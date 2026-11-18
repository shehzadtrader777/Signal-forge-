import { TrustConsolePanel } from '../components/TrustConsolePanel';

export function TrustConsole() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="border-b border-slate-800/80 pb-5">
        <span className="font-mono text-xs uppercase tracking-wider text-blue-400">
          Force Signal Governance · L4 Certification
        </span>
        <h1 className="mt-1 font-display text-3xl font-bold text-white tracking-tight">
          PG_v4 Trust Console &amp; Promotion Authority
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm text-slate-400">
          Verifies un-cached Kernel &amp; GitOps Policy identities, EU AI Act Arts. 9–15 governance declarations, Backtest ↔ Replay ↔ Paper equivalence, and Walk-Forward Out-of-Sample stability before certifying production promotions.
        </p>
      </div>

      <TrustConsolePanel initialSymbol="BTCUSDT" />
    </div>
  );
}
