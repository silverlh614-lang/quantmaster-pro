/**
 * gateEngine.ts — 퀀트 Gate 평가 엔진 (메인 오케스트레이터)
 *
 * evaluateStock() 함수를 통해 Gate 1→2→3 단계 평가를 수행하고
 * EvaluationResult를 반환한다.
 *
 * 세부 로직은 다음 서브모듈로 분리됨:
 *   macroEngine.ts         — Gate 0, RegimeConfig, MAPC
 *   fxRateCycleEngine.ts   — FX 조정 팩터, 금리 사이클 역가중치
 *   contrarianEngine.ts    — 역발상 카운터사이클 알고리즘
 *   extendedRegimeEngine.ts — 확장 레짐 감지, 상승 초기 선취매
 *   roeEngine.ts           — ROE 유형 전이 감지
 */

import {
  ConditionId,
  EvaluationResult,
  MarketRegime,
  StockProfile,
  StockProfileType,
  SectorRotation,
  MultiTimeframe,
  TranchePlan,
  EnemyChecklist,
  SeasonalityData,
  AttributionAnalysis,
  MacroEnvironment,
  Gate0Result,
  RateCycle,
  SmartMoneyData,
  ExportMomentumData,
  GeopoliticalRiskData,
  CreditSpreadData,
  EconomicRegime,
  FinancialStressIndex,
  SupplyChainIntelligence,
} from '../../types/quant';
import { z } from 'zod';
import {
  ALL_CONDITIONS,
  CONDITION_SOURCE_MAP,
  getEvolutionWeightsFromPerformance,
} from './evolutionEngine';
import {
  computeConfluence, classifyCyclePosition, gradeCatalyst,
  analyzeMomentumAcceleration, evaluateTMA, evaluateSRR,
  evaluateEnemyChecklist, computeDataReliability, computeSignalVerdict,
} from './technicalEngine';
import { VKOSPI } from '../../constants/thresholds';

// ── 서브모듈 re-export (외부 코드가 gateEngine 경유로 import 할 수 있도록 유지) ──
export { evaluateGate0, getRegimeConfig, evaluateMAPCResult } from './macroEngine';
export { getFXAdjustmentFactor, getRateCycleAdjustment } from './fxRateCycleEngine';
export { computeContrarianSignals } from './contrarianEngine';
export { evaluateEarlyBullEntry, classifyExtendedRegime, deriveExtendedRegime } from './extendedRegimeEngine';
export { detectROETransition } from './roeEngine';
export { detectContradictions } from './contradictionDetector';
export { evaluateTimingSync, tradingDaysBetween } from './timingSyncEngine';
export {
  computeHybridZone, assignPercentileZones, isStrongBuyQualified, normalizeScore,
  FINAL_SCORE_MAX,
} from './percentileClassifier';
export type { PercentileZone, ScoredEntry, ZonedEntry, StrongBuyQualificationCriteria } from './percentileClassifier';

// ── 서브모듈 직접 import (evaluateStock 내부에서 사용) ───────────────────────
import { evaluateGate0, evaluateMAPCResult } from './macroEngine';
import { getFXAdjustmentFactor, getRateCycleAdjustment } from './fxRateCycleEngine';
import { computeContrarianSignals } from './contrarianEngine';
import { evaluateEarlyBullEntry, classifyExtendedRegime, deriveExtendedRegime } from './extendedRegimeEngine';
import { detectROETransition } from './roeEngine';
import { detectContradictions } from './contradictionDetector';
import { evaluateTimingSync } from './timingSyncEngine';
import { normalizeScore } from './percentileClassifier';

// ─── 아이디어 9: evaluateStock 입력 유효성 검증 스키마 ────────────────────────────

/** ConditionId(1~27)에 대응하는 단일 조건 점수 스키마 (0~10) */
const ConditionScoreSchema = z.number().min(0).max(10);

/**
 * stockData 런타임 검증 스키마.
 * 키: 1~27 정수(문자열 키도 숫자로 강제 변환), 값: 0~10 숫자.
 * safeParse 실패 시 evaluateStock은 빈 객체로 대체(fallback).
 */
const StockDataSchema = z.record(
  z.coerce.number().int().min(1).max(27),
  ConditionScoreSchema,
);

