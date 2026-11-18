import { Link } from 'react-router-dom';
import { ArrowLeft, FileBarChart2 } from 'lucide-react';
import { AutoReportsSection } from '../components/AutoReportsSection';

export function AutoReports() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <FileBarChart2 className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span className="font-mono font-semibold text-blue-300">
              ADMINISTRATIVE REPORTING DESK
            </span>
          </div>
          <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Automated Performance Reports &amp; Digest Archive
          </h1>
          <p className="mt-1 text-xs text-slate-400 max-w-2xl">
            Daily, Weekly, and Monthly Coordinator telemetry digests dispatched cleanly to your
            configured email inbox and Telegram channel.
          </p>
        </div>

        <Link
          to="/"
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-700 bg-[#111827] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Master Dashboard</span>
        </Link>
      </div>

      <AutoReportsSection />
    </div>
  );
}
