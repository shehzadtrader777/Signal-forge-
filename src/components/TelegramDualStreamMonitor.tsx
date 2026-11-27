import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarClock,
  Cpu,
  Filter,
  RefreshCw,
  Send,
  ShieldCheck,
  Terminal,
  Webhook,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import {
  formatAlertPrice,
  type TelegramDualStreamStatus,
} from '../lib/telegramStreams';
import type {
  ProcessedSignalRecord,
  SignalProcessorStatusSnapshot,
  TpMilestone,
} from '../lib/signalProcessor';

type MonitorTab = 'SIGNAL_PROCESSOR' | 'PUBLIC_SIGNALS' | 'DEVELOPER_AUDITS' | 'WEBHOOK_SCHEDULE';

const SAMPLE_MANUAL_ALERT =
  'LONG BTC/USDT 4h Entry: $92,450 TP1: $95,500 TP2: $98,800 TP3: $101,695 SL: $90,601 Confidence: 91%';

export const TelegramDualStreamMonitor = memo(function TelegramDualStreamMonitor() {
  const { selectedSymbol, tickers, allKnownCoins, appLiveEnabled, signalTimeframe, refreshTelegramFeed } =
    useApp();

  const [activeTab, setActiveTab] = useState<MonitorTab>('SIGNAL_PROCESSOR');
  const [status, setStatus] = useState<TelegramDualStreamStatus | null>(null);
  const [processorStatus, setProcessorStatus] = useState<SignalProcessorStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Automated / Manual Signal Processor state
  const [rawAlertInput, setRawAlertInput] = useState<string>(SAMPLE_MANUAL_ALERT);
  const [expandedSignalId, setExpandedSignalId] = useState<string | null>(null);

  // Quick Stream 1 structured signal dispatch form
  const [signalPair, setSignalPair] = useState<string>(selectedSymbol || 'BTCUSDT');
  const [signalDirection, setSignalDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [signalConfidence, setSignalConfidence] = useState<number>(89);

  // Stream 2 schedule & developer chat binding form
  const [devChatInput, setDevChatInput] = useState('');
  const [scheduledUtcHour, setScheduledUtcHour] = useState<number>(0);
  const [dailyEnabled, setDailyEnabled] = useState<boolean>(true);
  const [webhookUrlInput, setWebhookUrlInput] = useState<string>('');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedSymbol) setSignalPair(selectedSymbol);
  }, [selectedSymbol]);

  const fetchStreamStatus = useCallback(async () => {
    try {
      const [tgRes, procRes] = await Promise.all([
        fetch('/api/telegram/streams/status'),
        fetch('/api/signal-processor/status'),
      ]);
      if (tgRes.ok) {
        const data = (await tgRes.json()) as TelegramDualStreamStatus;
        if (data?.ok) {
          setStatus(data);
          setScheduledUtcHour(data.developerAudit.dailyScheduledUtcHour);
          setDailyEnabled(data.developerAudit.dailyAutoDeliveryEnabled);
          if (data.webhook.configuredUrl) {
            setWebhookUrlInput((prev) => prev || data.webhook.configuredUrl || '');
          }
        }
      }
      if (procRes.ok) {
        const procData = (await procRes.json()) as SignalProcessorStatusSnapshot;
        if (procData?.ok) {
          setProcessorStatus(procData);
        }
      }
    } catch {
      // keep previous snapshot on transient failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStreamStatus();
  }, [fetchStreamStatus]);

  useEffect(() => {
    if (!appLiveEnabled) return;
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchStreamStatus();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [appLiveEnabled, fetchStreamStatus]);

  const activePrice = useMemo(() => {
    const p = tickers[signalPair]?.price;
    if (p && Number.isFinite(p) && p > 0) return p;
    return 65000;
  }, [tickers, signalPair]);

  const computedSignalPreview = useMemo(() => {
    const riskDist = activePrice * 0.018;
    const stopLoss =
      signalDirection === 'BUY'
        ? Number((activePrice - riskDist).toFixed(4))
        : Number((activePrice + riskDist).toFixed(4));
    const exitPrice =
      signalDirection === 'BUY'
        ? Number((activePrice + riskDist * 5).toFixed(4))
        : Number((activePrice - riskDist * 5).toFixed(4));
    return { entryPrice: activePrice, exitPrice, stopLoss };
  }, [activePrice, signalDirection]);

  const handleDispatchPublicSignal = async () => {
    setBusyAction('dispatch-signal');
    setFeedback(null);
    try {
      const res = await apiFetch('/api/telegram/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: signalPair,
          direction: signalDirection,
          entryPrice: computedSignalPreview.entryPrice,
          exitPrice: computedSignalPreview.exitPrice,
          stopLoss: computedSignalPreview.stopLoss,
          confidence: signalConfidence,
          timeframe: signalTimeframe,
          rationale: 'Dashboard Oversight Dispatch (1:5 R:R Kernel Verified)',
          dedupeKey: `${signalPair}_${signalDirection}_manual_${Date.now()}`,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setFeedback({ ok: false, text: data?.error || 'Failed to dispatch Signal Forge alert.' });
        return;
      }
      if (data.status) setStatus(data.status as TelegramDualStreamStatus);
      if (data.processorStatus) {
        setProcessorStatus(data.processorStatus as SignalProcessorStatusSnapshot);
      }
      await refreshTelegramFeed();
      if (data.filtered) {
        setFeedback({
          ok: false,
          text: `Spam Filter Active (${data.spamVerdict?.reasonCode || 'DUPLICATE'}): ${data.spamVerdict?.reason || 'Discarded repetitive alert.'}`,
        });
        return;
      }
      const webhookOk = Boolean(data.processedSignal?.webhookDispatched);
      const delivered = Boolean(data.delivered || data.providerAccepted);
      setFeedback({
        ok: delivered,
        text: data.suppressed
          ? `Signal recorded locally (suppressed): ${data.deliveryError || 'Public Signal Gate withheld external dispatch.'}`
          : webhookOk
          ? `Accepted by Make.com Webhook for channel ${status?.publicChannel.chatId || 'Unconfigured'} (HTTP ${data.processedSignal?.webhookHttpStatus}).`
          : delivered
          ? `Delivered ${signalPair} ${signalDirection} alert to channel ${status?.publicChannel.chatId || 'Unconfigured'}.`
          : `Delivery failed for ${signalPair} ${signalDirection}: ${data.deliveryError || data.structuredSignal?.errorDetail || 'Provider rejected request.'}`,
      });
    } catch {
      setFeedback({ ok: false, text: 'Network error dispatching structured signal alert.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleProcessIncomingAlert = async (mode: 'PROCESS' | 'SPAM_TEST') => {
    const trimmed = rawAlertInput.trim();
    if (!trimmed) {
      setFeedback({ ok: false, text: 'Enter an incoming trading alert string before processing.' });
      return;
    }
    setBusyAction(mode === 'SPAM_TEST' ? 'spam-test' : 'process-alert');
    setFeedback(null);
    try {
      const res = await apiFetch('/api/signal-processor/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'MANUAL',
          rawAlertText: trimmed,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setFeedback({ ok: false, text: data?.error || 'Failed to process trading alert.' });
        return;
      }
      if (data.processorStatus) {
        setProcessorStatus(data.processorStatus as SignalProcessorStatusSnapshot);
      }
      if (data.telegramStatus) {
        setStatus(data.telegramStatus as TelegramDualStreamStatus);
      }
      await refreshTelegramFeed();

      const rec = data.record as ProcessedSignalRecord;
      if (data.filtered) {
        setFeedback({
          ok: true,
          text: `Spam Filter Blocked [${rec.spamVerdict.reasonCode}]: ${rec.spamVerdict.reason}`,
        });
      } else {
        const accepted = Boolean(data.delivered || data.providerAccepted);
        setFeedback({
          ok: accepted,
          text: data.suppressed
            ? `Formatted ${rec.symbol} ${rec.direction} card locally (suppressed): ${rec.suppressionReason || rec.webhookError || 'Gate locked.'}`
            : accepted
            ? `Accepted ${rec.symbol} ${rec.direction} signal card (${rec.deliveryState || 'PROVIDER_ACCEPTED'}${rec.webhookHttpStatus ? ` · HTTP ${rec.webhookHttpStatus}` : ''}) → ${rec.targetChatId}.`
            : `Delivery failed for ${rec.symbol} ${rec.direction}: ${rec.webhookError || 'Provider did not accept payload.'}`,
        });
      }
    } catch {
      setFeedback({ ok: false, text: 'Network error processing trading alert.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTransmitMilestone = async (
    rec: ProcessedSignalRecord,
    targetMilestone: TpMilestone
  ) => {
    setBusyAction(`milestone-${rec.signalId}-${targetMilestone}`);
    setFeedback(null);
    const ordered: TpMilestone[] =
      targetMilestone === 'TP3'
        ? ['TP1', 'TP2', 'TP3']
        : targetMilestone === 'TP2'
        ? ['TP1', 'TP2']
        : ['TP1'];
    const targetPrice =
      targetMilestone === 'TP3'
        ? rec.takeProfits[2]
        : targetMilestone === 'TP2'
        ? rec.takeProfits[1]
        : rec.takeProfits[0];
    const pctMove =
      rec.entryPrice > 0
        ? Number(
            (
              ((rec.direction === 'BUY' ? targetPrice - rec.entryPrice : rec.entryPrice - targetPrice) /
                rec.entryPrice) *
              100
            ).toFixed(2)
          )
        : 0;
    const simulatedNotional = 10_000;
    const pnlUsd = Number(((simulatedNotional * pctMove) / 100).toFixed(2));
    const lifecycleStatus =
      targetMilestone === 'TP3'
        ? 'CLOSED_TP'
        : targetMilestone === 'TP2'
        ? 'TP2_HIT'
        : 'TP1_HIT';

    try {
      const res = await apiFetch('/api/signal-processor/milestone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signalId: rec.signalId,
          hitTpMilestones: ordered,
          finalPnlUsd: pnlUsd,
          finalPnlPercent: pctMove,
          lifecycleStatus,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setFeedback({ ok: false, text: data?.error || 'Failed to transmit milestone update.' });
        return;
      }
      if (data.processorStatus) {
        setProcessorStatus(data.processorStatus as SignalProcessorStatusSnapshot);
      }
      if (data.telegramStatus) {
        setStatus(data.telegramStatus as TelegramDualStreamStatus);
      }
      await refreshTelegramFeed();
      const updated = data.record as ProcessedSignalRecord;
      if (data.filtered) {
        setFeedback({
          ok: true,
          text: `Spam Filter Blocked Duplicate Milestone [${updated.spamVerdict.reasonCode}]: ${updated.spamVerdict.reason}`,
        });
      } else {
        const accepted = Boolean(data.delivered || data.providerAccepted);
        setFeedback({
          ok: accepted,
          text: data.suppressed
            ? `Recorded ${updated.symbol} ${ordered.join('+')} milestone locally (suppressed): ${updated.suppressionReason || 'Public gate locked.'}`
            : accepted
            ? `Delivered ${updated.symbol} ${ordered.join('+')} milestone (P&L ${pnlUsd >= 0 ? '+' : '-'}$${Math.abs(pnlUsd).toFixed(2)} / ${pctMove >= 0 ? '+' : ''}${pctMove.toFixed(2)}%) · ${updated.deliveryState || 'ACCEPTED'}.`
            : `Milestone delivery failed for ${updated.symbol}: ${updated.webhookError || 'Provider error.'}`,
        });
      }
    } catch {
      setFeedback({ ok: false, text: 'Network error transmitting TP milestone update.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDispatchAudit = async (kind: 'CONTINUOUS_AUDIT' | 'DAILY_DIGEST') => {
    setBusyAction(kind);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/telegram/audit/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setFeedback({ ok: false, text: data?.error || 'Failed to dispatch developer audit.' });
        return;
      }
      if (data.status) setStatus(data.status as TelegramDualStreamStatus);
      const delivered = Boolean(data.auditEntry?.deliveredViaBot);
      const label = kind === 'DAILY_DIGEST' ? 'Daily System Audit Report' : 'Live System Audit Snapshot';
      setFeedback({
        ok: true,
        text: delivered
          ? `${label} delivered to developer private Telegram account.`
          : `${label} logged locally (${data.auditEntry?.errorDetail || 'bind private chat ID for direct delivery'}).`,
      });
    } catch {
      setFeedback({ ok: false, text: 'Network error dispatching developer system audit.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveSchedule = async (overrideAutoDaily?: boolean) => {
    setBusyAction('save-schedule');
    setFeedback(null);
    const nextAuto = typeof overrideAutoDaily === 'boolean' ? overrideAutoDaily : dailyEnabled;
    try {
      const res = await apiFetch('/api/telegram/audit/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailyAutoDeliveryEnabled: nextAuto,
          dailyScheduledUtcHour: scheduledUtcHour,
          developerChatId: devChatInput.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setFeedback({ ok: false, text: data?.error || 'Could not update audit schedule.' });
        return;
      }
      if (data.status) setStatus(data.status as TelegramDualStreamStatus);
      setDailyEnabled(nextAuto);
      if (devChatInput.trim()) setDevChatInput('');
      setFeedback({
        ok: true,
        text: `Updated developer audit routing & daily delivery (${nextAuto ? `Active @ ${String(scheduledUtcHour).padStart(2, '0')}:00 UTC` : 'Paused'}).`,
      });
    } catch {
      setFeedback({ ok: false, text: 'Network error saving audit delivery schedule.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRegisterWebhook = async () => {
    setBusyAction('register-webhook');
    setFeedback(null);
    try {
      const res = await apiFetch('/api/telegram/webhook/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: webhookUrlInput.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.status) setStatus(data.status as TelegramDualStreamStatus);
      setFeedback({
        ok: Boolean(data?.ok),
        text: String(data?.description || 'Webhook registration completed.'),
      });
    } catch {
      setFeedback({ ok: false, text: 'Network error registering Telegram webhook.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCheckWebhookInfo = async () => {
    setBusyAction('webhook-info');
    setFeedback(null);
    try {
      const res = await fetch('/api/telegram/webhook/info');
      const data = await res.json().catch(() => null);
      if (data?.status) setStatus(data.status as TelegramDualStreamStatus);
      setFeedback({
        ok: Boolean(data?.ok),
        text: data?.ok
          ? `Telegram Webhook Info synced · Pending updates: ${data.webhookInfo?.pendingUpdateCount ?? 0}${data.webhookInfo?.url ? ` · URL active` : ' · No URL registered yet'}.`
          : String(data?.error || 'Could not query Telegram getWebhookInfo.'),
      });
    } catch {
      setFeedback({ ok: false, text: 'Network error checking Telegram webhook info.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestWebhookDrill = async () => {
    setBusyAction('webhook-drill');
    setFeedback(null);
    try {
      const res = await apiFetch('/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          update_id: Math.floor(Date.now() / 1000),
          message: {
            chat: { id: 900142857, type: 'private' },
            from: { username: 'signal_forge_dev' },
            text: '/audit',
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setFeedback({ ok: false, text: data?.error || 'Webhook verification drill failed.' });
        return;
      }
      if (data.status) setStatus(data.status as TelegramDualStreamStatus);
      setFeedback({
        ok: true,
        text: `Webhook update #${data.event?.updateId} processed: ${data.event?.actionTaken}.`,
      });
    } catch {
      setFeedback({ ok: false, text: 'Network error running webhook verification drill.' });
    } finally {
      setBusyAction(null);
    }
  };

  const health = status?.liveTelemetry.health;
  const latencies = status?.liveTelemetry.moduleLatencies ?? [];

  const healthTone =
    health?.overallStatus === 'OPTIMAL'
      ? 'text-emerald-400'
      : health?.overallStatus === 'SELF_HEALING'
      ? 'text-amber-300'
      : 'text-rose-400';

  return (
    <section
      aria-label="Telegram Dual-Stream & System Audit Oversight"
      data-testid="telegram-dual-stream-monitor"
      className="cyber-surface rounded-xl border overflow-hidden"
    >
      {/* Header Row */}
      <div className="flex flex-col gap-3 border-b border-slate-800/90 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Telegram Webhook &amp; Dual-Stream Router</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-300">
              Bot {status?.botHealthState || (status?.botConfigured ? 'CONFIGURED_NOT_VERIFIED' : 'UNCONFIGURED')}
              {status?.botUsername ? ` (${status.botUsername})` : ''}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-300">
              Channel {status?.publicChannel.chatId || 'Unconfigured'}
            </span>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-white tracking-tight">
            Dual-Stream Telegram Alerts &amp; Live System Audit Monitor
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleDispatchAudit('CONTINUOUS_AUDIT')}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <Activity className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span>{busyAction === 'CONTINUOUS_AUDIT' ? 'Capturing...' : 'Capture Audit'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleDispatchAudit('DAILY_DIGEST')}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{busyAction === 'DAILY_DIGEST' ? 'Sending...' : 'Send Daily Audit'}</span>
          </button>

          <button
            type="button"
            onClick={() => fetchStreamStatus()}
            aria-label="Refresh Telegram dual-stream telemetry"
            className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-[#0d1323] p-2 text-slate-300 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Live Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`border-b px-5 py-2.5 text-xs flex items-center justify-between gap-3 ${
            feedback.ok
              ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
              : 'border-amber-500/30 bg-amber-950/30 text-amber-200'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] font-semibold underline underline-offset-2 opacity-80 hover:opacity-100 cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 5-Column Real-Time Telemetry & Stream Summary Strip */}
      <div className="grid grid-cols-1 divide-y divide-slate-800/80 border-b border-slate-800/90 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
        <div className="px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Cpu className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <span>Real-Time CPU &amp; Memory</span>
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
            {health ? `${health.cpuUsagePct.toFixed(1)}%` : '--'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
            RSS {health ? `${health.memoryRssMb.toFixed(1)} MB` : '--'} · Load{' '}
            {health ? health.loadAvg1m.toFixed(2) : '--'}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <span>System Health</span>
          </div>
          <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${healthTone}`}>
            {health?.overallStatus || 'SYNCING'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
            Services {health ? `${health.activeServicesHealthy}/${health.totalServices}` : '--'} · Lag{' '}
            {health ? `${health.eventLoopLagMs.toFixed(2)}ms` : '--'}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Send className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <span>Stream 1 · Signal Forge</span>
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
            {status?.publicChannel.totalDispatched ?? 0} alerts
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums truncate">
            Public{' '}
            {(status?.publicChannel.handle || '@SignalForge').replace(/^https?:\/\/t\.me\//i, '@')}{' '}
            · {status?.publicChannel.deliveredCount ?? 0} live
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Terminal className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <span>Stream 2 · Developer Audit</span>
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
            {status?.developerAudit.totalAuditsLogged ?? 0} logs
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-400 truncate">
            Private: {status?.developerAudit.targetChatIdMasked || 'Unbound'}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <CalendarClock className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <span>Daily Auto-Delivery</span>
          </div>
          <div
            className={`mt-1 font-mono text-xl font-bold tabular-nums ${
              status?.developerAudit.dailyAutoDeliveryEnabled ? 'text-emerald-400' : 'text-amber-300'
            }`}
          >
            {status?.developerAudit.dailyAutoDeliveryEnabled
              ? `${String(status.developerAudit.dailyScheduledUtcHour).padStart(2, '0')}:00 UTC`
              : 'PAUSED'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
            Sent {status?.developerAudit.dailyReportsDispatchedTotal ?? 0} · Interval 24h
          </div>
        </div>
      </div>

      {/* Live Module Latency Strip */}
      <div className="border-b border-slate-800/90 bg-[#0d1323]/70 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <span className="text-xs font-semibold text-slate-200">
            Live Module Latencies &amp; Runtime Parameters
          </span>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            WS {health?.wsConnected ? 'Connected' : 'Fallback'} · Frame Age{' '}
            {health ? `${health.wsFrameAgeMs}ms` : '--'} · Auto-Heals {health?.autoHealCount ?? 0} ·
            Uptime {health ? `${Math.floor(health.uptimeSec / 60)}m ${health.uptimeSec % 60}s` : '--'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
          {latencies.map((mod) => {
            const statusColor =
              mod.status === 'OPTIMAL'
                ? 'text-emerald-400'
                : mod.status === 'DEGRADED'
                ? 'text-amber-300'
                : 'text-rose-400';
            return (
              <div key={mod.moduleId} className="min-w-0">
                <div className="text-[11px] text-slate-400 truncate">{mod.label}</div>
                <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
                  <span className="text-sm font-bold text-white">{mod.latencyMs}ms</span>
                  <span className={`text-[10px] font-semibold ${statusColor}`}>{mod.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Segmented View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/90 px-5 py-3">
        <div
          role="tablist"
          aria-label="Telegram Dual-Stream Views"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-[#0d1323] p-1 border border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'SIGNAL_PROCESSOR'}
            onClick={() => setActiveTab('SIGNAL_PROCESSOR')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'SIGNAL_PROCESSOR'
                ? 'bg-[#3b82f6] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Signal Processor &amp; Webhook ({processorStatus?.stats.totalTransmitted ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'PUBLIC_SIGNALS'}
            onClick={() => setActiveTab('PUBLIC_SIGNALS')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'PUBLIC_SIGNALS'
                ? 'bg-[#3b82f6] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Stream 1: Public Signals ({status?.publicSignals.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'DEVELOPER_AUDITS'}
            onClick={() => setActiveTab('DEVELOPER_AUDITS')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'DEVELOPER_AUDITS'
                ? 'bg-[#3b82f6] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Stream 2: Developer Audits ({status?.developerAuditLogs.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'WEBHOOK_SCHEDULE'}
            onClick={() => setActiveTab('WEBHOOK_SCHEDULE')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'WEBHOOK_SCHEDULE'
                ? 'bg-[#3b82f6] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Webhook &amp; Daily Schedule
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
          <Webhook className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
          <span>
            Relay: {processorStatus?.webhookConfigured ? processorStatus.maskedWebhookUrl : 'Unconfigured'} ·
            Filtered {processorStatus?.stats.totalSpamFiltered ?? 0}
          </span>
        </div>
      </div>

      {/* TAB 0: Automated Trading Signal Processor, Anti-Spam Filter & Make.com Webhook Relay */}
      {activeTab === 'SIGNAL_PROCESSOR' && (
        <div className="p-5 space-y-5" data-testid="signal-processor-panel">
          {/* Webhook Relay & Anti-Spam Metrics Strip */}
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-[#0d1323] px-4 py-3 lg:grid-cols-5">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400">Outbound Webhook Relay</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-slate-200 truncate">
                {processorStatus?.webhookConfigured ? processorStatus.maskedWebhookUrl : 'Not configured'}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400">Target Channel Chat ID</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-white tabular-nums">
                {processorStatus?.targetChatId || 'Unconfigured'}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400">Accepted / Delivered</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-white tabular-nums">
                <span className="text-emerald-400">
                  {(processorStatus?.lifecycleCounters?.providerAccepted ?? 0) +
                    (processorStatus?.lifecycleCounters?.deliveredWhenVerifiable ?? 0)}{' '}
                  accepted
                </span>{' '}
                ·{' '}
                <span className="text-rose-400">
                  {processorStatus?.lifecycleCounters?.failed ?? 0} failed
                </span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400">Suppressed / Spam Blocked</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-amber-300 tabular-nums">
                {processorStatus?.lifecycleCounters?.suppressed ?? 0} suppressed ·{' '}
                {processorStatus?.stats.totalSpamFiltered ?? 0} spam
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400">Generated / Retrying</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-blue-400 tabular-nums">
                {processorStatus?.lifecycleCounters?.signalGenerated ?? 0} gen ·{' '}
                {processorStatus?.lifecycleCounters?.retrying ?? 0} retrying
              </div>
            </div>
          </div>

          {/* Incoming Alert Parser (Automated & Manual) */}
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-white">
                  Automated &amp; Manual Signal Card Processor
                </h3>
                <p className="text-xs text-slate-400">
                  Extracts Entry Price, TP1/TP2/TP3, Stop Loss, Hit TP Milestones, and Final P&amp;L.
                  Strict anti-spam discards duplicate fingerprints (15m TTL) and near-instant repeats
                  (3m cooldown) while permitting genuine milestone updates.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const activeP = tickers[signalPair]?.price || 92450;
                  const sl = Number((activeP * 0.982).toFixed(2));
                  const tp1 = Number((activeP * 1.032).toFixed(2));
                  const tp2 = Number((activeP * 1.064).toFixed(2));
                  const tp3 = Number((activeP * 1.09).toFixed(2));
                  setRawAlertInput(
                    `LONG ${signalPair.replace('USDT', '/USDT')} ${signalTimeframe} Entry: $${activeP} TP1: $${tp1} TP2: $${tp2} TP3: $${tp3} SL: $${sl} Confidence: 91%`
                  );
                }}
                className="rounded-lg border border-slate-700 bg-[#111827] px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                Load Live {signalPair} Template
              </button>
            </div>

            <label htmlFor="signal-processor-raw-input" className="sr-only">
              Incoming trading alert text
            </label>
            <textarea
              id="signal-processor-raw-input"
              rows={2}
              value={rawAlertInput}
              onChange={(e) => setRawAlertInput(e.target.value)}
              placeholder="Paste manual or automated alert text, e.g. LONG ETH/USDT 4h Entry: $3,200 TP1: $3,320 TP2: $3,440 TP3: $3,560 SL: $3,140 Confidence: 90%"
              className="w-full rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-mono text-white placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-slate-400">
                Routing → Webhook {processorStatus?.maskedWebhookUrl || 'Not configured'} · Chat{' '}
                {processorStatus?.targetChatId || 'Unconfigured'}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleProcessIncomingAlert('SPAM_TEST')}
                  disabled={busyAction !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-semibold text-amber-300 hover:border-amber-400/60 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {busyAction === 'spam-test' ? 'Testing...' : 'Verify Spam Filter (Repeat)'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleProcessIncomingAlert('PROCESS')}
                  disabled={busyAction !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {busyAction === 'process-alert'
                      ? 'Transmitting...'
                      : 'Process & Transmit to Webhook'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Transmitted Structured Signal Cards & Milestone / Final P&L Controls */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                  <th className="py-2.5 pr-3">Time</th>
                  <th className="py-2.5 pr-3">Pair &amp; Side</th>
                  <th className="py-2.5 pr-3 text-right">Entry</th>
                  <th className="py-2.5 pr-3 text-right">TP1 / TP2 / TP3</th>
                  <th className="py-2.5 pr-3 text-right">Stop Loss</th>
                  <th className="py-2.5 pr-3">Hit TPs</th>
                  <th className="py-2.5 pr-3 text-right">Final P&amp;L</th>
                  <th className="py-2.5 pr-3 text-right">Webhook</th>
                  <th className="py-2.5 text-right">Transmit Milestone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {!processorStatus || processorStatus.recentProcessed.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-7 text-center text-slate-400">
                      No signal cards transmitted via webhook yet. Submit an alert above to format,
                      spam-check, and relay directly to Chat{' '}
                      {processorStatus?.targetChatId || 'Unconfigured'}.
                    </td>
                  </tr>
                ) : (
                  processorStatus.recentProcessed.map((rec) => {
                    const isExpanded = expandedSignalId === rec.signalId;
                    return (
                      <tr key={rec.signalId} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                          {new Date(rec.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 pr-3 font-mono whitespace-nowrap">
                          <span className="font-semibold text-white">{rec.symbol}</span>{' '}
                          <span
                            className={
                              rec.direction === 'BUY'
                                ? 'text-emerald-400 font-semibold'
                                : 'text-rose-400 font-semibold'
                            }
                          >
                            {rec.direction}
                          </span>
                          <span className="ml-1.5 text-[10px] text-slate-400">{rec.source}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono text-slate-200 tabular-nums whitespace-nowrap">
                          ${formatAlertPrice(rec.entryPrice)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono text-[11px] text-emerald-300 tabular-nums whitespace-nowrap">
                          ${formatAlertPrice(rec.takeProfits[0])} / $
                          {formatAlertPrice(rec.takeProfits[1])} / $
                          {formatAlertPrice(rec.takeProfits[2])}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono text-rose-300 tabular-nums whitespace-nowrap">
                          ${formatAlertPrice(rec.stopLoss)}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-[11px] text-blue-300 whitespace-nowrap">
                          {rec.hitTpMilestones.length > 0
                            ? rec.hitTpMilestones.join(' · ')
                            : 'Open'}
                        </td>
                        <td
                          className={`py-2.5 pr-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                            rec.finalPnlUsd === null && rec.finalPnlPercent === null
                              ? 'text-slate-400 font-normal'
                              : (rec.finalPnlUsd ?? rec.finalPnlPercent ?? 0) >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {rec.finalPnlUsd !== null
                            ? `${rec.finalPnlUsd >= 0 ? '+' : '-'}$${Math.abs(rec.finalPnlUsd).toFixed(2)}`
                            : ''}
                          {rec.finalPnlPercent !== null
                            ? `${rec.finalPnlUsd !== null ? ' ' : ''}(${rec.finalPnlPercent >= 0 ? '+' : ''}${rec.finalPnlPercent.toFixed(2)}%)`
                            : rec.finalPnlUsd === null
                            ? 'Pending'
                            : ''}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono text-[11px] whitespace-nowrap">
                          <span
                            className={
                              rec.webhookDispatched ? 'text-emerald-400 font-semibold' : 'text-amber-300'
                            }
                            title={rec.webhookError || undefined}
                          >
                            {rec.webhookDispatched
                              ? `HTTP ${rec.webhookHttpStatus ?? 200}`
                              : 'Queued'}
                          </span>
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {(['TP1', 'TP2', 'TP3'] as const).map((tp) => {
                              const alreadyHit = rec.hitTpMilestones.includes(tp);
                              return (
                                <button
                                  key={tp}
                                  type="button"
                                  disabled={busyAction !== null || alreadyHit}
                                  onClick={() => handleTransmitMilestone(rec, tp)}
                                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default ${
                                    alreadyHit
                                      ? 'border-emerald-500/40 text-emerald-400'
                                      : 'border-slate-700 bg-[#0d1323] text-slate-200 hover:border-[#3b82f6] hover:text-white'
                                  }`}
                                >
                                  {tp}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedSignalId(isExpanded ? null : rec.signalId)
                              }
                              className="ml-1 text-[11px] font-semibold text-[#3b82f6] hover:text-blue-400 cursor-pointer"
                            >
                              {isExpanded ? 'Hide' : 'Card'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {expandedSignalId && (
            <div className="rounded-lg border border-slate-800 bg-[#0a0e1a] p-4">
              {(() => {
                const selected = processorStatus?.recentProcessed.find(
                  (r) => r.signalId === expandedSignalId
                );
                if (!selected) return null;
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                      <span>
                        Signal Card Payload → Chat {selected.targetChatId} · Verdict:{' '}
                        {selected.spamVerdict.reasonCode}
                      </span>
                      <span>
                        Webhook: {selected.webhookDispatched ? `HTTP ${selected.webhookHttpStatus} (${selected.webhookLatencyMs}ms)` : selected.webhookError || 'Queued'}
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-200">
                      {selected.formattedCard}
                    </pre>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Strict Spam Filter Discarded Log */}
          {processorStatus && processorStatus.recentFiltered.length > 0 && (
            <div className="border-t border-slate-800/80 pt-3">
              <div className="flex items-center justify-between text-xs font-semibold text-amber-300 mb-2">
                <span>
                  Strict Spam Filter — Discarded Duplicate / Flood Alerts (
                  {processorStatus.recentFiltered.length})
                </span>
                <span className="font-mono text-[11px] font-normal text-slate-400">
                  15m Fingerprint TTL · 3m Pair Cooldown · 12/5m Flood Guard
                </span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {processorStatus.recentFiltered.slice(0, 8).map((rej) => (
                  <div
                    key={rej.signalId}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-1.5 text-[11px] font-mono"
                  >
                    <span className="text-slate-200">
                      {rej.symbol} {rej.direction} ·{' '}
                      <span className="text-amber-300">{rej.spamVerdict.reasonCode}</span>
                    </span>
                    <span className="text-slate-400">{rej.spamVerdict.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 1: Stream 1 — Public 'Signal Forge' Structured Trade Signal Alerts */}
      {activeTab === 'PUBLIC_SIGNALS' && (
        <div className="p-5 space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-[#0d1323] p-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end">
              <div>
                <label
                  htmlFor="tg-stream-pair"
                  className="block text-[11px] font-medium text-slate-400 mb-1"
                >
                  Trading Pair
                </label>
                <select
                  id="tg-stream-pair"
                  value={signalPair}
                  onChange={(e) => setSignalPair(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-mono text-white focus:border-[#3b82f6] focus:outline-none"
                >
                  {allKnownCoins.slice(0, 16).map((c) => (
                    <option key={c.symbol} value={c.symbol}>
                      {c.symbol}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="tg-stream-direction"
                  className="block text-[11px] font-medium text-slate-400 mb-1"
                >
                  Direction
                </label>
                <select
                  id="tg-stream-direction"
                  value={signalDirection}
                  onChange={(e) => setSignalDirection(e.target.value === 'SELL' ? 'SELL' : 'BUY')}
                  className="w-full rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-mono text-white focus:border-[#3b82f6] focus:outline-none"
                >
                  <option value="BUY">LONG / BUY</option>
                  <option value="SELL">SHORT / SELL</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="tg-stream-confidence"
                  className="block text-[11px] font-medium text-slate-400 mb-1"
                >
                  Confidence (%)
                </label>
                <input
                  id="tg-stream-confidence"
                  type="number"
                  min={50}
                  max={99}
                  value={signalConfidence}
                  onChange={(e) =>
                    setSignalConfidence(Math.max(50, Math.min(99, Number(e.target.value) || 85)))
                  }
                  className="w-24 rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-mono tabular-nums text-white focus:border-[#3b82f6] focus:outline-none"
                />
              </div>

              <div className="font-mono text-[11px] text-slate-300 tabular-nums leading-relaxed">
                <div>
                  Entry ${formatAlertPrice(computedSignalPreview.entryPrice)} · Exit $
                  {formatAlertPrice(computedSignalPreview.exitPrice)}
                </div>
                <div className="text-slate-400">
                  Stop Loss ${formatAlertPrice(computedSignalPreview.stopLoss)} · R:R 1:5
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDispatchPublicSignal}
              disabled={busyAction !== null}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {busyAction === 'dispatch-signal'
                  ? 'Dispatching...'
                  : 'Dispatch Signal Alert'}
              </span>
            </button>
          </div>

          {/* Public Signal Stream Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                  <th className="py-2.5 pr-4">Time</th>
                  <th className="py-2.5 pr-4">Trading Pair</th>
                  <th className="py-2.5 pr-4">Side</th>
                  <th className="py-2.5 pr-4 text-right">Entry Price</th>
                  <th className="py-2.5 pr-4 text-right">Exit Price (TP)</th>
                  <th className="py-2.5 pr-4 text-right">Stop Loss</th>
                  <th className="py-2.5 pr-4 text-right">Confidence</th>
                  <th className="py-2.5 text-right">Delivery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {!status || status.publicSignals.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      No structured trade signal alerts dispatched to Signal Forge yet. Use
                      &ldquo;Dispatch Signal Alert&rdquo; above or route any Coordinator signal to
                      broadcast immediately.
                    </td>
                  </tr>
                ) : (
                  status.publicSignals.map((sig) => (
                    <tr key={sig.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                        {new Date(sig.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5 pr-4 font-mono font-semibold text-white whitespace-nowrap">
                        {sig.symbol}
                        <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                          {sig.timeframe || '4h'}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 pr-4 font-mono font-semibold whitespace-nowrap ${
                          sig.direction === 'BUY'
                            ? 'text-emerald-400'
                            : sig.direction === 'SELL'
                            ? 'text-rose-400'
                            : 'text-blue-400'
                        }`}
                      >
                        {sig.direction}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-slate-200 tabular-nums whitespace-nowrap">
                        ${formatAlertPrice(sig.entryPrice)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-emerald-300 tabular-nums whitespace-nowrap">
                        ${formatAlertPrice(sig.exitPrice)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-rose-300 tabular-nums whitespace-nowrap">
                        ${formatAlertPrice(sig.stopLoss)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono font-semibold text-white tabular-nums whitespace-nowrap">
                        {sig.confidence}%
                        {sig.riskRewardRatio ? (
                          <span className="ml-1 text-[10px] font-normal text-slate-400">
                            1:{sig.riskRewardRatio}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 text-right font-mono text-[11px] whitespace-nowrap">
                        <span
                          className={
                            sig.deliveredViaBot ? 'text-emerald-400 font-semibold' : 'text-amber-300'
                          }
                          title={sig.errorDetail || undefined}
                        >
                          {sig.deliveredViaBot ? 'Telegram Live' : 'Stream Logged'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Stream 2 — Continuous Developer Private System Audit Logs */}
      {activeTab === 'DEVELOPER_AUDITS' && (
        <div className="p-5 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-slate-400">
            <span>
              Stream 2 isolates real-time CPU usage, module latencies, and system health strictly to
              the developer&apos;s private Telegram chat ({status?.developerAudit.targetChatIdMasked}).
            </span>
            <span className="font-mono text-slate-300 whitespace-nowrap">
              Next Daily Auto-Report:{' '}
              {status?.developerAudit.nextDailyReportUtcIso
                ? status.developerAudit.nextDailyReportUtcIso.replace('T', ' ').slice(0, 16) + ' UTC'
                : '--'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                  <th className="py-2.5 pr-4">Timestamp</th>
                  <th className="py-2.5 pr-4">Audit Type</th>
                  <th className="py-2.5 pr-4 text-right">CPU %</th>
                  <th className="py-2.5 pr-4 text-right">Memory RSS</th>
                  <th className="py-2.5 pr-4 text-right">Loop Lag</th>
                  <th className="py-2.5 pr-4 text-right">Peak Latency</th>
                  <th className="py-2.5 pr-4">Health</th>
                  <th className="py-2.5 text-right">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {!status || status.developerAuditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Capturing initial system audit snapshot...
                    </td>
                  </tr>
                ) : (
                  status.developerAuditLogs.map((entry) => {
                    const slowest = [...entry.moduleLatencies].sort(
                      (a, b) => b.latencyMs - a.latencyMs
                    )[0];
                    const isExpanded = expandedAuditId === entry.id;
                    return (
                      <tr key={entry.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                          {new Date(entry.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 pr-4 font-medium text-slate-200 whitespace-nowrap">
                          {entry.kind === 'DAILY_DIGEST'
                            ? 'Daily Audit Digest'
                            : entry.kind === 'WEBHOOK_COMMAND'
                            ? 'Webhook /audit Reply'
                            : 'Continuous Telemetry'}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono font-semibold text-white tabular-nums">
                          {entry.health.cpuUsagePct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-slate-300 tabular-nums">
                          {entry.health.memoryRssMb.toFixed(1)} MB
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-slate-300 tabular-nums">
                          {entry.health.eventLoopLagMs.toFixed(2)}ms
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                          {slowest ? `${slowest.latencyMs}ms (${slowest.label})` : '--'}
                        </td>
                        <td
                          className={`py-2.5 pr-4 font-mono font-semibold whitespace-nowrap ${
                            entry.health.overallStatus === 'OPTIMAL'
                              ? 'text-emerald-400'
                              : entry.health.overallStatus === 'SELF_HEALING'
                              ? 'text-amber-300'
                              : 'text-rose-400'
                          }`}
                        >
                          {entry.health.overallStatus}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedAuditId(isExpanded ? null : entry.id)
                            }
                            className="text-[11px] font-semibold text-[#3b82f6] hover:text-blue-400 cursor-pointer"
                          >
                            {isExpanded ? 'Hide Message' : 'Inspect Log'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {expandedAuditId && (
            <div className="rounded-lg border border-slate-800 bg-[#0a0e1a] p-4">
              {(() => {
                const selected = status?.developerAuditLogs.find((e) => e.id === expandedAuditId);
                if (!selected) return null;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span>
                        Target Private Chat: {selected.targetChatId} · Delivery:{' '}
                        {selected.deliveredViaBot ? 'DELIVERED' : 'LOCAL_STREAM'}
                      </span>
                      {selected.errorDetail && (
                        <span className="text-amber-300">{selected.errorDetail}</span>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-200">
                      {selected.formattedMessage}
                    </pre>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Webhook Configuration & Daily Automated Delivery Controls */}
      {activeTab === 'WEBHOOK_SCHEDULE' && (
        <div className="p-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Webhook Registration & Inbound Verification */}
          <div className="space-y-4">
            <div>
              <h3 className="font-display text-sm font-bold text-white">
                Telegram Bot Webhook Endpoint
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Registers <code className="font-mono text-slate-200">/api/telegram/webhook</code>{' '}
                with HMAC secret-token verification. Private messages with{' '}
                <code className="font-mono text-slate-200">/start</code> or{' '}
                <code className="font-mono text-slate-200">/audit</code> auto-bind Stream 2 to the
                developer&apos;s private account.
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="tg-webhook-url"
                className="block text-[11px] font-medium text-slate-400"
              >
                Public HTTPS Webhook URL
              </label>
              <input
                id="tg-webhook-url"
                type="url"
                placeholder="https://your-app-domain/api/telegram/webhook"
                value={webhookUrlInput}
                onChange={(e) => setWebhookUrlInput(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-mono text-white placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRegisterWebhook}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Webhook className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {busyAction === 'register-webhook' ? 'Registering...' : 'Register Webhook'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCheckWebhookInfo}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <span>Check Telegram Info</span>
              </button>

              <button
                type="button"
                onClick={handleTestWebhookDrill}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <span>Test /audit Webhook</span>
              </button>
            </div>

            {/* Recent Inbound Webhook Events */}
            <div className="border-t border-slate-800/80 pt-3">
              <div className="text-xs font-semibold text-slate-200 mb-2">
                Recent Inbound Webhook Events ({status?.recentWebhookEvents.length ?? 0})
              </div>
              {!status || status.recentWebhookEvents.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No inbound webhook updates received yet. Send <code className="font-mono">/start</code>{' '}
                  to the bot or click &ldquo;Test /audit Webhook&rdquo; to verify webhook handling.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {status.recentWebhookEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-1.5 text-[11px] font-mono"
                    >
                      <span className="text-slate-200">
                        {ev.senderLabel} ({ev.chatType}) ·{' '}
                        <span className="text-[#3b82f6]">{ev.command || ev.textPreview}</span>
                      </span>
                      <span className="text-slate-400">{ev.actionTaken}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Daily Automated Delivery & Developer Private Chat Binding */}
          <div className="space-y-4">
            <div>
              <h3 className="font-display text-sm font-bold text-white">
                Daily Automated Audit Delivery &amp; Private Routing
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Configures automated 24-hour system health digests directed exclusively to the
                developer&apos;s private Telegram chat ID (strictly isolated from public channel{' '}
                <code className="font-mono text-slate-200">
                  {status?.publicChannel.chatId || 'Unconfigured'}
                </code>
                ).
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#0d1323] px-3.5 py-2.5">
              <div>
                <div className="text-xs font-semibold text-white">
                  Automated Daily Audit Report
                </div>
                <div className="text-[11px] text-slate-400">
                  Delivers 24h CPU, memory, latency &amp; health digest once daily
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={dailyEnabled}
                aria-label="Toggle Daily Automated Developer Audit Delivery"
                onClick={() => handleSaveSchedule(!dailyEnabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                  dailyEnabled
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-slate-700 bg-slate-800'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    dailyEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="tg-daily-utc-hour"
                  className="block text-[11px] font-medium text-slate-400 mb-1"
                >
                  Daily Delivery Hour (UTC)
                </label>
                <select
                  id="tg-daily-utc-hour"
                  value={scheduledUtcHour}
                  onChange={(e) => setScheduledUtcHour(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-mono text-white focus:border-[#3b82f6] focus:outline-none"
                >
                  {Array.from({ length: 24 }, (_, hr) => (
                    <option key={hr} value={hr}>
                      {String(hr).padStart(2, '0')}:00 UTC
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="tg-dev-chat-id"
                  className="block text-[11px] font-medium text-slate-400 mb-1"
                >
                  Developer Private Chat ID
                </label>
                <input
                  id="tg-dev-chat-id"
                  type="text"
                  inputMode="numeric"
                  placeholder={status?.developerAudit.targetChatIdMasked || 'e.g. 581920441'}
                  value={devChatInput}
                  onChange={(e) => setDevChatInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-mono text-white placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-slate-400">
                Last Daily Report:{' '}
                {status?.developerAudit.lastDailyReportSentAt
                  ? new Date(status.developerAudit.lastDailyReportSentAt).toLocaleString()
                  : 'Pending first daily run'}
              </span>
              <button
                type="button"
                onClick={() => handleSaveSchedule()}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <span>{busyAction === 'save-schedule' ? 'Saving...' : 'Save Routing & Schedule'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
