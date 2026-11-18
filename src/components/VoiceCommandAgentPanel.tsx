import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Radio, Send, ShieldAlert } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { VoiceListeningMode } from '../lib/voiceCommandAgent';

const QUICK_PHRASES = [
  { label: 'Voice "Stop"', phrase: 'stop', tone: 'danger' as const },
  { label: 'Voice "Resume"', phrase: 'resume app live', tone: 'success' as const },
  { label: 'Voice "Emergency Liquidate"', phrase: 'emergency liquidate all', tone: 'danger' as const },
  { label: 'Voice "Run Tick"', phrase: 'run tick', tone: 'neutral' as const },
  { label: 'Voice "Run Audit"', phrase: 'run audit', tone: 'neutral' as const },
  { label: 'Voice "Open Signals"', phrase: 'open signals', tone: 'neutral' as const },
];

export function VoiceCommandAgentPanel() {
  const navigate = useNavigate();
  const {
    voiceAgent,
    setVoiceMode,
    startPushToTalk,
    stopVoiceListening,
    executeVoiceCommand,
  } = useApp();

  const [manualTranscript, setManualTranscript] = useState('');
  const [busy, setBusy] = useState(false);

  const runPhrase = async (phrase: string) => {
    if (!phrase.trim()) return;
    setBusy(true);
    try {
      const res = await executeVoiceCommand(phrase);
      if (res.routeTarget) {
        navigate(res.routeTarget);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTranscript.trim()) return;
    const text = manualTranscript;
    setManualTranscript('');
    await runPhrase(text);
  };

  const handleModeClick = (mode: VoiceListeningMode) => {
    if (mode === 'PUSH_TO_TALK') {
      startPushToTalk();
      return;
    }
    if (mode === 'STANDBY') {
      stopVoiceListening();
      return;
    }
    setVoiceMode('ALWAYS_LISTENING');
  };

  return (
    <section
      aria-label="Dedicated Hands-Free Voice Command Agent"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Mic className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span className="font-mono font-semibold text-blue-300">
              HANDS-FREE VOICE COMMAND AGENT
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-300">
              Mode: {voiceAgent.mode} ·{' '}
              {voiceAgent.supportedInBrowser ? 'Web Speech Active' : 'Command Desk Ready'}
            </span>
          </div>
          <h2 className="mt-0.5 font-display text-lg font-bold text-white tracking-normal">
            Voice Emergency Stop &amp; Autonomous Execution Interface
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleModeClick('PUSH_TO_TALK')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap ${
              voiceAgent.mode === 'PUSH_TO_TALK'
                ? 'border-[#3b82f6] bg-[#3b82f6]/20 text-white'
                : 'border-slate-700 bg-[#0a0e1a] text-slate-300 hover:text-white'
            }`}
          >
            <Mic className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
            <span>Push-to-Talk</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeClick('ALWAYS_LISTENING')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap ${
              voiceAgent.mode === 'ALWAYS_LISTENING'
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-[#0a0e1a] text-slate-300 hover:text-white'
            }`}
          >
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Always-Listening</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeClick('STANDBY')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap ${
              voiceAgent.mode === 'STANDBY'
                ? 'border-slate-500 bg-slate-800 text-white'
                : 'border-slate-700 bg-[#0a0e1a] text-slate-400 hover:text-white'
            }`}
          >
            <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Standby</span>
          </button>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3.5 text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-300">Active Voice Dispatch Status</span>
              {voiceAgent.lastIntent && (
                <span className="font-mono text-[11px] font-bold text-blue-300">
                  LAST INTENT: {voiceAgent.lastIntent}
                </span>
              )}
            </div>
            <p className="text-slate-200 leading-relaxed">{voiceAgent.lastActionSummary}</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-wrap sm:flex-nowrap gap-2">
            <label htmlFor="voice-transcript-input" className="sr-only">
              Voice Command Phrase Input
            </label>
            <input
              id="voice-transcript-input"
              type="text"
              value={manualTranscript}
              onChange={(e) => setManualTranscript(e.target.value)}
              placeholder='Speak or type voice command (e.g. "Stop", "Resume", "Emergency Liquidate", "Run Tick")...'
              className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Execute Voice Command</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            {QUICK_PHRASES.map((item) => (
              <button
                key={item.phrase}
                type="button"
                disabled={busy}
                onClick={() => runPhrase(item.phrase)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  item.tone === 'danger'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                    : item.tone === 'success'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                    : 'border-slate-700 bg-[#0d1323] text-slate-300 hover:border-[#3b82f6] hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <span>Voice Command Audit Log</span>
            <span className="inline-flex items-center gap-1 text-rose-300 font-mono">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              &ldquo;Stop&rdquo; Override Ready
            </span>
          </div>
          {voiceAgent.history.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 text-xs text-slate-400">
              No voice commands triggered yet. Background Always-Listening or Push-to-Talk commands log here in real time.
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {voiceAgent.history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-slate-800/80 bg-[#0a0e1a] px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                    <span className="font-bold text-white">&ldquo;{item.transcript}&rdquo;</span>
                    <span
                      className={
                        item.intent === 'STOP' || item.intent === 'EMERGENCY_LIQUIDATE'
                          ? 'text-rose-400 font-semibold'
                          : 'text-emerald-400 font-semibold'
                      }
                    >
                      {item.intent}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{item.summary}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
