import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Clock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatCryptoPrice } from '../lib/marketData';
import { PLATFORM_SUBSYSTEM_REGISTRY } from '../lib/platformArchitecture';
import {
  SEEDED_CANONICAL_TRADE_LEDGER,
  adaptPublicVerifiedTradeToLifecycle,
  summarizeVerifiedPerformance,
  type CanonicalTradeRecord,
} from '../lib/tradeLifecycleLedger';
import { useCommandControlStore } from '../store/useCommandControlStore';
import { useTradingArchitectureStore } from '../store/useTradingArchitectureStore';
import { PublicLiveMarketOverview } from '../components/PublicLiveMarketOverview';
import { PublicTradeIdVerification } from '../components/PublicTradeIdVerification';
import { AiWelcomeAssistant } from '../components/AiWelcomeAssistant';

const HOW_IT_WORKS_STEPS = [
  {
    num: '01',
    title: 'Real-Time Market Ingestion & Parity Validation',
    description:
      'Live Spot and Futures feeds are continuously reconciled against candlestick history with automated outlier quarantine before any signal is scored.',
  },
  {
    num: '02',
    title: 'Multi-Agent Strategy & Skeptic Risk Filtering',
    description:
      'Technical momentum, Smart Money Concepts, and volume profile setups pass through an independent Skeptic Agent and hard stop-loss invariants.',
  },
  {
    num: '03',
    title: 'Canonical Trade ID & Smart Chart Publication',
    description:
      'Every approved setup receives an auditable Trade ID connecting Strategy, Chart Snapshot, Publication, Execution, Position, Result, and History.',
  },
  {
    num: '04',
    title: 'Paper/Demo Isolation & OTP-Gated Live Controls',
    description:
      'All accounts default to Paper/Testnet simulation. Live execution is disabled in this release, including after email OTP verification.',
  },
];

