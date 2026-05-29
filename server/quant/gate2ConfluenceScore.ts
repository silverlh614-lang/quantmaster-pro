// @responsibility ADR-0519 Gate2 confluence scoring and promotion policy.

export type Gate2Axis =
  | 'RS_RELATIVE_STRENGTH'
  | 'SUPPLY_CONFLUENCE'
  | 'SECTOR_LEADERSHIP'
  | 'TECHNICAL_TREND'
  | 'FUNDAMENTAL_QUALITY';

export type Gate2AxisStatus = 'BULLISH' | 'ACCUMULATING' | 'NEUTRAL' | 'WEAK' | 'MISSING';
export type Gate2AxisConfidence = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | 'AI_ESTIMATED';
export type Gate2PromotionStage = 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY' | 'WEIGHTED' | 'GATED' | 'CORE';
export type Gate2Status =
  | 'GATE2_PASS_STRONG'
  | 'GATE2_PASS_WEAK'
  | 'GATE2_WATCH'
  | 'GATE2_FAIL'
  | 'DATA_INCOMPLETE'
  | 'SKIPPED_BY_GATE1';
export type Gate2EvaluationScope = 'FULL' | 'DIAGNOSTIC_ONLY';
export type Gate2FinalStatus = Gate2Status | 'NOT_EVALUATED_DUE_TO_GATE1_FAIL';

export type Gate2ConfluenceLevel = 'STRONG' | 'MODERATE' | 'WEAK' | 'INCOMPLETE';
export type Gate2ConfidenceCeiling = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Gate2AxisScore {
  axis: Gate2Axis;
  score: number | null;
  status: Gate2AxisStatus;
  confidence: Gate2AxisConfidence;
  promotionStage: Gate2PromotionStage;
  evidence: string[];
  missingReason?: string;
  source?: string;
  scoreIncluded: boolean;
}

export interface Gate2EvaluationResult {
  symbol: string;
  name?: string;
  sourceSnapshotId: string;
  gate1Status: string;
  gate2Status: Gate2Status;
  gate2EvaluationScope: Gate2EvaluationScope;
  finalGate2: Gate2FinalStatus;
  upstreamBlocker?: 'GATE1_FAIL';
  gate2DiagnosticPrimary?: string;
  rawScore: number | null;
  coverageAdjustedScore: number | null;
  confluenceLevel: Gate2ConfluenceLevel;
  usableAxisCount: number;
  bullishAxisCount: number;
  accumulatingAxisCount: number;
  missingAxisCount: number;
  aiEstimatedAxisCount: number;
  confidenceCeiling: Gate2ConfidenceCeiling;
  axes: Gate2AxisScore[];
  primaryPositiveAxis?: Gate2Axis;
  primaryNegativeAxis?: Gate2Axis;
  primaryMissingAxis?: Gate2Axis;
  primaryBlocker?: string;
  gate2GrowthValidated: boolean;
  gate2ConfluenceLevel: Gate2ConfluenceLevel;
  executionImpact: 'NONE';
  marketSignal: false;
  shadowLearning: true;
  counterfactualRecorded: boolean;
}

export interface Gate2CounterfactualSeed {
  symbol: string;
  sourceSnapshotId: string;
  gate2Status: Gate2Status;
  gate2CoverageAdjustedScore: number | null;
  gate2ConfluenceLevel: Gate2ConfluenceLevel;
  gate2AxisScores: Gate2AxisScore[];
  gate2PrimaryPositiveAxis?: Gate2Axis;
  gate2PrimaryNegativeAxis?: Gate2Axis;
  gate2MissingAxis?: Gate2Axis;
  gate2ConfidenceCeiling: Gate2ConfidenceCeiling;
  promotionStages: Partial<Record<Gate2Axis, Gate2PromotionStage>>;
  executionImpact: 'NONE';
  marketSignal: false;
  shadowLearning: true;
  counterfactualRecorded: true;
}

export interface Gate2ConfluenceSummary {
  sourceSnapshotId: string;
  totalCandidates: number;
  evaluated: number;
  gate2PassStrong: number;
  gate2PassWeak: number;
  gate2Watch: number;
  gate2Fail: number;
  dataIncomplete: number;
  skippedByGate1: number;
  avgCoverageAdjustedScore: number | null;
  usableAxisAvg: number;
  rsUsable: number;
  supplyUsable: number;
  sectorUsable: number;
  technicalUsable: number;
  fundamentalUsable: number;
  topPositiveAxis: Gate2Axis | 'none';
  topNegativeAxis: Gate2Axis | 'none';
  topMissingAxis: Gate2Axis | 'none';
  axisDistribution: Record<Gate2Axis, Record<Gate2AxisStatus, number>>;
  confidenceDistribution: Record<Gate2AxisConfidence, number>;
  promotionStageDistribution: Record<Gate2PromotionStage, number>;
  missingReasonDistribution: Record<string, number>;
  gate2InputFromGate1Pass: number;
  gate2InputFromGate1Degraded: number;
  gate2SkippedByGate1HardFail: number;
  gate2DiagnosticOnlyFromGate1Incomplete: number;
  providerIssueSeparatedCount: number;
  aiEstimatedAxisExcludedCount: number;
  counterfactualSeeds: Gate2CounterfactualSeed[];
  results: Gate2EvaluationResult[];
  executionImpact: 'NONE';
  marketSignal: false;
  shadowLearning: true;
  counterfactualRecorded: true;
}

export interface Gate2ConfluenceSummaryInput {
  traces: readonly Record<string, unknown>[];
  sourceSnapshotId?: string | null;
  gate2CacheRecords?: readonly Record<string, unknown>[];
}

