import { memo, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownRight, ArrowUpRight, Calculator, Lock, ShieldCheck, X, Zap } from 'lucide-react';
import type { TradingSignal } from '../lib/signals';
import { formatCryptoPrice } from '../lib/marketData';
import type { PinnedSignalRecord } from '../lib/pinnedSignals';

interface SignalDetailModalProps {
  signal: TradingSignal | null;
  layoutId: string | null;
  pinnedRecord?: PinnedSignalRecord;
  onClose: () => void;
  onExecuteBuy: (signal: TradingSignal) => void;
  onOpenRiskCalc: (signal: TradingSignal) => void;
}

export const SignalDetailModal = memo(function SignalDetailModal({
  signal,
  layoutId,
  pinnedRecord,
  onClose,
  onExecuteBuy,
  onOpenRiskCalc,
}: SignalDetailModalProps) {
  useEffect(() => {
    if (!signal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [signal, onClose]);

  const isBuy = signal?.direction === 'BUY';

  return (
    <AnimatePresence>
      {signal && layoutId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${signal.symbol} Signal Detail View`}
          data-testid="signal-detail-shared-modal"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#02050d]/80 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* Shared Element Morph Container */}
          <motion.article
            layoutId={layoutId}
            transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.72 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.08, bottom: 0.35 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 500) {
                onClose();
              }
            }}
            className="cyber-surface relative z-10 w-full max-w-2xl rounded-2xl border border-cyan-400/40 p-6 shadow-2xl overflow-hidden"
          >
            {/* Swipe Handle Indicator */}
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" aria-hidden="true" />

            <div className="flex items-start justify-between gap-4 border-b border-slate-800/90 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="text-cyan-300 font-medium">Shared Element Inspection</span>
                  <span aria-hidden="true">·</span>
                  <span>{signal.indicators?.pattern || 'Autonomous AI Setup'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-white font-semibold">
                    {signal.confidence}% Confidence
                  </span>
                </div>
                <h2 className="mt-1 font-display text-2xl font-bold text-white flex items-center gap-2.5">
                  <span>{signal.coinName}</span>
                  <span className="font-mono text-sm font-medium text-slate-400">
                    ({signal.symbol})
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${
                      isBuy
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {isBuy ? (
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {signal.direction}
                  </span>
                </h2>
              </div>

              <motion.button
                whileTap={{ scale: 0.92 }}
                type="button"
                onClick={onClose}
                aria-label="Close signal detail modal"
                className="rounded-lg border border-slate-700 bg-[#050914] p-2 text-slate-300 hover:border-cyan-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </motion.button>
            </div>

            {/* Key Levels Grid */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-[#060c1b] p-3">
                <div className="text-[11px] font-sans text-slate-400">Entry Anchor</div>
                <div className="mt-1 text-base font-bold text-white">
                  ${formatCryptoPrice(signal.entryPrice)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#060c1b] p-3">
                <div className="text-[11px] font-sans text-slate-400">ATR Trailing SL</div>
                <div className="mt-1 text-base font-bold text-amber-300">
                  ${formatCryptoPrice(pinnedRecord?.trailingStopLoss ?? signal.trailingStop ?? signal.stopLoss)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#060c1b] p-3">
                <div className="text-[11px] font-sans text-slate-400">Max Target (TP3)</div>
                <div className="mt-1 text-base font-bold text-emerald-400">
                  ${formatCryptoPrice(signal.takeProfits[2])}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#060c1b] p-3">
                <div className="text-[11px] font-sans text-slate-400">Min R:R Floor</div>
                <div className="mt-1 text-base font-bold text-cyan-300">
                  1:{signal.dynamicRRs?.[2] ?? 5.0}
                </div>
              </div>
            </div>

            {/* TP Ladder */}
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              {signal.takeProfits.map((tp, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 font-mono tabular-nums"
                >
                  <div className="text-[10px] font-sans text-slate-400">
                    TP{idx + 1} · {signal.dynamicRRs?.[idx] ?? (idx === 0 ? 2 : idx === 1 ? 3.5 : 5)}R
                  </div>
                  <div className="mt-0.5 text-sm font-bold text-emerald-400">
                    ${formatCryptoPrice(tp)}
                  </div>
                </div>
              ))}
            </div>

            {/* Governance & Rationale */}
            <div className="mt-4 rounded-lg border border-slate-800 bg-[#060c1b] p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-200">
                <ShieldCheck className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                <span>Execution Thesis &amp; Kernel Verification</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-300">{signal.reason}</p>
              {pinnedRecord && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-300 pt-1">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    Pinned Status: {pinnedRecord.status} · Live Mark ${formatCryptoPrice(pinnedRecord.currentPrice)} (
                    {pinnedRecord.unrealizedR >= 0 ? '+' : ''}
                    {pinnedRecord.unrealizedR}R)
                  </span>
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRiskCalc(signal);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#050914] px-4 py-2 text-xs font-semibold text-white hover:border-cyan-400 transition-colors cursor-pointer"
              >
                <Calculator className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                <span>Open Risk Calculator</span>
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => {
                  onClose();
                  onExecuteBuy(signal);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer"
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Route to Execution Hub</span>
              </motion.button>
            </div>
          </motion.article>
        </div>
      )}
    </AnimatePresence>
  );
});
