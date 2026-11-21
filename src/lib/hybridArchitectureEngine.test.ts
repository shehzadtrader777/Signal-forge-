import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ARCHITECTURAL_REFERENCES,
  computeHorizontalCloneScalePlan,
  evaluatePaperValidationChamber,
  optimizeDynamicRiskParameters,
  runVectorizedMmapBacktest,
} from './hybridArchitectureEngine';
import { HybridArchitectureServerRuntime } from './hybridArchitectureServer';

describe('Signal Forge 6-Phase Hybrid Production Architecture', () => {
  it('Phase 2: scales autonomous AI worker clones into thousands driven by volatility and compute nodes', () => {
    const lowVol = computeHorizontalCloneScalePlan({
      marketVolatilityPct: 12,
      computeNodes: 4,
      baseClonesPerNode: 64,
    });
    const highVol = computeHorizontalCloneScalePlan({
      marketVolatilityPct: 48,
      computeNodes: 16,
      baseClonesPerNode: 64,
    });

    assert.ok(highVol.totalActiveClones > lowVol.totalActiveClones);
    assert.ok(highVol.totalActiveClones >= 2000, 'Expected horizontal scale into thousands of clones');
    const sumFamilies = Object.values(highVol.familyDistribution).reduce((a, b) => a + b, 0);
    assert.equal(sumFamilies, highVol.totalActiveClones);
  });

  it('Phase 3 & 6: executes vectorized mmap simulation across Crypto, Forex, and Equities with date-range slicing', () => {
    for (const assetClass of ['CRYPTO', 'FOREX', 'EQUITIES'] as const) {
      const report = runVectorizedMmapBacktest({
        assetClass,
        strategyFamily: 'BREAKOUT_MOMENTUM',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        regime: 'TRENDING_BULL',
        liveVolatilityPct: 22,
        tickCount: 4000,
      });
      assert.equal(report.assetClass, assetClass);
      assert.equal(report.ticksProcessed, 4000);
      assert.equal(report.mmapFrameBytes, 44);
      assert.ok(report.nsPerTick > 0 && report.nsPerTick < 150);
      assert.ok(report.entryPoints.length > 0);
    }
  });

  it('Phase 4 & 5: applies Paper Validation Chamber drag and adapts dynamic risk sizing to volatility', () => {
    const backtest = runVectorizedMmapBacktest({
      assetClass: 'CRYPTO',
      strategyFamily: 'BREAKOUT_MOMENTUM',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      regime: 'TRENDING_BULL',
      liveVolatilityPct: 20,
      tickCount: 5000,
    });
    const calmChamber = evaluatePaperValidationChamber(backtest, 15);
    const stressedChamber = evaluatePaperValidationChamber(backtest, 60);

    assert.ok(stressedChamber.avgSlippageBps > calmChamber.avgSlippageBps);
    assert.ok(stressedChamber.avgSimulatedLatencyMs > calmChamber.avgSimulatedLatencyMs);

    const calmRisk = optimizeDynamicRiskParameters({
      chamber: calmChamber,
      sharpeRatio: backtest.sharpeRatio,
      liveVolatilityPct: 15,
    });
    const stressedRisk = optimizeDynamicRiskParameters({
      chamber: stressedChamber,
      sharpeRatio: backtest.sharpeRatio,
      liveVolatilityPct: 60,
    });

    assert.ok(stressedRisk.optimizedPositionSizePct < calmRisk.optimizedPositionSizePct);
    assert.ok(stressedRisk.optimizedLeverageLimit < calmRisk.optimizedLeverageLimit);
    assert.ok(stressedRisk.optimizedHardDrawdownPct <= calmRisk.optimizedHardDrawdownPct);
  });

  it('Phase 6: persists strategy lifecycle into SQLite DB, blocks invalid dates and path traversal', () => {
    const projectRoot = process.cwd();
    const runtime = new HybridArchitectureServerRuntime(projectRoot, ':memory:');
    try {
      const initial = runtime.getStateSnapshot();
      assert.ok(initial.trackedStrategies.length >= 3);
      assert.equal(ARCHITECTURAL_REFERENCES.length, 5);

      const created = runtime.runBacktestAndTrack({
        assetClass: 'FOREX',
        strategyFamily: 'MEAN_REVERSION',
        startDate: '2023-01-01',
        endDate: '2024-01-01',
        regime: 'HIGH_VOL_CHOP',
        liveVolatilityPct: 38,
        tickCount: 3000,
      });

      const fetched = runtime.getStrategyById(created.strategyId);
      assert.ok(fetched);
      assert.equal(fetched.strategyId, created.strategyId);
      assert.equal(fetched.startDate, '2023-01-01');
      assert.equal(fetched.endDate, '2024-01-01');

      assert.throws(() => {
        runtime.runBacktestAndTrack({
          assetClass: 'CRYPTO',
          strategyFamily: 'STAT_ARB',
          startDate: '2025-05-01',
          endDate: '2024-05-01',
          regime: 'TRENDING_BULL',
          liveVolatilityPct: 20,
        });
      }, /strictly after/i);

      // Allowlisted source viewer reads real Rust & Python files
      const rustSrc = runtime.readAllowlistedSource('rust_orderbook');
      assert.ok(rustSrc.content.includes('OrderBookRouter'));
      const pySrc = runtime.readAllowlistedSource('py_mmap');
      assert.ok(pySrc.content.includes('mmap.mmap'));

      // Rejects traversal or non-allowlisted keys
      assert.throws(() => {
        runtime.readAllowlistedSource('../../.env');
      }, /allowlist/i);
      assert.equal(path.basename(projectRoot).length > 0, true);
    } finally {
      runtime.close();
    }
  });
});
