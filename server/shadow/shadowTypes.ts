// @responsibility Shadow Learning Genius Patch v1 타입 SSOT
export type ShadowLifecycleState =
  | 'CANDIDATE_DETECTED'
  | 'SHADOW_SIGNAL_APPROVED'
  | 'GATE_EVALUATED'
  | 'DECISION_MADE'
  | 'LIVE_APPROVED'
  | 'LIVE_BLOCKED_SHADOW_ALLOWED'
  | 'SHADOW_ONLY'
  | 'REJECTED_TRACE_ONLY'
  | 'SHADOW_ORDER_CREATED'
  | 'SHADOW_PAPER_FILLED'
  | 'SHADOW_POSITION_OPENED'
  | 'SHADOW_MONITORING'
  | 'SHADOW_EXIT_TRIGGERED'
  | 'SHADOW_PAPER_SOLD'
  | 'SHADOW_POSITION_CLOSED'
  | 'OUTCOME_LABELED'
  | 'REFLECTION_READY'
  | 'PARAM_UPDATE_CANDIDATE'
  | 'QUARANTINED';

export type EngineMode = 'NORMAL' | 'LIVE' | 'PAPER' | 'SHADOW' | 'SHADOW_ONLY' | 'SELL_ONLY' | 'HARD_BLOCK' | 'OBSERVE_ONLY';
export type ExecutionImpact = 'NONE' | 'PAPER' | 'LIVE';
export type DataHealth = 'OK' | 'STALE' | 'DEGRADED' | 'EMPTY' | 'CORRUPTED' | 'UNAVAILABLE';
export type ProviderHealth = 'OK' | 'KRX_UNAVAILABLE' | 'NAVER_NOT_WIRED' | 'CACHE_EMPTY' | 'PROVIDER_DEGRADED' | 'PROVIDER_ERROR';
export type ConfidenceLevel = 'VERIFIED' | 'CALCULATED' | 'FALLBACK' | 'AI_ESTIMATE' | 'LOW' | 'QUARANTINED';
export type SourceConfidence = 'VERIFIED' | 'CALCULATED' | 'EXTERNAL_API' | 'FALLBACK' | 'AI_ESTIMATE' | 'UNKNOWN';
export type OutcomeLabel =
  | 'WIN' | 'LOSS' | 'BREAKEVEN' | 'ACTIVE' | 'EXPIRED' | 'INVALID' | 'DATA_CORRUPTED'
  | 'MISSED_WIN' | 'AVOIDED_LOSS' | 'GOOD_BLOCK' | 'BAD_BLOCK' | 'NEUTRAL_BLOCK' | 'QUARANTINED';
export type IntegritySeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type PromotionStatus = 'BLOCKED' | 'OBSERVE' | 'READY_FOR_CANARY' | 'CANARY_ACTIVE' | 'CORE_CANDIDATE';

export interface ShadowStateTransition {
  caseId: string;
  from?: ShadowLifecycleState;
  to: ShadowLifecycleState;
  timestamp: string;
  reason: string;
  engineMode: EngineMode;
  executionImpact: ExecutionImpact;
  dataHealth: DataHealth;
  confidenceLevel: ConfidenceLevel;
  integrityIssue?: string;
}

export interface ShadowCase {
  caseId: string;
  signalId: string;
  symbol: string;
  symbolName: string;
  detectedAt: string;
  marketSession: string;
  engineMode: EngineMode;
  blockedReason?: string;
  dataProvider?: string;
  dataHealth: DataHealth;
  providerHealth: ProviderHealth;
  confidenceLevel: ConfidenceLevel;
  expectedDecision?: string;
  actualDecision?: string;
  shadowDecision?: string;
  executionImpact: ExecutionImpact;
  entryPriceVirtual?: number;
  stopPriceVirtual?: number;
  targetPriceVirtual?: number;
  positionSizeVirtual?: number;
  mfe?: number;
  mae?: number;
  currentReturnPct?: number;
  finalReturnPct?: number;
  holdingMinutes?: number;
  outcomeLabel?: OutcomeLabel;
  learningTag?: string;
  regimeTag?: string;
  sectorTag?: string;
  sourceConfidence: SourceConfidence;
  createdAt: string;
  updatedAt: string;
  state?: ShadowLifecycleState;
  liveOrderCreated?: boolean;
  brokerOrderCreated?: boolean;
  brokerOrdersCreated?: 0 | number;
  cohortType?: 'FRESH_SHADOW' | 'BACKLOG_REPAIR' | 'GHOST_REPAIR' | 'RECOVERED_METADATA' | 'QUARANTINED' | 'COUNTERFACTUAL_BLOCKED';
  repairRunId?: string;
  backfillRunId?: string;
  metadataRecovered?: boolean;
  pendingRetryReason?: string;
  quarantinedReason?: string;
  entryPriceSource?: string;
  targetStopSource?: string;
  riskRuleId?: string;
  rMultiple?: number;
  returnR?: number;
  duplicateTelegramSuppressed?: boolean;
  counterfactualRecorded?: boolean;
  labelUpdatedAt?: string;
}

export interface IntegrityIssue {
  item: string;
  count: number;
  severity: IntegritySeverity;
  examples: string[];
}

export interface ReturnFlowCheck {
  caseId: string;
  symbol: string;
  lookupDay: number;
  checkedAt: string;
  hit: boolean;
  stale: boolean;
  pending: boolean;
  providerFallbackUsed: boolean;
  providerHealth: ProviderHealth;
  sourceConfidence: SourceConfidence;
  marketRiskInferred: false;
  price?: number;
  error?: string;
}

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
