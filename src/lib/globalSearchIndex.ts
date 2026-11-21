export type SearchDocumentCategory =
  | 'FEATURE'
  | 'ACTIVE_TRADE'
  | 'HISTORICAL_TRADE'
  | 'TRADE_ID_PROOF';

export interface SearchableDocument {
  readonly id: string;
  readonly category: SearchDocumentCategory;
  readonly title: string;
  readonly subtitle: string;
  readonly route: string;
  readonly tradeId?: string;
  readonly symbol?: string;
  readonly statusLabel?: string;
  readonly pnlLabel?: string;
  readonly keywords: readonly string[];
}

export interface RankedSearchResult {
  readonly doc: SearchableDocument;
  readonly score: number;
  readonly matchedField: 'EXACT_TRADE_ID' | 'SYMBOL_PREFIX' | 'TITLE' | 'TOKEN_INDEX';
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9._:-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * In-memory inverted-index Global Search Engine supporting sub-millisecond
 * queries across system modules, active trades, historical ledger records,
 * and cryptographic public Trade IDs (SF-TRD-...).
 */
export class GlobalSearchIndex {
  private readonly docsById = new Map<string, SearchableDocument>();
  private readonly invertedIndex = new Map<string, Set<string>>();
  private readonly tradeIdMap = new Map<string, string>();

  constructor(initialDocs: readonly SearchableDocument[] = []) {
    this.rebuild(initialDocs);
  }

  rebuild(docs: readonly SearchableDocument[]): void {
    this.docsById.clear();
    this.invertedIndex.clear();
    this.tradeIdMap.clear();

    for (const doc of docs) {
      this.docsById.set(doc.id, doc);
      if (doc.tradeId) {
        this.tradeIdMap.set(doc.tradeId.toUpperCase(), doc.id);
      }

      const tokenPool = new Set<string>([
        ...tokenize(doc.title),
        ...tokenize(doc.subtitle),
        ...tokenize(doc.symbol ?? ''),
        ...tokenize(doc.tradeId ?? ''),
        ...doc.keywords.flatMap((kw) => tokenize(kw)),
      ]);

      for (const tok of tokenPool) {
        let bucket = this.invertedIndex.get(tok);
        if (!bucket) {
          bucket = new Set<string>();
          this.invertedIndex.set(tok, bucket);
        }
        bucket.add(doc.id);
      }
    }
  }

  get size(): number {
    return this.docsById.size;
  }

