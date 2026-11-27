import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {computeRelativeVolumeObservation,parseBinanceFiveMinuteKlines,parseBybitFiveMinuteKlines} from './realVolumeCandles';

test('binance closed klines produce measured 5m quote volume and taker delta',()=>{
 const now=60*300000+2500;
 const rows=Array.from({length:60},(_,i)=>{
  const t=i*300000;
  return [t,'1','2','0.5','1.5','100',t+299999,i===59?'300000':'100000','100', '50',i===59?'200000':'60000','0'];
 });
 const parsed=parseBinanceFiveMinuteKlines('SOLUSDT',rows,now);
 assert.equal(parsed.length,60);
 const last=computeRelativeVolumeObservation(parsed);
 assert.equal(last?.relativeVolumeRatio,3);
 assert.equal(last?.baselineWindowCount,50);
 assert.equal(last?.takerBuyVolumeUsd5m,200000);
 assert.equal(last?.takerSellVolumeUsd5m,100000);
});
test('bybit candles do not invent taker side data',()=>{
 const now=60*300000+1000;
 const rows=Array.from({length:60},(_,i)=>[String(i*300000),'1','2','0.5','1.5','100',i===59?'300000':'100000']);
 const obs=computeRelativeVolumeObservation(parseBybitFiveMinuteKlines('SOLUSDT',rows,now));
 assert.equal(obs?.relativeVolumeRatio,3);
 assert.equal(obs?.takerBuyVolumeUsd5m,null);
 assert.equal(obs?.takerSellVolumeUsd5m,null);
});
test('gaps and missing baselines must not create pre-pump evidence',()=>{
 const now=22*300000;
 const rows=Array.from({length:21},(_,i)=>[i*300000,'1','2','0.5','1','100',i*300000+299999,'1000','1','500','600','0']);
 const obs=parseBinanceFiveMinuteKlines('BTCUSDT',rows,now);
 assert.ok(computeRelativeVolumeObservation(obs));
 const withGap=obs.map((v,i)=>i===5?{...v,closedAtMs:v.closedAtMs+300000}:v);
 assert.equal(computeRelativeVolumeObservation(withGap),null);
 assert.equal(computeRelativeVolumeObservation(obs.slice(0,19)),null);
});
