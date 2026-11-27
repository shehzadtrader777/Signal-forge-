/**
 * Signal Forge — Canonical Modular Platform Architecture & Exchange Control Contracts
 *
 * Exposes stable, typed interfaces connecting all 12 core subsystems without
 * duplicating existing engines or breaking backward compatibility.
 */

export type PlatformSubsystemId =
  | 'MARKET_DATA_ENGINE'
  | 'AI_AGENT_COORDINATOR'
  | 'STRATEGY_ENGINE'
  | 'RISK_MANAGEMENT'
  | 'BACKTESTING_ENGINE'
  | 'EXCHANGE_ROUTER'
  | 'TRADING_EXECUTION'
  | 'PORTFOLIO_MANAGEMENT'
  | 'HEDGING_ENGINE'
  | 'NOTIFICATIONS_REPORTING'
  | 'USER_AUTHENTICATION'
  | 'PUBLIC_WEBSITE';

export type SubsystemLayer = 'DATA' | 'INTELLIGENCE' | 'EXECUTION' | 'RISK' | 'EXPERIENCE';

export type SubsystemImplementationState = 'OPERATIONAL' | 'PARTIAL' | 'SIMULATED_FALLBACK';

export interface PlatformSubsystemContract {
  readonly id: PlatformSubsystemId;
  readonly name: string;
  readonly layer: SubsystemLayer;
  readonly primaryModulePath: string;
  readonly apiEndpoints: readonly string[];
  readonly dependsOn: readonly PlatformSubsystemId[];
  readonly implementationState: SubsystemImplementationState;
  readonly summary: string;
}

