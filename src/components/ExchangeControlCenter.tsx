import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import {
  DEFAULT_EXCHANGE_CONTROLS,
  type ExchangeControlProfile,
  type ExchangeRiskSettings,
  type SupportedExchangeId,
} from '../lib/platformArchitecture';
import type { OtpProviderReadiness } from '../lib/otpChallenge';
import { LiveSwitchSecurityModal } from './LiveSwitchSecurityModal';

interface ControlCenterResponse {
  ok: boolean;
  globalExecutionMode: 'TESTNET' | 'LIVE';
  exchanges: ExchangeControlProfile[];
  otpProvider: OtpProviderReadiness;
}

export function ExchangeControlCenter() {
  const { executionState, hasSwitchedLiveOnce, switchExecutionMode, user } = useApp();
  const [exchanges, setExchanges] = useState<ExchangeControlProfile[]>([
    ...DEFAULT_EXCHANGE_CONTROLS,
  ]);
  const [otpProvider, setOtpProvider] = useState<OtpProviderReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<SupportedExchangeId | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [liveModalOpen, setLiveModalOpen] = useState(false);

  const loadControlCenter = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/exchanges/control-center');
      if (!res.ok) return;
      const data = (await res.json()) as ControlCenterResponse;
      if (data.ok && Array.isArray(data.exchanges)) {
        setExchanges(data.exchanges);
      }
      if (data.otpProvider) {
        setOtpProvider(data.otpProvider);
      }
    } catch {
      // keep safe defaults if offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadControlCenter();
  }, [loadControlCenter, executionState.mode]);

  const handleRiskFieldChange = (
    exchangeId: SupportedExchangeId,
    field: keyof ExchangeRiskSettings,
    value: number | boolean
  ) => {
    setExchanges((prev) =>
      prev.map((ex) =>
        ex.id === exchangeId
          ? {
              ...ex,
              riskSettings: {
                ...ex.riskSettings,
                [field]: value,
              },
            }
          : ex
      )
    );
  };

  const handleSaveRisk = async (ex: ExchangeControlProfile) => {
    setFeedback(null);
    setSavingId(ex.id);
    try {
      const res = await apiFetch('/api/exchanges/risk-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchangeId: ex.id,
          ...ex.riskSettings,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'warn',
          text: data.error || `Could not save ${ex.name} risk settings. Operator sign-in required.`,
        });
        return;
      }
      if (Array.isArray(data.exchanges)) {
        setExchanges(data.exchanges);
      }
      setFeedback({
        tone: 'ok',
        text: `${ex.name} risk guardrails saved (Max ${ex.riskSettings.maxRiskPerTradePct}%/trade · ${ex.riskSettings.maxDailyLossPct}% daily loss cap · ${ex.riskSettings.maxLeverage}x max leverage).`,
      });
    } catch {
      setFeedback({
        tone: 'warn',
        text: `Network error saving ${ex.name} risk limits.`,
      });
    } finally {
      setSavingId(null);
    }
  };

  const isLive = executionState.mode === 'LIVE';
  const liveButtonLabel = isLive
    ? 'Switch to Testnet'
    : hasSwitchedLiveOnce
    ? 'Back to Live'
    : 'Switch to Live';

  const handleToggleEnvironment = () => {
    setFeedback(null);
    if (isLive) {
      switchExecutionMode('TESTNET');
      setFeedback({
        tone: 'ok',
        text: 'Returned safely to Paper / Testnet sandbox execution.',
      });
    } else {
      setLiveModalOpen(true);
    }
  };

  return (
    <section
      id="exchange-control-center"
      data-testid="exchange-control-center"
      aria-label="Exchange and Trading Control Center"
      className="scroll-mt-20 rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      {/* Header Bar with Clearly Positioned Switch to Live Control */}
      <div className="flex flex-col gap-4 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-wider text-blue-400">
            Exchange &amp; Trading Control Center
          </div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-white tracking-tight">
            Multi-Exchange Routing, Paper/Demo Isolation &amp; Live Safety Gate
          </h2>
          <p className="text-xs text-slate-400">
            Manage connection status, Paper/Demo availability, Live readiness, and per-exchange risk limits independently across Binance, Bybit, OKX, and Kraken.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void loadControlCenter()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-white cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Sync Status</span>
          </button>

          <button
            type="button"
            data-testid="exchange-center-switch-live-btn"
            onClick={handleToggleEnvironment}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              isLive
                ? 'border border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
            }`}
          >
            <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{liveButtonLabel}</span>
          </button>
        </div>
      </div>

      {/* Live Transition Safety Readiness Strip */}
      <div className="border-b border-slate-800/80 bg-[#0a0e1a]/75 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono">
          <span className="inline-flex items-center gap-1.5">
            {isLive ? (
              <Activity className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            ) : (
              <FlaskConical className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            )}
            <span className="text-slate-400">Active Environment:</span>
            <span className={isLive ? 'font-bold text-amber-300' : 'font-bold text-emerald-400'}>
              {isLive ? 'LIVE (Guarded)' : 'PAPER / TESTNET'}
            </span>
          </span>
          <span className="text-slate-700" aria-hidden="true">|</span>
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
            <span className="text-slate-400">Email OTP Provider:</span>
            <span
              className={
                otpProvider?.resendApiKeyConfigured
                  ? otpProvider.customVerifiedSenderConfigured
                    ? 'text-emerald-400 font-semibold'
                    : 'text-amber-300 font-semibold'
                  : 'text-rose-400 font-semibold'
              }
            >
              {!otpProvider
                ? 'Checking...'
                : !otpProvider.resendApiKeyConfigured
                ? 'RESEND_API_KEY Missing'
                : otpProvider.customVerifiedSenderConfigured
                ? 'Verified Domain Ready'
                : 'Resend Sandbox Sender'}
            </span>
          </span>
          <span className="text-slate-700" aria-hidden="true">|</span>
          <span className="inline-flex items-center gap-1.5">
            {user ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            )}
            <span className="text-slate-400">Operator Auth:</span>
            <span className={user ? 'text-emerald-400 font-semibold' : 'text-amber-300 font-semibold'}>
              {user ? 'Authenticated' : 'Sign-In Required for Live'}
            </span>
          </span>
        </div>

        <span className="text-[11px] text-slate-400">
          Live Trading stays locked until Email OTP, intent confirmation, and safety checks pass.
        </span>
      </div>

      {feedback && (
        <div
          role="status"
          className={`mx-5 mt-4 rounded-lg border px-3.5 py-2.5 text-xs ${
            feedback.tone === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Per-Exchange Control Matrix */}
      <div className="p-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        {exchanges.map((ex) => {
          const connColor =
            ex.connectionStatus === 'CONNECTED'
              ? 'text-emerald-400'
              : ex.connectionStatus === 'SANDBOX_ONLY'
              ? 'text-blue-300'
              : 'text-slate-400';

          return (
            <article
              key={ex.id}
              data-testid={`exchange-card-${ex.id.toLowerCase()}`}
              className="rounded-xl border border-slate-800 bg-[#0d1323] p-4 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
                  <div>
                    <h3 className="font-display text-base font-bold text-white">{ex.name}</h3>
                    <p className="font-mono text-[11px] text-slate-400 truncate max-w-[260px]">
                      {ex.marketFeedEndpoint}
                    </p>
                  </div>
                  <span className={`font-mono text-[11px] font-semibold ${connColor}`}>
                    {ex.connectionStatus.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Separated Mode Statuses */}
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-800/80 bg-[#0a0e1a] px-2.5 py-2">
                    <dt className="text-[10px] text-slate-400">Paper / Demo</dt>
                    <dd
                      className={`mt-0.5 font-mono font-semibold ${
                        ex.paperDemoActive
                          ? 'text-emerald-400'
                          : ex.paperDemoAvailable
                          ? 'text-blue-300'
                          : 'text-slate-500'
                      }`}
                    >
                      {ex.paperDemoActive
                        ? 'ACTIVE'
                        : ex.paperDemoAvailable
                        ? 'READY'
                        : 'UNAVAILABLE'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800/80 bg-[#0a0e1a] px-2.5 py-2">
                    <dt className="text-[10px] text-slate-400">Live Status</dt>
                    <dd
                      className={`mt-0.5 font-mono font-semibold ${
                        ex.liveTradingEnabled ? 'text-amber-300' : 'text-slate-400'
                      }`}
                    >
                      {ex.liveTradingEnabled ? 'LIVE ARMED' : 'DISABLED'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800/80 bg-[#0a0e1a] px-2.5 py-2">
                    <dt className="text-[10px] text-slate-400">Live API Keys</dt>
                    <dd
                      className={`mt-0.5 font-mono font-semibold ${
                        ex.liveCredentialsConfigured ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {ex.liveCredentialsConfigured ? 'CONFIGURED' : 'NOT SET'}
                    </dd>
                  </div>
                </dl>

                {/* Per-Exchange Risk Settings */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono uppercase tracking-wider text-slate-400">
                      Per-Exchange Risk Limits
                    </span>
                    <span className="font-mono text-slate-500">
                      {ex.supportedMarkets.join(' · ')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <label className="space-y-1">
                      <span className="block text-[10px] text-slate-400">Risk / Trade %</span>
                      <input
                        type="number"
                        step="0.25"
                        min="0.1"
                        max="5"
                        value={ex.riskSettings.maxRiskPerTradePct}
                        onChange={(e) =>
                          handleRiskFieldChange(ex.id, 'maxRiskPerTradePct', Number(e.target.value))
                        }
                        className="w-full rounded-md border border-slate-700 bg-[#0a0e1a] px-2 py-1 font-mono text-xs tabular-nums text-white focus:border-[#3b82f6] focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-slate-400">Daily Loss %</span>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="15"
                        value={ex.riskSettings.maxDailyLossPct}
                        onChange={(e) =>
                          handleRiskFieldChange(ex.id, 'maxDailyLossPct', Number(e.target.value))
                        }
                        className="w-full rounded-md border border-slate-700 bg-[#0a0e1a] px-2 py-1 font-mono text-xs tabular-nums text-white focus:border-[#3b82f6] focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-slate-400">Max Leverage</span>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="20"
                        value={ex.riskSettings.maxLeverage}
                        onChange={(e) =>
                          handleRiskFieldChange(ex.id, 'maxLeverage', Number(e.target.value))
                        }
                        className="w-full rounded-md border border-slate-700 bg-[#0a0e1a] px-2 py-1 font-mono text-xs tabular-nums text-white focus:border-[#3b82f6] focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-slate-400">Max Open</span>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="12"
                        value={ex.riskSettings.maxOpenPositions}
                        onChange={(e) =>
                          handleRiskFieldChange(ex.id, 'maxOpenPositions', Number(e.target.value))
                        }
                        className="w-full rounded-md border border-slate-700 bg-[#0a0e1a] px-2 py-1 font-mono text-xs tabular-nums text-white focus:border-[#3b82f6] focus:outline-none"
                      />
                    </label>
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-slate-400">{ex.notes}</p>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ex.riskSettings.requireStopLoss}
                    onChange={(e) =>
                      handleRiskFieldChange(ex.id, 'requireStopLoss', e.target.checked)
                    }
                    className="accent-blue-500"
                  />
                  <span>Mandatory Stop Loss</span>
                </label>

                <button
                  type="button"
                  disabled={savingId === ex.id}
                  onClick={() => void handleSaveRisk(ex)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#3b82f6] transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  <Save className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
                  <span>{savingId === ex.id ? 'Saving...' : 'Save Risk Caps'}</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="border-t border-slate-800/80 bg-[#0d1323] px-5 py-2.5 flex items-center gap-2 text-[11px] text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
        <span>
          API credentials are strictly server-side environment variables and are never exposed to the browser or client bundles.
        </span>
      </div>

      <LiveSwitchSecurityModal
        open={liveModalOpen}
        onClose={() => setLiveModalOpen(false)}
        onSuccess={() => {
          setFeedback({
            tone: 'ok',
            text: 'LIVE execution authorized after verified Email OTP and safety checklist completion.',
          });
          void loadControlCenter();
        }}
      />
    </section>
  );
}
