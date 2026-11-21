import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_FABLE_PROP_LIMITS,
  FABLE_EIGHT_LAYER_SPEC,
  buildBlackScholesIvSurface,
  computeInverseVarianceWeights,
  evaluateLayer6PreTradeRisk,
  generateDeterministicBenchPrices,
  priceBlackScholesOption,
  proposeSingleParameterMutation,
  runFourGateValidation,
  type BlackScholesInput,
  type BlackScholesValuation,
  type FableDeploymentStage,
  type FableFourGateValidationReport,
  type FableInverseVarianceWeight,
  type FableLayerStatusItem,
  type FablePreTradeRiskDecision,
  type FablePropFirmLimits,
  type FableStrategicMemoryEntry,
  type FableStrategyFamily,
  type FableStrategyFamilyProfile,
  type FableStrategyParams,
  type FableStrategyVersion,
  type FableVolatilityRegime,
  type IvSurfacePoint,
} from './fableOrchestratorEngine';

export interface FableDeploymentTicket {
  readonly versionId: string;
  readonly stage: FableDeploymentStage;
  readonly approvalToken: string;
  readonly stagedAtIso: string;
  readonly approvedAtIso: string | null;
  readonly approvedBy: string | null;
}

export interface FableOrchestratorSnapshot {
  readonly layers: readonly FableLayerStatusItem[];
  readonly propLimits: FablePropFirmLimits;
  readonly activeVersion: FableStrategyVersion;
  readonly versionCounter: number;
  readonly families: readonly FableStrategyFamilyProfile[];
  readonly inverseVarianceWeights: readonly FableInverseVarianceWeight[];
  readonly deploymentTicket: FableDeploymentTicket;
  readonly latestValidation: FableFourGateValidationReport | null;
  readonly validationHistory: readonly FableFourGateValidationReport[];
  readonly latestRiskDecision: FablePreTradeRiskDecision;
  readonly latestOptionValuation: BlackScholesValuation;
  readonly ivSurface: readonly IvSurfacePoint[];
  readonly strategicMemory: readonly FableStrategicMemoryEntry[];
  readonly pythonModules: readonly { readonly id: string; readonly relativePath: string; readonly layerSummary: string }[];
}

const ALLOWLISTED_PYTHON_MODULES: readonly {
  readonly id: string;
  readonly relativePath: string;
  readonly layerSummary: string;
}[] = Object.freeze([
  {
    id: 'main_orchestrator',
    relativePath: 'fable_5_2/main_orchestrator.py',
    layerSummary: 'Layers 1–3, 7 & Unified 8-Layer Orchestration Loop',
  },
  {
    id: 'risk_manager',
    relativePath: 'fable_5_2/risk/risk_manager.py',
    layerSummary: 'Layer 6 Prop Firm Limits, Half-Kelly, ATR Stops, Spread & Inverse Variance',
  },
  {
    id: 'validator',
    relativePath: 'fable_5_2/backtest/validator.py',
    layerSummary: 'Layers 4–5 4-Gate Validator, Phase 5 Single-Param Evolution & Black-Scholes',
  },
  {
    id: 'dashboard',
    relativePath: 'fable_5_2/monitoring/dashboard.py',
    layerSummary: 'Layer 8 Strategic Memory SQLite, Streamlit UI & Discord Reporter',
  },
]);

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Stateful Server Runtime for Signal Forge Fable 5.2 8-Layer Self-Improving Orchestrator.
 * Maintains Strategic Memory provenance, Layer 7 Paper-to-Live human sign-off tickets,
 * and allowlisted read-only access to the modular `/fable_5_2/` Python package.
 */
export class FableOrchestratorRuntime {
  private readonly workspaceRoot: string;
  private versionCounter = 1;
  private activeVersion: FableStrategyVersion;
  private readonly families: FableStrategyFamilyProfile[];
  private deploymentTicket: FableDeploymentTicket;
  private readonly validationHistory: FableFourGateValidationReport[] = [];
  private latestRiskDecision: FablePreTradeRiskDecision;
  private latestOptionValuation: BlackScholesValuation;
  private ivSurface: readonly IvSurfacePoint[];
  private readonly strategicMemory: FableStrategicMemoryEntry[] = [];

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    const nowIso = new Date().toISOString();

    this.activeVersion = {
      versionId: 'momentum-v1',
      family: 'MOMENTUM',
      params: { lookback: 20, entryZscore: 1.2, stopAtrMult: 1.5 },
      parentVersionId: null,
      createdAtIso: nowIso,
    };

