// @responsibility Simplification Step 3 soft Gate scoring and hard-fail limiting.

export type GateSeverity =
  | 'PASS'
  | 'WARN'
  | 'SOFT_FAIL'
  | 'HARD_FAIL'
  | 'NOT_AVAILABLE';

export type GateEvaluationName =
  | 'DATA'
  | 'QUALITY'
  | 'RISK_REWARD'
  | 'DIAGNOSTIC';

export type GateExecutionImpact =
  | 'NONE'
  | 'DATA_REQUIRED_MISSING'
  | 'ORDER_WAIT';

export type QualityDecision =
  | 'TRADE_READY'
  | 'WATCH_READY'
  | 'DATA_INCOMPLETE'
  | 'ORDER_NOT_READY';

export interface GateEvaluation {
  gateName: GateEvaluationName;
  severity: GateSeverity;
  scoreContribution: number;
  confidenceAdjustment: number;
  hardFail: boolean;
  reasons: string[];
  missingFields: string[];
  riskTags: string[];
  learningLabels: string[];
  executionImpact: GateExecutionImpact;
}

export interface GateScoreBreakdown {
  dataGateUsable: boolean;
  technicalScore: number;
  supplyScore: number;
  momentumScore: number;
  fundamentalScore: number;
  riskRewardScore: number;
  diagnosticPenalty: number;
  gateTotalScore: number;
  hardFailReasons: string[];
  softFailReasons: string[];
  missingFields: string[];
  evaluatedAxes: string[];
  missingAxes: string[];
  gateEvaluations: GateEvaluation[];
  counterfactualRecorded: true;
}

