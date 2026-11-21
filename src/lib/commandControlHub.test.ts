import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_TOGGLE_KEYS, DEFAULT_CONTROL_MATRIX } from './controlMatrix';
import {
  COMMAND_DOMAINS,
  COMMAND_MODULE_CATALOG,
  applyCommandPreset,
  computeControlMatrixDelta,
  createDefaultCommandControlState,
  evaluateCommandControlSnapshot,
  filterCommandModules,
  resolveModuleEffectiveState,
  sanitizeCommandControlState,
  setDomainMasterOverride,
  setGlobalMasterOverride,
  setModuleGranularToggle,
  updateDockPreferences,
} from './commandControlHub';

test('COMMAND_MODULE_CATALOG maps all 24 GranularControlMatrix toggles plus 5 specialized Signal Forge modules', () => {
  assert.equal(COMMAND_DOMAINS.length, 4);
  assert.equal(COMMAND_MODULE_CATALOG.length, 29);

  const mappedKeys = new Set(
    COMMAND_MODULE_CATALOG.map((m) => m.controlMatrixKey).filter(Boolean)
  );
  for (const key of CONTROL_TOGGLE_KEYS) {
    assert.ok(mappedKeys.has(key), `Missing GranularControlMatrix key in Command Hub catalog: ${key}`);
  }
});

test('Hybrid Master Override takes precedence without erasing underlying granular module preferences', () => {
  let state = createDefaultCommandControlState(DEFAULT_CONTROL_MATRIX, '2026-01-01T00:00:00.000Z');

  // Set custom granular preferences
  state = setModuleGranularToggle(state, 'signalEngine', false);
  state = setModuleGranularToggle(state, 'futuresExecutionRouter', true);
  state = setModuleGranularToggle(state, 'multiAgentDebateCoordinator', false);

  assert.equal(resolveModuleEffectiveState('signalEngine', state).effectiveEnabled, false);
  assert.equal(resolveModuleEffectiveState('futuresExecutionRouter', state).effectiveEnabled, true);
  assert.equal(resolveModuleEffectiveState('multiAgentDebateCoordinator', state).effectiveEnabled, false);

  // Engage Global Master Emergency OFF
  state = setGlobalMasterOverride(state, 'FORCE_ALL_OFF');
  const haltedSnap = evaluateCommandControlSnapshot(state);
  assert.equal(haltedSnap.effectiveActiveCount, 0);
  assert.equal(haltedSnap.overriddenCount, 29);
  assert.equal(resolveModuleEffectiveState('futuresExecutionRouter', state).resolution, 'GLOBAL_FORCE_OFF');

  // Engage Global Master Force ON
  state = setGlobalMasterOverride(state, 'FORCE_ALL_ON');
  const allOnSnap = evaluateCommandControlSnapshot(state);
  assert.equal(allOnSnap.effectiveActiveCount, 29);
  assert.equal(resolveModuleEffectiveState('signalEngine', state).resolution, 'GLOBAL_FORCE_ON');

  // Release Global Master back to GRANULAR -> all custom granular settings are preserved cleanly
  state = setGlobalMasterOverride(state, 'GRANULAR');
  assert.equal(resolveModuleEffectiveState('signalEngine', state).effectiveEnabled, false);
  assert.equal(resolveModuleEffectiveState('signalEngine', state).resolution, 'GRANULAR');
  assert.equal(resolveModuleEffectiveState('futuresExecutionRouter', state).effectiveEnabled, true);
  assert.equal(resolveModuleEffectiveState('multiAgentDebateCoordinator', state).effectiveEnabled, false);
});

test('Per-domain Master Override isolates only its own domain modules and clears global force cleanly', () => {
  let state = createDefaultCommandControlState(DEFAULT_CONTROL_MATRIX);
  state = setDomainMasterOverride(state, 'EXECUTION_ROUTER', 'FORCE_OFF');

  const snap = evaluateCommandControlSnapshot(state);
  const execSummary = snap.domainSummaries.find((d) => d.domain.id === 'EXECUTION_ROUTER');
  const aiSummary = snap.domainSummaries.find((d) => d.domain.id === 'AI_AGENTS');

  assert.ok(execSummary);
  assert.equal(execSummary.effectiveActiveCount, 0);
  assert.equal(execSummary.overriddenCount, execSummary.totalModules);
  assert.equal(snap.derivedControlMatrix.spotExecutionRouter, false);
  assert.equal(snap.derivedControlMatrix.testnetSandboxRouter, false);

  // AI_AGENTS remains untouched under GRANULAR mode
  assert.ok(aiSummary);
  assert.equal(aiSummary.overrideMode, 'GRANULAR');
  assert.equal(aiSummary.overriddenCount, 0);
  assert.ok(aiSummary.effectiveActiveCount > 0);
});

test('Operational presets, dock preferences, search filtering, and backend matrix delta calculation work deterministically', () => {
  let state = createDefaultCommandControlState(DEFAULT_CONTROL_MATRIX);
  state = applyCommandPreset(state, 'SAFE_MONITOR_ONLY');

  const monitorSnap = evaluateCommandControlSnapshot(state);
  const execSummary = monitorSnap.domainSummaries.find((d) => d.domain.id === 'EXECUTION_ROUTER');
  const marketSummary = monitorSnap.domainSummaries.find((d) => d.domain.id === 'MARKET_DATA');
  assert.equal(execSummary?.effectiveActiveCount, 0);
  assert.equal(marketSummary?.effectiveActiveCount, marketSummary?.totalModules);

  const diffs = computeControlMatrixDelta(DEFAULT_CONTROL_MATRIX, monitorSnap.derivedControlMatrix);
  assert.ok(diffs.some((d) => d.key === 'spotExecutionRouter' && d.value === false));
  assert.ok(diffs.some((d) => d.key === 'futuresFeedModule' && d.value === true));

  // Search filtering
  const filtered = filterCommandModules(monitorSnap.modules, {
    domain: 'AI_AGENTS',
    query: 'debate',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].descriptor.id, 'multiAgentDebateCoordinator');

  // Dock preferences & sanitization
  state = updateDockPreferences(state, { tapToTopMode: 'ON_SCROLL', showDockLabels: false });
  const hydrated = sanitizeCommandControlState(JSON.parse(JSON.stringify(state)));
  assert.equal(hydrated.dock.tapToTopMode, 'ON_SCROLL');
  assert.equal(hydrated.dock.showDockLabels, false);
  assert.equal(hydrated.domainOverrides.EXECUTION_ROUTER, 'FORCE_OFF');
});
