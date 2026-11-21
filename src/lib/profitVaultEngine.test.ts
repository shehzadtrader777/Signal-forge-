import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROFIT_SCOOP_CONFIG,
  ProfitScoopVaultEngine,
  USER_OVERRIDE_CONFIRMATION_PHRASES,
} from './profitVaultEngine';

test('ProfitScoopVaultEngine continuously monitors realized gains, auto-scoops excess into immutable Locker Vault, and preserves zero-drift accounting', () => {
  const engine = new ProfitScoopVaultEngine(
    10_000,
    {
      ...DEFAULT_PROFIT_SCOOP_CONFIG,
      enabled: true,
      thresholdMode: 'USD_FIXED',
      profitThresholdUsd: 200,
      scoopExcessRatioPct: 100,
    },
    false
  );

  // Trade 1: +$150 (below $200 threshold -> stays in active trading balance, nothing scooped)
  const r1 = engine.ingestRealizedTrade({
    tradeId: 'tr_1',
    symbol: 'BTCUSDT',
    realizedPnlUsd: 150,
    sourceAgent: 'AI_COORDINATOR',
    settledAtMs: Date.UTC(2026, 10, 19, 10, 0, 0),
  });
  assert.equal(r1.scoopedNow, false);
  assert.equal(r1.snapshot.activeTradingBalanceUsd, 10_150);
  assert.equal(r1.snapshot.lockedVaultBalanceUsd, 0);
  assert.equal(r1.snapshot.integrity.reconciliationDriftUsd, 0);

  // Trade 2: +$175 (accumulated $325 > $200 -> excess $125 auto-scooped into immutable Locker Vault!)
  const r2 = engine.ingestRealizedTrade({
    tradeId: 'tr_2',
    symbol: 'SOLUSDT',
    realizedPnlUsd: 175,
    sourceAgent: 'PRE_PUMP_SUPPORT',
    settledAtMs: Date.UTC(2026, 10, 19, 11, 0, 0),
  });
  assert.equal(r2.scoopedNow, true);
  assert.equal(r2.scoopedAmountUsd, 125);
  assert.equal(r2.snapshot.lockedVaultBalanceUsd, 125);
  assert.equal(r2.snapshot.activeTradingBalanceUsd, 10_200);
  assert.equal(r2.snapshot.integrity.accountingInvariantValid, true);
  assert.equal(r2.snapshot.integrity.hashChainValid, true);
  assert.equal(r2.snapshot.integrity.reconciliationDriftUsd, 0);

  // Duplicate tradeId replay must be ignored cleanly (zero double-counting drift)
  const dup = engine.ingestRealizedTrade({
    tradeId: 'tr_2',
    symbol: 'SOLUSDT',
    realizedPnlUsd: 175,
    sourceAgent: 'PRE_PUMP_SUPPORT',
    settledAtMs: Date.UTC(2026, 10, 19, 11, 0, 1),
  });
  assert.equal(dup.duplicateIgnored, true);
  assert.equal(dup.snapshot.lockedVaultBalanceUsd, 125);
  assert.equal(dup.snapshot.totalProcessedTrades, 2);

  // Subsequent loss must ONLY impact active trading capital — immutable Locker Vault untouched!
  const r3 = engine.ingestRealizedTrade({
    tradeId: 'tr_3',
    symbol: 'ETHUSDT',
    realizedPnlUsd: -120,
    sourceAgent: 'SMC_FRVP',
    settledAtMs: Date.UTC(2026, 10, 19, 12, 0, 0),
  });
  assert.equal(r3.snapshot.lockedVaultBalanceUsd, 125, 'Losses must never touch immutable Locker Vault');
  assert.equal(r3.snapshot.activeTradingBalanceUsd, 10_080);
  assert.equal(r3.snapshot.integrity.reconciliationDriftUsd, 0);

  // Verify high-precision Daily PnL tracking (+205 / 10,000 = +2.0500%)
  const day = r3.snapshot.dailyHistory.find((d) => d.dateKey === '2026-11-19');
  assert.ok(day);
  assert.equal(day.realizedPnlUsd, 205);
  assert.equal(day.returnPct, 2.05);
  assert.equal(day.scoopedToVaultUsd, 125);
  assert.equal(day.tradeCount, 3);
  assert.equal(day.winningTrades, 2);
  assert.equal(day.losingTrades, 1);
});

