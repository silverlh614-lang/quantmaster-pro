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
} from '../types/quant';

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
  const kellyReduction = macroHealthScore >= 70 ? 0 : macroHealthScore >= 40 ? 0.5 : 1.0;

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
  stockData: Record<ConditionId, number> = {} as any,
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
  if (!stockData) stockData = {} as any;
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
  // 신용 위기 경보(AA- ≥ 150bp) → 추가 Kelly 50% 축소 플래그 (나중에 적용)
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

  // Gate 0 Kelly 축소 적용 (MHS 40-69 → 50% 축소)
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

// 실계산 기반 조건 ID (indicators.ts / KIS API / DART API)
const REAL_DATA_CONDITIONS: ConditionId[] = [2, 6, 10, 11, 18, 19, 20, 21, 25, 26]; // 모멘텀·일목·골든크로스·거래량·RS·VCP 등
const AI_ESTIMATE_CONDITIONS: ConditionId[] = [1, 3, 4, 5, 7, 8, 9, 12, 13, 14, 15, 16, 17, 22, 23, 24, 27];

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
