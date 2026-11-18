import { AlertTriangle, CheckCircle2, Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import {
  safeFiniteNumber,
  type ExposureRegime,
  type PortfolioEvaluationResult,
} from '../../lib/portfolioManager';

interface MultiAssetExposureMeterProps {
  evaluation: PortfolioEvaluationResult | null | undefined;
  compact?: boolean;
}

function getRegimePresentation(regime: ExposureRegime) {
  if (regime === 'OVER_EXPOSED') {
    return {
      badgeText: 'OVER-EXPOSED',
      headingColor: 'text-rose-400',
      barColor: 'bg-rose-500',
      borderTint: 'border-rose-500/35 bg-rose-500/10',
      Icon: AlertTriangle,
      guidance: 'Gross deployment exceeds target ceiling or reserve floor. Trim overweight legs into USDT.',
    };
  }
  if (regime === 'UNDER_EXPOSED') {
    return {
      badgeText: 'UNDER-EXPOSED',
      headingColor: 'text-amber-400',
      barColor: 'bg-amber-400',
      borderTint: 'border-amber-500/35 bg-amber-500/10',
      Icon: TrendingDown,
      guidance: 'Excess unallocated stablecoin cash detected. Deploy capital toward underweight risk-parity assets.',
    };
  }
  return {
    badgeText: 'BALANCED EXPOSURE',
    headingColor: 'text-emerald-400',
    barColor: 'bg-emerald-500',
    borderTint: 'border-emerald-500/35 bg-emerald-500/10',
    Icon: CheckCircle2,
    guidance: 'Portfolio gross exposure sits cleanly inside target risk-parity tolerance.',
  };
}

function formatUsd(val: number): string {
  const n = safeFiniteNumber(val, 0);
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MultiAssetExposureMeter({ evaluation, compact = false }: MultiAssetExposureMeterProps) {
  if (!evaluation || !evaluation.exposureMeter) {
    return (
      <section className="rounded-xl border border-slate-800/80 bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Gauge className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
          <span>Calibrating multi-asset exposure meter...</span>
        </div>
      </section>
    );
  }

  const meter = evaluation.exposureMeter;
  const assets = Array.isArray(evaluation.assets) ? evaluation.assets : [];
  const cfg = evaluation.config;
  const regimeInfo = getRegimePresentation(meter.regime);
  const RegimeIcon = regimeInfo.Icon;

  const grossPct = safeFiniteNumber(meter.grossExposurePct, 0);
  const targetPct = safeFiniteNumber(meter.targetDeploymentPct, 85);
  const maxPct = Math.max(100, safeFiniteNumber(cfg?.maxGrossExposurePct, 100));
  const scaleMax = Math.max(150, maxPct + 25);

  const markerLeftPct = Math.min(98, Math.max(2, (grossPct / scaleMax) * 100));
  const targetMarkerLeftPct = Math.min(96, Math.max(4, (targetPct / scaleMax) * 100));
  const underZoneWidthPct = Math.min(100, Math.max(5, ((Math.max(0, targetPct - 7.5)) / scaleMax) * 100));
  const balancedZoneWidthPct = Math.min(
    100 - underZoneWidthPct,
    Math.max(8, (15 / scaleMax) * 100)
  );

  return (
    <section
      aria-label="Multi-Asset Exposure Meter"
      className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#111827] overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-3.5">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-400">
            Spot Holdings + Open Margin · Reserve Floor {cfg.minStablecoinReservePct}%
          </div>
          <h3 className="font-display text-base font-bold text-white tracking-tight flex items-center gap-2">
            <Gauge className="h-4 w-4 text-[#3b82f6] shrink-0" aria-hidden="true" />
            <span>Multi-Asset Exposure Meter</span>
          </h3>
        </div>

        <div
          data-testid="exposure-regime-status"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold tracking-wide ${regimeInfo.borderTint} ${regimeInfo.headingColor}`}
        >
          <RegimeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{regimeInfo.badgeText}</span>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Primary Numeric Readout + Linear Segmented Meter */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2.5">
              <span className={`font-display text-3xl font-bold tabular-nums ${regimeInfo.headingColor}`}>
                {grossPct.toFixed(1)}%
              </span>
              <span className="text-xs text-slate-400">
                Gross Exposure vs <strong className="text-slate-200 tabular-nums">{targetPct.toFixed(0)}%</strong> Target
              </span>
            </div>
            <div className="text-xs text-slate-300 tabular-nums font-mono">
              Delta:{' '}
              <span
                className={
                  meter.exposureDeltaPct > 7.5
                    ? 'text-rose-400 font-semibold'
                    : meter.exposureDeltaPct < -7.5
                    ? 'text-amber-400 font-semibold'
                    : 'text-emerald-400 font-semibold'
                }
              >
                {meter.exposureDeltaPct >= 0 ? '+' : ''}
                {safeFiniteNumber(meter.exposureDeltaPct, 0).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* 3-Zone Segmented Exposure Scale (0% -> scaleMax%) */}
          <div className="relative pt-3 pb-1">
            <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-slate-900 border border-slate-800 flex">
              <div
                style={{ width: `${underZoneWidthPct}%` }}
                className="h-full bg-amber-500/35"
                title="Under-Exposed Zone"
              />
              <div
                style={{ width: `${balancedZoneWidthPct}%` }}
                className="h-full bg-emerald-500/45 border-x border-emerald-400/30"
                title="Balanced Target Band"
              />
              <div
                className="h-full flex-1 bg-rose-500/40"
                title="Over-Exposed / Leveraged Zone"
              />
            </div>

            {/* Target Marker */}
            <div
              style={{ left: `${targetMarkerLeftPct}%` }}
              className="absolute top-1.5 -translate-x-1/2 flex flex-col items-center pointer-events-none"
              aria-hidden="true"
            >
              <span className="h-6 w-0.5 bg-slate-300/70" />
            </div>

            {/* Live Gross Exposure Needle */}
            <div
              style={{ left: `${markerLeftPct}%` }}
              className="absolute top-0 -translate-x-1/2 flex flex-col items-center pointer-events-none transition-all duration-300"
            >
              <span className={`h-2 w-2 rotate-45 ${regimeInfo.barColor} border border-white/80`} />
              <span className="mt-0.5 h-5 w-0.5 bg-white shadow" />
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
            <span>Under-Exposed (&lt;{Math.max(0, targetPct - 7.5).toFixed(0)}%)</span>
            <span className="text-emerald-400 font-medium">Balanced (~{targetPct.toFixed(0)}%)</span>
            <span className="text-rose-400 font-medium">Over-Exposed (&gt;{maxPct}%)</span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">{regimeInfo.guidance}</p>
        </div>

        {/* Capital Deployment KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800/80 text-xs">
          <div>
            <div className="text-slate-400">Total Equity</div>
            <div className="mt-0.5 font-mono font-bold text-white tabular-nums">
              {formatUsd(meter.totalEquityUsd)}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Deployed Capital</div>
            <div className="mt-0.5 font-mono font-bold text-slate-100 tabular-nums">
              {formatUsd(meter.deployedExposureUsd)}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Stablecoin Reserve</div>
            <div className="mt-0.5 font-mono font-bold text-cyan-300 tabular-nums">
              {formatUsd(meter.stablecoinReserveUsd)} ({safeFiniteNumber(meter.stablecoinReservePct, 0).toFixed(1)}%)
            </div>
          </div>
          <div>
            <div className="text-slate-400">Max Asset Drift</div>
            <div
              className={`mt-0.5 font-mono font-bold tabular-nums ${
                meter.maxAbsDriftPct >= cfg.driftThresholdPct ? 'text-amber-300' : 'text-emerald-300'
              }`}
            >
              ±{safeFiniteNumber(meter.maxAbsDriftPct, 0).toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Per-Asset Exposure Drift Breakdown */}
        {!compact && assets.length > 0 && (
          <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium text-slate-300">Per-Asset Weight vs Target Parity</span>
              <span>
                Over: <strong className="text-rose-300">{meter.overExposedAssets.join(', ') || 'None'}</strong>
                <span className="mx-1.5 text-slate-600">·</span>
                Under: <strong className="text-amber-300">{meter.underExposedAssets.join(', ') || 'None'}</strong>
              </span>
            </div>

            <div className="space-y-2">
              {assets.map((asset) => {
                const statusIcon =
                  asset.exposureStatus === 'OVER_EXPOSED' ? (
                    <TrendingUp className="h-3 w-3 text-rose-400 shrink-0" aria-hidden="true" />
                  ) : asset.exposureStatus === 'UNDER_EXPOSED' ? (
                    <TrendingDown className="h-3 w-3 text-amber-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" aria-hidden="true" />
                  );

                const statusText =
                  asset.exposureStatus === 'OVER_EXPOSED'
                    ? 'Overweight'
                    : asset.exposureStatus === 'UNDER_EXPOSED'
                    ? 'Underweight'
                    : 'Balanced';

                const fillWidth = Math.min(100, Math.max(2, (asset.currentWeightPct / 50) * 100));
                const targetPos = Math.min(98, Math.max(2, (asset.targetWeightPct / 50) * 100));

                return (
                  <div key={asset.symbol} className="grid grid-cols-12 items-center gap-2 text-xs">
                    <div className="col-span-3 flex items-center gap-1.5 min-w-0">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: asset.color }}
                      />
                      <span className="font-semibold text-white truncate">{asset.baseAsset}</span>
                    </div>

                    <div className="col-span-5 relative h-2 rounded-full bg-slate-900 overflow-visible">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${fillWidth}%`,
                          backgroundColor: asset.color,
                        }}
                      />
                      <span
                        style={{ left: `${targetPos}%` }}
                        title={`Target ${asset.targetWeightPct.toFixed(1)}%`}
                        className="absolute -top-0.5 h-3 w-0.5 bg-white/90"
                      />
                    </div>

                    <div className="col-span-2 text-right font-mono tabular-nums text-slate-200">
                      {asset.currentWeightPct.toFixed(1)}%
                      <span className="text-slate-500">/{asset.targetWeightPct.toFixed(0)}%</span>
                    </div>

                    <div className="col-span-2 flex items-center justify-end gap-1 text-[11px]">
                      {statusIcon}
                      <span
                        className={
                          asset.exposureStatus === 'OVER_EXPOSED'
                            ? 'text-rose-300'
                            : asset.exposureStatus === 'UNDER_EXPOSED'
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                        }
                      >
                        {statusText}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
