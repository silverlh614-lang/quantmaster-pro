// @responsibility Define isolated virtual account records.
import type { PaperCostModel } from './paperExperiment';

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
}
export interface PaperAccountLedger {
  version: 'virtual-account-v1'; id: string; startedAt: string; config: PaperAccountConfig;
  buyPaused: boolean; controls: Array<{ at: string; buyPaused: boolean }>;
  lastSnapshotAt: string | null; orders: PaperAccountOrder[]; marks: Record<string, PaperAccountQuote>;
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
