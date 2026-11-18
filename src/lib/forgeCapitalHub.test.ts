import assert from 'node:assert/strict';
import test from 'node:test';
import type { SandboxPosition } from './coordinator';
import {
  BINANCE_FUTURES_TESTNET_ENDPOINT,
  BINANCE_SPOT_TESTNET_ENDPOINT,
  DEFAULT_MODULE_DRAWDOWN_LIMIT_PCT,
  DEFAULT_PORTFOLIO_DRAWDOWN_LIMIT_PCT,
  FORGE_MODULE_ORDER,
  buildUnifiedCapitalLedgerState,
  clampModuleDrawdownLimit,
  clampPortfolioDrawdownLimit,
  computeVolatilityAdjustedThreshold,
  createInitialForgeCapitalHubState,
  createRoutedSandboxPosition,
  reconcileForgeCapitalState,
  recordForgeApiError,
  recoverFromImmutableFailSafe,
  routeDualExecutionOrder,
  setForgeModuleSuspension,
  updateForgeCapitalConfig,
} from './forgeCapitalHub';

function makePosition(overrides: Partial<SandboxPosition> = {}): SandboxPosition {
  return {
    id: `pos_${Math.random().toString(36).slice(2, 8)}`,
    symbol: 'BTCUSDT',
    direction: 'BUY',
    mode: 'TESTNET',
    marketType: 'SPOT',
    marginMode: 'CROSS',
    leverage: 1,
    entryPrice: 65000,
    quantity: 0.05,
    notionalUsd: 3250,
    initialMarginUsd: 3250,
    maintenanceMarginUsd: 0,
    initialStopLoss: 63700,
    trailingStopLoss: 63900,
    takeProfits: [67000, 69000, 71500],
    status: 'OPEN',
    pnlUsd: 0,
    pnlPercent: 0,
    skepticVerdict: 'APPROVED',
    openedAt: '2026-11-16T10:00:00.000Z',
    ...overrides,
  };
}

test('Forge Capital Hub initializes all 5 active trading desks with 4.0% module default and 12.5% portfolio cap', () => {
  const state = createInitialForgeCapitalHubState({ initialEquityUsd: 25000 });
  assert.equal(state.portfolioDrawdownLimitPct, DEFAULT_PORTFOLIO_DRAWDOWN_LIMIT_PCT);
  assert.equal(state.failSafe.haltCode, 'NOMINAL');
  assert.equal(state.failSafe.httpStatusLock, 200);
  assert.equal(FORGE_MODULE_ORDER.length, 5);
  for (const modId of FORGE_MODULE_ORDER) {
    assert.ok(state.modules[modId], `Expected module ${modId}`);
    assert.equal(
      state.modules[modId].configuredDrawdownLimitPct,
      DEFAULT_MODULE_DRAWDOWN_LIMIT_PCT
    );
    assert.equal(state.modules[modId].status, 'ACTIVE');
  }
});

test('portfolio drawdown bounds clamp strictly within 10-15% and module limits within 3-5%', () => {
  assert.equal(clampPortfolioDrawdownLimit(4), 10);
  assert.equal(clampPortfolioDrawdownLimit(12.5), 12.5);
  assert.equal(clampPortfolioDrawdownLimit(24), 15);

  assert.equal(clampModuleDrawdownLimit(1.2), 3);
  assert.equal(clampModuleDrawdownLimit(4.0), 4.0);
  assert.equal(clampModuleDrawdownLimit(9.5), 5);

  const calmLimit = computeVolatilityAdjustedThreshold(5.0, 1.2);
  const stormLimit = computeVolatilityAdjustedThreshold(5.0, 7.2);
  assert.equal(calmLimit, 5.0);
  assert.equal(stormLimit, 3.0);
});

