import { memo, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, PieChart as PieChartIcon } from 'lucide-react';
import {
  PORTFOLIO_COLORS,
  safeFiniteNumber,
  type PortfolioEvaluationResult,
} from '../../lib/portfolioManager';

import { ErrorBoundary } from '../ErrorBoundary';

const ALLOC_BAR_MARGIN = { top: 10, right: 12, left: -12, bottom: 4 } as const;
const ALLOC_BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const ALLOC_AXIS_TICK = { fill: '#94a3b8', fontSize: 11 } as const;
const ALLOC_AXIS_LINE = { stroke: '#334155' } as const;
const ALLOC_TOOLTIP_CURSOR = { fill: 'rgba(59, 130, 246, 0.08)' } as const;
const ALLOC_TOOLTIP_STYLE = {
  backgroundColor: '#0d1323',
  borderColor: '#334155',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#f8fafc',
} as const;

function formatAllocWeightTooltip(value: unknown, name?: string | number): [string, string] {
  const num = safeFiniteNumber(value, 0);
  return [
    `${num.toFixed(2)}%`,
    name === 'currentWeight' ? 'Actual Weight' : 'Target Parity Weight',
  ];
}

function formatAllocDonutTooltip(
  value: unknown,
  name?: string | number,
  item?: { payload?: { notionalUsd?: number } }
): [string, string] {
  const pct = safeFiniteNumber(value, 0);
  const usd = safeFiniteNumber(item?.payload?.notionalUsd, 0);
  return [
    `${pct.toFixed(1)}% ($${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })})`,
    String(name ?? ''),
  ];
}

interface AssetAllocationChartsProps {
  evaluation: PortfolioEvaluationResult | null | undefined;
}

type ChartMode = 'WEIGHTS' | 'DONUT';

