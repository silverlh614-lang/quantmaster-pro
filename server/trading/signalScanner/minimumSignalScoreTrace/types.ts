// @responsibility ADR-0466 Minimum Signal Score Decomposition 진단 타입 계약 SSOT (advisory-only, 매매 미관여).

export type SignalScoreComponentCode =
  | "PRICE_MOMENTUM"
  | "VOLUME_LIQUIDITY"
  | "TECHNICAL_TREND"
  | "RELATIVE_STRENGTH"
  | "WATCHLIST_UPSTREAM_SCORE"
  | "BREAKOUT_STRUCTURE"
  | "SUPPLY_CONFLUENCE"
  | "INVESTOR_FLOW"
  | "SECTOR_ENERGY"
  | "MARKET_REGIME"
  | "MACRO_RISK"
  | "DATA_QUALITY"
  | "SESSION_STATUS"
  | "NEWS_OR_CATALYST"
  | "WATCHLIST_PRIORITY"
  | "RISK_PENALTY"
  | "UNKNOWN_DATA_PENALTY"
  | "SOFT_FAIL_PENALTY"
  // Patch-B: ADR-0467 ADVISORY_SIGNAL 범위 컴포넌트 — Gate1 hard block 미관여, score=0 graceful.
  | "SECTOR_RELATIVE_STRENGTH"
  | "GHOST_SIGNAL_STRENGTH"
  | "OTHER";

export type SignalScoreComponentConfidence =
  | "VERIFIED"
  | "DEGRADED"
  | "STALE"
  | "UNKNOWN"
  | "MISSING"
  | "DIAGNOSTIC_ONLY";

export interface SignalScoreComponentTrace {
  code: SignalScoreComponentCode;
  rawValue?: unknown;
  normalizedScore: number;
  weight: number;
  weightedScore: number;
  maxScore: number;
  contributionPct: number;
  confidence: SignalScoreComponentConfidence;
  providerIssue: boolean;
  marketSignal: boolean;
  penaltyApplied: boolean;
  penaltyReason?: string;
  message: string;
}

export interface MinimumSignalScoreTrace {
  symbol: string;
  name?: string;
  requiredScore: number;
  actualScore: number;
  scoreGap: number;
  passed: boolean;
  components: SignalScoreComponentTrace[];
  positiveScoreTotal: number;
  penaltyTotal: number;
  unknownPenaltyTotal: number;
  providerIssuePenaltyTotal: number;
  sessionPenaltyTotal: number;
  sectorPenaltyTotal: number;
  riskPenaltyTotal: number;
  softFailPenaltyTotal: number;
  topMissingContributors: string[];
  topPenaltyContributors: string[];
  wouldPassIfUnknownNeutral: boolean;
  wouldPassIfProviderPenaltyRemoved: boolean;
  wouldPassIfSessionPenaltyRemoved: boolean;
  wouldPassIfRiskPenaltyCapped: boolean;
  wouldPassIfSectorPenaltyRemoved: boolean;
  wouldPassIfSoftFailPenaltyRemoved: boolean;
}

export type UnknownDataTreatment =
  | "NEUTRAL"
  | "EXCLUDED_FROM_DENOMINATOR"
  | "ZERO_SCORE"
  | "PENALTY"
  | "BEARISH_EQUIVALENT";

export interface UnknownDataTreatmentAudit {
  symbol: string;
  unknownFields: {
    field: string;
    treatment: UnknownDataTreatment;
    scoreImpact: number;
    allowed: boolean;
    message: string;
  }[];
  hasBearishEquivalentUnknown: boolean;
  totalUnknownScoreImpact: number;
}

export type SoftFailCode =
  | "PROVIDER_UNKNOWN"
  | "SUPPLY_UNKNOWN"
  | "SECTOR_DIAGNOSTIC"
  | "MIN_SIGNAL_GAP"
  | "DATA_STALE"
  | "RISK_PENALTY"
  | "SESSION_SOFT_BLOCK"
  | "LOW_CONFIDENCE"
  | "OTHER";

export interface SoftFailAccumulationTrace {
  symbol: string;
  softFails: {
    code: SoftFailCode;
    weight: number;
    severityScore: number;
    reason: string;
    providerIssue: boolean;
    marketSignal: boolean;
  }[];
  totalSoftFailScore: number;
  softFailThreshold: number;
  failedBySoftAccumulation: boolean;
  wouldPassIfProviderSoftFailsExcluded: boolean;
  wouldPassIfSessionSoftFailsExcluded: boolean;
  wouldPassIfSectorSoftFailsExcluded: boolean;
  wouldPassIfRiskSoftFailsCapped: boolean;
}

export interface RiskPenaltyTrace {
  symbol: string;
  regimeMultiplier: number;
  fomcMultiplier: number;
  sectorMultiplier: number;
  riskMultiplier: number;
  finalKelly: number;
  signalScoreRiskPenalty: number;
  sizingRiskPenalty: number;
  doubleCountWarning: boolean;
  wouldPassIfRiskPenaltyCapped: boolean;
}

export type SignalScoreCalibrationScenario =
  | "UNKNOWN_NEUTRAL"
  | "PROVIDER_PENALTY_REMOVED"
  | "SESSION_PENALTY_REMOVED"
  | "RISK_PENALTY_CAPPED"
  | "SECTOR_PENALTY_REMOVED"
  | "SOFT_FAIL_PENALTY_REMOVED"
  | "MIN_SIGNAL_THRESHOLD_MINUS_5"
  | "MIN_SIGNAL_THRESHOLD_MINUS_10"
  | "R3_EARLY_ADAPTIVE_THRESHOLD";

export interface SignalScoreCalibrationResult {
  scenario: SignalScoreCalibrationScenario;
  hypotheticalSurvivors: number;
  survivorExamples: {
    symbol: string;
    name?: string;
    actualScore: number;
    adjustedScore: number;
    requiredScore: number;
    reason: string[];
  }[];
  executionImpact: "NONE";
}

export interface MinSignalScoreDecompositionReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  minSignalFailed: number;
  requiredScoreAvg: number;
  actualScoreAvg: number;
  actualScoreMin: number;
  actualScoreMax: number;
  avgScoreGap: number;
  topScoreDeficits: {
    code: SignalScoreComponentCode;
    avgImpact: number;
    affectedCount: number;
  }[];
  topPenaltyContributors: {
    code: SignalScoreComponentCode;
    avgPenalty: number;
    affectedCount: number;
  }[];
  unknownTreatmentWarnings: number;
  wouldPassIfUnknownNeutral: number;
  wouldPassIfProviderPenaltyRemoved: number;
  wouldPassIfSessionPenaltyRemoved: number;
  wouldPassIfRiskPenaltyCapped: number;
  wouldPassIfSoftFailPenaltyRemoved: number;
  recommendedAction:
    | "NO_ACTION"
    | "DIAGNOSTIC_ONLY"
    | "FIX_UNKNOWN_TREATMENT"
    | "REMOVE_SESSION_FROM_SIGNAL_SCORE"
    | "CAP_RISK_PENALTY"
    | "REVIEW_MIN_SIGNAL_THRESHOLD"
    | "REVIEW_SOFT_FAIL_ACCUMULATION";
}
