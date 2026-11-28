/**
 * Signal Forge — Future Premium AI Chart Screenshot Analyzer (Modular Architecture Only)
 *
 * STRICT STEP 1 INVARIANTS:
 *  - Feature is strictly DISABLED (architecture prepared only).
 *  - Zero payment processing, zero active billing, zero live trade execution from screenshots.
 *  - Clearly separates visual screenshot estimates from verified market OHLCV data.
 *  - Prompts for missing symbol, timeframe, or price scale instead of fabricating levels.
 */

export const SCREENSHOT_ANALYZER_FEATURE_FLAGS = Object.freeze({
  FEATURE_ENABLED: false,
  BILLING_ENABLED: false,
  LIVE_EXECUTION_FROM_SCREENSHOT_ALLOWED: false,
  STAGE: 'ARCHITECTURE_RESERVED_STEP_1' as const,
});

export type ScreenshotAnalysisProvenance = 'VISUAL_ESTIMATE_UNVERIFIED';

export type FutureSubscriptionTier = 'FREE' | 'PRO_PREVIEW' | 'INSTITUTIONAL_PREVIEW';

export interface ScreenshotPrivacyPolicy {
  ephemeralInMemoryOnly: true;
  retentionHours: 0;
  allowModelTraining: false;
  autoScrubExifMetadata: true;
  redactAccountBalancesAndOrderIds: true;
  auditLogRetentionDays: 30;
}

export interface ScreenshotTierQuota {
  tier: FutureSubscriptionTier;
  monthlyUploadLimit: number;
  maxFileSizeBytes: number;
  estimatedCostBudgetUsd: number;
  enabledInStep1: false;
}

export interface ScreenshotUploadMetadata {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  detectedSymbol?: string | null;
  detectedTimeframe?: string | null;
  detectedVisiblePriceMin?: number | null;
  detectedVisiblePriceMax?: number | null;
}

export interface ScreenshotUploadValidationResult {
  accepted: boolean;
  blockedByFeatureFlag: boolean;
  errors: string[];
  missingContextPrompts: string[];
  provenanceLabel: ScreenshotAnalysisProvenance;
}

export interface ScreenshotCostMonitorSample {
  tier: FutureSubscriptionTier;
  uploadsThisCycle: number;
  estimatedVisionTokens: number;
  estimatedCostUsd: number;
  withinBudget: boolean;
}

export const ALLOWED_SCREENSHOT_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

export const MAX_SCREENSHOT_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

export const DEFAULT_SCREENSHOT_PRIVACY_POLICY: Readonly<ScreenshotPrivacyPolicy> = Object.freeze({
  ephemeralInMemoryOnly: true,
  retentionHours: 0,
  allowModelTraining: false,
  autoScrubExifMetadata: true,
  redactAccountBalancesAndOrderIds: true,
  auditLogRetentionDays: 30,
});

export const FUTURE_SCREENSHOT_TIER_QUOTAS: Readonly<
  Record<FutureSubscriptionTier, ScreenshotTierQuota>
> = Object.freeze({
  FREE: {
    tier: 'FREE',
    monthlyUploadLimit: 0,
    maxFileSizeBytes: 0,
    estimatedCostBudgetUsd: 0,
    enabledInStep1: false,
  },
  PRO_PREVIEW: {
    tier: 'PRO_PREVIEW',
    monthlyUploadLimit: 25,
    maxFileSizeBytes: MAX_SCREENSHOT_SIZE_BYTES,
    estimatedCostBudgetUsd: 3.5,
    enabledInStep1: false,
  },
  INSTITUTIONAL_PREVIEW: {
    tier: 'INSTITUTIONAL_PREVIEW',
    monthlyUploadLimit: 150,
    maxFileSizeBytes: MAX_SCREENSHOT_SIZE_BYTES,
    estimatedCostBudgetUsd: 18.0,
    enabledInStep1: false,
  },
});

