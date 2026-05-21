// @responsibility Gate2 diagnostic schema surface.

import type { ConditionKey, GateLayerName, ServerGateResult } from '../../quantFilter.js';
import type { KisInvestorFlow } from '../../clients/kisClient.js';
import type { DartFinancials } from '../../clients/dartFinancialClient.js';
import {
  KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS,
} from '../../clients/kisClient/kisOfficialEndpointRegistry.js';
import type {
  KisInvestorFlowConfidence,
  KisInvestorFlowDriftDiagnostic,
  KisInvestorFlowEndpointKey,
  KisInvestorFlowProviderStatus,
  KisInvestorFlowRawFieldCoverage,
  QmpInvestorFlow,
} from '../../clients/kisClient/kisOfficialInvestorFlowMapper.js';
import type {
  KisProgramFlowDriftDiagnostic,
  KisProgramFlowRawFieldCoverage,
  KisProgramTradeConfidence,
  KisProgramTradeProviderStatus,
  QmpProgramFlow,
} from '../../clients/kisClient/kisOfficialProgramFlowMapper.js';
import type {
  DartFinancialConfidence,
  DartFinancialProviderStatus,
  DartFinancialRawFieldCoverage,
  QmpDartFinancials,
} from '../../clients/dartFinancialNormalizer.js';
import {
  normalizeBenchmarkReturnForGate2,
  type BenchmarkConfidence,
  type BenchmarkKey,
  type BenchmarkMarket,
  type BenchmarkProviderStatus,
  type BenchmarkRawFieldCoverage,
  type BenchmarkReturnSource,
  type QmpBenchmarkReturn,
} from '../../clients/benchmarkReturnNormalizer.js';
import {
  normalizeSectorThemeCycleForGate2,
  type AttentionPhase,
  type LeaderCyclePhase,
  type QmpSectorThemeCycle,
  type SectorCycleMarket,
  type SectorThemeCycleConfidence,
  type SectorThemeCycleProviderStatus,
  type SectorThemeCycleRawFieldCoverage,
  type SectorThemeCycleSource,
} from '../../clients/sectorThemeLeaderCycleNormalizer.js';

export type GateEvaluatorOutput = NonNullable<ServerGateResult['outputs']>[number];

export type Gate2WiringStatus =
  | 'FIRED'
  | 'THRESHOLD_NOT_MET'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_DEGRADED'
  | 'ERROR';

export type Gate2DataPath =
  | 'QUOTE_ONLY'
  | 'KIS'
  | 'DART'
  | 'BENCHMARK'
  | 'KIS_DART'
  | 'QUOTE_BENCHMARK'
  | 'MIXED'
  | 'UNKNOWN';

export interface Gate2WiringDiagnostic {
  key: string;
  layer: 'gate2';
  status: Gate2WiringStatus;
  inputs: string[];
  quoteInputs: string[];
  kisInputs: string[];
  dartInputs: string[];
  benchmarkInputs: string[];
  missingInputs: string[];
  availableInputs: string[];
  requiredExternalData: string[];
  missingExternalData: string[];
  dataPath: Gate2DataPath;
  providerIssue: boolean;
  marketSignal: false;
  diagnosticOnly: true;
}

export interface Gate2SourceCoverage {
  conditionCount: number;
  quoteInputCount: number;
  kisInputCount: number;
  dartInputCount: number;
  benchmarkInputCount: number;
  requiredExternalData: string[];
  missingInputs: string[];
  missingExternalData: string[];
  providerIssues: string[];
  allDeclaredInputsAvailable: boolean;
  allExternalDataAvailable: boolean;
  marketSignal: false;
  diagnosticOnly: true;
}

export type Gate2ExternalProviderStatus =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'DEGRADED'
  | 'MISSING'
  | 'EMPTY_VALID'
  | 'STALE'
  | 'STAGE_NOT_FETCHED'
  | 'UNKNOWN';

export type Gate2EvaluationStage = 'DISCOVERY_GATE' | 'REFRESHED_GATE' | 'ENTRY_RECHECK_GATE' | string;

