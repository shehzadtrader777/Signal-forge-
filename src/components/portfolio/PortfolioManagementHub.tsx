import { Briefcase, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { ErrorBoundary } from '../ErrorBoundary';
import { MultiAssetExposureMeter } from './MultiAssetExposureMeter';
import { VolatilityRiskGauges } from './VolatilityRiskGauges';
import { AssetAllocationCharts } from './AssetAllocationCharts';
import { AutoRebalanceControls } from './AutoRebalanceControls';
import { safeFiniteNumber } from '../../lib/portfolioManager';

interface PortfolioManagementHubProps {
  compact?: boolean;
}

export function PortfolioManagementHub({ compact = false }: PortfolioManagementHubProps) {
  const {
    portfolioEvaluation,
    portfolioHoldings,
    portfolioReserveUsd,
    portfolioConfig,
    portfolioRebalanceHistory,
    portfolioBusy,
    updatePortfolioConfig,
    updatePortfolioHoldingUnits,
    executePortfolioRebalanceNow,
    resetPortfolioBaseline,
  } = useApp();

  const equityUsd = safeFiniteNumber(portfolioEvaluation?.exposureMeter?.totalEquityUsd, 0);
  const grossPct = safeFiniteNumber(portfolioEvaluation?.exposureMeter?.grossExposurePct, 0);
  const riskScore = safeFiniteNumber(portfolioEvaluation?.volatilityRisk?.riskScore, 0);

  return (
    <section
      aria-label="Multi-Asset Portfolio & Volatility Auto-Rebalancing"
      className="space-y-5"
    >
      {/* Section Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs text-slate-400">
            Volatility-Weighted Risk Parity · Live WebSocket Mark Valuations · Threshold &amp; Periodic Auto-Rebalance
          </span>
          <h2 className="mt-0.5 font-display text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-[#3b82f6] shrink-0" aria-hidden="true" />
            <span>Multi-Asset Portfolio &amp; Volatility Rebalancer</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="font-mono text-slate-300 tabular-nums">
            Equity <strong className="text-white">${equityUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
            <span className="mx-2 text-slate-600" aria-hidden="true">·</span>
            Exposure <strong className="text-white">{grossPct.toFixed(1)}%</strong>
            <span className="mx-2 text-slate-600" aria-hidden="true">·</span>
            Vol Risk <strong className="text-white">{riskScore}/100</strong>
          </div>

          {compact && (
            <Link
              to="/portfolio"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#3b82f6] transition-colors whitespace-nowrap"
            >
              <span>Full Portfolio Desk</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {/* Responsive CSS Grid Layout with Isolated Error Boundaries per Module */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-6 min-w-0 flex flex-col">
          <ErrorBoundary title="Exposure Meter Recovery">
            <MultiAssetExposureMeter evaluation={portfolioEvaluation} />
          </ErrorBoundary>
        </div>

        <div className="lg:col-span-6 min-w-0 flex flex-col">
          <ErrorBoundary title="Volatility Risk Gauges Recovery">
            <VolatilityRiskGauges evaluation={portfolioEvaluation} />
          </ErrorBoundary>
        </div>

        <div className="lg:col-span-5 min-w-0 flex flex-col">
          <ErrorBoundary title="Asset Allocation Charts Recovery">
            <AssetAllocationCharts evaluation={portfolioEvaluation} />
          </ErrorBoundary>
        </div>

        <div className="lg:col-span-7 min-w-0 flex flex-col">
          <ErrorBoundary title="Auto-Rebalancing Controls Recovery">
            <AutoRebalanceControls
              evaluation={portfolioEvaluation}
              holdings={portfolioHoldings}
              stablecoinReserveUsd={portfolioReserveUsd}
              config={portfolioConfig}
              history={portfolioRebalanceHistory}
              onUpdateConfig={updatePortfolioConfig}
              onUpdateHoldingUnits={updatePortfolioHoldingUnits}
              onExecuteRebalanceNow={executePortfolioRebalanceNow}
              onResetBaseline={resetPortfolioBaseline}
              rebalancingBusy={portfolioBusy}
            />
          </ErrorBoundary>
        </div>
      </div>
    </section>
  );
}
