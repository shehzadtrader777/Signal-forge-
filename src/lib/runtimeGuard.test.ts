import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_LIVE_MANDATE,
  FOUR_PROFILE_CATALOG,
  ORDERED_DEFENSE_LAYERS,
  ORDERED_GUARD_STEPS,
  RuntimeGuardBootError,
  assertContainerEgressAllowed,
  buildDefaultCredentialMetadata,
  evaluateRuntimeGuard,
  resolveLiveMandateFromEnvironment,
  resolveRuntimeGuardStartupOrThrow,
  type GuardProfileId,
} from './runtimeGuard';

const SRC_LIB_DIR = path.resolve(import.meta.dirname);

test('Four-Profile Model exposes frozen Paper-Read, Paper-Trade, Live-Read, and Live-Trade specs with strict capability & mandate rules', () => {
  const expectedIds: GuardProfileId[] = ['Paper-Read', 'Paper-Trade', 'Live-Read', 'Live-Trade'];
  assert.deepEqual(Object.keys(FOUR_PROFILE_CATALOG), expectedIds);

  assert.equal(FOUR_PROFILE_CATALOG['Paper-Read'].primaryHost, 'testnet.binance.vision');
  assert.equal(FOUR_PROFILE_CATALOG['Paper-Read'].canPlaceOrders, false);
  assert.equal(FOUR_PROFILE_CATALOG['Paper-Read'].requiresMandate, false);

  assert.equal(FOUR_PROFILE_CATALOG['Paper-Trade'].primaryHost, 'testnet.binance.vision');
  assert.equal(FOUR_PROFILE_CATALOG['Paper-Trade'].canPlaceOrders, true);
  assert.equal(FOUR_PROFILE_CATALOG['Paper-Trade'].requiresMandate, false);

  assert.equal(FOUR_PROFILE_CATALOG['Live-Read'].primaryHost, 'api.binance.com');
  assert.equal(FOUR_PROFILE_CATALOG['Live-Read'].canPlaceOrders, false);
  assert.equal(FOUR_PROFILE_CATALOG['Live-Read'].requiresMandate, false);

  assert.equal(FOUR_PROFILE_CATALOG['Live-Trade'].primaryHost, 'api.binance.com');
  assert.equal(FOUR_PROFILE_CATALOG['Live-Trade'].canPlaceOrders, true);
  assert.equal(FOUR_PROFILE_CATALOG['Live-Trade'].requiresMandate, true);

  for (const id of expectedIds) {
    const lock = resolveRuntimeGuardStartupOrThrow({ requestedProfile: id });
    assert.equal(Object.isFrozen(FOUR_PROFILE_CATALOG[id]), true);
    assert.equal(Object.isFrozen(lock), true);
    assert.equal(lock.immutable, true);
    assert.equal(lock.profileId, id);
  }
});

test('Profile mismatch test: testnet key + live host or live key + testnet host triggers hard boot failure', () => {
  const testnetCreds = buildDefaultCredentialMetadata('Paper-Trade');

  assert.throws(
    () =>
      resolveRuntimeGuardStartupOrThrow({
        requestedProfile: 'Live-Trade',
        targetHostOrUrl: 'https://api.binance.com/api/v3/order',
        credentials: testnetCreds,
      }),
    (err: unknown) => {
      assert.ok(err instanceof RuntimeGuardBootError);
      assert.equal(err.denial.reasonCode, 'TESTNET_KEY_ON_LIVE_HOST');
      assert.equal(err.denial.blockedByLayer, 'LAYER_1_CREDENTIAL_NAMESPACE');
      assert.ok(err.denial.remediationHint.length > 10);
      return true;
    }
  );

  const liveCreds = buildDefaultCredentialMetadata('Live-Trade');
  assert.throws(
    () =>
      resolveRuntimeGuardStartupOrThrow({
        requestedProfile: 'Paper-Trade',
        targetHostOrUrl: 'https://testnet.binance.vision/api/v3/order',
        credentials: liveCreds,
      }),
    (err: unknown) => {
      assert.ok(err instanceof RuntimeGuardBootError);
      assert.equal(err.denial.reasonCode, 'LIVE_KEY_ON_TESTNET_HOST');
      return true;
    }
  );
});

