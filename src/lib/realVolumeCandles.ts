/**
 * Real exchange candle extraction for the read-only early-volume scanner.
 * Only CLOSED 5m candles qualify; this is exchange trade volume, not on-chain deposits.
 */
export interface FiveMinuteObservation {
  symbol: string;
  venue: 'BINANCE'|'BYBIT';
  closedAtMs: number;
  quoteVolumeUsd: number;
  takerBuyQuoteVolumeUsd: number|null;
}
export interface RelativeVolumeObservation {
  symbol:string; venue:'BINANCE'|'BYBIT';
  observedAtMs:number;
  quoteVolumeUsd5m:number;
  baselineAverageQuoteVolumeUsd5m:number;
  baselineWindowCount:number;
  takerBuyVolumeUsd5m:number|null;
  takerSellVolumeUsd5m:number|null;
  relativeVolumeRatio:number;
}
const finitePositive=(n:number)=>Number.isFinite(n)&&n>=0;
export function parseBinanceFiveMinuteKlines(symbol:string,raw:unknown[],nowMs:number):FiveMinuteObservation[] {
 if(!Array.isArray(raw)||!Number.isFinite(nowMs))return [];
 const items:FiveMinuteObservation[]=[];
 for(const item of raw) {
  if(!Array.isArray(item)||item.length<11)continue;
  const closeAt=Number(item[6]);
  const quote=Number(item[7]);
  const takerBuy=Number(item[10]);
  if(!finitePositive(closeAt)||closeAt>=nowMs||!finitePositive(quote)||!finitePositive(takerBuy)||takerBuy>quote)continue;
  items.push({symbol,venue:'BINANCE',closedAtMs:closeAt,quoteVolumeUsd:quote,takerBuyQuoteVolumeUsd:takerBuy});
 }
 return items.sort((a,b)=>a.closedAtMs-b.closedAtMs);
}
export function parseBybitFiveMinuteKlines(symbol:string,raw:unknown[],nowMs:number):FiveMinuteObservation[] {
 if(!Array.isArray(raw)||!Number.isFinite(nowMs))return [];
 const items:FiveMinuteObservation[]=[];
 for(const item of raw) {
  if(!Array.isArray(item)||item.length<7)continue;
  const startsAt=Number(item[0]),quote=Number(item[6]);
  const closesAt=startsAt+300_000;
  if(!finitePositive(startsAt)||closesAt>nowMs||!finitePositive(quote))continue;
  items.push({symbol,venue:'BYBIT',closedAtMs:closesAt,quoteVolumeUsd:quote,takerBuyQuoteVolumeUsd:null});
 }
 return items.sort((a,b)=>a.closedAtMs-b.closedAtMs);
}
export function computeRelativeVolumeObservation(candles:readonly FiveMinuteObservation[]):RelativeVolumeObservation|null {
 if(candles.length<21)return null;
 const sorted=[...candles].sort((a,b)=>a.closedAtMs-b.closedAtMs);
 const recent=sorted[sorted.length-1];
 if(sorted.some(x=>x.symbol!==recent.symbol||x.venue!==recent.venue))return null;
 // Require a continuous closing time sequence, no gaps or duplicate 5m bars.
 const selected=sorted.slice(-51);
 for(let i=1;i<selected.length;i++)if(selected[i].closedAtMs-selected[i-1].closedAtMs!==300_000)return null;
 const baseline=selected.slice(0,-1);
 if(baseline.length<20)return null;
 const average=baseline.reduce((sum,c)=>sum+c.quoteVolumeUsd,0)/baseline.length;
 if(!(average>0))return null;
 const ratio=recent.quoteVolumeUsd/average;
 const sell=recent.takerBuyQuoteVolumeUsd!==null?recent.quoteVolumeUsd-recent.takerBuyQuoteVolumeUsd:null;
 return {symbol:recent.symbol,venue:recent.venue,observedAtMs:recent.closedAtMs,quoteVolumeUsd5m:recent.quoteVolumeUsd,
  baselineAverageQuoteVolumeUsd5m:average,baselineWindowCount:baseline.length,
  takerBuyVolumeUsd5m:recent.takerBuyQuoteVolumeUsd,takerSellVolumeUsd5m:sell,
  relativeVolumeRatio:Number(ratio.toFixed(3))};
}
