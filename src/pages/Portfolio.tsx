import { LivePriceStrip } from '../components/LivePriceStrip';
import { SystemControlsBar } from '../components/SystemControlsBar';
import { PortfolioManagementHub } from '../components/portfolio/PortfolioManagementHub';
import { ErrorBoundary } from '../components/ErrorBoundary';

export function Portfolio() {
  return (
    <div>
      <LivePriceStrip />
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        <SystemControlsBar />
        <ErrorBoundary title="Portfolio Workspace Recovery">
          <PortfolioManagementHub />
        </ErrorBoundary>
      </div>
    </div>
  );
}
