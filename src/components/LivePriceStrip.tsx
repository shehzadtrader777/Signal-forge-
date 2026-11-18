import { RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TRACKED_COINS, formatCryptoPrice } from '../lib/marketData';

export function LivePriceStrip() {
  const {
    tickers,
    selectedSymbol,
    setSelectedSymbol,
    wsConnected,
    liveFeedModulesEnabled,
    telemetryMetrics,
    resyncing,
    resyncAllTelemetry,
  } = useApp();

  const latencyReadout = telemetryMetrics.lastLatencyMs || telemetryMetrics.avgLatencyMs;

  return (
    <section
      aria-label="Live Cryptocurrency Prices"
      className="border-b border-slate-800/80 bg-[#0d1323]"
    >
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <div className="hidden sm:flex items-center gap-2.5 shrink-0 pr-3 border-r border-slate-800">
          <span
            className={`h-2 w-2 rounded-full ${
              !liveFeedModulesEnabled
                ? 'bg-slate-500'
                : wsConnected
                ? 'bg-emerald-400'
                : 'bg-amber-400'
            }`}
            aria-hidden="true"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-medium text-slate-300 whitespace-nowrap">
              {!liveFeedModulesEnabled
                ? 'Spot Feed Paused'
                : wsConnected
                ? 'Binance Spot Live'
                : telemetryMetrics.fallbackEnforced
                ? 'Deterministic Spot'
                : 'Spot Feed'}
            </span>
            <span className="font-mono text-[10px] text-slate-500 tabular-nums whitespace-nowrap">
              {!liveFeedModulesEnabled
                ? 'Low-Lag Mode · Signals Active'
                : `${latencyReadout > 0 ? `${latencyReadout}ms` : 'calibrating'} · E${telemetryMetrics.syncEpoch} · ${Math.round(telemetryMetrics.pollIntervalMs / 1000)}s`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => resyncAllTelemetry()}
            disabled={resyncing}
            aria-label="Force telemetry resync"
            title="Flush WebSocket buffers, enforce deterministic fallback, and force immediate resync"
            className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-[#111827] px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-[#3b82f6] hover:text-white disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3 w-3 ${resyncing ? 'animate-spin text-[#3b82f6]' : ''}`}
              aria-hidden="true"
            />
            <span>{resyncing ? 'Syncing' : 'Force Resync'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
          {TRACKED_COINS.map((coin) => {
            const t = tickers[coin.symbol];
            if (!t) return null;
            const isSelected = selectedSymbol === coin.symbol;
            const isUp = t.change24hPercent >= 0;

            return (
              <button
                key={coin.symbol}
                type="button"
                onClick={() => setSelectedSymbol(coin.symbol)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                  isSelected
                    ? 'border-[#3b82f6] bg-[#3b82f6]/15 text-white'
                    : 'border-slate-800/80 bg-[#111827] text-slate-300 hover:border-slate-700 hover:text-white'
                }`}
              >
                <span className="text-xs font-semibold tracking-tight">{coin.baseAsset}</span>
                <span className="font-mono text-xs tabular-nums text-slate-100">
                  ${formatCryptoPrice(t.price)}
                </span>
                <span
                  className={`font-mono text-xs tabular-nums font-medium ${
                    isUp ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {isUp ? '+' : ''}
                  {t.change24hPercent.toFixed(2)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
