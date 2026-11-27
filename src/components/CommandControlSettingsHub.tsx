import { memo, useCallback, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Cpu,
  Eye,
  EyeOff,
  Lock,
  Mic,
  Power,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ForgeHaltServerStatus } from './ForgeHaltServerStatus';
import { useRbacIdentity } from '../hooks/useRbacIdentity';
import {
  COMMAND_DOMAINS,
  computeControlMatrixDelta,
  evaluateCommandControlSnapshot,
  filterCommandModules,
  type CommandDomainId,
  type CommandModuleKind,
  type CommandPresetId,
  type EvaluatedCommandModule,
  type GlobalMasterOverride,
  type MasterOverrideMode,
} from '../lib/commandControlHub';
import {
  DESIGN_SYSTEM_VARIANTS,
  ORDERED_DESIGN_VARIANTS,
  type WidgetLayoutContract,
  type WidgetMetadataSegment,
  type WidgetMetricItem,
} from '../lib/designSystem';
import { useCommandControlStore } from '../store/useCommandControlStore';
import {
  useWorkspaceStore,
  type WorkspacePanelKey,
} from '../store/useWorkspaceStore';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeSegmentedControl,
  ForgeWidgetFrame,
  type SegmentedOption,
} from './ui/ForgeDesignSystem';

type HubTabId = 'ALL' | CommandDomainId | 'DOCK_WORKSPACE';

const HUB_LAYOUT: WidgetLayoutContract = {
  widgetId: 'command-control-hub',
  ariaLabel: 'Centralized Command and Control Hub',
  colSpanDesktop: 12,
  density: 'STANDARD',
  elevation: 'SURFACE',
  gpuContain: true,
  showStreamRail: true,
};

const GLOBAL_OVERRIDE_OPTIONS: readonly SegmentedOption<GlobalMasterOverride>[] = [
  { value: 'GRANULAR', label: 'Granular Control', testId: 'master-mode-granular' },
  { value: 'FORCE_ALL_ON', label: 'Force Module Preferences ON', testId: 'master-mode-force-on' },
  { value: 'FORCE_ALL_OFF', label: 'Local Modules OFF', testId: 'master-mode-force-off' },
];

const DOMAIN_OVERRIDE_OPTIONS: readonly SegmentedOption<MasterOverrideMode>[] = [
  { value: 'GRANULAR', label: 'Granular' },
  { value: 'FORCE_ON', label: 'Force ON' },
  { value: 'FORCE_OFF', label: 'Force OFF' },
];

const TAB_OPTIONS: readonly SegmentedOption<HubTabId>[] = [
  { value: 'ALL', label: 'All Modules', testId: 'hub-tab-all' },
  { value: 'MARKET_DATA', label: 'Market Feeds', testId: 'hub-tab-market' },
  { value: 'AI_AGENTS', label: 'AI Agents', testId: 'hub-tab-agents' },
  { value: 'EXECUTION_ROUTER', label: 'Execution Tools', testId: 'hub-tab-execution' },
  { value: 'RELIABILITY_TELEMETRY', label: 'Safeguards', testId: 'hub-tab-safeguards' },
  { value: 'DOCK_WORKSPACE', label: 'Dock & Workspace', testId: 'hub-tab-dock' },
];

const KIND_OPTIONS: readonly SegmentedOption<CommandModuleKind | 'ALL'>[] = [
  { value: 'ALL', label: 'All Types' },
  { value: 'AGENT', label: 'Agents' },
  { value: 'TOOL', label: 'Tools' },
  { value: 'FEED', label: 'Feeds' },
  { value: 'SAFEGUARD', label: 'Safeguards' },
];

