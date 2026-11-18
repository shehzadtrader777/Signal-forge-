import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSpotFeedAgainstCmc,
  validateSpotTickSample,
  type CmcBaselineValuation,
} from './spotCmcValidator';

test('validateSpotTickSample isolates corrupted ticks and sudden flash-spike anomalies', () => {
  const badZero = validateSpotTickSample({ price: 0, previousPrice: 64500 });
  assert.equal(badZero.valid, false);
  assert.equal(badZero.isolated, true);

  const flashSpike = validateSpotTickSample({
    price: 99500,
    previousPrice: 64500,
    maxJumpPct: 25,
  });
  assert.equal(flashSpike.valid, false);
  assert.equal(flashSpike.isolated, true);
  assert.ok(flashSpike.jumpPct > 25);

  const healthy = validateSpotTickSample({
    price: 64710,
    previousPrice: 64500,
    maxJumpPct: 25,
  });
  assert.equal(healthy.valid, true);
  assert.equal(healthy.isolated, false);
});

test('validateSpotFeedAgainstCmc confirms parity and isolates divergent CMC/Spot anomalies', () => {
  const cmc: CmcBaselineValuation = {
    symbol: 'BTCUSDT',
    coinName: 'Bitcoin',
    cmcRank: 1,
    cmcPriceUsd: 64750,
    marketCapUsd: 1_280_000_000_000,
    volume24hUsd: 28_500_000_000,
    dominancePct: 54.2,
    percentChange24h: 1.85,
    circulatingSupply: 19_780_000,
    updatedAt: new Date().toISOString(),
    source: 'cmc_api',
  };

  const synced = validateSpotFeedAgainstCmc({
    symbol: 'BTCUSDT',
    spotPrice: 64720,
    cmcBaseline: cmc,
  });
  assert.equal(synced.valid, true);
  assert.equal(synced.anomalyIsolated, false);
  assert.ok(synced.divergencePct < 0.2);

  const diverged = validateSpotFeedAgainstCmc({
    symbol: 'BTCUSDT',
    spotPrice: 64720,
    cmcBaseline: { ...cmc, cmcPriceUsd: 52000 },
  });
  assert.equal(diverged.valid, false);
  assert.equal(diverged.anomalyIsolated, true);
  assert.ok(diverged.divergencePct > 8.0);
});
