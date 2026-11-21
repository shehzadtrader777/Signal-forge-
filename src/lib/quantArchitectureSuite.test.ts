import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TradingViewBinanceSyncArbiter,
  computeDiscrepancyBps,
  reanchorSeriesToBinanceWs,
  stitchBinanceTickToTradingViewBar,
} from './priceSyncArbiter';
import { buildRbacIdentity, evaluateRbacAccess } from './rbac';
import { UNAUTHENTICATED_PRINCIPAL, type SubscriptionPrincipal } from './subscriptionGatekeeper';
import {
  ModularProfitTakingEngine,
  classifyVolatilityRegime,
} from './modularProfitTaking';
import {
  optimizeBacktestParameters,
  runComparativeSimulationMatrix,
} from './modularBacktestEngine';

test('TradingViewBinanceSyncArbiter stitches intrabar ticks and resolves feed discrepancy cleanly', () => {
  const arbiter = new TradingViewBinanceSyncArbiter();
  const bar = {
    time: 1730000000,
    open: 90000,
    high: 90100,
    low: 89900,
    close: 90020,
    volume: 420,
  };

  // Moderate intrabar drift (22 bps) -> stitched cleanly without full reanchor
  const stitched = stitchBinanceTickToTradingViewBar(bar, 90220);
  assert.equal(stitched.updatedBar.close, 90220);
  assert.equal(stitched.updatedBar.high, 90220);
  assert.equal(stitched.requiresFullReanchor, false);
  assert.equal(stitched.parityStatus, 'DRIFT_RESOLVED');

  // Large drift (> 35 bps) -> flags full reanchor
  const largeDrift = stitchBinanceTickToTradingViewBar(bar, 91200);
  assert.equal(largeDrift.requiresFullReanchor, true);
  assert.equal(largeDrift.parityStatus, 'RECONCILING');

  const reanchored = reanchorSeriesToBinanceWs([bar], 91200);
  assert.equal(reanchored[0].close, 91200);
  assert.equal(computeDiscrepancyBps(reanchored[0].close, 91200), 0);

  const telemetry = arbiter.recordTick('BTCUSDT', 90020, 90220, true);
  assert.equal(telemetry.discrepancyBps, 0);
  assert.equal(telemetry.driftEventsResolved, 1);
  assert.equal(telemetry.parityStatus, 'DRIFT_RESOLVED');
});

test('RBAC strictly denies Test Console and debugging endpoints for Guests (401) and non-admin Traders (403) while authorizing Super Admins', () => {
  const guestId = buildRbacIdentity(UNAUTHENTICATED_PRINCIPAL);
  assert.equal(guestId.canAccessTestConsole, false);
  const guestDecision = evaluateRbacAccess(guestId, 'DEBUG_ENDPOINTS_ACCESS');
  assert.equal(guestDecision.allowed, false);
  assert.equal(guestDecision.httpStatus, 401);

  const traderPrincipal: SubscriptionPrincipal = {
    authenticated: true,
    uid: 'uid_trader_1',
    email: 'trader@example.com',
    emailVerified: true,
    tier: 'PRO',
    status: 'ACTIVE',
    expiresAtMs: null,
    entitlementId: 'ent_1',
    planLabel: 'Pro Trader',
  };
  const traderId = buildRbacIdentity(traderPrincipal);
  assert.equal(traderId.role, 'TRADER');
  assert.equal(traderId.canAccessTestConsole, false);
  const traderDecision = evaluateRbacAccess(traderId, 'TEST_CONSOLE_VIEW');
  assert.equal(traderDecision.allowed, false);
  assert.equal(traderDecision.httpStatus, 403);
  assert.equal(traderDecision.code, 'RBAC_FORBIDDEN');

  const adminPrincipal: SubscriptionPrincipal = {
    authenticated: true,
    uid: 'uid_admin_1',
    email: 'dillwalaa.69@gmail.com',
    emailVerified: true,
    tier: 'PREMIUM_INSTITUTIONAL',
    status: 'ACTIVE',
    expiresAtMs: null,
    entitlementId: 'ent_admin',
    planLabel: 'Admin',
  };
  const adminId = buildRbacIdentity(adminPrincipal);
  assert.equal(adminId.role, 'SUPER_ADMIN');
  assert.equal(adminId.canAccessTestConsole, true);
  const adminDecision = evaluateRbacAccess(adminId, 'DEBUG_ENDPOINTS_ACCESS');
  assert.equal(adminDecision.allowed, true);
  assert.equal(adminDecision.httpStatus, 200);
});