function resolutionLabel(item: EvaluatedCommandModule): { text: string; toneClass: string } {
  switch (item.resolution) {
    case 'GLOBAL_FORCE_OFF':
      return { text: 'LOCKED OFF · GLOBAL MASTER', toneClass: 'text-rose-400' };
    case 'GLOBAL_FORCE_ON':
      return { text: 'FORCED ON · GLOBAL MASTER', toneClass: 'text-cyan-300' };
    case 'DOMAIN_FORCE_OFF':
      return { text: 'LOCKED OFF · DOMAIN MASTER', toneClass: 'text-amber-300' };
    case 'DOMAIN_FORCE_ON':
      return { text: 'FORCED ON · DOMAIN MASTER', toneClass: 'text-cyan-300' };
    case 'GRANULAR':
      return item.effectiveEnabled
        ? { text: 'ACTIVE · GRANULAR', toneClass: 'text-emerald-400' }
        : { text: 'PAUSED · GRANULAR', toneClass: 'text-slate-400' };
  }
}

function domainIcon(domain: CommandDomainId) {
  switch (domain) {
    case 'MARKET_DATA':
      return <Activity className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />;
    case 'AI_AGENTS':
      return <Bot className="h-4 w-4 text-indigo-400 shrink-0" aria-hidden="true" />;
    case 'EXECUTION_ROUTER':
      return <Cpu className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />;
    case 'RELIABILITY_TELEMETRY':
      return <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />;
  }
}

