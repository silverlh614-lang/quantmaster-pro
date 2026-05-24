// @responsibility Public report card contracts for blog/Telegram/paid-preview exports.

export type ViewMode = 'OPERATION_MODE' | 'PUBLIC_REPORT_MODE' | 'PAID_PREVIEW_MODE';

export type DataConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED'
  | 'UNKNOWN';

export type ReportVisibility = 'PUBLIC' | 'PAID' | 'PRIVATE';

export type MarketGateStatus = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'GRAY';
export type SectorGateStatus = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'GRAY';
export type FlowDirection = 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';
export type TrendChange = 'UP' | 'DOWN' | 'FLAT';
export type SectorAlignment =
  | 'LEADING_SECTOR'
  | 'WATCH_SECTOR'
  | 'NEUTRAL_SECTOR'
  | 'WEAK_SECTOR'
  | 'AVOID_SECTOR';

export type PublicDecisionStatus =
  | 'CONFIRMED_CANDIDATE'
  | 'BUY_CANDIDATE'
  | 'WATCH'
  | 'WAIT_PULLBACK'
  | 'HOLD'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'BLOCKED'
  | 'DATA_INSUFFICIENT';

export type PublicDecisionDisplay =
  | 'CONFIRMED_CANDIDATE'
  | 'BUY_CANDIDATE'
  | 'WATCH'
  | 'WAIT_PULLBACK'
  | 'HOLD'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'BLOCKED'
  | 'DATA_INSUFFICIENT';

export type GateStatus =
  | 'PASS'
  | 'WATCH'
  | 'WAIT'
  | 'BLOCKED'
  | 'DATA_INSUFFICIENT'
  | 'NOT_EVALUATED';

export type ShadowTrackingStatus =
  | 'OFF'
  | 'ON'
  | 'REGISTERED'
  | 'PAPER_FILLED'
  | 'OPEN'
  | 'CLOSED'
  | 'BLOCKED_BUT_TRACKED';

export interface GateSummary {
  name: string;
  status: GateStatus;
  passed: number;
  total: number;
  primaryReason?: string;
}

export interface CandidateDecisionSummary {
  totalCandidates: number;
  confirmedCandidateCount: number;
  buyCandidateCount: number;
  watchCount: number;
  waitPullbackCount: number;
  blockedCount: number;
  dataInsufficientCount: number;
  sellOnlyCount: number;
  shadowOnlyCount: number;
  shadowTrackingCount: number;
  holdCount: number;
}

export interface DataConfidenceSummary {
  overall: DataConfidence;
  calculatedIndicatorCount: number;
  aiEstimatedIndicatorCount: number;
  missingIndicatorCount: number;
  providerIssue: boolean;
  marketSignal: boolean;
  notes: string[];
}

export interface CandidateSectorAlignment {
  sectorName: string;
  sectorScore: number;
  sectorRank: number;
  isLeadingSector: boolean;
  sectorAlignment: SectorAlignment;
  sectorPenaltyApplied: boolean;
  sectorBonusApplied: boolean;
}

export interface DailyMarketGateCard {
  reportDate: string;
  sourceSnapshotId: string;
  asOf: string;
  marketSessionState: string;
  engineMode: 'NORMAL' | 'DEGRADED' | 'SELL_ONLY' | 'SHADOW_ONLY' | 'OBSERVE_ONLY';
  marketGateStatus: MarketGateStatus;
  macroHealthScore: number;
  newBuyAllowed: boolean;
  liveExecutionAllowed: boolean;
  sellOnlyAllowed: boolean;
  shadowLearningAllowed: boolean;
  primaryReason: string;
  riskSummary: string;
  providerIssue: boolean;
  marketSignal: boolean;
  executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'LIVE_EXECUTION_BLOCKED' | 'LIVE_EXECUTION_ALLOWED';
  dataConfidenceSummary: DataConfidenceSummary;
  leadingSectorsTop3: string[];
  weakSectorsTop3: string[];
  tomorrowWatchPoints: string[];
}

export interface SectorRotationItem {
  sectorName: string;
  sectorScore: number;
  relativeStrengthRank: number;
  flowDirection: FlowDirection;
  trendChange: TrendChange;
  sectorGateStatus: SectorGateStatus;
  reason: string;
  representativeStocks: string[];
  cautionFlags: string[];
  dataConfidence: DataConfidence;
  alignment: SectorAlignment;
}

export interface SectorRotationCard {
  reportDate: string;
  sourceSnapshotId: string;
  asOf: string;
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
  displayDecision: PublicDecisionDisplay;
  finalScore: number;
  sourceSnapshotId: string;
  asOf: string;
  gate0: GateSummary;
  gate1: GateSummary;
  gate2: GateSummary;
  gate3: GateSummary;
  gate0MacroStatus: string;
  gate1SurvivalResult: string;
  gate2GrowthResult: string;
  gate3TimingResult: string;
  sectorAlignment: CandidateSectorAlignment;
  calculatedIndicatorCount: number;
  aiEstimatedIndicatorCount: number;
  missingIndicatorCount: number;
  dataConfidenceSummary: DataConfidenceSummary;
  dataConfidence: DataConfidenceSummary;
  positiveDrivers: string[];
  riskDrivers: string[];
  bullishReasons: string[];
  bearishReasons: string[];
  blockedReasons: string[];
  nextCheckConditions: string[];
  nextAction: string[];
  confluenceAxes: {
    id: 'FUNDAMENTAL' | 'FLOW' | 'TECHNICAL' | 'MACRO';
    score: number;
    reason?: string;
  }[];
  shadowRegistrationStatus: 'REGISTERED' | 'NOT_REGISTERED' | 'SHADOW_ONLY' | 'NOT_ALLOWED';
  shadowTrackingStatus: ShadowTrackingStatus;
  liveExecutionAllowed: boolean;
  engineMode: DailyMarketGateCard['engineMode'];
  executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'LIVE_EXECUTION_ALLOWED' | 'LIVE_EXECUTION_BLOCKED';
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
  sourceSnapshotId: string;
  asOf: string;
  blogTitle: string;
  oneLineSummary: string;
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
  candidateSummary: CandidateDecisionSummary;
  dataConfidenceSummary: DataConfidenceSummary;
  blogMarkdown: string;
  blogHtml: string;
  blogTags: string[];
  telegramSummary: string;
  markdownOutput: string;
  telegramOutput: string;
  publicSummary: string;
  paidPayload?: Record<string, unknown>;
  privatePayload?: Record<string, unknown>;
  generatedAt: string;
}

export interface PublicReportSnapshot {
  reportId: string;
  reportDate: string;
  sourceSnapshotId: string;
  asOf: string;
  reportType: PublicReportModel['reportType'];
  visibility: ReportVisibility;
  marketGate?: DailyMarketGateCard;
  sectorRotation?: SectorRotationCard;
  candidateSummary: CandidateDecisionSummary;
  representativeCandidates: StockDecisionCard[];
  buyBlockSummary?: BuyBlockReasonCard;
  shadowPerformance?: ShadowPerformanceCard;
  blogTitle: string;
  blogMarkdown: string;
  blogHtml: string;
  blogTags: string[];
  telegramSummary: string;
  generatedAt: string;
  generatedBy: 'PUBLIC_REPORT_MODE';
}

export interface PublicReportSnapshotListItem {
  reportId: string;
  reportDate: string;
  reportType: PublicReportModel['reportType'];
  marketGateStatus: MarketGateStatus | 'UNKNOWN';
  topSectors: string[];
  candidateCount: number;
  blockedCount: number;
  shadowCount: number;
  sourceSnapshotId: string;
  generatedAt: string;
}
