import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { FinancialSettlementLedger } from './financialSettlementLedgerServer.mjs';

const base = Object.freeze({
  environment: 'TESTNET', uid: 'tenant-a', venue: 'BINANCE', accountRef: 'opaque-account-a',
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
    assert.deepEqual(ledger.readRealizedPnl('tenant-a', 'TESTNET'), { settlementCount: 0, realizedPnlMicroUsd: '0' });
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
    assert.deepEqual(ledger.readRealizedPnl('tenant-a', 'TESTNET'), { settlementCount: 2, realizedPnlMicroUsd: '750000' });
    assert.deepEqual(ledger.readRealizedPnl('tenant-b', 'TESTNET'), { settlementCount: 1, realizedPnlMicroUsd: '1250000' });
    assert.deepEqual(ledger.readRealizedPnl('unknown', 'TESTNET'), { settlementCount: 0, realizedPnlMicroUsd: '0' });
    assert.throws(() => ledger.readRealizedPnl("' OR 1=1", 'TESTNET'), /INVALID_OWNER/);
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
    assert.deepEqual(ledger.readRealizedPnl('tenant-a', 'TESTNET'), { settlementCount: 1, realizedPnlMicroUsd: '1250000' });
  } finally { ledger?.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
test('no active server or browser import of settlement writer before provider approval', () => {
  const server = fs.readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('../components/ProfitVaultAndDailyPnlPanel.tsx', import.meta.url), 'utf8');
  for (const source of [server, panel]) assert.doesNotMatch(source, /financialSettlementLedgerServer|FinancialSettlementLedger/);
});

test('missing or LIVE settlement scope is denied; reads require explicit TESTNET', async () => {
  const ledger = new FinancialSettlementLedger(':memory:', async key => ({ ...base, environment: key }));
  try {
    await assert.rejects(ledger.ingest('LIVE'), /SETTLEMENT_ENVIRONMENT_NOT_ALLOWED/);
    await assert.rejects(ledger.ingest(undefined), /SETTLEMENT_ENVIRONMENT_NOT_ALLOWED/);
    assert.throws(() => ledger.readRealizedPnl('tenant-a', 'LIVE'), /SETTLEMENT_ENVIRONMENT_NOT_ALLOWED/);
    assert.throws(() => ledger.readRealizedPnl('tenant-a'), /SETTLEMENT_ENVIRONMENT_NOT_ALLOWED/);
    assert.deepEqual(ledger.readRealizedPnl('tenant-a', 'TESTNET'), { settlementCount:0, realizedPnlMicroUsd:'0' });
  } finally { ledger.close(); }
});
test('totals beyond signed 64-bit range aggregate without overflow', async () => {
  const ledger = new FinancialSettlementLedger(':memory:', async id => ({ ...base, settlementId: 'bulk-' + id, realizedPnlMicroUsd: 1000000000000000 }));
  try {
    for (let i=0;i<9300;i++) await ledger.ingest(i);
    assert.deepEqual(ledger.readRealizedPnl('tenant-a', 'TESTNET'), { settlementCount:9300, realizedPnlMicroUsd:'9300000000000000000' });
  } finally { ledger.close(); }
});
test('unscoped legacy database is rejected rather than silently classified', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ledger-unscoped-'));
  const file = path.join(folder, 'ledger.sqlite');
  try {
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE settlement_accounts (owner_uid TEXT); INSERT INTO settlement_accounts VALUES (\'legacy-owner\');');
    db.close();
    assert.throws(() => new FinancialSettlementLedger(file, verifyFixture), /UNSCOPED_LEDGER_MIGRATION_REQUIRED/);
    const check = new DatabaseSync(file);
    try { assert.equal(check.prepare('SELECT COUNT(*) AS count FROM settlement_accounts').get().count,1); }
    finally { check.close(); }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
