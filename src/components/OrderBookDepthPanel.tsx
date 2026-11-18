import { useMemo, useState } from 'react';
import { Layers, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatCryptoPrice } from '../lib/marketData';
import type { MultiExchangeDepthAnalysis } from '../lib/orderBookDepth';

const DEPTH_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT'];

export function OrderBookDepthPanel() {
  const { selectedSymbol, setSelectedSymbol, orderBookDepth, refreshOrderBookDepth, tickers } =
    useApp();
  const [refreshing, setRefreshing] = useState(false);

  const activeSymbol = orderBookDepth[selectedSymbol]
    ? selectedSymbol
    : Object.keys(orderBookDepth)[0] || selectedSymbol || 'BTCUSDT';

  const depth: MultiExchangeDepthAnalysis | null = orderBookDepth[activeSymbol] ?? null;

  const coinTabs = useMemo(() => {
    const keys = Array.from(new Set([...DEPTH_COINS, activeSymbol]));
    return keys.slice(0, 6);
  }, [activeSymbol]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshOrderBookDepth(activeSymbol, true);
    } finally {
      setRefreshing(false);
    }
  };

  const bidRatioPct = depth
    ? Math.max(
        5,
        Math.min(
          95,
          (depth.aggregatedBidUsd / Math.max(1, depth.aggregatedBidUsd + depth.aggregatedAskUsd)) *
            100
        )
      )
    : 50;

  const avgSpreadBps =
    depth && depth.exchanges.length > 0
      ? depth.exchanges.reduce((sum, ex) => sum + ex.spreadBps, 0) / depth.exchanges.length
      : 1.0;

  const obiPct = depth ? depth.netOrderBookImbalance * 100 : 0;

  const shiftLabel = depth
    ? depth.liquidityShift === 'INSTITUTIONAL_ACCUMULATION'
      ? 'Institutional Accumulation'
      : depth.liquidityShift === 'DISTRIBUTION_WALL'
      ? 'Ask Wall Distribution'
      : depth.liquidityShift === 'LIQUIDITY_VACUUM'
      ? 'Liquidity Vacuum'
      : 'Balanced Depth'
    : 'Initializing';

  const shiftColor =
    depth?.liquidityShift === 'INSTITUTIONAL_ACCUMULATION'
      ? 'text-emerald-400'
      : depth?.liquidityShift === 'DISTRIBUTION_WALL'
      ? 'text-rose-400'
      : depth?.liquidityShift === 'LIQUIDITY_VACUUM'
      ? 'text-amber-300'
      : 'text-slate-300';

  return (
    <section
      aria-label="Multi-Exchange L2 Order Book Depth Monitor"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Layers className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span className="font-mono font-semibold text-blue-300">
              BINANCE · BYBIT · OKX L2 DEPTH
            </span>
            <span aria-hidden="true">·</span>
            <span className={`font-mono font-semibold ${shiftColor}`}>{shiftLabel}</span>
            {depth && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-300 tabular-nums">
                  {depth.whaleWalls.length} Whale Walls Detected
                </span>
              </>
            )}
          </div>
          <h2 className="mt-0.5 font-display text-lg font-bold text-white tracking-tight">
            Multi-Exchange Order Book Depth &amp; Institutional Liquidity Shifts
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Select Depth Asset"
            className="inline-flex rounded-lg border border-slate-800 bg-[#0a0e1a] p-0.5 text-[11px] font-mono"
          >
            {coinTabs.map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => {
                  setSelectedSymbol(sym);
                  refreshOrderBookDepth(sym, false);
                }}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors cursor-pointer ${
                  sym === activeSymbol
                    ? 'bg-[#3b82f6] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {sym.replace(/USDT$/, '')}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0a0e1a] px-2.5 py-1.5 text-xs text-slate-300 hover:border-[#3b82f6] hover:text-white cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-[#3b82f6]' : ''}`}
              aria-hidden="true"
            />
            <span>Sync L2 Books</span>
          </button>
        </div>
      </div>

      {!depth ? (
        <div className="p-6 text-center text-xs text-slate-400">
          Synchronizing Binance, Bybit, and OKX L2 depth ladders for {activeSymbol}...
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Top Multi-Exchange Telemetry Strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 font-mono text-xs tabular-nums">
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">REFERENCE MID ({activeSymbol})</span>
              <span className="mt-0.5 block text-sm font-bold text-white">
                ${formatCryptoPrice(tickers[activeSymbol]?.price ?? depth.liveMidPrice)}
              </span>
              <span className="text-[10px] text-slate-400">
                Spread: {avgSpreadBps.toFixed(2)} bps
              </span>
            </div>

            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
              <span className="block text-[10px] text-emerald-300">AGGREGATED BID DEPTH</span>
              <span className="mt-0.5 block text-sm font-bold text-emerald-300">
                ${(depth.aggregatedBidUsd / 1_000_000).toFixed(2)}M
              </span>
              <span className="text-[10px] text-slate-400">
                Support across {depth.exchanges.length} venues
              </span>
            </div>

            <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
              <span className="block text-[10px] text-rose-300">AGGREGATED ASK DEPTH</span>
              <span className="mt-0.5 block text-sm font-bold text-rose-300">
                ${(depth.aggregatedAskUsd / 1_000_000).toFixed(2)}M
              </span>
              <span className="text-[10px] text-slate-400">Overhead resting supply</span>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">NET ORDER BOOK IMBALANCE</span>
              <span
                className={`mt-0.5 block text-sm font-bold ${
                  obiPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {obiPct >= 0 ? '+' : ''}
                {obiPct.toFixed(2)}% OBI
              </span>
              <span className={`text-[10px] font-semibold ${shiftColor}`}>{shiftLabel}</span>
            </div>
          </div>

          {/* Aggregated Bid vs Ask Liquidity Pressure Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
              <span>
                Bid Liquidity Balance:{' '}
                <strong className="text-emerald-400">{bidRatioPct.toFixed(1)}%</strong>
              </span>
              <span>
                Ask Overhead:{' '}
                <strong className="text-rose-400">{(100 - bidRatioPct).toFixed(1)}%</strong>
              </span>
            </div>
            <div className="h-2.5 w-full rounded bg-rose-500/30 overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${bidRatioPct.toFixed(1)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-300">{depth.summary}</p>
          </div>

          {/* Exchange Venue Breakdown + Detected Whale Walls */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5 rounded-lg border border-slate-800/80 bg-[#0d1323] p-3.5 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Exchange Venue Contribution
              </div>
              <div className="divide-y divide-slate-800/70 font-mono text-xs tabular-nums">
                {depth.exchanges.map((ex) => (
                  <div key={ex.exchange} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-white uppercase">{ex.exchange}</span>
                      <span className="ml-2 text-[10px] text-slate-400">
                        {ex.source === 'live_ws'
                          ? 'Live WS L2'
                          : ex.source === 'exchange_rest'
                          ? 'REST L2'
                          : 'WS-Anchored'}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-emerald-300">
                        ${(ex.bidDepth2PctUsd / 1e3).toFixed(0)}k Bid
                      </span>
                      <span className="mx-1.5 text-slate-600">/</span>
                      <span className="text-rose-300">
                        ${(ex.askDepth2PctUsd / 1e3).toFixed(0)}k Ask
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7 rounded-lg border border-slate-800/80 bg-[#0d1323] p-3.5 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Detected Institutional Whale Liquidity Walls ({depth.whaleWalls.length})
              </div>
              {depth.whaleWalls.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">
                  No concentrated whale order walls exceeding cluster threshold on {activeSymbol}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono tabular-nums">
                    <thead className="text-[10px] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-1.5 pr-2">Venue</th>
                        <th className="py-1.5 px-2">Wall Side</th>
                        <th className="py-1.5 px-2 text-right">Price Level</th>
                        <th className="py-1.5 px-2 text-right">Cluster Size</th>
                        <th className="py-1.5 pl-2 text-right">Dist %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {depth.whaleWalls.slice(0, 5).map((wall, idx) => (
                        <tr key={`${wall.exchange}_${wall.side}_${idx}`}>
                          <td className="py-1.5 pr-2 font-bold text-white uppercase">
                            {wall.exchange}
                          </td>
                          <td
                            className={`py-1.5 px-2 font-semibold ${
                              wall.side === 'BID' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {wall.side === 'BID' ? 'BID ABSORB' : 'ASK SUPPLY'}
                          </td>
                          <td className="py-1.5 px-2 text-right text-slate-200">
                            ${formatCryptoPrice(wall.price)}
                          </td>
                          <td className="py-1.5 px-2 text-right text-blue-300 font-semibold">
                            ${Math.round(wall.notionalUsd).toLocaleString()}
                          </td>
                          <td className="py-1.5 pl-2 text-right text-slate-400">
                            {wall.distancePct.toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
