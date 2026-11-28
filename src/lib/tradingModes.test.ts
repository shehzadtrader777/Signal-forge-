import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeOrderRoute, normalizeTradingMode, summarizeByMode, summarizeAccountByMode, type ExecutionPermit } from './tradingModes';

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

test('account-scoped comparison blocks cross-user PnL leakage', () => {
  const trades = [
    {mode:'PAPER' as const, accountId:'owner', signalId:'s1', strategyVersion:'v1', realizedNetPnlUsd:25},
    {mode:'PAPER' as const, accountId:'other', signalId:'s2', strategyVersion:'v1', realizedNetPnlUsd:999999},
    {mode:'LIVE' as const, accountId:'owner', signalId:'s3', strategyVersion:'v1', realizedNetPnlUsd:Number.NaN},
  ];
  const rows = summarizeAccountByMode(trades, 'owner');
  assert.deepEqual(rows.map(x => [x.count, x.realizedNetPnlUsd]), [[1,25],[0,0],[0,0]]);
  assert.throws(() => summarizeByMode(trades), /multiple accounts/);
  assert.throws(() => summarizeAccountByMode(trades, ''), /account ID/);
});
test('nonfinite money and incomplete signal provenance are rejected', () => {
  const trades = [
    {mode:'DEMO' as const, accountId:'owner', signalId:'valid', strategyVersion:'v1', realizedNetPnlUsd:-2},
    {mode:'DEMO' as const, accountId:'owner', signalId:'bad', strategyVersion:'v1', realizedNetPnlUsd:Number.POSITIVE_INFINITY},
    {mode:'DEMO' as const, accountId:'owner', signalId:'', strategyVersion:'v1', realizedNetPnlUsd:3},
  ];
  const demo = summarizeAccountByMode(trades, 'owner')[1];
  assert.deepEqual([demo.count, demo.realizedNetPnlUsd], [1,-2]);
});
