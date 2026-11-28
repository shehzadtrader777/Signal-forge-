import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRESTORE_DATE_KEY_REGEX,
  FIRESTORE_ID_REGEX,
  FIRESTORE_SYMBOL_REGEX,
  normalizeToggleMapForFirestore,
  sanitizeChecksum,
  sanitizeDailyPnlFields,
  sanitizeErrorAuditFields,
  sanitizeFirestoreId,
  sanitizeFirestoreSymbol,
  sanitizePriceAlertFields,
  sanitizeRecordHash,
  sanitizeUserProfileFields,
  sanitizeVaultLockerFields,
  sanitizeWatchlistFields,
} from './firestorePayloads';
import { DEFAULT_CONTROL_MATRIX } from './controlMatrix';

test('Firestore payload sanitizers enforce blueprint regexes, bounds, and defaults across all entities', () => {
  // 1. ID and symbol sanitization
  const safeId = sanitizeFirestoreId('../bad/id$! ' + 'x'.repeat(200), 64);
  assert.ok(safeId.length <= 64);
  assert.ok(FIRESTORE_ID_REGEX.test(safeId));

  const safeSym = sanitizeFirestoreSymbol('eth-usdt!');
  assert.equal(safeSym, 'ETHUSDT');
  assert.ok(FIRESTORE_SYMBOL_REGEX.test(safeSym));
  assert.equal(sanitizeFirestoreSymbol('!!'), 'BTCUSDT');

  // 2. UserProfile sanitization
  const profile = sanitizeUserProfileFields({
    uid: 'user_abc-123',
    email: 'trader@example.com',
    displayName: '   ',
  });
  assert.equal(profile.uid, 'user_abc-123');
  assert.equal(profile.displayName, 'Trader');
  assert.ok(profile.email.length >= 3 && profile.email.length <= 254);

  // 3. Watchlist sanitization
  const watch = sanitizeWatchlistFields({
    userId: 'user_abc-123',
    symbol: 'solusdt',
    coinName: 'S'.repeat(80),
    notes: 'N'.repeat(300),
  });
  assert.equal(watch.symbol, 'SOLUSDT');
  assert.equal(watch.coinName.length, 50);
  assert.equal(watch.notes?.length, 240);

  // 4. PriceAlert sanitization prevents non-positive targetPrice
  const alert = sanitizePriceAlertFields({
    alertId: 'al_btc_1',
    userId: 'user_abc-123',
    symbol: 'BTCUSDT',
    condition: 'ABOVE',
    targetPrice: -10,
    emailNotify: true,
  });
  assert.ok(alert.targetPrice > 0);
  assert.equal(alert.active, true);
  assert.equal(alert.triggered, false);

  // 5. Toggle map normalization always outputs all 24 strict boolean keys
  const normalizedToggles = normalizeToggleMapForFirestore({
    spotWsStream: false,
    ghostShadowField: true,
  });
  assert.deepEqual(
    Object.keys(normalizedToggles).sort(),
    Object.keys(DEFAULT_CONTROL_MATRIX).sort()
  );
  assert.equal(normalizedToggles.spotWsStream, false);
  assert.equal('ghostShadowField' in normalizedToggles, false);

  // 6. Checksum & recordHash minimum lengths
  assert.ok(sanitizeChecksum('ab').length >= 4);
  assert.ok(sanitizeRecordHash('abc').length >= 8);

  // 7. ErrorAuditRecord enum clamping
  const audit = sanitizeErrorAuditFields({
    id: 'err_1',
    userId: 'user_abc-123',
    correlationId: 'corr-1',
    serviceId: 'invalid-service',
    severity: 'CRITICAL',
    code: 'WS_DROP',
    message: 'Socket dropped',
    recoveryAction: 'Reconnected',
  });
  assert.equal(audit.serviceId, 'telemetry-bus-svc');

  // 8. DailyPnlRecord date validation & clamping
  assert.equal(
    sanitizeDailyPnlFields({
      dateKey: 'invalid-date',
      userId: 'user_abc-123',
      startingEquityUsd: 1000,
      endingEquityUsd: 1050,
      realizedPnlUsd: 50,
      returnPct: 5,
      scoopedToVaultUsd: 10,
      manualReleasedUsd: 0,
      tradeCount: 2,
      winningTrades: 2,
      losingTrades: 0,
      winRatePct: 150,
      recordHash: 'short',
    }),
    null
  );

  const validDaily = sanitizeDailyPnlFields({
    dateKey: '2026-11-22',
    userId: 'user_abc-123',
    startingEquityUsd: -50,
    endingEquityUsd: 1050,
    realizedPnlUsd: 50,
    returnPct: 5,
    scoopedToVaultUsd: 10,
    manualReleasedUsd: 0,
    tradeCount: 2,
    winningTrades: 2,
    losingTrades: 0,
    winRatePct: 150,
    recordHash: 'short',
  });
  assert.ok(validDaily);
  assert.ok(FIRESTORE_DATE_KEY_REGEX.test(validDaily.dateKey));
  assert.equal(validDaily.startingEquityUsd, 0);
  assert.equal(validDaily.winRatePct, 100);
  assert.ok(validDaily.recordHash.length >= 8);

  // 9. VaultLockerState bounds clamping
  const vault = sanitizeVaultLockerFields({
    vaultId: 'primaryVault',
    userId: 'user_abc-123',
    thresholdMode: 'USD_FIXED',
    profitThresholdUsd: 1,
    profitThresholdPct: 99,
    scoopExcessRatioPct: 500,
    enabled: true,
    lockedVaultBalanceUsd: -25,
    totalScoopedLifetimeUsd: -10,
    stateVersion: 0,
  });
  assert.equal(vault.profitThresholdUsd, 10);
  assert.equal(vault.profitThresholdPct, 50);
  assert.equal(vault.scoopExcessRatioPct, 100);
  assert.equal(vault.lockedVaultBalanceUsd, 0);
  assert.equal(vault.totalScoopedLifetimeUsd, 0);
  assert.equal(vault.stateVersion, 1);
});

