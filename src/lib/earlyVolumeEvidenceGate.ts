/**
 * Pre-pump early warning validation — research and paper-trading gate only.
 * A 24h quote-volume total or order-book wall is NOT proof of net capital inflow,
 * wash-trade-free demand, institutional interest or a future price increase.
 */
export type EvidenceOrigin = 'EXCHANGE_TRADES' | 'EXCHANGE_CANDLES' | 'EXCHANGE_ORDERBOOK' | 'ONCHAIN_INDEXER' | 'MODEL_ESTIMATE' | 'CACHE';
export interface EarlyVolumeEvidence {
 readonly symbol: string;
 readonly observedAtMs: number;
 readonly nowMs: number;
 readonly livePriceUsd: number;
 readonly quoteVolumeUsd5m: number;
 readonly baselineAverageQuoteVolumeUsd5m: number;
 readonly baselineWindowCount: number;
 readonly independentExchangeConfirmations: number;
 readonly orderbookSpreadBps: number;
 readonly executableDepthUsd: number;
 readonly estimatedRoundTripSlippageBps: number;
 readonly takerBuyVolumeUsd5m: number | null;
 readonly takerSellVolumeUsd5m: number | null;
 readonly source: EvidenceOrigin;
 readonly marketHaltActive: boolean;
 readonly securityIncidentActive: boolean;
 readonly delistingFlag: boolean;
 readonly priceChange5mPct: number;
 readonly availableFuturesContract: boolean;
 readonly fundingRatePct: number | null;
}
export interface EarlyVolumeDecision {
 readonly mode: 'REJECT' | 'WATCH' | 'PAPER_SPOT_CANDIDATE' | 'PAPER_FUTURES_RESEARCH';
 readonly mayPlaceLiveOrder: false;
 readonly verifiedRelativeVolumeRatio: number | null;
 readonly netAggressiveBuyUsd: number | null;
 readonly reasons: readonly string[];
 readonly isDataVerified: boolean;
}

export function evaluateEarlyVolumeEvidence(e: EarlyVolumeEvidence): EarlyVolumeDecision {
 const reasons: string[]=[];
 const finite=(...n:number[])=>n.every(Number.isFinite);
 const fresh=finite(e.nowMs,e.observedAtMs) && e.nowMs >= e.observedAtMs && e.nowMs-e.observedAtMs <= 30_000;
 if(!fresh) reasons.push('Market snapshot stale or timestamp invalid');
 if(!finite(e.livePriceUsd,e.quoteVolumeUsd5m,e.baselineAverageQuoteVolumeUsd5m,e.orderbookSpreadBps,e.executableDepthUsd,e.estimatedRoundTripSlippageBps,e.priceChange5mPct) ||
   e.livePriceUsd<=0 || e.quoteVolumeUsd5m<0 || e.baselineAverageQuoteVolumeUsd5m<=0 || e.orderbookSpreadBps<0 || e.executableDepthUsd<0 || e.estimatedRoundTripSlippageBps<0) reasons.push('Incomplete or invalid numeric evidence');
 if(!['EXCHANGE_TRADES','EXCHANGE_CANDLES'].includes(e.source)) reasons.push('Volume source is modeled, cached, or not verified exchange flow');
 if(!Number.isSafeInteger(e.baselineWindowCount) || e.baselineWindowCount<20) reasons.push('Insufficient historical 5-minute volume baseline');
 if(!Number.isSafeInteger(e.independentExchangeConfirmations) || e.independentExchangeConfirmations<2) reasons.push('Independent cross-exchange confirmation missing');
 if(e.orderbookSpreadBps>35 || e.executableDepthUsd<50_000 || e.estimatedRoundTripSlippageBps>40) reasons.push('Spread, executable depth or slippage fails liquidity checks');
 if(e.marketHaltActive || e.securityIncidentActive || e.delistingFlag) reasons.push('Hard risk, security, or delisting flag present');
 if(Math.abs(e.priceChange5mPct)>12) reasons.push('Parabolic 5-minute move; avoid late chasing');
 const flowValid=e.takerBuyVolumeUsd5m!==null && e.takerSellVolumeUsd5m!==null &&
   finite(e.takerBuyVolumeUsd5m,e.takerSellVolumeUsd5m) && e.takerBuyVolumeUsd5m>=0 && e.takerSellVolumeUsd5m>=0;
 if(!flowValid) reasons.push('Actual aggressive buy/sell trade flow unavailable');
 const ratio=finite(e.quoteVolumeUsd5m,e.baselineAverageQuoteVolumeUsd5m) && e.baselineAverageQuoteVolumeUsd5m>0
   ? Number((e.quoteVolumeUsd5m/e.baselineAverageQuoteVolumeUsd5m).toFixed(2)) : null;
 const net=flowValid ? e.takerBuyVolumeUsd5m! - e.takerSellVolumeUsd5m! : null;
 const verified=reasons.length===0;
 if(!verified) return {mode:'REJECT',mayPlaceLiveOrder:false,verifiedRelativeVolumeRatio:ratio,netAggressiveBuyUsd:net,reasons,isDataVerified:false};
 if(ratio===null || ratio<1.8 || net===null || net<=0)
   return {mode:'WATCH',mayPlaceLiveOrder:false,verifiedRelativeVolumeRatio:ratio,netAggressiveBuyUsd:net,reasons:['Insufficient relative volume or net aggressive buying'],isDataVerified:true};
 // Futures requires a separate market/venue and margin risk review; never auto-place.
 const futuresEligible=e.availableFuturesContract && e.fundingRatePct!==null && Number.isFinite(e.fundingRatePct)
   && Math.abs(e.fundingRatePct)<0.03 && ratio>=3;
 return {mode:futuresEligible?'PAPER_FUTURES_RESEARCH':'PAPER_SPOT_CANDIDATE',
   mayPlaceLiveOrder:false,verifiedRelativeVolumeRatio:ratio,netAggressiveBuyUsd:net,reasons:[],
   isDataVerified:true};
}
