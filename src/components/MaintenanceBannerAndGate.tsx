import { memo, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Clock, ShieldCheck, Wrench } from 'lucide-react';
import type { PublicMaintenanceSummary } from '../lib/safeMaintenanceProtocol';

export const MAINTENANCE_UPDATED_EVENT = 'sf-maintenance-updated';

const OPERATOR_EXEMPT_PREFIXES = ['/settings', '/dashboard', '/login', '/trust-console', '/test-console'];

function formatRemainingCountdown(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Pending verification';
  if (seconds <= 0) return 'Window elapsed — awaiting safety verification';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

const MaintenanceCountdownText = memo(function MaintenanceCountdownText({
  estimatedEndAtIso,
  fallbackRemainingSeconds,
}: {
  estimatedEndAtIso: string | null | undefined;
  fallbackRemainingSeconds: number | null;
}) {
  const [tickNow, setTickNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!estimatedEndAtIso) return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setTickNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [estimatedEndAtIso]);

  const remainingSeconds = (() => {
    if (!estimatedEndAtIso) return fallbackRemainingSeconds;
    const endMs = new Date(estimatedEndAtIso).getTime();
    if (!Number.isFinite(endMs)) return fallbackRemainingSeconds;
    return Math.max(0, Math.floor((endMs - tickNow) / 1000));
  })();

  return <>{formatRemainingCountdown(remainingSeconds)}</>;
});

export function usePublicMaintenanceStatus(): PublicMaintenanceSummary | null {
  const [summary, setSummary] = useState<PublicMaintenanceSummary | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetch('/api/maintenance/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!active || !data?.ok || !data.maintenance) return;
          setSummary(data.maintenance as PublicMaintenanceSummary);
        })
        .catch(() => undefined);
    };

    load();
    const interval = window.setInterval(load, 30_000);
    const onUpdated = () => load();
    window.addEventListener(MAINTENANCE_UPDATED_EVENT, onUpdated);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener(MAINTENANCE_UPDATED_EVENT, onUpdated);
    };
  }, []);

  return summary;
}

export function MaintenanceBannerAndGate({ children }: { children: ReactNode }) {
  const summary = usePublicMaintenanceStatus();
  const location = useLocation();

  const isOperatorRoute = OPERATOR_EXEMPT_PREFIXES.some((prefix) =>
    location.pathname.startsWith(prefix)
  );

  // Mode B: Temporary Maintenance Page for public visitors while operator/protection routes stay reachable
  if (summary?.showMaintenancePage && !isOperatorRoute) {
    return (
      <div
        data-testid="public-maintenance-page"
        className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8"
      >
        <section className="rounded-2xl border border-amber-500/35 bg-[#111827] overflow-hidden shadow-2xl">
          <div className="border-b border-slate-800 bg-[#0d1323] px-6 py-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-300 shrink-0">
                <Wrench className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <div className="font-mono text-xs text-amber-300">
                  Signal Forge · Safe Maintenance Protocol ({summary.state})
                </div>
                <h1 className="font-display text-xl sm:text-2xl font-bold text-white">
                  Scheduled System Update in Progress
                </h1>
              </div>
            </div>
            <span className="font-mono text-xs text-slate-400 shrink-0">
              v{summary.currentVersion} &rarr; v{summary.targetVersion}
            </span>
          </div>

          <div className="p-6 space-y-5">
            <p className="text-sm leading-relaxed text-slate-200">{summary.bannerMessage}</p>

            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3.5">
                <dt className="font-sans text-[11px] text-slate-400">System State</dt>
                <dd className="mt-1 font-bold text-amber-300">{summary.state}</dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3.5">
                <dt className="font-sans text-[11px] text-slate-400">Estimated Remaining</dt>
                <dd className="mt-1 font-bold text-white">
                  <MaintenanceCountdownText
                    estimatedEndAtIso={summary.estimatedEndAtIso}
                    fallbackRemainingSeconds={summary.remainingSeconds}
                  />
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3.5">
                <dt className="font-sans text-[11px] text-slate-400">Service Health</dt>
                <dd className="mt-1 font-bold text-emerald-400">
                  {summary.serviceHealth.replace(/_/g, ' ')}
                </dd>
              </div>
            </dl>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/25 p-4 flex items-start gap-3 text-xs text-emerald-200">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <div className="font-semibold text-white">
                  Existing Open Positions &amp; Protective Orders Remain Active
                </div>
                <p className="text-slate-300 leading-relaxed">
                  All new live trading entries are strictly paused during this maintenance window. Existing positions are never auto-closed and protective Stop-Loss / Take-Profit orders remain intact. Live trading only resumes after all 10 post-update safety checks pass and an authorized operator approves resumption.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4 text-xs">
              <span className="font-mono text-slate-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                {summary.estimatedEndAtIso
                  ? `Estimated completion: ${new Date(summary.estimatedEndAtIso).toUTCString()}`
                  : 'Awaiting post-update verification'}
              </span>
              <Link
                to="/settings"
                data-testid="maintenance-operator-access-link"
                className="font-semibold text-blue-400 hover:text-blue-300"
              >
                Authorized Operator Command Hub &rarr;
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      {summary?.isMaintenanceActive && (
        <div
          role="status"
          data-testid="maintenance-status-banner"
          className="border-b border-amber-500/40 bg-amber-950/55 px-4 py-2.5 text-xs text-amber-100"
        >
          <div className="mx-auto max-w-[1440px] flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex items-center gap-2 font-medium">
              <Wrench className="h-3.5 w-3.5 text-amber-300 shrink-0" aria-hidden="true" />
              <span>{summary.bannerMessage}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-amber-200/90 tabular-nums">
              <span>State: {summary.state}</span>
              <span aria-hidden="true">·</span>
              <span>Mode: {summary.publicAccessMode === 'READ_ONLY' ? 'Read-Only' : 'Maintenance Page'}</span>
              <span aria-hidden="true">·</span>
              <span>
                Remaining:{' '}
                <MaintenanceCountdownText
                  estimatedEndAtIso={summary.estimatedEndAtIso}
                  fallbackRemainingSeconds={summary.remainingSeconds}
                />
              </span>
              <span aria-hidden="true">·</span>
              <span>Health: {summary.serviceHealth.replace(/_/g, ' ')}</span>
            </div>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
