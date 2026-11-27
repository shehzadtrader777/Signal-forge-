import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  FlaskConical,
  Hash,
  Play,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import {
  DEFAULT_STEP2_BACKTEST_CONFIG,
  type Step2StrategyComparisonReport,
} from '../lib/step2StrategyFramework';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'] as const;
const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const;

export const Step2StrategyBacktestComparator: React.FC = () => {
  const [symbol, setSymbol] = useState<string>(DEFAULT_STEP2_BACKTEST_CONFIG.symbol);
  const [timeframe, setTimeframe] = useState<string>(DEFAULT_STEP2_BACKTEST_CONFIG.timeframe);
  const [initialEquityUsd, setInitialEquityUsd] = useState<number>(
    DEFAULT_STEP2_BACKTEST_CONFIG.initialEquityUsd
  );
  const [riskPerTradePct, setRiskPerTradePct] = useState<number>(
    DEFAULT_STEP2_BACKTEST_CONFIG.riskPerTradePct
  );
  const [feeBps, setFeeBps] = useState<number>(DEFAULT_STEP2_BACKTEST_CONFIG.feeBps);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_STEP2_BACKTEST_CONFIG.slippageBps);
  const [spreadBps, setSpreadBps] = useState<number>(DEFAULT_STEP2_BACKTEST_CONFIG.spreadBps);

  const [report, setReport] = useState<Step2StrategyComparisonReport | null>(null);
  const [savedReports, setSavedReports] = useState<Step2StrategyComparisonReport[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    try {
      const res = await apiFetch('/api/step2/hub');
      const data = await res.json();
      if (data?.ok && Array.isArray(data.savedBacktestReports)) {
        setSavedReports(data.savedBacktestReports);
        if (data.savedBacktestReports.length > 0) {
          setReport((curr) => curr ?? data.savedBacktestReports[0]);
        }
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  const handleRunComparison = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiFetch('/api/step2/backtest/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          initialEquityUsd,
          riskPerTradePct,
          feeBps,
          slippageBps,
          spreadBps,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Backtest comparison failed.');
      } else {
        setReport(data.report);
        await loadSaved();
      }
    } catch {
      setError('Network error while running Step 2 strategy comparison backtest.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section
      aria-label="Step 2 Point-in-Time Multi-Strategy Backtest Comparator"
      className="rounded-2xl border border-indigo-500/25 bg-[#090f1d] p-4 sm:p-6 shadow-xl space-y-5"
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
            <FlaskConical className="w-4 h-4" />
            <span>Step 2 · Point-in-Time Multi-Strategy Backtesting Upgrade</span>
            <span className="px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200">
              HISTORICAL BACKTEST ONLY (ISOLATED FROM PAPER / DEMO / LIVE)
            </span>
          </div>
          <h2 className="mt-1.5 text-lg sm:text-xl font-bold text-white">
            8-Strategy Transparent Comparison (Zero Look-Ahead · Fees · Slippage · Spread · OOS)
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Displays BOTH profitable and unprofitable strategies without survivorship filtering. Every run saves a reproducible configuration hash.
          </p>
        </div>

        <button
          type="button"
          disabled={running}
          onClick={handleRunComparison}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-bold text-xs px-4 py-2.5 transition shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          <span>{running ? 'Running Point-in-Time Backtest…' : 'Run Multi-Strategy Comparison'}</span>
        </button>
      </div>

      {/* Explicit Assumptions & Configuration Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 text-xs">
        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>Pair</span>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-white"
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>Timeframe</span>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-white"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>Equity (USD)</span>
          <input
            type="number"
            value={initialEquityUsd}
            onChange={(e) => setInitialEquityUsd(Number(e.target.value))}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-white font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>Risk/Trade %</span>
          <input
            type="number"
            step="0.1"
            value={riskPerTradePct}
            onChange={(e) => setRiskPerTradePct(Number(e.target.value))}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-white font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>Fee (bps/side)</span>
          <input
            type="number"
            value={feeBps}
            onChange={(e) => setFeeBps(Number(e.target.value))}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-white font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>Slippage (bps)</span>
          <input
            type="number"
            value={slippageBps}
            onChange={(e) => setSlippageBps(Number(e.target.value))}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-white font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>Spread (bps)</span>
          <input
            type="number"
            value={spreadBps}
            onChange={(e) => setSpreadBps(Number(e.target.value))}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-white font-mono"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Reproducible Saved Configs Bar */}
      {savedReports.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-semibold">Saved Reproducible Configs:</span>
          {savedReports.map((sr) => (
            <button
              key={sr.configHash}
              type="button"
              onClick={() => setReport(sr)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono text-[11px] border transition ${
                report?.configHash === sr.configHash
                  ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Hash className="w-3 h-3" />
              <span>
                {sr.configHash} ({sr.config.symbol} {sr.config.timeframe})
              </span>
            </button>
          ))}
        </div>
      )}

      {report ? (
        <div className="space-y-4">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[10px] uppercase text-slate-400">Config Hash</div>
              <div className="mt-0.5 font-mono font-bold text-indigo-300">{report.configHash}</div>
              <div className="text-[10px] text-slate-500">
                {report.dataProvider} ({report.isSyntheticData ? 'Synthetic' : 'Verified'})
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[10px] uppercase text-slate-400">Walk-Forward Split</div>
              <div className="mt-0.5 font-mono font-bold text-white">
                {report.inSampleBars} IS / {report.outOfSampleBars} OOS
              </div>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Zero Look-Ahead
              </div>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3">
              <div className="text-[10px] uppercase text-emerald-300">Profitable Strategies</div>
              <div className="mt-0.5 font-mono font-bold text-emerald-200 text-base">
                {report.summary.profitableCount}
              </div>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3">
              <div className="text-[10px] uppercase text-rose-300">Unprofitable Strategies</div>
              <div className="mt-0.5 font-mono font-bold text-rose-200 text-base">
                {report.summary.unprofitableCount}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 col-span-2 lg:col-span-1">
              <div className="text-[10px] uppercase text-slate-400">Low Sample / Inactive</div>
              <div className="mt-0.5 font-mono font-bold text-slate-200 text-base">
                {report.summary.insufficientSampleCount}
              </div>
            </div>
          </div>

          {/* Transparent All-8 Comparison Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/95 text-slate-400 text-[11px]">
                <tr>
                  <th className="px-3 py-2.5">Strategy</th>
                  <th className="px-3 py-2.5">Outcome</th>
                  <th className="px-3 py-2.5">Trades</th>
                  <th className="px-3 py-2.5">Win Rate</th>
                  <th className="px-3 py-2.5">Net PnL</th>
                  <th className="px-3 py-2.5">Fees + Slip</th>
                  <th className="px-3 py-2.5">Max DD</th>
                  <th className="px-3 py-2.5">PF / Exp</th>
                  <th className="px-3 py-2.5">Sharpe / Sortino</th>
                  <th className="px-3 py-2.5">IS vs OOS %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {report.results.map((row) => (
                  <tr key={row.strategyId} className="hover:bg-slate-900/50">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-white">{row.strategyName}</div>
                      <div className="text-[10px] text-slate-400">{row.notes}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          row.outcomeClassification === 'PROFITABLE'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : row.outcomeClassification === 'UNPROFITABLE'
                            ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {row.outcomeClassification === 'PROFITABLE' ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : row.outcomeClassification === 'UNPROFITABLE' ? (
                          <TrendingDown className="w-3 h-3" />
                        ) : (
                          <BarChart3 className="w-3 h-3" />
                        )}
                        {row.outcomeClassification}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-200">
                      {row.totalTrades} ({row.wins}W/{row.losses}L)
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-200">{row.winRatePct}%</td>
                    <td
                      className={`px-3 py-2.5 font-mono font-bold ${
                        row.netPnlUsd > 0
                          ? 'text-emerald-300'
                          : row.netPnlUsd < 0
                          ? 'text-rose-300'
                          : 'text-slate-400'
                      }`}
                    >
                      {row.netPnlUsd >= 0 ? '+' : ''}${row.netPnlUsd} ({row.netReturnPct}%)
                    </td>
                    <td className="px-3 py-2.5 font-mono text-amber-300">
                      ${row.totalFeesAndSlippageUsd}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-rose-200">{row.maxDrawdownPct}%</td>
                    <td className="px-3 py-2.5 font-mono text-slate-200">
                      {row.profitFactor ?? '—'} / ${row.expectancyUsd}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-200">
                      {row.sharpeRatio} / {row.sortinoRatio}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-200">
                      {row.inSampleReturnPct}% / {row.outOfSampleReturnPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5 text-[11px] text-amber-200/90 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
            <span>{report.summary.disclaimer}</span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-xs text-slate-400">
          Click <strong className="text-slate-200">Run Multi-Strategy Comparison</strong> to evaluate
          all 8 strategies point-in-time with realistic fee, slippage, and spread modeling.
        </div>
      )}
    </section>
  );
};

export default Step2StrategyBacktestComparator;