    this.families = [
      {
        family: 'BREAKOUT',
        label: 'Breakout',
        annualizedVolatility: 0.34,
        oosSharpe: 1.42,
        winRate: 0.52,
        payoffRatio: 1.95,
      },
      {
        family: 'MEAN_REVERSION',
        label: 'Mean Reversion',
        annualizedVolatility: 0.18,
        oosSharpe: 1.84,
        winRate: 0.62,
        payoffRatio: 1.48,
      },
      {
        family: 'MOMENTUM',
        label: 'Momentum',
        annualizedVolatility: 0.24,
        oosSharpe: 1.96,
        winRate: 0.57,
        payoffRatio: 2.1,
      },
    ];

    this.deploymentTicket = this.createPaperTicket(this.activeVersion.versionId);

    this.latestRiskDecision = evaluateLayer6PreTradeRisk({
      side: 'BUY',
      bid: 91_395,
      ask: 91_405, // ~0.0109% spread <= 0.02%
      atr: 840,
      regime: 'QUIET',
      currentEquityUsd: 100_000,
      startOfDayEquityUsd: 100_000,
      highWaterMarkEquityUsd: 100_000,
      strategyFamily: this.families[2],
      allFamilies: this.families,
      activeCorrelations: [0.22, -0.14],
    });

    this.latestOptionValuation = priceBlackScholesOption({
      symbol: 'BTC-30D-ATM-PUT',
      optionType: 'PUT',
      spotPrice: 91_400,
      strikePrice: 91_400,
      timeToExpiryYears: 30 / 365,
      riskFreeRate: 0.045,
      volatility: 0.46,
    });

    this.ivSurface = buildBlackScholesIvSurface({
      symbol: 'BTCUSDT',
      spotPrice: 91_400,
      baseVolatility: 0.46,
    });

