import { enforceMaxStopLossCap } from './coordinator';
import type { ExchangeVenue, MultiExchangeDepthAnalysis } from './orderBookDepth';

export interface ArbitrageOpportunity {
  id: string;
  symbol: string;
  buyExchange: ExchangeVenue;
  sellExchange: ExchangeVenue;
  buyAskPrice: number;
  sellBidPrice: number;
  grossSpreadBps: number;
  estimatedFeeBps: number;
  netSpreadBps: number;
  executable: boolean;
  suggestedNotionalUsd: number;
  projectedNetProfitUsd: number;
  detectedAt: string;
}

export interface ArbitrageExecutionRecord {
  id: string;
  symbol: string;
  buyExchange: ExchangeVenue;
  sellExchange: ExchangeVenue;
  buyAskPrice: number;
  sellBidPrice: number;
  notionalUsd: number;
  netSpreadBps: number;
  realizedProfitUsd: number;
  timestamp: string;
}

export interface InstitutionalCopyAccount {
  id: string;
  handle: string;
  institutionName: string;
  strategyFocus: string;
  tier: 'INSTITUTIONAL_PRIME' | 'QUANT_FUND';
  verifiedAuditHash: string;
  aumUsd: number;
  sharpeRatio: number;
  winRatePct: number;
  maxDrawdownPct: number;
  autoMirrorEnabled: boolean;
  allocationUsd: number;
  lastMirroredSymbol?: string;
  lastMirroredAt?: string;
}

export interface MirroredCopyTradePlan {
  id: string;
  accountId: string;
  accountHandle: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  marketType: 'SPOT' | 'USD_M_FUTURES';
  entryPrice: number;
  stopLoss: number;
  maxRiskPct: number; // Strictly <= 2.0%
  takeProfits: [number, number, number];
  riskRewardRatio: number; // Strictly >= 5.0
  notionalUsd: number;
  leverage: number;
  createdAt: string;
}

export const INITIAL_INSTITUTIONAL_ACCOUNTS: InstitutionalCopyAccount[] = [
  {
    id: 'inst_kronos_macro',
    handle: '@KronosPrimeDesk',
    institutionName: 'Kronos Institutional Liquidity Fund',
    strategyFocus: 'Delta-Neutral Perps + Spot Orderbook Breakouts',
    tier: 'INSTITUTIONAL_PRIME',
    verifiedAuditHash: '0x94a8e...7f3c',
    aumUsd: 142_500_000,
    sharpeRatio: 3.18,
    winRatePct: 68.4,
    maxDrawdownPct: 4.1,
    autoMirrorEnabled: true,
    allocationUsd: 1800,
  },
  {
    id: 'inst_aegis_quant',
    handle: '@AegisSystematic',
    institutionName: 'Aegis Sovereign Digital Quant',
    strategyFocus: 'SMC Liquidity Sweeps · 1:5 Asymmetric R:R',
    tier: 'QUANT_FUND',
    verifiedAuditHash: '0x31b04...d821',
    aumUsd: 89_000_000,
    sharpeRatio: 2.94,
    winRatePct: 64.9,
    maxDrawdownPct: 4.8,
    autoMirrorEnabled: true,
    allocationUsd: 1500,
  },
  {
    id: 'inst_helix_arb',
    handle: '@HelixCrossVenue',
    institutionName: 'Helix Cross-Venue Desk',
    strategyFocus: 'Spot-Futures Funding & Cross-Exchange Spreads',
    tier: 'INSTITUTIONAL_PRIME',
    verifiedAuditHash: '0x7c12a...9e05',
    aumUsd: 210_000_000,
    sharpeRatio: 3.45,
    winRatePct: 74.2,
    maxDrawdownPct: 2.9,
    autoMirrorEnabled: false,
    allocationUsd: 2000,
  },
];

/**
 * Scans live Multi-Exchange L2 Order Books (Binance, Bybit, OKX) to identify
 * cross-exchange ask->bid spread discrepancies net of exchange fees.
 */
export function scanCrossExchangeArbitrage(
  depthMap: Record<string, MultiExchangeDepthAnalysis>,
  options?: { minNetSpreadBps?: number; defaultNotionalUsd?: number; estimatedFeeBps?: number }
): ArbitrageOpportunity[] {
  const minNetBps = options?.minNetSpreadBps ?? 3.5;
  const notionalUsd = options?.defaultNotionalUsd ?? 2500;
  const feeBps = options?.estimatedFeeBps ?? 6.0; // 3bps per leg
  const nowIso = new Date().toISOString();
  const opportunities: ArbitrageOpportunity[] = [];

  for (const depth of Object.values(depthMap)) {
    const books = depth.exchanges.filter((b) => b.bestBid > 0 && b.bestAsk > 0);
    if (books.length < 2) continue;

    let bestBuy = books[0];
    let bestSell = books[0];
    for (const b of books) {
      if (b.bestAsk < bestBuy.bestAsk) bestBuy = b;
      if (b.bestBid > bestSell.bestBid) bestSell = b;
    }

    if (bestBuy.exchange === bestSell.exchange) continue;
    const grossSpreadBps =
      ((bestSell.bestBid - bestBuy.bestAsk) / Math.max(bestBuy.bestAsk, 1e-8)) * 10_000;
    const netSpreadBps = Number((grossSpreadBps - feeBps).toFixed(2));
    const executable = netSpreadBps >= minNetBps;
    const projectedNetProfitUsd = Number(
      Math.max(0, (notionalUsd * netSpreadBps) / 10_000).toFixed(2)
    );

    opportunities.push({
      id: `arb_${depth.symbol}_${bestBuy.exchange}_${bestSell.exchange}`,
      symbol: depth.symbol,
      buyExchange: bestBuy.exchange,
      sellExchange: bestSell.exchange,
      buyAskPrice: bestBuy.bestAsk,
      sellBidPrice: bestSell.bestBid,
      grossSpreadBps: Number(grossSpreadBps.toFixed(2)),
      estimatedFeeBps: feeBps,
      netSpreadBps,
      executable,
      suggestedNotionalUsd: notionalUsd,
      projectedNetProfitUsd,
      detectedAt: nowIso,
    });
  }

  return opportunities.sort((a, b) => b.netSpreadBps - a.netSpreadBps);
}

