// @responsibility Candidate Decision Card view model shared by Discover/Watchlist/Public Report.

import {
  isChecklistConditionMet,
  GATE1_IDS,
  GATE1_REQUIRED,
  GATE2_IDS,
  GATE2_REQUIRED,
  GATE3_IDS,
  GATE3_REQUIRED,
} from '../constants/gateConfig';
import { CONDITION_ID_TO_CHECKLIST_KEY, type ConditionId } from '../types/core';
import type { StockRecommendation } from '../services/stockService';
import { classifyDataQuality, resolveConditionTier, isVerifiedTier } from '../utils/dataQualityClassifier';
import type {
  CandidateDecisionSummary,
  CandidateSectorAlignment,
  DailyMarketGateCard,
  DataConfidenceSummary,
  GateStatus,
  GateSummary,
  PublicDecisionDisplay,
  PublicDecisionStatus,
  SectorAlignment,
  SectorRotationCard,
  ShadowTrackingStatus,
  StockDecisionCard,
} from '../public-report/reportTypes';

export interface CandidateDecisionBuildContext {
  sourceSnapshotId?: string;
  asOf?: string;
  engineMode?: DailyMarketGateCard['engineMode'];
  marketGateStatus?: DailyMarketGateCard['marketGateStatus'];
  sectorRotation?: SectorRotationCard;
}

const DEFAULT_SOURCE_SNAPSHOT_ID = 'candidate-card-local';

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function conditionPasses(stock: StockRecommendation, id: ConditionId): boolean {
  const key = CONDITION_ID_TO_CHECKLIST_KEY[id];
  if (!key) return false;
  const value = stock.checklist?.[key as keyof StockRecommendation['checklist']];
  return isChecklistConditionMet(value);
}

/** 통과 + 실데이터 검증(AI 추정 아님) 인지 — 게이트 절충 표기(검증 N·AI M)용. */
function conditionVerifiedPass(stock: StockRecommendation, id: ConditionId): boolean {
  const key = CONDITION_ID_TO_CHECKLIST_KEY[id];
  if (!key) return false;
  return conditionPasses(stock, id) && isVerifiedTier(resolveConditionTier(stock, key as keyof StockRecommendation['checklist']));
}

/** 검증 가중 최종 점수 — 검증 통과=1·AI 추정 통과=0.5·미달=0 (SSOT 레이더와 동일 철학).
 * AI 가 채운 truthy 만으로 100 이 되던 부풀림을 실데이터 검증 비율로 정직화한다. */
function weightedFinalScore(stock: StockRecommendation): number {
  const ids: ConditionId[] = [...GATE1_IDS, ...GATE2_IDS, ...GATE3_IDS];
  if (ids.length === 0) return 0;
  const weighted = ids.reduce(
    (sum, id) => sum + (conditionVerifiedPass(stock, id) ? 1 : conditionPasses(stock, id) ? 0.5 : 0),
    0,
  );
  return Math.round((weighted / ids.length) * 100);
}

function buildGateSummary(
  stock: StockRecommendation,
  name: string,
  ids: readonly ConditionId[],
  required: number,
  failStatus: GateStatus,
): GateSummary {
  // UI 표시 SSOT — conditionPasses(>=CONDITION_PASS_THRESHOLD) 단일 임계값 기반.
  // 직전엔 `explicitPassed` (stock.gateEvaluation.gateNPassed) 가 다른 임계값으로
  // 산정된 후 우선 채택돼, status=PASS + passed=0/total=N 모순 표시됨.
  // primaryReason 도 외부 값(다른 임계 기반) 무시하고 로컬 count 로 재구성 — 정직성.
  const passed = ids.filter((id) => conditionPasses(stock, id)).length;
  const verifiedPassed = ids.filter((id) => conditionVerifiedPass(stock, id)).length;
  const total = ids.length;
  const status: GateStatus = passed >= required
    ? 'PASS'
    : passed === 0
      ? 'DATA_INSUFFICIENT'
      : failStatus;
  // 절충(사용자 채택): 게이트 통과수는 유지하되 검증/AI 추정 비율을 함께 표기 —
  // Gemini all-true 로 통과수가 부풀 때 실데이터 근거가 얼마인지 정직하게 보여준다.
  const breakdown = passed > 0 ? ` (검${verifiedPassed}·AI${passed - verifiedPassed})` : '';
  const primaryReason = status === 'PASS'
    ? `통과 ${passed}/${total}${breakdown}`
    : status === 'DATA_INSUFFICIENT'
      ? `데이터 부족 ${0}/${total}`
      : `미충족 ${passed}/${total} 기준${required}${breakdown}`;
  return { name, status, passed, total, primaryReason };
}

