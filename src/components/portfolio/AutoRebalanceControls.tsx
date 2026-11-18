import { useState } from 'react';
import {
  Clock,
  Download,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import {
  safeFiniteNumber,
  type PortfolioEvaluationResult,
  type PortfolioHoldingSeed,
  type PortfolioRebalanceConfig,
  type RebalanceExecutionRecord,
  type RebalanceTriggerMode,
} from '../../lib/portfolioManager';

interface AutoRebalanceControlsProps {
  evaluation: PortfolioEvaluationResult | null | undefined;
  holdings: PortfolioHoldingSeed[];
  stablecoinReserveUsd: number;
  config: PortfolioRebalanceConfig;
  history: RebalanceExecutionRecord[];
  onUpdateConfig: (patch: Partial<PortfolioRebalanceConfig>) => Promise<void> | void;
  onUpdateHoldingUnits: (symbol: string, units: number, reserveUsd?: number) => Promise<void> | void;
  onExecuteRebalanceNow: () => Promise<void> | void;
  onResetBaseline: () => Promise<void> | void;
  rebalancingBusy?: boolean;
}

const PERIODIC_OPTIONS = [
  { minutes: 15, label: '15m' },
  { minutes: 60, label: '1h' },
  { minutes: 240, label: '4h' },
  { minutes: 1440, label: '24h' },
];

const TRIGGER_MODES: Array<{ value: RebalanceTriggerMode; label: string }> = [
  { value: 'HYBRID', label: 'Hybrid (Threshold + Periodic)' },
  { value: 'THRESHOLD_ONLY', label: 'Threshold Drift Only' },
  { value: 'PERIODIC_ONLY', label: 'Periodic Schedule Only' },
];

export function AutoRebalanceControls({
  evaluation,
  holdings,
  stablecoinReserveUsd,
  config,
  history,
  onUpdateConfig,
  onUpdateHoldingUnits,
  onExecuteRebalanceNow,
  onResetBaseline,
  rebalancingBusy = false,
}: AutoRebalanceControlsProps) {
  const [showHoldingsEditor, setShowHoldingsEditor] = useState(false);

  const safeHoldings = Array.isArray(holdings) ? holdings : [];
  const safeHistory = Array.isArray(history) ? history : [];
  const trigger = evaluation?.rebalanceTrigger;
  const assets = evaluation?.assets ?? [];

  const handleExportCsv = () => {
    if (safeHistory.length === 0) return;
    const header = [
      'ID',
      'Timestamp',
      'Trigger',
      'TradesExecuted',
      'MovedNotionalUSD',
      'PreMaxDriftPct',
      'PostMaxDriftPct',
      'VolRiskScore',
    ].join(',');
    const rows = safeHistory.map((rec) =>
      [
        rec.id,
        rec.executedAt,
        rec.triggerReason,
        rec.tradesExecuted,
        rec.movedNotionalUsd.toFixed(2),
        rec.preMaxDriftPct.toFixed(2),
        rec.postMaxDriftPct.toFixed(2),
        rec.volRiskScoreAtExecution,
      ].join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-forge-rebalance-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label="Volatility-Based Auto-Rebalancing Controls"
      className="flex flex-col rounded-xl border border-slate-800/80 bg-[#111827] overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-3.5">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-400">
            Explicit Threshold &amp; Periodic Rules · Null-Safe Execution Ledger
          </div>
          <h3 className="font-display text-base font-bold text-white tracking-tight flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[#3b82f6] shrink-0" aria-hidden="true" />
            <span>Volatility Auto-Rebalancing Controls</span>
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onResetBaseline}
            disabled={rebalancingBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-500 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset Baseline</span>
          </button>

          <button
            type="button"
            data-testid="execute-rebalance-now"
            onClick={onExecuteRebalanceNow}
            disabled={rebalancingBusy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{rebalancingBusy ? 'Rebalancing...' : 'Execute Rebalance Now'}</span>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Trigger Readiness Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/90 bg-[#0d1323] px-4 py-3 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Zap
              className={`h-4 w-4 shrink-0 ${
                trigger?.shouldExecute ? 'text-amber-400' : 'text-emerald-400'
              }`}
              aria-hidden="true"
            />
            <span className="text-slate-200 font-medium truncate">
              {trigger?.summaryText || 'Monitoring portfolio drift and volatility triggers.'}
            </span>
          </div>
          <div className="flex items-center gap-3 text-slate-400 tabular-nums shrink-0">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              Next Periodic: <strong className="text-white">{trigger?.minutesUntilPeriodicDue ?? 0}m</strong>
            </span>
          </div>
        </div>

        {/* Toggle Switches + Threshold & Periodic Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {/* Switch 1: Auto-Rebalance Enabled */}
          <div className="space-y-2 border-b md:border-b-0 border-slate-800/70 pb-3 md:pb-0">
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="font-semibold text-slate-200">Auto-Rebalance Engine</span>
              <input
                type="checkbox"
                checked={config.autoRebalanceEnabled}
                onChange={(e) => onUpdateConfig({ autoRebalanceEnabled: e.target.checked })}
                className="h-4 w-4 accent-[#3b82f6] cursor-pointer"
              />
            </label>
            <p className="text-[11px] text-slate-400">
              Status:{' '}
              <strong className={config.autoRebalanceEnabled ? 'text-emerald-400' : 'text-amber-400'}>
                {config.autoRebalanceEnabled ? 'ARMED (Active)' : 'PAUSED (Manual)'}
              </strong>
            </p>
            <label className="flex items-center justify-between gap-2 pt-1 cursor-pointer">
              <span className="font-semibold text-slate-200">Volatility Parity Weights</span>
              <input
                type="checkbox"
                checked={config.volatilityWeightingEnabled}
                onChange={(e) =>
                  onUpdateConfig({ volatilityWeightingEnabled: e.target.checked })
                }
                className="h-4 w-4 accent-[#10b981] cursor-pointer"
              />
            </label>
          </div>

          {/* Control 2: Trigger Mode */}
          <div className="space-y-1.5">
            <label htmlFor="rebalance-trigger-mode" className="block font-semibold text-slate-200">
              Trigger Mode
            </label>
            <select
              id="rebalance-trigger-mode"
              value={config.triggerMode}
              onChange={(e) =>
                onUpdateConfig({ triggerMode: e.target.value as RebalanceTriggerMode })
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
            >
              {TRIGGER_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-slate-400">
              Combines threshold breach &amp; fixed timer.
            </div>
          </div>

          {/* Control 3: Drift Threshold (%) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="drift-threshold-range" className="font-semibold text-slate-200">
                Drift Threshold
              </label>
              <span className="font-mono font-bold text-[#3b82f6] tabular-nums">
                ±{safeFiniteNumber(config.driftThresholdPct, 3).toFixed(1)}%
              </span>
            </div>
            <input
              id="drift-threshold-range"
              type="range"
              min={0.5}
              max={15}
              step={0.5}
              value={config.driftThresholdPct}
              onChange={(e) =>
                onUpdateConfig({ driftThresholdPct: safeFiniteNumber(e.target.value, 3) })
              }
              className="w-full accent-[#3b82f6] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 tabular-nums">
              <span>0.5% (Tight)</span>
              <span>7.5%</span>
              <span>15.0% (Wide)</span>
            </div>
          </div>

          {/* Control 4: Periodic Cadence */}
          <div className="space-y-1.5">
            <div className="font-semibold text-slate-200">Periodic Cadence</div>
            <div className="grid grid-cols-4 gap-1.5">
              {PERIODIC_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  onClick={() => onUpdateConfig({ periodicIntervalMinutes: opt.minutes })}
                  className={`rounded-md border py-1.5 text-xs font-mono font-semibold transition-colors cursor-pointer ${
                    config.periodicIntervalMinutes === opt.minutes
                      ? 'border-[#3b82f6] bg-[#3b82f6]/20 text-white'
                      : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
              <span>Max Gross Cap:</span>
              <span className="font-mono text-slate-200 tabular-nums">{config.maxGrossExposurePct}%</span>
            </div>
          </div>
        </div>

        {/* Exposure Guardrail Inputs + Holdings Adjuster Toggle */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-800/80 text-xs">
          <div>
            <label htmlFor="max-gross-input" className="block text-slate-400 mb-1">
              Max Gross Exposure (%)
            </label>
            <input
              id="max-gross-input"
              type="number"
              min={50}
              max={200}
              step={5}
              value={config.maxGrossExposurePct}
              onChange={(e) =>
                onUpdateConfig({ maxGrossExposurePct: safeFiniteNumber(e.target.value, 100) })
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 font-mono text-white tabular-nums focus:border-[#3b82f6] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="min-reserve-input" className="block text-slate-400 mb-1">
              Min Stablecoin Reserve (%)
            </label>
            <input
              id="min-reserve-input"
              type="number"
              min={0}
              max={60}
              step={1}
              value={config.minStablecoinReservePct}
              onChange={(e) =>
                onUpdateConfig({ minStablecoinReservePct: safeFiniteNumber(e.target.value, 15) })
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 font-mono text-white tabular-nums focus:border-[#3b82f6] focus:outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setShowHoldingsEditor((v) => !v)}
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer"
            >
              {showHoldingsEditor ? 'Hide Holdings & Reserve Editor' : 'Adjust Holdings & Reserve Units'}
            </button>
          </div>
        </div>

        {/* Interactive Holdings Editor (allows stress testing Under/Over exposure immediately) */}
        {showHoldingsEditor && (
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-white">
                Simulate Holdings Skew or Stablecoin Reserve Inflow
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateHoldingUnits('BTCUSDT', 0.35, 600)}
                  className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                >
                  Simulate Over-Exposed BTC Skew
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateHoldingUnits('BTCUSDT', 0.05, 14500)}
                  className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                >
                  Simulate Under-Exposed Cash Heavy
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              {safeHoldings.map((h) => (
                <div key={h.symbol}>
                  <label className="block text-slate-400 mb-1">{h.baseAsset} Units</label>
                  <input
                    type="number"
                    min={0}
                    step={h.symbol === 'BTCUSDT' ? 0.01 : 0.5}
                    value={h.units}
                    onChange={(e) =>
                      onUpdateHoldingUnits(
                        h.symbol,
                        Math.max(0, safeFiniteNumber(e.target.value, h.units))
                      )
                    }
                    className="w-full rounded border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-white tabular-nums"
                  />
                </div>
              ))}
              <div>
                <label className="block text-slate-400 mb-1">USDT Reserve ($)</label>
                <input
                  type="number"
                  min={0}
                  step={250}
                  value={Math.round(safeFiniteNumber(stablecoinReserveUsd, 0))}
                  onChange={(e) =>
                    onUpdateHoldingUnits(
                      'USDT',
                      0,
                      Math.max(0, safeFiniteNumber(e.target.value, stablecoinReserveUsd))
                    )
                  }
                  className="w-full rounded border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-cyan-300 tabular-nums"
                />
              </div>
            </div>
          </div>
        )}

        {/* Suggested Rebalance Orders Preview Table */}
        {assets.length > 0 && (
          <div className="pt-2 overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 px-2 font-medium text-right">Mark Price</th>
                  <th className="py-2 px-2 font-medium text-right">Actual / Target</th>
                  <th className="py-2 px-2 font-medium text-right">Drift</th>
                  <th className="py-2 px-2 font-medium text-right">Delta Notional</th>
                  <th className="py-2 pl-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 tabular-nums">
                {assets.map((a) => (
                  <tr key={a.symbol} className="hover:bg-slate-800/25">
                    <td className="py-2 pr-3 font-semibold text-white">{a.baseAsset}</td>
                    <td className="py-2 px-2 text-right font-mono text-slate-300">
                      ${a.markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-slate-200">
                      {a.currentWeightPct.toFixed(1)}% / {a.targetWeightPct.toFixed(1)}%
                    </td>
                    <td
                      className={`py-2 px-2 text-right font-mono font-medium ${
                        a.driftPct > config.driftThresholdPct
                          ? 'text-rose-400'
                          : a.driftPct < -config.driftThresholdPct
                          ? 'text-amber-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {a.driftPct >= 0 ? '+' : ''}
                      {a.driftPct.toFixed(2)}%
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-slate-200">
                      {a.rebalanceDeltaUsd >= 0 ? '+' : '-'}$
                      {Math.abs(a.rebalanceDeltaUsd).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <span
                        className={`font-mono font-bold ${
                          a.suggestedAction === 'BUY'
                            ? 'text-emerald-400'
                            : a.suggestedAction === 'SELL'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {a.suggestedAction}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Recent Rebalance Audit Trail */}
        <div className="pt-3 border-t border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">
              Rebalance Execution Ledger ({safeHistory.length})
            </span>
            {safeHistory.length > 0 && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export CSV</span>
              </button>
            )}
          </div>

          {safeHistory.length === 0 ? (
            <p className="text-xs text-slate-500">
              No rebalance executions recorded yet in this cycle. Click Execute Rebalance Now or await a threshold/periodic trigger.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/60 text-xs">
              {safeHistory.slice(0, 4).map((rec) => (
                <div
                  key={rec.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 tabular-nums"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-[#3b82f6]">
                      {rec.triggerReason}
                    </span>
                    <span className="text-slate-400">
                      {rec.tradesExecuted} trades · ${rec.movedNotionalUsd.toLocaleString()} rotated
                    </span>
                  </div>
                  <div className="text-slate-300 font-mono">
                    Drift {rec.preMaxDriftPct.toFixed(1)}% &rarr;{' '}
                    <span className="text-emerald-400 font-semibold">
                      {rec.postMaxDriftPct.toFixed(2)}%
                    </span>
                    <span className="ml-2 text-slate-500">
                      {new Date(rec.executedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
