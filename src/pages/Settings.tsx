import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  ExternalLink,
  FileBarChart2,
  Mail,
  MessageSquare,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react';
import { AiProviderCredentialsPanel } from '../components/AiProviderCredentialsPanel';
import { CommandControlSettingsHub } from '../components/CommandControlSettingsHub';
import { CommandHubNotificationSettings } from '../components/CommandHubNotificationSettings';
import { AdminBusinessControlCenter } from '../components/AdminBusinessControlCenter';
import { ExchangeControlCenter } from '../components/ExchangeControlCenter';
import { MaintenanceManagementPanel } from '../components/MaintenanceManagementPanel';
import { OwnerConfigHealthPanel } from '../components/OwnerConfigHealthPanel';
import { ScreenshotAnalyzerBlueprintCard } from '../components/ScreenshotAnalyzerBlueprintCard';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import { resolveTelegramChannelUrl } from '../lib/platformArchitecture';
import { useTradingArchitectureStore } from '../store/useTradingArchitectureStore';
import type { OtpProviderReadiness } from '../lib/otpChallenge';
import type {
  DeliveryLifecycleCounters,
  NotificationTransportPolicy,
  ProviderConnectionHealthState,
  ProviderHealthSummary,
} from '../lib/notificationDeliveryConfig';

interface NotificationHealthResponse {
  ok: boolean;
  policy: NotificationTransportPolicy;
  counters: DeliveryLifecycleCounters;
  telegram: ProviderHealthSummary;
  makeWebhook: ProviderHealthSummary;
  discord: ProviderHealthSummary;
  advisories: string[];
}

function formatHealthLabel(state?: ProviderConnectionHealthState): string {
  switch (state) {
    case 'AUTHENTICATED':
      return 'AUTHENTICATED';
    case 'DELIVERY_ACCEPTED':
      return 'DELIVERY ACCEPTED';
    case 'CONFIGURED_NOT_VERIFIED':
      return 'CONFIGURED / NOT VERIFIED';
    case 'AUTH_FAILED':
      return 'AUTH FAILED';
    case 'WEBHOOK_UNREACHABLE':
      return 'WEBHOOK UNREACHABLE';
    case 'DELIVERY_FAILED':
      return 'DELIVERY FAILED';
    case 'BLOCKED':
      return 'BLOCKED (CONFIG ERROR)';
    default:
      return 'UNCONFIGURED';
  }
}

function getHealthToneClass(state?: ProviderConnectionHealthState): string {
  switch (state) {
    case 'AUTHENTICATED':
    case 'DELIVERY_ACCEPTED':
      return 'text-emerald-400';
    case 'CONFIGURED_NOT_VERIFIED':
      return 'text-amber-300';
    case 'AUTH_FAILED':
    case 'WEBHOOK_UNREACHABLE':
    case 'DELIVERY_FAILED':
    case 'BLOCKED':
      return 'text-rose-400';
    default:
      return 'text-slate-400';
  }
}

type SettingsSectionTab =
  | 'COMMAND_HUB'
  | 'SECRETS_HEALTH'
  | 'BUSINESS_CONTROLS'
  | 'MAINTENANCE'
  | 'EXCHANGE_CONTROLS'
  | 'REPORTING'
  | 'SOCIAL_CHANNELS'
  | 'PERSONALIZATION';

const SETTINGS_TABS: readonly {
  id: SettingsSectionTab;
  label: string;
  testId: string;
}[] = [
  { id: 'COMMAND_HUB', label: 'Command Hub', testId: 'settings-tab-command' },
  { id: 'SECRETS_HEALTH', label: 'Secrets & Env', testId: 'settings-tab-secrets' },
  { id: 'BUSINESS_CONTROLS', label: 'Business & Offers', testId: 'settings-tab-business' },
  { id: 'MAINTENANCE', label: 'Safe Maintenance', testId: 'settings-tab-maintenance' },
  { id: 'EXCHANGE_CONTROLS', label: 'Exchange Controls', testId: 'settings-tab-exchanges' },
  { id: 'REPORTING', label: 'Reporting', testId: 'settings-tab-reporting' },
  { id: 'SOCIAL_CHANNELS', label: 'Social Channels', testId: 'settings-tab-social' },
  { id: 'PERSONALIZATION', label: 'Personalization', testId: 'settings-tab-personalization' },
];