export interface SoftGateScoreInput {
  snapshotId?: string;
  symbol?: string;
  currentPrice?: number | null;
  priceSnapshotPresent?: boolean;
  tradable?: boolean | null;
  tradingHalted?: boolean;
  managementIssue?: boolean;
  orderAvailable?: boolean;
  volume?: number | null;
  liquidityStatus?: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
  reliableQuote?: boolean;
  tradePlan?: {
    entryPrice?: number | null;
    stopLoss?: number | null;
    targetPrice?: number | null;
    riskReward?: number | null;
    riskRewardOk?: boolean;
  } | null;
  slotAvailable?: boolean;
  technicalTrend?: 'STRONG' | 'NEUTRAL' | 'WEAK' | 'MISSING';
  volumeTrend?: 'STRONG' | 'NORMAL' | 'WEAK' | 'MISSING';
  supplyTrend?: 'BOTH_BUY' | 'ONE_SIDE_BUY' | 'NEUTRAL' | 'SELLING' | 'MISSING';
  rsPercentile?: number | null;
  institution5d?: boolean | null;
  fundamentalStatus?: 'VERIFIED_GOOD' | 'PARTIAL' | 'MISSING' | 'AI_ONLY';
  enemyWarnings?: number;
  enemyHardBlock?: boolean;
  catalystStatus?: 'VERIFIED_HIGH' | 'VERIFIED_MEDIUM' | 'AI_ONLY' | 'NONE';
  passedConditions?: number;
  totalConditions?: number;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function arr(value: readonly string[]): string {
  return value.length > 0 ? value.join(',') : 'none';
}

function makeEvaluation(input: GateEvaluation): GateEvaluation {
  return input;
}

function scoreTechnical(input: SoftGateScoreInput): Pick<GateScoreBreakdown, 'technicalScore'> & {
  reasons: string[];
  missingFields: string[];
  evaluated: boolean;
} {
  switch (input.technicalTrend) {
    case 'STRONG':
      return { technicalScore: 8, reasons: [], missingFields: [], evaluated: true };
    case 'NEUTRAL':
      return { technicalScore: 2, reasons: [], missingFields: [], evaluated: true };
    case 'WEAK':
      return { technicalScore: -3, reasons: ['TECHNICAL_WEAK_SCORE_PENALTY'], missingFields: [], evaluated: true };
    case 'MISSING':
      return { technicalScore: 0, reasons: ['TECHNICAL_MISSING_DIAGNOSTIC_ONLY'], missingFields: ['technicalTrend'], evaluated: false };
    default:
      return { technicalScore: 0, reasons: [], missingFields: [], evaluated: false };
  }
}

function scoreVolume(input: SoftGateScoreInput): { score: number; reasons: string[]; missingFields: string[]; evaluated: boolean } {
  switch (input.volumeTrend) {
    case 'STRONG':
      return { score: 8, reasons: [], missingFields: [], evaluated: true };
    case 'NORMAL':
      return { score: 2, reasons: [], missingFields: [], evaluated: true };
    case 'WEAK':
      return { score: -3, reasons: ['VOLUME_WEAK_SCORE_PENALTY'], missingFields: [], evaluated: true };
    case 'MISSING':
      return { score: 0, reasons: ['VOLUME_TREND_MISSING_DIAGNOSTIC_ONLY'], missingFields: ['volumeTrend'], evaluated: false };
    default:
      return { score: 0, reasons: [], missingFields: [], evaluated: false };
  }
}

function scoreSupply(input: SoftGateScoreInput): { score: number; reasons: string[]; missingFields: string[]; evaluated: boolean } {
  switch (input.supplyTrend) {
    case 'BOTH_BUY':
      return { score: 8, reasons: [], missingFields: [], evaluated: true };
    case 'ONE_SIDE_BUY':
      return { score: 4, reasons: [], missingFields: [], evaluated: true };
    case 'NEUTRAL':
      return { score: 0, reasons: [], missingFields: [], evaluated: true };
    case 'SELLING':
      return { score: -4, reasons: ['SUPPLY_SELLING_SCORE_PENALTY'], missingFields: [], evaluated: true };
    case 'MISSING':
      return { score: 0, reasons: ['SUPPLY_MISSING_DIAGNOSTIC_ONLY'], missingFields: ['supplyTrend'], evaluated: false };
    default:
      return { score: 0, reasons: [], missingFields: [], evaluated: false };
  }
}

function scoreRs(input: SoftGateScoreInput): { score: number; reasons: string[]; evaluated: boolean } {
  const rs = input.rsPercentile;
  if (typeof rs !== 'number' || !Number.isFinite(rs)) return { score: 0, reasons: [], evaluated: false };
  if (rs <= 5) return { score: 8, reasons: [], evaluated: true };
  if (rs <= 20) return { score: 4, reasons: ['RS_TOP3_NOT_REQUIRED_SCORE_ONLY'], evaluated: true };
  if (rs <= 50) return { score: 0, reasons: ['RS_NEUTRAL_SCORE_ONLY'], evaluated: true };
  return { score: -4, reasons: ['RS_WEAK_SCORE_PENALTY'], evaluated: true };
}

function scoreFundamental(input: SoftGateScoreInput): { score: number; reasons: string[]; missingFields: string[]; evaluated: boolean } {
  switch (input.fundamentalStatus) {
    case 'VERIFIED_GOOD':
      return { score: 8, reasons: [], missingFields: [], evaluated: true };
    case 'PARTIAL':
      return { score: 3, reasons: ['FUNDAMENTAL_PARTIAL_SCORE_ONLY'], missingFields: [], evaluated: true };
    case 'AI_ONLY':
      return { score: 0, reasons: ['FUNDAMENTAL_AI_ADVISORY_ONLY'], missingFields: [], evaluated: true };
    case 'MISSING':
      return { score: 0, reasons: ['FUNDAMENTAL_MISSING_DIAGNOSTIC_ONLY'], missingFields: ['fundamental'], evaluated: false };
    default:
      return { score: 0, reasons: [], missingFields: [], evaluated: false };
  }
}

function scoreCatalyst(input: SoftGateScoreInput): { score: number; reasons: string[]; evaluated: boolean } {
  switch (input.catalystStatus) {
    case 'VERIFIED_HIGH':
      return { score: 5, reasons: [], evaluated: true };
    case 'VERIFIED_MEDIUM':
      return { score: 3, reasons: [], evaluated: true };
    case 'AI_ONLY':
      return { score: 0, reasons: ['CATALYST_AI_ADVISORY_ONLY'], evaluated: true };
    case 'NONE':
      return { score: 0, reasons: [], evaluated: true };
    default:
      return { score: 0, reasons: [], evaluated: false };
  }
}

export function evaluateSoftGateScore(input: SoftGateScoreInput): GateScoreBreakdown {
  const hardFailReasons: string[] = [];
  const softFailReasons: string[] = [];
  const missingFields: string[] = [];
  const evaluatedAxes: string[] = [];
  const missingAxes: string[] = [];

  if (!isFinitePositive(input.currentPrice)) {
    hardFailReasons.push('PRICE_MISSING');
    missingFields.push('currentPrice');
  }
  if (input.priceSnapshotPresent === false) {
    hardFailReasons.push('PRICE_SNAPSHOT_MISSING');
    missingFields.push('priceSnapshot');
  }
  if (input.tradable === false) hardFailReasons.push('TRADABLE_FALSE');
  if (input.tradingHalted === true) hardFailReasons.push('HALTED');
  if (input.managementIssue === true) hardFailReasons.push('MANAGEMENT_ISSUE');
  if (input.orderAvailable === false) hardFailReasons.push('ORDER_UNAVAILABLE');
  if (input.volume === null) {
    hardFailReasons.push('VOLUME_MISSING');
    missingFields.push('volume');
  }
  if (input.liquidityStatus === 'FAIL' && input.reliableQuote === false) {
    hardFailReasons.push('LIQUIDITY_FAIL_NO_RELIABLE_QUOTE');
  }

  const tradePlan = input.tradePlan;
  let riskRewardScore = 0;
  if (tradePlan) {
    const invalidEntry = !isFinitePositive(tradePlan.entryPrice);
    const invalidStop = !isFinitePositive(tradePlan.stopLoss);
    const invalidTarget = !isFinitePositive(tradePlan.targetPrice);
    const invalidRr = typeof tradePlan.riskReward !== 'number' || !Number.isFinite(tradePlan.riskReward);
    if (invalidEntry) hardFailReasons.push('ENTRY_PRICE_INVALID');
    if (invalidStop) hardFailReasons.push('STOP_LOSS_INVALID');
    if (invalidTarget) hardFailReasons.push('TARGET_INVALID');
    if (invalidRr) hardFailReasons.push('RR_UNCALCULABLE');
    if (!invalidRr && tradePlan.riskRewardOk === false) {
      riskRewardScore = -4;
      softFailReasons.push('RR_INSUFFICIENT_SCORE_ONLY');
    } else if (!invalidRr && (tradePlan.riskReward ?? 0) >= 2) {
      riskRewardScore = 8;
    } else if (!invalidRr) {
      riskRewardScore = 2;
    }
    evaluatedAxes.push('riskReward');
  }
  if (input.slotAvailable === false) {
    hardFailReasons.push('SLOT_FULL');
    softFailReasons.push('SLOT_FULL_COUNTERFACTUAL_REQUIRED');
  }

  const technical = scoreTechnical(input);
  const volume = scoreVolume(input);
  const supply = scoreSupply(input);
  const rs = scoreRs(input);
  const fundamental = scoreFundamental(input);
  const catalyst = scoreCatalyst(input);

  const conditionScore = input.totalConditions && input.totalConditions > 0 && input.passedConditions != null
    ? Math.round(Math.max(0, Math.min(1, input.passedConditions / input.totalConditions)) * 8)
    : 0;
  if (input.totalConditions && input.passedConditions != null && input.passedConditions < input.totalConditions) {
    softFailReasons.push('CONDITION_COUNT_DIAGNOSTIC_ONLY');
  }

  const diagnosticPenalty =
    input.enemyHardBlock === true
      ? -8
      : -Math.min(8, Math.max(0, input.enemyWarnings ?? 0) * 2);
  if ((input.enemyWarnings ?? 0) > 0) softFailReasons.push('ENEMY_CHECKLIST_SCORE_PENALTY_ONLY');
  if (input.enemyHardBlock === true) hardFailReasons.push('ENEMY_CHECKLIST_TRADING_UNAVAILABLE');

  const momentumScore = volume.score + rs.score + catalyst.score + conditionScore;
  const supplyScore = supply.score + (input.institution5d === true ? 3 : 0);
  if (input.institution5d === false) softFailReasons.push('INSTITUTION_5D_NOT_REQUIRED_SCORE_ONLY');

  const axisScores = [
    ['technical', technical.evaluated, technical.missingFields],
    ['volume', volume.evaluated, volume.missingFields],
    ['supply', supply.evaluated, supply.missingFields],
    ['rs', rs.evaluated, []],
    ['fundamental', fundamental.evaluated, fundamental.missingFields],
    ['catalyst', catalyst.evaluated, []],
  ] as const;
  for (const [axis, evaluated, missing] of axisScores) {
    if (evaluated) evaluatedAxes.push(axis);
    else if (missing.length > 0) missingAxes.push(axis);
    missingFields.push(...missing);
  }

  softFailReasons.push(
    ...technical.reasons,
    ...volume.reasons,
    ...supply.reasons,
    ...rs.reasons,
    ...fundamental.reasons,
    ...catalyst.reasons,
  );

  const dataGateUsable = hardFailReasons.filter((reason) => reason !== 'SLOT_FULL').length === 0;
  const qualityScore = technical.technicalScore + supplyScore + momentumScore + fundamental.score;
  const gateTotalScore = qualityScore + riskRewardScore + diagnosticPenalty;

  const dataGate = makeEvaluation({
    gateName: 'DATA',
    severity: dataGateUsable ? 'PASS' : 'HARD_FAIL',
    scoreContribution: 0,
    confidenceAdjustment: dataGateUsable ? 0 : -0.5,
    hardFail: !dataGateUsable,
    reasons: hardFailReasons.filter((reason) => reason !== 'SLOT_FULL'),
    missingFields: [...new Set(missingFields.filter((field) => field === 'currentPrice' || field === 'priceSnapshot' || field === 'volume'))],
    riskTags: [],
    learningLabels: dataGateUsable ? [] : ['DATA_GAP_COUNTERFACTUAL'],
    executionImpact: dataGateUsable ? 'NONE' : 'DATA_REQUIRED_MISSING',
  });
  const qualityGate = makeEvaluation({
    gateName: 'QUALITY',
    severity: qualityScore >= 12 ? 'PASS' : qualityScore >= 0 ? 'WARN' : 'SOFT_FAIL',
    scoreContribution: qualityScore,
    confidenceAdjustment: qualityScore < 0 ? -0.1 : 0,
    hardFail: false,
    reasons: softFailReasons.filter((reason) => !reason.startsWith('RR_') && !reason.startsWith('SLOT_')),
    missingFields: [...new Set(missingFields)],
    riskTags: [],
    learningLabels: ['WATCH_COUNTERFACTUAL'],
    executionImpact: 'NONE',
  });
  const rrGate = makeEvaluation({
    gateName: 'RISK_REWARD',
    severity: hardFailReasons.some((reason) => ['ENTRY_PRICE_INVALID', 'STOP_LOSS_INVALID', 'TARGET_INVALID', 'RR_UNCALCULABLE'].includes(reason))
      ? 'HARD_FAIL'
      : riskRewardScore < 0 ? 'SOFT_FAIL' : tradePlan ? 'PASS' : 'NOT_AVAILABLE',
    scoreContribution: riskRewardScore,
    confidenceAdjustment: riskRewardScore < 0 ? -0.05 : 0,
    hardFail: hardFailReasons.some((reason) => ['ENTRY_PRICE_INVALID', 'STOP_LOSS_INVALID', 'TARGET_INVALID', 'RR_UNCALCULABLE'].includes(reason)),
    reasons: [
      ...hardFailReasons.filter((reason) => ['ENTRY_PRICE_INVALID', 'STOP_LOSS_INVALID', 'TARGET_INVALID', 'RR_UNCALCULABLE'].includes(reason)),
      ...softFailReasons.filter((reason) => reason.startsWith('RR_') || reason.startsWith('SLOT_')),
    ],
    missingFields: [],
    riskTags: riskRewardScore < 0 ? ['RR_INSUFFICIENT'] : [],
    learningLabels: ['TRADE_PLAN_COUNTERFACTUAL'],
    executionImpact: 'NONE',
  });
  const diagnosticGate = makeEvaluation({
    gateName: 'DIAGNOSTIC',
    severity: diagnosticPenalty < 0 ? 'WARN' : 'PASS',
    scoreContribution: diagnosticPenalty,
    confidenceAdjustment: 0,
    hardFail: false,
    reasons: (input.enemyWarnings ?? 0) > 0 ? ['ENEMY_CHECKLIST_SCORE_PENALTY_ONLY'] : [],
    missingFields: [],
    riskTags: (input.enemyWarnings ?? 0) > 0 ? ['ENEMY_CHECKLIST_WARNING'] : [],
    learningLabels: ['WATCH_COUNTERFACTUAL'],
    executionImpact: 'NONE',
  });

  return {
    dataGateUsable,
    technicalScore: technical.technicalScore,
    supplyScore,
    momentumScore,
    fundamentalScore: fundamental.score,
    riskRewardScore,
    diagnosticPenalty,
    gateTotalScore,
    hardFailReasons: [...new Set(hardFailReasons)],
    softFailReasons: [...new Set(softFailReasons)],
    missingFields: [...new Set(missingFields)],
    evaluatedAxes: [...new Set(evaluatedAxes)],
    missingAxes: [...new Set(missingAxes)],
    gateEvaluations: [dataGate, qualityGate, rrGate, diagnosticGate],
    counterfactualRecorded: true,
  };
}

export function resolveQualityDecisionFromGate(input: {
  gateScoreBreakdown: GateScoreBreakdown;
  finalScore: number;
  buyThreshold?: number;
  riskRewardOk?: boolean;
  slotAvailable?: boolean;
}): QualityDecision {
  const hard = input.gateScoreBreakdown.hardFailReasons;
  if (!input.gateScoreBreakdown.dataGateUsable) {
    if (hard.includes('ORDER_UNAVAILABLE')) return 'ORDER_NOT_READY';
    return 'DATA_INCOMPLETE';
  }
  if (input.riskRewardOk === false || input.slotAvailable === false) return 'WATCH_READY';
  return input.finalScore >= (input.buyThreshold ?? 70) ? 'TRADE_READY' : 'WATCH_READY';
}

export function formatGateScoreEvaluatedLog(input: {
  snapshotId?: string;
  symbol?: string;
  breakdown: GateScoreBreakdown;
}): string {
  const b = input.breakdown;
  return [
    '[GATE_SCORE_EVALUATED]',
    `snapshotId=${input.snapshotId ?? 'none'}`,
    `symbol=${input.symbol ?? 'none'}`,
    `dataGateUsable=${b.dataGateUsable}`,
    `technicalScore=${b.technicalScore}`,
    `supplyScore=${b.supplyScore}`,
    `momentumScore=${b.momentumScore}`,
    `fundamentalScore=${b.fundamentalScore}`,
    `riskRewardScore=${b.riskRewardScore}`,
    `diagnosticPenalty=${b.diagnosticPenalty}`,
    `gateTotalScore=${b.gateTotalScore}`,
    `hardFailReasons=[${arr(b.hardFailReasons)}]`,
    `softFailReasons=[${arr(b.softFailReasons)}]`,
  ].join(' ');
}

export function formatGateHardFailLimitedLog(input: {
  snapshotId?: string;
  symbol?: string;
  previousHardFailReason: string;
}): string {
  return [
    '[GATE_HARD_FAIL_LIMITED]',
    `snapshotId=${input.snapshotId ?? 'none'}`,
    `symbol=${input.symbol ?? 'none'}`,
    `previousHardFailReason=${input.previousHardFailReason}`,
    "newRole='SOFT_FAIL_OR_SCORE_PENALTY'",
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatGateEvaluatedPartialLog(input: {
  snapshotId?: string;
  symbol?: string;
  breakdown: GateScoreBreakdown;
}): string {
  const b = input.breakdown;
  return [
    '[GATE_EVALUATED_PARTIAL]',
    `snapshotId=${input.snapshotId ?? 'none'}`,
    `symbol=${input.symbol ?? 'none'}`,
    `evaluatedAxes=[${arr(b.evaluatedAxes)}]`,
    `missingAxes=[${arr(b.missingAxes)}]`,
    `missingFields=[${arr(b.missingFields)}]`,
    `gateTotalScore=${b.gateTotalScore}`,
    `counterfactualRecorded=${b.counterfactualRecorded}`,
  ].join(' ');
}
