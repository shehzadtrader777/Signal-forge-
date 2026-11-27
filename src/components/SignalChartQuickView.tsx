import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SignalChartSnapshot {
  signalId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  capturedAt: string;
  entryLow?: number | null;
  entryHigh?: number | null;
  stopLoss?: number | null;
  takeProfits?: readonly number[];
  strategy?: string;
  dataQuality?: 'LIVE' | 'CACHED' | 'STALE' | 'SIMULATED' | 'UNAVAILABLE';
}

interface SignalChartQuickViewProps {
  signal: SignalChartSnapshot | null;
  onClose: () => void;
  /** Pass the existing chart renderer for this exact signal. Never synthesize candles. */
  children: React.ReactNode;
}

function formatPrice(price: number | null | undefined): string {
  return typeof price === 'number' && Number.isFinite(price)
    ? price.toLocaleString('en-US', { maximumFractionDigits: 8 })
    : '—';
}

/**
 * An accessible, read-only overlay that does not navigate away from Signal History.
 * The caller must supply actual chart candles/overlays and validate their provenance.
 * No trading/exchange API calls or mode changes occur in this component.
 */
export function SignalChartQuickView({ signal, onClose, children }: SignalChartQuickViewProps) {
  const [fullScreen, setFullScreen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!signal || typeof document === 'undefined') return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      // Keep keyboard focus within the dialog rather than behind it.
      if (event.key === 'Tab') {
        const dialog = closeRef.current?.closest('[role="dialog"]');
        const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = priorOverflow;
      previousFocus?.focus();
    };
  }, [signal?.signalId, onClose]);

  useEffect(() => {
    setFullScreen(false);
  }, [signal?.signalId]);

  if (!signal || typeof document === 'undefined') return null;

  const label = `${signal.symbol} ${signal.timeframe} signal chart`;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-2 sm:p-6"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={label}
        className={`flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-600 bg-slate-950 text-white shadow-2xl ${fullScreen ? 'h-full max-w-none' : 'h-[min(85dvh,760px)] max-w-5xl'}`}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-700 p-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{signal.symbol} · {signal.direction} · {signal.timeframe}</h2>
            <p className="truncate text-xs text-slate-400">Signal ID: {signal.signalId} · {signal.dataQuality ?? 'UNVERIFIED DATA'}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" aria-label={fullScreen ? 'Exit full screen chart' : 'Expand chart to full screen'}
              className="rounded-md border border-slate-600 px-3 py-2 text-sm"
              onClick={() => setFullScreen(v => !v)}>{fullScreen ? 'Minimize' : 'Full screen'}</button>
            <button ref={closeRef} type="button" aria-label="Close signal chart"
              className="rounded-md border border-slate-600 px-3 py-2 text-sm" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-700 p-3 text-xs sm:grid-cols-4">
          <span>Entry: {formatPrice(signal.entryLow)}{signal.entryHigh !== signal.entryLow ? ` – ${formatPrice(signal.entryHigh)}` : ''}</span>
          <span>SL: {formatPrice(signal.stopLoss)}</span>
          <span>TP: {(signal.takeProfits ?? []).map(formatPrice).join(' / ') || '—'}</span>
          <span className="truncate">Strategy: {signal.strategy || '—'}</span>
        </div>
        <div className="min-h-0 flex-1 p-2" aria-label="Signal-specific chart viewport">
          {children}
        </div>
      </section>
    </div>, document.body
  );
}

export default SignalChartQuickView;