test('Manual Override Protocol strictly forbids autonomous agents and enforces user-only confirmation for release and rebalance', () => {
  const engine = new ProfitScoopVaultEngine(
    20_000,
    {
      ...DEFAULT_PROFIT_SCOOP_CONFIG,
      thresholdMode: 'USD_FIXED',
      profitThresholdUsd: 100,
      scoopExcessRatioPct: 100,
    },
    false
  );

  // Generate $500 profit -> $400 auto-scooped into immutable Locker Vault
  engine.ingestRealizedTrade({
    tradeId: 'tr_lock_1',
    symbol: 'BTCUSDT',
    realizedPnlUsd: 500,
    sourceAgent: 'AI_COORDINATOR',
    settledAtMs: Date.UTC(2026, 10, 19, 14, 0, 0),
  });
  assert.equal(engine.getSnapshot().lockedVaultBalanceUsd, 400);

  // 1. Autonomous agent attempting override MUST be strictly forbidden
  const agentAttempt = engine.executeManualUserOverride({
    actorType: 'AUTONOMOUS_AGENT',
    actorId: 'AI_COORDINATOR',
    action: 'RELEASE_TO_TRADING',
    amountUsd: 200,
    confirmationPhrase: USER_OVERRIDE_CONFIRMATION_PHRASES.RELEASE_TO_TRADING,
    reason: 'Autonomous margin top-up attempt',
  });
  assert.equal(agentAttempt.allowed, false);
  assert.equal(agentAttempt.code, 'AGENT_OVERRIDE_FORBIDDEN');
  assert.equal(engine.getSnapshot().lockedVaultBalanceUsd, 400);

  // 2. Human user with wrong confirmation phrase MUST be rejected
  const badConfirm = engine.executeManualUserOverride({
    actorType: 'AUTHENTICATED_USER',
    actorId: 'uid_owner_1',
    actorEmail: 'dillwalaa.69@gmail.com',
    action: 'RELEASE_TO_TRADING',
    amountUsd: 150,
    confirmationPhrase: 'WRONG_PHRASE',
    reason: 'Manual test',
  });
  assert.equal(badConfirm.allowed, false);
  assert.equal(badConfirm.code, 'USER_CONFIRMATION_REQUIRED');

  // 3. Human user with valid UNLOCK_VAULT releases $150 back to Active Trading Capital
  const userRelease = engine.executeManualUserOverride({
    actorType: 'AUTHENTICATED_USER',
    actorId: 'uid_owner_1',
    actorEmail: 'dillwalaa.69@gmail.com',
    action: 'RELEASE_TO_TRADING',
    amountUsd: 150,
    confirmationPhrase: 'UNLOCK_VAULT',
    reason: 'Scaling into breakout allocation',
  });
  assert.equal(userRelease.allowed, true);
  assert.equal(userRelease.code, 'OVERRIDE_EXECUTED');
  assert.equal(userRelease.snapshot.lockedVaultBalanceUsd, 250);
  assert.equal(userRelease.snapshot.activeTradingBalanceUsd, 20_250);
  assert.equal(userRelease.snapshot.integrity.reconciliationDriftUsd, 0);

  // 4. Human user with valid REBALANCE_VAULT withdraws $100 to external cold treasury
  const userRebalance = engine.executeManualUserOverride({
    actorType: 'AUTHENTICATED_USER',
    actorId: 'uid_owner_1',
    actorEmail: 'dillwalaa.69@gmail.com',
    action: 'REBALANCE_EXTERNAL',
    amountUsd: 100,
    confirmationPhrase: 'REBALANCE_VAULT',
    reason: 'Cold storage treasury rebalance',
  });
  assert.equal(userRebalance.allowed, true);
  assert.equal(userRebalance.snapshot.lockedVaultBalanceUsd, 150);
  assert.equal(userRebalance.snapshot.netExternalRebalancedUsd, 100);
  assert.equal(userRebalance.snapshot.integrity.hashChainValid, true);
  assert.equal(userRebalance.snapshot.integrity.accountingInvariantValid, true);
  assert.equal(userRebalance.snapshot.integrity.reconciliationDriftUsd, 0);
});

test('PERCENT_OF_EQUITY threshold mode dynamically scales scooping threshold and preserves multi-day PnL rollovers', () => {
  const engine = new ProfitScoopVaultEngine(
    10_000,
    {
      ...DEFAULT_PROFIT_SCOOP_CONFIG,
      thresholdMode: 'PERCENT_OF_EQUITY',
      profitThresholdPct: 2.5, // $250 on $10k
      scoopExcessRatioPct: 80,
    },
    false
  );

  // Day 1: +$400 profit -> threshold on $10,400 is $260 -> excess $140 -> 80% ($112) scooped
  const d1 = engine.ingestRealizedTrade({
    tradeId: 'day1_t1',
    symbol: 'BTCUSDT',
    realizedPnlUsd: 400,
    sourceAgent: 'AI_COORDINATOR',
    settledAtMs: Date.UTC(2026, 10, 18, 15, 0, 0),
  });
  assert.equal(d1.scoopedNow, true);
  assert.equal(d1.scoopedAmountUsd, 112);

  // Day 2: +$310.25 profit
  const d2 = engine.ingestRealizedTrade({
    tradeId: 'day2_t1',
    symbol: 'ETHUSDT',
    realizedPnlUsd: 310.25,
    sourceAgent: 'SMC_FRVP',
    settledAtMs: Date.UTC(2026, 10, 19, 15, 0, 0),
  });
  assert.ok(d2.snapshot.dailyHistory.length >= 2);
  assert.equal(d2.snapshot.integrity.reconciliationDriftUsd, 0);
  assert.equal(d2.snapshot.integrity.hashChainValid, true);
});
