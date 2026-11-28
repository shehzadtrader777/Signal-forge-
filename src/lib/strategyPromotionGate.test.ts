import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluateStrategyPromotion, type StrategyEvidence } from './strategyPromotionGate';

const valid: StrategyEvidence={
 strategyId:'test-paper-1', sourceKind:'PAPER_TRADES', independentOutOfSample:true,
 evidenceWindowDays:90, closedTrades:120, minClosedTradesRequired:100,
 maxDrawdownPct:3, maxDrawdownLimitPct:5, observedProfitFactor:1.2,
 netOfFees:true, slippageIncluded:true, leakageCheckPassed:true,
 reproducibleSnapshot:true, activeHardHalt:false,securityIncidentUnresolved:false,
};
test('research projections never promote to owner-ready or live trading',()=>{
 const v=evaluateStrategyPromotion({...valid,sourceKind:'SIMULATED_PRIOR'});
 assert.equal(v.stage,'RESEARCH');assert.equal(v.eligibleForOwnerReview,false);assert.equal(v.liveTradingApproved,false);
});
test('independently validated paper record can only reach owner review',()=>{
 const v=evaluateStrategyPromotion(valid);
 assert.equal(v.stage,'OWNER_REVIEW');assert.equal(v.eligibleForOwnerReview,true);assert.equal(v.liveTradingApproved,false);
});
test('risk, security, and missing friction reject promotion',()=>{
 for(const bad of [{activeHardHalt:true},{securityIncidentUnresolved:true},{netOfFees:false},{slippageIncluded:false},{leakageCheckPassed:false},{maxDrawdownPct:6},{closedTrades:10},{independentOutOfSample:false}]){
  const v=evaluateStrategyPromotion({...valid,...bad});
  assert.equal(v.eligibleForOwnerReview,false);assert.equal(v.liveTradingApproved,false);
 }
});
