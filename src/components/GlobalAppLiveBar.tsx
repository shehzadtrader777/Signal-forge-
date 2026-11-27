import { useEffect, useState } from 'react';
import { Lock, Power, ShieldAlert, Wifi, WifiOff, Wrench } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { resolvePlatformOperationalStatuses } from '../lib/step3ReadinessAudit';

export function GlobalAppLiveBar() {
  const {
    appLiveEnabled,
    setAppLiveEnabled,
    appLiveMeta,
    forgeCapitalState,
    wsConnected,
    wsVerification,
    reconciliationTelemetry,
    refreshWsVerification,
  } = useApp();

  const [verifyingWs, setVerifyingWs] = useState(false);
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [exchangeDemoVerifiedConnected, setExchangeDemoVerifiedConnected] = useState(false);

  useEffect(() => {
    let active = true;
    const syncPlatformReadiness = async () => {
      try {
        const res = await fetch('/api/step3/readiness', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok || !active) return;
        const data = (await res.json()) as {
          maintenanceActive?: boolean;
          exchangeDemoVerifiedConnected?: boolean;
        };
        if (active) {
          setMaintenanceActive(Boolean(data.maintenanceActive));
          setExchangeDemoVerifiedConnected(Boolean(data.exchangeDemoVerifiedConnected));
        }
      } catch {
        // fallback cleanly to safe defaults
      }
    };
    void syncPlatformReadiness();
    const timer = window.setInterval(syncPlatformReadiness, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleVerifyWs = async () => {
    setVerifyingWs(true);
    try {
      await refreshWsVerification();
    } finally {
      setVerifyingWs(false);
    }
  };

  const backendWsActive = Boolean(wsVerification?.spotWsConnected);
  const wsActive = wsConnected || backendWsActive;

  const operationalStatus = resolvePlatformOperationalStatuses({
    appOnline: appLiveEnabled,
    marketDataConnected: appLiveEnabled && wsActive,
    exchangeDemoVerifiedConnected,
    maintenanceActive,
  });

  return (
    <div
      role="region"
      aria-label="Global Application & Trading Environment Status Bar"
      data-testid="global-app-live-bar"
      className={`border-b transition-colors ${
        maintenanceActive
          ? 'border-amber-500/40 bg-[#1a150b]'
          : appLiveEnabled
          ? 'border-slate-800/90 bg-[#0b101d]'
          : 'border-rose-500/40 bg-[#1a0f16]'
      }`}
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2.5 px-4 py-2 sm:px-6 lg:px-8 text-xs">
        {/* Explicit Application Power Control + Unambiguous Environment Badges */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0d1323] px-2.5 py-1">
            <Power
              className={`h-3.5 w-3.5 shrink-0 ${
                appLiveEnabled ? 'text-emerald-400' : 'text-rose-400'
              }`}
              aria-hidden="true"
            />
            <button
              type="button"
              role="switch"
              data-testid="app-live-switch"
              aria-checked={appLiveEnabled}
              aria-label="Toggle Application Online Feed Switch"
              onClick={() => setAppLiveEnabled(!appLiveEnabled)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                appLiveEnabled
                  ? 'border-emerald-500 bg-emerald-500'
                  : 'border-rose-500/70 bg-rose-950'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  appLiveEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
            <span
              data-testid="app-live-status-text"
              className={`font-mono text-[10px] font-bold tracking-wide whitespace-nowrap ${
                appLiveEnabled ? 'text-emerald-400' : 'text-rose-300'
              }`}
            >
              {operationalStatus.applicationLabel}
            </span>
          </div>

          <span
            data-testid="status-market-data"
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap ${
              wsActive && appLiveEnabled
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/35 bg-amber-500/10 text-amber-300'
            }`}
          >
            {wsActive && appLiveEnabled ? (
              <Wifi className="h-3 w-3" aria-hidden="true" />
            ) : (
              <WifiOff className="h-3 w-3" aria-hidden="true" />
            )}
            {operationalStatus.marketDataLabel}
          </span>

          <span
            data-testid="status-trading-env"
            className="inline-flex items-center rounded border border-blue-500/35 bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-blue-300 whitespace-nowrap"
          >
            {operationalStatus.activeTradingLabel}
          </span>

          <span
            data-testid="status-live-locked"
            className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-300 whitespace-nowrap"
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            {operationalStatus.liveTradingLabel}
          </span>

          {operationalStatus.maintenanceLabel && (
            <span
              data-testid="status-maintenance-active"
              className="inline-flex items-center gap-1 rounded border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-200 whitespace-nowrap"
            >
              <Wrench className="h-3 w-3" aria-hidden="true" />
              {operationalStatus.maintenanceLabel}
            </span>
          )}

          <div className="hidden xl:flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-400 tabular-nums">
            {appLiveEnabled ? (
              <span
                data-testid="ws-reconciliation-status"
                className="inline-flex items-center gap-1.5 text-slate-300"
              >
                <span>
                  {reconciliationTelemetry.dataFreshness === 'FRESH'
                    ? 'Fresh'
                    : !reconciliationTelemetry.lastFrameAtIso
                      ? 'Awaiting Frame'
                      : reconciliationTelemetry.dataFreshness} ·{' '}
                  {(wsVerification?.totalWsFrames ?? 0).toLocaleString()} frames ·{' '}
                  {reconciliationTelemetry.validatedTicksCount.toLocaleString()} validated ·{' '}
                  {reconciliationTelemetry.driftsResolvedCount} reconciled
                  {reconciliationTelemetry.reconnectCount > 0
                    ? ` · ${reconciliationTelemetry.reconnectCount} reconnects`
                    : ''}
                  {reconciliationTelemetry.duplicateTicksDroppedCount +
                    reconciliationTelemetry.outOfOrderTicksDroppedCount >
                  0
                    ? ` · ${reconciliationTelemetry.duplicateTicksDroppedCount} dup / ${reconciliationTelemetry.outOfOrderTicksDroppedCount} ooo`
                    : ''}
                  {reconciliationTelemetry.rejectedTicksCount > 0
                    ? ` · ${reconciliationTelemetry.rejectedTicksCount} quarantined`
                    : ''}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-rose-300 font-semibold">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  POLLING &amp; WS PAUSED · QUOTA SHIELDED ({appLiveMeta.quotaSavedCalls} saved)
                </span>
              </span>
            )}
            <button
              type="button"
              onClick={handleVerifyWs}
              disabled={verifyingWs}
              className="rounded border border-slate-700 bg-[#0d1323] px-2 py-0.5 text-[10px] font-semibold text-blue-300 hover:border-[#3b82f6] cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {verifyingWs ? 'Checking WS...' : 'Verify WS'}
            </button>
          </div>
        </div>

        {/* Runtime Guard Profile Readout */}
        <div
          data-testid="runtime-guard-profile-pill"
          className="inline-flex items-center gap-2 font-mono text-[11px] text-slate-300 shrink-0"
        >
          <span className="text-emerald-400 font-semibold">
            {forgeCapitalState.activeGuardProfile}
          </span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="text-slate-400">
            Mandate: {forgeCapitalState.liveMandateStatus}
          </span>
        </div>
      </div>

      {forgeCapitalState.lastGuardDenial && (
        <div
          role="alert"
          data-testid="guard-denial-banner"
          className="border-t border-rose-500/40 bg-rose-950/35 px-4 py-1.5 sm:px-6 lg:px-8"
        >
          <div className="mx-auto max-w-[1440px] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-rose-200">
            <span>
              Blocked by <strong>{forgeCapitalState.lastGuardDenial.blockedByLayer}</strong> ({forgeCapitalState.lastGuardDenial.reasonCode}): {forgeCapitalState.lastGuardDenial.message}
            </span>
            <span className="text-amber-300">
              Remediation: {forgeCapitalState.lastGuardDenial.remediationHint}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
