export type ExchangeVenue = 'BINANCE' | 'BYBIT' | 'OKX';

export interface OrderBookLevel {
  price: number;
  quantity: number;
  notionalUsd: number;
}

export interface ExchangeOrderBookSnapshot {
  exchange: ExchangeVenue;
  symbol: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bidDepth05PctUsd: number;
  askDepth05PctUsd: number;
  bidDepth2PctUsd: number;
  askDepth2PctUsd: number;
  imbalanceRatio: number; // -1 (ask heavy) .. +1 (bid heavy)
  whaleWallSide: 'BID_WALL' | 'ASK_WALL' | 'BALANCED';
  largestWhaleWallUsd: number;
  largestWhaleWallPrice: number;
  source: 'live_ws' | 'exchange_rest' | 'ws_anchored_book';
  updatedAtMs: number;
}

export interface WhaleLiquidityWall {
  exchange: ExchangeVenue;
  side: 'BID' | 'ASK';
  price: number;
  distancePct: number;
  notionalUsd: number;
  classification: 'INSTITUTIONAL_BID_ABSORPTION' | 'WHALE_ASK_RESISTANCE';
}

export type LiquidityShiftState =
  | 'INSTITUTIONAL_ACCUMULATION'
  | 'DISTRIBUTION_WALL'
  | 'LIQUIDITY_VACUUM'
  | 'BALANCED';

export interface MultiExchangeDepthAnalysis {
  symbol: string;
  liveMidPrice: number;
  exchanges: ExchangeOrderBookSnapshot[];
  aggregatedBidUsd: number;
  aggregatedAskUsd: number;
  netOrderBookImbalance: number; // -1 .. +1
  imbalanceBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  liquidityShift: LiquidityShiftState;
  whaleWalls: WhaleLiquidityWall[];
  preActionLeadConfidence: number; // 0..99
  summary: string;
  updatedAtMs: number;
}

function summarizeRawLevels(
  rawLevels: Array<[number, number]>,
  midPrice: number,
  side: 'BID' | 'ASK'
): {
  levels: OrderBookLevel[];
  depth05PctUsd: number;
  depth2PctUsd: number;
  largestUsd: number;
  largestPrice: number;
} {
  const levels: OrderBookLevel[] = [];
  let depth05PctUsd = 0;
  let depth2PctUsd = 0;
  let largestUsd = 0;
  let largestPrice = midPrice;

  for (const [p, q] of rawLevels) {
    if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) continue;
    const notionalUsd = Number((p * q).toFixed(2));
    const distPct = Math.abs(p - midPrice) / Math.max(midPrice, 1e-8);
    if (distPct <= 0.005) depth05PctUsd += notionalUsd;
    if (distPct <= 0.025) depth2PctUsd += notionalUsd;
    if (notionalUsd > largestUsd) {
      largestUsd = notionalUsd;
      largestPrice = p;
    }
    levels.push({
      price: Number(p.toPrecision(6)),
      quantity: Number(q.toPrecision(5)),
      notionalUsd,
    });
  }

  levels.sort((a, b) => (side === 'BID' ? b.price - a.price : a.price - b.price));

  return {
    levels: levels.slice(0, 12),
    depth05PctUsd: Math.round(depth05PctUsd),
    depth2PctUsd: Math.round(depth2PctUsd),
    largestUsd: Math.round(largestUsd),
    largestPrice: Number(largestPrice.toPrecision(6)),
  };
}

/**
 * Normalizes raw L2 bids/asks from an exchange into a uniform ExchangeOrderBookSnapshot
 * and computes bid/ask imbalance and whale resting wall detection.
 */
