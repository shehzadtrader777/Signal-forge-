import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVoiceCommandTranscript } from './voiceCommandAgent';

test('parseVoiceCommandTranscript prioritizes emergency Stop commands immediately', () => {
  const exactStop = parseVoiceCommandTranscript('Stop');
  assert.equal(exactStop.intent, 'STOP');

  const phraseStop = parseVoiceCommandTranscript('Hey Signal Forge emergency stop trading now');
  assert.equal(phraseStop.intent, 'STOP');

  const haltCmd = parseVoiceCommandTranscript('halt system');
  assert.equal(haltCmd.intent, 'STOP');
});

test('parseVoiceCommandTranscript recognizes liquidate, resume, tick, audit, and navigation commands', () => {
  assert.equal(parseVoiceCommandTranscript('emergency liquidate all positions').intent, 'EMERGENCY_LIQUIDATE');
  assert.equal(parseVoiceCommandTranscript('resume app live').intent, 'RESUME');
  assert.equal(parseVoiceCommandTranscript('run coordinator tick').intent, 'RUN_TICK');
  assert.equal(parseVoiceCommandTranscript('run sentinel audit').intent, 'RUN_AUDIT');
  assert.equal(parseVoiceCommandTranscript('check system status').intent, 'STATUS');

  const navBacktest = parseVoiceCommandTranscript('open backtesting');
  assert.equal(navBacktest.intent, 'NAVIGATE');
  assert.equal(navBacktest.routeTarget, '/backtesting');

  const navSignals = parseVoiceCommandTranscript('go to signals');
  assert.equal(navSignals.intent, 'NAVIGATE');
  assert.equal(navSignals.routeTarget, '/signals');
});

test('parseVoiceCommandTranscript returns UNKNOWN cleanly for unrelated utterances', () => {
  const unknown = parseVoiceCommandTranscript('hello weather today');
  assert.equal(unknown.intent, 'UNKNOWN');
});
