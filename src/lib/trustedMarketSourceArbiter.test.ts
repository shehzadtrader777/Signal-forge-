import { test } from 'node:test';
import {strict as assert} from 'node:assert';
import {selectTrustedMarketQuote,type MarketQuote} from './trustedMarketSourceArbiter';
const q:MarketQuote={provider:'BINANCE_WS',symbol:'SOLUSDT',priceUsd:100,observedAtMs:10000,receivedAtMs:10010,exchangeMarket:'SPOT',marketPair:'SOLUSDT',synthetic:false};
test('fresh exchange websocket outranks aggregator and remains observational',()=>{
 const r=selectTrustedMarketQuote([{...q,provider:'COINGECKO',exchangeMarket:'AGGREGATED'},q],11000,'SOLUSDT','CHART');
 assert.equal(r.quote?.provider,'BINANCE_WS'); assert.equal(r.status,'VERIFIED');assert.equal(r.canUseForExecution,false);
});
test('stale prices and synthetic books never provide a trade-ready price',()=>{
 for(const quotes of [[{...q,observedAtMs:1000}],[{...q,synthetic:true}],[{...q,provider:'GEMINI' as const}]]){
  const r=selectTrustedMarketQuote(quotes,11000,'SOLUSDT','CHART');
  assert.equal(r.status,'UNAVAILABLE');assert.equal(r.quote,null);
 }
});
test('aggregated quote is clearly contextual only',()=>{
 const r=selectTrustedMarketQuote([{...q,provider:'COINMARKETCAP',exchangeMarket:'AGGREGATED',marketPair:'SOLUSDT'}],11000,'SOLUSDT','RESEARCH');
 assert.equal(r.status,'DEGRADED_RESEARCH_ONLY');assert.equal(r.canUseForExecution,false);
});
test('wrong pair or stale receipt cannot claim verified exchange quote',()=>{
 const r=selectTrustedMarketQuote([{...q,marketPair:'SOLUSD'}],11000,'SOLUSDT','CHART');
 assert.equal(r.status,'DEGRADED_RESEARCH_ONLY');
 assert.equal(selectTrustedMarketQuote([{...q,receivedAtMs:12000}],11000,'SOLUSDT','CHART').status,'UNAVAILABLE');
});
