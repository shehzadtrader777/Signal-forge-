import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  acceptNewerAuthoritativeSnapshot,
  deriveHaltPresentation,
  type HaltAuthoritySnapshot,
} from './emergencyHaltPresentation';

const halted: HaltAuthoritySnapshot = {
  state: 'HALTED_CONFIRMED',
  revision: 4,
  sealId: 'sample-seal',
  acknowledgedAtIso: '2026-11-27T10:42:48Z',
  source: 'server',
  executionEnabled: false,
};

test('offline or pending state never announces a confirmed halt or enables trading', () => {
  const unknown = deriveHaltPresentation(null);
  assert.equal(unknown.isHaltConfirmed, false);
  assert.equal(unknown.allowsTrading, false);
  assert.equal(unknown.showEmergencyBanner, true);
  assert.match(deriveHaltPresentation(null, true).label, /awaiting server acknowledgement/);
});

test('confirmed server halt is clearly visible, including on mobile presentation', () => {
  const result = deriveHaltPresentation(halted);
  assert.equal(result.isHaltConfirmed, true);
  assert.equal(result.tone, 'danger');
  assert.equal(result.showEmergencyBanner, true);
  assert.equal(result.allowsTrading, false);
});

test('approved recovery does not unlock live trading', () => {
  const view = deriveHaltPresentation({
    ...halted,
    revision: 5,
    state: 'RESUME_APPROVED_EXECUTION_LOCKED',
  });
  assert.equal(view.allowsTrading, false);
  assert.match(view.label, /trading still locked/);
});

test('stale or invalid local-shaped state does not override server state', () => {
  assert.equal(acceptNewerAuthoritativeSnapshot(halted, { ...halted, revision: 3 }), halted);
  assert.equal(acceptNewerAuthoritativeSnapshot(halted, { ...halted, revision: 5, source: 'client' as 'server' }), halted);
  assert.equal(acceptNewerAuthoritativeSnapshot(halted, { ...halted, revision: 5 }).revision, 5);
});
