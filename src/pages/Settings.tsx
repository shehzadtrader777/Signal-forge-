import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CommandControlSettingsHub } from '../components/CommandControlSettingsHub';

export function Settings() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-800/80 pb-5">
        <div className="space-y-1.5">
          <div className="font-mono text-xs text-cyan-400">
            Settings · Centralized Command &amp; Control
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
            System Settings &amp; Module Command Hub
          </h1>
          <p className="max-w-3xl text-sm text-slate-400">
            Map and orchestrate all active Signal Forge market feeds, AI agents, execution tools, safeguards, and the floating widget dock with hybrid Master Override and granular switches.
          </p>
        </div>

        <Link
          to="/"
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-800 bg-[#0d1526] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-500/50 hover:text-white transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Dashboard</span>
        </Link>
      </div>

      <CommandControlSettingsHub />
    </div>
  );
}