const GATE1_IDS: ConditionId[] = [1, 3, 5, 7, 9];
const GATE2_IDS: ConditionId[] = [4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24];
const GATE3_IDS: ConditionId[] = [2, 17, 18, 19, 20, 22, 23, 25, 26, 27];

// ─── Stock Profile ──────────────────────────────────────────────────────────

export function getStockProfile(type: StockProfileType): StockProfile {
  switch (type) {
    case 'A': return { type: 'A', monitoringCycle: 'WEEKLY', stopLoss: -15, executionDelay: 3 };
    case 'B': return { type: 'B', monitoringCycle: 'DAILY', stopLoss: -12, executionDelay: 1 };
    case 'C': return { type: 'C', monitoringCycle: 'REALTIME', stopLoss: -8, executionDelay: 0 };
    case 'D': return { type: 'D', monitoringCycle: 'REALTIME', stopLoss: -5, executionDelay: 0 };
  }
}

// ─── Position Sizing 계산기 ─────────────────────────────────────────────────

/** evaluateStock 에서 분리된 기본 포지션 사이즈 + 추천 등급 결정 로직 */
function computeBasePositionSize(ctx: {
  finalScore: number;
  stockData: Record<ConditionId, number>;
  regimeType: string;
  euphoriaSignals: number;
  sellSignalCount: number;
  rrr: number;
  isLeadingSector: boolean;
  kellyReduction: number;
  geoRiskScore?: number;
  isGeoSector: boolean;
  creditCrisis: boolean;
  cashRatio: number;
  isPairTradeMode: boolean;
}): { positionSize: number; recommendation: EvaluationResult['recommendation'] } {
  let recommendation: EvaluationResult['recommendation'] = '관망';
  let positionSize = 0;

  const scorePercentage = (ctx.finalScore / 270) * 100;
  if (scorePercentage >= 90) positionSize = 20;
  else if (scorePercentage >= 80) positionSize = 15;
  else if (scorePercentage >= 70) positionSize = 10;
  else if (scorePercentage >= 60) positionSize = 5;

  // Conflict Signal Priority
  const fundamentalScore = (ctx.stockData[3] ?? 0) + (ctx.stockData[15] ?? 0) + (ctx.stockData[21] ?? 0);
  const technicalScore = (ctx.stockData[2] ?? 0) + (ctx.stockData[10] ?? 0) + (ctx.stockData[18] ?? 0);

  if (ctx.regimeType === '하락' && technicalScore < 15 && fundamentalScore > 20) {
    positionSize *= 0.7;
  } else if (ctx.regimeType === '상승초기' && technicalScore > 20 && fundamentalScore < 15) {
    positionSize *= 1.2;
  }

  if (positionSize > 0) {
    recommendation = positionSize >= 15 ? '풀 포지션' : '절반 포지션';
  }

  if (!ctx.isLeadingSector) positionSize *= 0.5;

  if (ctx.euphoriaSignals >= 3) {
    recommendation = '매도';
    positionSize *= 0.5;
  }

  if (ctx.sellSignalCount >= 5) {
    recommendation = '강력 매도';
    positionSize = 0;
  } else if (ctx.sellSignalCount >= 3) {
    recommendation = '매도';
    positionSize *= 0.3;
  }

  if (ctx.rrr < 2.0) {
    positionSize = 0;
    recommendation = '관망';
  }

  if (ctx.kellyReduction > 0) {
    positionSize *= (1 - ctx.kellyReduction);
  }

  if (ctx.geoRiskScore !== undefined && ctx.geoRiskScore <= 3 && ctx.isGeoSector) {
    positionSize *= 0.7;
  }

  if (ctx.creditCrisis) {
    positionSize *= 0.5;
  }

  if (ctx.cashRatio > 30) {
    const regimeReduction = 1 - (ctx.cashRatio - 30) / 100;
    positionSize *= Math.max(0.1, regimeReduction);
  }

  if (ctx.isPairTradeMode && positionSize > 0) {
    recommendation = '절반 포지션';
    positionSize = Math.min(positionSize, 5);
  }

  positionSize = Math.max(0, positionSize);
  return { positionSize, recommendation };
}

// ─── Main Evaluation Function ────────────────────────────────────────────────

