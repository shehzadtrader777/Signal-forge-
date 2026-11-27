import { create } from 'zustand';
import type { DesignSystemVariant, WidgetDensity } from '../lib/designSystem';

export type MonitorId = 'DISPLAY_1' | 'DISPLAY_2' | 'DISPLAY_3';

export type WorkspacePanelKey =
  | 'hybridArchitecture'
  | 'freqtradeTerminal'
  | 'systemControls'
  | 'telegramMonitor'
  | 'priceChart'
  | 'activeEntryZoneSignals'
  | 'prePumpSupportDesk'
  | 'backendExecutionLogs'
  | 'portfolioHub'
  | 'forgeCapital'
  | 'liveLedger'
  | 'coordinatorHub'
  | 'sentinelAgent'
  | 'autonomousOps'
  | 'orderBookDepth'
  | 'smcProfile'
  | 'patternScanner'
  | 'agentLoopTelemetry'
  | 'modularProfitTaking'
  | 'agentSyncAudit'
  | 'profitVault'
  | 'debateCoordinator'
  | 'multiAgentArchitecture'
  | 'agenticCliLoop'
  | 'fableOrchestrator';

export interface WorkspacePanelDescriptor {
  key: WorkspacePanelKey;
  label: string;
  category: 'CORE' | 'EXECUTION' | 'INTELLIGENCE';
}

export const WORKSPACE_PANEL_CATALOG: readonly WorkspacePanelDescriptor[] = [
  { key: 'hybridArchitecture', label: 'Hybrid Python+Rust 6-Phase Core', category: 'CORE' },
  { key: 'freqtradeTerminal', label: 'Unified CCXT & Dry-Run Terminal', category: 'CORE' },
  { key: 'systemControls', label: 'Runtime Controls', category: 'CORE' },
  { key: 'priceChart', label: 'Execution Chart', category: 'CORE' },
  { key: 'activeEntryZoneSignals', label: 'Entry-Zone Signals', category: 'EXECUTION' },
  { key: 'prePumpSupportDesk', label: 'Pre-Pump Support Desk', category: 'EXECUTION' },
  { key: 'backendExecutionLogs', label: 'Backend Execution Logs', category: 'EXECUTION' },
  { key: 'telegramMonitor', label: 'Telegram & Webhook', category: 'EXECUTION' },
  { key: 'forgeCapital', label: 'Forge Capital Hub', category: 'EXECUTION' },
  { key: 'liveLedger', label: 'Live Testnet Ledger', category: 'EXECUTION' },
  { key: 'coordinatorHub', label: 'AI Coordinator', category: 'INTELLIGENCE' },
  { key: 'portfolioHub', label: 'Portfolio Rebalancer', category: 'CORE' },
  { key: 'sentinelAgent', label: 'Sentinel Agent', category: 'INTELLIGENCE' },
  { key: 'autonomousOps', label: 'Autonomous Ops', category: 'INTELLIGENCE' },
  { key: 'orderBookDepth', label: 'L2 Order Book', category: 'INTELLIGENCE' },
  { key: 'smcProfile', label: 'SMC Volume Profile', category: 'INTELLIGENCE' },
  { key: 'patternScanner', label: 'Pattern Scanner', category: 'INTELLIGENCE' },
  { key: 'agentLoopTelemetry', label: 'Agent Loop Telemetry', category: 'CORE' },
  { key: 'agentSyncAudit', label: 'Agent Sync & 120Hz Audit', category: 'CORE' },
  { key: 'modularProfitTaking', label: 'Modular TP/SL Studio', category: 'EXECUTION' },
  { key: 'profitVault', label: 'Profit Vault & Daily PnL', category: 'EXECUTION' },
  { key: 'debateCoordinator', label: 'Debate AI & Self-Healing', category: 'INTELLIGENCE' },
  { key: 'multiAgentArchitecture', label: 'Multi-Agent Trading Command', category: 'EXECUTION' },
  { key: 'agenticCliLoop', label: 'Agentic CLI & Model Gateway', category: 'CORE' },
  { key: 'fableOrchestrator', label: 'Fable 5.2 8-Layer Orchestrator', category: 'INTELLIGENCE' },
] as const;

export type PanelVisibilityMap = Record<WorkspacePanelKey, boolean>;

export interface MonitorProfile {
  id: MonitorId;
  name: string;
  role: string;
  panels: PanelVisibilityMap;
}

export type WorkspacePresetId =
  | 'FULL_COMMAND'
  | 'EXECUTION_120HZ'
  | 'SIGNALS_AND_PREPUMP'
  | 'TELEMETRY_OPS';

