import { memo, useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type {
  ConfigHealthStatus,
  ConfigPersistenceStatus,
  OwnerConfigHealthReport,
} from '../lib/serverConfigRegistry';

interface ConfigHealthApiResponse {
  readonly ok: boolean;
  readonly configHealth?: OwnerConfigHealthReport;
  readonly error?: string;
  readonly code?: string;
}

function getStatusBadgeClass(status: ConfigHealthStatus): string {
  switch (status) {
    case 'VERIFIED':
      return 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300';
    case 'CONFIGURED':
      return 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200';
    case 'PENDING_VERIFICATION':
      return 'border-amber-500/45 bg-amber-500/15 text-amber-200';
    case 'PENDING_OWNER_CONFIGURATION':
      return 'border-amber-500/55 bg-amber-500/20 text-amber-200';
    case 'INVALID_FORMAT':
    case 'RESTART_NOT_PERSISTED':
      return 'border-rose-500/50 bg-rose-500/15 text-rose-300';
    default:
      return 'border-slate-700 bg-slate-800/70 text-slate-300';
  }
}

function formatPersistenceLabel(persistence: ConfigPersistenceStatus): string {
  switch (persistence) {
    case 'VERIFIED_PERSISTENT':
      return 'VERIFIED ACROSS RESTART';
    case 'FIRST_BOOT_BASELINE':
      return 'RECORDED (FIRST BOOT)';
    case 'NOT_PERSISTED_AFTER_RESTART':
      return 'RESTART_NOT_PERSISTED';
    default:
      return 'UNCONFIGURED';
  }
}

export const OwnerConfigHealthPanel = memo(function OwnerConfigHealthPanel() {
  const [report, setReport] = useState<OwnerConfigHealthReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authLocked, setAuthLocked] = useState<{
    readonly status: number;
    readonly message: string;
  } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const res = await apiFetch('/api/admin/config-health', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.status === 401 || res.status === 403) {
        setReport(null);
        setAuthLocked({
          status: res.status,
          message:
            res.status === 401
              ? 'Sign in with your verified Owner Google account to inspect server environment and Secrets persistence diagnostics.'
              : 'Access restricted to verified Owner / SUPER_ADMIN accounts.',
        });
        return;
      }
      const data = (await res.json()) as ConfigHealthApiResponse;
      if (!res.ok || !data.ok || !data.configHealth) {
        setErrorText(data.error || `Failed to load configuration health (HTTP ${res.status}).`);
        return;
      }
      setAuthLocked(null);
      setReport(data.configHealth);
    } catch {
      setErrorText('Network error while checking server configuration health.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  return (
    <section
      data-testid="owner-config-health-panel"
      aria-label="Owner-Only Server Secrets and Environment Configuration Health"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-wider text-cyan-400">
            Owner-Only Diagnostics · Zero Secret Values Exposed
          </div>
          <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
            <Server className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />
            <span>Permanent Secrets &amp; Backend Environment Health</span>
          </h2>
          <p className="text-xs text-slate-400 max-w-3xl">
            Verifies live server-side presence, format validity, platform vs local fallback source, and cross-restart persistence without displaying secret values, prefixes, or fragments.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadHealth()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-500/60 hover:text-white transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Re-Check Server Env</span>
        </button>
      </div>

      <div className="p-5 space-y-5 text-xs">
        {authLocked ? (
          <div
            data-testid="owner-config-health-locked"
            className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-4 flex items-start gap-3"
          >
            <Lock className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <div className="font-semibold text-amber-200">
                Owner Authentication Required (HTTP {authLocked.status})
              </div>
              <p className="text-slate-300 leading-relaxed">{authLocked.message}</p>
            </div>
          </div>
        ) : errorText ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" aria-hidden="true" />
            <span>{errorText}</span>
          </div>
        ) : !report ? (
          <div className="py-6 text-center font-mono text-slate-400">
            Loading verified server environment registry...
          </div>
        ) : (
          <>
            {/* Top 3 Priority Readiness Cards: Gemini, CoinGecko, Telegram Canonical Channel */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <article className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-white">Gemini Backend</span>
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${getStatusBadgeClass(
                      report.geminiReadiness.status
                    )}`}
                  >
                    {report.geminiReadiness.status}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  Source: <span className="text-slate-200">{report.geminiReadiness.source}</span> ·{' '}
                  {formatPersistenceLabel(report.geminiReadiness.persistence)}
                </div>
                <p className="text-slate-400 leading-relaxed">{report.geminiReadiness.guidance}</p>
              </article>

              <article className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-white">CoinGecko Market Data</span>
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${getStatusBadgeClass(
                      report.coingeckoReadiness.status
                    )}`}
                  >
                    {report.coingeckoReadiness.status}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  Tier: <span className="text-slate-200 uppercase">{report.coingeckoReadiness.tier}</span> ({report.coingeckoReadiness.endpointHost}) ·{' '}
                  {formatPersistenceLabel(report.coingeckoReadiness.persistence)}
                </div>
                <p className="text-slate-400 leading-relaxed">{report.coingeckoReadiness.guidance}</p>
              </article>

              <article className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-white">Telegram Channel ID</span>
                  <span
                    data-testid="telegram-canonical-channel-status"
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${getStatusBadgeClass(
                      report.telegramReadiness.canonicalChannelStatus
                    )}`}
                  >
                    {report.telegramReadiness.canonicalChannelStatus}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  Bot Token: <span className="text-slate-200">{report.telegramReadiness.botTokenStatus}</span>
                  {report.telegramReadiness.botUsername ? (
                    <> · <span className="text-emerald-300">{report.telegramReadiness.botUsername}</span></>
                  ) : null}
                </div>
                <p className="text-slate-400 leading-relaxed">{report.telegramReadiness.guidance}</p>
              </article>
            </div>

            {/* Runtime Provenance Summary Strip */}
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] px-4 py-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-300">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Boot #{report.runtime.bootCount}
                </span>
                <span>Platform Secrets Tracked: {report.runtime.platformRuntimeKeysTrackedCount}</span>
                <span>
                  Local .env Fallback Keys: {report.runtime.localDotenvLoadedKeysCount}
                </span>
                <span>
                  Runtime: {report.runtime.cloudRunService ? 'Hosted Cloud Run / AI Studio' : report.runtime.nodeEnv}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className="text-emerald-300">VERIFIED {report.summary.verified}</span>
                <span className="text-cyan-300">CONFIGURED {report.summary.configured}</span>
                <span className="text-amber-300">
                  PENDING {report.summary.pendingVerification + report.summary.pendingOwnerConfiguration}
                </span>
                <span className="text-rose-300">
                  ISSUES {report.summary.invalidFormat + report.summary.restartNotPersisted}
                </span>
              </div>
            </div>

            {/* Obsolete / Conflicting Variables Warning */}
            {report.obsoleteWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-amber-200">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                  <span>Obsolete / Conflicting Legacy Variables Detected ({report.obsoleteWarnings.length})</span>
                </div>
                {report.obsoleteWarnings.map((ob) => (
                  <div key={ob.name} className="font-mono text-[11px] text-amber-100/90">
                    • <span className="font-bold">{ob.name}</span> ({ob.source}) &rarr; {ob.message}
                  </div>
                ))}
              </div>
            )}

            {/* Complete Registry Table */}
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-[#0d1323] font-mono text-[10px] uppercase text-slate-400">
                    <th className="px-3.5 py-2.5">Variable</th>
                    <th className="px-3.5 py-2.5">Status</th>
                    <th className="px-3.5 py-2.5">Scope / Source</th>
                    <th className="px-3.5 py-2.5">Restart Persistence</th>
                    <th className="px-3.5 py-2.5">Owner Guidance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 bg-[#0a0f1c]">
                  {report.items.map((item) => (
                    <tr key={item.name} className="hover:bg-slate-900/50">
                      <td className="px-3.5 py-2.5 align-top">
                        <div className="font-mono font-semibold text-white">{item.name}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {item.requirement}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 align-top whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${getStatusBadgeClass(
                            item.status
                          )}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 align-top font-mono text-[11px] text-slate-300 whitespace-nowrap">
                        <div>{item.scope}</div>
                        <div className="text-[10px] text-slate-500">{item.source}</div>
                      </td>
                      <td className="px-3.5 py-2.5 align-top font-mono text-[10px] whitespace-nowrap">
                        <span
                          className={
                            item.persistence === 'VERIFIED_PERSISTENT'
                              ? 'text-emerald-300'
                              : item.persistence === 'NOT_PERSISTED_AFTER_RESTART'
                              ? 'text-rose-300'
                              : 'text-slate-400'
                          }
                        >
                          {formatPersistenceLabel(item.persistence)}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 align-top text-slate-300 leading-relaxed max-w-md">
                        {item.guidance}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Platform Persistence Guidance */}
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-white">
                <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />
                <span>AI Studio Secrets Persistence Rules</span>
              </div>
              {report.platformGuidance.map((line, i) => (
                <p key={i} className="text-[11px] text-slate-400 leading-relaxed">
                  • {line}
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
});
