import { useEffect, useState } from 'react';
import { Bell, Mail, Send, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TRACKED_COINS, formatCryptoPrice } from '../lib/marketData';
import { apiFetch } from '../lib/apiClient';

interface EmailDispatchRecord {
  id: string;
  type: string;
  recipient: string;
  subject: string;
  summary: string;
  status: string;
  timestamp: string;
}

export function Alerts() {
  const {
    user,
    tickers,
    priceAlerts,
    addPriceAlert,
    removePriceAlert,
    dispatchPerformanceReport,
  } = useApp();

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [targetPrice, setTargetPrice] = useState('95000');
  const [emailNotify, setEmailNotify] = useState(true);
  const [formError, setFormError] = useState('');

  const [history, setHistory] = useState<EmailDispatchRecord[]>([]);
  const [ownerEmail, setOwnerEmail] = useState('amirshehzad2647tcs@gmail.com');
  const [resendConfigured, setResendConfigured] = useState(false);
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  const loadHistory = () => {
    fetch('/api/alerts/history')
      .then((res) => res.json())
      .then((json) => {
        if (json.ownerEmail) setOwnerEmail(json.ownerEmail);
        setResendConfigured(Boolean(json.resendConfigured));
        setTelegramConfigured(Boolean(json.telegramConfigured));
        setHistory(Array.isArray(json.records) ? json.records : []);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const numPrice = Number(targetPrice);
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      setFormError('Please enter a valid positive target price.');
      return;
    }
    await addPriceAlert({
      symbol,
      condition,
      targetPrice: numPrice,
      emailNotify,
    });
    setStatusFeedback(`Price alert armed for ${symbol} ${condition} $${numPrice}.`);
  };

  const triggerTestSignalBatch = async () => {
    setSendingEmail(true);
    try {
      const livePrice = tickers.BTCUSDT?.price ?? 91420;
      const res = await apiFetch('/api/alerts/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'HIGH_CONFIDENCE_SIGNAL',
          sourceModule: 'AI_ENGINE',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          confidence: 89,
          entryPrice: livePrice,
          stopLoss: Number((livePrice * 0.982).toFixed(2)),
          trailingStopLoss: Number((livePrice * 0.984).toFixed(2)),
          takeProfits: [
            Number((livePrice * 1.022).toFixed(2)),
            Number((livePrice * 1.045).toFixed(2)),
            Number((livePrice * 1.072).toFixed(2)),
          ],
          reason: 'Verification signal batched into strict 3-Hour Digest queue.',
        }),
      });
      const data = await res.json();
      setStatusFeedback(
        data.batched
          ? `Signal batched into strict 3-Hour Digest queue (${data.queueCount} queued · zero individual email quota spent).`
          : `Queued for ${ownerEmail}.`
      );
      loadHistory();
    } finally {
      setSendingEmail(false);
    }
  };

  const triggerThreeHourDigest = async () => {
    setSendingEmail(true);
    try {
      const res = await apiFetch('/api/digest/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      setStatusFeedback(
        data.record?.status === 'sent'
          ? `3-Hour Batched Signal Digest sent to ${ownerEmail} (${data.record.batchedCount ?? 0} signals consolidated)`
          : `3-Hour Digest logged for ${ownerEmail} (${data.record?.summary || 'Includes WhatsApp link'})`
      );
      loadHistory();
    } finally {
      setSendingEmail(false);
    }
  };

  const triggerScheduledPerformanceReport = async (
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  ) => {
    setSendingEmail(true);
    try {
      const res = await dispatchPerformanceReport(period);
      setStatusFeedback(
        res.ok
          ? `${period} performance summary delivered to ${ownerEmail} and "Signal Forge" Telegram channel.`
          : `Failed to dispatch ${period} performance report.`
      );
      loadHistory();
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div className="border-b border-slate-800/80 pb-6">
        <span className="text-xs text-slate-400">
          Real-Time Price Monitors · Resend Automated Email Engine
        </span>
        <h1 className="mt-1 font-display text-3xl font-bold text-white tracking-tight">
          Price Alerts &amp; Automated Signal Emails
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Configure custom target alerts and manage automated Resend emails to{' '}
          <span className="font-mono text-slate-200">{ownerEmail}</span>.
        </p>
      </div>

      {statusFeedback && (
        <div
          role="status"
          className="rounded-lg border border-[#3b82f6]/40 bg-[#3b82f6]/10 px-4 py-3 text-xs text-blue-200"
        >
          {statusFeedback}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Create Price Alert + List */}
        <div className="lg:col-span-6 space-y-6">
          <section className="rounded-xl border border-slate-800/90 bg-[#111827] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Bell className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
              <h2 className="font-display text-lg font-bold text-white">
                Create Target Price Alert
              </h2>
            </div>

            <form onSubmit={handleCreateAlert} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="alert-coin-select"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Coin Pair
                  </label>
                  <select
                    id="alert-coin-select"
                    value={symbol}
                    onChange={(e) => {
                      const nextSym = e.target.value;
                      setSymbol(nextSym);
                      const p = tickers[nextSym]?.price;
                      if (p) setTargetPrice(String(Number((p * 1.03).toPrecision(5))));
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
                  >
                    {TRACKED_COINS.map((c) => (
                      <option key={c.symbol} value={c.symbol}>
                        {c.symbol}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="alert-condition-select"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Condition
                  </label>
                  <select
                    id="alert-condition-select"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as 'ABOVE' | 'BELOW')}
                    className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
                  >
                    <option value="ABOVE">Crosses Above</option>
                    <option value="BELOW">Drops Below</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="alert-target-price"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Target Price (USD)
                  </label>
                  <input
                    id="alert-target-price"
                    type="number"
                    step="any"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-xs text-white focus:border-[#3b82f6] focus:outline-none"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailNotify}
                  onChange={(e) => setEmailNotify(e.target.checked)}
                  className="rounded border-slate-600 bg-[#0a0e1a] text-[#3b82f6]"
                />
                <span>Also dispatch Resend Email Alert with WhatsApp link when triggered</span>
              </label>

              {formError && (
                <p className="text-xs text-rose-400" role="alert">
                  {formError}
                </p>
              )}

              <button
                type="submit"
                className="w-full rounded-lg bg-[#3b82f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer"
              >
                Create Price Alert
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-800/90 bg-[#111827] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-base font-bold text-white">
                Configured Alerts ({priceAlerts.length})
              </h3>
              <span className="text-[11px] text-slate-400">
                {user && user.emailVerified ? 'Synced to Firestore' : 'Local Session'}
              </span>
            </div>

            {priceAlerts.length === 0 ? (
              <p className="text-xs text-slate-400 py-4">
                No price alerts configured yet. Create an alert above to track live breakouts.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800/70">
                {priceAlerts.map((alert) => {
                  const live = tickers[alert.symbol]?.price ?? 0;
                  return (
                    <li
                      key={alert.id}
                      className="flex items-center justify-between gap-3 py-3 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-white">{alert.symbol}</span>
                        <span className="mx-2 text-slate-500">·</span>
                        <span className="text-slate-300">
                          {alert.condition} ${formatCryptoPrice(alert.targetPrice)}
                        </span>
                        <span className="block mt-0.5 font-mono text-[11px] text-slate-400">
                          Live: ${formatCryptoPrice(live)} ·{' '}
                          {alert.triggered ? (
                            <span className="text-emerald-400 font-semibold">Triggered</span>
                          ) : (
                            <span className="text-blue-400">Monitoring</span>
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePriceAlert(alert.id)}
                        aria-label={`Delete alert for ${alert.symbol}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Right: Automated Resend Email System */}
        <div className="lg:col-span-6 space-y-6">
          <section className="rounded-xl border border-slate-800/90 bg-[#111827] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <Mail className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
                  <span>
                    Resend API · {resendConfigured ? 'API Key Active' : 'Template Queue Mode'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Telegram Bot · {telegramConfigured ? 'Token Connected' : 'Not Configured'}
                  </span>
                </div>
                <h2 className="mt-1 font-display text-lg font-bold text-white">
                  Automated Owner Email Rules
                </h2>
              </div>
            </div>

            <div className="divide-y divide-slate-800/80 text-xs">
              <div className="pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">
                    High-Confidence Signal Batching (&ge; 85% Quota Shield)
                  </h3>
                  <p className="mt-0.5 text-slate-400">
                    All &ge;85% AI, SMC, Pattern Scanner, and Top Gainer signals batch cleanly into the Coordinator&apos;s strict 3-hour digest queue (replacing individual real-time email spam).
                  </p>
                </div>
                <button
                  type="button"
                  disabled={sendingEmail}
                  onClick={triggerTestSignalBatch}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-semibold text-white hover:border-[#3b82f6] cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Queue &ge;85% Test Signal</span>
                </button>
              </div>

              <div className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">
                    Strict 3-Hour Batched Signal Email Digest
                  </h3>
                  <p className="mt-0.5 text-slate-400">
                    Consolidates all queued high-confidence signal alerts and Binance Top Movers into one scheduled digest every 3 hours with direct WhatsApp desk link (<span className="font-mono">https://wa.me/923015083557</span>).
                  </p>
                </div>
                <button
                  type="button"
                  disabled={sendingEmail}
                  onClick={triggerThreeHourDigest}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Send 3H Digest Now</span>
                </button>
              </div>

              <div className="pt-4 space-y-2.5">
                <div>
                  <h3 className="font-semibold text-white">
                    Automated Daily, Weekly &amp; Monthly Performance Summaries (Email + Telegram)
                  </h3>
                  <p className="mt-0.5 text-slate-400">
                    Automatically compiles win rate, net return, dynamic R:R curve, and Skeptic Agent vetoes to{' '}
                    <span className="font-mono text-slate-200">{ownerEmail}</span> &amp; &ldquo;Signal Forge&rdquo; Telegram.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      disabled={sendingEmail}
                      onClick={() => triggerScheduledPerformanceReport(period)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#3b82f6] cursor-pointer"
                    >
                      <Send className="h-3 w-3 text-[#3b82f6]" aria-hidden="true" />
                      <span>
                        Send {period.charAt(0) + period.slice(1).toLowerCase()} Summary
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-800/90 bg-[#111827] p-5">
            <h3 className="font-display text-base font-bold text-white mb-3">
              Email Alert Dispatch Log
            </h3>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">
                No automated email dispatches recorded in this session yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800/70">
                {history.map((rec) => (
                  <li key={rec.id} className="py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">{rec.subject}</span>
                      <span
                        className={`font-mono text-[11px] shrink-0 ${
                          rec.status === 'sent'
                            ? 'text-emerald-400'
                            : rec.status === 'batched_for_3h_digest'
                            ? 'text-blue-300'
                            : rec.status === 'failed'
                            ? 'text-rose-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {rec.status === 'sent'
                          ? 'Sent'
                          : rec.status === 'batched_for_3h_digest'
                          ? 'Batched (3H)'
                          : rec.status === 'failed'
                          ? 'Failed'
                          : 'Queued (No Key)'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-slate-400">{rec.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
