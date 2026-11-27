import type { UnifiedSignalAuditRecord } from './signalHistory';

/**
 * Traceable local record ID is NOT an exchange execution receipt or cryptographic attestation.
 * Never label a backtest/pinned signal as exchange-verified without signed server evidence.
 */
export type TradeProvenance = 'SIMULATED'|'LOCAL_SIGNAL'|'EXECUTION_UNVERIFIED'|'EXCHANGE_VERIFIED';
export function deriveTradeAuditIdentity(record:UnifiedSignalAuditRecord):{
 id:string;provenance:TradeProvenance;verificationLabel:string;exchangeVerified:false;
}{
 const source=record.origin;
 const provenance:TradeProvenance=source.startsWith('BACKTEST_')?'SIMULATED'
  :source==='LIVE_PINNED'?'LOCAL_SIGNAL':'EXECUTION_UNVERIFIED';
 return {
  id: record.id,
  provenance,
  verificationLabel: provenance==='SIMULATED'?'Simulated benchmark — not a trade'
   : provenance==='LOCAL_SIGNAL'?'Signal record — exchange trade not verified'
   :'Execution record — awaiting exchange trade receipt verification',
  exchangeVerified:false,
 };
}