export const PLATFORM_SUBSYSTEM_REGISTRY: readonly PlatformSubsystemContract[] = [
  {
    id: 'MARKET_DATA_ENGINE',
    name: 'Market Data Engine',
    layer: 'DATA',
    primaryModulePath: 'src/lib/wsDataEngine.ts',
    apiEndpoints: ['/api/market/tickers', '/api/market/klines', '/api/market/orderbook'],
    dependsOn: [],
    implementationState: 'OPERATIONAL',
    summary: 'Real-time Binance Spot/Futures WebSocket ingestion, outlier validation, and TradingView bar reconciliation.',
  },
  {
    id: 'AI_AGENT_COORDINATOR',
    name: 'AI Agent Coordinator',
    layer: 'INTELLIGENCE',
    primaryModulePath: 'src/lib/coordinator.ts',
    apiEndpoints: ['/api/intelligence/evaluate', '/api/agent/command'],
    dependsOn: ['MARKET_DATA_ENGINE', 'STRATEGY_ENGINE', 'RISK_MANAGEMENT'],
    implementationState: 'OPERATIONAL',
    summary: 'Multi-agent consensus, Skeptic Agent veto filtering, and voice/text command routing.',
  },
  {
    id: 'STRATEGY_ENGINE',
    name: 'Strategy Engine',
    layer: 'INTELLIGENCE',
    primaryModulePath: 'src/lib/signals.ts',
    apiEndpoints: ['/api/signals/history', '/api/pipeline/dashboard-snapshot'],
    dependsOn: ['MARKET_DATA_ENGINE'],
    implementationState: 'OPERATIONAL',
    summary: 'EMA/RSI momentum, SMC Order Blocks, Fixed Range Volume Profile, and chart pattern detection.',
  },
  {
    id: 'RISK_MANAGEMENT',
    name: 'Risk Management',
    layer: 'RISK',
    primaryModulePath: 'src/lib/masterContainment.ts',
    apiEndpoints: ['/api/exchanges/risk-config', '/api/containment/status'],
    dependsOn: ['MARKET_DATA_ENGINE', 'PORTFOLIO_MANAGEMENT'],
    implementationState: 'OPERATIONAL',
    summary: 'Stop-loss caps, R:R invariants, automated flash-crash circuit breakers, and kill-switch containment.',
  },
  {
    id: 'BACKTESTING_ENGINE',
    name: 'Backtesting Engine',
    layer: 'INTELLIGENCE',
    primaryModulePath: 'src/lib/backtester.ts',
    apiEndpoints: ['/api/backtesting/run'],
    dependsOn: ['MARKET_DATA_ENGINE', 'STRATEGY_ENGINE', 'RISK_MANAGEMENT'],
    implementationState: 'OPERATIONAL',
    summary: '30/60/90-day walk-forward out-of-sample simulation with slippage and fee modeling.',
  },
  {
    id: 'EXCHANGE_ROUTER',
    name: 'Exchange Router',
    layer: 'EXECUTION',
    primaryModulePath: 'src/lib/freqtradeUnifiedEngine.ts',
    apiEndpoints: ['/api/exchanges/control-center', '/api/freqtrade/state'],
    dependsOn: ['MARKET_DATA_ENGINE', 'RISK_MANAGEMENT', 'USER_AUTHENTICATION'],
    implementationState: 'PARTIAL',
    summary: 'Unified exchange status and routing control across Binance, Bybit, OKX, and Kraken with Paper/Demo/Live separation.',
  },
  {
    id: 'TRADING_EXECUTION',
    name: 'Trading Execution',
    layer: 'EXECUTION',
    primaryModulePath: 'src/lib/executionEngine.ts',
    apiEndpoints: ['/api/execution/state', '/api/execution/mode', '/api/execution/order'],
    dependsOn: ['EXCHANGE_ROUTER', 'RISK_MANAGEMENT', 'USER_AUTHENTICATION'],
    implementationState: 'OPERATIONAL',
    summary: 'Testnet/Paper sandbox execution with OTP-gated Live transition and atomic order mutex locking.',
  },
  {
    id: 'PORTFOLIO_MANAGEMENT',
    name: 'Portfolio Management',
    layer: 'RISK',
    primaryModulePath: 'src/lib/portfolioAnalytics.ts',
    apiEndpoints: ['/api/portfolio/summary'],
    dependsOn: ['MARKET_DATA_ENGINE', 'TRADING_EXECUTION'],
    implementationState: 'OPERATIONAL',
    summary: 'Multi-asset exposure tracking, cross-margin parity, profit vault locking, and daily PnL ledgers.',
  },
  {
    id: 'HEDGING_ENGINE',
    name: 'Hedging Engine',
    layer: 'RISK',
    primaryModulePath: 'src/lib/masterContainment.ts',
    apiEndpoints: ['/api/containment/status'],
    dependsOn: ['MARKET_DATA_ENGINE', 'PORTFOLIO_MANAGEMENT', 'RISK_MANAGEMENT'],
    implementationState: 'OPERATIONAL',
    summary: 'ATR volatility-adjusted trailing buffers, funding-rate protection, and correlated counter-hedges.',
  },
  {
    id: 'NOTIFICATIONS_REPORTING',
    name: 'Notifications and Reporting',
    layer: 'EXPERIENCE',
    primaryModulePath: 'src/lib/autoReports.ts',
    apiEndpoints: ['/api/alerts/history', '/api/digest/dispatch', '/api/reports/performance'],
    dependsOn: ['STRATEGY_ENGINE', 'TRADING_EXECUTION', 'PORTFOLIO_MANAGEMENT'],
    implementationState: 'PARTIAL',
    summary: '3-hour batched signal digests, Daily/Weekly/Monthly performance reports, Telegram channel broadcast, and Email delivery.',
  },
  {
    id: 'USER_AUTHENTICATION',
    name: 'User Authentication',
    layer: 'RISK',
    primaryModulePath: 'src/lib/firebase.ts',
    apiEndpoints: ['/api/security/live-otp/status', '/api/security/live-otp/request'],
    dependsOn: [],
    implementationState: 'OPERATIONAL',
    summary: 'Firebase Authentication, RBAC role enforcement, operator session tokens, and Live-switch Email OTP challenge.',
  },
  {
    id: 'PUBLIC_WEBSITE',
    name: 'Public Website',
    layer: 'EXPERIENCE',
    primaryModulePath: 'src/pages/PublicHome.tsx',
    apiEndpoints: ['/api/public/trade-ledger', '/api/market/tickers'],
    dependsOn: ['MARKET_DATA_ENGINE', 'STRATEGY_ENGINE', 'USER_AUTHENTICATION'],
    implementationState: 'OPERATIONAL',
    summary: 'Public trading platform homepage with Trade ID verification, public signals, and strict isolation from private user data.',
  },
];

