import { Lock, ShieldCheck } from 'lucide-react';
import {
  DEFAULT_SCREENSHOT_PRIVACY_POLICY,
  FUTURE_SCREENSHOT_TIER_QUOTAS,
  SCREENSHOT_ANALYZER_FEATURE_FLAGS,
} from '../lib/screenshotAnalyzerArchitecture';

/**
 * Read-only architectural blueprint panel for the future Premium AI Chart Screenshot Analyzer.
 * Strictly DISABLED in Step 1 — zero uploads processed, zero billing, zero live trade triggers.
 */
export function ScreenshotAnalyzerBlueprintCard() {
  return (
    <section
      data-testid="screenshot-analyzer-blueprint"
      className="rounded-xl border border-slate-800 bg-[#111827] overflow-hidden"
    >
      <div className="border-b border-slate-800 bg-[#0d1323] px-5 py-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-xs text-slate-400">
            Future Premium Module · Architecture Prepared Only
          </div>
          <h3 className="font-display text-base font-bold text-white flex items-center gap-2">
            <Lock className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <span>AI Chart Screenshot Analyzer (Disabled in Step 1)</span>
          </h3>
        </div>
        <span className="rounded-md border border-slate-700 bg-[#0a0e1a] px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-300">
          FEATURE: OFF · BILLING: OFF · LIVE EXECUTION: BLOCKED
        </span>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-1.5">
          <div className="font-semibold text-white">Visual Estimate vs. Verified Data</div>
          <p className="text-slate-400 leading-relaxed">
            Every future screenshot reading is tagged strictly as{' '}
            <span className="font-mono text-amber-300">VISUAL_ESTIMATE_UNVERIFIED</span> and never merged with verified exchange OHLCV data or permitted to trigger live orders.
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-1.5">
          <div className="font-semibold text-white">Missing Context &amp; Privacy Guardrails</div>
          <p className="text-slate-400 leading-relaxed">
            Missing symbol, timeframe, or visible price bounds trigger explicit user prompts rather than guesses. Retention:{' '}
            <span className="font-mono text-emerald-400">
              {DEFAULT_SCREENSHOT_PRIVACY_POLICY.retentionHours}h (ephemeral)
            </span>
            , EXIF scrubbed, account balances redacted, model training disabled.
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-4 space-y-1.5">
          <div className="font-semibold text-white flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
            <span>Quota &amp; Cost Architecture</span>
          </div>
          <p className="text-slate-400 leading-relaxed">
            Reserved tier quotas prepared ({FUTURE_SCREENSHOT_TIER_QUOTAS.PRO_PREVIEW.monthlyUploadLimit}/mo Pro preview,{' '}
            {FUTURE_SCREENSHOT_TIER_QUOTAS.INSTITUTIONAL_PREVIEW.monthlyUploadLimit}/mo Institutional preview). Stage:{' '}
            <span className="font-mono text-slate-200">{SCREENSHOT_ANALYZER_FEATURE_FLAGS.STAGE}</span>. No payments active.
          </p>
        </div>
      </div>
    </section>
  );
}
