import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSocialChartSnapshotSpec,
  evaluatePublicationDeliveryStatus,
} from './socialChartSnapshot.ts';
import { SEEDED_CANONICAL_TRADE_LEDGER } from './tradeLifecycleLedger.ts';

test('Social Chart Snapshot maintains exact same Trade ID across Stage 1 (Signal) and Stage 2 (Closed Result)', () => {
  const closedTrade = SEEDED_CANONICAL_TRADE_LEDGER.find(
    (t) => t.recordClass === 'EXECUTED_TRADE' && t.closedAtIso !== null
  );
  assert.ok(closedTrade, 'Expected a closed executed trade in seeded canonical ledger');

  const stage1 = buildSocialChartSnapshotSpec(closedTrade!, 'STAGE_1_APPROVED_SIGNAL');
  const stage2 = buildSocialChartSnapshotSpec(closedTrade!, 'STAGE_2_CLOSED_RESULT');

  assert.equal(stage1.tradeId, closedTrade!.tradeId);
  assert.equal(stage2.tradeId, closedTrade!.tradeId);
  assert.equal(stage1.stage, 'STAGE_1_APPROVED_SIGNAL');
  assert.equal(stage2.stage, 'STAGE_2_CLOSED_RESULT');
  assert.equal(stage2.isStage2Available, true);
  assert.ok(stage1.fileName.includes('stage1_signal.png'));
  assert.ok(stage2.fileName.includes('stage2_result.png'));

  // Unexecuted signal cannot forge a Stage 2 closed result snapshot
  const signalOnly = SEEDED_CANONICAL_TRADE_LEDGER.find((t) => t.recordClass === 'SIGNAL_ONLY');
  assert.ok(signalOnly, 'Expected a signal-only record in seeded canonical ledger');
  const fallback = buildSocialChartSnapshotSpec(signalOnly!, 'STAGE_2_CLOSED_RESULT');
  assert.equal(fallback.stage, 'STAGE_1_APPROVED_SIGNAL');
  assert.equal(fallback.isStage2Available, false);
});

test('evaluatePublicationDeliveryStatus refuses to report published without real API confirmation & messageId', () => {
  const unconfirmed = evaluatePublicationDeliveryStatus({
    channel: 'TELEGRAM',
    confirmed: false,
  });
  assert.equal(unconfirmed.published, false);

  const missingId = evaluatePublicationDeliveryStatus({
    channel: 'DISCORD',
    confirmed: true,
    messageId: '',
  });
  assert.equal(missingId.published, false);

  const confirmed = evaluatePublicationDeliveryStatus({
    channel: 'TELEGRAM',
    confirmed: true,
    messageId: 'tg-msg-88412',
  });
  assert.equal(confirmed.published, true);
  assert.ok(confirmed.detail.includes('tg-msg-88412'));
});