function buildGate0Summary(context: CandidateDecisionBuildContext, stock: StockRecommendation): GateSummary {
  const marketGateStatus = context.marketGateStatus ?? (
    stock.aiConvictionScore?.marketPhase === 'BEAR' || stock.aiConvictionScore?.marketPhase === 'RISK_OFF'
      ? 'ORANGE'
      : 'YELLOW'
  );
  const status: GateStatus =
    marketGateStatus === 'GREEN' || marketGateStatus === 'YELLOW'
      ? 'PASS'
      : marketGateStatus === 'ORANGE' || marketGateStatus === 'GRAY'
        ? 'WATCH'
        : 'BLOCKED';
  return {
    name: 'Gate 0 Market',
    status,
    passed: status === 'PASS' ? 1 : 0,
    total: 1,
    primaryReason: `market=${marketGateStatus}`,
  };
}

export function buildCandidateDataConfidence(stock: StockRecommendation): DataConfidenceSummary {
  const dataQuality = classifyDataQuality(stock);
  const calculatedIndicatorCount = dataQuality.computed + dataQuality.api;
  const aiEstimatedIndicatorCount = dataQuality.aiInferred;
  const missingIndicatorCount = [
    stock.currentPrice,
    stock.targetPrice,
    stock.stopLoss,
    stock.gateEvaluation?.finalScore ?? stock.quantGateScore?.value ?? stock.confidenceScore,
  ].filter((value) => typeof value !== 'number' || !Number.isFinite(value)).length;
  const providerIssue = stock.dataSourceType === 'STALE';
  const total = Math.max(1, dataQuality.total + missingIndicatorCount);
  const aiRatio = aiEstimatedIndicatorCount / total;
  const verifiedRatio = calculatedIndicatorCount / total;
  // AI 추정이 우세하면 STALE 보다 AI_ESTIMATED 를 우선 표시 — 'stale(실패처럼 보임)' 보다
  // 'AI 추정(L4 참조값)' 이 사용자에게 더 정직하고 신뢰감 있다. providerIssue 불리언은 그대로
  // 보존(불변식 marketSignal 분리 로직용). live 차단은 아래 liveExecutionAllowed 에서 별도 유지.
  const overall: DataConfidenceSummary['overall'] = missingIndicatorCount > 0
    ? 'MISSING'
    : aiRatio >= 0.3
      ? 'AI_ESTIMATED'
      : providerIssue
        ? 'STALE'
        : verifiedRatio >= 0.7
          ? 'VERIFIED'
          : 'DEGRADED';

  return {
    overall,
    calculatedIndicatorCount,
    aiEstimatedIndicatorCount,
    missingIndicatorCount,
    providerIssue,
    marketSignal: false,
    notes: [
      aiEstimatedIndicatorCount > 0 ? 'AI estimated inputs are separated from calculated evidence.' : '',
      missingIndicatorCount > 0 ? 'Core card inputs are missing; live judgment should stay deferred.' : '',
      providerIssue ? 'Provider issue is isolated from marketSignal.' : '',
    ].filter(Boolean),
  };
}

function normalizeFinalScore(stock: StockRecommendation): number {
  const candidates = [
    stock.gateEvaluation?.finalScore,
    typeof stock.quantGateScore?.value === 'number' ? stock.quantGateScore.value * 10 : undefined,
    stock.confidenceScore,
    stock.aiConvictionScore?.totalScore,
  ];
  const raw = candidates.find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (raw === undefined) return 0;
  if (raw <= 10) return clamp(raw * 10);
  if (raw <= 27) return clamp((raw / 27) * 100);
  return clamp(raw);
}

export function publicDecisionLabel(status?: PublicDecisionStatus): PublicDecisionDisplay {
  switch (status) {
    case 'CONFIRMED_CANDIDATE':
    case 'BUY_CANDIDATE':
    case 'WATCH':
    case 'WAIT_PULLBACK':
    case 'HOLD':
    case 'SELL_ONLY':
    case 'SHADOW_ONLY':
    case 'BLOCKED':
    case 'DATA_INSUFFICIENT':
      return status;
    default:
      return 'DATA_INSUFFICIENT';
  }
}

