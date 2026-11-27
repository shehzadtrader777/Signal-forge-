import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXCHANGE_CONTROLS,
  PLATFORM_SUBSYSTEM_REGISTRY,
  evaluateExchangeLiveReadiness,
  getSubsystemContract,
  resolveTelegramChannelUrl,
  sanitizeExchangeRiskSettings,
  validateSubsystemDependencyGraph,
} from './platformArchitecture';

test('PLATFORM_SUBSYSTEM_REGISTRY covers all 12 core subsystems with a valid dependency graph', () => {
  assert.equal(PLATFORM_SUBSYSTEM_REGISTRY.length, 12);
  const graph = validateSubsystemDependencyGraph(PLATFORM_SUBSYSTEM_REGISTRY);
  assert.equal(graph.valid, true);
  assert.deepEqual(graph.missingDependencies, []);
  assert.ok(getSubsystemContract('MARKET_DATA_ENGINE'));
  assert.ok(getSubsystemContract('PUBLIC_WEBSITE'));
  assert.ok(getSubsystemContract('EXCHANGE_ROUTER'));
});

test('DEFAULT_EXCHANGE_CONTROLS separates Binance, Bybit, OKX, and Kraken with live disabled by default', () => {
  const ids = DEFAULT_EXCHANGE_CONTROLS.map((e) => e.id);
  assert.deepEqual(ids, ['BINANCE', 'BYBIT', 'OKX', 'KRAKEN']);
  for (const ex of DEFAULT_EXCHANGE_CONTROLS) {
    assert.equal(ex.liveTradingEnabled, false);
    assert.equal(ex.paperDemoAvailable, true);
    assert.equal(ex.riskSettings.requireStopLoss, true);
  }
});

test('sanitizeExchangeRiskSettings clamps extreme values into safe bounds', () => {
  const base = DEFAULT_EXCHANGE_CONTROLS[0].riskSettings;
  const sanitized = sanitizeExchangeRiskSettings(base, {
    maxRiskPerTradePct: 99,
    maxDailyLossPct: 0.01,
    maxLeverage: 125,
    maxOpenPositions: 50,
    requireStopLoss: true,
  });
  assert.equal(sanitized.maxRiskPerTradePct, 5);
  assert.equal(sanitized.maxDailyLossPct, 0.5);
  assert.equal(sanitized.maxLeverage, 20);
  assert.equal(sanitized.maxOpenPositions, 12);
});

test('evaluateExchangeLiveReadiness blocks Live transition whenever any safety condition is unmet', () => {
  const blocked = evaluateExchangeLiveReadiness({
    isAuthenticated: false,
    otpProviderReady: false,
    anyLiveCredentialsConfigured: false,
    riskCapsValid: false,
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockers.length, 4);

  const ready = evaluateExchangeLiveReadiness({
    isAuthenticated: true,
    otpProviderReady: true,
    anyLiveCredentialsConfigured: true,
    riskCapsValid: true,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.blockers.length, 0);
});

test('resolveTelegramChannelUrl converts handles and URLs cleanly into direct https://t.me links', () => {
  assert.equal(resolveTelegramChannelUrl('@SignalForge'), 'https://t.me/SignalForge');
  assert.equal(resolveTelegramChannelUrl('SignalForgeOfficial'), 'https://t.me/SignalForgeOfficial');
  assert.equal(resolveTelegramChannelUrl('http://t.me/my_channel'), 'https://t.me/my_channel');
  assert.equal(resolveTelegramChannelUrl(''), 'https://t.me/SignalForge');
});