export function evaluateStock(
  rawStockData: unknown,
  regime: MarketRegime,
  profileType: StockProfileType,
  sectorRotation: SectorRotation,
  euphoriaSignals: number, // 0-5
  emergencyStop: boolean,
  rrr: number,
  sellSignals: number[] = [],
  multiTimeframe?: MultiTimeframe,
  enemyChecklist?: EnemyChecklist,
  seasonality?: SeasonalityData,
  attribution?: AttributionAnalysis,
  isPullbackVolumeLow?: boolean,  // 1순위: 눌림목 거래량 감소 여부
  macroEnv?: MacroEnvironment,    // Gate 0 + FX + Rate Cycle 입력
  stockExportRatio?: number,      // 수출 비중 0-100 (FX 조정용)
  advancedContext?: {
    smartMoney?: SmartMoneyData;
    exportMomentum?: ExportMomentumData;
    geoRisk?: GeopoliticalRiskData;
    creditSpread?: CreditSpreadData;
    economicRegime?: EconomicRegime;
    supplyChain?: SupplyChainIntelligence;
    financialStress?: FinancialStressIndex;
    // 판단엔진 고도화 입력
    newsPhase?: 'SILENT' | 'EARLY' | 'GROWING' | 'CROWDED' | 'OVERHYPED';
    weeklyRsiValues?: number[];           // 최근 3주 RSI [45, 52, 62]
    institutionalAmounts?: number[];      // 최근 5일 기관 순매수 금액
    volumeTrend?: 'INCREASING' | 'STABLE' | 'DECREASING';
    catalystDescription?: string;         // 촉매 설명 텍스트
    dailyCloses?: number[];               // 최근 7일+ 일봉 종가 (TMA 계산용)
    // SRR 입력
    weeklyRsRatios?: number[];           // 주간 RS Ratio 이력 (SRR 계산용)
    entryRsRank?: number;                // 매수 시점 RS 순위 (%, 기본 5)
    currentRsRank?: number;              // 현재 RS 순위 (%)
    stockReturn20d?: number;             // 종목 20일 수익률 (%)
    sectorReturn20d?: number;            // 섹터 ETF 20일 수익률 (%)
    macroEnv?: MacroEnvironment;         // 실시간 매크로 환경 (MAPC 계산용)
    // ROE 유형 전이 감지 입력
    roeTypeHistory?: import('../../types/quant').ROEType[];          // 최근 분기 ROE 유형 배열 (오래된→최신)
    assetTurnoverHistory?: number[];     // 최근 2개 분기 총자산회전율 (오래된→최신)
    // 상승 초기 선취매 조건 입력 (Step 3)
    foreignPassiveActiveDays?: number;   // 외국인 Passive+Active 동반 순매수 일수
    rsPercentileInSector?: number;       // 섹터 내 RS 백분위 (0=최상, 100=최하)
    outperformsKospi1M?: boolean;        // 최근 1개월 KOSPI 대비 아웃퍼폼 여부
    enemyFlags?: Partial<{
      lockupExpiringSoon: boolean;
      majorShareholderSelling: boolean;
      creditBalanceSurge: boolean;
      shortInterestSurge: boolean;
      targetPriceDowngrade: boolean;
      fundMaturityDue: boolean;
      clientPerformanceWeak: boolean;
    }>;
  },
  extendedRegimeOptions?: {
    kospi60dVolatility?: number;
    leadingSectorCount?: number;
    foreignFlowDirection?: 'CONSISTENT_BUY' | 'CONSISTENT_SELL' | 'ALTERNATING';
    kospiSp500Correlation?: number;
    financialStress?: FinancialStressIndex;
    kospiAboveMa20?: boolean;            // Bull Regime 판단용 (Step 1)
  },
  stockSector?: string, // 종목 섹터 (조선/반도체 등) — BDI/SEMI Gate 조정용
  conditionPassTimestamps?: Partial<Record<ConditionId, string>>, // 조건 통과 시점 ISO 문자열 (Timing Sync 계산용)
): EvaluationResult {
  // ── 아이디어 9: Zod 런타임 입력 검증 ──────────────────────────────────────────
  const parsed = StockDataSchema.safeParse(rawStockData);
  if (!parsed.success) {
    console.error('[evaluateStock] Invalid input:', parsed.error.issues);
  }
  let stockData: Record<ConditionId, number> = (
    parsed.success ? parsed.data : {}
  ) as Record<ConditionId, number>;
  const profile = getStockProfile(profileType);

  // ── Gate 0: 거시 환경 생존 게이트 ──────────────────────────────────────────
  const gate0Result: Gate0Result | undefined = macroEnv ? evaluateGate0(macroEnv) : undefined;

  // 금리 사이클 도출
  const rateCycle: RateCycle = macroEnv
    ? (macroEnv.bokRateDirection === 'HIKING' ? 'TIGHTENING'
      : macroEnv.bokRateDirection === 'CUTTING' ? 'EASING' : 'PAUSE')
    : 'PAUSE';
  const rateCycleAdj = getRateCycleAdjustment(rateCycle);

  // FX 조정 팩터 (-3 ~ +3)
  const fxRegime = gate0Result?.fxRegime ?? 'NEUTRAL';
  const fxAdjustmentFactor = getFXAdjustmentFactor(fxRegime, stockExportRatio ?? 50);

  // ── 조기 종료 헬퍼 (Gate 평가 중단 시 공통 반환값) ──────────────────────────
  const earlyExit = (overrides: {
    gate1Score?: number;
    recommendation: EvaluationResult['recommendation'];
    emergencyStop: boolean;
  }): EvaluationResult => ({
    gate0Result,
    smartMoneyData: advancedContext?.smartMoney,
    exportMomentumData: advancedContext?.exportMomentum,
    geopoliticalRisk: advancedContext?.geoRisk,
    creditSpreadData: advancedContext?.creditSpread,
    contrarianSignals: [],
    fxAdjustmentFactor,
    gate1Passed: false,
    gate2Passed: false,
    gate3Passed: false,
    gate1Score: overrides.gate1Score ?? 0,
    gate2Score: 0,
    gate3Score: 0,
    finalScore: 0,
    recommendation: overrides.recommendation,
    positionSize: 0,
    rrr,
    lastTrigger: false,
    euphoriaLevel: euphoriaSignals,
    emergencyStop: overrides.emergencyStop,
    profile,
    sellScore: sellSignals.length,
    sellSignals,
    multiTimeframe,
    enemyChecklist,
    seasonality,
    attribution,
  });

  // ── 확장 레짐 감지 (불확실성/위기/박스권) ──────────────────────────────────
  const extRegimeAction = classifyExtendedRegime(
    gate0Result, macroEnv, advancedContext?.economicRegime, extendedRegimeOptions
  );
  const extRegime = deriveExtendedRegime(
    advancedContext?.economicRegime, gate0Result, macroEnv, extendedRegimeOptions
  );

  // CRISIS 레짐 → 전면 매수 중단 (FULL_STOP)
  if (extRegimeAction.mode === 'FULL_STOP') {
    return earlyExit({ recommendation: '강력 매도', emergencyStop: true });
  }

  // MHS < 40 또는 비상정지 → 전면 매수 중단
  if (gate0Result?.buyingHalted || emergencyStop) {
    return earlyExit({ recommendation: '관망', emergencyStop });
  }

  // ── IDEA 3: ROE 유형 전이 감지 — Gate 1 패널티 적용 ─────────────────────────
  const roeTransitionResult = advancedContext?.roeTypeHistory?.length
    ? detectROETransition(
        advancedContext.roeTypeHistory,
        advancedContext.assetTurnoverHistory ?? [],
      )
    : undefined;
  // [3,3,3,4] 패턴 감지 시 roeType3(조건 id=3) 점수를 0으로 강제 → Gate 1 탈락
  if (roeTransitionResult?.penaltyApplied) {
    stockData = { ...stockData, [3]: 0 } as Record<ConditionId, number>;
  }

  // ── Gate 1: 생존 필터 ────────────────────────────────────────────────────
  // 확장 레짐 기반 적응형 Gate 임계값 적용
  const gate1Threshold = extRegimeAction.gateAdjustment.gate1Threshold;
  const gate1BasePassed = GATE1_IDS.every(id => (stockData[id] ?? 0) >= gate1Threshold);
  // 금리 인상기: ICR(조건23) 추가 임계값 검사
  const icrCheck = rateCycleAdj.gate1IcrMinScore > 5
    ? (stockData[23] ?? 0) >= rateCycleAdj.gate1IcrMinScore
    : true;
  const gate1Passed = gate1BasePassed && icrCheck;

  // ── 동적 가중치 계산 ─────────────────────────────────────────────────────
  const vKospiMultiplier = regime.vKospi > VKOSPI.CALM ? 1.5 : 1.0;
  const growthMultiplier = regime.vKospi < 15 ? 1.5 : 1.0;

  // Self-Evolution Layer: 과거 성과 기반 가중치
  // 실전 데이터 기반 동적 가중치 (10건 이상 누적 시 자동 업데이트)
  // 기본값 + localStorage 실전 데이터로 오버라이드
  const EVOLUTION_WEIGHTS: Record<ConditionId, number> = {
    1: 1.1,  // 주도주 사이클 — 안정적 성과 (기본값)
    10: 0.9, // 기술적 정배열 — 최근 후행 (기본값)
    25: 1.2, // VCP — 현 레짐에서 신뢰도 높음 (기본값)
    ...getEvolutionWeightsFromPerformance(),
  };

  const calculateScore = (ids: ConditionId[]) => {
    return ids.reduce((acc, id) => {
      let weight = ALL_CONDITIONS[id].baseWeight * (regime.weightMultipliers[id] || 1.0);

      // Evolution 가중치
      weight *= (EVOLUTION_WEIGHTS[id] || 1.0);

      // 1순위: 눌림목 거래량 감소 시 가중치 부여 (거래량11, VCP25)
      if (isPullbackVolumeLow && (id === 11 || id === 25)) weight *= 1.3;

      // vKospi 기반 가중치
      if (id === 7 || id === 23) weight *= vKospiMultiplier;
      if (id === 2 || id === 24) weight *= growthMultiplier;

      // 금리 사이클 역가중치 (Rate Cycle Inverter)
      if (rateCycle === 'TIGHTENING' && id === 23) weight *= 2.0; // ICR 가중치 2배 강화
      if (rateCycle === 'EASING' && (id === 3 || id === 14 || id === 15)) {
        weight *= rateCycleAdj.gate2GrowthWeightBoost; // 성장성 20% 상향
      }

      return acc + ((stockData[id] ?? 0) * weight);
    }, 0);
  };

  const gate1Score = calculateScore(GATE1_IDS);

  if (!gate1Passed) {
    return earlyExit({ gate1Score, recommendation: '관망', emergencyStop });
  }

  // ── Advanced Context 추출 ────────────────────────────────────────────────
  const { smartMoney, exportMomentum, geoRisk, creditSpread, economicRegime } = advancedContext ?? {};
  const GEO_SECTORS = ['방산', '조선', '원자력', '방위산업'];
  const isGeoSector = GEO_SECTORS.some(s => sectorRotation.name.includes(s));

  // ── 아이디어 9: 크레딧 스프레드 조기 경보 ──────────────────────────────────
  // 신용 위기 경보(AA- ≥ 150bp) → Kelly 50% 축소 (아래 positionSize *= 0.5 에서 적용)
  const creditCrisis = creditSpread?.isCrisisAlert === true;
  // 유동성 확장(스프레드 축소 추세) → Gate 2 완화 트리거로 합산
  const creditLiquidityRelax = creditSpread?.isLiquidityExpanding === true;

  // ── 아이디어 11: 역발상 카운터사이클 신호 산출 ──────────────────────────────
  // 확장 레짐(CRISIS/UNCERTAIN 등)도 역발상 판단에 반영
  const effectiveRegime = extRegime !== 'UNCERTAIN' && extRegime !== 'RANGE_BOUND'
    ? extRegime : economicRegime;
  const contrarianSignals = computeContrarianSignals(
    effectiveRegime,
    fxRegime,
    macroEnv?.vix ?? 20,
    macroEnv?.exportGrowth3mAvg ?? 0,
    sectorRotation.name,
  );
  const contrarianGate3Bonus = contrarianSignals
    .filter(s => s.active)
    .reduce((sum, s) => sum + s.bonus, 0);

  // ── Gate 2: 성장 검증 ────────────────────────────────────────────────────
  // 확장 레짐 기반 기본 임계값 (정상: 9, 방어: 10, 위기: 12 등)
  const gate2BaseThreshold = extRegimeAction.gateAdjustment.gate2Required;
  // Smart Money EWY+MTUM 동시 유입 OR 반도체 수출 3개월 연속 성장 → -1 완화
  const semiconductorRelax = exportMomentum?.semiconductorGate2Relax === true
    && sectorRotation.name.includes('반도체');
  // 레이어 I: BDI 3개월 +20% 이상 → 조선섹터 Gate 2 완화 -1
  const supplyChain = advancedContext?.supplyChain;
  const SHIPBUILDING_SECTORS = ['조선', '해운', '벌크'];
  const bdiRelax = supplyChain && supplyChain.bdi.mom3Change >= 20
    && SHIPBUILDING_SECTORS.some(s => (stockSector ?? sectorRotation.name).includes(s));
  // 레이어 I: SEMI Book-to-Bill ≥ 1.1 → 반도체섹터 Gate 2 추가 완화
  const semiRelax = supplyChain && supplyChain.semiBillings.bookToBill >= 1.1
    && (stockSector ?? sectorRotation.name).includes('반도체');
  const gate2RelaxBonus = (smartMoney?.isEwyMtumBothInflow || semiconductorRelax || creditLiquidityRelax || bdiRelax || semiRelax) ? 1 : 0;
  const gate2Threshold = Math.max(6, gate2BaseThreshold - gate2RelaxBonus);
  const gate2PassCount = GATE2_IDS.filter(id => (stockData[id] ?? 0) >= 5).length;
  const gate2Passed = gate2PassCount >= gate2Threshold;
  const gate2Score = calculateScore(GATE2_IDS);

  // ── Gate 3: 정밀 타이밍 ──────────────────────────────────────────────────
  // 확장 레짐 기반 기본 임계값
  const gate3BaseThreshold = extRegimeAction.gateAdjustment.gate3Required;
  // 지정학 리스크 GOS ≥ 7 AND 지정학 수혜 섹터 → -1 완화
  const gate3RelaxBonus = (geoRisk && geoRisk.score >= 7 && isGeoSector) ? 1 : 0;
  const gate3Threshold = Math.max(4, gate3BaseThreshold - gate3RelaxBonus);
  const gate3PassCount = GATE3_IDS.filter(id => (stockData[id] ?? 0) >= 5).length;
  const gate3Passed = gate3PassCount >= gate3Threshold;
  const gate3ScoreRaw = calculateScore(GATE3_IDS);

  // ── 상충 감지기 (Contradiction Detector) ──────────────────────────────────
  const contradictionDetection = detectContradictions(stockData);
  // 상충 쌍 감지 시 Gate 3 점수 -20% 패널티 적용
  const gate3Score = gate3ScoreRaw * contradictionDetection.gate3PenaltyMultiplier;

  // FX 조정 팩터 반영: 수출주/내수주 비대칭 환율 영향 내재화
  let finalScore = gate2Score + gate3Score + fxAdjustmentFactor;

  // 수출 모멘텀 Hot Sector +5% 보너스
  if (exportMomentum?.hotSectors.includes(sectorRotation.name)) {
    finalScore *= 1.05;
  }

  // 역발상 카운터사이클 Gate 3 보너스 (침체기 방산, 달러강세 헬스케어, VIX 공포극점)
  finalScore += contrarianGate3Bonus;

  // ── 하락 추세 / 고변동성 패널티 (점수를 날카롭게 차별화) ─────────────────────
  // 하락 추세: 기술적 정배열(10) + 모멘텀(2) 모두 낮은데 레짐이 하락
  const isDowntrend = regime.type === '하락' &&
    (stockData[10] ?? 0) < 4 && (stockData[2] ?? 0) < 4;
  if (isDowntrend) {
    finalScore -= 20;
  }

  // 고변동성: vKospi 기반 — macroEnv?.vkospi > VKOSPI.ELEVATED(25)
  const isHighVolatility = (macroEnv?.vkospi ?? 0) > VKOSPI.ELEVATED;
  if (isHighVolatility) {
    finalScore -= 15;
  }

  // finalScore 음수 방지 (최소 0)
  finalScore = Math.max(0, finalScore);

  // 2순위: 대장주 신고가 경신 시 트리거 강화
  const lastTrigger = (stockData[25] >= 8 && stockData[27] >= 8) ||
    (sectorRotation.sectorLeaderNewHigh && stockData[2] >= 8);

  // ── Position Sizing ──────────────────────────────────────────────────────
  const sellScore = sellSignals.length;
  let { positionSize, recommendation } = computeBasePositionSize({
    finalScore,
    stockData,
    regimeType: regime.type,
    euphoriaSignals,
    sellSignalCount: sellScore,
    rrr,
    isLeadingSector: sectorRotation.isLeading,
    kellyReduction: gate0Result?.kellyReduction ?? 0,
    geoRiskScore: geoRisk?.score,
    isGeoSector,
    creditCrisis,
    cashRatio: extRegimeAction.cashRatio,
    isPairTradeMode: extRegimeAction.mode === 'PAIR_TRADE',
  });

  // 3-Tranche Scaling Plan
  const tranchePlan: TranchePlan | undefined = positionSize > 0 ? {
    tranche1: { size: positionSize * 0.3, trigger: '현재가 진입', status: 'PENDING' },
    tranche2: { size: positionSize * 0.3, trigger: '1차 지지선 확인', status: 'PENDING' },
    tranche3: { size: positionSize * 0.4, trigger: '추세 강화 확인', status: 'PENDING' },
  } : undefined;

  // ── 판단엔진 고도화 ────────────────────────────────────────────────────────

  // 합치 스코어 (4축)
  const confluence = computeConfluence(stockData, gate0Result, advancedContext);

  // 사이클 위치 — newsPhase를 advancedContext에서 가져옴 (없으면 GROWING 기본값)
  const cycleAnalysis = classifyCyclePosition(
    sectorRotation.rank ?? 50,
    advancedContext?.newsPhase ?? 'GROWING',
  );

  // 촉매 등급 — 촉매 설명 텍스트로 A/B/C 분류
  const catalystAnalysis = gradeCatalyst(stockData[27] ?? 0, advancedContext?.catalystDescription);

  // 모멘텀 가속도 — 주봉 RSI 3주 추이 + 기관 순매수 금액 추이
  const momentumAcc = analyzeMomentumAcceleration(
    advancedContext?.weeklyRsiValues ?? [],
    advancedContext?.institutionalAmounts ?? [],
    advancedContext?.volumeTrend ?? 'STABLE',
  );

  // TMA (추세 모멘텀 가속도) — 수익률 2차 미분으로 감속 선행 감지
  const tmaResult = advancedContext?.dailyCloses
    ? evaluateTMA(advancedContext.dailyCloses)
    : undefined;

  // SRR (섹터 내 상대강도 역전 감지) — Gate 3 모멘텀 조건 실시간 추적
  const srrResult =
    advancedContext?.stockReturn20d !== undefined &&
    advancedContext?.sectorReturn20d !== undefined
      ? evaluateSRR(
          advancedContext.weeklyRsRatios ?? [],
          advancedContext.entryRsRank ?? cycleAnalysis.sectorRsRank,
          advancedContext.currentRsRank ?? cycleAnalysis.sectorRsRank,
          advancedContext.stockReturn20d,
          advancedContext.sectorReturn20d,
        )
      : undefined;

  // 강화된 적의 체크리스트 — 7항목 역검증 플래그
  const enemyEnhanced = evaluateEnemyChecklist(enemyChecklist, advancedContext?.enemyFlags ?? {});

  // 데이터 신뢰도
  const dataReliability = computeDataReliability(stockData);

  // ── 상승 초기 선취매 조건 평가 (Step 3) ─────────────────────────────────────
  const earlyBullEntryResult = gate1Passed
    ? evaluateEarlyBullEntry(
        stockData,
        advancedContext?.foreignPassiveActiveDays ?? 0,
        advancedContext?.rsPercentileInSector ?? 100,
        advancedContext?.outperformsKospi1M ?? false,
      )
    : undefined;

  // 최종 신호 판정 (4단계 개편 + 상승 초기 선취매 + 퍼센타일 하이브리드)
  const isBullRegime = extRegimeAction.gateAdjustment.gate2Required < 9;
  const normalizedFinalScore = normalizeScore(finalScore);
  // volumeTrend: advancedContext.volumeTrend (INCREASING/STABLE/DECREASING)
  const volumeIncreasing = advancedContext?.volumeTrend === 'INCREASING';
  // noDrawdown: 기술적 정배열(10) 점수 ≥ 5 이면 drawdown 없음으로 간주
  const noDrawdown = (stockData[10] ?? 0) >= 5;
  const signalVerdict = computeSignalVerdict(
    gate1Passed, gate2Passed, gate3Passed,
    recommendation, rrr,
    confluence, multiTimeframe,
    catalystAnalysis, enemyEnhanced, cycleAnalysis, momentumAcc, dataReliability,
    earlyBullEntryResult?.triggered ?? false,
    isBullRegime,
    undefined, // percentile: 배치 맥락에서 제공 시 외부에서 주입, 개별 평가 시 undefined
    normalizedFinalScore,
    { volumeIncreasing, noDrawdown, regime: regime.type },
  );

  // 신호 등급에 따른 포지션 사이즈 최종 조정
  // 주의: CONFIRMED_STRONG_BUY라도 Gate 0 매수중단/비상정지/크레딧위기를 무시하면 안됨
  const gate0Blocked = gate0Result?.buyingHalted || emergencyStop || creditCrisis;
  if (signalVerdict.grade === 'CONFIRMED_STRONG_BUY' && !gate0Blocked && positionSize > 0) {
    // 상충 감지 시 CONFIRMED_STRONG_BUY 등급 금지 — 포지션 축소
    if (contradictionDetection.strongBuyBlocked) {
      positionSize = Math.min(positionSize, 10); // 최대 10%로 제한
      recommendation = '절반 포지션';
    } else {
      positionSize = Math.max(positionSize, 20);
    }
  } else if (signalVerdict.grade === 'BUY' && signalVerdict.isEarlyBullEntry && !gate3Passed) {
    // 상승 초기 선취매: Gate 3 미달이어도 BUY 50% 포지션 허용
    positionSize = Math.max(positionSize, 10);
    recommendation = '절반 포지션';
  } else if (signalVerdict.grade === 'WATCH' || signalVerdict.grade === 'HOLD') {
    positionSize = 0;
    if (recommendation === '풀 포지션' || recommendation === '절반 포지션') {
      recommendation = '관망';
    }
  }

  // 사이클 LATE → 신규 진입 금지
  if (cycleAnalysis.position === 'LATE' && positionSize > 0) {
    positionSize = 0;
    recommendation = '관망';
  }

  // 데이터 신뢰도 강등
  if (dataReliability.degraded && recommendation === '풀 포지션') {
    recommendation = '절반 포지션';
  }

  positionSize = Math.max(0, positionSize);

  // ── Timing Sync Score ────────────────────────────────────────────────────
  const timingSync = evaluateTimingSync(
    stockData as Record<ConditionId, number>,
    conditionPassTimestamps ?? {},
  );

  return {
    gate0Result,
    smartMoneyData: smartMoney,
    exportMomentumData: exportMomentum,
    geopoliticalRisk: geoRisk,
    creditSpreadData: creditSpread,
    contrarianSignals,
    fxAdjustmentFactor,
    gate1Passed,
    gate2Passed,
    gate3Passed,
    gate1Score,
    gate2Score,
    gate3Score,
    finalScore,
    recommendation,
    positionSize,
    rrr,
    lastTrigger,
    euphoriaLevel: euphoriaSignals,
    emergencyStop,
    profile,
    sellScore,
    sellSignals,
    multiTimeframe,
    tranchePlan,
    enemyChecklist,
    seasonality,
    attribution,
    confluence,
    cycleAnalysis,
    catalystAnalysis,
    momentumAcceleration: momentumAcc,
    tma: tmaResult,
    srr: srrResult,
    mapc: gate0Result && advancedContext?.macroEnv
      ? evaluateMAPCResult(gate0Result, advancedContext.macroEnv, positionSize)
      : undefined,
    roeTransition: roeTransitionResult,
    enemyChecklistEnhanced: enemyEnhanced,
    dataReliability,
    signalVerdict,
    earlyBullEntry: earlyBullEntryResult,
    conditionScores: stockData as Record<ConditionId, number>,
    conditionSources: CONDITION_SOURCE_MAP,
    contradictionDetection,
    timingSync,
  };
}
