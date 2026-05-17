// @responsibility Public report card contracts for blog/Telegram/paid-preview exports.

export type ViewMode = 'OPERATION_MODE' | 'PUBLIC_REPORT_MODE' | 'PAID_PREVIEW_MODE';

export type DataConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED';

export type ReportVisibility = 'PUBLIC' | 'PAID' | 'PRIVATE';

export type PublicDecisionStatus =
  | 'CONFIRMED_BUY'
  | 'BUY'
  | 'WATCH'
  | 'WAIT_PULLBACK'
  | 'HOLD'
  | 'SELL_ONLY'
  | 'BLOCKED'
  | 'DATA_INSUFFICIENT';

export interface DataConfidenceSummary {
  overall: DataConfidence;
  calculatedIndicatorCount: number;
  aiEstimatedIndicatorCount: number;
  missingIndicatorCount: number;
  providerIssue: boolean;
  marketSignal: boolean;
  notes: string[];
}

export interface DailyMarketGateCard {
  reportDate: string;
  marketSessionState: string;
  engineMode: 'NORMAL' | 'DEGRADED' | 'SELL_ONLY' | 'SHADOW_ONLY' | 'OBSERVE_ONLY';
  marketGateStatus: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'GRAY';
  macroHealthScore: number;
  newBuyAllowed: boolean;
  sellOnlyAllowed: boolean;
  shadowLearningAllowed: boolean;
  primaryReason: string;
  riskSummary: string;
  leadingSectorsTop3: string[];
  weakSectorsTop3: string[];
  tomorrowWatchPoints: string[];
}

export interface SectorRotationItem {
  sectorName: string;
  sectorScore: number;
  relativeStrengthRank: number;
  flowDirection: 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';
  trendChange: 'UP' | 'DOWN' | 'FLAT';
  sectorGateStatus: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'GRAY';
  reason: string;
  representativeStocks: string[];
  cautionFlags: string[];
}

export interface SectorRotationCard {
  reportDate: string;
  sectors: SectorRotationItem[];
  topSectors: SectorRotationItem[];
  weakSectors: SectorRotationItem[];
  summary: string;
}

export interface StockDecisionCard {
  stockCode: string;
  stockName: string;
  sector: string;
  finalDecision: PublicDecisionStatus;
  finalScore: number;
  gate0MacroStatus: string;
  gate1SurvivalResult: string;
  gate2GrowthResult: string;
  gate3TimingResult: string;
  calculatedIndicatorCount: number;
  aiEstimatedIndicatorCount: number;
  missingIndicatorCount: number;
  dataConfidenceSummary: DataConfidenceSummary;
  bullishReasons: string[];
  bearishReasons: string[];
  blockedReasons: string[];
  shadowRegistrationStatus: 'REGISTERED' | 'NOT_REGISTERED' | 'SHADOW_ONLY' | 'NOT_ALLOWED';
  executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'SELL_ONLY' | 'LIVE_EXECUTION_ALLOWED';
}

export interface BuyBlockReasonCard {
  stockName?: string;
  blockLevel: 'SOFT_BLOCK' | 'HARD_BLOCK' | 'TEMPORARY_WAIT' | 'DATA_INSUFFICIENT';
  failedGate:
    | 'GATE_0_MACRO'
    | 'GATE_1_SURVIVAL'
    | 'GATE_2_GROWTH'
    | 'GATE_3_TIMING'
    | 'DATA_CONFIDENCE'
    | 'RISK_CONTROL';
  blockedReasons: string[];
  riskFlags: string[];
  dataIssues: string[];
  requiredConditionsForReentry: string[];
  shadowOnlyAllowed: boolean;
  postOutcomeTrackingEnabled: boolean;
  executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'LIVE_EXECUTION_BLOCKED';
}

export interface ShadowPerformanceCard {
  period: string;
  totalShadowCandidates: number;
  openShadowPositions: number;
  targetHitCount: number;
  stopLossHitCount: number;
  breakEvenCount: number;
  pendingCount: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  averageHoldingDays: number;
  sampleSizeSufficiency: 'INSUFFICIENT' | 'WATCHING' | 'ENOUGH_FOR_REVIEW' | 'ENOUGH_FOR_TRANSITION';
  liveTransitionStatus: 'NOT_READY' | 'WATCHING' | 'PARTIAL_READY' | 'READY';
  improvementNotes: string[];
}

export interface PublicReportModel {
  reportId: string;
  reportDate: string;
  reportType:
    | 'DAILY_MARKET_GATE'
    | 'SECTOR_ROTATION'
    | 'STOCK_DECISION'
    | 'BUY_BLOCK'
    | 'SHADOW_PERFORMANCE'
    | 'DAILY_FULL_REPORT';
  visibility: ReportVisibility;
  marketGate?: DailyMarketGateCard;
  sectorRotation?: SectorRotationCard;
  stockDecision?: StockDecisionCard;
  buyBlock?: BuyBlockReasonCard;
  shadowPerformance?: ShadowPerformanceCard;
  markdownOutput: string;
  telegramOutput: string;
  publicSummary: string;
  paidPayload?: Record<string, unknown>;
  privatePayload?: Record<string, unknown>;
  generatedAt: string;
}
