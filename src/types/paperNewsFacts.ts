// @responsibility Define provenance for factual news observations.
import type { PaperLearningGroup } from './paperExperiment';

export const PAPER_NEWS_EVENT_LABELS = {
  CONTRACT: '판매·공급 계약', EARNINGS: '실적 보고', TREASURY: '자사주', FINANCING: '자금 조달',
  OWNERSHIP: '지분 보고', LEGAL: '소송·횡령·배임', LISTING: '상장·거래 상태', OTHER: '기타 공시',
} as const;
export type PaperNewsEvent = keyof typeof PAPER_NEWS_EVENT_LABELS;
export const PAPER_NEWS_RELATION_LABELS = { DIRECT: '해당 기업 직접 공시', INDIRECT: '간접·업종 자료', UNVERIFIED: '기업 연결 미확인' } as const;
export const PAPER_NEWS_FILING_LABELS = { FILED: '공시 접수 확인', AMENDED: '정정·변경 공시', WITHDRAWN: '철회·취하 공시', UNCONFIRMED: '접수 미확인' } as const;
export interface PaperNewsFacts {
  version: 'news-facts-v1';
  recordedAt: string;
  relationship: keyof typeof PAPER_NEWS_RELATION_LABELS;
  event: PaperNewsEvent;
  filingStatus: keyof typeof PAPER_NEWS_FILING_LABELS;
  receiptNo: string | null;
  filedDate: string | null;
  firstSeenAt: string;
  sourceUrl: string | null;
  linkMethod: string;
}
export interface PaperDisclosureStatus {
  state: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  checkedAt: string;
  lastSuccessAt: string | null;
  fromDate: string;
  toDate: string;
  pages: number;
  fetchedCount: number;
  linkedCount: number;
  unlinkedCount: number;
  issue: string | null;
}
export interface PaperNewsFactsStudy {
  recordedCount: number;
  unrecordedCount: number;
  groups: Array<{
    key: string;
    label: string;
    observationCount: number;
    entryDateCount: number;
    flowCount: number;
    meanForeignPctVolume: number | null;
    meanInstitutionPctVolume: number | null;
    outcomes: Array<PaperLearningGroup & { horizon: 1 | 3 | 5 }>;
  }>;
}