/**
 * Identifies missing chart metadata so the future analyzer prompts the user
 * instead of fabricating prices, symbols, or timeframes.
 */
export function detectMissingScreenshotContext(
  meta: Pick<
    ScreenshotUploadMetadata,
    'detectedSymbol' | 'detectedTimeframe' | 'detectedVisiblePriceMin' | 'detectedVisiblePriceMax'
  >
): string[] {
  const prompts: string[] = [];
  if (!meta.detectedSymbol || meta.detectedSymbol.trim().length < 3) {
    prompts.push('Please specify the trading pair / symbol shown in the chart (e.g., BTCUSDT).');
  }
  if (!meta.detectedTimeframe || meta.detectedTimeframe.trim().length < 2) {
    prompts.push('Please specify the chart timeframe (e.g., 15m, 1h, 4h, 1d).');
  }
  const hasValidPriceRange =
    typeof meta.detectedVisiblePriceMin === 'number' &&
    typeof meta.detectedVisiblePriceMax === 'number' &&
    Number.isFinite(meta.detectedVisiblePriceMin) &&
    Number.isFinite(meta.detectedVisiblePriceMax) &&
    meta.detectedVisiblePriceMax > meta.detectedVisiblePriceMin &&
    meta.detectedVisiblePriceMin > 0;
  if (!hasValidPriceRange) {
    prompts.push(
      'Price scale could not be read reliably — please provide the visible low and high price bounds.'
    );
  }
  return prompts;
}

/**
 * Validates screenshot upload payloads against strict security, privacy, and Step 1 disabled-feature rules.
 */
export function validateScreenshotAnalyzerRequest(
  meta: ScreenshotUploadMetadata,
  tier: FutureSubscriptionTier = 'FREE'
): ScreenshotUploadValidationResult {
  const errors: string[] = [];
  const missingContextPrompts = detectMissingScreenshotContext(meta);

  if (!ALLOWED_SCREENSHOT_MIME_TYPES.includes(meta.mimeType)) {
    errors.push(
      `Unsupported file format "${meta.mimeType}". Only PNG, JPEG, and WebP chart screenshots are permitted.`
    );
  }
  if (!Number.isFinite(meta.sizeBytes) || meta.sizeBytes <= 0) {
    errors.push('Screenshot file is empty or unreadable.');
  } else if (meta.sizeBytes > MAX_SCREENSHOT_SIZE_BYTES) {
    errors.push('Screenshot exceeds maximum 8 MB upload size limit.');
  }

  if (!SCREENSHOT_ANALYZER_FEATURE_FLAGS.FEATURE_ENABLED) {
    errors.push(
      `AI Chart Screenshot Analyzer is currently disabled (${SCREENSHOT_ANALYZER_FEATURE_FLAGS.STAGE}; tier ${tier} not active). No upload was processed or billed.`
    );
  }

  return {
    accepted: false,
    blockedByFeatureFlag: !SCREENSHOT_ANALYZER_FEATURE_FLAGS.FEATURE_ENABLED,
    errors,
    missingContextPrompts,
    provenanceLabel: 'VISUAL_ESTIMATE_UNVERIFIED',
  };
}

export function evaluateScreenshotCostBudget(
  tier: FutureSubscriptionTier,
  uploadsThisCycle: number,
  avgCostPerUploadUsd = 0.04
): ScreenshotCostMonitorSample {
  const quota = FUTURE_SCREENSHOT_TIER_QUOTAS[tier];
  const safeUploads = Math.max(0, Math.floor(uploadsThisCycle));
  const estimatedCostUsd = Number((safeUploads * avgCostPerUploadUsd).toFixed(4));
  const estimatedVisionTokens = safeUploads * 1800;
  return {
    tier,
    uploadsThisCycle: safeUploads,
    estimatedVisionTokens,
    estimatedCostUsd,
    withinBudget:
      safeUploads <= quota.monthlyUploadLimit && estimatedCostUsd <= quota.estimatedCostBudgetUsd,
  };
}
