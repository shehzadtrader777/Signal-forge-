import { useState } from 'react';
import { Calculator, X } from 'lucide-react';
import { type TradingSignal } from '../lib/signals';
import { calculateRiskMetrics } from '../lib/riskCalculator';
import { formatCryptoPrice } from '../lib/marketData';

interface RiskCalculatorModalProps {
  signal: TradingSignal | null;
  onClose: () => void;
}

const LEVERAGE_PRESETS = [1, 5, 10, 20, 50];

export function RiskCalculatorModal({ signal, onClose }: RiskCalculatorModalProps) {
  const [balanceInput, setBalanceInput] = useState('10000');
  const [riskInput, setRiskInput] = useState('2');
  const [leverageInput, setLeverageInput] = useState('10');

  if (!signal) return null;

  const balance = Number(balanceInput);
  const riskPercent = Number(riskInput);
  const leverage = Number(leverageInput);

  const metrics = calculateRiskMetrics({
    balance,
    riskPercent,
    leverage,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    takeProfits: signal.takeProfits,
    direction: signal.direction,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risk-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-700/80 bg-[#111827] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Calculator className="h-5 w-5 text-[#3b82f6]" aria-hidden="true" />
            <h2 id="risk-modal-title" className="font-display text-lg font-bold text-white">
              Risk Management Calculator · {signal.symbol} ({signal.direction})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close risk calculator"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Signal Reference Strip */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-[#0d1323] p-3 text-xs">
            <div>
              <span className="text-slate-400">Entry Price</span>
              <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-white">
                ${formatCryptoPrice(signal.entryPrice)}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Stop Loss</span>
              <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-rose-400">
                ${formatCryptoPrice(signal.stopLoss)}
              </span>
            </div>
          </div>

          {/* Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="risk-account-balance"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Account Balance ($)
              </label>
              <input
                id="risk-account-balance"
                type="number"
                min="1"
                step="any"
                value={balanceInput}
                onChange={(e) => setBalanceInput(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="risk-percent-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Risk % (Default 2%)
              </label>
              <input
                id="risk-percent-input"
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={riskInput}
                onChange={(e) => setRiskInput(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="risk-leverage-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Leverage (1x–125x)
              </label>
              <input
                id="risk-leverage-input"
                type="number"
                min="1"
                max="125"
                step="1"
                value={leverageInput}
                onChange={(e) => setLeverageInput(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">Quick Leverage Presets</span>
            <div className="flex items-center gap-1.5" role="group" aria-label="Leverage presets">
              {LEVERAGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setLeverageInput(String(preset))}
                  className={`rounded-md px-2.5 py-1 font-mono text-xs font-medium transition-colors cursor-pointer ${
                    leverage === preset
                      ? 'bg-[#3b82f6] text-white'
                      : 'border border-slate-800 bg-[#0d1323] text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  {preset}x
                </button>
              ))}
            </div>
          </div>

          {/* Formula Reference */}
          <div className="rounded-lg border border-[#3b82f6]/30 bg-[#3b82f6]/10 px-3.5 py-2.5">
            <span className="block text-[11px] font-medium text-blue-300">Formula Applied</span>
            <code className="mt-0.5 block font-mono text-xs text-white">
              Position Size = (Balance * Risk%) / (Entry - SL)
            </code>
          </div>

          {!metrics.isValid ? (
            <p className="text-xs text-rose-400" role="alert">
              {metrics.errorMessage}
            </p>
          ) : (
            <div className="space-y-4">
              {metrics.exceedsBalance && (
                <p
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
                  role="status"
                >
                  Required margin (${metrics.requiredMarginUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}) exceeds your account balance. Increase leverage or reduce risk %.
                </p>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                  <span className="block text-xs text-slate-400">Position Size (USD)</span>
                  <span className="mt-1 block font-mono text-base font-bold tabular-nums text-white">
                    ${metrics.positionValueUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                  <span className="block text-xs text-slate-400">
                    Required Margin ({metrics.leverage}x)
                  </span>
                  <span className="mt-1 block font-mono text-base font-bold tabular-nums text-white">
                    ${metrics.requiredMarginUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                  <span className="block text-xs text-slate-400">
                    Lot Size ({signal.baseAsset})
                  </span>
                  <span className="mt-1 block font-mono text-base font-bold tabular-nums text-[#3b82f6]">
                    {metrics.lotSize}
                  </span>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3">
                  <span className="block text-xs text-slate-400">Potential Loss (SL)</span>
                  <span className="mt-1 block font-mono text-base font-bold tabular-nums text-rose-400">
                    -${metrics.potentialLossUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0d1323] p-3 col-span-2 sm:col-span-2">
                  <span className="block text-xs text-slate-400">Stop Distance</span>
                  <span className="mt-1 block font-mono text-base font-bold tabular-nums text-slate-200">
                    {metrics.stopDistancePercent}% (${metrics.stopDistancePerUnit})
                  </span>
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-400 mb-2">
                  Projected Profit Targets
                </span>
                <div className="grid grid-cols-3 gap-2.5">
                  {metrics.potentialProfitsUsd.map((profit, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-slate-800 bg-[#0d1323] p-2.5"
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>TP {idx + 1}</span>
                        <span className="font-mono">{metrics.riskRewardRatios[idx]}R</span>
                      </div>
                      <span className="mt-1 block font-mono text-sm font-semibold tabular-nums text-emerald-400">
                        +${profit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 px-5 py-3.5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
