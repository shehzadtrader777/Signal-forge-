import { memo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Calculator,
  CheckCircle2,
  Radar,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { formatCryptoPrice } from '../lib/marketData';
import {
  type MarketPatternScanSummary,
  type PatternScanResult,
  type PatternScannerParams,
  type PatternSignalMode,
} from '../lib/patternScanner';
import { type TradingSignal } from '../lib/signals';
import { useApp } from '../context/AppContext';

interface PatternScannerPanelProps {
  summary: MarketPatternScanSummary;
  params: PatternScannerParams;
  onChangeParams: (next: PatternScannerParams) => void;
  autoScanEnabled: boolean;
  onToggleAutoScan: () => void;
  scanning: boolean;
  onManualScan: () => void;
  onOpenRiskCalc: (signal: TradingSignal) => void;
  onSendToCoordinator?: (item: PatternScanResult) => void;
}

type ScannerTab = 'CONFIRMED' | 'FAKEOUTS' | 'COILS';

function toRiskCalculatorSignal(item: PatternScanResult): TradingSignal {
  return {
    id: item.id,
    symbol: item.symbol,
    baseAsset: item.baseAsset,
    coinName: item.coinName,
    direction: item.direction,
    entryPrice: item.entryPrice,
    stopLoss: item.stopLoss,
    takeProfits: item.takeProfits,
    confidence: item.confidence,
    technicalScore: item.direction === 'BUY' ? 75 : -75,
    fundamentalScore: 0,
    indicators: {
      rsi: item.rsi,
      ema9: item.entryPrice,
      ema21: item.breakoutLevel,
      ema50: item.breakoutLevel,
      macdLine: 0,
      macdSignal: 0,
      macdHistogram: 0,
      bbUpper: item.takeProfits[0],
      bbMiddle: item.breakoutLevel,
      bbLower: item.stopLoss,
      bbPercentB: 0.5,
      pattern: `${item.patternName} (${item.moveType})`,
      score: item.direction === 'BUY' ? 75 : -75,
      summary: item.summary,
    },
    fundamental: {
      score: 0,
      articleCount: 0,
      bullishCount: 0,
      bearishCount: 0,
      topHeadline: item.summary,
      summary: item.summary,
    },
    reason: item.summary,
    generatedAt: item.detectedAt,
  };
}

export const PatternScannerPanel = memo(function PatternScannerPanel({
  summary,
  params,
  onChangeParams,
  autoScanEnabled,
  onToggleAutoScan,
  scanning,
  onManualScan,
  onOpenRiskCalc,
  onSendToCoordinator,
}: PatternScannerPanelProps) {
  const { setSelectedSymbol } = useApp();
  const [activeTab, setActiveTab] = useState<ScannerTab>('CONFIRMED');

  const activeList =
    activeTab === 'CONFIRMED'
      ? summary.confirmedSignals
      : activeTab === 'FAKEOUTS'
      ? summary.filteredFakeouts
      : summary.watchingCoils;

  return (
    <section
      aria-label="Chart Pattern Breakout and Anti-Fakeout Scanner"
      className="scroll-mt-20 rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      {/* Header & Continuous Scan Controls */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
            <span className="font-semibold text-emerald-400">
              {autoScanEnabled ? 'Continuous Scan Active (30s)' : 'Manual Scan Mode'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {summary.scannedCount} pairs ({params.timeframe})
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-emerald-400">
              {summary.confirmedSignals.length} Confirmed
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-amber-300">
              {summary.filteredFakeouts.length} Fakeouts Filtered
            </span>
          </div>
          <h2 className="mt-0.5 font-display text-lg font-bold text-white flex items-center gap-2">
            <Radar className="h-5 w-5 text-[#3b82f6] shrink-0" aria-hidden="true" />
            <span>Chart Pattern Breakout &amp; Breakdown Scanner (Anti-Fakeout Filter)</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleAutoScan}
            aria-pressed={autoScanEnabled}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              autoScanEnabled
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-slate-700 bg-[#0a0e1a] text-slate-300 hover:border-slate-500'
            }`}
          >
            Auto-Scan 30s: {autoScanEnabled ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={onManualScan}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#3b82f6] transition-colors cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
            <span>{scanning ? 'Scanning...' : 'Scan Patterns'}</span>
          </button>
        </div>
      </div>

      {/* Parameter Selection Bar */}
      <div className="grid grid-cols-2 gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-3.5 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label
            htmlFor="pat-signal-mode"
            className="block text-[11px] font-medium text-slate-400 mb-1"
          >
            Signal Direction
          </label>
          <select
            id="pat-signal-mode"
            value={params.signalMode}
            onChange={(e) =>
              onChangeParams({ ...params, signalMode: e.target.value as PatternSignalMode })
            }
            className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 text-xs font-medium text-white focus:border-[#3b82f6] focus:outline-none"
          >
            <option value="BOTH">Long &amp; Short</option>
            <option value="LONG_ONLY">Long Breakouts Only</option>
            <option value="SHORT_ONLY">Short Breakdowns Only</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="pat-min-vol"
            className="block text-[11px] font-medium text-slate-400 mb-1"
          >
            Min Volume Spike
          </label>
          <select
            id="pat-min-vol"
            value={String(params.minVolumeMultiplier)}
            onChange={(e) =>
              onChangeParams({ ...params, minVolumeMultiplier: Number(e.target.value) })
            }
            className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs font-medium text-white focus:border-[#3b82f6] focus:outline-none"
          >
            <option value="1.1">1.10x avg20</option>
            <option value="1.35">1.35x avg20 (Strict)</option>
            <option value="1.6">1.60x avg20</option>
            <option value="2">2.00x avg20</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="pat-min-close"
            className="block text-[11px] font-medium text-slate-400 mb-1"
          >
            Close Beyond Level
          </label>
          <select
            id="pat-min-close"
            value={String(params.minClosePercentBeyondLevel)}
            onChange={(e) =>
              onChangeParams({ ...params, minClosePercentBeyondLevel: Number(e.target.value) })
            }
            className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs font-medium text-white focus:border-[#3b82f6] focus:outline-none"
          >
            <option value="0.1">+/- 0.10%</option>
            <option value="0.2">+/- 0.20% (Strict)</option>
            <option value="0.4">+/- 0.40%</option>
            <option value="0.75">+/- 0.75%</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="pat-min-conf"
            className="block text-[11px] font-medium text-slate-400 mb-1"
          >
            Min Confidence
          </label>
          <select
            id="pat-min-conf"
            value={String(params.minConfidence)}
            onChange={(e) =>
              onChangeParams({ ...params, minConfidence: Number(e.target.value) })
            }
            className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs font-medium text-white focus:border-[#3b82f6] focus:outline-none"
          >
            <option value="65">65%+</option>
            <option value="70">70%+ (Strict)</option>
            <option value="78">78%+</option>
            <option value="85">85%+</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="pat-rr-target"
            className="block text-[11px] font-medium text-slate-400 mb-1"
          >
            Target R:R
          </label>
          <select
            id="pat-rr-target"
            value={String(params.riskRewardTarget)}
            onChange={(e) =>
              onChangeParams({ ...params, riskRewardTarget: Number(e.target.value) })
            }
            className="w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 font-mono text-xs font-medium text-white focus:border-[#3b82f6] focus:outline-none"
          >
            <option value="2">1:2 R:R</option>
            <option value="3">1:3 R:R</option>
            <option value="5">1:5 R:R</option>
          </select>
        </div>

        <div className="flex flex-col justify-end">
          <button
            type="button"
            onClick={() =>
              onChangeParams({ ...params, strictFakeoutFilter: !params.strictFakeoutFilter })
            }
            aria-pressed={params.strictFakeoutFilter}
            className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              params.strictFakeoutFilter
                ? 'border-[#3b82f6]/50 bg-[#3b82f6]/15 text-blue-300'
                : 'border-slate-700 bg-[#0a0e1a] text-slate-400 hover:text-white'
            }`}
          >
            Fakeout Filter: {params.strictFakeoutFilter ? 'STRICT' : 'RELAXED'}
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3">
        <div className="inline-flex rounded-lg border border-slate-800 bg-[#0a0e1a] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('CONFIRMED')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors cursor-pointer ${
              activeTab === 'CONFIRMED'
                ? 'bg-[#3b82f6] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Confirmed Signals ({summary.confirmedSignals.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('FAKEOUTS')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors cursor-pointer ${
              activeTab === 'FAKEOUTS'
                ? 'bg-amber-500/20 text-amber-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Filtered Fakeouts ({summary.filteredFakeouts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('COILS')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors cursor-pointer ${
              activeTab === 'COILS'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Coiling Watchlist ({summary.watchingCoils.length})
          </button>
        </div>

        <span className="text-[11px] text-slate-400">
          {activeTab === 'CONFIRMED'
            ? 'Passed candle close, wick rejection, volume surge & momentum alignment checks'
            : activeTab === 'FAKEOUTS'
            ? 'Blocked traps failing volume expansion, close confirmation, or wick guards'
            : 'Pre-breakout compression setups approaching resistance or support'}
        </span>
      </div>

      {/* Results Table */}
      {activeList.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-400">
          {activeTab === 'CONFIRMED'
            ? 'No breakouts or breakdowns currently satisfy all strict anti-fakeout thresholds. Adjust parameters above or inspect Filtered Fakeouts / Coiling Watchlist.'
            : activeTab === 'FAKEOUTS'
            ? 'No fakeout traps detected on the current candle scan.'
            : 'No coiling patterns currently in pre-breakout standby.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0d1323] text-slate-400">
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Pair</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Pattern &amp; Move</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Signal</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Trigger Level</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Vol / Close</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Entry / SL</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Target (TP3)</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {activeTab === 'FAKEOUTS' ? 'Fakeout Rejection Reason' : 'Verification Checks'}
                </th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {activeList.map((item) => {
                const isBuy = item.direction === 'BUY';
                return (
                  <tr key={item.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedSymbol(item.symbol)}
                        className="text-left group cursor-pointer"
                      >
                        <span className="font-mono font-bold text-white group-hover:text-[#3b82f6] transition-colors">
                          {item.symbol}
                        </span>
                        <span className="block text-[11px] text-slate-400">{item.coinName}</span>
                      </button>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-semibold text-slate-200">{item.patternName}</span>
                      <span className="block text-[11px] text-slate-400">
                        {item.moveType} · {item.confidence}% Conf
                      </span>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 font-bold ${
                          isBuy ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isBuy ? (
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {isBuy ? 'LONG' : 'SHORT'}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                      ${formatCryptoPrice(item.breakoutLevel)}
                    </td>

                    <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <span
                        className={
                          item.volumeRatio >= params.minVolumeMultiplier
                            ? 'text-emerald-400'
                            : 'text-amber-300'
                        }
                      >
                        {item.volumeRatio.toFixed(2)}x vol
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        {item.closeBeyondPercent >= 0 ? '+' : ''}
                        {item.closeBeyondPercent.toFixed(2)}%
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <span className="text-white">${formatCryptoPrice(item.entryPrice)}</span>
                      <span className="block text-[11px] text-rose-400">
                        SL ${formatCryptoPrice(item.stopLoss)}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <span className="text-emerald-400">
                        ${formatCryptoPrice(item.takeProfits[2])}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        1:{item.riskRewardRatio} R:R
                      </span>
                    </td>

                    <td className="px-4 py-3 max-w-xs">
                      {item.fakeoutReasons.length > 0 ? (
                        <div className="flex items-start gap-1.5 text-[11px] text-amber-300">
                          <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{item.fakeoutReasons[0]}</span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1.5 text-[11px] text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{item.passedChecks[0]}</span>
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {onSendToCoordinator && activeTab === 'CONFIRMED' && (
                          <button
                            type="button"
                            onClick={() => onSendToCoordinator(item)}
                            className="inline-flex items-center gap-1 rounded-md border border-[#3b82f6]/50 bg-[#3b82f6]/15 px-2.5 py-1.5 text-[11px] font-semibold text-blue-200 hover:bg-[#3b82f6]/30 transition-colors cursor-pointer"
                          >
                            <Bot className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>Coord</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenRiskCalc(toRiskCalculatorSignal(item))}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#0a0e1a] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:border-[#3b82f6] transition-colors cursor-pointer"
                        >
                          <Calculator className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>Size</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});
