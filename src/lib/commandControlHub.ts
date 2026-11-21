import {
  CONTROL_MATRIX_DESCRIPTORS,
  CONTROL_TOGGLE_KEYS,
  DEFAULT_CONTROL_MATRIX,
  computeMatrixChecksum,
  type ControlDomain,
  type GranularControlMatrix,
  type GranularToggleKey,
  type MicroserviceId,
} from './controlMatrix';

export type CommandDomainId = ControlDomain;

export type MasterOverrideMode = 'GRANULAR' | 'FORCE_ON' | 'FORCE_OFF';

export type GlobalMasterOverride = 'GRANULAR' | 'FORCE_ALL_ON' | 'FORCE_ALL_OFF';

export type CommandModuleKind = 'FEED' | 'AGENT' | 'TOOL' | 'SAFEGUARD';

export type EffectiveResolutionSource =
  | 'GRANULAR'
  | 'GLOBAL_FORCE_ON'
  | 'GLOBAL_FORCE_OFF'
  | 'DOMAIN_FORCE_ON'
  | 'DOMAIN_FORCE_OFF';

export type CommandPresetId =
  | 'FULL_COMMAND'
  | 'SAFE_MONITOR_ONLY'
  | 'EXECUTION_LOCKDOWN'
  | 'RESTORE_GRANULAR';

export type TapToTopDisplayMode = 'PERSISTENT' | 'ON_SCROLL';

export interface DockPreferences {
  tapToTopMode: TapToTopDisplayMode;
  showDockLabels: boolean;
  voiceOverlayAutoClose: boolean;
}

export interface CommandDomainDescriptor {
  id: CommandDomainId;
  label: string;
  shortLabel: string;
  description: string;
  ownerService: MicroserviceId;
}

export interface CommandModuleDescriptor {
  id: string;
  label: string;
  description: string;
  domain: CommandDomainId;
  serviceId: MicroserviceId;
  kind: CommandModuleKind;
  critical: boolean;
  defaultEnabled: boolean;
  controlMatrixKey?: GranularToggleKey;
  workspacePanelKey?: string;
}

export interface CommandControlHubState {
  globalOverride: GlobalMasterOverride;
  domainOverrides: Record<CommandDomainId, MasterOverrideMode>;
  granularEnabled: Record<string, boolean>;
  dock: DockPreferences;
  stateVersion: number;
  updatedAtIso: string;
}

export interface EvaluatedCommandModule {
  descriptor: CommandModuleDescriptor;
  granularEnabled: boolean;
  effectiveEnabled: boolean;
  resolution: EffectiveResolutionSource;
  isOverridden: boolean;
}

export interface CommandDomainSummary {
  domain: CommandDomainDescriptor;
  overrideMode: MasterOverrideMode;
  totalModules: number;
  effectiveActiveCount: number;
  granularActiveCount: number;
  overriddenCount: number;
}

export interface CommandControlEvaluationSnapshot {
  modules: EvaluatedCommandModule[];
  domainSummaries: CommandDomainSummary[];
  totalModules: number;
  effectiveActiveCount: number;
  overriddenCount: number;
  derivedControlMatrix: GranularControlMatrix;
  matrixChecksum: string;
}

export interface CommandModuleFilterOptions {
  domain?: CommandDomainId | 'ALL';
  kind?: CommandModuleKind | 'ALL';
  query?: string;
}

export const COMMAND_DOMAINS: readonly CommandDomainDescriptor[] = [
  {
    id: 'MARKET_DATA',
    label: 'Market Feeds & Parity',
    shortLabel: 'Market Feeds',
    description: 'Spot WebSocket streams, L2 depth walls, Top Gainers scanner, and CMC baseline validation.',
    ownerService: 'market-data-svc',
  },
  {
    id: 'AI_AGENTS',
    label: 'AI Agents & Intelligence',
    shortLabel: 'AI Agents',
    description: 'Signal Engine, Multi-Agent Debate AI, SMC/FRVP, Pattern Scanner, Sentinel FUD Guard, and Voice Agent.',
    ownerService: 'ai-agents-svc',
  },
  {
    id: 'EXECUTION_ROUTER',
    label: 'Execution & Capital Tools',
    shortLabel: 'Execution Tools',
    description: 'Spot/Futures routers, Testnet/Live desks, Profit Vault Auto-Scooper, Modular TP/SL, and Rebalancer.',
    ownerService: 'execution-router-svc',
  },
  {
    id: 'RELIABILITY_TELEMETRY',
    label: 'Telemetry & Safeguards',
    shortLabel: 'Safeguards',
    description: 'Real-time SSE bus, HA auto-failover, rollback checkpoints, Telegram dual-stream relay, and diagnostics.',
    ownerService: 'telemetry-bus-svc',
  },
] as const;

