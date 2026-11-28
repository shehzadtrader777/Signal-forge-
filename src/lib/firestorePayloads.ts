import { DEFAULT_CONTROL_MATRIX, type GranularControlMatrix, type MicroserviceId } from './controlMatrix';

export const FIRESTORE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const FIRESTORE_SYMBOL_REGEX = /^[A-Z0-9]+$/;
export const FIRESTORE_DATE_KEY_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const VALID_SERVICE_IDS: ReadonlySet<MicroserviceId> = new Set<MicroserviceId>([
  'market-data-svc',
  'ai-agents-svc',
  'execution-router-svc',
  'risk-kernel-svc',
  'telemetry-bus-svc',
]);

export function sanitizeFirestoreId(raw: string, maxLength = 64, fallback = 'item'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLength);
  if (cleaned.length >= 1 && FIRESTORE_ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return fallback.slice(0, maxLength);
}

export function sanitizeFirestoreSymbol(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (cleaned.length >= 4 && FIRESTORE_SYMBOL_REGEX.test(cleaned)) {
    return cleaned;
  }
  return 'BTCUSDT';
}

export function normalizeToggleMapForFirestore(
  toggles: Partial<Record<string, boolean>>
): GranularControlMatrix {
  return {
    spotWsStream: Boolean(toggles.spotWsStream ?? DEFAULT_CONTROL_MATRIX.spotWsStream),
    l2OrderBookDepth: Boolean(toggles.l2OrderBookDepth ?? DEFAULT_CONTROL_MATRIX.l2OrderBookDepth),
    topGainersScanner: Boolean(
      toggles.topGainersScanner ?? DEFAULT_CONTROL_MATRIX.topGainersScanner
    ),
    cmcBaselineValidator: Boolean(
      toggles.cmcBaselineValidator ?? DEFAULT_CONTROL_MATRIX.cmcBaselineValidator
    ),
    futuresFeedModule: Boolean(
      toggles.futuresFeedModule ?? DEFAULT_CONTROL_MATRIX.futuresFeedModule
    ),
    signalEngine: Boolean(toggles.signalEngine ?? DEFAULT_CONTROL_MATRIX.signalEngine),
    smcVolumeAgent: Boolean(toggles.smcVolumeAgent ?? DEFAULT_CONTROL_MATRIX.smcVolumeAgent),
    patternScannerAgent: Boolean(
      toggles.patternScannerAgent ?? DEFAULT_CONTROL_MATRIX.patternScannerAgent
    ),
    sentinelAgent: Boolean(toggles.sentinelAgent ?? DEFAULT_CONTROL_MATRIX.sentinelAgent),
    autonomousCoordinator: Boolean(
      toggles.autonomousCoordinator ?? DEFAULT_CONTROL_MATRIX.autonomousCoordinator
    ),
    rlAutoTuner: Boolean(toggles.rlAutoTuner ?? DEFAULT_CONTROL_MATRIX.rlAutoTuner),
    voiceCommandAgent: Boolean(
      toggles.voiceCommandAgent ?? DEFAULT_CONTROL_MATRIX.voiceCommandAgent
    ),
    spotExecutionRouter: Boolean(
      toggles.spotExecutionRouter ?? DEFAULT_CONTROL_MATRIX.spotExecutionRouter
    ),
    futuresExecutionRouter: Boolean(
      toggles.futuresExecutionRouter ?? DEFAULT_CONTROL_MATRIX.futuresExecutionRouter
    ),
    testnetSandboxRouter: Boolean(
      toggles.testnetSandboxRouter ?? DEFAULT_CONTROL_MATRIX.testnetSandboxRouter
    ),
    liveExecutionRouter: Boolean(
      toggles.liveExecutionRouter ?? DEFAULT_CONTROL_MATRIX.liveExecutionRouter
    ),
    crossExchangeArbitrage: Boolean(
      toggles.crossExchangeArbitrage ?? DEFAULT_CONTROL_MATRIX.crossExchangeArbitrage
    ),
    institutionalCopyDesk: Boolean(
      toggles.institutionalCopyDesk ?? DEFAULT_CONTROL_MATRIX.institutionalCopyDesk
    ),
    portfolioAutoRebalancer: Boolean(
      toggles.portfolioAutoRebalancer ?? DEFAULT_CONTROL_MATRIX.portfolioAutoRebalancer
    ),
    telemetrySseStream: Boolean(
      toggles.telemetrySseStream ?? DEFAULT_CONTROL_MATRIX.telemetrySseStream
    ),
    diagnosticErrorCapture: Boolean(
      toggles.diagnosticErrorCapture ?? DEFAULT_CONTROL_MATRIX.diagnosticErrorCapture
    ),
    haAutoFailover: Boolean(toggles.haAutoFailover ?? DEFAULT_CONTROL_MATRIX.haAutoFailover),
    automatedRollbackProtocol: Boolean(
      toggles.automatedRollbackProtocol ?? DEFAULT_CONTROL_MATRIX.automatedRollbackProtocol
    ),
    emailDigestDispatcher: Boolean(
      toggles.emailDigestDispatcher ?? DEFAULT_CONTROL_MATRIX.emailDigestDispatcher
    ),
  };
}