export const PUBLIC_DECISION_TEXT: Record<PublicDecisionStatus, string> = {
  CONFIRMED_CANDIDATE: 'Strong candidate',
  BUY_CANDIDATE: 'Entry candidate',
  WATCH: 'Watch',
  WAIT_PULLBACK: 'Wait pullback',
  HOLD: 'Hold management',
  SELL_ONLY: 'Sell-only',
  SHADOW_ONLY: 'Shadow tracking',
  BLOCKED: 'Blocked',
  DATA_INSUFFICIENT: 'Data insufficient',
};
function decideStatus(
  stock: StockRecommendation,
  confidence: DataConfidenceSummary,
  gate0: GateSummary,
  gate1: GateSummary,
  gate2: GateSummary,
  gate3: GateSummary,
  engineMode: DailyMarketGateCard['engineMode'],
  sectorAlignment: CandidateSectorAlignment,
): PublicDecisionStatus {
  if (engineMode === 'SELL_ONLY') return 'SELL_ONLY';
  if (engineMode === 'SHADOW_ONLY' || engineMode === 'OBSERVE_ONLY') return 'SHADOW_ONLY';
  if (confidence.overall === 'MISSING' || confidence.overall === 'STALE') return 'DATA_INSUFFICIENT';
  if (gate0.status === 'BLOCKED' || gate1.status === 'BLOCKED') return 'BLOCKED';
  if (sectorAlignment.sectorAlignment === 'AVOID_SECTOR') return 'BLOCKED';
  if (gate3.status === 'BLOCKED') return 'BLOCKED';
  if (gate3.status === 'WAIT' || gate3.status === 'WATCH' || stock.gateEvaluation?.gate3Passed === false) return 'WAIT_PULLBACK';
  if (gate2.status === 'WATCH' || gate2.status === 'DATA_INSUFFICIENT' || stock.gateEvaluation?.gate2Passed === false) return 'WATCH';
  if (sectorAlignment.sectorAlignment === 'WEAK_SECTOR') return 'WATCH';
  if (stock.type === 'STRONG_SELL' || stock.type === 'SELL') return 'HOLD';
  if (gate0.status === 'WATCH') return 'WAIT_PULLBACK';
  if (stock.type === 'STRONG_BUY' && confidence.aiEstimatedIndicatorCount === 0) {
    return gate0.primaryReason?.includes('market=YELLOW') ? 'BUY_CANDIDATE' : 'CONFIRMED_CANDIDATE';
  }
  if (stock.type === 'STRONG_BUY' || stock.type === 'BUY') return 'BUY_CANDIDATE';
  return 'WATCH';
}

