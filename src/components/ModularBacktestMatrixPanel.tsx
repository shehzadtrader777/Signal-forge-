import { memo, useCallback, useEffect, useState } from 'react';
import { BarChart3, Play, Sparkles, SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import {
  DEFAULT_MODULAR_BACKTEST_PARAMS,
  type BacktestTradeHorizon,
  type ComparativeSimulationMatrixReport,
  type MatrixAgentStrategyId,
  type ModularBacktestParams,
  type ParameterOptimizationResult,
} from '../lib/modularBacktestEngine';

interface ModularBacktestMatrixPanelProps {
  symbol: string;
}

const HORIZONS: BacktestTradeHorizon[] = [100, 250, 500, 1000];

export const ModularBacktestMatrixPanel = memo(function ModularBacktestMatrixPanel({
  symbol,
}: ModularBacktestMatrixPanelProps) {
  const [params, setParams] = useState<ModularBacktestParams>(DEFAULT_MODULAR_BACKTEST_PARAMS);
  const [optTarget, setOptTarget] = useState<MatrixAgentStrategyId>('AUTONOMOUS_MASTER');
  const [report, setReport] = useState<ComparativeSimulationMatrixReport | null>(null);
  const [optimization, setOptimization] = useState<ParameterOptimizationResult | null>(null);
  const [runningMatrix, setRunningMatrix] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  const runMatrix = useCallback(
    async (nextParams: ModularBacktestParams) => {
      setRunningMatrix(true);
      try {
        const res = await fetch('/api/backtest/matrix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, ...nextParams }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          report?: ComparativeSimulationMatrixReport;
        };
        if (data?.ok && data.report) {
          setReport(data.report);
        }
      } finally {
        setRunningMatrix(false);
      }
    },
    [symbol]
  );

  useEffect(() => {
    runMatrix(params);
  }, [symbol]);

  const handleRunOptimizer = async () => {
    setOptimizing(true);
    try {
      const res = await fetch('/api/backtest/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          strategyId: optTarget,
          ...params,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        optimization?: ParameterOptimizationResult;
      };
      if (data?.ok && data.optimization) {
        setOptimization(data.optimization);
      }
    } finally {
      setOptimizing(false);
    }
  };

  const applyOptimizedParams = () => {
    if (!optimization) return;
    setParams(optimization.bestParams);
    runMatrix(optimization.bestParams);
  };

  return (
    <section
      aria-label="Modular 1,000-Trade Multi-Horizon Backtest Matrix"
      data-testid="modular-backtest-matrix-panel"
      className="cyber-surface rounded-xl border overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800/90 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-cyan-300 font-medium">Decoupled Quantitative Engine</span>
            <span aria-hidden="true">·</span>
            <span>Up to 1,000 Trades / Profile · Simultaneous 4-Agent Comparative Matrix</span>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />
            <span>Parameterized Multi-Horizon Simulation Matrix ({symbol})</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            disabled={optimizing}
            onClick={handleRunOptimizer}
            data-testid="run-backtest-optimizer-btn"
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{optimizing ? 'Optimizing 150 Grid Sets...' : 'Auto-Optimize Parameters'}</span>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            disabled={runningMatrix}
            onClick={() => runMatrix(params)}
            data-testid="run-backtest-matrix-btn"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{runningMatrix ? 'Simulating...' : `Run ${params.tradeCount}-Trade Matrix`}</span>
          </motion.button>
        </div>
      </div>

      {/* Parameter Override Control Bar */}
      <div className="grid grid-cols-1 gap-4 border-b border-slate-800/90 bg-[#060c1b]/90 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5 text-xs">
        <label className="block">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Risk Limit / Trade</span>
            <span className="font-mono text-rose-300 font-semibold">
              {params.riskLimitPerTradePct.toFixed(2)}%
            </span>
          </div>
          <input
            type="range"
            min={0.25}
            max={2.0}
            step={0.05}
            value={params.riskLimitPerTradePct}
            onChange={(e) =>
              setParams((p) => ({ ...p, riskLimitPerTradePct: Number(e.target.value) }))
            }
            className="mt-1.5 w-full accent-rose-400 cursor-pointer"
          />
        </label>

        <label className="block">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>ATR Trailing Stop Mult</span>
            <span className="font-mono text-amber-300 font-semibold">
              {params.atrTrailingStopMultiplier.toFixed(2)}x
            </span>
          </div>
          <input
            type="range"
            min={1.0}
            max={3.5}
            step={0.05}
            value={params.atrTrailingStopMultiplier}
            onChange={(e) =>
              setParams((p) => ({ ...p, atrTrailingStopMultiplier: Number(e.target.value) }))
            }
            className="mt-1.5 w-full accent-amber-400 cursor-pointer"
          />
        </label>

        <label className="block">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Profit-to-Loss Ratio</span>
            <span className="font-mono text-emerald-400 font-semibold">
              1:{params.profitToLossRatio.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min={5.0}
            max={10.0}
            step={0.1}
            value={params.profitToLossRatio}
            onChange={(e) =>
              setParams((p) => ({ ...p, profitToLossRatio: Number(e.target.value) }))
            }
            className="mt-1.5 w-full accent-emerald-400 cursor-pointer"
          />
        </label>

        <div>
          <div className="text-[11px] text-slate-400 mb-1.5">Trade Horizon / Profile</div>
          <div className="grid grid-cols-4 gap-1">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => {
                  const next = { ...params, tradeCount: h };
                  setParams(next);
                  runMatrix(next);
                }}
                className={`rounded border py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                  params.tradeCount === h
                    ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                    : 'border-slate-800 bg-[#0b1224] text-slate-400 hover:text-white'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <SlidersHorizontal className="h-3 w-3 text-cyan-400" aria-hidden="true" />
              Optimizer Target
            </span>
            <button
              type="button"
              onClick={() =>
                setParams((p) => ({ ...p, autonomousProfitLock: !p.autonomousProfitLock }))
              }
              className={`font-mono text-[10px] font-bold cursor-pointer ${
                params.autonomousProfitLock ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              {params.autonomousProfitLock ? 'Auto-Lock ON' : 'Static TP'}
            </button>
          </div>
          <select
            aria-label="Optimization target agent strategy"
            value={optTarget}
            onChange={(e) => setOptTarget(e.target.value as MatrixAgentStrategyId)}
            className="rounded-lg border border-slate-700 bg-[#0b1224] px-2.5 py-1.5 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none cursor-pointer"
          >
            <option value="AUTONOMOUS_MASTER">AI Master Coordinator</option>
            <option value="SMC_1_5">SMC &amp; FRVP Liquidity</option>
            <option value="PATTERN_SCANNER">Chart Pattern Breakout</option>
            <option value="PRE_PUMP_SUPPORT">Pre-Pump Support Momentum</option>
          </select>
        </div>
      </div>

      {/* Auto-Optimizer Discovery Callout */}
      {optimization && (
        <div
          data-testid="backtest-optimizer-result"
          className="flex flex-col gap-3 border-b border-cyan-500/25 bg-cyan-950/20 px-5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-0.5">
            <div className="font-semibold text-cyan-200">
              Auto-Optimizer Evaluated {optimization.candidatesEvaluated} Parameter Sets ({optimization.computeDurationMs}ms)
            </div>
            <div className="font-mono text-[11px] text-slate-300 tabular-nums">
              Optimal: Risk {optimization.bestParams.riskLimitPerTradePct}% · ATR{' '}
              {optimization.bestParams.atrTrailingStopMultiplier}x · 1:{optimization.bestParams.profitToLossRatio} R:R →
              Sharpe <span className="text-emerald-400">{optimization.optimizedResult.sharpeRatio}</span> (
              {optimization.improvementSharpe >= 0 ? '+' : ''}
              {optimization.improvementSharpe}) · MaxDD{' '}
              <span className="text-amber-300">{optimization.optimizedResult.maxDrawdownPct}%</span>
            </div>
          </div>
          <button
            type="button"
            onClick={applyOptimizedParams}
            className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Apply Optimal Override
          </button>
        </div>
      )}

      {/* Comparative Multi-Agent Matrix Table */}
      <div className="overflow-x-auto p-5">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
              <th className="py-2.5 pr-4">Agent Strategy Profile</th>
              <th className="py-2.5 pr-3 text-right">Trades</th>
              <th className="py-2.5 pr-3 text-right">Win Rate</th>
              <th className="py-2.5 pr-3 text-right">Expectancy</th>
              <th className="py-2.5 pr-3 text-right">Profit Factor</th>
              <th className="py-2.5 pr-3 text-right">Sharpe / Sortino</th>
              <th className="py-2.5 pr-3 text-right">Max Drawdown</th>
              <th className="py-2.5 pr-3 text-right">Total Return</th>
              <th className="py-2.5 text-right">Ending Equity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 text-xs font-mono tabular-nums">
            {(report?.profiles ?? []).map((prof) => {
              const isLeader = report?.leaderStrategyId === prof.strategyId;
              return (
                <tr key={prof.strategyId} className="hover:bg-slate-800/25 transition-colors">
                  <td className="py-3 pr-4 font-sans">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{prof.strategyLabel}</span>
                      {isLeader && (
                        <span className="font-mono text-[10px] font-bold text-cyan-300 border border-cyan-500/40 bg-cyan-500/10 rounded px-1.5 py-0.5">
                          LEADER
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-right text-slate-300">{prof.tradeCount.toLocaleString()}</td>
                  <td className="py-3 pr-3 text-right text-slate-200">{prof.winRatePct.toFixed(1)}%</td>
                  <td
                    className={`py-3 pr-3 text-right font-semibold ${
                      prof.expectancyR >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {prof.expectancyR >= 0 ? '+' : ''}
                    {prof.expectancyR}R
                  </td>
                  <td className="py-3 pr-3 text-right text-white">{prof.profitFactor.toFixed(2)}x</td>
                  <td className="py-3 pr-3 text-right text-cyan-300">
                    {prof.sharpeRatio.toFixed(2)} / {prof.sortinoRatio.toFixed(2)}
                  </td>
                  <td className="py-3 pr-3 text-right text-amber-300">
                    -{prof.maxDrawdownPct.toFixed(2)}%
                  </td>
                  <td
                    className={`py-3 pr-3 text-right font-semibold ${
                      prof.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {prof.totalReturnPct >= 0 ? '+' : ''}
                    {prof.totalReturnPct.toFixed(1)}%
                  </td>
                  <td className="py-3 text-right font-bold text-white">
                    ${prof.endingEquityUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
});