const WORKSPACE_PANEL_BINDINGS: Partial<Record<GranularToggleKey, string>> = {
  spotWsStream: 'priceChart',
  l2OrderBookDepth: 'orderBookDepth',
  topGainersScanner: 'prePumpSupportDesk',
  signalEngine: 'activeEntryZoneSignals',
  smcVolumeAgent: 'smcProfile',
  patternScannerAgent: 'patternScanner',
  sentinelAgent: 'sentinelAgent',
  autonomousCoordinator: 'autonomousOps',
  spotExecutionRouter: 'freqtradeTerminal',
  testnetSandboxRouter: 'liveLedger',
  portfolioAutoRebalancer: 'portfolioHub',
  telemetrySseStream: 'agentLoopTelemetry',
  emailDigestDispatcher: 'telegramMonitor',
};

function domainToDefaultKind(domain: CommandDomainId): CommandModuleKind {
  switch (domain) {
    case 'MARKET_DATA':
      return 'FEED';
    case 'AI_AGENTS':
      return 'AGENT';
    case 'EXECUTION_ROUTER':
      return 'TOOL';
    case 'RELIABILITY_TELEMETRY':
      return 'SAFEGUARD';
  }
}

const SPECIALIZED_ENGINE_MODULES: readonly CommandModuleDescriptor[] = [
  {
    id: 'multiAgentDebateCoordinator',
    label: 'Multi-Agent Debate Coordinator',
    description: 'Gemini-grounded 3-role debate kernel (Researcher, Risk Manager, Trader) with consensus veto.',
    domain: 'AI_AGENTS',
    serviceId: 'ai-agents-svc',
    kind: 'AGENT',
    critical: true,
    defaultEnabled: true,
    workspacePanelKey: 'debateCoordinator',
  },
  {
    id: 'profitVaultScooper',
    label: 'Profit Scooping & Vault Locker',
    description: 'High-frequency realized gain scooper locking surplus profits into immutable vault with 6h Yearn decay.',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'execution-router-svc',
    kind: 'TOOL',
    critical: true,
    defaultEnabled: true,
    workspacePanelKey: 'profitVault',
  },
  {
    id: 'modularTpSlEngine',
    label: 'Modular TP/SL Risk Studio',
    description: 'Volatility-adapted multi-tier take-profit and structural stop-loss engine enforcing 1:5 R:R floor.',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'risk-kernel-svc',
    kind: 'TOOL',
    critical: true,
    defaultEnabled: true,
    workspacePanelKey: 'modularProfitTaking',
  },
  {
    id: 'backtestingMatrixEngine',
    label: 'Backtesting Matrix Engine',
    description: 'Walk-forward 30/60/90d multi-strategy comparative simulation and parameter grid optimizer.',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'ai-agents-svc',
    kind: 'TOOL',
    critical: false,
    defaultEnabled: true,
  },
  {
    id: 'telegramDualStreamRelay',
    label: 'Telegram Dual-Stream Relay',
    description: 'Deduplicated public Signal Forge trade cards + private developer audit stream & webhook stabilizer.',
    domain: 'RELIABILITY_TELEMETRY',
    serviceId: 'telemetry-bus-svc',
    kind: 'SAFEGUARD',
    critical: true,
    defaultEnabled: true,
    workspacePanelKey: 'telegramMonitor',
  },
] as const;

export const COMMAND_MODULE_CATALOG: readonly CommandModuleDescriptor[] = [
  ...CONTROL_MATRIX_DESCRIPTORS.map((desc) => ({
    id: desc.key,
    label: desc.label,
    description: desc.description,
    domain: desc.domain,
    serviceId: desc.serviceId,
    kind: domainToDefaultKind(desc.domain),
    critical: desc.critical,
    defaultEnabled: DEFAULT_CONTROL_MATRIX[desc.key],
    controlMatrixKey: desc.key,
    workspacePanelKey: WORKSPACE_PANEL_BINDINGS[desc.key],
  })),
  ...SPECIALIZED_ENGINE_MODULES,
];

