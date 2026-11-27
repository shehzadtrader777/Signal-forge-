import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareExecutionsBySignal, type ModeExecutionObservation } from './signalModeComparison';

const sample: ModeExecutionObservation[] = [
  { accountId: 'owner', signalId: 'sf-1', strategyVersion: 'v1', mode: 'PAPER', attemptId: 'p1', status: 'FILLED', realizedNetPnlUsd: 12 },
  { accountId: 'owner', signalId: 'sf-1', strategyVersion: 'v1', mode: 'DEMO', attemptId: 'd1', status: 'REJECTED' },
];

test('same immutable signal is compared across modes, no imaginary live fill', () => {
  const [row] = compareExecutionsBySignal(sample, 'owner');
  assert.equal(row.signalId, 'sf-1');
  assert.deepEqual(row.modes.PAPER, { status: 'FILLED', attempts: 1, realizedNetPnlUsd: 12 });
  assert.deepEqual(row.modes.DEMO, { status: 'REJECTED', attempts: 1, realizedNetPnlUsd: null });
  assert.deepEqual(row.modes.LIVE, { status: 'NOT_RUN', attempts: 0, realizedNetPnlUsd: null });
});

test('cross-account entries are completely excluded', () => {
  const rows = compareExecutionsBySignal([...sample, {
    accountId: 'other', signalId: 'sf-1', strategyVersion: 'v1',
    mode: 'LIVE', attemptId: 'l1', status: 'FILLED', realizedNetPnlUsd: 99999,
  }], 'owner');
  assert.equal(rows[0].modes.LIVE.status, 'NOT_RUN');
  assert.throws(() => compareExecutionsBySignal(sample, ''), /Verified account ID/);
});

test('duplicates and invalid monetary values never inflate PnL', () => {
  const [row] = compareExecutionsBySignal([
    ...sample, sample[0],
    { ...sample[0], attemptId: 'p2', realizedNetPnlUsd: Number.POSITIVE_INFINITY },
    { ...sample[0], attemptId: 'p3', realizedNetPnlUsd: Number.NaN },
    { ...sample[0], attemptId: 'p4', realizedNetPnlUsd: null },
  ], 'owner');
  assert.equal(row.modes.PAPER.attempts, 1);
  assert.equal(row.modes.PAPER.realizedNetPnlUsd, 12);
});

test('different versions and signal IDs are never silently pooled', () => {
  const rows = compareExecutionsBySignal([...sample, {
    accountId: 'owner', signalId: 'sf-1', strategyVersion: 'v2',
    mode: 'PAPER', attemptId: 'p2', status: 'FILLED', realizedNetPnlUsd: -5,
  }, {
    accountId: 'owner', signalId: 'sf-2', strategyVersion: 'v1',
    mode: 'PAPER', attemptId: 'p3', status: 'PENDING',
  }], 'owner');
  assert.equal(rows.length, 3);
  assert.equal(rows.find(x => x.strategyVersion === 'v2')?.modes.PAPER.realizedNetPnlUsd, -5);
  assert.equal(rows.find(x => x.signalId === 'sf-2')?.modes.PAPER.realizedNetPnlUsd, null);
});

test('multiple attempts are displayed separately from final settled amount', () => {
  const [row] = compareExecutionsBySignal([...sample, {
    accountId: 'owner', signalId: 'sf-1', strategyVersion: 'v1',
    mode: 'DEMO', attemptId: 'd2', status: 'FILLED', realizedNetPnlUsd: 3,
  }], 'owner');
  assert.equal(row.modes.DEMO.status, 'MIXED');
  assert.equal(row.modes.DEMO.attempts, 2);
  assert.equal(row.modes.DEMO.realizedNetPnlUsd, 3);
});