test('Firestore upserts use atomic runTransaction with path locking and single-flight vault sync', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const rootDir = path.resolve(import.meta.dirname, '..', '..');

  const firebaseSrc = fs.readFileSync(path.join(rootDir, 'src/lib/firebase.ts'), 'utf8');
  assert.ok(firebaseSrc.includes('runTransaction'), 'firebase.ts must import and use runTransaction');
  assert.ok(
    firebaseSrc.includes('function withDocumentWriteLock'),
    'firebase.ts must serialize concurrent writes per document path'
  );

  for (const fnName of [
    'syncUserProfile',
    'saveWorkspaceControlConfig',
    'saveDailyPnlRecordToFirestore',
    'saveVaultLockerSnapshotToFirestore',
  ]) {
    const start = firebaseSrc.indexOf(`export async function ${fnName}`);
    assert.ok(start >= 0, `${fnName} must exist`);
    const body = firebaseSrc.slice(start, start + 1400);
    assert.ok(
      body.includes('withDocumentWriteLock') && body.includes('runTransaction'),
      `${fnName} must wrap upsert in withDocumentWriteLock + runTransaction`
    );
    assert.equal(
      body.includes('getDocFromServer'),
      false,
      `${fnName} must not use non-atomic getDocFromServer before setDoc`
    );
  }

  const vaultPanelSrc = fs.readFileSync(
    path.join(rootDir, 'src/components/ProfitVaultAndDailyPnlPanel.tsx'),
    'utf8'
  );
  assert.ok(vaultPanelSrc.includes('vaultSyncSignature'), 'Panel must gate sync by content signature');
  assert.ok(vaultPanelSrc.includes('syncInFlightRef'), 'Panel must enforce single-flight cloud sync');
});

test('failed financial Firestore writes must reject so UI cannot falsely mark cloud sync successful', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..');
  const src = fs.readFileSync(path.join(root, 'src/lib/firebase.ts'), 'utf8');
  const functions = [
    'saveDailyPnlRecordToFirestore',
    'saveVaultLockerSnapshotToFirestore',
  ];
  for (const name of functions) {
    const start = src.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, `Missing financial cloud sync function: ${name}`);
    const remainder = src.slice(start);
    const nextExport = remainder.indexOf('\nexport ', 10);
    const body = nextExport === -1 ? remainder : remainder.slice(0, nextExport);
    assert.match(body, /throw new Error\([^)]*verified matching user/, `${name} must reject auth failures`);
    assert.match(body, /catch \(error\) \{[\s\S]*?handleFirestoreError\(error, OperationType\.WRITE, path\);\s*throw error;/,
      `${name} must rethrow write errors after reporting them`);
  }
  const dailyStart = src.indexOf('export async function saveDailyPnlRecordToFirestore(');
  const vaultStart = src.indexOf('export async function saveVaultLockerSnapshotToFirestore(');
  const daily = src.slice(dailyStart, vaultStart);
  assert.match(daily, /if \(!sanitized\) throw new Error/, 'Invalid daily PnL records must reject instead of silently succeeding');
  const panel = fs.readFileSync(path.join(root, 'src/components/ProfitVaultAndDailyPnlPanel.tsx'), 'utf8');
  assert.ok(panel.includes('await saveVaultLockerSnapshotToFirestore('));
  assert.ok(panel.includes('await saveDailyPnlRecordToFirestore('));
});
