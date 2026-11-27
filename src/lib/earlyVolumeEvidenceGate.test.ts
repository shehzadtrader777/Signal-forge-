import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluateEarlyVolumeEvidence, type EarlyVolumeEvidence } from './earlyVolumeEvidenceGate';

const good: EarlyVolumeEvidence = {
 symbol:'SOLUSDT',observedAtMs:1000000,nowMs:1005000,livePriceUsd:100,
 quoteVolumeUsd5m:3_000_000,baselineAverageQuoteVolumeUsd5m:1_000_000,
 baselineWindowCount:40,independentExchangeConfirmations:2,
 orderbookSpreadBps:8,executableDepthUsd:500000,estimatedRoundTripSlippageBps:18,
 takerBuyVolumeUsd5m:1_900_000,takerSellVolumeUsd5m:1_100_000,
 source:'EXCHANGE_TRADES',marketHaltActive:false,securityIncidentActive:false,
 delistingFlag:false,priceChange5mPct:2,availableFuturesContract:false,fundingRatePct:null,
};
test('verified early-volume evidence creates research candidate, not live order',()=>{
 const d=evaluateEarlyVolumeEvidence(good);
 assert.equal(d.mode,'PAPER_SPOT_CANDIDATE');assert.equal(d.verifiedRelativeVolumeRatio,3);
 assert.equal(d.netAggressiveBuyUsd,800000);assert.equal(d.mayPlaceLiveOrder,false);
});
test('cached/model estimates, stale feeds and unilateral venue data fail verification',()=>{
 for(const patch of [{source:'MODEL_ESTIMATE' as const},{source:'CACHE' as const},{nowMs:1050000},{independentExchangeConfirmations:1},{baselineWindowCount:5},{orderbookSpreadBps:80},{marketHaltActive:true},{securityIncidentActive:true},{delistingFlag:true},{takerBuyVolumeUsd5m:null},{priceChange5mPct:18}]){
  const d=evaluateEarlyVolumeEvidence({...good,...patch});assert.equal(d.mode,'REJECT');assert.equal(d.mayPlaceLiveOrder,false);
 }
});
test('volume spike without net aggressive buying is only a watch alert',()=>{
 const d=evaluateEarlyVolumeEvidence({...good,takerBuyVolumeUsd5m:500000,takerSellVolumeUsd5m:2500000});
 assert.equal(d.mode,'WATCH');assert.equal(d.mayPlaceLiveOrder,false);
});
test('futures candidate needs real contract and funding data and still cannot trade',()=>{
 const d=evaluateEarlyVolumeEvidence({...good,availableFuturesContract:true,fundingRatePct:0.01});
 assert.equal(d.mode,'PAPER_FUTURES_RESEARCH');assert.equal(d.mayPlaceLiveOrder,false);
});
