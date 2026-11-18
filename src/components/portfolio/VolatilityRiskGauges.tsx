import { Activity, ShieldAlert } from 'lucide-react';
import {
  safeFiniteNumber,
  type PortfolioEvaluationResult,
  type VolatilityRiskRegime,
} from '../../lib/portfolioManager';

interface VolatilityRiskGaugesProps {
  evaluation: PortfolioEvaluationResult | null | undefined;
}

function getVolRegimeStyles(regime: VolatilityRiskRegime) {
  switch (regime) {
    case 'EXTREME':
      return {
        label: 'EXTREME VOL',
        textClass: 'text-rose-400',
        strokeColor: '#f43f5e',
        badgeClass: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
      };
    case 'ELEVATED':
      return {
        label: 'ELEVATED VOL',
        textClass: 'text-amber-400',
        strokeColor: '#f59e0b',
        badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      };
    case 'MODERATE':
      return {
        label: 'MODERATE VOL',
        textClass: 'text-sky-400',
        strokeColor: '#3b82f6',
        badgeClass: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
      };
    default:
      return {
        label: 'CALM VOL',
        textClass: 'text-emerald-400',
        strokeColor: '#10b981',
        badgeClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      };
  }
}

export function VolatilityRiskGauges({ evaluation }: VolatilityRiskGaugesProps) {
  if (!evaluation || !evaluation.volatilityRisk) {
    return (
      <section className="rounded-xl border border-slate-800/80 bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Activity className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
          <span>Computing real-time volatility risk gauges...</span>
        </div>
      </section>
    );
  }

  const vol = evaluation.volatilityRisk;
  const assets = Array.isArray(evaluation.assets) ? evaluation.assets : [];
  const style = getVolRegimeStyles(vol.riskRegime);
  const riskScore = Math.min(100, Math.max(0, safeFiniteNumber(vol.riskScore, 0)));

  // Semicircular SVG arc geometry (radius = 68, center = 90,82)
  const radius = 68;
  const circumference = Math.PI * radius;
  const dashOffset = circumference * (1 - riskScore / 100);
  const needleAngleDeg = -90 + (riskScore / 100) * 180;

  return (
    <section
      aria-label="Real-Time Volatility Risk Gauges"
      className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#111827] overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-3.5">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-400">
            ATR(14) + Log-Return Variance · Inverse-Vol Parity Calibration
          </div>
          <h3 className="font-display text-base font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#3b82f6] shrink-0" aria-hidden="true" />
            <span>Volatility Risk Gauges</span>
          </h3>
        </div>

        <div
          data-testid="volatility-regime-status"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold tracking-wide ${style.badgeClass}`}
        >
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{style.label}</span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Semicircle Gauge + Summary Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
          {/* Semicircular Portfolio Risk Gauge */}
          <div className="sm:col-span-5 flex flex-col items-center justify-center">
            <svg
              viewBox="0 0 180 104"
              className="w-full max-w-[200px] overflow-visible"
              role="img"
              aria-label={`Portfolio volatility risk score ${riskScore} out of 100 (${style.label})`}
            >
              {/* Background Track */}
              <path
                d="M 22 82 A 68 68 0 0 1 158 82"
                fill="none"
                stroke="#1e293b"
                strokeWidth="12"
                strokeLinecap="round"
              />
              {/* Active Risk Arc */}
              <path
                d="M 22 82 A 68 68 0 0 1 158 82"
                fill="none"
                stroke={style.strokeColor}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="transition-all duration-500"
              />
              {/* Needle */}
              <g transform={`translate(90, 82) rotate(${needleAngleDeg})`}>
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="-54"
                  stroke="#f8fafc"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <circle cx="0" cy="0" r="4.5" fill="#f8fafc" />
              </g>
              {/* Numeric Score */}
              <text
                x="90"
                y="68"
                textAnchor="middle"
                className="fill-white font-display text-[22px] font-bold"
              >
                {riskScore}
              </text>
              <text
                x="90"
                y="98"
                textAnchor="middle"
                className="fill-slate-400 text-[10px] font-medium"
              >
                RISK SCORE / 100
              </text>
            </svg>
          </div>

          {/* Real-Time Volatility KPIs */}
          <div className="sm:col-span-7 grid grid-cols-2 gap-3 text-xs">
            <div className="border-b border-slate-800/70 pb-2.5">
              <div className="text-slate-400">Annualized Vol</div>
              <div className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${style.textClass}`}>
                {safeFiniteNumber(vol.portfolioAnnualizedVolPct, 0).toFixed(1)}%
              </div>
            </div>

            <div className="border-b border-slate-800/70 pb-2.5">
              <div className="text-slate-400">Weighted ATR (14)</div>
              <div className="mt-0.5 font-mono text-lg font-bold text-slate-100 tabular-nums">
                {safeFiniteNumber(vol.portfolioAtrPct, 0).toFixed(2)}%
              </div>
            </div>

            <div>
              <div className="text-slate-400">Daily 95% VaR</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-rose-300 tabular-nums">
                -${safeFiniteNumber(vol.var95DailyUsd, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="ml-1 text-[11px] font-normal text-slate-400">
                  ({safeFiniteNumber(vol.var95DailyPct, 0).toFixed(2)}%)
                </span>
              </div>
            </div>

            <div>
              <div className="text-slate-400">Diversification Ratio</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300 tabular-nums">
                {safeFiniteNumber(vol.diversificationRatio, 1).toFixed(2)}x
              </div>
            </div>
          </div>
        </div>

        {/* Per-Asset Volatility Gauges */}
        {assets.length > 0 && (
          <div className="pt-3 border-t border-slate-800/80">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium text-slate-300">Asset Realized Volatility &amp; Parity Target</span>
              <span>Lower Vol = Larger Parity Share</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
              {assets.map((asset) => {
                const aStyle = getVolRegimeStyles(asset.volRegime);
                const barPct = Math.min(100, Math.max(6, (asset.annualizedVolatilityPct / 150) * 100));
                return (
                  <div key={asset.symbol} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        {asset.baseAsset}
                        <span className="ml-1.5 font-normal text-slate-400 tabular-nums">
                          ATR {asset.atrPercent.toFixed(2)}%
                        </span>
                      </span>
                      <span className={`font-mono tabular-nums font-medium ${aStyle.textClass}`}>
                        {asset.annualizedVolatilityPct.toFixed(1)}% · {asset.volRegime}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${barPct}%`,
                          backgroundColor: aStyle.strokeColor,
                        }}
                      />
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