export const AssetAllocationCharts = memo(function AssetAllocationCharts({
  evaluation,
}: AssetAllocationChartsProps) {
  const [chartMode, setChartMode] = useState<ChartMode>('WEIGHTS');

  const dataSignature = useMemo(() => {
    if (!evaluation || !Array.isArray(evaluation.assets) || evaluation.assets.length === 0) {
      return '';
    }
    const meter = evaluation.exposureMeter;
    const assetSig = evaluation.assets
      .map(
        (a) =>
          `${a.baseAsset}:${safeFiniteNumber(a.currentWeightPct, 0).toFixed(2)}:${safeFiniteNumber(
            a.targetWeightPct,
            0
          ).toFixed(2)}:${Math.round(safeFiniteNumber(a.notionalUsd, 0))}`
      )
      .join('|');
    return `${assetSig}||USDT:${safeFiniteNumber(meter.stablecoinReservePct, 0).toFixed(2)}:${safeFiniteNumber(
      evaluation.config.minStablecoinReservePct,
      15
    ).toFixed(2)}:${Math.round(safeFiniteNumber(meter.stablecoinReserveUsd, 0))}`;
  }, [evaluation]);

  const barData = useMemo(() => {
    if (!evaluation || !Array.isArray(evaluation.assets) || evaluation.assets.length === 0) {
      return [];
    }
    const assets = evaluation.assets;
    const meter = evaluation.exposureMeter;
    return [
      ...assets.map((a) => ({
        name: a.baseAsset,
        currentWeight: Number(safeFiniteNumber(a.currentWeightPct, 0).toFixed(2)),
        targetWeight: Number(safeFiniteNumber(a.targetWeightPct, 0).toFixed(2)),
        notionalUsd: safeFiniteNumber(a.notionalUsd, 0),
        driftPct: safeFiniteNumber(a.driftPct, 0),
        color: a.color || '#3b82f6',
      })),
      {
        name: 'USDT',
        currentWeight: Number(safeFiniteNumber(meter.stablecoinReservePct, 0).toFixed(2)),
        targetWeight: Number(
          safeFiniteNumber(evaluation.config.minStablecoinReservePct, 15).toFixed(2)
        ),
        notionalUsd: safeFiniteNumber(meter.stablecoinReserveUsd, 0),
        driftPct: Number(
          (
            safeFiniteNumber(meter.stablecoinReservePct, 0) -
            safeFiniteNumber(evaluation.config.minStablecoinReservePct, 15)
          ).toFixed(2)
        ),
        color: PORTFOLIO_COLORS.USDT,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSignature]);

  const donutData = useMemo(
    () =>
      barData
        .filter((d) => d.currentWeight > 0)
        .map((d) => ({
          name: d.name,
          value: d.currentWeight,
          notionalUsd: d.notionalUsd,
          color: d.color,
        })),
    [barData]
  );

  if (!evaluation || barData.length === 0) {
    return (
      <section className="rounded-xl border border-slate-800/80 bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <BarChart3 className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
          <span>Waiting for live multi-asset ticker valuations...</span>
        </div>
      </section>
    );
  }

  const meter = evaluation.exposureMeter;

  return (
    <section
      aria-label="Interactive Asset Allocation Charts"
      className="flex flex-col rounded-xl border border-slate-800/80 bg-[#111827] overflow-hidden min-w-0"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-3.5">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-400">
            {evaluation.config.volatilityWeightingEnabled
              ? 'Dynamic Inverse-Volatility Target vs Actual Weight'
              : 'Custom Manual Target Weight vs Actual Weight'}
          </div>
          <h3 className="font-display text-base font-bold text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#3b82f6] shrink-0" aria-hidden="true" />
            <span>Interactive Asset Allocation</span>
          </h3>
        </div>

        <div className="inline-flex rounded-lg border border-slate-800 bg-[#0a0e1a] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setChartMode('WEIGHTS')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors cursor-pointer ${
              chartMode === 'WEIGHTS'
                ? 'bg-[#3b82f6] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Current vs Target</span>
          </button>
          <button
            type="button"
            onClick={() => setChartMode('DONUT')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors cursor-pointer ${
              chartMode === 'DONUT'
                ? 'bg-[#3b82f6] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <PieChartIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Composition</span>
          </button>
        </div>
      </div>

      <div className="p-5 flex-1 flex flex-col justify-between gap-4 min-w-0">
        {/* Responsive Recharts Canvas (Fixed Height + Module-Level Stable Props) */}
        <ErrorBoundary title="Asset Allocation Chart Recovery">
          <div className="h-[270px] w-full min-w-0">
            {chartMode === 'WEIGHTS' ? (
              <ResponsiveContainer width="100%" height={270} minWidth={0} debounce={50}>
                <BarChart data={barData} margin={ALLOC_BAR_MARGIN}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={ALLOC_AXIS_TICK}
                    axisLine={ALLOC_AXIS_LINE}
                    tickLine={false}
                  />
                  <YAxis
                    tick={ALLOC_AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    unit="%"
                  />
                  <Tooltip
                    cursor={ALLOC_TOOLTIP_CURSOR}
                    contentStyle={ALLOC_TOOLTIP_STYLE}
                    formatter={formatAllocWeightTooltip}
                  />
                  <Bar
                    dataKey="currentWeight"
                    name="currentWeight"
                    fill="#3b82f6"
                    radius={ALLOC_BAR_RADIUS}
                    barSize={18}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="targetWeight"
                    name="targetWeight"
                    fill="#10b981"
                    radius={ALLOC_BAR_RADIUS}
                    barSize={18}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={270} minWidth={0} debounce={50}>
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={98}
                    paddingAngle={2}
                    stroke="#0a0e1a"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {donutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={ALLOC_TOOLTIP_STYLE}
                    formatter={formatAllocDonutTooltip}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ErrorBoundary>

        {/* Clean Legend & Notional Table */}
        <div className="border-t border-slate-800/80 pt-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#3b82f6]" />
                <span>Actual %</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" />
                <span>Target Parity %</span>
              </span>
            </div>
            <span className="font-mono tabular-nums text-slate-300">
              Equity: ${safeFiniteNumber(meter.totalEquityUsd, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
            {barData.map((row) => (
              <div
                key={row.name}
                className="flex items-center justify-between gap-2 py-0.5 border-b border-slate-800/50"
              >
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: row.color }}
                  />
                  <span>{row.name}</span>
                </span>
                <span className="font-mono tabular-nums text-slate-300">
                  {row.currentWeight.toFixed(1)}%
                  <span className="text-slate-500"> · ${Math.round(row.notionalUsd).toLocaleString()}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
});
