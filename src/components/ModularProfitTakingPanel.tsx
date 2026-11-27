import { memo, useCallback, useEffect, useState } from 'react';
import { Lock, RefreshCw, Shield, Sliders, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetch } from '../lib/apiClient';
import { formatCryptoPrice } from '../lib/marketData';
import { useApp } from '../context/AppContext';
import type {
  AdaptedExecutionThresholds,
  AgentProfitTakingProfile,
  ProfitAgentId,
  ProfitTakingMode,
} from '../lib/modularProfitTaking';

const AGENT_TAB_TAP = { scale: 0.96 } as const;

export const ModularProfitTakingPanel = memo(function ModularProfitTakingPanel() {
  const { selectedSymbol, tickers } = useApp();
  const [profiles, setProfiles] = useState<AgentProfitTakingProfile[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<ProfitAgentId>('AI_COORDINATOR');
  const [simAtrPct, setSimAtrPct] = useState<number>(2.1);
  const [simPeakR, setSimPeakR] = useState<number>(3.4);
  const [evaluation, setEvaluation] = useState<AdaptedExecutionThresholds | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const livePrice = tickers[selectedSymbol]?.price || 91500;

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch('/api/profit-taking/policies');
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        profiles?: AgentProfitTakingProfile[];
      };
      if (data?.ok && Array.isArray(data.profiles)) {
        setProfiles(data.profiles);
      }
    } catch {
      // keep existing profiles
    }
  }, []);

  const runLiveEvaluation = useCallback(
    async (agentId: ProfitAgentId, atrPct: number, peakR: number, price: number) => {
      try {
        const atr = (price * atrPct) / 100;
        const currentPrice = Number((price * (1 + (peakR * 0.014))).toFixed(4));
        const res = await fetch('/api/profit-taking/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            symbol: selectedSymbol,
            direction: 'BUY',
            entryPrice: price,
            currentPrice,
            atr,
            peakUnrealizedR: peakR,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          evaluation?: AdaptedExecutionThresholds;
        };
        if (data?.ok && data.evaluation) {
          setEvaluation(data.evaluation);
        }
      } catch {
        // ignore transient errors
      }
    },
    [selectedSymbol]
  );

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const quantizedLivePrice = Number(livePrice.toPrecision(5));
  const profilesVersionSig = profiles.map((p) => `${p.agentId}:${p.updatedAtIso}`).join('|');

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void runLiveEvaluation(selectedAgentId, simAtrPct, simPeakR, quantizedLivePrice);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedAgentId, simAtrPct, simPeakR, quantizedLivePrice, profilesVersionSig, runLiveEvaluation]);

  const activeProfile = profiles.find((p) => p.agentId === selectedAgentId) ?? null;

  const handleUpdatePolicy = async (patch: {
    takeProfit?: Partial<AgentProfitTakingProfile['takeProfit']>;
    stopLoss?: Partial<AgentProfitTakingProfile['stopLoss']>;
  }) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/profit-taking/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgentId,
          ...patch,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        profiles?: AgentProfitTakingProfile[];
        updatedProfile?: AgentProfitTakingProfile;
      } | null;
      if (!res.ok || !data?.ok) {
        setFeedback({ ok: false, text: data?.error || 'Could not update agent TP/SL policy.' });
        return;
      }
      if (data.profiles) {
        setProfiles(data.profiles);
      }
      setFeedback({
        ok: true,
        text: `Updated ${data.updatedProfile?.agentLabel || selectedAgentId} independently (zero cross-agent interference).`,
      });
    } catch {
      setFeedback({ ok: false, text: 'Network error saving modular profit-taking policy.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Modular Decoupled Profit-Taking & Stop-Loss Studio"
      data-testid="modular-profit-taking-panel"
      className="cyber-surface rounded-xl border overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800/90 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-cyan-300 font-medium">Decoupled TP &amp; SL Architecture</span>
            <span aria-hidden="true">·</span>
            <span>Per-Agent Volatility Adaptation · Zero Global Strategy Interference</span>
          </div>
          <h2 className="mt-1 font-display text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Sliders className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />
            <span>Modular Profit-Taking &amp; Autonomous Profit-Locking Engine</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="AI Agent Policies">
          {profiles.map((prof) => {
            const active = prof.agentId === selectedAgentId;
            return (
              <motion.button
                key={prof.agentId}
                whileTap={AGENT_TAB_TAP}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedAgentId(prof.agentId)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                    : 'border-slate-800 bg-[#050914] text-slate-400 hover:text-white'
                }`}
              >
                {prof.agentLabel.replace(/ Agent$/i, '')}
              </motion.button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`border-b px-5 py-2 text-xs flex items-center justify-between ${
            feedback.ok
              ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
              : 'border-amber-500/30 bg-amber-950/30 text-amber-200'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] font-semibold underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {activeProfile && (
        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-12">
          {/* Column 1: Decoupled Take-Profit Policy */}
          <div className="lg:col-span-4 rounded-lg border border-slate-800/90 bg-[#060c1b]/90 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                Decoupled Take-Profit Policy
              </span>
              <span className="font-mono text-[10px] text-slate-400">Floor &ge; 1:5 R:R</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'AUTONOMOUS_PROFIT_LOCK', label: 'Autonomous Lock' },
                  { id: 'HARD_CODED_TARGETS', label: 'Hard-Coded TPs' },
                ] as Array<{ id: ProfitTakingMode; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={saving}
                  onClick={() => handleUpdatePolicy({ takeProfit: { mode: m.id } })}
                  className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                    activeProfile.takeProfit.mode === m.id
                      ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-800 bg-[#0b1224] text-slate-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="space-y-2.5 text-xs">
              <label className="block">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Max Profit Target (TP3 R-Multiple)</span>
                  <span className="font-mono text-emerald-300">{activeProfile.takeProfit.tp3R}R</span>
                </div>
                <input
                  type="range"
                  min={5.0}
                  max={10.0}
                  step={0.2}
                  value={activeProfile.takeProfit.tp3R}
                  onChange={(e) =>
                    handleUpdatePolicy({ takeProfit: { tp3R: Number(e.target.value) } })
                  }
                  className="mt-1 w-full accent-emerald-400 cursor-pointer"
                />
              </label>

              <label className="block">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Volatility TP Expansion Factor</span>
                  <span className="font-mono text-cyan-300">
                    {activeProfile.takeProfit.volatilityExpansionFactor}x
                  </span>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={1.5}
                  step={0.05}
                  value={activeProfile.takeProfit.volatilityExpansionFactor}
                  onChange={(e) =>
                    handleUpdatePolicy({
                      takeProfit: { volatilityExpansionFactor: Number(e.target.value) },
                    })
                  }
                  className="mt-1 w-full accent-cyan-400 cursor-pointer"
                />
              </label>

              <div className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0b1224] px-3 py-2">
                <span className="text-[11px] text-slate-300">Hold Strictly Until Max TP3</span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    handleUpdatePolicy({
                      takeProfit: {
                        holdUntilMaxTarget: !activeProfile.takeProfit.holdUntilMaxTarget,
                      },
                    })
                  }
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold cursor-pointer ${
                    activeProfile.takeProfit.holdUntilMaxTarget
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {activeProfile.takeProfit.holdUntilMaxTarget ? 'LOCKED' : 'FLEXIBLE'}
                </button>
              </div>
            </div>
          </div>

          {/* Column 2: Decoupled Stop-Loss Policy */}
          <div className="lg:col-span-4 rounded-lg border border-slate-800/90 bg-[#060c1b]/90 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-300 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                Decoupled Stop-Loss Policy
              </span>
              <span className="font-mono text-[10px] text-slate-400">Cap &le; 2.0% Risk</span>
            </div>

            <div className="space-y-2.5 text-xs">
              <label className="block">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>ATR Trailing Stop Multiplier</span>
                  <span className="font-mono text-amber-300">
                    {activeProfile.stopLoss.atrStopMultiplier}x ATR
                  </span>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={3.0}
                  step={0.05}
                  value={activeProfile.stopLoss.atrStopMultiplier}
                  onChange={(e) =>
                    handleUpdatePolicy({ stopLoss: { atrStopMultiplier: Number(e.target.value) } })
                  }
                  className="mt-1 w-full accent-amber-400 cursor-pointer"
                />
              </label>

              <label className="block">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Risk Limit Per Trade</span>
                  <span className="font-mono text-rose-300">
                    {activeProfile.stopLoss.maxRiskPercentPerTrade}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={activeProfile.stopLoss.maxRiskPercentPerTrade}
                  onChange={(e) =>
                    handleUpdatePolicy({
                      stopLoss: { maxRiskPercentPerTrade: Number(e.target.value) },
                    })
                  }
                  className="mt-1 w-full accent-rose-400 cursor-pointer"
                />
              </label>

              <label className="block">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Extreme-Volatility SL Tightening</span>
                  <span className="font-mono text-cyan-300">
                    {activeProfile.stopLoss.volatilityTighteningFactor}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.75}
                  max={1.0}
                  step={0.05}
                  value={activeProfile.stopLoss.volatilityTighteningFactor}
                  onChange={(e) =>
                    handleUpdatePolicy({
                      stopLoss: { volatilityTighteningFactor: Number(e.target.value) },
                    })
                  }
                  className="mt-1 w-full accent-cyan-400 cursor-pointer"
                />
              </label>

              <div className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0b1224] px-3 py-2">
                <span className="text-[11px] text-slate-300">Dynamic Trailing Stop</span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    handleUpdatePolicy({
                      stopLoss: { trailingEnabled: !activeProfile.stopLoss.trailingEnabled },
                    })
                  }
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold cursor-pointer ${
                    activeProfile.stopLoss.trailingEnabled
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {activeProfile.stopLoss.trailingEnabled ? 'ENABLED' : 'STATIC'}
                </button>
              </div>
            </div>
          </div>

          {/* Column 3: Real-Time Volatility Adaptation & Autonomous Profit-Lock Preview */}
          <div className="lg:col-span-4 rounded-lg border border-cyan-500/25 bg-[#060c1b]/95 p-4 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-cyan-200 flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                Live Volatility Adaptation ({selectedSymbol})
              </span>
              <button
                type="button"
                onClick={() => runLiveEvaluation(selectedAgentId, simAtrPct, simPeakR, livePrice)}
                className="text-slate-400 hover:text-cyan-300 cursor-pointer"
                aria-label="Recompute volatility adaptation"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="block">
                <span className="text-slate-400">Live ATR Volatility ({simAtrPct}%)</span>
                <input
                  type="range"
                  min={0.6}
                  max={5.0}
                  step={0.1}
                  value={simAtrPct}
                  onChange={(e) => setSimAtrPct(Number(e.target.value))}
                  className="mt-1 w-full accent-cyan-400 cursor-pointer"
                />
              </label>
              <label className="block">
                <span className="text-slate-400">Peak Excursion (+{simPeakR}R)</span>
                <input
                  type="range"
                  min={0.5}
                  max={6.5}
                  step={0.1}
                  value={simPeakR}
                  onChange={(e) => setSimPeakR(Number(e.target.value))}
                  className="mt-1 w-full accent-emerald-400 cursor-pointer"
                />
              </label>
            </div>

            {evaluation && (
              <div className="space-y-2 border-t border-slate-800/80 pt-2.5 text-xs font-mono tabular-nums">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Regime · Effective R:R</span>
                  <span className="text-cyan-300 font-semibold">
                    {evaluation.volatilityRegime} · 1:{evaluation.effectiveRiskRewardRatio}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Adapted Stop / Lock</span>
                  <span className="text-amber-300 font-semibold">
                    ${formatCryptoPrice(evaluation.effectiveStopLoss)}
                    {evaluation.lockedProfitFloorR !== null
                      ? ` (+${evaluation.lockedProfitFloorR}R locked)`
                      : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Adapted TP3 Target</span>
                  <span className="text-emerald-400 font-semibold">
                    ${formatCryptoPrice(evaluation.effectiveTakeProfits[2])}
                  </span>
                </div>
                <p className="font-sans text-[11px] leading-snug text-slate-300 pt-1">
                  {evaluation.rationale}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
});
