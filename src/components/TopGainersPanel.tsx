import { memo, useCallback, useMemo, useState } from 'react';
import { BellRing, Lock, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import { formatCompactUsd, formatCryptoPrice } from '../lib/marketData';
import type {
  BackendExecutionPipelineSnapshot,
  PrePumpSupportCandidate,
} from '../lib/executionPipeline';

interface TopGainersPanelProps {
  prioritizedSymbols?: string[];
  prePumpMonitor?: PrePumpSupportCandidate[];
  onPipelineSnapshotUpdated?: (next: BackendExecutionPipelineSnapshot) => void;
}

function formatShortTime(iso: string | null): string {
  if (!iso) return 'Syncing...';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Live';
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const TopGainersPanel = memo(function TopGainersPanel({
  prioritizedSymbols = [],
  prePumpMonitor = [],
  onPipelineSnapshotUpdated,
}: TopGainersPanelProps) {
  const {
    topGainers,
    gainerSource,
    gainerUpdatedAt,
    gainerAlerts,
    gainerLoading,
    refreshTopGainers,
    selectedSymbol,
    setSelectedSymbol,
    wsConnected,
  } = useApp();

  const [refreshing, setRefreshing] = useState(false);
  const [executingSymbol, setExecutingSymbol] = useState<string | null>(null);
  const [supportFeedback, setSupportFeedback] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshTopGainers(true);
    } finally {
      setRefreshing(false);
    }
  }, [refreshTopGainers]);

  const handleExecuteSupportTrade = useCallback(
    async (symbol: string) => {
      setExecutingSymbol(symbol);
      setSupportFeedback(null);
      setSelectedSymbol(symbol);
      try {
        const res = await apiFetch('/api/pipeline/pre-pump/execute-support', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, notionalUsd: 2000 }),
        });
        const data = await res.json().catch(() => null);
        if (data?.snapshot && onPipelineSnapshotUpdated) {
          onPipelineSnapshotUpdated(data.snapshot as BackendExecutionPipelineSnapshot);
        }
        if (!res.ok || !data?.ok) {
          setSupportFeedback({
            ok: false,
            text: data?.error || `Could not execute immediate support entry for ${symbol}.`,
          });
          return;
        }
        setSupportFeedback({
          ok: true,
          text: `Support Executed: ${symbol} BUY @ $${formatCryptoPrice(
            data.executedOrder.executedPrice
          )} — locked HOLD UNTIL MAX PROFIT TARGET ($${formatCryptoPrice(
            data.executedOrder.maxProfitTarget
          )}) in Backend Execution Logs.`,
        });
      } catch {
        setSupportFeedback({
          ok: false,
          text: `Network error executing Pre-Pump support trade for ${symbol}.`,
        });
      } finally {
        setExecutingSymbol(null);
      }
    },
    [onPipelineSnapshotUpdated, setSelectedSymbol]
  );

  const prioritizedSet = useMemo(() => new Set(prioritizedSymbols), [prioritizedSymbols]);
  const supportBySymbol = useMemo(() => {
    const map: Record<string, PrePumpSupportCandidate> = {};
    for (const item of prePumpMonitor) {
      map[item.symbol] = item;
    }
    return map;
  }, [prePumpMonitor]);

  return (
    <section
      aria-label="Pre-Pump & Top Gainer Continuous Support Execution Engine"
      data-testid="prepump-support-panel"
      className="cyber-surface rounded-xl border overflow-hidden"
    >
      {/* Header Bar */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-emerald-400 font-medium">
              {gainerSource === 'binance'
                ? 'Continuous Pre-Pump Support Monitor Live'
                : 'Binance Market Model'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-cyan-300 font-medium">
              Mandatory Hold Until Max Target (TP3)
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {wsConnected ? 'WS Synced' : 'Polling'} · Updated {formatShortTime(gainerUpdatedAt)}
            </span>
          </div>
          <h2 className="mt-0.5 font-display text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden="true" />
            <span>Pre-Pump &amp; Top Gainer Immediate Support Execution Desk</span>
          </h2>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Sync Binance Top Gainers"
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-700 bg-[#050914] px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white hover:border-cyan-400 transition-colors cursor-pointer whitespace-nowrap"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing || gainerLoading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{refreshing ? 'Syncing Feeder...' : 'Sync Gainers'}</span>
        </button>
      </div>

      {supportFeedback && (
        <div
          role="status"
          className={`border-b px-5 py-2.5 text-xs flex items-center justify-between gap-3 ${
            supportFeedback.ok
              ? 'border-emerald-500/35 bg-emerald-950/35 text-emerald-200'
              : 'border-amber-500/35 bg-amber-950/35 text-amber-200'
          }`}
        >
          <span>{supportFeedback.text}</span>
          <button
            type="button"
            onClick={() => setSupportFeedback(null)}
            className="text-[11px] font-semibold underline underline-offset-2 cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2-Column Split: Continuous Pre-Pump Support Table + Real-Time Alert Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80">
        {/* Left: Live Top Gainers + Immediate Support Execution */}
        <div className="lg:col-span-8 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-white">
              Continuous Support Monitoring &amp; Max-Target Hold Pairs (USDT)
            </h3>
            <span className="font-mono text-[11px] text-cyan-300">
              Early TP1/TP2 liquidation disabled · Auto-liquidates at TP3
            </span>
          </div>

          {topGainers.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Connecting to Binance 24h Top Gainers continuous support feeder...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2.5 pr-2 font-medium">Rank</th>
                    <th className="pb-2.5 pr-2 font-medium">Pair</th>
                    <th className="pb-2.5 pr-2 font-medium text-right">Live Price</th>
                    <th className="pb-2.5 pr-2 font-medium text-right">Support / Max TP3</th>
                    <th className="pb-2.5 pr-2 font-medium text-right">24H / Score</th>
                    <th className="pb-2.5 font-medium text-right">Support Execution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {topGainers.map((coin) => {
                    const isSelected = selectedSymbol === coin.symbol;
                    const inTopSignals = prioritizedSet.has(coin.symbol);
                    const supportInfo = supportBySymbol[coin.symbol];
                    const supportPrice = supportInfo?.supportLevel ?? coin.price * 0.996;
                    const maxTarget = supportInfo?.resistanceTargetMax ?? coin.price * 1.094;
                    const isHolding = supportInfo?.status === 'SUPPORT_EXECUTED_HOLDING';

                    return (
                      <tr
                        key={coin.symbol}
                        onClick={() => setSelectedSymbol(coin.symbol)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-cyan-500/10' : 'hover:bg-slate-800/35'
                        }`}
                      >
                        <td className="py-2.5 pr-2 font-mono tabular-nums text-slate-400">
                          #{coin.gainerRank}
                        </td>
                        <td className="py-2.5 pr-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-white">{coin.baseAsset}</span>
                            <span className="font-mono text-[11px] text-slate-400">
                              {coin.symbol}
                            </span>
                            {inTopSignals && (
                              <span className="text-[10px] font-mono text-cyan-400">· Signal</span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            Vol {formatCompactUsd(coin.volume24hUsd)} ·{' '}
                            {coin.accumulationPhase ?? 'MOMENTUM_LEADER'}
                          </div>
                        </td>
                        <td className="py-2.5 pr-2 text-right font-mono font-semibold tabular-nums text-white whitespace-nowrap">
                          ${formatCryptoPrice(coin.price)}
                        </td>
                        <td className="py-2.5 pr-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-cyan-300">
                            Sup ${formatCryptoPrice(supportPrice)}
                          </div>
                          <div className="text-[10px] text-emerald-400">
                            Max ${formatCryptoPrice(maxTarget)}
                          </div>
                        </td>
                        <td className="py-2.5 pr-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div
                            className={`font-semibold ${
                              coin.change24hPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {coin.change24hPercent >= 0 ? '+' : ''}
                            {coin.change24hPercent.toFixed(2)}%
                          </div>
                          <div className="text-[10px] text-amber-300">
                            Score {coin.prePumpScore ?? 78}/100
                          </div>
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {isHolding ? (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-cyan-300">
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              <span>HOLDING→TP3</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={executingSymbol !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExecuteSupportTrade(coin.symbol);
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Zap className="h-3 w-3" aria-hidden="true" />
                              <span>
                                {executingSymbol === coin.symbol ? 'Executing...' : 'Exec Support'}
                              </span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Real-Time Gainer Alerts Stream */}
        <div className="lg:col-span-4 p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <BellRing className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />
              <span>Real-Time Gainer Alerts</span>
            </h3>
            <span className="font-mono text-xs tabular-nums text-slate-400">
              {gainerAlerts.length} event{gainerAlerts.length === 1 ? '' : 's'}
            </span>
          </div>

          {gainerAlerts.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              Monitoring Binance 24h momentum thresholds and live support breakouts...
            </p>
          ) : (
            <ul className="divide-y divide-slate-800/70 max-h-[300px] overflow-y-auto pr-1">
              {gainerAlerts.slice(0, 6).map((alert) => (
                <li key={alert.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedSymbol(alert.symbol)}
                      className="font-semibold text-white hover:text-cyan-300 transition-colors cursor-pointer text-left"
                    >
                      #{alert.gainerRank} {alert.symbol}{' '}
                      <span className="font-mono font-normal text-slate-400">
                        ${formatCryptoPrice(alert.price)}
                      </span>
                    </button>
                    <span className="font-mono font-semibold tabular-nums text-emerald-400 whitespace-nowrap">
                      +{alert.change24hPercent.toFixed(2)}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-snug text-slate-300">{alert.reason}</p>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                    <span>Vol {formatCompactUsd(alert.volume24hUsd)}</span>
                    <span>{formatShortTime(alert.timestamp)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
});
