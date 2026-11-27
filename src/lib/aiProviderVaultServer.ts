import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type AllowedGeminiCommandModel = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';

export const ALLOWED_GEMINI_COMMAND_MODELS: readonly AllowedGeminiCommandModel[] = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

export const DEFAULT_GEMINI_COMMAND_MODEL: AllowedGeminiCommandModel = 'gemini-4-hydrogen';

export type GeminiCredentialSource = 'BACKEND_ENCRYPTED_STORE' | 'SERVER_ENV' | 'NONE';

export interface GeminiConnectionTestSummary {
  readonly ok: boolean;
  readonly httpStatus: number;
  readonly code: string;
  readonly errorCategory: string;
  readonly model: AllowedGeminiCommandModel;
  readonly message: string;
  readonly testedAtIso: string;
}

export interface OpenAiProviderConfig {
  readonly enabled: boolean;
  readonly modelId: string;
  readonly baseUrl: string;
  readonly updatedAtIso: string | null;
}

export interface AnthropicProviderConfig {
  readonly enabled: boolean;
  readonly modelId: string;
  readonly updatedAtIso: string | null;
}

export interface PublicAiProvidersStatus {
  readonly storageEngine: 'AES_256_GCM_BACKEND_VAULT';
  readonly gemini: {
    readonly configured: boolean;
    readonly statusLabel: 'Gemini API Key — Configured' | 'Gemini API Key — Not Configured';
    readonly source: GeminiCredentialSource;
    readonly hasStoredSecret: boolean;
    readonly hasServerEnvFallback: boolean;
    readonly envOverrideRevoked: boolean;
    readonly configuredModel: AllowedGeminiCommandModel;
    readonly allowedModels: readonly AllowedGeminiCommandModel[];
    readonly updatedAtIso: string | null;
    readonly lastTestedAtIso: string | null;
    readonly lastTestResult: GeminiConnectionTestSummary | null;
  };
  readonly openai: {
    readonly configured: boolean;
    readonly statusLabel: 'OpenAI API Key — Configured' | 'OpenAI API Key — Not Configured';
    readonly source: GeminiCredentialSource;
    readonly enabled: boolean;
    readonly modelId: string;
    readonly baseUrl: string;
    readonly updatedAtIso: string | null;
  };
  readonly anthropic: {
    readonly configured: boolean;
    readonly statusLabel: 'Claude API Key — Configured' | 'Claude API Key — Not Configured';
    readonly source: GeminiCredentialSource;
    readonly enabled: boolean;
    readonly modelId: string;
    readonly updatedAtIso: string | null;
  };
}

interface EncryptedSecretBox {
  readonly v: 1;
  readonly alg: 'aes-256-gcm';
  readonly ivB64: string;
  readonly tagB64: string;
  readonly ctB64: string;
}

interface PersistedVaultDocument {
  readonly schemaVersion: 1;
  readonly gemini: {
    readonly encryptedApiKey: EncryptedSecretBox | null;
    readonly envOverrideRevoked: boolean;
    readonly configuredModel: AllowedGeminiCommandModel;
    readonly updatedAtIso: string | null;
    readonly lastTestedAtIso: string | null;
    readonly lastTestResult: GeminiConnectionTestSummary | null;
  };
  readonly openai: {
    readonly encryptedApiKey: EncryptedSecretBox | null;
    readonly envOverrideRevoked: boolean;
    readonly enabled: boolean;
    readonly modelId: string;
    readonly baseUrl: string;
    readonly updatedAtIso: string | null;
  };
  readonly anthropic: {
    readonly encryptedApiKey: EncryptedSecretBox | null;
    readonly envOverrideRevoked: boolean;
    readonly enabled: boolean;
    readonly modelId: string;
    readonly updatedAtIso: string | null;
  };
}

export interface ApplyAiProvidersInput {
  readonly geminiApiKey?: string | null;
  readonly geminiModel?: string | null;
  readonly openai?: {
    readonly apiKey?: string | null;
    readonly enabled?: boolean;
    readonly modelId?: string | null;
    readonly baseUrl?: string | null;
  };
  readonly anthropic?: {
    readonly apiKey?: string | null;
    readonly enabled?: boolean;
    readonly modelId?: string | null;
  };
}

export interface VaultMutationResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly keyUpdated: boolean;
  readonly preservedExistingGeminiKey: boolean;
  readonly status: PublicAiProvidersStatus;
}

