import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react';
import { formatCompactUsd } from '../lib/marketData';
import { useApp } from '../context/AppContext';

interface WhaleTransaction {
  id: string;
  symbol: string;
  coinName: string;
  amountUnits: number;
  amountUsd: number;
  type: 'Exchange Inflow' | 'Exchange Outflow' | 'Whale Transfer';
  fromLabel: string;
  toLabel: string;
  timestamp: string;
  impact: 'Bullish' | 'Bearish' | 'Neutral';
}

interface ExchangeFlowMetric {
  symbol: string;
  coinName: string;
  price: number;
  change24h: number;
  volume24hUsd: number;
  inflow24hUsd: number;
  outflow24hUsd: number;
  netflowUsd: number;
}

type FlowFilter = 'ALL' | 'Exchange Inflow' | 'Exchange Outflow' | 'Whale Transfer';

export function MarketIntelligence() {
  const { setSelectedSymbol } = useApp();
  const [whales, setWhales] = useState<WhaleTransaction[]>([]);
  const [flows, setFlows] = useState<ExchangeFlowMetric[]>([]);
  const [source, setSource] = useState<string>('loading');
  const [filter, setFilter] = useState<FlowFilter>('ALL');
  const [loading, setLoading] = useState(true);

  const loadIntelligence = () => {
    setLoading(true);
    fetch('/api/cmc/intelligence')
      .then((res) => res.json())
      .then((json) => {
        setWhales(Array.isArray(json.whales) ? json.whales : []);
        setFlows(Array.isArray(json.flows) ? json.flows : []);
        setSource(json.source === 'cmc' ? 'CoinMarketCap Live API' : 'CoinMarketCap Market Model');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadIntelligence();
  }, []);

  const filteredWhales =
    filter === 'ALL' ? whales : whales.filter((w) => w.type === filter);

  return (
    <section
      aria-label="Market Intelligence"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800/80 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs text-slate-400">{source}</span>
          <h2 className="mt-0.5 font-display text-lg font-bold text-white">
            Market Intelligence — Whale Tracker &amp; Exchange Flows
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter whale transactions"
            className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0a0e1a] p-1"
          >
            {(['ALL', 'Exchange Outflow', 'Exchange Inflow', 'Whale Transfer'] as FlowFilter[]).map(
              (f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    filter === f
                      ? 'bg-[#3b82f6] text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f === 'ALL' ? 'All Flows' : f}
                </button>
              )
            )}
          </div>

          <button
            type="button"
            onClick={loadIntelligence}
            aria-label="Refresh market intelligence"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0a0e1a] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80">
        {/* Left: Whale Tracker */}
        <div className="lg:col-span-7 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">
            Large Whale Transactions
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2.5 font-medium">Asset</th>
                  <th className="pb-2.5 font-medium">Flow Type</th>
                  <th className="pb-2.5 font-medium">Route</th>
                  <th className="pb-2.5 font-medium text-right">Value (USD)</th>
                  <th className="pb-2.5 font-medium text-right">Bias</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredWhales.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 pr-3">
                      <button
                        type="button"
                        onClick={() => setSelectedSymbol(tx.symbol)}
                        className="font-semibold text-white hover:text-[#3b82f6] cursor-pointer text-left"
                      >
                        {tx.coinName}
                        <span className="ml-1.5 font-mono text-[11px] text-slate-400">
                          {tx.amountUnits.toLocaleString('en-US')}
                        </span>
                      </button>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-300">
                      {tx.type}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-400">
                      {tx.fromLabel} → {tx.toLabel}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums text-white whitespace-nowrap">
                      {formatCompactUsd(tx.amountUsd)}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          tx.impact === 'Bullish'
                            ? 'text-emerald-400'
                            : tx.impact === 'Bearish'
                            ? 'text-rose-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {tx.impact === 'Bullish' ? (
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {tx.impact}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Exchange Inflow / Outflow Monitor */}
        <div className="lg:col-span-5 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">
            24h Exchange Inflow vs Outflow
          </h3>
          <div className="space-y-3.5">
            {flows.map((flow) => {
              const total = Math.max(1, flow.inflow24hUsd + flow.outflow24hUsd);
              const outflowShare = Math.round((flow.outflow24hUsd / total) * 100);
              const isAccumulation = flow.netflowUsd <= 0;

              return (
                <div key={flow.symbol} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedSymbol(flow.symbol)}
                      className="font-semibold text-white hover:text-[#3b82f6] cursor-pointer"
                    >
                      {flow.coinName}{' '}
                      <span className="font-mono text-slate-400">{flow.symbol}</span>
                    </button>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        isAccumulation ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      Net {isAccumulation ? '-' : '+'}
                      {formatCompactUsd(Math.abs(flow.netflowUsd))}{' '}
                      ({isAccumulation ? 'Outflow' : 'Inflow'})
                    </span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="bg-emerald-500"
                      style={{ width: `${outflowShare}%` }}
                      title={`Outflow: ${formatCompactUsd(flow.outflow24hUsd)}`}
                    />
                    <div
                      className="bg-rose-500"
                      style={{ width: `${100 - outflowShare}%` }}
                      title={`Inflow: ${formatCompactUsd(flow.inflow24hUsd)}`}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                    <span>Out: {formatCompactUsd(flow.outflow24hUsd)}</span>
                    <span>In: {formatCompactUsd(flow.inflow24hUsd)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
