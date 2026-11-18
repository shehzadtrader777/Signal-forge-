import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Power, Radio, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function GlobalAppLiveBar() {
  const navigate = useNavigate();
  const {
    appLiveEnabled,
    setAppLiveEnabled,
    appLiveMeta,
    forgeCapitalState,
    wsConnected,
    wsVerification,
    reconciliationTelemetry,
    refreshWsVerification,
    voiceAgent,
    setVoiceMode,
    startPushToTalk,
    stopVoiceListening,
    executeVoiceCommand,
  } = useApp();

  const [verifyingWs, setVerifyingWs] = useState(false);

  const handleVerifyWs = async () => {
    setVerifyingWs(true);
    try {
      await refreshWsVerification();
    } finally {
      setVerifyingWs(false);
    }
  };

  const handleEmergencyVoiceStop = async () => {
    const res = await executeVoiceCommand('emergency stop');
    if (res.routeTarget) navigate(res.routeTarget);
  };

  const handleVoiceResume = async () => {
    const res = await executeVoiceCommand('resume app live');
    if (res.routeTarget) navigate(res.routeTarget);
  };

  const isAlwaysListening = voiceAgent.mode === 'ALWAYS_LISTENING';
  const backendWsActive = Boolean(wsVerification?.spotWsConnected);
  const wsActive = wsConnected || backendWsActive;

  return (
    <div
      role="region"
      aria-label="Global App Live & Voice Emergency Bar"
      className={`border-b transition-colors ${
        appLiveEnabled
          ? 'border-slate-800/90 bg-[#0b101d]'
          : 'border-rose-500/40 bg-[#1a0f16]'
      }`}
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8 text-xs">
        {/* Global 'App Live' Master Kill Switch + Quota Shield */}
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="inline-flex items-center gap-2.5 rounded-lg border border-slate-800 bg-[#0d1323] px-3 py-1">
            <Power
              className={`h-3.5 w-3.5 shrink-0 ${
                appLiveEnabled ? 'text-emerald-400' : 'text-rose-400'
              }`}
              aria-hidden="true"
            />
            <span className="font-semibold text-white whitespace-nowrap">App Live</span>
            <button
              type="button"
              role="switch"
              data-testid="app-live-switch"
              aria-checked={appLiveEnabled}
              aria-label="Toggle App Live Master Control Switch"
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
              className={`font-mono text-[11px] font-bold tabular-nums whitespace-nowrap ${
                appLiveEnabled ? 'text-emerald-400' : 'text-rose-300'
              }`}
            >
              {appLiveEnabled ? 'LIVE' : 'HALTED'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-400 tabular-nums">
            {appLiveEnabled ? (
              <span
                data-testid="ws-reconciliation-status"
                className="inline-flex items-center gap-1.5 text-slate-300"
              >
                {wsActive ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                )}
                <span>
                  WS {wsActive ? 'Connected' : 'Syncing'} ·{' '}
                  {(wsVerification?.totalWsFrames ?? 0).toLocaleString()} frames ·{' '}
                  {reconciliationTelemetry.validatedTicksCount.toLocaleString()} validated ·{' '}
                  {reconciliationTelemetry.driftsResolvedCount} reconciled
                  {reconciliationTelemetry.rejectedTicksCount > 0
                    ? ` · ${reconciliationTelemetry.rejectedTicksCount} quarantined`
                    : ''}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-rose-300 font-semibold">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  ALL POLLING, WS &amp; DISPATCH HALTED · API QUOTA SHIELDED ({appLiveMeta.quotaSavedCalls} saved)
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

        {/* Dedicated Hands-Free Voice Command Controls & Emergency Stop */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="voice-ptt-btn"
            onClick={() => (voiceAgent.listening && !isAlwaysListening ? stopVoiceListening() : startPushToTalk())}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              voiceAgent.listening
                ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                : 'border-slate-700 bg-[#0d1323] text-slate-200 hover:border-[#3b82f6]'
            }`}
          >
            {voiceAgent.listening ? (
              <Mic className="h-3.5 w-3.5 text-blue-300" aria-hidden="true" />
            ) : (
              <MicOff className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            )}
            <span>{voiceAgent.listening ? 'Listening...' : 'Push-to-Talk'}</span>
          </button>

          <button
            type="button"
            data-testid="voice-always-listening-btn"
            onClick={() => setVoiceMode(isAlwaysListening ? 'STANDBY' : 'ALWAYS_LISTENING')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              isAlwaysListening
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-800 bg-[#0d1323] text-slate-400 hover:text-white'
            }`}
          >
            <Radio className="h-3 w-3" aria-hidden="true" />
            <span>{isAlwaysListening ? 'Always-Listening ON' : 'Always-Listening'}</span>
          </button>

          <div
            data-testid="runtime-guard-profile-pill"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0d1323] px-2.5 py-1 font-mono text-[11px] text-slate-300"
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

          {appLiveEnabled ? (
            <button
              type="button"
              data-testid="voice-emergency-stop-btn"
              onClick={handleEmergencyVoiceStop}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/60 bg-rose-600/20 px-2.5 py-1 text-[11px] font-bold text-rose-200 hover:bg-rose-600/35 cursor-pointer whitespace-nowrap"
            >
              <span>Voice Stop</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="voice-resume-btn"
              onClick={handleVoiceResume}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/60 bg-emerald-600/20 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-600/35 cursor-pointer whitespace-nowrap"
            >
              <span>Voice Resume</span>
            </button>
          )}
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
