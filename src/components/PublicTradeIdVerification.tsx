import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  Search,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { formatCryptoPrice } from '../lib/marketData';
import {
  lookupCanonicalTradeByExactId,
  type CanonicalTradeRecord,
} from '../lib/tradeLifecycleLedger';
import {
  classifyTradeEnvironment,
  computeVerifiedTradePnl,
  validatePublicTradeIdInput,
} from '../lib/publicSmartChartModel';
import { PublicTradeSmartChart } from './PublicTradeSmartChart';
import { AiChartScannerModal } from './AiChartScannerModal';

interface PublicTradeIdVerificationProps {
  ledgerRecords: readonly CanonicalTradeRecord[];
  requestedTradeId?: string | null;
  onClearRequestedTradeId?: () => void;
}

const TONE_BANNER_CLASSES = {
  slate: 'border-slate-700 bg-slate-900/90 text-slate-200',
  cyan: 'border-cyan-500/40 bg-cyan-950/35 text-cyan-200',
  amber: 'border-amber-500/40 bg-amber-950/35 text-amber-200',
  emerald: 'border-emerald-500/40 bg-emerald-950/35 text-emerald-200',
} as const;

/**
 * Separate, dedicated Trade ID Verification experience for the public homepage.
 * Before a valid Trade ID is submitted, displays zero fabricated trade results,
 * zero entry/exit annotations, and zero P&L claims.
 */
