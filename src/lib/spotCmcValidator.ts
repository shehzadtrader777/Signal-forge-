export interface CmcBaselineValuation {
  symbol: string;
  coinName: string;
  cmcRank: number;
  cmcPriceUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  dominancePct: number;
  percentChange24h: number;
  circulatingSupply: number;
  updatedAt: string;
  source: 'cmc_api' | 'spot_indexed_baseline' | 'unavailable';
}

export interface SpotTickAnomalyCheck {
  valid: boolean;
  isolated: boolean;
  jumpPct: number;
  anchorDriftPct?: number;
  reason: string;
}

export interface SpotCmcValidationResult {
  valid: boolean;
  spotPrice: number;
  cmcPriceUsd: number;
  divergencePct: number;
  anomalyIsolated: boolean;
  baselineVerified?: boolean;
  reason: string;
}

/**
 * Validates incoming Binance Spot tick data against corrupted payloads, single-tick spikes,
 * and slow-drip cumulative anchor drift.
 */
export function validateSpotTickSample(params: {
  price: number;
  previousPrice?: number;
  maxJumpPct?: number;
  anchorPrice?: number;
  maxAnchorDriftPct?: number;
}): SpotTickAnomalyCheck {
  const {
    price,
    previousPrice,
    maxJumpPct = 12,
    anchorPrice,
    maxAnchorDriftPct = 22,
  } = params;

  if (!Number.isFinite(price) || price <= 0) {
    return {
      valid: false,
      isolated: true,
      jumpPct: 100,
      reason: 'Isolated corrupted Spot tick (non-finite or non-positive price).',
    };
  }

  let anchorDriftPct = 0;
  if (anchorPrice !== undefined && Number.isFinite(anchorPrice) && anchorPrice > 0) {
    anchorDriftPct = Number(((Math.abs(price - anchorPrice) / anchorPrice) * 100).toFixed(4));
    if (anchorDriftPct > maxAnchorDriftPct) {
      return {
        valid: false,
        isolated: true,
        jumpPct: anchorDriftPct,
        anchorDriftPct,
        reason: `Isolated cumulative Spot drift anomaly (${anchorDriftPct}% from anchor exceeds ${maxAnchorDriftPct}% ceiling).`,
      };
    }
  }

  if (previousPrice !== undefined && Number.isFinite(previousPrice) && previousPrice > 0) {
    const jumpPct = Number(((Math.abs(price - previousPrice) / previousPrice) * 100).toFixed(4));
    if (jumpPct > maxJumpPct) {
      return {
        valid: false,
        isolated: true,
        jumpPct,
        anchorDriftPct,
        reason: `Isolated Spot price anomaly (${jumpPct}% single-tick jump exceeds ${maxJumpPct}% safeguard).`,
      };
    }
    return {
      valid: true,
      isolated: false,
      jumpPct,
      anchorDriftPct,
      reason: 'Spot tick validated within continuous range.',
    };
  }

  return {
    valid: true,
    isolated: false,
    jumpPct: 0,
    anchorDriftPct,
    reason: 'Initial Spot tick accepted.',
  };
}

/**
 * Cross-validates live Binance Spot price against CoinMarketCap baseline valuation
 * so anomalies from either endpoint are isolated without breaking execution.
 */
export function validateSpotFeedAgainstCmc(params: {
  symbol: string;
  spotPrice: number;
  cmcBaseline?: CmcBaselineValuation | null;
  maxDivergencePct?: number;
}): SpotCmcValidationResult {
  const { symbol, spotPrice, cmcBaseline, maxDivergencePct = 8.0 } = params;

  if (!Number.isFinite(spotPrice) || spotPrice <= 0) {
    return {
      valid: false,
      spotPrice: 0,
      cmcPriceUsd: cmcBaseline?.cmcPriceUsd ?? 0,
      divergencePct: 100,
      anomalyIsolated: true,
      baselineVerified: false,
      reason: `${symbol}: Invalid Binance Spot quote isolated.`,
    };
  }

  if (
    !cmcBaseline ||
    cmcBaseline.source !== 'cmc_api' ||
    !Number.isFinite(cmcBaseline.cmcPriceUsd) ||
    cmcBaseline.cmcPriceUsd <= 0
  ) {
    return {
      valid: true,
      spotPrice,
      cmcPriceUsd: 0,
      divergencePct: 0,
      anomalyIsolated: false,
      baselineVerified: false,
      reason: `${symbol}: Binance Spot accepted (independent CMC API baseline unavailable).`,
    };
  }

  const divergencePct = Number(
    (
      (Math.abs(spotPrice - cmcBaseline.cmcPriceUsd) / cmcBaseline.cmcPriceUsd) *
      100
    ).toFixed(3)
  );

  if (divergencePct > maxDivergencePct) {
    return {
      valid: false,
      spotPrice,
      cmcPriceUsd: cmcBaseline.cmcPriceUsd,
      divergencePct,
      anomalyIsolated: true,
      baselineVerified: false,
      reason: `${symbol}: Spot ($${spotPrice}) vs CMC ($${cmcBaseline.cmcPriceUsd}) divergence ${divergencePct}% > ${maxDivergencePct}% — anomaly isolated to primary Spot quote.`,
    };
  }

  return {
    valid: true,
    spotPrice,
    cmcPriceUsd: cmcBaseline.cmcPriceUsd,
    divergencePct,
    anomalyIsolated: false,
    baselineVerified: true,
    reason: `${symbol}: Spot & CMC API baseline synchronized (${divergencePct}% spread).`,
  };
}
