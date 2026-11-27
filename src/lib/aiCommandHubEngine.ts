/**
 * Signal Forge Floating Binance-Style AI Command Hub Engine (Gemini 4 Hydrogen).
 *
 * Pure, zero-I/O, strictly typed logic (zero `any`) handling:
 *  - Dynamic state dimming opacity across IDLE / EXPANDED / LISTENING / PROCESSING / RESULT
 *  - Compositor-friendly waveform simulation amplitudes
 *  - Consolidated pre-login navigation & command shortcut grids (compact + expanded)
 *  - Trade ID extraction and instant Trade Result Snapshot formatting
 *  - Strict allowlisted route sanitization
 */

import type { PublicVerifiedTradeRecord } from './multiAgentTradingArchitecture';

export type AiCommandHubVisualState =
  | 'IDLE'
  | 'EXPANDED'
  | 'LISTENING'
  | 'PROCESSING'
  | 'RESULT';

export type DockAuthPresentationMode =
  | 'PRE_LOGIN_STATIC_WAVEFORM'
  | 'LOGGED_IN_DRAGGABLE_HUB';

export function resolveDockPresentationMode(isLoggedIn: boolean): DockAuthPresentationMode {
  return isLoggedIn ? 'LOGGED_IN_DRAGGABLE_HUB' : 'PRE_LOGIN_STATIC_WAVEFORM';
}

export type ShortcutCategory = 'NAVIGATION' | 'COMMAND';

export interface CommandHubShortcutItem {
  readonly id: string;
  readonly label: string;
  readonly shortHint: string;
  readonly category: ShortcutCategory;
  readonly tier: 'PRIMARY' | 'EXTENDED';
  readonly route?: string;
  readonly voicePhrase?: string;
  readonly tone?: 'default' | 'gold' | 'danger';
  readonly keywords: readonly string[];
}

export interface TradeResultSnapshotView {
  readonly id: string;
  readonly badgeLabel: string;
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly marketLabel: string;
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly currentOrExitPrice: number | null;
  readonly pnlPct: number | null;
  readonly rrLabel: string;
  readonly confidencePct: number | null;
  readonly statusLabel: string;
  readonly verified: boolean;
  readonly integrityLabel: string;
  readonly digest: string | null;
  readonly patternLabel: string;
  readonly visualSnapshotSvgDataUri: string | null;
  readonly routeTarget: string;
}

export const ALLOWED_HUB_ROUTES: ReadonlySet<string> = new Set([
  '/',
  '/signals',
  '/portfolio',
  '/signal-history',
  '/backtesting',
  '/watchlist',
  '/alerts',
  '/auto-reports',
  '/settings',
  '/about',
  '/login',
]);

