import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Server-only settlement store. No HTTP write route, browser import, shared-vault
// migration, or default exchange verifier. It is not a live-settlement integration.
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const VENUES = new Set(['BINANCE', 'BYBIT']);
const MAX_ABS_MICRO_USD = 1_000_000_000_000_000;
function requireId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error('INVALID_' + label);
  return value;
}
function validateSettlement(value) {
  if (!value || value.provenance !== 'VERIFIED_EXCHANGE_SETTLEMENT') throw new Error('UNVERIFIED_SETTLEMENT');
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
  return { uid, venue, accountRef, settlementId, amount, settledAtMs };
}

export class FinancialSettlementLedger {
  #db;
  #verify;
  constructor(dbPath, verifySettlement) {
    if (typeof verifySettlement !== 'function') throw new Error('TRUSTED_SETTLEMENT_VERIFIER_REQUIRED');
    this.#verify = verifySettlement;
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') fs.chmodSync(dbPath, 0o600);
    this.#db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settlement_accounts (
        venue TEXT NOT NULL, account_ref TEXT NOT NULL, owner_uid TEXT NOT NULL,
        PRIMARY KEY(venue, account_ref)
      );
      CREATE TABLE IF NOT EXISTS financial_settlements (
        venue TEXT NOT NULL, account_ref TEXT NOT NULL, settlement_id TEXT NOT NULL,
        owner_uid TEXT NOT NULL, amount_micro_usd INTEGER NOT NULL, settled_at_ms INTEGER NOT NULL,
        PRIMARY KEY(venue, account_ref, settlement_id)
      );
      CREATE INDEX IF NOT EXISTS financial_settlements_owner ON financial_settlements(owner_uid, settled_at_ms);
    `);
  }

  // Only server integration code may call this. The injected verifier must obtain
  // settled amounts and the owner/account binding independently of any request body.
  // Never pass a function that simply echoes caller data as the verifier.
  async ingest(reference) {
    const event = validateSettlement(await this.#verify(reference));
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const binding = this.#db.prepare('SELECT owner_uid FROM settlement_accounts WHERE venue = ? AND account_ref = ?').get(event.venue, event.accountRef);
      if (binding && binding.owner_uid !== event.uid) throw new Error('SETTLEMENT_ACCOUNT_OWNER_CONFLICT');
      if (!binding) this.#db.prepare('INSERT INTO settlement_accounts(venue, account_ref, owner_uid) VALUES (?, ?, ?)').run(event.venue, event.accountRef, event.uid);
      const prior = this.#db.prepare('SELECT owner_uid, amount_micro_usd, settled_at_ms FROM financial_settlements WHERE venue = ? AND account_ref = ? AND settlement_id = ?').get(event.venue, event.accountRef, event.settlementId);
      if (prior) {
        if (prior.owner_uid !== event.uid || prior.amount_micro_usd !== event.amount || prior.settled_at_ms !== event.settledAtMs) {
          throw new Error('SETTLEMENT_REPLAY_CONFLICT');
        }
        this.#db.exec('COMMIT');
        return { inserted: false };
      }
      this.#db.prepare('INSERT INTO financial_settlements(venue, account_ref, settlement_id, owner_uid, amount_micro_usd, settled_at_ms) VALUES (?, ?, ?, ?, ?, ?)').run(event.venue, event.accountRef, event.settlementId, event.uid, event.amount, event.settledAtMs);
      this.#db.exec('COMMIT');
      return { inserted: true };
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  // uid must be obtained from verified server authentication, not a URL/body
  // supplied tenant identifier. No account-wide read is exposed by this class.
  readRealizedPnl(uid) {
    const owner = requireId(uid, 'OWNER');
    const row = this.#db.prepare('SELECT COUNT(*) AS count, CAST(COALESCE(SUM(amount_micro_usd), 0) AS TEXT) AS amount FROM financial_settlements WHERE owner_uid = ?').get(owner);
    return { settlementCount: row.count, realizedPnlMicroUsd: row.amount };
  }

  close() { this.#db.close(); }
}
