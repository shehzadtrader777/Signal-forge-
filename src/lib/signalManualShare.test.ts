import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMasterSetupForManualCopy } from './signalManualShare';

test('manual signal export is explicit about unverified status and contains entry/stop/targets', () => {
  const text = formatMasterSetupForManualCopy({
    id: 'ephemeral-123', symbol: 'BTCUSDT', direction: 'BUY',
    sourceModule: 'PATTERN_SCANNER', entryPrice: 100,
    trailingStopLoss: 94, takeProfits: [105, 110, 115],
    confidence: 82, maxRiskReward: 2.5,
  });
  assert.match(text, /RESEARCH SETUP \(UNVERIFIED DRAFT\)/);
  assert.match(text, /BTCUSDT/);
  assert.match(text, /Entry: 100/);
  assert.match(text, /Stop loss: 94/);
  assert.match(text, /Targets: 105 \/ 110 \/ 115/);
  assert.match(text, /NO VERIFIED TRADE ID/);
  assert.doesNotMatch(text, /ephemeral-123/);
});