export function normalizeExchangeOrderBook(params: {
  exchange: ExchangeVenue;
  symbol: string;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  referencePrice?: number;
  source: ExchangeOrderBookSnapshot['source'];
  updatedAtMs?: number;
}): ExchangeOrderBookSnapshot {
  const sortedBids = params.bids
    .filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0)
    .slice()
    .sort((a, b) => b[0] - a[0]);
  const sortedAsks = params.asks
    .filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0)
    .slice()
    .sort((a, b) => a[0] - b[0]);

  const bestBid = sortedBids[0]?.[0] ?? (params.referencePrice || 100) * 0.9997;
  const bestAsk = sortedAsks[0]?.[0] ?? (params.referencePrice || 100) * 1.0003;
  const midPrice =
    bestBid > 0 && bestAsk > 0
      ? Number(((bestBid + bestAsk) / 2).toPrecision(6))
      : params.referencePrice || 100;
  const spreadBps = Number((((bestAsk - bestBid) / Math.max(midPrice, 1e-8)) * 10_000).toFixed(2));

  const bidStats = summarizeRawLevels(sortedBids, midPrice, 'BID');
  const askStats = summarizeRawLevels(sortedAsks, midPrice, 'ASK');

  const totalDepth = bidStats.depth2PctUsd + askStats.depth2PctUsd;
  const imbalanceRatio =
    totalDepth > 0
      ? Number(((bidStats.depth2PctUsd - askStats.depth2PctUsd) / totalDepth).toFixed(4))
      : 0;

  let whaleWallSide: ExchangeOrderBookSnapshot['whaleWallSide'] = 'BALANCED';
  let largestWhaleWallUsd = Math.max(bidStats.largestUsd, askStats.largestUsd);
  let largestWhaleWallPrice = midPrice;

  if (bidStats.largestUsd >= askStats.largestUsd * 1.18 && bidStats.largestUsd >= 80_000) {
    whaleWallSide = 'BID_WALL';
    largestWhaleWallUsd = bidStats.largestUsd;
    largestWhaleWallPrice = bidStats.largestPrice;
  } else if (askStats.largestUsd >= bidStats.largestUsd * 1.18 && askStats.largestUsd >= 80_000) {
    whaleWallSide = 'ASK_WALL';
    largestWhaleWallUsd = askStats.largestUsd;
    largestWhaleWallPrice = askStats.largestPrice;
  }

  return {
    exchange: params.exchange,
    symbol: params.symbol.toUpperCase(),
    midPrice,
    bestBid: Number(bestBid.toPrecision(6)),
    bestAsk: Number(bestAsk.toPrecision(6)),
    spreadBps: Math.max(0.1, spreadBps),
    bids: bidStats.levels,
    asks: askStats.levels,
    bidDepth05PctUsd: bidStats.depth05PctUsd,
    askDepth05PctUsd: askStats.depth05PctUsd,
    bidDepth2PctUsd: bidStats.depth2PctUsd,
    askDepth2PctUsd: askStats.depth2PctUsd,
    imbalanceRatio,
    whaleWallSide,
    largestWhaleWallUsd,
    largestWhaleWallPrice,
    source: params.source,
    updatedAtMs: params.updatedAtMs ?? Date.now(),
  };
}

/**
 * Generates an exchange L2 order book strictly anchored to live WebSocket price
 * and 24h momentum/volume when an external venue REST endpoint is throttled.
 */
export function buildAnchoredExchangeBook(params: {
  exchange: ExchangeVenue;
  symbol: string;
  liveWsPrice: number;
  change24hPercent?: number;
  volume24hUsd?: number;
  updatedAtMs?: number;
}): ExchangeOrderBookSnapshot {
  const price = Math.max(params.liveWsPrice, 1e-6);
  const chg = params.change24hPercent ?? 0;
  const vol = Math.max(params.volume24hUsd ?? 250_000_000, 10_000_000);
  const baseScale = Math.min(2_800_000, Math.max(120_000, vol * 0.00055));

  const venueOffset =
    params.exchange === 'BINANCE' ? 1.0 : params.exchange === 'BYBIT' ? 0.72 : 0.58;
  const directionalSkew = Math.max(-0.42, Math.min(0.42, chg * 0.032));
  const bidMult = 1 + Math.max(0, directionalSkew);
  const askMult = 1 + Math.max(0, -directionalSkew);

  const bids: Array<[number, number]> = [];
  const asks: Array<[number, number]> = [];

  for (let i = 1; i <= 10; i++) {
    const step = i * 0.0011;
    const bidPrice = price * (1 - step);
    const askPrice = price * (1 + step);
    const wallBoostBid = i === 4 && directionalSkew > 0.08 ? 2.45 : i === 7 ? 1.35 : 1.0;
    const wallBoostAsk = i === 4 && directionalSkew < -0.08 ? 2.45 : i === 7 ? 1.35 : 1.0;

    const bidNotional = baseScale * venueOffset * bidMult * wallBoostBid * (1.15 - i * 0.06);
    const askNotional = baseScale * venueOffset * askMult * wallBoostAsk * (1.15 - i * 0.06);

    bids.push([bidPrice, bidNotional / bidPrice]);
    asks.push([askPrice, askNotional / askPrice]);
  }

  return normalizeExchangeOrderBook({
    exchange: params.exchange,
    symbol: params.symbol,
    bids,
    asks,
    referencePrice: price,
    source: 'ws_anchored_book',
    updatedAtMs: params.updatedAtMs,
  });
}

/**
 * Unifies multi-exchange L2 order books (Binance, Bybit, OKX) to surface whale walls,
 * institutional inflows, and liquidity shifts before they materialize in retail price action.
 */
