// @responsibility Define dated investor-flow research contracts.
import type { PaperLearningGroup, PaperNewsGroup } from './paperExperiment';

export const PAPER_FLOW_ISSUE_LABELS = {
  UNAVAILABLE: '수급 응답 없음', SYMBOL_MISMATCH: '수급 종목 불일치', DATE_MISMATCH: '직전 거래일 수급 미확인',
  TIME_INVALID: '수급 확인 시각 오류', QUANTITY_MISSING: '같은 날짜의 순매수 수량 미확인',
  VOLUME_MISSING: '같은 날짜의 거래량 미확인', VOLUME_MISMATCH: '순매수 수량과 거래량 불일치',
  NOT_RECORDED: '진입 당시 수급 미기록',
  DUPLICATE_ENTRY: '중복 종목·진입일 기록',
} as const;
export type PaperFlowIssue = keyof typeof PAPER_FLOW_ISSUE_LABELS;
export interface PaperInvestorFlow {
  symbol: string;
  source: 'KIS_API';
  unit: 'SHARES';
  requestedTradingDate: string;
  tradingDate: string | null;
  observedAt: string | null;
  foreignNetShares: number | null;
  institutionalNetShares: number | null;
  volume: number | null;
  issue: PaperFlowIssue | null;
}
export type PaperFlowActor = 'FOREIGN' | 'INSTITUTION' | 'COMBINED';
export type PaperFlowGroup = 'BOTH_BUY' | 'BOTH_SELL' | 'DIVERGENT' | 'OTHER';
export interface PaperFlowCorrelation {
  count: number;
  symbolCount: number;
  entryDateCount: number;
  pearson: number | null;
  spearman: number | null;
  status: 'AVAILABLE' | 'INSUFFICIENT_PAIRS' | 'NO_VARIATION';
}
export interface PaperInvestorFlowSnapshot {
  asOf: string;
  tradingDate: string;
  candidateCount: number;
  availableCount: number;
  flowCorrelation: PaperFlowCorrelation;
  groups: Array<{ group: PaperFlowGroup; count: number }>;
}
export interface PaperInvestorFlowStudy {
  version: 'previous-session-flow-v1';
  totalCount: number;
  availableCount: number;
  missing: Partial<Record<PaperFlowIssue, number>>;
  segments: Array<{
    news: 'ALL' | PaperNewsGroup;
    observationCount: number;
    flowCorrelation: PaperFlowCorrelation;
    correlations: Array<PaperFlowCorrelation & { actor: PaperFlowActor; horizon: 1 | 3 | 5 }>;
    groups: Array<{
      group: PaperFlowGroup;
      observationCount: number;
      meanForeignPctVolume: number | null;
      meanInstitutionPctVolume: number | null;
      outcomes: Array<PaperLearningGroup & { horizon: 1 | 3 | 5 }>;
    }>;
  }>;
}