export const COMMAND_HUB_SHORTCUTS: readonly CommandHubShortcutItem[] = Object.freeze([
  // Primary compact row (always visible in collapsed grid)
  {
    id: 'nav-signals',
    label: 'Live Signals',
    shortHint: 'SMC & FRVP setups',
    category: 'NAVIGATION',
    tier: 'PRIMARY',
    route: '/signals',
    tone: 'gold',
    keywords: ['signals', 'coordinator', 'setups', 'entries'],
  },
  {
    id: 'nav-portfolio',
    label: 'Portfolio',
    shortHint: 'Exposure & PnL',
    category: 'NAVIGATION',
    tier: 'PRIMARY',
    route: '/portfolio',
    keywords: ['portfolio', 'wallet', 'positions', 'pnl', 'balance'],
  },
  {
    id: 'nav-settings',
    label: 'Settings Hub',
    shortHint: 'Command & Controls',
    category: 'NAVIGATION',
    tier: 'PRIMARY',
    route: '/settings',
    keywords: ['settings', 'config', 'preferences', 'command hub', 'controls'],
  },
  {
    id: 'cmd-status',
    label: 'Desk Status',
    shortHint: 'Voice health check',
    category: 'COMMAND',
    tier: 'PRIMARY',
    voicePhrase: 'status',
    keywords: ['status', 'health', 'telemetry', 'summary'],
  },

  // Extended grid items (revealed when shortcut grid expands)
  {
    id: 'nav-dashboard',
    label: 'Dashboard',
    shortHint: 'Master command deck',
    category: 'NAVIGATION',
    tier: 'EXTENDED',
    route: '/',
    keywords: ['dashboard', 'home', 'main', 'overview'],
  },
  {
    id: 'nav-history',
    label: 'Signal History',
    shortHint: 'Audit ledger',
    category: 'NAVIGATION',
    tier: 'EXTENDED',
    route: '/signal-history',
    keywords: ['history', 'signal history', 'ledger', 'past trades'],
  },
  {
    id: 'nav-backtesting',
    label: 'Backtesting',
    shortHint: '30/60/90d replay',
    category: 'NAVIGATION',
    tier: 'EXTENDED',
    route: '/backtesting',
    keywords: ['backtest', 'backtesting', 'replay', 'simulation'],
  },
  {
    id: 'nav-watchlist',
    label: 'Watchlist',
    shortHint: 'Tracked assets',
    category: 'NAVIGATION',
    tier: 'EXTENDED',
    route: '/watchlist',
    keywords: ['watchlist', 'favorites', 'pairs', 'coins'],
  },
  {
    id: 'nav-alerts',
    label: 'Price Alerts',
    shortHint: 'Trigger rules',
    category: 'NAVIGATION',
    tier: 'EXTENDED',
    route: '/alerts',
    keywords: ['alerts', 'notifications', 'triggers'],
  },
  {
    id: 'nav-reports',
    label: 'Auto-Reports',
    shortHint: 'Daily / Weekly',
    category: 'NAVIGATION',
    tier: 'EXTENDED',
    route: '/auto-reports',
    keywords: ['reports', 'auto-reports', 'digest', 'summary'],
  },
  {
    id: 'nav-about',
    label: 'Architecture',
    shortHint: 'Platform specs',
    category: 'NAVIGATION',
    tier: 'EXTENDED',
    route: '/about',
    keywords: ['about', 'architecture', 'docs', 'info'],
  },
  {
    id: 'cmd-tick',
    label: 'Run Tick',
    shortHint: 'Sync live engine',
    category: 'COMMAND',
    tier: 'EXTENDED',
    voicePhrase: 'run tick',
    keywords: ['tick', 'sync', 'refresh'],
  },
  {
    id: 'cmd-audit',
    label: 'Run Audit',
    shortHint: 'Sentinel check',
    category: 'COMMAND',
    tier: 'EXTENDED',
    voicePhrase: 'run audit',
    keywords: ['audit', 'sentinel', 'verify'],
  },
  {
    id: 'cmd-emergency',
    label: 'Emergency Halt',
    shortHint: 'Liquidate / stop',
    category: 'COMMAND',
    tier: 'EXTENDED',
    voicePhrase: 'emergency liquidate all',
    tone: 'danger',
    keywords: ['emergency', 'stop', 'halt', 'liquidate'],
  },
]);

/**
 * Dynamic backdrop dim opacity tuned to hub visual state.
 * Smoothly darkens the underlying dashboard when expanded, listening, or processing.
 */
export function computeBackdropDimOpacity(state: AiCommandHubVisualState): number {
  switch (state) {
    case 'IDLE':
      return 0;
    case 'EXPANDED':
      return 0.56;
    case 'RESULT':
      return 0.64;
    case 'PROCESSING':
      return 0.74;
    case 'LISTENING':
      return 0.8;
  }
}

/**
 * Generates deterministic, symmetric normalized bar heights (0.14 .. 1.0) for the
 * compositor-only (`scaleY`) audio waveform simulator.
 */
export function computeWaveformBarHeights(
  state: AiCommandHubVisualState,
  phaseRad: number,
  barCount = 20
): readonly number[] {
  const count = Math.max(8, Math.min(48, Math.round(barCount)));
  const bars: number[] = [];
  const mid = (count - 1) / 2;

  for (let i = 0; i < count; i += 1) {
    const distNorm = Math.abs(i - mid) / Math.max(1, mid);
    const envelope = Math.max(0.22, 1 - distNorm * 0.72);
    let amp = 0.18;

    if (state === 'IDLE') {
      amp = 0.16 + 0.06 * envelope;
    } else if (state === 'EXPANDED') {
      const wave = 0.5 + 0.5 * Math.sin(phaseRad * 0.9 + i * 0.42);
      amp = 0.18 + wave * 0.24 * envelope;
    } else if (state === 'LISTENING') {
      const primary = 0.5 + 0.5 * Math.sin(phaseRad * 2.6 + i * 0.65);
      const harmonic = 0.5 + 0.5 * Math.cos(phaseRad * 4.1 - i * 1.15);
      amp = 0.22 + (primary * 0.55 + harmonic * 0.25) * 0.95 * envelope;
    } else if (state === 'PROCESSING') {
      const sweep = 0.5 + 0.5 * Math.sin(phaseRad * 3.2 - i * 0.55);
      amp = 0.2 + sweep * 0.68 * envelope;
    } else {
      // RESULT state: calm harmonic settle
      const settle = 0.5 + 0.5 * Math.sin(phaseRad * 1.2 + i * 0.35);
      amp = 0.2 + settle * 0.32 * envelope;
    }

    bars.push(Number(Math.min(1, Math.max(0.14, amp)).toFixed(3)));
  }

  return bars;
}