export function sanitizeUserProfileFields(input: {
  uid: string;
  email: string | null | undefined;
  displayName: string | null | undefined;
}): { uid: string; email: string; displayName: string } {
  const uid = sanitizeFirestoreId(input.uid, 128, 'user');
  const rawEmail = (input.email ?? '').trim().slice(0, 254);
  const email = rawEmail.length >= 3 ? rawEmail : `${uid}@users.invalid`.slice(0, 254);
  const fallbackName = email.split('@')[0] || 'Trader';
  const rawDisplay = (input.displayName ?? fallbackName).trim().slice(0, 80);
  const displayName = rawDisplay.length >= 1 ? rawDisplay : 'Trader';
  return { uid, email, displayName };
}

export function sanitizeWatchlistFields(input: {
  userId: string;
  symbol: string;
  coinName: string;
  notes?: string;
}): { id: string; userId: string; symbol: string; coinName: string; notes?: string } {
  const symbol = sanitizeFirestoreSymbol(input.symbol);
  const id = sanitizeFirestoreId(symbol, 32, 'BTCUSDT');
  const userId = sanitizeFirestoreId(input.userId, 128, 'user');
  const coinName = (input.coinName || symbol).trim().slice(0, 50) || symbol;
  const result: { id: string; userId: string; symbol: string; coinName: string; notes?: string } = {
    id,
    userId,
    symbol,
    coinName,
  };
  if (typeof input.notes === 'string') {
    result.notes = input.notes.slice(0, 240);
  }
  return result;
}

export function sanitizePriceAlertFields(input: {
  alertId: string;
  userId: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW';
  targetPrice: number;
  emailNotify: boolean;
}): {
  id: string;
  userId: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW';
  targetPrice: number;
  active: boolean;
  triggered: boolean;
  emailNotify: boolean;
} {
  const symbol = sanitizeFirestoreSymbol(input.symbol);
  const id = sanitizeFirestoreId(input.alertId, 64, `al_${symbol}`);
  const userId = sanitizeFirestoreId(input.userId, 128, 'user');
  const numericPrice = Number(input.targetPrice);
  const targetPrice = Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : 1;
  return {
    id,
    userId,
    symbol,
    condition: input.condition === 'BELOW' ? 'BELOW' : 'ABOVE',
    targetPrice,
    active: true,
    triggered: false,
    emailNotify: Boolean(input.emailNotify),
  };
}

export function sanitizeChecksum(raw: string): string {
  const trimmed = raw.trim().slice(0, 40);
  return trimmed.length >= 4 ? trimmed : trimmed.padEnd(4, '0');
}

export function sanitizeRecordHash(raw: string): string {
  const trimmed = raw.trim().slice(0, 32);
  return trimmed.length >= 8 ? trimmed : trimmed.padEnd(8, '0');
}

export function sanitizeServiceId(raw: string): MicroserviceId {
  if (VALID_SERVICE_IDS.has(raw as MicroserviceId)) {
    return raw as MicroserviceId;
  }
  return 'telemetry-bus-svc';
}

export function sanitizeErrorAuditFields(input: {
  id: string;
  userId: string;
  correlationId: string;
  serviceId: string;
  severity: 'WARN' | 'ERROR' | 'CRITICAL';
  code: string;
  message: string;
  recoveryAction: string;
}): {
  id: string;
  userId: string;
  correlationId: string;
  serviceId: MicroserviceId;
  severity: 'WARN' | 'ERROR' | 'CRITICAL';
  code: string;
  message: string;
  recoveryAction: string;
} {
  const id = sanitizeFirestoreId(input.id, 64, 'err_record');
  const userId = sanitizeFirestoreId(input.userId, 128, 'user');
  const severity: 'WARN' | 'ERROR' | 'CRITICAL' =
    input.severity === 'CRITICAL' || input.severity === 'WARN' ? input.severity : 'ERROR';
  return {
    id,
    userId,
    correlationId: input.correlationId.trim().slice(0, 80) || 'corr_default',
    serviceId: sanitizeServiceId(input.serviceId),
    severity,
    code: input.code.trim().slice(0, 64) || 'ERR_UNKNOWN',
    message: input.message.trim().slice(0, 320) || 'Error recorded',
    recoveryAction: input.recoveryAction.trim().slice(0, 240) || 'Contained',
  };
}

