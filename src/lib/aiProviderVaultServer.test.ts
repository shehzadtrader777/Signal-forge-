import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AiProviderCredentialVault,
  isValidGeminiCommandModel,
  validateSubmittedApiKey,
} from './aiProviderVaultServer';

function createTempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ai-vault-test-'));
}

test('AiProviderCredentialVault encrypts Gemini key at rest, persists across restarts, and never exposes plaintext', () => {
  const tempDir = createTempDataDir();
  try {
    const fakeSecret = 'AIzaSyFakeTestSecretKeyForVault9876543210';
    const vault1 = new AiProviderCredentialVault(tempDir, () => ({}));

    const initialStatus = vault1.getPublicStatus();
    assert.equal(initialStatus.gemini.configured, false);
    assert.equal(initialStatus.gemini.statusLabel, 'Gemini API Key — Not Configured');
    assert.equal(initialStatus.gemini.source, 'NONE');

    const saveRes = vault1.applyChanges({
      geminiApiKey: fakeSecret,
      geminiModel: 'gemini-4-hydrogen',
      openai: { enabled: true, modelId: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
      anthropic: { enabled: true, modelId: 'claude-3-5-sonnet-latest' },
    });

    assert.equal(saveRes.ok, true);
    assert.equal(saveRes.keyUpdated, true);
    assert.equal(saveRes.status.gemini.configured, true);
    assert.equal(saveRes.status.gemini.statusLabel, 'Gemini API Key — Configured');
    assert.equal(saveRes.status.gemini.source, 'BACKEND_ENCRYPTED_STORE');
    assert.equal(saveRes.status.openai.enabled, true);
    assert.equal(saveRes.status.anthropic.enabled, true);

    // Public status JSON must NEVER contain the plaintext secret or any slice of it
    const serializedStatus = JSON.stringify(saveRes.status);
    assert.ok(!serializedStatus.includes(fakeSecret));
    assert.ok(!serializedStatus.includes('FakeTestSecretKey'));

    // Encrypted disk file must NEVER contain the plaintext secret
    const rawDiskFile = fs.readFileSync(path.join(tempDir, 'ai-provider-vault.enc.json'), 'utf8');
    assert.ok(!rawDiskFile.includes(fakeSecret));
    assert.ok(!rawDiskFile.includes('FakeTestSecretKey'));
    assert.ok(rawDiskFile.includes('"aes-256-gcm"'));

    // Simulate full application restart by instantiating a brand new vault instance on the same directory
    const vaultAfterRestart = new AiProviderCredentialVault(tempDir, () => ({}));
    const statusAfterRestart = vaultAfterRestart.getPublicStatus();
    assert.equal(statusAfterRestart.gemini.configured, true);
    assert.equal(statusAfterRestart.gemini.statusLabel, 'Gemini API Key — Configured');
    assert.equal(statusAfterRestart.gemini.source, 'BACKEND_ENCRYPTED_STORE');
    assert.equal(statusAfterRestart.openai.enabled, true);
    assert.equal(statusAfterRestart.openai.modelId, 'gpt-4o-mini');
    assert.equal(statusAfterRestart.anthropic.enabled, true);
    assert.equal(statusAfterRestart.anthropic.modelId, 'claude-3-5-sonnet-latest');
    assert.equal(vaultAfterRestart.resolveEffectiveGeminiKey().apiKey, fakeSecret);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('AiProviderCredentialVault NEVER overwrites an existing Gemini secret when Apply Changes submits an empty key input', () => {
  const tempDir = createTempDataDir();
  try {
    const originalSecret = 'AIzaSyOriginalPersistedKey112233445566';
    const vault = new AiProviderCredentialVault(tempDir, () => ({}));

    vault.applyChanges({
      geminiApiKey: originalSecret,
      openai: { enabled: true, modelId: 'gpt-4.1-mini' },
      anthropic: { enabled: false, modelId: 'claude-3-7-sonnet-latest' },
    });

    // Ordinary settings update with empty geminiApiKey string
    const updateRes = vault.applyChanges({
      geminiApiKey: '',
      geminiModel: 'gemini-3.1-flash-lite',
      openai: { enabled: true, modelId: 'gpt-4.1-mini' },
      anthropic: { enabled: true, modelId: 'claude-3-7-sonnet-latest' },
    });

    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.keyUpdated, false);
    assert.equal(updateRes.preservedExistingGeminiKey, true);
    assert.equal(updateRes.status.gemini.configured, true);
    assert.equal(updateRes.status.gemini.statusLabel, 'Gemini API Key — Configured');
    assert.equal(updateRes.status.gemini.configuredModel, 'gemini-3.1-flash-lite');
    assert.equal(updateRes.status.anthropic.enabled, true);
    assert.equal(vault.resolveEffectiveGeminiKey().apiKey, originalSecret);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('AiProviderCredentialVault supports Replace Key, Revoke Key (including env suppression), and strict model/key validation', () => {
  const tempDir = createTempDataDir();
  try {
    const envFallbackKey = 'AIzaSyServerEnvFallbackKey000011112222';
    const replacedKey = 'AIzaSyReplacedVaultKey999988887777';
    const vault = new AiProviderCredentialVault(tempDir, () => ({
      GEMINI_API_KEY: envFallbackKey,
    }));

    // Initially resolves server env fallback cleanly
    assert.equal(vault.getPublicStatus().gemini.configured, true);
    assert.equal(vault.getPublicStatus().gemini.source, 'SERVER_ENV');
    assert.equal(vault.resolveEffectiveGeminiKey().apiKey, envFallbackKey);

    // Replace Key overrides env fallback cleanly in encrypted store
    const replaceRes = vault.replaceGeminiKey(replacedKey);
    assert.equal(replaceRes.ok, true);
    assert.equal(replaceRes.code, 'GEMINI_KEY_REPLACED');
    assert.equal(replaceRes.status.gemini.source, 'BACKEND_ENCRYPTED_STORE');
    assert.equal(vault.resolveEffectiveGeminiKey().apiKey, replacedKey);

    // Revoke Key removes stored key AND suppresses env fallback persistently across restart
    const revokeRes = vault.revokeGeminiKey();
    assert.equal(revokeRes.ok, true);
    assert.equal(revokeRes.code, 'GEMINI_KEY_REVOKED');
    assert.equal(revokeRes.status.gemini.configured, false);
    assert.equal(revokeRes.status.gemini.statusLabel, 'Gemini API Key — Not Configured');
    assert.equal(vault.resolveEffectiveGeminiKey().apiKey, null);

    const afterRestart = new AiProviderCredentialVault(tempDir, () => ({
      GEMINI_API_KEY: envFallbackKey,
    }));
    assert.equal(afterRestart.getPublicStatus().gemini.configured, false);
    assert.equal(afterRestart.resolveEffectiveGeminiKey().apiKey, null);

    // Validation guards
    assert.equal(validateSubmittedApiKey('MY_GEMINI_API_KEY', 'Gemini').ok, false);
    assert.equal(validateSubmittedApiKey('short', 'Gemini').ok, false);
    assert.equal(validateSubmittedApiKey('AIzaSyWith SpaceInside1234', 'Gemini').ok, false);
    assert.equal(isValidGeminiCommandModel('gemini-4-hydrogen'), true);
    assert.equal(isValidGeminiCommandModel('gemini-3.1-flash-lite'), true);
    assert.equal(isValidGeminiCommandModel('gemini-1.5-flash'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
