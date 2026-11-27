import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {evaluateSignalAccess} from './signalTierPolicy';
import type {SubscriptionPrincipal} from './subscriptionGatekeeper';
const base:SubscriptionPrincipal={authenticated:true,uid:'verified-user',email:'verified@example.invalid',emailVerified:true,tier:'FREE',status:'ACTIVE',expiresAtMs:null,entitlementId:'id1',planLabel:'Free'};
const verified='INDEPENDENTLY_CROSS_CHECKED' as const;
test('free users see public market watch but not proprietary signals',()=>{
 assert.equal(evaluateSignalAccess(base,'PUBLIC_MARKET_WATCH','EXCHANGE_OBSERVED').canView,true);
 assert.equal(evaluateSignalAccess(base,'PRE_PUMP_RESEARCH',verified).canView,false);
});
test('Pro gets independently checked momentum, not Ultimate research signals',()=>{
 const pro={...base,tier:'PRO' as const};
 assert.equal(evaluateSignalAccess(pro,'VERIFIED_MOMENTUM',verified).canView,true);
 assert.equal(evaluateSignalAccess(pro,'PRE_PUMP_RESEARCH',verified).canView,false);
});
test('active premium institutional maps to future Ultimate label without silently granting live permissions',()=>{
 const premium={...base,tier:'PREMIUM_INSTITUTIONAL' as const};
 const allowed=evaluateSignalAccess(premium,'WHALE_ONCHAIN_FLOW',verified);
 assert.equal(allowed.canView,true); assert.equal(allowed.canPlaceLiveOrder,false);
 assert.equal(evaluateSignalAccess({...premium,status:'EXPIRED'},'PRE_PUMP_RESEARCH',verified).canView,false);
});
test('no tier sees modeled or stale pre-pump data as verified',()=>{
 for(const provenance of ['MODELED','STALE'] as const){
  const r=evaluateSignalAccess({...base,tier:'PREMIUM_INSTITUTIONAL'},'PRE_PUMP_RESEARCH',provenance);
  assert.equal(r.canView,false); assert.equal(r.displayStatus,'UNVERIFIED');
 }
});
