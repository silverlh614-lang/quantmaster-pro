// @responsibility Define isolated virtual account records.
import type { PaperCostModel } from './paperExperiment';
import type { PaperAdaptiveRule, PaperAdaptiveStats } from './paperAdaptive';

export interface PaperAccountCandidate {
  rule: PaperAdaptiveRule; ruleKey: string; label: string;
  training: PaperAdaptiveStats; validation: PaperAdaptiveStats;
}
export interface PaperAccountSelection {
  version: 'validated-net-v1'; id: string; tradingDate: string; selectedAt: string;
  sourceEvaluatedAt: string; cutoffAt: string;
  minimumSamples: number; minimumEntryDates: number;
  candidates: PaperAccountCandidate[]; selectedRuleKey: string | null;
}

export interface PaperAccountConfig { initialCash: number; maxPositionPct: number; includeExploration: boolean }
export interface PaperAccountQuote { price: number; observedAt: string; source: string; snapshotId: string }
export interface PaperAccountFill {
  id: string; at: string; snapshotId: string; quote: PaperAccountQuote; quantity: number;
  price: number; grossAmount: number; fee: number; tax: number; cashDelta: number;
}
export interface PaperAccountOrder {
  id: string; tradeId: string; symbol: string; name: string; side: 'BUY' | 'SELL';
  signalAt: string; submittedAt: string; updatedAt: string; signalSnapshotId: string;
  signalReason: string; signalLabel: string; purpose: 'VALIDATED' | 'EXPLORATION';
  quantity: number; budget: number; costModel: PaperCostModel;
  status: 'PENDING' | 'FILLED' | 'REJECTED' | 'EXPIRED'; statusReason: string;
  fill: PaperAccountFill | null;
  /** Absent in legacy records or when no daily policy selection was available. */
  selectionId?: string;
}
export interface PaperAccountLedger {
  version: 'virtual-account-v1'; id: string; startedAt: string; config: PaperAccountConfig;
  buyPaused: boolean; controls: Array<{ at: string; buyPaused: boolean }>;
  lastSnapshotAt: string | null; orders: PaperAccountOrder[]; marks: Record<string, PaperAccountQuote>;
  /** Append-only daily choices; old account records remain readable. */
  selections?: PaperAccountSelection[];
  /** Observed liquidation-equity drawdown; excludes stale marks, never backfilled. */
  risk?: { since: string; updatedAt: string; observations: number; peakEquity: number; maxDrawdownPct: number };
}
export interface PaperAccountPosition {
  tradeId: string; symbol: string; name: string; quantity: number; entryCost: number;
  mark: PaperAccountQuote | null; stale: boolean; liquidationValue: number | null; unrealizedPnl: number | null;
}
export interface PaperAccountView {
  account: PaperAccountLedger | null; asOf: string; error?: string;
  cash: number | null; realizedPnl: number | null; unrealizedPnl: number | null;
  equity: number | null; returnPct: number | null; positions: PaperAccountPosition[];
}