export type Gate2RiskPressure = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

export interface Gate2ExternalDataCoverage {
  kisInvestorFlow: {
    required: boolean;
    available: boolean;
    provider: 'KIS_OFFICIAL' | 'KIS_API' | 'CACHE' | 'UNKNOWN';
    endpointKey: KisInvestorFlowEndpointKey | 'UNKNOWN';
    endpoint: string | null;
    trId: string | null;
    providerStatus: KisInvestorFlowProviderStatus | null;
    dataConfidence: KisInvestorFlowConfidence | null;
    status: Gate2ExternalProviderStatus;
    fields: {
      foreignNetBuy: boolean;
      institutionalNetBuy: boolean;
      individualNetBuy: boolean;
    };
    foreignNetBuy: number | null;
    institutionalNetBuy: number | null;
    individualNetBuy: number | null;
    missingFields: string[];
    rawFieldCoverage: KisInvestorFlowRawFieldCoverage;
    driftDiagnostics: KisInvestorFlowDriftDiagnostic[];
    stageNotFetched: boolean;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  };
  dartFinancials: {
    required: boolean;
    available: boolean;
    provider: 'DART' | 'DART_CACHE' | 'QMP_CACHE' | 'UNKNOWN';
    providerStatus: DartFinancialProviderStatus | null;
    dataConfidence: DartFinancialConfidence | null;
    status: Gate2ExternalProviderStatus;
    fields: {
      operatingCashFlow: boolean;
      netIncome: boolean;
      ocfRatio: boolean;
      roe: boolean;
      opm: boolean;
      opmYoYDelta: boolean;
      marginAcceleration: boolean;
      interestCoverageRatio: boolean;
    };
    ocfRatio: number | null;
    roe: number | null;
    opm: number | null;
    opmYoYDelta: number | null;
    marginAcceleration: number | null;
    interestCoverageRatio: number | null;
    missingFields: string[];
    rawFieldCoverage: DartFinancialRawFieldCoverage;
    stageNotFetched: boolean;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  };
  benchmark: {
    required: boolean;
    available: boolean;
    provider: BenchmarkReturnSource;
    providerStatus: BenchmarkProviderStatus | null;
    dataConfidence: BenchmarkConfidence | null;
    status: Gate2ExternalProviderStatus;
    market: BenchmarkMarket;
    benchmarkKey: BenchmarkKey;
    period: '20D';
    fields: {
      stockReturn20d: boolean;
      benchmarkReturn20d: boolean;
      relativeReturn20d: boolean;
      kospi20dReturn: boolean;
      kosdaq20dReturn: boolean;
    };
    values: {
      stockReturn20d: number | null;
      benchmarkReturn20d: number | null;
      relativeReturn20d: number | null;
    };
    missingFields: string[];
    rawFieldCoverage: BenchmarkRawFieldCoverage;
    stageNotFetched: boolean;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    notes: string[];
  };
  programTrade: {
    required: false;
    available: boolean;
    provider: 'KIS_OFFICIAL' | 'KIS_API' | 'CACHE' | 'UNKNOWN';
    marketProgram: {
      available: boolean;
      endpointKey: 'COMP_PROGRAM_TRADE_TODAY' | 'UNKNOWN';
      endpoint: string | null;
      trId: string | null;
      providerStatus: KisProgramTradeProviderStatus | null;
      dataConfidence: KisProgramTradeConfidence | null;
      status: Gate2ExternalProviderStatus;
      scope: 'MARKET';
      fields: {
        programNetBuyAmount: boolean;
        arbitrageNetBuyAmount: boolean;
        nonArbitrageNetBuyAmount: boolean;
      };
      values: {
        programNetBuyAmount: number | null;
        arbitrageNetBuyAmount: number | null;
        nonArbitrageNetBuyAmount: number | null;
      };
      rawFieldCoverage: KisProgramFlowRawFieldCoverage;
      driftDiagnostics: KisProgramFlowDriftDiagnostic[];
      stageNotFetched: boolean;
      providerIssue: boolean;
      marketSignal: false;
    };
    stockProgram: {
      available: boolean;
      endpointKey: 'PROGRAM_TRADE_BY_STOCK_DAILY' | 'UNKNOWN';
      endpoint: string | null;
      trId: string | null;
      providerStatus: KisProgramTradeProviderStatus | null;
      dataConfidence: KisProgramTradeConfidence | null;
      status: Gate2ExternalProviderStatus;
      scope: 'STOCK';
      fields: {
        programNetBuyAmount: boolean;
        programNetBuyVolume: boolean;
      };
      values: {
        programNetBuyAmount: number | null;
        programNetBuyVolume: number | null;
      };
      rawFieldCoverage: KisProgramFlowRawFieldCoverage;
      driftDiagnostics: KisProgramFlowDriftDiagnostic[];
      stageNotFetched: boolean;
      providerIssue: boolean;
      marketSignal: false;
    };
    scopeSeparationValid: boolean;
    notes: string[];
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    marketSignal: false;
  };
  riskFlow: {
    required: false;
    available: boolean;
    provider: 'KIS_OFFICIAL' | 'KIS_API' | 'KRX_CACHE' | 'QMP_CACHE' | 'CACHE' | 'UNKNOWN';
    status: Gate2ExternalProviderStatus;
    fields: {
      shortPressure: boolean;
      loanPressure: boolean;
      creditOverheat: boolean;
    };
    values: {
      shortSaleIncreaseRate: number | null;
      loanIncreaseRate: number | null;
      creditIncreaseRate: number | null;
      creditBalanceRatio: number | null;
    };
    interpretation: {
      shortPressure: Gate2RiskPressure;
      loanPressure: Gate2RiskPressure;
      creditOverheat: Gate2RiskPressure;
      overallRisk: Gate2RiskPressure;
    };
    notes: string[];
    stageNotFetched: boolean;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    diagnosticOnly: true;
  };
  sectorCycle: {
    required: boolean;
    available: boolean;
    provider: SectorThemeCycleSource;
    providerStatus: SectorThemeCycleProviderStatus | null;
    dataConfidence: SectorThemeCycleConfidence | null;
    status: Gate2ExternalProviderStatus;
    symbol: string;
    sector: string | null;
    industry: string | null;
    themeTags: string[];
    market: SectorCycleMarket;
    fields: {
      sector: boolean;
      industry: boolean;
      themeTags: boolean;
      sectorReturn20d: boolean;
      sectorReturn60d: boolean;
      benchmarkReturn20d: boolean;
      benchmarkReturn60d: boolean;
      sectorRelativeReturn20d: boolean;
      sectorRelativeReturn60d: boolean;
      stockReturn20d: boolean;
      stockReturn60d: boolean;
      stockVsSectorReturn20d: boolean;
      stockVsSectorReturn60d: boolean;
    };
    values: {
      sectorReturn20d: number | null;
      sectorReturn60d: number | null;
      benchmarkReturn20d: number | null;
      benchmarkReturn60d: number | null;
      sectorRelativeReturn20d: number | null;
      sectorRelativeReturn60d: number | null;
      stockReturn20d: number | null;
      stockReturn60d: number | null;
      stockVsSectorReturn20d: number | null;
      stockVsSectorReturn60d: number | null;
      sectorRank20d: number | null;
      sectorRank60d: number | null;
      sectorPercentile20d: number | null;
      sectorPercentile60d: number | null;
    };
    missingFields: string[];
    rawFieldCoverage: SectorThemeCycleRawFieldCoverage;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    diagnosticOnly: true;
    notes: string[];
  };
  leaderCycle: {
    required: boolean;
    available: boolean;
    status: Gate2ExternalProviderStatus;
    leaderCyclePhase: LeaderCyclePhase;
    isCurrentLeadingSector: boolean | null;
    isSectorLeader: boolean | null;
    isPreviousCycleLeader: boolean | null;
    isNewLeaderCandidate: boolean | null;
    newsFrequency30d: number | null;
    newsCrowdingScore: number | null;
    attentionPhase: AttentionPhase;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    diagnosticOnly: true;
    notes: string[];
  };
}

