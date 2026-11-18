import { ArrowDownRight, ArrowUpRight, Bot, Calculator, Clock, Layers } from 'lucide-react';
import { formatCompactUsd, formatCryptoPrice, type Timeframe } from '../lib/marketData';
import { type TradingSignal } from '../lib/signals';
import { type SmcAgentAnalysis } from '../lib/smcAgent';

interface SmcVolumeProfilePanelProps {
  analysis: SmcAgentAnalysis | null;
  timeframe: Timeframe;
  livePrice?: number;
  onOpenRiskCalc: (signal: TradingSignal) => void;
  onSendToCoordinator?: (analysis: SmcAgentAnalysis) => void;
}

export function SmcVolumeProfilePanel({
  analysis,
  timeframe,
  livePrice,
  onOpenRiskCalc,
  onSendToCoordinator,
}: SmcVolumeProfilePanelProps) {
  if (!analysis) {
    return (
      <section
        aria-label="SMC and Volume Profile AI Agent"
        className="rounded-xl border border-slate-800/90 bg-[#111827] p-6 text-xs text-slate-400"
      >
        Initializing Smart Money Concepts &amp; Fixed Range Volume Profile analysis...
      </section>
    );
  }

  const isBuy = analysis.direction === 'BUY';
  const spot = livePrice && Number.isFinite(livePrice) ? livePrice : analysis.entryPrice;

  const executionGateLabel =
    analysis.executionStatus === 'EXECUTE'
      ? `EXECUTE · ${analysis.sessionStatus.session}`
      : analysis.executionStatus === 'WAIT_SESSION'
      ? `HOLD · Outside London/NY (${analysis.sessionStatus.utcTimeLabel})`
      : analysis.executionStatus === 'WAIT_SWEEP'
      ? `WAIT · Confirm ${isBuy ? 'Sweep Below Lows' : 'Sweep Above Highs'}`
      : `WAIT · Retest ${analysis.zoneLabel}`;

  const executionGateStyle =
    analysis.executionAllowed
      ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
      : 'text-amber-300 border-amber-500/30 bg-amber-500/10';

  const handleOpenCalculator = () => {
    const synthesizedSignal: TradingSignal = {
      id: `smc_${analysis.symbol}_${analysis.direction}`,
      symbol: analysis.symbol,
      baseAsset: analysis.symbol.replace(/USDT$/i, ''),
      coinName: analysis.coinName,
      direction: analysis.direction,
      entryPrice: analysis.entryPrice,
      stopLoss: analysis.stopLoss,
      takeProfits: analysis.takeProfits,
      confidence: analysis.confidence,
      technicalScore: analysis.score,
      fundamentalScore: 0,
      smcScore: analysis.score,
      indicators: {
        rsi: 50,
        ema9: analysis.entryPrice,
        ema21: analysis.entryPrice,
        ema50: analysis.volumeProfile.poc,
        macdLine: 0,
        macdSignal: 0,
        macdHistogram: 0,
        bbUpper: analysis.volumeProfile.vah,
        bbMiddle: analysis.volumeProfile.poc,
        bbLower: analysis.volumeProfile.val,
        bbPercentB: 0.5,
        pattern: analysis.retestStatus,
        score: analysis.score,
        summary: analysis.structure.summary,
      },
      fundamental: {
        score: 0,
        articleCount: 0,
        bullishCount: 0,
        bearishCount: 0,
        topHeadline: analysis.liquiditySweep.summary,
        summary: analysis.liquiditySweep.summary,
      },
      smc: analysis,
      reason: analysis.rationale,
      generatedAt: new Date().toISOString(),
    };
    onOpenRiskCalc(synthesizedSignal);
  };

  return (
    <section
      aria-label="SMC and Volume Profile AI Agent"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
            <span>Smart Money Concepts Agent</span>
            <span aria-hidden="true">·</span>
            <span>Fixed Range Volume Profile ({timeframe})</span>
            <span aria-hidden="true">·</span>
            <span>{analysis.zoneLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-300">
              ~{analysis.monthlyTradeTarget} trades/mo
            </span>
          </div>
          <h2 className="mt-0.5 font-display text-lg font-bold text-white flex items-center gap-2">
            <Layers className="h-5 w-5 text-amber-400 shrink-0" aria-hidden="true" />
            <span>
              {analysis.coinName} ({analysis.symbol}) — Structural Retest &amp; Order Flow
            </span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-bold tracking-wide ${
                isBuy
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {isBuy ? (
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {isBuy ? 'LONG' : 'SHORT'} ({analysis.direction})
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-semibold ${executionGateStyle}`}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{executionGateLabel}</span>
            </span>
            <span className="font-mono font-bold tabular-nums text-white">
              {analysis.confidence}% Confidence
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono tabular-nums text-slate-300">
              1:{analysis.riskRewardRatio} R:R
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onSendToCoordinator && (
              <button
                type="button"
                onClick={() => onSendToCoordinator(analysis)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <Bot className="h-3.5 w-3.5 text-[#3b82f6] shrink-0" aria-hidden="true" />
                <span>Send to Coordinator</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenCalculator}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Calculator className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Size SMC Setup</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2-Column Diagnostic Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80">
        {/* Left Column: SMC Structure, Sweeps, Session Filter, Supply/Accumulation Zones & Targets */}
        <div className="lg:col-span-7 p-5 divide-y divide-slate-800/70">
          {/* 1. Market Structure, Liquidity Sweep & London/NY Killzone Gate */}
          <div className="pb-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <span className="text-xs text-slate-400">Market Structure (BOS / CHoCH)</span>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <span
                  className={
                    analysis.structure.bias === 'Bullish'
                      ? 'text-emerald-400'
                      : analysis.structure.bias === 'Bearish'
                      ? 'text-rose-400'
                      : 'text-slate-200'
                  }
                >
                  {analysis.structure.bias} · {analysis.structure.lastEvent}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{analysis.structure.summary}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                <span>Prev High: ${formatCryptoPrice(analysis.structure.lastSwingHigh)}</span>
                <span>Prev Low: ${formatCryptoPrice(analysis.structure.lastSwingLow)}</span>
              </div>
            </div>

            <div>
              <span className="text-xs text-slate-400">Liquidity Sweep Trigger</span>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <span
                  className={
                    analysis.sweepConfirmed
                      ? isBuy
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                      : 'text-amber-300'
                  }
                >
                  {analysis.sweepConfirmed
                    ? `${analysis.liquiditySweep.type} Confirmed`
                    : analysis.liquiditySweep.detected
                    ? `${analysis.liquiditySweep.type} (Counter-bias)`
                    : isBuy
                    ? 'Awaiting Sweep Below Lows'
                    : 'Awaiting Sweep Above Highs'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{analysis.liquiditySweep.summary}</p>
              {analysis.liquiditySweep.detected && (
                <div className="mt-1.5 font-mono text-[11px] tabular-nums text-slate-400">
                  Swept Level: ${formatCryptoPrice(analysis.liquiditySweep.sweptPrice)}
                </div>
              )}
            </div>

            <div>
              <span className="text-xs text-slate-400">Session Execution Filter</span>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <span
                  className={
                    analysis.sessionStatus.isOptimalWindow ? 'text-emerald-400' : 'text-amber-300'
                  }
                >
                  {analysis.sessionStatus.session}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{analysis.sessionStatus.summary}</p>
              <div className="mt-1.5 font-mono text-[11px] tabular-nums text-slate-400">
                London 07–16 · NY 12–21 UTC
              </div>
            </div>
          </div>

          {/* 2. Supply & Accumulation Zones (Order Blocks + FRVP HVN/LVN Confirmation) */}
          <div className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <h3 className="text-xs font-semibold text-white">
                Supply &amp; Accumulation Zones (Order Blocks · FRVP HVN Liquidity)
              </h3>
              <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                <span className="text-emerald-400">
                  HVN Confirmed ({analysis.hvnConfirmedCount})
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="text-amber-300">
                  LVN Guarded ({analysis.lvnAvoidedCount})
                </span>
              </div>
            </div>

            {analysis.allOrderBlocks.length === 0 ? (
              <p className="text-xs text-slate-400">
                Monitoring displacement candles for HVN-confirmed Supply or Accumulation Zone formation.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-slate-400">
                      <th className="pb-2 font-medium">Zone Role</th>
                      <th className="pb-2 font-medium">Range (Low – High)</th>
                      <th className="pb-2 font-medium">FRVP Liquidity</th>
                      <th className="pb-2 font-medium text-right">Distance</th>
                      <th className="pb-2 font-medium text-right">Retest State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {analysis.allOrderBlocks.slice(0, 4).map((ob, idx) => (
                      <tr key={`${ob.type}_${ob.time}_${idx}`}>
                        <td
                          className={`py-2 pr-3 font-semibold whitespace-nowrap ${
                            ob.type === 'Bullish OB' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {ob.zoneRole}
                        </td>
                        <td className="py-2 pr-3 font-mono tabular-nums text-slate-200 whitespace-nowrap">
                          ${formatCryptoPrice(ob.low)} – ${formatCryptoPrice(ob.high)}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span
                            className={`text-[11px] font-semibold ${
                              ob.volumeProfileAlignment === 'HVN_CONFIRMED'
                                ? 'text-emerald-400'
                                : ob.volumeProfileAlignment === 'LVN_VOID'
                                ? 'text-rose-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {ob.volumeProfileAlignment === 'HVN_CONFIRMED'
                              ? 'HVN Confirmed'
                              : ob.volumeProfileAlignment === 'LVN_VOID'
                              ? 'LVN Sweep Risk'
                              : 'Balanced Node'}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {ob.distancePercent.toFixed(2)}%
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <span
                            className={
                              ob.retesting
                                ? 'font-semibold text-amber-300'
                                : ob.mitigated
                                ? 'text-slate-400'
                                : 'text-[#3b82f6]'
                            }
                          >
                            {ob.retesting
                              ? 'Retesting Now'
                              : ob.mitigated
                              ? 'Tested'
                              : 'Unmitigated'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3. Zone Entry, Stop Loss & Previous High/Low Targets */}
          <div className="pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-semibold text-white">
                {isBuy
                  ? 'Long Plan: Accumulation Zone Entry · SL Below Zone · Target Previous High'
                  : 'Short Plan: Supply Zone Entry · SL Above Zone · Target Previous Low'}
              </h3>
              <span className="font-mono text-[11px] tabular-nums text-emerald-400">
                {isBuy ? 'Prev High Pool' : 'Prev Low Pool'}: $
                {formatCryptoPrice(analysis.targetLiquidityPool)}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono tabular-nums text-xs">
              <div>
                <span className="block font-sans text-[11px] text-slate-400">
                  {analysis.zoneLabel} Entry
                </span>
                <span className="mt-0.5 block text-sm font-semibold text-white">
                  ${formatCryptoPrice(analysis.entryPrice)}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[11px] text-slate-400">
                  SL ({isBuy ? 'Below Zone' : 'Above Zone'})
                </span>
                <span className="mt-0.5 block text-sm font-semibold text-rose-400">
                  ${formatCryptoPrice(analysis.stopLoss)}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[11px] text-slate-400">TP 1 (2.0R Scale)</span>
                <span className="mt-0.5 block text-sm font-semibold text-emerald-400">
                  ${formatCryptoPrice(analysis.takeProfits[0])}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[11px] text-slate-400">TP 2 (3.5R Scale)</span>
                <span className="mt-0.5 block text-sm font-semibold text-emerald-400">
                  ${formatCryptoPrice(analysis.takeProfits[1])}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[11px] text-slate-400">TP 3 (1:5 Target)</span>
                <span className="mt-0.5 block text-sm font-semibold text-emerald-400">
                  ${formatCryptoPrice(analysis.takeProfits[2])}
                </span>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-300">{analysis.rationale}</p>
          </div>
        </div>

        {/* Right Column: Fixed Range Volume Profile Histogram */}
        <div className="lg:col-span-5 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-white">
                Fixed Range Volume Profile (96 bars)
              </h3>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                Vol {formatCompactUsd(analysis.volumeProfile.totalVolume).replace('$', '')}{' '}
                {analysis.symbol.replace(/USDT$/i, '')}
              </span>
            </div>

            {/* Key FRVP Anchors */}
            <div className="grid grid-cols-4 gap-2 border-y border-slate-800/80 py-2.5 mb-3 text-xs">
              <div>
                <span className="block text-[11px] text-slate-400">VAH</span>
                <span className="font-mono font-semibold tabular-nums text-blue-300">
                  ${formatCryptoPrice(analysis.volumeProfile.vah)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-slate-400">POC</span>
                <span className="font-mono font-semibold tabular-nums text-amber-300">
                  ${formatCryptoPrice(analysis.volumeProfile.poc)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-slate-400">VAL</span>
                <span className="font-mono font-semibold tabular-nums text-blue-300">
                  ${formatCryptoPrice(analysis.volumeProfile.val)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-slate-400">Zone</span>
                <span
                  className={`font-semibold ${
                    analysis.volumeProfile.priceZone === 'Discount'
                      ? 'text-emerald-400'
                      : analysis.volumeProfile.priceZone === 'Premium'
                      ? 'text-rose-400'
                      : 'text-slate-200'
                  }`}
                >
                  {analysis.volumeProfile.priceZone}
                </span>
              </div>
            </div>

            {/* Horizontal Volume Profile Bins */}
            <div
              className="space-y-1"
              role="img"
              aria-label={`Fixed Range Volume Profile for ${analysis.symbol} with POC at $${formatCryptoPrice(analysis.volumeProfile.poc)}`}
            >
              {analysis.volumeProfile.bins.map((bin, idx) => {
                const isSpotBin = spot >= bin.priceLow && spot <= bin.priceHigh;
                return (
                  <div key={idx} className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
                    <span
                      className={`w-20 shrink-0 text-right ${
                        bin.isPoc
                          ? 'font-bold text-amber-300'
                          : isSpotBin
                          ? 'font-semibold text-white'
                          : 'text-slate-500'
                      }`}
                    >
                      ${formatCryptoPrice(bin.midPrice)}
                    </span>

                    <div className="relative flex-1 h-3 rounded-sm bg-slate-900/90 overflow-hidden">
                      <div
                        className={`h-full rounded-sm ${
                          bin.isPoc
                            ? 'bg-amber-400'
                            : bin.nodeType === 'HVN'
                            ? 'bg-emerald-500/80'
                            : bin.inValueArea
                            ? 'bg-[#3b82f6]/70'
                            : bin.nodeType === 'LVN'
                            ? 'bg-rose-500/35'
                            : 'bg-slate-600/60'
                        }`}
                        style={{ width: `${Math.max(4, Math.round(bin.ratio * 100))}%` }}
                      />
                    </div>

                    <span className="w-10 shrink-0 text-right text-[10px] font-sans">
                      {bin.isPoc ? (
                        <span className="font-bold text-amber-300">POC</span>
                      ) : isSpotBin ? (
                        <span className="font-semibold text-emerald-400">Spot</span>
                      ) : bin.nodeType === 'HVN' ? (
                        <span className="text-emerald-400 font-semibold">HVN</span>
                      ) : bin.nodeType === 'LVN' ? (
                        <span className="text-rose-400/80">LVN</span>
                      ) : bin.inValueArea ? (
                        <span className="text-blue-400/80">VA</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/70 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            <span className="text-amber-300">Amber: POC</span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-400">Green: HVN Liquidity</span>
            <span aria-hidden="true">·</span>
            <span className="text-rose-300">Red: LVN Void Avoided</span>
          </div>
        </div>
      </div>
    </section>
  );
}