const PLACEHOLDER_KEYS = new Set([
  'MY_GEMINI_API_KEY',
  'YOUR_API_KEY',
  'REPLACE-ME',
  'REPLACE_ME',
  'TEST',
  'PLACEHOLDER',
  'NONE',
  'NULL',
]);

export function isValidGeminiCommandModel(value: unknown): value is AllowedGeminiCommandModel {
  return (
    typeof value === 'string' &&
    (ALLOWED_GEMINI_COMMAND_MODELS as readonly string[]).includes(value.trim())
  );
}

export function normalizeGeminiCommandModel(value: unknown): AllowedGeminiCommandModel {
  const raw = typeof value === 'string' ? value.trim() : '';
  return isValidGeminiCommandModel(raw) ? raw : DEFAULT_GEMINI_COMMAND_MODEL;
}

export function validateSubmittedApiKey(
  rawValue: unknown,
  providerLabel: string
): { readonly ok: boolean; readonly trimmed: string; readonly error: string | null } {
  if (typeof rawValue !== 'string') {
    return { ok: false, trimmed: '', error: `${providerLabel} API key must be a text string.` };
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { ok: false, trimmed: '', error: `${providerLabel} API key cannot be empty.` };
  }
  if (trimmed.length < 10 || trimmed.length > 512) {
    return {
      ok: false,
      trimmed: '',
      error: `${providerLabel} API key length looks invalid (expected 10–512 characters).`,
    };
  }
  if (/[\s\r\n\0]/.test(trimmed)) {
    return {
      ok: false,
      trimmed: '',
      error: `${providerLabel} API key must not contain spaces or line breaks.`,
    };
  }
  if (PLACEHOLDER_KEYS.has(trimmed.toUpperCase())) {
    return {
      ok: false,
      trimmed: '',
      error: `Placeholder value rejected. Enter a real ${providerLabel} API secret key.`,
    };
  }
  return { ok: true, trimmed, error: null };
}

function isUsableEnvSecret(raw: string | undefined): boolean {
  const trimmed = String(raw || '').trim();
  return trimmed.length >= 10 && !PLACEHOLDER_KEYS.has(trimmed.toUpperCase());
}

function sanitizeModelId(raw: unknown, fallback: string): string {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val) return fallback;
  return /^[a-zA-Z0-9._:/-]{2,80}$/.test(val) ? val : fallback;
}

