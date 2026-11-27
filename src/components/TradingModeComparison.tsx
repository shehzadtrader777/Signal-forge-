import React from 'react';
import { summarizeAccountByMode, type ComparableTrade, type TradingMode } from '../lib/tradingModes';

/**
 * Read-only comparison panel for the three execution environments.
 * Never switches execution mode or calls an exchange.
 */
export function TradingModeComparison({ trades, activeMode, authorizedAccountId }: {
  trades: readonly ComparableTrade[];
  activeMode: TradingMode;
  /** Must be derived from the authenticated session, not a user-supplied query. */
  authorizedAccountId: string;
}) {
  const summaries = summarizeAccountByMode(trades, authorizedAccountId);
  const titles: Record<TradingMode, string> = {
    PAPER: 'Paper Simulation',
    DEMO: 'Exchange Demo / Testnet',
    LIVE: 'Live Exchange',
  };

  return (
    <section aria-label="Trading mode performance comparison" className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-100">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Trading Mode Comparison</h2>
        <span className="text-xs text-amber-300">Read-only · No orders submitted</span>
      </div>
      <p className="mb-4 text-sm text-slate-400">Paper fills are simulated. Demo uses an exchange sandbox when configured. Live results are real orders only. These outcomes are not directly interchangeable.</p>
      <div className="grid gap-3 md:grid-cols-3">
        {summaries.map(summary => {
          const hasRuns = summary.count > 0;
          return (
            <article key={summary.mode} className="rounded-lg border border-slate-700 p-3" aria-label={titles[summary.mode]}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-medium">{titles[summary.mode]}</h3>
                {activeMode === summary.mode && <span className="text-xs text-sky-300">Selected</span>}
              </div>
              <p className="text-sm text-slate-400">Trades: {hasRuns ? summary.count : 'Not run'}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {hasRuns ? `$${summary.realizedNetPnlUsd.toFixed(2)} net P&L` : 'Not run'}
              </p>
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-400">Data must come from mode-tagged, verified ledger entries. This panel is display-only; it does not authorize live trading.</p>
    </section>
  );
}

export default TradingModeComparison;
