import { useState } from 'react';
import { AlertTriangle, Play, RefreshCw, ShieldAlert, ShieldCheck, Zap } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatCryptoPrice } from '../lib/marketData';

export function SentinelAgentPanel() {
  const {
    selectedSymbol,
    sentinelBySymbol,
    sentinelFeed,
    triggerSentinelAudit,
    autonomousState,
    runAutonomousCycleNow,
  } = useApp();

  const [auditing, setAuditing] = useState(false);
  const [simHeadline, setSimHeadline] = useState('');
  const [simSentiment, setSimSentiment] = useState<'BEARISH' | 'BULLISH'>('BEARISH');

  const activeSymbol = sentinelBySymbol[selectedSymbol]
    ? selectedSymbol
    : Object.keys(sentinelBySymbol)[0] || selectedSymbol || 'BTCUSDT';

  const assessment = sentinelBySymbol[activeSymbol] ?? null;

  const regimeMeta = (() => {
    if (!assessment) {
      return {
        label: 'MONITORING',
        color: 'text-slate-300',
        border: 'border-slate-800',
        bg: 'bg-[#0d1323]',
      };
    }
    switch (assessment.regime) {
      case 'PANIC_FUD':
      case 'DUMP_ALERT':
        return {
          label: assessment.regime.replace('_', ' '),
          color: 'text-rose-400',
          border: 'border-rose-500/40',
          bg: 'bg-rose-500/10',
        };
      case 'PUMP_SURGE':
        return {
          label: 'VERIFIED PUMP SURGE',
          color: 'text-emerald-400',
          border: 'border-emerald-500/40',
          bg: 'bg-emerald-500/10',
        };
      case 'REVERSAL_CONFIRMED':
        return {
          label: 'REVERSAL CONFIRMED',
          color: 'text-amber-300',
          border: 'border-amber-500/40',
          bg: 'bg-amber-500/10',
        };
      default:
        return {
          label: 'CALM / VERIFIED',
          color: 'text-emerald-400',
          border: 'border-slate-800',
          bg: 'bg-[#0d1323]',
        };
    }
  })();

  const handleAudit = async () => {
    setAuditing(true);
    try {
      await triggerSentinelAudit();
    } finally {
      setAuditing(false);
    }
  };

  const handleSimulateCrossPlatformEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simHeadline.trim()) return;
    setAuditing(true);
    try {
      await triggerSentinelAudit({
        symbol: activeSymbol,
        headline: simHeadline.trim(),
        sentiment: simSentiment,
        platform: 'X',
      });
      setSimHeadline('');
    } finally {
      setAuditing(false);
    }
  };

  return (
    <section
      aria-label="Sentinel Agent Anomaly and Panic Detection"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            <span className="font-mono font-semibold text-amber-300">
              DEDICATED SENTINEL AGENT
            </span>
            <span aria-hidden="true">·</span>
            <span>X + CryptoPanic + Exchange Corroboration</span>
            <span aria-hidden="true">·</span>
            <span className={`font-mono font-bold ${regimeMeta.color}`}>{regimeMeta.label}</span>
          </div>
          <h2 className="mt-0.5 font-display text-lg font-bold text-white tracking-tight">
            Market Panic, FUD, Breaking News &amp; Preemptive Pump/Dump Guard
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => runAutonomousCycleNow()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-400 cursor-pointer whitespace-nowrap"
          >
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Execute Autonomous Tick</span>
          </button>

          <button
            type="button"
            disabled={auditing}
            onClick={handleAudit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${auditing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{auditing ? 'Auditing...' : 'Run Sentinel Audit'}</span>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Top Metrics Strip */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 font-mono text-xs tabular-nums">
          <div className={`rounded-lg border p-3 ${regimeMeta.border} ${regimeMeta.bg}`}>
            <span className="block text-[10px] text-slate-400">
              THREAT REGIME ({activeSymbol})
            </span>
            <span className={`mt-0.5 block text-sm font-bold ${regimeMeta.color}`}>
              {regimeMeta.label}
            </span>
            <span className="text-[10px] text-slate-400">
              {assessment?.verificationStatus.replace(/_/g, ' ') ?? 'SYNCING'}
            </span>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
            <span className="block text-[10px] text-slate-400">ANOMALY &amp; VOL SPIKE</span>
            <span className="mt-0.5 block text-sm font-bold text-white">
              Score {assessment?.threatScore ?? 0}/100 · {assessment?.volumeSpikeRatio.toFixed(2) ?? '1.00'}x
            </span>
            <span className="text-[10px] text-slate-400">
              WS Delta: {(assessment?.wsVelocityPct ?? 0) >= 0 ? '+' : ''}
              {(assessment?.wsVelocityPct ?? 0).toFixed(2)}%
            </span>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
            <span className="block text-[10px] text-slate-400">MANDATED PROTECTION</span>
            <span className="mt-0.5 block text-sm font-bold text-amber-300">
              Max 2.0% Structural SL · Min 1:5 R:R
            </span>
            <span className="text-[10px] text-slate-400">
              {assessment?.reversalConfirmed
                ? 'Structural Reversal Confirmed'
                : 'Hedge Hold Until Reversal'}
            </span>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
            <span className="block text-[10px] text-slate-400">AUTONOMOUS SENTINEL LOG</span>
            <span className="mt-0.5 block text-sm font-bold text-blue-300">
              {autonomousState.hedgesExecuted} Hedges · {autonomousState.reversalExitsExecuted} Reversals
            </span>
            <span className="text-[10px] text-slate-400">
              {autonomousState.entriesExecuted} Auto Entries ({autonomousState.totalCycles} cycles)
            </span>
          </div>
        </div>

        {/* Active Preemptive Directive Banner */}
        {assessment?.preemptivePlan && (
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-mono font-bold">
                {assessment.preemptivePlan.action === 'HOLD_MONITOR' ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />
                )}
                <span className="text-white">
                  DIRECTIVE: {assessment.preemptivePlan.action.replace(/_/g, ' ')} (
                  {assessment.preemptivePlan.marketType} ·{' '}
                  {assessment.preemptivePlan.marketType === 'USD_M_FUTURES' ? '5x Cross' : '1x Spot'})
                </span>
              </div>
              <p className="text-xs text-slate-300">{assessment.preemptivePlan.reason}</p>
            </div>

            <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums shrink-0">
              <div>
                <span className="block text-[10px] text-slate-400">ENTRY</span>
                <span className="text-white font-semibold">
                  ${formatCryptoPrice(assessment.preemptivePlan.entryPrice)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-amber-300">
                  SL ({assessment.preemptivePlan.stopLossPct.toFixed(2)}% CAP)
                </span>
                <span className="text-amber-200 font-semibold">
                  ${formatCryptoPrice(assessment.preemptivePlan.stopLoss)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-emerald-300">5x ATR TRAIL TP</span>
                <span className="text-emerald-200 font-semibold">
                  ${formatCryptoPrice(assessment.preemptivePlan.trailingTakeProfit5xAtr)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Cross-Platform Verification Feed & Event Trigger */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Cross-Platform Feed Verification ({sentinelFeed.length} Active)
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {sentinelFeed.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Monitoring X, CryptoPanic, and L2 order books for breaking anomalies.
                </p>
              ) : (
                sentinelFeed.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-slate-800/80 bg-[#0d1323] px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                      <span className="font-bold text-blue-300">
                        {item.platform} · {item.handle} ({item.symbols[0] || 'MACRO'})
                      </span>
                      <span
                        className={
                          item.sentiment === 'BULLISH_CATALYST'
                            ? 'text-emerald-400 font-semibold'
                            : item.sentiment === 'PANIC_FUD'
                            ? 'text-rose-400 font-semibold'
                            : 'text-slate-400'
                        }
                      >
                        {item.sentiment.replace(/_/g, ' ')} · Trust {Math.round(item.credibilityWeight * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-slate-200 leading-snug">{item.headline}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-5 rounded-lg border border-slate-800/80 bg-[#0d1323] p-4 flex flex-col justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                X / Breaking News Verification Trigger
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Submit a breaking X / news signal to verify cross-platform corroboration and inspect Sentinel&apos;s preemptive risk hedge or momentum trigger.
              </p>
            </div>

            <form onSubmit={handleSimulateCrossPlatformEvent} className="space-y-2.5">
              <div className="flex gap-2">
                <select
                  aria-label="Sentinel Event Sentiment"
                  value={simSentiment}
                  onChange={(e) => setSimSentiment(e.target.value as 'BEARISH' | 'BULLISH')}
                  className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-2 text-xs font-mono text-white focus:border-[#3b82f6] focus:outline-none"
                >
                  <option value="BEARISH">PANIC / FUD (Hedge Short)</option>
                  <option value="BULLISH">BREAKOUT SURGE (Long)</option>
                </select>
                <input
                  type="text"
                  value={simHeadline}
                  onChange={(e) => setSimHeadline(e.target.value)}
                  placeholder={`e.g. ${activeSymbol.replace(/USDT$/, '')} flash exploit / ETF surge on X`}
                  className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={auditing || !simHeadline.trim()}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-semibold text-white hover:border-[#3b82f6] disabled:opacity-50 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
                <span>Verify on Cross-Platform Feeds</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
