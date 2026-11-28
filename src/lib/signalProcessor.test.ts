import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPAM_FILTER_CONFIG,
  buildOutboundWebhookPayload,
  evaluateSignalSpamFilter,
  extractTradingAlertParams,
  maskWebhookUrl,
  type SpamFilterHistoryEntry,
} from './signalProcessor';

test('extractTradingAlertParams parses manual raw alert text into structured entry, TP1-TP3, SL, milestones, and P&L', () => {
  const res = extractTradingAlertParams({
    rawAlertText:
      'LONG BTC/USDT 4h Entry: $92,450 TP1: $95,500 TP2: $98,800 TP3: $101,695 SL: $90,601 Confidence: 91% | Hit TP1, TP2 | PnL: +$642.50 (+4.85%)',
  });

  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.source, 'MANUAL');
  assert.equal(res.card.symbol, 'BTCUSDT');
  assert.equal(res.card.direction, 'BUY');
  assert.equal(res.card.timeframe, '4h');
  assert.equal(res.card.entryPrice, 92450);
  assert.deepEqual(res.card.takeProfits, [95500, 98800, 101695]);
  assert.equal(res.card.stopLoss, 90601);
  assert.equal(res.card.confidence, 91);
  assert.deepEqual(res.card.hitTpMilestones, ['TP1', 'TP2']);
  assert.equal(res.card.finalPnlUsd, 642.5);
  assert.equal(res.card.finalPnlPercent, 4.85);
  assert.equal(res.card.lifecycleStatus, 'TP2_HIT');
  assert.match(res.card.formattedCard, /TP1 HIT · TP2 HIT/);
  assert.match(res.card.formattedCard, /\+\$642\.50 \/ \+4\.85%/);
});

test('evaluateSignalSpamFilter discards near-instant duplicates, identical fingerprints, and channel floods while allowing milestone updates', () => {
  const baseTime = 1_700_000_000_000;
  const first = extractTradingAlertParams({
    source: 'AUTOMATED',
    symbol: 'ETHUSDT',
    direction: 'BUY',
    entryPrice: 3200,
    tp1: 3320,
    tp2: 3440,
    tp3: 3560,
    stopLoss: 3140,
    confidence: 89,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const history: SpamFilterHistoryEntry[] = [];
  const v1 = evaluateSignalSpamFilter(first.card, history, baseTime);
  assert.equal(v1.allowed, true);
  assert.equal(v1.reasonCode, 'ALLOWED');
  history.unshift({
    signalId: first.card.signalId,
    symbol: first.card.symbol,
    direction: first.card.direction,
    fingerprint: first.card.fingerprint,
    lifecycleStatus: first.card.lifecycleStatus,
    hitTpMilestones: first.card.hitTpMilestones,
    timestampMs: baseTime,
  });

  // Exact duplicate 10 seconds later must be discarded
  const v2 = evaluateSignalSpamFilter(first.card, history, baseTime + 10_000);
  assert.equal(v2.allowed, false);
  assert.equal(v2.reasonCode, 'DUPLICATE_FINGERPRINT');

  // Near-instant repetitive alert on same symbol+direction with slightly different price must be discarded
  const slightDiff = extractTradingAlertParams({
    source: 'AUTOMATED',
    symbol: 'ETHUSDT',
    direction: 'BUY',
    entryPrice: 3205,
    tp1: 3325,
    tp2: 3445,
    tp3: 3565,
    stopLoss: 3145,
    confidence: 89,
  });
  assert.equal(slightDiff.ok, true);
  if (!slightDiff.ok) return;
  const v3 = evaluateSignalSpamFilter(slightDiff.card, history, baseTime + 30_000);
  assert.equal(v3.allowed, false);
  assert.equal(v3.reasonCode, 'DUPLICATE_NEAR_INSTANT');

  // Genuine TP1 milestone + P&L update within cooldown must be allowed
  const milestoneUpdate = extractTradingAlertParams({
    source: 'AUTOMATED',
    symbol: 'ETHUSDT',
    direction: 'BUY',
    entryPrice: 3200,
    tp1: 3320,
    tp2: 3440,
    tp3: 3560,
    stopLoss: 3140,
    confidence: 89,
    hitTpMilestones: ['TP1'],
    finalPnlUsd: 180.5,
    finalPnlPercent: 3.75,
    lifecycleStatus: 'TP1_HIT',
  });
  assert.equal(milestoneUpdate.ok, true);
  if (!milestoneUpdate.ok) return;
  const v4 = evaluateSignalSpamFilter(milestoneUpdate.card, history, baseTime + 45_000);
  assert.equal(v4.allowed, true);
  assert.equal(v4.reasonCode, 'MILESTONE_UPDATE_ALLOWED');

  // Flood protection cap enforcement
  const floodedHistory: SpamFilterHistoryEntry[] = Array.from(
    { length: DEFAULT_SPAM_FILTER_CONFIG.maxSignalsPerFloodWindow },
    (_, i) => ({
      signalId: `s_${i}`,
      symbol: `ALT${i}USDT`,
      direction: 'BUY' as const,
      fingerprint: `fp_${i}`,
      lifecycleStatus: 'OPEN' as const,
      hitTpMilestones: [],
      timestampMs: baseTime + i * 1000,
    })
  );
  const newPair = extractTradingAlertParams({
    symbol: 'SOLUSDT',
    direction: 'BUY',
    entryPrice: 180,
    stopLoss: 175,
  });
  assert.equal(newPair.ok, true);
  if (!newPair.ok) return;
  const vFlood = evaluateSignalSpamFilter(newPair.card, floodedHistory, baseTime + 20_000);
  assert.equal(vFlood.allowed, false);
  assert.equal(vFlood.reasonCode, 'CHANNEL_FLOOD_LIMIT');
});

test('buildOutboundWebhookPayload emits secret-free structured signal payload without bot_token and masks URLs', () => {
  const res = extractTradingAlertParams({
    source: 'AUTOMATED',
    symbol: 'SOLUSDT',
    direction: 'SELL',
    entryPrice: 210,
    tp1: 198,
    tp2: 186,
    tp3: 172,
    stopLoss: 214,
    confidence: 93,
    hitTpMilestones: ['TP1', 'TP2', 'TP3'],
    finalPnlUsd: 920.25,
    finalPnlPercent: 18.1,
    lifecycleStatus: 'CLOSED_TP',
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const payload = buildOutboundWebhookPayload(res.card, {
    chatId: '-1002345678901',
    channelName: 'Signal Forge',
  });
  assert.equal(payload.event_type, 'MILESTONE_PNL_UPDATE');
  assert.equal(payload.signal_category, 'REALIZED_RESULT');
  assert.equal(payload.chat_id, '-1002345678901');
  assert.equal('bot_token' in payload, false);
  assert.equal(payload.symbol, 'SOLUSDT');
  assert.equal(payload.pair, 'SOLUSDT');
  assert.equal(payload.entry_price, 210);
  assert.equal(payload.take_profits.tp3, 172);
  assert.equal(payload.stop_loss, 214);
  assert.deepEqual(payload.hit_tp_milestones, ['TP1', 'TP2', 'TP3']);
  assert.equal(payload.final_pnl_usd, 920.25);
  assert.equal(payload.final_pnl_percent, 18.1);

  assert.equal(
    maskWebhookUrl('https://hook.us2.make.com/qwrgmt5dbkp4529wxpnynabp7qw1xdu'),
    'https://hook.us2.make.com/qwrg...1xdu'
  );
});