export type SupportedExchangeId = 'BINANCE' | 'BYBIT' | 'OKX' | 'KRAKEN';

export type ExchangeConnectionStatus = 'CONNECTED' | 'SANDBOX_ONLY' | 'CREDENTIALS_REQUIRED' | 'DEGRADED';

export interface ExchangeRiskSettings {
  readonly maxRiskPerTradePct: number;
  readonly maxDailyLossPct: number;
  readonly maxLeverage: number;
  readonly maxOpenPositions: number;
  readonly requireStopLoss: boolean;
}

export interface ExchangeControlProfile {
  readonly id: SupportedExchangeId;
  readonly name: string;
  readonly connectionStatus: ExchangeConnectionStatus;
  readonly paperDemoAvailable: boolean;
  readonly paperDemoActive: boolean;
  readonly liveCredentialsConfigured: boolean;
  readonly liveTradingEnabled: boolean;
  readonly marketFeedEndpoint: string;
  readonly supportedMarkets: readonly ('SPOT' | 'FUTURES')[];
  readonly riskSettings: ExchangeRiskSettings;
  readonly notes: string;
}

export const DEFAULT_EXCHANGE_CONTROLS: readonly ExchangeControlProfile[] = [
  {
    id: 'BINANCE',
    name: 'Binance',
    connectionStatus: 'SANDBOX_ONLY',
    paperDemoAvailable: true,
    paperDemoActive: true,
    liveCredentialsConfigured: false,
    liveTradingEnabled: false,
    marketFeedEndpoint: 'https://testnet.binance.vision/api/v3',
    supportedMarkets: ['SPOT', 'FUTURES'],
    riskSettings: {
      maxRiskPerTradePct: 1.0,
      maxDailyLossPct: 3.0,
      maxLeverage: 5,
      maxOpenPositions: 4,
      requireStopLoss: true,
    },
    notes: 'Primary real-time WebSocket feed and Testnet sandbox active.',
  },
  {
    id: 'BYBIT',
    name: 'Bybit',
    connectionStatus: 'CREDENTIALS_REQUIRED',
    paperDemoAvailable: true,
    paperDemoActive: false,
    liveCredentialsConfigured: false,
    liveTradingEnabled: false,
    marketFeedEndpoint: 'https://api-testnet.bybit.com',
    supportedMarkets: ['SPOT', 'FUTURES'],
    riskSettings: {
      maxRiskPerTradePct: 1.0,
      maxDailyLossPct: 3.0,
      maxLeverage: 3,
      maxOpenPositions: 3,
      requireStopLoss: true,
    },
    notes: 'Paper routing ready; configure BYBIT_API_KEY and BYBIT_API_SECRET for authenticated exchange routing.',
  },
  {
    id: 'OKX',
    name: 'OKX',
    connectionStatus: 'CREDENTIALS_REQUIRED',
    paperDemoAvailable: true,
    paperDemoActive: false,
    liveCredentialsConfigured: false,
    liveTradingEnabled: false,
    marketFeedEndpoint: 'https://www.okx.com (Demo Header)',
    supportedMarkets: ['SPOT', 'FUTURES'],
    riskSettings: {
      maxRiskPerTradePct: 0.75,
      maxDailyLossPct: 2.5,
      maxLeverage: 3,
      maxOpenPositions: 2,
      requireStopLoss: true,
    },
    notes: 'Demo mode header supported; add OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE to connect.',
  },
  {
    id: 'KRAKEN',
    name: 'Kraken',
    connectionStatus: 'CREDENTIALS_REQUIRED',
    paperDemoAvailable: true,
    paperDemoActive: false,
    liveCredentialsConfigured: false,
    liveTradingEnabled: false,
    marketFeedEndpoint: 'https://demo-futures.kraken.com',
    supportedMarkets: ['SPOT', 'FUTURES'],
    riskSettings: {
      maxRiskPerTradePct: 0.75,
      maxDailyLossPct: 2.5,
      maxLeverage: 2,
      maxOpenPositions: 2,
      requireStopLoss: true,
    },
    notes: 'Spot and Demo Futures supported; add KRAKEN_API_KEY and KRAKEN_API_SECRET for authenticated access.',
  },
];