export function Settings() {
  const { telegramHandle, telegramBotConfigured, digestStatus } = useApp();
  const executionMode = useTradingArchitectureStore((s) => s.executionMode);
  const setExecutionMode = useTradingArchitectureStore((s) => s.setExecutionMode);
  const indicatorSuite = useTradingArchitectureStore((s) => s.indicatorSuite);
  const updateIndicatorSuite = useTradingArchitectureStore((s) => s.updateIndicatorSuite);

  const [activeTab, setActiveTab] = useState<SettingsSectionTab>('COMMAND_HUB');
  const [otpProvider, setOtpProvider] = useState<OtpProviderReadiness | null>(null);
  const [notifHealth, setNotifHealth] = useState<NotificationHealthResponse | null>(null);

  useEffect(() => {
    fetch('/api/security/live-otp/status')
      .then((res) => res.json())
      .then((data) => {
        if (data?.provider) setOtpProvider(data.provider);
      })
      .catch(() => undefined);

    apiFetch('/api/notifications/health', { method: 'GET' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.ok) setNotifHealth(data as NotificationHealthResponse);
      })
      .catch(() => undefined);
  }, []);

  const telegramChannelUrl = resolveTelegramChannelUrl(telegramHandle);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-800/80 pb-5">
        <div className="space-y-1.5">
          <div className="font-mono text-xs text-cyan-400">
            Settings · Modular Platform Configuration
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
            System Settings, Exchange Controls &amp; Channel Architecture
          </h1>
          <p className="max-w-3xl text-sm text-slate-400">
            Orchestrate active modules, exchange safety gates, automated reporting channels, social broadcasts, and workspace personalization in cleanly separated desks.
          </p>
        </div>

        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-800 bg-[#0d1526] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-500/50 hover:text-white transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Dashboard</span>
        </Link>
      </div>

      {/* Clean Section Tabs (Reporting, Social Channels, Personalization, Exchange Controls, Command Hub) */}
      <nav
        aria-label="Settings Sections"
        className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 pb-3"
      >
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={tab.testId}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-[#3b82f6] bg-[#3b82f6]/15 text-white'
                : 'border-slate-800 bg-[#0d1323] text-slate-400 hover:border-slate-700 hover:text-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'COMMAND_HUB' && (
        <div className="space-y-6">
          <OwnerConfigHealthPanel />
          <AiProviderCredentialsPanel />
          <CommandHubNotificationSettings />
          <MaintenanceManagementPanel />
          <CommandControlSettingsHub />
        </div>
      )}

      {activeTab === 'SECRETS_HEALTH' && <OwnerConfigHealthPanel />}

      {activeTab === 'BUSINESS_CONTROLS' && <AdminBusinessControlCenter />}

      {activeTab === 'MAINTENANCE' && <MaintenanceManagementPanel />}

      {activeTab === 'EXCHANGE_CONTROLS' && <ExchangeControlCenter />}

      {activeTab === 'REPORTING' && (
        <section
          data-testid="settings-reporting-section"
          className="rounded-xl border border-slate-800 bg-[#111827] overflow-hidden"
        >
          <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-xs text-blue-400">Reporting &amp; Delivery Architecture</div>
              <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                <FileBarChart2 className="h-5 w-5 text-blue-400" aria-hidden="true" />
                <span>Automated Digests, Performance Reports &amp; Delivery Status</span>
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/auto-reports"
                className="rounded-lg border border-slate-700 bg-[#111827] px-3 py-1.5 text-xs font-semibold text-white hover:border-blue-500 transition-colors whitespace-nowrap"
              >
                Open Auto-Reports &rarr;
              </Link>
              <Link
                to="/alerts"
                className="rounded-lg border border-slate-700 bg-[#111827] px-3 py-1.5 text-xs font-semibold text-white hover:border-blue-500 transition-colors whitespace-nowrap"
              >
                Open Price Alerts &rarr;
              </Link>
            </div>
          </div>

          <div className="p-5 grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
            <article className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-white">
                <Mail className="h-4 w-4 text-blue-400" aria-hidden="true" />
                <span>Email Provider Readiness (Resend)</span>
              </div>
              <div
                className={`font-mono font-semibold ${
                  otpProvider?.resendApiKeyConfigured ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {otpProvider?.resendApiKeyConfigured
                  ? otpProvider.customVerifiedSenderConfigured
                    ? 'CONFIGURED · VERIFIED DOMAIN'
                    : 'CONFIGURED · SANDBOX SENDER'
                  : 'NOT CONFIGURED (RESEND_API_KEY MISSING)'}
              </div>
              <p className="text-slate-400 leading-relaxed">
                {otpProvider?.advisory ||
                  'Checking server-side Resend provider configuration...'}
              </p>
            </article>

            <article className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-white">
                <Bell className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                <span>3-Hour Signal Email Digest</span>
              </div>
              <div className="font-mono text-slate-200 tabular-nums">
                {digestStatus
                  ? `${digestStatus.pendingCount} pending · ${digestStatus.individualEmailsPrevented} emails saved`
                  : 'Strict 3H Batching Active'}
              </div>
              <p className="text-slate-400 leading-relaxed">
                High-confidence signal alerts batch cleanly into 3-hour digests to avoid duplicate email spam. Separate from Daily/Weekly/Monthly performance summaries.
              </p>
            </article>

            <article className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-white">
                <Zap className="h-4 w-4 text-amber-400" aria-hidden="true" />
                <span>Security &amp; Audit Separation</span>
              </div>
              <div className="font-mono text-emerald-400">ISOLATED CHANNELS</div>
              <p className="text-slate-400 leading-relaxed">
                Security OTP challenges are delivered strictly to the operator email and never broadcast to public Telegram channels.
              </p>
            </article>
          </div>
        </section>
      )}

      {activeTab === 'SOCIAL_CHANNELS' && (
        <section
          data-testid="settings-social-section"
          className="rounded-xl border border-slate-800 bg-[#111827] overflow-hidden"
        >
          <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4">
            <div className="font-mono text-xs text-blue-400">Social Channels &amp; Broadcast Endpoints</div>
            <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-400" aria-hidden="true" />
              <span>Telegram, WhatsApp &amp; Discord Channel Controls</span>
            </h2>
          </div>

          <div className="p-5 space-y-4 text-xs">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <article className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-white">Telegram Bot API</span>
                  <span
                    data-testid="telegram-health-state"
                    className={`font-mono font-semibold ${getHealthToneClass(notifHealth?.telegram.state)}`}
                  >
                    {notifHealth
                      ? formatHealthLabel(notifHealth.telegram.state)
                      : telegramBotConfigured
                      ? 'CONFIGURED / NOT VERIFIED'
                      : 'UNCONFIGURED'}
                  </span>
                </div>
                <p className="text-slate-400">
                  Handle: <span className="font-mono text-slate-200">{telegramHandle}</span>
                  {notifHealth?.telegram.botUsername ? (
                    <> · Bot <span className="font-mono text-emerald-300">{notifHealth.telegram.botUsername}</span></>
                  ) : null}
                </p>
                {notifHealth?.telegram.canonicalChannelStatus && (
                  <p className="font-mono text-[11px] text-slate-300">
                    TELEGRAM_CHAT_ID:{' '}
                    <span
                      className={
                        notifHealth.telegram.canonicalChannelStatus === 'CONFIGURED'
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                      }
                    >
                      {notifHealth.telegram.canonicalChannelStatus}
                    </span>
                  </p>
                )}
                {notifHealth?.telegram.lastSuccessDetail && (
                  <p className="font-mono text-[11px] text-emerald-400/90">
                    Ack: {notifHealth.telegram.lastSuccessDetail}
                  </p>
                )}
                {notifHealth?.telegram.lastFailureDetail && (
                  <p className="font-mono text-[11px] text-rose-400">
                    Last failure: {notifHealth.telegram.lastFailureDetail}
                  </p>
                )}
                <a
                  href={telegramChannelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-semibold"
                >
                  <span>Open {telegramChannelUrl}</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </article>

              <article className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-white">Make.com Relay</span>
                  <span
                    data-testid="make-health-state"
                    className={`font-mono font-semibold ${getHealthToneClass(notifHealth?.makeWebhook.state)}`}
                  >
                    {formatHealthLabel(notifHealth?.makeWebhook.state)}
                  </span>
                </div>
                <p className="text-slate-400">
                  Target: <span className="font-mono text-slate-200">{notifHealth?.makeWebhook.maskedTarget || 'Checking...'}</span>
                </p>
                <p className="text-slate-400">
                  Primary Telegram transport:{' '}
                  <span className="font-mono text-slate-200">
                    {notifHealth?.policy.telegramPrimaryTransport || 'MAKE_WEBHOOK'}
                  </span>
                  {' · '}Fallback:{' '}
                  <span className="font-mono text-slate-200">
                    {notifHealth?.policy.allowTelegramFallbackOnPrimaryFailure ? 'ENABLED' : 'OFF (NO DUPLICATES)'}
                  </span>
                </p>
                {notifHealth?.makeWebhook.lastSuccessDetail && (
                  <p className="font-mono text-[11px] text-emerald-400/90">
                    Ack: {notifHealth.makeWebhook.lastSuccessDetail}
                  </p>
                )}
                {notifHealth?.makeWebhook.lastFailureDetail && (
                  <p className="font-mono text-[11px] text-rose-400">
                    Last failure: {notifHealth.makeWebhook.lastFailureDetail}
                  </p>
                )}
              </article>

              <article className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-white">Discord Webhook</span>
                  <span
                    data-testid="discord-health-state"
                    className={`font-mono font-semibold ${getHealthToneClass(notifHealth?.discord.state)}`}
                  >
                    {formatHealthLabel(notifHealth?.discord.state)}
                  </span>
                </div>
                <p className="text-slate-400">
                  Endpoint: <span className="font-mono text-slate-200">{notifHealth?.discord.maskedTarget || 'Not configured'}</span>
                </p>
                <p className="text-slate-400">
                  Structured signal embeds (`?wait=true` message ID verification) isolated strictly server-side.
                </p>
                {notifHealth?.discord.lastSuccessDetail && (
                  <p className="font-mono text-[11px] text-emerald-400/90">
                    Ack: {notifHealth.discord.lastSuccessDetail}
                  </p>
                )}
                {notifHealth?.discord.lastFailureDetail && (
                  <p className="font-mono text-[11px] text-rose-400">
                    Last failure: {notifHealth.discord.lastFailureDetail}
                  </p>
                )}
              </article>
            </div>

            {notifHealth && (
              <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-white">
                    Persistent Delivery Lifecycle Counters (SQLite Ledger)
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Generated {notifHealth.counters.signalGenerated} · Approved {notifHealth.counters.signalApproved} · Accepted {notifHealth.counters.providerAccepted} · Verified Delivered {notifHealth.counters.deliveredWhenVerifiable} · Retrying {notifHealth.counters.retrying} · Failed {notifHealth.counters.failed} · Suppressed {notifHealth.counters.suppressed}
                  </span>
                </div>
                {notifHealth.advisories.length > 0 && (
                  <div className="space-y-1 border-t border-slate-800/80 pt-2.5">
                    <div className="font-mono text-[11px] font-semibold text-amber-300">
                      Owner Configuration Advisories ({notifHealth.advisories.length})
                    </div>
                    {notifHealth.advisories.map((adv, idx) => (
                      <div key={idx} className="font-mono text-[11px] text-slate-300">
                        • {adv}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'PERSONALIZATION' && (
        <section
          data-testid="settings-personalization-section"
          className="rounded-xl border border-slate-800 bg-[#111827] overflow-hidden"
        >
          <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4">
            <div className="font-mono text-xs text-blue-400">Workspace Personalization</div>
            <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-400" aria-hidden="true" />
              <span>Chart Defaults &amp; Execution Autonomy Preferences</span>
            </h2>
          </div>

          <div className="p-5 grid grid-cols-1 gap-5 md:grid-cols-2 text-xs">
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-white">
                <SlidersHorizontal className="h-4 w-4 text-blue-400" aria-hidden="true" />
                <span>Default Smart Chart Overlays</span>
              </div>
              <div className="space-y-2">
                <label className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0a0e1a] px-3 py-2 cursor-pointer">
                  <span className="text-slate-200">Show EMA Ribbon ({indicatorSuite.emaFastPeriod}/{indicatorSuite.emaMidPeriod}/{indicatorSuite.emaSlowPeriod})</span>
                  <input
                    type="checkbox"
                    checked={indicatorSuite.showEmaRibbon}
                    onChange={(e) => updateIndicatorSuite({ showEmaRibbon: e.target.checked })}
                    className="accent-blue-500"
                  />
                </label>
                <label className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0a0e1a] px-3 py-2 cursor-pointer">
                  <span className="text-slate-200">Show SMC / FRVP Market Structure Levels</span>
                  <input
                    type="checkbox"
                    checked={indicatorSuite.showSmcOverlay}
                    onChange={(e) => updateIndicatorSuite({ showSmcOverlay: e.target.checked })}
                    className="accent-blue-500"
                  />
                </label>
                <label className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0a0e1a] px-3 py-2 cursor-pointer">
                  <span className="text-slate-200">Show Session VWAP Overlay</span>
                  <input
                    type="checkbox"
                    checked={indicatorSuite.showVwapOverlay}
                    onChange={(e) => updateIndicatorSuite({ showVwapOverlay: e.target.checked })}
                    className="accent-blue-500"
                  />
                </label>
                <label className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0a0e1a] px-3 py-2 cursor-pointer">
                  <span className="text-slate-200">Show Bollinger Bands (20, 2σ)</span>
                  <input
                    type="checkbox"
                    checked={indicatorSuite.showBollingerBands}
                    onChange={(e) => updateIndicatorSuite({ showBollingerBands: e.target.checked })}
                    className="accent-blue-500"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-3">
              <div className="font-semibold text-white">Coordinator Execution Autonomy</div>
              <p className="text-slate-400">
                Choose whether the AI Agent Coordinator runs fully autonomously in Paper/Demo mode or requires manual confirmation before routing orders.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setExecutionMode('FULLY_AUTONOMOUS')}
                  className={`rounded-lg border px-3 py-2.5 text-xs font-semibold cursor-pointer ${
                    executionMode === 'FULLY_AUTONOMOUS'
                      ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
                  }`}
                >
                  Fully Autonomous
                </button>
                <button
                  type="button"
                  onClick={() => setExecutionMode('SUPERVISED_MANUAL_OVERRIDE')}
                  className={`rounded-lg border px-3 py-2.5 text-xs font-semibold cursor-pointer ${
                    executionMode === 'SUPERVISED_MANUAL_OVERRIDE'
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
                  }`}
                >
                  Supervised Override
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'PERSONALIZATION' && <ScreenshotAnalyzerBlueprintCard />}
    </div>
  );
}
