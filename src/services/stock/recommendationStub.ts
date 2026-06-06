// @responsibility 실데이터 기반 중립 StockRecommendation stub SSOT (종목검색·후보발굴 공유).
// AI 판정 없이 {code,name}(+선택 snapshot)으로 카드 골격을 만들고, enrichStockWithRealData 가
// 가격/기술지표/밸류/수급/펀더멘털을 실데이터로 채운다. AI 서술(reason/conviction/news)은 중립.
import type { StockRecommendation } from './types';

const ZERO_CHECKLIST: StockRecommendation['checklist'] = {
  cycleVerified: 0, momentumRanking: 0, roeType3: 0, supplyInflow: 0, riskOnEnvironment: 0,
  ichimokuBreakout: 0, mechanicalStop: 0, economicMoatVerified: 0, notPreviousLeader: 0,
  technicalGoldenCross: 0, volumeSurgeVerified: 0, institutionalBuying: 0, consensusTarget: 0,
  earningsSurprise: 0, performanceReality: 0, policyAlignment: 0, psychologicalObjectivity: 0,
  turtleBreakout: 0, fibonacciLevel: 0, elliottWaveVerified: 0, ocfQuality: 0, marginAcceleration: 0,
  interestCoverage: 0, relativeStrength: 0, vcpPattern: 0, divergenceCheck: 0, catalystAnalysis: 0,
};

export interface BaseRecommendationOpts {
  reason?: string;
  per?: number;
  pbr?: number;
  marketCap?: number;
  changePercent?: number;
  relatedSectors?: string[];
  /** 'KRX_MASTER'(검색) | 'REALDATA_UNIVERSE'(후보발굴) 등 출처 태그. */
  dataSource?: string;
}

/**
 * 중립 StockRecommendation stub. enrich 가 실데이터로 보강하기 전 골격.
 * AI 판정 필드(type/checklist/score)는 중립 — confidenceScore 0 + reason 으로 "AI 판정 보류" 표시.
 */
export function buildBaseRecommendation(code: string, name: string, opts: BaseRecommendationOpts = {}): StockRecommendation {
  const per = opts.per ?? 0;
  return {
    name,
    code,
    reason: opts.reason ?? '실데이터 기반 후보 — 실시간 데이터로 보강(AI 판정 보류).',
    type: 'BUY',
    patterns: [],
    hotness: 0,
    roeType: 'UNKNOWN',
    isLeadingSector: false,
    momentumRank: 0,
    supplyQuality: { passive: false, active: false },
    peakPrice: 0,
    currentPrice: 0,
    isPreviousLeader: false,
    ichimokuStatus: 'INSIDE_CLOUD',
    relatedSectors: opts.relatedSectors ?? [],
    valuation: { per, pbr: opts.pbr ?? 0, epsGrowth: 0, debtRatio: 0, perSource: per > 0 ? 'NAVER_SNAPSHOT' : 'UNAVAILABLE' },
    technicalSignals: {
      maAlignment: 'NEUTRAL', rsi: 0, macdStatus: 'NEUTRAL', bollingerStatus: 'NEUTRAL',
      stochasticStatus: 'NEUTRAL', volumeSurge: false, disparity20: 0, macdHistogram: 0, bbWidth: 0, stochRsi: 0,
    },
    economicMoat: { type: 'NONE', description: '' },
    scores: { value: 0, momentum: 0 },
    marketSentiment: { iri: 0, vkospi: 0 },
    confidenceScore: 0,
    marketCap: opts.marketCap ?? 0,
    marketCapCategory: 'MID',
    correlationGroup: '',
    aiConvictionScore: { totalScore: 0, factors: [], marketPhase: 'NEUTRAL', description: '' },
    riskFactors: [],
    targetPrice: 0,
    stopLoss: 0,
    checklist: { ...ZERO_CHECKLIST },
    visualReport: { financial: 0, technical: 0, supply: 0, summary: '' },
    dataSource: opts.dataSource ?? 'REALDATA',
  } as unknown as StockRecommendation;
}