export interface CyberVisualSettings {
  designVariant: DesignSystemVariant;
  density: WidgetDensity;
  neonGridOverlay: boolean;
  pulseSyncStreams: boolean;
  aiActivityIndicators: boolean;
  wsBatchIntervalMs: 8 | 16 | 50 | 100;
}

interface WorkspaceSyncEnvelope {
  originTabId: string;
  stateVersion: number;
  monitors: Record<MonitorId, MonitorProfile>;
  cyber: CyberVisualSettings;
}

export interface WorkspaceStoreState {
  tabId: string;
  stateVersion: number;
  activeMonitorId: MonitorId;
  monitors: Record<MonitorId, MonitorProfile>;
  cyber: CyberVisualSettings;
  syncedPeersCount: number;
  lastSyncAtIso: string | null;

  setActiveMonitor: (monitorId: MonitorId) => void;
  togglePanelVisibility: (panel: WorkspacePanelKey, monitorId?: MonitorId) => void;
  setPanelVisibility: (panel: WorkspacePanelKey, visible: boolean, monitorId?: MonitorId) => void;
  applyPreset: (preset: WorkspacePresetId, monitorId?: MonitorId) => void;
  updateCyberSettings: (patch: Partial<CyberVisualSettings>) => void;
  resetMonitors: () => void;
}

const STORAGE_KEY = 'signal_forge_multiscreen_workspace_v4';
const BROADCAST_CHANNEL_NAME = 'signal_forge_multiscreen_sync_v4';

function makePanels(overrides: Partial<PanelVisibilityMap>, defaultVal = true): PanelVisibilityMap {
  const base: PanelVisibilityMap = {
    hybridArchitecture: defaultVal,
    freqtradeTerminal: defaultVal,
    systemControls: defaultVal,
    telegramMonitor: defaultVal,
    priceChart: defaultVal,
    activeEntryZoneSignals: defaultVal,
    prePumpSupportDesk: defaultVal,
    backendExecutionLogs: defaultVal,
    portfolioHub: defaultVal,
    forgeCapital: defaultVal,
    liveLedger: defaultVal,
    coordinatorHub: defaultVal,
    sentinelAgent: defaultVal,
    autonomousOps: defaultVal,
    orderBookDepth: defaultVal,
    smcProfile: defaultVal,
    patternScanner: defaultVal,
    agentLoopTelemetry: defaultVal,
    modularProfitTaking: defaultVal,
    agentSyncAudit: defaultVal,
    profitVault: defaultVal,
    debateCoordinator: defaultVal,
    multiAgentArchitecture: defaultVal,
    agenticCliLoop: defaultVal,
    fableOrchestrator: defaultVal,
  };
  return { ...base, ...overrides };
}

export function createDefaultMonitors(): Record<MonitorId, MonitorProfile> {
  return {
    DISPLAY_1: {
      id: 'DISPLAY_1',
      name: 'Display 1 · Unified Command',
      role: 'Minimalist High-Density CCXT Terminal, Live Chart, Active Signals & Fable 5.2',
      panels: makePanels(
        {
          hybridArchitecture: true,
          freqtradeTerminal: true,
          systemControls: true,
          priceChart: true,
          activeEntryZoneSignals: true,
          fableOrchestrator: true,
        },
        false
      ),
    },
    DISPLAY_2: {
      id: 'DISPLAY_2',
      name: 'Display 2 · Execution',
      role: 'Auto-Executed Order Logs, Modular TP/SL, Telegram Relay & Capital Hub',
      panels: makePanels(
        {
          freqtradeTerminal: true,
          systemControls: true,
          agentLoopTelemetry: true,
          agentSyncAudit: true,
          modularProfitTaking: true,
          profitVault: true,
          activeEntryZoneSignals: true,
          prePumpSupportDesk: true,
          backendExecutionLogs: true,
          telegramMonitor: true,
          forgeCapital: true,
          liveLedger: true,
          coordinatorHub: true,
          multiAgentArchitecture: true,
          agenticCliLoop: true,
          fableOrchestrator: true,
        },
        false
      ),
    },
    DISPLAY_3: {
      id: 'DISPLAY_3',
      name: 'Display 3 · Intelligence',
      role: 'Agent Loops, Sync Audit, Order Book L2, SMC Profile, Pattern Scanner & Portfolio',
      panels: makePanels(
        {
          agentLoopTelemetry: true,
          agentSyncAudit: true,
          priceChart: true,
          portfolioHub: true,
          profitVault: true,
          debateCoordinator: true,
          sentinelAgent: true,
          autonomousOps: true,
          orderBookDepth: true,
          smcProfile: true,
          patternScanner: true,
        },
        false
      ),
    },
  };
}

