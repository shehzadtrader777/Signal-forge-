import {TRACKED_COINS, type CoinMeta, type TopGainerCoin} from './marketData';

/**
 * Research universe is deliberately distinct from watchlist quota or realtime WS subscriptions.
 * Presence in a ticker/gainer feed is NOT evidence that 30/60/90d historical candles exist.
 */
export interface BacktestUniverseCoin extends CoinMeta {
  readonly origin:'TRACKED'|'LIVE_MARKET';
}
export function buildBacktestResearchUniverse(
  allKnownCoins:readonly CoinMeta[],
  topGainers:readonly TopGainerCoin[],
  tickerSymbols:readonly string[],
):BacktestUniverseCoin[] {
  const result=new Map<string,BacktestUniverseCoin>();
  for(const coin of TRACKED_COINS) result.set(coin.symbol,{...coin,origin:'TRACKED'});
  for(const coin of [...allKnownCoins,...topGainers]) {
    const symbol=String(coin.symbol||'').toUpperCase();
    if(!/^[A-Z0-9]{2,16}USDT$/.test(symbol))continue;
    if(!result.has(symbol))result.set(symbol,{...coin,symbol,origin:'LIVE_MARKET'});
  }
  for(const value of tickerSymbols) {
    const symbol=String(value||'').toUpperCase();
    if(!/^[A-Z0-9]{2,16}USDT$/.test(symbol)||result.has(symbol))continue;
    const baseAsset=symbol.slice(0,-4);
    result.set(symbol,{symbol,baseAsset,name:baseAsset,referencePrice:0,dailyVolatility:0,origin:'LIVE_MARKET'});
  }
  return [...result.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol));
}

export function validateHistoricalCoverage(input:{
  symbol:string;
  bars:readonly {time:number;open:number;high:number;low:number;close:number;volume:number}[];
  windowDays:30|60|90;
  timeframeMinutes:15|60|240|1440;
  source:'binance'|'cache'|'unknown';
}) {
  const expected=Math.ceil(input.windowDays*24*60/input.timeframeMinutes);
  const arr=[...input.bars].sort((a,b)=>a.time-b.time);
  const valid=arr.every(c=>[c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.volume>=0);
  let continuous=true;
  const delta=input.timeframeMinutes*60;
  for(let i=1;i<arr.length;i++)if(arr[i].time-arr[i-1].time!==delta){continuous=false;break;}
  const observedBars=arr.length;
  const verified=input.source==='binance'&&valid&&continuous&&observedBars>=expected;
  return {symbol:input.symbol,windowDays:input.windowDays,source:input.source,
    expectedBars:expected,observedBars,continuous,verified,
    mode:verified?'HISTORICAL_VERIFIED' as const:'SIMULATION_OR_INSUFFICIENT' as const};
}
