/**
 * Trusted market-data source selection for charts/research. Pure, no network calls.
 * A cached CoinGecko/CMC quote is never represented as exchange execution price.
 * Gemini may interpret verified observations but must not supply price ticks.
 */
export type MarketProvider='BINANCE_WS'|'BYBIT_WS'|'OKX_WS'|'BINANCE_REST'|'COINGECKO'|'COINMARKETCAP'|'CACHE'|'GEMINI';
export type MarketUse='CHART'|'RESEARCH'|'EXECUTION';
export interface MarketQuote {
 readonly provider:MarketProvider;
 readonly symbol:string;
 readonly priceUsd:number;
 readonly observedAtMs:number;
 readonly receivedAtMs:number;
 readonly exchangeMarket:'SPOT'|'FUTURES'|'AGGREGATED';
 readonly marketPair:string;
 readonly synthetic:boolean;
}
export interface QuoteSelection {
 readonly quote:MarketQuote|null;
 readonly status:'VERIFIED'|'DEGRADED_RESEARCH_ONLY'|'UNAVAILABLE';
 readonly canUseForExecution:false;
 readonly reasons:readonly string[];
}
const limits:Record<MarketUse,number>={CHART:5_000,RESEARCH:30_000,EXECUTION:1_000};
const priority:Record<MarketProvider,number>={BINANCE_WS:1,BYBIT_WS:2,OKX_WS:3,BINANCE_REST:4,COINGECKO:5,COINMARKETCAP:6,CACHE:7,GEMINI:99};
export function selectTrustedMarketQuote(
 quotes:readonly MarketQuote[], nowMs:number, symbol:string, use:MarketUse,
):QuoteSelection {
 const eligible=quotes.filter(q=>q.symbol===symbol && Number.isFinite(q.priceUsd)&&q.priceUsd>0 &&
   Number.isFinite(q.observedAtMs)&&Number.isFinite(q.receivedAtMs)&&Number.isFinite(nowMs)&&
   nowMs>=q.observedAtMs&&q.receivedAtMs>=q.observedAtMs&&q.receivedAtMs<=nowMs&&
   nowMs-q.observedAtMs<=limits[use]&&!q.synthetic&&q.provider!=='GEMINI');
 const sorted=eligible.sort((a,b)=>priority[a.provider]-priority[b.provider]||b.observedAtMs-a.observedAtMs);
 const q=sorted[0];
 if(!q)return {quote:null,status:'UNAVAILABLE',canUseForExecution:false,reasons:['No fresh, non-synthetic, time-consistent verified quote']};
 const exchangeFeed=['BINANCE_WS','BYBIT_WS','OKX_WS','BINANCE_REST'].includes(q.provider);
 const pairMatches=q.marketPair===symbol&&q.exchangeMarket!=='AGGREGATED';
 const status=exchangeFeed&&pairMatches?'VERIFIED':'DEGRADED_RESEARCH_ONLY';
 const reasons=status==='VERIFIED'?[]:['Aggregator prices are contextual only; cannot be executable prices'];
 // Even a verified exchange quote is observation, not an order authorization.
 return {quote:q,status,canUseForExecution:false,reasons};
}