test('Mandate default test: absent LIVE_MANDATE defaults to NOT_GRANTED and blocks live order intents with LIVE_WRITE_REQUIRES_MANDATE', () => {
  assert.equal(DEFAULT_LIVE_MANDATE, 'NOT_GRANTED');
  assert.equal(resolveLiveMandateFromEnvironment({}), 'NOT_GRANTED');
  assert.equal(resolveLiveMandateFromEnvironment({ LIVE_MANDATE: 'NOT_GRANTED' }), 'NOT_GRANTED');

  const liveTradeLock = resolveRuntimeGuardStartupOrThrow({ requestedProfile: 'Live-Trade' });
  const deniedOrder = evaluateRuntimeGuard({
    startupLock: liveTradeLock,
    operation: 'PLACE_ORDER',
    targetEndpoint: 'https://api.binance.com/api/v3/order',
    venue: 'BINANCE_SPOT',
    symbol: 'BTCUSDT',
    reconciliationHealthy: true,
    nowUtc: '2026-11-17T13:30:00.000Z',
  });

  assert.equal(deniedOrder.allowed, false);
  assert.equal(deniedOrder.denial?.denied, true);
  assert.equal(deniedOrder.denial?.reasonCode, 'LIVE_WRITE_REQUIRES_MANDATE');
  assert.equal(deniedOrder.denial?.blockedByLayer, 'LAYER_4_MANDATE_CHECK');
  assert.equal(deniedOrder.denial?.blockedByStep, 'STEP_4_MANDATE_CHECK');
  assert.equal(deniedOrder.mandateAudit?.decision, 'DENY');
  assert.equal(deniedOrder.mandateAudit?.mandateState, 'NOT_GRANTED');

  // Out-of-band external mandate grant authorizes matching scoped order
  const validMandate = resolveLiveMandateFromEnvironment({
    LIVE_MANDATE: JSON.stringify({
      status: 'GRANTED',
      venue: 'BINANCE_SPOT',
      symbolSet: ['BTCUSDT', 'ETHUSDT'],
      startsAtUtc: '2026-11-17T13:00:00.000Z',
      expiresAtUtc: '2026-11-17T15:00:00.000Z',
      source: 'SECRET_MANAGER_OUT_OF_BAND',
      signerDigest: 'sig_mandate_0123456789abcdef',
    }),
  });
  const allowedOrder = evaluateRuntimeGuard({
    startupLock: liveTradeLock,
    operation: 'PLACE_ORDER',
    targetEndpoint: 'https://api.binance.com/api/v3/order',
    venue: 'BINANCE_SPOT',
    symbol: 'BTCUSDT',
    mandate: validMandate,
    reconciliationHealthy: true,
    nowUtc: '2026-11-17T13:30:00.000Z',
  });
  assert.equal(allowedOrder.allowed, true);
  assert.equal(allowedOrder.denial, null);
  assert.equal(allowedOrder.mandateAudit?.decision, 'ALLOW');
  assert.deepEqual(allowedOrder.completedSteps, ORDERED_GUARD_STEPS);

  // Mandate must never be written to disk by runtimeGuard.ts
  const guardSource = fs.readFileSync(path.resolve(SRC_LIB_DIR, 'runtimeGuard.ts'), 'utf8');
  assert.equal(/writeFile|appendFile|node:fs/.test(guardSource), false);
});

