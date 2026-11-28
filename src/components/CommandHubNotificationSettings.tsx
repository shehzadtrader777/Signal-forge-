import { useCallback, useEffect, useState } from 'react';
import { BellOff, CheckCircle2, RefreshCw, Send, ShieldAlert, Radio } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type {
  AggregatedNonCriticalFailure,
  HealthDigestCadence,
  NotificationSettings,
  SchedulerLeaseRecord,
  SystemOperationalHealth,
} from '../lib/telegramNotificationGovernor';

interface NotificationTelemetrySnapshot {
  settings: NotificationSettings;
  lastReportedHealth: SystemOperationalHealth;
  lastHealthDigestSentAtIso: string | null;
  telegram429BackoffActive: boolean;
  telegram429RetryAfterSec: number;
  activeDedupeCount: number;
  activeSchedulerLeases: SchedulerLeaseRecord[];
  counters: {
    deliveredCount: number;
    suppressedRoutineAuditCount: number;
    deduplicatedCount: number;
    rateLimitedCount: number;
    telegram429Count: number;
    failedCount: number;
  };
  aggregatedNonCriticalFailures: AggregatedNonCriticalFailure[];
}

interface NotificationsStatusResponse {
  ok: boolean;
  workerId: string;
  activeSchedulers: string[];
  telemetry: NotificationTelemetrySnapshot;
}

const CADENCE_OPTIONS: readonly { value: HealthDigestCadence; label: string }[] = [
  { value: 'MANUAL', label: 'Manual Only' },
  { value: '1h', label: 'Every 1 hour' },
  { value: '2h', label: 'Every 2 hours' },
  { value: '4h', label: 'Every 4 hours' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '24h', label: 'Every 24 hours (Default)' },
];

