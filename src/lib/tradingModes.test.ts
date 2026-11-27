import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeOrderRoute, normalizeTradingMode, summarizeByMode, type ExecutionPermit } from './tradingModes.js';

const basic: ExecutionPermit = {
  mode: 'PAPER', requestedDestination: 'SIMULATOR', authenticated: true,
  serverLiveEnabled: false, accountLiveApproved: false, freshChallengeVerified: false,
  riskApproved: true, exchangeConfigured: false, emergencyHalt: false,
};
test('unknown mode defaults to paper', () => assert.equal(normalizeTradingMode('LIVE '), 'PAPER'));
test('paper cannot reach production exchange', () => {
  assert.equal(authorizeOrderRoute(basic), true);
  assert.equal(authorizeOrderRoute({...basic, requestedDestination: 'EXCHANGE_PRODUCTION'}), false);
});
test('demo cannot reach production and needs sandbox configuration', () => {
  const demo = {...basic, mode: 'DEMO' as const, requestedDestination: 'EXCHANGE_SANDBOX' as const};
  assert.equal(authorizeOrderRoute(demo), false);
  assert.equal(authorizeOrderRoute({...demo, exchangeConfigured: true}), true);
  assert.equal(authorizeOrderRoute({...demo, requestedDestination: 'EXCHANGE_PRODUCTION'}), false);
});
test('live is denied by default and requires every server gate', () => {
  const live = {...basic, mode: 'LIVE' as const, requestedDestination: 'EXCHANGE_PRODUCTION' as const, exchangeConfigured: true};
  assert.equal(authorizeOrderRoute(live), false);
  assert.equal(authorizeOrderRoute({...live, serverLiveEnabled: true, accountLiveApproved: true}), false);
  const approved = {...live, serverLiveEnabled: true, accountLiveApproved: true, freshChallengeVerified: true};
  assert.equal(authorizeOrderRoute(approved), true);
  assert.equal(authorizeOrderRoute({...approved, emergencyHalt: true}), false);
  assert.equal(authorizeOrderRoute({...approved, riskApproved: false}), false);
});
test('comparison keeps paper/demo/live ledgers distinct', () => {
  const summaries = summarizeByMode([
    {mode:'PAPER', accountId:'a', signalId:'s', strategyVersion:'v', realizedNetPnlUsd:10},
    {mode:'DEMO', accountId:'a', signalId:'s', strategyVersion:'v', realizedNetPnlUsd:-2},
  ]);
  assert.deepEqual(summaries.map(x=>[x.mode,x.count,x.realizedNetPnlUsd]), [
    ['PAPER',1,10], ['DEMO',1,-2], ['LIVE',0,0]
  ]);
});