export function sanitizeExchangeRiskSettings(
  current: ExchangeRiskSettings,
  patch: Partial<ExchangeRiskSettings>
): ExchangeRiskSettings {
  const clamp = (val: unknown, fallback: number, min: number, max: number) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Number(Math.min(max, Math.max(min, n)).toFixed(2));
  };
  return {
    maxRiskPerTradePct: clamp(patch.maxRiskPerTradePct, current.maxRiskPerTradePct, 0.1, 5.0),
    maxDailyLossPct: clamp(patch.maxDailyLossPct, current.maxDailyLossPct, 0.5, 15.0),
    maxLeverage: Math.round(clamp(patch.maxLeverage, current.maxLeverage, 1, 20)),
    maxOpenPositions: Math.round(clamp(patch.maxOpenPositions, current.maxOpenPositions, 1, 12)),
    requireStopLoss:
      typeof patch.requireStopLoss === 'boolean' ? patch.requireStopLoss : current.requireStopLoss,
  };
}

export interface LiveReadinessEvaluation {
  readonly ready: boolean;
  readonly blockers: readonly string[];
}

export function evaluateExchangeLiveReadiness(params: {
  isAuthenticated: boolean;
  otpProviderReady: boolean;
  anyLiveCredentialsConfigured: boolean;
  riskCapsValid: boolean;
}): LiveReadinessEvaluation {
  const blockers: string[] = [];
  if (!params.isAuthenticated) {
    blockers.push('Operator authentication required before Live mode transition.');
  }
  if (!params.otpProviderReady) {
    blockers.push('Email OTP delivery provider requires verified RESEND_API_KEY configuration.');
  }
  if (!params.anyLiveCredentialsConfigured) {
    blockers.push('No exchange live API keys configured (Binance/Bybit/OKX/Kraken live keys missing).');
  }
  if (!params.riskCapsValid) {
    blockers.push('Per-exchange stop-loss and daily loss limits must be enabled.');
  }
  return {
    ready: blockers.length === 0,
    blockers,
  };
}

export function getSubsystemContract(id: PlatformSubsystemId): PlatformSubsystemContract | undefined {
  return PLATFORM_SUBSYSTEM_REGISTRY.find((s) => s.id === id);
}

export function validateSubsystemDependencyGraph(
  registry: readonly PlatformSubsystemContract[] = PLATFORM_SUBSYSTEM_REGISTRY
): { valid: boolean; missingDependencies: string[] } {
  const knownIds = new Set(registry.map((s) => s.id));
  const missingDependencies: string[] = [];
  for (const sys of registry) {
    for (const dep of sys.dependsOn) {
      if (!knownIds.has(dep)) {
        missingDependencies.push(`${sys.id} -> ${dep}`);
      }
    }
  }
  return {
    valid: missingDependencies.length === 0,
    missingDependencies,
  };
}

/**
 * Resolves a configured Telegram handle (e.g. "@SignalForge", "SignalForge", or full https://t.me/...)
 * into a safe direct HTTPS Telegram Channel URL.
 */
export function resolveTelegramChannelUrl(handleOrUrl?: string | null): string {
  const raw = (handleOrUrl || '').trim();
  if (!raw) return 'https://t.me/SignalForge';
  if (/^https?:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_/+%-]+$/i.test(raw)) {
    return raw.replace(/^http:\/\//i, 'https://');
  }
  const cleaned = raw.replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '');
  return cleaned ? `https://t.me/${cleaned}` : 'https://t.me/SignalForge';
}
