import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  runTransaction,
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
import { isRetryableAuthNetworkError } from './firebaseAuthErrors';
import {
  normalizeToggleMapForFirestore,
  sanitizeChecksum,
  sanitizeErrorAuditFields,
  sanitizeFirestoreId,
  sanitizeFirestoreSymbol,
  sanitizePriceAlertFields,
  sanitizeUserProfileFields,
  sanitizeWatchlistFields,
} from './firestorePayloads';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export function getFirestoreConfigMetadata(): {
  projectId: string;
  firestoreDatabaseId: string;
} {
  return {
    projectId: firebaseConfig.projectId,
    firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
  };
}

/**
 * Initialize Firebase Auth without eagerly registering browserPopupRedirectResolver.
 * Eagerly attaching browserPopupRedirectResolver via getAuth() causes Firebase Auth to
 * proactively inject and ping https://<authDomain>/__/auth/iframe on page load on
 * Mobile/Safari/iOS and embedded preview frames, throwing unhandled auth/network-request-failed
 * errors before the user ever initiates sign-in. Instead, pass browserPopupRedirectResolver
 * on demand inside signInWithGoogle().
 */
function createAuthInstance(): Auth {
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
      ],
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuthInstance();
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

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

/** Public-facing reference only. Firebase UID remains the authentication identity. */
export function getSignalForgePublicId(uid: string): string {
  return `SF-${uid}`;
}

const ensuredProfileInFlight = new Map<string, Promise<void>>();
const documentWriteQueue = new Map<string, Promise<void>>();

/**
 * Serializes concurrent writes targeting the same Firestore document path within
 * this tab so overlapping polling ticks or StrictMode double-effects never race.
 */
async function withDocumentWriteLock<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = documentWriteQueue.get(path) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const currentGate = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => currentGate);
  documentWriteQueue.set(path, tail);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    releaseCurrent();
    if (documentWriteQueue.get(path) === tail) {
      documentWriteQueue.delete(path);
    }
  }
}

/**
 * Guarantees the parent `/users/{userId}` document exists before any subcollection
 * `create` executes, preventing Master Gate `exists(/users/{userId})` race failures
 * on first sign-in.
 */
async function ensureUserProfileReady(userId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified || currentUser.uid !== userId) {
    return;
  }
  const existingPromise = ensuredProfileInFlight.get(userId);
  if (existingPromise) {
    await existingPromise;
    return;
  }
  const syncPromise = syncUserProfile(currentUser).catch((err) => {
    ensuredProfileInFlight.delete(userId);
    throw err;
  });
  ensuredProfileInFlight.set(userId, syncPromise);
  await syncPromise;
}

