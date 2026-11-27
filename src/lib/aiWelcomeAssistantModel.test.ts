import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerWelcomeAssistantQuery,
  INITIAL_VOICE_PERMISSION_STATE,
  markWelcomeAssistantShown,
  requestVoiceMicrophoneToggle,
  shouldAutoShowWelcomeAssistant,
  WELCOME_QUICK_TOPICS,
} from './aiWelcomeAssistantModel.ts';

test('AI Welcome Assistant session gate shows once per session and respects opt-in microphone rules', () => {
  const memory = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v);
    },
  };

  assert.equal(shouldAutoShowWelcomeAssistant(mockStorage), true);
  markWelcomeAssistantShown(mockStorage);
  assert.equal(shouldAutoShowWelcomeAssistant(mockStorage), false);

  // Microphone MUST start off and never enable without explicit click
  assert.equal(INITIAL_VOICE_PERMISSION_STATE.microphoneOptIn, false);
  assert.equal(INITIAL_VOICE_PERMISSION_STATE.isListening, false);

  const nonClick = requestVoiceMicrophoneToggle(INITIAL_VOICE_PERMISSION_STATE, false);
  assert.equal(nonClick.isListening, false);
  assert.equal(nonClick.microphoneOptIn, false);

  const clickedOn = requestVoiceMicrophoneToggle(INITIAL_VOICE_PERMISSION_STATE, true);
  assert.equal(clickedOn.isListening, true);
  assert.equal(clickedOn.microphoneOptIn, true);

  const clickedOff = requestVoiceMicrophoneToggle(clickedOn, true);
  assert.equal(clickedOff.isListening, false);
});

test('AI Welcome Assistant answers visitor FAQ queries transparently with valid routes', () => {
  assert.equal(WELCOME_QUICK_TOPICS.length, 6);

  const verifyAns = answerWelcomeAssistantQuery('How can I verify SF-2026-000103?');
  assert.equal(verifyAns.matchedTopicId, 'trade_verification');
  assert.equal(verifyAns.suggestedAction?.target, '#trade-id-verification');

  const chartAns = answerWelcomeAssistantQuery('Do you have trendline support on charts?');
  assert.equal(chartAns.matchedTopicId, 'smart_charts');

  const regAns = answerWelcomeAssistantQuery('How do I register?');
  assert.equal(regAns.matchedTopicId, 'registration');
  assert.equal(regAns.suggestedAction?.target, '/login');
});
