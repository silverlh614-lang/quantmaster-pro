// @responsibility Shadow promotion report contracts.
export type PromotionStatus = 'BLOCKED' | 'OBSERVE' | 'READY_FOR_CANARY' | 'CANARY_ACTIVE' | 'CORE_CANDIDATE';

export interface PromotionReport {
  sampleSize: number;
  closedSampleCount: number;
  closedSampleRate: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  maxDrawdownVirtual: number;
  duplicateSignalRate: number;
  paperFillRate: number;
  labelCompletionRate: number;
  returnFlowHitRate: number;
  pendingStaleCount: number;
  dataCorruptionRate: number;
  regimeBreakdown: Record<string, { sampleSize: number; winRate: number }>;
  promotionStatus: PromotionStatus;
  blockers: string[];
  generatedAt: string;
}
