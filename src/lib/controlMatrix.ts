import type {
  ActiveRuntimePlanes,
  SystemRuntimeControls,
} from './systemControls';

export type MicroserviceId =
  | 'market-data-svc'
  | 'ai-agents-svc'
  | 'execution-router-svc'
  | 'risk-kernel-svc'
  | 'telemetry-bus-svc';

export type ControlDomain =
  | 'MARKET_DATA'
  | 'AI_AGENTS'
  | 'EXECUTION_ROUTER'
  | 'RELIABILITY_TELEMETRY';

export type CapabilityClass =
  | 'PUBLIC_VIEW'
  | 'TELEMETRY'
  | 'AGENT_OVERRIDE'
  | 'EXECUTION';

export interface GranularControlMatrix {
  // Market Data Microservice (market-data-svc)
  spotWsStream: boolean;
  l2OrderBookDepth: boolean;
  topGainersScanner: boolean;
  cmcBaselineValidator: boolean;
  futuresFeedModule: boolean;

  // AI Agent Modules Microservice (ai-agents-svc)
  signalEngine: boolean;
  smcVolumeAgent: boolean;
  patternScannerAgent: boolean;
  sentinelAgent: boolean;
  autonomousCoordinator: boolean;
  rlAutoTuner: boolean;
  voiceCommandAgent: boolean;

  // Execution Router Microservice (execution-router-svc)
  spotExecutionRouter: boolean;
  futuresExecutionRouter: boolean;
  testnetSandboxRouter: boolean;
  liveExecutionRouter: boolean;
  crossExchangeArbitrage: boolean;
  institutionalCopyDesk: boolean;
  portfolioAutoRebalancer: boolean;

  // Telemetry & Reliability Microservice (telemetry-bus-svc / risk-kernel-svc)
  telemetrySseStream: boolean;
  diagnosticErrorCapture: boolean;
  haAutoFailover: boolean;
  automatedRollbackProtocol: boolean;
  emailDigestDispatcher: boolean;
}

export type GranularToggleKey = keyof GranularControlMatrix;

export interface ToggleDescriptor {
  key: GranularToggleKey;
  label: string;
  description: string;
  domain: ControlDomain;
  serviceId: MicroserviceId;
  capability: CapabilityClass;
  critical: boolean;
}

export const DEFAULT_CONTROL_MATRIX: GranularControlMatrix = {
  // Market Data
  spotWsStream: true,
  l2OrderBookDepth: true,
  topGainersScanner: true,
  cmcBaselineValidator: true,
  futuresFeedModule: false,

  // AI Agents
  signalEngine: true,
  smcVolumeAgent: true,
  patternScannerAgent: true,
  sentinelAgent: true,
  autonomousCoordinator: true,
  rlAutoTuner: true,
  voiceCommandAgent: true,

  // Execution Router
  spotExecutionRouter: true,
  futuresExecutionRouter: false,
  testnetSandboxRouter: true,
  liveExecutionRouter: false,
  crossExchangeArbitrage: true,
  institutionalCopyDesk: true,
  portfolioAutoRebalancer: true,

  // Reliability & Telemetry
  telemetrySseStream: true,
  diagnosticErrorCapture: true,
  haAutoFailover: true,
  automatedRollbackProtocol: true,
  emailDigestDispatcher: true,
};

