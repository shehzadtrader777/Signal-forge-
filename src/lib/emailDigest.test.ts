import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THREE_HOURS_MS,
  consumePendingForDigest,
  createInitialDigestState,
  enqueueSignalForDigest,
  evaluateDigestSchedule,
} from './emailDigest';

test('enqueueSignalForDigest batches signals cleanly and deduplicates repeated symbol+direction', () => {
  const t0 = 1_700_000_000_000;
  let state = createInitialDigestState(t0);

  const r1 = enqueueSignalForDigest(
    state,
    {
      symbol: 'BTCUSDT',
      direction: 'SELL',
      sourceModule: 'SMC_FRVP',
      confidence: 88,
      entryPrice: 64650,
      trailingStopLoss: 65420,
      takeProfits: [63100, 61900, 60800],
      reason: 'Supply Zone BSL sweep retest',
    },
    t0 + 1000
  );
  state = r1.state;
  assert.equal(state.pending.length, 1);
  assert.equal(state.individualEmailsPrevented, 1);
  assert.equal(r1.deduplicated, false);

  const r2 = enqueueSignalForDigest(
    state,
    {
      symbol: 'BTCUSDT',
      direction: 'SELL',
      sourceModule: 'SMC_FRVP',
      confidence: 91,
      entryPrice: 64680,
      trailingStopLoss: 65400,
    },
    t0 + 5000
  );
  state = r2.state;
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].confidence, 91);
  assert.equal(state.individualEmailsPrevented, 2);
  assert.equal(r2.deduplicated, true);

  const r3 = enqueueSignalForDigest(
    state,
    {
      symbol: 'AVAXUSDT',
      direction: 'BUY',
      sourceModule: 'PATTERN_SCANNER',
      confidence: 86,
      entryPrice: 38.75,
    },
    t0 + 8000
  );
  state = r3.state;
  assert.equal(state.pending.length, 2);
  assert.equal(state.pending[0].symbol, 'BTCUSDT');
});

test('evaluateDigestSchedule enforces strict 3-hour window and consumePendingForDigest resets batch', () => {
  const t0 = 1_700_000_000_000;
  let state = createInitialDigestState(t0);
  state = enqueueSignalForDigest(
    state,
    {
      symbol: 'SOLUSDT',
      direction: 'BUY',
      confidence: 89,
      entryPrice: 214.5,
    },
    t0 + 1000
  ).state;

  // Within initial 3-hour window: scheduled dispatch is blocked to protect daily email quota
  const early = evaluateDigestSchedule(state, t0 + 60 * 60 * 1000, false);
  assert.equal(early.due, false);
  assert.equal(early.remainingMs, 2 * 60 * 60 * 1000);

  // Manual force bypasses cooldown
  const forced = evaluateDigestSchedule(state, t0 + 60 * 60 * 1000, true);
  assert.equal(forced.due, true);

  // At exact 3 hours elapsed
  const onTime = evaluateDigestSchedule(state, t0 + THREE_HOURS_MS, false);
  assert.equal(onTime.due, true);
  assert.equal(onTime.remainingMs, 0);

  const consumed = consumePendingForDigest(state, t0 + THREE_HOURS_MS);
  assert.equal(consumed.batch.length, 1);
  assert.equal(consumed.state.pending.length, 0);
  assert.equal(consumed.state.totalDigestsDispatched, 1);
  assert.equal(consumed.state.nextScheduledAtMs, t0 + THREE_HOURS_MS * 2);

  // Immediately after dispatch, another non-forced check is blocked for 3 full hours
  const rightAfter = evaluateDigestSchedule(consumed.state, t0 + THREE_HOURS_MS + 10_000, false);
  assert.equal(rightAfter.due, false);
  assert.ok(rightAfter.remainingMs > THREE_HOURS_MS - 20_000);
});
