import type { TradingMode } from './tradingModes';

/**
 * A signal is compared by its immutable snapshot identity, not pair/timeframe.
 * One signal may produce multiple mode-specific execution attempts.
 * This read-only utility never connects to an exchange or settles PnL.
 */
export interface ModeExecutionObservation {
  accountId: string;
  signalId: string;
  strategyVersion: string;
  mode: TradingMode;
  attemptId: string;
  status: 'FILLED' | 'REJECTED' | 'PENDING' | 'CANCELLED';
  providerOrderId?: string | null;
  realizedNetPnlUsd?: number | null;
}

export interface SignalModeComparison {
  signalId: string;
  strategyVersion: string;
  modes: Record<TradingMode, {
    status: 'NOT_RUN' | 'FILLED' | 'REJECTED' | 'PENDING' | 'CANCELLED' | 'MIXED';
    attempts: number;
    realizedNetPnlUsd: number | null;
  }>;
}

const modes: readonly TradingMode[] = ['PAPER', 'DEMO', 'LIVE'];

function isMode(value: unknown): value is TradingMode {
  return value === 'PAPER' || value === 'DEMO' || value === 'LIVE';
}

/**
 * The authorized account ID must be obtained from trusted server auth.
 * No synthetic LIVE result is created when there are no live observations.
 * Incomplete/invalid attempts are rejected, and repeat IDs are deduplicated.
 */
export function compareExecutionsBySignal(
  observations: readonly ModeExecutionObservation[],
  authorizedAccountId: string
): SignalModeComparison[] {
  if (typeof authorizedAccountId !== 'string' || !authorizedAccountId.trim()) {
    throw new Error('Verified account ID is required');
  }
  const grouped = new Map<string, ModeExecutionObservation[]>();
  const seenAttempts = new Set<string>();

  for (const record of observations) {
    if (record.accountId !== authorizedAccountId) continue;
    if (!record.signalId?.trim() || !record.strategyVersion?.trim() || !record.attemptId?.trim()) continue;
    if (!isMode(record.mode)) continue;
    if (!['FILLED', 'REJECTED', 'PENDING', 'CANCELLED'].includes(record.status)) continue;
    // A filled record must have a valid authoritative monetary value; other
    // statuses are not settled P&L and must not be counted as realized profit.
    if (record.status === 'FILLED' && (
      record.realizedNetPnlUsd === null ||
      typeof record.realizedNetPnlUsd !== 'number' ||
      !Number.isFinite(record.realizedNetPnlUsd)
    )) continue;
    const attemptKey = JSON.stringify([record.accountId, record.mode, record.attemptId]);
    if (seenAttempts.has(attemptKey)) continue;
    seenAttempts.add(attemptKey);
    const signalKey = JSON.stringify([record.signalId, record.strategyVersion]);
    const rows = grouped.get(signalKey) ?? [];
    rows.push(record);
    grouped.set(signalKey, rows);
  }

  return [...grouped.values()].map(rows => {
    const first = rows[0];
    const result = {} as SignalModeComparison['modes'];
    for (const mode of modes) {
      const subset = rows.filter(record => record.mode === mode);
      const statuses = new Set(subset.map(record => record.status));
      const filled = subset.filter(record => record.status === 'FILLED');
      result[mode] = {
        status: statuses.size === 0 ? 'NOT_RUN' : statuses.size > 1 ? 'MIXED' : subset[0].status,
        attempts: subset.length,
        // Null means there is no settled result; never show "$0 earned"
        // for a mode which has never had any fills.
        realizedNetPnlUsd: filled.length
          ? filled.reduce((sum, record) => sum + (record.realizedNetPnlUsd as number), 0)
          : null,
      };
    }
    return { signalId: first.signalId, strategyVersion: first.strategyVersion, modes: result };
  }).sort((a, b) => a.signalId.localeCompare(b.signalId));
}
