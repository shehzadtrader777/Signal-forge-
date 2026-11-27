import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCREENSHOT_PRIVACY_POLICY,
  detectMissingScreenshotContext,
  evaluateScreenshotCostBudget,
  SCREENSHOT_ANALYZER_FEATURE_FLAGS,
  validateScreenshotAnalyzerRequest,
} from './screenshotAnalyzerArchitecture.ts';

test('Screenshot Analyzer architecture stays strictly disabled with zero billing & zero live execution in Step 1', () => {
  assert.equal(SCREENSHOT_ANALYZER_FEATURE_FLAGS.FEATURE_ENABLED, false);
  assert.equal(SCREENSHOT_ANALYZER_FEATURE_FLAGS.BILLING_ENABLED, false);
  assert.equal(SCREENSHOT_ANALYZER_FEATURE_FLAGS.LIVE_EXECUTION_FROM_SCREENSHOT_ALLOWED, false);
  assert.equal(DEFAULT_SCREENSHOT_PRIVACY_POLICY.ephemeralInMemoryOnly, true);
  assert.equal(DEFAULT_SCREENSHOT_PRIVACY_POLICY.retentionHours, 0);
  assert.equal(DEFAULT_SCREENSHOT_PRIVACY_POLICY.allowModelTraining, false);
});

test('Screenshot Analyzer rejects invalid MIME types, detects missing symbol/timeframe/price scale, and stays blocked by feature flag', () => {
  const result = validateScreenshotAnalyzerRequest(
    {
      fileName: 'chart.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: 12_000,
    },
    'PRO_PREVIEW'
  );

  assert.equal(result.accepted, false);
  assert.equal(result.blockedByFeatureFlag, true);
  assert.equal(result.provenanceLabel, 'VISUAL_ESTIMATE_UNVERIFIED');
  assert.equal(result.missingContextPrompts.length, 3);
  assert.ok(result.errors.some((e) => e.includes('Unsupported file format')));
  assert.ok(result.errors.some((e) => e.includes('currently disabled')));

  const completePrompts = detectMissingScreenshotContext({
    detectedSymbol: 'BTCUSDT',
    detectedTimeframe: '1h',
    detectedVisiblePriceMin: 89000,
    detectedVisiblePriceMax: 94500,
  });
  assert.equal(completePrompts.length, 0);

  const budget = evaluateScreenshotCostBudget('PRO_PREVIEW', 10, 0.04);
  assert.equal(budget.withinBudget, true);
  assert.equal(budget.estimatedCostUsd, 0.4);
});
