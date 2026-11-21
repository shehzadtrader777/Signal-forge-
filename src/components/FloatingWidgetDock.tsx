import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  Mic,
  MicOff,
  Power,
  Radio,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MOTION_120HZ_SPRINGS } from '../lib/designSystem';
import { resolveModuleEffectiveState } from '../lib/commandControlHub';
import type { VoiceListeningMode } from '../lib/voiceCommandAgent';
import { useCommandControlStore } from '../store/useCommandControlStore';

interface QuickVoiceCommand {
  readonly label: string;
  readonly phrase: string;
  readonly tone: 'neutral' | 'danger';
}

const QUICK_VOICE_COMMANDS: readonly QuickVoiceCommand[] = Object.freeze([
  { label: 'Status', phrase: 'status', tone: 'neutral' },
  { label: 'Run Tick', phrase: 'run tick', tone: 'neutral' },
  { label: 'Run Audit', phrase: 'run audit', tone: 'neutral' },
  { label: 'Open Signals', phrase: 'open signals', tone: 'neutral' },
  { label: 'Open Settings', phrase: 'open settings', tone: 'neutral' },
  { label: 'Emergency Liquidate', phrase: 'emergency liquidate all', tone: 'danger' },
]);

export const FloatingWidgetDock = memo(function FloatingWidgetDock() {
  const navigate = useNavigate();
  const {
    appLiveEnabled,
    voiceAgent,
    setVoiceMode,
    startPushToTalk,
    stopVoiceListening,
    executeVoiceCommand,
  } = useApp();

  const hub = useCommandControlStore((s) => s.hub);
  const voiceOverlayOpen = useCommandControlStore((s) => s.voiceOverlayOpen);
  const setVoiceOverlayOpen = useCommandControlStore((s) => s.setVoiceOverlayOpen);
  const toggleVoiceOverlay = useCommandControlStore((s) => s.toggleVoiceOverlay);

  const [scrollY, setScrollY] = useState(0);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [manualPhrase, setManualPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [overlayFeedback, setOverlayFeedback] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const voiceModuleState = resolveModuleEffectiveState('voiceCommandAgent', hub);
  const voiceEnabled = voiceModuleState.effectiveEnabled;
  const isAlwaysListening = voiceAgent.mode === 'ALWAYS_LISTENING';

  useEffect(() => {
    const computeScroll = () => {
      rafRef.current = null;
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight
      );
      const pct = Math.min(100, Math.max(0, Math.round((y / maxScroll) * 100)));
      setScrollY(y);
      setScrollPercent(pct);
    };

    const onScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(computeScroll);
    };

    computeScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!voiceOverlayOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setVoiceOverlayOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [voiceOverlayOpen, setVoiceOverlayOpen]);

  const handleTapToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleModeSelect = useCallback(
    (mode: VoiceListeningMode) => {
      if (mode === 'PUSH_TO_TALK') {
        if (voiceAgent.listening && !isAlwaysListening) {
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
    [isAlwaysListening, setVoiceMode, startPushToTalk, stopVoiceListening, voiceAgent.listening]
  );

  const runOverlayCommand = useCallback(
    async (phrase: string) => {
      const normalized = phrase.trim();
      if (!normalized) return;

      setBusy(true);
      try {
        if (normalized.toLowerCase().includes('open settings')) {
          setOverlayFeedback('Navigated to Settings · Command & Control Hub.');
          navigate('/settings');
          if (hub.dock.voiceOverlayAutoClose) {
            setVoiceOverlayOpen(false);
          }
          return;
        }

        const res = await executeVoiceCommand(normalized, 0.98);
        setOverlayFeedback(res.summary);
        if (res.routeTarget) {
          navigate(res.routeTarget);
        }
        if (hub.dock.voiceOverlayAutoClose) {
          setVoiceOverlayOpen(false);
        }
      } finally {
        setBusy(false);
      }
    },
    [executeVoiceCommand, hub.dock.voiceOverlayAutoClose, navigate, setVoiceOverlayOpen]
  );

  const handleManualSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!manualPhrase.trim()) return;
      const phrase = manualPhrase.trim();
      setManualPhrase('');
      await runOverlayCommand(phrase);
    },
    [manualPhrase, runOverlayCommand]
  );

  const isScrolled = scrollY > 80;
  const showTapToTop = hub.dock.tapToTopMode === 'PERSISTENT' || scrollY > 120;
  const showLabels = hub.dock.showDockLabels;

  return (
    <div
      data-testid="floating-widget-dock-root"
      className="relative flex items-center justify-end gap-1.5"
    >
      {/* Consolidated Bottom Voice Command Overlay Drawer */}
      <AnimatePresence>
        {voiceOverlayOpen && (
          <motion.section
            key="voice-command-overlay"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={MOTION_120HZ_SPRINGS.snappy}
            role="dialog"
            aria-label="Signal Forge Consolidated Voice Command Widget"
            data-testid="voice-command-overlay"
            className="fixed bottom-[64px] right-4 sm:right-6 z-50 w-[min(400px,calc(100vw-2rem))] rounded-xl border border-cyan-500/35 bg-[#070d1b]/98 backdrop-blur-md shadow-2xl overflow-hidden text-slate-100"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-800/90 bg-[#0b1325] px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ${
                    voiceAgent.listening
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/35'
                  }`}
                >
                  {voiceAgent.listening ? (
                    <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-bold text-white truncate">
                    Voice Command Center
                  </h2>
                  <p className="font-mono text-[10px] text-slate-400 truncate">
                    {voiceEnabled
                      ? `${voiceAgent.mode} · ${
                          voiceAgent.supportedInBrowser ? 'Web Speech Active' : 'Command Desk Ready'
                        }`
                      : 'VOICE AGENT PAUSED IN COMMAND HUB'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Link
                  to="/settings"
                  onClick={() => setVoiceOverlayOpen(false)}
                  aria-label="Open Command & Control Settings"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-cyan-300 transition-colors"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
                <button
                  type="button"
                  onClick={() => setVoiceOverlayOpen(false)}
                  aria-label="Close Voice Command Center"
                  data-testid="voice-overlay-close-btn"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-3.5 space-y-3 max-h-[70vh] overflow-y-auto">
              {!voiceEnabled && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 flex items-center justify-between gap-2">
                  <span>Voice Emergency Guard is paused by Command Hub.</span>
                  <Link
                    to="/settings"
                    onClick={() => setVoiceOverlayOpen(false)}
                    className="font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
                  >
                    Configure
                  </Link>
                </div>
              )}

              {/* 3-Mode Listening Controls (Push-to-Talk, Always-Listen, Standby) */}
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  disabled={!voiceEnabled}
                  data-testid="overlay-ptt-btn"
                  onClick={() => handleModeSelect('PUSH_TO_TALK')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-45 ${
                    voiceAgent.mode === 'PUSH_TO_TALK' || (voiceAgent.listening && !isAlwaysListening)
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                      : 'border-slate-700 bg-[#0d1526] text-slate-200 hover:border-cyan-400'
                  }`}
                >
                  <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{voiceAgent.listening && !isAlwaysListening ? 'Stop Mic' : 'Push-to-Talk'}</span>
                </button>

                <button
                  type="button"
                  disabled={!voiceEnabled}
                  data-testid="overlay-always-listening-btn"
                  onClick={() => handleModeSelect('ALWAYS_LISTENING')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-45 ${
                    isAlwaysListening
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-700 bg-[#0d1526] text-slate-300 hover:text-white'
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
                    voiceAgent.mode === 'STANDBY' && !voiceAgent.listening
                      ? 'border-slate-500 bg-slate-800 text-white'
                      : 'border-slate-700 bg-[#0d1526] text-slate-400 hover:text-white'
                  }`}
                >
                  <MicOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Standby</span>
                </button>
              </div>

              {/* Emergency App Live Toggle via Voice */}
              <button
                type="button"
                disabled={busy}
                data-testid="overlay-emergency-toggle-btn"
                onClick={() =>
                  void runOverlayCommand(appLiveEnabled ? 'emergency stop' : 'resume app live')
                }
                className={`w-full inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60 ${
                  appLiveEnabled
                    ? 'border-rose-500/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                    : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                }`}
              >
                <Power className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {appLiveEnabled
                    ? 'Voice Emergency Stop (Halt App Live)'
                    : 'Voice Resume (Restore App Live)'}
                </span>
              </button>

              {/* Active Voice Dispatch Status */}
              <div
                data-testid="voice-dispatch-status"
                className="rounded-lg border border-slate-800 bg-[#0b1325] px-3 py-2 text-[11px] space-y-1"
              >
                <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                  <span className="text-slate-400">Active Dispatch</span>
                  <span className="text-cyan-300 font-semibold">
                    {voiceAgent.lastIntent ? `LAST: ${voiceAgent.lastIntent}` : 'STOP OVERRIDE READY'}
                  </span>
                </div>
                <p className="text-slate-200 leading-snug">
                  {overlayFeedback ?? voiceAgent.lastActionSummary}
                </p>
              </div>

              {/* Quick Command Shortcuts */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>Quick Voice Dispatch</span>
                  <span className="inline-flex items-center gap-1 text-rose-300">
                    <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                    <span>Hands-Free</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {QUICK_VOICE_COMMANDS.map((cmd) => (
                    <button
                      key={cmd.phrase}
                      type="button"
                      disabled={busy}
                      onClick={() => void runOverlayCommand(cmd.phrase)}
                      className={`rounded-md border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors cursor-pointer truncate disabled:opacity-60 ${
                        cmd.tone === 'danger'
                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                          : 'border-slate-800 bg-[#0b1325] text-slate-200 hover:border-cyan-500/40 hover:text-cyan-200'
                      }`}
                    >
                      &ldquo;{cmd.label}&rdquo;
                    </button>
                  ))}
                </div>
              </div>

              {/* Manual Command Input */}
              <form onSubmit={handleManualSubmit} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={manualPhrase}
                  onChange={(e) => setManualPhrase(e.target.value)}
                  placeholder='Speak or type command (e.g. "status", "stop")'
                  aria-label="Manual voice command input"
                  data-testid="voice-overlay-command-input"
                  className="flex-1 min-w-0 rounded-lg border border-slate-700/90 bg-[#050914] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy}
                  data-testid="voice-overlay-submit-btn"
                  aria-label="Execute voice command"
                  className="inline-flex items-center justify-center rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-colors cursor-pointer shrink-0 disabled:opacity-60"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </form>

              {overlayFeedback && (
                <div
                  data-testid="voice-overlay-feedback"
                  className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 font-mono text-[11px] text-cyan-100 leading-snug"
                >
                  {overlayFeedback}
                </div>
              )}

              {/* Consolidated Voice Command Audit Log */}
              <div className="border-t border-slate-800/80 pt-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>Voice Command Audit Log</span>
                  <span className="tabular-nums">{voiceAgent.history.length} total</span>
                </div>
                {voiceAgent.history.length === 0 ? (
                  <div className="rounded border border-slate-800/80 bg-[#050914] px-2.5 py-2 text-[11px] text-slate-400">
                    No voice commands executed yet. All Push-to-Talk, Always-On, and typed commands log here.
                  </div>
                ) : (
                  <div
                    data-testid="voice-overlay-audit-log"
                    className="max-h-32 overflow-y-auto space-y-1 pr-0.5"
                  >
                    {voiceAgent.history.slice(0, 6).map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded border border-slate-800/80 bg-[#050914] px-2.5 py-1.5 text-[11px]"
                      >
                        <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-slate-400">
                          <span
                            className={`font-semibold truncate ${
                              entry.intent === 'STOP' || entry.intent === 'EMERGENCY_LIQUIDATE'
                                ? 'text-rose-400'
                                : 'text-cyan-300'
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
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Bottom Dock Controls: Tap-to-Top + Consolidated Voice Widget */}
      <nav
        aria-label="Bottom Voice & Navigation Dock"
        data-testid="floating-widget-dock"
        className="inline-flex items-center gap-1.5"
      >
        {/* 1. Persistent Tap-to-Top Scroll Integration */}
        {showTapToTop && (
          <motion.button
            whileTap={{ scale: 0.94 }}
            transition={MOTION_120HZ_SPRINGS.snappy}
            type="button"
            onClick={handleTapToTop}
            aria-label={isScrolled ? `Scroll to top (${scrollPercent}% scrolled)` : 'Tap to top'}
            title={isScrolled ? `Tap to top (${scrollPercent}% depth)` : 'At top of page'}
            data-testid="dock-tap-to-top-btn"
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-cyan-400 ${
              isScrolled
                ? 'border border-cyan-500/45 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25'
                : 'border border-slate-800 bg-[#0d1526] text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <ArrowUp className="h-4 w-4 shrink-0" aria-hidden="true" />
            {showLabels && (
              <span className="hidden sm:inline font-mono tabular-nums whitespace-nowrap">
                {isScrolled ? `${scrollPercent}%` : 'Top'}
              </span>
            )}
          </motion.button>
        )}

        {/* 2. Consolidated Voice Command Widget Trigger */}
        <motion.button
          whileTap={{ scale: 0.94 }}
          transition={MOTION_120HZ_SPRINGS.snappy}
          type="button"
          onClick={toggleVoiceOverlay}
          aria-label="Toggle Consolidated Voice Command Widget"
          aria-expanded={voiceOverlayOpen}
          data-testid="dock-voice-overlay-btn"
          className={`relative inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-cyan-400 ${
            voiceOverlayOpen || voiceAgent.listening
              ? 'border border-cyan-400 bg-cyan-500/25 text-white'
              : 'border border-cyan-500/40 bg-[#0d1526] text-slate-100 hover:border-cyan-400 hover:text-white'
          }`}
        >
          <span className="relative inline-flex">
            {voiceAgent.listening ? (
              <Mic className="h-4 w-4 text-cyan-300 shrink-0" aria-hidden="true" />
            ) : (
              <Mic className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />
            )}
            {(voiceAgent.listening || isAlwaysListening) && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400"
              />
            )}
          </span>
          {showLabels && (
            <span className="whitespace-nowrap">
              {voiceAgent.listening
                ? 'Listening'
                : isAlwaysListening
                ? 'Voice On'
                : 'Voice Control'}
            </span>
          )}
        </motion.button>
      </nav>
    </div>
  );
});
