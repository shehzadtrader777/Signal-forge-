import type { SubscriptionPrincipal } from './subscriptionGatekeeper';
/**
 * Premium signal-access policy. Distinguishes signal *viewing* from
 * permission to trade. Current backend has FREE/PRO/PREMIUM_INSTITUTIONAL;
 * Ultimate is a proposed product label, not a newly granted entitlement.
 */
export type SignalClass='PUBLIC_MARKET_WATCH'|'VERIFIED_MOMENTUM'|'PRE_PUMP_RESEARCH'|'WHALe_ONCHAIN_FLOW'|'FUTURES_RESEARCH';
export type SignalProvenance='EXCHANGE_OBSERVED'|'INDEPENDENTLY_CROSS_CHECKED'|'MODELED'|'STALE';
export interface SignalAccessDecision {
 readonly canView:boolean;
 readonly displayStatus:'AVAILABLE'|'REDACTED_UPGRADE'|'UNVERIFIED';
 readonly canPlaceLiveOrder:false;
 readonly reasons:readonly string[];
}
export function evaluateSignalAccess(
 principal:SubscriptionPrincipal|null,kind:SignalClass,provenance:SignalProvenance,nowMs=Date.now(),
):SignalAccessDecision {
 const signed=Boolean(principal?.authenticated&&principal?.uid&&principal?.emailVerified);
 const active= signed&&principal?.status==='ACTIVE'&&(principal.expiresAtMs===null||Boolean(principal.expiresAtMs&&principal.expiresAtMs>nowMs));
 const premium=active&&principal?.tier==='PREMIUM_INSTITUTIONAL';
 const pro=active&&(principal?.tier==='PRO'||premium);
 const verified=provenance==='INDEPENDENTLY_CROSS_CHECKED';
 if(provenance==='MODELED'||provenance==='STALE')return {canView:false,displayStatus:'UNVERIFIED',canPlaceLiveOrder:false,reasons:['Only fresh independently verified premium signal data may be promoted']};
 if(kind==='PUBLIC_MARKET_WATCH') return {canView:true,displayStatus:'AVAILABLE',canPlaceLiveOrder:false,reasons:[]};
 const needsPremium=kind==='PRE_PUMP_RESEARCH'||kind==='WHALe_ONCHAIN_FLOW'||kind==='FUTURES_RESEARCH';
 const allowed=needsPremium?premium&&verified:pro&&verified;
 return {canView:Boolean(allowed),displayStatus:allowed?'AVAILABLE':'REDACTED_UPGRADE',canPlaceLiveOrder:false,
 reasons:allowed?[]:[needsPremium?'Premium Institutional (future Ultimate mapping) entitlement and independent verification required':'Pro entitlement and independent verification required']};
}
