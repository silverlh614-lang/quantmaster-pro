import type { StockRecommendation } from '../services/stock/types';

const RADAR_CATEGORIES = [
  { name: '기본적 분석', keys: ['roeType3', 'earningsSurprise', 'performanceReality', 'ocfQuality', 'marginAcceleration', 'interestCoverage', 'economicMoatVerified'] },
  { name: '기술적 분석', keys: ['momentumRanking', 'ichimokuBreakout', 'technicalGoldenCross', 'volumeSurgeVerified', 'turtleBreakout', 'fibonacciLevel', 'elliottWaveVerified', 'vcpPattern', 'divergenceCheck'] },
  { name: '수급 분석', keys: ['supplyInflow', 'institutionalBuying', 'consensusTarget'] },
  { name: '시장 주도력', keys: ['cycleVerified', 'riskOnEnvironment', 'notPreviousLeader', 'policyAlignment'] },
  { name: '전략/심리', keys: ['mechanicalStop', 'psychologicalObjectivity', 'catalystAnalysis'] },
] as const;

export function getRadarData(stock: StockRecommendation) {
  return RADAR_CATEGORIES.map(cat => {
    const passed = cat.keys.filter(key => stock.checklist ? stock.checklist[key as keyof StockRecommendation['checklist']] : 0).length;
    const total = cat.keys.length;
    return { subject: cat.name, A: Math.round((passed / total) * 100), fullMark: 100 };
  });
}
