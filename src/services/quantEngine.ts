import {
  ConditionId,
  EvaluationResult,
  MarketRegime,
  StockProfile,
  StockProfileType,
  SectorRotation,
  SellCondition,
  MultiTimeframe,
  TranchePlan,
  EnemyChecklist,
  SeasonalityData,
  AttributionAnalysis,
  MacroEnvironment,
  Gate0Result,
  RateCycle,
  FXRegime,
  SmartMoneyData,
  ExportMomentumData,
  GeopoliticalRiskData,
  CreditSpreadData,
  ContrarianSignal,
  EconomicRegime,
  ExtendedRegimeData,
  FinancialStressIndex,
  SupplyChainIntelligence,
  ConfluenceScore,
  CycleAnalysis,
  CyclePosition,
  CatalystAnalysis,
  CatalystGrade,
  MomentumAcceleration,
  EnemyChecklistEnhanced,
  DataReliability,
  SignalVerdict,
  SignalGrade,
  BearRegimeResult,
  BearRegimeCondition,
  BearSeasonalityResult,
  VkospiTriggerResult,
  VkospiTriggerLevel,
  InverseGate1Result,
  InverseGate1Condition,
  InverseGate1SignalType,
  MarketNeutralResult,
  MarketNeutralLeg,
  BetaNeutralScenario,
  BearScreenerResult,
  BearScreenerCondition,
  BearKellyResult,
  SectorOverheatInput,
  SectorOverheatCondition,
  OverheatedSectorMatch,
  SectorOverheatResult,
  BearModeSimulatorInput,
  BearModeSimulatorResult,
  BearModeSimulatorScenarioResult,
} from '../types/quant';
import { z } from 'zod';

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

export const ALL_CONDITIONS: Record<ConditionId, { name: string; baseWeight: number; description: string }> = {
  1: { name: '주도주 사이클', baseWeight: 3.0, description: '현재 시장의 주도 섹터 및 사이클 부합 여부' },
  2: { name: '모멘텀', baseWeight: 2.5, description: '업종 내 상대적 강도 및 모멘텀 상위권' },
  3: { name: 'ROE 유형 3', baseWeight: 2.0, description: '자산회전율과 마진이 동반 상승하는 성장성' },
  4: { name: '수급 질', baseWeight: 2.0, description: '기관/외인의 질적인 수급 유입 및 매집 흔적' },
  5: { name: '시장 환경 Risk-On', baseWeight: 2.0, description: '매크로 및 시장 지표가 투자 적기임을 시사' },
  6: { name: '일목균형표', baseWeight: 1.5, description: '구름대 상단 안착 및 후행스팬 역전 여부' },
  7: { name: '기계적 손절 설정', baseWeight: 2.0, description: '명확한 손절 라인 및 리스크 관리 계획 수립' },
  8: { name: '경제적 해자', baseWeight: 1.5, description: '독점적 지위 및 높은 진입 장벽 보유' },
  9: { name: '신규 주도주 여부', baseWeight: 2.0, description: '새로운 사이클의 주인공으로 부상 중인지 확인' },
  10: { name: '기술적 정배열', baseWeight: 1.5, description: '이동평균선이 정배열 상태로 우상향 중' },
  11: { name: '거래량', baseWeight: 1.5, description: '돌파 시 거래량 동반 및 매집 거래량 확인' },
  12: { name: '기관/외인 수급', baseWeight: 1.5, description: '메이저 수급의 지속적인 유입 확인' },
  13: { name: '목표가 여력', baseWeight: 1.5, description: '상승 여력이 충분한 목표가 설정 가능' },
  14: { name: '실적 서프라이즈', baseWeight: 1.5, description: '컨센서스를 상회하는 실적 발표 및 전망' },
  15: { name: '실체적 펀더멘털', baseWeight: 1.5, description: '재무제표상 실질적인 이익 성장 확인' },
  16: { name: '정책/매크로', baseWeight: 1.5, description: '정부 정책 및 거시 경제 환경의 수혜' },
  17: { name: '심리적 객관성', baseWeight: 1.0, description: '공포와 탐욕에 휘둘리지 않는 객관적 분석' },
  18: { name: '터틀 돌파', baseWeight: 1.0, description: '20일/55일 고가 돌파 시스템 적용' },
  19: { name: '피보나치', baseWeight: 1.0, description: '주요 되돌림 및 확장 레벨에서의 지지/저항' },
  20: { name: '엘리엇 파동', baseWeight: 1.0, description: '현재 파동의 위치 및 진행 단계 분석' },
  21: { name: '이익의 질 OCF', baseWeight: 1.5, description: '영업활동현금흐름이 당기순이익을 상회' },
  22: { name: '마진 가속도', baseWeight: 1.0, description: '영업이익률 개선 속도가 매출 성장보다 빠름' },
  23: { name: '재무 방어력 ICR', baseWeight: 1.0, description: '이자보상배율이 높아 금리 인상에 강함' },
  24: { name: '상대강도 RS', baseWeight: 1.5, description: '지수 대비 주가 상승률이 월등히 높음' },
  25: { name: 'VCP', baseWeight: 1.0, description: '변동성 축소 패턴 및 에너지 응축 확인' },
  26: { name: '다이버전스', baseWeight: 1.0, description: '주가와 지표 간의 역전 현상 발생 여부' },
  27: { name: '촉매제', baseWeight: 1.0, description: '주가를 끌어올릴 명확한 재료 및 일정' },
};

export const SELL_CHECKLIST: Record<number, SellCondition> = {
  1: { id: 1, name: '주도주 이탈', description: '섹터 내 대장주 지위 상실', trigger: '상대강도(RS) 급락' },
  2: { id: 2, name: 'ROE 훼손', description: '이익률 하락 및 자산 효율성 저하', trigger: '영업이익률 2분기 연속 하락' },
  3: { id: 3, name: '데드크로스', description: '주요 이평선 역배열 전환', trigger: '50일선 200일선 하향 돌파' },
  4: { id: 4, name: '수급 이탈', description: '기관/외인 대량 매도', trigger: '5거래일 연속 순매도' },
  5: { id: 5, name: '목표가 도달', description: '산정된 적정 가치 도달', trigger: '목표가 95% 이상 도달' },
  6: { id: 6, name: '손절가 터치', description: '기계적 리스크 관리', trigger: '매수가 대비 -8%~-15% 도달' },
  7: { id: 7, name: '유포리아 발생', description: '과도한 낙관론 및 과열', trigger: 'RSI 80 이상 및 거래량 폭증' },
  8: { id: 8, name: '촉매 소멸', description: '기대했던 재료 노출 및 소멸', trigger: '뉴스 발표 후 음봉 발생' },
  9: { id: 9, name: '추세 붕괴', description: '상승 추세선 하향 이탈', trigger: '추세선 이탈 후 리테스트 실패' },
  10: { id: 10, name: '거래량 실린 음봉', description: '고점에서 대량 거래 동반 하락', trigger: '평균 거래량 3배 이상 음봉' },
};

const GATE1_IDS: ConditionId[] = [1, 3, 5, 7, 9];
const GATE2_IDS: ConditionId[] = [4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24];
const GATE3_IDS: ConditionId[] = [2, 17, 18, 19, 20, 22, 23, 25, 26, 27];

// ─── Gate 0: 거시 환경 생존 게이트 ──────────────────────────────────────────

/** MHS 세부 점수 계산 (4개 축, 각 0-25) */
function computeMacroScoreDetails(env: MacroEnvironment) {
  // 금리 축 (0-25): 금리 인하 유리, 인상 불리
  let interestRateScore = 20;
  if (env.bokRateDirection === 'HIKING') interestRateScore -= 10;
  else if (env.bokRateDirection === 'CUTTING') interestRateScore += 5;
  if (env.us10yYield > 4.5) interestRateScore -= 5;
  if (env.krUsSpread < -1.0) interestRateScore -= 5; // 한미 금리 역전 심화
  interestRateScore = Math.max(0, Math.min(25, interestRateScore));

  // 유동성 축 (0-25): M2 > 명목GDP → Risk-On
  let liquidityScore = 15;
  if (env.m2GrowthYoY > env.nominalGdpGrowth) liquidityScore += 10;
  else liquidityScore -= 5;
  if (env.bankLendingGrowth > 5) liquidityScore += 3;
  else if (env.bankLendingGrowth < 0) liquidityScore -= 5;
  liquidityScore = Math.max(0, Math.min(25, liquidityScore));

  // 경기 축 (0-25): 수출 + OECD CLI
  let economicScore = 15;
  if (env.oeciCliKorea > 101) economicScore += 5;
  else if (env.oeciCliKorea < 99) economicScore -= 5;
  if (env.exportGrowth3mAvg > 5) economicScore += 5;
  else if (env.exportGrowth3mAvg < -5) economicScore -= 10;
  economicScore = Math.max(0, Math.min(25, economicScore));

  // 리스크 축 (0-25): VKOSPI + VIX + 삼성IRI
  let riskScore = 25;
  if (env.vkospi > 25) riskScore -= 12;
  else if (env.vkospi > 20) riskScore -= 6;
  if (env.vix > 30) riskScore -= 10;
  else if (env.vix > 20) riskScore -= 5;
  if (env.samsungIri < 0.7) riskScore -= 5; // 기관 매도 압력
  riskScore = Math.max(0, Math.min(25, riskScore));

  return { interestRateScore, liquidityScore, economicScore, riskScore };
}

/** Gate 0 전체 평가 */
export function evaluateGate0(env: MacroEnvironment): Gate0Result {
  const details = computeMacroScoreDetails(env);
  const macroHealthScore = details.interestRateScore + details.liquidityScore
    + details.economicScore + details.riskScore;

  const mhsLevel: Gate0Result['mhsLevel'] =
    macroHealthScore >= 70 ? 'HIGH' : macroHealthScore >= 40 ? 'MEDIUM' : 'LOW';

  const buyingHalted = macroHealthScore < 40;
  // MAPC: 조정 켈리 = 기본 켈리 × (MHS / 100); MHS < 40 은 buyingHalted 로 차단
  const kellyReduction = macroHealthScore < 40 ? 1.0 : 1 - (macroHealthScore / 100);

  const rateCycle: RateCycle =
    env.bokRateDirection === 'HIKING' ? 'TIGHTENING' :
    env.bokRateDirection === 'CUTTING' ? 'EASING' : 'PAUSE';

  const fxRegime: FXRegime =
    env.usdKrw >= 1350 ? 'DOLLAR_STRONG' :
    env.usdKrw <= 1280 ? 'DOLLAR_WEAK' : 'NEUTRAL';

  return {
    passed: !buyingHalted,
    macroHealthScore,
    mhsLevel,
    kellyReduction,
    buyingHalted,
    rateCycle,
    fxRegime,
    details,
  };
}

// ─── 환율 반응 함수 (FX Impact Module) ──────────────────────────────────────

/**
 * 종목의 수출 비중(0-100)과 FX 레짐에 따라 ±3점 조정 팩터를 반환.
 * exportRatio=100: 순수 수출주 / exportRatio=0: 순수 내수주
 */
export function getFXAdjustmentFactor(fxRegime: FXRegime, exportRatio: number): number {
  if (fxRegime === 'NEUTRAL') return 0;
  // -1~+1 정규화: (수출비중 - 내수비중) / 100
  const bias = (exportRatio - (100 - exportRatio)) / 100; // -1 to +1
  const direction = fxRegime === 'DOLLAR_STRONG' ? 1 : -1;
  return parseFloat((bias * direction * 3).toFixed(2)); // -3 ~ +3
}

// ─── 금리 사이클 역가중치 시스템 (Rate Cycle Inverter) ───────────────────────

/** 금리 사이클에 따른 Gate 조건 파라미터 반환 */
export function getRateCycleAdjustment(rateCycle: RateCycle): {
  gate1IcrMinScore: number;      // 재무방어력 ICR(조건23) 최소 통과 점수
  gate2GrowthWeightBoost: number; // Gate2 성장성 조건 가중치 부스트 배율
} {
  switch (rateCycle) {
    case 'TIGHTENING':
      return {
        gate1IcrMinScore: 7,       // ICR 조건 강화: 5 → 7
        gate2GrowthWeightBoost: 1.0,
      };
    case 'EASING':
      return {
        gate1IcrMinScore: 5,       // 기본값 유지
        gate2GrowthWeightBoost: 1.2, // 성장성 조건 20% 상향
      };
    case 'PAUSE':
    default:
      return {
        gate1IcrMinScore: 5,
        gate2GrowthWeightBoost: 1.0,
      };
  }
}