test('ModularProfitTakingEngine decouples TP/SL per agent, adapts to volatility, and engages autonomous profit lock without cross-agent interference', () => {
  const engine = new ModularProfitTakingEngine();
  const initialSmc = engine.getProfile('SMC_FRVP');

  // Mutating AI_COORDINATOR must NOT affect SMC_FRVP
  engine.updateAgentPolicy('AI_COORDINATOR', {
    takeProfit: { mode: 'AUTONOMOUS_PROFIT_LOCK', tp3R: 7.0, autonomousProfitLockStepR: 1.0, autonomousLockBufferR: 0.5 },
    stopLoss: { atrStopMultiplier: 1.8, maxRiskPercentPerTrade: 1.8 },
  });
  assert.equal(engine.getProfile('SMC_FRVP').takeProfit.tp3R, initialSmc.takeProfit.tp3R);
  assert.equal(engine.getProfile('AI_COORDINATOR').takeProfit.tp3R, 7.0);

  // Extreme volatility classification & tightening
  const vol = classifyVolatilityRegime(4500, 90000);
  assert.equal(vol.regime, 'EXTREME');

  // Autonomous profit lock ratchets stop loss above entry after favorable excursion
  const evalLock = engine.process({
    agentId: 'AI_COORDINATOR',
    direction: 'BUY',
    entryPrice: 100,
    currentPrice: 105.5, // +3.05R if riskDist = 1.8
    atr: 1.0,
    peakUnrealizedR: 3.2,
  });
  assert.ok(evalLock.effectiveRiskRewardRatio >= 5.0);
  assert.ok(evalLock.lockedProfitFloorR !== null && evalLock.lockedProfitFloorR >= 2.0);
  assert.ok(evalLock.effectiveStopLoss > 100);

  // Pre-Pump Support agent enforces holdUntilMaxTarget (blocks premature TP1/TP2 exit)
  const prePumpEval = engine.process({
    agentId: 'PRE_PUMP_SUPPORT',
    direction: 'BUY',
    entryPrice: 100,
    currentPrice: 107,
    atr: 1.0,
    peakUnrealizedR: 3.5,
  });
  assert.equal(prePumpEval.earlyTpExitBlocked, true);
  assert.equal(prePumpEval.shouldLiquidateNow, false);
});

test('ModularBacktestEngine runs 1,000-trade comparative matrix across all agents and optimizes parameters within 1:5 R:R and 2% risk bounds', () => {
  const matrix = runComparativeSimulationMatrix('BTCUSDT', {
    riskLimitPerTradePct: 1.5,
    atrTrailingStopMultiplier: 1.65,
    profitToLossRatio: 5.5,
    tradeCount: 1000,
    autonomousProfitLock: true,
  });

  assert.equal(matrix.profiles.length, 4);
  for (const prof of matrix.profiles) {
    assert.equal(prof.tradeCount, 1000);
    assert.equal(prof.wins + prof.losses, 1000);
    assert.ok(prof.equitySample.length >= 20);
  }

  const opt = optimizeBacktestParameters('BTCUSDT', 'AUTONOMOUS_MASTER', {
    riskLimitPerTradePct: 1.0,
    atrTrailingStopMultiplier: 1.25,
    profitToLossRatio: 5.0,
    tradeCount: 1000,
  });
  assert.ok(opt.candidatesEvaluated >= 100);
  assert.ok(opt.bestParams.profitToLossRatio >= 5.0);
  assert.ok(opt.bestParams.riskLimitPerTradePct <= 2.0);
  assert.equal(opt.optimizedResult.tradeCount, 1000);
});