const DEFAULT_CYBER_SETTINGS: CyberVisualSettings = {
  designVariant: 'CYBER_AI',
  density: 'STANDARD',
  neonGridOverlay: true,
  pulseSyncStreams: true,
  aiActivityIndicators: true,
  wsBatchIntervalMs: 100,
};

function loadPersistedWorkspace(): {
  monitors: Record<MonitorId, MonitorProfile>;
  cyber: CyberVisualSettings;
  stateVersion: number;
} {
  if (typeof window === 'undefined') {
    return {
      monitors: createDefaultMonitors(),
      cyber: DEFAULT_CYBER_SETTINGS,
      stateVersion: 1,
    };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        monitors: createDefaultMonitors(),
        cyber: DEFAULT_CYBER_SETTINGS,
        stateVersion: 1,
      };
    }
    const parsed = JSON.parse(raw) as Partial<WorkspaceSyncEnvelope>;
    const defaults = createDefaultMonitors();
    const mergedMonitors: Record<MonitorId, MonitorProfile> = {
      DISPLAY_1: {
        ...defaults.DISPLAY_1,
        ...(parsed.monitors?.DISPLAY_1 ?? {}),
        panels: {
          ...defaults.DISPLAY_1.panels,
          ...(parsed.monitors?.DISPLAY_1?.panels ?? {}),
        },
      },
      DISPLAY_2: {
        ...defaults.DISPLAY_2,
        ...(parsed.monitors?.DISPLAY_2 ?? {}),
        panels: {
          ...defaults.DISPLAY_2.panels,
          ...(parsed.monitors?.DISPLAY_2?.panels ?? {}),
        },
      },
      DISPLAY_3: {
        ...defaults.DISPLAY_3,
        ...(parsed.monitors?.DISPLAY_3 ?? {}),
        panels: {
          ...defaults.DISPLAY_3.panels,
          ...(parsed.monitors?.DISPLAY_3?.panels ?? {}),
        },
      },
    };
    const mergedCyber: CyberVisualSettings = {
      ...DEFAULT_CYBER_SETTINGS,
      ...(parsed.cyber ?? {}),
      wsBatchIntervalMs:
        typeof parsed.cyber?.wsBatchIntervalMs === 'number' && parsed.cyber.wsBatchIntervalMs >= 50
          ? parsed.cyber.wsBatchIntervalMs
          : DEFAULT_CYBER_SETTINGS.wsBatchIntervalMs,
    };
    return {
      monitors: mergedMonitors,
      cyber: mergedCyber,
      stateVersion: typeof parsed.stateVersion === 'number' ? parsed.stateVersion : 1,
    };
  } catch {
    return {
      monitors: createDefaultMonitors(),
      cyber: DEFAULT_CYBER_SETTINGS,
      stateVersion: 1,
    };
  }
}