export function getStockProfile(type: StockProfileType): StockProfile {
  switch (type) {
    case 'A': return { type: 'A', monitoringCycle: 'WEEKLY', stopLoss: -15, executionDelay: 3 };
    case 'B': return { type: 'B', monitoringCycle: 'DAILY', stopLoss: -12, executionDelay: 1 };
    case 'C': return { type: 'C', monitoringCycle: 'REALTIME', stopLoss: -8, executionDelay: 0 };
    case 'D': return { type: 'D', monitoringCycle: 'REALTIME', stopLoss: -5, executionDelay: 0 };
  }
}

// ─── 아이디어 11: 역발상 카운터사이클 알고리즘 ──────────────────────────────

/**
 * 거시 악재가 오히려 특정 섹터의 매수 신호가 되는 역발상 조건 3가지를 판별.
 * 순수 계산 함수 — AI 호출 없음.
 */
export function computeContrarianSignals(
  economicRegime: EconomicRegime | undefined,
  fxRegime: 'DOLLAR_STRONG' | 'DOLLAR_WEAK' | 'NEUTRAL',
  vix: number,
  exportGrowth3mAvg: number,
  sectorName: string,
): ContrarianSignal[] {
  const GEO_DEFENSE = ['방산', '방위산업', '항공우주'];
  const HEALTHCARE_DOMESTIC = ['헬스케어', '바이오', '의료기기', '제약'];

  const isDefense = GEO_DEFENSE.some(s => sectorName.includes(s));
  const isHealthcare = HEALTHCARE_DOMESTIC.some(s => sectorName.includes(s));

  // 신호 1: 경기 침체 → 방산 매수 조건 강화 (예산 확대 기대)
  const recessionDefense: ContrarianSignal = {
    id: 'RECESSION_DEFENSE',
    name: '침체기 방산 역발상',
    active: economicRegime === 'RECESSION' && isDefense,
    bonus: 5,
    description: '경기 침체 시 정부 방산 예산 확대 기대 → 방산주 Gate 3 +5pt 역발상 가산',
  };

  // 신호 2: 달러 강세 + 수출 둔화 → 내수 헬스케어 Gate 완화
  const dollarHealthcare: ContrarianSignal = {
    id: 'DOLLAR_STRONG_HEALTHCARE',
    name: '달러강세 헬스케어 역발상',
    active: fxRegime === 'DOLLAR_STRONG' && exportGrowth3mAvg < 0 && isHealthcare,
    bonus: 3,
    description: '달러 강세 + 수출 둔화 → 내수 헬스케어 상대적 수혜 → Gate 3 +3pt',
  };

  // 신호 3: VIX 급등 공포 극점 → Gate 3 역발상 매수 가산점
  const vixFearPeak: ContrarianSignal = {
    id: 'VIX_FEAR_PEAK',
    name: 'VIX 공포 극점 역발상',
    active: vix >= 35,
    bonus: 3,
    description: 'VIX ≥ 35 공포 극점 → 통계적 과매도 → Gate 3 +3pt 역발상 가산',
  };

  return [recessionDefense, dollarHealthcare, vixFearPeak];
}

// ─── 불확실성 레짐 감지 및 적응형 Gate 시스템 ─────────────────────────────────

/**
 * Gate 0 결과 + 거시 데이터로부터 확장 레짐(UNCERTAIN/CRISIS/RANGE_BOUND)을 감지.
 * 기존 4단계(RECOVERY/EXPANSION/SLOWDOWN/RECESSION)에 3개 비정상 레짐을 추가하여
 * 시스템이 "판단 불능" 상태를 인식하고 방어 모드로 전환할 수 있게 합니다.
 */
export function classifyExtendedRegime(
  gate0: Gate0Result | undefined,
  macroEnv: MacroEnvironment | undefined,
  baseRegime: EconomicRegime | undefined,
  options?: {
    kospi60dVolatility?: number;      // KOSPI 60일 변동성 (%)
    leadingSectorCount?: number;      // 명확한 주도 섹터 수
    foreignFlowDirection?: 'CONSISTENT_BUY' | 'CONSISTENT_SELL' | 'ALTERNATING';
    kospiSp500Correlation?: number;   // KOSPI-S&P500 상관계수
    financialStress?: FinancialStressIndex;  // 레이어 K: 금융시스템 스트레스
  }
): ExtendedRegimeData['systemAction'] {
  if (!gate0 || !macroEnv) {
    return {
      mode: 'NORMAL',
      cashRatio: 30,
      gateAdjustment: { gate1Threshold: 5, gate2Required: 9, gate3Required: 7 },
      message: '거시 데이터 미수집. 기본 모드 유지.',
    };
  }

  const { macroHealthScore, mhsLevel } = gate0;
  const { vkospi, vix, exportGrowth3mAvg } = macroEnv;
  const kospi60dVol = options?.kospi60dVolatility ?? 0;
  const leadingSectors = options?.leadingSectorCount ?? 3;
  const foreignFlow = options?.foreignFlowDirection ?? 'ALTERNATING';
  const correlation = options?.kospiSp500Correlation ?? 0.7;
  const fsi = options?.financialStress;

  // ── FSI CRISIS → Gate 0 buyingHalted 강제 발동, Kelly 0% ──
  if (fsi && fsi.systemAction === 'CRISIS') {
    return {
      mode: 'FULL_STOP',
      cashRatio: 100,
      gateAdjustment: { gate1Threshold: 10, gate2Required: 12, gate3Required: 10 },
      message: `금융시스템 스트레스 위기 (FSI ${fsi.compositeScore}, TED ${fsi.tedSpread.bps}bp, HY ${fsi.usHySpread.bps}bp, MOVE ${fsi.moveIndex.current}). 전량 현금 전환.`,
    };
  }

  // ── FSI DEFENSIVE → 방어 모드 강화 ──
  if (fsi && fsi.systemAction === 'DEFENSIVE') {
    return {
      mode: 'CASH_HEAVY',
      cashRatio: 80,
      gateAdjustment: { gate1Threshold: 7, gate2Required: 11, gate3Required: 9 },
      message: `금융시스템 스트레스 경고 (FSI ${fsi.compositeScore}). Gate 기준 대폭 강화.`,
    };
  }

  // ── CRISIS 감지: 극단적 공포 + 신용 위기 ──
  if (vkospi > 35 && vix > 30 && macroHealthScore < 30) {
    return {
      mode: 'FULL_STOP',
      cashRatio: 100,
      gateAdjustment: { gate1Threshold: 10, gate2Required: 12, gate3Required: 10 },
      message: `위기 레짐 감지 (VKOSPI ${vkospi}, VIX ${vix}, MHS ${macroHealthScore}). 전량 현금 전환. Gate 평가 사실상 중단.`,
    };
  }

  // ── RANGE_BOUND 감지: 낮은 변동성 + 주도주 부재 + 외국인 방향성 없음 ──
  if (kospi60dVol > 0 && kospi60dVol < 5 && leadingSectors === 0 && foreignFlow === 'ALTERNATING') {
    return {
      mode: 'PAIR_TRADE',
      cashRatio: 60,
      gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 },
      message: `박스권 횡보 감지 (60일 변동성 ${kospi60dVol}%, 주도섹터 0개). 페어트레이딩/현금 비중 확대 모드. Gate 기준 강화.`,
    };
  }

  // ── UNCERTAIN 감지: 신호 혼조 (4축 모두 40~60 밴드 또는 상관관계 붕괴) ──
  const { interestRateScore, liquidityScore, economicScore, riskScore } = gate0.details;
  const allMidRange = [interestRateScore, liquidityScore, economicScore, riskScore]
    .every(s => s >= 8 && s <= 17); // 각 축 0-25 중 중간 밴드
  const correlationBreakdown = correlation < 0.3;

  if (allMidRange || (correlationBreakdown && mhsLevel === 'MEDIUM')) {
    return {
      mode: 'DEFENSIVE',
      cashRatio: 70,
      gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 },
      message: `불확실성 레짐 감지 (${allMidRange ? '4축 신호 혼조' : '글로벌 상관관계 이탈'}). 현금 70%, Gate 기준 상향.`,
    };
  }

  // ── 회복 초기 감지: 바닥 반등 신호 → Gate 완화 ──
  if (baseRegime === 'RECOVERY' && macroEnv.bokRateDirection === 'CUTTING' && exportGrowth3mAvg > 0) {
    return {
      mode: 'NORMAL',
      cashRatio: 20,
      gateAdjustment: { gate1Threshold: 4, gate2Required: 8, gate3Required: 6 },
      message: `회복 초기 감지 (금리 인하 + 수출 반등). Gate 기준 완화하여 초기 주도주 포착 강화.`,
    };
  }

  // ── 정상 시장: 기존 MHS 기반 ──
  if (mhsLevel === 'HIGH') {
    return {
      mode: 'NORMAL',
      cashRatio: 20,
      gateAdjustment: { gate1Threshold: 5, gate2Required: 9, gate3Required: 7 },
      message: '정상 시장. 기본 Gate 기준 적용.',
    };
  }

  if (mhsLevel === 'MEDIUM') {
    return {
      mode: 'DEFENSIVE',
      cashRatio: 50,
      gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 },
      message: `MHS ${macroHealthScore} (중간). 방어적 운용, Gate 기준 상향.`,
    };
  }

  // mhsLevel === 'LOW'
  return {
    mode: 'CASH_HEAVY',
    cashRatio: 80,
    gateAdjustment: { gate1Threshold: 7, gate2Required: 11, gate3Required: 9 },
    message: `MHS ${macroHealthScore} (낮음). 현금 80%, Gate 기준 대폭 강화.`,
  };
}

/**
 * 확장 레짐 기반으로 기존 EconomicRegime 4단계를 7단계로 재분류.
 * AI가 반환한 baseRegime + Gate0 수치를 결합하여 최종 판정.
 */
