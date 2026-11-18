import { useState } from 'react';
import {
  ArrowLeftRight,
  Cpu,
  ShieldAlert,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatCryptoPrice } from '../lib/marketData';

type OperationsTab = 'RL_TUNING' | 'LIQUIDATION' | 'ARBITRAGE' | 'COPY_TRADING';

export function AutonomousOperationsHub() {
  const {
    selectedSymbol,
    rlTuning,
    triggerRlAutoTune,
    emergencyLiquidation,
    triggerEmergencyLiquidation,
    arbitrageOpportunities,
    arbitrageExecutions,
    executeArbitrage,
    copyAccounts,
    mirroredCopyHistory,
    toggleCopyAccount,
    mirrorCopyTrade,
  } = useApp();

  const [activeTab, setActiveTab] = useState<OperationsTab>('RL_TUNING');
  const [stablecoinAsset, setStablecoinAsset] = useState<'USDT' | 'USDC'>('USDT');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const handleTune = async () => {
    setBusyKey('tune');
    try {
      await triggerRlAutoTune();
      setStatusBanner('RL Auto-Tuning updated ATR multipliers, timeframe, and high-conviction compute allocation.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleEmergencyLiquidate = async () => {
    setBusyKey('liquidate');
    try {
      const res = await triggerEmergencyLiquidation(
        stablecoinAsset,
        `Coordinator Flash-Crash Shield Liquidation -> ${stablecoinAsset}`
      );
      setStatusBanner(
        res.ok
          ? `Settled ${res.liquidatedCount ?? 0} high-risk position(s) directly into ${stablecoinAsset} reserve.`
          : 'Emergency liquidation request could not complete.'
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleCaptureArbitrage = async (oppId: string) => {
    setBusyKey(oppId);
    try {
      const res = await executeArbitrage(oppId);
      setStatusBanner(
        res.ok
          ? 'Delta-neutral cross-exchange arbitrage capture settled cleanly to Cross Wallet.'
          : res.error || 'Arbitrage spread skipped.'
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleMirrorTrade = async (accountId: string, direction: 'BUY' | 'SELL') => {
    setBusyKey(`mirror_${accountId}`);
    try {
      const res = await mirrorCopyTrade(accountId, selectedSymbol, direction);
      setStatusBanner(
        res.ok
          ? `Mirrored institutional desk ${direction} on ${selectedSymbol} with strict <=2.0% risk cap & >=1:5 R:R.`
          : 'Mirror execution could not complete.'
      );
    } finally {
      setBusyKey(null);
    }
  };

  const computeEntries = Object.entries(rlTuning.computeAllocationBySymbol || {}).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <section
      aria-label="Autonomous Intelligence Safeguards Arbitrage and Copy Trading Hub"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      {/* Header & Clean Tab Bar */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Cpu className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span className="font-mono font-semibold text-blue-300">
              AUTONOMOUS SAFEGUARDS · RL TUNER · ARBITRAGE · COPY DESK
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-emerald-400">
              Reserve ${emergencyLiquidation.totalStablecoinReserveUsd.toLocaleString()} {emergencyLiquidation.stablecoinReserveAsset}
            </span>
          </div>
          <h2 className="mt-0.5 font-display text-lg font-bold text-white tracking-tight">
            RL Auto-Tuning, Flash-Crash Liquidation, Arbitrage &amp; Institutional Copy Trading
          </h2>
        </div>

        <div
          role="tablist"
          aria-label="Autonomous Operations Sections"
          className="inline-flex flex-wrap rounded-lg border border-slate-800 bg-[#0a0e1a] p-1 shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'RL_TUNING'}
            onClick={() => setActiveTab('RL_TUNING')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              activeTab === 'RL_TUNING' ? 'bg-[#3b82f6] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>RL Auto-Tuner</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'LIQUIDATION'}
            onClick={() => setActiveTab('LIQUIDATION')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              activeTab === 'LIQUIDATION' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Flash-Crash Shield</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ARBITRAGE'}
            onClick={() => setActiveTab('ARBITRAGE')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              activeTab === 'ARBITRAGE' ? 'bg-[#3b82f6] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Arbitrage ({arbitrageOpportunities.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'COPY_TRADING'}
            onClick={() => setActiveTab('COPY_TRADING')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              activeTab === 'COPY_TRADING' ? 'bg-[#3b82f6] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Institutional Copy ({copyAccounts.filter((a) => a.autoMirrorEnabled).length})</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div
          role="status"
          className="border-b border-[#3b82f6]/30 bg-[#3b82f6]/10 px-5 py-2 text-xs text-blue-200 flex items-center justify-between gap-2"
        >
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-slate-300 hover:text-white text-[11px] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: Reinforcement Learning Performance Auto-Tuning */}
      {activeTab === 'RL_TUNING' && (
        <div className="p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-300 max-w-3xl">{rlTuning.tuningNote}</p>
            <button
              type="button"
              onClick={handleTune}
              disabled={busyKey === 'tune'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{busyKey === 'tune' ? 'Tuning RL Policy...' : 'Run RL Auto-Tune Cycle'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 font-mono tabular-nums text-xs">
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">RL ATR STOP MULT</span>
              <span className="text-lg font-bold text-amber-300">
                {rlTuning.atrStopMultiplier.toFixed(2)}x
              </span>
              <span className="block text-[10px] text-slate-400">Hard 2.0% Risk Cap</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">RL TRAIL TP MULT</span>
              <span className="text-lg font-bold text-emerald-400">
                {rlTuning.atrTrailingTpMultiplier.toFixed(2)}x
              </span>
              <span className="block text-[10px] text-slate-400">Min 1:5 R:R Enforced</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">OPTIMAL TIMEFRAME</span>
              <span className="text-lg font-bold text-white uppercase">
                {rlTuning.preferredTimeframe}
              </span>
              <span className="block text-[10px] text-slate-400">Adaptive Horizon</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">RL REWARD SCORE</span>
              <span
                className={`text-lg font-bold ${
                  rlTuning.rlRewardScore >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {rlTuning.rlRewardScore >= 0 ? '+' : ''}
                {rlTuning.rlRewardScore.toFixed(3)}
              </span>
              <span className="block text-[10px] text-slate-400">
                {rlTuning.settledTradesEvaluated} trades evaluated
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">WIN RATE · PF</span>
              <span className="text-lg font-bold text-blue-300">
                {rlTuning.winRatePct}% · {rlTuning.profitFactor}x
              </span>
              <span className="block text-[10px] text-slate-400">Conviction Gate &ge;{rlTuning.highConvictionThreshold}%</span>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              High-Conviction Setup Compute Resource Allocation
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {computeEntries.map(([sym, pct]) => (
                <div key={sym} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                    <span className="font-bold text-white">{sym}</span>
                    <span className={pct >= 75 ? 'text-emerald-400 font-semibold' : 'text-slate-300'}>
                      {pct}% Compute
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        pct >= 75 ? 'bg-emerald-500' : 'bg-[#3b82f6]'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(8, pct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Autonomous Flash-Crash Emergency Stablecoin Liquidation */}
      {activeTab === 'LIQUIDATION' && (
        <div className="p-5 space-y-5">
          <div className="flex flex-col gap-4 rounded-lg border border-rose-500/30 bg-rose-950/15 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-rose-200 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-400" aria-hidden="true" />
                <span>Autonomous Flash-Crash Safeguard (&le;-4.5% WS Drop or Sentinel Panic FUD)</span>
              </div>
              <p className="text-slate-300">
                Automatically liquidates high-risk volatile &amp; leveraged exposure directly into your{' '}
                {stablecoinAsset} stablecoin reserve when severe flash-crash conditions trigger.
              </p>
              <div className="font-mono text-[11px] text-slate-400 tabular-nums pt-0.5">
                Liquidated Events: {emergencyLiquidation.liquidatedCount} · Total Protected: $
                {emergencyLiquidation.totalConvertedUsd.toLocaleString()} {emergencyLiquidation.stablecoinReserveAsset}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <label htmlFor="liq-stable-select" className="text-xs text-slate-300">
                Reserve:
              </label>
              <select
                id="liq-stable-select"
                value={stablecoinAsset}
                onChange={(e) => setStablecoinAsset(e.target.value === 'USDC' ? 'USDC' : 'USDT')}
                className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-2 font-mono text-xs text-white focus:border-[#3b82f6] focus:outline-none"
              >
                <option value="USDT">USDT Reserve</option>
                <option value="USDC">USDC Reserve</option>
              </select>
              <button
                type="button"
                data-testid="emergency-liquidate-btn"
                disabled={busyKey === 'liquidate'}
                onClick={handleEmergencyLiquidate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-500 cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {busyKey === 'liquidate'
                    ? 'Converting to Stablecoin...'
                    : `Liquidate to ${stablecoinAsset} Now`}
                </span>
              </button>
            </div>
          </div>

          {emergencyLiquidation.history.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">
              No flash-crash emergency liquidations triggered yet. Autonomous safeguard monitors WS drop velocity continuously.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="border-b border-slate-800 bg-[#0a0e1a] text-slate-400">
                  <tr>
                    <th className="py-2.5 px-3">Pair</th>
                    <th className="py-2.5 px-3">Market</th>
                    <th className="py-2.5 px-3 text-right">Exit Price</th>
                    <th className="py-2.5 px-3 text-right">Converted {stablecoinAsset}</th>
                    <th className="py-2.5 px-3 text-right">Net PnL</th>
                    <th className="py-2.5 px-3">Trigger Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {emergencyLiquidation.history.slice(0, 10).map((rec) => (
                    <tr key={rec.id} className="hover:bg-[#0d1323]">
                      <td className="py-2.5 px-3 font-bold text-white">{rec.symbol}</td>
                      <td className="py-2.5 px-3 text-slate-300">{rec.marketType}</td>
                      <td className="py-2.5 px-3 text-right text-slate-200">
                        ${formatCryptoPrice(rec.exitPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-300 font-semibold">
                        ${rec.notionalReleasedUsd.toLocaleString()} {rec.convertedStablecoin}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          rec.netRealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {rec.netRealizedPnlUsd >= 0 ? '+' : ''}${rec.netRealizedPnlUsd.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-slate-400 max-w-xs truncate">
                        {rec.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Multi-Exchange Arbitrage Scanner & Execution */}
      {activeTab === 'ARBITRAGE' && (
        <div className="p-5 space-y-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead className="border-b border-slate-800 bg-[#0a0e1a] text-slate-400">
                <tr>
                  <th className="py-2.5 px-3">Pair</th>
                  <th className="py-2.5 px-3">Buy Ask (Venue)</th>
                  <th className="py-2.5 px-3">Sell Bid (Venue)</th>
                  <th className="py-2.5 px-3 text-right">Net Spread</th>
                  <th className="py-2.5 px-3 text-right">Est. Net Profit</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {arbitrageOpportunities.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-5 text-center font-sans text-slate-400">
                      Scanning Binance, Bybit &amp; OKX L2 order books for executable cross-exchange spreads...
                    </td>
                  </tr>
                ) : (
                  arbitrageOpportunities.map((opp) => (
                    <tr key={opp.id} className="hover:bg-[#0d1323]">
                      <td className="py-2.5 px-3 font-bold text-white">{opp.symbol}</td>
                      <td className="py-2.5 px-3 text-emerald-300">
                        {opp.buyExchange} · ${formatCryptoPrice(opp.buyAskPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-cyan-300">
                        {opp.sellExchange} · ${formatCryptoPrice(opp.sellBidPrice)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          opp.netSpreadBps > 0 ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {opp.netSpreadBps >= 0 ? '+' : ''}
                        {opp.netSpreadBps} bps
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-200">
                        ${opp.projectedNetProfitUsd.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          disabled={busyKey === opp.id}
                          onClick={() => handleCaptureArbitrage(opp.id)}
                          className="rounded-md border border-[#3b82f6]/60 bg-[#3b82f6]/15 px-2.5 py-1 font-sans text-[11px] font-semibold text-blue-200 hover:bg-[#3b82f6]/30 cursor-pointer whitespace-nowrap disabled:opacity-50"
                        >
                          {busyKey === opp.id ? 'Routing...' : 'Capture Spread'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {arbitrageExecutions.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3.5 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Recent Cross-Exchange Arbitrage Captures ({arbitrageExecutions.length})
              </div>
              <div className="space-y-1.5 text-xs font-mono tabular-nums">
                {arbitrageExecutions.slice(0, 5).map((ex) => (
                  <div
                    key={ex.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-slate-300"
                  >
                    <span>
                      <strong className="text-white">{ex.symbol}</strong> · {ex.buyExchange} &rarr;{' '}
                      {ex.sellExchange} (+{ex.netSpreadBps} bps)
                    </span>
                    <span className="text-emerald-400 font-bold">
                      +${ex.realizedProfitUsd.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Institutional Social Copy Trading */}
      {activeTab === 'COPY_TRADING' && (
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {copyAccounts.map((acc) => (
              <div
                key={acc.id}
                className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-blue-300">{acc.handle}</span>
                    <span className="font-mono text-[10px] text-slate-400">
                      Audit {acc.verifiedAuditHash}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white">{acc.institutionName}</h3>
                  <p className="text-[11px] text-slate-400 leading-snug">{acc.strategyFocus}</p>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded border border-slate-800/80 bg-[#0a0e1a] p-2 font-mono text-[11px] tabular-nums">
                  <div>
                    <span className="block text-[9px] text-slate-400">SHARPE</span>
                    <span className="font-bold text-white">{acc.sharpeRatio}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-slate-400">WIN RATE</span>
                    <span className="font-bold text-emerald-400">{acc.winRatePct}%</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-slate-400">MAX DD</span>
                    <span className="font-bold text-amber-300">-{acc.maxDrawdownPct}%</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={acc.autoMirrorEnabled}
                    onClick={() => toggleCopyAccount(acc.id, !acc.autoMirrorEnabled)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                      acc.autoMirrorEnabled
                        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 bg-[#0a0e1a] text-slate-400'
                    }`}
                  >
                    {acc.autoMirrorEnabled ? 'Auto-Mirror ON' : 'Auto-Mirror OFF'}
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busyKey === `mirror_${acc.id}`}
                      onClick={() => handleMirrorTrade(acc.id, 'BUY')}
                      className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                    >
                      Mirror LONG
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `mirror_${acc.id}`}
                      onClick={() => handleMirrorTrade(acc.id, 'SELL')}
                      className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500 cursor-pointer"
                    >
                      Mirror SHORT
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {mirroredCopyHistory.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3.5 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Mirrored Institutional Executions (&le;2.0% Max Risk · &ge;1:5 R:R Enforced)
              </div>
              <div className="space-y-1.5 text-xs font-mono tabular-nums">
                {mirroredCopyHistory.slice(0, 6).map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                    <span>
                      <strong className="text-white">{m.symbol}</strong> {m.direction} via {m.accountHandle} @ $
                      {formatCryptoPrice(m.entryPrice)}
                    </span>
                    <span className="text-emerald-400">
                      Risk {m.maxRiskPct}% · 1:{m.riskRewardRatio} R:R
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
