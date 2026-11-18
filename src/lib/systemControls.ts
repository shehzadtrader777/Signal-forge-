export interface SystemRuntimeControls {
  testnetExecutionEnabled: boolean;
  liveFeedModulesEnabled: boolean;
}

export interface ActiveRuntimePlanes {
  runSpotWsStream: boolean;
  runKlineWsStream: boolean;
  runLiveFeedRestPolling: boolean;
  runMonitorSseStream: boolean;
  runBackgroundIntelAgent: boolean;
  runFuturesModules: boolean;
  runTestnetExecution: boolean;
  runTestnetAtrTracking: boolean;
  runSignalEngine: boolean;
  runTopGainersScanner: boolean;
  runTelegramDispatcher: boolean;
  runAutonomousCoordinator: boolean;
  runArbitrageAndCopyTrading: boolean;
}

export interface MonitorHealthSnapshotLike {
  agentActive?: boolean;
  wsChannelStatus?: string;
  autoHealCount?: number;
  anomaliesDetected?: number;
  lastHealAction?: string;
  spotFeedOk?: boolean;
  cmcFeedOk?: boolean;
}

export const SYSTEM_CONTROLS_STORAGE_KEY = 'sf_system_controls_v1';
export const APP_LIVE_STORAGE_KEY = 'sf_app_live_v1';

export const DEFAULT_SYSTEM_CONTROLS: SystemRuntimeControls = {
  testnetExecutionEnabled: true,
  liveFeedModulesEnabled: true,
};

export function parseSystemControls(
  input: unknown,
  fallback: SystemRuntimeControls = DEFAULT_SYSTEM_CONTROLS
): SystemRuntimeControls {
  if (!input || typeof input !== 'object') {
    return { ...fallback };
  }
  const obj = input as Record<string, unknown>;
  return {
    testnetExecutionEnabled:
      typeof obj.testnetExecutionEnabled === 'boolean'
        ? obj.testnetExecutionEnabled
        : fallback.testnetExecutionEnabled,
    liveFeedModulesEnabled:
      typeof obj.liveFeedModulesEnabled === 'boolean'
        ? obj.liveFeedModulesEnabled
        : fallback.liveFeedModulesEnabled,
  };
}

export function mergeSystemControls(
  current: SystemRuntimeControls,
  patch: Partial<SystemRuntimeControls>
): SystemRuntimeControls {
  return {
    testnetExecutionEnabled:
      typeof patch.testnetExecutionEnabled === 'boolean'
        ? patch.testnetExecutionEnabled
        : current.testnetExecutionEnabled,
    liveFeedModulesEnabled:
      typeof patch.liveFeedModulesEnabled === 'boolean'
        ? patch.liveFeedModulesEnabled
        : current.liveFeedModulesEnabled,
  };
}

/**
 * Derives active runtime planes.
 * When appLiveEnabled is false, the Global 'App Live' Master Control Switch immediately halts
 * ALL external API polling, WebSockets, Signal Dispatch, and Autonomous Execution to safeguard quota.
 */
export function deriveActiveRuntimePlanes(
  controls: SystemRuntimeControls,
  appLiveEnabled = true
): ActiveRuntimePlanes {
  if (!appLiveEnabled) {
    return {
      runSpotWsStream: false,
      runKlineWsStream: false,
      runLiveFeedRestPolling: false,
      runMonitorSseStream: false,
      runBackgroundIntelAgent: false,
      runFuturesModules: false,
      runTestnetExecution: false,
      runTestnetAtrTracking: false,
      runSignalEngine: false,
      runTopGainersScanner: false,
      runTelegramDispatcher: false,
      runAutonomousCoordinator: false,
      runArbitrageAndCopyTrading: false,
    };
  }

  const liveActive = Boolean(controls.liveFeedModulesEnabled);
  const testnetActive = Boolean(controls.testnetExecutionEnabled);
  return {
    runSpotWsStream: liveActive,
    runKlineWsStream: liveActive,
    runLiveFeedRestPolling: liveActive,
    runMonitorSseStream: liveActive,
    runBackgroundIntelAgent: liveActive,
    runFuturesModules: liveActive,
    runTestnetExecution: testnetActive,
    runTestnetAtrTracking: testnetActive && liveActive,
    // Core signaling, top-gainers scanner, and Telegram dispatcher remain active when App Live is ON.
    runSignalEngine: true,
    runTopGainersScanner: true,
    runTelegramDispatcher: true,
    runAutonomousCoordinator: testnetActive && liveActive,
    runArbitrageAndCopyTrading: testnetActive && liveActive,
  };
}

export function shouldSyncMonitorHealthUi(
  prev: MonitorHealthSnapshotLike | null | undefined,
  next: MonitorHealthSnapshotLike,
  elapsedMs: number,
  minIntervalMs = 3000
): boolean {
  if (!prev) return true;
  if (
    prev.agentActive !== next.agentActive ||
    prev.wsChannelStatus !== next.wsChannelStatus ||
    prev.autoHealCount !== next.autoHealCount ||
    prev.anomaliesDetected !== next.anomaliesDetected ||
    prev.lastHealAction !== next.lastHealAction ||
    prev.spotFeedOk !== next.spotFeedOk ||
    prev.cmcFeedOk !== next.cmcFeedOk
  ) {
    return true;
  }
  return elapsedMs >= minIntervalMs;
}
