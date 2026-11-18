import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  updateDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function maskEmailForLogs(email?: string | null): string | null {
  if (!email) return null;
  const atIdx = email.indexOf('@');
  if (atIdx <= 1) return '[redacted]';
  return `${email.slice(0, 2)}***${email.slice(atIdx)}`;
}

function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: maskEmailForLogs(auth.currentUser?.email),
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: maskEmailForLogs(provider.email),
        })) || [],
    },
    operationType,
    path,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function logFirestoreSnapshotError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): void {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error('Firestore Snapshot Error:', JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

export interface UserWatchlistEntry {
  id: string;
  userId: string;
  symbol: string;
  coinName: string;
  notes?: string;
}

export interface UserPriceAlert {
  id: string;
  userId: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW';
  targetPrice: number;
  active: boolean;
  triggered: boolean;
  emailNotify: boolean;
}

export async function syncUserProfile(user: User): Promise<void> {
  if (!user.emailVerified) return;
  const userRef = doc(db, 'users', user.uid);
  try {
    const existing = await getDocFromServer(userRef);
    const displayName = (user.displayName || user.email?.split('@')[0] || 'Trader').slice(0, 80);
    const email = (user.email || '').slice(0, 254);
    if (!existing.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email,
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        email,
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  await syncUserProfile(result.user);
  return result.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password);
  if (result.user.emailVerified) {
    await syncUserProfile(result.user);
  }
  return result.user;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName.trim()) {
    await updateProfile(result.user, { displayName: displayName.trim().slice(0, 80) });
  }
  await sendEmailVerification(result.user);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function subscribeAuth(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}

export function subscribeWatchlist(
  userId: string,
  onData: (items: UserWatchlistEntry[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/watchlist`;
  const q = query(collection(db, path), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: UserWatchlistEntry[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          userId: String(data.userId),
          symbol: String(data.symbol),
          coinName: String(data.coinName),
          notes: data.notes ? String(data.notes) : undefined,
        };
      });
      onData(items);
    },
    (error) => {
      logFirestoreSnapshotError(error, OperationType.LIST, path);
      if (onError) onError(error);
    }
  );
}

export async function addWatchlistItem(
  userId: string,
  symbol: string,
  coinName: string
): Promise<void> {
  const cleanSymbol = symbol.replace(/[^A-Z0-9]/g, '').slice(0, 16);
  const path = `users/${userId}/watchlist/${cleanSymbol}`;
  try {
    await setDoc(doc(db, 'users', userId, 'watchlist', cleanSymbol), {
      id: cleanSymbol,
      userId,
      symbol: cleanSymbol,
      coinName: coinName.slice(0, 50),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function removeWatchlistItem(userId: string, symbol: string): Promise<void> {
  const cleanSymbol = symbol.replace(/[^A-Z0-9]/g, '').slice(0, 16);
  const path = `users/${userId}/watchlist/${cleanSymbol}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'watchlist', cleanSymbol));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribePriceAlerts(
  userId: string,
  onData: (alerts: UserPriceAlert[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/alerts`;
  const q = query(collection(db, path), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: UserPriceAlert[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          userId: String(data.userId),
          symbol: String(data.symbol),
          condition: data.condition === 'BELOW' ? 'BELOW' : 'ABOVE',
          targetPrice: Number(data.targetPrice),
          active: Boolean(data.active),
          triggered: Boolean(data.triggered),
          emailNotify: Boolean(data.emailNotify),
        };
      });
      onData(items);
    },
    (error) => {
      logFirestoreSnapshotError(error, OperationType.LIST, path);
      if (onError) onError(error);
    }
  );
}

export async function createPriceAlert(
  userId: string,
  input: Omit<UserPriceAlert, 'id' | 'userId' | 'active' | 'triggered'>
): Promise<string> {
  const cleanSymbol = input.symbol.replace(/[^A-Z0-9]/g, '').slice(0, 16);
  const alertId = `al_${cleanSymbol}_${Date.now()}`.slice(0, 64);
  const path = `users/${userId}/alerts/${alertId}`;
  try {
    await setDoc(doc(db, 'users', userId, 'alerts', alertId), {
      id: alertId,
      userId,
      symbol: cleanSymbol,
      condition: input.condition,
      targetPrice: Number(input.targetPrice),
      active: true,
      triggered: false,
      emailNotify: Boolean(input.emailNotify),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return alertId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePriceAlertStatus(
  userId: string,
  alertId: string,
  patch: Partial<Pick<UserPriceAlert, 'active' | 'triggered'>>
): Promise<void> {
  const path = `users/${userId}/alerts/${alertId}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'alerts', alertId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deletePriceAlert(userId: string, alertId: string): Promise<void> {
  const path = `users/${userId}/alerts/${alertId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'alerts', alertId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function getCurrentFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export interface PersistedWorkspaceConfig {
  id: string;
  userId: string;
  checksum: string;
  toggles: Record<string, boolean>;
}

export function subscribeWorkspaceControlConfig(
  userId: string,
  onData: (cfg: PersistedWorkspaceConfig | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/workspaceConfig/controlMatrix`;
  return onSnapshot(
    doc(db, 'users', userId, 'workspaceConfig', 'controlMatrix'),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      onData({
        id: String(data.id || 'controlMatrix'),
        userId: String(data.userId || userId),
        checksum: String(data.checksum || ''),
        toggles: (data.toggles && typeof data.toggles === 'object' ? data.toggles : {}) as Record<
          string,
          boolean
        >,
      });
    },
    (error) => {
      logFirestoreSnapshotError(error, OperationType.GET, path);
      if (onError) onError(error);
    }
  );
}

export async function saveWorkspaceControlConfig(
  userId: string,
  checksum: string,
  toggles: Record<string, boolean>
): Promise<void> {
  const path = `users/${userId}/workspaceConfig/controlMatrix`;
  const ref = doc(db, 'users', userId, 'workspaceConfig', 'controlMatrix');
  try {
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: 'controlMatrix',
        userId,
        checksum: checksum.slice(0, 40),
        toggles,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        checksum: checksum.slice(0, 40),
        toggles,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveRollbackCheckpointToFirestore(
  userId: string,
  input: {
    snapshotId: string;
    version: number;
    reason: string;
    checksum: string;
    toggles: Record<string, boolean>;
  }
): Promise<void> {
  const cleanId = input.snapshotId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const path = `users/${userId}/rollbackSnapshots/${cleanId}`;
  try {
    await setDoc(doc(db, 'users', userId, 'rollbackSnapshots', cleanId), {
      snapshotId: cleanId,
      userId,
      version: Math.max(1, Number(input.version) || 1),
      reason: input.reason.slice(0, 200) || 'Checkpoint',
      checksum: input.checksum.slice(0, 40),
      toggles: input.toggles,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveErrorAuditToFirestore(
  userId: string,
  input: {
    id: string;
    correlationId: string;
    serviceId: string;
    severity: 'WARN' | 'ERROR' | 'CRITICAL';
    code: string;
    message: string;
    recoveryAction: string;
  }
): Promise<void> {
  const cleanId = input.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const path = `users/${userId}/errorLogs/${cleanId}`;
  try {
    await setDoc(doc(db, 'users', userId, 'errorLogs', cleanId), {
      id: cleanId,
      userId,
      correlationId: input.correlationId.slice(0, 80),
      serviceId: input.serviceId.slice(0, 40),
      severity: input.severity,
      code: input.code.slice(0, 64),
      message: input.message.slice(0, 320) || 'Error recorded',
      recoveryAction: input.recoveryAction.slice(0, 240) || 'Contained',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

