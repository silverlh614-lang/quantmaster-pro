// @responsibility Shadow Case Library client-side read model contracts.

export type EngineMode = 'NORMAL' | 'DEGRADED' | 'SELL_ONLY' | 'SHADOW_ONLY' | 'OBSERVE_ONLY';

export type ShadowCaseType =
  | 'CASE_SUPPLY_UNSTABLE'
  | 'CASE_HOLIDAY'
  | 'CASE_LUNCH_BREAK'
  | 'CASE_SELL_ONLY'
  | 'CASE_SHADOW_ONLY'
  | 'CASE_KRX_DELAY'
  | 'CASE_KIS_500'
  | 'CASE_DART_DELAY'
  | 'CASE_YAHOO_STALE'
  | 'CASE_MACRO_RISK_OFF'
  | 'CASE_STRONG_BUY_BLOCKED'
  | 'CASE_BUYLIST_EMPTY'
  | 'CASE_WATCHLIST_REFRESHED_BUT_NO_EXECUTION'
  | 'CASE_DATA_MISSING'
  | 'CASE_PROVIDER_HEALTH_BAD'
  | 'CASE_MARKET_SIGNAL_NEUTRAL'
  | 'CASE_PROGRAM_TRADING_EMPTY'
  | 'CASE_SCAN_DIAGNOSTIC_SUPPRESSED'
  | 'CASE_UNKNOWN';

export type ShadowExecutionImpact = 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'SHADOW_ONLY' | 'DEGRADED' | 'BLOCKING';
export type ShadowPostOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'PENDING' | 'INVALIDATED' | 'NOT_TRACKED';
export type ShadowCaseStatus = 'OPEN' | 'OUTCOME_PENDING' | 'RESOLVED' | 'IGNORED' | 'NEEDS_REVIEW';
export type DataHealth = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | 'AI_ESTIMATED' | 'UNKNOWN';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_APPLICABLE';
export type ShadowCaseSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface ShadowCaseItem {
  id: string;
  timestamp: string;
  symbol?: string;
  symbolName?: string;
  caseType: ShadowCaseType;
  marketSession?: string;
  engineMode: EngineMode;
  blockedReason?: string;
  dataProvider?: string;
  dataHealth: DataHealth;
  confidenceLevel: ConfidenceLevel;
  expectedDecision?: string;
  actualDecision?: string;
  shadowDecision?: string;
  executionImpact: ShadowExecutionImpact;
  providerIssue?: boolean;
  marketSignal?: boolean;
  postOutcome: ShadowPostOutcome;
  learningTag?: string;
  status: ShadowCaseStatus;
  nextAction?: string;
}

export interface ShadowCounterfactualOutcome {
  caseId: string;
  symbol: string;
  virtualEntryPrice?: number;
  virtualStopLoss?: number;
  virtualTargetPrice?: number;
  currentPrice?: number;
  maxFavorableExcursion?: number;
  maxAdverseExcursion?: number;
  returnPct?: number;
  outcome: ShadowPostOutcome;
  holdingDays?: number;
  lesson?: string;
}

export interface ShadowCaseLibraryResponse {
  status: {
    shadowLearning: boolean;
    engineMode: EngineMode;
    executionAllowed: boolean;
    shadowAllowed: boolean;
    lastCaseAt?: string;
  };
  items: ShadowCaseItem[];
  counterfactualOutcomes: ShadowCounterfactualOutcome[];
}
