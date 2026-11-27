import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {evaluateRecovery,initialRecoveryState,recoveryBackoffMs,type RecoverySafetyContext} from './forgeResilienceSupervisor';
const safe: RecoverySafetyContext={hardHaltActive:false,securityIncidentActive:false,marketDataFresh:true,stateReconciled:true,fallbackTrusted:true,fallbackIsReadOnly:true,rollbackIntegrityVerified:true};
test('switches only to trusted read-only fallback after repeated failures',()=>{
 let s=initialRecoveryState();
 let r=evaluateRecovery(s,{nowMs:1000,healthy:false,fault:'TIMEOUT',safety:safe});assert.equal(r.recommendedRoute,'BLOCK');
 r=evaluateRecovery(r.state,{nowMs:2000,healthy:false,fault:'TIMEOUT',safety:safe});
 assert.equal(r.state.mode,'FALLBACK');assert.equal(r.recommendedRoute,'READ_ONLY_FALLBACK');assert.equal(r.liveExecutionAllowed,false);
});
test('never routes through untrusted or execution-capable fallback',()=>{
 let r=evaluateRecovery(initialRecoveryState(),{nowMs:1,healthy:false,fault:'UPSTREAM_5XX',safety:{...safe,fallbackIsReadOnly:false}});
 r=evaluateRecovery(r.state,{nowMs:2,healthy:false,fault:'UPSTREAM_5XX',safety:{...safe,fallbackIsReadOnly:false}});
 assert.equal(r.recommendedRoute,'BLOCK');assert.notEqual(r.state.mode,'FALLBACK');
});
test('hard seal, security and integrity faults cannot self-heal',()=>{
 for(const ctx of [{...safe,hardHaltActive:true},{...safe,securityIncidentActive:true},{...safe,rollbackIntegrityVerified:false}]){
  const r=evaluateRecovery(initialRecoveryState(),{nowMs:10,healthy:true,safety:ctx});
  assert.equal(r.state.mode,'ISOLATED');assert.equal(r.recommendedRoute,'BLOCK');
 }
 for(const fault of ['AUTH_FAILURE','SECURITY_ALERT','INTEGRITY_FAILURE'] as const){
  const r=evaluateRecovery(initialRecoveryState(),{nowMs:10,healthy:false,fault,safety:safe});
  assert.equal(r.state.mode,'ISOLATED');assert.equal(r.autoRecoveryEligible,false);
 }
});
test('restoring primary requires three healthy checks and stable interval',()=>{
 let r=evaluateRecovery(initialRecoveryState(),{nowMs:1000,healthy:false,fault:'TIMEOUT',safety:safe});
 r=evaluateRecovery(r.state,{nowMs:2000,healthy:false,fault:'TIMEOUT',safety:safe});
 for(const nowMs of [10000,20000]){r=evaluateRecovery(r.state,{nowMs,healthy:true,safety:safe});assert.equal(r.state.mode,'FALLBACK');}
 r=evaluateRecovery(r.state,{nowMs:62000,healthy:true,safety:safe});
 assert.equal(r.state.mode,'PRIMARY');assert.equal(r.liveExecutionAllowed,false);
});
test('exponential backoff is bounded',()=>{assert.ok(recoveryBackoffMs(30)<=120000);assert.ok(recoveryBackoffMs(3)>recoveryBackoffMs(1));});
