import { useState } from 'react';
import { BookOpen, ShieldCheck, Sparkles } from 'lucide-react';

const TOPICS = [
  { question: 'Where should I start?', answer: 'Start with the workspace preview, then create an account when ready. Explore signals, charts and portfolio views as research tools. Use paper mode to learn before considering any higher-risk environment.' },
  { question: 'What is the difference between Paper, Demo and Live?', answer: 'Paper uses simulated records for practice. Demo uses a designated sandbox environment where supported. Live involves real funds and must stay locked until separate authorization, exchange verification and risk controls are completed. Never interpret a simulated balance as real profit.' },
  { question: 'How do I read a signal?', answer: 'Check the symbol, timeframe, source, freshness, entry context and risk levels. Signals are research inputs, not guaranteed predictions or instructions to trade.' },
  { question: 'What can this assistant do?', answer: 'This guide explains Signal Forge features and safe workflows. It cannot place orders, change settings, access private account data, unlock trading modes, or give personalized financial recommendations.' },
  { question: 'How do I keep my account safe?', answer: 'Use strong authentication, never share API keys or recovery codes, verify the website address, and review permissions before connecting any service. A guide cannot verify your account security by itself.' },
] as const;

/** Deterministic, no-network educational guide; not an AI model or trading agent. */
export function GuideOnlyAssistant() {
  const [active, setActive] = useState<number>(0);
  return (
    <section id="guide" className="mx-auto max-w-6xl py-16 sm:py-24" aria-labelledby="guide-title">
      <div className="mb-8 flex items-center gap-3 text-slate-500">
        <Sparkles size={20} aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-[0.22em]">Platform guidance</span>
      </div>
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h2 id="guide-title" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Your Super Guide, not your trader.</h2>
          <p className="mt-4 max-w-lg leading-7 text-slate-600">Explore how Signal Forge works with clear, educational explanations. This first release is a curated guide; conversational AI features are not connected yet.</p>
          <p className="mt-6 flex items-start gap-2 text-sm text-slate-600"><ShieldCheck className="mt-0.5 shrink-0" size={18} aria-hidden="true" /> Read-only: no orders, account changes, private data access or trading-mode unlocks.</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-2 font-semibold text-slate-900"><BookOpen size={19} aria-hidden="true" /> Explore common questions</div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Guide topics">
            {TOPICS.map((topic, index) => (
              <button type="button" key={topic.question} onClick={() => setActive(index)} aria-pressed={active === index}
                className={`rounded-full border px-3 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${active === index ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-400'}`}>
                {topic.question}
              </button>
            ))}
          </div>
          <div role="status" aria-live="polite" className="mt-6 rounded-2xl bg-slate-50 p-5">
            <h3 className="font-semibold text-slate-900">{TOPICS[active].question}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">{TOPICS[active].answer}</p>
          </div>
          <p className="mt-4 text-xs text-slate-500">Educational feature guide only. Not financial advice or a live AI chat.</p>
        </div>
      </div>
    </section>
  );
}
