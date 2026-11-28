import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp, SDK_VERSION } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, setDoc, serverTimestamp, terminate } from 'firebase/firestore';

const projectId = 'demo-signal-forge-rules';
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('REFUSING_NON_DEMO_FIRESTORE_TARGET');
}
const require = createRequire(import.meta.url);
const firestoreRequire = createRequire(require.resolve('@firebase/firestore'));
const grpcVersion = firestoreRequire('@grpc/grpc-js/package.json').version;
assert.equal(SDK_VERSION, '13.3.0');
assert.equal(grpcVersion, '1.13.6');
console.log('LOCKED_FIREBASE_SDK=' + SDK_VERSION + ' GRPC=' + grpcVersion);

const apps = [];
const stores = [];
function connect(name, uid) {
  const app = initializeApp({ projectId, apiKey: 'demo-only-not-a-real-key', appId: 'demo-only-app' }, name);
  apps.push(app);
  const db = getFirestore(app);
  stores.push(db);
  const mockUserToken = uid ? { sub: uid, email_verified: true, email: uid + '@example.invalid' } : undefined;
  connectFirestoreEmulator(db, '127.0.0.1', 8080, mockUserToken ? { mockUserToken } : {});
  return db;
}
let count = 0;
async function allow(label, fn) { const result = await fn(); count++; console.log('PASS SDK:', label); return result; }
async function deny(label, fn) { await assert.rejects(fn, error => error?.code === 'permission-denied'); count++; console.log('PASS SDK deny:', label); }
try {
  const owner = connect('sdk-owner', 'test-owner-a');
  const other = connect('sdk-other', 'test-owner-b');
  const guest = connect('sdk-guest');
  const profilePath = 'users/test-owner-a';
  const pnlPath = profilePath + '/dailyPnlRecords/2026-01-01';
  const vaultPath = profilePath + '/vaultLocker/primaryVault';
  // Existing isolated authorization suite seeds these demo records first.
  const profile = await allow('owner profile read', () => getDoc(doc(owner, profilePath)));
  assert.equal(profile.data().uid, 'test-owner-a');
  await allow('owner profile update', () => updateDoc(doc(owner, profilePath), {displayName:'SDK Compatibility Test', updatedAt:serverTimestamp()}));
  await deny('other profile read', () => getDoc(doc(other, profilePath)));
  await deny('guest profile read', () => getDoc(doc(guest, profilePath)));
  await allow('owner PnL read', () => getDoc(doc(owner, pnlPath)));
  await deny('other PnL read', () => getDoc(doc(other, pnlPath)));
  await deny('owner forged PnL update', () => updateDoc(doc(owner, pnlPath), {realizedPnlUsd:999, updatedAt:serverTimestamp()}));
  await deny('owner vault balance update', () => updateDoc(doc(owner, vaultPath), {lockedVaultBalanceUsd:999, updatedAt:serverTimestamp()}));
  const fresh = await getDoc(doc(owner, pnlPath));
  assert.equal(fresh.data().realizedPnlUsd,25);
  assert.equal((await getDoc(doc(owner, vaultPath))).data().lockedVaultBalanceUsd,0);
  console.log('LOCKED_FIREBASE_SDK_VERIFIED_CHECKS=' + count);
} finally {
  await Promise.allSettled(stores.map(db => terminate(db)));
  await Promise.allSettled(apps.map(app => deleteApp(app)));
}
