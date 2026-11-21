import { memo } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const SystemControlsBar = memo(function SystemControlsBar() {
  const {
    appLiveEnabled,
    testnetExecutionEnabled,
    setTestnetExecutionEnabled,
    liveFeedModulesEnabled,
    setLiveFeedModulesEnabled,
    autonomousState,
    toggleAutonomousCoordinator,
  } = useApp();

  const lowLagActive = !appLiveEnabled || !testnetExecutionEnabled || !liveFeedModulesEnabled;

  return (
    <section
      aria-label="Master System Performance Controls"
      className="rounded-xl border border-slate-800/90 bg-[#111827] px-4 py-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
          <SlidersHorizontal className="h-3.5 w-3.5 text-[#3b82f6] shrink-0" aria-hidden="true" />
          <span>System Runtime &amp; Autonomous Coordinator Controls</span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span
            className={`font-mono text-[11px] font-semibold whitespace-nowrap ${
              !appLiveEnabled ? 'text-rose-400' : lowLagActive ? 'text-amber-300' : 'text-emerald-400'
            }`}
          >
            {!appLiveEnabled
              ? 'APP LIVE HALTED (QUOTA SHIELD)'
              : lowLagActive
              ? 'LOW-LAG PAUSE ACTIVE'
              : 'FULL REAL-TIME STREAM'}
          </span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Active Safeguards: Signal Engine · Top Gainers · L2 Depth · 2.0% Max Risk / Min 1:5 R:R · Reversal Exit
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
        {/* Master Toggle 1: Binance Testnet Execution */}
        <div className="inline-flex items-center gap-2.5 rounded-lg border border-slate-800 bg-[#0d1323] px-3 py-1.5 text-xs">
          <span className="font-medium text-slate-200 whitespace-nowrap">
            Binance Testnet Execution
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={testnetExecutionEnabled}
            aria-label="Toggle Binance Testnet Execution"
            onClick={() => setTestnetExecutionEnabled(!testnetExecutionEnabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
              testnetExecutionEnabled
                ? 'border-[#3b82f6] bg-[#3b82f6]'
                : 'border-slate-700 bg-slate-800'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                testnetExecutionEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span
            className={`font-mono text-[11px] font-semibold tabular-nums whitespace-nowrap ${
              testnetExecutionEnabled ? 'text-emerald-400' : 'text-amber-300'
            }`}
          >
            {testnetExecutionEnabled ? 'ON' : 'PAUSED'}
          </span>
        </div>

        {/* Master Toggle 2: Live Spot/Futures Feed/Trading Modules */}
        <div className="inline-flex items-center gap-2.5 rounded-lg border border-slate-800 bg-[#0d1323] px-3 py-1.5 text-xs">
          <span className="font-medium text-slate-200 whitespace-nowrap">
            Live Spot/Futures Feed/Trading Modules
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={liveFeedModulesEnabled}
            aria-label="Toggle Live Spot/Futures Feed/Trading Modules"
            onClick={() => setLiveFeedModulesEnabled(!liveFeedModulesEnabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
              liveFeedModulesEnabled
                ? 'border-[#3b82f6] bg-[#3b82f6]'
                : 'border-slate-700 bg-slate-800'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                liveFeedModulesEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span
            className={`font-mono text-[11px] font-semibold tabular-nums whitespace-nowrap ${
              liveFeedModulesEnabled ? 'text-emerald-400' : 'text-amber-300'
            }`}
          >
            {liveFeedModulesEnabled ? 'ON' : 'PAUSED'}
          </span>
        </div>

        {/* Master Toggle 3: Zero-Intervention Autonomous Spot/Futures Coordinator */}
        <div className="inline-flex items-center gap-2.5 rounded-lg border border-slate-800 bg-[#0d1323] px-3 py-1.5 text-xs">
          <span className="font-medium text-slate-200 whitespace-nowrap">
            Autonomous Spot/Futures AI
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={autonomousState.enabled}
            aria-label="Toggle Autonomous Zero-Intervention Coordinator"
            onClick={() => toggleAutonomousCoordinator(!autonomousState.enabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
              autonomousState.enabled
                ? 'border-emerald-500 bg-emerald-500'
                : 'border-slate-700 bg-slate-800'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                autonomousState.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span
            className={`font-mono text-[11px] font-semibold tabular-nums whitespace-nowrap ${
              autonomousState.enabled ? 'text-emerald-400' : 'text-slate-400'
            }`}
          >
            {autonomousState.enabled ? 'ARMED' : 'MANUAL'}
          </span>
        </div>
      </div>
    </section>
  );
});
