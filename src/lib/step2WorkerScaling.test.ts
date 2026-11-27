import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialMaintenanceState,
  startMaintenance,
} from './safeMaintenanceProtocol';
import {
  acquireIdempotentExecutionLock,
  createInitialWorkerPoolState,
  releaseExecutionLock,
  restartDegradedWorker,
  scaleWorkerPoolControlled,
} from './step2WorkerScaling';

test('Step 2 Worker Scaling: prevents two workers from executing the same signal or clientOrderId', () => {
  const maint = createInitialMaintenanceState('1.4.0-step2');
  const pool0 = createInitialWorkerPoolState();

  const first = acquireIdempotentExecutionLock(
    pool0,
    { signalId: 'SF-SIG-001', clientOrderId: 'ORD-001', workerId: 'sf-worker-1' },
    maint
  );
  assert.equal(first.acquired, true);
  assert.equal(first.assignedWorkerId, 'sf-worker-1');

  // Second worker tries to execute same signalId concurrently
  const dupSignal = acquireIdempotentExecutionLock(
    first.state,
    { signalId: 'SF-SIG-001', clientOrderId: 'ORD-002', workerId: 'sf-worker-2' },
    maint
  );
  assert.equal(dupSignal.acquired, false);
  assert.equal(dupSignal.code, 'BLOCKED_DUPLICATE_SIGNAL');
  assert.equal(dupSignal.state.duplicateExecutionsPrevented, 1);

  // Release first lock; subsequent replay of same signalId or clientOrderId must STILL be blocked
  const released = releaseExecutionLock(dupSignal.state, {
    signalId: 'SF-SIG-001',
    workerId: 'sf-worker-1',
    succeeded: true,
  });

  const replayOrder = acquireIdempotentExecutionLock(
    released,
    { signalId: 'SF-SIG-002', clientOrderId: 'ORD-001', workerId: 'sf-worker-2' },
    maint
  );
  assert.equal(replayOrder.acquired, false);
  assert.equal(replayOrder.code, 'BLOCKED_DUPLICATE_CLIENT_ORDER_ID');
});

test('Step 2 Worker Scaling: enforces bounded min/max worker budget and concurrency limit', () => {
  const maint = createInitialMaintenanceState('1.4.0-step2');
  const pool0 = createInitialWorkerPoolState();

  const tooMany = scaleWorkerPoolControlled(pool0, 12, maint);
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.code, 'BLOCKED_RESOURCE_BUDGET');

  const scaledUp = scaleWorkerPoolControlled(pool0, 4, maint);
  assert.equal(scaledUp.ok, true);
  assert.equal(scaledUp.state.workers.length, 4);

  // Fill concurrency limit (default 2)
  const a = acquireIdempotentExecutionLock(
    scaledUp.state,
    { signalId: 'S1', clientOrderId: 'C1' },
    maint
  );
  const b = acquireIdempotentExecutionLock(
    a.state,
    { signalId: 'S2', clientOrderId: 'C2' },
    maint
  );
  const c = acquireIdempotentExecutionLock(
    b.state,
    { signalId: 'S3', clientOrderId: 'C3' },
    maint
  );
  assert.equal(a.acquired, true);
  assert.equal(b.acquired, true);
  assert.equal(c.acquired, false);
  assert.equal(c.code, 'BLOCKED_CONCURRENCY_LIMIT');
  assert.equal(c.state.queueDepth, 1);
});

test('Step 2 Worker Scaling: Safe Maintenance Mode blocks scaling, execution dispatch, and self-healing override', () => {
  const normal = createInitialMaintenanceState('1.4.0-step2');
  const inMaint = startMaintenance(normal, {
    durationMinutes: 60,
    publicAccessMode: 'READ_ONLY',
    actor: 'OPS',
  });
  const pool0 = createInitialWorkerPoolState();

  const scaleBlocked = scaleWorkerPoolControlled(pool0, 3, inMaint);
  assert.equal(scaleBlocked.ok, false);
  assert.equal(scaleBlocked.code, 'BLOCKED_MAINTENANCE_ACTIVE');

  const execBlocked = acquireIdempotentExecutionLock(
    scaleBlocked.state,
    { signalId: 'SF-SIG-M1', clientOrderId: 'ORD-M1' },
    inMaint
  );
  assert.equal(execBlocked.acquired, false);
  assert.equal(execBlocked.code, 'BLOCKED_MAINTENANCE_ACTIVE');

  const selfHealBlocked = restartDegradedWorker(execBlocked.state, 'sf-worker-1', inMaint);
  assert.equal(selfHealBlocked.ok, false);
  assert.ok(selfHealBlocked.reason.includes('Safe Maintenance Mode'));
});
