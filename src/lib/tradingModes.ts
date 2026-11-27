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
/** Never merge mode ledgers. A missing mode is reported as Not run by the UI. */
export function summarizeByMode(trades: readonly ComparableTrade[]): ModeSummary[] {
  return (['PAPER', 'DEMO', 'LIVE'] as const).map(mode => {
    const rows = trades.filter(t => t.mode === mode);
    return {
      mode,
      count: rows.length,
      realizedNetPnlUsd: rows.reduce((sum, t) => sum + t.realizedNetPnlUsd, 0),
    };
  });
}
