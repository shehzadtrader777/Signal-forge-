import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SYSTEM_CONTROLS,
  deriveActiveRuntimePlanes,
  mergeSystemControls,
  parseSystemControls,
  shouldSyncMonitorHealthUi,
} from './systemControls.ts';

test('parseSystemControls safely normalizes partial or invalid inputs', () => {
  assert.deepEqual(parseSystemControls(null), DEFAULT_SYSTEM_CONTROLS);
  assert.deepEqual(parseSystemControls({}), DEFAULT_SYSTEM_CONTROLS);
  assert.deepEqual(
    parseSystemControls({ testnetExecutionEnabled: false }),
    { testnetExecutionEnabled: false, liveFeedModulesEnabled: true }
  );
  assert.deepEqual(
    parseSystemControls({ testnetExecutionEnabled: 'yes', liveFeedModulesEnabled: false }),
    { testnetExecutionEnabled: true, liveFeedModulesEnabled: false }
  );
});

test('mergeSystemControls merges partial patches without dropping existing fields', () => {
  const initial = { testnetExecutionEnabled: false, liveFeedModulesEnabled: true };
  assert.deepEqual(mergeSystemControls(initial, { liveFeedModulesEnabled: false }), {
    testnetExecutionEnabled: false,
    liveFeedModulesEnabled: false,
  });
  assert.deepEqual(mergeSystemControls(initial, {}), initial);
});

test('deriveActiveRuntimePlanes pauses high-frequency loops when toggled off while keeping core alerts active', () => {
  const allPaused = deriveActiveRuntimePlanes({
    testnetExecutionEnabled: false,
    liveFeedModulesEnabled: false,
  });
  assert.equal(allPaused.runSpotWsStream, false);
  assert.equal(allPaused.runKlineWsStream, false);
  assert.equal(allPaused.runLiveFeedRestPolling, false);
  assert.equal(allPaused.runMonitorSseStream, false);
  assert.equal(allPaused.runBackgroundIntelAgent, false);
  assert.equal(allPaused.runFuturesModules, false);
  assert.equal(allPaused.runTestnetExecution, false);
  assert.equal(allPaused.runTestnetAtrTracking, false);
  // Preserved subsystems stay ON
  assert.equal(allPaused.runSignalEngine, true);
  assert.equal(allPaused.runTopGainersScanner, true);
  assert.equal(allPaused.runTelegramDispatcher, true);
});

test('deriveActiveRuntimePlanes allows independent control of Testnet Execution vs Live Feed Modules', () => {
  const onlyLivePaused = deriveActiveRuntimePlanes({
    testnetExecutionEnabled: true,
    liveFeedModulesEnabled: false,
  });
  assert.equal(onlyLivePaused.runTestnetExecution, true);
  assert.equal(onlyLivePaused.runTestnetAtrTracking, false);
  assert.equal(onlyLivePaused.runSpotWsStream, false);
  assert.equal(onlyLivePaused.runSignalEngine, true);
  assert.equal(onlyLivePaused.runTopGainersScanner, true);
  assert.equal(onlyLivePaused.runTelegramDispatcher, true);

  const onlyTestnetPaused = deriveActiveRuntimePlanes({
    testnetExecutionEnabled: false,
    liveFeedModulesEnabled: true,
  });
  assert.equal(onlyTestnetPaused.runTestnetExecution, false);
  assert.equal(onlyTestnetPaused.runTestnetAtrTracking, false);
  assert.equal(onlyTestnetPaused.runSpotWsStream, true);
  assert.equal(onlyTestnetPaused.runLiveFeedRestPolling, true);
  assert.equal(onlyTestnetPaused.runFuturesModules, true);
});

test('shouldSyncMonitorHealthUi suppresses sub-second unchanged heartbeats until interval elapses', () => {
  const base = {
    agentActive: true,
    wsChannelStatus: 'BOUND_STREAMING',
    autoHealCount: 1,
    anomaliesDetected: 0,
    lastHealAction: 'OK',
    spotFeedOk: true,
    cmcFeedOk: true,
  };
  assert.equal(shouldSyncMonitorHealthUi(null, base, 0), true);
  assert.equal(shouldSyncMonitorHealthUi(base, { ...base }, 750), false);
  assert.equal(shouldSyncMonitorHealthUi(base, { ...base }, 2999), false);
  assert.equal(shouldSyncMonitorHealthUi(base, { ...base }, 3000), true);
  assert.equal(
    shouldSyncMonitorHealthUi(base, { ...base, wsChannelStatus: 'RECONNECTING' }, 200),
    true
  );
  assert.equal(
    shouldSyncMonitorHealthUi(base, { ...base, autoHealCount: 2 }, 150),
    true
  );
});

test('deriveActiveRuntimePlanes halts ALL operations including signal dispatch when App Live switch is OFF', () => {
  const halted = deriveActiveRuntimePlanes(
    { testnetExecutionEnabled: true, liveFeedModulesEnabled: true },
    false
  );
  assert.equal(halted.runSpotWsStream, false);
  assert.equal(halted.runKlineWsStream, false);
  assert.equal(halted.runLiveFeedRestPolling, false);
  assert.equal(halted.runMonitorSseStream, false);
  assert.equal(halted.runSignalEngine, false);
  assert.equal(halted.runTopGainersScanner, false);
  assert.equal(halted.runTelegramDispatcher, false);
  assert.equal(halted.runAutonomousCoordinator, false);
  assert.equal(halted.runArbitrageAndCopyTrading, false);
});
