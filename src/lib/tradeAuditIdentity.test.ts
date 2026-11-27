import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {deriveTradeAuditIdentity} from './tradeAuditIdentity';
import type {UnifiedSignalAuditRecord} from './signalHistory';

const sample:UnifiedSignalAuditRecord={
 id:'sample-record',timestamp:'2026-11-27T00:00:00Z',symbol:'SOLUSDT',coinName:'SOL',
 direction:'BUY',origin:'LIVE_PINNED',moduleLabel:'Pre Pump Research',session:'24/7',timeframe:'15m',
 entryPrice:100,exitOrMarkPrice:110,stopLoss:95,takeProfit:120,confidence:80,
 riskRewardRatio:4,status:'ACTIVE',pnlR:2,pnlPercent:10,
};
test('pinned signals are not mislabeled as verified exchange trades',()=>{
 const result=deriveTradeAuditIdentity(sample);
 assert.equal(result.id,'sample-record');
 assert.equal(result.provenance,'LOCAL_SIGNAL');
 assert.equal(result.exchangeVerified,false);
});
test('benchmark and execution records remain distinguishable',()=>{
 assert.equal(deriveTradeAuditIdentity({...sample,origin:'BACKTEST_SMC'}).provenance,'SIMULATED');
 const executed=deriveTradeAuditIdentity({...sample,origin:'EXECUTED_ORDER'});
 assert.equal(executed.provenance,'EXECUTION_UNVERIFIED');
 assert.equal(executed.exchangeVerified,false);
});
