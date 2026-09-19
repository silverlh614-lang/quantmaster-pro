// @responsibility Define independent observation research contracts.
export const PAPER_FEATURES = {
  rsi14: { label: 'RSI 14', unit: '', cuts: [30, 50, 70] },
  rsiChange5: { label: 'RSI 5일 변화', unit: 'p', cuts: [-5, 0, 5] },
  volumeRatio20: { label: '완료일 거래량 / 이전 20일 평균', unit: '배', cuts: [0.5, 1, 2] },
  turnover20: { label: '20일 평균 종가×거래량 (추정)', unit: '억원', cuts: [10, 50, 200] },
  return20: { label: '20일 수익률', unit: '%', cuts: [-10, 0, 10] },
  peerRelative20: { label: '동일시장 관측군 중앙값 대비 20일 수익률', unit: '%p', cuts: [-5, 0, 5] },
  ma20Gap: { label: '완료 종가 / 20일선 이격', unit: '%', cuts: [-5, 0, 5] },
  ma60Gap: { label: '완료 종가 / 60일선 이격', unit: '%', cuts: [-5, 0, 5] },
  ma20Slope5: { label: '20일선의 5일 변화', unit: '%', cuts: [-2, 0, 2] },
  high20Gap: { label: '이전 20일 고가 대비 완료 종가', unit: '%', cuts: [-10, -3, 0] },
  gapPct: { label: '완료일 시가 갭', unit: '%', cuts: [-2, 0, 2] },
  atr14Pct: { label: 'ATR 14 / 완료 종가', unit: '%', cuts: [2, 4, 6] },
  adx14: { label: 'ADX 14 추세 강도', unit: '', cuts: [20, 25, 40] },
  macdHistogramPct: { label: 'MACD 12·26·9 히스토그램 / 종가', unit: '%', cuts: [-0.5, 0, 0.5] },
  bollingerB: { label: '볼린저 20·2 표준편차 %B', unit: '%', cuts: [0, 50, 100] },
  stochasticK14: { label: '스토캐스틱 14 %K', unit: '%', cuts: [20, 50, 80] },
  per: { label: '현재 PER (양수만)', unit: '배', cuts: [10, 20, 40] },
  pbr: { label: '현재가 / KIS BPS (양수만)', unit: '배', cuts: [1, 2, 5] },
  revenueGrowth: { label: 'KIS 매출 전년 대비 증감률', unit: '%', cuts: [-10, 0, 20] },
  operatingMargin: { label: 'KIS 영업이익률', unit: '%', cuts: [0, 5, 15] },
  netMargin: { label: 'KIS 순이익률', unit: '%', cuts: [0, 5, 15] },
  roe: { label: 'KIS ROE', unit: '%', cuts: [0, 10, 20] },
  debtRatio: { label: 'KIS 부채비율', unit: '%', cuts: [50, 100, 200] },
  currentRatio: { label: 'KIS 유동비율', unit: '%', cuts: [100, 150, 200] },
  operatingCashFlowSign: { label: 'DART 영업현금흐름 부호 (-1·0·1)', unit: '', cuts: [0, 1] },
  equityRatio: { label: 'DART 자본 / 자산', unit: '%', cuts: [0, 20, 50] },
} as const;
export type PaperFeatureKey = keyof typeof PAPER_FEATURES;
export type PaperFeatureValues = Record<PaperFeatureKey, number | null>;
export interface PaperFinancialFacts {
  symbol: string;
  observedAt: string;
  kis: { period: string | null; incomePeriod: string | null; stabilityPeriod: string | null;
    incomeField?: 'bsop_prti';
    roe: number | null; operatingMargin: number | null; netMargin: number | null;
    revenueGrowth: number | null; debtRatio: number | null; currentRatio: number | null; bps: number | null } | null;
  dart: { period: string | null; statement: string; operatingCashFlowSign: number | null; equityRatio: number | null } | null;
  issues: string[];
}
export interface PaperObservationFeatures {
  version: 'observation-features-v1';
  asOf: string;
  technicalDate: string | null;
  financials: PaperFinancialFacts | null;
  values: PaperFeatureValues;
}
export interface PaperFeatureCoverage {
  asOf: string; candidateCount: number;
  available: Record<PaperFeatureKey, number>;
}
export interface PaperFeatureStudy {
  totalCount: number; recordedCount: number;
  features: Array<{ key: PaperFeatureKey; availableCount: number; missingCount: number;
    groups: Array<{ label: string; count: number; symbolCount: number; entryDateCount: number;
      outcomes: Array<{ horizon: 1 | 3 | 5; count: number; symbolCount: number; entryDateCount: number;
        meanNetReturnPct: number | null; winRatePct: number | null }> }> }>;
}
