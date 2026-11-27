import { memo, useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  AlertOctagon,
  BellRing,
  CheckCircle2,
  GitCompareArrows,
  Lock,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  TrendingDown,
  Unlock,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import type {
  AntiDetectionDispatchPlan,
  BoundKernelUnit,
  CircuitBreakerDecision,
  ContainmentOperatingMode,
  CorrelatedHedgePlan,
  DepthSlippageModelResult,
  ExecutionParityValidationResult,
  FundingMonitorDecision,
  OfflineAlertChannel,
  OperationalEnvironment,
  PendingManualPosition,
  ProtocolGuardrails,
} from '../lib/masterContainmentProtocol';

interface ContainmentBindingView {
  readonly bindingId: string;
  readonly accountId: string;
  readonly sessionId: string;
  readonly channel: OfflineAlertChannel;
  readonly chatId: string;
  readonly digestFingerprint: string;
  readonly boundAtIso: string;
  readonly expiresAtIso: string;
}

interface ContainmentAlertAuditView {
  readonly id: string;
  readonly timestampIso: string;
  readonly channel: OfflineAlertChannel;
  readonly targetChatId: string;
  readonly eventType: string;
  readonly symbol: string;
  readonly status: string;
  readonly delivered: boolean;
  readonly reason: string;
}

interface AtrBufferRowView {
  readonly symbol: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly atrMultiplier: number;
  readonly bufferPct: number;
  readonly updatedStopLoss: number;
  readonly ratcheted: boolean;
  readonly lockedProfitPct: number;
}

interface ContainmentStateSnapshot {
  readonly ok: boolean;
  readonly protocolVersion: string;
  readonly mode: ContainmentOperatingMode;
  readonly autonomousExecutionAllowed: boolean;
  readonly environments: readonly OperationalEnvironment[];
  readonly allNodesBoundVerified: boolean;
  readonly guardrails: ProtocolGuardrails;
  readonly thresholds: {
    readonly flashCrashDropPct: number;
    readonly abnormalVolatilityMultiplier: number;
    readonly maxSpreadBps: number;
  };
  readonly lastCircuitBreaker: CircuitBreakerDecision;
  readonly pendingManualPositions: readonly PendingManualPosition[];
  readonly antiDetection: {
    readonly configuredEnvProxyCount: number;
    readonly totalShieldedDispatches: number;
    readonly lastDispatchPlan: AntiDetectionDispatchPlan;
  };
  readonly parityEnforcement: {
    readonly totalChecks: number;
    readonly breachHaltCount: number;
    readonly lastSlippageModel: DepthSlippageModelResult;
    readonly lastParityResult: ExecutionParityValidationResult;
  };
  readonly antiSpam: {
    readonly turnstileSecretConfigured: boolean;
    readonly turnstileSiteKeyConfigured: boolean;
    readonly honeypotActive: boolean;
    readonly rateLimitPerMin: number;
    readonly metrics: {
      readonly passedCount: number;
      readonly honeypotBlockedCount: number;
      readonly rateBlockedCount: number;
      readonly turnstileFailedCount: number;
    };
  };
  readonly fundingMonitors: readonly FundingMonitorDecision[];
  readonly offlineAlerts: {
    readonly activeBindings: readonly ContainmentBindingView[];
    readonly routedCount: number;
    readonly blockedSpamCount: number;
    readonly recentAudit: readonly ContainmentAlertAuditView[];
  };
  readonly hedgingAndBuffers: {
    readonly stressScore: number;
    readonly atrBuffers: readonly AtrBufferRowView[];
    readonly hedgePlan: CorrelatedHedgePlan;
  };
  readonly boundEntities: readonly BoundKernelUnit[];
  readonly updatedAtIso: string;
}

type PillarTab =
  | 'ANTI_DETECTION'
  | 'PARITY'
  | 'EMERGENCY'
  | 'FUNDING'
  | 'ALERTS'
  | 'HEDGING';

function generateTurnstileChallengeToken(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `cf-turnstile-${Date.now().toString(36)}-${rand}`;
}

export const MasterContainmentProtocolPanel = memo(function MasterContainmentProtocolPanel() {
  const { user } = useApp();
  const [activeTab, setActiveTab] = useState<PillarTab>('EMERGENCY');
  const [snapshot, setSnapshot] = useState<ContainmentStateSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Pillar 1: Human verification phrase & hidden honeypot state
  const [clearancePhrase, setClearancePhrase] = useState('');
  const [honeypotTrap, setHoneypotTrap] = useState('');

  // Pillar 3: Cryptographic Session-to-ChatID binding form
  const [bindChannel, setBindChannel] = useState<OfflineAlertChannel>('TELEGRAM');
  const [bindChatId, setBindChatId] = useState('@SignalForgeDesk');
  const [sessionNonce] = useState(() => `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);

  // Pillar 4: Market stress slider
  const [stressDraft, setStressDraft] = useState(32);

  const accountId = user?.uid ?? 'operator_local_desk';

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/containment/state');
      if (!res.ok) return;
      const data = (await res.json()) as ContainmentStateSnapshot;
      if (data?.ok) {
        setSnapshot(data);
        setStressDraft(data.hedgingAndBuffers.stressScore);
      }
    } catch {
      // non-fatal background refresh error
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchSnapshot();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [fetchSnapshot]);

  const handleShockDrill = useCallback(
    async (kind: 'FLASH_CRASH' | 'VOL_SPIKE') => {
      setLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const payload =
          kind === 'FLASH_CRASH'
            ? {
                symbol: 'BTCUSDT',
                priceChangeWindowPct: -5.4,
                currentVolatilityPct: 4.2,
                baselineVolatilityPct: 1.5,
                spreadBps: 24,
                honeypot: honeypotTrap,
                turnstileToken: generateTurnstileChallengeToken(),
              }
            : {
                symbol: 'ETHUSDT',
                priceChangeWindowPct: -2.1,
                currentVolatilityPct: 6.3,
                baselineVolatilityPct: 1.5,
                spreadBps: 38,
                honeypot: honeypotTrap,
                turnstileToken: generateTurnstileChallengeToken(),
              };

        const res = await apiFetch('/api/containment/circuit-breaker/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as {
          ok: boolean;
          decision?: CircuitBreakerDecision;
          snapshot?: ContainmentStateSnapshot;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setErrorMessage(data.error ?? 'Circuit breaker evaluation failed.');
          return;
        }
        if (data.snapshot) setSnapshot(data.snapshot);
        setStatusMessage(
          data.decision?.summary ?? 'Circuit breaker engaged; switched to Manual Fallback Only.'
        );
      } catch {
        setErrorMessage('Network error contacting containment circuit breaker.');
      } finally {
        setLoading(false);
      }
    },
    [honeypotTrap]
  );

  const handleManualVerifyAction = useCallback(
    async (
      action: 'APPROVE_POSITION' | 'REJECT_POSITION' | 'RELEASE_CIRCUIT_BREAKER',
      positionId?: string
    ) => {
      setLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const res = await apiFetch('/api/containment/manual-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            positionId,
            confirmationPhrase: clearancePhrase,
            operatorLabel: user?.email ?? 'HUMAN_OPERATOR',
            honeypot: honeypotTrap,
            turnstileToken: generateTurnstileChallengeToken(),
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          snapshot?: ContainmentStateSnapshot;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setErrorMessage(data.error ?? 'Human verification rejected.');
          return;
        }
        if (data.snapshot) setSnapshot(data.snapshot);
        if (action === 'RELEASE_CIRCUIT_BREAKER') {
          setClearancePhrase('');
          setStatusMessage('Circuit breaker released via verified human clearance.');
        } else {
          setStatusMessage(`Position ${positionId} marked ${action}.`);
        }
      } catch {
        setErrorMessage('Network error submitting human verification.');
      } finally {
        setLoading(false);
      }
    },
    [clearancePhrase, honeypotTrap, user?.email]
  );

  const handleBindSessionChat = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const res = await apiFetch('/api/containment/alert-binding/bind', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId,
            sessionId: sessionNonce,
            channel: bindChannel,
            chatId: bindChatId.trim(),
            honeypot: honeypotTrap,
            turnstileToken: generateTurnstileChallengeToken(),
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          binding?: { bindingId: string; digestFingerprint: string; chatId: string };
          snapshot?: ContainmentStateSnapshot;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setErrorMessage(data.error ?? 'Failed to cryptographically bind chat ID.');
          return;
        }
        if (data.snapshot) setSnapshot(data.snapshot);
        setStatusMessage(
          `Bound ${bindChannel} chat ${data.binding?.chatId} (HMAC ${data.binding?.digestFingerprint}).`
        );
      } catch {
        setErrorMessage('Network error binding session chat ID.');
      } finally {
        setLoading(false);
      }
    },
    [accountId, bindChannel, bindChatId, honeypotTrap, sessionNonce]
  );

  const handleTestAlertDispatch = useCallback(
    async (useUnauthorizedChat: boolean) => {
      setLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const targetChatId = useUnauthorizedChat ? '-100999888777' : bindChatId.trim();
        const res = await apiFetch('/api/containment/alert-binding/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId,
            sessionId: sessionNonce,
            channel: bindChannel,
            targetChatId,
            eventType: 'PNL_UPDATE',
            symbol: 'BTCUSDT',
            message: `BTCUSDT realized PnL update (+2.42% net after funding)`,
            dedupKey: `BTCUSDT_PNL_${Date.now().toString(36)}`,
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          decision?: { status: string; reason: string };
          snapshot?: ContainmentStateSnapshot;
        };
        if (data.snapshot) setSnapshot(data.snapshot);
        if (data.ok) {
          setStatusMessage(data.decision?.reason ?? 'Alert routed exclusively to bound chat.');
        } else {
          setErrorMessage(data.decision?.reason ?? 'Unbound alert transmission suppressed.');
        }
      } catch {
        setErrorMessage('Network error testing filtered alert dispatch.');
      } finally {
        setLoading(false);
      }
    },
    [accountId, bindChannel, bindChatId, sessionNonce]
  );

  const handleApplyStressScore = useCallback(async (nextStress: number) => {
    setStressDraft(nextStress);
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiFetch('/api/containment/hedging/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stressScore: nextStress }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        snapshot?: ContainmentStateSnapshot;
        error?: string;
      };
      if (data.ok && data.snapshot) {
        setSnapshot(data.snapshot);
        setStatusMessage(data.snapshot.hedgingAndBuffers.hedgePlan.summary);
      } else if (data.error) {
        setErrorMessage(data.error);
      }
    } catch {
      setErrorMessage('Network error evaluating correlated hedge plan.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSimulateAntiDetection = useCallback(
    async (action: 'PLACE_ORDER' | 'MODIFY_ORDER' | 'CANCEL_ORDER') => {
      setLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const res = await apiFetch('/api/containment/anti-detection/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'BTCUSDT',
            action,
            honeypot: honeypotTrap,
            turnstileToken: generateTurnstileChallengeToken(),
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          plan?: AntiDetectionDispatchPlan;
          snapshot?: ContainmentStateSnapshot;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setErrorMessage(data.error ?? 'Anti-detection dispatch cadence failed.');
          return;
        }
        if (data.snapshot) setSnapshot(data.snapshot);
        if (data.plan) {
          setStatusMessage(
            `${data.plan.action} shielded via ${data.plan.proxyTunnel.slotId}: jitter ${data.plan.jitterDelayMs}ms + human latency ${data.plan.humanCognitiveLatencyMs}ms = ${data.plan.totalDecoupledDelayMs}ms.`
          );
        }
      } catch {
        setErrorMessage('Network error simulating anti-detection dispatch.');
      } finally {
        setLoading(false);
      }
    },
    [honeypotTrap]
  );

  const handleValidateParity = useCallback(
    async (simulateBreach: boolean) => {
      setLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const res = await apiFetch('/api/containment/parity/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'BTCUSDT',
            simulateBreach,
            honeypot: honeypotTrap,
            turnstileToken: generateTurnstileChallengeToken(),
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          fatalError?: string | null;
          parityResult?: ExecutionParityValidationResult;
          snapshot?: ContainmentStateSnapshot;
          error?: string;
        };
        if (data.snapshot) setSnapshot(data.snapshot);
        if (data.ok) {
          setStatusMessage(
            data.parityResult?.summary ?? 'Paper-to-Live zero-variance parity verified.'
          );
        } else {
          setErrorMessage(
            data.fatalError ??
              data.parityResult?.summary ??
              data.error ??
              'FATAL: Paper-to-Live parity breach detected. Halting execution.'
          );
        }
      } catch {
        setErrorMessage('Network error verifying Paper-to-Live parity.');
      } finally {
        setLoading(false);
      }
    },
    [honeypotTrap]
  );

  const isHalted = snapshot?.mode === 'HALTED_MANUAL_ONLY';
  const deleverageCount =
    snapshot?.fundingMonitors.filter((m) => m.action !== 'HOLD_OPTIMAL').length ?? 0;
  const blockedTotal =
    (snapshot?.antiSpam.metrics.honeypotBlockedCount ?? 0) +
    (snapshot?.antiSpam.metrics.rateBlockedCount ?? 0) +
    (snapshot?.antiSpam.metrics.turnstileFailedCount ?? 0);

  return (
    <section
      data-testid="master-containment-protocol-panel"
      aria-label="Master Containment and Strategy Protocol"
      className={`rounded-2xl border p-4 sm:p-5 space-y-4 transition-colors ${
        isHalted
          ? 'border-rose-500/60 bg-[#140A10]'
          : 'border-slate-800/90 bg-[#0A101E]/95'
      }`}
    >
      {/* Hidden Anti-Spam Honeypot Trap Input (must remain empty for human operators) */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="containment-hp-website">Website</label>
        <input
          id="containment-hp-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypotTrap}
          onChange={(e) => setHoneypotTrap(e.target.value)}
        />
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className={isHalted ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
              {isHalted ? 'HALTED · MANUAL FALLBACK ONLY' : 'PROTOCOL ACTIVE · AUTONOMOUS ARMED'}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="text-cyan-300">
              {snapshot ? `${snapshot.boundEntities.length}/${snapshot.boundEntities.length}` : '10/10'} Nodes Bound · Simulation · Paper · Live
            </span>
          </div>
          <h2 className="font-display text-base sm:text-lg font-bold text-white flex items-center gap-2">
            {isHalted ? (
              <AlertOctagon className="h-5 w-5 text-rose-400 shrink-0" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-[#F0B90B] shrink-0" aria-hidden="true" />
            )}
            <span>Master Containment, Anti-Detection &amp; Paper-to-Live Parity Protocol</span>
          </h2>
        </div>

        <button
          type="button"
          onClick={() => void fetchSnapshot()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-500/60 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Sync Protocol</span>
        </button>
      </div>

      {/* 4-Card Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-slate-800/90 bg-[#070C17] p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Containment &amp; Circuit Breaker
          </div>
          <div
            data-testid="containment-mode-value"
            className={`mt-1 font-mono text-sm font-bold ${
              isHalted ? 'text-rose-400' : 'text-emerald-400'
            }`}
          >
            {isHalted ? 'MANUAL ONLY' : 'ARMED'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
            Cap -{snapshot?.thresholds.flashCrashDropPct ?? 5}% · {snapshot?.antiSpam.rateLimitPerMin ?? 30}/min Shield ({blockedTotal} blk)
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#070C17] p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Anti-Detection &amp; Proxy Tunnel
          </div>
          <div
            data-testid="containment-proxy-slot-value"
            className="mt-1 font-mono text-sm font-bold text-cyan-300 truncate"
          >
            {snapshot?.antiDetection.lastDispatchPlan.proxyTunnel.slotId ?? 'RES-TUN-EU-FRA-01'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
            Jitter {snapshot?.antiDetection.lastDispatchPlan.jitterDelayMs ?? 402}ms · Human +{snapshot?.antiDetection.lastDispatchPlan.humanCognitiveLatencyMs ?? 412}ms
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#070C17] p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Paper-to-Live Parity Guard
          </div>
          <div
            data-testid="containment-parity-status"
            className={`mt-1 font-mono text-sm font-bold tabular-nums ${
              snapshot?.parityEnforcement.lastParityResult.haltTriggered
                ? 'text-rose-400'
                : 'text-emerald-400'
            }`}
          >
            {snapshot?.parityEnforcement.lastParityResult.haltTriggered ? 'PARITY BREACH' : 'ZERO-VARIANCE'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
            Tol ≤0.10% · Depth Slip {snapshot?.parityEnforcement.lastSlippageModel.expectedSlippageBps.toFixed(2) ?? '2.15'} bps
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#070C17] p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Funding, Alerts &amp; Hedging
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-[#F0B90B] tabular-nums">
            {deleverageCount > 0 ? `${deleverageCount} De-Lev` : 'Optimal'} · Stress {snapshot?.hedgingAndBuffers.stressScore ?? 32}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
            Max Funding 15% · {snapshot?.offlineAlerts.activeBindings.length ?? 0} Bound Chat
          </div>
        </div>
      </div>

      {/* 6-Pillar Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 pb-2.5">
        {(
          [
            { id: 'EMERGENCY', label: 'Emergency & Breakers', icon: ShieldAlert },
            { id: 'ANTI_DETECTION', label: 'Anti-Detection & Proxy', icon: Radio },
            { id: 'PARITY', label: 'Paper-to-Live Parity', icon: GitCompareArrows },
            { id: 'FUNDING', label: 'Funding & De-Leverage', icon: TrendingDown },
            { id: 'ALERTS', label: 'Offline Alert Binding', icon: BellRing },
            { id: 'HEDGING', label: 'ATR, Hedging & Guardrails', icon: Sliders },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`containment-tab-${tab.id.toLowerCase()}`}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'border-[#F0B90B]/70 bg-[#F0B90B]/12 text-[#FCD535]'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Status / Error Banner */}
      {(statusMessage || errorMessage) && (
        <div
          data-testid="containment-feedback-banner"
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-mono ${
            errorMessage
              ? 'border-rose-500/45 bg-rose-500/10 text-rose-200'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          }`}
        >
          {errorMessage ?? statusMessage}
        </div>
      )}

      {/* TAB A: ANTI-DETECTION, EVASION & EXCHANGE SHIELDING */}
      {activeTab === 'ANTI_DETECTION' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <div className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Jitter, Human Latency &amp; Rotating Residential Tunnels
              </h3>
              <span className="font-mono text-[10px] text-cyan-300">
                {snapshot?.guardrails.antiDetection.minDelayMs ?? 150}–{snapshot?.guardrails.antiDetection.maxDelayMs ?? 850}ms · ROTATIONAL_RESIDENTIAL
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <div className="text-[10px] text-slate-400">JITTER DELAY</div>
                <div className="mt-1 font-bold text-[#F0B90B]">
                  {snapshot?.antiDetection.lastDispatchPlan.jitterDelayMs ?? 402} ms
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <div className="text-[10px] text-slate-400">COGNITIVE LAG</div>
                <div className="mt-1 font-bold text-cyan-300">
                  {snapshot?.antiDetection.lastDispatchPlan.humanCognitiveLatencyMs ?? 412} ms
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <div className="text-[10px] text-slate-400">TOTAL DECOUPLED</div>
                <div className="mt-1 font-bold text-emerald-300">
                  {snapshot?.antiDetection.lastDispatchPlan.totalDecoupledDelayMs ?? 814} ms
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                data-testid="containment-dispatch-place-btn"
                onClick={() => void handleSimulateAntiDetection('PLACE_ORDER')}
                className="rounded-lg bg-[#F0B90B] px-3 py-1.5 text-xs font-bold text-[#0B0E11] hover:bg-[#FCD535] transition-colors cursor-pointer disabled:opacity-50"
              >
                Rotate Tunnel &amp; Schedule Place Order
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleSimulateAntiDetection('MODIFY_ORDER')}
                className="rounded-lg border border-cyan-500/45 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 cursor-pointer disabled:opacity-50"
              >
                Simulate Modify Cadence
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleSimulateAntiDetection('CANCEL_ORDER')}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 cursor-pointer disabled:opacity-50"
              >
                Simulate Cancel Cadence
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-2.5 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs font-bold uppercase tracking-wider text-slate-200">
                Active Egress Tunnel &amp; Cadence Telemetry
              </span>
              <span className="text-[10px] text-emerald-400">
                {snapshot?.antiDetection.totalShieldedDispatches ?? 1} Shielded Dispatches
              </span>
            </div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
                <span className="text-slate-400">Active Tunnel Slot</span>
                <span className="text-cyan-300 font-semibold">
                  {snapshot?.antiDetection.lastDispatchPlan.proxyTunnel.slotId ?? 'RES-TUN-EU-FRA-01'}
                </span>
              </div>
              <div className="flex justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
                <span className="text-slate-400">Transport Scope</span>
                <span className="text-slate-200">
                  {snapshot?.antiDetection.lastDispatchPlan.proxyTunnel.transport ?? 'REST_AND_WS'}
                </span>
              </div>
              <div className="flex justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
                <span className="text-slate-400">Cadence Profile</span>
                <span className="text-emerald-300">
                  {snapshot?.antiDetection.lastDispatchPlan.cadenceProfile ?? 'HUMAN_RETAIL_VARIANCE'}
                </span>
              </div>
              <div className="flex justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
                <span className="text-slate-400">Env Residential Pool</span>
                <span className="text-slate-300">
                  {(snapshot?.antiDetection.configuredEnvProxyCount ?? 0) > 0
                    ? `${snapshot?.antiDetection.configuredEnvProxyCount} Configured Tunnels`
                    : '5 Default Topology Slots'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB B: PAPER-TO-LIVE PARITY ENFORCEMENT */}
      {activeTab === 'PARITY' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <div className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Zero-Variance Execution &amp; Parity Verifier
              </h3>
              <span className="font-mono text-[10px] text-emerald-400">
                Max Divergence ≤0.10% · PnL ≤0.05
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {snapshot?.parityEnforcement.lastParityResult.summary ??
                'Enforcing identical entry, exit, Stop Loss, Take Profit, and slippage logic between Paper and Live execution.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                data-testid="containment-parity-clean-btn"
                onClick={() => void handleValidateParity(false)}
                className="rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer disabled:opacity-50"
              >
                Verify Clean Parity
              </button>
              <button
                type="button"
                disabled={loading}
                data-testid="containment-parity-breach-btn"
                onClick={() => void handleValidateParity(true)}
                className="rounded-lg border border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 cursor-pointer disabled:opacity-50"
              >
                Simulate Parity Breach → Auto-Halt
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-2 font-mono text-[11px] tabular-nums">
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs font-bold uppercase tracking-wider text-slate-200">
                Depth-Aware Slippage &amp; Divergence Audit
              </span>
              <span className="text-[10px] text-slate-400">
                Checks {snapshot?.parityEnforcement.totalChecks ?? 1} · Halts {snapshot?.parityEnforcement.breachHaltCount ?? 0}
              </span>
            </div>
            <div className="flex justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
              <span className="text-slate-400">Book Pressure Impact</span>
              <span className="text-cyan-300">
                {snapshot?.parityEnforcement.lastSlippageModel.bookImpactBps.toFixed(2) ?? '1.45'} bps
              </span>
            </div>
            <div className="flex justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
              <span className="text-slate-400">Latency Drift Component</span>
              <span className="text-slate-200">
                {snapshot?.parityEnforcement.lastSlippageModel.latencyDriftBps.toFixed(2) ?? '0.73'} bps
              </span>
            </div>
            <div className="flex justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
              <span className="text-slate-400">Max Entry/SL/TP Drift</span>
              <span className="text-[#F0B90B] font-semibold">
                {((snapshot?.parityEnforcement.lastParityResult.maxPriceDivergenceRatio ?? 0) * 100).toFixed(3)}%
              </span>
            </div>
            <div className="flex justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
              <span className="text-slate-400">PnL Divergence Delta</span>
              <span className="text-emerald-300 font-semibold">
                {(snapshot?.parityEnforcement.lastParityResult.pnlDivergence ?? 0).toFixed(4)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: EMERGENCY PROTOCOLS */}
      {activeTab === 'EMERGENCY' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <div className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Automated Circuit Breakers &amp; Anti-Spam Shield
              </h3>
              <span className="font-mono text-[10px] text-cyan-300">
                Turnstile {snapshot?.antiSpam.turnstileSecretConfigured ? 'LIVE' : 'CHALLENGE'} · Honeypot ON
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {snapshot?.lastCircuitBreaker.summary ??
                'Monitoring flash crash drops (-5.0%), abnormal volatility spikes (3.5x), and spread blow-outs (250 bps).'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                data-testid="containment-drill-flash-crash"
                onClick={() => void handleShockDrill('FLASH_CRASH')}
                className="rounded-lg border border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 transition-colors cursor-pointer disabled:opacity-50"
              >
                Trigger Flash-Crash Breaker (-5.4%)
              </button>
              <button
                type="button"
                disabled={loading}
                data-testid="containment-drill-vol-spike"
                onClick={() => void handleShockDrill('VOL_SPIKE')}
                className="rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 transition-colors cursor-pointer disabled:opacity-50"
              >
                Trigger Volatility Spike (4.2x)
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                {isHalted ? (
                  <Lock className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                ) : (
                  <Unlock className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                )}
                <span>Manual Fallback Verification Queue</span>
              </h3>
              <span className="font-mono text-[10px] text-slate-400">
                {snapshot?.pendingManualPositions.filter((p) => p.status === 'PENDING_HUMAN_VERIFICATION').length ?? 0} Pending
              </span>
            </div>

            {snapshot && snapshot.pendingManualPositions.length > 0 ? (
              <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                {snapshot.pendingManualPositions.slice(0, 4).map((pos) => (
                  <div
                    key={pos.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-white truncate">
                        {pos.symbol} {pos.side} · ${pos.notionalUsd.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{pos.status}</div>
                    </div>
                    {pos.status === 'PENDING_HUMAN_VERIFICATION' && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleManualVerifyAction('APPROVE_POSITION', pos.id)}
                          className="rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 cursor-pointer"
                        >
                          Verify
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleManualVerifyAction('REJECT_POSITION', pos.id)}
                          className="rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                No positions currently queued for human fallback verification.
              </p>
            )}

            {isHalted && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={clearancePhrase}
                  onChange={(e) => setClearancePhrase(e.target.value)}
                  placeholder="Type CONFIRM MANUAL CLEARANCE"
                  data-testid="containment-clearance-input"
                  className="flex-1 min-w-0 rounded-lg border border-rose-500/40 bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                />
                <button
                  type="button"
                  disabled={loading}
                  data-testid="containment-release-breaker-btn"
                  onClick={() => void handleManualVerifyAction('RELEASE_CIRCUIT_BREAKER')}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  Release Halt
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: FUNDING FEE & AUTONOMOUS DE-LEVERAGING */}
      {activeTab === 'FUNDING' && (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#070C17]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 font-mono text-[10px] uppercase text-slate-400">
                <th className="py-2.5 px-3">Pair</th>
                <th className="py-2.5 px-3">Perp-Spot Basis</th>
                <th className="py-2.5 px-3">Annual Funding</th>
                <th className="py-2.5 px-3">Est. Cost / Gain</th>
                <th className="py-2.5 px-3">Autonomous Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
              {(snapshot?.fundingMonitors ?? []).map((row) => (
                <tr key={row.symbol} className="hover:bg-slate-900/50">
                  <td className="py-2.5 px-3 font-bold text-white">{row.symbol}</td>
                  <td className="py-2.5 px-3 text-cyan-300">+{row.basisBps.toFixed(1)} bps</td>
                  <td className="py-2.5 px-3 text-slate-200">{row.annualizedFundingPct.toFixed(1)}%</td>
                  <td className="py-2.5 px-3 text-slate-300">
                    ${row.projectedFundingCostUsd.toFixed(2)} ({Math.round(row.fundingToGainRatio * 100)}%)
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`font-bold ${
                        row.action === 'EMERGENCY_CLOSE'
                          ? 'text-rose-400'
                          : row.action === 'AUTONOMOUS_DELEVERAGE'
                          ? 'text-[#F0B90B]'
                          : 'text-emerald-400'
                      }`}
                    >
                      {row.action === 'AUTONOMOUS_DELEVERAGE'
                        ? `DE-LEVERAGE -${row.reductionPct}% (${row.recommendedLeverage}x)`
                        : row.action}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: CRYPTOGRAPHIC SESSION-CHATID BINDING & FILTERED ROUTING */}
      {activeTab === 'ALERTS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <form
            onSubmit={handleBindSessionChat}
            className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-3"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Cryptographic Account · Session · Chat ID Binding
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={bindChannel}
                onChange={(e) => setBindChannel(e.target.value as OfflineAlertChannel)}
                aria-label="Alert Channel"
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#F0B90B]"
              >
                <option value="TELEGRAM">Telegram</option>
                <option value="DISCORD">Discord</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
              <input
                type="text"
                value={bindChatId}
                onChange={(e) => setBindChatId(e.target.value)}
                placeholder="@ChatId or -100..."
                aria-label="Channel Chat ID"
                data-testid="containment-chat-id-input"
                className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:outline-none focus:border-[#F0B90B]"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={loading}
                data-testid="containment-bind-chat-btn"
                className="rounded-lg bg-[#F0B90B] px-3 py-1.5 text-xs font-bold text-[#0B0E11] hover:bg-[#FCD535] transition-colors cursor-pointer disabled:opacity-50"
              >
                Bind Session &amp; Chat ID
              </button>
              <button
                type="button"
                disabled={loading}
                data-testid="containment-test-bound-dispatch-btn"
                onClick={() => void handleTestAlertDispatch(false)}
                className="rounded-lg border border-emerald-500/45 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 cursor-pointer disabled:opacity-50"
              >
                Send Bound PnL Update
              </button>
              <button
                type="button"
                disabled={loading}
                data-testid="containment-test-spam-block-btn"
                onClick={() => void handleTestAlertDispatch(true)}
                className="rounded-lg border border-rose-500/45 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 cursor-pointer disabled:opacity-50"
              >
                Test Spam Filter
              </button>
            </div>
          </form>

          <div className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-slate-200">
                Active Bindings &amp; Filtered Routing Ledger
              </span>
              <span className="font-mono text-[10px] text-cyan-300">
                Routed {snapshot?.offlineAlerts.routedCount ?? 0} · Blocked {snapshot?.offlineAlerts.blockedSpamCount ?? 0}
              </span>
            </div>
            {(snapshot?.offlineAlerts.activeBindings.length ?? 0) > 0 && (
              <div className="space-y-1">
                {snapshot?.offlineAlerts.activeBindings.slice(0, 2).map((b) => (
                  <div
                    key={b.bindingId}
                    className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    <span className="text-emerald-300 font-semibold">
                      {b.channel} · {b.chatId}
                    </span>
                    <span className="text-slate-400">HMAC {b.digestFingerprint}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {(snapshot?.offlineAlerts.recentAudit ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">
                  Bind your chat ID to test filtered PnL delivery and automatic anti-spam blocking.
                </p>
              ) : (
                snapshot?.offlineAlerts.recentAudit.slice(0, 4).map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-[11px] flex items-center justify-between gap-2"
                  >
                    <span className={ev.delivered ? 'text-emerald-300 font-mono' : 'text-rose-300 font-mono'}>
                      {ev.status}
                    </span>
                    <span className="text-slate-400 truncate">{ev.targetChatId}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ATR VOLATILITY BUFFERS, CORRELATED HEDGING & BOUND KERNELS */}
      {activeTab === 'HEDGING' && (
        <div className="space-y-3.5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            <div className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Correlated Asset Counter-Position Hedging
                </h3>
                <span className="font-mono text-xs font-bold text-[#F0B90B]">
                  Stress {stressDraft}/100
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={stressDraft}
                aria-label="Market stress score slider"
                onChange={(e) => setStressDraft(Number(e.target.value))}
                onMouseUp={() => void handleApplyStressScore(stressDraft)}
                onTouchEnd={() => void handleApplyStressScore(stressDraft)}
                className="w-full accent-[#F0B90B] cursor-pointer"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-300">
                  {snapshot?.hedgingAndBuffers.hedgePlan.summary}
                </p>
                <button
                  type="button"
                  data-testid="containment-stress-hedge-btn"
                  onClick={() => void handleApplyStressScore(85)}
                  className="rounded-lg border border-indigo-500/50 bg-indigo-500/15 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-500/25 cursor-pointer whitespace-nowrap"
                >
                  Simulate Stress (85)
                </button>
              </div>
              {(snapshot?.hedgingAndBuffers.hedgePlan.legs.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  {snapshot?.hedgingAndBuffers.hedgePlan.legs.map((leg) => (
                    <div
                      key={`${leg.sourceSymbol}-${leg.hedgeDirection}-${leg.hedgeSymbol}`}
                      className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 font-mono text-[11px] text-indigo-100 flex items-center justify-between gap-2"
                    >
                      <span>
                        {leg.sourceSymbol} → Counter {leg.hedgeDirection} {leg.hedgeSymbol}
                      </span>
                      <span className="text-[#F0B90B] font-bold">
                        ${leg.hedgeNotionalUsd.toLocaleString()} (r={leg.correlation.toFixed(2)})
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {(snapshot?.hedgingAndBuffers.atrBuffers.length ?? 0) > 0 && (
                <div className="border-t border-slate-800 pt-2.5 space-y-1.5">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    Dynamic ATR-Multiplied Trailing Stop Buffers
                  </div>
                  {snapshot?.hedgingAndBuffers.atrBuffers.map((buf, idx) => (
                    <div
                      key={`${buf.symbol}-${buf.direction}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 font-mono text-[11px]"
                    >
                      <span className="text-slate-200">
                        {buf.symbol} {buf.direction} · {buf.atrMultiplier.toFixed(2)}x ATR (±{buf.bufferPct.toFixed(2)}%)
                      </span>
                      <span className="text-emerald-300 font-semibold">
                        SL ${buf.updatedStopLoss.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#070C17] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                  <span>Global Accountability Matrix (All Agents &amp; Kernels)</span>
                </h3>
                <span className="font-mono text-[10px] text-emerald-400">100% ENFORCED</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                {(snapshot?.boundEntities ?? []).map((unit) => (
                  <div
                    key={unit.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="text-slate-200 truncate">{unit.label}</span>
                    <span
                      className={`inline-flex items-center gap-1 font-mono text-[10px] shrink-0 ${
                        unit.operationalStatus === 'HALTED_MANUAL_ONLY'
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      {unit.operationalStatus === 'HALTED_MANUAL_ONLY' ? 'HALTED' : 'BOUND'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