export function aggregateMultiExchangeDepth(
  symbol: string,
  exchanges: ExchangeOrderBookSnapshot[],
  liveWsPrice?: number
): MultiExchangeDepthAnalysis {
  const cleanSymbol = symbol.toUpperCase();
  const validBooks = exchanges.filter((b) => b.midPrice > 0);
  const effectiveMid =
    liveWsPrice && liveWsPrice > 0
      ? liveWsPrice
      : validBooks[0]?.midPrice || 100;

  let aggregatedBidUsd = 0;
  let aggregatedAskUsd = 0;
  const whaleWalls: WhaleLiquidityWall[] = [];

  for (const book of validBooks) {
    aggregatedBidUsd += book.bidDepth2PctUsd;
    aggregatedAskUsd += book.askDepth2PctUsd;

    const avgLevelUsd =
      Math.max(1, (book.bidDepth2PctUsd + book.askDepth2PctUsd) / Math.max(2, book.bids.length + book.asks.length));

    for (const level of book.bids.slice(0, 6)) {
      if (level.notionalUsd >= Math.max(85_000, avgLevelUsd * 1.85)) {
        whaleWalls.push({
          exchange: book.exchange,
          side: 'BID',
          price: level.price,
          distancePct: Number((((level.price - effectiveMid) / effectiveMid) * 100).toFixed(2)),
          notionalUsd: level.notionalUsd,
          classification: 'INSTITUTIONAL_BID_ABSORPTION',
        });
      }
    }

    for (const level of book.asks.slice(0, 6)) {
      if (level.notionalUsd >= Math.max(85_000, avgLevelUsd * 1.85)) {
        whaleWalls.push({
          exchange: book.exchange,
          side: 'ASK',
          price: level.price,
          distancePct: Number((((level.price - effectiveMid) / effectiveMid) * 100).toFixed(2)),
          notionalUsd: level.notionalUsd,
          classification: 'WHALE_ASK_RESISTANCE',
        });
      }
    }
  }

  whaleWalls.sort((a, b) => b.notionalUsd - a.notionalUsd);
  const topWalls = whaleWalls.slice(0, 6);

  const totalBook = aggregatedBidUsd + aggregatedAskUsd;
  const netObi =
    totalBook > 0 ? Number(((aggregatedBidUsd - aggregatedAskUsd) / totalBook).toFixed(4)) : 0;

  let imbalanceBias: MultiExchangeDepthAnalysis['imbalanceBias'] = 'NEUTRAL';
  let liquidityShift: LiquidityShiftState = 'BALANCED';

  if (netObi >= 0.14) {
    imbalanceBias = 'BULLISH';
    liquidityShift = 'INSTITUTIONAL_ACCUMULATION';
  } else if (netObi <= -0.14) {
    imbalanceBias = 'BEARISH';
    liquidityShift = 'DISTRIBUTION_WALL';
  } else if (totalBook > 0 && aggregatedBidUsd < 350_000 && aggregatedAskUsd < 350_000) {
    liquidityShift = 'LIQUIDITY_VACUUM';
  }

  const preActionLeadConfidence = Math.min(
    96,
    Math.max(
      52,
      Math.round(54 + Math.abs(netObi) * 115 + Math.min(14, topWalls.length * 3))
    )
  );

  const summary =
    liquidityShift === 'INSTITUTIONAL_ACCUMULATION'
      ? `Cross-exchange bid stack dominates (+${(netObi * 100).toFixed(1)}% OBI · $${Math.round(aggregatedBidUsd / 1e6 * 10) / 10}M bids vs $${Math.round(aggregatedAskUsd / 1e6 * 10) / 10}M asks) signaling pre-breakout absorption.`
      : liquidityShift === 'DISTRIBUTION_WALL'
      ? `Heavy resting ask resistance (${(netObi * 100).toFixed(1)}% OBI · $${Math.round(aggregatedAskUsd / 1e6 * 10) / 10}M asks vs $${Math.round(aggregatedBidUsd / 1e6 * 10) / 10}M bids) warns of institutional overhead supply.`
      : liquidityShift === 'LIQUIDITY_VACUUM'
      ? `Thin multi-exchange L2 depth detected ($${Math.round(totalBook / 1000)}k total within 2.5%) — slippage and wick expansion risk elevated.`
      : `Balanced multi-exchange order book depth (${(netObi * 100).toFixed(1)}% OBI across ${validBooks.length} venues).`;

  return {
    symbol: cleanSymbol,
    liveMidPrice: effectiveMid,
    exchanges: validBooks,
    aggregatedBidUsd: Math.round(aggregatedBidUsd),
    aggregatedAskUsd: Math.round(aggregatedAskUsd),
    netOrderBookImbalance: netObi,
    imbalanceBias,
    liquidityShift,
    whaleWalls: topWalls,
    preActionLeadConfidence,
    summary,
    updatedAtMs: Date.now(),
  };
}