export function PublicTradeIdVerification({
  ledgerRecords,
  requestedTradeId,
  onClearRequestedTradeId,
}: PublicTradeIdVerificationProps) {
  const [tradeQuery, setTradeQuery] = useState<string>('');
  const [verifiedTrade, setVerifiedTrade] = useState<CanonicalTradeRecord | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [scannerOpen, setScannerOpen] = useState<boolean>(false);
  const [scannerVisible, setScannerVisible] = useState<boolean>(true);

  useEffect(() => {
    fetch('/api/scanner/status', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.featureVisible === 'boolean') {
          setScannerVisible(data.featureVisible);
        }
      })
      .catch(() => undefined);
  }, []);

  const runVerificationLookup = async (rawInput: string) => {
    const check = validatePublicTradeIdInput(rawInput);
    if (!check.valid) {
      setVerifiedTrade(null);
      setSearchError(check.error);
      return;
    }

    setSearchError(null);
    setIsVerifying(true);

    try {
      const res = await fetch(
        `/api/public/trade-ledger?tradeId=${encodeURIComponent(check.normalized)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && data.matched) {
          setVerifiedTrade(data.matched as CanonicalTradeRecord);
          setIsVerifying(false);
          return;
        }
      }
    } catch {
      // Fall back to already-fetched public ledger records in memory
    }

    const localMatch = lookupCanonicalTradeByExactId(check.normalized, ledgerRecords);
    if (localMatch) {
      setVerifiedTrade(localMatch);
      setSearchError(null);
    } else {
      setVerifiedTrade(null);
      setSearchError(
        `No public Trade ID matched "${check.normalized}". Verify the exact Trade ID from a published Signal Forge card (e.g. SF-2026-000103).`
      );
    }
    setIsVerifying(false);
  };

  // Respond when a visitor clicks "Verify on Chart" from the public ledger tables below
  useEffect(() => {
    if (!requestedTradeId) return;
    setTradeQuery(requestedTradeId);
    void runVerificationLookup(requestedTradeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTradeId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runVerificationLookup(tradeQuery);
  };

  const handleClear = () => {
    setTradeQuery('');
    setVerifiedTrade(null);
    setSearchError(null);
    onClearRequestedTradeId?.();
  };

  const envInfo = useMemo(
    () => (verifiedTrade ? classifyTradeEnvironment(verifiedTrade) : null),
    [verifiedTrade]
  );
  const pnlInfo = useMemo(
    () => (verifiedTrade ? computeVerifiedTradePnl(verifiedTrade) : null),
    [verifiedTrade]
  );

  return (
    <section
      id="trade-id-verification"
      aria-label="Trade ID Verification"
      data-testid="public-trade-id-verification"
      className="scroll-mt-20 rounded-xl border border-slate-800 bg-[#111827] overflow-hidden"
    >
      {/* Header & Search Form */}
      <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="font-mono text-xs text-blue-400">
            Independent Trade ID Verification
          </div>
          <h2 className="font-display text-xl font-bold text-white tracking-tight">
            Inspect Verified Trade History &amp; Interactive Smart Chart
          </h2>
          <p className="text-xs text-slate-400">
            Enter a published Signal Forge Trade ID to retrieve its actual market history, strategy, breakout pattern, entry/SL/TP levels, execution markers, environment mode, and verified P&amp;L.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row sm:items-center gap-2 w-full lg:w-auto"
        >
          <label htmlFor="public-trade-id-input" className="sr-only">
            Enter Public Trade ID
          </label>
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="public-trade-id-input"
              data-testid="public-trade-id-input"
              type="text"
              value={tradeQuery}
              onChange={(e) => setTradeQuery(e.target.value)}
              placeholder="Enter Trade ID (e.g. SF-2026-000103)"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] py-2 pl-9 pr-3 font-mono text-xs text-white placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="submit"
              disabled={isVerifying}
              data-testid="public-trade-id-verify-btn"
              className="flex-1 sm:flex-none rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
            >
              {isVerifying ? 'Verifying...' : 'Verify Trade ID'}
            </button>
            {scannerVisible && (
              <button
                type="button"
                data-testid="public-upload-chart-btn"
                onClick={() => setScannerOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-500/60 bg-blue-500/15 px-3.5 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/25 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Upload Chart</span>
              </button>
            )}
            {(verifiedTrade || searchError || tradeQuery) && (
              <button
                type="button"
                data-testid="public-trade-id-clear-btn"
                onClick={handleClear}
                aria-label="Clear Trade ID Verification"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Explicit Public Ledger Lookup Shortcuts (Never Auto-Selected) */}
      <div className="border-b border-slate-800/80 bg-[#0a0e1a]/70 px-5 py-2.5 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">Public ledger IDs:</span>
        {ledgerRecords
          .filter((rec) => rec.tradeId.startsWith('SF-2026-'))
          .slice(0, 4)
          .map((rec) => {
            const isSelected = verifiedTrade?.tradeId === rec.tradeId;
            const modeLabel =
              rec.recordClass === 'SIGNAL_ONLY' ? 'Signal Only' : rec.tradingMode;
            return (
              <button
                key={rec.tradeId}
                type="button"
                data-testid={`quick-verify-${rec.tradeId}`}
                onClick={() => {
                  setTradeQuery(rec.tradeId);
                  void runVerificationLookup(rec.tradeId);
                }}
                className={`max-w-full truncate rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                    : 'border-slate-800 bg-[#111827] text-slate-300 hover:border-slate-600 hover:text-white'
                }`}
              >
                {rec.tradeId} · {rec.pair} ({modeLabel})
              </button>
            );
          })}
      </div>

      {/* Body: Empty State OR Error OR Verified Smart Chart & Full Audit Record */}
      <div className="p-5">
        {searchError && (
          <div
            role="alert"
            data-testid="public-trade-id-error"
            className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200"
          >
            {searchError}
          </div>
        )}

        {!verifiedTrade ? (
          <div
            data-testid="trade-verification-empty-state"
            className="rounded-xl border border-dashed border-slate-800 bg-[#0a0e1a]/60 px-6 py-10 text-center space-y-3"
          >
            <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-[#111827] text-blue-400">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1 max-w-xl mx-auto">
              <h3 className="font-display text-base font-bold text-white">
                Enter a Trade ID to Load Its Verified Smart Chart
              </h3>
              <p className="text-xs leading-relaxed text-slate-400">
                No trade results, entry markers, or P&amp;L overlays are displayed until you verify a specific public Trade ID. Enter an ID above (or select a public ledger ID) to audit its real market candles, breakout structure, risk levels, execution status, and whether it ran in Paper, Demo, Live, or Signal-Only mode.
              </p>
            </div>
            <div className="pt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[11px] text-slate-500">
              <span>PAPER = Simulated Wallet</span>
              <span aria-hidden="true">·</span>
              <span>DEMO = Exchange Sandbox</span>
              <span aria-hidden="true">·</span>
              <span>LIVE = Authenticated Real Capital</span>
              <span aria-hidden="true">·</span>
              <span>SIGNAL ONLY = Unexecuted Analysis</span>
            </div>
          </div>
        ) : (
          <div data-testid="verified-trade-detail-panel" className="space-y-5">
            {/* Environment & Trade Status Verification Banner */}
            {envInfo && pnlInfo && (
              <div
                data-testid="verified-trade-environment-banner"
                className={`rounded-xl border px-4 py-3.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${
                  TONE_BANNER_CLASSES[envInfo.tone]
                }`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs">
                    <span className="inline-flex items-center gap-1.5 font-bold text-white">
                      <FileCheck2 className="h-4 w-4 text-blue-400" aria-hidden="true" />
                      {verifiedTrade.tradeId}
                    </span>
                    <span className="opacity-50" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={`font-bold ${
                        verifiedTrade.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {verifiedTrade.direction} {verifiedTrade.pair}
                    </span>
                    <span className="opacity-50" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-bold tracking-wide" data-testid="verified-trade-mode-label">
                      {envInfo.badgeLabel}
                    </span>
                  </div>
                  <p className="text-xs opacity-90">{envInfo.environmentDescription}</p>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs tabular-nums shrink-0">
                  <div>
                    <div className="font-sans text-[11px] text-slate-400">Trade Status</div>
                    <div className="font-semibold text-white" data-testid="verified-trade-status">
                      {envInfo.statusLabel}
                    </div>
                  </div>
                  <div>
                    <div className="font-sans text-[11px] text-slate-400">Verified P&amp;L</div>
                    <div
                      data-testid="verified-trade-pnl"
                      className={`font-bold ${
                        !pnlInfo.isRealized
                          ? 'text-slate-300'
                          : (pnlInfo.netPnlUsd ?? 0) >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {pnlInfo.displayLabel}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Interactive Smart Chart with Actual Market History, Patterns & Markers */}
            <PublicTradeSmartChart trade={verifiedTrade} />

            {/* Structured Contract Telemetry & Auditable Lifecycle Timeline */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="lg:col-span-7 space-y-4">
                <div className="space-y-1">
                  <div className="font-mono text-[11px] text-slate-400">
                    {verifiedTrade.exchange} · {verifiedTrade.timeframe} · Confidence{' '}
                    {verifiedTrade.confidence}% · Opened{' '}
                    {new Date(verifiedTrade.openedAtIso).toUTCString().slice(5, 22)} UTC
                    {verifiedTrade.closedAtIso
                      ? ` · Closed ${new Date(verifiedTrade.closedAtIso).toUTCString().slice(5, 22)} UTC`
                      : ''}
                  </div>
                  <h3 className="font-display text-base font-bold text-white">
                    {verifiedTrade.strategyName}
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-300">
                    {verifiedTrade.strategyExplanation}
                  </p>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                  <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                    <dt className="font-sans text-[11px] text-slate-400">Signal Price</dt>
                    <dd className="mt-1 font-semibold text-white">
                      ${formatCryptoPrice(verifiedTrade.signalPrice)}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                    <dt className="font-sans text-[11px] text-slate-400">Actual Fill</dt>
                    <dd className="mt-1 font-semibold text-white">
                      {verifiedTrade.actualExecutionPrice !== null
                        ? `$${formatCryptoPrice(verifiedTrade.actualExecutionPrice)}`
                        : 'Not Executed'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                    <dt className="font-sans text-[11px] text-slate-400">Stop Loss</dt>
                    <dd className="mt-1 font-semibold text-rose-400">
                      ${formatCryptoPrice(verifiedTrade.stopLoss)}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                    <dt className="font-sans text-[11px] text-slate-400">Take Profit</dt>
                    <dd className="mt-1 font-semibold text-emerald-400">
                      ${formatCryptoPrice(verifiedTrade.takeProfit)}
                    </dd>
                  </div>
                </dl>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                  <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                    <dt className="font-sans text-[11px] text-slate-400">Gross Realized</dt>
                    <dd
                      className={`mt-1 font-bold ${
                        pnlInfo?.grossPnlUsd === null || pnlInfo?.grossPnlUsd === undefined
                          ? 'text-slate-400'
                          : pnlInfo.grossPnlUsd >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {pnlInfo && pnlInfo.grossPnlUsd !== null
                        ? `${pnlInfo.grossPnlUsd >= 0 ? '+' : ''}$${pnlInfo.grossPnlUsd.toFixed(2)}`
                        : 'N/A'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                    <dt className="font-sans text-[11px] text-slate-400">Fees Deducted</dt>
                    <dd className="mt-1 font-semibold text-slate-200">
                      {verifiedTrade.feesUsd !== null ? `$${verifiedTrade.feesUsd.toFixed(2)}` : '—'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                    <dt className="font-sans text-[11px] text-slate-400">Slippage</dt>
                    <dd className="mt-1 font-semibold text-slate-200">
                      {verifiedTrade.slippageBps !== null
                        ? `${verifiedTrade.slippageBps >= 0 ? '+' : ''}${verifiedTrade.slippageBps} bps`
                        : '—'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                    <dt className="font-sans text-[11px] text-slate-400">Theoretical R:R</dt>
                    <dd className="mt-1 font-semibold text-blue-300">
                      1:{verifiedTrade.projectedRrRatio}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Auditable Lifecycle Timeline */}
              <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#0d1323] p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h4 className="font-display text-sm font-bold text-white">
                    Auditable Lifecycle Timeline
                  </h4>
                  <span className="font-mono text-[11px] text-slate-400">
                    {verifiedTrade.timeline.length} events
                  </span>
                </div>

                <ol className="space-y-3">
                  {verifiedTrade.timeline.map((evt) => (
                    <li key={evt.id} className="flex items-start gap-3 text-xs">
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 text-blue-400 shrink-0"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-100">{evt.title}</span>
                          <span className="font-mono text-[10px] text-slate-500 tabular-nums shrink-0">
                            {new Date(evt.timestampIso).toISOString().slice(11, 19)}Z
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-snug">{evt.detail}</p>
                        <div className="font-mono text-[10px] text-slate-500">
                          {evt.stage} · {evt.actor}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>

      <AiChartScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} />
    </section>
  );
}
