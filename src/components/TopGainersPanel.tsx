import { useState, type MouseEvent } from 'react';
import { BellRing, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatCompactUsd, formatCryptoPrice, type TopGainerCoin } from '../lib/marketData';

interface TopGainersPanelProps {
  prioritizedSymbols?: string[];
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

export function TopGainersPanel({ prioritizedSymbols = [] }: TopGainersPanelProps) {
  const {
    topGainers,
    gainerSource,
    gainerUpdatedAt,
    gainerAlerts,
    gainerLoading,
    refreshTopGainers,
    selectedSymbol,
    setSelectedSymbol,
    futuresTradingEnabled,
    setExecutionRouteDraft,
    wsConnected,
  } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshTopGainers(true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleBuyGainer = (e: MouseEvent, coin: TopGainerCoin) => {
    e.stopPropagation();
    setSelectedSymbol(coin.symbol);
    setExecutionRouteDraft({
      symbol: coin.symbol,
      direction: 'BUY',
      market: futuresTradingEnabled ? 'USD_M_FUTURES' : 'SPOT',
      moduleId: 'SPOT_MOMENTUM',
      leverage: futuresTradingEnabled ? coin.dynamicLeverageCap ?? 8 : 1,
      notionalUsd: 1500,
      trailingAtrMultiplier: coin.wideTrailAtrMult ?? 2.15,
      prePumpScore: coin.prePumpScore,
      sourceLabel: `Top Gainer #${coin.gainerRank} Feeder`,
      requestedAt: Date.now(),
    });
    const target =
      document.getElementById('forge-execution-hub') ??
      document.getElementById('execution-ledger');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const prioritizedSet = new Set(prioritizedSymbols);

  return (
    <section
      aria-label="Binance Top Gainers Feeder"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      {/* Header Bar */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
              {wsConnected && (
                <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
              )}
              {gainerSource === 'binance' ? 'Binance 24h Pre-Pump Feeder Live' : 'Binance Market Model'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Auto-poll every 25s</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Updated {formatShortTime(gainerUpdatedAt)}
            </span>
          </div>
          <h2 className="mt-0.5 font-display text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden="true" />
            <span>Binance Top Gainers Pre-Pump Feeder &amp; Real-Time Alerts</span>
          </h2>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Sync Binance Top Gainers"
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-800 bg-[#0a0e1a] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:border-[#3b82f6] transition-colors cursor-pointer whitespace-nowrap"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing || gainerLoading ? 'animate-spin' : ''}`}
          />
          <span>{refreshing ? 'Syncing Feeder...' : 'Sync Gainers'}</span>
        </button>
      </div>

      {/* 2-Column Split: Live Top Gainers Table + Real-Time Alert Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80">
        {/* Left: Live Top Gainers */}
        <div className="lg:col-span-7 p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-white">
              Pre-Pump &amp; Top Gaining Spot Pairs (USDT)
            </h3>
            <span className="text-xs text-slate-400">
              Click row for chart or BUY to route
            </span>
          </div>

          {topGainers.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Connecting to Binance 24h Top Gainers feeder...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2.5 font-medium">Rank</th>
                    <th className="pb-2.5 font-medium">Pair</th>
                    <th className="pb-2.5 font-medium text-right">Live Price</th>
                    <th className="pb-2.5 font-medium text-right">24H Gain</th>
                    <th className="pb-2.5 font-medium text-right">Pre-Pump</th>
                    <th className="pb-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {topGainers.map((coin) => {
                    const isSelected = selectedSymbol === coin.symbol;
                    const inTopSignals = prioritizedSet.has(coin.symbol);

                    return (
                      <tr
                        key={coin.symbol}
                        onClick={() => setSelectedSymbol(coin.symbol)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#3b82f6]/10' : 'hover:bg-slate-800/35'
                        }`}
                      >
                        <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-400">
                          #{coin.gainerRank}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-white">{coin.baseAsset}</span>
                            <span className="font-mono text-[11px] text-slate-400">
                              {coin.symbol}
                            </span>
                            {inTopSignals && (
                              <span className="text-[10px] font-mono text-blue-400">
                                · Signal
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            Vol {formatCompactUsd(coin.volume24hUsd)} ·{' '}
                            {coin.accumulationPhase ?? 'MOMENTUM_LEADER'}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums text-white whitespace-nowrap">
                          ${formatCryptoPrice(coin.price)}
                        </td>
                        <td
                          className={`py-2.5 pr-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                            coin.change24hPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {coin.change24hPercent >= 0 ? '+' : ''}
                          {coin.change24hPercent.toFixed(2)}%
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-amber-300">
                            {coin.prePumpScore ?? 72}
                            <span className="text-slate-500">/100</span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {(coin.volumeAnomalyRatio ?? 1.8).toFixed(1)}x Vol ·{' '}
                            {(coin.wideTrailAtrMult ?? 2.15).toFixed(2)}x ATR
                          </div>
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => handleBuyGainer(e, coin)}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                          >
                            <Zap className="h-3 w-3" aria-hidden="true" />
                            <span>BUY</span>
                          </button>
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
        <div className="lg:col-span-5 p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <BellRing className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
              <span>Real-Time Gainer Alerts</span>
            </h3>
            <span className="font-mono text-xs tabular-nums text-slate-400">
              {gainerAlerts.length} event{gainerAlerts.length === 1 ? '' : 's'}
            </span>
          </div>

          {gainerAlerts.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              Monitoring Binance 24h momentum thresholds and live WebSocket surges...
            </p>
          ) : (
            <ul className="divide-y divide-slate-800/70 max-h-[300px] overflow-y-auto pr-1">
              {gainerAlerts.slice(0, 6).map((alert) => (
                <li key={alert.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedSymbol(alert.symbol)}
                      className="font-semibold text-white hover:text-[#3b82f6] transition-colors cursor-pointer text-left"
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
}