test('per-module 3-5% drawdown automatically isolates breaching module (including Autonomous AI Agents) without halting healthy desks', () => {
  let state = createInitialForgeCapitalHubState({
    initialEquityUsd: 25000,
    portfolioDrawdownLimitPct: 12.5,
  });

  // Lose $240 in AUTONOMOUS_AI_AGENTS (allocated $3,750 -> 6.4% DD > 4.0% cap)
  // while portfolio drawdown is < 1% (< 12.5% portfolio cap)
  const autoAgentLoss = makePosition({
    id: 'auto_sent_fut_ETHUSDT_1',
    symbol: 'ETHUSDT',
    marketType: 'USD_M_FUTURES',
    leverage: 5,
    notionalUsd: 2400,
    autonomousEntry: true,
    entrySourceReason: 'Sentinel BUY_DIP autonomous execution',
    status: 'CLOSED_TRAIL_SL',
    pnlUsd: -240,
  });

  state = reconcileForgeCapitalState(state, {
    walletBalanceUsd: 24760,
    positions: [autoAgentLoss],
    authoritativePrices: { BTCUSDT: 65000, ETHUSDT: 3150 },
    marketVolatilityPct: 3.0,
  });

  assert.equal(state.failSafe.engaged, false);
  assert.equal(state.failSafe.haltCode, 'NOMINAL');
  assert.equal(state.modules.AUTONOMOUS_AI_AGENTS.status, 'SUSPENDED');
  assert.equal(state.modules.SPOT_MOMENTUM.status, 'ACTIVE');

  // Routing through isolated AUTONOMOUS_AI_AGENTS fails cleanly, while SPOT_MOMENTUM remains active
  const rejected = routeDualExecutionOrder(state, {
    moduleId: 'AUTONOMOUS_AI_AGENTS',
    market: 'SPOT',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: 1000,
    submittedPrice: 65000,
    authoritativePrice: 65000,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.routeRecord.status, 'REJECTED_MODULE_SUSPENDED');

  const routedSpot = routeDualExecutionOrder(rejected.nextState, {
    moduleId: 'SPOT_MOMENTUM',
    market: 'SPOT',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: 1000,
    submittedPrice: 65000,
    authoritativePrice: 65000,
  });
  assert.equal(routedSpot.ok, true);
  assert.equal(routedSpot.routeRecord.apiEndpoint, BINANCE_SPOT_TESTNET_ENDPOINT);
  assert.equal(routedSpot.routeRecord.leverage, 1);
});

test('hard 10-15% portfolio-wide drawdown triggers EMERGENCY_HALT (423 Locked) halting Spot, Futures, and WS routing', () => {
  let state = createInitialForgeCapitalHubState({
    initialEquityUsd: 25000,
    portfolioDrawdownLimitPct: 12.0,
  });

  const openHeavyFuture = makePosition({
    id: 'fut_heavy',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    marketType: 'USD_M_FUTURES',
    leverage: 5,
    entryPrice: 70000,
    notionalUsd: 31500,
  });

  state = reconcileForgeCapitalState(state, {
    walletBalanceUsd: 25000,
    positions: [openHeavyFuture],
    authoritativePrices: { BTCUSDT: 63000 }, // -10% on 31.5k = -3150 USD (12.6% DD)
    marketVolatilityPct: 5.5,
  });

  assert.equal(state.failSafe.engaged, true);
  assert.equal(state.failSafe.haltCode, 'EMERGENCY_HALT');
  assert.equal(state.failSafe.httpStatusLock, 423);
  assert.equal(state.allTradingHalted, true);
  assert.ok(Object.isFrozen(state.failSafe));

  // Relaxing config limit to 15% does NOT clear an EMERGENCY_HALT latch
  const afterRelax = updateForgeCapitalConfig(state, { portfolioDrawdownLimitPct: 15.0 });
  assert.equal(afterRelax.failSafe.engaged, true);
  assert.equal(afterRelax.failSafe.haltCode, 'EMERGENCY_HALT');

  // Spot & Futures routes both return 423 Locked
  const spotAttempt = routeDualExecutionOrder(afterRelax, {
    moduleId: 'SPOT_MOMENTUM',
    market: 'SPOT',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: 500,
    submittedPrice: 63000,
    authoritativePrice: 63000,
  });
  assert.equal(spotAttempt.ok, false);
  assert.equal(spotAttempt.statusCode, 423);
  assert.equal(spotAttempt.routeRecord.status, 'REJECTED_FAIL_SAFE');

  const futuresAttempt = routeDualExecutionOrder(spotAttempt.nextState, {
    moduleId: 'FUTURES_COORDINATOR',
    market: 'USD_M_FUTURES',
    symbol: 'BTCUSDT',
    direction: 'SELL',
    notionalUsd: 500,
    leverage: 3,
    submittedPrice: 63000,
    authoritativePrice: 63000,
  });
  assert.equal(futuresAttempt.ok, false);
  assert.equal(futuresAttempt.statusCode, 423);

  const rejectedBadCode = recoverFromImmutableFailSafe(futuresAttempt.nextState, {
    confirmationCode: 'WRONG_CODE',
    expectedCode: 'SEAL-OP-7492-AUTH',
    operatorReason: 'Attempted unauthorized unlock',
  });
  assert.equal(rejectedBadCode.ok, false);
  assert.equal(rejectedBadCode.nextState.failSafe.engaged, true);

  const recovered = recoverFromImmutableFailSafe(futuresAttempt.nextState, {
    confirmationCode: 'SEAL-OP-7492-AUTH',
    expectedCode: 'SEAL-OP-7492-AUTH',
    operatorReason: 'Flattened exposure and verified collateral liquidity',
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.nextState.failSafe.engaged, false);
  assert.equal(recovered.nextState.failSafe.haltCode, 'NOMINAL');
  assert.equal(recovered.nextState.failSafe.httpStatusLock, 200);
});

test('dual execution router dispatches real unified position and reconciles with 0% drift across Master Desk & Ledger', () => {
  let state = createInitialForgeCapitalHubState({ initialEquityUsd: 25000 });

  const futRoute = routeDualExecutionOrder(state, {
    moduleId: 'FUTURES_COORDINATOR',
    market: 'USD_M_FUTURES',
    environment: 'TESTNET',
    symbol: 'ETHUSDT',
    direction: 'BUY',
    notionalUsd: 2000,
    leverage: 10,
    marginMode: 'CROSS',
    submittedPrice: 3000,
    authoritativePrice: 3000,
  });
  assert.equal(futRoute.ok, true);
  assert.equal(futRoute.routeRecord.apiEndpoint, BINANCE_FUTURES_TESTNET_ENDPOINT);
  state = futRoute.nextState;

  const livePos = createRoutedSandboxPosition(futRoute.routeRecord);
  const prices = { ETHUSDT: 3150 }; // +5% move = +$100 PnL on $2,000 notional
  state = reconcileForgeCapitalState(state, {
    walletBalanceUsd: 25000,
    positions: [livePos],
    authoritativePrices: prices,
    marketVolatilityPct: 2.5,
  });

  const unified = buildUnifiedCapitalLedgerState({
    positions: [livePos],
    walletBalanceUsd: 25000,
    tickers: {
      ETHUSDT: {
        symbol: 'ETHUSDT',
        baseAsset: 'ETH',
        name: 'Ethereum',
        price: 3150,
        change24hPercent: 5.0,
        high24h: 3180,
        low24h: 2980,
        volume24hUsd: 900_000_000,
        isLiveWs: true,
      },
    },
    candlesMap: {},
    forgeCapitalState: state,
  });

  assert.equal(unified.openPositionsCount, 1);
  assert.equal(unified.totalOpenPnlUsd, 100);
  assert.equal(unified.liveEquityUsd, 25100);
  assert.equal(unified.positions[0].moduleId, 'FUTURES_COORDINATOR');
  assert.equal(unified.positions[0].apiEndpoint, BINANCE_FUTURES_TESTNET_ENDPOINT);
  // Zero drift between Forge Capital Hub equity and Unified Ledger equity
  assert.equal(unified.liveEquityUsd, state.currentEquityUsd);

  // Also check API error logging & module toggle
  const logged = recordForgeApiError(state, {
    market: 'USD_M_FUTURES',
    moduleId: 'FUTURES_COORDINATOR',
    endpoint: '/fapi/v1/order',
    httpStatus: 429,
    exchangeCode: -1003,
    latencyMs: 220,
    message: 'Rate limit warning',
  });
  assert.equal(logged.apiErrorLogs.length, 1);
  const toggled = setForgeModuleSuspension(logged, 'ARB_COPY_DESK', true, 'Spread widened');
  assert.equal(toggled.ok, true);
  assert.equal(toggled.nextState.modules.ARB_COPY_DESK.status, 'SUSPENDED');
});

// Deterministic seeded PRNG (Mulberry32) for repeatable property-based testing in CI/CD
function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('PBT Invariant 1: portfolio [10-15%] and module [3-5%] bounds hold across extreme and non-finite inputs (150 trials)', () => {
  const rng = createSeededRng(0x51a9f001);
  const pathological = [NaN, Infinity, -Infinity, -100, 0, 2.99, 5.01, 9.99, 15.01, 99999];

  for (const val of pathological) {
    const p = clampPortfolioDrawdownLimit(val);
    const m = clampModuleDrawdownLimit(val);
    const v = computeVolatilityAdjustedThreshold(val, val);
    assert.ok(p >= 10.0 && p <= 15.0, `Portfolio clamp out of bounds for ${String(val)}: ${p}`);
    assert.ok(m >= 3.0 && m <= 5.0, `Module clamp out of bounds for ${String(val)}: ${m}`);
    assert.ok(v >= 3.0 && v <= 5.0, `Vol threshold out of bounds for ${String(val)}: ${v}`);
  }

  for (let i = 0; i < 150; i += 1) {
    const rawPortfolio = (rng() - 0.25) * 40;
    const rawModule = (rng() - 0.25) * 15;
    const rawVol = (rng() - 0.2) * 25;

    const p = clampPortfolioDrawdownLimit(rawPortfolio);
    const m = clampModuleDrawdownLimit(rawModule);
    const v = computeVolatilityAdjustedThreshold(m, rawVol);

    assert.ok(Number.isFinite(p) && p >= 10.0 && p <= 15.0);
    assert.ok(Number.isFinite(m) && m >= 3.0 && m <= 5.0);
    assert.ok(Number.isFinite(v) && v >= 3.0 && v <= 5.0);
  }
});

test('PBT Invariant 2: 0.00 USD equity parity holds between reconcileForgeCapitalState and buildUnifiedCapitalLedgerState across 150 random Spot+Futures books', () => {
  const rng = createSeededRng(0x7c4b2219);
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

  for (let trial = 0; trial < 150; trial += 1) {
    const walletBalanceUsd = Number((18000 + rng() * 12000).toFixed(2));
    const positionCount = Math.floor(rng() * 8);
    const prices: Record<string, number> = {
      BTCUSDT: Number((62000 + rng() * 8000).toFixed(2)),
      ETHUSDT: Number((2900 + rng() * 500).toFixed(2)),
      SOLUSDT: Number((130 + rng() * 40).toFixed(2)),
      BNBUSDT: Number((540 + rng() * 80).toFixed(2)),
    };

    const positions: SandboxPosition[] = [];
    for (let j = 0; j < positionCount; j += 1) {
      const sym = symbols[Math.floor(rng() * symbols.length)];
      const live = prices[sym];
      const entry = Number((live * (0.94 + rng() * 0.12)).toFixed(2));
      const dir = rng() > 0.5 ? 'BUY' : 'SELL';
      const isFutures = rng() > 0.45;
      const notional = Number((500 + rng() * 3500).toFixed(2));
      const leverage = isFutures ? Math.floor(2 + rng() * 8) : 1;
      const isOpen = rng() > 0.25;
      const mod = FORGE_MODULE_ORDER[Math.floor(rng() * FORGE_MODULE_ORDER.length)];
      const tagMap = {
        SPOT_MOMENTUM: 'spot_mom_',
        FUTURES_COORDINATOR: 'fut_coord_',
        SMC_FRVP_DESK: 'smc_frvp_',
        ARB_COPY_DESK: 'arb_copy_',
        AUTONOMOUS_AI_AGENTS: 'auto_sent_',
      } as const;

      positions.push(
        makePosition({
          id: `${tagMap[mod]}${trial}_${j}`,
          symbol: sym,
          direction: dir,
          marketType: isFutures ? 'USD_M_FUTURES' : 'SPOT',
          leverage,
          entryPrice: entry,
          quantity: Number((notional / entry).toFixed(6)),
          notionalUsd: notional,
          initialMarginUsd: Number((notional / leverage).toFixed(2)),
          status: isOpen ? 'OPEN' : 'CLOSED_TRAIL_SL',
          pnlUsd: isOpen ? 0 : Number(((rng() - 0.5) * 400).toFixed(2)),
        })
      );
    }

    const initial = createInitialForgeCapitalHubState({ initialEquityUsd: 25000 });
    const reconciled = reconcileForgeCapitalState(initial, {
      walletBalanceUsd,
      positions,
      authoritativePrices: prices,
      marketVolatilityPct: 1 + rng() * 6,
    });

    const tickers = Object.fromEntries(
      Object.entries(prices).map(([sym, price]) => [
        sym,
        {
          symbol: sym,
          baseAsset: sym.replace('USDT', ''),
          name: sym,
          price,
          change24hPercent: 1.2,
          high24h: price * 1.02,
          low24h: price * 0.98,
          volume24hUsd: 500_000_000,
          isLiveWs: true,
        },
      ])
    );

    const unified = buildUnifiedCapitalLedgerState({
      positions,
      walletBalanceUsd,
      tickers,
      candlesMap: {},
      forgeCapitalState: reconciled,
    });

    assert.ok(Object.isFrozen(unified));
    assert.ok(Object.isFrozen(unified.positions));
    assert.equal(
      unified.liveEquityUsd,
      reconciled.currentEquityUsd,
      `Equity parity mismatch on trial ${trial}: ledger=${unified.liveEquityUsd} hub=${reconciled.currentEquityUsd}`
    );
  }
});

test('PBT Invariant 3: EMERGENCY_HALT (423 Locked) is monotonically immutable against config relaxations, module toggles, and dual routing (150 trials)', () => {
  const rng = createSeededRng(0x9a00e112);

  let state = createInitialForgeCapitalHubState({
    initialEquityUsd: 25000,
    portfolioDrawdownLimitPct: 11.0,
  });

  state = reconcileForgeCapitalState(state, {
    walletBalanceUsd: 21500, // -14% DD >= 11%
    positions: [],
    authoritativePrices: { BTCUSDT: 65000 },
    marketVolatilityPct: 4.0,
  });
  assert.equal(state.failSafe.engaged, true);
  assert.equal(state.failSafe.httpStatusLock, 423);

  for (let step = 0; step < 150; step += 1) {
    // Random config widening
    state = updateForgeCapitalConfig(state, {
      portfolioDrawdownLimitPct: 10 + rng() * 10,
      moduleLimitsPct: {
        SPOT_MOMENTUM: 3 + rng() * 5,
        FUTURES_COORDINATOR: 3 + rng() * 5,
      },
    });
    assert.equal(state.failSafe.engaged, true);
    assert.equal(state.failSafe.haltCode, 'EMERGENCY_HALT');
    assert.equal(state.failSafe.httpStatusLock, 423);

    // Random module activation attempts must be blocked (423)
    const mod = FORGE_MODULE_ORDER[Math.floor(rng() * FORGE_MODULE_ORDER.length)];
    const toggle = setForgeModuleSuspension(state, mod, false, 'Automated unlock probe');
    assert.equal(toggle.ok, false);

    // Random wrong recovery codes must fail (423 remains engaged)
    const badRecover = recoverFromImmutableFailSafe(state, {
      confirmationCode: `WRONG_${step}`,
      operatorReason: 'Valid length operator reason check',
    });
    assert.equal(badRecover.ok, false);

    // Random Spot & Futures routing attempts must all fail with 423 Locked
    const channel = rng() > 0.5 ? 'USD_M_FUTURES' : 'SPOT';
    const routeAttempt = routeDualExecutionOrder(state, {
      moduleId: mod,
      market: channel,
      symbol: 'BTCUSDT',
      direction: rng() > 0.5 ? 'BUY' : 'SELL',
      notionalUsd: 250 + rng() * 2000,
      leverage: channel === 'USD_M_FUTURES' ? 5 : 1,
      submittedPrice: 65000,
      authoritativePrice: 65000,
      appLiveEnabled: true,
    });
    assert.equal(routeAttempt.ok, false);
    assert.equal(routeAttempt.statusCode, 423);
    assert.equal(routeAttempt.routeRecord.status, 'REJECTED_FAIL_SAFE');
    state = routeAttempt.nextState;
  }
});

test('PBT Invariant 4: per-module isolation contains single breaching desk while preserving availability across healthy desks (150 trials)', () => {
  const rng = createSeededRng(0x31f80044);

  for (let trial = 0; trial < 150; trial += 1) {
    const modIndex = trial % FORGE_MODULE_ORDER.length;
    const breachedMod = FORGE_MODULE_ORDER[modIndex];
    const healthyMod = FORGE_MODULE_ORDER[(modIndex + 1) % FORGE_MODULE_ORDER.length];
    const prefixMap = {
      SPOT_MOMENTUM: 'spot_mom',
      FUTURES_COORDINATOR: 'fut_coord',
      SMC_FRVP_DESK: 'smc_frvp',
      ARB_COPY_DESK: 'arb_copy',
      AUTONOMOUS_AI_AGENTS: 'auto_sent',
    } as const;

    let state = createInitialForgeCapitalHubState({
      initialEquityUsd: 50000,
      portfolioDrawdownLimitPct: 15.0,
    });

    // Loss of 5.5–8.5% of the desk's allocated capital guarantees module breach (> 3.0–5.0% cap)
    // while portfolio-wide drawdown stays strictly below 2.6% (< 15.0% portfolio cap).
    const deskAlloc = state.modules[breachedMod].allocatedCapitalUsd;
    const lossUsd = -Math.round(deskAlloc * (0.055 + rng() * 0.03));
    const breachPos = makePosition({
      id: `${prefixMap[breachedMod]}_breach_${trial}`,
      symbol: 'BTCUSDT',
      marketType: breachedMod === 'FUTURES_COORDINATOR' ? 'USD_M_FUTURES' : 'SPOT',
      entrySourceReason: `Forge [${breachedMod}] PBT trial ${trial}`,
      status: 'CLOSED_TRAIL_SL',
      pnlUsd: lossUsd,
    });

    state = reconcileForgeCapitalState(state, {
      walletBalanceUsd: 50000 + lossUsd,
      positions: [breachPos],
      authoritativePrices: { BTCUSDT: 65000 },
      marketVolatilityPct: 1.5 + rng() * 3.5,
    });

    assert.equal(state.failSafe.engaged, false);
    assert.equal(state.modules[breachedMod].status, 'SUSPENDED');
    assert.equal(state.modules[healthyMod].status, 'ACTIVE');

    const blockedRoute = routeDualExecutionOrder(state, {
      moduleId: breachedMod,
      market: state.modules[breachedMod].primaryMarket,
      symbol: 'BTCUSDT',
      direction: 'BUY',
      notionalUsd: 500,
      submittedPrice: 65000,
      authoritativePrice: 65000,
      appLiveEnabled: true,
    });
    assert.equal(blockedRoute.ok, false);
    assert.equal(blockedRoute.routeRecord.status, 'REJECTED_MODULE_SUSPENDED');

    const healthyRoute = routeDualExecutionOrder(blockedRoute.nextState, {
      moduleId: healthyMod,
      market: state.modules[healthyMod].primaryMarket,
      symbol: 'BTCUSDT',
      direction: 'BUY',
      notionalUsd: 500,
      submittedPrice: 65000,
      authoritativePrice: 65000,
      appLiveEnabled: true,
    });
    assert.equal(healthyRoute.ok, true);
    assert.equal(healthyRoute.routeRecord.status, 'ROUTED');
  }
});

test('Invariant 5: malformed / adversarial NaN / Infinity inputs are cleanly contained without throwing or mutating prior state', () => {
  const baseline = createInitialForgeCapitalHubState({ initialEquityUsd: 25000 });
  const beforeJson = JSON.stringify(baseline);

  const corruptPosition = makePosition({
    id: 'fut_coord_corrupt',
    entryPrice: Number.NaN,
    notionalUsd: Number.POSITIVE_INFINITY,
    leverage: -5,
    pnlUsd: Number.NaN,
    status: 'OPEN',
  });

  const safeReconciled = reconcileForgeCapitalState(baseline, {
    walletBalanceUsd: Number.NaN,
    positions: [corruptPosition],
    authoritativePrices: { BTCUSDT: Number.NaN },
    marketVolatilityPct: Number.POSITIVE_INFINITY,
  });

  assert.ok(Number.isFinite(safeReconciled.currentEquityUsd));
  assert.ok(Number.isFinite(safeReconciled.portfolioDrawdownPct));
  assert.equal(safeReconciled.walletBalanceUsd, 25000);
  // Original state remains untouched
  assert.equal(JSON.stringify(baseline), beforeJson);

  const invalidNotional = routeDualExecutionOrder(safeReconciled, {
    moduleId: 'SPOT_MOMENTUM',
    market: 'SPOT',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: Number.NaN,
    submittedPrice: Number.NaN,
    authoritativePrice: 65000,
  });
  assert.equal(invalidNotional.ok, false);
  assert.equal(invalidNotional.statusCode, 400);
  assert.equal(invalidNotional.routeRecord.status, 'REJECTED_VALIDATION');
});

test('Top Gainers routes attribute to SPOT_MOMENTUM (4.0% default within 3-5%) and Unified Ledger exposes 0.00% parity divergence', () => {
  let state = createInitialForgeCapitalHubState({ initialEquityUsd: 25000 });
  assert.equal(state.modules.SPOT_MOMENTUM.label, 'Spot Momentum & Top Gainers');
  assert.equal(state.modules.SPOT_MOMENTUM.configuredDrawdownLimitPct, 4.0);

  const gainerPos = makePosition({
    id: 'gainer_pre_pump_SUIUSDT',
    symbol: 'SUIUSDT',
    marketType: 'SPOT',
    entryPrice: 3.8,
    notionalUsd: 2000,
    entrySourceReason: 'Binance TOP_GAINER PRE_PUMP execution',
    status: 'OPEN',
  });

  state = reconcileForgeCapitalState(state, {
    walletBalanceUsd: 25000,
    positions: [gainerPos],
    authoritativePrices: { SUIUSDT: 4.18 },
    marketVolatilityPct: 3.2,
  });

  const unified = buildUnifiedCapitalLedgerState({
    positions: [gainerPos],
    walletBalanceUsd: 25000,
    tickers: {
      SUIUSDT: {
        symbol: 'SUIUSDT',
        baseAsset: 'SUI',
        name: 'Sui',
        price: 4.18,
        change24hPercent: 10.0,
        high24h: 4.2,
        low24h: 3.7,
        volume24hUsd: 400_000_000,
        isLiveWs: true,
      },
    },
    candlesMap: {},
    forgeCapitalState: state,
  });

  assert.equal(unified.positions[0].moduleId, 'SPOT_MOMENTUM');
  assert.equal(unified.walletParityDivergencePct, 0);
  assert.equal(unified.walletParityVerified, true);
  assert.equal(unified.liveEquityUsd, state.currentEquityUsd);
});

test('routeDualExecutionOrder enforces L0 Runtime Guard isolation and L2 Parity Gate Live halt', () => {
  const state = createInitialForgeCapitalHubState({ initialEquityUsd: 25000 });

  // L0 Guard: Reject LIVE route backed by TESTNET credentials or missing LIVE_SPOT_TRADE scope
  const l0Blocked = routeDualExecutionOrder(state, {
    moduleId: 'SPOT_MOMENTUM',
    market: 'SPOT',
    environment: 'LIVE',
    credentialEnvironment: 'TESTNET',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: 1000,
    submittedPrice: 65000,
    authoritativePrice: 65000,
    appLiveEnabled: true,
  });
  assert.equal(l0Blocked.ok, false);
  assert.equal(l0Blocked.statusCode, 403);
  assert.equal(l0Blocked.routeRecord.status, 'REJECTED_L0_GUARD');

  const scopeBlocked = routeDualExecutionOrder(state, {
    moduleId: 'FUTURES_COORDINATOR',
    market: 'USD_M_FUTURES',
    environment: 'LIVE',
    credentialEnvironment: 'LIVE',
    grantedScopes: ['READ_MARKET', 'LIVE_SPOT_TRADE'], // Missing LIVE_FUTURES_TRADE
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: 1000,
    leverage: 5,
    submittedPrice: 65000,
    authoritativePrice: 65000,
    appLiveEnabled: true,
  });
  assert.equal(scopeBlocked.ok, false);
  assert.equal(scopeBlocked.statusCode, 403);
  assert.equal(scopeBlocked.routeRecord.status, 'REJECTED_L0_GUARD');

  // L0 Guard Mandate Check: LIVE order without out-of-band mandate blocks with LIVE_WRITE_REQUIRES_MANDATE
  const unmandatedLive = routeDualExecutionOrder(state, {
    moduleId: 'SPOT_MOMENTUM',
    market: 'SPOT',
    environment: 'LIVE',
    credentialEnvironment: 'LIVE',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: 1000,
    submittedPrice: 65000,
    authoritativePrice: 65000,
    appLiveEnabled: true,
    nowIso: '2026-11-17T13:30:00.000Z',
  });
  assert.equal(unmandatedLive.ok, false);
  assert.equal(unmandatedLive.routeRecord.status, 'REJECTED_L0_GUARD');
  assert.equal(unmandatedLive.guardDenial?.reasonCode, 'LIVE_WRITE_REQUIRES_MANDATE');

  // L2 Parity Gate: Reject LIVE deployment when live vs backtest divergence exceeds tolerance (with valid mandate)
  const parityBlocked = routeDualExecutionOrder(state, {
    moduleId: 'SPOT_MOMENTUM',
    market: 'SPOT',
    environment: 'LIVE',
    credentialEnvironment: 'LIVE',
    liveMandate: {
      status: 'GRANTED',
      venue: 'BINANCE_SPOT',
      symbolSet: ['BTCUSDT'],
      startsAtUtc: '2026-11-17T12:00:00.000Z',
      expiresAtUtc: '2026-11-17T16:00:00.000Z',
      source: 'SECRET_MANAGER_OUT_OF_BAND',
      signerDigest: 'sig_live_parity_test_123456',
    },
    nowIso: '2026-11-17T13:30:00.000Z',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: 1000,
    submittedPrice: 65000,
    authoritativePrice: 65000,
    appLiveEnabled: true,
    parityGateInput: {
      backtestExpectedSlippageBps: 12,
      liveObservedSlippageBps: 65,
      backtestWinRatePct: 58,
      liveWinRatePct: 40,
      backtestExpectancyR: 1.5,
      liveExpectancyR: 0.3,
    },
  });
  assert.equal(parityBlocked.ok, false);
  assert.equal(parityBlocked.statusCode, 423);
  assert.equal(parityBlocked.routeRecord.status, 'REJECTED_PARITY_GATE');
});



