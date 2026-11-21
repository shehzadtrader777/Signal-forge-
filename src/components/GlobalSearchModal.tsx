import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  History,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MOTION_120HZ_SPRINGS } from '../lib/designSystem';
import {
  GlobalSearchIndex,
  STATIC_FEATURE_SEARCH_DOCS,
  type SearchDocumentCategory,
  type SearchableDocument,
} from '../lib/globalSearchIndex';
import { verifyPublicTradeId } from '../lib/multiAgentTradingArchitecture';
import { useTradingArchitectureStore } from '../store/useTradingArchitectureStore';

const CATEGORY_TABS: readonly { id: SearchDocumentCategory | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'TRADE_ID_PROOF', label: 'Trade IDs' },
  { id: 'ACTIVE_TRADE', label: 'Active Trades' },
  { id: 'HISTORICAL_TRADE', label: 'History' },
  { id: 'FEATURE', label: 'Modules' },
];

export const GlobalSearchModal = memo(function GlobalSearchModal() {
  const navigate = useNavigate();
  const { pinnedSignals, executionState, tickers, setSelectedSymbol } = useApp();

  const open = useTradingArchitectureStore((s) => s.globalSearchOpen);
  const setOpen = useTradingArchitectureStore((s) => s.setGlobalSearchOpen);
  const toggleOpen = useTradingArchitectureStore((s) => s.toggleGlobalSearch);
  const verifiedTrades = useTradingArchitectureStore((s) => s.verifiedTrades);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchDocumentCategory | 'ALL'>('ALL');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Cmd/Ctrl + K global shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggleOpen();
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen, toggleOpen]);

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 40);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  const searchIndex = useMemo(() => {
    const docs: SearchableDocument[] = [...STATIC_FEATURE_SEARCH_DOCS];

    for (const trade of verifiedTrades) {
      docs.push({
        id: `proof_${trade.tradeId}`,
        category: 'TRADE_ID_PROOF',
        title: `${trade.tradeId} · ${trade.symbol} ${trade.direction}`,
        subtitle: `${trade.patternLabel} · Entry $${trade.entryPrice} · 1:${trade.rrMultiplier.toFixed(1)} · ${trade.stage}`,
        route: '/',
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        statusLabel: 'VERIFIED',
        pnlLabel:
          trade.realizedPnlPct !== null
            ? `${trade.realizedPnlPct >= 0 ? '+' : ''}${trade.realizedPnlPct.toFixed(2)}%`
            : `${trade.confidence}% Conf`,
        keywords: [
          trade.tradeId,
          trade.symbol,
          trade.direction,
          trade.market,
          trade.patternLabel,
          trade.stage,
          'verify',
          'proof',
        ],
      });
    }

    for (const pin of pinnedSignals) {
      const sym = pin.signal.symbol;
      const liveMark = tickers[sym]?.price ?? pin.signal.entryPrice;
      const rawPct =
        pin.signal.entryPrice > 0
          ? ((liveMark - pin.signal.entryPrice) / pin.signal.entryPrice) * 100
          : 0;
      const signedPct = pin.signal.direction === 'BUY' ? rawPct : -rawPct;
      docs.push({
        id: `active_${pin.signal.id}`,
        category: 'ACTIVE_TRADE',
        title: `${sym} ${pin.signal.direction} · Active Signal`,
        subtitle: `Entry $${pin.signal.entryPrice.toFixed(2)} · Confidence ${pin.signal.confidence}% · Status ${pin.status}`,
        route: '/signals',
        symbol: sym,
        statusLabel: pin.status,
        pnlLabel: `${signedPct >= 0 ? '+' : ''}${signedPct.toFixed(2)}%`,
        keywords: [sym, pin.signal.direction, pin.status, 'active', 'trade', 'signal'],
      });
    }

    for (const pos of executionState.positions.slice(0, 40)) {
      const isClosed = pos.status !== 'OPEN';
      const marketLabel = pos.marketType ?? 'SPOT';
      const mark = tickers[pos.symbol]?.price ?? pos.entryPrice;
      const rawPct =
        pos.entryPrice > 0 ? ((mark - pos.entryPrice) / pos.entryPrice) * 100 : 0;
      const signedPct = pos.direction === 'BUY' ? rawPct : -rawPct;
      docs.push({
        id: `pos_${pos.id}`,
        category: isClosed ? 'HISTORICAL_TRADE' : 'ACTIVE_TRADE',
        title: `${pos.symbol} ${pos.direction} · ${marketLabel} (${pos.status})`,
        subtitle: `Order ${pos.id} · Entry $${pos.entryPrice} · Notional $${Math.round(pos.notionalUsd)}`,
        route: isClosed ? '/signal-history' : '/portfolio',
        tradeId: pos.id,
        symbol: pos.symbol,
        statusLabel: pos.status,
        pnlLabel: `${signedPct >= 0 ? '+' : ''}${signedPct.toFixed(2)}%`,
        keywords: [pos.id, pos.symbol, pos.direction, pos.status, marketLabel, 'history', 'order'],
      });
    }

    return new GlobalSearchIndex(docs);
  }, [executionState.positions, pinnedSignals, tickers, verifiedTrades]);

  const results = useMemo(
    () => searchIndex.search(query, category, 18),
    [searchIndex, query, category]
  );

  const directVerification = useMemo(() => {
    const clean = query.trim().toUpperCase();
    if (!clean.startsWith('SF-TRD-')) return null;
    return verifyPublicTradeId(clean, verifiedTrades);
  }, [query, verifiedTrades]);

  const handleSelectResult = useCallback(
    (doc: SearchableDocument) => {
      if (doc.symbol) {
        setSelectedSymbol(doc.symbol);
      }
      setOpen(false);
      navigate(doc.route);
    },
    [navigate, setOpen, setSelectedSymbol]
  );

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-16 sm:pt-24"
          role="dialog"
          aria-modal="true"
          aria-label="Global Indexed Search & Trade ID Verifier"
          data-testid="global-search-modal"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-[#030712]/80"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={MOTION_120HZ_SPRINGS.snappy}
            className="relative z-10 w-full max-w-2xl rounded-xl border border-slate-700/90 bg-[#070d1b] shadow-2xl overflow-hidden text-slate-100"
          >
            {/* Search Input Bar */}
            <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3.5">
              <Search className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search features, pairs (BTCUSDT), active/historical trades, or Trade ID (SF-TRD-...)..."
                aria-label="Global search query"
                data-testid="global-search-input"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
              <span className="hidden sm:inline font-mono text-[10px] text-slate-500">
                {searchIndex.size} indexed
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close Global Search"
                data-testid="global-search-close-btn"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Category Filter Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0b1325] px-4 py-2">
              <div className="flex items-center gap-1" role="tablist" aria-label="Search Categories">
                {CATEGORY_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={category === tab.id}
                    onClick={() => setCategory(tab.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      category === tab.id
                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                        : 'text-slate-400 hover:text-white border border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {verifiedTrades[0] && (
                <button
                  type="button"
                  onClick={() => setQuery(verifiedTrades[0].tradeId)}
                  className="font-mono text-[10px] text-cyan-400 hover:text-cyan-300 cursor-pointer truncate max-w-[230px]"
                >
                  Verify sample: {verifiedTrades[0].tradeId}
                </button>
              )}
            </div>

            {/* Direct Cryptographic Trade ID Verification Card */}
            {directVerification && (
              <div
                data-testid="global-search-trade-verification"
                className={`border-b border-slate-800 px-4 py-3 ${
                  directVerification.verified ? 'bg-emerald-500/10' : 'bg-rose-500/10'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <CheckCircle2
                        className={`h-4 w-4 shrink-0 ${
                          directVerification.verified ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span
                        className={
                          directVerification.verified ? 'text-emerald-300' : 'text-rose-300'
                        }
                      >
                        {directVerification.verified
                          ? 'Cryptographic Trade ID Authentic'
                          : `Verification Status: ${directVerification.integrityStatus}`}
                      </span>
                    </div>
                    {directVerification.record && (
                      <div className="font-mono text-[11px] text-slate-300 tabular-nums">
                        {directVerification.record.symbol} {directVerification.record.direction} ·
                        Entry ${directVerification.record.entryPrice} · TP $
                        {directVerification.record.takeProfit} (1:
                        {directVerification.record.rrMultiplier.toFixed(1)}) · Digest{' '}
                        {directVerification.record.cryptographicDigest}
                      </div>
                    )}
                  </div>
                  {directVerification.record && (
                    <img
                      src={directVerification.record.visualSnapshotSvgDataUri}
                      alt={`Chart proof snapshot for ${directVerification.record.tradeId}`}
                      className="h-16 w-36 rounded border border-slate-700 object-cover shrink-0"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Indexed Results List */}
            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800/70">
              {results.length === 0 ? (
                <div className="px-5 py-10 text-center text-xs text-slate-400">
                  No indexed features, trades, or Trade IDs matched &ldquo;{query}&rdquo;.
                </div>
              ) : (
                results.map(({ doc, matchedField }) => (
                  <button
                    key={doc.id}
                    type="button"
                    data-testid={`search-result-${doc.id}`}
                    onClick={() => handleSelectResult(doc)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#0d1526] transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="mt-0.5 text-slate-400 shrink-0">
                        {doc.category === 'TRADE_ID_PROOF' ? (
                          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                        ) : doc.category === 'ACTIVE_TRADE' ? (
                          <TrendingUp className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                        ) : doc.category === 'HISTORICAL_TRADE' ? (
                          <History className="h-4 w-4 text-amber-400" aria-hidden="true" />
                        ) : (
                          <SlidersHorizontal className="h-4 w-4 text-blue-400" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                          <span className="truncate">{doc.title}</span>
                          {matchedField === 'EXACT_TRADE_ID' && (
                            <span className="font-mono text-[10px] text-emerald-400">
                              · Exact Trade ID
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                          {doc.subtitle}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {doc.pnlLabel && (
                        <span className="font-mono text-[11px] font-semibold text-cyan-300 tabular-nums">
                          {doc.pnlLabel}
                        </span>
                      )}
                      <ArrowRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Footer Key Hints */}
            <div className="flex items-center justify-between border-t border-slate-800 bg-[#0b1325] px-4 py-2 font-mono text-[10px] text-slate-500">
              <span>Indexed: Modules · Active Trades · Historical Ledger · Cryptographic Trade IDs</span>
              <span>ESC to close · Ctrl/⌘K</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
});
