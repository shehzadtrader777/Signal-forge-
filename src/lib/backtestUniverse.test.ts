import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {buildBacktestResearchUniverse,validateHistoricalCoverage} from './backtestUniverse';

test('dynamic research universe includes live market symbols and deduplicates without watchlist limit',()=>{
 const result=buildBacktestResearchUniverse(
  [{symbol:'SUIUSDT',baseAsset:'SUI',name:'Sui',referencePrice:1,dailyVolatility:0.04}],
  [{symbol:'SUIUSDT',baseAsset:'SUI',name:'Sui',price:1,change24hPercent:2,high24h:2,low24h:1,volume24hUsd:2000000,gainerRank:1,isTopGainer:true}],
  ['RENDERUSDT','BTCUSDT','bad pair'],
 );
 assert.ok(result.some(c=>c.symbol==='SUIUSDT'));
 assert.ok(result.some(c=>c.symbol==='RENDERUSDT'));
 assert.equal(result.filter(c=>c.symbol==='BTCUSDT').length,1);
 assert.equal(result.filter(c=>c.symbol==='SUIUSDT').length,1);
 assert.equal(result.some(c=>c.symbol==='BAD PAIR'),false);
});
test('no simulated or insufficient candles qualify as verified real 30d backtest',()=>{
 const candles=Array.from({length:100},(_,i)=>({time:1000+i*900,open:2,high:2,low:2,close:2,volume:100}));
 const insufficient=validateHistoricalCoverage({symbol:'SUIUSDT',bars:candles,windowDays:30,timeframeMinutes:15,source:'binance'});
 assert.equal(insufficient.verified,false);assert.equal(insufficient.expectedBars,2880);
 assert.equal(validateHistoricalCoverage({symbol:'SUIUSDT',bars:candles,windowDays:30,timeframeMinutes:15,source:'cache'}).verified,false);
});
test('complete candles only qualify if continuous and from real source',()=>{
 const candles=Array.from({length:30},(_,i)=>({time:1000+i*86400,open:2,high:3,low:1,close:2,volume:100}));
 assert.equal(validateHistoricalCoverage({symbol:'BTCUSDT',bars:candles,windowDays:30,timeframeMinutes:1440,source:'binance'}).verified,true);
 const broken=candles.map((c,i)=>i===10?{...c,time:c.time+60}:c);
 assert.equal(validateHistoricalCoverage({symbol:'BTCUSDT',bars:broken,windowDays:30,timeframeMinutes:1440,source:'binance'}).verified,false);
});