export function CommandHubNotificationSettings() {
  const [status, setStatus] = useState<NotificationsStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [sendingDigest, setSendingDigest] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/notifications/settings');
      if (!res.ok) {
        setFeedback({ tone: 'err', text: `Unable to load notification settings (HTTP ${res.status}).` });
        return;
      }
      const data = (await res.json()) as NotificationsStatusResponse;
      if (data.ok) {
        setStatus(data);
      }
    } catch {
      setFeedback({ tone: 'err', text: 'Failed to connect to notification governor endpoint.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateSettings = async (patch: Partial<NotificationSettings>) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/notifications/settings', {
        method: 'POST',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({ tone: 'err', text: data?.error || 'Failed to persist notification policy.' });
        return;
      }
      setStatus((prev) =>
        prev
          ? { ...prev, telemetry: data.telemetry }
          : {
              ok: true,
              workerId: 'active-worker',
              activeSchedulers: ['telegram_health_monitor'],
              telemetry: data.telemetry,
            }
      );
      setFeedback({ tone: 'ok', text: 'Telegram notification policy persisted to durable state.' });
    } catch {
      setFeedback({ tone: 'err', text: 'Network error updating notification settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSendManualDigest = async () => {
    setSendingDigest(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/notifications/manual-digest', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({ tone: 'err', text: data?.error || 'Manual digest dispatch failed.' });
        return;
      }
      setStatus((prev) => (prev ? { ...prev, telemetry: data.telemetry } : prev));
      setFeedback({
        tone: 'ok',
        text: 'Manual Health Digest evaluated through the Anti-Flood Governor.',
      });
    } catch {
      setFeedback({ tone: 'err', text: 'Network error triggering manual digest.' });
    } finally {
      setSendingDigest(false);
    }
  };

  const telemetry = status?.telemetry;
  const settings = telemetry?.settings;

  return (
    <section
      data-testid="command-hub-notification-settings"
      aria-label="Telegram Anti-Flood & Notification Controls"
      className="rounded-xl border border-slate-800 bg-[#111827] overflow-hidden"
    >
      <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="font-mono text-xs text-blue-400">
            Command Hub · Telegram Anti-Flood Governor
          </div>
          <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
            <BellOff className="h-5 w-5 text-blue-400 shrink-0" aria-hidden="true" />
            <span>Notification Channels, Health Digest Cadence &amp; Flood Protection</span>
          </h2>
          <p className="text-xs text-slate-400">
            Internal monitoring stays active every 60s under a single cross-worker lease, while outbound Telegram alerts fire only on real state transitions, critical risks, recoveries, or your selected digest schedule.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="send-manual-digest-btn"
            disabled={sendingDigest || loading}
            onClick={handleSendManualDigest}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-lg bg-[#3b82f6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{sendingDigest ? 'Sending...' : 'Send Manual Health Digest'}</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadSettings()}
            aria-label="Refresh Notification Governor Telemetry"
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {feedback && (
          <div
            role="status"
            data-testid="notification-settings-feedback"
            className={`rounded-lg border px-4 py-2.5 text-xs flex items-center gap-2 ${
              feedback.tone === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
            }`}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Live Governor Telemetry Strip */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono tabular-nums">
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
            <dt className="font-sans text-[11px] text-slate-400">System Health</dt>
            <dd
              data-testid="governor-health-state"
              className="mt-1 font-bold text-emerald-400"
            >
              {telemetry?.lastReportedHealth ?? 'OPTIMAL'}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
            <dt className="font-sans text-[11px] text-slate-400">Routine Audits Blocked</dt>
            <dd
              data-testid="governor-suppressed-count"
              className="mt-1 font-bold text-blue-300"
            >
              {telemetry?.counters.suppressedRoutineAuditCount ?? 0}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
            <dt className="font-sans text-[11px] text-slate-400">Duplicates Prevented</dt>
            <dd className="mt-1 font-bold text-slate-100">
              {telemetry?.counters.deduplicatedCount ?? 0}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
            <dt className="font-sans text-[11px] text-slate-400">Delivered Alerts</dt>
            <dd
              data-testid="governor-delivered-count"
              className="mt-1 font-bold text-slate-100"
            >
              {telemetry?.counters.deliveredCount ?? 0}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
            <dt className="font-sans text-[11px] text-slate-400">429 Backoff</dt>
            <dd
              className={`mt-1 font-bold ${
                telemetry?.telegram429BackoffActive ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {telemetry?.telegram429BackoffActive
                ? `${telemetry.telegram429RetryAfterSec}s WAIT`
                : 'CLEAR'}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
            <dt className="font-sans text-[11px] text-slate-400">Active Schedulers</dt>
            <dd
              data-testid="governor-scheduler-count"
              className="mt-1 font-bold text-slate-100"
            >
              {status?.activeSchedulers.length ?? 0} singleton
            </dd>
          </div>
        </dl>

        {/* Policy Controls Grid */}
        {settings && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7 space-y-2.5">
              <div className="font-mono text-[11px] text-slate-400 uppercase tracking-wider">
                Personal Admin Stream vs. Public Signal Channel
              </div>

              <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-[#0a0e1a] px-4 py-3 cursor-pointer">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-white">
                    Critical Alerts, State Transitions &amp; Recoveries
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Immediate personal admin notification for protective-order failures, outages, risk breaches, and recovery events.
                  </div>
                </div>
                <input
                  type="checkbox"
                  data-testid="toggle-critical-alerts"
                  disabled={saving}
                  checked={settings.criticalAlertsEnabled}
                  onChange={(e) => void updateSettings({ criticalAlertsEnabled: e.target.checked })}
                  className="mt-1 h-4 w-4 accent-blue-500 shrink-0"
                />
              </label>

              <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-[#0a0e1a] px-4 py-3 cursor-pointer">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-white">
                    Trading Execution Alerts (Personal Admin)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Configurable per-trade fill and closure notifications to personal admin chat. Deduplicated by canonical Trade ID.
                  </div>
                </div>
                <input
                  type="checkbox"
                  data-testid="toggle-trading-alerts"
                  disabled={saving}
                  checked={settings.tradingAlertsEnabled}
                  onChange={(e) => void updateSettings({ tradingAlertsEnabled: e.target.checked })}
                  className="mt-1 h-4 w-4 accent-blue-500 shrink-0"
                />
              </label>

              <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-[#0a0e1a] px-4 py-3 cursor-pointer">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-white flex items-center gap-2">
                    <span>Routine Unchanged OPTIMAL Audit Pings</span>
                    <span className="font-mono text-[10px] text-amber-300">OFF BY DEFAULT</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Keep disabled to prevent repetitive healthy audit messages. Internal self-healing and metrics remain 100% active.
                  </div>
                </div>
                <input
                  type="checkbox"
                  data-testid="toggle-routine-audits"
                  disabled={saving}
                  checked={settings.routineAuditEnabled}
                  onChange={(e) => void updateSettings({ routineAuditEnabled: e.target.checked })}
                  className="mt-1 h-4 w-4 accent-amber-500 shrink-0"
                />
              </label>

              <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-[#0a0e1a] px-4 py-3 cursor-pointer">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-white">
                    Public Signal Channel Publishing (Isolated Stream)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Strictly isolated from admin ops alerts — internal diagnostics and OTP codes are hard-blocked from public channels.
                  </div>
                </div>
                <input
                  type="checkbox"
                  data-testid="toggle-public-signal-channel"
                  disabled={saving}
                  checked={settings.publicSignalPublishingEnabled}
                  onChange={(e) =>
                    void updateSettings({ publicSignalPublishingEnabled: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 accent-blue-500 shrink-0"
                />
              </label>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Radio className="h-4 w-4 text-blue-400" aria-hidden="true" />
                  <span>Scheduled Health Digest Cadence</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Choose how often a single consolidated health summary may be sent when the system remains healthy.
                </p>
                <label htmlFor="health-digest-cadence-select" className="sr-only">
                  Health Digest Cadence
                </label>
                <select
                  id="health-digest-cadence-select"
                  data-testid="health-digest-cadence-select"
                  disabled={saving}
                  value={settings.healthDigestCadence}
                  onChange={(e) =>
                    void updateSettings({
                      healthDigestCadence: e.target.value as HealthDigestCadence,
                    })
                  }
                  className="w-full min-h-[40px] rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-xs text-white focus:border-[#3b82f6] focus:outline-none"
                >
                  {CADENCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="font-mono text-[11px] text-slate-400 space-y-1 pt-1">
                  <div>
                    Last digest:{' '}
                    <span className="text-slate-200">
                      {telemetry?.lastHealthDigestSentAtIso
                        ? new Date(telemetry.lastHealthDigestSentAtIso).toUTCString().slice(5, 25)
                        : 'None dispatched yet'}
                    </span>
                  </div>
                  <div>
                    Worker lease owner:{' '}
                    <span className="text-slate-200 truncate">{status?.workerId ?? '—'}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-white">
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-400" aria-hidden="true" />
                    Aggregated Non-Critical Failures
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {telemetry?.aggregatedNonCriticalFailures.length ?? 0} keys
                  </span>
                </div>
                {telemetry && telemetry.aggregatedNonCriticalFailures.length > 0 ? (
                  <ul className="space-y-1.5 text-[11px] font-mono text-slate-300">
                    {telemetry.aggregatedNonCriticalFailures.slice(0, 4).map((item) => (
                      <li
                        key={item.key}
                        className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-[#0a0e1a] px-2.5 py-1.5"
                      >
                        <span className="truncate">{item.key}</span>
                        <span className="text-amber-300 shrink-0">&times;{item.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    No repeated non-critical errors buffered. Repeated failures are grouped instead of spamming individual Telegram alerts.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
