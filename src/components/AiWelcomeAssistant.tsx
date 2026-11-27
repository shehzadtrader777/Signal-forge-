import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Mic, MicOff, Minimize2, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import {
  answerWelcomeAssistantQuery,
  INITIAL_VOICE_PERMISSION_STATE,
  markWelcomeAssistantShown,
  requestVoiceMicrophoneToggle,
  shouldAutoShowWelcomeAssistant,
  WELCOME_GREETING_TEXT,
  WELCOME_QUICK_TOPICS,
  type VoicePermissionState,
  type WelcomeAssistantResponse,
  type WelcomeQuickTopic,
} from '../lib/aiWelcomeAssistantModel';

interface AiWelcomeAssistantProps {
  /** External trigger counter incremented when visitor reopens welcome assistant from the existing FloatingWidgetDock */
  reopenSignal?: number;
}

/**
 * Lightweight, animated Public AI Welcome Assistant anchored to Signal Forge's existing
 * bottom-right widget dock (zero heavy 3D deps, zero duplicate floating icon).
 * - Appears automatically once per browsing session on the public homepage after a short delay
 * - Never activates microphone or autoplays audio without explicit visitor click & permission
 */
export function AiWelcomeAssistant({ reopenSignal = 0 }: AiWelcomeAssistantProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isPublicHome = location.pathname === '/' || location.pathname === '/home';

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [hasWaved, setHasWaved] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [response, setResponse] = useState<WelcomeAssistantResponse | null>(null);
  const [voiceState, setVoiceState] = useState<VoicePermissionState>(INITIAL_VOICE_PERMISSION_STATE);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  // Automatic session-once arrival animation on public homepage
  useEffect(() => {
    if (!isPublicHome) return;
    if (!shouldAutoShowWelcomeAssistant(window.sessionStorage)) return;

    const timer = window.setTimeout(() => {
      markWelcomeAssistantShown(window.sessionStorage);
      setIsOpen(true);
      setIsMinimized(false);
      setHasWaved(true);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [isPublicHome]);

  // Allow visitor to reopen at any time via the existing dock button
  useEffect(() => {
    if (reopenSignal <= 0) return;
    setIsOpen(true);
    setIsMinimized(false);
    setHasWaved(true);
  }, [reopenSignal]);

  // Clean up any active opt-in speech recognition on unmount
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const speakIfOptedIn = (text: string) => {
    if (!voiceState.speechOutputOptIn) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      window.speechSynthesis.speak(utter);
    } catch {
      // ignore unsupported synthesis errors
    }
  };

  const navigateTarget = (targetType: 'ANCHOR' | 'ROUTE', target: string) => {
    if (targetType === 'ANCHOR') {
      const id = target.replace(/^#/, '');
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    navigate(target);
  };

  const handleSelectTopic = (topic: WelcomeQuickTopic) => {
    const res: WelcomeAssistantResponse = {
      matchedTopicId: topic.id,
      answer: topic.answer,
      suggestedAction: {
        label: topic.actionLabel,
        targetType: topic.targetType,
        target: topic.target,
      },
    };
    setResponse(res);
    speakIfOptedIn(topic.answer);
  };

  const handleAskSubmit = (e: FormEvent) => {
    e.preventDefault();
    const res = answerWelcomeAssistantQuery(query);
    setResponse(res);
    setQuery('');
    speakIfOptedIn(res.answer);
  };

  const handleToggleVoiceMic = () => {
    const next = requestVoiceMicrophoneToggle(voiceState, true);
    if (!next.isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setVoiceState(next);
      setVoiceNotice('Voice microphone stopped.');
      return;
    }

    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setVoiceState({ ...INITIAL_VOICE_PERMISSION_STATE, speechOutputOptIn: voiceState.speechOutputOptIn });
      setVoiceNotice('Browser speech recognition is unavailable — type any question below.');
      return;
    }

    try {
      const rec = new SpeechRecognitionCtor() as {
        lang: string;
        interimResults: boolean;
        maxAlternatives: number;
        onresult: ((ev: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (ev) => {
        const transcript = ev.results?.[0]?.[0]?.transcript || '';
        if (transcript.trim()) {
          const ans = answerWelcomeAssistantQuery(transcript);
          setResponse(ans);
          speakIfOptedIn(ans.answer);
        }
      };
      rec.onerror = () => {
        setVoiceState((prev) => ({ ...prev, isListening: false }));
        setVoiceNotice('Microphone permission was denied or unavailable.');
      };
      rec.onend = () => {
        setVoiceState((prev) => ({ ...prev, isListening: false }));
      };
      recognitionRef.current = rec;
      setVoiceState(next);
      setVoiceNotice('Listening after your explicit click... ask a question.');
      rec.start();
    } catch {
      setVoiceState((prev) => ({ ...prev, isListening: false }));
      setVoiceNotice('Unable to start browser voice recognition.');
    }
  };

  if (!isPublicHome || !isOpen) return null;

  if (isMinimized) {
    return (
      <div
        data-testid="ai-welcome-minimized"
        className="fixed bottom-24 right-4 z-40 sm:right-6"
      >
        <button
          type="button"
          data-testid="ai-welcome-reopen-btn"
          onClick={() => setIsMinimized(false)}
          className="inline-flex items-center gap-2 rounded-full border border-blue-500/50 bg-[#0d1526]/95 px-3.5 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md hover:border-blue-400 cursor-pointer"
        >
          <Sparkles className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
          <span>Welcome Guide</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Signal Forge AI Welcome Assistant"
      data-testid="ai-welcome-assistant"
      className="fixed bottom-24 right-3 sm:right-6 z-40 w-[calc(100vw-1.5rem)] max-w-[350px] rounded-2xl border border-blue-500/40 bg-[#0d1526]/95 shadow-2xl backdrop-blur-md overflow-hidden animate-[fadeIn_0.25s_ease-out]"
    >
      {/* Top Character Emergence Header */}
      <div className="border-b border-slate-800 bg-gradient-to-r from-[#0f1a33] via-[#101c38] to-[#0d1526] px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Lightweight SVG Character with subtle CSS wave animation */}
          <div className="relative h-10 w-10 rounded-full bg-blue-500/15 border border-blue-400/40 flex items-center justify-center shrink-0">
            <svg
              viewBox="0 0 40 40"
              className="h-8 w-8"
              aria-hidden="true"
            >
              <circle cx="20" cy="21" r="11" fill="#1e3a8a" stroke="#60a5fa" strokeWidth="1.5" />
              <circle cx="16" cy="19" r="1.8" fill="#e0f2fe" />
              <circle cx="24" cy="19" r="1.8" fill="#e0f2fe" />
              <path d="M16 24.5 Q20 27.5 24 24.5" stroke="#93c5fd" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              {/* Waving hand */}
              <g
                className={hasWaved ? 'origin-[31px_22px] motion-safe:animate-bounce' : ''}
              >
                <circle cx="32" cy="15" r="3" fill="#38bdf8" />
              </g>
            </svg>
          </div>
          <div className="min-w-0">
            <div
              data-testid="ai-welcome-greeting"
              className="font-display text-xs font-bold text-white leading-tight"
            >
              {WELCOME_GREETING_TEXT}
            </div>
            <div className="text-[11px] text-blue-300 truncate">
              Interactive Guide · Opt-In Voice
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            data-testid="ai-welcome-minimize-btn"
            onClick={() => setIsMinimized(true)}
            aria-label="Minimize Welcome Assistant"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="ai-welcome-close-btn"
            onClick={() => setIsOpen(false)}
            aria-label="Close Welcome Assistant"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body: Interactive Shortcuts + Q&A Answer + Opt-In Voice Controls */}
      <div className="p-3.5 space-y-3 text-xs">
        <p className="text-[11px] leading-relaxed text-slate-300">
          Explore verified spot charts, audit any public Trade ID, or learn how Paper/Demo isolation works. Choose a quick guide below or ask a question:
        </p>

        {/* 6 Functional Quick Shortcuts / FAQs */}
        <div className="grid grid-cols-2 gap-1.5">
          {WELCOME_QUICK_TOPICS.map((topic) => (
            <button
              key={topic.id}
              type="button"
              data-testid={`ai-welcome-topic-${topic.id}`}
              onClick={() => handleSelectTopic(topic)}
              className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors cursor-pointer truncate ${
                response?.matchedTopicId === topic.id
                  ? 'border-blue-500 bg-blue-500/20 text-white'
                  : 'border-slate-800 bg-[#0a0e1a] text-slate-300 hover:border-slate-600 hover:text-white'
              }`}
            >
              {topic.label}
            </button>
          ))}
        </div>

        {/* Active Answer Card */}
        {response && (
          <div
            data-testid="ai-welcome-answer"
            className="rounded-lg border border-slate-800 bg-[#0a0e1a] p-2.5 space-y-2"
          >
            <p className="text-[11px] leading-relaxed text-slate-200">{response.answer}</p>
            {response.suggestedAction && (
              <button
                type="button"
                data-testid="ai-welcome-action-btn"
                onClick={() =>
                  navigateTarget(
                    response.suggestedAction!.targetType,
                    response.suggestedAction!.target
                  )
                }
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                <span>{response.suggestedAction.label} &rarr;</span>
              </button>
            )}
          </div>
        )}

        {/* Text Q&A Input */}
        <form onSubmit={handleAskSubmit} className="flex items-center gap-1.5">
          <input
            type="text"
            data-testid="ai-welcome-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about Trade ID, charts, login..."
            aria-label="Ask Signal Forge Welcome Assistant"
            className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            data-testid="ai-welcome-send-btn"
            aria-label="Send question"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#3b82f6] text-white hover:bg-blue-500 cursor-pointer shrink-0"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </form>

        {/* Opt-In Voice & Speech Controls (Strictly OFF by default) */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2 text-[11px]">
          <button
            type="button"
            data-testid="ai-welcome-mic-btn"
            aria-pressed={voiceState.isListening}
            onClick={handleToggleVoiceMic}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium cursor-pointer ${
              voiceState.isListening
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
            }`}
          >
            {voiceState.isListening ? (
              <Mic className="h-3 w-3" aria-hidden="true" />
            ) : (
              <MicOff className="h-3 w-3" aria-hidden="true" />
            )}
            <span>{voiceState.isListening ? 'Listening (Click to Stop)' : 'Voice Input (Opt-In)'}</span>
          </button>

          <button
            type="button"
            data-testid="ai-welcome-tts-btn"
            aria-pressed={voiceState.speechOutputOptIn}
            onClick={() =>
              setVoiceState((prev) => ({ ...prev, speechOutputOptIn: !prev.speechOutputOptIn }))
            }
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 cursor-pointer ${
              voiceState.speechOutputOptIn
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:text-white'
            }`}
          >
            {voiceState.speechOutputOptIn ? (
              <Volume2 className="h-3 w-3" aria-hidden="true" />
            ) : (
              <VolumeX className="h-3 w-3" aria-hidden="true" />
            )}
            <span>Audio {voiceState.speechOutputOptIn ? 'On' : 'Off'}</span>
          </button>
        </div>

        {voiceNotice && (
          <div className="text-[10px] font-mono text-slate-400">{voiceNotice}</div>
        )}
      </div>
    </aside>
  );
}