export function PublicHome() {
  const { user } = useApp();
  const setVoiceOverlayOpen = useCommandControlStore((s) => s.setVoiceOverlayOpen);
  const storeVerifiedTrades = useTradingArchitectureStore((s) => s.verifiedTrades);

  const [apiRecords, setApiRecords] = useState<CanonicalTradeRecord[]>([
    ...SEEDED_CANONICAL_TRADE_LEDGER,
  ]);
  const [requestedVerifyId, setRequestedVerifyId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const qp = new URLSearchParams(window.location.search).get('tradeId');
    return qp && qp.trim() ? qp.trim() : null;
  });
  const [welcomeReopenSignal, setWelcomeReopenSignal] = useState<number>(0);

  useEffect(() => {
    let active = true;
    fetch('/api/public/trade-ledger')
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data?.ok && Array.isArray(data.records) && data.records.length > 0) {
          setApiRecords(data.records);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const ledgerRecords = useMemo<CanonicalTradeRecord[]>(() => {
    const map = new Map<string, CanonicalTradeRecord>();
    for (const rec of apiRecords) {
      map.set(rec.tradeId, rec);
    }
    for (const vt of storeVerifiedTrades) {
      if (!map.has(vt.tradeId)) {
        map.set(vt.tradeId, adaptPublicVerifiedTradeToLifecycle(vt));
      }
    }
    return Array.from(map.values());
  }, [apiRecords, storeVerifiedTrades]);

  const performance = useMemo(
    () => summarizeVerifiedPerformance(ledgerRecords),
    [ledgerRecords]
  );

  const publishedSignals = useMemo(
    () => ledgerRecords.filter((r) => r.recordClass === 'SIGNAL_ONLY'),
    [ledgerRecords]
  );

  const executedTrades = useMemo(
    () => ledgerRecords.filter((r) => r.recordClass === 'EXECUTED_TRADE'),
    [ledgerRecords]
  );

  const handleInspectTradeOnChart = (tradeId: string) => {
    setRequestedVerifyId(tradeId);
    const section = document.getElementById('trade-id-verification');
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleClearRequestedTradeId = useCallback(() => {
    setRequestedVerifyId(null);
  }, []);

  return (
    <div
      data-testid="public-home-page"
      className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 space-y-12"
    >
      {user && (
        <div
          data-testid="public-preview-banner"
          className="rounded-xl border border-blue-500/40 bg-blue-950/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <span className="text-blue-200">
            <strong className="text-white">Public Preview Mode</strong> — You are inspecting the exact public homepage while signed in (private account data remains strictly isolated).
          </span>
          <Link
            to="/dashboard"
            data-testid="public-preview-return-dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3 py-1.5 font-semibold text-white hover:bg-blue-500 whitespace-nowrap"
          >
            <span>Return to Dashboard &rarr;</span>
          </Link>
        </div>
      )}

      {/* 1. Hero & Welcome Section + AI Assistant Introduction */}
      <section className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center border-b border-slate-800/80 pb-10">
        <div className="lg:col-span-7 space-y-5">
          <div className="font-mono text-xs text-blue-400">
            Signal Forge · Auditable Trading Intelligence &amp; Execution Platform
          </div>
          <h1 className="font-display text-[clamp(2.1rem,4vw,3.5rem)] font-bold leading-[1.08] tracking-tight text-white [text-wrap:balance]">
            Structured market signals, transparent Trade ID verification, and disciplined risk controls.
          </h1>
          <p className="max-w-2xl text-sm sm:text-base leading-relaxed text-slate-300">
            Signal Forge connects real-time market feeds, Smart Money chart structure, multi-agent risk vetting, and Paper/Demo exchange routing inside one auditable ledger. Published signals are always separated from executed trades, and Live Trading remains disabled in this release.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              to="/dashboard"
              data-testid="public-open-workspace-cta"
              className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap"
            >
              <span>Open Trading Workspace</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            {!user && (
              <Link
                to="/login"
                data-testid="public-login-cta"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#111827] px-5 py-2.5 text-sm font-semibold text-slate-100 hover:border-blue-500/60 hover:text-white transition-colors whitespace-nowrap"
              >
                <span>Sign In / Create Account</span>
              </Link>
            )}
            <a
              href="#trade-id-verification"
              className="inline-flex items-center gap-1.5 px-2 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap"
            >
              <span>Verify a Trade ID</span>
            </a>
          </div>
        </div>

        {/* AI Assistant Introduction Card */}
        <div className="lg:col-span-5">
          <aside className="rounded-xl border border-slate-800 bg-[#111827] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 shrink-0">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-white">
                  Signal Forge AI Assistant &amp; Voice Hub
                </h2>
                <p className="text-xs text-slate-400">
                  Instant Trade ID lookups, chart summaries &amp; safe navigation
                </p>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-slate-300">
              Ask the floating AI Command Hub to verify any published Trade ID, inspect current market structure, explain risk parameters, or jump straight to Charts, Backtesting, and Exchange Controls without cluttering the interface.
            </p>

            <dl className="grid grid-cols-3 gap-3 border-y border-slate-800 py-3 text-xs font-mono tabular-nums">
              <div>
                <dt className="font-sans text-[11px] text-slate-400">Core Modules</dt>
                <dd className="mt-0.5 text-base font-bold text-white">
                  {PLATFORM_SUBSYSTEM_REGISTRY.length}
                </dd>
              </div>
              <div>
                <dt className="font-sans text-[11px] text-slate-400">Default Mode</dt>
                <dd className="mt-0.5 text-base font-bold text-emerald-400">PAPER</dd>
              </div>
              <div>
                <dt className="font-sans text-[11px] text-slate-400">Live Gate</dt>
                <dd className="mt-0.5 text-base font-bold text-amber-300">OTP + Auth</dd>
              </div>
            </dl>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVoiceOverlayOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-semibold text-white hover:border-blue-500/60 transition-colors cursor-pointer"
              >
                <span>AI Command Hub (⌘K)</span>
              </button>
              <button
                type="button"
                data-testid="public-open-welcome-guide-btn"
                onClick={() => setWelcomeReopenSignal((n) => n + 1)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/12 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/20 transition-colors cursor-pointer"
              >
                <span>Open Welcome Guide</span>
              </button>
            </div>
          </aside>
        </div>
      </section>

      {/* 2. Lightweight Live Market Overview (Verified Market Data Only — Zero Trade Overlays) */}
      <PublicLiveMarketOverview />

      {/* 3. Separate Trade ID Verification Experience (Interactive Smart Chart on Valid ID Only) */}
      <PublicTradeIdVerification
        ledgerRecords={ledgerRecords}
        requestedTradeId={requestedVerifyId}
        onClearRequestedTradeId={handleClearRequestedTradeId}
      />

      {/* 4. Published Trading Signals vs Verified Executed Performance (Strictly Separated) */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Published Trading Signals (Never Counted as Realized Profit) */}
        <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111827] overflow-hidden flex flex-col">
          <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4">
            <div className="font-mono text-xs text-blue-400">Published Signals Feed</div>
            <h2 className="font-display text-lg font-bold text-white">
              Signal Publications (Unexecuted Setups)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Published analytical setups only. Theoretical R:R targets are never reported as realized profit.
            </p>
          </div>
          <div className="p-5 space-y-3 flex-1">
            {publishedSignals.map((sig) => (
              <article
                key={sig.tradeId}
                className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleInspectTradeOnChart(sig.tradeId)}
                    className="font-mono font-bold text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline cursor-pointer text-left"
                  >
                    {sig.tradeId} · {sig.pair} ({sig.timeframe})
                  </button>
                  <span
                    className={`font-mono font-semibold ${
                      sig.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {sig.direction} · Signal Only
                  </span>
                </div>
                <div className="text-slate-300 font-medium">{sig.strategyName}</div>
                <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px] tabular-nums text-slate-300">
                  <div>Signal: ${formatCryptoPrice(sig.signalPrice)}</div>
                  <div className="text-rose-400">SL: ${formatCryptoPrice(sig.stopLoss)}</div>
                  <div className="text-emerald-400">TP: ${formatCryptoPrice(sig.takeProfit)}</div>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
                  <span>Theoretical R:R 1:{sig.projectedRrRatio}</span>
                  <span className="font-mono text-slate-500">Realized PnL: N/A</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        {/* Right: Verified Performance Summary (Executed Trades Only) */}
        <div
          data-testid="public-verified-performance"
          className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111827] overflow-hidden flex flex-col"
        >
          <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-mono text-xs text-emerald-400">
                Executed Ledger · Paper &amp; Demo Verification
              </div>
              <h2 className="font-display text-lg font-bold text-white">
                Verified Executed Performance Summary
              </h2>
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              Mode Split: {performance.modeBreakdown.PAPER} PAPER · {performance.modeBreakdown.DEMO} DEMO · {performance.modeBreakdown.LIVE} LIVE
            </span>
          </div>

          <div className="p-5 space-y-5 flex-1">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Closed Executed</dt>
                <dd className="mt-1 text-lg font-bold text-white">
                  {performance.closedExecutedCount}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Verified Win Rate</dt>
                <dd className="mt-1 text-lg font-bold text-emerald-400">
                  {performance.verifiedWinRatePct !== null
                    ? `${performance.verifiedWinRatePct}%`
                    : '—'}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Net Realized (After Fees)</dt>
                <dd
                  className={`mt-1 text-lg font-bold ${
                    performance.netRealizedPnlAfterFeesUsd >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {performance.netRealizedPnlAfterFeesUsd >= 0 ? '+' : ''}$
                  {performance.netRealizedPnlAfterFeesUsd.toFixed(2)}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Published Signals (Excluded)</dt>
                <dd className="mt-1 text-lg font-bold text-slate-300">
                  {performance.publishedSignalsCount}
                </dd>
              </div>
            </dl>

            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-[#0d1323] text-[11px] text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Trade ID</th>
                    <th className="px-3 py-2 font-medium">Pair / Mode</th>
                    <th className="px-3 py-2 font-medium text-right">Status</th>
                    <th className="px-3 py-2 font-medium text-right">Fees</th>
                    <th className="px-3 py-2 font-medium text-right">Realized PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                  {executedTrades.map((tr) => (
                    <tr key={tr.tradeId} className="hover:bg-slate-800/35">
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => handleInspectTradeOnChart(tr.tradeId)}
                          className="text-blue-300 hover:text-blue-200 font-semibold underline-offset-2 hover:underline cursor-pointer"
                        >
                          {tr.tradeId}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-slate-200">
                        {tr.pair} · {tr.exchange} ({tr.tradingMode})
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-300">
                        {tr.executionStatus.replace(/_/g, ' ')}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-400">
                        {tr.feesUsd !== null ? `$${tr.feesUsd.toFixed(2)}` : '—'}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-semibold ${
                          tr.realizedPnlUsd === null
                            ? 'text-slate-400'
                            : tr.realizedPnlUsd >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {tr.realizedPnlUsd !== null
                          ? `${tr.realizedPnlUsd >= 0 ? '+' : ''}$${tr.realizedPnlUsd.toFixed(2)}`
                          : 'Open Position'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-400 flex items-start gap-2">
              <Clock className="mt-0.5 h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
              <span>{performance.disclaimer}</span>
            </p>
          </div>
        </div>
      </section>

      {/* 5. Features & How It Works */}
      <section aria-label="How Signal Forge Works" className="space-y-5">
        <div className="max-w-2xl">
          <div className="font-mono text-xs text-blue-400">Platform Architecture</div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-white tracking-tight">
            How Signal Forge Moves From Market Feed to Audited Execution
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <article
              key={step.num}
              className="rounded-xl border border-slate-800 bg-[#111827] p-5 space-y-2"
            >
              <div className="font-mono text-xs font-bold text-blue-400">{step.num}.</div>
              <h3 className="font-display text-base font-bold text-white">{step.title}</h3>
              <p className="text-xs leading-relaxed text-slate-400">{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 6. Risk Disclosures & Account Access */}
      <section
        aria-label="Risk Disclosure and Account Access"
        className="rounded-xl border border-slate-800 bg-[#0d1323] p-6 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center"
      >
        <div className="lg:col-span-8 space-y-2">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Important Risk Disclosure &amp; Execution Safeguards</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-300">
            Cryptocurrency spot and derivatives trading carries substantial risk of capital loss. Signal Forge provides automated analytical tooling, Paper/Demo simulation environments, and risk-gated execution workflows for informational and operational support — never guaranteed profit or financial advice. Real-money live trading is disabled by default and requires explicit authenticated verification, Email OTP confirmation, configured exchange credentials, and risk limits.
          </p>
        </div>
        <div className="lg:col-span-4 flex flex-wrap lg:justify-end gap-3">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span>{user ? 'Account Settings' : 'Sign In / Sign Up'}</span>
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#111827] px-4 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-white transition-colors whitespace-nowrap"
          >
            <span>Enter Workspace</span>
          </Link>
        </div>
      </section>

      {/* Lightweight Animated AI Welcome Assistant anchored above existing bottom-right widget */}
      <AiWelcomeAssistant reopenSignal={welcomeReopenSignal} />
    </div>
  );
}
