import { ArrowDownRight, ArrowUpRight, Calculator, Lock, Star, Zap } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { type TradingSignal } from '../lib/signals';
import { formatCryptoPrice } from '../lib/marketData';
import { type PinnedSignalRecord, isPinnedSignalResolved } from '../lib/pinnedSignals';
import { useApp } from '../context/AppContext';

interface SignalCardProps {
  signal: TradingSignal;
  rank: number;
  pinnedRecord?: PinnedSignalRecord;
  onOpenRiskCalc: (signal: TradingSignal) => void;
}

export function SignalCard({
  signal,
  rank,
  pinnedRecord,
  onOpenRiskCalc,
}: SignalCardProps) {
  const {
    watchlist,
    toggleWatchlist,
    setSelectedSymbol,
    futuresTradingEnabled,
    setExecutionRouteDraft,
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const isBuy = signal.direction === 'BUY';
  const isWatched = watchlist.includes(signal.symbol);

  const activeTrailSl = pinnedRecord?.trailingStopLoss ?? signal.trailingStop ?? signal.stopLoss;
  const resolved = pinnedRecord ? isPinnedSignalResolved(pinnedRecord.status) : false;
  const effectiveLeverage = futuresTradingEnabled
    ? signal.recommendedLeverage ?? 5
    : 1;
  const wideAtrMult = signal.trailingAtrMultiplier ?? (signal.isTopGainer ? 2.05 : 1.25);

  const handleBuyExecutionRedirect = () => {
    setSelectedSymbol(signal.symbol);
    setExecutionRouteDraft({
      symbol: signal.symbol,
      direction: 'BUY',
      market: futuresTradingEnabled ? 'USD_M_FUTURES' : 'SPOT',
      moduleId: futuresTradingEnabled ? 'FUTURES_COORDINATOR' : 'SPOT_MOMENTUM',
      leverage: effectiveLeverage,
      notionalUsd: 1500,
      stopLoss: signal.stopLoss,
      trailingStopLoss: activeTrailSl,
      trailingAtrMultiplier: wideAtrMult,
      takeProfits: signal.takeProfits,
      prePumpScore: signal.prePumpScore,
      sourceLabel: signal.isTopGainer
        ? `Top Gainer #${signal.gainerRank ?? rank}`
        : 'AI Coordinator Signal',
      requestedAt: Date.now(),
    });

    const scrollToHub = () => {
      const target =
        document.getElementById('forge-execution-hub') ??
        document.getElementById('execution-ledger');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    if (location.pathname !== '/') {
      navigate('/#forge-execution-hub');
      window.setTimeout(scrollToHub, 180);
    } else {
      window.history.replaceState(null, '', '#forge-execution-hub');
      scrollToHub();
    }
  };

  const pinnedStatusLabel = pinnedRecord
    ? pinnedRecord.status === 'TP3_WIN'
      ? `TP3 WIN (+${pinnedRecord.realizedR ?? pinnedRecord.unrealizedR}R)`
      : pinnedRecord.status === 'SL_STOPPED'
      ? `ATR SL HIT (${pinnedRecord.realizedR ?? pinnedRecord.unrealizedR}R)`
      : pinnedRecord.status === 'TP2_HIT'
      ? `PINNED · TP2 HIT (${pinnedRecord.unrealizedR >= 0 ? '+' : ''}${pinnedRecord.unrealizedR}R)`
      : pinnedRecord.status === 'TP1_HIT'
      ? `PINNED · TP1 HIT (${pinnedRecord.unrealizedR >= 0 ? '+' : ''}${pinnedRecord.unrealizedR}R)`
      : `PINNED · ACTIVE (${pinnedRecord.unrealizedR >= 0 ? '+' : ''}${pinnedRecord.unrealizedR}R)`
    : null;

  return (
    <article
      data-testid={`signal-card-${signal.symbol}`}
      className={`flex flex-col justify-between rounded-xl border bg-[#111827] p-4 transition-colors ${
        resolved
          ? 'border-emerald-500/40'
          : pinnedRecord
          ? 'border-[#3b82f6]/45 hover:border-[#3b82f6]/75'
          : 'border-slate-800/90 hover:border-slate-700'
      }`}
      aria-label={`${signal.symbol} ${signal.direction} signal`}
    >
      <div>
        {/* Card Header: Coin + Execution Context + Direction */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-400">
              <span>#{rank}</span>
              {signal.isTopGainer && signal.gainerRank && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-emerald-400">
                    Top Gainer #{signal.gainerRank}
                    {typeof signal.change24hPercent === 'number'
                      ? ` (+${signal.change24hPercent.toFixed(1)}%)`
                      : ''}
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="truncate">{signal.indicators?.pattern || 'AI Setup'}</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSymbol(signal.symbol)}
              className="mt-0.5 font-display text-base font-bold text-white hover:text-[#3b82f6] transition-colors text-left cursor-pointer truncate block max-w-full"
            >
              {signal.coinName}{' '}
              <span className="font-mono text-xs font-medium text-slate-400">
                ({signal.symbol})
              </span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${
                isBuy
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {isBuy ? (
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
              )}
              {signal.direction}
            </span>
          </div>
        </div>

        {/* Confidence Score Bar & Pre-Pump / Dynamic Leverage Telemetry */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">AI Confidence</span>
            <span className="font-mono font-bold tabular-nums text-white">
              {signal.confidence}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full ${
                signal.confidence >= 85
                  ? 'bg-[#3b82f6]'
                  : isBuy
                  ? 'bg-emerald-500'
                  : 'bg-rose-500'
              }`}
              style={{ width: `${signal.confidence}%` }}
            />
          </div>

          {(typeof signal.prePumpScore === 'number' || typeof signal.volumeAnomalyRatio === 'number') && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono tabular-nums text-slate-300">
              <span>
                Pre-Pump{' '}
                <strong className="text-amber-300">{signal.prePumpScore ?? 65}</strong>
                {typeof signal.volumeAnomalyRatio === 'number'
                  ? ` · Vol ${signal.volumeAnomalyRatio.toFixed(1)}x`
                  : ''}
              </span>
              <span className="text-blue-300">
                {effectiveLeverage}x Dyn · {wideAtrMult.toFixed(2)}x ATR
              </span>
            </div>
          )}

          {pinnedStatusLabel && (
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
              <span
                className={`inline-flex items-center gap-1 font-semibold truncate ${
                  pinnedRecord?.status === 'TP3_WIN'
                    ? 'text-emerald-400'
                    : pinnedRecord?.status === 'SL_STOPPED'
                    ? 'text-rose-400'
                    : 'text-blue-300'
                }`}
              >
                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{pinnedStatusLabel}</span>
              </span>
              {pinnedRecord && (
                <span className="text-slate-400 shrink-0">
                  ${formatCryptoPrice(pinnedRecord.currentPrice)}
                </span>
              )}
            </div>
          )}

          {signal.smc && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-400">
              <span className="text-amber-300 font-medium">
                {signal.smc.structure.bias} {signal.smc.structure.lastEvent}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                POC ${formatCryptoPrice(signal.smc.volumeProfile.poc)}
              </span>
            </div>
          )}
        </div>

        {/* Entry, Mandated Wider ATR Trailing Stop Loss, and 3 Take Profits */}
        <div className="mt-3 grid grid-cols-2 gap-2.5 border-y border-slate-800/80 py-3 text-xs">
          <div>
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <span>Entry Price</span>
              {signal.entryPriceSource === 'LIVE_WS_FEED' && (
                <span className="font-mono text-[10px] font-semibold text-emerald-400">
                  WS
                </span>
              )}
            </span>
            <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-white">
              ${formatCryptoPrice(signal.entryPrice)}
            </span>
          </div>
          <div>
            <span className="block text-[11px] text-slate-400">
              Wide ATR SL ({wideAtrMult.toFixed(2)}x)
            </span>
            <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-amber-300">
              ${formatCryptoPrice(activeTrailSl)}
            </span>
            <span className="block font-mono text-[10px] tabular-nums text-rose-400">
              Init ${formatCryptoPrice(signal.stopLoss)}
            </span>
          </div>
          <div className="col-span-2 grid grid-cols-3 gap-1.5 pt-0.5">
            {signal.takeProfits.map((tp, idx) => {
              const reached = (pinnedRecord?.highestTpHit ?? 0) >= idx + 1;
              return (
                <div
                  key={idx}
                  className={`rounded-md px-2 py-1 ${
                    reached ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-[#0d1323]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{reached ? `TP${idx + 1} HIT` : `TP${idx + 1}`}</span>
                    {signal.dynamicRRs?.[idx] && (
                      <span className="font-mono text-[9px] text-slate-500">
                        {signal.dynamicRRs[idx]}R
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] font-semibold tabular-nums text-emerald-400">
                    ${formatCryptoPrice(tp)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Execution Summary */}
        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-300 line-clamp-2">
          {signal.reason}
        </p>
      </div>

      {/* Actions: Primary Functional BUY + Risk Calc + Watchlist Star */}
      <div className="mt-4 flex items-center gap-2 pt-1">
        <button
          type="button"
          data-testid={`signal-buy-${signal.symbol}`}
          onClick={handleBuyExecutionRedirect}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap"
        >
          <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>BUY</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenRiskCalc(signal)}
          aria-label={`Open risk calculator for ${signal.symbol}`}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-semibold text-white hover:border-[#3b82f6] transition-colors cursor-pointer whitespace-nowrap"
        >
          <Calculator className="h-3.5 w-3.5 text-[#3b82f6] shrink-0" aria-hidden="true" />
          <span>Risk Calc</span>
        </button>

        <button
          type="button"
          onClick={() => toggleWatchlist(signal.symbol)}
          aria-label={isWatched ? `Remove ${signal.symbol} from watchlist` : `Save ${signal.symbol} to watchlist`}
          className={`inline-flex items-center justify-center rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
            isWatched
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-400'
              : 'border-slate-700 bg-[#0d1323] text-slate-300 hover:text-white'
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${isWatched ? 'fill-amber-400' : ''}`} />
        </button>
      </div>
    </article>
  );
}