/**
 * Extracts a cryptographic Trade ID (`SF-TRD-...`) from free-form text or voice transcript.
 */
export function extractTradeIdToken(input: string): string | null {
  const match = String(input || '')
    .toUpperCase()
    .match(/\bSF-TRD-[A-Z0-9-]{4,32}\b/);
  return match ? match[0] : null;
}

/**
 * Strictly validates that an AI-suggested or user-requested route belongs to the allowlist.
 */
export function sanitizeAllowedRoute(route: string | null | undefined): string | null {
  if (!route) return null;
  const trimmed = route.trim();
  return ALLOWED_HUB_ROUTES.has(trimmed) ? trimmed : null;
}

/**
 * Resolves a local navigation shortcut directly from concise voice/text phrasing
 * (e.g. "open settings", "go to backtesting", "show portfolio").
 */
export function resolveShortcutFromQuery(query: string): CommandHubShortcutItem | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  const navVerbPattern = /^(open|go to|navigate to|show|view|switch to)\s+/i;
  const cleaned = normalized.replace(navVerbPattern, '').trim();

  for (const item of COMMAND_HUB_SHORTCUTS) {
    if (item.category !== 'NAVIGATION') continue;
    if (item.label.toLowerCase() === cleaned) return item;
    if (item.keywords.some((kw) => kw === cleaned || (navVerbPattern.test(normalized) && cleaned.includes(kw)))) {
      return item;
    }
  }
  return null;
}

export function buildTradeResultSnapshotFromVerified(
  record: PublicVerifiedTradeRecord,
  verified: boolean,
  integrityStatus: string
): TradeResultSnapshotView {
  return {
    id: record.tradeId,
    badgeLabel: verified ? 'CRYPTOGRAPHICALLY VERIFIED' : `INTEGRITY: ${integrityStatus}`,
    symbol: record.symbol,
    direction: record.direction,
    marketLabel: record.market,
    entryPrice: record.entryPrice,
    stopLoss: record.stopLoss,
    takeProfit: record.takeProfit,
    currentOrExitPrice:
      record.realizedPnlPct !== null
        ? Number(
            (
              record.entryPrice *
              (1 + (record.direction === 'BUY' ? 1 : -1) * (record.realizedPnlPct / 100))
            ).toPrecision(7)
          )
        : null,
    pnlPct: record.realizedPnlPct,
    rrLabel: `1:${record.rrMultiplier.toFixed(1)}`,
    confidencePct: record.confidence,
    statusLabel: record.stage,
    verified,
    integrityLabel: integrityStatus,
    digest: record.cryptographicDigest,
    patternLabel: record.patternLabel,
    visualSnapshotSvgDataUri: record.visualSnapshotSvgDataUri,
    routeTarget: '/signals',
  };
}

export function buildTradeResultSnapshotFromExecution(
  pos: {
    readonly id: string;
    readonly symbol: string;
    readonly direction: 'BUY' | 'SELL';
    readonly entryPrice: number;
    readonly stopLoss: number;
    readonly takeProfit: number;
    readonly status: string;
    readonly notionalUsd: number;
    readonly marketType?: string;
  },
  livePrice: number
): TradeResultSnapshotView {
  const safeLive = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : pos.entryPrice;
  const rawPct =
    pos.entryPrice > 0 ? ((safeLive - pos.entryPrice) / pos.entryPrice) * 100 : 0;
  const signedPct = pos.direction === 'BUY' ? rawPct : -rawPct;
  const risk = Math.abs(pos.entryPrice - pos.stopLoss);
  const reward = Math.abs(pos.takeProfit - pos.entryPrice);
  const rr = risk > 0 ? reward / risk : 2.0;

  return {
    id: pos.id,
    badgeLabel: pos.status === 'OPEN' ? 'LIVE LEDGER POSITION' : 'HISTORICAL EXECUTION',
    symbol: pos.symbol,
    direction: pos.direction,
    marketLabel: pos.marketType ?? 'SPOT',
    entryPrice: pos.entryPrice,
    stopLoss: pos.stopLoss,
    takeProfit: pos.takeProfit,
    currentOrExitPrice: safeLive,
    pnlPct: Number(signedPct.toFixed(2)),
    rrLabel: `1:${rr.toFixed(1)}`,
    confidencePct: null,
    statusLabel: pos.status,
    verified: true,
    integrityLabel: 'LEDGER_VERIFIED',
    digest: null,
    patternLabel: `Notional $${Math.round(pos.notionalUsd).toLocaleString()}`,
    visualSnapshotSvgDataUri: null,
    routeTarget: pos.status === 'OPEN' ? '/portfolio' : '/signal-history',
  };
}
