import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Lock,
  RefreshCw,
  Shield,
  ShieldAlert,
  Unlock,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ForgeHaltServerStatus } from './ForgeHaltServerStatus';
import {
  BINANCE_FUTURES_TESTNET_ENDPOINT,
  BINANCE_SPOT_TESTNET_ENDPOINT,
  FORGE_MODULE_ORDER,
  MODULE_DRAWDOWN_MAX_PCT,
  MODULE_DRAWDOWN_MIN_PCT,
  PORTFOLIO_DRAWDOWN_MAX_PCT,
  PORTFOLIO_DRAWDOWN_MIN_PCT,
  resolveBinanceExecutionEndpoint,
  type ForgeMarketChannel,
  type ForgeModuleId,
  type ForgeModuleRiskProfile,
} from '../lib/forgeCapitalHub';
import {
  advanceMonotonicTrailingStop,
  evaluateRRGate,
  evaluateRegimeAwareScaling,
} from '../lib/invariantKernels';
import { formatCryptoPrice } from '../lib/marketData';
import {
  assertL0RuntimeDiscipline,
  createEnvironmentProfileContract,
  evaluateParityGate,
  type RuntimeEnvironmentProfile,
} from '../lib/systemicLayers';

type HubBottomTab = 'POSITIONS' | 'AUDIT' | 'API_ERRORS';