export interface Gate2ExternalCoverageInput {
  kisFlow?: KisInvestorFlow | QmpInvestorFlow | null;
  dartFin?: DartFinancials | QmpDartFinancials | null;
  kospi20dReturn?: number | null;
  kosdaq20dReturn?: number | null;
  quote?: unknown;
  stockMaster?: unknown;
  market?: BenchmarkMarket | string | null;
  benchmarkReturn?: QmpBenchmarkReturn | null;
  benchmarkRaw?: unknown;
  programTrade?: {
    marketProgram?: QmpProgramFlow | null;
    stockProgram?: QmpProgramFlow | null;
  } | null;
  riskFlow?: unknown;
  sectorThemeCycle?: QmpSectorThemeCycle | unknown | null;
  sectorEnergyResult?: unknown;
  evaluationStage?: Gate2EvaluationStage | null;
}

export type Gate2ConsolidatedHealth =
  | 'OK'
  | 'WARN'
  | 'DEGRADED'
  | 'DATA_INCOMPLETE'
  | 'STAGE_NOT_FETCHED'
  | 'CONFLICT'
  | 'UNKNOWN';

export type Gate2ConsolidatedOperatorAction =
  | 'NONE'
  | 'CHECK_KIS_INVESTOR_FLOW'
  | 'CHECK_DART_FINANCIALS'
  | 'CHECK_BENCHMARK_PROVIDER'
  | 'CHECK_PROGRAM_FLOW_SCOPE'
  | 'CHECK_RISK_FLOW_PROVIDER'
  | 'CHECK_SECTOR_MAP'
  | 'REVIEW_GATE2_INPUTS'
  | 'REVIEW_SIGNAL_CONFLICT'
  | 'WAIT_FOR_ENTRY_RECHECK';