const TAB_ID = `sf_mon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
let syncChannel: BroadcastChannel | null = null;

function getSyncChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!syncChannel) {
    syncChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  }
  return syncChannel;
}

function persistAndBroadcast(
  monitors: Record<MonitorId, MonitorProfile>,
  cyber: CyberVisualSettings,
  stateVersion: number
): void {
  const envelope: WorkspaceSyncEnvelope = {
    originTabId: TAB_ID,
    stateVersion,
    monitors,
    cyber,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      // ignore quota errors
    }
  }
  try {
    getSyncChannel()?.postMessage(envelope);
  } catch {
    // ignore channel closure errors
  }
}

const initial = loadPersistedWorkspace();

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  tabId: TAB_ID,
  stateVersion: initial.stateVersion,
  activeMonitorId: 'DISPLAY_1',
  monitors: initial.monitors,
  cyber: initial.cyber,
  syncedPeersCount: 1,
  lastSyncAtIso: null,

  setActiveMonitor: (monitorId) => {
    set({ activeMonitorId: monitorId });
  },

  togglePanelVisibility: (panel, monitorId) => {
    const targetId = monitorId ?? get().activeMonitorId;
    const prev = get();
    const targetMonitor = prev.monitors[targetId];
    const nextVersion = prev.stateVersion + 1;
    const nextMonitors: Record<MonitorId, MonitorProfile> = {
      ...prev.monitors,
      [targetId]: {
        ...targetMonitor,
        panels: {
          ...targetMonitor.panels,
          [panel]: !targetMonitor.panels[panel],
        },
      },
    };
    persistAndBroadcast(nextMonitors, prev.cyber, nextVersion);
    set({
      monitors: nextMonitors,
      stateVersion: nextVersion,
      lastSyncAtIso: new Date().toISOString(),
    });
  },

  setPanelVisibility: (panel, visible, monitorId) => {
    const targetId = monitorId ?? get().activeMonitorId;
    const prev = get();
    const targetMonitor = prev.monitors[targetId];
    if (targetMonitor.panels[panel] === visible) return;
    const nextVersion = prev.stateVersion + 1;
    const nextMonitors: Record<MonitorId, MonitorProfile> = {
      ...prev.monitors,
      [targetId]: {
        ...targetMonitor,
        panels: {
          ...targetMonitor.panels,
          [panel]: visible,
        },
      },
    };
    persistAndBroadcast(nextMonitors, prev.cyber, nextVersion);
    set({
      monitors: nextMonitors,
      stateVersion: nextVersion,
      lastSyncAtIso: new Date().toISOString(),
    });
  },

  applyPreset: (preset, monitorId) => {
    const targetId = monitorId ?? get().activeMonitorId;
    const prev = get();
    let panels: PanelVisibilityMap;
    if (preset === 'FULL_COMMAND') {
      panels = makePanels({}, true);
    } else if (preset === 'EXECUTION_120HZ') {
      panels = makePanels(
        {
          hybridArchitecture: true,
          freqtradeTerminal: true,
          systemControls: true,
          agentLoopTelemetry: true,
          agentSyncAudit: true,
          priceChart: true,
          modularProfitTaking: true,
          profitVault: true,
          activeEntryZoneSignals: true,
          prePumpSupportDesk: true,
          backendExecutionLogs: true,
          telegramMonitor: true,
          forgeCapital: true,
          multiAgentArchitecture: true,
          agenticCliLoop: true,
          fableOrchestrator: true,
        },
        false
      );
    } else if (preset === 'SIGNALS_AND_PREPUMP') {
      panels = makePanels(
        {
          agentLoopTelemetry: true,
          agentSyncAudit: true,
          modularProfitTaking: true,
          activeEntryZoneSignals: true,
          prePumpSupportDesk: true,
          backendExecutionLogs: true,
          telegramMonitor: true,
          patternScanner: true,
        },
        false
      );
    } else {
      panels = makePanels(
        {
          systemControls: true,
          agentLoopTelemetry: true,
          agentSyncAudit: true,
          modularProfitTaking: true,
          profitVault: true,
          debateCoordinator: true,
          telegramMonitor: true,
          portfolioHub: true,
          sentinelAgent: true,
          autonomousOps: true,
          orderBookDepth: true,
          smcProfile: true,
        },
        false
      );
    }

    const nextVersion = prev.stateVersion + 1;
    const nextMonitors: Record<MonitorId, MonitorProfile> = {
      ...prev.monitors,
      [targetId]: {
        ...prev.monitors[targetId],
        panels,
      },
    };
    persistAndBroadcast(nextMonitors, prev.cyber, nextVersion);
    set({
      monitors: nextMonitors,
      stateVersion: nextVersion,
      lastSyncAtIso: new Date().toISOString(),
    });
  },

  updateCyberSettings: (patch) => {
    const prev = get();
    const nextCyber: CyberVisualSettings = { ...prev.cyber, ...patch };
    const nextVersion = prev.stateVersion + 1;
    persistAndBroadcast(prev.monitors, nextCyber, nextVersion);
    set({
      cyber: nextCyber,
      stateVersion: nextVersion,
      lastSyncAtIso: new Date().toISOString(),
    });
  },

  resetMonitors: () => {
    const nextMonitors = createDefaultMonitors();
    const nextVersion = get().stateVersion + 1;
    persistAndBroadcast(nextMonitors, DEFAULT_CYBER_SETTINGS, nextVersion);
    set({
      monitors: nextMonitors,
      cyber: DEFAULT_CYBER_SETTINGS,
      stateVersion: nextVersion,
      lastSyncAtIso: new Date().toISOString(),
    });
  },
}));

// Cross-monitor BroadcastChannel listener: strictly monotonic version guard prevents state corruption
if (typeof window !== 'undefined') {
  const ch = getSyncChannel();
  if (ch) {
    ch.onmessage = (event: MessageEvent<WorkspaceSyncEnvelope>) => {
      const msg = event.data;
      if (!msg || msg.originTabId === TAB_ID) return;
      const cur = useWorkspaceStore.getState();
      if (msg.stateVersion <= cur.stateVersion) return;
      useWorkspaceStore.setState({
        monitors: msg.monitors,
        cyber: msg.cyber,
        stateVersion: msg.stateVersion,
        syncedPeersCount: Math.max(2, cur.syncedPeersCount),
        lastSyncAtIso: new Date().toISOString(),
      });
    };
  }
}
