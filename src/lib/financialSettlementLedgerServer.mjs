import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Server-only settlement store. No HTTP write route, browser import, shared-vault
// migration, or default exchange verifier. It is not a live-settlement integration.
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const VENUES = new Set(['BINANCE', 'BYBIT']);
// This isolated foundation accepts only independently verified testnet settlements.
// LIVE is intentionally unavailable even if a verifier claims it.
function requireTestnet(environment) {
  if (environment !== 'TESTNET') throw new Error('SETTLEMENT_ENVIRONMENT_NOT_ALLOWED');
  return environment;
}
const MAX_ABS_MICRO_USD = 1_000_000_000_000_000;
function requireId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error('INVALID_' + label);
  return value;
}
function validateSettlement(value) {
  if (!value || value.provenance !== 'VERIFIED_EXCHANGE_SETTLEMENT') throw new Error('UNVERIFIED_SETTLEMENT');
  const environment = requireTestnet(value.environment);
  const uid = requireId(value.uid, 'OWNER');
  const accountRef = requireId(value.accountRef, 'ACCOUNT');
  const settlementId = requireId(value.settlementId, 'SETTLEMENT_ID');
  const venue = value.venue;
  if (!VENUES.has(venue) || value.currency !== 'USD') throw new Error('UNSUPPORTED_SETTLEMENT_UNIT');
  const amount = value.realizedPnlMicroUsd;
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_ABS_MICRO_USD) throw new Error('INVALID_SETTLEMENT_AMOUNT');
  const settledAtMs = value.settledAtMs;
  if (!Number.isSafeInteger(settledAtMs) || settledAtMs <= 0 || settledAtMs > Date.now() + 60_000) {
    throw new Error('INVALID_SETTLEMENT_TIME');
  }
  return { environment, uid, venue, accountRef, settlementId, amount, settledAtMs };
}

export class FinancialSettlementLedger {
  #db;
  #verify;
  constructor(dbPath, verifySettlement) {
    if (typeof verifySettlement !== 'function') throw new Error('TRUSTED_SETTLEMENT_VERIFIER_REQUIRED');
    this.#verify = verifySettlement;
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(dbPath);
    try {
      if (dbPath !== ':memory:') fs.chmodSync(dbPath, 0o600);
      // Unscoped historical records must be quarantined, never guessed into TESTNET.
      const legacy = this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('settlement_accounts','financial_settlements')").get();
      if (legacy) throw new Error('UNSCOPED_LEDGER_MIGRATION_REQUIRED');
      this.#db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settlement_accounts_v2 (
        environment TEXT NOT NULL CHECK(environment = 'TESTNET'), venue TEXT NOT NULL, account_ref TEXT NOT NULL, owner_uid TEXT NOT NULL,
        PRIMARY KEY(environment, venue, account_ref)
      );
      CREATE TABLE IF NOT EXISTS financial_settlements_v2 (
        environment TEXT NOT NULL CHECK(environment = 'TESTNET'), venue TEXT NOT NULL, account_ref TEXT NOT NULL, settlement_id TEXT NOT NULL,
        owner_uid TEXT NOT NULL, amount_micro_usd INTEGER NOT NULL, settled_at_ms INTEGER NOT NULL,
        PRIMARY KEY(environment, venue, account_ref, settlement_id)
      );
      CREATE INDEX IF NOT EXISTS financial_settlements_owner_v2 ON financial_settlements_v2(environment, owner_uid, settled_at_ms);
      `);
    } catch (error) { this.#db.close(); throw error; }
  }

  // Only server integration code may call this. The injected verifier must obtain
  // settled amounts and the owner/account binding independently of any request body.
  // Never pass a function that simply echoes caller data as the verifier.
  async ingest(reference) {
    const event = validateSettlement(await this.#verify(reference));
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const binding = this.#db.prepare('SELECT owner_uid FROM settlement_accounts_v2 WHERE environment = ? AND venue = ? AND account_ref = ?').get(event.environment, event.venue, event.accountRef);
      if (binding && binding.owner_uid !== event.uid) throw new Error('SETTLEMENT_ACCOUNT_OWNER_CONFLICT');
      if (!binding) this.#db.prepare('INSERT INTO settlement_accounts_v2(environment, venue, account_ref, owner_uid) VALUES (?, ?, ?, ?)').run(event.environment, event.venue, event.accountRef, event.uid);
      const prior = this.#db.prepare('SELECT owner_uid, amount_micro_usd, settled_at_ms FROM financial_settlements_v2 WHERE environment = ? AND venue = ? AND account_ref = ? AND settlement_id = ?').get(event.environment, event.venue, event.accountRef, event.settlementId);
      if (prior) {
        if (prior.owner_uid !== event.uid || prior.amount_micro_usd !== event.amount || prior.settled_at_ms !== event.settledAtMs) {
          throw new Error('SETTLEMENT_REPLAY_CONFLICT');
        }
        this.#db.exec('COMMIT');
        return { inserted: false };
      }
      this.#db.prepare('INSERT INTO financial_settlements_v2(environment, venue, account_ref, settlement_id, owner_uid, amount_micro_usd, settled_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(event.environment, event.venue, event.accountRef, event.settlementId, event.uid, event.amount, event.settledAtMs);
      this.#db.exec('COMMIT');
      return { inserted: true };
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  // uid must be obtained from verified server authentication, not a URL/body
  // supplied tenant identifier. No account-wide read is exposed by this class.
  readRealizedPnl(uid, environment) {
    const owner = requireId(uid, 'OWNER');
    requireTestnet(environment);
    // SQLite SUM uses signed 64-bit integers; stream BigInt rows to avoid
    // overflowing totals even when every individual amount is a safe integer.
    const statement = this.#db.prepare('SELECT amount_micro_usd FROM financial_settlements_v2 WHERE environment = ? AND owner_uid = ?');
    statement.setReadBigInts(true);
    let total = 0n;
    let count = 0;
    for (const row of statement.iterate(environment, owner)) {
      total += row.amount_micro_usd;
      count += 1;
      if (!Number.isSafeInteger(count)) throw new Error('SETTLEMENT_COUNT_OVERFLOW');
    }
    return { settlementCount: count, realizedPnlMicroUsd: total.toString() };
  }

  close() { this.#db.close(); }
}
