import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FinancialSettlementLedger } from './financialSettlementLedgerServer.mjs';

const base = Object.freeze({
  uid: 'tenant-a', venue: 'BINANCE', accountRef: 'opaque-account-a',
  settlementId: 'fill-001', currency: 'USD', realizedPnlMicroUsd: 1250000,
  settledAtMs: 1700000000000, provenance: 'VERIFIED_EXCHANGE_SETTLEMENT',
});
// These fixtures simulate an independent server verifier. They are never wired to production.
const fixtures = {
  valid: base,
  loss: { ...base, settlementId: 'fill-002', realizedPnlMicroUsd: -500000 },
  other: { ...base, uid: 'tenant-b', accountRef: 'opaque-account-b' },
  forged: { ...base, provenance: 'BROWSER_SUBMITTED' },
  replay: { ...base, realizedPnlMicroUsd: 999999 },
  reassigned: { ...base, uid: 'tenant-b', settlementId: 'fill-003' },
  badAmount: { ...base, realizedPnlMicroUsd: 1.5 },
};
const verifyFixture = async key => fixtures[key] || null;
test('settlement ledger cannot initialize without a verifier', () => {
  assert.throws(() => new FinancialSettlementLedger(':memory:'), /TRUSTED_SETTLEMENT_VERIFIER_REQUIRED/);
});
test('settlement ledger denies unverified and malformed inputs before writing', async () => {
  const ledger = new FinancialSettlementLedger(':memory:', verifyFixture);
  try {
    await assert.rejects(ledger.ingest('forged'), /UNVERIFIED_SETTLEMENT/);
    await assert.rejects(ledger.ingest('badAmount'), /INVALID_SETTLEMENT_AMOUNT/);
    await assert.rejects(ledger.ingest({ ...base }), /UNVERIFIED_SETTLEMENT/);
    assert.deepEqual(ledger.readRealizedPnl('tenant-a'), { settlementCount: 0, realizedPnlMicroUsd: '0' });
  } finally { ledger.close(); }
});
test('settlement ledger isolates accounts, rejects conflicts and performs exact fixed-point aggregation', async () => {
  const ledger = new FinancialSettlementLedger(':memory:', verifyFixture);
  try {
    assert.deepEqual(await ledger.ingest('valid'), { inserted: true });
    assert.deepEqual(await ledger.ingest('valid'), { inserted: false });
    await assert.rejects(ledger.ingest('replay'), /SETTLEMENT_REPLAY_CONFLICT/);
    await assert.rejects(ledger.ingest('reassigned'), /SETTLEMENT_ACCOUNT_OWNER_CONFLICT/);
    await ledger.ingest('loss');
    await ledger.ingest('other');
    assert.deepEqual(ledger.readRealizedPnl('tenant-a'), { settlementCount: 2, realizedPnlMicroUsd: '750000' });
    assert.deepEqual(ledger.readRealizedPnl('tenant-b'), { settlementCount: 1, realizedPnlMicroUsd: '1250000' });
    assert.deepEqual(ledger.readRealizedPnl('unknown'), { settlementCount: 0, realizedPnlMicroUsd: '0' });
    assert.throws(() => ledger.readRealizedPnl("' OR 1=1"), /INVALID_OWNER/);
  } finally { ledger.close(); }
});
test('settlement idempotency persists after close and reopen', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ledger-test-'));
  const file = path.join(folder, 'ledger.sqlite');
  let ledger;
  try {
    ledger = new FinancialSettlementLedger(file, verifyFixture);
    await ledger.ingest('valid');
    ledger.close(); ledger = undefined;
    ledger = new FinancialSettlementLedger(file, verifyFixture);
    assert.deepEqual(await ledger.ingest('valid'), { inserted: false });
    assert.deepEqual(ledger.readRealizedPnl('tenant-a'), { settlementCount: 1, realizedPnlMicroUsd: '1250000' });
  } finally { ledger?.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
test('no active server or browser import of settlement writer before provider approval', () => {
  const server = fs.readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('../components/ProfitVaultAndDailyPnlPanel.tsx', import.meta.url), 'utf8');
  for (const source of [server, panel]) assert.doesNotMatch(source, /financialSettlementLedgerServer|FinancialSettlementLedger/);
});