function buildPositiveDrivers(
  stock: StockRecommendation,
  gate1: GateSummary,
  gate2: GateSummary,
  gate3: GateSummary,
  sectorAlignment: CandidateSectorAlignment,
): string[] {
  return [
    stock.reason,
    sectorAlignment.sectorBonusApplied ? `${sectorAlignment.sectorName} 섹터 정렬 양호` : '',
    stock.supplyQuality?.active ? '수급 유입 활발' : '',
    gate1.status === 'PASS' ? 'Gate 1 생존 필터 통과' : '',
    gate2.status === 'PASS' ? 'Gate 2 성장성 검증 통과' : '',
    gate3.status === 'PASS' ? 'Gate 3 타이밍 조건 통과' : '',
    ...(stock.patterns ?? []).slice(0, 2).map((pattern) => `패턴: ${pattern}`),
    stock.visualReport?.summary,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function buildRiskDrivers(
  stock: StockRecommendation,
  confidence: DataConfidenceSummary,
  sectorAlignment: CandidateSectorAlignment,
): string[] {
  return [
    ...(stock.riskFactors ?? []),
    sectorAlignment.sectorPenaltyApplied ? `${sectorAlignment.sectorName} 섹터 약세 구간` : '',
    confidence.aiEstimatedIndicatorCount > 0 ? 'AI 추정 근거 포함 (미검증)' : '',
    confidence.missingIndicatorCount > 0 ? '핵심 데이터 누락' : '',
    confidence.providerIssue ? '공급자 데이터 이슈 (시그널과 분리)' : '',
    stock.technicalSignals?.rsi > 75 ? `RSI 과열 주의 (${stock.technicalSignals.rsi})` : '',
    stock.isPreviousLeader ? '前 주도주 피로 리스크' : '',
    stock.newsSentiment?.status === 'NEGATIVE' ? stock.newsSentiment.summary : '',
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function buildBlockReasons(
  confidence: DataConfidenceSummary,
  gate0: GateSummary,
  gate1: GateSummary,
  gate2: GateSummary,
  gate3: GateSummary,
  engineMode: DailyMarketGateCard['engineMode'],
  sectorAlignment: CandidateSectorAlignment,
): string[] {
  return [
    engineMode === 'SELL_ONLY' ? 'SELL_ONLY 정책 — 진단 중 신규 매수 차단' : '',
    engineMode === 'SHADOW_ONLY' || engineMode === 'OBSERVE_ONLY' ? `${engineMode} — 실매수 차단 (Shadow 추적은 유지)` : '',
    gate0.status === 'BLOCKED' ? 'Gate 0 시장 환경 — 신규 진입 차단' : '',
    gate1.status === 'BLOCKED' ? gate1.primaryReason ?? 'Gate 1 생존 필터 미통과' : '',
    sectorAlignment.sectorAlignment === 'AVOID_SECTOR' ? `${sectorAlignment.sectorName} 회피 섹터 — 신규 매수 차단` : '',
    sectorAlignment.sectorAlignment === 'WEAK_SECTOR' ? `${sectorAlignment.sectorName} 약세 섹터 — 관찰로 강등` : '',
    gate2.status !== 'PASS' ? gate2.primaryReason ?? 'Gate 2 성장성 검증 미완료' : '',
    gate3.status !== 'PASS' ? gate3.primaryReason ?? 'Gate 3 타이밍/트리거 미확정' : '',
    confidence.overall === 'MISSING' ? '핵심 데이터 누락 — 실시간 판단 보류' : '',
    confidence.overall === 'STALE' ? '공급자 데이터 stale — 시그널 미확정' : '',
    confidence.overall === 'AI_ESTIMATED' ? 'AI 추정 근거는 계산 근거와 분리됨' : '',
  ].filter((item): item is string => item.length > 0);
}

function buildNextActions(status: PublicDecisionStatus): string[] {
  switch (status) {
    case 'CONFIRMED_CANDIDATE':
    case 'BUY_CANDIDATE':
      return ['SHADOW_TRACK', 'CHECK_EXECUTION_POLICY'];
    case 'WATCH':
      return ['WATCH', 'RECHECK_GATE'];
    case 'WAIT_PULLBACK':
      return ['WAIT_PULLBACK', 'RECHECK_GATE3'];
    case 'SELL_ONLY':
    case 'SHADOW_ONLY':
      return ['SHADOW_TRACK', 'POLICY_BLOCKED'];
    case 'DATA_INSUFFICIENT':
      return ['RECHECK_DATA', 'SHADOW_TRACK'];
    case 'BLOCKED':
      return ['BLOCKED', 'SHADOW_TRACK'];
    case 'HOLD':
    default:
      return ['WATCH'];
  }
}

function buildConfluenceAxes(stock: StockRecommendation, gate0: GateSummary): StockDecisionCard['confluenceAxes'] {
  const macroScore = gate0.status === 'PASS' ? 7 : gate0.status === 'WATCH' ? 5 : 3;
  return [
    { id: 'FUNDAMENTAL', score: round(clamp(stock.visualReport?.financial ?? stock.valuation?.epsGrowth ?? 0) / 10, 1), reason: 'Fundamental quality evidence' },
    { id: 'FLOW', score: round(clamp(stock.visualReport?.supply ?? (stock.supplyQuality?.active ? 70 : 45)) / 10, 1), reason: 'Supply confluence evidence' },
    { id: 'TECHNICAL', score: round(clamp(stock.visualReport?.technical ?? stock.confidenceScore ?? 0) / 10, 1), reason: 'Gate 3 timing evidence' },
    { id: 'MACRO', score: macroScore, reason: gate0.primaryReason },
  ];
}

function gateText(gate: GateSummary): string {
  return `${gate.passed}/${gate.total} ${gate.status}`;
}

function stockSector(stock: StockRecommendation): string {
  return stock.sectorAnalysis?.sectorName
    ?? stock.relatedSectors?.[0]
    ?? stock.correlationGroup
    ?? 'UNCLASSIFIED';
}

function alignmentFromScore(score: number): SectorAlignment {
  if (score >= 80) return 'LEADING_SECTOR';
  if (score >= 65) return 'WATCH_SECTOR';
  if (score >= 50) return 'NEUTRAL_SECTOR';
  if (score >= 35) return 'WEAK_SECTOR';
  return 'AVOID_SECTOR';
}

function buildSectorAlignment(stock: StockRecommendation, context: CandidateDecisionBuildContext): CandidateSectorAlignment {
  const sectorName = stockSector(stock);
  const normalizedName = sectorName.trim().toLowerCase();
  const sectorItem = context.sectorRotation?.sectors.find((item) => item.sectorName.trim().toLowerCase() === normalizedName);
  const fallbackScore = stock.isLeadingSector ? 80 : 50;
  const sectorScore = sectorItem?.sectorScore ?? fallbackScore;
  const sectorRank = sectorItem?.relativeStrengthRank ?? (stock.isLeadingSector ? 1 : 0);
  const sectorAlignment = sectorItem?.alignment ?? alignmentFromScore(sectorScore);
  const isLeadingSector = sectorAlignment === 'LEADING_SECTOR' || stock.isLeadingSector === true;

  return {
    sectorName,
    sectorScore,
    sectorRank,
    isLeadingSector,
    sectorAlignment,
    sectorPenaltyApplied: sectorAlignment === 'WEAK_SECTOR' || sectorAlignment === 'AVOID_SECTOR',
    sectorBonusApplied: sectorAlignment === 'LEADING_SECTOR' || sectorAlignment === 'WATCH_SECTOR',
  };
}

function deriveExecutionImpact(status: PublicDecisionStatus, liveExecutionAllowed: boolean, engineMode: DailyMarketGateCard['engineMode']): StockDecisionCard['executionImpact'] {
  if (liveExecutionAllowed) return 'LIVE_EXECUTION_ALLOWED';
  if (engineMode === 'SELL_ONLY' || status === 'BLOCKED') return 'LIVE_EXECUTION_BLOCKED';
  if (status === 'DATA_INSUFFICIENT' || status === 'SHADOW_ONLY') return 'NEW_BUY_BLOCKED_ONLY';
  return 'NONE';
}

function deriveShadowTrackingStatus(status: PublicDecisionStatus): ShadowTrackingStatus {
  if (status === 'BLOCKED' || status === 'DATA_INSUFFICIENT') return 'BLOCKED_BUT_TRACKED';
  if (status === 'HOLD') return 'ON';
  return 'ON';
}

function mapShadowRegistrationStatus(status: ShadowTrackingStatus): StockDecisionCard['shadowRegistrationStatus'] {
  if (status === 'REGISTERED' || status === 'PAPER_FILLED' || status === 'OPEN' || status === 'CLOSED') return 'REGISTERED';
  if (status === 'OFF') return 'NOT_ALLOWED';
  return 'SHADOW_ONLY';
}

export function buildCandidateDecisionCardModel(
  stock: StockRecommendation,
  context: CandidateDecisionBuildContext = {},
): StockDecisionCard {
  const engineMode = context.engineMode ?? 'NORMAL';
  const sourceSnapshotId = context.sourceSnapshotId ?? DEFAULT_SOURCE_SNAPSHOT_ID;
  const asOf = context.asOf ?? stock.priceUpdatedAt ?? stock.financialUpdatedAt ?? new Date(0).toISOString();
  const confidence = buildCandidateDataConfidence(stock);
  const gate0 = buildGate0Summary(context, stock);
  const gate1 = buildGateSummary(stock, 'Gate 1 Survival', GATE1_IDS, GATE1_REQUIRED, 'BLOCKED');
  const gate2 = buildGateSummary(stock, 'Gate 2 Growth', GATE2_IDS, GATE2_REQUIRED, 'WATCH');
  const gate3 = buildGateSummary(stock, 'Gate 3 Timing', GATE3_IDS, GATE3_REQUIRED, 'WAIT');
  const sectorAlignment = buildSectorAlignment(stock, context);
  const finalDecision = decideStatus(stock, confidence, gate0, gate1, gate2, gate3, engineMode, sectorAlignment);
  const positiveDrivers = buildPositiveDrivers(stock, gate1, gate2, gate3, sectorAlignment);
  const riskDrivers = buildRiskDrivers(stock, confidence, sectorAlignment);
  const blockReasons = buildBlockReasons(confidence, gate0, gate1, gate2, gate3, engineMode, sectorAlignment);
  const liveExecutionAllowed = (
    engineMode === 'NORMAL'
    && (finalDecision === 'CONFIRMED_CANDIDATE' || finalDecision === 'BUY_CANDIDATE')
    && confidence.overall !== 'MISSING'
    && confidence.overall !== 'STALE'
    // 불변식 #7 — AI_ESTIMATED(L4) 는 live 집행 표시 차단 (overall 우선순위 변경에 따른 안전 보존).
    && confidence.overall !== 'AI_ESTIMATED'
    && !confidence.providerIssue
  );
  const shadowTrackingStatus = deriveShadowTrackingStatus(finalDecision);
  const executionImpact = deriveExecutionImpact(finalDecision, liveExecutionAllowed, engineMode);

  return {
    stockCode: stock.code,
    stockName: stock.name,
    sector: stockSector(stock),
    finalDecision,
    displayDecision: publicDecisionLabel(finalDecision),
    // finalScore — 검증 가중(검증=1·AI추정=0.5·미달=0). Gemini 가 checklist 를 거의 다 true 로
    // 채워 단순 통과수면 "전부 통과=100" 으로 부풀던 문제(실데이터 검증 0 인데 100) 정직화.
    // 실데이터 검증 비율이 높을수록 점수가 오른다 — SSOT 레이더와 동일 가중.
    finalScore: weightedFinalScore(stock),
    sourceSnapshotId,
    asOf,
    gate0,
    gate1,
    gate2,
    gate3,
    gate0MacroStatus: gateText(gate0),
    gate1SurvivalResult: gateText(gate1),
    gate2GrowthResult: gateText(gate2),
    gate3TimingResult: gateText(gate3),
    sectorAlignment,
    calculatedIndicatorCount: confidence.calculatedIndicatorCount,
    aiEstimatedIndicatorCount: confidence.aiEstimatedIndicatorCount,
    missingIndicatorCount: confidence.missingIndicatorCount,
    dataConfidenceSummary: confidence,
    dataConfidence: confidence,
    positiveDrivers,
    riskDrivers,
    bullishReasons: positiveDrivers,
    bearishReasons: riskDrivers,
    blockedReasons: blockReasons,
    nextCheckConditions: buildNextActions(finalDecision),
    nextAction: buildNextActions(finalDecision),
    confluenceAxes: buildConfluenceAxes(stock, gate0),
    shadowRegistrationStatus: mapShadowRegistrationStatus(shadowTrackingStatus),
    shadowTrackingStatus,
    liveExecutionAllowed,
    engineMode,
    executionImpact,
  };
}

export function buildCandidateDecisionSummary(
  recommendations: StockRecommendation[] = [],
  context: CandidateDecisionBuildContext = {},
): CandidateDecisionSummary {
  const summary: CandidateDecisionSummary = {
    totalCandidates: recommendations.length,
    confirmedCandidateCount: 0,
    buyCandidateCount: 0,
    watchCount: 0,
    waitPullbackCount: 0,
    blockedCount: 0,
    dataInsufficientCount: 0,
    sellOnlyCount: 0,
    shadowOnlyCount: 0,
    shadowTrackingCount: 0,
    holdCount: 0,
  };

  for (const stock of recommendations) {
    const model = buildCandidateDecisionCardModel(stock, context);
    if (model.finalDecision === 'CONFIRMED_CANDIDATE') summary.confirmedCandidateCount += 1;
    if (model.finalDecision === 'BUY_CANDIDATE') summary.buyCandidateCount += 1;
    if (model.finalDecision === 'WATCH') summary.watchCount += 1;
    if (model.finalDecision === 'WAIT_PULLBACK') summary.waitPullbackCount += 1;
    if (model.finalDecision === 'BLOCKED') summary.blockedCount += 1;
    if (model.finalDecision === 'DATA_INSUFFICIENT') summary.dataInsufficientCount += 1;
    if (model.finalDecision === 'SELL_ONLY') summary.sellOnlyCount += 1;
    if (model.finalDecision === 'SHADOW_ONLY') summary.shadowOnlyCount += 1;
    if (model.finalDecision === 'HOLD') summary.holdCount += 1;
    if (model.shadowTrackingStatus !== 'OFF') summary.shadowTrackingCount += 1;
  }

  return summary;
}