/**
 * Executes an actionable delta-neutral cross-exchange arbitrage capture, updating wallet balance.
 */
export function executeArbitrageCapture(
  opp: ArbitrageOpportunity,
  walletBalanceUsd: number
): {
  ok: boolean;
  updatedWalletBalanceUsd: number;
  record?: ArbitrageExecutionRecord;
  error?: string;
} {
  if (!opp.executable || opp.netSpreadBps <= 0) {
    return {
      ok: false,
      updatedWalletBalanceUsd: walletBalanceUsd,
      error: `Spread ${opp.netSpreadBps} bps on ${opp.symbol} does not clear taker fees cleanly.`,
    };
  }
  const realizedProfitUsd = Number(((opp.suggestedNotionalUsd * opp.netSpreadBps) / 10_000).toFixed(2));
  const updatedWalletBalanceUsd = Number((walletBalanceUsd + realizedProfitUsd).toFixed(2));

  return {
    ok: true,
    updatedWalletBalanceUsd,
    record: {
      id: `arb_exec_${opp.symbol}_${Date.now()}`,
      symbol: opp.symbol,
      buyExchange: opp.buyExchange,
      sellExchange: opp.sellExchange,
      buyAskPrice: opp.buyAskPrice,
      sellBidPrice: opp.sellBidPrice,
      notionalUsd: opp.suggestedNotionalUsd,
      netSpreadBps: opp.netSpreadBps,
      realizedProfitUsd,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Constructs a risk-governed Social Copy Trading plan from a verified institutional desk,
 * strictly enforcing the 2.0% hard maximum risk limit per trade and minimum 1:5 P/L ratio.
 */
export function buildMirroredCopyTradePlan(params: {
  account: InstitutionalCopyAccount;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  atr14: number;
  futuresEnabled?: boolean;
}): MirroredCopyTradePlan {
  const safeEntry = Math.max(params.entryPrice, 1e-8);
  const safeAtr = Math.max(params.atr14, safeEntry * 0.005);
  const rawSl =
    params.direction === 'BUY' ? safeEntry - safeAtr * 1.4 : safeEntry + safeAtr * 1.4;
  // Strictly enforce hard 2.0% max risk per trade
  const stopLoss = enforceMaxStopLossCap(safeEntry, params.direction, rawSl, 2.0);
  const riskDist = Math.max(Math.abs(safeEntry - stopLoss), safeEntry * 0.002);
  const maxRiskPct = Number(((Math.abs(safeEntry - stopLoss) / safeEntry) * 100).toFixed(2));

  // Strictly uphold >= 1:5 profit-to-loss ratio for TP3 & symmetric trailing envelope
  const rr3 = 5.2;
  const tp1 =
    params.direction === 'BUY'
      ? Number((safeEntry + riskDist * 2.0).toPrecision(6))
      : Number(Math.max(safeEntry * 0.1, safeEntry - riskDist * 2.0).toPrecision(6));
  const tp2 =
    params.direction === 'BUY'
      ? Number((safeEntry + riskDist * 3.5).toPrecision(6))
      : Number(Math.max(safeEntry * 0.08, safeEntry - riskDist * 3.5).toPrecision(6));
  const tp3 =
    params.direction === 'BUY'
      ? Number((safeEntry + riskDist * rr3).toPrecision(6))
      : Number(Math.max(safeEntry * 0.05, safeEntry - riskDist * rr3).toPrecision(6));

  return {
    id: `copy_${params.account.id}_${params.symbol}_${Date.now()}`,
    accountId: params.account.id,
    accountHandle: params.account.handle,
    symbol: params.symbol.toUpperCase(),
    direction: params.direction,
    marketType: params.futuresEnabled ? 'USD_M_FUTURES' : 'SPOT',
    entryPrice: Number(safeEntry.toPrecision(6)),
    stopLoss,
    maxRiskPct,
    takeProfits: [tp1, tp2, tp3],
    riskRewardRatio: rr3,
    notionalUsd: params.account.allocationUsd,
    leverage: params.futuresEnabled ? 3 : 1,
    createdAt: new Date().toISOString(),
  };
}