test('Denial-reason test: every single layer of the 6-layer anti-mismatch defense produces a typed reasonCode, blockedByLayer, and remediationHint', () => {
  assert.equal(ORDERED_DEFENSE_LAYERS.length, 6);

  // Layer 1: Credential Namespace / Key Policy (withdrawals enabled, missing IP allowlist, identical keys)
  assert.throws(
    () =>
      resolveRuntimeGuardStartupOrThrow({
        requestedProfile: 'Live-Trade',
        credentials: { ...buildDefaultCredentialMetadata('Live-Trade'), withdrawalsEnabled: true },
      }),
    (err: unknown) =>
      err instanceof RuntimeGuardBootError &&
      err.denial.blockedByLayer === 'LAYER_1_CREDENTIAL_NAMESPACE' &&
      err.denial.reasonCode === 'KEY_WITHDRAWALS_ENABLED' &&
      err.denial.remediationHint.length > 0
  );
  assert.throws(
    () =>
      resolveRuntimeGuardStartupOrThrow({
        requestedProfile: 'Live-Read',
        credentials: { ...buildDefaultCredentialMetadata('Live-Read'), ipAllowlistConfigured: false },
      }),
    (err: unknown) =>
      err instanceof RuntimeGuardBootError &&
      err.denial.blockedByLayer === 'LAYER_1_CREDENTIAL_NAMESPACE' &&
      err.denial.reasonCode === 'LIVE_IP_ALLOWLIST_MISSING'
  );

  // Layer 2: Profile Resolution (attempting runtime profile switch)
  const paperTradeLock = resolveRuntimeGuardStartupOrThrow({ requestedProfile: 'Paper-Trade' });
  const l2Denial = evaluateRuntimeGuard({
    startupLock: paperTradeLock,
    attemptedProfileSwitch: 'Live-Trade',
    operation: 'READ_MARKET',
    targetEndpoint: 'https://testnet.binance.vision/api/v3/ticker/price',
    venue: 'BINANCE_SPOT',
    symbol: 'BTCUSDT',
    reconciliationHealthy: true,
  });
  assert.equal(l2Denial.allowed, false);
  assert.equal(l2Denial.denial?.blockedByLayer, 'LAYER_2_PROFILE_RESOLUTION');
  assert.equal(l2Denial.denial?.reasonCode, 'RUNTIME_PROFILE_SWITCH_FORBIDDEN');
  assert.ok(l2Denial.denial?.remediationHint);

  // Layer 3: Guard Capability (read-only profile attempting order write)
  const paperReadLock = resolveRuntimeGuardStartupOrThrow({ requestedProfile: 'Paper-Read' });
  const l3Denial = evaluateRuntimeGuard({
    startupLock: paperReadLock,
    operation: 'PLACE_ORDER',
    targetEndpoint: 'https://testnet.binance.vision/api/v3/order',
    venue: 'BINANCE_SPOT',
    symbol: 'BTCUSDT',
    reconciliationHealthy: true,
  });
  assert.equal(l3Denial.allowed, false);
  assert.equal(l3Denial.denial?.blockedByLayer, 'LAYER_3_GUARD_CAPABILITY');
  assert.equal(l3Denial.denial?.reasonCode, 'READ_ONLY_PROFILE_WRITE_BLOCKED');
  assert.ok(l3Denial.denial?.remediationHint);

  // Layer 4: Mandate Check (Live-Trade without mandate)
  const liveTradeLock = resolveRuntimeGuardStartupOrThrow({ requestedProfile: 'Live-Trade' });
  const l4Denial = evaluateRuntimeGuard({
    startupLock: liveTradeLock,
    operation: 'PLACE_ORDER',
    targetEndpoint: 'https://api.binance.com/api/v3/order',
    venue: 'BINANCE_SPOT',
    symbol: 'BTCUSDT',
    mandate: 'NOT_GRANTED',
    reconciliationHealthy: true,
  });
  assert.equal(l4Denial.allowed, false);
  assert.equal(l4Denial.denial?.blockedByLayer, 'LAYER_4_MANDATE_CHECK');
  assert.equal(l4Denial.denial?.reasonCode, 'LIVE_WRITE_REQUIRES_MANDATE');

  // Layer 5: Adapter Host Assertion (unapproved third-party adapter host)
  const l5Denial = evaluateRuntimeGuard({
    startupLock: paperTradeLock,
    operation: 'PLACE_ORDER',
    targetEndpoint: 'https://rogue-exchange-proxy.invalid/api/v3/order',
    venue: 'BINANCE_SPOT',
    symbol: 'BTCUSDT',
    reconciliationHealthy: true,
  });
  assert.equal(l5Denial.allowed, false);
  assert.equal(l5Denial.denial?.blockedByLayer, 'LAYER_5_ADAPTER_HOST_ASSERTION');
  assert.equal(l5Denial.denial?.reasonCode, 'ADAPTER_HOST_MISMATCH');

  // Layer 6: Egress Policy Test (testnet container cannot resolve live host)
  const egressCheck = assertContainerEgressAllowed('Paper-Trade', 'https://api.binance.com/api/v3/order');
  assert.equal(egressCheck.allowed, false);
  if (!egressCheck.allowed) {
    assert.equal(egressCheck.denial.blockedByLayer, 'LAYER_6_NETWORK_EGRESS_POLICY');
    assert.equal(egressCheck.denial.reasonCode, 'CONTAINER_EGRESS_BLOCKED');
    assert.ok(egressCheck.denial.remediationHint.includes('testnet.binance.vision'));
  }
});
