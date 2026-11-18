import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  FlaskConical,
  Gauge,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatCryptoPrice, type Candle } from '../lib/marketData';
import {
  advanceAtrTrailingStop,
  type CoordinatedTradePlan,
  type LeverageScalingMode,
  type MarginMode,
} from '../lib/coordinator';

interface CoordinatorHubProps {
  plans: CoordinatedTradePlan[];
  candlesMap: Record<string, Candle[]>;
  notionalUsd: number;
  onChangeNotionalUsd: (val: number) => void;
  scalingMode: LeverageScalingMode;
  onChangeScalingMode: (mode: LeverageScalingMode) => void;
  manualLeverage: number;
  onChangeManualLeverage: (lev: number) => void;
  marginMode: MarginMode;
  onChangeMarginMode: (mode: MarginMode) => void;
}

type HubTab = 'COORDINATOR' | 'EXECUTION';

const LEVERAGE_PRESETS = [3, 5, 10, 15, 20, 25];

export function CoordinatorHub({
  plans,
  candlesMap,
  notionalUsd,
  onChangeNotionalUsd,
  scalingMode,
  onChangeScalingMode,
  manualLeverage,
  onChangeManualLeverage,
  marginMode,
  onChangeMarginMode,
}: CoordinatorHubProps) {
  const {
    tickers,
    futuresTradingEnabled,
    setFuturesTradingEnabled,
    spotFeedSource,
    cmcSource,
    cmcValuations,
    spotCmcValidations,
    futuresFeedSource,
    telemetryMetrics,
    monitorHealth,
    focusedCoordinatorPlanId,
    focusCoordinatorPlan,
    resyncing,
    resyncAllTelemetry,
    executionState,
    liveCrossMargin,
    executeCoordinatorOrder,
    closeSandboxPosition,
    settleCrossMarginCycle,
    routeSignalToTelegram,
    testnetExecutionEnabled,
    setTestnetExecutionEnabled,
    liveFeedModulesEnabled,
    setLiveFeedModulesEnabled,
    autonomousState,
  } = useApp();

  const [activeTab, setActiveTab] = useState<HubTab>('COORDINATOR');
  const [selectedPlanIndex, setSelectedPlanIndex] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const plansRef = useRef(plans);
  plansRef.current = plans;
  const handledFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusedCoordinatorPlanId) {
      handledFocusIdRef.current = null;
      return;
    }
    if (handledFocusIdRef.current === focusedCoordinatorPlanId) return;
    const matchIdx = plansRef.current.findIndex((p) => p.id === focusedCoordinatorPlanId);
    if (matchIdx >= 0) {
      handledFocusIdRef.current = focusedCoordinatorPlanId;
      setSelectedPlanIndex((prev) => (prev === matchIdx ? prev : matchIdx));
      setActiveTab((prev) => (prev === 'COORDINATOR' ? prev : 'COORDINATOR'));
      focusCoordinatorPlan('');
    }
  }, [focusedCoordinatorPlanId, plans.length, focusCoordinatorPlan]);

  const activePlan = plans[selectedPlanIndex] ?? plans[0] ?? null;

  // Live mark-to-market P&L, ROE%, and monotonic ATR Trailing SL for open positions
  const enrichedPositions = useMemo(() => {
    return executionState.positions.map((pos) => {
      const livePrice = tickers[pos.symbol]?.price ?? pos.entryPrice;
      const candles = candlesMap[pos.symbol] || [];
      const approxAtr =
        candles.length >= 2
          ? Math.max(
              livePrice * 0.006,
              candles
                .slice(-14)
                .reduce((acc, c) => acc + (c.high - c.low), 0) /
                Math.min(14, candles.length)
            )
          : livePrice * 0.015;

      const liveTrailSl =
        pos.status === 'OPEN'
          ? advanceAtrTrailingStop(pos, livePrice, approxAtr)
          : pos.trailingStopLoss;

      const pct =
        pos.status === 'OPEN'
          ? ((pos.direction === 'BUY'
              ? livePrice - pos.entryPrice
              : pos.entryPrice - livePrice) /
              pos.entryPrice) *
            100
          : pos.pnlPercent;

      const usd =
        pos.status === 'OPEN'
          ? Number(((pos.notionalUsd * pct) / 100 + (pos.settledFundingUsd ?? 0)).toFixed(2))
          : pos.pnlUsd;

      const lev = Math.max(1, pos.leverage ?? 1);
      const im = pos.initialMarginUsd ?? pos.notionalUsd / lev;
      const roe =
        pos.status === 'OPEN'
          ? Number(((usd / Math.max(1, im)) * 100).toFixed(2))
          : pos.roePercent ?? Number((pct * lev).toFixed(2));

      return {
        ...pos,
        livePrice,
        liveTrailSl,
        livePnlPercent: Number(pct.toFixed(2)),
        livePnlUsd: usd,
        liveRoePercent: roe,
        effectiveLev: lev,
        effectiveIm: Number(im.toFixed(2)),
      };
    });
  }, [executionState.positions, tickers, candlesMap]);

  const handleManualTelegramRoute = async () => {
    if (!activePlan) return;
    setBusyAction('telegram');
    try {
      const sent = await routeSignalToTelegram(activePlan, true);
      setFeedback(
        sent
          ? `${activePlan.marketType === 'SPOT' ? 'Spot 1x' : 'Futures'} signal ${activePlan.symbol} (${activePlan.marketType === 'SPOT' ? 'SPOT 1x' : `${activePlan.futuresMargin.leverage}x ${activePlan.futuresMargin.marginMode}`}) routed to "Signal Forge" Telegram.`
          : `Signal ${activePlan.symbol} already delivered this hour.`
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleExecuteTrade = async () => {
    if (!activePlan) return;
    setBusyAction('execute');
    try {
      const isFutures = futuresTradingEnabled && activePlan.marketType === 'USD_M_FUTURES';
      const res = await executeCoordinatorOrder(activePlan, {
        notionalUsd: activePlan.futuresMargin.notionalUsd,
        leverage: isFutures ? activePlan.futuresMargin.leverage : 1,
        marginMode: activePlan.futuresMargin.marginMode,
      });
      setFeedback(
        res.ok
          ? isFutures
            ? `${executionState.mode} USD-M Futures filled: ${activePlan.symbol} ${activePlan.direction} ${activePlan.futuresMargin.leverage}x ${activePlan.futuresMargin.marginMode} (IM $${activePlan.futuresMargin.initialMarginUsd}).`
            : `${executionState.mode} Binance Spot 1x filled: ${activePlan.symbol} ${activePlan.direction} ($${activePlan.futuresMargin.notionalUsd} Spot Principal).`
          : res.error || 'Execution blocked by safeguard.'
      );
      if (res.ok) setActiveTab('EXECUTION');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSettleCrossFunding = async () => {
    setBusyAction('settle');
    try {
      await settleCrossMarginCycle();
      setFeedback('8H Cross-Margin funding settlement cycle applied to open Futures positions.');
    } finally {
      setBusyAction(null);
    }
  };

  const openCount = enrichedPositions.filter((p) => p.status === 'OPEN').length;

  return (
    <section
      aria-label="Autonomous AI Trading Coordinator Hub"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      {/* Top Coordinator Header & Tab Bar */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Bot className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span>
              Binance Spot Primary (
              {spotFeedSource === 'binance_spot' ? 'api.binance.com Live' : 'Deterministic Spot'})
            </span>
            <span aria-hidden="true">·</span>
            <span>
              CMC Baseline ({cmcSource === 'cmc_api' ? 'CoinMarketCap Live' : 'Unavailable'})
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={`font-mono font-semibold ${
                executionState.mode === 'LIVE' ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {futuresTradingEnabled
                ? `FUTURES ${executionState.mode}`
                : `SPOT 1x ${executionState.mode}`}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-200 tabular-nums">
              Equity ${liveCrossMargin.crossEquityUsd.toLocaleString()}
            </span>
            {monitorHealth && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  Monitor HB #{monitorHealth.heartbeatSeq} ({monitorHealth.status} · Heals: {monitorHealth.autoHealCount} · Isolated: {monitorHealth.anomaliesIsolatedCount ?? 0})
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span
              className={`font-mono tabular-nums ${
                autonomousState.enabled ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              Auto {autonomousState.enabled ? 'Armed' : 'Manual'} ({autonomousState.spotActiveCount} Spot / {autonomousState.futuresActiveCount} Fut)
            </span>
          </div>
          <h2 className="mt-0.5 font-display text-xl font-bold text-white tracking-tight">
            {futuresTradingEnabled
              ? 'Autonomous AI Crypto Trading Coordinator (Spot Baseline + Futures Active)'
              : 'Autonomous AI Crypto Trading Coordinator (Binance Spot Priority)'}
          </h2>
        </div>

        <div className="flex flex-col items-start xl:items-end gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
          {/* Manual UI Toggle Switch for Optional Futures Activation */}
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0a0e1a] px-2.5 py-1.5 text-xs">
            <span className="font-medium text-slate-300 whitespace-nowrap">
              Futures Trading
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={futuresTradingEnabled}
              aria-label="Toggle optional Binance Futures trading"
              onClick={() => {
                const next = !futuresTradingEnabled;
                setFuturesTradingEnabled(next);
                setFeedback(
                  next
                    ? `Optional Futures Trading enabled (${futuresFeedSource === 'binance_futures' ? 'fapi.binance.com' : 'Spot-anchored'} telemetry active).`
                    : 'Reverted to Binance Spot 1x Priority (Futures telemetry disabled).'
                );
              }}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                futuresTradingEnabled
                  ? 'border-[#3b82f6] bg-[#3b82f6]'
                  : 'border-slate-700 bg-slate-800'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  futuresTradingEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
            <span
              className={`font-mono text-[11px] font-semibold whitespace-nowrap ${
                futuresTradingEnabled ? 'text-blue-300' : 'text-emerald-400'
              }`}
            >
              {futuresTradingEnabled ? 'ON' : 'OFF (Spot 1x)'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => resyncAllTelemetry()}
            disabled={resyncing}
            aria-label="Flush buffers and resync Binance Spot feed"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0a0e1a] px-2.5 py-1.5 text-xs text-slate-300 hover:border-[#3b82f6] hover:text-white disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${resyncing ? 'animate-spin text-[#3b82f6]' : ''}`} aria-hidden="true" />
            <span>{resyncing ? 'Resyncing...' : 'Sync Spot Feed'}</span>
          </button>
          </div>

          <div
            role="tablist"
            aria-label="Coordinator Sections"
            className="inline-flex rounded-lg border border-slate-800 bg-[#0a0e1a] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'COORDINATOR'}
              onClick={() => setActiveTab('COORDINATOR')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'COORDINATOR'
                  ? 'bg-[#3b82f6] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Agents &amp; Skeptic Gate
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'EXECUTION'}
              onClick={() => setActiveTab('EXECUTION')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'EXECUTION'
                  ? 'bg-[#3b82f6] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Ledger &amp; Margin ({openCount})
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className="border-b border-[#3b82f6]/30 bg-[#3b82f6]/10 px-5 py-2 text-xs text-blue-200 flex items-center justify-between gap-2"
        >
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-300 hover:text-white text-[11px] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {(!testnetExecutionEnabled || !liveFeedModulesEnabled) && (
        <div
          role="status"
          className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            {!liveFeedModulesEnabled && !testnetExecutionEnabled
              ? 'Binance Testnet Execution & Live Feed Modules paused — Signal Generation Engine, Top Gainers Scanner & Telegram Dispatcher remain active.'
              : !liveFeedModulesEnabled
              ? 'Live Spot/Futures Feed Modules paused — high-frequency WS/REST loops halted cleanly while Signal Engine & Telegram remain active.'
              : 'Binance Testnet Execution paused — Testnet trade loops halted cleanly while Signal Engine & Telegram remain active.'}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {!testnetExecutionEnabled && (
              <button
                type="button"
                onClick={() => setTestnetExecutionEnabled(true)}
                className="rounded-md border border-amber-400/50 bg-[#0d1323] px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20 cursor-pointer whitespace-nowrap"
              >
                Resume Testnet
              </button>
            )}
            {!liveFeedModulesEnabled && (
              <button
                type="button"
                onClick={() => setLiveFeedModulesEnabled(true)}
                className="rounded-md border border-amber-400/50 bg-[#0d1323] px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20 cursor-pointer whitespace-nowrap"
              >
                Resume Live Modules
              </button>
            )}
          </div>
        </div>
      )}

      {/* TAB 1: Multi-Agent Coordinator + Leverage Scaling + Dynamic Futures Margin + Skeptic Gate */}
      {activeTab === 'COORDINATOR' && (
        <div className="p-5 space-y-5">
          {!activePlan ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Synchronizing Binance Spot market telemetry and sub-agents...
            </p>
          ) : (
            <>
              {/* Candidate Selector & Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">Coordinator Feed:</span>
                  {plans.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPlanIndex(idx)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                        idx === selectedPlanIndex
                          ? 'border-[#3b82f6] bg-[#3b82f6]/15 text-white'
                          : 'border-slate-800 bg-[#0a0e1a] text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span className="font-mono">{p.symbol}</span>{' '}
                      <span
                        className={
                          p.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        {p.direction}
                      </span>{' '}
                      <span className="font-mono text-slate-400">
                        {p.confidence}% · {p.marketType === 'SPOT' ? 'SPOT 1x' : `${p.futuresMargin.leverage}x`}
                      </span>
                      <span className="ml-1.5 text-[10px] text-blue-300">
                        ({p.sourceModule === 'SMC_FRVP' ? 'SMC' : p.sourceModule === 'PATTERN_SCANNER' ? 'Pattern' : 'AI'})
                      </span>
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyAction === 'telegram'}
                    onClick={handleManualTelegramRoute}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#3b82f6] cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
                    <span>Route to &ldquo;Signal Forge&rdquo;</span>
                  </button>
                  <button
                    type="button"
                    disabled={
                      busyAction === 'execute' ||
                      activePlan.skeptic.verdict === 'VETOED' ||
                      (!testnetExecutionEnabled && executionState.mode === 'TESTNET')
                    }
                    onClick={handleExecuteTrade}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      activePlan.skeptic.verdict === 'VETOED' ||
                      (!testnetExecutionEnabled && executionState.mode === 'TESTNET')
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-[#3b82f6] text-white hover:bg-blue-500 cursor-pointer'
                    }`}
                  >
                    <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {activePlan.skeptic.verdict === 'VETOED'
                        ? 'Blocked by Skeptic'
                        : !testnetExecutionEnabled && executionState.mode === 'TESTNET'
                        ? 'Testnet Paused'
                        : futuresTradingEnabled && activePlan.marketType === 'USD_M_FUTURES'
                        ? `Execute ${activePlan.futuresMargin.leverage}x ${activePlan.futuresMargin.marginMode} (${executionState.mode})`
                        : `Execute SPOT 1x (${executionState.mode})`}
                    </span>
                  </button>
                </div>
              </div>

              {/* Spot 1x Allocation OR Optional Futures Leverage Scaling Strip */}
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                {futuresTradingEnabled ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-white">
                        <Gauge className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
                        <span>Futures Leverage Scaling:</span>
                      </span>

                      <div
                        role="group"
                        aria-label="Leverage Scaling Mode"
                        className="inline-flex rounded-md border border-slate-800 bg-[#0a0e1a] p-0.5"
                      >
                        <button
                          type="button"
                          onClick={() => onChangeScalingMode('AUTO_VOLATILITY')}
                          className={`rounded px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                            scalingMode === 'AUTO_VOLATILITY'
                              ? 'bg-[#3b82f6] text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Auto ATR-Scaled ({activePlan.futuresMargin.recommendedLeverage}x)
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeScalingMode('MANUAL')}
                          className={`rounded px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                            scalingMode === 'MANUAL'
                              ? 'bg-[#3b82f6] text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Manual
                        </button>
                      </div>

                      {scalingMode === 'MANUAL' && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {LEVERAGE_PRESETS.filter(
                            (l) => l <= activePlan.futuresMargin.maxLeverage
                          ).map((lev) => (
                            <button
                              key={lev}
                              type="button"
                              onClick={() => onChangeManualLeverage(lev)}
                              className={`rounded border px-2 py-1 font-mono text-[11px] cursor-pointer ${
                                manualLeverage === lev
                                  ? 'border-[#3b82f6] bg-[#3b82f6]/20 text-white font-bold'
                                  : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
                              }`}
                            >
                              {lev}x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <div
                        role="group"
                        aria-label="Margin Mode"
                        className="inline-flex rounded-md border border-slate-800 bg-[#0a0e1a] p-0.5"
                      >
                        <button
                          type="button"
                          onClick={() => onChangeMarginMode('CROSS')}
                          className={`rounded px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                            marginMode === 'CROSS'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Cross Margin
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeMarginMode('ISOLATED')}
                          className={`rounded px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                            marginMode === 'ISOLATED'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Isolated
                        </button>
                      </div>

                      <label className="flex items-center gap-1.5 text-slate-300">
                        <span>Notional:</span>
                        <select
                          aria-label="Position Notional USD"
                          value={notionalUsd}
                          onChange={(e) => onChangeNotionalUsd(Number(e.target.value))}
                          className="rounded-md border border-slate-700 bg-[#0a0e1a] px-2.5 py-1 font-mono text-xs text-white focus:border-[#3b82f6] focus:outline-none"
                        >
                          <option value={500}>$500</option>
                          <option value={1500}>$1,500</option>
                          <option value={3000}>$3,000</option>
                          <option value={5000}>$5,000</option>
                          <option value={10000}>$10,000</option>
                        </select>
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                        <span>Binance Spot Priority (1x Unleveraged · Zero Liquidation Risk)</span>
                      </span>
                      {cmcValuations[activePlan.symbol] && (
                        <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                          CMC Valuation: ${formatCryptoPrice(cmcValuations[activePlan.symbol].cmcPriceUsd)} ·{' '}
                          {spotCmcValidations[activePlan.symbol]?.anomalyIsolated
                            ? 'Anomaly Guarded'
                            : 'Spot/CMC Parity Verified'}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <label className="flex items-center gap-1.5 text-slate-300">
                        <span>Spot Principal:</span>
                        <select
                          aria-label="Position Notional USD"
                          value={notionalUsd}
                          onChange={(e) => onChangeNotionalUsd(Number(e.target.value))}
                          className="rounded-md border border-slate-700 bg-[#0a0e1a] px-2.5 py-1 font-mono text-xs text-white focus:border-[#3b82f6] focus:outline-none"
                        >
                          <option value={500}>$500</option>
                          <option value={1500}>$1,500</option>
                          <option value={3000}>$3,000</option>
                          <option value={5000}>$5,000</option>
                          <option value={10000}>$10,000</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}
              </div>

              {/* 7 Unified Sub-Agents Matrix */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                {activePlan.subAgents.map((agent) => {
                  const isSkeptic = agent.id === 'skeptic';
                  const biasColor =
                    agent.bias === 'BULLISH'
                      ? 'text-emerald-400'
                      : agent.bias === 'BEARISH'
                      ? 'text-rose-400'
                      : 'text-amber-400';

                  return (
                    <div
                      key={agent.id}
                      className={`rounded-lg border p-3.5 ${
                        isSkeptic
                          ? 'border-amber-500/35 bg-[#0a0e1a]'
                          : 'border-slate-800/90 bg-[#0d1323]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-white truncate">
                          {agent.name}
                        </span>
                        <span className={`font-mono text-[11px] font-semibold ${biasColor}`}>
                          {agent.bias}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{agent.role}</p>
                      <div className="mt-2 font-mono text-[11px] font-semibold text-slate-200 tabular-nums">
                        {agent.metricLabel}
                      </div>
                      <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
                        {agent.summary}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Split: Dynamic Targets + Spot Principal / Futures Margin vs Skeptic Audit */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="lg:col-span-7 rounded-lg border border-slate-800/90 bg-[#0d1323] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold text-white flex items-center gap-2">
                      <Activity className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
                      <span>
                        {futuresTradingEnabled
                          ? 'Dynamic Futures Margin, TP1–TP3 & ATR Trailing SL'
                          : 'Spot Allocation, TP1–TP3 & ATR Trailing SL'}
                      </span>
                    </h3>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      ATR(14): ${formatCryptoPrice(activePlan.riskPlan.atr14)} (
                      {activePlan.riskPlan.atrPercent}% ·{' '}
                      {activePlan.riskPlan.volatilityRegime} VOL)
                    </span>
                  </div>

                  {/* Spot 1x Summary OR Futures Margin/Liq Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
                    <div className="rounded border border-[#3b82f6]/35 bg-[#3b82f6]/5 p-2.5">
                      <span className="block text-[10px] text-blue-300">
                        {futuresTradingEnabled ? 'DYNAMIC INITIAL MARGIN' : 'SPOT 1x PRINCIPAL'}
                      </span>
                      <span className="text-white font-semibold">
                        ${activePlan.futuresMargin.initialMarginUsd.toLocaleString()}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        {futuresTradingEnabled
                          ? `${activePlan.futuresMargin.leverage}x ${activePlan.futuresMargin.marginMode}`
                          : 'Spot Priority · 1x'}
                      </span>
                    </div>
                    <div className="rounded border border-slate-800 bg-[#0a0e1a] p-2.5">
                      <span className="block text-[10px] text-slate-400">
                        {futuresTradingEnabled
                          ? `MAINT. MARGIN (${(activePlan.futuresMargin.maintenanceMarginRate * 100).toFixed(1)}%)`
                          : 'EST. SPOT FEE (0.1%)'}
                      </span>
                      <span className="text-slate-200 font-semibold">
                        $
                        {futuresTradingEnabled
                          ? activePlan.futuresMargin.maintenanceMarginUsd.toFixed(2)
                          : activePlan.futuresMargin.estimatedFeeUsd.toFixed(2)}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        {futuresTradingEnabled
                          ? `Est. Fee $${activePlan.futuresMargin.estimatedFeeUsd.toFixed(2)}`
                          : 'Spot Execution Fee'}
                      </span>
                    </div>
                    <div
                      className={`rounded border p-2.5 ${
                        futuresTradingEnabled
                          ? 'border-rose-500/30 bg-rose-500/5'
                          : 'border-emerald-500/30 bg-emerald-500/5'
                      }`}
                    >
                      <span
                        className={`block text-[10px] ${
                          futuresTradingEnabled ? 'text-rose-300' : 'text-emerald-300'
                        }`}
                      >
                        {futuresTradingEnabled
                          ? `${activePlan.futuresMargin.marginMode} LIQ. PRICE`
                          : 'LIQUIDATION RISK'}
                      </span>
                      <span
                        className={`font-semibold ${
                          futuresTradingEnabled ? 'text-rose-200' : 'text-emerald-200'
                        }`}
                      >
                        {futuresTradingEnabled
                          ? `$${formatCryptoPrice(activePlan.futuresMargin.liquidationPrice)}`
                          : 'NONE (1x Spot)'}
                      </span>
                      <span className="block text-[10px] text-emerald-400">
                        {futuresTradingEnabled
                          ? activePlan.futuresMargin.stopBeforeLiquidationSafe
                            ? 'SL Safe vs Liq'
                            : 'Tighten Leverage'
                          : 'Unleveraged Spot'}
                      </span>
                    </div>
                    <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5">
                      <span className="block text-[10px] text-amber-300">
                        ATR TRAILING SL (MAX {activePlan.riskPlan.maxStopLossPct ?? 2}% CAP)
                      </span>
                      <span className="text-amber-200 font-semibold">
                        ${formatCryptoPrice(activePlan.riskPlan.trailingStopLoss)}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        5x ATR Trail TP ${formatCryptoPrice(activePlan.riskPlan.trailingTakeProfit5xAtr)}
                      </span>
                    </div>
                  </div>

                  {/* Dynamic Take Profits Row */}
                  <div className="grid grid-cols-3 gap-2.5 text-xs font-mono tabular-nums">
                    {activePlan.riskPlan.takeProfits.map((tp, idx) => (
                      <div
                        key={idx}
                        className="rounded border border-emerald-500/25 bg-emerald-500/5 p-2.5"
                      >
                        <span className="block text-[10px] text-emerald-300">
                          DYNAMIC TP{idx + 1} ({activePlan.riskPlan.dynamicRRs[idx]}R)
                        </span>
                        <span className="text-emerald-200 font-semibold">
                          ${formatCryptoPrice(tp)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-5 rounded-lg border border-slate-800/90 bg-[#0d1323] p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold text-white flex items-center gap-2">
                      {activePlan.skeptic.verdict === 'APPROVED' ? (
                        <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <ShieldAlert className="h-4 w-4 text-amber-400" aria-hidden="true" />
                      )}
                      <span>Skeptic Validation Audit</span>
                    </h3>
                    <span
                      className={`font-mono text-xs font-bold ${
                        activePlan.skeptic.verdict === 'APPROVED'
                          ? 'text-emerald-400'
                          : activePlan.skeptic.verdict === 'CAUTION'
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {activePlan.skeptic.verdict} · Risk {activePlan.skeptic.skepticRiskScore}/100
                    </span>
                  </div>

                  {activePlan.skeptic.challenges.length === 0 ? (
                    <div className="flex items-start gap-2 text-xs text-emerald-300/90 pt-1">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>
                        No price overextension, whale netflow conflict, or crowded Futures funding detected.
                      </span>
                    </div>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-amber-200/90 list-disc pl-4">
                      {activePlan.skeptic.challenges.map((ch, i) => (
                        <li key={i}>{ch}</li>
                      ))}
                    </ul>
                  )}

                  <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-2">
                    {activePlan.skeptic.mitigationNote}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: Binance USD-M Futures Cross-Margin Settlement & Live Switch */}
      {activeTab === 'EXECUTION' && (
        <div className="p-5 space-y-5">
          {/* Environment & Actions Banner */}
          <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-[#0d1323] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <FlaskConical
                  className={`h-4 w-4 ${
                    executionState.mode === 'TESTNET' ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="font-bold text-white">
                  Environment:{' '}
                  {executionState.mode === 'TESTNET'
                    ? 'Binance Futures Testnet'
                    : 'Binance USD-M Futures Live'}
                </span>
                <span className="font-mono text-slate-400">({executionState.endpoint})</span>
              </div>
              <p className="text-xs text-slate-400 font-mono tabular-nums">
                Shared Cross-Margin Pool · Executed Futures Orders: {executionState.totalExecutedOrders}
                {executionState.mode === 'LIVE' && !executionState.liveConfigured && (
                  <span className="text-amber-400 ml-2">
                    · Guarded Mirror Mode (add BINANCE_LIVE_API_KEY in secrets for live signing)
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={busyAction === 'settle' || openCount === 0}
                onClick={handleSettleCrossFunding}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer ${
                  openCount === 0
                    ? 'border-slate-800 bg-[#0a0e1a] text-slate-500 cursor-not-allowed'
                    : 'border-slate-700 bg-[#111827] text-white hover:border-[#3b82f6]'
                }`}
              >
                <RefreshCw className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
                <span>Settle 8H Cross Funding</span>
              </button>

              <span
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-mono font-semibold ${
                  executionState.mode === 'LIVE'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {executionState.mode === 'LIVE' ? 'LIVE OTP Verified' : 'TESTNET Guarded'}
                </span>
              </span>
            </div>
          </div>

          {/* Live Cross-Margin Wallet & Settlement Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 font-mono text-xs tabular-nums">
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">CROSS WALLET BALANCE</span>
              <span className="mt-0.5 block text-base font-bold text-white">
                ${liveCrossMargin.walletBalanceUsd.toLocaleString()}
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">CROSS EQUITY (uPnL)</span>
              <span
                className={`mt-0.5 block text-base font-bold ${
                  liveCrossMargin.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                ${liveCrossMargin.crossEquityUsd.toLocaleString()}
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">AVAILABLE CROSS MARGIN</span>
              <span className="mt-0.5 block text-base font-bold text-blue-400">
                ${liveCrossMargin.availableCrossMarginUsd.toLocaleString()}
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
              <span className="block text-[10px] text-slate-400">INITIAL / MAINT. MARGIN</span>
              <span className="mt-0.5 block text-base font-bold text-slate-200">
                ${liveCrossMargin.totalInitialMarginUsd.toLocaleString()} / $
                {liveCrossMargin.totalMaintenanceMarginUsd.toFixed(1)}
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3 col-span-2 sm:col-span-1">
              <span className="block text-[10px] text-slate-400">CROSS MARGIN RATIO</span>
              <span
                className={`mt-0.5 block text-base font-bold ${
                  liveCrossMargin.crossMarginRatioPercent >= 60
                    ? 'text-rose-400'
                    : liveCrossMargin.crossMarginRatioPercent >= 25
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {liveCrossMargin.crossMarginRatioPercent.toFixed(2)}%
              </span>
            </div>
          </div>

          {enrichedPositions.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-6 text-center text-xs text-slate-400">
              No active USD-M Futures positions yet. Select a Skeptic-approved setup in the{' '}
              <button
                type="button"
                onClick={() => setActiveTab('COORDINATOR')}
                className="text-[#3b82f6] hover:underline font-semibold cursor-pointer"
              >
                Agents &amp; Skeptic Gate
              </button>{' '}
              tab and execute with your scaled Cross-Margin leverage.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0d1323] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Contract / Margin</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3">Entry &rarr; Mark</th>
                    <th className="py-2.5 px-3">Initial Margin</th>
                    <th className="py-2.5 px-3">Cross Liq / Trail SL</th>
                    <th className="py-2.5 px-3">P&amp;L (ROE%)</th>
                    <th className="py-2.5 px-3 text-right">Settlement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                  {enrichedPositions.map((pos) => (
                    <tr key={pos.id} className="bg-[#0a0e1a]/50">
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-white">{pos.symbol}</span>
                        <span className="block text-[10px] text-slate-400">
                          {pos.effectiveLev}x {pos.marginMode || 'CROSS'} · ${pos.notionalUsd}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 px-3 font-semibold ${
                          pos.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {pos.direction}
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        ${formatCryptoPrice(pos.entryPrice)} &rarr; $
                        {formatCryptoPrice(pos.livePrice)}
                      </td>
                      <td className="py-2.5 px-3 text-blue-300">
                        ${pos.effectiveIm.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="block text-rose-300">
                          Liq ${formatCryptoPrice(pos.liquidationPrice ?? 0)}
                        </span>
                        <span className="block text-[10px] text-amber-300">
                          Trail SL ${formatCryptoPrice(pos.liveTrailSl)}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 px-3 font-semibold ${
                          pos.livePnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {pos.livePnlUsd >= 0 ? '+' : ''}${pos.livePnlUsd}
                        <span className="block text-[10px]">
                          ROE {pos.liveRoePercent >= 0 ? '+' : ''}
                          {pos.liveRoePercent}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {pos.status === 'OPEN' ? (
                          <button
                            type="button"
                            onClick={() => closeSandboxPosition(pos.id, pos.livePrice)}
                            className="rounded border border-slate-700 bg-[#111827] px-2.5 py-1 text-[11px] text-white hover:border-rose-400 cursor-pointer"
                          >
                            Close &amp; Settle
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-500">Settled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </section>
  );
}
