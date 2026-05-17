/**
 * @responsibility Advisory screener typed contract
 */

export type ScreenerMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'UNKNOWN';
export type AdvisoryStage = 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY';

export type DataConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED'
  | 'UNKNOWN';

export type DataConfidenceSummary = {
  verified: number;
  degraded: number;
  stale: number;
  missing: number;
  aiEstimated: number;
  unknown: number;
};

export interface ScreenerConfig {
  minMarketCapKrw: number;
  minAvgTradingValue20dKrw: number;
  excludeNegativeEarnings: boolean;
  excludeManagedStocks: boolean;
  excludeTradingHalt: boolean;
  volumeSpikeRatio: number;
  nearHigh52wRatio: number;
  maxDistanceFromMa20Pct?: number;
  minRelativeStrengthPct?: number;
  maxCandidatesForAiAnalysis: number;
  allowedStages: AdvisoryStage[];
}

export const QuantScreenerReason = {
  RejectMarketCapTooSmall: 'REJECT_MARKET_CAP_TOO_SMALL',
  RejectAvgTradingValueTooLow: 'REJECT_AVG_TRADING_VALUE_TOO_LOW',
  RejectPriceDataMissing: 'REJECT_PRICE_DATA_MISSING',
  RejectNegativeEarnings: 'REJECT_NEGATIVE_EARNINGS',
  RejectManagedStock: 'REJECT_MANAGED_STOCK',
  RejectTradingHalt: 'REJECT_TRADING_HALT',
  RejectCoreDataMissing: 'REJECT_CORE_DATA_MISSING',
  RejectNoAbnormalSignal: 'REJECT_NO_ABNORMAL_SIGNAL',
  RejectTooExtendedFromMa20: 'REJECT_TOO_EXTENDED_FROM_MA20',
  PassQuantFilter: 'PASS_QUANT_FILTER',
  PassVolumeSpike: 'PASS_VOLUME_SPIKE',
  PassNear52wHigh: 'PASS_NEAR_52W_HIGH',
  PassRelativeStrength: 'PASS_RELATIVE_STRENGTH',
  PassInstitutionForeignFlow: 'PASS_INSTITUTION_FOREIGN_FLOW',
  PendingInstitutionForeignFlow: 'PENDING_INSTITUTION_FOREIGN_FLOW_NOT_AVAILABLE',
  PendingVcp: 'PENDING_VCP_NOT_AVAILABLE',
  PendingRelativeStrength: 'PENDING_RELATIVE_STRENGTH_NOT_AVAILABLE',
} as const;

export type QuantScreenerReasonCode = typeof QuantScreenerReason[keyof typeof QuantScreenerReason];

export interface ScreenerDataPoint<T> {
  value: T | null | undefined;
  confidence: DataConfidence;
  source?: string;
  updatedAt?: string;
}

export interface ScreenerUniverseItem {
  symbol: string;
  name: string;
  market?: ScreenerMarket;
  sector?: string;
  marketCapKrw?: ScreenerDataPoint<number>;
  avgTradingValue20dKrw?: ScreenerDataPoint<number>;
  latestClose?: ScreenerDataPoint<number>;
  per?: ScreenerDataPoint<number>;
  isManaged?: ScreenerDataPoint<boolean>;
  isTradingHalt?: ScreenerDataPoint<boolean>;
  volume?: ScreenerDataPoint<number>;
  avgVolume20d?: ScreenerDataPoint<number>;
  high52w?: ScreenerDataPoint<number>;
  ma20?: ScreenerDataPoint<number>;
  relativeStrengthPct?: ScreenerDataPoint<number>;
  institutionForeignNetBuy3d?: ScreenerDataPoint<boolean>;
  volatilityContraction?: ScreenerDataPoint<boolean>;
  providerIssues?: string[];
  missingData?: string[];
}

export interface QuantFilterRecord {
  item: ScreenerUniverseItem;
  passedQuantFilter: boolean;
  quantScore: number;
  reasons: string[];
  risks: string[];
  missingData: string[];
  dataConfidence: DataConfidenceSummary;
  providerIssue: boolean;
}

export interface AbnormalSignalRecord extends QuantFilterRecord {
  passedAbnormalSignalFilter: boolean;
  abnormalSignalScore: number;
  marketSignal: boolean;
  signalState: 'PROVIDER_ISSUE' | 'MARKET_SIGNAL' | 'MIXED' | 'NONE';
}

export interface AdvisoryScreenerCandidate {
  symbol: string;
  name: string;
  market?: ScreenerMarket;
  sector?: string;
  stage: AdvisoryStage;
  passedQuantFilter: boolean;
  passedAbnormalSignalFilter: boolean;
  quantScore?: number;
  abnormalSignalScore?: number;
  totalAdvisoryScore?: number;
  reasons: string[];
  risks: string[];
  missingData: string[];
  dataConfidence: DataConfidenceSummary;
  providerIssue: boolean;
  marketSignal: boolean;
  aiEstimatedFields: string[];
  aiAnalysis?: {
    summary: string;
    possibleCatalysts: string[];
    cautionPoints: string[];
    followUpChecks: string[];
    confidence: 'AI_ESTIMATED';
  };
  createdAt: string;
  updatedAt: string;
}

export interface AdvisoryScreenerResult {
  candidates: AdvisoryScreenerCandidate[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  shadowLearning: true;
  telemetry: {
    universeTotal: number;
    quantPassed: number;
    quantRejected: number;
    abnormalPassed: number;
    aiAnalyzed: number;
    aiSkippedReason?: 'NO_CANDIDATES' | 'AI_DISABLED';
    learningTags: string[];
  };
  createdAt: string;
}
