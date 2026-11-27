import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PROTOCOL_GUARDRAILS,
  MasterSystemIntegrityVeriifer,
  MasterSystemIntegrityVerifier,
  PROTOCOL_BOUND_ENTITIES,
  buildBoundKernelAccountabilityList,
  buildCanonicalBindingPayload,
  computeCorrelatedHedgePlan,
  computeDeterministicBindingFingerprint,
  computeExecutionDispatchCadence,
  computeVolatilityAdjustedTrailingStop,
  evaluateAntiSpamShield,
  evaluateCircuitBreaker,
  evaluateFundingAndDeleverage,
  filterAndRouteOfflineAlert,
  isValidOfflineChatId,
  modelDepthAwareExecutionSlippage,
  validatePaperToLiveExecutionParity,
  type SessionChatBinding,
} from './masterContainmentProtocol';

describe('Master Containment & Strategy Protocol Kernel', () => {
  it('Pillar 1A: triggers Automated Circuit Breaker on flash crash, abnormal volatility spike, or spread blow-out and locks to Manual Fallback Only', () => {
    const flashCrash = evaluateCircuitBreaker({
      symbol: 'BTCUSDT',
      priceChangeWindowPct: -5.4,
      currentVolatilityPct: 3.1,
      baselineVolatilityPct: 1.5,
      spreadBps: 12,
      observedAtMs: Date.now(),
    });
    assert.equal(flashCrash.tripped, true);
    assert.equal(flashCrash.reason, 'FLASH_CRASH_DETECTED');
    assert.equal(flashCrash.nextMode, 'HALTED_MANUAL_ONLY');
    assert.equal(flashCrash.autonomousExecutionAllowed, false);
    assert.equal(flashCrash.humanVerificationRequired, true);

    const volSpike = evaluateCircuitBreaker({
      symbol: 'ETHUSDT',
      priceChangeWindowPct: -1.8,
      currentVolatilityPct: 6.4,
      baselineVolatilityPct: 1.5,
      spreadBps: 18,
      observedAtMs: Date.now(),
    });
    assert.equal(volSpike.tripped, true);
    assert.equal(volSpike.reason, 'ABNORMAL_VOLATILITY_SPIKE');
    assert.equal(volSpike.nextMode, 'HALTED_MANUAL_ONLY');

    const calm = evaluateCircuitBreaker({
      symbol: 'BTCUSDT',
      priceChangeWindowPct: 0.4,
      currentVolatilityPct: 1.4,
      baselineVolatilityPct: 1.5,
      spreadBps: 4.2,
      observedAtMs: Date.now(),
    });
    assert.equal(calm.tripped, false);
    assert.equal(calm.nextMode, 'AUTONOMOUS_ACTIVE');
    assert.equal(calm.autonomousExecutionAllowed, true);
  });

  it('Pillar 1B: enforces Honeypot trap, API rate-exhaustion cap, and Cloudflare Turnstile verification', () => {
    const now = Date.now();
    const honeypotHit = evaluateAntiSpamShield({
      honeypotValue: 'https://bot-spam.invalid',
      turnstileToken: 'cf-valid-token-1234',
      turnstileSecretConfigured: false,
      recentRequestTimestampsMs: [],
      nowMs: now,
    });
    assert.equal(honeypotHit.allowed, false);
    assert.equal(honeypotHit.statusCode, 403);
    assert.equal(honeypotHit.code, 'HONEYPOT_TRIGGERED');

    const rateExhausted = evaluateAntiSpamShield({
      honeypotValue: '',
      turnstileToken: 'cf-valid-token-1234',
      turnstileSecretConfigured: false,
      recentRequestTimestampsMs: Array.from({ length: 12 }, (_, i) => now - i * 1000),
      nowMs: now,
      maxRequestsPerWindow: 10,
      windowMs: 60_000,
    });
    assert.equal(rateExhausted.allowed, false);
    assert.equal(rateExhausted.statusCode, 429);
    assert.equal(rateExhausted.code, 'RATE_EXHAUSTION_BLOCKED');

    const failedTurnstile = evaluateAntiSpamShield({
      honeypotValue: '',
      turnstileToken: 'bad-token',
      turnstileSecretConfigured: true,
      turnstileSiteverifyPassed: false,
      recentRequestTimestampsMs: [],
      nowMs: now,
    });
    assert.equal(failedTurnstile.allowed, false);
    assert.equal(failedTurnstile.code, 'TURNSTILE_VERIFICATION_FAILED');

    const passedTurnstile = evaluateAntiSpamShield({
      honeypotValue: '',
      turnstileToken: 'cf-live-verified-token',
      turnstileSecretConfigured: true,
      turnstileSiteverifyPassed: true,
      recentRequestTimestampsMs: [now - 5000],
      nowMs: now,
      maxRequestsPerWindow: 20,
    });
    assert.equal(passedTurnstile.allowed, true);
    assert.equal(passedTurnstile.code, 'SHIELD_PASSED');
  });

  it('Pillar 2: tracks perp-vs-spot spreads and triggers autonomous de-leveraging or emergency closure when funding costs erode gains', () => {
    const emergency = evaluateFundingAndDeleverage({
      symbol: 'BTCUSDT',
      spotPrice: 90_000,
      perpMarkPrice: 90_630,
      fundingRate8h: 0.0025, // 0.25% per 8h
      positionSide: 'LONG',
      notionalUsd: 20_000,
      currentLeverage: 5,
      projectedGainUsd: 120,
      expectedHoldingHours: 24, // 3 periods * $50 = $150 > $120 gain
    });
    assert.equal(emergency.action, 'EMERGENCY_CLOSE');
    assert.equal(emergency.recommendedNotionalUsd, 0);
    assert.equal(emergency.reductionPct, 100);
    assert.ok(emergency.basisBps > 60);

    const deleverage = evaluateFundingAndDeleverage({
      symbol: 'ETHUSDT',
      spotPrice: 3_000,
      perpMarkPrice: 3_018,
      fundingRate8h: 0.0012,
      positionSide: 'LONG',
      notionalUsd: 10_000,
      currentLeverage: 5,
      projectedGainUsd: 55,
      expectedHoldingHours: 24, // 3 * $12 = $36 (~65% of gain)
    });
    assert.equal(deleverage.action, 'AUTONOMOUS_DELEVERAGE');
    assert.ok(deleverage.recommendedNotionalUsd < 10_000);
    assert.ok(deleverage.recommendedLeverage <= 2);

    const optimal = evaluateFundingAndDeleverage({
      symbol: 'SOLUSDT',
      spotPrice: 180,
      perpMarkPrice: 180.05,
      fundingRate8h: 0.0001,
      positionSide: 'LONG',
      notionalUsd: 5_000,
      currentLeverage: 3,
      projectedGainUsd: 240,
      expectedHoldingHours: 24,
    });
    assert.equal(optimal.action, 'HOLD_OPTIMAL');
    assert.equal(optimal.reductionPct, 0);
  });

  it('Pillar 3: cryptographically binds account/session/chatId and filters unbound, mismatched, or duplicate channel spam', () => {
    assert.equal(isValidOfflineChatId('-100192837465'), true);
    assert.equal(isValidOfflineChatId('@SignalForgeDesk'), true);
    assert.equal(isValidOfflineChatId('bad chat!'), false);

    const secret = 'test-signing-salt';
    const payload = buildCanonicalBindingPayload({
      accountId: 'uid_trader_1',
      sessionId: 'sess_abc_99',
      channel: 'TELEGRAM',
      chatId: '-100192837465',
    });
    const digest = computeDeterministicBindingFingerprint(payload, secret);

    const binding: SessionChatBinding = {
      bindingId: 'bind_1',
      accountId: 'uid_trader_1',
      sessionId: 'sess_abc_99',
      channel: 'TELEGRAM',
      chatId: '-100192837465',
      bindingDigest: digest,
      boundAtIso: new Date(Date.now() - 10_000).toISOString(),
      expiresAtIso: new Date(Date.now() + 3_600_000).toISOString(),
      active: true,
    };

    const verify = (b: SessionChatBinding) =>
      b.bindingDigest ===
      computeDeterministicBindingFingerprint(
        buildCanonicalBindingPayload({
          accountId: b.accountId,
          sessionId: b.sessionId,
          channel: b.channel,
          chatId: b.chatId,
        }),
        secret
      );

    const now = Date.now();
    const dedup = new Map<string, number>();

    const routed = filterAndRouteOfflineAlert({
      alert: {
        alertId: 'al_1',
        accountId: 'uid_trader_1',
        sessionId: 'sess_abc_99',
        channel: 'TELEGRAM',
        targetChatId: '-100192837465',
        eventType: 'PNL_UPDATE',
        symbol: 'BTCUSDT',
        pnlDeltaUsd: 420.5,
        message: 'BTCUSDT TP1 reached +$420.50',
        dedupKey: 'BTCUSDT_TP1',
        timestampMs: now,
      },
      bindings: [binding],
      recentDedupKeys: dedup,
      verifyDigest: verify,
    });
    assert.equal(routed.deliver, true);
    assert.equal(routed.status, 'ROUTED_TO_BOUND_CHAT');

    // Cross-chat mismatch blocked
    const mismatch = filterAndRouteOfflineAlert({
      alert: {
        alertId: 'al_2',
        accountId: 'uid_trader_1',
        sessionId: 'sess_abc_99',
        channel: 'TELEGRAM',
        targetChatId: '-100999999999',
        eventType: 'PNL_UPDATE',
        symbol: 'BTCUSDT',
        message: 'Unauthorized channel broadcast',
        dedupKey: 'BTCUSDT_TP2',
        timestampMs: now,
      },
      bindings: [binding],
      recentDedupKeys: dedup,
      verifyDigest: verify,
    });
    assert.equal(mismatch.deliver, false);
    assert.equal(mismatch.status, 'BLOCKED_CHAT_MISMATCH');

    // Duplicate spam blocked inside cooldown
    dedup.set('-100192837465::BTCUSDT_TP1', now - 5_000);
    const dupSpam = filterAndRouteOfflineAlert({
      alert: {
        alertId: 'al_3',
        accountId: 'uid_trader_1',
        sessionId: 'sess_abc_99',
        channel: 'TELEGRAM',
        targetChatId: '-100192837465',
        eventType: 'PNL_UPDATE',
        symbol: 'BTCUSDT',
        message: 'Duplicate alert spam',
        dedupKey: 'BTCUSDT_TP1',
        timestampMs: now,
      },
      bindings: [binding],
      recentDedupKeys: dedup,
      verifyDigest: verify,
    });
    assert.equal(dupSpam.deliver, false);
    assert.equal(dupSpam.status, 'BLOCKED_DUPLICATE_SPAM');
  });

  it('Pillar 4 & Global Accountability: computes ATR-adjusted ratcheting stops, correlated counter-hedges, and binds all agents/coordinators/kernels', () => {
    const trailing = computeVolatilityAdjustedTrailingStop({
      direction: 'LONG',
      entryPrice: 90_000,
      currentPrice: 94_500,
      currentStopLoss: 89_000,
      atr14: 650,
      volatilityRegime: 'ELEVATED',
    });
    assert.equal(trailing.atrMultiplier, 2.35);
    assert.equal(trailing.ratcheted, true);
    assert.ok(trailing.updatedStopLoss > 92_500 && trailing.updatedStopLoss < 94_500);
    assert.ok(trailing.lockedProfitPct > 0);

    // Must never widen risk on pullback
    const pullback = computeVolatilityAdjustedTrailingStop({
      direction: 'LONG',
      entryPrice: 90_000,
      currentPrice: 91_000,
      currentStopLoss: 92_000,
      atr14: 800,
      volatilityRegime: 'EXTREME',
    });
    assert.equal(pullback.ratcheted, false);
    assert.equal(pullback.updatedStopLoss, 92_000);

    const hedgePlan = computeCorrelatedHedgePlan({
      exposures: [
        { symbol: 'BTCUSDT', direction: 'LONG', notionalUsd: 10_000 },
        { symbol: 'SOLUSDT', direction: 'LONG', notionalUsd: 4_000 },
      ],
      stressScore: 86,
    });
    assert.equal(hedgePlan.triggered, true);
    assert.equal(hedgePlan.legs.length, 2);
    assert.equal(hedgePlan.legs[0].hedgeSymbol, 'ETHUSDT');
    assert.equal(hedgePlan.legs[0].hedgeDirection, 'SHORT');
    assert.equal(hedgePlan.legs[1].hedgeSymbol, 'BTCUSDT');
    assert.equal(hedgePlan.legs[1].hedgeDirection, 'SHORT');
    assert.ok(hedgePlan.netDeltaReductionPct >= 35 && hedgePlan.netDeltaReductionPct <= 95);

    const boundHalted = buildBoundKernelAccountabilityList('HALTED_MANUAL_ONLY');
    assert.ok(boundHalted.length >= 10);
    assert.ok(boundHalted.every((u) => u.strictlyBound && u.operationalStatus === 'HALTED_MANUAL_ONLY'));
  });

  it('Section 2: Anti-Detection injects 150-850ms jitter, human cognitive latency, and rotates residential proxy tunnels', () => {
    const planA = computeExecutionDispatchCadence({
      action: 'PLACE_ORDER',
      symbol: 'BTCUSDT',
      signalGeneratedAtMs: 1_700_000_000_000,
      randomUnitA: 0.42,
      randomUnitB: 0.55,
      sequenceIndex: 0,
      previousSlotId: null,
    });
    const planB = computeExecutionDispatchCadence({
      action: 'MODIFY_ORDER',
      symbol: 'BTCUSDT',
      signalGeneratedAtMs: 1_700_000_005_000,
      randomUnitA: 0.88,
      randomUnitB: 0.21,
      sequenceIndex: 0,
      previousSlotId: planA.proxyTunnel.slotId,
    });

    assert.ok(planA.jitterDelayMs >= 150 && planA.jitterDelayMs <= 850);
    assert.ok(planB.jitterDelayMs >= 150 && planB.jitterDelayMs <= 850);
    assert.ok(planA.humanCognitiveLatencyMs >= 220);
    assert.equal(planA.proxyTunnel.rotationPolicy, 'ROTATIONAL_RESIDENTIAL');
    assert.notEqual(
      planA.proxyTunnel.slotId,
      planB.proxyTunnel.slotId,
      'Consecutive dispatches must rotate residential proxy tunnel to prevent IP clustering'
    );
    assert.equal(
      planA.scheduledDispatchAtMs,
      planA.signalGeneratedAtMs + planA.totalDecoupledDelayMs
    );
  });

  it('Section 3 & Schema: enforces depth-aware slippage modeling, ProtocolGuardrails, and MasterSystemIntegrityVerifier parity halts', () => {
    assert.equal(DEFAULT_PROTOCOL_GUARDRAILS.antiDetection.minDelayMs, 150);
    assert.equal(DEFAULT_PROTOCOL_GUARDRAILS.antiDetection.maxDelayMs, 850);
    assert.equal(DEFAULT_PROTOCOL_GUARDRAILS.parityEnforcement.slippageToleranceThreshold, 0.001);
    assert.equal(DEFAULT_PROTOCOL_GUARDRAILS.containment.circuitBreakerTriggerPct, 0.05);
    assert.equal(DEFAULT_PROTOCOL_GUARDRAILS.containment.antiSpamRateLimitPerMin, 30);
    assert.equal(DEFAULT_PROTOCOL_GUARDRAILS.portfolioGuard.maxFundingCostToProfitRatio, 0.15);
    assert.equal(DEFAULT_PROTOCOL_GUARDRAILS.hedgingEngine.dynamicAtrMultiplier, 1.5);

    assert.equal(
      MasterSystemIntegrityVerifier.verifyAllNodesBound(PROTOCOL_BOUND_ENTITIES.map((e) => e.id)),
      true
    );
    assert.equal(MasterSystemIntegrityVeriifer.verifyAllNodesBound(['NODE_A', null]), false);

    const depthSlip = modelDepthAwareExecutionSlippage({
      symbol: 'BTCUSDT',
      orderNotionalUsd: 5_000,
      topOfBookDepthUsd: 800_000,
      spreadBps: 1.4,
      executionLatencyMs: 320,
      volatilityPct: 1.2,
    });
    assert.ok(depthSlip.expectedSlippageBps > 0);
    assert.equal(depthSlip.withinParityTolerance, true);

    const cleanParity = MasterSystemIntegrityVerifier.EnforceParityOrHalt(
      { entryPrice: 90_000, exitPrice: 92_000, stopLoss: 88_500, takeProfit: 93_500, pnl: 0.0222, slippageRatio: 0.0004 },
      { entryPrice: 90_040, exitPrice: 91_980, stopLoss: 88_500, takeProfit: 93_500, pnl: 0.0215, slippageRatio: 0.0005 }
    );
    assert.equal(cleanParity.parityVerified, true);
    assert.equal(cleanParity.haltTriggered, false);

    assert.throws(
      () =>
        MasterSystemIntegrityVeriifer.EnforceParityOrHalt(
          { entryPrice: 90_000, stopLoss: 88_500, takeProfit: 93_500, pnl: 0.08 },
          { entryPrice: 90_350, stopLoss: 88_500, takeProfit: 93_500, pnl: 0.01 }
        ),
      /FATAL: Paper-to-Live parity breach detected\. Halting execution\./
    );

    const softCheck = validatePaperToLiveExecutionParity(
      { entryPrice: 3_000, stopLoss: 2_940, takeProfit: 3_180, pnl: 0.04 },
      { entryPrice: 3_012, stopLoss: 2_940, takeProfit: 3_180, pnl: 0.038 }
    );
    assert.equal(softCheck.haltTriggered, true);
    assert.ok(softCheck.violations.some((v) => v.includes('Entry divergence')));
  });
});