export async function syncUserProfile(user: User): Promise<void> {
  if (!user.emailVerified) return;
  const fields = sanitizeUserProfileFields({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
  });
  const path = `users/${fields.uid}`;
  const userRef = doc(db, 'users', fields.uid);
  try {
    await withDocumentWriteLock(path, async () => {
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(userRef);
        if (!existing.exists()) {
          tx.set(userRef, {
            uid: fields.uid,
            publicId: getSignalForgePublicId(user.uid),
            email: fields.email,
            displayName: fields.displayName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.update(userRef, {
            publicId: getSignalForgePublicId(user.uid),
            email: fields.email,
            displayName: fields.displayName,
            updatedAt: serverTimestamp(),
          });
        }
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function signInWithGoogle(): Promise<User> {
  let result;
  try {
    result = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
  } catch (firstErr) {
    if (isRetryableAuthNetworkError(firstErr)) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      result = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
    } else {
      throw firstErr;
    }
  }
  await syncUserProfile(result.user).catch(() => undefined);
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
  ensuredProfileInFlight.clear();
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
  const fields = sanitizeWatchlistFields({ userId, symbol, coinName });
  const path = `users/${fields.userId}/watchlist/${fields.id}`;
  try {
    await ensureUserProfileReady(fields.userId);
    await setDoc(doc(db, 'users', fields.userId, 'watchlist', fields.id), {
      id: fields.id,
      userId: fields.userId,
      symbol: fields.symbol,
      coinName: fields.coinName,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function removeWatchlistItem(userId: string, symbol: string): Promise<void> {
  const cleanSymbol = sanitizeFirestoreSymbol(symbol);
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
  const cleanSymbol = sanitizeFirestoreSymbol(input.symbol);
  const fields = sanitizePriceAlertFields({
    alertId: `al_${cleanSymbol}_${Date.now()}`,
    userId,
    symbol: cleanSymbol,
    condition: input.condition,
    targetPrice: input.targetPrice,
    emailNotify: input.emailNotify,
  });
  const path = `users/${fields.userId}/alerts/${fields.id}`;
  try {
    await ensureUserProfileReady(fields.userId);
    await setDoc(doc(db, 'users', fields.userId, 'alerts', fields.id), {
      id: fields.id,
      userId: fields.userId,
      symbol: fields.symbol,
      condition: fields.condition,
      targetPrice: fields.targetPrice,
      active: fields.active,
      triggered: fields.triggered,
      emailNotify: fields.emailNotify,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return fields.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePriceAlertStatus(
  userId: string,
  alertId: string,
  patch: Partial<Pick<UserPriceAlert, 'active' | 'triggered'>>
): Promise<void> {
  const cleanId = sanitizeFirestoreId(alertId, 64, 'alert');
  const path = `users/${userId}/alerts/${cleanId}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'alerts', cleanId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deletePriceAlert(userId: string, alertId: string): Promise<void> {
  const cleanId = sanitizeFirestoreId(alertId, 64, 'alert');
  const path = `users/${userId}/alerts/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'alerts', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function getCurrentFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    const token = await user.getIdToken(forceRefresh);
    return auth.currentUser === user ? token : null;
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
  const cleanUserId = sanitizeFirestoreId(userId, 128, 'user');
  if (!auth.currentUser || !auth.currentUser.emailVerified || auth.currentUser.uid !== cleanUserId) {
    return;
  }
  const safeChecksum = sanitizeChecksum(checksum);
  const safeToggles = normalizeToggleMapForFirestore(toggles);
  const path = `users/${cleanUserId}/workspaceConfig/controlMatrix`;
  const ref = doc(db, 'users', cleanUserId, 'workspaceConfig', 'controlMatrix');
  try {
    await ensureUserProfileReady(cleanUserId);
    await withDocumentWriteLock(path, async () => {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          tx.set(ref, {
            id: 'controlMatrix',
            userId: cleanUserId,
            checksum: safeChecksum,
            toggles: safeToggles,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.update(ref, {
            checksum: safeChecksum,
            toggles: safeToggles,
            updatedAt: serverTimestamp(),
          });
        }
      });
    });
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
  const cleanUserId = sanitizeFirestoreId(userId, 128, 'user');
  const cleanId = sanitizeFirestoreId(input.snapshotId, 64, 'snap_checkpoint');
  const safeToggles = normalizeToggleMapForFirestore(input.toggles);
  const path = `users/${cleanUserId}/rollbackSnapshots/${cleanId}`;
  try {
    await ensureUserProfileReady(cleanUserId);
    await setDoc(doc(db, 'users', cleanUserId, 'rollbackSnapshots', cleanId), {
      snapshotId: cleanId,
      userId: cleanUserId,
      version: Math.max(1, Number(input.version) || 1),
      reason: input.reason.trim().slice(0, 200) || 'Checkpoint',
      checksum: sanitizeChecksum(input.checksum),
      toggles: safeToggles,
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
  const fields = sanitizeErrorAuditFields({
    ...input,
    userId,
  });
  const path = `users/${fields.userId}/errorLogs/${fields.id}`;
  try {
    await ensureUserProfileReady(fields.userId);
    await setDoc(doc(db, 'users', fields.userId, 'errorLogs', fields.id), {
      id: fields.id,
      userId: fields.userId,
      correlationId: fields.correlationId,
      serviceId: fields.serviceId,
      severity: fields.severity,
      code: fields.code,
      message: fields.message,
      recoveryAction: fields.recoveryAction,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export interface PersistedDailyPnlRecord {
  dateKey: string;
  userId: string;
  startingEquityUsd: number;
  endingEquityUsd: number;
  realizedPnlUsd: number;
  returnPct: number;
  scoopedToVaultUsd: number;
  manualReleasedUsd: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  recordHash: string;
}

export interface PersistedVaultLockerState {
  id: string;
  userId: string;
  thresholdMode: 'USD_FIXED' | 'PERCENT_OF_EQUITY';
  profitThresholdUsd: number;
  profitThresholdPct: number;
  scoopExcessRatioPct: number;
  enabled: boolean;
  lockedVaultBalanceUsd: number;
  totalScoopedLifetimeUsd: number;
  stateVersion: number;
}

export function subscribeDailyPnlRecords(
  userId: string,
  onData: (records: PersistedDailyPnlRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/dailyPnlRecords`;
  const q = query(collection(db, path), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const records: PersistedDailyPnlRecord[] = snapshot.docs
        .map((d) => {
          const data = d.data();
          return {
            dateKey: String(data.dateKey || d.id),
            userId: String(data.userId || userId),
            startingEquityUsd: Number(data.startingEquityUsd) || 0,
            endingEquityUsd: Number(data.endingEquityUsd) || 0,
            realizedPnlUsd: Number(data.realizedPnlUsd) || 0,
            returnPct: Number(data.returnPct) || 0,
            scoopedToVaultUsd: Number(data.scoopedToVaultUsd) || 0,
            manualReleasedUsd: Number(data.manualReleasedUsd) || 0,
            tradeCount: Number(data.tradeCount) || 0,
            winningTrades: Number(data.winningTrades) || 0,
            losingTrades: Number(data.losingTrades) || 0,
            winRatePct: Number(data.winRatePct) || 0,
            recordHash: String(data.recordHash || ''),
          };
        })
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      onData(records);
    },
    (error) => {
      logFirestoreSnapshotError(error, OperationType.LIST, path);
      if (onError) onError(error);
    }
  );
}

export function subscribeVaultLockerState(
  userId: string,
  onData: (state: PersistedVaultLockerState | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const vaultId = 'primaryVault';
  const path = `users/${userId}/vaultLocker/${vaultId}`;
  return onSnapshot(
    doc(db, 'users', userId, 'vaultLocker', vaultId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      onData({
        id: String(data.id || vaultId),
        userId: String(data.userId || userId),
        thresholdMode:
          data.thresholdMode === 'PERCENT_OF_EQUITY' ? 'PERCENT_OF_EQUITY' : 'USD_FIXED',
        profitThresholdUsd: Number(data.profitThresholdUsd) || 250,
        profitThresholdPct: Number(data.profitThresholdPct) || 1.5,
        scoopExcessRatioPct: Number(data.scoopExcessRatioPct) || 100,
        enabled: Boolean(data.enabled),
        lockedVaultBalanceUsd: Number(data.lockedVaultBalanceUsd) || 0,
        totalScoopedLifetimeUsd: Number(data.totalScoopedLifetimeUsd) || 0,
        stateVersion: Number(data.stateVersion) || 1,
      });
    },
    (error) => {
      logFirestoreSnapshotError(error, OperationType.GET, path);
      if (onError) onError(error);
    }
  );
}

// Retained compatibility exports deliberately fail closed. Browser-provided data
// cannot establish financial settlement provenance, even for a verified owner.
export async function saveDailyPnlRecordToFirestore(
  _userId: string,
  _record: Omit<PersistedDailyPnlRecord, 'userId'>
): Promise<void> {
  throw new Error('FINANCIAL_CLIENT_WRITE_DISABLED');
}

export async function saveVaultLockerSnapshotToFirestore(
  _userId: string,
  _state: Omit<PersistedVaultLockerState, 'id' | 'userId'>
): Promise<void> {
  throw new Error('FINANCIAL_CLIENT_WRITE_DISABLED');
}
