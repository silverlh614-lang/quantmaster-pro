// @responsibility Define frozen morning recommendations with source evidence.
import type { PaperAdaptiveCandidate, PaperAdaptiveState } from './paperAdaptive';
import type { PaperDailyClose, PaperObservation, PaperSnapshot } from './paperExperiment';

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
