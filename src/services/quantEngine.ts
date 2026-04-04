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
  AttributionAnalysis
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
  isPullbackVolumeLow?: boolean // 1순위: 눌림목 거래량 감소 여부
): EvaluationResult {
  if (!stockData) stockData = {} as any;
  const profile = getStockProfile(profileType);

  // Gate 1: 생존 필터 (5개 중 하나라도 탈락 시 종료)
  const gate1Passed = GATE1_IDS.every(id => stockData[id] >= 5);
  
  // Dynamic Scoring
  const vKospiMultiplier = regime.vKospi > 20 ? 1.5 : 1.0;
  const growthMultiplier = regime.vKospi < 15 ? 1.5 : 1.0;

// Self-Evolution Layer (Idea 1)
// In a real app, these would be fetched from a database of past performance
const EVOLUTION_WEIGHTS: Record<ConditionId, number> = {
  1: 1.1, // Cycle analysis has been performing well
  10: 0.9, // MA alignment has been lagging recently
  25: 1.2, // VCP breakout is highly reliable in current regime
};

const calculateScore = (ids: ConditionId[]) => {
  return ids.reduce((acc, id) => {
    let weight = ALL_CONDITIONS[id].baseWeight * (regime.weightMultipliers[id] || 1.0);
    
    // Apply Evolution Weights
    weight *= (EVOLUTION_WEIGHTS[id] || 1.0);

    // 1순위: 눌림목 거래량 감소 시 가중치 부여 (Condition 11: 거래량, 25: VCP)
    if (isPullbackVolumeLow && (id === 11 || id === 25)) {
      weight *= 1.3;
    }

    if (id === 7 || id === 23) weight *= vKospiMultiplier;
    if (id === 2 || id === 24) weight *= growthMultiplier;
    return acc + (stockData[id] * weight);
  }, 0);
};

  const gate1Score = calculateScore(GATE1_IDS);

  if (!gate1Passed || emergencyStop) {
    return {
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
      attribution
    };
  }

  // Gate 2: 성장 검증 (12개 중 9개 이상 통과)
  const gate2PassCount = GATE2_IDS.filter(id => stockData[id] >= 5).length;
  const gate2Passed = gate2PassCount >= 9;
  const gate2Score = calculateScore(GATE2_IDS);

  // Gate 3: 정밀 타이밍 (10개 중 7개 이상 통과)
  const gate3PassCount = GATE3_IDS.filter(id => stockData[id] >= 5).length;
  const gate3Passed = gate3PassCount >= 7;
  const gate3Score = calculateScore(GATE3_IDS);

  const finalScore = gate2Score + gate3Score;
  
  // Last Trigger
  // 2순위: 대장주 신고가 경신 시 가산점 및 트리거 강화
  const lastTrigger = (stockData[25] >= 8 && stockData[27] >= 8) || 
                      (sectorRotation.sectorLeaderNewHigh && stockData[2] >= 8); // VCP + Catalyst OR Sector Leader High + Momentum

  let recommendation: EvaluationResult['recommendation'] = '관망';
  let positionSize = 0;

  // Position Sizing
  const scorePercentage = (finalScore / 270) * 100;
  if (scorePercentage >= 90) positionSize = 20;
  else if (scorePercentage >= 80) positionSize = 15;
  else if (scorePercentage >= 70) positionSize = 10;
  else if (scorePercentage >= 60) positionSize = 5;

  // Conflict Signal Priority (Idea 12)
  // If technical is weak but fundamental is strong, reduce position in bear market
  const fundamentalScore = stockData[3] + stockData[15] + stockData[21];
  const technicalScore = stockData[2] + stockData[10] + stockData[18];
  
  if (regime.type === '하락' && technicalScore < 15 && fundamentalScore > 20) {
    positionSize *= 0.7; // Prioritize technical in bear market (Safety first)
  } else if (regime.type === '상승초기' && technicalScore > 20 && fundamentalScore < 15) {
    positionSize *= 1.2; // Prioritize technical in early bull (Momentum first)
  }

  if (positionSize > 0) {
    recommendation = positionSize >= 15 ? '풀 포지션' : '절반 포지션';
  }

  // Sector Rotation
  if (!sectorRotation.isLeading) {
    positionSize *= 0.5;
  }

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

  // 3-Tranche Scaling (Idea 3)
  const tranchePlan: TranchePlan | undefined = positionSize > 0 ? {
    tranche1: { size: positionSize * 0.3, trigger: '현재가 진입', status: 'PENDING' },
    tranche2: { size: positionSize * 0.3, trigger: '1차 지지선 확인', status: 'PENDING' },
    tranche3: { size: positionSize * 0.4, trigger: '추세 강화 확인', status: 'PENDING' }
  } : undefined;

  return {
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
    attribution
  };
}