export const CONTROL_MATRIX_DESCRIPTORS: readonly ToggleDescriptor[] = [
  // MARKET_DATA
  {
    key: 'spotWsStream',
    label: 'Binance Spot WebSocket',
    description: 'Real-time Spot ticker & 1m/15m kline stream ingestion.',
    domain: 'MARKET_DATA',
    serviceId: 'market-data-svc',
    capability: 'TELEMETRY',
    critical: true,
  },
  {
    key: 'l2OrderBookDepth',
    label: 'Multi-Exchange L2 Depth',
    description: 'Aggregated Binance, Bybit & OKX order-book wall detection.',
    domain: 'MARKET_DATA',
    serviceId: 'market-data-svc',
    capability: 'TELEMETRY',
    critical: false,
  },
  {
    key: 'topGainersScanner',
    label: 'Top Gainers Feeder',
    description: '24h velocity breakout discovery & momentum alerts.',
    domain: 'MARKET_DATA',
    serviceId: 'market-data-svc',
    capability: 'TELEMETRY',
    critical: false,
  },
  {
    key: 'cmcBaselineValidator',
    label: 'CMC Parity Validator',
    description: 'Cross-checks Spot feed ticks against CoinMarketCap baseline.',
    domain: 'MARKET_DATA',
    serviceId: 'market-data-svc',
    capability: 'TELEMETRY',
    critical: true,
  },
  {
    key: 'futuresFeedModule',
    label: 'USD-M Futures Feed',
    description: 'On-demand perpetual mark price, funding & open interest telemetry.',
    domain: 'MARKET_DATA',
    serviceId: 'market-data-svc',
    capability: 'TELEMETRY',
    critical: false,
  },

  // AI_AGENTS
  {
    key: 'signalEngine',
    label: 'Core Signal Engine',
    description: 'Multi-factor setup scoring with immutable 1:5 R:R invariant.',
    domain: 'AI_AGENTS',
    serviceId: 'ai-agents-svc',
    capability: 'AGENT_OVERRIDE',
    critical: true,
  },
  {
    key: 'smcVolumeAgent',
    label: 'SMC & FRVP Agent',
    description: 'Order blocks, fair-value gaps, POC & structural liquidity zones.',
    domain: 'AI_AGENTS',
    serviceId: 'ai-agents-svc',
    capability: 'AGENT_OVERRIDE',
    critical: false,
  },
  {
    key: 'patternScannerAgent',
    label: 'Pattern Breakout Scanner',
    description: 'Double bottom/top, flags & anti-fakeout volume confirmation.',
    domain: 'AI_AGENTS',
    serviceId: 'ai-agents-svc',
    capability: 'AGENT_OVERRIDE',
    critical: false,
  },
  {
    key: 'sentinelAgent',
    label: 'Sentinel FUD Guard',
    description: 'Cross-platform breaking panic, depeg & black-swan halt classifier.',
    domain: 'AI_AGENTS',
    serviceId: 'ai-agents-svc',
    capability: 'AGENT_OVERRIDE',
    critical: true,
  },
  {
    key: 'autonomousCoordinator',
    label: 'Autonomous Coordinator',
    description: 'Zero-intervention entry, 5x ATR trail & reversal exit supervisor.',
    domain: 'AI_AGENTS',
    serviceId: 'ai-agents-svc',
    capability: 'AGENT_OVERRIDE',
    critical: true,
  },
  {
    key: 'rlAutoTuner',
    label: 'RL Policy Auto-Tuner',
    description: 'Reinforcement learning stop/trail calibration within kernel bounds.',
    domain: 'AI_AGENTS',
    serviceId: 'ai-agents-svc',
    capability: 'AGENT_OVERRIDE',
    critical: false,
  },
  {
    key: 'voiceCommandAgent',
    label: 'Voice Emergency Guard',
    description: 'Hands-free push-to-talk & always-listening halt command parser.',
    domain: 'AI_AGENTS',
    serviceId: 'ai-agents-svc',
    capability: 'AGENT_OVERRIDE',
    critical: false,
  },

  // EXECUTION_ROUTER
  {
    key: 'spotExecutionRouter',
    label: 'Spot 1x Router',
    description: 'Primary non-leveraged Binance Spot order routing channel.',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'execution-router-svc',
    capability: 'EXECUTION',
    critical: true,
  },
  {
    key: 'futuresExecutionRouter',
    label: 'USD-M Futures Router',
    description: 'Cross/Isolated leveraged perpetual execution desk.',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'execution-router-svc',
    capability: 'EXECUTION',
    critical: true,
  },
  {
    key: 'testnetSandboxRouter',
    label: 'Testnet Sandbox Desk',
    description: 'Simulated Cross-Margin ledger routed to Binance Testnet.',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'execution-router-svc',
    capability: 'EXECUTION',
    critical: true,
  },
  {
    key: 'liveExecutionRouter',
    label: 'Live Production Desk',
    description: 'Real-capital order execution (requires Email OTP + Premium).',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'execution-router-svc',
    capability: 'EXECUTION',
    critical: true,
  },
  {
    key: 'crossExchangeArbitrage',
    label: 'Arbitrage Router',
    description: 'Delta-neutral multi-venue spread capture above bps floor.',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'execution-router-svc',
    capability: 'EXECUTION',
    critical: false,
  },
  {
    key: 'institutionalCopyDesk',
    label: 'Institutional Copy Desk',
    description: 'Mirrored desk execution capped at 2.0% risk & min 1:5 R:R.',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'execution-router-svc',
    capability: 'EXECUTION',
    critical: false,
  },
  {
    key: 'portfolioAutoRebalancer',
    label: 'Portfolio Auto-Rebalancer',
    description: 'Volatility-weighted multi-asset drift rebalance engine.',
    domain: 'EXECUTION_ROUTER',
    serviceId: 'execution-router-svc',
    capability: 'EXECUTION',
    critical: false,
  },

  // RELIABILITY_TELEMETRY
  {
    key: 'telemetrySseStream',
    label: 'Real-Time SSE Bus',
    description: 'Sub-second server-sent heartbeat & Spot tick fan-out bus.',
    domain: 'RELIABILITY_TELEMETRY',
    serviceId: 'telemetry-bus-svc',
    capability: 'TELEMETRY',
    critical: true,
  },
  {
    key: 'diagnosticErrorCapture',
    label: 'Exhaustive Error Ledger',
    description: 'Captures correlation-ID traced errors across all microservices.',
    domain: 'RELIABILITY_TELEMETRY',
    serviceId: 'telemetry-bus-svc',
    capability: 'TELEMETRY',
    critical: true,
  },
  {
    key: 'haAutoFailover',
    label: 'HA Auto-Failover',
    description: 'Switches Primary → Standby nodes automatically on consecutive faults.',
    domain: 'RELIABILITY_TELEMETRY',
    serviceId: 'risk-kernel-svc',
    capability: 'TELEMETRY',
    critical: true,
  },
  {
    key: 'automatedRollbackProtocol',
    label: 'Automated Rollback',
    description: 'Reverts unstable config mutations to last verified healthy snapshot.',
    domain: 'RELIABILITY_TELEMETRY',
    serviceId: 'risk-kernel-svc',
    capability: 'TELEMETRY',
    critical: true,
  },
  {
    key: 'emailDigestDispatcher',
    label: '3-Hour Signal Digest',
    description: 'Batches >=85% high-conviction alerts without individual spam.',
    domain: 'RELIABILITY_TELEMETRY',
    serviceId: 'telemetry-bus-svc',
    capability: 'TELEMETRY',
    critical: false,
  },
] as const;