export const CommandControlSettingsHub = memo(function CommandControlSettingsHub() {
  const {
    appLiveEnabled,
    setAppLiveEnabled,
    architectureState,
    toggleControlMatrixKey,
    voiceAgent,
    engageForgeFailSafeNow,
    forgeCapitalBusy,
  } = useApp();

  const { rbac } = useRbacIdentity();
  const ownerControlsAllowed = rbac.role === 'SUPER_ADMIN';
  const hub = useCommandControlStore((s) => s.hub);
  const setGlobalOverride = useCommandControlStore((s) => s.setGlobalOverride);
  const setDomainOverride = useCommandControlStore((s) => s.setDomainOverride);
  const setGranularToggle = useCommandControlStore((s) => s.setGranularToggle);
  const applyPreset = useCommandControlStore((s) => s.applyPreset);
  const updateDock = useCommandControlStore((s) => s.updateDock);
  const resetHubToDefaults = useCommandControlStore((s) => s.resetHubToDefaults);
  const setVoiceOverlayOpen = useCommandControlStore((s) => s.setVoiceOverlayOpen);

  const activeMonitorId = useWorkspaceStore((s) => s.activeMonitorId);
  const activeMonitor = useWorkspaceStore((s) => s.monitors[s.activeMonitorId]);
  const cyber = useWorkspaceStore((s) => s.cyber);
  const setPanelVisibility = useWorkspaceStore((s) => s.setPanelVisibility);
  const updateCyberSettings = useWorkspaceStore((s) => s.updateCyberSettings);

  const [activeTab, setActiveTab] = useState<HubTabId>('ALL');
  const [kindFilter, setKindFilter] = useState<CommandModuleKind | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const snapshot = useMemo(() => evaluateCommandControlSnapshot(hub), [hub]);

  const pendingBackendDiffs = useMemo(() => computeControlMatrixDelta(
    architectureState.controlMatrix,
    snapshot.derivedControlMatrix
  ).length, [architectureState.controlMatrix, snapshot.derivedControlMatrix]);

  const filteredModules = useMemo(() => {
    const domainFilter: CommandDomainId | 'ALL' =
      activeTab === 'ALL' || activeTab === 'DOCK_WORKSPACE' ? 'ALL' : activeTab;
    return filterCommandModules(snapshot.modules, {
      domain: domainFilter,
      kind: kindFilter,
      query: searchQuery,
    });
  }, [snapshot.modules, activeTab, kindFilter, searchQuery]);

  const syncDerivedMatrixToBackend = useCallback(
    async (nextHubState: typeof hub, contextLabel: string) => {
      if (!ownerControlsAllowed) {
        setSyncNotice('Owner-level account required for global system configuration. Changes are not authorized.');
        return;
      }
      const nextSnap = evaluateCommandControlSnapshot(nextHubState);
      const deltas = computeControlMatrixDelta(
        architectureState.controlMatrix,
        nextSnap.derivedControlMatrix
      );
      if (deltas.length === 0) {
        setSyncNotice(
          `${contextLabel} synchronized · Backend matrix already aligned (${nextSnap.matrixChecksum}).`
        );
        return;
      }

      let syncedCount = 0;
      for (const delta of deltas) {
        try {
          const res = await toggleControlMatrixKey(delta.key, delta.value);
          if (!res.ok) break; // Stop on failed write; the backend may have diverged.
          syncedCount += 1;
        } catch {
          break;
        }
      }
      setSyncNotice(
        syncedCount === deltas.length
          ? `${contextLabel} synchronized (${syncedCount}/${deltas.length} backend toggles · ${nextSnap.matrixChecksum}).`
          : `${contextLabel}: PARTIAL BACKEND SYNC (${syncedCount}/${deltas.length}). Execution remains subject to independent server safety checks. Reconcile before relying on this state.`
      );
    },
    [
      architectureState.controlMatrix,
      ownerControlsAllowed,
      toggleControlMatrixKey,
    ]
  );

  const handleGlobalOverrideChange = useCallback(
    async (mode: GlobalMasterOverride) => {
      if (!ownerControlsAllowed) {
        setSyncNotice('Owner-level access required to change global command overrides.');
        return;
      }
      const next = setGlobalOverride(mode);
      if (mode === 'FORCE_ALL_OFF' && appLiveEnabled) {
        await setAppLiveEnabled(false);
      }
      await syncDerivedMatrixToBackend(
        next,
        mode === 'FORCE_ALL_OFF'
          ? 'Global Master Emergency OFF'
          : mode === 'FORCE_ALL_ON'
          ? 'Global Master Force ON'
          : 'Granular Command Mode'
      );
    },
    [appLiveEnabled, ownerControlsAllowed, setAppLiveEnabled, setGlobalOverride, syncDerivedMatrixToBackend]
  );

  const handleDomainOverrideChange = useCallback(
    async (domain: CommandDomainId, mode: MasterOverrideMode) => {
      if (!ownerControlsAllowed) {
        setSyncNotice('Owner-level access required to change domain controls.');
        return;
      }
      const next = setDomainOverride(domain, mode);
      const label = COMMAND_DOMAINS.find((d) => d.id === domain)?.shortLabel ?? domain;
      await syncDerivedMatrixToBackend(next, `${label} Master -> ${mode}`);
    },
    [ownerControlsAllowed, setDomainOverride, syncDerivedMatrixToBackend]
  );

  const handleGranularModuleToggle = useCallback(
    async (mod: EvaluatedCommandModule) => {
      if (!ownerControlsAllowed) {
        setSyncNotice('Owner-level access required to change system modules.');
        return;
      }
      const nextEnabled = !mod.granularEnabled;
      const next = setGranularToggle(mod.descriptor.id, nextEnabled);
      let backendConfirmed = false;
      if (mod.descriptor.controlMatrixKey && !mod.isOverridden) {
        try {
          const outcome = await toggleControlMatrixKey(mod.descriptor.controlMatrixKey, nextEnabled);
          backendConfirmed = outcome.ok;
        } catch {
          backendConfirmed = false;
        }
      }
      setSyncNotice(
        mod.isOverridden
          ? `Saved granular preference for ${mod.descriptor.label}. Master Override remains in effect.`
          : backendConfirmed
          ? `${mod.descriptor.label}: backend confirmed ${nextEnabled ? 'ON' : 'OFF'} (${evaluateCommandControlSnapshot(next).matrixChecksum}).`
          : `${mod.descriptor.label}: local preference saved; backend change NOT confirmed. Check permissions and resync.`
      );
    },
    [ownerControlsAllowed, setGranularToggle, toggleControlMatrixKey]
  );

  const handlePresetClick = useCallback(
    async (preset: CommandPresetId, label: string) => {
      if (!ownerControlsAllowed) {
        setSyncNotice('Owner-level access required to change maintenance presets.');
        return;
      }
      const next = applyPreset(preset);
      await syncDerivedMatrixToBackend(next, `Preset "${label}"`);
    },
    [applyPreset, ownerControlsAllowed, syncDerivedMatrixToBackend]
  );

  const handleVerifiedEmergencyRequest = useCallback(async () => {
    if (typeof window === 'undefined' || !window.confirm(
      'Activate the server Emergency Halt (423) now? This blocks trading and requires independent owner recovery authorization.'
    )) return;
    setSyncNotice('Emergency Halt requested. Check the server-confirmed status below; a local preference alone is not confirmation.');
    await engageForgeFailSafeNow('Owner requested explicit 423 Emergency Halt from Master Command & Control Settings.');
  }, [engageForgeFailSafeNow]);

  const handleResetAll = useCallback(async () => {
    if (!ownerControlsAllowed) {
      setSyncNotice('Owner-level account required to reset maintenance controls.');
      return;
    }
    const next = resetHubToDefaults();
    await syncDerivedMatrixToBackend(next, 'Command Hub Defaults (app state unchanged)');
  }, [ownerControlsAllowed, resetHubToDefaults, syncDerivedMatrixToBackend]);

  const metrics: readonly WidgetMetricItem[] = useMemo(
    () => [
      {
        id: 'active-modules',
        label: 'Effective Active Modules',
        value: `${snapshot.effectiveActiveCount} / ${snapshot.totalModules}`,
        subtext:
          snapshot.overriddenCount > 0
            ? `${snapshot.overriddenCount} under master override`
            : '100% granular routing',
        tone:
          snapshot.effectiveActiveCount === 0
            ? 'CRITICAL'
            : snapshot.overriddenCount > 0
            ? 'WARNING'
            : 'NOMINAL',
      },
      {
        id: 'master-mode',
        label: 'Master Override Layer',
        value:
          hub.globalOverride === 'FORCE_ALL_OFF'
            ? 'EMERGENCY OFF'
            : hub.globalOverride === 'FORCE_ALL_ON'
            ? 'FORCE ALL ON'
            : 'HYBRID GRANULAR',
        subtext: appLiveEnabled ? 'App Live: ONLINE' : 'App Live: HALTED',
        tone:
          hub.globalOverride === 'FORCE_ALL_OFF' || !appLiveEnabled
            ? 'CRITICAL'
            : hub.globalOverride === 'FORCE_ALL_ON'
            ? 'INFO'
            : 'NOMINAL',
      },
      {
        id: 'matrix-checksum',
        label: 'Control Matrix Checksum',
        value: snapshot.matrixChecksum,
        subtext: ownerControlsAllowed
          ? 'Owner may request backend sync (verify result)'
          : 'Read-only backend / local view',
        tone: 'INFO',
      },
      {
        id: 'dock-voice',
        label: 'Floating Dock & Voice',
        value: voiceAgent.listening ? 'VOICE LIVE' : 'DOCK ARMED',
        subtext: `Tap-to-Top: ${hub.dock.tapToTopMode === 'PERSISTENT' ? 'Persistent' : 'On Scroll'}`,
        tone: voiceAgent.listening ? 'NOMINAL' : 'INFO',
      },
    ],
    [
      appLiveEnabled,
      hub.dock.tapToTopMode,
      hub.globalOverride,
      snapshot.effectiveActiveCount,
      snapshot.matrixChecksum,
      snapshot.overriddenCount,
      snapshot.totalModules,
      ownerControlsAllowed,
      voiceAgent.listening,
    ]
  );

  const headerMetadata: readonly WidgetMetadataSegment[] = useMemo(
    () => [
      { id: 'cch-layer', label: 'Command & Control Hub' },
      {
        id: 'cch-version',
        label: 'Sync',
        value: `v${hub.stateVersion}`,
        tone: 'INFO',
      },
      {
        id: 'cch-active',
        label: `${snapshot.effectiveActiveCount}/${snapshot.totalModules} Active`,
        tone: snapshot.effectiveActiveCount > 0 ? 'NOMINAL' : 'CRITICAL',
      },
    ],
    [hub.stateVersion, snapshot.effectiveActiveCount, snapshot.totalModules]
  );

  const visibleDomains = useMemo(() => {
    if (activeTab === 'DOCK_WORKSPACE') return [];
    if (activeTab === 'ALL') return snapshot.domainSummaries;
    return snapshot.domainSummaries.filter((d) => d.domain.id === activeTab);
  }, [activeTab, snapshot.domainSummaries]);

  return (
    <div className="space-y-6">
      <ForgeWidgetFrame
        layout={HUB_LAYOUT}
        title="Command & Control Hub · Hybrid Module Orchestrator"
        icon={<SlidersHorizontal className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />}
        metadata={headerMetadata}
        testId="command-control-hub-widget"
        actions={
          <>
            <ForgeInteractiveButton
              label="Voice Overlay"
              icon={<Mic className="h-3.5 w-3.5" aria-hidden="true" />}
              intent="secondary"
              testId="settings-open-voice-overlay-btn"
              onClick={() => setVoiceOverlayOpen(true)}
            />
            <ForgeInteractiveButton
              label={forgeCapitalBusy ? 'Emergency Request Pending' : 'Server Emergency Halt (423)'}
              icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}
              intent="danger"
              testId="settings-server-emergency-halt-btn"
              onClick={handleVerifiedEmergencyRequest}
            />
            <ForgeInteractiveButton
              label="Reset Defaults"
              icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              intent="ghost"
              testId="settings-reset-hub-btn"
              onClick={handleResetAll}
            />
          </>
        }
      >
        <div className="space-y-5">
          <ForgeMetricStrip items={metrics} columns={4} />
          <ForgeHaltServerStatus />
          {!ownerControlsAllowed && (
            <p role="status" className="rounded-lg border border-rose-500/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-200">
              Read-only system control view: a verified SUPER_ADMIN account is required to change shared backend modules, maintenance presets or rollbacks. Emergency-stop requests retain their separate operator authentication.
            </p>
          )}
          {pendingBackendDiffs > 0 && (
            <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-100">
              Maintenance reconciliation needed: {pendingBackendDiffs} command toggles differ from the last reported backend matrix. This is not a confirmed backend configuration; inspect and resync before relying on it.
            </div>
          )}
          <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
            Maintenance/Force ON/OFF controls are workspace preferences only. They do not confirm or clear the server-side 423 Emergency Halt. Enabling modules or resetting defaults never authorizes LIVE trading; use the dedicated authenticated Forge Capital emergency control for actual server halt.
          </p>

          {/* Master Override Command Bar */}
          <div
            data-testid="master-override-console"
            className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-3.5"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Power className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  <span>Global Master Override Layer</span>
                </div>
                <p className="text-xs text-slate-400">
                  Configure 29 workspace modules. This panel is not a server-authoritative order-routing or Emergency Halt control; independent execution safety gates always apply.
                </p>
              </div>

              <ForgeSegmentedControl
                ariaLabel="Global Master Override Mode"
                layoutGroupId="global-master-override-mode"
                options={GLOBAL_OVERRIDE_OPTIONS}
                value={hub.globalOverride}
                onChange={handleGlobalOverrideChange}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                  Quick Profiles:
                </span>
                <ForgeInteractiveButton
                  label="Full Command"
                  intent="primary"
                  testId="preset-full-command-btn"
                  onClick={() => handlePresetClick('FULL_COMMAND', 'Full Command')}
                />
                <ForgeInteractiveButton
                  label="Monitor Only"
                  intent="secondary"
                  testId="preset-monitor-only-btn"
                  onClick={() => handlePresetClick('SAFE_MONITOR_ONLY', 'Safe Monitor Only')}
                />
                <ForgeInteractiveButton
                  label="Execution Lockdown"
                  intent="danger"
                  testId="preset-exec-lockdown-btn"
                  onClick={() => handlePresetClick('EXECUTION_LOCKDOWN', 'Execution Lockdown')}
                />
                <ForgeInteractiveButton
                  label="Restore Granular"
                  intent="ghost"
                  testId="preset-restore-granular-btn"
                  onClick={() => handlePresetClick('RESTORE_GRANULAR', 'Restore Granular')}
                />
              </div>

              {syncNotice && (
                <div
                  data-testid="command-hub-sync-notice"
                  className="font-mono text-[11px] text-cyan-300 truncate max-w-full"
                >
                  {syncNotice}
                </div>
              )}
            </div>
          </div>

          {/* Domain Navigation & Search Controls */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <ForgeSegmentedControl
              ariaLabel="Command Hub Domain Filter"
              layoutGroupId="command-hub-domain-tabs"
              options={TAB_OPTIONS}
              value={activeTab}
              onChange={setActiveTab}
            />

            {activeTab !== 'DOCK_WORKSPACE' && (
              <div className="flex flex-wrap items-center gap-2">
                <ForgeSegmentedControl
                  ariaLabel="Module Type Filter"
                  layoutGroupId="command-hub-kind-filter"
                  options={KIND_OPTIONS}
                  value={kindFilter}
                  onChange={setKindFilter}
                />
                <div className="relative min-w-[210px] flex-1 sm:flex-initial">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter agents, tools, feeds..."
                    aria-label="Filter Signal Forge modules"
                    data-testid="command-hub-search"
                    className="w-full rounded-lg border border-slate-800 bg-[#050914] py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Domain Hybrid Toggle Sections */}
          {activeTab !== 'DOCK_WORKSPACE' && (
            <div className="space-y-5">
              {visibleDomains.map((summary) => {
                const domainMods = filteredModules.filter(
                  (m) => m.descriptor.domain === summary.domain.id
                );
                if (domainMods.length === 0 && (searchQuery.trim() || kindFilter !== 'ALL')) {
                  return null;
                }

                return (
                  <section
                    key={summary.domain.id}
                    data-testid={`domain-section-${summary.domain.id}`}
                    aria-label={summary.domain.label}
                    className="rounded-xl border border-slate-800/90 bg-[#070d1b]/90 overflow-hidden"
                  >
                    {/* Domain Header with Per-Domain Master Override */}
                    <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0b1325]/90 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {domainIcon(summary.domain.id)}
                          <h3 className="font-display text-sm font-bold text-white">
                            {summary.domain.label}
                          </h3>
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {summary.effectiveActiveCount}/{summary.totalModules} active
                          </span>
                          <span className="font-mono text-[10px] text-slate-500">
                            · {summary.domain.ownerService}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {summary.domain.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                          Domain Override:
                        </span>
                        <ForgeSegmentedControl
                          ariaLabel={`${summary.domain.shortLabel} Master Override`}
                          layoutGroupId={`domain-override-${summary.domain.id}`}
                          options={DOMAIN_OVERRIDE_OPTIONS.map((o) => ({
                            ...o,
                            testId: `domain-${summary.domain.id}-${o.value.toLowerCase()}`,
                          }))}
                          value={summary.overrideMode}
                          onChange={(mode) => handleDomainOverrideChange(summary.domain.id, mode)}
                        />
                      </div>
                    </div>

                    {/* Individual Granular Module Matrix */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:gap-px bg-slate-800/60">
                      {domainMods.map((item) => {
                        const status = resolutionLabel(item);
                        const panelKey = item.descriptor.workspacePanelKey as
                          | WorkspacePanelKey
                          | undefined;
                        const panelVisible =
                          panelKey && activeMonitor ? activeMonitor.panels[panelKey] : undefined;

                        return (
                          <div
                            key={item.descriptor.id}
                            data-testid={`module-row-${item.descriptor.id}`}
                            className="flex items-start justify-between gap-3 bg-[#070d1b] px-4 py-3.5 transition-colors hover:bg-[#0b1325]/70"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-white">
                                  {item.descriptor.label}
                                </span>
                                {item.descriptor.critical && (
                                  <span className="font-mono text-[10px] text-amber-300">
                                    · Core Kernel
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] leading-relaxed text-slate-400">
                                {item.descriptor.description}
                              </p>
                              <div className="flex flex-wrap items-center gap-2.5 pt-0.5 font-mono text-[10px]">
                                <span
                                  data-testid={`module-status-${item.descriptor.id}`}
                                  className={`font-semibold ${status.toneClass}`}
                                >
                                  {status.text}
                                </span>
                                <span className="text-slate-600" aria-hidden="true">
                                  ·
                                </span>
                                <span className="text-slate-500">
                                  Saved Pref: {item.granularEnabled ? 'ON' : 'OFF'}
                                </span>
                                {panelKey && typeof panelVisible === 'boolean' && (
                                  <>
                                    <span className="text-slate-600" aria-hidden="true">
                                      ·
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPanelVisibility(panelKey, !panelVisible, activeMonitorId)
                                      }
                                      className="inline-flex items-center gap-1 text-slate-400 hover:text-cyan-300 cursor-pointer"
                                    >
                                      {panelVisible ? (
                                        <Eye className="h-3 w-3 text-cyan-400" aria-hidden="true" />
                                      ) : (
                                        <EyeOff className="h-3 w-3 text-slate-500" aria-hidden="true" />
                                      )}
                                      <span>{panelVisible ? 'Widget Shown' : 'Widget Hidden'}</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={item.granularEnabled}
                                aria-label={`Toggle ${item.descriptor.label} granular preference`}
                                data-testid={`module-switch-${item.descriptor.id}`}
                                onClick={() => handleGranularModuleToggle(item)}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400 ${
                                  item.effectiveEnabled
                                    ? 'border-emerald-500 bg-emerald-500/90'
                                    : item.isOverridden
                                    ? 'border-rose-500/60 bg-rose-950/90'
                                    : 'border-slate-700 bg-slate-800'
                                }`}
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                    item.granularEnabled ? 'translate-x-4' : 'translate-x-0.5'
                                  }`}
                                />
                              </button>
                              {item.isOverridden && (
                                <span className="inline-flex items-center gap-1 font-mono text-[9px] text-amber-300">
                                  <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                                  MASTER
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              {filteredModules.length === 0 && (
                <div className="rounded-xl border border-slate-800 bg-[#070d1b] px-5 py-8 text-center text-xs text-slate-400">
                  No modules match &ldquo;{searchQuery}&rdquo; in the current filter.
                </div>
              )}
            </div>
          )}

          {/* Floating Widget Dock & Multi-Screen Workspace Settings Tab */}
          {activeTab === 'DOCK_WORKSPACE' && (
            <div
              data-testid="dock-workspace-settings"
              className="grid grid-cols-1 lg:grid-cols-2 gap-4"
            >
              {/* Floating Widget Dock Controls */}
              <div className="rounded-xl border border-slate-800/90 bg-[#070d1b] p-4 space-y-4">
                <div className="space-y-1">
                  <h3 className="font-display text-sm font-bold text-white">
                    Centralized Floating Widget Dock
                  </h3>
                  <p className="text-xs text-slate-400">
                    Controls the bottom-right dock housing Tap-to-Top scroll integration, Voice Command Overlay trigger, and WhatsApp Desk FAB.
                  </p>
                </div>

                <div className="space-y-3 border-t border-slate-800/80 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-white">
                        Tap-to-Top Scroll Button
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Persistent always-visible dock button or appear only while scrolled.
                      </div>
                    </div>
                    <ForgeSegmentedControl
                      ariaLabel="Tap to Top Display Mode"
                      layoutGroupId="tap-to-top-display-mode"
                      options={[
                        { value: 'PERSISTENT', label: 'Persistent', testId: 'dock-toptop-persistent' },
                        { value: 'ON_SCROLL', label: 'On Scroll', testId: 'dock-toptop-scroll' },
                      ]}
                      value={hub.dock.tapToTopMode}
                      onChange={(tapToTopMode) => updateDock({ tapToTopMode })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-slate-800/70 pt-3">
                    <div>
                      <div className="text-xs font-semibold text-white">Show Text Labels on Dock</div>
                      <div className="text-[11px] text-slate-400">
                        Display compact labels alongside Tap-to-Top, Voice, and WhatsApp icons.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hub.dock.showDockLabels}
                      data-testid="dock-labels-switch"
                      onClick={() => updateDock({ showDockLabels: !hub.dock.showDockLabels })}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                        hub.dock.showDockLabels
                          ? 'border-cyan-400 bg-cyan-500'
                          : 'border-slate-700 bg-slate-800'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          hub.dock.showDockLabels ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-slate-800/70 pt-3">
                    <div>
                      <div className="text-xs font-semibold text-white">
                        Auto-Close Voice Overlay After Dispatch
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Minimize the anchored Voice Command drawer after executing a command.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hub.dock.voiceOverlayAutoClose}
                      data-testid="dock-voice-autoclose-switch"
                      onClick={() =>
                        updateDock({ voiceOverlayAutoClose: !hub.dock.voiceOverlayAutoClose })
                      }
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                        hub.dock.voiceOverlayAutoClose
                          ? 'border-cyan-400 bg-cyan-500'
                          : 'border-slate-700 bg-slate-800'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          hub.dock.voiceOverlayAutoClose ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Multi-Design & Rendering Pipeline Settings */}
              <div className="rounded-xl border border-slate-800/90 bg-[#070d1b] p-4 space-y-4">
                <div className="space-y-1">
                  <h3 className="font-display text-sm font-bold text-white">
                    Cyber-AI Theme &amp; 120Hz Pipeline
                  </h3>
                  <p className="text-xs text-slate-400">
                    Synchronized across all connected multi-screen displays via BroadcastChannel.
                  </p>
                </div>

                <div className="space-y-3 border-t border-slate-800/80 pt-3">
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-white">Design System Variant</div>
                    <ForgeSegmentedControl
                      ariaLabel="Design System Variant"
                      layoutGroupId="settings-design-variant"
                      options={ORDERED_DESIGN_VARIANTS.map((v) => ({
                        value: v,
                        label: DESIGN_SYSTEM_VARIANTS[v].label,
                      }))}
                      value={cyber.designVariant}
                      onChange={(designVariant) => updateCyberSettings({ designVariant })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-slate-800/70 pt-3">
                    <div>
                      <div className="text-xs font-semibold text-white">Widget Density</div>
                      <div className="text-[11px] text-slate-400">
                        Adjust spacing across high-density multi-monitor grids.
                      </div>
                    </div>
                    <ForgeSegmentedControl
                      ariaLabel="Widget Density"
                      layoutGroupId="settings-widget-density"
                      options={[
                        { value: 'STANDARD', label: 'Standard' },
                        { value: 'COMPACT', label: 'Compact' },
                      ]}
                      value={cyber.density}
                      onChange={(density) => updateCyberSettings({ density })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-slate-800/70 pt-3">
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                      <ShieldAlert className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
                      <span>Invariant Kernels (1:5 R:R, 2% SL Cap, 6-Level DD) remain immutable.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </ForgeWidgetFrame>
    </div>
  );
});
