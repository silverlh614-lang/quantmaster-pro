// @responsibility KIS SectorEnergy provider public type declarations (extracted, byte-equivalent; ADR-0587).

import type { SectorKey } from '../sectorEnergyMaster.js';
import type { KisChartCandle } from '../../screener/kisChartDataFetcher.js';
import type { KisInvestorTradeByStockDaily } from '../kisClient/index.js';
import type { SectorIndexCodeVerificationMatchedBy } from '../kisSectorIndexCodeVerifier.js';
import type { SectorEnergyDataQuality, SectorEnergyInput } from '../sectorEnergyProvider.js';
import type { KisRepresentativeBasketAudit, SectorEnergyCoverageBreakdown } from '../sectorEnergyQualityDiagnostic.js';

export type KisSectorEnergySourceTier =
  | 'KIS_OFFICIAL_INDEX'
  | 'KIS_OFFICIAL_DAILY'
  | 'KIS_STOCK_BASKET_DERIVED'
  | 'MISSING';

export type KisSectorEnergyLeadershipConfidence =
  | 'WEIGHTED'
  | 'READY_FOR_SHADOW'
  | 'PARTIAL'
  | 'BLOCKED';

export interface KisSectorEnergyCoverageBreakdown {
  totalSectors: number;
  verifiedIndexCodeCount: number;
  verifiedIndexCodeCoverage: number;
  kisOfficialCount: number;
  kisOfficialCoverage: number;
  kisBasketCount: number;
  kisBasketCoverage: number;
  internalProxyCount: number;
  internalProxyCoverage: number;
  stockDailyFallbackCount: number;
  stockDailyFallbackCoverage: number;
  yahooGlobalProxyCount: number;
  yahooGlobalProxyCoverage: number;
}

export interface KisSectorBasketRow {
  sectorKey: string;
  displayName: string;
  representativeCodes: string[];
  validPriceCount: number;
  return1d?: number;
  return5d?: number;
  return20d?: number;
  turnoverAcceleration?: number;
  breadthAbove20ma?: number;
  source: 'KIS_PRICE' | 'KIS_DAILY_CHART';
  confidence: 'PARTIAL' | 'VERIFIED';
}

export interface KisSectorEnergyIndexRow {
  sectorKey: SectorKey;
  sectorReturn5d: number;
  sectorReturn20d: number;
  turnoverAcceleration?: number;
  breadthAbove20ma?: number;
  foreignInstitutionFlowAlignment?: number;
  sectorRelativeStrengthVsKospi?: number;
  sectorRelativeStrengthVsKosdaq?: number;
  leadingStockCount?: number;
  topConstituentMomentum?: number;
  sourceTier?: Extract<KisSectorEnergySourceTier, 'KIS_OFFICIAL_INDEX' | 'KIS_OFFICIAL_DAILY'>;
}

export type SectorIndexVerificationStatus =
  | 'NO_ALIAS_FOUND'
  | 'SAFE_ALIAS_CANDIDATE_FOUND'
  | 'UNSAFE_ALIAS_REJECTED'
  | 'PENDING_IDXCODE_MST_VERIFY'
  | 'VERIFIED'
  | 'UNRESOLVED';

export type KisSectorIndexDryRunErrorClass =
  | 'EMPTY'
  | 'INVALID_CODE'
  | 'PROVIDER_500'
  | 'TIMEOUT'
  | 'DISABLED'
  | 'INSUFFICIENT_SERIES'
  | 'UNRESOLVED_EMPTY';

export interface KisSectorIndexDryRunRow {
  sectorKey: SectorKey;
  iscd: string;
  previousIscd?: string;
  label: string;
  success: boolean;
  seriesCount: number;
  latestDate?: string;
  return5d?: number;
  return20d?: number;
  turnoverAcceleration?: number;
  providerIssue?: boolean;
  marketSignal?: false;
  verificationStatus?: SectorIndexVerificationStatus | 'NOT_REQUIRED';
  verificationAction?: string;
  resolutionStatus?: 'PENDING_IDXCODE_MST_VERIFY' | 'REQUIRES_IDXCODE_MST_LOOKUP' | 'IDXCODE_MST_VERIFIED' | 'IDXCODE_MST_NOT_FOUND' | 'ENDPOINT_COMPATIBILITY_FAILED' | 'UNRESOLVED_EMPTY' | 'NONE';
  safeAliasCandidate?: { sectorKey: SectorKey; displayName: string; krxIndexCode: string };
  aliasCandidates?: string[];
  verifiedName?: string;
  matchedBy?: SectorIndexCodeVerificationMatchedBy;
  errorClass?: KisSectorIndexDryRunErrorClass;
  useForProduction?: false;
  useForDryRun?: boolean;
  error?: string;
}

export interface KisSectorIndexDryRunReport {
  enabled: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
  rows: KisSectorIndexDryRunRow[];
  sourceTier: 'KIS_SECTOR_INDEX_DAILY_DRYRUN';
  dataQuality: 'PARTIAL';
  officialBenchmark: false;
  sectorBoostAllowed: false;
  strongBuyAllowed: false;
  executionImpact: 'NONE';
  marketSignal: false;
  providerIssue: boolean;
  candidateCoverage: number;
  promotionStage: 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY' | 'WEIGHTED' | 'GATED' | 'CORE';
  promotionBlockedReason: 'OBSERVE_20D_REQUIRED' | 'SHADOW_SCORE_CANDIDATE_MANUAL_AUDIT_REQUIRED';
  daysCollected: number;
  promotionHistoryRecorded: boolean;
}

export interface SectorIdxcodeMasterRow {
  iscd: string;
  koreanName: string;
  englishKey?: string;
  aliases?: string[];
}

export interface SectorIndexCodeMasterVerificationResult {
  verification: 'VERIFIED' | 'UNRESOLVED';
  resolutionStatus: 'IDXCODE_MST_VERIFIED' | 'IDXCODE_MST_NOT_FOUND';
  useForProduction: false;
  useForDryRun: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  matchedBy?: 'EXACT_ISCD' | 'KOREAN_NAME' | 'ENGLISH_SECTOR_KEY' | 'ALIAS' | 'ENDPOINT_COMPATIBILITY_DRY_RUN';
  matchedIscd?: string;
  matchedName?: string;
}

export interface KisSectorEnergyProviderOverrides {
  fetchOfficialIndexRows?: () => Promise<KisSectorEnergyIndexRow[]>;
  fetchOfficialDailyRows?: () => Promise<KisSectorEnergyIndexRow[]>;
  fetchCandles?: (code: string) => Promise<KisChartCandle[]>;
  fetchInvestorFlow?: (code: string) => Promise<KisInvestorTradeByStockDaily | null>;
  now?: () => Date;
}

export interface KisSectorEnergyProviderResult {
  inputs: SectorEnergyInput[];
  dataQuality: SectorEnergyDataQuality;
  validSectorCount: number;
  totalSectorCount: number;
  sourceTier: KisSectorEnergySourceTier;
  confidence: number;
  leadershipConfidence: KisSectorEnergyLeadershipConfidence;
  coverageBreakdown: KisSectorEnergyCoverageBreakdown;
  selectedSectors: string[];
  providerIssue: boolean;
  marketSignal: false;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  reasons: string[];
  diagnostics: string[];
  recoveryAudit?: KisRepresentativeBasketAudit;
  sectorCoverageBreakdown?: SectorEnergyCoverageBreakdown;
}