export function deriveExtendedRegime(
  baseRegime: EconomicRegime | undefined,
  gate0: Gate0Result | undefined,
  macroEnv: MacroEnvironment | undefined,
  options?: {
    kospi60dVolatility?: number;
    leadingSectorCount?: number;
    foreignFlowDirection?: 'CONSISTENT_BUY' | 'CONSISTENT_SELL' | 'ALTERNATING';
    kospiSp500Correlation?: number;
  }
): EconomicRegime {
  if (!gate0 || !macroEnv) return baseRegime ?? 'EXPANSION';

  const { macroHealthScore } = gate0;
  const { vkospi, vix } = macroEnv;
  const kospi60dVol = options?.kospi60dVolatility ?? 0;
  const leadingSectors = options?.leadingSectorCount ?? 3;
  const foreignFlow = options?.foreignFlowDirection ?? 'ALTERNATING';
  const correlation = options?.kospiSp500Correlation ?? 0.7;

  // CRISIS
  if (vkospi > 35 && vix > 30 && macroHealthScore < 30) return 'CRISIS';

  // RANGE_BOUND
  if (kospi60dVol > 0 && kospi60dVol < 5 && leadingSectors === 0 && foreignFlow === 'ALTERNATING') return 'RANGE_BOUND';

  // UNCERTAIN
  const { interestRateScore, liquidityScore, economicScore, riskScore } = gate0.details;
  const allMidRange = [interestRateScore, liquidityScore, economicScore, riskScore].every(s => s >= 8 && s <= 17);
  if (allMidRange || (correlation < 0.3 && gate0.mhsLevel === 'MEDIUM')) return 'UNCERTAIN';

  return baseRegime ?? 'EXPANSION';
}

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
  },
  stockSector?: string, // 종목 섹터 (조선/반도체 등) — BDI/SEMI Gate 조정용
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
  const gate0Result = macroEnv ? evaluateGate0(macroEnv) : undefined;

  // 금리 사이클 도출
  const rateCycle: RateCycle = macroEnv
    ? (macroEnv.bokRateDirection === 'HIKING' ? 'TIGHTENING'
      : macroEnv.bokRateDirection === 'CUTTING' ? 'EASING' : 'PAUSE')
    : 'PAUSE';
  const rateCycleAdj = getRateCycleAdjustment(rateCycle);

  // FX 조정 팩터 (-3 ~ +3)
  const fxRegime = gate0Result?.fxRegime ?? 'NEUTRAL';
  const fxAdjustmentFactor = getFXAdjustmentFactor(fxRegime, stockExportRatio ?? 50);

  // ── 확장 레짐 감지 (불확실성/위기/박스권) ──────────────────────────────────
  const extRegimeAction = classifyExtendedRegime(
    gate0Result, macroEnv, advancedContext?.economicRegime, extendedRegimeOptions
  );
  const extRegime = deriveExtendedRegime(
    advancedContext?.economicRegime, gate0Result, macroEnv, extendedRegimeOptions
  );

  // CRISIS 레짐 → 전면 매수 중단 (FULL_STOP)
  if (extRegimeAction.mode === 'FULL_STOP') {
    return {
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
      gate1Score: 0,
      gate2Score: 0,
      gate3Score: 0,
      finalScore: 0,
      recommendation: '강력 매도',
      positionSize: 0,
      rrr,
      lastTrigger: false,
      euphoriaLevel: euphoriaSignals,
      emergencyStop: true,
      profile,
      sellScore: sellSignals.length,
      sellSignals,
      multiTimeframe,
      enemyChecklist,
      seasonality,
      attribution,
    };
  }

  // MHS < 40 또는 비상정지 → 전면 매수 중단
  if (gate0Result?.buyingHalted || emergencyStop) {
    return {
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
      gate1Score: 0,
      gate2Score: 0,
      gate3Score: 0,
      finalScore: 0,
      recommendation: '관망',
      positionSize: 0,
      rrr,
      lastTrigger: false,
      euphoriaLevel: euphoriaSignals,
      emergencyStop,
      profile,
      sellScore: sellSignals.length,
      sellSignals,
      multiTimeframe,
      enemyChecklist,
      seasonality,
      attribution,
    };
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
  const vKospiMultiplier = regime.vKospi > 20 ? 1.5 : 1.0;
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
    return {
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
      gate1Score,
      gate2Score: 0,
      gate3Score: 0,
      finalScore: 0,
      recommendation: '관망',
      positionSize: 0,
      rrr,
      lastTrigger: false,
      euphoriaLevel: euphoriaSignals,
      emergencyStop,
      profile,
      sellScore: sellSignals.length,
      sellSignals,
      multiTimeframe,
      enemyChecklist,
      seasonality,
      attribution,
    };
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
  const gate3Score = calculateScore(GATE3_IDS);

  // FX 조정 팩터 반영: 수출주/내수주 비대칭 환율 영향 내재화
  let finalScore = gate2Score + gate3Score + fxAdjustmentFactor;

  // 수출 모멘텀 Hot Sector +5% 보너스
  if (exportMomentum?.hotSectors.includes(sectorRotation.name)) {
    finalScore *= 1.05;
  }

  // 역발상 카운터사이클 Gate 3 보너스 (침체기 방산, 달러강세 헬스케어, VIX 공포극점)
  finalScore += contrarianGate3Bonus;

  // 2순위: 대장주 신고가 경신 시 트리거 강화
  const lastTrigger = (stockData[25] >= 8 && stockData[27] >= 8) ||
    (sectorRotation.sectorLeaderNewHigh && stockData[2] >= 8);

  let recommendation: EvaluationResult['recommendation'] = '관망';
  let positionSize = 0;

  // ── Position Sizing ──────────────────────────────────────────────────────
  const scorePercentage = (finalScore / 270) * 100;
  if (scorePercentage >= 90) positionSize = 20;
  else if (scorePercentage >= 80) positionSize = 15;
  else if (scorePercentage >= 70) positionSize = 10;
  else if (scorePercentage >= 60) positionSize = 5;

  // Conflict Signal Priority
  const fundamentalScore = (stockData[3] ?? 0) + (stockData[15] ?? 0) + (stockData[21] ?? 0);
  const technicalScore = (stockData[2] ?? 0) + (stockData[10] ?? 0) + (stockData[18] ?? 0);

  if (regime.type === '하락' && technicalScore < 15 && fundamentalScore > 20) {
    positionSize *= 0.7;
  } else if (regime.type === '상승초기' && technicalScore > 20 && fundamentalScore < 15) {
    positionSize *= 1.2;
  }

  if (positionSize > 0) {
    recommendation = positionSize >= 15 ? '풀 포지션' : '절반 포지션';
  }

  // Sector Rotation
  if (!sectorRotation.isLeading) positionSize *= 0.5;

  // Euphoria Detector
  if (euphoriaSignals >= 3) {
    recommendation = '매도';
    positionSize *= 0.5;
  }

  // Sell Checklist
  const sellScore = sellSignals.length;
  if (sellScore >= 5) {
    recommendation = '강력 매도';
    positionSize = 0;
  } else if (sellScore >= 3) {
    recommendation = '매도';
    positionSize *= 0.3;
  }

  // RRR Filter
  if (rrr < 2.0) {
    positionSize = 0;
    recommendation = '관망';
  }

  // MAPC: 조정 켈리 = 기본 켈리 × (MHS / 100)
  if (gate0Result && gate0Result.kellyReduction > 0) {
    positionSize *= (1 - gate0Result.kellyReduction);
  }

  // 지정학 리스크 GOS ≤ 3 AND 지정학 섹터 → Kelly 30% 축소
  if (geoRisk && geoRisk.score <= 3 && isGeoSector) {
    positionSize *= 0.7;
  }

  // 신용 위기 경보(AA- ≥ 150bp) → Kelly 전면 50% 추가 하향
  if (creditCrisis) {
    positionSize *= 0.5;
  }

  // 확장 레짐 현금비중 반영: 권장 현금비중이 높을수록 포지션 축소
  if (extRegimeAction.cashRatio > 30) {
    const regimeReduction = 1 - (extRegimeAction.cashRatio - 30) / 100;
    positionSize *= Math.max(0.1, regimeReduction);
  }

  // 박스권(PAIR_TRADE) 모드 시 관망 추천 강제
  if (extRegimeAction.mode === 'PAIR_TRADE' && positionSize > 0) {
    recommendation = '절반 포지션';
    positionSize = Math.min(positionSize, 5);
  }

  positionSize = Math.max(0, positionSize);

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

  // 강화된 적의 체크리스트 — 7항목 역검증 플래그
  const enemyEnhanced = evaluateEnemyChecklist(enemyChecklist, advancedContext?.enemyFlags ?? {});

  // 데이터 신뢰도
  const dataReliability = computeDataReliability(stockData);

  // 최종 신호 판정 (7조건)
  const signalVerdict = computeSignalVerdict(
    gate1Passed, gate2Passed, gate3Passed,
    recommendation, rrr,
    confluence, multiTimeframe,
    catalystAnalysis, enemyEnhanced, cycleAnalysis, momentumAcc, dataReliability,
  );

  // 신호 등급에 따른 포지션 사이즈 최종 조정
  // 주의: CONFIRMED_STRONG_BUY라도 Gate 0 매수중단/비상정지/크레딧위기를 무시하면 안됨
  const gate0Blocked = gate0Result?.buyingHalted || emergencyStop || creditCrisis;
  if (signalVerdict.grade === 'CONFIRMED_STRONG_BUY' && !gate0Blocked && positionSize > 0) {
    positionSize = Math.max(positionSize, 20);
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
    enemyChecklistEnhanced: enemyEnhanced,
    dataReliability,
    signalVerdict,
    conditionScores: stockData as Record<ConditionId, number>,
    conditionSources: CONDITION_SOURCE_MAP,
  };
}

// ─── 실전 성과 기반 동적 EVOLUTION_WEIGHTS ──────────────────────────────────────

const EVOLUTION_WEIGHTS_KEY = 'k-stock-evolution-weights';

/**
 * localStorage에서 실전 데이터 기반 가중치를 읽어옵니다.
 * TradeJournal의 computeConditionPerformance()가 계산한 결과를
 * saveEvolutionWeights()로 저장하면 다음 evaluateStock() 호출 시 반영.
 */
