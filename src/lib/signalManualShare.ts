import type { MasterCoordinatorSetup } from './masterCoordinator';

/**
 * Manual text export only. An ephemeral coordinator setup ID is NOT proof of
 * a published signal and must not be presented as a verified trade ID.
 */
export function formatMasterSetupForManualCopy(
  setup: Pick<MasterCoordinatorSetup,
    'id' | 'symbol' | 'direction' | 'sourceModule' | 'entryPrice' |
    'trailingStopLoss' | 'takeProfits' | 'confidence' | 'maxRiskReward'>
): string {
  const price = (n: number) => Number.isFinite(n) && n > 0 ? n.toPrecision(8).replace(/0+$/, '').replace(/\.$/, '') : 'N/A';
  return [
    'SIGNAL FORGE · RESEARCH SETUP (UNVERIFIED DRAFT)',
    `Pair: ${setup.symbol} | Side: ${setup.direction}`,
    `Module: ${setup.sourceModule}`,
    `Entry: ${price(setup.entryPrice)}`,
    `Stop loss: ${price(setup.trailingStopLoss)}`,
    `Targets: ${setup.takeProfits.map(price).join(' / ')}`,
    `Model confidence (not win probability): ${setup.confidence}%`,
    `Proposed max R:R: 1:${setup.maxRiskReward.toFixed(2)}`,
    'Verification: NOT PUBLISHED / NO VERIFIED TRADE ID',
    'Research only. Not a live trade, performance guarantee, or financial advice.',
  ].join('\n');
}
