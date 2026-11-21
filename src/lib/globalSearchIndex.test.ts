import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GlobalSearchIndex,
  STATIC_FEATURE_SEARCH_DOCS,
  type SearchableDocument,
} from './globalSearchIndex';

test('GlobalSearchIndex resolves exact cryptographic Trade IDs first and ranks symbol/feature queries accurately', () => {
  const dynamicDocs: SearchableDocument[] = [
    ...STATIC_FEATURE_SEARCH_DOCS,
    {
      id: 'active_1',
      category: 'ACTIVE_TRADE',
      title: 'BTCUSDT LONG · Entry-Zone Active',
      subtitle: 'Entry $64,000 · TP $73,600 (1:10.0) · Bullish OB',
      route: '/signals',
      symbol: 'BTCUSDT',
      tradeId: 'SF-TRD-20261120-0001-A1B2C3',
      statusLabel: 'ACTIVE',
      pnlLabel: '+3.4%',
      keywords: ['btc', 'bitcoin', 'long', 'active', 'order block'],
    },
    {
      id: 'hist_1',
      category: 'HISTORICAL_TRADE',
      title: 'SOLUSDT LONG · TP3 Hit',
      subtitle: 'Closed +14.8% · Pre-Pump Accumulation',
      route: '/signal-history',
      symbol: 'SOLUSDT',
      tradeId: 'SF-TRD-20261119-0018-D4E5F6',
      statusLabel: 'TP_HIT',
      pnlLabel: '+$1,480',
      keywords: ['sol', 'solana', 'pre-pump', 'closed'],
    },
    {
      id: 'proof_1',
      category: 'TRADE_ID_PROOF',
      title: 'Verified Trade Proof · SF-TRD-20261120-0001-A1B2C3',
      subtitle: 'BTCUSDT BUY · Cryptographic Digest Match · Visual Snapshot Attached',
      route: '/',
      symbol: 'BTCUSDT',
      tradeId: 'SF-TRD-20261120-0001-A1B2C3',
      statusLabel: 'VERIFIED',
      keywords: ['verify', 'proof', 'cryptographic', 'snapshot'],
    },
  ];

  const index = new GlobalSearchIndex(dynamicDocs);
  assert.equal(index.size, dynamicDocs.length);

  // Exact Trade ID query prioritizes EXACT_TRADE_ID
  const exactRes = index.search('SF-TRD-20261120-0001-A1B2C3');
  assert.ok(exactRes.length >= 1);
  assert.equal(exactRes[0].matchedField, 'EXACT_TRADE_ID');
  assert.equal(exactRes[0].doc.tradeId, 'SF-TRD-20261120-0001-A1B2C3');

  // Category-filtered historical search
  const histOnly = index.search('sol', 'HISTORICAL_TRADE');
  assert.equal(histOnly.length, 1);
  assert.equal(histOnly[0].doc.id, 'hist_1');

  // Multi-term feature search
  const controlRes = index.search('master override', 'FEATURE');
  assert.ok(controlRes.length >= 1);
  assert.equal(controlRes[0].doc.route, '/settings');
});