export const COMMAND_MODULE_BY_ID: Record<string, CommandModuleDescriptor> =
  COMMAND_MODULE_CATALOG.reduce<Record<string, CommandModuleDescriptor>>((acc, mod) => {
    acc[mod.id] = mod;
    return acc;
  }, {});

export const DEFAULT_DOCK_PREFERENCES: DockPreferences = {
  tapToTopMode: 'PERSISTENT',
  showDockLabels: true,
  voiceOverlayAutoClose: false,
};

export function createDefaultCommandControlState(
  initialMatrix: GranularControlMatrix = DEFAULT_CONTROL_MATRIX,
  nowIso: string = new Date().toISOString()
): CommandControlHubState {
  const granularEnabled: Record<string, boolean> = {};
  for (const mod of COMMAND_MODULE_CATALOG) {
    if (mod.controlMatrixKey) {
      granularEnabled[mod.id] = initialMatrix[mod.controlMatrixKey];
    } else {
      granularEnabled[mod.id] = mod.defaultEnabled;
    }
  }
  return {
    globalOverride: 'GRANULAR',
    domainOverrides: {
      MARKET_DATA: 'GRANULAR',
      AI_AGENTS: 'GRANULAR',
      EXECUTION_ROUTER: 'GRANULAR',
      RELIABILITY_TELEMETRY: 'GRANULAR',
    },
    granularEnabled,
    dock: { ...DEFAULT_DOCK_PREFERENCES },
    stateVersion: 1,
    updatedAtIso: nowIso,
  };
}

export function sanitizeCommandControlState(
  input: unknown,
  fallbackMatrix: GranularControlMatrix = DEFAULT_CONTROL_MATRIX
): CommandControlHubState {
  const defaults = createDefaultCommandControlState(fallbackMatrix);
  if (!input || typeof input !== 'object') {
    return defaults;
  }
  const raw = input as Partial<CommandControlHubState>;
  const globalOverride: GlobalMasterOverride =
    raw.globalOverride === 'FORCE_ALL_ON' ||
    raw.globalOverride === 'FORCE_ALL_OFF' ||
    raw.globalOverride === 'GRANULAR'
      ? raw.globalOverride
      : defaults.globalOverride;

  const domainOverrides: Record<CommandDomainId, MasterOverrideMode> = {
    ...defaults.domainOverrides,
  };
  if (raw.domainOverrides && typeof raw.domainOverrides === 'object') {
    for (const domain of COMMAND_DOMAINS) {
      const val = raw.domainOverrides[domain.id];
      if (val === 'GRANULAR' || val === 'FORCE_ON' || val === 'FORCE_OFF') {
        domainOverrides[domain.id] = val;
      }
    }
  }

  const granularEnabled: Record<string, boolean> = { ...defaults.granularEnabled };
  if (raw.granularEnabled && typeof raw.granularEnabled === 'object') {
    for (const mod of COMMAND_MODULE_CATALOG) {
      if (typeof raw.granularEnabled[mod.id] === 'boolean') {
        granularEnabled[mod.id] = raw.granularEnabled[mod.id];
      }
    }
  }

  const dock: DockPreferences = {
    tapToTopMode:
      raw.dock?.tapToTopMode === 'ON_SCROLL' || raw.dock?.tapToTopMode === 'PERSISTENT'
        ? raw.dock.tapToTopMode
        : defaults.dock.tapToTopMode,
    showDockLabels:
      typeof raw.dock?.showDockLabels === 'boolean'
        ? raw.dock.showDockLabels
        : defaults.dock.showDockLabels,
    voiceOverlayAutoClose:
      typeof raw.dock?.voiceOverlayAutoClose === 'boolean'
        ? raw.dock.voiceOverlayAutoClose
        : defaults.dock.voiceOverlayAutoClose,
  };

  return {
    globalOverride,
    domainOverrides,
    granularEnabled,
    dock,
    stateVersion: typeof raw.stateVersion === 'number' && raw.stateVersion >= 1 ? raw.stateVersion : 1,
    updatedAtIso: typeof raw.updatedAtIso === 'string' ? raw.updatedAtIso : defaults.updatedAtIso,
  };
}

