import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';

// This suite is copied into a temporary directory by CI; no application
// Firebase config, real account, credentials, or cloud SDK project is loaded.
const projectId = 'demo-signal-forge-rules';
const expectedHost = '127.0.0.1:8080';
if (process.env.FIRESTORE_EMULATOR_HOST !== expectedHost || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error('REFUSING_NON_DEMO_FIRESTORE_TARGET');
}
const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') },
});
const a = 'test-owner-a', b = 'test-owner-b';
const owner = env.authenticatedContext(a, { email_verified: true }).firestore();
const other = env.authenticatedContext(b, { email_verified: true }).firestore();
const unverified = env.authenticatedContext(a, { email_verified: false }).firestore();
const guest = env.unauthenticatedContext().firestore();
const stamp = Timestamp.fromMillis(1700000000000);
const profile = uid => ({ uid, publicId: 'SF-' + uid, email: uid + '@example.invalid', displayName: 'Test Owner', createdAt: stamp, updatedAt: stamp });
const pnl = (uid, dateKey) => ({ userId: uid, dateKey, startingEquityUsd: 100, endingEquityUsd: 125, realizedPnlUsd: 25, returnPct: 25, scoopedToVaultUsd: 0, manualReleasedUsd: 0, tradeCount: 1, winningTrades: 1, losingTrades: 0, winRatePct: 100, recordHash: 'fixture1234', createdAt: stamp, updatedAt: stamp });
const vault = (uid, id = 'primaryVault') => ({ id, userId: uid, thresholdMode: 'USD_FIXED', profitThresholdUsd: 250, profitThresholdPct: 2, scoopExcessRatioPct: 100, enabled: true, lockedVaultBalanceUsd: 0, totalScoopedLifetimeUsd: 0, stateVersion: 1, createdAt: stamp, updatedAt: stamp });
const pnlPath = 'users/' + a + '/dailyPnlRecords/2026-01-01';
const vaultPath = 'users/' + a + '/vaultLocker/primaryVault';
let checks = 0;
async function allow(label, operation) { const r = await assertSucceeds(operation()); checks++; console.log('PASS allow:', label); return r; }
async function deny(label, operation) { await assertFails(operation()); checks++; console.log('PASS deny:', label); }
try {
  await env.clearFirestore();
  // Admin bypass is limited to seeding this disposable emulator.
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/' + a), profile(a));
    await setDoc(doc(db, 'users/' + b), profile(b));
    await setDoc(doc(db, pnlPath), pnl(a, '2026-01-01'));
    await setDoc(doc(db, vaultPath), vault(a));
  });
  await allow('owner profile get', () => getDoc(doc(owner, 'users/' + a)));
  await deny('other profile get', () => getDoc(doc(other, 'users/' + a)));
  await deny('guest profile get', () => getDoc(doc(guest, 'users/' + a)));
  await deny('owner user enumeration', () => getDocs(collection(owner, 'users')));
  await allow('owner profile update', () => updateDoc(doc(owner, 'users/' + a), { displayName: 'Updated Test Owner', updatedAt: serverTimestamp() }));
  await deny('public ID spoof', () => updateDoc(doc(owner, 'users/' + a), { publicId: 'SF-' + b, updatedAt: serverTimestamp() }));
  await deny('unverified profile update', () => updateDoc(doc(unverified, 'users/' + a), { displayName: 'No', updatedAt: serverTimestamp() }));
  const watchPath = 'users/' + a + '/watchlist/BTCUSDT';
  await allow('verified owner watchlist create', () => setDoc(doc(owner, watchPath), { id:'BTCUSDT', userId:a, symbol:'BTCUSDT', coinName:'Bitcoin', createdAt:serverTimestamp() }));
  await allow('owner watchlist read', () => getDoc(doc(owner, watchPath)));
  await deny('other watchlist read', () => getDoc(doc(other, watchPath)));
  await deny('cross-user watchlist write', () => updateDoc(doc(other, watchPath), { notes: 'denied' }));
  await allow('verified owner watchlist delete', () => deleteDoc(doc(owner, watchPath)));
  for (const path of [pnlPath, vaultPath]) {
    await allow('owner legacy financial read ' + path, () => getDoc(doc(owner, path)));
    await deny('other legacy financial read ' + path, () => getDoc(doc(other, path)));
    await deny('guest legacy financial read ' + path, () => getDoc(doc(guest, path)));
    await deny('owner financial delete ' + path, () => deleteDoc(doc(owner, path)));
    await deny('other financial delete ' + path, () => deleteDoc(doc(other, path)));
    await deny('guest financial delete ' + path, () => deleteDoc(doc(guest, path)));
  }
  for (const name of ['dailyPnlRecords', 'vaultLocker']) {
    const c = 'users/' + a + '/' + name;
    await allow('owner scoped query ' + name, () => getDocs(query(collection(owner, c), where('userId', '==', a))));
    await deny('unscoped owner financial query ' + name, () => getDocs(collection(owner, c)));
    await deny('other scoped query ' + name, () => getDocs(query(collection(other, c), where('userId', '==', a))));
    await deny('guest scoped query ' + name, () => getDocs(query(collection(guest, c), where('userId', '==', a))));
  }
  for (const [label, db] of [['verified owner',owner],['unverified owner',unverified],['other user',other],['guest',guest]]) {
    await deny(label + ' schema-valid PnL create', () => setDoc(doc(db, 'users/' + a + '/dailyPnlRecords/2026-01-02'), { ...pnl(a, '2026-01-02'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await deny(label + ' PnL update', () => updateDoc(doc(db, pnlPath), { realizedPnlUsd:999, updatedAt:serverTimestamp() }));
    await deny(label + ' schema-valid vault create', () => setDoc(doc(db, 'users/' + a + '/vaultLocker/alternateVault'), { ...vault(a, 'alternateVault'), createdAt:serverTimestamp(), updatedAt:serverTimestamp() }));
    await deny(label + ' vault balance update', () => updateDoc(doc(db, vaultPath), { lockedVaultBalanceUsd:999, updatedAt:serverTimestamp() }));
  }
  const batch = writeBatch(owner);
  batch.update(doc(owner, 'users/' + a), { displayName:'Should Not Commit', updatedAt:serverTimestamp() });
  batch.update(doc(owner, pnlPath), { realizedPnlUsd:999, updatedAt:serverTimestamp() });
  await deny('atomic batch with forbidden financial mutation', () => batch.commit());
  assert.equal((await getDoc(doc(owner, pnlPath))).data().realizedPnlUsd, 25);
  assert.equal((await getDoc(doc(owner, vaultPath))).data().lockedVaultBalanceUsd, 0);
  assert.equal((await getDoc(doc(owner, 'users/' + a))).data().displayName, 'Updated Test Owner');
  console.log('FIRESTORE_EMULATOR_VERIFIED_CHECKS=' + checks);
} finally {
  await env.cleanup();
}