export const CONTROL_TOGGLE_KEYS: readonly GranularToggleKey[] = CONTROL_MATRIX_DESCRIPTORS.map(
  (d) => d.key
);

export const DESCRIPTOR_BY_KEY: Record<GranularToggleKey, ToggleDescriptor> =
  CONTROL_MATRIX_DESCRIPTORS.reduce(
    (acc, item) => {
      acc[item.key] = item;
      return acc;
    },
    {} as Record<GranularToggleKey, ToggleDescriptor>
  );

export function parseGranularControlMatrix(
  input: unknown,
  fallback: GranularControlMatrix = DEFAULT_CONTROL_MATRIX
): GranularControlMatrix {
  const base: GranularControlMatrix = { ...fallback };
  if (!input || typeof input !== 'object') {
    return base;
  }
  const obj = input as Record<string, unknown>;
  for (const key of CONTROL_TOGGLE_KEYS) {
    if (typeof obj[key] === 'boolean') {
      base[key] = obj[key] as boolean;
    }
  }
  return base;
}

export function mergeGranularControlMatrix(
  current: GranularControlMatrix,
  patch: Partial<GranularControlMatrix>
): GranularControlMatrix {
  const next: GranularControlMatrix = { ...current };
  for (const key of CONTROL_TOGGLE_KEYS) {
    if (typeof patch[key] === 'boolean') {
      next[key] = patch[key] as boolean;
    }
  }
  return next;
}