export function getEvolutionWeightsFromPerformance(): Record<number, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(EVOLUTION_WEIGHTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    // string key → number key 변환
    const result: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const numKey = parseInt(k, 10);
      if (!isNaN(numKey) && typeof v === 'number' && v >= 0.5 && v <= 1.5) {
        result[numKey] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 실전 성과 데이터에서 계산된 가중치를 localStorage에 저장합니다.
 * TradeJournal에서 매매 종료 시 호출됩니다.
 */
export function saveEvolutionWeights(weights: Record<number, number>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(EVOLUTION_WEIGHTS_KEY, JSON.stringify(weights));
  } catch (e) {
    console.error('Failed to save evolution weights:', e);
  }
}

// ─── 판단엔진 고도화 함수 ──────────────────────────────────────────────────────

// 실계산 기반 조건 ID (가격/지표 데이터로 직접 계산 가능)
// 2=모멘텀RS, 6=일목균형표, 7=손절가(사용자설정), 10=기술적정배열, 11=거래량, 18=터틀돌파, 19=피보나치, 24=상대강도RS, 25=VCP
const REAL_DATA_CONDITIONS: ConditionId[] = [2, 6, 7, 10, 11, 18, 19, 24, 25];

// AI 추정 기반 조건 ID (재무/섹터/거시 해석 필요 — AI가 점수 부여)
const AI_ESTIMATE_CONDITIONS: ConditionId[] = [1, 3, 4, 5, 8, 9, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 26, 27];

/**
 * 27개 조건별 데이터 출처 분류 맵
 * 'COMPUTED' = 가격/지표 기반 실계산 (KIS실시간 / DART / 차트)
 * 'AI'       = AI 추정값 (Gemini 해석 기반)
 */
export const CONDITION_SOURCE_MAP: Record<ConditionId, 'COMPUTED' | 'AI'> = Object.fromEntries([
  ...REAL_DATA_CONDITIONS.map(id => [id, 'COMPUTED' as const]),
  ...AI_ESTIMATE_CONDITIONS.map(id => [id, 'AI' as const]),
]) as Record<ConditionId, 'COMPUTED' | 'AI'>;

/**
 * 합치(Confluence) 스코어 — 4개 독립 축의 방향 동시 확인
 */
export function computeConfluence(
  stockData: Record<ConditionId, number>,
  gate0: Gate0Result | undefined,
  advancedContext?: {
    smartMoney?: SmartMoneyData;
    exportMomentum?: ExportMomentumData;
    creditSpread?: CreditSpreadData;
    financialStress?: FinancialStressIndex;
  },
): ConfluenceScore {
  // 축1: 기술적 (RSI·MACD·BB·일목·VCP — 조건 2,6,10,18,20,25,26)
  const techIds: ConditionId[] = [2, 6, 10, 18, 20, 25, 26];
  const techScore = techIds.reduce((s, id) => s + (stockData[id] ?? 0), 0) / techIds.length;
  const technical = techScore >= 7 ? 'BULLISH' as const : techScore >= 4 ? 'NEUTRAL' as const : 'BEARISH' as const;

  // 축2: 수급 (기관·외인·수급질 — 조건 4,11,12)
  const supplyIds: ConditionId[] = [4, 11, 12];
  const supplyScore = supplyIds.reduce((s, id) => s + (stockData[id] ?? 0), 0) / supplyIds.length;
  const supply = supplyScore >= 7 ? 'BULLISH' as const : supplyScore >= 4 ? 'NEUTRAL' as const : 'BEARISH' as const;

  // 축3: 펀더멘털 (ROE·OCF·ICR·마진 — 조건 3,15,21,22,23)
  const fundIds: ConditionId[] = [3, 15, 21, 22, 23];
  const fundScore = fundIds.reduce((s, id) => s + (stockData[id] ?? 0), 0) / fundIds.length;
  const fundamental = fundScore >= 7 ? 'BULLISH' as const : fundScore >= 4 ? 'NEUTRAL' as const : 'BEARISH' as const;

  // 축4: 매크로 (Gate0 MHS + FSI + 크레딧)
  let macroScore = 0;
  if (gate0?.mhsLevel === 'HIGH') macroScore += 3;
  else if (gate0?.mhsLevel === 'MEDIUM') macroScore += 1;
  if (advancedContext?.financialStress?.systemAction === 'NORMAL') macroScore += 2;
  else if (advancedContext?.financialStress?.systemAction === 'CAUTION') macroScore += 1;
  if (advancedContext?.creditSpread?.isLiquidityExpanding) macroScore += 2;
  if (advancedContext?.smartMoney?.isEwyMtumBothInflow) macroScore += 1;
  const macro = macroScore >= 6 ? 'BULLISH' as const : macroScore >= 3 ? 'NEUTRAL' as const : 'BEARISH' as const;

  const axes = [technical, supply, fundamental, macro];
  const bullishCount = axes.filter(a => a === 'BULLISH').length;

  return { technical, supply, fundamental, macro, bullishCount, confirmed: bullishCount === 4 };
}

/**
 * 사이클 위치 분류 — EARLY / MID / LATE
 */
export function classifyCyclePosition(
  sectorRsRank: number,        // 상위 % (0=최상, 100=최하)
  newsPhase: 'SILENT' | 'EARLY' | 'GROWING' | 'CROWDED' | 'OVERHYPED',
  weeklyRsi?: number,
): CycleAnalysis {
  let position: CyclePosition = 'MID';
  let kellyMultiplier = 0.7;

  // EARLY: RS 상위 2~20% 진입 초기 + 뉴스 SILENT/EARLY
  if (sectorRsRank <= 20 && sectorRsRank >= 2 && (newsPhase === 'SILENT' || newsPhase === 'EARLY')) {
    position = 'EARLY';
    kellyMultiplier = 1.0;
  }
  // LATE: RS 상위 1% 과열 OR 뉴스 CROWDED/OVERHYPED OR 주봉 RSI 80+
  else if (sectorRsRank < 2 || newsPhase === 'CROWDED' || newsPhase === 'OVERHYPED' || (weeklyRsi && weeklyRsi >= 80)) {
    position = 'LATE';
    kellyMultiplier = 0;
  }

  const sectorRsTrend = sectorRsRank <= 5 ? 'ACCELERATING' as const
    : sectorRsRank <= 20 ? 'STABLE' as const : 'DECELERATING' as const;

  return {
    position,
    sectorRsRank,
    sectorRsTrend,
    newsPhase,
    foreignFlowPhase: 'ACTIVE_ONLY', // 기본값 — 실제 데이터 있을 때 오버라이드
    kellyMultiplier,
  };
}

/**
 * 촉매 품질 등급화 — A(구조적) / B(사이클) / C(단기)
 * AI가 추정한 촉매 점수(0-10)와 설명 텍스트에서 판별
 */
export function gradeCatalyst(
  catalystScore: number,       // 조건27 점수 (0-10)
  catalystDesc?: string,       // AI 설명 텍스트
): CatalystAnalysis {
  const desc = (catalystDesc ?? '').toLowerCase();

  // Grade A: 구조적 변화 키워드
  const gradeAKeywords = ['수주잔고', '법제화', '장기계약', '정부정책', 'nrc승인', '10년', '대규모', '구조적'];
  const isGradeA = catalystScore >= 8 && gradeAKeywords.some(k => desc.includes(k));

  // Grade C: 단기 재료 키워드
  const gradeCKeywords = ['테마', '소문', '단기', '루머', '공시', '일회성'];
  const isGradeC = catalystScore < 5 || gradeCKeywords.some(k => desc.includes(k));

  if (isGradeA) {
    return { grade: 'A', type: '구조적 변화', durability: 'STRUCTURAL', description: catalystDesc ?? '', strongBuyAllowed: true };
  }
  if (isGradeC) {
    return { grade: 'C', type: '단기 재료', durability: 'TEMPORARY', description: catalystDesc ?? '', strongBuyAllowed: false };
  }
  return { grade: 'B', type: '사이클 모멘텀', durability: 'CYCLICAL', description: catalystDesc ?? '', strongBuyAllowed: false };
}

/**
 * 모멘텀 가속도 분석
 */
export function analyzeMomentumAcceleration(
  rsiValues: number[],                   // 최근 3주 RSI [45, 52, 62]
  institutionalAmounts: number[],        // 최근 5일 기관 순매수 금액
  volumeTrend: 'INCREASING' | 'STABLE' | 'DECREASING',
): MomentumAcceleration {
  const rsiAccelerating = rsiValues.length >= 3
    && rsiValues.every((v, i) => i === 0 || v > rsiValues[i - 1]);
  const institutionalAccelerating = institutionalAmounts.length >= 3
    && institutionalAmounts.every((v, i) => i === 0 || v > institutionalAmounts[i - 1]);

  return {
    rsiTrend: rsiValues,
    rsiAccelerating,
    institutionalTrend: institutionalAmounts,
    institutionalAccelerating,
    volumeTrend,
    overallAcceleration: rsiAccelerating && institutionalAccelerating,
  };
}

/**
 * 강화된 적의 체크리스트 — 7항목 역검증
 */
export function evaluateEnemyChecklist(
  base: EnemyChecklist | undefined,
  flags: Partial<{
    lockupExpiringSoon: boolean;
    majorShareholderSelling: boolean;
    creditBalanceSurge: boolean;
    shortInterestSurge: boolean;
    targetPriceDowngrade: boolean;
    fundMaturityDue: boolean;
    clientPerformanceWeak: boolean;
  }>,
): EnemyChecklistEnhanced {
  const f = {
    lockupExpiringSoon: flags.lockupExpiringSoon ?? false,
    majorShareholderSelling: flags.majorShareholderSelling ?? false,
    creditBalanceSurge: flags.creditBalanceSurge ?? false,
    shortInterestSurge: flags.shortInterestSurge ?? false,
    targetPriceDowngrade: flags.targetPriceDowngrade ?? false,
    fundMaturityDue: flags.fundMaturityDue ?? false,
    clientPerformanceWeak: flags.clientPerformanceWeak ?? false,
  };
  const blockedCount = Object.values(f).filter(Boolean).length;

  return {
    bearCase: base?.bearCase ?? '',
    riskFactors: base?.riskFactors ?? [],
    counterArguments: base?.counterArguments ?? [],
    ...f,
    blockedCount,
    strongBuyBlocked: blockedCount >= 2,
  };
}

/**
 * 데이터 신뢰도 추적
 */
export function computeDataReliability(stockData: Record<ConditionId, number>): DataReliability {
  const realCount = REAL_DATA_CONDITIONS.filter(id => (stockData[id] ?? 0) > 0).length;
  const aiCount = AI_ESTIMATE_CONDITIONS.filter(id => (stockData[id] ?? 0) > 0).length;
  const total = realCount + aiCount;
  const reliabilityPct = total > 0 ? Math.round((realCount / total) * 100) : 0;

  return {
    realDataCount: realCount,
    aiEstimateCount: aiCount,
    reliabilityPct,
    degraded: reliabilityPct < 50,
  };
}

/**
 * 최종 신호 판정 — CONFIRMED STRONG BUY 7개 조건 검증
 *
 * ① 기존 6개 조건 (25/27, RS, 기관, RRR, 일목, VKOSPI)
 * ② 합치 4/4축 BULLISH
 * ③ 멀티타임프레임 월봉+주봉 BULLISH
 * ④ 촉매 등급 A
 * ⑤ 역검증 통과 (blockedCount < 2)
 * ⑥ 사이클 EARLY
 * ⑦ 모멘텀 가속 확인
 */
export function computeSignalVerdict(
  gate1Passed: boolean,
  gate2Passed: boolean,
  gate3Passed: boolean,
  recommendation: EvaluationResult['recommendation'],
  rrr: number,
  confluence: ConfluenceScore,
  multiTimeframe: MultiTimeframe | undefined,
  catalystAnalysis: CatalystAnalysis,
  enemyEnhanced: EnemyChecklistEnhanced,
  cycleAnalysis: CycleAnalysis,
  momentumAcc: MomentumAcceleration,
  dataReliability: DataReliability,
): SignalVerdict {
  const passed: string[] = [];
  const failed: string[] = [];

  // ① 기존 Gate 1~3 통과 + 풀 포지션
  const gatesOk = gate1Passed && gate2Passed && gate3Passed && recommendation === '풀 포지션';
  if (gatesOk) passed.push('Gate 1~3 통과 + 풀 포지션');
  else failed.push('Gate 미달 또는 관망/매도');

  // ② 합치 4/4
  if (confluence.confirmed) passed.push(`합치 4/4 (${confluence.bullishCount}/4 BULLISH)`);
  else failed.push(`합치 ${confluence.bullishCount}/4 (미확인)`);

  // ③ 멀티타임프레임
  const mtfOk = multiTimeframe?.monthly === 'BULLISH' && multiTimeframe?.weekly === 'BULLISH';
  if (mtfOk) passed.push('월봉+주봉 BULLISH');
  else failed.push('멀티타임프레임 미달');

  // ④ 촉매 A등급
  if (catalystAnalysis.grade === 'A') passed.push(`촉매 A등급 (${catalystAnalysis.type})`);
  else failed.push(`촉매 ${catalystAnalysis.grade}등급`);

  // ⑤ 역검증 통과
  if (!enemyEnhanced.strongBuyBlocked) passed.push('역검증 통과');
  else failed.push(`역검증 실패 (${enemyEnhanced.blockedCount}개 위험)`);

  // ⑥ 사이클 EARLY
  if (cycleAnalysis.position === 'EARLY') passed.push('사이클 EARLY');
  else failed.push(`사이클 ${cycleAnalysis.position}`);

  // ⑦ 모멘텀 가속
  if (momentumAcc.overallAcceleration) passed.push('모멘텀 가속 확인');
  else failed.push('모멘텀 비가속');

  // 데이터 신뢰도 강등
  if (dataReliability.degraded) failed.push(`데이터 신뢰도 ${dataReliability.reliabilityPct}% (AI 의존 과다)`);

  // 등급 결정
  let grade: SignalGrade;
  let kellyPct: number;
  let positionRule: string;

  if (passed.length === 7 && !dataReliability.degraded) {
    grade = 'CONFIRMED_STRONG_BUY';
    kellyPct = 100;
    positionRule = '풀 포지션, 자동매매 허용';
  } else if (gatesOk && rrr >= 3.0) {
    grade = 'STRONG_BUY';
    kellyPct = 70;
    positionRule = '수동 매매, 교차검증 후 진입';
  } else if (gate1Passed && gate2Passed && rrr >= 2.0) {
    grade = 'BUY';
    kellyPct = 50;
    positionRule = '분할 매수';
  } else if (gate1Passed && gate2Passed) {
    grade = 'WATCH';
    kellyPct = 0;
    positionRule = '관심 종목, 진입 대기';
  } else {
    grade = 'HOLD';
    kellyPct = 0;
    positionRule = '포지션 없음';
  }

  return { grade, kellyPct, positionRule, passedConditions: passed, failedConditions: failed };
}

// ─── 아이디어 1: Gate -1 "Market Regime Detector" — Bull/Bear 자동 판별 게이트 ──

const FOMC_APPROX_MEETINGS: Array<{ month: number; day: number }> = [
  { month: 1, day: 31 },
  { month: 3, day: 20 },
  { month: 5, day: 10 },
  { month: 6, day: 20 },
  { month: 7, day: 31 },
  { month: 9, day: 20 },
  { month: 11, day: 10 },
  { month: 12, day: 20 },
];

function isWithinMonthDayRange(month: number, day: number, startMonth: number, startDay: number, endMonth: number, endDay: number): boolean {
  const current = month * 100 + day;
  const start = startMonth * 100 + startDay;
  const end = endMonth * 100 + endDay;
  if (start <= end) {
    return current >= start && current <= end;
  }
  return current >= start || current <= end;
}

/**
 * 아이디어 11: 계절성 Bear Calendar
 * 통계적으로 약세 빈도가 높은 구간(9~10월, 12월 중순~1월 초, 실적 시즌 직전, FOMC 직전)을
 * 감지하여 Gate -1 임계치를 자동 조정한다.
 */
export function evaluateBearSeasonality(
  macroEnv: MacroEnvironment,
  asOfDate: Date = new Date(),
): BearSeasonalityResult {
  const now = asOfDate.toISOString();
  const month = asOfDate.getUTCMonth() + 1;
  const day = asOfDate.getUTCDate();
  const year = asOfDate.getUTCFullYear();

  const isAutumnWeakness = month === 9 || month === 10;
  const isYearEndClearing = isWithinMonthDayRange(month, day, 12, 15, 1, 10);
  const isPreQ1Earnings = isWithinMonthDayRange(month, day, 3, 25, 4, 20);

  const todayUTC = Date.UTC(year, month - 1, day);
  const isPreFomc = FOMC_APPROX_MEETINGS.some(({ month: meetingMonth, day: meetingDay }) => {
    const meetingUTC = Date.UTC(year, meetingMonth - 1, meetingDay);
    const dayDiff = Math.floor((meetingUTC - todayUTC) / (1000 * 60 * 60 * 24));
    return dayDiff >= 1 && dayDiff <= 7;
  });

  const windows: BearSeasonalityResult['windows'] = [
    {
      id: 'AUTUMN_WEAKNESS',
      name: '9~10월 약세 시즌',
      active: isAutumnWeakness,
      description: '여름 랠리 소진 + 외국인 연말 리밸런싱 선반영 구간',
      period: '9월~10월',
    },
    {
      id: 'YEAR_END_CLEARING',
      name: '연말/연초 청산 압력',
      active: isYearEndClearing,
      description: '12월 윈도우드레싱 이후 포지션 정리 물량 출회 구간',
      period: '12/15~1/10',
    },
    {
      id: 'PRE_Q1_EARNINGS',
      name: '1Q 실적 시즌 직전',
      active: isPreQ1Earnings,
      description: '어닝 쇼크 우려 선반영 매도 가능성이 높은 기간',
      period: '3/25~4/20',
    },
    {
      id: 'PRE_FOMC',
      name: 'FOMC 직전 불확실성',
      active: isPreFomc,
      description: '정책 발표 직전 리스크 오프 성향 강화 구간',
      period: 'FOMC D-7~D-1',
    },
  ];

  const activeWindowIds = windows.filter(window => window.active).map(window => window.id);
  const isBearSeason = activeWindowIds.length > 0;
  const vkospiRisingConfirmed = macroEnv.vkospiRising === true;
  const inverseEntryWeightPct = isBearSeason && vkospiRisingConfirmed ? 20 : 0;
  const gateThresholdAdjustment = isBearSeason ? -1 : 0;

  const actionMessage = !isBearSeason
    ? '계절성 Bear Calendar 비활성 — Gate -1 기본 임계치(5개) 유지.'
    : inverseEntryWeightPct > 0
      ? `약세 계절성 + VKOSPI 동반 상승 확인. 인버스 진입 확률 가중치 +${inverseEntryWeightPct}% 적용, Gate -1 민감도 강화.`
      : '약세 계절성 구간 감지. Gate -1 임계치를 자동 하향 조정하여 민감도를 높입니다.';

  return {
    isBearSeason,
    windows,
    activeWindowIds,
    gateThresholdAdjustment,
    inverseEntryWeightPct,
    vkospiRisingConfirmed,
    actionMessage,
    lastUpdated: now,
  };
}

/**
 * 7개 매크로 조건을 평가하여 시장 레짐을 BULL / TRANSITION / BEAR 3단계로 분류한다.
 * 5개 이상 조건 충족 시 Bear Mode 자동 활성화.
 * MacroEnvironment에 이미 포함된 vkospi, samsungIri, bokRateDirection, usdKrw,
 * mhsLevel 등을 직접 활용하며, 나머지 보조 지표(kospiBelow120ma, foreignFuturesSellDays 등)는
 * MacroEnvironment의 optional 확장 필드에서 읽는다.
 */
export function evaluateBearRegime(
  macroEnv: MacroEnvironment,
  gate0: Gate0Result,
  seasonalityResult?: BearSeasonalityResult,
): BearRegimeResult {
  const now = new Date().toISOString();

  // ── 조건 1: KOSPI 120일 이평선 하회 + 일목 구름 하방 ──
  const cond1: BearRegimeCondition = {
    id: 'KOSPI_BELOW_120MA',
    name: 'KOSPI 120일선 하락 + 일목 구름 하방',
    triggered: !!(macroEnv.kospiBelow120ma && macroEnv.kospiIchimokuBearish),
    description: 'KOSPI가 120일 이동평균선 아래에 위치하고 일목균형표 구름 하방에 있습니다.',
  };

  // ── 조건 2: VKOSPI 25% 이상 + 상승 중 ──
  const cond2: BearRegimeCondition = {
    id: 'VKOSPI_HIGH_RISING',
    name: 'VKOSPI 25% 이상 + 상승 추세',
    triggered: macroEnv.vkospi >= 25 && macroEnv.vkospiRising === true,
    description: `VKOSPI ${macroEnv.vkospi.toFixed(1)} — 시장 변동성 경보 구간 진입.`,
  };

  // ── 조건 3: 삼성 IRI +3.0pt 이상 급등 ──
  const iriDelta = macroEnv.samsungIriDelta ?? 0;
  const cond3: BearRegimeCondition = {
    id: 'SAMSUNG_IRI_SURGE',
    name: '삼성 IRI +3.0pt 이상 급등',
    triggered: iriDelta >= 3.0,
    description: `삼성 IRI 변화 +${iriDelta.toFixed(1)}pt — 기관 위험회피 심화.`,
  };

  // ── 조건 4: 외국인 선물 누적 순매도 10일 이상 ──
  const sellDays = macroEnv.foreignFuturesSellDays ?? 0;
  const cond4: BearRegimeCondition = {
    id: 'FOREIGN_FUTURES_SELL',
    name: '외국인 선물 연속 순매도 10일 이상',
    triggered: sellDays >= 10,
    description: `외국인 선물 연속 순매도 ${sellDays}일째.`,
  };

  // ── 조건 5: MHS GREEN→YELLOW→RED 전환 확인 ──
  const mhsLevel = gate0.mhsLevel;
  const mhsTrend = macroEnv.mhsTrend ?? 'STABLE';
  const cond5: BearRegimeCondition = {
    id: 'MHS_DETERIORATING',
    name: 'MHS GREEN→YELLOW→RED 전환',
    triggered: (mhsLevel === 'LOW') || (mhsLevel === 'MEDIUM' && mhsTrend === 'DETERIORATING'),
    description: `MHS ${gate0.macroHealthScore} (${mhsLevel}) — ${mhsTrend === 'DETERIORATING' ? '악화 추세' : '매수 중단 수준'}.`,
  };

  // ── 조건 6: BOK 금리 인상 사이클 진행 중 ──
  const cond6: BearRegimeCondition = {
    id: 'BOK_RATE_HIKING',
    name: 'BOK 금리 인상 사이클',
    triggered: macroEnv.bokRateDirection === 'HIKING',
    description: '한국은행 기준금리 인상 사이클 — 유동성 긴축 환경.',
  };

  // ── 조건 7: USD/KRW 1,350 이상 급등 국면 ──
  const cond7: BearRegimeCondition = {
    id: 'USDKRW_SURGE',
    name: 'USD/KRW 1,350 이상 급등',
    triggered: macroEnv.usdKrw >= 1350,
    description: `USD/KRW ${macroEnv.usdKrw.toLocaleString()} — 원화 급약세, 외국인 자금 유출 압력.`,
  };

  const allConditions = [cond1, cond2, cond3, cond4, cond5, cond6, cond7];
  const triggeredCount = allConditions.filter(c => c.triggered).length;
  const BASE_BEAR_THRESHOLD = 5;
  const BEAR_THRESHOLD = Math.max(3, BASE_BEAR_THRESHOLD + (seasonalityResult?.gateThresholdAdjustment ?? 0));

  let regime: BearRegimeResult['regime'];
  let actionRecommendation: string;
  let cashRatioRecommended: number;
  let defenseMode: boolean;

  if (triggeredCount >= BEAR_THRESHOLD) {
    regime = 'BEAR';
    actionRecommendation = '🔴 Bear Mode 활성화 — 인버스/방어자산 선택 모드. 신규 롱 포지션 전면 중단. KODEX 200선물인버스2X 및 방어섹터 재편 권고.';
    cashRatioRecommended = 70;
    defenseMode = true;
  } else if (triggeredCount >= 3) {
    regime = 'TRANSITION';
    actionRecommendation = '🟡 Transition Mode — 현금 비중 확대 및 헤지 레이어 활성화. 신규 진입 규모 축소(50%), 기존 포지션 점검.';
    cashRatioRecommended = 40;
    defenseMode = false;
  } else {
    regime = 'BULL';
    actionRecommendation = '🟢 Bull Mode — 27조건 롱 시스템 정상 작동. Gate 1→3 표준 기준 적용.';
    cashRatioRecommended = 20;
    defenseMode = false;
  }

  if (seasonalityResult?.isBearSeason && seasonalityResult.gateThresholdAdjustment < 0) {
    actionRecommendation += ` (계절성 약세 구간 반영: 임계치 ${BASE_BEAR_THRESHOLD}→${BEAR_THRESHOLD})`;
  }

  return {
    regime,
    conditions: allConditions,
    triggeredCount,
    threshold: BEAR_THRESHOLD,
    actionRecommendation,
    cashRatioRecommended,
    defenseMode,
    lastUpdated: now,
  };
}

// ─── 아이디어 2: 인버스 ETF 스코어링 시스템 — Inverse Gate 1 ────────────────

/**
 * 롱 시스템의 거울상(Mirror System) — 27개 조건의 역전(Inversion)으로 구성된
 * Inverse Gate 1의 5개 Bear 필수 조건을 평가한다.
 * 5개 모두 충족 시 → STRONG BEAR 시그널 발동 → KODEX 200선물인버스2X 또는
 * TIGER 인버스 ETF 즉시 진입 권고.
 */
export function evaluateInverseGate1(
  macroEnv: MacroEnvironment,
): InverseGate1Result {
  const now = new Date().toISOString();

  // ── 조건 1: KOSPI 일목 구름 하단 이탈 확인 ──
  const cond1: InverseGate1Condition = {
    id: 'KOSPI_ICHIMOKU_BREAK_DOWN',
    name: '① KOSPI 일목 구름 하단 이탈',
    triggered: macroEnv.kospiIchimokuBearish === true,
    description: 'KOSPI가 일목균형표 구름 하단을 이탈한 상태입니다. 롱 시스템의 "구름 위 안착" 조건의 역전 신호.',
  };

  // ── 조건 2: VKOSPI 20 이상 + 상승 가속 ──
  const cond2: InverseGate1Condition = {
    id: 'VKOSPI_20_ACCELERATING',
    name: '② VKOSPI 20 이상 + 상승 가속',
    triggered: macroEnv.vkospi >= 20 && macroEnv.vkospiRising === true,
    description: `VKOSPI ${macroEnv.vkospi.toFixed(1)} — 변동성 가속 구간 진입. 시장 공포 확산 중.`,
  };

  // ── 조건 3: 외국인 선물 순매도 가속 (3일 연속 증가) ──
  const sellDays = macroEnv.foreignFuturesSellDays ?? 0;
  const cond3: InverseGate1Condition = {
    id: 'FOREIGN_FUTURES_SELL_ACCEL',
    name: '③ 외국인 선물 순매도 가속 (3일 연속)',
    triggered: sellDays >= 3,
    description: `외국인 선물 연속 순매도 ${sellDays}일째 — 외국인 자금 이탈 가속.`,
  };

  // ── 조건 4: 기준금리 인상 or 동결(긴축 유지) 사이클 ──
  const cond4: InverseGate1Condition = {
    id: 'RATE_TIGHTENING_OR_HOLD',
    name: '④ 기준금리 인상 or 동결 (긴축 유지)',
    triggered: macroEnv.bokRateDirection === 'HIKING' || macroEnv.bokRateDirection === 'HOLDING',
    description: `한국은행 기준금리 ${macroEnv.bokRateDirection === 'HIKING' ? '인상' : '동결'} — 긴축 환경 유지. 유동성 수축 압력.`,
  };

  // ── 조건 5: 달러인덱스(DXY) 강세 전환 확인 ──
  const cond5: InverseGate1Condition = {
    id: 'DXY_BULLISH_TURN',
    name: '⑤ 달러인덱스(DXY) 강세 전환',
    triggered: macroEnv.dxyBullish === true,
    description: '달러인덱스 강세 전환 확인 — 신흥국(한국 포함) 자금 이탈 압력 증가.',
  };

  const allConditions = [cond1, cond2, cond3, cond4, cond5];
  const triggeredCount = allConditions.filter(c => c.triggered).length;
  const allTriggered = triggeredCount === 5;

  const INVERSE_ETFS = [
    'KODEX 200선물인버스2X (233740)',
    'TIGER 200선물인버스2X (252670)',
    'KODEX 코스닥150선물인버스 (251340)',
  ];

  let signalType: InverseGate1SignalType;
  let actionMessage: string;

  if (allTriggered) {
    signalType = 'STRONG_BEAR';
    actionMessage = '🔴 STRONG BEAR 시그널 발동 — Inverse Gate 1 5개 조건 전부 충족. KODEX 200선물인버스2X 또는 TIGER 인버스 즉시 진입 권고. 신규 롱 포지션 전면 중단.';
  } else if (triggeredCount >= 3) {
    signalType = 'PARTIAL';
    actionMessage = `🟠 인버스 ETF 대기 시그널 — ${triggeredCount}/5개 조건 충족. 잔여 조건 확인 후 5개 모두 충족 시 STRONG BEAR 발동. 현금 비중 확대 권고.`;
  } else {
    signalType = 'INACTIVE';
    actionMessage = `🟢 인버스 게이트 비활성 — ${triggeredCount}/5개 조건만 충족. 27조건 롱 시스템 정상 운용 가능.`;
  }

  return {
    signalType,
    conditions: allConditions,
    triggeredCount,
    allTriggered,
    etfRecommendations: allTriggered ? INVERSE_ETFS : [],
    actionMessage,
    lastUpdated: now,
  };
}

// ─── 아이디어 4: VKOSPI 공포지수 트리거 시스템 ──────────────────────────────────

/**
 * VKOSPI 수치를 4단계 트리거 레벨로 평가하여 인버스 ETF 전략 및 현금 비중을 반환한다.
 * VKOSPI ≥ 50 (역사적 공포) 시 인버스 포지션 최대화 + V자 반등 준비 종목 리스트 병행 생성.
 */
export function evaluateVkospiTrigger(vkospi: number): VkospiTriggerResult {
  const now = new Date().toISOString();

  const INVERSE_ETFS = [
    'KODEX 200선물인버스2X (233740)',
    'KODEX 코스닥150선물인버스 (251340)',
    'TIGER 200선물인버스2X (252670)',
  ];

  const V_RECOVERY_STOCKS = [
    '삼성전자 (005930) — 반도체 V반등 선도주',
    'SK하이닉스 (000660) — HBM 수요 회복 수혜',
    '현대차 (005380) — 글로벌 수출 정상화',
    'POSCO홀딩스 (005490) — 철강 수요 반등',
    'KB금융 (105560) — 금리 안정화 수혜 금융주',
    'KODEX 200 (069500) — 지수 회복 직접 수혜',
  ];

  let level: VkospiTriggerLevel;
  let cashRatio: number;
  let inversePosition: number;
  let description: string;
  let actionMessage: string;
  let dualPositionActive: boolean;
  let vRecoveryStocks: string[] | undefined;

  if (vkospi >= 50) {
    level = 'HISTORICAL_FEAR';
    cashRatio = 10;
    inversePosition = 80;
    dualPositionActive = true;
    vRecoveryStocks = V_RECOVERY_STOCKS;
    description = `VKOSPI ${vkospi.toFixed(1)} — 역사적 공포 이벤트 (2008 금융위기·2020 코로나 수준).`;
    actionMessage = '🚨 역사적 공포 이벤트 — 인버스 ETF 최대 포지션(80%) 유지. 동시에 V자 반등 준비 리스트 자동 생성. 추가 공포 매도 시 분할 역발상 롱 준비.';
  } else if (vkospi >= 40) {
    level = 'ENTRY_2';
    cashRatio = 20;
    inversePosition = 60;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 고공포 구간. 인버스 ETF 추가 진입 신호.`;
    actionMessage = '🔴 인버스 ETF 추가 진입 — 포지션 60%까지 확대. 손절선: VKOSPI 35 하향 복귀 시 절반 청산.';
  } else if (vkospi >= 30) {
    level = 'ENTRY_1';
    cashRatio = 40;
    inversePosition = 30;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 공포 구간 진입. 인버스 ETF 1차 진입 적기.`;
    actionMessage = '🟠 인버스 ETF 1차 진입 — 포지션 30% 구축. 추가 상승 시(VKOSPI 40+) 2차 진입 대기.';
  } else if (vkospi >= 25) {
    level = 'WARNING';
    cashRatio = 20;
    inversePosition = 0;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 경계 구간. Bear Mode 경계경보 발령.`;
    actionMessage = '🟡 Bear Mode 경계경보 — 현금 비중 20% 확보. 신규 롱 포지션 규모 축소. 인버스 ETF 준비 대기.';
  } else {
    level = 'NORMAL';
    cashRatio = 0;
    inversePosition = 0;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 정상 시장. Risk-On 최적 환경.`;
    actionMessage = '🟢 정상 시장 — VKOSPI 20 이하는 Risk-On 최적기. 27조건 롱 시스템 전면 가동.';
  }

  return {
    level,
    vkospi,
    cashRatio,
    inversePosition,
    dualPositionActive,
    inverseEtfSuggestions: inversePosition > 0 ? INVERSE_ETFS : [],
    vRecoveryStocks,
    description,
    actionMessage,
    lastUpdated: now,
  };
}

// ─── 아이디어 9: Market Neutral 모드 — 롱/인버스 동시 보유로 변동성 수익 추구 ──

/**
 * TRANSITION 레짐에서 Market Neutral 전략을 평가한다.
 * 롱(50%) + 인버스(30%) + 현금(20%) 구조로 베타를 중립화하여
 * 시장 방향과 무관하게 롱 종목의 개별 알파(초과 수익)만 추구한다.
 *
 * 핵심 공식:
 *   포트폴리오 수익 = 롱 비중 × (시장 수익 + 알파) + 인버스 비중 × (−시장 수익 × 2배) + 현금
 *   → 시장 베타가 상쇄되어 알파가 전체 성과를 좌우한다.
 */
export function evaluateMarketNeutral(
  bearRegimeResult: BearRegimeResult,
): MarketNeutralResult {
  const now = new Date().toISOString();
  const regime = bearRegimeResult.regime;
  const isActive = regime === 'TRANSITION';

  const legs: MarketNeutralLeg[] = [
    {
      type: 'LONG',
      weightPct: 50,
      label: '롱 포지션 (실적 주도주)',
      description: '3-Gate 시스템이 선별한 최고 품질 종목. 조선·방산 등 시장 대비 아웃퍼폼 기대 섹터.',
      examples: ['HD현대중공업', 'LIG넥스원', '한화에어로스페이스', 'HD한국조선해양'],
    },
    {
      type: 'INVERSE',
      weightPct: 30,
      label: '인버스 ETF (시장 헤지)',
      description: 'KOSPI 200 지수 하락 시 수익을 내는 인버스 ETF로 시장 베타를 상쇄한다.',
      examples: ['KODEX 200선물인버스 (114800)', 'TIGER 200선물인버스2X (252670)'],
    },
    {
      type: 'CASH',
      weightPct: 20,
      label: '현금 (기회 대기)',
      description: 'TRANSITION 구간이 BEAR로 전환될 경우 즉시 인버스를 추가하거나, BULL 전환 시 롱 비중을 확대한다.',
      examples: ['CMA', '단기채 ETF'],
    },
  ];

  // 베타 중립화 시나리오: 시장 −5%, 롱 알파 +3%, 인버스 2배 레버리지 기준
  // 롱 수익 = 50% × (−5% + 3%) = −1%
  // 인버스 수익 = 30% × (+10%) = +3%
  // 현금 = 20% × 0% = 0%
  // 합계 = +2%
  const marketReturn = -5;
  const longAlpha = 3;
  const inverseReturn = 10; // 인버스 2배 ETF 기준, 시장 −5% → +10%
  const longReturn = (marketReturn + longAlpha) * (50 / 100);
  const invReturn = inverseReturn * (30 / 100);
  const totalReturn = parseFloat((longReturn + invReturn).toFixed(2));

  const betaNeutralScenario: BetaNeutralScenario = {
    marketReturn,
    longAlpha,
    inverseReturn,
    totalReturn,
    description:
      `시장 ${marketReturn}% 하락 시: 롱(50%) ${longReturn > 0 ? '+' : ''}${longReturn.toFixed(1)}% ` +
      `+ 인버스(30%) +${invReturn.toFixed(1)}% = 포트폴리오 ${totalReturn >= 0 ? '+' : ''}${totalReturn}%`,
  };

  const strategyDescription =
    'TRANSITION 구간(변동성 ↑, 방향 불명확)에서 롱과 인버스를 동시 보유해 시장 방향에 무관하게 ' +
    '롱 종목의 개별 알파만 수익화하는 베타 중립 전략. ' +
    'QuantMaster Pro의 3-Gate 시스템이 선별한 최고 품질 종목에 이 전략을 결합하면 샤프 지수를 극적으로 개선할 수 있다.';

  const sharpeImprovementNote =
    '롱 단독 대비 변동성을 약 40% 축소하면서 알파를 보존 → 샤프 지수 1.2 → 2.0+ 개선 기대';

  const actionMessage = isActive
    ? '🟡 Market Neutral 모드 활성화 — 롱 50% / 인버스 30% / 현금 20% 구조로 베타를 중립화하세요. 3-Gate 선별 실적 주도주 롱 + KODEX 200선물인버스 헤지 권고.'
    : regime === 'BEAR'
    ? '🔴 BEAR 모드 — Market Neutral 전략 비활성. 인버스 비중 확대 및 롱 포지션 전면 청산 권고.'
    : '🟢 BULL 모드 — Market Neutral 전략 불필요. 27조건 롱 시스템 전면 가동.';

  return {
    isActive,
    regime,
    legs,
    betaNeutralScenario,
    sharpeImprovementNote,
    strategyDescription,
    actionMessage,
    lastUpdated: now,
  };
}

// ─── 아이디어 3: Bear Regime 전용 종목 발굴 — "하락 수혜주" 자동 탐색 ──────────

/**
 * Gate -1이 Bear Regime을 감지하면 자동 활성화되는 Bear Screener.
 * 기존 27조건 대신 방어형 15조건으로 종목을 재스크리닝한다.
 *
 * 카테고리:
 *  - 방어주 (Defensive):        음식료·통신·유틸리티 — 경기와 무관한 필수 소비
 *  - 역주기주 (Counter-Cyclical): 채권형 ETF, 금 ETF, 달러 ETF
 *  - 숏 수혜주 (Value-Depressed): 실적 탄탄하나 주가만 눌린 종목
 *  - 변동성 수혜주 (Volatility Beneficiary): 보험주, 금융주(NIM 개선)
 */
export function evaluateBearScreener(
  macroEnv: MacroEnvironment,
  bearRegimeResult: BearRegimeResult,
): BearScreenerResult {
  const now = new Date().toISOString();
  const isActive = bearRegimeResult.regime === 'BEAR';

  // ─── 방어주 조건 (4개) ──────────────────────────────────────────────────────

  /** 조건 D1: 배당 수익률 3% 이상 — 하락장에서도 안정적 현금흐름 */
  const condD1: BearScreenerCondition = {
    id: 'DIVIDEND_YIELD_3PCT',
    name: '배당 수익률 3% 이상',
    passed: true, // AI 스크리닝 단계에서 검증 — 항상 활성화하여 탐색 유도
    category: 'DEFENSIVE',
    description: '배당 수익률 3% 이상인 고배당 방어주는 하락장에서 주가 하방 지지 역할을 한다.',
  };

  /** 조건 D2: 음식료·생활용품 필수소비재 섹터 */
  const condD2: BearScreenerCondition = {
    id: 'ESSENTIAL_CONSUMER_SECTOR',
    name: '필수소비재 섹터 (음식료·생활용품)',
    passed: true,
    category: 'DEFENSIVE',
    description: '경기 둔화와 무관하게 수요가 유지되는 필수소비재 업종으로 하락장 방어력이 높다.',
  };

  /** 조건 D3: 통신·유틸리티 섹터 — 규제 보호 + 안정 배당 */
  const condD3: BearScreenerCondition = {
    id: 'TELCO_UTILITY_SECTOR',
    name: '통신·유틸리티 섹터',
    passed: true,
    category: 'DEFENSIVE',
    description: '규제 산업으로 경쟁이 제한되어 있고 안정적 현금흐름·배당으로 하락장 방어력 우수.',
  };

  /** 조건 D4: 저베타 (β < 0.7) — 시장 대비 낮은 변동성 */
  const condD4: BearScreenerCondition = {
    id: 'LOW_BETA',
    name: '저베타 종목 (β 0.7 미만)',
    passed: true,
    category: 'DEFENSIVE',
    description: '시장 하락 시 상대적으로 낮은 낙폭을 기록하는 저베타 종목을 우선 탐색.',
  };

  // ─── 역주기주 조건 (4개) ─────────────────────────────────────────────────────

  /** 조건 CC1: 채권형 ETF — 금리 하락 기대 시 가격 상승 */
  const condCC1: BearScreenerCondition = {
    id: 'BOND_ETF_CANDIDATE',
    name: '채권형 ETF 수혜 (금리 하락 기대)',
    passed: macroEnv.bokRateDirection === 'CUTTING' || macroEnv.bokRateDirection === 'HOLDING',
    category: 'COUNTER_CYCLICAL',
    description: `한국은행 기준금리 ${macroEnv.bokRateDirection} — 금리 하락/동결 구간에서 채권형 ETF 가격 상승 기대.`,
  };

  /** 조건 CC2: 금 ETF — 달러 약세·경기 침체 헤지 */
  const condCC2: BearScreenerCondition = {
    id: 'GOLD_ETF_HEDGE',
    name: '금 ETF 헤지 (KODEX 골드선물 등)',
    passed: true,
    category: 'COUNTER_CYCLICAL',
    description: '경기 침체·지정학적 리스크 확대 시 안전자산 선호로 금 ETF 수혜 증가.',
  };

  /** 조건 CC3: 달러 ETF — USD/KRW 상승 수혜 */
  const condCC3: BearScreenerCondition = {
    id: 'DOLLAR_ETF_SURGE',
    name: '달러 ETF 수혜 (USD/KRW 상승)',
    passed: macroEnv.usdKrw >= 1320,
    category: 'COUNTER_CYCLICAL',
    description: `USD/KRW ${macroEnv.usdKrw.toLocaleString()} — 원화 약세 구간에서 달러 ETF(KODEX 미국달러선물 등) 수혜 발생.`,
  };

  /** 조건 CC4: 음의 시장 상관관계 자산 — 하락 시 반등 패턴 */
  const condCC4: BearScreenerCondition = {
    id: 'NEGATIVE_CORRELATION',
    name: '하락장 역상관 자산',
    passed: true,
    category: 'COUNTER_CYCLICAL',
    description: 'KOSPI 하락 시 반등하는 역상관 자산(인버스 제외)으로 포트폴리오 방어력 강화.',
  };

  // ─── 숏 수혜주 조건 (4개) ───────────────────────────────────────────────────

  /** 조건 VD1: ROE 15% 이상 — 탄탄한 실적 기반 */
  const condVD1: BearScreenerCondition = {
    id: 'ROE_ABOVE_15',
    name: 'ROE 15% 이상 (탄탄한 실적)',
    passed: true,
    category: 'VALUE_DEPRESSED',
    description: '강력한 이익 창출 능력을 증명하는 ROE 15% 이상 종목. 주가 하락은 공매도 과잉, 재진입 기회.',
  };

  /** 조건 VD2: PER 섹터 평균 이하 — 저평가 매력 */
  const condVD2: BearScreenerCondition = {
    id: 'PER_BELOW_SECTOR_AVG',
    name: 'PER 섹터 평균 이하 (저평가)',
    passed: true,
    category: 'VALUE_DEPRESSED',
    description: '섹터 평균 PER 대비 낮은 밸류에이션으로 하락장 방어 여력 및 반등 시 상승폭 확대 기대.',
  };

  /** 조건 VD3: 공매도 잔고 감소 추세 — 숏 커버링 매수 기대 */
  const condVD3: BearScreenerCondition = {
    id: 'SHORT_INTEREST_DECLINING',
    name: '공매도 잔고 감소 (숏 커버링 기대)',
    passed: true,
    category: 'VALUE_DEPRESSED',
    description: '공매도 잔고가 고점 대비 감소 중인 종목은 숏 커버링에 의한 기술적 반등 가능성이 높다.',
  };

  /** 조건 VD4: 52주 고점 대비 30% 이상 하락 + 실적 유지 — 과매도 구간 */
  const condVD4: BearScreenerCondition = {
    id: 'OVERSOLD_FUNDAMENTALS_INTACT',
    name: '과매도 + 실적 유지 (52주 -30% 이상 하락)',
    passed: true,
    category: 'VALUE_DEPRESSED',
    description: '실적은 견조하나 시장 공포로 과도하게 하락한 종목. 공매도 세력의 반대편 포지션 기회.',
  };

  // ─── 변동성 수혜주 조건 (3개) ───────────────────────────────────────────────

  /** 조건 VB1: 보험 섹터 — VKOSPI 상승 시 보험료 인상 기대 */
  const condVB1: BearScreenerCondition = {
    id: 'INSURANCE_SECTOR',
    name: '보험 섹터 (변동성 상승 수혜)',
    passed: macroEnv.vkospi >= 20,
    category: 'VOLATILITY_BENEFICIARY',
    description: `VKOSPI ${macroEnv.vkospi.toFixed(1)} — 변동성 상승 구간에서 보험사 손해율 개선 및 보험료 조정 수혜 기대.`,
  };

  /** 조건 VB2: 금융주 NIM 개선 — 기준금리 유지/인상 수혜 */
  const condVB2: BearScreenerCondition = {
    id: 'FINANCIAL_NIM_IMPROVEMENT',
    name: '금융주 NIM 개선 (금리 유지/인상 구간)',
    passed: macroEnv.bokRateDirection === 'HIKING' || macroEnv.bokRateDirection === 'HOLDING',
    category: 'VOLATILITY_BENEFICIARY',
    description: `BOK 금리 ${macroEnv.bokRateDirection} — 금리 유지/인상 기조에서 은행·금융지주의 순이자마진(NIM) 개선 기대.`,
  };

  /** 조건 VB3: 달러 강세 수혜 수출 방어주 — 환율 헤지 완료 종목 */
  const condVB3: BearScreenerCondition = {
    id: 'DOLLAR_HEDGE_EXPORTER',
    name: '달러 강세 수혜 수출 방어주',
    passed: macroEnv.usdKrw >= 1300 && (macroEnv.dxyBullish === true),
    category: 'VOLATILITY_BENEFICIARY',
    description: `USD/KRW ${macroEnv.usdKrw.toLocaleString()}, DXY 강세 ${macroEnv.dxyBullish ? '확인' : '미확인'} — 환율 수혜를 받는 수출 중심 방어주 탐색.`,
  };

  const allConditions: BearScreenerCondition[] = [
    condD1, condD2, condD3, condD4,
    condCC1, condCC2, condCC3, condCC4,
    condVD1, condVD2, condVD3, condVD4,
    condVB1, condVB2, condVB3,
  ];

  const passedCount = allConditions.filter(c => c.passed).length;

  const categories = {
    defensive: allConditions.filter(c => c.category === 'DEFENSIVE'),
    counterCyclical: allConditions.filter(c => c.category === 'COUNTER_CYCLICAL'),
    valueDepressed: allConditions.filter(c => c.category === 'VALUE_DEPRESSED'),
    volatilityBeneficiary: allConditions.filter(c => c.category === 'VOLATILITY_BENEFICIARY'),
  };

  const searchQueries = [
    '하락장 방어주 음식료 고배당 한국',
    '통신주 유틸리티 배당 저베타 한국',
    `KODEX 골드선물 금 ETF 한국`,
    `달러 ETF KODEX 미국달러선물 ${macroEnv.usdKrw >= 1320 ? '수혜' : '관련'}`,
    '채권 ETF KODEX 국고채 한국',
    '보험주 삼성화재 현대해상 한국',
    '은행주 KB금융 신한지주 NIM 개선',
    `공매도 감소 실적 저평가 종목 한국`,
    '52주 신저가 과매도 ROE 탄탄 종목',
  ];

  const triggerReason = isActive
    ? `Gate -1 Bear Regime 감지 (${bearRegimeResult.triggeredCount}/${bearRegimeResult.threshold} 조건 충족) — 27조건 Bull 스크리너 → 방어형 15조건 Bear Screener 자동 전환`
    : 'Bear Screener 비활성 — Bull/Transition Mode';

  const screeningNote = isActive
    ? '🔴 Bear Mode 활성: 방어주·역주기주·숏 수혜주·변동성 수혜주 4개 카테고리에서 하락 수혜 종목을 자동 탐색합니다. 파생상품 없이 하락장 수익을 추구하는 현실적 접근입니다.'
    : '기본 27조건 Bull 스크리너 활성 — Gate -1이 Bear Regime을 감지하면 자동으로 Bear Screener로 전환됩니다.';

  return {
    isActive,
    triggerReason,
    conditions: allConditions,
    passedCount,
    categories,
    searchQueries,
    screeningNote,
    lastUpdated: now,
  };
}

// ─── 아이디어 6: Bear Mode Kelly Criterion — 하락 베팅에 적용하는 켈리 공식 ──

/** 두 날짜(ISO 문자열) 사이의 거래일(영업일) 수를 계산한다. (토·일 제외)
 * 진입일(from)은 day 0으로 간주하고, from 다음 날부터 카운트를 시작한다.
 * 예: 월요일 진입 → 화요일 end면 1거래일 경과.
 */
function countTradingDaysBetween(from: string, to: string): number {
  const start = new Date(from);
  const end = new Date(to);
  if (end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1); // 진입일(day 0) 제외, 다음 날부터 카운트
  while (cursor <= end) {
    const day = cursor.getDay(); // 0=일, 6=토
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Bear Mode Kelly Criterion — 인버스 ETF에 대한 최적 포지션 비중 자동 계산.
 *
 * Bear Kelly = (p × b - q) / b
 *   p = Bear 신호 합치 확률 (Gate -1 충족도로 추정)
 *   b = 기대 수익률 배수 (인버스 2X ETF ≈ 1.8)
 *   q = 1 - p
 *
 * 인버스 ETF는 시간가치 손실(음의 롤링 비용)이 있으므로
 * 최대 보유 기간을 30거래일로 제한하는 Time-Stop 로직을 포함한다.
 *
 * @param bearRegimeResult Gate -1 Bear Regime 평가 결과
 * @param entryDate 포지션 진입일 (ISO 날짜 문자열, null이면 미진입)
 */
export function evaluateBearKelly(
  bearRegimeResult: BearRegimeResult,
  entryDate: string | null = null,
  inverseEntryWeightPct: number = 0,
): BearKellyResult {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  const MAX_HOLDING_DAYS = 30;
  // 인버스 2X ETF 기대 수익률 배수 (실전 슬리피지·롤링 비용 감안 1.8)
  const B = 1.8;

  const isActive = bearRegimeResult.regime === 'BEAR';

  // rawP = 충족 조건 수 / 전체 조건 수 (Gate -1 기준, 경계 없는 원시 확률)
  const rawP = bearRegimeResult.conditions.length > 0
    ? bearRegimeResult.triggeredCount / bearRegimeResult.conditions.length
    : 0;
  // p = Bear Mode 활성 시 rawP에 0.5 하한 적용 (최소한의 Bear 신뢰도 보장);
  // Bear Mode가 아닐 때는 0으로 처리
  const weightedP = rawP * (1 + Math.max(0, inverseEntryWeightPct) / 100);
  const p = isActive ? Math.max(0.5, Math.min(weightedP, 1.0)) : 0;
  const q = 1 - p;

  // Bear Kelly 공식: (p × b - q) / b
  const rawKellyFraction = p > 0 ? Math.max(0, (p * B - q) / B) : 0;

  // 전체 켈리 포지션 (%) — 최대 30% 상한 (인버스 ETF 레버리지 위험 감안)
  const kellyPct = Math.min(rawKellyFraction * 100, 30);

  // 반 켈리 — 실전 권고 (시간가치 손실·슬리피지 보정)
  const halfKellyPct = kellyPct / 2;

  // Time-Stop 계산
  let tradingDaysElapsed = 0;
  let tradingDaysRemaining = MAX_HOLDING_DAYS;
  let timeStopTriggered = false;

  if (entryDate) {
    tradingDaysElapsed = countTradingDaysBetween(entryDate, today);
    tradingDaysRemaining = Math.max(0, MAX_HOLDING_DAYS - tradingDaysElapsed);
    timeStopTriggered = tradingDaysElapsed >= MAX_HOLDING_DAYS;
  }

  const timeStopAlert = timeStopTriggered
    ? `⚠️ Time-Stop 발동 — 진입일(${entryDate})로부터 30거래일 경과. 인버스 ETF 즉시 청산 권고. 시간가치 손실 누적으로 추가 보유 시 음(-)의 기대수익.`
    : entryDate
      ? `⏱ 잔여 ${tradingDaysRemaining}거래일 (${tradingDaysElapsed}/${MAX_HOLDING_DAYS}일 경과) — Time-Stop 30거래일 내 포지션 청산 권고.`
      : '포지션 진입 후 Time-Stop이 자동 카운트다운됩니다. 30거래일 도달 시 자동 청산 알림이 발송됩니다.';

  const formulaNote = `Bear Kelly = (p × b − q) / b = (${p.toFixed(2)} × ${B} − ${q.toFixed(2)}) / ${B} = ${rawKellyFraction.toFixed(3)} → 전체켈리 ${kellyPct.toFixed(1)}% / 반켈리 ${halfKellyPct.toFixed(1)}%`;

  let actionMessage: string;
  if (!isActive) {
    actionMessage = '🟢 Bear Regime 비활성 — Bear Kelly 포지션 없음. Gate -1이 Bear Mode를 감지하면 켈리 공식이 자동 계산됩니다.';
  } else if (timeStopTriggered) {
    actionMessage = `🔴 Time-Stop 발동 — 인버스 ETF 즉시 청산. Bear Kelly: 반켈리 ${halfKellyPct.toFixed(1)}% (전체켈리 ${kellyPct.toFixed(1)}%)`;
  } else if (kellyPct < 5) {
    actionMessage = `🟡 Bear 신호 약함 — 켈리 포지션 ${halfKellyPct.toFixed(1)}% (반켈리). 조건 추가 충족 확인 후 진입 권고.`;
  } else {
    actionMessage = `🔴 Bear Kelly 활성 — 인버스 ETF 권장 비중 ${halfKellyPct.toFixed(1)}% (반켈리). 최대 30거래일 보유, Time-Stop 엄수.`;
  }

  return {
    isActive,
    p,
    b: B,
    q,
    rawKellyFraction,
    kellyPct,
    halfKellyPct,
    maxHoldingDays: MAX_HOLDING_DAYS,
    entryDate,
    tradingDaysElapsed,
    tradingDaysRemaining,
    timeStopTriggered,
    timeStopAlert,
    formulaNote,
    actionMessage,
    lastUpdated: now,
  };
}

// ─── 아이디어 7: 섹터 과열 감지 + 인버스 ETF 자동 매칭 ──────────────────────────

/**
 * 섹터별 과열 인버스 ETF 자동 매핑 테이블
 * 반도체 과열 → KODEX 반도체 인버스
 * 이차전지 과열 → TIGER 2차전지TOP10 인버스
 * 조선 과열 → KODEX 조선 관련 인버스
 */
const SECTOR_INVERSE_ETF_MAP: Record<string, { etf: string; code: string }> = {
  '반도체': { etf: 'KODEX 반도체 인버스 (091160)', code: '091160' },
  '이차전지': { etf: 'TIGER 2차전지TOP10 인버스 (400810)', code: '400810' },
  '조선': { etf: 'KODEX 조선 관련 인버스 (229720)', code: '229720' },
};

/**
 * 아이디어 7: 섹터 과열 감지 + 인버스 ETF 자동 매칭
 *
 * 섹터 과열 4개 조건:
 *   1. 섹터 RS 상위 1% 진입 (sectorRsRank < 1)
 *   2. 뉴스 빈도 CROWDED 또는 OVERHYPED 단계
 *   3. 주봉 RSI 80 이상
 *   4. 외국인 Active 매수 6주 연속 과잉
 *
 * 4개 조건을 모두 충족할 때 과열(overheated)로 판정하고, 해당 섹터의 인버스 ETF를 자동 매칭한다.
 */
export function evaluateSectorOverheat(
  sectors: SectorOverheatInput[],
): SectorOverheatResult {
  const now = new Date().toISOString();

  const allSectors: OverheatedSectorMatch[] = sectors.map(sector => {
    const conditions: SectorOverheatCondition[] = [
      {
        id: 'rs_rank',
        label: '섹터 RS 상위 1% 진입 (과열)',
        triggered: sector.sectorRsRank < 1,
        value: `RS ${sector.sectorRsRank.toFixed(1)}%`,
      },
      {
        id: 'news_phase',
        label: '뉴스 빈도 CROWDED/OVERHYPED',
        triggered: sector.newsPhase === 'CROWDED' || sector.newsPhase === 'OVERHYPED',
        value: sector.newsPhase,
      },
      {
        id: 'weekly_rsi',
        label: '주봉 RSI 80 이상',
        triggered: sector.weeklyRsi >= 80,
        value: `RSI ${sector.weeklyRsi.toFixed(1)}`,
      },
      {
        id: 'foreign_buying',
        label: '외국인 Active 매수 6주 연속 과잉',
        triggered: sector.foreignActiveBuyingWeeks >= 6,
        value: `${sector.foreignActiveBuyingWeeks}주 연속`,
      },
    ];

    const triggeredCount = conditions.filter(c => c.triggered).length;
    const isFullyOverheated = triggeredCount === 4;
    const overheatScore = Math.round((triggeredCount / 4) * 100);

    const etfInfo = SECTOR_INVERSE_ETF_MAP[sector.name];
    if (!etfInfo) {
      console.warn(`[SectorOverheat] ETF 매핑 없음: ${sector.name} — 인버스 ETF 수동 확인 필요`);
    }
    const inverseEtf = etfInfo?.etf ?? `${sector.name} 인버스 ETF (수동 확인 필요)`;
    const inverseEtfCode = etfInfo?.code ?? '-';

    let recommendation: string;
    if (isFullyOverheated) {
      recommendation = `🔴 완전 과열 (4/4) — ${inverseEtf} 즉시 진입 권고. 신규 롱 포지션 중단.`;
    } else if (triggeredCount >= 3) {
      recommendation = `🟠 과열 임계치 근접 (${triggeredCount}/4) — 과열 확정 전 단계. ${inverseEtf}는 관찰 목록에 유지.`;
    } else if (triggeredCount >= 2) {
      recommendation = `🟡 과열 주의 (${triggeredCount}/4) — 과열 조건 미충족. 경보 모니터링 강화.`;
    } else {
      recommendation = `🟢 정상 사이클 (${triggeredCount}/4) — 과열 신호 미충족. 관망 유지.`;
    }

    return {
      sectorName: sector.name,
      inverseEtf,
      inverseEtfCode,
      conditions,
      triggeredCount,
      isFullyOverheated,
      overheatScore,
      recommendation,
    };
  });

  const overheatedMatches = allSectors.filter(s => s.isFullyOverheated);
  const overheatedCount = overheatedMatches.length;

  let actionMessage: string;
  if (overheatedCount === 0) {
    actionMessage = '🟢 현재 과열 감지 섹터 없음 — 전체 섹터 정상 사이클 운용 중. 롱 포지션 유지 가능.';
  } else if (overheatedCount === 1) {
    actionMessage = `🟡 1개 섹터 과열 감지 — ${overheatedMatches[0].sectorName} 섹터 과열. ${overheatedMatches[0].inverseEtf} 인버스 ETF 진입 검토. 해당 섹터 롱 포지션 비중 축소 권고.`;
  } else {
    const names = overheatedMatches.map(m => m.sectorName).join(', ');
    actionMessage = `🔴 ${overheatedCount}개 섹터 동시 과열 — ${names}. 각 섹터 인버스 ETF 즉시 진입 권고. 과열 섹터 롱 포지션 전면 축소.`;
  }

  return {
    overheatedMatches,
    allSectors,
    overheatedCount,
    actionMessage,
    lastUpdated: now,
  };
}

// ─── 아이디어 8: Bear Mode 손익 시뮬레이터 ─────────────────────────────────────

/** KODEX 인버스 2X ETF 실효 배율 (슬리피지·롤링 비용 반영) */
const BEAR_SIM_INVERSE_2X_MULTIPLIER = 1.8;

/** Bear Mode 시뮬레이터에서 사용할 기본 인버스 ETF 명칭 */
const BEAR_SIM_ETF_NAME = 'KODEX 인버스 2X (122630)';

/** Gate -1 감지 후 Bear Mode 전환까지 대기하는 거래일 수 (D+3) */
const BEAR_SIM_SWITCH_DELAY_DAYS = 3;

/**
 * Gate -1 감지일로부터 지정된 거래일 수만큼 뒤의 날짜를 계산한다.
 * 토·일은 거래일에서 제외한다.
 * 참고: 한국 공휴일은 별도 처리하지 않으며, 실제 D+3 전환일은 공휴일 여부에 따라
 * 하루 이상 차이가 날 수 있다 (시뮬레이션 추정치로 사용).
 */
function addTradingDays(fromDateStr: string, days: number): string {
  const date = new Date(fromDateStr);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return date.toISOString().split('T')[0];
}

/**
 * 아이디어 8: Bear Mode 손익 시뮬레이터
 *
 * 사용자가 입력한 Bear 구간 시나리오를 기반으로 다음을 계산한다:
 *   1. 롱 포트폴리오가 Bear 구간에서 기록한 실제 수익률 (사용자 입력)
 *   2. Gate -1이 Bear를 감지한 D+3에 KODEX 인버스 2X로 전환했을 경우 시뮬레이션 수익률
 *   3. 두 수익률의 알파 차이 (%p)
 *
 * Bear Mode 수익 추정:
 *   bearModeReturn = -1 × marketReturn × INVERSE_2X_MULTIPLIER (1.8)
 *
 * @param inputs 사용자가 입력한 Bear 구간 시나리오 목록
 */
export function evaluateBearModeSimulator(
  inputs: BearModeSimulatorInput[],
): BearModeSimulatorResult {
  const now = new Date().toISOString();

  const scenarios: BearModeSimulatorScenarioResult[] = inputs.map(input => {
    const switchDate = addTradingDays(input.gateDetectionDate, BEAR_SIM_SWITCH_DELAY_DAYS);

    // Bear Mode 수익률: 시장 하락 × 인버스 2X 배율 (시장이 하락하면 양의 수익)
    const bearModeReturn = parseFloat(
      (-input.marketReturn * BEAR_SIM_INVERSE_2X_MULTIPLIER).toFixed(2),
    );
    const longReturn = input.longPortfolioReturn;
    const alphaDifference = parseFloat((bearModeReturn - longReturn).toFixed(2));

    let recommendation: string;
    if (alphaDifference > 20) {
      recommendation = `🔴 강력한 전환 신호 — Bear Mode 전환 시 ${alphaDifference.toFixed(1)}%p 알파 획득 가능. 다음 Gate -1 감지 시 D+3 즉시 전환 권고.`;
    } else if (alphaDifference > 0) {
      recommendation = `🟡 유의미한 알파 — ${alphaDifference.toFixed(1)}%p 개선. 시스템 신호를 따르는 것이 직관 대비 유리.`;
    } else {
      recommendation = `🟢 Bear Mode 전환 효과 미미 — 해당 구간에서는 롱 포트폴리오가 Bear Mode 대비 우위.`;
    }

    return {
      label: input.label,
      bearStartDate: input.bearStartDate,
      bearEndDate: input.bearEndDate,
      switchDate,
      switchDayOffset: BEAR_SIM_SWITCH_DELAY_DAYS,
      longReturn,
      bearModeReturn,
      alphaDifference,
      inverseEtfName: BEAR_SIM_ETF_NAME,
      recommendation,
    };
  });

  // 최고 알파 시나리오: 동일 알파 시 먼저 나온 시나리오(낮은 인덱스) 선택
  const bestScenario = scenarios.length > 0
    ? [...scenarios].sort((a, b) => b.alphaDifference - a.alphaDifference)[0]
    : null;

  let conclusionMessage: string;
  if (scenarios.length === 0) {
    conclusionMessage = '🟢 시나리오 없음 — Bear 구간 데이터를 입력하면 손익 시뮬레이션이 자동 계산됩니다.';
  } else if (bestScenario && bestScenario.alphaDifference > 0) {
    conclusionMessage = `📊 시스템 신호를 따랐다면 최대 +${bestScenario.alphaDifference.toFixed(1)}%p 알파 획득 가능 (${bestScenario.label}). 데이터가 말했고, 그걸 따랐다면 이만큼 벌었다.`;
  } else {
    conclusionMessage = '📊 시뮬레이션 완료 — 입력된 시나리오에서는 Bear Mode 전환 효과가 제한적입니다.';
  }

  return {
    scenarios,
    bestScenario,
    conclusionMessage,
    lastUpdated: now,
  };
}