export function resolveModuleEffectiveState(
  moduleId: string,
  state: CommandControlHubState
): EvaluatedCommandModule {
  const descriptor = COMMAND_MODULE_BY_ID[moduleId];
  if (!descriptor) {
    throw new Error(`Unknown Command Control module ID: ${moduleId}`);
  }
  const granularEnabled =
    typeof state.granularEnabled[moduleId] === 'boolean'
      ? state.granularEnabled[moduleId]
      : descriptor.defaultEnabled;

  if (state.globalOverride === 'FORCE_ALL_OFF') {
    return {
      descriptor,
      granularEnabled,
      effectiveEnabled: false,
      resolution: 'GLOBAL_FORCE_OFF',
      isOverridden: true,
    };
  }
  if (state.globalOverride === 'FORCE_ALL_ON') {
    return {
      descriptor,
      granularEnabled,
      effectiveEnabled: true,
      resolution: 'GLOBAL_FORCE_ON',
      isOverridden: true,
    };
  }

  const domainMode = state.domainOverrides[descriptor.domain] ?? 'GRANULAR';
  if (domainMode === 'FORCE_OFF') {
    return {
      descriptor,
      granularEnabled,
      effectiveEnabled: false,
      resolution: 'DOMAIN_FORCE_OFF',
      isOverridden: true,
    };
  }
  if (domainMode === 'FORCE_ON') {
    return {
      descriptor,
      granularEnabled,
      effectiveEnabled: true,
      resolution: 'DOMAIN_FORCE_ON',
      isOverridden: true,
    };
  }

  return {
    descriptor,
    granularEnabled,
    effectiveEnabled: granularEnabled,
    resolution: 'GRANULAR',
    isOverridden: false,
  };
}

export function evaluateCommandControlSnapshot(
  state: CommandControlHubState
): CommandControlEvaluationSnapshot {
  const modules: EvaluatedCommandModule[] = COMMAND_MODULE_CATALOG.map((mod) =>
    resolveModuleEffectiveState(mod.id, state)
  );

  const derivedControlMatrix: GranularControlMatrix = { ...DEFAULT_CONTROL_MATRIX };
  for (const evaluated of modules) {
    if (evaluated.descriptor.controlMatrixKey) {
      derivedControlMatrix[evaluated.descriptor.controlMatrixKey] = evaluated.effectiveEnabled;
    }
  }

  const domainSummaries: CommandDomainSummary[] = COMMAND_DOMAINS.map((domain) => {
    const domainMods = modules.filter((m) => m.descriptor.domain === domain.id);
    return {
      domain,
      overrideMode: state.domainOverrides[domain.id] ?? 'GRANULAR',
      totalModules: domainMods.length,
      effectiveActiveCount: domainMods.filter((m) => m.effectiveEnabled).length,
      granularActiveCount: domainMods.filter((m) => m.granularEnabled).length,
      overriddenCount: domainMods.filter((m) => m.isOverridden).length,
    };
  });

  const effectiveActiveCount = modules.filter((m) => m.effectiveEnabled).length;
  const overriddenCount = modules.filter((m) => m.isOverridden).length;
  const matrixChecksum = computeMatrixChecksum(derivedControlMatrix);

  return {
    modules,
    domainSummaries,
    totalModules: modules.length,
    effectiveActiveCount,
    overriddenCount,
    derivedControlMatrix,
    matrixChecksum,
  };
}

export function setGlobalMasterOverride(
  state: CommandControlHubState,
  mode: GlobalMasterOverride,
  nowIso: string = new Date().toISOString()
): CommandControlHubState {
  return {
    ...state,
    globalOverride: mode,
    stateVersion: state.stateVersion + 1,
    updatedAtIso: nowIso,
  };
}

export function setDomainMasterOverride(
  state: CommandControlHubState,
  domain: CommandDomainId,
  mode: MasterOverrideMode,
  nowIso: string = new Date().toISOString()
): CommandControlHubState {
  return {
    ...state,
    globalOverride: state.globalOverride !== 'GRANULAR' ? 'GRANULAR' : state.globalOverride,
    domainOverrides: {
      ...state.domainOverrides,
      [domain]: mode,
    },
    stateVersion: state.stateVersion + 1,
    updatedAtIso: nowIso,
  };
}

