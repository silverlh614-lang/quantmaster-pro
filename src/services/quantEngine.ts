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
  }
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

  // MHS < 40 또는 비상정지 → 전면 매수 중단
  if (gate0Result?.buyingHalted || emergencyStop) {
    return {
      gate0Result,
      smartMoneyData: advancedContext?.smartMoney,
      exportMomentumData: advancedContext?.exportMomentum,
      geopoliticalRisk: advancedContext?.geoRisk,
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
  // MHS 40-69 → Gate 1 통과 기준 강화 (5점 → 6점)
  const gate1Threshold = gate0Result?.mhsLevel === 'MEDIUM' ? 6 : 5;
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
  const EVOLUTION_WEIGHTS: Record<ConditionId, number> = {
    1: 1.1,  // 주도주 사이클 — 안정적 성과
    10: 0.9, // 기술적 정배열 — 최근 후행
    25: 1.2, // VCP — 현 레짐에서 신뢰도 높음
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
  const { smartMoney, exportMomentum, geoRisk } = advancedContext ?? {};
  const GEO_SECTORS = ['방산', '조선', '원자력', '방위산업'];
  const isGeoSector = GEO_SECTORS.some(s => sectorRotation.name.includes(s));

  // ── Gate 2: 성장 검증 ────────────────────────────────────────────────────
  // Smart Money EWY+MTUM 동시 유입 OR 반도체 수출 3개월 연속 성장 → 9→8 완화
  const semiconductorRelax = exportMomentum?.semiconductorGate2Relax === true
    && sectorRotation.name.includes('반도체');
  const gate2Threshold = (smartMoney?.isEwyMtumBothInflow || semiconductorRelax) ? 8 : 9;
  const gate2PassCount = GATE2_IDS.filter(id => (stockData[id] ?? 0) >= 5).length;
  const gate2Passed = gate2PassCount >= gate2Threshold;
  const gate2Score = calculateScore(GATE2_IDS);

  // ── Gate 3: 정밀 타이밍 ──────────────────────────────────────────────────
  // 지정학 리스크 GOS ≥ 7 AND 지정학 수혜 섹터 → 7→6 완화
  const gate3Threshold = (geoRisk && geoRisk.score >= 7 && isGeoSector) ? 6 : 7;
  const gate3PassCount = GATE3_IDS.filter(id => (stockData[id] ?? 0) >= 5).length;
  const gate3Passed = gate3PassCount >= gate3Threshold;
  const gate3Score = calculateScore(GATE3_IDS);

  // FX 조정 팩터 반영: 수출주/내수주 비대칭 환율 영향 내재화
  let finalScore = gate2Score + gate3Score + fxAdjustmentFactor;

  // 수출 모멘텀 Hot Sector +5% 보너스
  if (exportMomentum?.hotSectors.includes(sectorRotation.name)) {
    finalScore *= 1.05;
  }

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

  positionSize = Math.max(0, positionSize);

  // 3-Tranche Scaling Plan
  const tranchePlan: TranchePlan | undefined = positionSize > 0 ? {
    tranche1: { size: positionSize * 0.3, trigger: '현재가 진입', status: 'PENDING' },
    tranche2: { size: positionSize * 0.3, trigger: '1차 지지선 확인', status: 'PENDING' },
    tranche3: { size: positionSize * 0.4, trigger: '추세 강화 확인', status: 'PENDING' },
  } : undefined;

  return {
    gate0Result,
    smartMoneyData: smartMoney,
    exportMomentumData: exportMomentum,
    geopoliticalRisk: geoRisk,
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
  };
}
