import { Activity, Lock, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatCryptoPrice, type Candle } from '../lib/marketData';

interface LiveTestnetLedgerProps {
  candlesMap?: Record<string, Candle[]>;
}

export function LiveTestnetLedger(_props: LiveTestnetLedgerProps) {
  const {
    executionState,
    unifiedCapitalLedger,
    spotFeedSource,
    cmcSource,
    monitorHealth,
    closeSandboxPosition,
    futuresTradingEnabled,
    testnetExecutionEnabled,
    setTestnetExecutionEnabled,
  } = useApp();

  const rows = unifiedCapitalLedger.positions;
  const openCount = unifiedCapitalLedger.openPositionsCount;
  const totalOpenPnlUsd = unifiedCapitalLedger.totalOpenPnlUsd;
  const liveEquityUsd = unifiedCapitalLedger.liveEquityUsd;
  const emergencyHalted = unifiedCapitalLedger.emergencyHalted;
  const anomaliesIsolated = monitorHealth?.anomaliesIsolatedCount ?? 0;

  return (
    <section
      id="live-testnet-ledger"
      aria-label="Live Testnet Execution Ledger"
      className="scroll-mt-20 rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Activity className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            <span className="font-mono text-emerald-400 font-semibold">
              {spotFeedSource === 'binance_spot' ? 'BINANCE SPOT LIVE' : 'SPOT DETERMINISTIC'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              CMC Valuations ({cmcSource === 'cmc_api' ? 'CoinMarketCap Live' : 'Unavailable'})
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {futuresTradingEnabled ? 'Futures Optional ON' : 'Spot Priority (1x)'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-blue-300">
              {unifiedCapitalLedger.walletParityDivergencePct.toFixed(2)}% Parity Drift ·{' '}
              {unifiedCapitalLedger.walletParityVerified ? 'Verified' : 'Syncing'}
            </span>
            {anomaliesIsolated > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-amber-300 tabular-nums">
                  {anomaliesIsolated} Anomalies Isolated
                </span>
              </>
            )}
          </div>
          <h2 className="mt-0.5 font-display text-xl font-bold text-white tracking-tight">
            Live Testnet Execution Ledger
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums">
          <div className="rounded-lg border border-slate-800 bg-[#0a0e1a] px-3 py-1.5">
            <span className="block text-[10px] text-slate-400">ACTIVE TRADES</span>
            <span className="font-bold text-white">{openCount} Open</span>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0a0e1a] px-3 py-1.5">
            <span className="block text-[10px] text-slate-400">LIVE FLOATING PNL</span>
            <span
              className={`font-bold ${
                totalOpenPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {totalOpenPnlUsd >= 0 ? '+' : ''}${totalOpenPnlUsd.toFixed(2)}
            </span>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0a0e1a] px-3 py-1.5">
            <span className="block text-[10px] text-slate-400">TESTNET EQUITY</span>
            <span className="font-bold text-blue-300">
              ${liveEquityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap ${
              emergencyHalted
                ? 'border-rose-500/45 bg-rose-500/15 text-rose-300'
                : !testnetExecutionEnabled && executionState.mode === 'TESTNET'
                ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {emergencyHalted ? (
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>
              {emergencyHalted
                ? 'EMERGENCY_HALT (423)'
                : !testnetExecutionEnabled && executionState.mode === 'TESTNET'
                ? 'TESTNET PAUSED'
                : executionState.mode}
            </span>
          </span>
        </div>
      </div>

      {!testnetExecutionEnabled && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-xs text-amber-200"
        >
          <span>
            Binance Testnet Execution is paused — high-frequency ATR trailing &amp; order loops are halted while Signal Engine, Top Gainers &amp; Telegram remain active.
          </span>
          <button
            type="button"
            onClick={() => setTestnetExecutionEnabled(true)}
            className="rounded-md border border-amber-400/50 bg-[#0d1323] px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20 cursor-pointer whitespace-nowrap shrink-0"
          >
            Resume Testnet Execution
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-400">
          No active Testnet executions yet. Route an order in Forge Capital Hub or execute a signal from the AI Trading Coordinator to stream real-time entry, PnL, and ATR trailing stops here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0a0e1a] text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Pair &amp; Governing Desk</th>
                <th className="py-2.5 px-3">Side</th>
                <th className="py-2.5 px-3">Entry Price</th>
                <th className="py-2.5 px-3">Live Spot Price</th>
                <th className="py-2.5 px-3">Live PnL</th>
                <th className="py-2.5 px-3">Trailing ATR SL</th>
                <th className="py-2.5 px-3">Take Profits (TP1–TP3)</th>
                <th className="py-2.5 px-4 text-right">Status / Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-[#0d1323]/70 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <span>{row.symbol}</span>
                      {row.autonomousEntry && (
                        <span className="text-[10px] font-semibold text-blue-300">AUTO</span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {row.marketKind === 'USD_M_FUTURES'
                        ? `FUTURES ${row.effectiveLev}x ${row.marginMode || 'CROSS'}`
                        : 'SPOT 1x'}{' '}
                      · ${row.notionalUsd.toLocaleString()} ·{' '}
                      <span className="text-blue-300">{row.moduleLabel}</span>
                    </div>
                  </td>
                  <td
                    className={`py-3 px-3 font-bold ${
                      row.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {row.direction}
                  </td>
                  <td className="py-3 px-3 text-slate-200">
                    ${formatCryptoPrice(row.entryPrice)}
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-white font-semibold">
                      ${formatCryptoPrice(row.livePrice)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {row.cmcPriceUsd ? `CMC $${formatCryptoPrice(row.cmcPriceUsd)}` : 'Spot Tick'}
                      {!row.cmcAligned && (
                        <span className="ml-1 text-amber-300">(Guarded)</span>
                      )}
                    </div>
                  </td>
                  <td
                    className={`py-3 px-3 font-semibold ${
                      row.livePnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    <div>
                      {row.livePnlUsd >= 0 ? '+' : ''}${row.livePnlUsd.toFixed(2)}
                    </div>
                    <div className="text-[10px]">
                      {row.livePnlPercent >= 0 ? '+' : ''}
                      {row.livePnlPercent.toFixed(2)}%
                      {row.marketKind === 'USD_M_FUTURES'
                        ? ` (ROE ${row.liveRoePercent >= 0 ? '+' : ''}${row.liveRoePercent.toFixed(1)}%)`
                        : ''}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-amber-300">
                    <div>${formatCryptoPrice(row.liveTrailSl)}</div>
                    <div className="text-[10px] text-slate-500">
                      Cap {row.maxStopLossPct ?? 2}% · Init ${formatCryptoPrice(row.initialStopLoss)}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-emerald-300">
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                      {row.trailingTakeProfit5xAtr ? (
                        <span className="text-cyan-300 font-semibold">
                          5x ATR ${formatCryptoPrice(row.trailingTakeProfit5xAtr)}
                        </span>
                      ) : null}
                      <span>TP1 ${formatCryptoPrice(row.takeProfits[0])}</span>
                      <span>TP3 ${formatCryptoPrice(row.takeProfits[2])}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {row.status === 'OPEN' ? (
                      <button
                        type="button"
                        disabled={!testnetExecutionEnabled && executionState.mode === 'TESTNET'}
                        onClick={() => closeSandboxPosition(row.id, row.livePrice)}
                        className="rounded-md border border-slate-700 bg-[#0d1323] px-2.5 py-1 text-[11px] font-sans font-semibold text-white hover:border-rose-400 hover:text-rose-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                      >
                        {!testnetExecutionEnabled && executionState.mode === 'TESTNET'
                          ? 'Execution Paused'
                          : 'Close & Settle'}
                      </button>
                    ) : (
                      <span className="text-[11px] font-sans text-slate-400">
                        Settled ({row.status.replace('CLOSED_', '')})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
