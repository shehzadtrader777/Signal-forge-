import { memo, useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type {
  AllowedGeminiCommandModel,
  GeminiConnectionTestSummary,
  PublicAiProvidersStatus,
} from '../lib/aiProviderVaultServer';

interface ProvidersResponse {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly error?: string;
  readonly keyUpdated?: boolean;
  readonly preservedExistingGeminiKey?: boolean;
  readonly providers?: PublicAiProvidersStatus;
  readonly testResult?: GeminiConnectionTestSummary;
}

export const AiProviderCredentialsPanel = memo(function AiProviderCredentialsPanel() {
  const [providers, setProviders] = useState<PublicAiProvidersStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [replacing, setReplacing] = useState<boolean>(false);
  const [revoking, setRevoking] = useState<boolean>(false);

  // Secret inputs live strictly in ephemeral React state and are cleared immediately after save.
  // Secrets are NEVER written to localStorage or sessionStorage.
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>('');
  const [replaceModeOpen, setReplaceModeOpen] = useState<boolean>(false);
  const [replaceKeyInput, setReplaceKeyInput] = useState<string>('');
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState<boolean>(false);

  // Non-secret provider configuration fields
  const [geminiModel, setGeminiModel] = useState<AllowedGeminiCommandModel>('gemini-4-hydrogen');
  const [openAiEnabled, setOpenAiEnabled] = useState<boolean>(false);
  const [openAiModelId, setOpenAiModelId] = useState<string>('gpt-4o-mini');
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState<string>('https://api.openai.com/v1');
  const [openAiKeyInput, setOpenAiKeyInput] = useState<string>('');
  const [claudeEnabled, setClaudeEnabled] = useState<boolean>(false);
  const [claudeModelId, setClaudeModelId] = useState<string>('claude-3-5-sonnet-latest');
  const [claudeKeyInput, setClaudeKeyInput] = useState<string>('');

  const [feedback, setFeedback] = useState<{
    readonly tone: 'ok' | 'warn' | 'err';
    readonly text: string;
  } | null>(null);

  const hydrateFromStatus = useCallback((status: PublicAiProvidersStatus) => {
    setProviders(status);
    setGeminiModel(status.gemini.configuredModel);
    setOpenAiEnabled(status.openai.enabled);
    setOpenAiModelId(status.openai.modelId);
    setOpenAiBaseUrl(status.openai.baseUrl);
    setClaudeEnabled(status.anthropic.enabled);
    setClaudeModelId(status.anthropic.modelId);
  }, []);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/settings/ai-providers', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.status === 401 || res.status === 403) {
        setProviders(null);
        setFeedback({
          tone: 'warn',
          text: 'Sign in with your verified Owner Google account to view or update AI provider credential diagnostics.',
        });
        return;
      }
      if (!res.ok) {
        setFeedback({
          tone: 'err',
          text: `Failed to load AI provider credential status (HTTP ${res.status}).`,
        });
        return;
      }
      const data = (await res.json()) as ProvidersResponse;
      if (data.ok && data.providers) {
        hydrateFromStatus(data.providers);
      }
    } catch {
      setFeedback({
        tone: 'err',
        text: 'Network error while loading AI provider configuration status.',
      });
    } finally {
      setLoading(false);
    }
  }, [hydrateFromStatus]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const handleApplyChanges = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const payload: Record<string, unknown> = {
        geminiModel,
        openai: {
          enabled: openAiEnabled,
          modelId: openAiModelId.trim(),
          baseUrl: openAiBaseUrl.trim(),
          ...(openAiKeyInput.trim() ? { apiKey: openAiKeyInput.trim() } : {}),
        },
        anthropic: {
          enabled: claudeEnabled,
          modelId: claudeModelId.trim(),
          ...(claudeKeyInput.trim() ? { apiKey: claudeKeyInput.trim() } : {}),
        },
      };
      // Only include geminiApiKey when non-empty; server also enforces empty-value preservation
      if (geminiKeyInput.trim()) {
        payload.geminiApiKey = geminiKeyInput.trim();
      }

      const res = await apiFetch('/api/settings/ai-providers/apply', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ProvidersResponse;
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'err',
          text: data.error || `Failed to apply AI provider changes (HTTP ${res.status}).`,
        });
        return;
      }
      if (data.providers) {
        hydrateFromStatus(data.providers);
      }
      // Always clear raw secret inputs immediately after successful encrypted backend persistence
      setGeminiKeyInput('');
      setOpenAiKeyInput('');
      setClaudeKeyInput('');
      setConfirmRevokeOpen(false);
      setFeedback({
        tone: 'ok',
        text: data.message || 'AI provider settings saved in encrypted backend storage.',
      });
    } catch {
      setFeedback({
        tone: 'err',
        text: 'Network error while applying AI provider configuration.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReplaceGeminiKey = async () => {
    const trimmed = replaceKeyInput.trim();
    if (!trimmed) {
      setFeedback({
        tone: 'warn',
        text: 'Enter a new Gemini API Secret Key before confirming replacement.',
      });
      return;
    }
    setReplacing(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/settings/ai-providers/gemini/replace', {
        method: 'POST',
        body: JSON.stringify({ geminiApiKey: trimmed }),
      });
      const data = (await res.json()) as ProvidersResponse;
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'err',
          text: data.error || `Failed to replace Gemini API Key (HTTP ${res.status}).`,
        });
        return;
      }
      if (data.providers) {
        hydrateFromStatus(data.providers);
      }
      setReplaceKeyInput('');
      setReplaceModeOpen(false);
      setConfirmRevokeOpen(false);
      setFeedback({
        tone: 'ok',
        text: data.message || 'Gemini API Key replaced in encrypted backend storage.',
      });
    } catch {
      setFeedback({
        tone: 'err',
        text: 'Network error while replacing Gemini API Key.',
      });
    } finally {
      setReplacing(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/settings/ai-providers/gemini/test', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as ProvidersResponse;
      if (data.providers) {
        hydrateFromStatus(data.providers);
      }
      if (data.ok && data.testResult?.ok) {
        setFeedback({
          tone: 'ok',
          text: data.testResult.message,
        });
      } else {
        setFeedback({
          tone: data.testResult?.httpStatus === 429 ? 'warn' : 'err',
          text:
            data.testResult?.message ||
            data.error ||
            `Gemini connection test failed (HTTP ${res.status}).`,
        });
      }
    } catch {
      setFeedback({
        tone: 'err',
        text: 'Network error while testing Gemini connection.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleRevokeGeminiKey = async () => {
    setRevoking(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/settings/ai-providers/gemini/revoke', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as ProvidersResponse;
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'err',
          text: data.error || `Failed to revoke Gemini API Key (HTTP ${res.status}).`,
        });
        return;
      }
      if (data.providers) {
        hydrateFromStatus(data.providers);
      }
      setGeminiKeyInput('');
      setReplaceKeyInput('');
      setReplaceModeOpen(false);
      setConfirmRevokeOpen(false);
      setFeedback({
        tone: 'warn',
        text: data.message || 'Gemini API Key revoked from backend storage.',
      });
    } catch {
      setFeedback({
        tone: 'err',
        text: 'Network error while revoking Gemini API Key.',
      });
    } finally {
      setRevoking(false);
    }
  };

  const geminiConfigured = Boolean(providers?.gemini.configured);
  const geminiStatusLabel =
    providers?.gemini.statusLabel ??
    (loading ? 'Checking Gemini credential status...' : 'Gemini API Key — Not Configured');
  const lastTest = providers?.gemini.lastTestResult ?? null;

  return (
    <section
      data-testid="ai-provider-credentials-panel"
      aria-label="AI Provider Credentials and Gemini Persistence"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-wider text-cyan-400">
            Encrypted Backend Vault · Zero localStorage Secrets
          </div>
          <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />
            <span>AI Provider Credentials &amp; Gemini Configuration</span>
          </h2>
          <p className="text-xs text-slate-400 max-w-3xl">
            Gemini, OpenAI, and Claude configurations are persisted in AES-256-GCM encrypted server storage.
            Leaving an API key input blank during ordinary updates never overwrites an existing saved secret.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadProviders()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-500/60 hover:text-white transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh Status</span>
        </button>
      </div>

      <form onSubmit={(e) => void handleApplyChanges(e)} className="p-5 space-y-5">
        {feedback && (
          <div
            role={feedback.tone === 'err' ? 'alert' : 'status'}
            data-testid="ai-providers-feedback"
            className={`rounded-lg border px-3.5 py-2.5 text-xs flex items-start gap-2 ${
              feedback.tone === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : feedback.tone === 'warn'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            {feedback.tone === 'ok' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Primary Gemini Card */}
        <div className="rounded-xl border border-slate-800 bg-[#0d1323] p-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />
                <span className="font-display text-sm font-bold text-white">
                  Google Gemini (Primary Command Hub Engine)
                </span>
                <span
                  data-testid="gemini-key-status-badge"
                  data-configured={geminiConfigured ? 'true' : 'false'}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                    geminiConfigured
                      ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
                      : 'border-amber-500/45 bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {geminiConfigured ? (
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>{geminiStatusLabel}</span>
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-400">
                Storage Source:{' '}
                <span className="text-slate-200">
                  {providers?.gemini.source === 'BACKEND_ENCRYPTED_STORE'
                    ? 'Encrypted Backend Vault (.data/ai-provider-vault.enc.json)'
                    : providers?.gemini.source === 'SERVER_ENV'
                    ? 'Server Environment Variable (GEMINI_API_KEY)'
                    : 'Not Configured'}
                </span>
                {providers?.gemini.updatedAtIso ? (
                  <>
                    {' · '}Updated:{' '}
                    <span className="text-slate-300">
                      {new Date(providers.gemini.updatedAtIso).toLocaleString()}
                    </span>
                  </>
                ) : null}
              </div>
            </div>

            {/* Secure Key Operations */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="gemini-test-connection-btn"
                onClick={() => void handleTestConnection()}
                disabled={testing || saving || revoking}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/45 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>Test Connection</span>
              </button>

              <button
                type="button"
                data-testid="gemini-replace-key-toggle-btn"
                onClick={() => {
                  setReplaceModeOpen((prev) => !prev);
                  setConfirmRevokeOpen(false);
                }}
                disabled={saving || replacing || revoking}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-blue-500/60 hover:text-white transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Replace Key</span>
              </button>

              <button
                type="button"
                data-testid="gemini-revoke-key-toggle-btn"
                onClick={() => {
                  setConfirmRevokeOpen((prev) => !prev);
                  setReplaceModeOpen(false);
                }}
                disabled={!geminiConfigured || saving || replacing || revoking}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 transition-colors cursor-pointer disabled:opacity-45 whitespace-nowrap"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Revoke Key</span>
              </button>
            </div>
          </div>

          {/* Inline Replace Key Drawer */}
          {replaceModeOpen && (
            <div
              data-testid="gemini-replace-key-panel"
              className="rounded-lg border border-blue-500/40 bg-blue-950/25 p-3.5 space-y-2.5"
            >
              <div className="text-xs font-semibold text-blue-200">
                Replace Stored Gemini API Secret Key
              </div>
              <p className="text-[11px] text-slate-300">
                The new key is encrypted with AES-256-GCM on the server and never echoed back to the browser.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  data-testid="gemini-replace-key-input"
                  autoComplete="new-password"
                  value={replaceKeyInput}
                  onChange={(e) => setReplaceKeyInput(e.target.value)}
                  placeholder="Enter new Gemini API Secret Key..."
                  className="flex-1 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  data-testid="gemini-replace-key-confirm-btn"
                  onClick={() => void handleReplaceGeminiKey()}
                  disabled={replacing}
                  className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  {replacing ? 'Replacing...' : 'Confirm Replacement'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReplaceModeOpen(false);
                    setReplaceKeyInput('');
                  }}
                  className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Inline Revoke Key Confirmation */}
          {confirmRevokeOpen && (
            <div
              data-testid="gemini-revoke-confirm-panel"
              className="rounded-lg border border-rose-500/45 bg-rose-950/30 p-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="text-xs text-rose-100">
                <strong>Confirm Revocation:</strong> This deletes the encrypted Gemini API key from Signal Forge backend storage and disables live Gemini commands until a new key is configured. Local commands (&ldquo;hello&rdquo;, &ldquo;status&rdquo;) stay active.
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-testid="gemini-revoke-key-confirm-btn"
                  onClick={() => void handleRevokeGeminiKey()}
                  disabled={revoking}
                  className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  {revoking ? 'Revoking...' : 'Confirm Revoke'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRevokeOpen(false)}
                  className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Gemini Key + Model Controls */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="sf-gemini-api-key-input"
                className="block text-xs font-semibold text-slate-200"
              >
                Gemini API Secret Key {geminiConfigured ? '(Leave blank to preserve saved key)' : ''}
              </label>
              <input
                id="sf-gemini-api-key-input"
                data-testid="gemini-api-key-input"
                type="password"
                autoComplete="new-password"
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                placeholder={
                  geminiConfigured
                    ? 'Configured securely on server (hidden) — enter only to update'
                    : 'Paste Gemini API Secret Key...'
                }
                className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-xs text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-400">
                Secret value is never revealed after saving and never stored in browser localStorage.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="sf-gemini-model-select"
                className="block text-xs font-semibold text-slate-200"
              >
                Active Gemini Command Model (Automatic Fallback Disabled)
              </label>
              <select
                id="sf-gemini-model-select"
                data-testid="gemini-model-select"
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value as AllowedGeminiCommandModel)}
                className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
              >
                <option value="gemini-4-hydrogen">gemini-4-hydrogen (Default Verified Model)</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Low-Latency Verified Model)</option>
              </select>
              <p className="text-[11px] text-slate-400">
                Only the selected verified model is queried. Automatic switching to alternate AI providers or models is disabled.
              </p>
            </div>
          </div>

          {/* Latest Connection Test Summary */}
          {lastTest && (
            <div
              data-testid="gemini-last-test-result"
              className={`rounded-lg border px-3 py-2 font-mono text-[11px] flex flex-wrap items-center justify-between gap-2 ${
                lastTest.ok
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                  : 'border-amber-500/35 bg-amber-500/10 text-amber-200'
              }`}
            >
              <span>
                Last Test ({lastTest.model}): HTTP {lastTest.httpStatus} · {lastTest.code} — {lastTest.message}
              </span>
              <span className="text-slate-400">
                {new Date(lastTest.testedAtIso).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>

        {/* Preserved OpenAI & Claude Provider Configurations */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div
            data-testid="openai-provider-config-card"
            className="rounded-xl border border-slate-800 bg-[#0d1323] p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-white">OpenAI Provider Slot</span>
              <span
                data-testid="openai-status-label"
                className={`font-mono text-[11px] font-semibold ${
                  providers?.openai.configured ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {providers?.openai.statusLabel ?? 'OpenAI API Key — Not Configured'}
              </span>
            </div>
            <label className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0a0e1a] px-3 py-2 text-xs cursor-pointer">
              <span className="text-slate-200">Enable OpenAI-Compatible Connector</span>
              <input
                type="checkbox"
                data-testid="openai-enabled-checkbox"
                checked={openAiEnabled}
                onChange={(e) => setOpenAiEnabled(e.target.checked)}
                className="accent-blue-500"
              />
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                data-testid="openai-model-input"
                value={openAiModelId}
                onChange={(e) => setOpenAiModelId(e.target.value)}
                placeholder="Model ID (e.g. gpt-4o-mini)"
                className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
              />
              <input
                type="password"
                autoComplete="new-password"
                value={openAiKeyInput}
                onChange={(e) => setOpenAiKeyInput(e.target.value)}
                placeholder={
                  providers?.openai.configured
                    ? 'Key saved (leave blank to keep)'
                    : 'Optional OpenAI key...'
                }
                className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 font-mono text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <input
              type="url"
              data-testid="openai-baseurl-input"
              value={openAiBaseUrl}
              onChange={(e) => setOpenAiBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 font-mono text-xs text-slate-300 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div
            data-testid="claude-provider-config-card"
            className="rounded-xl border border-slate-800 bg-[#0d1323] p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-white">Anthropic Claude Slot</span>
              <span
                data-testid="claude-status-label"
                className={`font-mono text-[11px] font-semibold ${
                  providers?.anthropic.configured ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {providers?.anthropic.statusLabel ?? 'Claude API Key — Not Configured'}
              </span>
            </div>
            <label className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0a0e1a] px-3 py-2 text-xs cursor-pointer">
              <span className="text-slate-200">Enable Anthropic Claude Connector</span>
              <input
                type="checkbox"
                data-testid="claude-enabled-checkbox"
                checked={claudeEnabled}
                onChange={(e) => setClaudeEnabled(e.target.checked)}
                className="accent-blue-500"
              />
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                data-testid="claude-model-input"
                value={claudeModelId}
                onChange={(e) => setClaudeModelId(e.target.value)}
                placeholder="Model ID (e.g. claude-3-5-sonnet-latest)"
                className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
              />
              <input
                type="password"
                autoComplete="new-password"
                value={claudeKeyInput}
                onChange={(e) => setClaudeKeyInput(e.target.value)}
                placeholder={
                  providers?.anthropic.configured
                    ? 'Key saved (leave blank to keep)'
                    : 'Optional Claude key...'
                }
                className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 font-mono text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              OpenAI and Claude slots are preserved independently and never automatically triggered as fallback for Gemini.
            </p>
          </div>
        </div>

        {/* Apply Changes Footer */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-800/80 pt-4">
          <p className="text-[11px] text-slate-400">
            Clicking <strong className="text-slate-200">Apply Changes</strong> writes encrypted server storage atomically and preserves any existing secret when its input is left empty.
          </p>
          <button
            type="submit"
            data-testid="ai-providers-apply-changes-btn"
            disabled={saving || replacing || revoking}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{saving ? 'Applying Changes...' : 'Apply Changes'}</span>
          </button>
        </div>
      </form>
    </section>
  );
});