export function setModuleGranularToggle(
  state: CommandControlHubState,
  moduleId: string,
  enabled: boolean,
  nowIso: string = new Date().toISOString()
): CommandControlHubState {
  if (!COMMAND_MODULE_BY_ID[moduleId]) {
    return state;
  }
  return {
    ...state,
    granularEnabled: {
      ...state.granularEnabled,
      [moduleId]: enabled,
    },
    stateVersion: state.stateVersion + 1,
    updatedAtIso: nowIso,
  };
}

export function updateDockPreferences(
  state: CommandControlHubState,
  patch: Partial<DockPreferences>,
  nowIso: string = new Date().toISOString()
): CommandControlHubState {
  return {
    ...state,
    dock: {
      ...state.dock,
      ...patch,
    },
    stateVersion: state.stateVersion + 1,
    updatedAtIso: nowIso,
  };
}

export function applyCommandPreset(
  state: CommandControlHubState,
  preset: CommandPresetId,
  nowIso: string = new Date().toISOString()
): CommandControlHubState {
  if (preset === 'RESTORE_GRANULAR') {
    return {
      ...state,
      globalOverride: 'GRANULAR',
      domainOverrides: {
        MARKET_DATA: 'GRANULAR',
        AI_AGENTS: 'GRANULAR',
        EXECUTION_ROUTER: 'GRANULAR',
        RELIABILITY_TELEMETRY: 'GRANULAR',
      },
      stateVersion: state.stateVersion + 1,
      updatedAtIso: nowIso,
    };
  }

  if (preset === 'FULL_COMMAND') {
    return {
      ...state,
      globalOverride: 'FORCE_ALL_ON',
      domainOverrides: {
        MARKET_DATA: 'GRANULAR',
        AI_AGENTS: 'GRANULAR',
        EXECUTION_ROUTER: 'GRANULAR',
        RELIABILITY_TELEMETRY: 'GRANULAR',
      },
      stateVersion: state.stateVersion + 1,
      updatedAtIso: nowIso,
    };
  }

  if (preset === 'SAFE_MONITOR_ONLY') {
    return {
      ...state,
      globalOverride: 'GRANULAR',
      domainOverrides: {
        MARKET_DATA: 'FORCE_ON',
        AI_AGENTS: 'GRANULAR',
        EXECUTION_ROUTER: 'FORCE_OFF',
        RELIABILITY_TELEMETRY: 'FORCE_ON',
      },
      stateVersion: state.stateVersion + 1,
      updatedAtIso: nowIso,
    };
  }

  // EXECUTION_LOCKDOWN: keep telemetry & feeds granular, strictly lock execution routers OFF
  return {
    ...state,
    globalOverride: 'GRANULAR',
    domainOverrides: {
      ...state.domainOverrides,
      EXECUTION_ROUTER: 'FORCE_OFF',
    },
    stateVersion: state.stateVersion + 1,
    updatedAtIso: nowIso,
  };
}

export function filterCommandModules(
  modules: readonly EvaluatedCommandModule[],
  options: CommandModuleFilterOptions
): EvaluatedCommandModule[] {
  const domainFilter = options.domain ?? 'ALL';
  const kindFilter = options.kind ?? 'ALL';
  const query = (options.query ?? '').trim().toLowerCase();

  return modules.filter((item) => {
    if (domainFilter !== 'ALL' && item.descriptor.domain !== domainFilter) {
      return false;
    }
    if (kindFilter !== 'ALL' && item.descriptor.kind !== kindFilter) {
      return false;
    }
    if (query.length > 0) {
      const hay = `${item.descriptor.label} ${item.descriptor.description} ${item.descriptor.id} ${item.descriptor.serviceId}`.toLowerCase();
      if (!hay.includes(query)) {
        return false;
      }
    }
    return true;
  });
}

export function computeControlMatrixDelta(
  currentBackendMatrix: GranularControlMatrix,
  targetMatrix: GranularControlMatrix
): Array<{ key: GranularToggleKey; value: boolean }> {
  const diffs: Array<{ key: GranularToggleKey; value: boolean }> = [];
  for (const key of CONTROL_TOGGLE_KEYS) {
    if (currentBackendMatrix[key] !== targetMatrix[key]) {
      diffs.push({ key, value: targetMatrix[key] });
    }
  }
  return diffs;
}
