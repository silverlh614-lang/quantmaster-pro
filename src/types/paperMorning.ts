// @responsibility Define frozen morning recommendations with source evidence.
import type { PaperAdaptiveCandidate, PaperAdaptiveState } from './paperAdaptive';
import type { PaperDailyClose, PaperObservation, PaperSnapshot } from './paperExperiment';
import type { PaperTradeMeasurement } from './paperStrategy';

export interface PaperMorningSource {
  version: 'morning-source-v1';
  snapshot: PaperSnapshot;
  adaptive: PaperAdaptiveState;
  openSymbols: string[];
}
export interface PaperMorningPick {
  rank: number;
  symbol: string;
  name: string;
  purpose: 'VALIDATED' | 'EXPLORATION';
  referenceClose: PaperDailyClose;
  observation: PaperObservation;
  candidate: PaperAdaptiveCandidate;
  ruleValue: number;
  trial?: { id: string; registeredAt: string };
}
export interface PaperMorningSelection {
  version: 'morning-recommendation-v1';
  id: string;
  tradingDate: string;
  scheduledAt: string;
  createdAt: string;
  status: 'READY' | 'NO_MATCH' | 'DATA_UNAVAILABLE' | 'HOLIDAY';
  reason: string;
  sourceSnapshotId: string | null;
  sourceAsOf: string | null;
  adaptiveEvaluatedAt: string | null;
  adaptiveCutoffAt: string | null;
  consideredCount: number;
  matchedCount: number;
  heldCount: number;
  picks: PaperMorningPick[];
}
export interface PaperMorningReport extends PaperMorningSelection {
  message: string;
  delivery?: { sentAt: string; messageId: number };
}
export interface PaperMorningTradeReference {
  reportId: string;
  rank: number;
  purpose: 'VALIDATED' | 'EXPLORATION';
  recommendedAt: string;
  sentAt: string;
  /** Same symbol can enter under another rule; retain the distinction. */
  matchesEntryRule: boolean;
}

export interface PaperMorningTracking {
  reportId: string;
  tradingDate: string;
  asOf: string;
  snapshotId: string;
  decisions: Array<{ symbol: string; action: 'BUY' | 'WAIT' | 'HOLD' | 'EXIT'; reason: string; decisionAt: string }>;
}
export type PaperMorningResultStatus = 'OPEN' | 'CLOSED' | 'NOT_ENTERED' | 'PENDING' | 'UNSENT';
export const PAPER_MORNING_RESULT_LABELS: Record<PaperMorningResultStatus, string> = {
  OPEN: '가상 보유', CLOSED: '가상 매도 완료', NOT_ENTERED: '가상 미진입', PENDING: '진입 확인 대기', UNSENT: '추천 발송 미확인',
};
export interface PaperMorningResult {
  application?: {
    entryRule: import('./paperAdaptive').PaperAdaptiveRule | null;
    exitModel: 'SCHEDULED_CLOSE' | 'ADAPTIVE_OBSERVED';
    exitPolicy: import('./paperAdaptiveExit').PaperAdaptiveExitPolicy | null;
    scheduledExitAt: string;
  };
  rank: number; symbol: string; name: string; tradeId: string | null;
  status: PaperMorningResultStatus;
  entryAt: string | null; entryPrice: number | null; entryReason: string | null;
  exitAt: string | null; exitPrice: number | null; exitReason: string | null;
  netReturnPct: number | null;
  matchesEntryRule: boolean | null;
  measurement: PaperTradeMeasurement | null;
  lastDecision: PaperMorningTracking['decisions'][number] | null;
}
export interface PaperMorningReview {
  report: PaperMorningReport | null;
  results: PaperMorningResult[];
  asOf: string;
  trackingError?: string;
}