  search(
    rawQuery: string,
    categoryFilter: SearchDocumentCategory | 'ALL' = 'ALL',
    limit = 20
  ): RankedSearchResult[] {
    const query = rawQuery.trim();
    const upperQuery = query.toUpperCase();
    const lowerQuery = query.toLowerCase();

    if (!query) {
      return Array.from(this.docsById.values())
        .filter((d) => categoryFilter === 'ALL' || d.category === categoryFilter)
        .slice(0, limit)
        .map((doc) => ({ doc, score: 10, matchedField: 'TITLE' }));
    }

    // Fast path: exact cryptographic Trade ID lookup
    const exactId = this.tradeIdMap.get(upperQuery);
    const resultsMap = new Map<string, RankedSearchResult>();

    if (exactId) {
      const doc = this.docsById.get(exactId);
      if (doc && (categoryFilter === 'ALL' || doc.category === categoryFilter)) {
        resultsMap.set(doc.id, { doc, score: 1000, matchedField: 'EXACT_TRADE_ID' });
      }
    }

    const queryTokens = tokenize(query);

    for (const doc of this.docsById.values()) {
      if (categoryFilter !== 'ALL' && doc.category !== categoryFilter) continue;
      if (resultsMap.has(doc.id)) continue;

      const titleLower = doc.title.toLowerCase();
      const subtitleLower = doc.subtitle.toLowerCase();
      const symbolLower = (doc.symbol ?? '').toLowerCase();
      const tradeIdLower = (doc.tradeId ?? '').toLowerCase();

      let score = 0;
      let matchedField: RankedSearchResult['matchedField'] = 'TOKEN_INDEX';

      if (tradeIdLower && tradeIdLower.includes(lowerQuery)) {
        score += 500;
        matchedField = 'EXACT_TRADE_ID';
      } else if (symbolLower && (symbolLower === lowerQuery || symbolLower.startsWith(lowerQuery))) {
        score += 320;
        matchedField = 'SYMBOL_PREFIX';
      } else if (titleLower.includes(lowerQuery)) {
        score += titleLower.startsWith(lowerQuery) ? 260 : 180;
        matchedField = 'TITLE';
      } else if (subtitleLower.includes(lowerQuery)) {
        score += 110;
        matchedField = 'TOKEN_INDEX';
      }

      // Inverted index multi-term prefix scoring
      let tokenHits = 0;
      for (const qt of queryTokens) {
        const directBucket = this.invertedIndex.get(qt);
        if (directBucket?.has(doc.id)) {
          tokenHits += 1;
          score += 55;
        } else {
          // Prefix scan for partial typing (e.g. "pre-p" or "sf-trd")
          for (const [indexedTok, ids] of this.invertedIndex.entries()) {
            if (indexedTok.startsWith(qt) && ids.has(doc.id)) {
              tokenHits += 1;
              score += 30;
              break;
            }
          }
        }
      }

      if (queryTokens.length > 1 && tokenHits === queryTokens.length) {
        score += 85;
      }

      if (score > 0) {
        resultsMap.set(doc.id, { doc, score, matchedField });
      }
    }

    return Array.from(resultsMap.values())
      .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
      .slice(0, limit);
  }
}

export const STATIC_FEATURE_SEARCH_DOCS: readonly SearchableDocument[] = [
  {
    id: 'feat_dashboard',
    category: 'FEATURE',
    title: 'Master Trading Dashboard',
    subtitle: 'Live TradingView chart, Multi-Agent Command Orchestrator, Entry-Zone signals & Pre-Pump Desk',
    route: '/',
    keywords: ['dashboard', 'home', 'chart', 'overview', 'multi-agent', 'orchestrator'],
  },
  {
    id: 'feat_settings_hub',
    category: 'FEATURE',
    title: 'Settings · Command & Control Hub',
    subtitle: 'Hybrid Master Override + 29 granular module toggles, dock controls, and theme pipeline',
    route: '/settings',
    keywords: ['settings', 'control panel', 'toggle', 'master override', 'command hub', 'dock'],
  },
  {
    id: 'feat_signals',
    category: 'FEATURE',
    title: 'Coordinator & Active Signals',
    subtitle: 'Multi-agent signal generation, 1:5 to 1:25 dynamic profit multipliers & Skeptic debate',
    route: '/signals',
    keywords: ['signals', 'coordinator', 'multiplier', 'debate', 'rr', 'take profit'],
  },
  {
    id: 'feat_signal_history',
    category: 'FEATURE',
    title: 'Signal History & Verified P&L Audit',
    subtitle: 'Historical trades, hit TP milestones, and cryptographic public Trade ID records',
    route: '/signal-history',
    keywords: ['history', 'audit', 'pnl', 'trade id', 'past trades', 'verify'],
  },
  {
    id: 'feat_backtesting',
    category: 'FEATURE',
    title: '30/60/90d Backtesting & Auto-Optimizer',
    subtitle: 'Walk-forward comparative matrix and continuous parameter optimization',
    route: '/backtesting',
    keywords: ['backtest', 'optimizer', 'sharpe', 'strategy', 'walk-forward', 'simulation'],
  },
  {
    id: 'feat_portfolio',
    category: 'FEATURE',
    title: 'Multi-Asset Portfolio & Volume Tiers',
    subtitle: 'Volatility-weighted rebalancer, volume-based fee tiers & Profit Vault locker',
    route: '/portfolio',
    keywords: ['portfolio', 'vault', 'tiers', 'fees', 'rebalancer', 'capital'],
  },
  {
    id: 'feat_alerts',
    category: 'FEATURE',
    title: 'Price Alerts & Dual-Stream Notifications',
    subtitle: 'Public Telegram signal cards, visual snapshots, and 30-min exclusive developer audit logs',
    route: '/alerts',
    keywords: ['alerts', 'telegram', 'webhook', 'notifications', 'audit logs'],
  },
  {
    id: 'feat_auto_reports',
    category: 'FEATURE',
    title: 'Automated Daily / Weekly / Monthly Reports',
    subtitle: 'Scheduled performance summaries and developer diagnostic digests',
    route: '/auto-reports',
    keywords: ['reports', 'daily', 'weekly', 'monthly', 'summary', 'digest'],
  },
  {
    id: 'feat_watchlist',
    category: 'FEATURE',
    title: 'Priority Coin Watchlist',
    subtitle: 'Pinned pairs with real-time Binance Spot WebSocket price feeds',
    route: '/watchlist',
    keywords: ['watchlist', 'coins', 'pairs', 'favorites', 'binance'],
  },
] as const;
