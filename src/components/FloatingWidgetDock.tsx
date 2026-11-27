import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  History,
  LayoutGrid,
  Loader2,
  Mic,
  MicOff,
  Power,
  Radio,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import { MOTION_120HZ_SPRINGS } from '../lib/designSystem';
import { resolveModuleEffectiveState } from '../lib/commandControlHub';
import {
  GlobalSearchIndex,
  STATIC_FEATURE_SEARCH_DOCS,
  type SearchableDocument,
} from '../lib/globalSearchIndex';
import { verifyPublicTradeId } from '../lib/multiAgentTradingArchitecture';
import {
  COMMAND_HUB_SHORTCUTS,
  buildTradeResultSnapshotFromExecution,
  buildTradeResultSnapshotFromVerified,
  computeBackdropDimOpacity,
  computeWaveformBarHeights,
  extractTradeIdToken,
  resolveDockPresentationMode,
  resolveShortcutFromQuery,
  type AiCommandHubVisualState,
  type CommandHubShortcutItem,
  type TradeResultSnapshotView,
} from '../lib/aiCommandHubEngine';
import type { VoiceListeningMode } from '../lib/voiceCommandAgent';
import {
  COMMAND_CLIENT_TIMEOUT_MS,
  classifyCommandClientError,
  matchDeterministicCommandIntent,
  parseSafeCommandHubResponse,
  type CommandErrorCategory,
  type GeminiQuotaScope,
  type ModelQuotaDiagnosticEntry,
} from '../lib/voiceCommandDiagnostics';
import { useCommandControlStore } from '../store/useCommandControlStore';
import { useTradingArchitectureStore } from '../store/useTradingArchitectureStore';
import { OfficialGeminiLogo } from './FooterSocialAndContact';

interface HubResponseView {
  readonly ok: boolean;
  readonly text: string;
  readonly urduMessage?: string | null;
  readonly model: string;
  readonly followUps: readonly string[];
  readonly httpStatus?: number;
  readonly errorCategory?: CommandErrorCategory;
  readonly code?: string;
  readonly diagnosticId?: string;
  readonly quotaScope?: GeminiQuotaScope;
  readonly retryAfterSeconds?: number | null;
  readonly modelQuotaBreakdown?: readonly ModelQuotaDiagnosticEntry[];
  readonly responseContentType?: string | null;
  readonly responseRedirected?: boolean;
  readonly responseUrlPath?: string | null;
  readonly responseBodySnippet?: string | null;
  readonly source?: 'VOICE' | 'TEXT';
}

const WAVEFORM_BAR_COUNT = 22;
const TAP_RING_RADIUS = 18;
const TAP_RING_CIRCUMFERENCE = 2 * Math.PI * TAP_RING_RADIUS;

function formatSnapshotPrice(price: number): string {
  if (!Number.isFinite(price)) return '—';
  if (price >= 1000) {
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  return `$${price.toFixed(5)}`;
}

export interface FloatingWidgetDockProps {
  readonly isLoggedIn?: boolean;
  readonly userRole?: string;
}

const COMPACT_WAVEFORM_BARS: readonly number[] = [0.38, 0.76, 0.52, 0.94, 0.44];
const LAUNCHER_HOVER = { scale: 1.05 } as const;
const LAUNCHER_TAP = { scale: 0.94 } as const;
const TAP_TO_TOP_HOVER = { y: -3, scale: 1.04 } as const;
const TAP_TO_TOP_TAP = { scale: 0.92 } as const;
const TAP_TO_TOP_ANIMATE_SCROLLED = { opacity: 1, scale: 1 } as const;
const TAP_TO_TOP_ANIMATE_IDLE = { opacity: 0.85, scale: 0.96 } as const;
const PRELOGIN_BTN_HOVER = { y: -2, scale: 1.02 } as const;
const PRELOGIN_BTN_TAP = { scale: 0.95 } as const;
const WAVEFORM_BAR_INITIAL = { scaleY: 0.35 } as const;
const COMPACT_BAR_ANIMATE_ACTIVE = COMPACT_WAVEFORM_BARS.map((peak) => ({
  scaleY: [0.3, peak, 0.35],
}));
const COMPACT_BAR_ANIMATE_IDLE = COMPACT_WAVEFORM_BARS.map((peak) => ({
  scaleY: [0.32, peak * 0.78, 0.32],
}));
const COMPACT_BAR_TRANSITION_LISTENING = COMPACT_WAVEFORM_BARS.map((_, idx) => ({
  repeat: Infinity,
  duration: 0.65,
  delay: idx * 0.11,
  ease: 'easeInOut' as const,
}));
const COMPACT_BAR_TRANSITION_IDLE = COMPACT_WAVEFORM_BARS.map((_, idx) => ({
  repeat: Infinity,
  duration: 1.35,
  delay: idx * 0.11,
  ease: 'easeInOut' as const,
}));

const BACKDROP_INITIAL = { opacity: 0 } as const;
const BACKDROP_EXIT = { opacity: 0 } as const;
const BACKDROP_TRANSITION = { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const } as const;
const OVERLAY_INITIAL = { opacity: 0, y: 18, scale: 0.96 } as const;
const OVERLAY_ANIMATE = { opacity: 1, y: 0, scale: 1 } as const;
const OVERLAY_EXIT = { opacity: 0, y: 14, scale: 0.96 } as const;
const SNAPSHOT_INITIAL = { opacity: 0, y: 8, scale: 0.98 } as const;
const SNAPSHOT_ANIMATE = { opacity: 1, y: 0, scale: 1 } as const;
const SNAPSHOT_EXIT = { opacity: 0, y: 6, scale: 0.98 } as const;

const EMPTY_SEARCH_INDEX = new GlobalSearchIndex([]);

interface HubWaveformVisualizerProps {
  readonly open: boolean;
  readonly hubVisualState: AiCommandHubVisualState;
  readonly micActive: boolean;
  readonly audioLevel: number;
}

const HubWaveformVisualizer = memo(function HubWaveformVisualizer({
  open,
  hubVisualState,
  micActive,
  audioLevel,
}: HubWaveformVisualizerProps) {
  const [wavePhase, setWavePhase] = useState(0);
  const waveRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    let lastTime = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.08, (now - lastTime) / 1000);
      lastTime = now;
      acc += dt;
      if (acc >= 0.042) {
        const step = acc;
        acc = 0;
        setWavePhase((prev) => (prev + step * 3.1) % (Math.PI * 200));
      }
      waveRafRef.current = window.requestAnimationFrame(tick);
    };
    waveRafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (waveRafRef.current !== null) {
        window.cancelAnimationFrame(waveRafRef.current);
        waveRafRef.current = null;
      }
    };
  }, [open]);

  const waveformBars = useMemo(() => {
    const base = computeWaveformBarHeights(hubVisualState, wavePhase, WAVEFORM_BAR_COUNT);
    if (hubVisualState === 'LISTENING') {
      const activityScale = Math.max(0.28, Math.min(1, audioLevel || 0.35));
      return base.map((h) => Number(Math.max(0.14, Math.min(1, 0.16 + h * activityScale)).toFixed(3)));
    }
    return base;
  }, [hubVisualState, audioLevel, wavePhase]);

  return (
    <div
      data-testid="ai-hub-waveform"
      data-waveform-state={hubVisualState}
      data-mic-active={micActive ? 'true' : 'false'}
      aria-hidden="true"
      className="flex h-11 items-center justify-center gap-[4px] rounded-lg bg-[#0B0E11] px-3 border border-[#1E2329]"
    >
      {waveformBars.map((height, idx) => (
        <span
          key={idx}
          style={{ transform: `scaleY(${height})` }}
          className={`h-8 w-[3px] origin-center rounded-full transition-transform duration-75 ${
            hubVisualState === 'LISTENING'
              ? 'bg-[#F0B90B]'
              : hubVisualState === 'PROCESSING'
              ? 'bg-cyan-400'
              : idx % 2 === 0
              ? 'bg-[#F0B90B]/70'
              : 'bg-cyan-400/55'
          }`}
        />
      ))}
    </div>
  );
});

