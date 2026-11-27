/**
 * Safe, standalone trading-mode domain model.
 * Does NOT submit exchange orders or grant live execution permission.
 * Must be integrated with authoritative server gates before use in production.
 */
export type TradingMode = 'PAPER' | 'DEMO' | 'LIVE';
export type OrderDestination = 'SIMULATOR' | 'EXCHANGE_SANDBOX' | 'EXCHANGE_PRODUCTION';

export interface ExecutionPermit {
  mode: TradingMode;
  requestedDestination: OrderDestination;
  authenticated: boolean;
  serverLiveEnabled: boolean;
  accountLiveApproved: boolean;
  freshChallengeVerified: boolean;
  riskApproved: boolean;
  exchangeConfigured: boolean;
  emergencyHalt: boolean;
}

export function normalizeTradingMode(input: unknown): TradingMode {
  return input === 'DEMO' || input === 'LIVE' ? input : 'PAPER';
}

export function expectedDestination(mode: TradingMode): OrderDestination {
  switch (mode) {
    case 'PAPER': return 'SIMULATOR';
    case 'DEMO': return 'EXCHANGE_SANDBOX';
    case 'LIVE': return 'EXCHANGE_PRODUCTION';
  }
}

/** Default-deny mode gate: fail closed if fields are absent or mode is unknown. */
export function authorizeOrderRoute(permit: ExecutionPermit): boolean {
  if (permit.emergencyHalt || !permit.authenticated || !permit.riskApproved) return false;
  if (permit.requestedDestination !== expectedDestination(permit.mode)) return false;
  if (permit.mode === 'PAPER') return true;
  if (!permit.exchangeConfigured) return false;
  if (permit.mode === 'DEMO') return true;
  return permit.serverLiveEnabled === true
    && permit.accountLiveApproved === true
    && permit.freshChallengeVerified === true;
}

export interface ComparableTrade {
  mode: TradingMode;
  accountId: string;
  signalId: string;
  strategyVersion: string;
  realizedNetPnlUsd: number;
}
export interface ModeSummary {
  mode: TradingMode;
  count: number;
  realizedNetPnlUsd: number;
}
/**
 * Use server-authenticated accountId to scope comparisons. Never accept an
 * accountId from an untrusted request without checking the authenticated
 * principal on the server. Invalid entries are excluded, not normalized into
 * fabricated zero-PnL trades. This is read-only presentation, not settlement.
 */
export function summarizeAccountByMode(
  trades: readonly ComparableTrade[],
  authorizedAccountId: string
): ModeSummary[] {
  if (!authorizedAccountId || !authorizedAccountId.trim()) {
    throw new Error('Verified account ID is required');
  }
  const valid = trades.filter(t =>
    t.accountId === authorizedAccountId &&
    (t.mode === 'PAPER' || t.mode === 'DEMO' || t.mode === 'LIVE') &&
    Number.isFinite(t.realizedNetPnlUsd) &&
    !!t.signalId &&
    !!t.strategyVersion
  );
  return (['PAPER', 'DEMO', 'LIVE'] as const).map(mode => {
    const rows = valid.filter(t => t.mode === mode);
    return {
      mode,
      count: rows.length,
      realizedNetPnlUsd: rows.reduce((sum, t) => sum + t.realizedNetPnlUsd, 0),
    };
  });
}

/**
 * Unscoped calculations are for trusted, pre-filtered datasets only.
 * Do not feed records from multiple users to this function.
 */
export function summarizeByMode(trades: readonly ComparableTrade[]): ModeSummary[] {
  const accountIds = new Set(trades.map(t => t.accountId));
  if (accountIds.size > 1) {
    throw new Error('Cannot compare trades from multiple accounts');
  }
  if (!trades.length) {
    return (['PAPER', 'DEMO', 'LIVE'] as const).map(mode => ({ mode, count: 0, realizedNetPnlUsd: 0 }));
  }
  return summarizeAccountByMode(trades, trades[0].accountId);
}