const AXIS_WEIGHTS: Record<Gate2Axis, number> = {
  RS_RELATIVE_STRENGTH: 25,
  SUPPLY_CONFLUENCE: 25,
  SECTOR_LEADERSHIP: 20,
  TECHNICAL_TREND: 15,
  FUNDAMENTAL_QUALITY: 15,
};

const AXES = Object.keys(AXIS_WEIGHTS) as Gate2Axis[];

type AnyRecord = Record<string, unknown>;

function recordOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.map(recordOf).filter((item): item is AnyRecord => Boolean(item)) : [];
}

function getByPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as AnyRecord)[part];
  }
  return current;
}

function firstRecord(...values: unknown[]): AnyRecord | null {
  for (const value of values) {
    const record = recordOf(value);
    if (record) return record;
  }
  return null;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function upper(value: unknown, fallback = 'UNKNOWN'): string {
  return text(value, fallback).toUpperCase();
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNumber(source: unknown, paths: readonly string[]): number | null {
  for (const path of paths) {
    const n = numberOf(getByPath(source, path));
    if (n != null) return n;
  }
  return null;
}

function firstBoolean(source: unknown, paths: readonly string[]): boolean | null {
  for (const path of paths) {
    const value = getByPath(source, path);
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function scoreStatus(score: number): Gate2AxisStatus {
  if (score >= 85) return 'BULLISH';
  if (score >= 65) return 'ACCUMULATING';
  if (score >= 45) return 'NEUTRAL';
  return 'WEAK';
}

function rsScoreFromExcess(excessReturn20d: number): { score: number; status: Gate2AxisStatus } {
  if (excessReturn20d >= 15) return { score: 100, status: 'BULLISH' };
  if (excessReturn20d >= 8) return { score: 85, status: 'BULLISH' };
  if (excessReturn20d >= 3) return { score: 70, status: 'ACCUMULATING' };
  if (excessReturn20d >= -3) return { score: 50, status: 'NEUTRAL' };
  return { score: 25, status: 'WEAK' };
}

function axisIncluded(axis: Pick<Gate2AxisScore, 'score' | 'confidence' | 'promotionStage'>): boolean {
  if (axis.score == null) return false;
  if (axis.confidence === 'MISSING' || axis.confidence === 'AI_ESTIMATED') return false;
  return axis.promotionStage === 'ADVISORY'
    || axis.promotionStage === 'WEIGHTED'
    || axis.promotionStage === 'GATED'
    || axis.promotionStage === 'CORE';
}

function axisScore(input: Omit<Gate2AxisScore, 'scoreIncluded'>): Gate2AxisScore {
  const result = { ...input, scoreIncluded: axisIncluded(input) };
  return result;
}

function missingAxis(axis: Gate2Axis, reason: string, evidence: string[] = []): Gate2AxisScore {
  return axisScore({
    axis,
    score: null,
    status: 'MISSING',
    confidence: 'MISSING',
    promotionStage: 'OBSERVE',
    evidence,
    missingReason: reason,
    source: 'MISSING',
  });
}

function conditionRows(trace: AnyRecord): AnyRecord[] {
  const rows = arrayOfRecords(trace.conditionResultsTrace);
  if (rows.length > 0) return rows;
  const conditionResults = recordOf(trace.conditionResults);
  if (!conditionResults) return [];
  return Object.entries(conditionResults).map(([key, value]) => {
    const result = recordOf(value);
    return {
      key,
      status: result?.status ?? (result?.fired === true ? 'FIRED' : undefined),
      score: result?.score,
      value: result?.value,
      detail: result?.detail ?? result?.reason,
      source: result?.source,
    };
  });
}

function conditionScore(trace: AnyRecord, keys: readonly string[]): number | null {
  const rows = conditionRows(trace);
  for (const key of keys) {
    const row = rows.find(item => text(item.key) === key);
    const score = numberOf(row?.score ?? row?.value);
    if (score != null) return score > 1 && score <= 10 ? score * 10 : score;
  }
  return null;
}

function resolveExternal(trace: AnyRecord, cacheProjection?: AnyRecord | null): AnyRecord | null {
  return firstRecord(
    trace.gate2ExternalDataCoverage,
    getByPath(trace, 'gateLayerSummary.gate2.externalDataCoverage'),
    cacheProjection,
  );
}

function resolveGate1Status(trace: AnyRecord): string {
  const explicit = upper(trace.gate1Status ?? getByPath(trace, 'gate1Trace.status'), '');
  if (explicit === 'FAIL_HARD' || explicit === 'HARD_FAIL' || explicit === 'SKIPPED_BY_GATE1') return 'FAIL_HARD';
  if (explicit === 'DATA_INCOMPLETE') return 'DATA_INCOMPLETE';
  if (trace.gate1Passed === true || getByPath(trace, 'gate1Trace.gate1Passed') === true) return 'PASS';

  const hardFailCount = numberOf(getByPath(trace, 'gate1Trace.hardFailCount')) ?? numberOf(trace.hardFailCount) ?? 0;
  const softFailCount = numberOf(getByPath(trace, 'gate1Trace.softFailCount')) ?? numberOf(trace.softFailCount) ?? 0;
  const providerSoftened = getByPath(trace, 'gate1Trace.wouldPassIfProviderIssueSoftened') === true
    || trace.wouldPassIfProviderIssueSoftened === true;
  const supplyIgnored = getByPath(trace, 'gate1Trace.wouldPassIfSupplySampleIgnored') === true
    || trace.wouldPassIfSupplySampleIgnored === true;

  if (hardFailCount > 0 && !providerSoftened && !supplyIgnored) return 'FAIL_HARD';
  if (providerSoftened || supplyIgnored || (softFailCount > 0 && hardFailCount === 0)) return 'DEGRADED_PASS';
  if (explicit) return explicit;
  return 'DIAGNOSTIC_ELIGIBLE';
}

function buildRsAxis(trace: AnyRecord, external: AnyRecord | null): Gate2AxisScore {
  const directScore = firstNumber(trace, [
    'symbolFeatures.rsScore',
    'symbolFeatures.relativeStrengthScore',
    'rsScore',
    'relativeStrengthScore',
  ]);
  if (directScore != null) {
    const score = clampScore(directScore);
    return axisScore({
      axis: 'RS_RELATIVE_STRENGTH',
      score,
      status: scoreStatus(score),
      confidence: 'VERIFIED',
      promotionStage: 'WEIGHTED',
      evidence: [`rsScore=${round1(score)}`, 'source=ADR0518_RS'],
      source: 'ADR0518_RS',
    });
  }

  const stockReturn20d = firstNumber(trace, [
    'symbolFeatures.return20d',
    'return20d',
    'quote.return20d',
    'featurePack.momentum.return20d',
    'momentumProjection.return20d',
  ]) ?? firstNumber(external, ['benchmark.values.stockReturn20d', 'sectorCycle.values.stockReturn20d']);
  const relativeReturn20d = firstNumber(trace, [
    'symbolFeatures.relativeReturn20d',
    'relativeReturn20d',
    'quote.relativeReturn20d',
  ]) ?? firstNumber(external, ['benchmark.values.relativeReturn20d']);
  if (relativeReturn20d != null) {
    const { score, status } = rsScoreFromExcess(relativeReturn20d);
    return axisScore({
      axis: 'RS_RELATIVE_STRENGTH',
      score,
      status,
      confidence: 'VERIFIED',
      promotionStage: 'WEIGHTED',
      evidence: [`relativeReturn20d=${round1(relativeReturn20d)}`, 'source=BENCHMARK_RELATIVE'],
      source: 'BENCHMARK_RELATIVE',
    });
  }

  const indexReturn20d = firstNumber(trace, [
    'symbolFeatures.indexReturn20d',
    'symbolFeatures.kospi20dReturn',
    'indexReturn20d',
    'kospi20dReturn',
    'quote.kospi20dReturn',
    'macroState.kospi20dReturn',
  ]) ?? firstNumber(external, ['benchmark.values.benchmarkReturn20d']);
  if (stockReturn20d != null && indexReturn20d != null) {
    const excess = stockReturn20d - indexReturn20d;
    const { score, status } = rsScoreFromExcess(excess);
    return axisScore({
      axis: 'RS_RELATIVE_STRENGTH',
      score,
      status,
      confidence: 'VERIFIED',
      promotionStage: 'WEIGHTED',
      evidence: [`return20d=${round1(stockReturn20d)}`, `indexReturn20d=${round1(indexReturn20d)}`, `excess=${round1(excess)}`],
      source: 'RETURN20D_MINUS_INDEX',
    });
  }

  const sectorReturn20d = firstNumber(external, ['sectorCycle.values.sectorReturn20d']);
  if (stockReturn20d != null && sectorReturn20d != null) {
    const excess = stockReturn20d - sectorReturn20d;
    const { score, status } = rsScoreFromExcess(excess);
    return axisScore({
      axis: 'RS_RELATIVE_STRENGTH',
      score,
      status,
      confidence: 'DEGRADED',
      promotionStage: 'ADVISORY',
      evidence: [`return20d=${round1(stockReturn20d)}`, `sectorReturn20d=${round1(sectorReturn20d)}`, `excess=${round1(excess)}`],
      source: 'SECTOR_RETURN_FALLBACK',
    });
  }

  return missingAxis('RS_RELATIVE_STRENGTH', 'RS_RETURN20D_MISSING', ['benchmark missing is not bearish']);
}

function buildSupplyAxis(trace: AnyRecord, external: AnyRecord | null): Gate2AxisScore {
  const kis = firstRecord(getByPath(external, 'kisInvestorFlow'), trace.kisInvestorFlow, trace.supplyConfluence);
  const semanticStatus = upper(
    getByPath(trace, 'supplyProviderHealth.semanticRowBreakPoint')
      ?? getByPath(trace, 'supplyProviderHealth.semanticNetBuyStatus')
      ?? getByPath(trace, 'supplyProviderHealth.semanticRow.status'),
    '',
  );
  const kisStatus = upper(kis?.status ?? kis?.providerStatus, '');
  const missingRow = semanticStatus.includes('NO_ROW_FOUND') || kisStatus === 'MISSING' || kisStatus === 'EMPTY_VALID';
  if (missingRow) {
    return missingAxis('SUPPLY_CONFLUENCE', 'SUPPLY_ROW_MISSING_NEUTRALIZED', [
      'NO_ROW_FOUND neutralized',
      'marketSignal=false',
      'executionImpact=NONE',
    ]);
  }

  const foreign = firstNumber(kis, ['foreignNetBuy', 'foreignNetBuyAmount', 'foreignNetBuyValue'])
    ?? firstNumber(trace, ['supplyProviderHealth.semanticRow.foreignNetBuy', 'foreignNetBuy']);
  const institutional = firstNumber(kis, ['institutionalNetBuy', 'institutionNetBuy', 'institutionNetBuyAmount'])
    ?? firstNumber(trace, ['supplyProviderHealth.semanticRow.institutionalNetBuy', 'institutionalNetBuy']);
  if (foreign == null && institutional == null) {
    return missingAxis('SUPPLY_CONFLUENCE', 'SUPPLY_FLOW_MISSING', ['supply missing is not bearish']);
  }

  const f = foreign ?? 0;
  const i = institutional ?? 0;
  let score = 50;
  if (f > 0 && i > 0) score = 95;
  else if (f > 0 || i > 0) score = 75;
  else if (f < 0 && i < 0) score = 30;

  const status = scoreStatus(score);
  const confidence: Gate2AxisConfidence = kisStatus === 'VERIFIED' || kisStatus === 'PARTIAL' || kisStatus === ''
    ? 'VERIFIED'
    : kisStatus === 'STALE'
      ? 'STALE'
      : 'DEGRADED';
  return axisScore({
    axis: 'SUPPLY_CONFLUENCE',
    score,
    status,
    confidence,
    promotionStage: confidence === 'STALE' ? 'ADVISORY' : 'WEIGHTED',
    evidence: [`foreignNetBuy=${round1(f)}`, `institutionalNetBuy=${round1(i)}`, 'providerIssueSeparated=true'],
    source: 'KIS_INVESTOR_FLOW',
  });
}

function buildSectorAxis(trace: AnyRecord, external: AnyRecord | null, rsAxis: Gate2AxisScore): Gate2AxisScore {
  const sector = firstRecord(getByPath(external, 'sectorCycle'), trace.sectorCycle, trace.sectorEnergyResult);
  const leader = firstRecord(getByPath(external, 'leaderCycle'), trace.leaderCycle);
  const status = upper(sector?.status ?? sector?.dataQuality, '');
  const available = status === 'VERIFIED' || status === 'PARTIAL' || sector?.available === true || leader?.isCurrentLeadingSector != null;
  if (!available) {
    return missingAxis('SECTOR_LEADERSHIP', 'SECTOR_LEADERSHIP_MISSING', ['sector missing is not bearish']);
  }

  const sectorRelative = firstNumber(sector, ['values.sectorRelativeReturn20d', 'sectorRelativeReturn20d']);
  const stockVsSector = firstNumber(sector, ['values.stockVsSectorReturn20d', 'stockVsSectorReturn20d']);
  const percentile = firstNumber(sector, ['values.sectorPercentile20d', 'sectorPercentile20d']);
  const currentLeader = leader?.isCurrentLeadingSector === true || sectorRelative != null && sectorRelative >= 5 || percentile != null && percentile >= 70;
  const stockLeader = leader?.isSectorLeader === true || stockVsSector != null && stockVsSector >= 3 || rsAxis.status === 'BULLISH';
  const crowded = upper(leader?.attentionPhase, '') === 'CROWDED'
    || upper(leader?.attentionPhase, '') === 'OVERHYPED'
    || (numberOf(leader?.newsCrowdingScore) ?? 0) >= 80;

  let score = 50;
  if (currentLeader && stockLeader) score = 95;
  else if (currentLeader) score = 72;
  else if (stockLeader) score = 62;
  else if (sectorRelative != null && sectorRelative < -5) score = 35;
  if (crowded) score = Math.max(25, score - 12);

  const confidence: Gate2AxisConfidence = status === 'VERIFIED' ? 'VERIFIED' : status === 'STALE' ? 'STALE' : 'DEGRADED';
  return axisScore({
    axis: 'SECTOR_LEADERSHIP',
    score,
    status: scoreStatus(score),
    confidence,
    promotionStage: confidence === 'VERIFIED' ? 'WEIGHTED' : 'ADVISORY',
    evidence: [
      `currentLeader=${String(currentLeader)}`,
      `stockLeader=${String(stockLeader)}`,
      `crowdedPenalty=${String(crowded)}`,
      'hardBlock=false',
    ],
    source: 'SECTOR_CYCLE',
  });
}

function buildTechnicalAxis(trace: AnyRecord): Gate2AxisScore {
  const maAlignment = upper(
    getByPath(trace, 'symbolFeatures.maAlignmentStatus')
      ?? trace.maAlignmentStatus
      ?? getByPath(trace, 'technicalIndicators.maAlignmentStatus'),
    '',
  );
  const aboveMA20 = firstBoolean(trace, ['symbolFeatures.aboveMA20', 'aboveMA20']);
  const aboveMA60 = firstBoolean(trace, ['symbolFeatures.aboveMA60', 'aboveMA60']);
  const return20d = firstNumber(trace, ['symbolFeatures.return20d', 'return20d', 'quote.return20d']);
  const close = firstNumber(trace, ['symbolFeatures.close', 'symbolFeatures.currentPrice', 'currentPrice', 'quote.currentPrice', 'price']);
  const ma20 = firstNumber(trace, ['symbolFeatures.ma20', 'ma20', 'quote.ma20']);
  const ma60 = firstNumber(trace, ['symbolFeatures.ma60', 'ma60', 'quote.ma60']);

  let resolved = maAlignment;
  if (!resolved && close != null && ma20 != null && ma60 != null) {
    if (close > ma20 && ma20 > ma60) resolved = 'BULLISH';
    else if (close >= ma60) resolved = 'NEUTRAL';
    else resolved = 'BEARISH';
  } else if (!resolved && aboveMA20 != null && aboveMA60 != null) {
    resolved = aboveMA20 && aboveMA60 ? 'BULLISH' : aboveMA60 ? 'NEUTRAL' : 'BEARISH';
  }

  if (!resolved) {
    return missingAxis('TECHNICAL_TREND', 'TECHNICAL_TREND_MISSING', ['breakoutAdvisoryOnly=true']);
  }

  let score = 50;
  if (resolved === 'BULLISH') score = return20d != null && return20d >= 8 ? 95 : 88;
  else if (resolved === 'NEUTRAL') score = return20d != null && return20d > 0 ? 68 : 50;
  else if (resolved === 'BEARISH') score = 32;
  const confidence: Gate2AxisConfidence = close != null || aboveMA20 != null || aboveMA60 != null ? 'VERIFIED' : 'DEGRADED';
  return axisScore({
    axis: 'TECHNICAL_TREND',
    score,
    status: scoreStatus(score),
    confidence,
    promotionStage: confidence === 'VERIFIED' ? 'WEIGHTED' : 'ADVISORY',
    evidence: [
      `maAlignment=${resolved}`,
      `aboveMA20=${String(aboveMA20)}`,
      `aboveMA60=${String(aboveMA60)}`,
      `return20d=${return20d == null ? 'null' : round1(return20d)}`,
      'breakoutAdvisoryOnly=true',
    ],
    source: 'OHLCV_TECHNICALS',
  });
}

function buildFundamentalAxis(external: AnyRecord | null, cacheProjection?: AnyRecord | null): Gate2AxisScore {
  const dart = firstRecord(
    getByPath(external, 'dartFinancials'),
    getByPath(cacheProjection, 'financialSnapshot'),
  );
  const profitability = firstRecord(getByPath(external, 'profitability'), getByPath(cacheProjection, 'profitability'));
  const stability = firstRecord(getByPath(external, 'stability'), getByPath(cacheProjection, 'stability'));
  const earningsQuality = firstRecord(getByPath(external, 'earningsQuality'), getByPath(cacheProjection, 'earningsQuality'));
  const source = upper(dart?.source ?? profitability?.source ?? earningsQuality?.source, 'NONE');
  const confidenceRaw = upper(dart?.dataConfidence ?? dart?.confidence, '');
  const aiEstimated = source.includes('AI') || confidenceRaw === 'AI_ESTIMATED';
  if (aiEstimated) {
    return axisScore({
      axis: 'FUNDAMENTAL_QUALITY',
      score: 70,
      status: 'ACCUMULATING',
      confidence: 'AI_ESTIMATED',
      promotionStage: 'OBSERVE',
      evidence: ['AI_ESTIMATED fundamental excluded from weighted score'],
      source: 'AI_ESTIMATED',
    });
  }

  const status = upper(dart?.status ?? dart?.rawStatus ?? dart?.confidence, '');
  const verified = status === 'VERIFIED' || status === 'OK_WITH_DATA' || confidenceRaw === 'VERIFIED' || source === 'DART';
  if (!verified) {
    return missingAxis('FUNDAMENTAL_QUALITY', 'DART_FINANCIALS_MISSING', ['fundamental missing is not bearish']);
  }

  const ocfRatio = firstNumber(external, ['dartFinancials.ocfRatio'])
    ?? firstNumber(cacheProjection, ['earningsQuality.score', 'metrics.ocfRatio']);
  const roe = firstNumber(external, ['dartFinancials.roe', 'profitability.roe'])
    ?? firstNumber(cacheProjection, ['profitability.roe', 'metrics.roe']);
  const opm = firstNumber(external, ['dartFinancials.opm', 'profitability.opm'])
    ?? firstNumber(cacheProjection, ['profitability.opm', 'metrics.opm']);
  const marginAcceleration = firstNumber(external, ['dartFinancials.marginAcceleration', 'dartFinancials.opmYoYDelta'])
    ?? firstNumber(cacheProjection, ['metrics.marginAcceleration', 'metrics.opmYoYDelta']);
  const icr = firstNumber(external, ['dartFinancials.interestCoverageRatio', 'stability.icr'])
    ?? firstNumber(cacheProjection, ['stability.icr', 'metrics.interestCoverageRatio']);

  let score = 55;
  const ocfOk = ocfRatio != null && ocfRatio >= 1;
  const roeOk = roe != null && roe > 0;
  const marginOk = marginAcceleration != null && marginAcceleration > 0;
  const icrOk = icr == null || icr >= 2;
  if (ocfOk && roeOk && marginOk && icrOk) score = 95;
  else if (ocfOk && roeOk && icrOk) score = 80;
  else if (roeOk || opm != null && opm > 0) score = 62;
  else score = 35;

  return axisScore({
    axis: 'FUNDAMENTAL_QUALITY',
    score,
    status: scoreStatus(score),
    confidence: confidenceRaw === 'STALE' ? 'STALE' : 'VERIFIED',
    promotionStage: confidenceRaw === 'STALE' ? 'ADVISORY' : 'WEIGHTED',
    evidence: [
      `ocfRatio=${ocfRatio == null ? 'null' : round1(ocfRatio)}`,
      `roe=${roe == null ? 'null' : round1(roe)}`,
      `marginAcceleration=${marginAcceleration == null ? 'null' : round1(marginAcceleration)}`,
      `interestCoverage=${icr == null ? 'null' : round1(icr)}`,
    ],
    source: 'DART_FINANCIALS',
  });
}

export function buildGate2EvaluationResult(input: {
  trace: Record<string, unknown>;
  sourceSnapshotId?: string | null;
  cacheProjection?: Record<string, unknown> | null;
}): Gate2EvaluationResult {
  const trace = input.trace as AnyRecord;
  const sourceSnapshotId = text(input.sourceSnapshotId, 'UNKNOWN_SOURCE_SNAPSHOT');
  const symbol = text(trace.symbol ?? getByPath(trace, 'quote.symbol') ?? getByPath(trace, 'quote.code'), 'UNKNOWN');
  const name = text(trace.name, '');
  const gate1Status = resolveGate1Status(trace);

  if (gate1Status === 'FAIL_HARD') {
    return {
      symbol,
      ...(name ? { name } : {}),
      sourceSnapshotId,
      gate1Status,
      gate2Status: 'SKIPPED_BY_GATE1',
      gate2EvaluationScope: 'DIAGNOSTIC_ONLY',
      finalGate2: 'NOT_EVALUATED_DUE_TO_GATE1_FAIL',
      upstreamBlocker: 'GATE1_FAIL',
      gate2DiagnosticPrimary: 'SKIPPED_BY_GATE1_HARD_FAIL',
      rawScore: null,
      coverageAdjustedScore: null,
      confluenceLevel: 'INCOMPLETE',
      usableAxisCount: 0,
      bullishAxisCount: 0,
      accumulatingAxisCount: 0,
      missingAxisCount: 5,
      aiEstimatedAxisCount: 0,
      confidenceCeiling: 'LOW',
      axes: AXES.map(axis => missingAxis(axis, 'SKIPPED_BY_GATE1_HARD_FAIL')),
      primaryMissingAxis: 'RS_RELATIVE_STRENGTH',
      gate2GrowthValidated: false,
      gate2ConfluenceLevel: 'INCOMPLETE',
      executionImpact: 'NONE',
      marketSignal: false,
      shadowLearning: true,
      counterfactualRecorded: true,
    };
  }

  const cacheProjection = recordOf(input.cacheProjection);
  const external = resolveExternal(trace, cacheProjection);
  const rs = buildRsAxis(trace, external);
  const axes: Gate2AxisScore[] = [
    rs,
    buildSupplyAxis(trace, external),
    buildSectorAxis(trace, external, rs),
    buildTechnicalAxis(trace),
    buildFundamentalAxis(external, cacheProjection),
  ];

  const included = axes.filter(axis => axis.scoreIncluded);
  const usableAxisCount = included.length;
  const missingAxisCount = axes.filter(axis => axis.score == null || axis.confidence === 'MISSING').length;
  const aiEstimatedAxisCount = axes.filter(axis => axis.confidence === 'AI_ESTIMATED').length;
  const bullishAxisCount = included.filter(axis => axis.status === 'BULLISH').length;
  const accumulatingAxisCount = included.filter(axis => axis.status === 'ACCUMULATING').length;
  const bullishOrAccumulatingAxisCount = bullishAxisCount + accumulatingAxisCount;
  const weightedSum = included.reduce((sum, axis) => sum + (axis.score ?? 0) * AXIS_WEIGHTS[axis.axis], 0);
  const usableWeight = included.reduce((sum, axis) => sum + AXIS_WEIGHTS[axis.axis], 0);
  const rawScore = usableAxisCount > 0 ? round1(weightedSum / 100) : null;
  const coverageAdjustedScore = usableWeight > 0 ? round1(weightedSum / usableWeight) : null;

  let gate2Status: Gate2Status = 'DATA_INCOMPLETE';
  if (usableAxisCount < 3 || coverageAdjustedScore == null) gate2Status = 'DATA_INCOMPLETE';
  else if (coverageAdjustedScore >= 80 && bullishAxisCount >= 3) gate2Status = 'GATE2_PASS_STRONG';
  else if (coverageAdjustedScore >= 65 && bullishOrAccumulatingAxisCount >= 3) gate2Status = 'GATE2_PASS_WEAK';
  else if (coverageAdjustedScore >= 50) gate2Status = 'GATE2_WATCH';
  else gate2Status = 'GATE2_FAIL';

  const confluenceLevel: Gate2ConfluenceLevel = gate2Status === 'GATE2_PASS_STRONG'
    ? 'STRONG'
    : gate2Status === 'GATE2_PASS_WEAK'
      ? 'MODERATE'
      : gate2Status === 'DATA_INCOMPLETE'
        ? 'INCOMPLETE'
        : 'WEAK';
  const confidenceCeiling: Gate2ConfidenceCeiling = usableAxisCount >= 5 && aiEstimatedAxisCount === 0
    ? 'HIGH'
    : usableAxisCount >= 3
      ? 'MEDIUM'
      : 'LOW';
  const primaryPositiveAxis = [...included].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0]?.axis;
  const primaryNegativeAxis = [...included].filter(axis => axis.status === 'WEAK').sort((a, b) => (a.score ?? 101) - (b.score ?? 101))[0]?.axis;
  const primaryMissingAxis = axes.find(axis => axis.status === 'MISSING')?.axis;
  const primaryBlocker = gate2Status === 'DATA_INCOMPLETE'
    ? `MISSING_${primaryMissingAxis ?? 'AXIS'}`
    : gate2Status === 'GATE2_FAIL'
      ? `WEAK_${primaryNegativeAxis ?? 'CONFLUENCE'}`
      : undefined;

  return {
    symbol,
    ...(name ? { name } : {}),
    sourceSnapshotId,
    gate1Status,
    gate2Status,
    gate2EvaluationScope: 'FULL',
    finalGate2: gate2Status,
    ...(primaryBlocker ? { gate2DiagnosticPrimary: primaryBlocker } : {}),
    rawScore,
    coverageAdjustedScore,
    confluenceLevel,
    usableAxisCount,
    bullishAxisCount,
    accumulatingAxisCount,
    missingAxisCount,
    aiEstimatedAxisCount,
    confidenceCeiling,
    axes,
    ...(primaryPositiveAxis ? { primaryPositiveAxis } : {}),
    ...(primaryNegativeAxis ? { primaryNegativeAxis } : {}),
    ...(primaryMissingAxis ? { primaryMissingAxis } : {}),
    ...(primaryBlocker ? { primaryBlocker } : {}),
    gate2GrowthValidated: gate2Status === 'GATE2_PASS_STRONG' || gate2Status === 'GATE2_PASS_WEAK',
    gate2ConfluenceLevel: confluenceLevel,
    executionImpact: 'NONE',
    marketSignal: false,
    shadowLearning: true,
    counterfactualRecorded: true,
  };
}

export function buildGate2CounterfactualSeed(result: Gate2EvaluationResult): Gate2CounterfactualSeed {
  return {
    symbol: result.symbol,
    sourceSnapshotId: result.sourceSnapshotId,
    gate2Status: result.gate2Status,
    gate2CoverageAdjustedScore: result.coverageAdjustedScore,
    gate2ConfluenceLevel: result.confluenceLevel,
    gate2AxisScores: result.axes,
    ...(result.primaryPositiveAxis ? { gate2PrimaryPositiveAxis: result.primaryPositiveAxis } : {}),
    ...(result.primaryNegativeAxis ? { gate2PrimaryNegativeAxis: result.primaryNegativeAxis } : {}),
    ...(result.primaryMissingAxis ? { gate2MissingAxis: result.primaryMissingAxis } : {}),
    gate2ConfidenceCeiling: result.confidenceCeiling,
    promotionStages: Object.fromEntries(result.axes.map(axis => [axis.axis, axis.promotionStage])) as Partial<Record<Gate2Axis, Gate2PromotionStage>>,
    executionImpact: 'NONE',
    marketSignal: false,
    shadowLearning: true,
    counterfactualRecorded: true,
  };
}

function increment<T extends string>(target: Record<T, number>, key: T): void {
  target[key] = (target[key] ?? 0) + 1;
}

function topFromCounts<T extends string>(counts: Record<T, number>): T | 'none' {
  const [top] = Object.entries(counts)
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  return top ? top[0] as T : 'none';
}

function buildCacheProjectionBySymbol(records: readonly Record<string, unknown>[] | undefined): Map<string, AnyRecord> {
  const map = new Map<string, AnyRecord>();
  for (const record of records ?? []) {
    const symbol = text(record.symbol);
    const projection = recordOf(record.projection);
    if (symbol && projection) map.set(symbol, projection);
  }
  return map;
}

export function buildGate2ConfluenceSummary(input: Gate2ConfluenceSummaryInput): Gate2ConfluenceSummary {
  const sourceSnapshotId = text(input.sourceSnapshotId, 'UNKNOWN_SOURCE_SNAPSHOT');
  const projectionBySymbol = buildCacheProjectionBySymbol(input.gate2CacheRecords);
  const results = input.traces.map(trace => {
    const symbol = text(trace.symbol ?? getByPath(trace, 'quote.symbol') ?? getByPath(trace, 'quote.code'));
    return buildGate2EvaluationResult({
      trace,
      sourceSnapshotId,
      cacheProjection: symbol ? projectionBySymbol.get(symbol) ?? null : null,
    });
  });
  const evaluatedResults = results.filter(result => result.gate2Status !== 'SKIPPED_BY_GATE1');
  const counterfactualSeeds = results.map(buildGate2CounterfactualSeed);

  const axisDistribution = Object.fromEntries(
    AXES.map(axis => [axis, { BULLISH: 0, ACCUMULATING: 0, NEUTRAL: 0, WEAK: 0, MISSING: 0 }]),
  ) as Record<Gate2Axis, Record<Gate2AxisStatus, number>>;
  const confidenceDistribution: Record<Gate2AxisConfidence, number> = {
    VERIFIED: 0,
    DEGRADED: 0,
    STALE: 0,
    MISSING: 0,
    AI_ESTIMATED: 0,
  };
  const promotionStageDistribution: Record<Gate2PromotionStage, number> = {
    OBSERVE: 0,
    SHADOW_SCORE: 0,
    ADVISORY: 0,
    WEIGHTED: 0,
    GATED: 0,
    CORE: 0,
  };
  const missingReasonDistribution: Record<string, number> = {};
  const positiveAxisCounts = Object.fromEntries(AXES.map(axis => [axis, 0])) as Record<Gate2Axis, number>;
  const negativeAxisCounts = Object.fromEntries(AXES.map(axis => [axis, 0])) as Record<Gate2Axis, number>;
  const missingAxisCounts = Object.fromEntries(AXES.map(axis => [axis, 0])) as Record<Gate2Axis, number>;

  for (const result of results) {
    for (const axis of result.axes) {
      increment(axisDistribution[axis.axis], axis.status);
      increment(confidenceDistribution, axis.confidence);
      increment(promotionStageDistribution, axis.promotionStage);
      if (axis.missingReason) missingReasonDistribution[axis.missingReason] = (missingReasonDistribution[axis.missingReason] ?? 0) + 1;
      if (axis.status === 'BULLISH' || axis.status === 'ACCUMULATING') positiveAxisCounts[axis.axis] += 1;
      if (axis.status === 'WEAK') negativeAxisCounts[axis.axis] += 1;
      if (axis.status === 'MISSING') missingAxisCounts[axis.axis] += 1;
    }
  }

  const scores = evaluatedResults
    .map(result => result.coverageAdjustedScore)
    .filter((score): score is number => score != null);
  const usableAxisTotal = evaluatedResults.reduce((sum, result) => sum + result.usableAxisCount, 0);
  const providerIssueSeparatedCount = results.reduce((sum, result) =>
    sum + (result.axes.some(axis => axis.evidence.some(item => item.includes('providerIssueSeparated=true'))) ? 1 : 0), 0);

  return {
    sourceSnapshotId,
    totalCandidates: results.length,
    evaluated: evaluatedResults.length,
    gate2PassStrong: results.filter(result => result.gate2Status === 'GATE2_PASS_STRONG').length,
    gate2PassWeak: results.filter(result => result.gate2Status === 'GATE2_PASS_WEAK').length,
    gate2Watch: results.filter(result => result.gate2Status === 'GATE2_WATCH').length,
    gate2Fail: results.filter(result => result.gate2Status === 'GATE2_FAIL').length,
    dataIncomplete: results.filter(result => result.gate2Status === 'DATA_INCOMPLETE').length,
    skippedByGate1: results.filter(result => result.gate2Status === 'SKIPPED_BY_GATE1').length,
    avgCoverageAdjustedScore: scores.length > 0 ? round1(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    usableAxisAvg: evaluatedResults.length > 0 ? round1(usableAxisTotal / evaluatedResults.length) : 0,
    rsUsable: results.filter(result => result.axes.find(axis => axis.axis === 'RS_RELATIVE_STRENGTH')?.scoreIncluded).length,
    supplyUsable: results.filter(result => result.axes.find(axis => axis.axis === 'SUPPLY_CONFLUENCE')?.scoreIncluded).length,
    sectorUsable: results.filter(result => result.axes.find(axis => axis.axis === 'SECTOR_LEADERSHIP')?.scoreIncluded).length,
    technicalUsable: results.filter(result => result.axes.find(axis => axis.axis === 'TECHNICAL_TREND')?.scoreIncluded).length,
    fundamentalUsable: results.filter(result => result.axes.find(axis => axis.axis === 'FUNDAMENTAL_QUALITY')?.scoreIncluded).length,
    topPositiveAxis: topFromCounts(positiveAxisCounts),
    topNegativeAxis: topFromCounts(negativeAxisCounts),
    topMissingAxis: topFromCounts(missingAxisCounts),
    axisDistribution,
    confidenceDistribution,
    promotionStageDistribution,
    missingReasonDistribution,
    gate2InputFromGate1Pass: results.filter(result => result.gate1Status === 'PASS').length,
    gate2InputFromGate1Degraded: results.filter(result => result.gate1Status === 'DEGRADED_PASS').length,
    gate2SkippedByGate1HardFail: results.filter(result => result.gate1Status === 'FAIL_HARD').length,
    gate2DiagnosticOnlyFromGate1Incomplete: results.filter(result => result.gate1Status === 'DATA_INCOMPLETE').length,
    providerIssueSeparatedCount,
    aiEstimatedAxisExcludedCount: results.reduce((sum, result) => sum + result.aiEstimatedAxisCount, 0),
    counterfactualSeeds,
    results,
    executionImpact: 'NONE',
    marketSignal: false,
    shadowLearning: true,
    counterfactualRecorded: true,
  };
}

function countText(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}:${value}`);
  return parts.join(',') || 'none';
}

export function formatGate2ConfluenceCompact(summary: Gate2ConfluenceSummary | null | undefined): string {
  if (!summary || summary.totalCandidates <= 0) {
    return [
      'Gate2 Growth / Confluence Validation',
      'evaluated: 0/0',
      'reason=GATE2_CONFLUENCE_NOT_CARRIED',
      'executionImpact=NONE',
      'shadowLearning=true',
      'counterfactualRecorded=true',
    ].join('\n');
  }

  return [
    'Gate2 Growth / Confluence Validation',
    `sourceSnapshotId=${summary.sourceSnapshotId}`,
    `evaluated: ${summary.evaluated}/${summary.totalCandidates}`,
    `gate2PassStrong: ${summary.gate2PassStrong}`,
    `gate2PassWeak: ${summary.gate2PassWeak}`,
    `gate2Watch: ${summary.gate2Watch}`,
    `gate2Fail: ${summary.gate2Fail}`,
    `dataIncomplete: ${summary.dataIncomplete}`,
    `skippedByGate1: ${summary.skippedByGate1}`,
    `avgCoverageAdjustedScore: ${summary.avgCoverageAdjustedScore ?? 'null'}`,
    `usableAxisAvg: ${summary.usableAxisAvg}/5`,
    `topPositiveAxis: ${summary.topPositiveAxis}`,
    `topNegativeAxis: ${summary.topNegativeAxis}`,
    `topMissingAxis: ${summary.topMissingAxis}`,
    `rsUsable: ${summary.rsUsable}/${summary.totalCandidates}`,
    `supplyUsable: ${summary.supplyUsable}/${summary.totalCandidates}`,
    `sectorUsable: ${summary.sectorUsable}/${summary.totalCandidates}`,
    `technicalUsable: ${summary.technicalUsable}/${summary.totalCandidates}`,
    `fundamentalUsable: ${summary.fundamentalUsable}/${summary.totalCandidates}`,
    `aiEstimatedAxisExcluded: ${summary.aiEstimatedAxisExcludedCount}`,
    `counterfactualSeeds: ${summary.counterfactualSeeds.length}`,
    'executionImpact=NONE',
    'shadowLearning=true',
    'counterfactualRecorded=true',
  ].join('\n');
}

export function formatGate2ConfluenceFull(summary: Gate2ConfluenceSummary | null | undefined): string | null {
  if (!summary || summary.totalCandidates <= 0) return null;
  return [
    'Gate2 Confluence Full Diagnostic',
    `Gate1ToGate2: pass=${summary.gate2InputFromGate1Pass} degraded=${summary.gate2InputFromGate1Degraded} skippedHardFail=${summary.gate2SkippedByGate1HardFail} diagnosticOnlyFromIncomplete=${summary.gate2DiagnosticOnlyFromGate1Incomplete}`,
    `PromotionStage: ${countText(summary.promotionStageDistribution)}`,
    `Confidence: ${countText(summary.confidenceDistribution)}`,
    `MissingReason: ${countText(summary.missingReasonDistribution)}`,
    `ProviderIssueSeparated: ${summary.providerIssueSeparatedCount}`,
    `AI_ESTIMATED_EXCLUDED: ${summary.aiEstimatedAxisExcludedCount}`,
    'AxisDistribution:',
    ...AXES.map(axis => `- ${axis}: ${countText(summary.axisDistribution[axis])}`),
    'SampleResults:',
    ...summary.results.slice(0, 8).map(result => {
      const axes = result.axes
        .map(axis => `${axis.axis}=${axis.score ?? 'null'}:${axis.status}:${axis.promotionStage}${axis.scoreIncluded ? '' : ':excluded'}`)
        .join(' ');
      return `- ${result.symbol} gate1=${result.gate1Status} gate2EvaluationScope=${result.gate2EvaluationScope} finalGate2=${result.finalGate2} upstreamBlocker=${result.upstreamBlocker ?? 'NONE'} gate2DiagnosticPrimary=${result.gate2DiagnosticPrimary ?? 'NONE'} score=${result.coverageAdjustedScore ?? 'null'} usable=${result.usableAxisCount}/5 ${axes}`;
    }),
    'marketSignal=false',
    'executionImpact=NONE',
  ].join('\n');
}