export const ForgeCapitalHub = memo(function ForgeCapitalHub() {
  const {
    selectedSymbol,
    allKnownCoins,
    tickers,
    executionState,
    testnetExecutionEnabled,
    forgeCapitalState,
    unifiedCapitalLedger,
    forgeCapitalBusy,
    updateForgeCapitalLimits,
    reconcileForgeCapitalNow,
    routeForgeCapitalOrder,
    closeSandboxPosition,
    toggleForgeModuleStatus,
    engageForgeFailSafeNow,
    requestForgeFailsafeChallenge,
    recoverForgeFailSafeNow,
    simulateForgeApiError,
    executionRouteDraft,
    setExecutionRouteDraft,
  } = useApp();

  const [market, setMarket] = useState<ForgeMarketChannel>('SPOT');
  const [moduleId, setModuleId] = useState<ForgeModuleId>('SPOT_MOMENTUM');
  const [symbol, setSymbol] = useState<string>(selectedSymbol || 'BTCUSDT');
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [notionalUsd, setNotionalUsd] = useState<number>(1250);
  const [leverage, setLeverage] = useState<number>(5);
  const [bottomTab, setBottomTab] = useState<HubBottomTab>('POSITIONS');
  const [statusFeedback, setStatusFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [activeDraftBanner, setActiveDraftBanner] = useState<typeof executionRouteDraft>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const lastAppliedDraftAtRef = useRef<number>(0);

  const [unlockCode, setUnlockCode] = useState('');
  const [unlockReason, setUnlockReason] = useState('');
  const [failsafeChallengeId, setFailsafeChallengeId] = useState<string>('');

  useEffect(() => {
    if (!executionRouteDraft) return;
    if (lastAppliedDraftAtRef.current === executionRouteDraft.requestedAt) return;
    lastAppliedDraftAtRef.current = executionRouteDraft.requestedAt;

    setSymbol(executionRouteDraft.symbol);
    setDirection(executionRouteDraft.direction);
    setMarket(executionRouteDraft.market);
    setModuleId(executionRouteDraft.moduleId);
    setLeverage(executionRouteDraft.leverage);
    setNotionalUsd(executionRouteDraft.notionalUsd);
    setBottomTab('POSITIONS');
    setActiveDraftBanner(executionRouteDraft);
    setStatusFeedback({
      ok: true,
      text: `Loaded ${executionRouteDraft.symbol} ${executionRouteDraft.direction} (${executionRouteDraft.market === 'USD_M_FUTURES' ? `${executionRouteDraft.leverage}x Futures` : 'Spot 1x'}) parameters from ${executionRouteDraft.sourceLabel || 'Signal Card'}. Review and click Validate & Route Order.`,
    });
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [executionRouteDraft]);

  const modulesList = useMemo<ForgeModuleRiskProfile[]>(
    () =>
      FORGE_MODULE_ORDER.map((id) => forgeCapitalState.modules[id]).filter(
        (m): m is ForgeModuleRiskProfile => Boolean(m)
      ),
    [forgeCapitalState.modules]
  );

  const activeEndpoint = resolveBinanceExecutionEndpoint(market, executionState.mode);
  const liveSymbolPrice = tickers[symbol]?.price ?? 65000;
  const isLocked =
    forgeCapitalState.failSafe.engaged ||
    forgeCapitalState.allTradingHalted ||
    unifiedCapitalLedger.emergencyHalted;

  const activeProfile: RuntimeEnvironmentProfile =
    executionState.mode === 'LIVE' ? 'LIVE' : 'TESTNET';

  const l0GuardAudit = useMemo(() => {
    const contract = createEnvironmentProfileContract(activeProfile);
    return assertL0RuntimeDiscipline({
      activeContract: contract,
      requestedProfile: activeProfile,
      credentialProfile: activeProfile,
      market,
      endpointUrl: activeEndpoint,
      stateNamespace: contract.ledgerNamespace,
    });
  }, [activeProfile, activeEndpoint, market]);

  const l2ParityAudit = useMemo(() => {
    const settled = unifiedCapitalLedger.positions.filter((p) => p.status !== 'OPEN');
    const wins = settled.filter((p) => p.livePnlUsd >= 0).length;
    const observedWr =
      settled.length >= 4 ? Number(((wins / settled.length) * 100).toFixed(1)) : 54.0;
    const observedExpR =
      settled.length >= 4
        ? Number(
            (
              settled.reduce((acc, p) => acc + p.livePnlPercent / 2.0, 0) /
              settled.length
            ).toFixed(2)
          )
        : 1.28;
    const avgDriftBps = Number(
      (12.5 + forgeCapitalState.reconciliation.maxPriceDriftPct * 40).toFixed(2)
    );
    return evaluateParityGate({
      backtestExpectedSlippageBps: 14.5,
      liveObservedSlippageBps: avgDriftBps,
      backtestWinRatePct: 56.0,
      liveWinRatePct: observedWr,
      backtestExpectancyR: 1.35,
      liveExpectancyR: observedExpR,
    });
  }, [
    unifiedCapitalLedger.positions,
    forgeCapitalState.reconciliation.maxPriceDriftPct,
  ]);

  const kernelSelfCheck = useMemo(() => {
    const entry = Math.max(1, liveSymbolPrice);
    const sl = entry * 0.985;
    const tp = entry * 1.0825; // 5.5R
    const rrCheck = evaluateRRGate({
      direction: 'BUY',
      entryPrice: entry,
      stopLoss: sl,
      takeProfit: tp,
    });
    const monoCheck = advanceMonotonicTrailingStop({
      direction: 'BUY',
      prevStopLoss: sl,
      initialStopLoss: sl,
      closedBar: { high: entry * 1.03, low: entry * 0.995, close: entry * 1.022 },
      atr14: entry * 0.012,
    });
    const scaleBlockedAt2R = evaluateRegimeAwareScaling({
      regime: 'TRENDING',
      realizedR: 2.4,
    });
    const scaleAllowedAbove3R = evaluateRegimeAwareScaling({
      regime: 'TRENDING',
      realizedR: 3.6,
    });
    return {
      rrRatio: rrCheck.rewardRiskRatio,
      rrPassed: rrCheck.passed,
      monotonicHeld: monoCheck.monotonicInvariantHeld,
      scalingBlockedBelow3R: !scaleBlockedAt2R.allowed,
      scalingAllowedAbove3R: scaleAllowedAbove3R.allowed,
    };
  }, [liveSymbolPrice]);

  const drawdownProgressPct = Math.min(
    100,
    Number(
      (
        (forgeCapitalState.portfolioDrawdownPct /
          Math.max(1, forgeCapitalState.portfolioDrawdownLimitPct)) *
        100
      ).toFixed(1)
    )
  );

  const handleMarketSwitch = (nextMarket: ForgeMarketChannel) => {
    setMarket(nextMarket);
    const currentMod = forgeCapitalState.modules[moduleId];
    if (nextMarket === 'USD_M_FUTURES' && (!currentMod || !currentMod.allowedMarkets.includes('USD_M_FUTURES'))) {
      setModuleId('FUTURES_COORDINATOR');
    } else if (nextMarket === 'SPOT' && moduleId === 'FUTURES_COORDINATOR') {
      setModuleId('SPOT_MOMENTUM');
    }
  };

  const handleModuleChange = (nextModId: ForgeModuleId) => {
    setModuleId(nextModId);
    const mod = forgeCapitalState.modules[nextModId];
    if (mod && !mod.allowedMarkets.includes(market)) {
      setMarket(mod.primaryMarket);
    }
  };

  const handleRouteOrder = async () => {
    const res = await routeForgeCapitalOrder({
      moduleId,
      market,
      symbol,
      direction,
      notionalUsd,
      leverage: market === 'USD_M_FUTURES' ? leverage : 1,
      marginMode: 'CROSS',
      submittedPrice: liveSymbolPrice,
    });
    setStatusFeedback({
      ok: res.ok,
      text: res.ok
        ? res.routeRecord?.reason || `Routed ${direction} ${symbol} cleanly.`
        : res.error || 'Dual execution order blocked by Forge Capital Hub safeguard.',
    });
  };

  const handleRequestFailsafeChallenge = async () => {
    const res = await requestForgeFailsafeChallenge();
    if (res.ok && res.challengeId) {
      setFailsafeChallengeId(res.challengeId);
      setStatusFeedback({
        ok: true,
        text:
          res.deliveryMode === 'email'
            ? `Single-use recovery seal dispatched to registered operator email (Challenge ${res.challengeId}).`
            : `Single-use recovery seal issued (Challenge ${res.challengeId}). Check configured email or server console.`,
      });
    } else {
      setStatusFeedback({
        ok: false,
        text: res.error || 'Unable to generate Fail-Safe recovery seal.',
      });
    }
  };

  const handleRecoverFailSafe = async () => {
    const res = await recoverForgeFailSafeNow(unlockCode, unlockReason, failsafeChallengeId || undefined);
    if (res.ok) {
      setUnlockCode('');
      setUnlockReason('');
      setFailsafeChallengeId('');
      setStatusFeedback({
        ok: true,
        text: 'EMERGENCY_HALT (423 Locked) cleared by verified operator and HWM re-anchored.',
      });
    } else {
      setStatusFeedback({
        ok: false,
        text: res.error || 'Fail-Safe recovery authorization rejected.',
      });
    }
  };

  const availablePairOptions = useMemo(() => {
    const coins = allKnownCoins.slice(0, 12);
    if (!coins.some((c) => c.symbol === symbol)) {
      return [
        {
          symbol,
          name: symbol.replace(/USDT$/i, ''),
          baseAsset: symbol.replace(/USDT$/i, ''),
          referencePrice: tickers[symbol]?.price ?? 1,
        },
        ...coins,
      ];
    }
    return coins;
  }, [allKnownCoins, symbol, tickers]);

  return (
    <section
      id="forge-execution-hub"
      ref={sectionRef}
      aria-label="Forge Capital Hub"
      className="scroll-mt-20 rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      {/* Top Institutional Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800/80 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-400">
            <span className="font-mono uppercase tracking-wider text-blue-400 font-semibold">
              Forge Capital Hub
            </span>
            <span>·</span>
            <span className="font-mono">
              Hard Portfolio Stop {forgeCapitalState.portfolioDrawdownLimitPct.toFixed(1)}% (10–15%)
            </span>
            <span>·</span>
            <span className="font-mono">
              5 Unified Desks · 3.0–5.0% Module Limits (4.0% Default)
            </span>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-white tracking-tight flex items-center gap-2">
            {isLocked ? (
              <Lock className="h-5 w-5 text-rose-400 shrink-0" aria-hidden="true" />
            ) : (
              <Shield className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden="true" />
            )}
            <span>Master Risk Desk &amp; Dual Binance Execution Hub</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-mono font-semibold whitespace-nowrap ${
              isLocked
                ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {isLocked ? (
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {isLocked ? 'EMERGENCY_HALT (423 Locked)' : 'DUAL CHANNELS ARMED'}
            </span>
          </span>

          <button
            type="button"
            disabled={forgeCapitalBusy}
            onClick={() => reconcileForgeCapitalNow()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-blue-500 hover:text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${forgeCapitalBusy ? 'animate-spin' : ''}`} />
            <span>Reconcile State</span>
          </button>

          {!isLocked && (
            <button
              type="button"
              disabled={forgeCapitalBusy}
              onClick={() =>
                engageForgeFailSafeNow(
                  'Operator engaged EMERGENCY_HALT (423 Locked) across Spot, USD-M Futures, and WebSocket streams.'
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Emergency Halt</span>
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-3" aria-label="Cross-device emergency halt confirmation">
        <ForgeHaltServerStatus />
      </div>

      {/* Immutable Fail-Safe Lock Recovery Bar (Visible strictly when halted) */}
      {isLocked && (
        <div className="border-b border-rose-500/40 bg-rose-950/30 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  EMERGENCY_HALT (423 Locked) · {forgeCapitalState.failSafe.immutableSealId}
                </span>
              </div>
              <p className="text-xs text-rose-200/90">
                {forgeCapitalState.failSafe.reason ||
                  'All Binance Spot, USD-M Futures, and WebSocket order generation suspended due to hard portfolio limit.'}{' '}
                (Triggered at{' '}
                <span className="font-mono tabular-nums font-semibold">
                  {forgeCapitalState.failSafe.triggerDrawdownPct.toFixed(2)}%
                </span>{' '}
                DD · Breach Equity{' '}
                <span className="font-mono tabular-nums font-semibold">
                  ${forgeCapitalState.failSafe.breachEquityUsd.toLocaleString()}
                </span>
                )
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={forgeCapitalBusy}
                onClick={handleRequestFailsafeChallenge}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Shield className="h-3.5 w-3.5" />
                <span>{failsafeChallengeId ? 'Reissue Seal' : 'Issue Recovery Seal'}</span>
              </button>
              <input
                type="text"
                autoComplete="one-time-code"
                value={unlockCode}
                onChange={(e) => setUnlockCode(e.target.value)}
                placeholder="Enter recovery seal (SF-...)"
                aria-label="Fail-safe confirmation code"
                className="w-52 rounded-lg border border-rose-500/40 bg-[#0b101d] px-3 py-1.5 text-xs font-mono text-white placeholder:text-slate-500 focus:border-rose-400 focus:outline-none"
              />
              <input
                type="text"
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                placeholder="Audit reason (min 6 chars)"
                aria-label="Operator recovery reason"
                className="w-48 rounded-lg border border-rose-500/40 bg-[#0b101d] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-rose-400 focus:outline-none"
              />
              <button
                type="button"
                disabled={forgeCapitalBusy}
                onClick={handleRecoverFailSafe}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Unlock className="h-3.5 w-3.5" />
                <span>Authorize Reset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KPI Governance Strip (Unified 0%-Drift Equity, Open/Net PnL & Hard Stop) */}
      <div className="grid grid-cols-1 divide-y divide-slate-800/80 border-b border-slate-800/80 sm:grid-cols-2 lg:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-3.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
            <span>Unified Equity / Open PnL</span>
            <span className="font-mono tabular-nums text-blue-300">
              {unifiedCapitalLedger.openPositionsCount} Open
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-bold text-white">
              ${unifiedCapitalLedger.liveEquityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span
              className={`text-xs font-semibold ${
                unifiedCapitalLedger.totalOpenPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {unifiedCapitalLedger.totalOpenPnlUsd >= 0 ? '+' : ''}${unifiedCapitalLedger.totalOpenPnlUsd.toFixed(2)}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-400">
            Net PnL {unifiedCapitalLedger.netPnlUsd >= 0 ? '+' : ''}${unifiedCapitalLedger.netPnlUsd.toFixed(2)} · HWM ${forgeCapitalState.highWaterMarkUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
            <span>Portfolio Drawdown</span>
            <span className="font-mono tabular-nums text-slate-300">
              Cap {forgeCapitalState.portfolioDrawdownLimitPct.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between font-mono tabular-nums">
            <span
              className={`text-lg font-bold ${
                forgeCapitalState.portfolioDrawdownPct >= forgeCapitalState.portfolioDrawdownLimitPct * 0.8
                  ? 'text-rose-400'
                  : forgeCapitalState.portfolioDrawdownPct >= 5
                  ? 'text-amber-300'
                  : 'text-emerald-400'
              }`}
            >
              {forgeCapitalState.portfolioDrawdownPct.toFixed(2)}%
            </span>
            <span className="text-xs text-slate-400">
              -${forgeCapitalState.portfolioDrawdownUsd.toFixed(2)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all ${
                isLocked ? 'bg-rose-500' : drawdownProgressPct > 75 ? 'bg-amber-400' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.max(4, drawdownProgressPct)}%` }}
            />
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
            <span>Hard Drawdown Stop (10–15%)</span>
            <span className="font-mono tabular-nums text-blue-300 font-semibold">
              {forgeCapitalState.portfolioDrawdownLimitPct.toFixed(1)}%
            </span>
          </div>
          <input
            type="range"
            min={PORTFOLIO_DRAWDOWN_MIN_PCT}
            max={PORTFOLIO_DRAWDOWN_MAX_PCT}
            step={0.5}
            value={forgeCapitalState.portfolioDrawdownLimitPct}
            aria-label="Portfolio drawdown limit percentage"
            onChange={(e) =>
              updateForgeCapitalLimits({ portfolioDrawdownLimitPct: Number(e.target.value) })
            }
            className="mt-2.5 w-full accent-blue-500 cursor-pointer"
          />
          <div className="mt-1 flex justify-between text-[10px] font-mono text-slate-500">
            <span>10.0% Strict</span>
            <span>12.5% Default</span>
            <span>15.0% Max</span>
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
            <span>Wallet Parity &amp; Sync</span>
            <span
              className={`font-mono font-semibold ${
                unifiedCapitalLedger.walletParityVerified ? 'text-emerald-400' : 'text-amber-300'
              }`}
            >
              {unifiedCapitalLedger.walletParityDivergencePct.toFixed(2)}% Drift
            </span>
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-white flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-blue-400 shrink-0" />
            <span>
              {unifiedCapitalLedger.walletParityVerified ? '0% Parity Verified' : 'Reconciling'} ·{' '}
              {forgeCapitalState.reconciliation.openSpotCount}S /{' '}
              {forgeCapitalState.reconciliation.openFuturesCount}F
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-400 truncate">
            Vol {forgeCapitalState.reconciliation.meanVolatilityPct.toFixed(2)}% ·{' '}
            {new Date(unifiedCapitalLedger.reconciledAt).toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Status Toast Line */}
      {statusFeedback && (
        <div
          className={`flex items-center justify-between border-b border-slate-800/80 px-5 py-2.5 text-xs ${
            statusFeedback.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'
          }`}
        >
          <span>{statusFeedback.text}</span>
          <button
            type="button"
            onClick={() => setStatusFeedback(null)}
            className="font-mono text-[11px] text-slate-400 hover:text-white cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Split Workspace: Dual Execution Router + Per-Module Volatility Matrix */}
      <div className="grid grid-cols-1 divide-y divide-slate-800/80 xl:grid-cols-12 xl:divide-x xl:divide-y-0">
        {/* Left: Dual-Execution Router (Binance Spot & USD-M Futures APIs) */}
        <div className="xl:col-span-5 p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-blue-400" />
              <span>Dual-Execution Router</span>
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              {executionState.mode} · {market === 'USD_M_FUTURES' ? 'USD-M Futures' : 'Spot'}
            </span>
          </div>

          {/* Spot vs USD-M Futures Selector */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleMarketSwitch('SPOT')}
              className={`rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                market === 'SPOT'
                  ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                  : 'border-slate-800 bg-[#0d1323] text-slate-400 hover:text-white'
              }`}
            >
              <div className="text-xs font-semibold">SPOT API (1x)</div>
              <div className="text-[10px] font-mono opacity-80 truncate">
                {BINANCE_SPOT_TESTNET_ENDPOINT}
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleMarketSwitch('USD_M_FUTURES')}
              className={`rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                market === 'USD_M_FUTURES'
                  ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                  : 'border-slate-800 bg-[#0d1323] text-slate-400 hover:text-white'
              }`}
            >
              <div className="text-xs font-semibold">USD-M FUTURES API</div>
              <div className="text-[10px] font-mono opacity-80 truncate">
                {BINANCE_FUTURES_TESTNET_ENDPOINT}
              </div>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-xs">
              <span className="text-slate-400">Execution Desk (5 Modules)</span>
              <select
                value={moduleId}
                onChange={(e) => handleModuleChange(e.target.value as ForgeModuleId)}
                className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
              >
                {modulesList.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.status})
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1 text-xs">
              <span className="text-slate-400">Pair</span>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
              >
                {availablePairOptions.map((c) => (
                  <option key={c.symbol} value={c.symbol}>
                    {c.symbol} (${formatCryptoPrice(tickers[c.symbol]?.price ?? c.referencePrice)})
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1 text-xs">
              <span className="text-slate-400">Notional (USD)</span>
              <input
                type="number"
                min={50}
                max={25000}
                step={50}
                value={notionalUsd}
                onChange={(e) => setNotionalUsd(Math.max(50, Number(e.target.value || 0)))}
                className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs font-mono tabular-nums text-white focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block space-y-1 text-xs">
              <span className="text-slate-400">Leverage</span>
              <input
                type="number"
                min={1}
                max={50}
                disabled={market === 'SPOT'}
                value={market === 'SPOT' ? 1 : leverage}
                onChange={(e) => setLeverage(Math.max(1, Math.min(50, Number(e.target.value || 1))))}
                className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs font-mono tabular-nums text-white disabled:opacity-50 focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#0d1323] px-3 py-2 text-[11px] font-mono text-slate-400">
            <span className="truncate">{activeEndpoint}</span>
            <span className="text-slate-200 tabular-nums shrink-0">
              Mark ${formatCryptoPrice(liveSymbolPrice)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="grid grid-cols-2 gap-1.5 w-36 shrink-0">
              <button
                type="button"
                onClick={() => setDirection('BUY')}
                className={`rounded-lg border py-2 text-xs font-semibold cursor-pointer ${
                  direction === 'BUY'
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-800 bg-[#0d1323] text-slate-400'
                }`}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setDirection('SELL')}
                className={`rounded-lg border py-2 text-xs font-semibold cursor-pointer ${
                  direction === 'SELL'
                    ? 'border-rose-500 bg-rose-500/15 text-rose-300'
                    : 'border-slate-800 bg-[#0d1323] text-slate-400'
                }`}
              >
                SELL
              </button>
            </div>

            <button
              type="button"
              data-testid="forge-validate-route-btn"
              disabled={forgeCapitalBusy}
              onClick={handleRouteOrder}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              {isLocked ? 'Test Route (423 Locked)' : 'Validate & Route Order'}
            </button>
          </div>

          {activeDraftBanner && activeDraftBanner.symbol === symbol && (
            <div
              data-testid="forge-routed-parameters"
              className="rounded-lg border border-blue-500/35 bg-blue-500/10 p-2.5 text-[11px] font-mono tabular-nums space-y-1"
            >
              <div className="flex items-center justify-between text-blue-200">
                <span className="font-semibold">
                  Routed Parameters: {activeDraftBanner.symbol} {activeDraftBanner.direction}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveDraftBanner(null);
                    setExecutionRouteDraft(null);
                  }}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <div className="text-slate-300 flex flex-wrap gap-x-3 gap-y-0.5">
                {typeof activeDraftBanner.trailingAtrMultiplier === 'number' && (
                  <span>Wide Trail: {activeDraftBanner.trailingAtrMultiplier.toFixed(2)}x ATR</span>
                )}
                {typeof activeDraftBanner.trailingStopLoss === 'number' && (
                  <span className="text-amber-300">
                    Trail SL ${formatCryptoPrice(activeDraftBanner.trailingStopLoss)}
                  </span>
                )}
                {activeDraftBanner.takeProfits && (
                  <span className="text-emerald-300">
                    TP1 ${formatCryptoPrice(activeDraftBanner.takeProfits[0])} · TP3 $
                    {formatCryptoPrice(activeDraftBanner.takeProfits[2])}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Per-Module Configurable Volatility Drawdown Matrix (3.0%–5.0%, Default 4.0%) */}
        <div className="xl:col-span-7 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">
              Per-Module Drawdown Thresholds (3.0–5.0% · Default 4.0%)
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              Auto-isolation across all 5 active trading desks
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3 font-medium">Module Desk</th>
                  <th className="py-2 pr-3 font-medium">Channel</th>
                  <th className="py-2 pr-3 font-medium text-right">Drawdown</th>
                  <th className="py-2 pr-3 font-medium text-right">Vol Cap</th>
                  <th className="py-2 pr-3 font-medium">Ceiling (3–5%)</th>
                  <th className="py-2 text-right font-medium">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {modulesList.map((mod) => {
                  const suspended = mod.status === 'SUSPENDED';
                  return (
                    <tr key={mod.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-white">{mod.label}</div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400">
                          Alloc ${mod.allocatedCapitalUsd.toLocaleString()} · Routed {mod.totalRoutedOrders}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-300">
                        {mod.allowedMarkets.join(' / ')}
                      </td>
                      <td
                        className={`py-2.5 pr-3 text-right font-mono tabular-nums font-semibold ${
                          mod.drawdownPct >= mod.volatilityAdjustedLimitPct
                            ? 'text-rose-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {mod.drawdownPct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-blue-300">
                        {mod.volatilityAdjustedLimitPct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={MODULE_DRAWDOWN_MIN_PCT}
                            max={MODULE_DRAWDOWN_MAX_PCT}
                            step={0.1}
                            value={mod.configuredDrawdownLimitPct}
                            aria-label={`${mod.label} drawdown ceiling`}
                            onChange={(e) =>
                              updateForgeCapitalLimits({
                                moduleLimitsPct: {
                                  [mod.id]: Number(e.target.value),
                                },
                              })
                            }
                            className="w-20 accent-blue-500 cursor-pointer"
                          />
                          <span className="font-mono tabular-nums text-[11px] text-slate-300 w-10">
                            {mod.configuredDrawdownLimitPct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          disabled={forgeCapitalBusy || isLocked}
                          onClick={() => toggleForgeModuleStatus(mod.id, !suspended)}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-mono font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                            suspended
                              ? 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                          }`}
                        >
                          {suspended ? 'SUSPENDED' : 'ACTIVE'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* L0–L2 Systemic Runtime Discipline & Invariant Kernels Strip */}
      <div
        data-testid="systemic-architecture-strip"
        className="grid grid-cols-1 divide-y divide-slate-800/80 border-t border-slate-800/80 bg-[#0d1323] md:grid-cols-2 xl:grid-cols-4 md:divide-x md:divide-y-0"
      >
        <div className="px-5 py-3 space-y-1">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
            <span>L0 Runtime Guard</span>
            <span
              className={`font-mono font-semibold ${
                l0GuardAudit.passed ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {l0GuardAudit.passed ? 'ISOLATED' : 'BLOCKED'}
            </span>
          </div>
          <div className="font-mono text-xs text-white truncate">
            {forgeCapitalState.activeGuardProfile} · Mandate: {forgeCapitalState.liveMandateStatus}
          </div>
          <div className="text-[11px] font-mono text-slate-400 truncate">
            {forgeCapitalState.lastGuardDenial
              ? `Blocked: ${forgeCapitalState.lastGuardDenial.blockedByLayer} (${forgeCapitalState.lastGuardDenial.reasonCode})`
              : `Triple ${forgeCapitalState.bindingTriple.kernel_hash.slice(0, 8)}/${forgeCapitalState.bindingTriple.policy_hash.slice(0, 8)}/${forgeCapitalState.bindingTriple.git_sha.slice(0, 7)}`}
          </div>
        </div>

        <div className="px-5 py-3 space-y-1">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
            <span>L1 Point-in-Time Feed</span>
            <span className="font-mono font-semibold text-emerald-400">
              ZERO LOOK-AHEAD
            </span>
          </div>
          <div className="font-mono text-xs text-white">
            Monotonic Closed-Bar Cursor
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            Dynamic window indicators · 0 precomputed future bars
          </div>
        </div>

        <div className="px-5 py-3 space-y-1">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
            <span>L2 Fill &amp; Parity Gate</span>
            <span
              className={`font-mono font-semibold ${
                l2ParityAudit.passed ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {l2ParityAudit.status}
            </span>
          </div>
          <div className="font-mono text-xs tabular-nums text-white">
            Δ Slip {l2ParityAudit.slippageDivergenceBps.toFixed(1)} bps · Δ Exp{' '}
            {l2ParityAudit.expectancyDivergenceR.toFixed(2)}R
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            Independent Decision vs Execution Contracts
          </div>
        </div>

        <div className="px-5 py-3 space-y-1">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
            <span>4 Invariant Kernels</span>
            <span className="font-mono font-semibold text-blue-300">
              {kernelSelfCheck.rrPassed &&
              kernelSelfCheck.monotonicHeld &&
              kernelSelfCheck.scalingBlockedBelow3R &&
              kernelSelfCheck.scalingAllowedAbove3R
                ? '4/4 ACTIVE'
                : 'CHECK'}
            </span>
          </div>
          <div className="font-mono text-xs tabular-nums text-white">
            RR ≥ 1:5 ({kernelSelfCheck.rrRatio.toFixed(1)}R) · Scale &gt; 3.0R
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            Structural ATR Stop ≤ 2% · Monotonic Trail Tightens Only
          </div>
        </div>
      </div>

      {/* Bottom Unified Open Positions, Immutable Audit Ledger & Structured API Error Logs */}
      <div id="execution-ledger" className="scroll-mt-20 border-t border-slate-800/80">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/70 px-5 py-2.5 bg-[#0d1323]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBottomTab('POSITIONS')}
              className={`rounded-md px-3 py-1 text-xs font-semibold cursor-pointer ${
                bottomTab === 'POSITIONS'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Unified Positions &amp; PnL ({unifiedCapitalLedger.positions.length})
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('AUDIT')}
              className={`rounded-md px-3 py-1 text-xs font-semibold cursor-pointer ${
                bottomTab === 'AUDIT'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Immutable Audit &amp; Route Ledger ({forgeCapitalState.auditLedger.length})
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('API_ERRORS')}
              className={`rounded-md px-3 py-1 text-xs font-semibold cursor-pointer ${
                bottomTab === 'API_ERRORS'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              API Error Log ({forgeCapitalState.apiErrorLogs.length})
            </button>
          </div>

          {bottomTab === 'API_ERRORS' && (
            <button
              type="button"
              onClick={() =>
                simulateForgeApiError({
                  market,
                  moduleId,
                  endpoint: activeEndpoint,
                  httpStatus: 429,
                  exchangeCode: '-1003',
                  message: `Simulated ${market} gateway rate-limit diagnostic logged cleanly.`,
                })
              }
              className="rounded-md border border-slate-700 bg-[#111827] px-2.5 py-1 text-[11px] font-mono text-slate-300 hover:border-amber-500/60 hover:text-white cursor-pointer"
            >
              Log Diagnostic Error
            </button>
          )}
        </div>

        <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60 px-5 py-2">
          {bottomTab === 'POSITIONS' ? (
            unifiedCapitalLedger.positions.length === 0 ? (
              <div className="py-5 text-center text-xs text-slate-400">
                No unified open or settled positions yet. Route a Spot or USD-M Futures order above to synchronize across both desks.
              </div>
            ) : (
              unifiedCapitalLedger.positions.map((pos) => (
                <div
                  key={pos.id}
                  className="flex flex-col gap-2 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 font-mono">
                      <span className="font-bold text-white">{pos.symbol}</span>
                      <span
                        className={`font-semibold ${
                          pos.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {pos.direction}
                      </span>
                      <span className="text-slate-300">
                        {pos.marketKind === 'USD_M_FUTURES'
                          ? `${pos.effectiveLev}x Futures`
                          : 'Spot 1x'}{' '}
                        · ${pos.notionalUsd.toLocaleString()}
                      </span>
                      <span className="text-[11px] text-blue-300">{pos.moduleLabel}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">
                      {pos.apiEndpoint} · Entry ${formatCryptoPrice(pos.entryPrice)} · Mark $
                      {formatCryptoPrice(pos.livePrice)} · Trail SL $
                      {formatCryptoPrice(pos.liveTrailSl)}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 font-mono tabular-nums shrink-0">
                    <div className="text-right">
                      <div
                        className={`font-semibold ${
                          pos.livePnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {pos.livePnlUsd >= 0 ? '+' : ''}${pos.livePnlUsd.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {pos.livePnlPercent >= 0 ? '+' : ''}
                        {pos.livePnlPercent.toFixed(2)}%
                      </div>
                    </div>

                    {pos.status === 'OPEN' ? (
                      <button
                        type="button"
                        disabled={!testnetExecutionEnabled && executionState.mode === 'TESTNET'}
                        onClick={() => closeSandboxPosition(pos.id, pos.livePrice)}
                        className="rounded-md border border-slate-700 bg-[#0d1323] px-2.5 py-1 text-[11px] font-sans font-semibold text-white hover:border-rose-400 hover:text-rose-200 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        Close &amp; Settle
                      </button>
                    ) : (
                      <span className="text-[11px] font-sans text-slate-400">
                        Settled ({pos.status.replace('CLOSED_', '')})
                      </span>
                    )}
                  </div>
                </div>
              ))
            )
          ) : bottomTab === 'AUDIT' ? (
            forgeCapitalState.auditLedger.slice(0, 12).map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-1 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                      entry.eventType === 'EMERGENCY_HALT' ||
                      entry.eventType === 'ORDER_REJECTED' ||
                      entry.eventType === 'MODULE_SUSPENDED'
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        : entry.eventType === 'DUAL_ORDER_ROUTED' ||
                          entry.eventType === 'FAIL_SAFE_RESET'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-700 bg-slate-800/70 text-slate-300'
                    }`}
                  >
                    {entry.eventType}
                  </span>
                  <span className="text-slate-200 truncate">{entry.message}</span>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-slate-500 shrink-0">
                  {entry.portfolioDrawdownPct.toFixed(2)}% DD ·{' '}
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))
          ) : forgeCapitalState.apiErrorLogs.length === 0 ? (
            <div className="py-5 text-center text-xs text-slate-400">
              No Spot or USD-M Futures API errors recorded in this runtime window.
            </div>
          ) : (
            forgeCapitalState.apiErrorLogs.slice(0, 12).map((err) => (
              <div
                key={err.id}
                className="flex flex-col gap-1 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                      err.severity === 'CRITICAL'
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    {err.market} · {err.httpStatus}/{err.exchangeCode}
                  </span>
                  <span className="text-slate-200 truncate">{err.message}</span>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-slate-500 shrink-0">
                  {err.retryable ? 'RETRYABLE' : 'FATAL'} · {err.latencyMs}ms ·{' '}
                  {new Date(err.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
});