function sanitizeBaseUrl(raw: unknown, fallback: string): string {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val) return fallback;
  try {
    const parsed = new URL(val);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fallback;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function createDefaultDocument(): PersistedVaultDocument {
  return {
    schemaVersion: 1,
    gemini: {
      encryptedApiKey: null,
      envOverrideRevoked: false,
      configuredModel: DEFAULT_GEMINI_COMMAND_MODEL,
      updatedAtIso: null,
      lastTestedAtIso: null,
      lastTestResult: null,
    },
    openai: {
      encryptedApiKey: null,
      envOverrideRevoked: false,
      enabled: false,
      modelId: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      updatedAtIso: null,
    },
    anthropic: {
      encryptedApiKey: null,
      envOverrideRevoked: false,
      enabled: false,
      modelId: 'claude-3-5-sonnet-latest',
      updatedAtIso: null,
    },
  };
}

/**
 * Encrypted server-side AI Provider Credential & Configuration Vault.
 *
 * Security invariants:
 * - Secrets are encrypted at rest with AES-256-GCM using a 256-bit backend master key
 *   stored with strict 0600 permissions inside the server data directory.
 * - Secrets are NEVER persisted in browser localStorage, NEVER logged, and NEVER returned
 *   in any status/public API response.
 * - Ordinary settings updates with an empty API key input NEVER overwrite an existing secret.
 */
export class AiProviderCredentialVault {
  private readonly dataDir: string;
  private readonly masterKeyPath: string;
  private readonly vaultFilePath: string;
  private readonly envSource: () => NodeJS.ProcessEnv;
  private masterKey: Buffer;
  private doc: PersistedVaultDocument;

  constructor(
    dataDir: string,
    envSource: () => NodeJS.ProcessEnv = () => process.env
  ) {
    this.dataDir = path.resolve(dataDir);
    this.masterKeyPath = path.join(this.dataDir, '.vault-master.key');
    this.vaultFilePath = path.join(this.dataDir, 'ai-provider-vault.enc.json');
    this.envSource = envSource;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.masterKey = this.loadOrCreateMasterKey();
    this.doc = this.loadPersistedDocument();
  }

  private loadOrCreateMasterKey(): Buffer {
    try {
      if (fs.existsSync(this.masterKeyPath)) {
        const raw = fs.readFileSync(this.masterKeyPath, 'utf8').trim();
        const decoded = Buffer.from(raw, 'hex');
        if (decoded.length === 32) {
          return decoded;
        }
      }
    } catch {
      // Fall through to regenerate master key cleanly if unreadable
    }
    const fresh = crypto.randomBytes(32);
    const tmpPath = `${this.masterKeyPath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpPath, fresh.toString('hex'), { mode: 0o600, encoding: 'utf8' });
    fs.renameSync(tmpPath, this.masterKeyPath);
    try {
      fs.chmodSync(this.masterKeyPath, 0o600);
    } catch {
      // ignore chmod failures on restricted filesystems
    }
    return fresh;
  }

  private encryptSecret(plaintext: string): EncryptedSecretBox {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: 1,
      alg: 'aes-256-gcm',
      ivB64: iv.toString('base64'),
      tagB64: tag.toString('base64'),
      ctB64: ciphertext.toString('base64'),
    };
  }

  private decryptSecret(box: EncryptedSecretBox | null | undefined): string | null {
    if (!box || box.v !== 1 || box.alg !== 'aes-256-gcm') return null;
    try {
      const iv = Buffer.from(box.ivB64, 'base64');
      const tag = Buffer.from(box.tagB64, 'base64');
      const ct = Buffer.from(box.ctB64, 'base64');
      if (iv.length !== 12 || tag.length !== 16 || ct.length === 0) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8').trim();
      return plain.length >= 10 ? plain : null;
    } catch {
      return null;
    }
  }

  private loadPersistedDocument(): PersistedVaultDocument {
    const defaults = createDefaultDocument();
    if (!fs.existsSync(this.vaultFilePath)) {
      return defaults;
    }
    try {
      const raw = fs.readFileSync(this.vaultFilePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedVaultDocument> | null;
      if (!parsed || typeof parsed !== 'object') return defaults;
      return {
        schemaVersion: 1,
        gemini: {
          encryptedApiKey: parsed.gemini?.encryptedApiKey ?? null,
          envOverrideRevoked: Boolean(parsed.gemini?.envOverrideRevoked),
          configuredModel: normalizeGeminiCommandModel(parsed.gemini?.configuredModel),
          updatedAtIso:
            typeof parsed.gemini?.updatedAtIso === 'string' ? parsed.gemini.updatedAtIso : null,
          lastTestedAtIso:
            typeof parsed.gemini?.lastTestedAtIso === 'string'
              ? parsed.gemini.lastTestedAtIso
              : null,
          lastTestResult:
            parsed.gemini?.lastTestResult && typeof parsed.gemini.lastTestResult === 'object'
              ? parsed.gemini.lastTestResult
              : null,
        },
        openai: {
          encryptedApiKey: parsed.openai?.encryptedApiKey ?? null,
          envOverrideRevoked: Boolean(parsed.openai?.envOverrideRevoked),
          enabled: Boolean(parsed.openai?.enabled),
          modelId: sanitizeModelId(parsed.openai?.modelId, defaults.openai.modelId),
          baseUrl: sanitizeBaseUrl(parsed.openai?.baseUrl, defaults.openai.baseUrl),
          updatedAtIso:
            typeof parsed.openai?.updatedAtIso === 'string' ? parsed.openai.updatedAtIso : null,
        },
        anthropic: {
          encryptedApiKey: parsed.anthropic?.encryptedApiKey ?? null,
          envOverrideRevoked: Boolean(parsed.anthropic?.envOverrideRevoked),
          enabled: Boolean(parsed.anthropic?.enabled),
          modelId: sanitizeModelId(parsed.anthropic?.modelId, defaults.anthropic.modelId),
          updatedAtIso:
            typeof parsed.anthropic?.updatedAtIso === 'string'
              ? parsed.anthropic.updatedAtIso
              : null,
        },
      };
    } catch {
      return defaults;
    }
  }

  private persistDocument(nextDoc: PersistedVaultDocument): void {
    this.doc = nextDoc;
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmpPath = `${this.vaultFilePath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpPath, JSON.stringify(nextDoc, null, 2), {
      mode: 0o600,
      encoding: 'utf8',
    });
    fs.renameSync(tmpPath, this.vaultFilePath);
    try {
      fs.chmodSync(this.vaultFilePath, 0o600);
    } catch {
      // ignore chmod failures on restricted filesystems
    }
  }

  private resolveEnvGeminiKey(): string | null {
    const raw = this.envSource().GEMINI_API_KEY;
    return isUsableEnvSecret(raw) ? String(raw).trim() : null;
  }

  private resolveEnvOpenAiKey(): string | null {
    const raw = this.envSource().OPENAI_COMPAT_API_KEY || this.envSource().OPENAI_API_KEY;
    return isUsableEnvSecret(raw) ? String(raw).trim() : null;
  }

  private resolveEnvAnthropicKey(): string | null {
    const raw = this.envSource().ANTHROPIC_API_KEY;
    return isUsableEnvSecret(raw) ? String(raw).trim() : null;
  }

  resolveEffectiveGeminiKey(): {
    readonly apiKey: string | null;
    readonly source: GeminiCredentialSource;
  } {
    const stored = this.decryptSecret(this.doc.gemini.encryptedApiKey);
    if (stored) {
      return { apiKey: stored, source: 'BACKEND_ENCRYPTED_STORE' };
    }
    if (!this.doc.gemini.envOverrideRevoked) {
      const envKey = this.resolveEnvGeminiKey();
      if (envKey) {
        return { apiKey: envKey, source: 'SERVER_ENV' };
      }
    }
    return { apiKey: null, source: 'NONE' };
  }

  hasEffectiveGeminiKey(): boolean {
    return this.resolveEffectiveGeminiKey().apiKey !== null;
  }

  hasEffectiveOpenAiKey(): boolean {
    if (this.decryptSecret(this.doc.openai.encryptedApiKey)) return true;
    return !this.doc.openai.envOverrideRevoked && this.resolveEnvOpenAiKey() !== null;
  }

  hasEffectiveAnthropicKey(): boolean {
    if (this.decryptSecret(this.doc.anthropic.encryptedApiKey)) return true;
    return !this.doc.anthropic.envOverrideRevoked && this.resolveEnvAnthropicKey() !== null;
  }

  getConfiguredGeminiModel(): AllowedGeminiCommandModel {
    return normalizeGeminiCommandModel(this.doc.gemini.configuredModel);
  }

  getPublicStatus(): PublicAiProvidersStatus {
    const geminiResolved = this.resolveEffectiveGeminiKey();
    const hasStoredGemini = this.decryptSecret(this.doc.gemini.encryptedApiKey) !== null;
    const hasEnvGemini = this.resolveEnvGeminiKey() !== null;

    const openaiStored = this.decryptSecret(this.doc.openai.encryptedApiKey) !== null;
    const openaiEnv = !this.doc.openai.envOverrideRevoked && this.resolveEnvOpenAiKey() !== null;
    const openaiSource: GeminiCredentialSource = openaiStored
      ? 'BACKEND_ENCRYPTED_STORE'
      : openaiEnv
      ? 'SERVER_ENV'
      : 'NONE';

    const anthropicStored = this.decryptSecret(this.doc.anthropic.encryptedApiKey) !== null;
    const anthropicEnv =
      !this.doc.anthropic.envOverrideRevoked && this.resolveEnvAnthropicKey() !== null;
    const anthropicSource: GeminiCredentialSource = anthropicStored
      ? 'BACKEND_ENCRYPTED_STORE'
      : anthropicEnv
      ? 'SERVER_ENV'
      : 'NONE';

    return {
      storageEngine: 'AES_256_GCM_BACKEND_VAULT',
      gemini: {
        configured: geminiResolved.apiKey !== null,
        statusLabel:
          geminiResolved.apiKey !== null
            ? 'Gemini API Key — Configured'
            : 'Gemini API Key — Not Configured',
        source: geminiResolved.source,
        hasStoredSecret: hasStoredGemini,
        hasServerEnvFallback: hasEnvGemini,
        envOverrideRevoked: this.doc.gemini.envOverrideRevoked,
        configuredModel: this.getConfiguredGeminiModel(),
        allowedModels: ALLOWED_GEMINI_COMMAND_MODELS,
        updatedAtIso: this.doc.gemini.updatedAtIso,
        lastTestedAtIso: this.doc.gemini.lastTestedAtIso,
        lastTestResult: this.doc.gemini.lastTestResult,
      },
      openai: {
        configured: openaiSource !== 'NONE',
        statusLabel:
          openaiSource !== 'NONE'
            ? 'OpenAI API Key — Configured'
            : 'OpenAI API Key — Not Configured',
        source: openaiSource,
        enabled: this.doc.openai.enabled,
        modelId: this.doc.openai.modelId,
        baseUrl: this.doc.openai.baseUrl,
        updatedAtIso: this.doc.openai.updatedAtIso,
      },
      anthropic: {
        configured: anthropicSource !== 'NONE',
        statusLabel:
          anthropicSource !== 'NONE'
            ? 'Claude API Key — Configured'
            : 'Claude API Key — Not Configured',
        source: anthropicSource,
        enabled: this.doc.anthropic.enabled,
        modelId: this.doc.anthropic.modelId,
        updatedAtIso: this.doc.anthropic.updatedAtIso,
      },
    };
  }

  /**
   * Applies provider configuration updates atomically.
   * CRITICAL INVARIANT: An empty or omitted API key string NEVER overwrites an existing secret.
   */
  applyChanges(input: ApplyAiProvidersInput): VaultMutationResult {
    const nowIso = new Date().toISOString();
    let nextGemini = { ...this.doc.gemini };
    let nextOpenAi = { ...this.doc.openai };
    let nextAnthropic = { ...this.doc.anthropic };

    let keyUpdated = false;
    let preservedExistingGeminiKey = false;

    const rawGeminiKey = typeof input.geminiApiKey === 'string' ? input.geminiApiKey.trim() : '';
    if (rawGeminiKey.length > 0) {
      const check = validateSubmittedApiKey(rawGeminiKey, 'Gemini');
      if (!check.ok) {
        return {
          ok: false,
          code: 'INVALID_GEMINI_API_KEY',
          message: check.error || 'Invalid Gemini API key format.',
          keyUpdated: false,
          preservedExistingGeminiKey: this.hasEffectiveGeminiKey(),
          status: this.getPublicStatus(),
        };
      }
      nextGemini = {
        ...nextGemini,
        encryptedApiKey: this.encryptSecret(check.trimmed),
        envOverrideRevoked: false,
        updatedAtIso: nowIso,
      };
      keyUpdated = true;
    } else if (this.hasEffectiveGeminiKey()) {
      // Never overwrite an existing secret with an empty input during ordinary settings updates
      preservedExistingGeminiKey = true;
    }

    if (input.geminiModel !== undefined && input.geminiModel !== null && String(input.geminiModel).trim() !== '') {
      if (!isValidGeminiCommandModel(input.geminiModel)) {
        return {
          ok: false,
          code: 'INVALID_GEMINI_MODEL',
          message: `Unsupported Gemini model ID. Allowed models: ${ALLOWED_GEMINI_COMMAND_MODELS.join(', ')}.`,
          keyUpdated: false,
          preservedExistingGeminiKey,
          status: this.getPublicStatus(),
        };
      }
      nextGemini = {
        ...nextGemini,
        configuredModel: input.geminiModel.trim() as AllowedGeminiCommandModel,
        updatedAtIso: nowIso,
      };
    }

    if (input.openai) {
      const rawOpenAiKey = typeof input.openai.apiKey === 'string' ? input.openai.apiKey.trim() : '';
      let openAiEncrypted = nextOpenAi.encryptedApiKey;
      let openAiRevoked = nextOpenAi.envOverrideRevoked;
      if (rawOpenAiKey.length > 0) {
        const check = validateSubmittedApiKey(rawOpenAiKey, 'OpenAI');
        if (!check.ok) {
          return {
            ok: false,
            code: 'INVALID_OPENAI_API_KEY',
            message: check.error || 'Invalid OpenAI API key format.',
            keyUpdated: false,
            preservedExistingGeminiKey,
            status: this.getPublicStatus(),
          };
        }
        openAiEncrypted = this.encryptSecret(check.trimmed);
        openAiRevoked = false;
      }
      nextOpenAi = {
        encryptedApiKey: openAiEncrypted,
        envOverrideRevoked: openAiRevoked,
        enabled:
          typeof input.openai.enabled === 'boolean' ? input.openai.enabled : nextOpenAi.enabled,
        modelId: sanitizeModelId(input.openai.modelId, nextOpenAi.modelId),
        baseUrl: sanitizeBaseUrl(input.openai.baseUrl, nextOpenAi.baseUrl),
        updatedAtIso: nowIso,
      };
    }

    if (input.anthropic) {
      const rawAnthropicKey =
        typeof input.anthropic.apiKey === 'string' ? input.anthropic.apiKey.trim() : '';
      let anthropicEncrypted = nextAnthropic.encryptedApiKey;
      let anthropicRevoked = nextAnthropic.envOverrideRevoked;
      if (rawAnthropicKey.length > 0) {
        const check = validateSubmittedApiKey(rawAnthropicKey, 'Claude');
        if (!check.ok) {
          return {
            ok: false,
            code: 'INVALID_ANTHROPIC_API_KEY',
            message: check.error || 'Invalid Claude API key format.',
            keyUpdated: false,
            preservedExistingGeminiKey,
            status: this.getPublicStatus(),
          };
        }
        anthropicEncrypted = this.encryptSecret(check.trimmed);
        anthropicRevoked = false;
      }
      nextAnthropic = {
        encryptedApiKey: anthropicEncrypted,
        envOverrideRevoked: anthropicRevoked,
        enabled:
          typeof input.anthropic.enabled === 'boolean'
            ? input.anthropic.enabled
            : nextAnthropic.enabled,
        modelId: sanitizeModelId(input.anthropic.modelId, nextAnthropic.modelId),
        updatedAtIso: nowIso,
      };
    }

    this.persistDocument({
      schemaVersion: 1,
      gemini: nextGemini,
      openai: nextOpenAi,
      anthropic: nextAnthropic,
    });

    const status = this.getPublicStatus();
    return {
      ok: true,
      code: keyUpdated ? 'GEMINI_KEY_SAVED' : 'SETTINGS_SAVED',
      message: keyUpdated
        ? 'Gemini API Key saved securely in encrypted backend storage. Status will persist across browser reloads and server restarts.'
        : preservedExistingGeminiKey
        ? 'AI provider settings saved. Existing Gemini API Key was preserved untouched.'
        : 'AI provider settings saved cleanly.',
      keyUpdated,
      preservedExistingGeminiKey,
      status,
    };
  }

  replaceGeminiKey(newApiKey: string): VaultMutationResult {
    const check = validateSubmittedApiKey(newApiKey, 'Gemini');
    if (!check.ok) {
      return {
        ok: false,
        code: 'INVALID_GEMINI_API_KEY',
        message: check.error || 'Enter a valid Gemini API key to replace the existing credential.',
        keyUpdated: false,
        preservedExistingGeminiKey: this.hasEffectiveGeminiKey(),
        status: this.getPublicStatus(),
      };
    }
    const nowIso = new Date().toISOString();
    this.persistDocument({
      ...this.doc,
      gemini: {
        ...this.doc.gemini,
        encryptedApiKey: this.encryptSecret(check.trimmed),
        envOverrideRevoked: false,
        updatedAtIso: nowIso,
        lastTestResult: null,
      },
    });
    return {
      ok: true,
      code: 'GEMINI_KEY_REPLACED',
      message:
        'Gemini API Key replaced in encrypted backend storage. Run Test Connection to verify live access.',
      keyUpdated: true,
      preservedExistingGeminiKey: false,
      status: this.getPublicStatus(),
    };
  }

  revokeGeminiKey(): VaultMutationResult {
    const nowIso = new Date().toISOString();
    this.persistDocument({
      ...this.doc,
      gemini: {
        ...this.doc.gemini,
        encryptedApiKey: null,
        envOverrideRevoked: true,
        updatedAtIso: nowIso,
        lastTestResult: null,
      },
    });
    return {
      ok: true,
      code: 'GEMINI_KEY_REVOKED',
      message:
        'Gemini API Key revoked from Signal Forge backend storage. Gemini commands are disabled until a new key is saved.',
      keyUpdated: true,
      preservedExistingGeminiKey: false,
      status: this.getPublicStatus(),
    };
  }

  recordGeminiTestResult(result: GeminiConnectionTestSummary): PublicAiProvidersStatus {
    this.persistDocument({
      ...this.doc,
      gemini: {
        ...this.doc.gemini,
        lastTestedAtIso: result.testedAtIso,
        lastTestResult: result,
      },
    });
    return this.getPublicStatus();
  }
}

let sharedVaultInstance: AiProviderCredentialVault | null = null;

export function getSharedAiProviderVault(): AiProviderCredentialVault {
  if (!sharedVaultInstance) {
    sharedVaultInstance = new AiProviderCredentialVault(path.resolve(process.cwd(), '.data'));
  }
  return sharedVaultInstance;
}