export type Gate2DataReadinessStatus =
  | 'OK'
  | 'MISSING'
  | 'DEGRADED'
  | 'STAGE_NOT_FETCHED'
  | 'OPTIONAL'
  | 'UNKNOWN';

export type Gate2SignalAlignment =
  | 'BULLISH'
  | 'BEARISH'
  | 'NEUTRAL'
  | 'UNAVAILABLE'
  | 'DIAGNOSTIC_ONLY'
  | 'RISK_HIGH'
  | 'RISK_MEDIUM'
  | 'RISK_LOW'
  | 'LEADING'
  | 'EARLY'
  | 'CROWDED'
  | 'LAGGARD'
  | 'UNKNOWN';

export interface Gate2ConsolidatedDiagnostic {
  health: Gate2ConsolidatedHealth;
  gate2Status: Gate2ConsolidatedHealth;
  externalDataStage: 'NONE' | 'DART_DEFERRED' | 'EXTERNAL_STAGE_DEFERRED';
  summary: string;
  primaryIssue: string | null;
  operatorAction: Gate2ConsolidatedOperatorAction;
  dataReadiness: {
    kisInvestorFlow: Gate2DataReadinessStatus;
    dartFinancials: Gate2DataReadinessStatus;
    benchmark: Gate2DataReadinessStatus;
    programTrade: Gate2DataReadinessStatus;
    riskFlow: Gate2DataReadinessStatus;
    sectorCycle: Gate2DataReadinessStatus;
  };
  signalAlignment: {
    supply: Gate2SignalAlignment;
    financials: Gate2SignalAlignment;
    relativeStrength: Gate2SignalAlignment;
    passiveFlow: Gate2SignalAlignment;
    riskFlow: Gate2SignalAlignment;
    sectorCycle: Gate2SignalAlignment;
  };
  conflictFlags: string[];
  missingCriticalData: string[];
  providerIssues: string[];
  marketSignal: false;
  providerIssue: boolean;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  scoreImpact: 'APPLIED' | 'NOT_APPLIED';
  diagnosticOnly: true;
  sections: {
    wiring: string[];
    kis: string[];
    dart: string[];
    benchmark: string[];
    program: string[];
    risk: string[];
    sector: string[];
  };
  compactText: string;
  telegramText: string;
}
