import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Play,
  RotateCcw,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  MAINTENANCE_DURATION_PRESETS_MINUTES,
  type PublicMaintenanceAccessMode,
  type SafeMaintenanceState,
} from '../lib/safeMaintenanceProtocol';
import { apiFetch } from '../lib/apiClient';
import { MAINTENANCE_UPDATED_EVENT } from './MaintenanceBannerAndGate';

const PRESET_LABELS: Record<number, string> = {
  60: '1 Hour',
  120: '2 Hours',
  180: '3 Hours',
};

export function MaintenanceManagementPanel() {
  const [state, setState] = useState<SafeMaintenanceState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  // Controls form state
  const [durationPreset, setDurationPreset] = useState<number | 'CUSTOM'>(60);
  const [customMinutes, setCustomMinutes] = useState<number>(45);
  const [scheduleDelayMinutes, setScheduleDelayMinutes] = useState<number>(15);
  const [publicAccessMode, setPublicAccessMode] = useState<PublicMaintenanceAccessMode>('READ_ONLY');
  const [targetVersion, setTargetVersion] = useState<string>('1.4.1-step1');
  const [reason, setReason] = useState<string>(
    'Safe version update with live trading protection enabled.'
  );
  const [explicitResumeConfirmed, setExplicitResumeConfirmed] = useState<boolean>(false);

  const selectedDurationMinutes =
    durationPreset === 'CUSTOM' ? Math.max(5, Math.min(1440, customMinutes || 45)) : durationPreset;

  const notifyGlobalBanner = () => {
    window.dispatchEvent(new Event(MAINTENANCE_UPDATED_EVENT));
  };

  const fetchAdminState = useCallback(async () => {
    try {
      const res = await apiFetch('/api/maintenance/admin');
      const data = await res.json();
      if (res.ok && data?.ok && data.state) {
        setState(data.state as SafeMaintenanceState);
        setPublicAccessMode(data.state.publicAccessMode);
      } else {
        setFeedback({
          tone: 'error',
          message:
            data?.error || 'Authorized operator session required to manage maintenance controls.',
        });
      }
    } catch {
      setFeedback({ tone: 'error', message: 'Unable to reach Safe Maintenance API.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAdminState();
  }, [fetchAdminState]);

  const runMutation = async (
    actionKey: string,
    endpoint: string,
    payload: Record<string, unknown>,
    successMessage: string
  ) => {
    setBusyAction(actionKey);
    setFeedback(null);
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setFeedback({
          tone: 'error',
          message: data?.error || `Operation failed (${res.status}).`,
        });
      } else {
        if (data.state) setState(data.state as SafeMaintenanceState);
        setFeedback({ tone: 'ok', message: successMessage });
        notifyGlobalBanner();
      }
    } catch {
      setFeedback({ tone: 'error', message: 'Network error while updating maintenance protocol.' });
    } finally {
      setBusyAction(null);
    }
  };

  const passedChecksCount =
    state?.safetyChecklist.filter((item) => item.status === 'PASS').length ?? 0;
  const totalChecksCount = state?.safetyChecklist.length ?? 10;
  const canApproveResume =
    Boolean(state) &&
    state!.state === 'AWAITING_APPROVAL' &&
    passedChecksCount === totalChecksCount &&
    explicitResumeConfirmed;

  return (
    <section
      data-testid="maintenance-management-panel"
      className="rounded-xl border border-slate-800 bg-[#111827] overflow-hidden"
    >
      <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-xs text-amber-300">
            Command Hub · Safe Version Update &amp; Live Trading Protection
          </div>
          <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
            <Wrench className="h-5 w-5 text-amber-400" aria-hidden="true" />
            <span>Maintenance Scheduling, Safety Verification &amp; Controlled Resume</span>
          </h3>
        </div>
        {state && (
          <div className="font-mono text-xs tabular-nums flex flex-wrap items-center gap-2">
            <span
              data-testid="maintenance-admin-state"
              className={`rounded-md border px-2.5 py-1 font-bold ${
                state.state === 'NORMAL'
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : state.rollbackActive || state.integrityCorrupted
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                  : 'border-amber-500/40 bg-amber-500/15 text-amber-200'
              }`}
            >
              STATE: {state.state}
            </span>
            <span className="text-slate-400">
              v{state.currentVersion}
              {state.targetVersion !== state.currentVersion ? ` → v${state.targetVersion}` : ''}
            </span>
          </div>
        )}
      </div>

      <div className="p-5 space-y-5">
        {feedback && (
          <div
            role="status"
            data-testid="maintenance-feedback"
            className={`rounded-lg border px-4 py-2.5 text-xs ${
              feedback.tone === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/35 text-emerald-200'
                : 'border-rose-500/40 bg-rose-950/35 text-rose-200'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {loading || !state ? (
          <div className="text-xs font-mono text-slate-400 py-4">
            Loading persisted maintenance state from backend...
          </div>
        ) : (
          <>
            {/* Status Overview Grid */}
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">New Live Entries</dt>
                <dd
                  className={`mt-1 font-bold ${
                    state.state === 'NORMAL' && !state.rollbackActive && !state.integrityCorrupted
                      ? 'text-emerald-400'
                      : 'text-amber-300'
                  }`}
                >
                  {state.state === 'NORMAL' && !state.rollbackActive && !state.integrityCorrupted
                    ? 'PERMITTED (NORMAL)'
                    : 'BLOCKED (PROTECTED)'}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Public Access Mode</dt>
                <dd className="mt-1 font-bold text-white">
                  {state.publicAccessMode === 'READ_ONLY' ? 'Read-Only + Banner' : 'Maintenance Page'}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Protected Open Positions</dt>
                <dd className="mt-1 font-bold text-cyan-300">
                  {state.protectedPositions.length} (SL/TP Intact)
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                <dt className="font-sans text-[11px] text-slate-400">Safety Verification</dt>
                <dd className="mt-1 font-bold text-white">
                  {passedChecksCount} / {totalChecksCount} Passed
                </dd>
              </div>
            </dl>

            {/* Controls Configuration */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#0d1323] p-4 space-y-4">
                <div className="font-display text-sm font-bold text-white">
                  Maintenance Window &amp; Public Access Configuration
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] text-slate-400">Duration Preset</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {MAINTENANCE_DURATION_PRESETS_MINUTES.map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        data-testid={`maint-preset-${mins}`}
                        onClick={() => setDurationPreset(mins)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                          durationPreset === mins
                            ? 'border-[#3b82f6] bg-[#3b82f6]/15 text-white'
                            : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
                        }`}
                      >
                        {PRESET_LABELS[mins]}
                      </button>
                    ))}
                    <button
                      type="button"
                      data-testid="maint-preset-custom"
                      onClick={() => setDurationPreset('CUSTOM')}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                        durationPreset === 'CUSTOM'
                          ? 'border-[#3b82f6] bg-[#3b82f6]/15 text-white'
                          : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
                      }`}
                    >
                      Custom
                    </button>
                    {durationPreset === 'CUSTOM' && (
                      <input
                        type="number"
                        min={5}
                        max={1440}
                        value={customMinutes}
                        onChange={(e) => setCustomMinutes(Number(e.target.value))}
                        aria-label="Custom maintenance duration in minutes"
                        className="w-24 rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white"
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <button
                    type="button"
                    data-testid="maint-mode-readonly"
                    onClick={() => setPublicAccessMode('READ_ONLY')}
                    className={`rounded-lg border p-3 text-left cursor-pointer ${
                      publicAccessMode === 'READ_ONLY'
                        ? 'border-blue-500/60 bg-blue-500/12 text-white'
                        : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-semibold">Mode A · Read-Only</div>
                    <div className="mt-0.5 text-[11px] opacity-80">
                      Public views authorized charts &amp; history with running status banner.
                    </div>
                  </button>
                  <button
                    type="button"
                    data-testid="maint-mode-page"
                    onClick={() => setPublicAccessMode('MAINTENANCE_PAGE')}
                    className={`rounded-lg border p-3 text-left cursor-pointer ${
                      publicAccessMode === 'MAINTENANCE_PAGE'
                        ? 'border-amber-500/60 bg-amber-500/12 text-white'
                        : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-semibold">Mode B · Maintenance Page</div>
                    <div className="mt-0.5 text-[11px] opacity-80">
                      Shows temporary maintenance page to public; admin &amp; protections stay active.
                    </div>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">Target Version</span>
                    <input
                      type="text"
                      value={targetVersion}
                      onChange={(e) => setTargetVersion(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">Schedule Delay (min)</span>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={scheduleDelayMinutes}
                      onChange={(e) => setScheduleDelayMinutes(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">Update Reason</span>
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 text-xs text-white"
                    />
                  </label>
                </div>

                {/* Primary Maintenance Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    data-testid="maint-start-btn"
                    disabled={busyAction !== null}
                    onClick={() =>
                      runMutation(
                        'start',
                        '/api/maintenance/start',
                        {
                          durationMinutes: selectedDurationMinutes,
                          publicAccessMode,
                          targetVersion,
                          reason,
                          actor: 'CommandHubOperator',
                        },
                        `Maintenance started (${selectedDurationMinutes}m, ${publicAccessMode}). New live entries paused.`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                  >
                    <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Start Maintenance</span>
                  </button>

                  <button
                    type="button"
                    data-testid="maint-schedule-btn"
                    disabled={busyAction !== null}
                    onClick={() =>
                      runMutation(
                        'schedule',
                        '/api/maintenance/schedule',
                        {
                          startDelayMinutes: scheduleDelayMinutes,
                          durationMinutes: selectedDurationMinutes,
                          publicAccessMode,
                          targetVersion,
                          reason,
                          actor: 'CommandHubOperator',
                        },
                        `Maintenance scheduled in ${scheduleDelayMinutes}m (${selectedDurationMinutes}m window).`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-blue-500 cursor-pointer whitespace-nowrap"
                  >
                    <CalendarClock className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
                    <span>Schedule Maintenance</span>
                  </button>

                  <button
                    type="button"
                    data-testid="maint-extend-btn"
                    disabled={busyAction !== null || state.state === 'NORMAL'}
                    onClick={() =>
                      runMutation(
                        'extend',
                        '/api/maintenance/extend',
                        {
                          additionalMinutes: 60,
                          reason: 'Operator extended maintenance by +1 hour.',
                          actor: 'CommandHubOperator',
                        },
                        'Maintenance window extended by +60 minutes.'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-500/60 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    <Clock className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                    <span>Extend (+1h)</span>
                  </button>

                  <button
                    type="button"
                    data-testid="maint-end-btn"
                    disabled={
                      busyAction !== null ||
                      (state.state !== 'MAINTENANCE' && state.state !== 'PREPARING')
                    }
                    onClick={() =>
                      runMutation(
                        'end',
                        '/api/maintenance/end',
                        {
                          reason: 'Deployment finished — running mandatory safety verification.',
                          actor: 'CommandHubOperator',
                        },
                        'Entered VERIFYING state. Complete all 10 safety checks before controlled resume.'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>End Maintenance &rarr; Verify</span>
                  </button>

                  <button
                    type="button"
                    data-testid="maint-rollback-btn"
                    disabled={busyAction !== null}
                    onClick={() =>
                      runMutation(
                        'rollback',
                        '/api/maintenance/rollback',
                        {
                          reason: 'Operator triggered safe deployment rollback drill.',
                          rollbackToVersion: state.previousStableVersion,
                          actor: 'CommandHubOperator',
                        },
                        `Rolled back safely to v${state.previousStableVersion}. Live entries remain blocked; protections intact.`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Safe Rollback</span>
                  </button>
                </div>
              </div>

              {/* Controlled Resume Gate */}
              <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#0d1323] p-4 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="font-display text-sm font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                    <span>Post-Update Verification &amp; Controlled Resume</span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Timer expiry never auto-enables live trading. Run all 10 safety probes, review every check below, then explicitly approve controlled resumption.
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    data-testid="maint-run-verify-btn"
                    disabled={busyAction !== null || state.state === 'NORMAL'}
                    onClick={() =>
                      runMutation(
                        'verify',
                        '/api/maintenance/verify',
                        { actor: 'CommandHubOperator' },
                        '10-point safety verification completed. Review results before approving resume.'
                      )
                    }
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/60 bg-blue-500/15 px-3.5 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/25 disabled:opacity-40 cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    <span>Run 10-Item Safety Verification</span>
                  </button>

                  <label className="flex items-start gap-2 rounded-lg border border-slate-800 bg-[#0a0e1a] p-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="maint-explicit-approval-checkbox"
                      checked={explicitResumeConfirmed}
                      onChange={(e) => setExplicitResumeConfirmed(e.target.checked)}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <span>
                      I confirm all 10 safety checks passed and explicitly authorize Controlled Resume to NORMAL state.
                    </span>
                  </label>

                  <button
                    type="button"
                    data-testid="maint-approve-resume-btn"
                    disabled={busyAction !== null || !canApproveResume}
                    onClick={() =>
                      runMutation(
                        'resume',
                        '/api/maintenance/approve-resume',
                        {
                          actor: 'CommandHubOperator',
                          explicitApproval: true,
                          clearRollbackFlag: state.rollbackActive,
                          note: '10/10 safety checks verified and approved via Command Hub.',
                        },
                        'Controlled Resume approved — Signal Forge returned to NORMAL operation.'
                      ).then(() => setExplicitResumeConfirmed(false))
                    }
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Approve Controlled Resume</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 10-Item Safety Verification Checklist */}
            <div className="rounded-xl border border-slate-800 bg-[#0d1323] overflow-hidden">
              <div className="border-b border-slate-800 px-4 py-2.5 flex items-center justify-between text-xs">
                <span className="font-display font-bold text-white">
                  10-Point Post-Update Safety Checklist
                </span>
                <span className="font-mono text-slate-400 tabular-nums">
                  {passedChecksCount}/{totalChecksCount} PASS
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:gap-px bg-slate-800/60">
                {state.safetyChecklist.map((item) => (
                  <div
                    key={item.id}
                    className="bg-[#0d1323] px-4 py-2.5 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-100">{item.label}</div>
                      <div className="text-[11px] text-slate-400 leading-snug">{item.detail}</div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 font-mono text-[11px] font-bold shrink-0 ${
                        item.status === 'PASS'
                          ? 'text-emerald-400'
                          : item.status === 'FAIL'
                          ? 'text-rose-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {item.status === 'PASS' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : item.status === 'FAIL' ? (
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Update & Maintenance History */}
            {state.history.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-[#0d1323] p-4 space-y-2">
                <div className="font-display text-xs font-bold text-white">
                  Update &amp; Maintenance Audit History
                </div>
                <ul className="space-y-1.5 text-[11px] font-mono">
                  {state.history.slice(0, 6).map((evt) => (
                    <li
                      key={evt.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800/60 pb-1.5 last:border-b-0 last:pb-0"
                    >
                      <span className="text-slate-200">
                        <strong className="text-blue-300">{evt.action}</strong> ({evt.fromState} &rarr;{' '}
                        {evt.toState}) · {evt.detail}
                      </span>
                      <span className="text-slate-500 shrink-0 tabular-nums">
                        {evt.timestampIso.slice(0, 19).replace('T', ' ')}Z · {evt.actor}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
