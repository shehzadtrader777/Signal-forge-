import { useState } from 'react';
import { CalendarClock, FileBarChart2, MailCheck, RefreshCw, Send } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function AutoReportsSection() {
  const {
    autoReports,
    refreshAutoReports,
    dispatchPerformanceReport,
    digestStatus,
    dispatchSignalDigestNow,
  } = useApp();
  const [busyPeriod, setBusyPeriod] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await refreshAutoReports();
    } finally {
      setRefreshing(false);
    }
  };

  const handleDispatch = async (period: 'DAILY' | 'WEEKLY' | 'MONTHLY') => {
    setBusyPeriod(period);
    try {
      await dispatchPerformanceReport(period);
    } finally {
      setBusyPeriod(null);
    }
  };

  const handleFlushDigest = async () => {
    setBusyPeriod('DIGEST_3H');
    try {
      await dispatchSignalDigestNow();
    } finally {
      setBusyPeriod(null);
    }
  };

  return (
    <section
      aria-label="Automated Coordinator Auto-Reports"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs text-slate-400">
            Autonomous AI Coordinator Telemetry · Email &amp; &ldquo;Signal Forge&rdquo; Telegram Synced
          </span>
          <h2 className="mt-0.5 font-display text-xl font-bold text-white flex items-center gap-2">
            <FileBarChart2 className="h-5 w-5 text-[#3b82f6]" aria-hidden="true" />
            <span>Auto-Reports (Daily · Weekly · Monthly)</span>
          </h2>
        </div>

        <button
          type="button"
          onClick={handleRefreshAll}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 text-[#3b82f6] ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{refreshing ? 'Refreshing...' : 'Sync Auto-Reports'}</span>
        </button>
      </div>

      {/* Strict 3-Hour Signal Email Digest Coordinator Bar */}
      {digestStatus && (
        <div className="border-b border-slate-800/70 bg-[#0a0e1a]/70 px-5 py-3 flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-300">
            <MailCheck className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
            <span className="font-semibold text-white">Strict 3-Hour Signal Email Digest</span>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-blue-300">
              {digestStatus.pendingCount} signals batched
            </span>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-emerald-400">
              {digestStatus.individualEmailsPrevented} individual emails prevented (Quota Protected)
            </span>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-400">
              Next 3H Dispatch: {new Date(digestStatus.nextScheduledAt).toUTCString().slice(17, 22)} UTC
            </span>
          </div>
          <button
            type="button"
            disabled={busyPeriod === 'DIGEST_3H'}
            onClick={handleFlushDigest}
            className="inline-flex items-center gap-1.5 self-start md:self-auto rounded-lg border border-slate-700 bg-[#111827] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#3b82f6] transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            <Send className="h-3 w-3 text-[#3b82f6]" aria-hidden="true" />
            <span>
              {busyPeriod === 'DIGEST_3H' ? 'Dispatching 3H Digest...' : 'Flush 3H Signal Digest'}
            </span>
          </button>
        </div>
      )}

      {autoReports.length === 0 ? (
        <div className="p-6 text-xs text-slate-400">
          Compiling automated Daily, Weekly, and Monthly Coordinator performance summaries...
        </div>
      ) : (
        <div className="p-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {autoReports.map((report) => (
            <article
              key={report.period}
              aria-label={`${report.label} Auto-Report`}
              className="rounded-xl border border-slate-800/90 bg-[#0d1323] p-4 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#3b82f6]">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{report.label}</span>
                  </div>
                  <span className="font-mono text-xs font-bold tabular-nums text-emerald-400">
                    +{report.netReturn}% Net
                  </span>
                </div>

                {/* Primary Metrics */}
                <div className="grid grid-cols-3 gap-2 border-y border-slate-800/80 py-2.5 text-xs font-mono tabular-nums">
                  <div>
                    <span className="block font-sans text-[10px] text-slate-400">Signals</span>
                    <span className="font-bold text-white">{report.signals}</span>
                  </div>
                  <div>
                    <span className="block font-sans text-[10px] text-slate-400">Win Rate</span>
                    <span className="font-bold text-emerald-400">{report.winRate}%</span>
                  </div>
                  <div>
                    <span className="block font-sans text-[10px] text-slate-400">Profit Factor</span>
                    <span className="font-bold text-blue-300">{report.profitFactor}x</span>
                  </div>
                </div>

                {/* Risk & Attribution Summary */}
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Avg Dynamic R:R</span>
                    <span className="font-mono font-semibold text-white">{report.avgRR}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">ATR Trailing Exits</span>
                    <span className="font-mono font-semibold text-amber-300">
                      {report.atrTrailingExits}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Skeptic Vetoes Saved</span>
                    <span className="font-mono font-semibold text-slate-200">
                      {report.skepticVetoes} traps
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Top Pair · Equity</span>
                    <span className="font-mono font-semibold text-slate-200">
                      {report.bestPair} · ${report.crossEquityUsd.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Module Attribution Table */}
                <div className="border-t border-slate-800/70 pt-2.5">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                    Engine Attribution (AI · SMC · Patterns)
                  </span>
                  <div className="space-y-1 text-[11px] font-mono tabular-nums">
                    {report.strategyBreakdown.map((mod) => (
                      <div
                        key={mod.module}
                        className="flex items-center justify-between text-slate-300"
                      >
                        <span className="font-sans text-slate-300">{mod.module}</span>
                        <span>
                          {mod.trades}t · {mod.winRate}% ·{' '}
                          <span className="text-emerald-400">+{mod.contributionPct}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={busyPeriod === report.period}
                onClick={() => handleDispatch(report.period)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-semibold text-white hover:border-[#3b82f6] transition-colors cursor-pointer disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
                <span>
                  {busyPeriod === report.period
                    ? `Sending ${report.period}...`
                    : `Dispatch ${report.period.charAt(0) + report.period.slice(1).toLowerCase()} to Email & Telegram`}
                </span>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