export function sanitizeDailyPnlFields(input: {
  dateKey: string;
  userId: string;
  startingEquityUsd: number;
  endingEquityUsd: number;
  realizedPnlUsd: number;
  returnPct: number;
  scoopedToVaultUsd: number;
  manualReleasedUsd: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  recordHash: string;
}): {
  dateKey: string;
  userId: string;
  startingEquityUsd: number;
  endingEquityUsd: number;
  realizedPnlUsd: number;
  returnPct: number;
  scoopedToVaultUsd: number;
  manualReleasedUsd: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  recordHash: string;
} | null {
  if (!FIRESTORE_DATE_KEY_REGEX.test(input.dateKey)) {
    return null;
  }
  const safeNum = (v: number): number => (Number.isFinite(v) ? v : 0);
  return {
    dateKey: input.dateKey,
    userId: sanitizeFirestoreId(input.userId, 128, 'user'),
    startingEquityUsd: Math.max(0, safeNum(Number(input.startingEquityUsd))),
    endingEquityUsd: Math.max(0, safeNum(Number(input.endingEquityUsd))),
    realizedPnlUsd: safeNum(Number(input.realizedPnlUsd)),
    returnPct: safeNum(Number(input.returnPct)),
    scoopedToVaultUsd: Math.max(0, safeNum(Number(input.scoopedToVaultUsd))),
    manualReleasedUsd: Math.max(0, safeNum(Number(input.manualReleasedUsd))),
    tradeCount: Math.max(0, safeNum(Number(input.tradeCount))),
    winningTrades: Math.max(0, safeNum(Number(input.winningTrades))),
    losingTrades: Math.max(0, safeNum(Number(input.losingTrades))),
    winRatePct: Math.min(100, Math.max(0, safeNum(Number(input.winRatePct)))),
    recordHash: sanitizeRecordHash(String(input.recordHash || '')),
  };
}

export function sanitizeVaultLockerFields(input: {
  vaultId: string;
  userId: string;
  thresholdMode: 'USD_FIXED' | 'PERCENT_OF_EQUITY';
  profitThresholdUsd: number;
  profitThresholdPct: number;
  scoopExcessRatioPct: number;
  enabled: boolean;
  lockedVaultBalanceUsd: number;
  totalScoopedLifetimeUsd: number;
  stateVersion: number;
}): {
  id: string;
  userId: string;
  thresholdMode: 'USD_FIXED' | 'PERCENT_OF_EQUITY';
  profitThresholdUsd: number;
  profitThresholdPct: number;
  scoopExcessRatioPct: number;
  enabled: boolean;
  lockedVaultBalanceUsd: number;
  totalScoopedLifetimeUsd: number;
  stateVersion: number;
} {
  const safeNum = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);
  return {
    id: sanitizeFirestoreId(input.vaultId, 64, 'primaryVault'),
    userId: sanitizeFirestoreId(input.userId, 128, 'user'),
    thresholdMode:
      input.thresholdMode === 'PERCENT_OF_EQUITY' ? 'PERCENT_OF_EQUITY' : 'USD_FIXED',
    profitThresholdUsd: Math.min(
      100000,
      Math.max(10, safeNum(Number(input.profitThresholdUsd), 250))
    ),
    profitThresholdPct: Math.min(
      50,
      Math.max(0.25, safeNum(Number(input.profitThresholdPct), 1.5))
    ),
    scoopExcessRatioPct: Math.min(
      100,
      Math.max(25, safeNum(Number(input.scoopExcessRatioPct), 100))
    ),
    enabled: Boolean(input.enabled),
    lockedVaultBalanceUsd: Math.max(0, safeNum(Number(input.lockedVaultBalanceUsd), 0)),
    totalScoopedLifetimeUsd: Math.max(0, safeNum(Number(input.totalScoopedLifetimeUsd), 0)),
    stateVersion: Math.max(1, Math.floor(safeNum(Number(input.stateVersion), 1))),
  };
}