export function diffControlMatrix(
  before: GranularControlMatrix,
  after: GranularControlMatrix
): Array<{ key: GranularToggleKey; from: boolean; to: boolean }> {
  const changes: Array<{ key: GranularToggleKey; from: boolean; to: boolean }> = [];
  for (const key of CONTROL_TOGGLE_KEYS) {
    if (before[key] !== after[key]) {
      changes.push({ key, from: before[key], to: after[key] });
    }
  }
  return changes;
}

export function matrixToSystemControls(
  matrix: GranularControlMatrix
): SystemRuntimeControls {
  return {
    testnetExecutionEnabled: matrix.testnetSandboxRouter,
    liveFeedModulesEnabled:
      matrix.spotWsStream || matrix.telemetrySseStream || matrix.l2OrderBookDepth,
  };
}

export function applySystemControlsToMatrix(
  matrix: GranularControlMatrix,
  controls: Partial<SystemRuntimeControls>
): GranularControlMatrix {
  const next = { ...matrix };
  if (typeof controls.testnetExecutionEnabled === 'boolean') {
    next.testnetSandboxRouter = controls.testnetExecutionEnabled;
  }
  if (typeof controls.liveFeedModulesEnabled === 'boolean') {
    next.spotWsStream = controls.liveFeedModulesEnabled;
    next.telemetrySseStream = controls.liveFeedModulesEnabled;
    next.l2OrderBookDepth = controls.liveFeedModulesEnabled;
  }
  return next;
}

export function derivePlanesFromMatrix(
  matrix: GranularControlMatrix,
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
  return {
    runSpotWsStream: matrix.spotWsStream,
    runKlineWsStream: matrix.spotWsStream,
    runLiveFeedRestPolling: matrix.spotWsStream || matrix.cmcBaselineValidator,
    runMonitorSseStream: matrix.telemetrySseStream,
    runBackgroundIntelAgent: matrix.sentinelAgent || matrix.smcVolumeAgent,
    runFuturesModules: matrix.futuresFeedModule || matrix.futuresExecutionRouter,
    runTestnetExecution: matrix.testnetSandboxRouter,
    runTestnetAtrTracking: matrix.testnetSandboxRouter && matrix.spotWsStream,
    runSignalEngine: matrix.signalEngine,
    runTopGainersScanner: matrix.topGainersScanner,
    runTelegramDispatcher: matrix.emailDigestDispatcher,
    runAutonomousCoordinator:
      matrix.autonomousCoordinator &&
      (matrix.testnetSandboxRouter || matrix.liveExecutionRouter),
    runArbitrageAndCopyTrading:
      (matrix.crossExchangeArbitrage || matrix.institutionalCopyDesk) &&
      matrix.testnetSandboxRouter,
  };
}

export function computeMatrixChecksum(matrix: GranularControlMatrix): string {
  const ordered = CONTROL_TOGGLE_KEYS.map((k) => `${k}:${matrix[k] ? '1' : '0'}`).join('|');
  let hash = 2166136261;
  for (let i = 0; i < ordered.length; i++) {
    hash ^= ordered.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `mtx_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
