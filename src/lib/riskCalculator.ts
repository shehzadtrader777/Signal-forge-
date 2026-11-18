export interface RiskCalculationInput {
  balance: number;
  riskPercent: number;
  leverage?: number;
  entryPrice: number;
  stopLoss: number;
  takeProfits: [number, number, number];
  direction: 'BUY' | 'SELL';
}

export interface RiskCalculationResult {
  isValid: boolean;
  errorMessage?: string;
  leverage: number;
  riskAmountUsd: number;
  stopDistancePerUnit: number;
  stopDistancePercent: number;
  positionSizeUnits: number;
  positionValueUsd: number;
  requiredMarginUsd: number;
  exceedsBalance: boolean;
  lotSize: number;
  potentialLossUsd: number;
  potentialProfitsUsd: [number, number, number];
  riskRewardRatios: [number, number, number];
  formulaString: string;
}

export function calculateRiskMetrics(input: RiskCalculationInput): RiskCalculationResult {
  const { balance, riskPercent, entryPrice, stopLoss, takeProfits } = input;
  const leverage = input.leverage ?? 1;
  const formulaString = 'Position Size = (Balance * Risk%) / (Entry - SL)';

  const invalidResult = (errorMessage: string): RiskCalculationResult => ({
    isValid: false,
    errorMessage,
    leverage: Number.isFinite(leverage) ? leverage : 1,
    riskAmountUsd: 0,
    stopDistancePerUnit: 0,
    stopDistancePercent: 0,
    positionSizeUnits: 0,
    positionValueUsd: 0,
    requiredMarginUsd: 0,
    exceedsBalance: false,
    lotSize: 0,
    potentialLossUsd: 0,
    potentialProfitsUsd: [0, 0, 0],
    riskRewardRatios: [0, 0, 0],
    formulaString,
  });

  if (!Number.isFinite(balance) || balance <= 0) {
    return invalidResult('Account balance must be greater than $0.');
  }

  if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 100) {
    return invalidResult('Risk % must be between 0.1% and 100%.');
  }

  if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) {
    return invalidResult('Leverage must be between 1x and 125x.');
  }

  const stopDistancePerUnit = Math.abs(entryPrice - stopLoss);
  if (!Number.isFinite(stopDistancePerUnit) || stopDistancePerUnit <= 0) {
    return invalidResult('Entry price and Stop Loss cannot be equal.');
  }

  // Exact formula: Position Size = (Balance * Risk%) / |Entry - SL|
  const riskAmountUsd = balance * (riskPercent / 100);
  const positionSizeUnits = riskAmountUsd / stopDistancePerUnit;
  const positionValueUsd = positionSizeUnits * entryPrice;
  const requiredMarginUsd = positionValueUsd / leverage;
  const exceedsBalance = requiredMarginUsd > balance;
  const lotSize = positionSizeUnits;
  const stopDistancePercent = (stopDistancePerUnit / entryPrice) * 100;

  const potentialProfitsUsd: [number, number, number] = [
    Math.abs(takeProfits[0] - entryPrice) * positionSizeUnits,
    Math.abs(takeProfits[1] - entryPrice) * positionSizeUnits,
    Math.abs(takeProfits[2] - entryPrice) * positionSizeUnits,
  ];

  const riskRewardRatios: [number, number, number] = [
    Math.abs(takeProfits[0] - entryPrice) / stopDistancePerUnit,
    Math.abs(takeProfits[1] - entryPrice) / stopDistancePerUnit,
    Math.abs(takeProfits[2] - entryPrice) / stopDistancePerUnit,
  ];

  return {
    isValid: true,
    leverage: Number(leverage.toFixed(2)),
    riskAmountUsd: Number(riskAmountUsd.toFixed(2)),
    stopDistancePerUnit: Number(stopDistancePerUnit.toPrecision(5)),
    stopDistancePercent: Number(stopDistancePercent.toFixed(2)),
    positionSizeUnits: Number(positionSizeUnits.toFixed(4)),
    positionValueUsd: Number(positionValueUsd.toFixed(2)),
    requiredMarginUsd: Number(requiredMarginUsd.toFixed(2)),
    exceedsBalance,
    lotSize: Number(lotSize.toFixed(4)),
    potentialLossUsd: Number(riskAmountUsd.toFixed(2)),
    potentialProfitsUsd: [
      Number(potentialProfitsUsd[0].toFixed(2)),
      Number(potentialProfitsUsd[1].toFixed(2)),
      Number(potentialProfitsUsd[2].toFixed(2)),
    ],
    riskRewardRatios: [
      Number(riskRewardRatios[0].toFixed(2)),
      Number(riskRewardRatios[1].toFixed(2)),
      Number(riskRewardRatios[2].toFixed(2)),
    ],
    formulaString,
  };
}