export const FloatingWidgetDock = memo(function FloatingWidgetDock({
  isLoggedIn,
  userRole,
}: FloatingWidgetDockProps = {}) {
  const navigate = useNavigate();
  const {
    user,
    appLiveEnabled,
    voiceAgent,
    pinnedSignals,
    executionState,
    tickers,
    setSelectedSymbol,
    setVoiceMode,
    startPushToTalk,
    stopVoiceListening,
    testMicrophoneCapture,
    executeVoiceCommand,
  } = useApp();

  const effectiveLoggedIn = isLoggedIn ?? Boolean(user);
  const dockMode = resolveDockPresentationMode(effectiveLoggedIn);

  const hub = useCommandControlStore((s) => s.hub);
  const voiceOverlayOpen = useCommandControlStore((s) => s.voiceOverlayOpen);
  const setVoiceOverlayOpen = useCommandControlStore((s) => s.setVoiceOverlayOpen);
  const toggleVoiceOverlay = useCommandControlStore((s) => s.toggleVoiceOverlay);
  const verifiedTrades = useTradingArchitectureStore((s) => s.verifiedTrades);

  const [isScrolled, setIsScrolled] = useState(false);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [commandInput, setCommandInput] = useState('');
  const [shortcutsExpanded, setShortcutsExpanded] = useState(false);
  const [auditExpanded, setAuditExpanded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [overlayFeedback, setOverlayFeedback] = useState<string | null>(null);
  const [geminiResponse, setGeminiResponse] = useState<HubResponseView | null>(null);
  const [activeSnapshot, setActiveSnapshot] = useState<TradeResultSnapshotView | null>(null);

  const scrollRafRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const viewportDragBoundsRef = useRef<HTMLDivElement | null>(null);
  const didDragRef = useRef(false);
  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const activeAbortReasonRef = useRef<'TIMEOUT' | 'USER_CANCELLED' | 'SUPERSEDED' | null>(null);
  const activeRequestSeqRef = useRef<number>(0);
  const activeRequestPromptRef = useRef<string | null>(null);
  const lastHandledSpeechEventRef = useRef<number | null>(voiceAgent.lastSpeechEventAt);

  const handleLauncherDragStart = useCallback(() => {
    didDragRef.current = true;
  }, []);

  const handleLauncherDragEnd = useCallback(() => {
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 80);
  }, []);

  const handleLauncherClick = useCallback(() => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    toggleVoiceOverlay();
  }, [toggleVoiceOverlay]);

  const voiceModuleState = resolveModuleEffectiveState('voiceCommandAgent', hub);
  const voiceEnabled = voiceModuleState.effectiveEnabled;
  const isAlwaysListening = voiceAgent.mode === 'ALWAYS_LISTENING' && voiceAgent.micVerified;
  const isMicBusy =
    voiceAgent.listening || voiceAgent.capturePhase === 'CHECKING_PERMISSION';

  const hubVisualState: AiCommandHubVisualState = useMemo(() => {
    if (!voiceOverlayOpen) return 'IDLE';
    if (voiceAgent.listening && voiceAgent.micActive) return 'LISTENING';
    if (processing || voiceAgent.capturePhase === 'CHECKING_PERMISSION') return 'PROCESSING';
    if (activeSnapshot || geminiResponse) return 'RESULT';
    return 'EXPANDED';
  }, [
    activeSnapshot,
    geminiResponse,
    processing,
    voiceAgent.capturePhase,
    voiceAgent.listening,
    voiceAgent.micActive,
    voiceOverlayOpen,
  ]);

  const dimOpacity = useMemo(
    () => computeBackdropDimOpacity(hubVisualState),
    [hubVisualState]
  );

  // Abort any pending command fetch cleanly on unmount
  useEffect(() => {
    return () => {
      if (activeRequestAbortRef.current) {
        activeAbortReasonRef.current = 'SUPERSEDED';
        activeRequestAbortRef.current.abort();
        activeRequestAbortRef.current = null;
      }
    };
  }, []);

  // Scroll depth tracker for animated Tap-to-Top ring
  useEffect(() => {
    const computeScroll = () => {
      scrollRafRef.current = null;
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight
      );
      const pct = Math.min(100, Math.max(0, Math.round((y / maxScroll) * 100)));
      const nextScrolled = y > 60;
      setIsScrolled((prev) => (prev === nextScrolled ? prev : nextScrolled));
      setScrollPercent((prev) => (prev === pct ? prev : pct));
    };

    const onScroll = () => {
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = window.requestAnimationFrame(computeScroll);
    };

    computeScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // Global Cmd/Ctrl + K opens/closes the unified AI Command Hub; ESC closes
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggleVoiceOverlay();
      } else if (e.key === 'Escape' && voiceOverlayOpen) {
        setVoiceOverlayOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setVoiceOverlayOpen, toggleVoiceOverlay, voiceOverlayOpen]);

  useEffect(() => {
    if (!voiceOverlayOpen) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [voiceOverlayOpen]);

  const tickersRef = useRef(tickers);
  tickersRef.current = tickers;
  const positionsRef = useRef(executionState.positions);
  positionsRef.current = executionState.positions;
  const verifiedTradesRef = useRef(verifiedTrades);
  verifiedTradesRef.current = verifiedTrades;
  const lastAutoInspectedTokenRef = useRef<string | null>(null);

  // Unified Indexed Search + Trade ID Lookup (built only while hub is open; uses ref for live marks so WS ticks never thrash index)
  const searchIndex = useMemo(() => {
    if (!voiceOverlayOpen) return EMPTY_SEARCH_INDEX;
    const docs: SearchableDocument[] = [...STATIC_FEATURE_SEARCH_DOCS];
    const currentTickers = tickersRef.current;

    for (const trade of verifiedTrades) {
      docs.push({
        id: `proof_${trade.tradeId}`,
        category: 'TRADE_ID_PROOF',
        title: `${trade.tradeId} · ${trade.symbol} ${trade.direction}`,
        subtitle: `${trade.patternLabel} · Entry $${trade.entryPrice} · 1:${trade.rrMultiplier.toFixed(1)} · ${trade.stage}`,
        route: '/signals',
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
      const liveMark = currentTickers[sym]?.price ?? pin.signal.entryPrice;
      const rawPct =
        pin.signal.entryPrice > 0
          ? ((liveMark - pin.signal.entryPrice) / pin.signal.entryPrice) * 100
          : 0;
      const signedPct = pin.signal.direction === 'BUY' ? rawPct : -rawPct;
      docs.push({
        id: `active_${pin.signal.id}`,
        category: 'ACTIVE_TRADE',
        title: `${sym} ${pin.signal.direction} · Active Signal`,
        subtitle: `Entry $${pin.signal.entryPrice.toFixed(2)} · Confidence ${pin.signal.confidence}% · ${pin.status}`,
        route: '/signals',
        symbol: sym,
        statusLabel: pin.status,
        pnlLabel: `${signedPct >= 0 ? '+' : ''}${signedPct.toFixed(2)}%`,
        keywords: [sym, pin.signal.direction, pin.status, 'active', 'trade', 'signal'],
      });
    }

    for (const pos of executionState.positions.slice(0, 30)) {
      const isClosed = pos.status !== 'OPEN';
      const marketLabel = pos.marketType ?? 'SPOT';
      const mark = currentTickers[pos.symbol]?.price ?? pos.entryPrice;
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
  }, [voiceOverlayOpen, executionState.positions, pinnedSignals, verifiedTrades]);

  const liveSearchMatches = useMemo(() => {
    const q = commandInput.trim();
    if (!q || !voiceOverlayOpen) return [];
    return searchIndex.search(q, 'ALL', 5);
  }, [commandInput, searchIndex, voiceOverlayOpen]);

  const inspectTradeId = useCallback(
    (rawTradeId: string): boolean => {
      const cleanId = rawTradeId.trim().toUpperCase();
      const verification = verifyPublicTradeId(cleanId, verifiedTradesRef.current);
      if (verification.record) {
        setSelectedSymbol(verification.record.symbol);
        setActiveSnapshot(
          buildTradeResultSnapshotFromVerified(
            verification.record,
            verification.verified,
            verification.integrityStatus
          )
        );
        setOverlayFeedback(
          verification.verified
            ? `Instant snapshot loaded for verified Trade ID ${verification.record.tradeId}.`
            : `Trade ID ${cleanId} status: ${verification.integrityStatus}.`
        );
        return true;
      }

      const posMatch = positionsRef.current.find(
        (p) => p.id.toUpperCase() === cleanId
      );
      if (posMatch) {
        const liveMark = tickersRef.current[posMatch.symbol]?.price ?? posMatch.entryPrice;
        const tp1 =
          posMatch.takeProfits && posMatch.takeProfits.length > 0
            ? posMatch.takeProfits[0]
            : posMatch.entryPrice * (posMatch.direction === 'BUY' ? 1.04 : 0.96);
        setSelectedSymbol(posMatch.symbol);
        setActiveSnapshot(
          buildTradeResultSnapshotFromExecution(
            {
              id: posMatch.id,
              symbol: posMatch.symbol,
              direction: posMatch.direction,
              entryPrice: posMatch.entryPrice,
              stopLoss: posMatch.trailingStopLoss || posMatch.initialStopLoss,
              takeProfit: tp1,
              status: posMatch.status,
              notionalUsd: posMatch.notionalUsd,
              marketType: posMatch.marketType,
            },
            liveMark
          )
        );
        setOverlayFeedback(`Instant execution snapshot loaded for order ${posMatch.id}.`);
        return true;
      }
      return false;
    },
    [setSelectedSymbol]
  );

  // Instant Trade Result Snapshot presentation as soon as a valid Trade ID is typed (runs once per unique token)
  useEffect(() => {
    const token = extractTradeIdToken(commandInput);
    if (!token) {
      lastAutoInspectedTokenRef.current = null;
      return;
    }
    if (lastAutoInspectedTokenRef.current === token) return;
    lastAutoInspectedTokenRef.current = token;
    inspectTradeId(token);
  }, [commandInput, inspectTradeId]);

  const handleTapToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleModeSelect = useCallback(
    (mode: VoiceListeningMode) => {
      if (mode === 'PUSH_TO_TALK') {
        if (isMicBusy && !isAlwaysListening) {
          stopVoiceListening();
        } else {
          startPushToTalk();
        }
        return;
      }
      if (mode === 'STANDBY') {
        stopVoiceListening();
        return;
      }
      setVoiceMode(isAlwaysListening ? 'STANDBY' : 'ALWAYS_LISTENING');
    },
    [isAlwaysListening, isMicBusy, setVoiceMode, startPushToTalk, stopVoiceListening]
  );

  const cancelActiveCommand = useCallback(() => {
    activeRequestSeqRef.current += 1;
    activeRequestPromptRef.current = null;
    if (activeRequestAbortRef.current) {
      activeAbortReasonRef.current = 'USER_CANCELLED';
      activeRequestAbortRef.current.abort();
      activeRequestAbortRef.current = null;
    }
    setProcessing(false);
    setGeminiResponse({
      ok: false,
      text: 'Command request cancelled by user.',
      urduMessage: 'کمانڈ کی درخواست منسوخ کر دی گئی۔',
      model: 'gemini-4-hydrogen',
      followUps: [],
      httpStatus: 0,
      errorCategory: 'CANCELLED',
      code: 'REQUEST_CANCELLED',
    });
  }, []);

  const runHubQuery = useCallback(
    async (rawPhrase: string, source: 'VOICE' | 'TEXT' = 'TEXT') => {
      const phrase = rawPhrase.trim();
      if (!phrase) return;

      // Prevent duplicate concurrent requests for the same phrase
      if (
        activeRequestAbortRef.current &&
        activeRequestPromptRef.current === phrase.toLowerCase()
      ) {
        return;
      }

      // 1. Instant Trade ID snapshot lookup
      const tradeIdToken = extractTradeIdToken(phrase);
      if (tradeIdToken && inspectTradeId(tradeIdToken)) {
        return;
      }

      // 2. Instant pre-login navigation shortcut resolution
      const navShortcut = resolveShortcutFromQuery(phrase);
      if (navShortcut?.route) {
        setOverlayFeedback(`Navigating to ${navShortcut.label} (${navShortcut.route}).`);
        navigate(navShortcut.route);
        if (hub.dock.voiceOverlayAutoClose) {
          setVoiceOverlayOpen(false);
        }
        return;
      }

      // 3a. Harmless greetings & read-only status checks (never treated as trading instructions, never mutate trading state)
      const deterministicKind = matchDeterministicCommandIntent(phrase);
      if (deterministicKind === 'GREETING') {
        const greetingReply =
          'Hello! Signal Forge AI Command Hub is online (read-only Paper/Demo isolation with HTTP 423 real-money lock active). Try saying or typing: "status", "open signals", "open portfolio", a Trade ID (SF-TRD-...), or ask about BTCUSDT.';
        if (source === 'TEXT') {
          void executeVoiceCommand(phrase, 0.99);
        }
        setOverlayFeedback('Greeting recognized — supported commands ready.');
        setGeminiResponse({
          ok: true,
          text: greetingReply,
          urduMessage:
            'السلام علیکم! Signal Forge AI Hub آن لائن ہے۔ آپ "status"، "open signals"، Trade ID یا مارکیٹ کا سوال پوچھ سکتے ہیں۔',
          model: 'local-command-router',
          followUps: ['status', 'Open Signals', 'What is BTCUSDT price?'],
          httpStatus: 200,
          errorCategory: 'NONE',
          code: 'LOCAL_GREETING',
          source,
        });
        return;
      }

      if (deterministicKind === 'STATUS') {
        const reqSeq = ++activeRequestSeqRef.current;
        setProcessing(true);
        try {
          const trackedCount = Object.keys(tickersRef.current || {}).length;
          const statusReply = `Read-only Signal Forge Status — App Live: ${appLiveEnabled ? 'ON (Active)' : 'HALTED'} · Execution Safety: Paper/Demo Isolation (HTTP 423 Real-Money Lock Active) · Tracked Markets: ${trackedCount} pairs. No trading state was modified.`;
          const res =
            source === 'TEXT'
              ? await Promise.race([
                  executeVoiceCommand('status', 0.99),
                  new Promise<never>((_resolve, reject) =>
                    window.setTimeout(() => reject(new Error('Status check timed out after 5s.')), 5_000)
                  ),
                ])
              : { summary: statusReply, routeTarget: undefined };
          if (activeRequestSeqRef.current !== reqSeq) return;
          setOverlayFeedback(res.summary || statusReply);
          setGeminiResponse({
            ok: true,
            text: statusReply,
            model: 'local-command-router',
            followUps: ['Open Signals', 'Open Portfolio', 'What is BTCUSDT price?'],
            httpStatus: 200,
            errorCategory: 'NONE',
            code: 'LOCAL_STATUS',
            source,
          });
        } catch (err) {
          if (activeRequestSeqRef.current !== reqSeq) return;
          setOverlayFeedback(
            err instanceof Error ? err.message : 'Read-only status check failed to complete.'
          );
        } finally {
          if (activeRequestSeqRef.current === reqSeq) {
            setProcessing(false);
          }
        }
        return;
      }

      // 3b. Built-in voice desk commands (tick, audit, stop, resume, liquidate)
      const lower = phrase.toLowerCase().replace(/[.!?]+$/g, '').trim();
      const isDirectDeskCommand =
        /^(run tick|run audit|emergency stop|resume app live|emergency liquidate all|stop|resume)$/i.test(
          lower
        );
      if (isDirectDeskCommand) {
        const reqSeq = ++activeRequestSeqRef.current;
        setProcessing(true);
        try {
          const res = await Promise.race([
            executeVoiceCommand(phrase, 0.98),
            new Promise<never>((_resolve, reject) =>
              window.setTimeout(() => reject(new Error('Desk command timed out after 10s.')), 10_000)
            ),
          ]);
          if (activeRequestSeqRef.current !== reqSeq) return;
          setOverlayFeedback(res.summary);
          if (res.routeTarget) {
            navigate(res.routeTarget);
          }
        } catch (err) {
          if (activeRequestSeqRef.current !== reqSeq) return;
          setOverlayFeedback(
            err instanceof Error ? err.message : 'Desk command failed to complete.'
          );
        } finally {
          if (activeRequestSeqRef.current === reqSeq) {
            setProcessing(false);
          }
        }
        return;
      }

      // 4. Query backend Gemini AI Command endpoint with credentials, strict JSON Accept header, timeout & cancellation
      if (activeRequestAbortRef.current) {
        activeAbortReasonRef.current = 'SUPERSEDED';
        activeRequestAbortRef.current.abort();
      }
      const controller = new AbortController();
      const reqSeq = ++activeRequestSeqRef.current;
      activeRequestAbortRef.current = controller;
      activeAbortReasonRef.current = null;
      activeRequestPromptRef.current = phrase.toLowerCase();

      const timeoutHandle = window.setTimeout(() => {
        if (activeRequestSeqRef.current !== reqSeq) return;
        activeAbortReasonRef.current = 'TIMEOUT';
        controller.abort();
      }, COMMAND_CLIENT_TIMEOUT_MS);

      setProcessing(true);
      setGeminiResponse(null);
      setOverlayFeedback(
        source === 'VOICE'
          ? `Voice transcript captured ("${phrase}") — querying Signal Forge AI Hub...`
          : null
      );

      try {
        const res = await apiFetch('/api/ai-command-hub/query', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          signal: controller.signal,
          body: JSON.stringify({
            prompt: phrase,
            source,
            knownTradeIds: verifiedTradesRef.current.slice(0, 10).map((t) => t.tradeId),
          }),
        });
        const parsed = await parseSafeCommandHubResponse(res);
        if (activeRequestSeqRef.current !== reqSeq) return;

        setGeminiResponse({
          ok: parsed.ok,
          text: parsed.reply,
          urduMessage: parsed.urduMessage,
          model: parsed.model,
          followUps: parsed.suggestedFollowUps,
          httpStatus: parsed.httpStatus,
          errorCategory: parsed.errorCategory,
          code: parsed.code,
          diagnosticId: parsed.diagnosticId,
          quotaScope: parsed.quotaScope,
          retryAfterSeconds: parsed.retryAfterSeconds,
          modelQuotaBreakdown: parsed.modelQuotaBreakdown,
          responseContentType: parsed.responseContentType,
          responseRedirected: parsed.responseRedirected,
          responseUrlPath: parsed.responseUrlPath,
          responseBodySnippet: parsed.responseBodySnippet,
          source,
        });

        if (source === 'VOICE') {
          setOverlayFeedback(
            parsed.ok
              ? `Voice command processed: "${phrase}" (HTTP ${parsed.httpStatus}).`
              : `Voice command failed: "${phrase}" (${parsed.errorCategory} · HTTP ${parsed.httpStatus}).`
          );
        }

        if (!parsed.ok) return;

        if (parsed.matchedSymbol) {
          setSelectedSymbol(parsed.matchedSymbol);
        }
        if (parsed.matchedTradeId) {
          inspectTradeId(parsed.matchedTradeId);
        }
        if (parsed.intent === 'NAVIGATE' && parsed.routeTarget) {
          navigate(parsed.routeTarget);
        }
      } catch (err) {
        if (activeRequestSeqRef.current !== reqSeq) return;
        const abortReason = activeAbortReasonRef.current;
        if (abortReason === 'SUPERSEDED') return;
        const mapped = classifyCommandClientError(err, abortReason);
        setGeminiResponse({
          ok: false,
          text: mapped.reply,
          urduMessage: mapped.urduMessage,
          model: mapped.model,
          followUps: [],
          httpStatus: mapped.httpStatus,
          errorCategory: mapped.errorCategory,
          code: mapped.code,
          source,
        });
        if (source === 'VOICE') {
          setOverlayFeedback(`Voice command stopped (${mapped.errorCategory}).`);
        }
      } finally {
        window.clearTimeout(timeoutHandle);
        if (activeRequestAbortRef.current === controller) {
          activeRequestAbortRef.current = null;
        }
        if (activeRequestSeqRef.current === reqSeq) {
          activeRequestPromptRef.current = null;
          setProcessing(false);
        }
      }
    },
    [
      appLiveEnabled,
      executeVoiceCommand,
      hub.dock.voiceOverlayAutoClose,
      inspectTradeId,
      navigate,
      setSelectedSymbol,
      setVoiceOverlayOpen,
    ]
  );

  const runHubQueryRef = useRef(runHubQuery);
  runHubQueryRef.current = runHubQuery;

  // Route finalized voice transcripts into the open AI Command Hub so voice queries receive full results
  useEffect(() => {
    const eventAt = voiceAgent.lastSpeechEventAt;
    if (!eventAt || eventAt === lastHandledSpeechEventRef.current) return;
    lastHandledSpeechEventRef.current = eventAt;

    const spoken = voiceAgent.lastTranscript.trim();
    if (!spoken || !voiceOverlayOpen) return;

    setCommandInput(spoken);
    const intent = voiceAgent.lastIntent;
    const deterministicKind = matchDeterministicCommandIntent(spoken);

    if (intent === 'GREETING' || deterministicKind === 'GREETING') {
      setOverlayFeedback(voiceAgent.lastActionSummary);
      setGeminiResponse({
        ok: true,
        text: 'Hello! Signal Forge AI Command Hub is online (read-only Paper/Demo isolation with HTTP 423 real-money lock active). Try saying or typing: "status", "open signals", "open portfolio", a Trade ID (SF-TRD-...), or ask about BTCUSDT.',
        urduMessage:
          'السلام علیکم! Signal Forge AI Hub آن لائن ہے۔ آپ "status"، "open signals"، Trade ID یا مارکیٹ کا سوال پوچھ سکتے ہیں۔',
        model: 'local-command-router',
        followUps: ['status', 'Open Signals', 'What is BTCUSDT price?'],
        httpStatus: 200,
        errorCategory: 'NONE',
        code: 'LOCAL_GREETING',
        source: 'VOICE',
      });
      return;
    }

    if (intent === 'STATUS' || deterministicKind === 'STATUS') {
      const trackedCount = Object.keys(tickersRef.current || {}).length;
      const statusText = `Read-only Signal Forge Status — App Live: ${appLiveEnabled ? 'ON (Active)' : 'HALTED'} · Execution Safety: Paper/Demo Isolation (HTTP 423 Real-Money Lock Active) · Tracked Markets: ${trackedCount} pairs. No trading state was modified.`;
      setOverlayFeedback(voiceAgent.lastActionSummary || statusText);
      setGeminiResponse({
        ok: true,
        text: statusText,
        model: 'local-command-router',
        followUps: ['Open Signals', 'Open Portfolio', 'What is BTCUSDT price?'],
        httpStatus: 200,
        errorCategory: 'NONE',
        code: 'LOCAL_STATUS',
        source: 'VOICE',
      });
      return;
    }

    if (
      intent === 'STOP' ||
      intent === 'RESUME' ||
      intent === 'EMERGENCY_LIQUIDATE' ||
      intent === 'RUN_TICK' ||
      intent === 'RUN_AUDIT'
    ) {
      setOverlayFeedback(voiceAgent.lastActionSummary);
      return;
    }

    if (intent === 'NAVIGATE') {
      const shortcut = resolveShortcutFromQuery(spoken);
      if (shortcut?.route) {
        setOverlayFeedback(`Voice navigated to ${shortcut.label} (${shortcut.route}).`);
        navigate(shortcut.route);
        return;
      }
    }

    void runHubQueryRef.current(spoken, 'VOICE');
  }, [
    appLiveEnabled,
    navigate,
    voiceAgent.lastActionSummary,
    voiceAgent.lastIntent,
    voiceAgent.lastSpeechEventAt,
    voiceAgent.lastTranscript,
    voiceOverlayOpen,
  ]);

  const handleShortcutClick = useCallback(
    (item: CommandHubShortcutItem) => {
      if (item.route) {
        setOverlayFeedback(`Opened ${item.label}.`);
        navigate(item.route);
        if (hub.dock.voiceOverlayAutoClose) {
          setVoiceOverlayOpen(false);
        }
        return;
      }
      if (item.voicePhrase) {
        void runHubQuery(item.voicePhrase);
      }
    },
    [hub.dock.voiceOverlayAutoClose, navigate, runHubQuery, setVoiceOverlayOpen]
  );

  const handleSelectSearchDoc = useCallback(
    (doc: SearchableDocument) => {
      if (doc.tradeId && inspectTradeId(doc.tradeId)) {
        return;
      }
      if (doc.symbol) {
        setSelectedSymbol(doc.symbol);
      }
      setOverlayFeedback(`Opened ${doc.title}.`);
      navigate(doc.route);
      setVoiceOverlayOpen(false);
    },
    [inspectTradeId, navigate, setSelectedSymbol, setVoiceOverlayOpen]
  );

  const handleManualSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const phrase = commandInput.trim();
      if (!phrase) return;
      await runHubQuery(phrase);
    },
    [commandInput, runHubQuery]
  );

  const visibleShortcuts = useMemo(
    () =>
      shortcutsExpanded
        ? COMMAND_HUB_SHORTCUTS
        : COMMAND_HUB_SHORTCUTS.filter((s) => s.tier === 'PRIMARY'),
    [shortcutsExpanded]
  );

  const backdropAnimate = useMemo(() => ({ opacity: dimOpacity }), [dimOpacity]);
  const tapRingOffset =
    TAP_RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, scrollPercent)) / 100);

  return (
    <>
      {/* Dynamic State Dimming Backdrop (progressive opacity across EXPANDED / RESULT / PROCESSING / LISTENING) */}
      <AnimatePresence>
        {voiceOverlayOpen && (
          <motion.div
            key="ai-hub-dim-backdrop"
            initial={BACKDROP_INITIAL}
            animate={backdropAnimate}
            exit={BACKDROP_EXIT}
            transition={BACKDROP_TRANSITION}
            onClick={() => setVoiceOverlayOpen(false)}
            aria-hidden="true"
            data-testid="ai-hub-dim-backdrop"
            data-hub-state={hubVisualState}
            className="fixed inset-0 z-40 bg-[#02050b] backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      {/* Floating Binance-Style AI Command Hub Dialog (Powered by Gemini 4 Hydrogen) */}
      <AnimatePresence>
        {voiceOverlayOpen && (
          <motion.section
            key="voice-command-overlay"
            initial={OVERLAY_INITIAL}
            animate={OVERLAY_ANIMATE}
            exit={OVERLAY_EXIT}
            transition={MOTION_120HZ_SPRINGS.snappy}
            role="dialog"
            aria-modal="true"
            aria-label="Signal Forge AI Command Hub powered by Gemini 4 Hydrogen"
            data-testid="voice-command-overlay"
            data-hub-state={hubVisualState}
            data-mic-active={voiceAgent.micActive ? 'true' : 'false'}
            data-mic-verified={voiceAgent.micVerified ? 'true' : 'false'}
            className="fixed bottom-[76px] right-4 sm:right-6 z-50 w-[min(464px,calc(100vw-2rem))] rounded-2xl border border-[#2B3139] bg-[#0B0E11] shadow-[0_24px_64px_rgba(0,0,0,0.82)] overflow-hidden text-slate-100"
          >
            {/* Header Bar */}
            <div className="flex items-center justify-between gap-2 border-b border-[#1E2329] bg-[#14171D] px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#F0B90B]/45 bg-[#1E2329] shrink-0">
                  <OfficialGeminiLogo className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-bold text-white truncate">
                    Signal Forge AI Hub
                  </h2>
                  <p className="text-[11px] text-slate-400 truncate">
                    <span>{geminiResponse?.model || 'Gemini AI Hub'}</span>
                    {effectiveLoggedIn && userRole && (
                      <>
                        <span className="mx-1.5 text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono text-cyan-300">{userRole}</span>
                      </>
                    )}
                    <span className="mx-1.5 text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-[#F0B90B]">{hubVisualState}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <span className="hidden sm:inline font-mono text-[10px] text-slate-500 mr-1">
                  ⌘K
                </span>
                <button
                  type="button"
                  onClick={() => setVoiceOverlayOpen(false)}
                  aria-label="Close AI Command Hub"
                  data-testid="voice-overlay-close-btn"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-[#1E2329] hover:text-white transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="p-4 space-y-3.5 max-h-[74vh] overflow-y-auto">
              {/* Live Waveform Simulation Stage + Voice Mode Selector */}
              <div className="rounded-xl border border-[#2B3139] bg-[#12161C] p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span
                    data-testid="voice-capture-status-label"
                    className="font-medium text-slate-300 truncate"
                  >
                    {voiceAgent.capturePhase === 'CHECKING_PERMISSION'
                      ? 'Checking microphone permission...'
                      : voiceAgent.capturePhase === 'SPEECH_DETECTED'
                      ? 'Speech detected — converting to text...'
                      : voiceAgent.listening && voiceAgent.micActive
                      ? 'Microphone live — speak your command...'
                      : processing
                      ? 'Processing command via Gemini...'
                      : voiceAgent.capturePhase === 'CANCELLED'
                      ? 'Voice listening cancelled'
                      : 'Voice & Command Waveform'}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isMicBusy && voiceEnabled && (
                      <button
                        type="button"
                        data-testid="overlay-test-mic-btn"
                        onClick={() => {
                          void testMicrophoneCapture().then((res) => {
                            setOverlayFeedback(res.summary);
                          });
                        }}
                        className="rounded border border-[#2B3139] bg-[#181A20] px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-300 hover:border-[#F0B90B]/60 hover:text-[#F0B90B] cursor-pointer"
                      >
                        Test Mic
                      </button>
                    )}
                    {isMicBusy && (
                      <button
                        type="button"
                        data-testid="overlay-cancel-mic-btn"
                        onClick={stopVoiceListening}
                        className="rounded border border-rose-500/50 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-200 hover:bg-rose-500/25 cursor-pointer"
                      >
                        Cancel Mic
                      </button>
                    )}
                    <span
                      data-testid="voice-mic-activity-badge"
                      className={`font-mono text-[10px] ${
                        voiceAgent.micActive
                          ? 'text-emerald-400'
                          : voiceAgent.capturePhase === 'ERROR'
                          ? 'text-rose-400'
                          : voiceAgent.micVerified
                          ? 'text-cyan-300'
                          : 'text-slate-400'
                      }`}
                    >
                      {!voiceEnabled
                        ? 'VOICE PAUSED'
                        : voiceAgent.micActive
                        ? 'MIC LIVE'
                        : voiceAgent.capturePhase === 'CHECKING_PERMISSION'
                        ? 'CHECKING MIC'
                        : voiceAgent.micVerified && voiceAgent.mode === 'STANDBY'
                        ? 'MIC READY'
                        : voiceAgent.mode}
                    </span>
                  </div>
                </div>

                {/* Compositor-only scaleY Waveform Visualizer (isolated memo component so 24fps ticks never re-render parent dock) */}
                <HubWaveformVisualizer
                  open={voiceOverlayOpen}
                  hubVisualState={hubVisualState}
                  micActive={voiceAgent.micActive}
                  audioLevel={voiceAgent.audioLevel}
                />

                {/* Live Interim Speech-to-Text Preview */}
                {voiceAgent.interimTranscript && (
                  <div
                    data-testid="voice-interim-transcript"
                    className="rounded-lg border border-[#F0B90B]/40 bg-[#F0B90B]/10 px-2.5 py-1.5 font-mono text-[11px] text-[#FCD535]"
                  >
                    Hearing: &ldquo;{voiceAgent.interimTranscript}&rdquo;
                  </div>
                )}

                {/* Clear Microphone / Speech Recognition Error Diagnostic Banner (English + Urdu + Text Fallback) */}
                {voiceAgent.lastError && (
                  <div
                    role="alert"
                    data-testid="voice-error-banner"
                    data-error-category={voiceAgent.lastErrorCategory ?? 'UNKNOWN'}
                    data-raw-error-name={voiceAgent.lastDiagnostic?.rawErrorName ?? ''}
                    data-embedded-iframe={voiceAgent.lastDiagnostic?.isEmbeddedIframe ? 'true' : 'false'}
                    className="rounded-lg border border-rose-500/45 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-200 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-rose-300">
                      <span>VOICE INPUT DIAGNOSTIC</span>
                      <span>{voiceAgent.lastErrorCategory ?? 'UNKNOWN'}</span>
                    </div>
                    <p className="leading-snug">{voiceAgent.lastError}</p>
                    {voiceAgent.lastErrorUrdu && (
                      <p
                        dir="rtl"
                        lang="ur"
                        data-testid="voice-error-urdu"
                        className="rounded border border-rose-400/25 bg-[#0B0E11]/60 px-2 py-1.5 text-[11px] leading-relaxed text-amber-100"
                      >
                        {voiceAgent.lastErrorUrdu}
                      </p>
                    )}
                    {voiceAgent.lastDiagnostic && (
                      <div
                        data-testid="voice-diagnostic-meta"
                        className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[9px] text-rose-200/80 border-t border-rose-500/20 pt-1"
                      >
                        <span>HTTPS:{voiceAgent.lastDiagnostic.isSecureContext ? 'YES' : 'NO'}</span>
                        <span>Frame:{voiceAgent.lastDiagnostic.isEmbeddedIframe ? 'IFRAME' : 'TOP'}</span>
                        <span>
                          Policy:
                          {voiceAgent.lastDiagnostic.permissionsPolicyAllowsMic === null
                            ? 'N/A'
                            : voiceAgent.lastDiagnostic.permissionsPolicyAllowsMic
                            ? 'ALLOW'
                            : 'BLOCK'}
                        </span>
                        {voiceAgent.lastDiagnostic.rawErrorName && (
                          <span>Err:{voiceAgent.lastDiagnostic.rawErrorName}</span>
                        )}
                        <span className="truncate max-w-full">
                          Origin:{voiceAgent.lastDiagnostic.origin}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        data-testid="voice-fallback-text-btn"
                        onClick={() => {
                          inputRef.current?.focus();
                          setOverlayFeedback('Text command bar ready — type any command below.');
                        }}
                        className="rounded border border-[#F0B90B]/50 bg-[#F0B90B]/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#FCD535] hover:bg-[#F0B90B]/25 cursor-pointer"
                      >
                        Type Command Fallback
                      </button>
                      <button
                        type="button"
                        data-testid="voice-fallback-status-btn"
                        onClick={() => {
                          setCommandInput('status');
                          void runHubQuery('status', 'TEXT');
                        }}
                        className="rounded border border-cyan-400/40 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-200 hover:bg-cyan-500/20 cursor-pointer"
                      >
                        Run Local Status
                      </button>
                    </div>
                  </div>
                )}

                {/* 3-Mode Listening Controls */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    disabled={!voiceEnabled}
                    data-testid="overlay-ptt-btn"
                    onClick={() => handleModeSelect('PUSH_TO_TALK')}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-45 ${
                      isMicBusy && !isAlwaysListening
                        ? 'border-[#F0B90B] bg-[#F0B90B]/15 text-[#F0B90B]'
                        : 'border-[#2B3139] bg-[#181A20] text-slate-200 hover:border-[#F0B90B]/60'
                    }`}
                  >
                    <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {isMicBusy && !isAlwaysListening ? 'Stop Mic' : 'Push-to-Talk'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={!voiceEnabled}
                    data-testid="overlay-always-listening-btn"
                    onClick={() => handleModeSelect('ALWAYS_LISTENING')}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-45 ${
                      isAlwaysListening
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                        : 'border-[#2B3139] bg-[#181A20] text-slate-300 hover:text-white'
                    }`}
                  >
                    <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{isAlwaysListening ? 'Always ON' : 'Always-On'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="overlay-standby-btn"
                    onClick={() => handleModeSelect('STANDBY')}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      voiceAgent.mode === 'STANDBY' && !isMicBusy
                        ? 'border-slate-500 bg-[#2B3139] text-white'
                        : 'border-[#2B3139] bg-[#181A20] text-slate-400 hover:text-white'
                    }`}
                  >
                    <MicOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Standby</span>
                  </button>
                </div>
              </div>

              {/* Unified Command, Search & Trade ID Lookup Form */}
              <form onSubmit={handleManualSubmit} className="space-y-2">
                <div className="flex items-center gap-2 rounded-xl border border-[#2B3139] bg-[#181A20] px-3 py-2 focus-within:border-[#F0B90B]/70 transition-colors">
                  <Search className="h-4 w-4 text-[#F0B90B] shrink-0" aria-hidden="true" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    placeholder='Ask Gemini 4 Hydrogen, navigate, or enter Trade ID (SF-TRD-...)'
                    aria-label="AI command, navigation, or Trade ID lookup input"
                    data-testid="voice-overlay-command-input"
                    className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                  />
                  {commandInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setCommandInput('');
                        setActiveSnapshot(null);
                      }}
                      aria-label="Clear command input"
                      className="text-slate-500 hover:text-slate-200 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={processing || !commandInput.trim()}
                    data-testid="voice-overlay-submit-btn"
                    aria-label="Send command to Gemini 4 Hydrogen"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#F0B90B] text-[#0B0E11] hover:bg-[#FCD535] transition-colors cursor-pointer shrink-0 disabled:opacity-45"
                  >
                    {processing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>

                {/* Quick Verified Trade ID Chips for Instant Snapshot Preview */}
                {verifiedTrades.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                    <span className="text-[10px] text-slate-500 whitespace-nowrap shrink-0">
                      Trade IDs:
                    </span>
                    {verifiedTrades.slice(0, 3).map((tr) => (
                      <button
                        key={tr.tradeId}
                        type="button"
                        data-testid={`ai-hub-sample-trade-${tr.tradeId}`}
                        onClick={() => {
                          setCommandInput(tr.tradeId);
                          inspectTradeId(tr.tradeId);
                        }}
                        className="rounded-md border border-[#2B3139] bg-[#14171D] px-2 py-1 font-mono text-[10px] text-[#F0B90B] hover:border-[#F0B90B]/60 hover:bg-[#1E2329] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {tr.tradeId}
                      </button>
                    ))}
                  </div>
                )}
              </form>

              {/* Active Command Processing Bar with Manual Cancellation (shown immediately below input on mobile) */}
              {processing && (
                <div
                  data-testid="ai-hub-loading-bar"
                  className="flex items-center justify-between gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300 shrink-0" aria-hidden="true" />
                    <span className="truncate">Waiting for AI Command response...</span>
                  </div>
                  <button
                    type="button"
                    data-testid="ai-hub-cancel-command-btn"
                    onClick={cancelActiveCommand}
                    className="rounded-md border border-cyan-400/45 bg-[#0B0E11] px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-200 hover:border-rose-400 hover:text-rose-200 cursor-pointer shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* AI Command Structured Response / Diagnostic Card (separate from voice microphone diagnostics) */}
              {geminiResponse && (
                <div
                  role={geminiResponse.ok ? 'status' : 'alert'}
                  data-testid="ai-hub-gemini-response"
                  data-response-ok={geminiResponse.ok ? 'true' : 'false'}
                  data-http-status={String(geminiResponse.httpStatus ?? '')}
                  data-error-category={geminiResponse.errorCategory ?? 'NONE'}
                  className={`rounded-xl border px-3.5 py-3 text-xs space-y-2 ${
                    geminiResponse.ok
                      ? 'border-cyan-500/35 bg-[#121824] text-slate-100'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <span className="inline-flex items-center gap-1.5 text-[#F0B90B]">
                      <OfficialGeminiLogo className="h-3.5 w-3.5" />
                      <span>{geminiResponse.model}</span>
                    </span>
                    <span className="text-slate-400">
                      {geminiResponse.ok
                        ? `VERIFIED · HTTP ${geminiResponse.httpStatus ?? 200}`
                        : `${geminiResponse.errorCategory ?? 'ERROR'}${
                            geminiResponse.httpStatus ? ` · HTTP ${geminiResponse.httpStatus}` : ''
                          }`}
                    </span>
                  </div>
                  <p className="leading-relaxed">{geminiResponse.text}</p>
                  {!geminiResponse.ok && geminiResponse.urduMessage && (
                    <p
                      dir="rtl"
                      lang="ur"
                      data-testid="ai-hub-error-urdu"
                      className="rounded border border-amber-400/25 bg-[#0B0E11]/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-100"
                    >
                      {geminiResponse.urduMessage}
                    </p>
                  )}
                  {!geminiResponse.ok &&
                    geminiResponse.modelQuotaBreakdown &&
                    geminiResponse.modelQuotaBreakdown.length > 0 && (
                      <div
                        data-testid="ai-hub-model-quota-breakdown"
                        className="rounded border border-amber-500/25 bg-[#0B0E11]/50 px-2 py-1.5 font-mono text-[10px] text-amber-200/90 space-y-0.5"
                      >
                        {geminiResponse.modelQuotaBreakdown.map((entry) => (
                          <div key={entry.model} className="flex items-center justify-between gap-2">
                            <span>{entry.model}</span>
                            <span>
                              HTTP {entry.httpStatus} · {entry.quotaScope ?? entry.errorCategory}
                              {entry.retryAfterSeconds ? ` (${entry.retryAfterSeconds}s)` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  {!geminiResponse.ok &&
                    (geminiResponse.responseContentType ||
                      geminiResponse.responseRedirected ||
                      geminiResponse.responseBodySnippet) && (
                      <div
                        data-testid="ai-hub-http-diagnostic-meta"
                        className="flex flex-wrap gap-x-2 gap-y-0.5 rounded border border-amber-500/20 bg-[#0B0E11]/55 px-2 py-1 font-mono text-[9px] text-amber-200/85"
                      >
                        {geminiResponse.responseContentType && (
                          <span>CT:{geminiResponse.responseContentType}</span>
                        )}
                        {geminiResponse.responseRedirected && (
                          <span>
                            Redirect:{geminiResponse.responseUrlPath || 'YES'}
                          </span>
                        )}
                        {geminiResponse.responseBodySnippet && (
                          <span className="truncate max-w-full">
                            Body:{geminiResponse.responseBodySnippet}
                          </span>
                        )}
                      </div>
                    )}
                  {!geminiResponse.ok && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-500/20 pt-1.5 font-mono text-[10px] text-amber-200/80">
                      <span>
                        {geminiResponse.code ?? 'COMMAND_ERROR'}
                        {geminiResponse.diagnosticId ? ` · Ref: ${geminiResponse.diagnosticId}` : ''}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {geminiResponse.code === 'PREVIEW_SESSION_REDIRECT' && (
                          <button
                            type="button"
                            data-testid="ai-hub-refresh-session-btn"
                            onClick={() => window.location.reload()}
                            className="rounded border border-[#F0B90B]/50 bg-[#F0B90B]/15 px-2 py-0.5 text-[10px] font-semibold text-[#FCD535] hover:bg-[#F0B90B]/25 cursor-pointer"
                          >
                            Refresh Session
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid="ai-hub-local-status-fallback-btn"
                          onClick={() => {
                            setCommandInput('status');
                            void runHubQuery('status', 'TEXT');
                          }}
                          className="rounded border border-cyan-400/45 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/25 cursor-pointer"
                        >
                          Run Local Status
                        </button>
                      </div>
                    </div>
                  )}
                  {geminiResponse.followUps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {geminiResponse.followUps.map((fup) => (
                        <button
                          key={fup}
                          type="button"
                          onClick={() => {
                            setCommandInput(fup);
                            void runHubQuery(fup, 'TEXT');
                          }}
                          className="rounded-md border border-[#2B3139] bg-[#181A20] px-2 py-1 text-[10px] text-slate-200 hover:border-[#F0B90B]/60 hover:text-[#F0B90B] transition-colors cursor-pointer"
                        >
                          {fup}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Live Indexed Matches (Pre-Login Navigation, Active Trades & Trade IDs) */}
              {liveSearchMatches.length > 0 && !activeSnapshot && (
                <div
                  data-testid="ai-hub-search-matches"
                  className="rounded-xl border border-[#2B3139] bg-[#12161C] divide-y divide-[#1E2329] overflow-hidden"
                >
                  {liveSearchMatches.map(({ doc }) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => handleSelectSearchDoc(doc)}
                      className="flex w-full items-center justify-between gap-2.5 px-3 py-2.5 text-left hover:bg-[#181A20] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {doc.category === 'TRADE_ID_PROOF' ? (
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                        ) : doc.category === 'ACTIVE_TRADE' ? (
                          <TrendingUp className="h-3.5 w-3.5 text-[#F0B90B] shrink-0" aria-hidden="true" />
                        ) : doc.category === 'HISTORICAL_TRADE' ? (
                          <History className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                        ) : (
                          <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">
                            {doc.title}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {doc.subtitle}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}

              {/* Instant Trade Result Snapshot Card */}
              <AnimatePresence>
                {activeSnapshot && (
                  <motion.div
                    key={activeSnapshot.id}
                    initial={SNAPSHOT_INITIAL}
                    animate={SNAPSHOT_ANIMATE}
                    exit={SNAPSHOT_EXIT}
                    transition={MOTION_120HZ_SPRINGS.snappy}
                    data-testid="ai-hub-trade-snapshot"
                    className="rounded-xl border border-[#F0B90B]/40 bg-[#14171D] p-3.5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono">
                          <CheckCircle2
                            className={`h-3.5 w-3.5 shrink-0 ${
                              activeSnapshot.verified ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                            aria-hidden="true"
                          />
                          <span
                            className={
                              activeSnapshot.verified ? 'text-emerald-300' : 'text-rose-300'
                            }
                          >
                            {activeSnapshot.badgeLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-display text-sm font-bold text-white">
                            {activeSnapshot.symbol}
                          </span>
                          <span
                            className={`font-mono text-[11px] font-bold ${
                              activeSnapshot.direction === 'BUY'
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {activeSnapshot.direction === 'BUY' ? 'LONG' : 'SHORT'}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            · {activeSnapshot.marketLabel}
                          </span>
                        </div>
                        <p className="font-mono text-[10px] text-slate-400 truncate">
                          {activeSnapshot.id} · {activeSnapshot.patternLabel}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <div
                          className={`font-mono text-base font-bold tabular-nums ${
                            activeSnapshot.pnlPct === null
                              ? 'text-[#F0B90B]'
                              : activeSnapshot.pnlPct >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {activeSnapshot.pnlPct !== null
                            ? `${activeSnapshot.pnlPct >= 0 ? '+' : ''}${activeSnapshot.pnlPct.toFixed(2)}%`
                            : activeSnapshot.confidencePct !== null
                            ? `${activeSnapshot.confidencePct}%`
                            : activeSnapshot.statusLabel}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                          R:R {activeSnapshot.rrLabel}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-y border-[#2B3139] py-2 font-mono text-[11px] tabular-nums">
                      <div>
                        <span className="block text-[9px] text-slate-500">ENTRY</span>
                        <span className="text-slate-100 font-semibold">
                          {formatSnapshotPrice(activeSnapshot.entryPrice)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-500">STOP LOSS</span>
                        <span className="text-rose-300 font-semibold">
                          {formatSnapshotPrice(activeSnapshot.stopLoss)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-500">TAKE PROFIT</span>
                        <span className="text-emerald-300 font-semibold">
                          {formatSnapshotPrice(activeSnapshot.takeProfit)}
                        </span>
                      </div>
                    </div>

                    {activeSnapshot.visualSnapshotSvgDataUri && (
                      <div className="overflow-hidden rounded-lg border border-[#2B3139] bg-[#0B0E11]">
                        <img
                          src={activeSnapshot.visualSnapshotSvgDataUri}
                          alt={`Trade result chart snapshot for ${activeSnapshot.id}`}
                          className="h-24 w-full object-cover"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-mono text-slate-500 truncate">
                        {activeSnapshot.digest
                          ? `Digest ${activeSnapshot.digest.slice(0, 14)}…`
                          : `Status: ${activeSnapshot.statusLabel}`}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setActiveSnapshot(null)}
                          className="text-slate-400 hover:text-white cursor-pointer"
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSymbol(activeSnapshot.symbol);
                            setVoiceOverlayOpen(false);
                            navigate(activeSnapshot.routeTarget);
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-[#F0B90B] px-2.5 py-1 text-[11px] font-bold text-[#0B0E11] hover:bg-[#FCD535] transition-colors cursor-pointer"
                        >
                          <span>Inspect</span>
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Expandable Pre-Login Navigation & Command Shortcut Grid */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                    <LayoutGrid className="h-3.5 w-3.5 text-[#F0B90B]" aria-hidden="true" />
                    <span>Navigation &amp; Desk Shortcuts</span>
                  </div>
                  <button
                    type="button"
                    data-testid="ai-hub-expand-shortcuts-btn"
                    aria-expanded={shortcutsExpanded}
                    onClick={() => setShortcutsExpanded((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#F0B90B] hover:text-[#FCD535] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <span>
                      {shortcutsExpanded
                        ? 'Collapse Grid'
                        : `Expand All (${COMMAND_HUB_SHORTCUTS.length})`}
                    </span>
                    {shortcutsExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>

                <div
                  data-testid="ai-hub-shortcut-grid"
                  data-expanded={shortcutsExpanded ? 'true' : 'false'}
                  className="grid grid-cols-2 gap-2"
                >
                  {visibleShortcuts.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={processing}
                      data-testid={`ai-hub-shortcut-${item.id}`}
                      onClick={() => handleShortcutClick(item)}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer disabled:opacity-50 ${
                        item.tone === 'danger'
                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                          : item.tone === 'gold'
                          ? 'border-[#F0B90B]/40 bg-[#F0B90B]/10 text-[#FCD535] hover:bg-[#F0B90B]/15'
                          : 'border-[#2B3139] bg-[#14171D] text-slate-100 hover:border-[#F0B90B]/45 hover:bg-[#181A20]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">{item.label}</div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {item.shortHint}
                        </div>
                      </div>
                      {item.category === 'NAVIGATION' ? (
                        <Compass className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                      ) : (
                        <ShieldAlert
                          className={`h-3.5 w-3.5 shrink-0 ${
                            item.tone === 'danger' ? 'text-rose-400' : 'text-slate-500'
                          }`}
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Emergency App Live Toggle */}
              <button
                type="button"
                disabled={processing}
                data-testid="overlay-emergency-toggle-btn"
                onClick={() =>
                  void runHubQuery(appLiveEnabled ? 'emergency stop' : 'resume app live')
                }
                className={`w-full inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60 ${
                  appLiveEnabled
                    ? 'border-rose-500/45 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                    : 'border-emerald-500/45 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                }`}
              >
                <Power className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {appLiveEnabled
                    ? 'Voice Emergency Stop (Halt App Live)'
                    : 'Voice Resume (Restore App Live)'}
                </span>
              </button>

              {overlayFeedback && (
                <div
                  data-testid="voice-overlay-feedback"
                  className="rounded-lg border border-[#2B3139] bg-[#14171D] px-3 py-2 font-mono text-[11px] text-slate-200 leading-snug"
                >
                  {overlayFeedback}
                </div>
              )}

              {/* Compact Voice Command Audit Log */}
              <div className="border-t border-[#1E2329] pt-2.5 space-y-1.5">
                <button
                  type="button"
                  onClick={() => setAuditExpanded((v) => !v)}
                  aria-expanded={auditExpanded}
                  className="flex w-full items-center justify-between text-[10px] font-mono text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <span>Voice Command Audit Log</span>
                  <span className="tabular-nums">
                    {voiceAgent.history.length} total {auditExpanded ? '▲' : '▼'}
                  </span>
                </button>
                <div
                  data-testid="voice-overlay-audit-log"
                  className={auditExpanded ? 'max-h-32 overflow-y-auto space-y-1 pr-0.5' : 'space-y-1'}
                >
                  {voiceAgent.history.length === 0 ? (
                    <div className="rounded-lg border border-[#1E2329] bg-[#12161C] px-2.5 py-2 text-[11px] text-slate-500">
                      Voice commands, Trade ID verifications, and desk overrides log here.
                    </div>
                  ) : (
                    voiceAgent.history.slice(0, auditExpanded ? 8 : 2).map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-[#1E2329] bg-[#12161C] px-2.5 py-1.5 text-[11px]"
                      >
                        <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-slate-400">
                          <span
                            className={`font-semibold truncate ${
                              entry.intent === 'STOP' || entry.intent === 'EMERGENCY_LIQUIDATE'
                                ? 'text-rose-400'
                                : 'text-[#F0B90B]'
                            }`}
                          >
                            {entry.intent} · &ldquo;{entry.transcript}&rdquo;
                          </span>
                          <span className="tabular-nums shrink-0">
                            {new Date(entry.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="text-slate-300 truncate">{entry.summary}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Invisible Viewport Bounds for Draggable Logged-In AI Command Hub */}
      <div
        ref={viewportDragBoundsRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-3 z-0"
      />

      {/* Logged-In State: Draggable / Moveable Full Gemini 4 Hydrogen AI Command Hub Launcher */}
      {dockMode === 'LOGGED_IN_DRAGGABLE_HUB' && (
        <motion.div
          drag
          dragMomentum={false}
          dragElastic={0.08}
          dragConstraints={viewportDragBoundsRef}
          onDragStart={handleLauncherDragStart}
          onDragEnd={handleLauncherDragEnd}
          data-testid="draggable-ai-hub-launcher"
          data-auth-mode="LOGGED_IN"
          className="fixed bottom-[76px] right-4 sm:bottom-[80px] sm:right-6 z-50 cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <motion.button
            type="button"
            onClick={handleLauncherClick}
            whileHover={LAUNCHER_HOVER}
            whileTap={LAUNCHER_TAP}
            transition={MOTION_120HZ_SPRINGS.snappy}
            aria-label="Open draggable Signal Forge AI Command Hub (Gemini 4 Hydrogen)"
            aria-expanded={voiceOverlayOpen}
            title="Drag anywhere or click to open Gemini 4 Hydrogen AI Hub (⌘K)"
            data-testid="dock-voice-overlay-btn"
            data-auth-mode="LOGGED_IN"
            className={`group relative flex h-14 w-14 items-center justify-center rounded-full border shadow-[0_14px_38px_rgba(0,0,0,0.75)] backdrop-blur-md transition-all duration-200 cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0B90B] ${
              voiceOverlayOpen || voiceAgent.listening || processing
                ? 'opacity-100 border-[#F0B90B] bg-gradient-to-br from-[#F0B90B] via-[#FCD535] to-[#D9A307] text-[#0B0E11]'
                : 'opacity-45 hover:opacity-100 focus-visible:opacity-100 border-slate-600/60 bg-gradient-to-br from-[#1B2234]/90 via-[#14171D]/90 to-[#0B0E11]/90 text-slate-200 hover:border-[#F0B90B]'
            }`}
          >
            {(voiceAgent.listening || processing) && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full border border-[#F0B90B]/70 animate-ping opacity-35"
              />
            )}
            <span
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                voiceOverlayOpen || voiceAgent.listening ? 'bg-[#0B0E11]' : 'bg-[#0B0E11]/90'
              }`}
            >
              {voiceAgent.listening ? (
                <Mic className="h-4 w-4 text-[#F0B90B]" aria-hidden="true" />
              ) : (
                <OfficialGeminiLogo className="h-4 w-4" />
              )}
            </span>
          </motion.button>
        </motion.div>
      )}

      {/* Permanently Anchored Bottom-Right Dock: Animated Tap-to-Top + Pre-Login Static Compact Voice Waveform */}
      <nav
        aria-label="Floating AI Command Hub and Scroll Controls"
        data-testid="floating-widget-dock"
        data-dock-mode={dockMode}
        className="fixed bottom-3 right-3 sm:bottom-5 sm:right-6 z-40 flex items-center gap-2 sm:gap-2.5 pb-[env(safe-area-inset-bottom)]"
      >
        {/* 1. Animated Circular Tap-to-Top Scroll Button with Live Scroll-Depth Ring */}
        <motion.button
          type="button"
          onClick={handleTapToTop}
          whileHover={TAP_TO_TOP_HOVER}
          whileTap={TAP_TO_TOP_TAP}
          animate={isScrolled ? TAP_TO_TOP_ANIMATE_SCROLLED : TAP_TO_TOP_ANIMATE_IDLE}
          transition={MOTION_120HZ_SPRINGS.snappy}
          aria-label={isScrolled ? `Scroll to top (${scrollPercent}% scrolled)` : 'Tap to top'}
          title={isScrolled ? `Tap to top (${scrollPercent}% scrolled)` : 'Tap to top'}
          data-testid="dock-tap-to-top-btn"
          className={`group relative inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full border shadow-lg shadow-black/50 backdrop-blur-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0B90B] ${
            isScrolled
              ? 'border-[#F0B90B]/50 bg-[#14171D]/95 text-[#F0B90B]'
              : 'border-[#2B3139] bg-[#0B0E11]/95 text-slate-300 hover:border-[#F0B90B]/50 hover:text-white'
          }`}
        >
          <svg
            viewBox="0 0 44 44"
            className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="22"
              cy="22"
              r={TAP_RING_RADIUS}
              fill="none"
              stroke="rgba(43, 49, 57, 0.75)"
              strokeWidth="2.2"
            />
            <circle
              cx="22"
              cy="22"
              r={TAP_RING_RADIUS}
              fill="none"
              stroke="#F0B90B"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeDasharray={TAP_RING_CIRCUMFERENCE}
              strokeDashoffset={tapRingOffset}
              className="transition-[stroke-dashoffset] duration-150 ease-out"
            />
          </svg>
          <ArrowUp
            className="h-4 w-4 transition-transform duration-150 group-hover:-translate-y-0.5"
            aria-hidden="true"
          />
        </motion.button>

        {/* 2. Pre-Login State: Static, Compact, Bottom-Right Voice Waveform Button */}
        {dockMode === 'PRE_LOGIN_STATIC_WAVEFORM' && (
          <motion.button
            type="button"
            onClick={toggleVoiceOverlay}
            whileHover={PRELOGIN_BTN_HOVER}
            whileTap={PRELOGIN_BTN_TAP}
            transition={MOTION_120HZ_SPRINGS.snappy}
            aria-label="Open Voice Command Hub (Gemini 4 Hydrogen)"
            aria-expanded={voiceOverlayOpen}
            title="Voice Command Hub & Trade ID Lookup (⌘K)"
            data-testid="dock-voice-overlay-btn"
            data-auth-mode="PRE_LOGIN"
            className={`relative inline-flex h-9 sm:h-11 items-center gap-2 sm:gap-2.5 rounded-full border px-2.5 sm:px-3.5 text-xs font-semibold shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-md transition-all duration-200 cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0B90B] ${
              voiceOverlayOpen || voiceAgent.listening || processing
                ? 'opacity-100 border-[#F0B90B] bg-[#181A20] text-[#F0B90B]'
                : 'opacity-50 hover:opacity-100 focus-visible:opacity-100 border-slate-700/70 bg-[#0B0E11]/85 text-slate-300 hover:border-[#F0B90B]/65 hover:text-white'
            }`}
          >
            {/* Compact 5-Bar Compositor-Only Voice Waveform */}
            <span
              data-testid="prelogin-compact-waveform"
              aria-hidden="true"
              className="inline-flex h-5 items-center gap-[3px]"
            >
              {COMPACT_WAVEFORM_BARS.map((_, idx) => (
                <motion.span
                  key={idx}
                  initial={WAVEFORM_BAR_INITIAL}
                  animate={
                    voiceAgent.listening || voiceOverlayOpen
                      ? COMPACT_BAR_ANIMATE_ACTIVE[idx]
                      : COMPACT_BAR_ANIMATE_IDLE[idx]
                  }
                  transition={
                    voiceAgent.listening
                      ? COMPACT_BAR_TRANSITION_LISTENING[idx]
                      : COMPACT_BAR_TRANSITION_IDLE[idx]
                  }
                  className={`h-4 w-[3px] origin-center rounded-full ${
                    voiceAgent.listening
                      ? 'bg-[#F0B90B]'
                      : idx % 2 === 0
                      ? 'bg-gradient-to-t from-blue-500 to-cyan-400'
                      : 'bg-gradient-to-t from-[#F0B90B] to-amber-300'
                  }`}
                />
              ))}
            </span>
            <span className="hidden sm:inline font-display tracking-tight text-xs">
              {voiceAgent.listening
                ? 'Listening...'
                : processing
                ? 'Thinking...'
                : 'Voice Hub'}
            </span>
          </motion.button>
        )}
      </nav>
    </>
  );
});
