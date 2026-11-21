import { memo, useCallback, useState } from 'react';
import {
  CheckCircle2,
  Crosshair,
  Lock,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { formatCryptoPrice } from '../lib/marketData';
import type { BackendExecutionPipelineSnapshot } from '../lib/executionPipeline';

interface EntryZoneAndExecutionPanelProps {
  snapshot: BackendExecutionPipelineSnapshot | null;
  showActiveSignals: boolean;
  showExecutionLogs: boolean;
  onSnapshotUpdated: (next: BackendExecutionPipelineSnapshot) => void;
  onSelectSymbol: (symbol: string) => void;
}

export const EntryZoneAndExecutionPanel = memo(function EntryZoneAndExecutionPanel({
  snapshot,
  showActiveSignals,
  showExecutionLogs,
  onSnapshotUpdated,
  onSelectSymbol,
}: EntryZoneAndExecutionPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const handleExecuteSignal = useCallback(
    async (signalId: string, forceEntryZoneMatch: boolean) => {
      setBusyId(signalId);
      setFeedback(null);
      try {
        const res = await apiFetch('/api/pipeline/entry-zone/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signalId, forceEntryZoneMatch, notionalUsd: 1500 }),
        });
        const data = await res.json().catch(() => null);
        if (data?.snapshot) {
          onSnapshotUpdated(data.snapshot as BackendExecutionPipelineSnapshot);
        }
        if (!res.ok || !data?.ok) {
          setFeedback({
            ok: false,
            text: data?.error || 'Entry Zone validation blocked premature execution.',
          });
          return;
        }
        setFeedback({
          ok: true,
          text: `Executed ${data.executedOrder.symbol} ${data.executedOrder.direction} @ $${formatCryptoPrice(
            data.executedOrder.executedPrice
          )} — card transitioned off active grid into Backend Execution Logs.`,
        });
      } catch {
        setFeedback({ ok: false, text: 'Network error executing Entry-Zone signal.' });
      } finally {
        setBusyId(null);
      }
    },
    [onSnapshotUpdated]
  );

  const handleRetryTelegramQueue = useCallback(async () => {
    setBusyId('tg-retry');
    setFeedback(null);
    try {
      const res = await apiFetch('/api/pipeline/telegram-queue/retry', {
        method: 'POST',
      });
      const data = await res.json().catch(() => null);
      if (data?.snapshot) {
        onSnapshotUpdated(data.snapshot as BackendExecutionPipelineSnapshot);
      }
      setFeedback({
        ok: Boolean(data?.ok),
        text: data?.ok
          ? `Telegram Dispatch Stabilizer flushed ${data.retriedCount ?? 0} queued delivery item(s).`
          : 'Could not flush Telegram dispatch retry queue.',
      });
    } catch {
      setFeedback({ ok: false, text: 'Network error retrying Telegram queue.' });
    } finally {
      setBusyId(null);
    }
  }, [onSnapshotUpdated]);

  const activeSignals = snapshot?.activeAwaitingSignals ?? [];
  const executedLogs = snapshot?.executedOrdersLog ?? [];
  const tgStab = snapshot?.telegramStabilizer;

  if (!showActiveSignals && !showExecutionLogs) return null;

  return (
    <div className="space-y-6" data-testid="entry-zone-execution-engine">
      {feedback && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-2.5 text-xs flex items-center justify-between gap-3 ${
            feedback.ok
              ? 'border-emerald-500/35 bg-emerald-950/35 text-emerald-200'
              : 'border-amber-500/35 bg-amber-950/35 text-amber-200'
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

      {/* 1. Strict Entry-Zone Gated Active Signal Cards */}
      {showActiveSignals && (
        <section
          aria-label="Entry Zone Validated Signal Queue"
          data-testid="entry-zone-active-queue"
          className="cyber-surface rounded-xl border overflow-hidden"
        >
          <div className="flex flex-col gap-2 border-b border-slate-800/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Backend Offloaded Signal Pipeline</span>
                <span aria-hidden="true">·</span>
                <span className="text-cyan-300 font-medium">
                  Strict Entry Zone Gating Active
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {activeSignals.length} awaiting entry · {executedLogs.length} transitioned to logs
                </span>
              </div>
              <h2 className="mt-1 font-display text-lg font-bold text-white flex items-center gap-2">
                <Crosshair className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />
                <span>Entry-Zone Gated Signal Cards (Active Until Executed)</span>
              </h2>
            </div>

            <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap">
              Auto-executes &amp; archives on zone fill
            </span>
          </div>

          <div className="p-5">
            {activeSignals.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                All active Entry-Zone signals have executed and transitioned cleanly to Backend
                Execution Logs. Awaiting next validated setup...
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {activeSignals.map((item) => {
                  const isBuy = item.direction === 'BUY';
                  const inZone = item.evaluation.inEntryZone;
                  return (
                    <article
                      key={item.signalId}
                      data-testid={`ez-card-${item.symbol}`}
                      className={`flex flex-col justify-between rounded-lg border bg-[#050914]/90 p-4 transition-colors ${
                        inZone
                          ? 'border-emerald-500/50'
                          : 'border-slate-800/90 hover:border-cyan-500/40'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[11px] text-slate-400">
                              {item.sourceModule === 'PRE_PUMP_SUPPORT'
                                ? 'Pre-Pump Support'
                                : 'AI Coordinator'}{' '}
                              · {item.timeframe} · {item.confidence}% Conf
                            </div>
                            <button
                              type="button"
                              onClick={() => onSelectSymbol(item.symbol)}
                              className="mt-0.5 font-display text-base font-bold text-white hover:text-cyan-300 transition-colors cursor-pointer text-left"
                            >
                              {item.symbol}
                            </button>
                          </div>
                          <span
                            className={`font-mono text-xs font-bold ${
                              isBuy ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {item.direction}
                          </span>
                        </div>

                        {/* Entry Zone Status Strip */}
                        <div className="mt-3 border-y border-slate-800/80 py-2.5 space-y-1.5 text-xs font-mono tabular-nums">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Entry Zone</span>
                            <span className="text-cyan-300 font-semibold">
                              ${formatCryptoPrice(item.entryZone.low)} – $
                              {formatCryptoPrice(item.entryZone.high)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Live Mark</span>
                            <span className="text-white">
                              ${formatCryptoPrice(item.evaluation.livePrice)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Zone Status</span>
                            <span
                              className={
                                inZone ? 'text-emerald-400 font-semibold' : 'text-amber-300'
                              }
                            >
                              {inZone
                                ? 'IN ENTRY ZONE'
                                : `${item.evaluation.distanceToZonePct}% away`}
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[11px]">
                            <span className="text-rose-300">
                              SL ${formatCryptoPrice(item.stopLoss)}
                            </span>
                            <span className="text-emerald-300">
                              TP3 ${formatCryptoPrice(item.takeProfits[2])}
                            </span>
                          </div>
                        </div>

                        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-300 line-clamp-2">
                          {item.reason}
                        </p>
                      </div>

                      <div className="mt-3.5 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => handleExecuteSignal(item.signalId, false)}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-[#0b1224] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-cyan-400 hover:text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                        >
                          <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                          <span>Validate Zone</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => handleExecuteSignal(item.signalId, true)}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                        >
                          <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {busyId === item.signalId ? 'Executing...' : 'Fill & Archive'}
                          </span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 2. Backend Execution Logs (Transitioned Traded Cards + Hold-Until-Max-Profit Lock + Telegram Stabilizer) */}
      {showExecutionLogs && (
        <section
          aria-label="Backend Execution Logs & Telegram Dispatch Stabilizer"
          data-testid="backend-execution-logs-panel"
          className="cyber-surface rounded-xl border overflow-hidden"
        >
          <div className="flex flex-col gap-3 border-b border-slate-800/90 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Zero-Clutter Execution Ledger</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  Telegram Stabilizer {tgStab?.reliabilityPct ?? 100}% · {tgStab?.totalDelivered ?? 0}{' '}
                  delivered · {tgStab?.pendingCount ?? 0} retrying
                </span>
              </div>
              <h2 className="mt-1 font-display text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>Backend Execution Logs &amp; Hold-Until-Max-Target Tracker</span>
              </h2>
            </div>

            <button
              type="button"
              onClick={handleRetryTelegramQueue}
              disabled={busyId !== null}
              className="inline-flex items-center gap-1.5 self-start lg:self-auto rounded-lg border border-slate-700 bg-[#050914] px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:border-cyan-400 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${busyId === 'tg-retry' ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Flush Telegram Retry Queue</span>
            </button>
          </div>

          <div className="overflow-x-auto p-5">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                  <th className="py-2.5 pr-3">Executed</th>
                  <th className="py-2.5 pr-3">Pair &amp; Module</th>
                  <th className="py-2.5 pr-3 text-right">Fill Price</th>
                  <th className="py-2.5 pr-3 text-right">Max Target (TP3)</th>
                  <th className="py-2.5 pr-3">Hold Policy &amp; Progress</th>
                  <th className="py-2.5 pr-3 text-right">P&amp;L</th>
                  <th className="py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {executedLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-7 text-center text-slate-400">
                      No Entry-Zone or Pre-Pump Support orders have transitioned to backend
                      execution logs yet. Execute any validated signal above or in the Pre-Pump
                      Support Desk.
                    </td>
                  </tr>
                ) : (
                  executedLogs.map((ord) => {
                    const pnlUsd = ord.realizedPnlUsd ?? ord.unrealizedPnlUsd;
                    const pnlPct = ord.realizedPnlPercent ?? ord.unrealizedPnlPercent;
                    return (
                      <tr key={ord.executionId} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                          {new Date(ord.executedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(ord.symbol)}
                            className="font-mono font-semibold text-white hover:text-cyan-300 cursor-pointer"
                          >
                            {ord.symbol}
                          </button>{' '}
                          <span
                            className={`font-mono font-semibold ${
                              ord.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {ord.direction}
                          </span>
                          <span className="ml-1.5 text-[10px] text-slate-400">
                            {ord.sourceModule === 'PRE_PUMP_SUPPORT' ? 'PRE-PUMP' : 'ENTRY-ZONE'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono text-slate-200 tabular-nums whitespace-nowrap">
                          ${formatCryptoPrice(ord.executedPrice)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono text-emerald-300 tabular-nums whitespace-nowrap">
                          ${formatCryptoPrice(ord.maxProfitTarget)}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                            {ord.holdUntilMaxTarget && (
                              <span className="inline-flex items-center gap-1 text-cyan-300 font-semibold">
                                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                                HOLD→TP3
                              </span>
                            )}
                            <span className="text-slate-300">{ord.progressToMaxTargetPct}%</span>
                            {ord.earlyLiquidationBlockedCount > 0 && (
                              <span className="text-amber-300">
                                ({ord.earlyLiquidationBlockedCount} early exit blocked)
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          className={`py-2.5 pr-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                            pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {pnlUsd >= 0 ? '+' : '-'}${Math.abs(pnlUsd).toFixed(2)} (
                          {pnlPct >= 0 ? '+' : ''}
                          {pnlPct.toFixed(2)}%)
                        </td>
                        <td className="py-2.5 text-right font-mono text-[11px] whitespace-nowrap">
                          <span
                            className={
                              ord.status === 'LIQUIDATED_MAX_PROFIT'
                                ? 'text-emerald-400 font-semibold'
                                : ord.status === 'STOPPED_PROTECTIVE'
                                ? 'text-rose-400 font-semibold'
                                : 'text-cyan-300 font-semibold'
                            }
                          >
                            {ord.status === 'LIQUIDATED_MAX_PROFIT'
                              ? 'MAX PROFIT CLOSED'
                              : ord.status === 'STOPPED_PROTECTIVE'
                              ? 'SL PROTECTED'
                              : 'HOLDING LIVE'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
});