    this.recordMemory({
      layer: 'LAYER_1_8_BOOT',
      eventType: 'RISK_CHECK',
      versionId: this.activeVersion.versionId,
      oosSharpe: this.families[2].oosSharpe,
      oosMaxDrawdownPct: 0.032,
      summary:
        'Fable 5.2 8-Layer Orchestrator initialized with Inverse Variance Risk Parity, Half-Kelly sizing, and Black-Scholes validator.',
    });
  }

  private createPaperTicket(versionId: string): FableDeploymentTicket {
    return {
      versionId,
      stage: 'PAPER_TRADING',
      approvalToken: crypto.randomBytes(16).toString('hex'),
      stagedAtIso: new Date().toISOString(),
      approvedAtIso: null,
      approvedBy: null,
    };
  }

  private recordMemory(entry: Omit<FableStrategicMemoryEntry, 'id' | 'recordedAtIso'>): void {
    this.strategicMemory.unshift({
      id: `mem_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      recordedAtIso: new Date().toISOString(),
      ...entry,
    });
    if (this.strategicMemory.length > 80) {
      this.strategicMemory.length = 80;
    }
  }

  getSnapshot(): FableOrchestratorSnapshot {
    return {
      layers: FABLE_EIGHT_LAYER_SPEC,
      propLimits: DEFAULT_FABLE_PROP_LIMITS,
      activeVersion: this.activeVersion,
      versionCounter: this.versionCounter,
      families: this.families,
      inverseVarianceWeights: computeInverseVarianceWeights(this.families),
      deploymentTicket: this.deploymentTicket,
      latestValidation: this.validationHistory[0] ?? null,
      validationHistory: this.validationHistory.slice(0, 15),
      latestRiskDecision: this.latestRiskDecision,
      latestOptionValuation: this.latestOptionValuation,
      ivSurface: this.ivSurface,
      strategicMemory: this.strategicMemory.slice(0, 40),
      pythonModules: ALLOWLISTED_PYTHON_MODULES,
    };
  }

  runPhase5Evolution(input: {
    readonly parameterToMutate: keyof FableStrategyParams;
    readonly newValue: number;
    readonly regime?: FableVolatilityRegime;
    readonly spotPrice?: number;
  }): { readonly ok: boolean; readonly report: FableFourGateValidationReport; readonly snapshot: FableOrchestratorSnapshot } {
    const spot = input.spotPrice && input.spotPrice > 0 ? input.spotPrice : 91_400;
    const regime: FableVolatilityRegime =
      input.regime === 'HIGH_VOLATILITY' ? 'HIGH_VOLATILITY' : 'QUIET';
    const series = generateDeterministicBenchPrices(200, spot, regime);
    const inSamplePrices = series.slice(0, 120);
    const outOfSamplePrices = series.slice(120);

    const nextNum = this.versionCounter + 1;
    const { candidate, hypothesis } = proposeSingleParameterMutation(
      this.activeVersion,
      input.parameterToMutate,
      input.newValue,
      nextNum
    );

    const cycleId = `p5_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const report = runFourGateValidation({
      cycleId,
      incumbentV1: this.activeVersion,
      candidateV2: candidate,
      hypothesis,
      inSamplePrices,
      outOfSamplePrices,
      optionContract: {
        symbol: 'BTC-30D-ATM-PUT',
        optionType: 'PUT',
        spotPrice: spot,
        strikePrice: spot,
        timeToExpiryYears: 30 / 365,
        riskFreeRate: 0.045,
        volatility: regime === 'HIGH_VOLATILITY' ? 0.62 : 0.44,
      },
    });

    this.validationHistory.unshift(report);
    if (this.validationHistory.length > 25) this.validationHistory.length = 25;

    if (report.promotedV2OverV1) {
      this.versionCounter = nextNum;
      this.activeVersion = candidate;
      this.deploymentTicket = this.createPaperTicket(candidate.versionId);
      this.recordMemory({
        layer: 'LAYER_5_EVOLUTION',
        eventType: 'VERSION_PROMOTED',
        versionId: candidate.versionId,
        oosSharpe: report.v2Oos.sharpeRatio,
        oosMaxDrawdownPct: report.v2Oos.maxDrawdownPct,
        summary: `Promoted ${candidate.versionId} over ${report.incumbentVersionId} (${report.mutatedParameters[0]}) — OOS Sharpe ${report.v2Oos.sharpeRatio.toFixed(3)}, Max DD ${(report.v2Oos.maxDrawdownPct * 100).toFixed(2)}%. Staged in Paper Trading.`,
      });
    } else {
      this.recordMemory({
        layer: 'LAYER_5_EVOLUTION',
        eventType: 'V2_REJECTED',
        versionId: candidate.versionId,
        oosSharpe: report.v2Oos.sharpeRatio,
        oosMaxDrawdownPct: report.v2Oos.maxDrawdownPct,
        summary: `Rejected ${candidate.versionId} (${hypothesis}): ${report.reasons[0] ?? 'Failed 4-gate OOS benchmark.'}`,
      });
    }

    return { ok: true, report, snapshot: this.getSnapshot() };
  }

  evaluateRisk(input: {
    readonly side: 'BUY' | 'SELL';
    readonly bid: number;
    readonly ask: number;
    readonly atr: number;
    readonly regime: FableVolatilityRegime;
    readonly currentEquityUsd: number;
    readonly startOfDayEquityUsd: number;
    readonly highWaterMarkEquityUsd: number;
    readonly family: FableStrategyFamily;
    readonly sharpeOverride?: number;
    readonly activeCorrelations: readonly number[];
  }): { readonly ok: boolean; readonly decision: FablePreTradeRiskDecision; readonly snapshot: FableOrchestratorSnapshot } {
    const baseFam =
      this.families.find((f) => f.family === input.family) ?? this.families[2];
    const effectiveFam: FableStrategyFamilyProfile =
      typeof input.sharpeOverride === 'number' && Number.isFinite(input.sharpeOverride)
        ? { ...baseFam, oosSharpe: input.sharpeOverride }
        : baseFam;

    const decision = evaluateLayer6PreTradeRisk({
      side: input.side,
      bid: input.bid,
      ask: input.ask,
      atr: input.atr,
      regime: input.regime,
      currentEquityUsd: input.currentEquityUsd,
      startOfDayEquityUsd: input.startOfDayEquityUsd,
      highWaterMarkEquityUsd: input.highWaterMarkEquityUsd,
      strategyFamily: effectiveFam,
      allFamilies: this.families,
      activeCorrelations: input.activeCorrelations,
    });

    this.latestRiskDecision = decision;
    this.recordMemory({
      layer: 'LAYER_6_RISK',
      eventType: 'RISK_CHECK',
      versionId: this.activeVersion.versionId,
      oosSharpe: effectiveFam.oosSharpe,
      oosMaxDrawdownPct: decision.totalDrawdownPct,
      summary: decision.approved
        ? `APPROVED ${input.side} (${effectiveFam.family}) via ${decision.sizingMode} · ${decision.trailingStopAtrMult}x ATR · spread ${(decision.bidAskSpreadPct * 100).toFixed(4)}%.`
        : `BLOCKED ${input.side} (${effectiveFam.family}): ${decision.rejectionReasons[0] ?? 'Risk limit violation.'}`,
    });

    return { ok: true, decision, snapshot: this.getSnapshot() };
  }

  evaluateOption(input: BlackScholesInput): {
    readonly ok: boolean;
    readonly valuation: BlackScholesValuation;
    readonly ivSurface: readonly IvSurfacePoint[];
    readonly snapshot: FableOrchestratorSnapshot;
  } {
    const valuation = priceBlackScholesOption(input);
    const ivSurface = buildBlackScholesIvSurface({
      symbol: input.symbol,
      spotPrice: input.spotPrice,
      baseVolatility: input.volatility,
      riskFreeRate: input.riskFreeRate,
    });

    this.latestOptionValuation = valuation;
    this.ivSurface = ivSurface;

    this.recordMemory({
      layer: 'LAYER_4_BLACK_SCHOLES',
      eventType: 'OPTION_AUDIT',
      versionId: this.activeVersion.versionId,
      oosSharpe: null,
      oosMaxDrawdownPct: null,
      summary: `Black-Scholes ${valuation.symbol} (${valuation.optionType}) · Theo $${valuation.theoreticalPrice.toFixed(2)} · Δ ${valuation.delta.toFixed(3)} · Γ ${valuation.gamma.toFixed(6)} · Θ ${valuation.thetaPerDay.toFixed(2)}/d · Verdict ${valuation.verdict}.`,
    });

    return { ok: true, valuation, ivSurface, snapshot: this.getSnapshot() };
  }

  approveLiveDeployment(input: {
    readonly versionId: string;
    readonly approvalToken: string;
    readonly operatorName: string;
  }): {
    readonly ok: boolean;
    readonly statusCode: number;
    readonly error?: string;
    readonly snapshot: FableOrchestratorSnapshot;
  } {
    if (this.deploymentTicket.versionId !== input.versionId) {
      return {
        ok: false,
        statusCode: 404,
        error: `No Paper Trading deployment ticket found for version '${input.versionId}'.`,
        snapshot: this.getSnapshot(),
      };
    }
    if (this.deploymentTicket.stage === 'LIVE_APPROVED') {
      return {
        ok: false,
        statusCode: 409,
        error: `Version '${input.versionId}' is already approved for Live deployment.`,
        snapshot: this.getSnapshot(),
      };
    }
    if (!safeTokenCompare(this.deploymentTicket.approvalToken, input.approvalToken)) {
      return {
        ok: false,
        statusCode: 403,
        error: 'Mandatory human approval rejected: invalid confirmation token.',
        snapshot: this.getSnapshot(),
      };
    }

    const operator = String(input.operatorName || 'Lead Operator').trim().slice(0, 64) || 'Lead Operator';
    this.deploymentTicket = {
      ...this.deploymentTicket,
      stage: 'LIVE_APPROVED',
      approvedAtIso: new Date().toISOString(),
      approvedBy: operator,
    };

    this.recordMemory({
      layer: 'LAYER_7_DEPLOYMENT',
      eventType: 'LIVE_APPROVED',
      versionId: this.deploymentTicket.versionId,
      oosSharpe: this.validationHistory[0]?.v2Oos.sharpeRatio ?? this.families[2].oosSharpe,
      oosMaxDrawdownPct: this.validationHistory[0]?.v2Oos.maxDrawdownPct ?? 0.032,
      summary: `Human operator '${operator}' explicitly approved ${this.deploymentTicket.versionId} for Live Deployment.`,
    });

    return { ok: true, statusCode: 200, snapshot: this.getSnapshot() };
  }

  readAllowlistedPythonFile(fileId: string): {
    readonly ok: boolean;
    readonly moduleId: string;
    readonly relativePath: string;
    readonly content?: string;
    readonly error?: string;
  } {
    const entry = ALLOWLISTED_PYTHON_MODULES.find(
      (m) => m.id === fileId || m.relativePath === fileId
    );
    if (!entry) {
      return {
        ok: false,
        moduleId: fileId,
        relativePath: '',
        error: 'Requested Python module is not in the allowlisted Fable 5.2 package.',
      };
    }
    const resolved = path.resolve(this.workspaceRoot, entry.relativePath);
    const rootBoundary = this.workspaceRoot.endsWith(path.sep)
      ? this.workspaceRoot
      : `${this.workspaceRoot}${path.sep}`;
    if (!resolved.startsWith(rootBoundary) || !fs.existsSync(resolved)) {
      return {
        ok: false,
        moduleId: entry.id,
        relativePath: entry.relativePath,
        error: 'Python source file unavailable.',
      };
    }
    return {
      ok: true,
      moduleId: entry.id,
      relativePath: entry.relativePath,
      content: fs.readFileSync(resolved, 'utf8'),
    };
  }
}
