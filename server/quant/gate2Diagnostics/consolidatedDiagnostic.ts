// @responsibility Gate2 consolidated diagnostic builder.

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
import type {
  Gate2ConsolidatedDiagnostic,
  Gate2ConsolidatedHealth,
  Gate2ConsolidatedOperatorAction,
  Gate2DataReadinessStatus,
  Gate2EvaluationStage,
  Gate2ExternalDataCoverage,
  Gate2ExternalProviderStatus,
  Gate2SignalAlignment,
  Gate2SourceCoverage,
} from './types.js';
import { buildGate2ExternalDataCoverage } from './externalCoverage.js';
import { unique } from './wiringDiagnostics.js';

export function gate2StageNotFetched(external: Gate2ExternalDataCoverage, evaluationStage?: Gate2EvaluationStage | null): boolean {
  const coreNotFetched = external.kisInvestorFlow.status === 'STAGE_NOT_FETCHED'
    && external.dartFinancials.status === 'STAGE_NOT_FETCHED'
    && external.benchmark.status === 'STAGE_NOT_FETCHED';
  return coreNotFetched && (!evaluationStage || evaluationStage === 'DISCOVERY_GATE');
}

export function alignmentFromSigned(value: number | null): Gate2SignalAlignment {
  if (value == null) return 'UNAVAILABLE';
  if (value > 0) return 'BULLISH';
  if (value < 0) return 'BEARISH';
  return 'NEUTRAL';
}

export function supplyAlignment(kis: Gate2ExternalDataCoverage['kisInvestorFlow']): Gate2SignalAlignment {
  if (kis.status !== 'VERIFIED') return 'UNAVAILABLE';
  if ((kis.foreignNetBuy ?? 0) > 0 && (kis.institutionalNetBuy ?? 0) > 0) return 'BULLISH';
  if ((kis.foreignNetBuy ?? 0) < 0 && (kis.institutionalNetBuy ?? 0) < 0) return 'BEARISH';
  return 'NEUTRAL';
}

export function financialAlignment(dart: Gate2ExternalDataCoverage['dartFinancials']): Gate2SignalAlignment {
  if (dart.status !== 'VERIFIED') return 'UNAVAILABLE';
  const ocfOk = dart.ocfRatio != null && dart.ocfRatio >= 1;
  const roeOk = dart.roe == null || dart.roe > 0;
  const opmOk = dart.opm == null || dart.opm > 0;
  if (ocfOk && roeOk && opmOk) return 'BULLISH';
  if (dart.ocfRatio != null && dart.ocfRatio < 1) return 'BEARISH';
  return 'NEUTRAL';
}

export function relativeStrengthAlignment(benchmark: Gate2ExternalDataCoverage['benchmark']): Gate2SignalAlignment {
  if (benchmark.status !== 'VERIFIED') return 'UNAVAILABLE';
  return alignmentFromSigned(benchmark.values.relativeReturn20d);
}

export function passiveFlowAlignment(program: Gate2ExternalDataCoverage['programTrade']): Gate2SignalAlignment {
  if (!program.scopeSeparationValid) return 'UNAVAILABLE';
  if (program.stockProgram.status === 'VERIFIED') return alignmentFromSigned(program.stockProgram.values.programNetBuyAmount);
  if (program.marketProgram.status === 'VERIFIED') return 'DIAGNOSTIC_ONLY';
  return 'UNAVAILABLE';
}

export function riskFlowAlignment(risk: Gate2ExternalDataCoverage['riskFlow']): Gate2SignalAlignment {
  if (risk.status === 'STAGE_NOT_FETCHED' || risk.status === 'MISSING') return 'UNAVAILABLE';
  if (risk.interpretation.shortPressure === 'HIGH' || risk.interpretation.creditOverheat === 'HIGH' || risk.interpretation.overallRisk === 'HIGH') return 'RISK_HIGH';
  if (risk.interpretation.shortPressure === 'MEDIUM' || risk.interpretation.creditOverheat === 'MEDIUM' || risk.interpretation.overallRisk === 'MEDIUM') return 'RISK_MEDIUM';
  if (risk.interpretation.overallRisk === 'LOW') return 'RISK_LOW';
  return 'UNKNOWN';
}

export function sectorCycleAlignment(external: Gate2ExternalDataCoverage): Gate2SignalAlignment {
  const leaderPhase = external.leaderCycle.leaderCyclePhase;
  const attention = external.leaderCycle.attentionPhase;
  if (external.sectorCycle.status === 'MISSING' || external.sectorCycle.status === 'STAGE_NOT_FETCHED') return 'UNAVAILABLE';
  if (leaderPhase === 'SILENT_ACCUMULATION' || leaderPhase === 'EARLY_LEADER') return 'EARLY';
  if (leaderPhase === 'MID_LEADER') return 'LEADING';
  if (leaderPhase === 'LATE_CROWDED' || attention === 'CROWDED' || attention === 'OVERHYPED') return 'CROWDED';
  if (leaderPhase === 'LAGGARD' || leaderPhase === 'EX_LEADER') return 'LAGGARD';
  return 'UNKNOWN';
}

export function gate2ProviderIssues(source: Gate2SourceCoverage | undefined, external: Gate2ExternalDataCoverage): string[] {
  return unique([
    ...(source?.providerIssues ?? []),
    ...(external.kisInvestorFlow.providerIssue ? ['KIS_INVESTOR_FLOW_PROVIDER_ISSUE'] : []),
    ...(external.dartFinancials.providerIssue ? ['DART_FINANCIALS_PROVIDER_ISSUE'] : []),
    ...(external.benchmark.providerIssue ? ['BENCHMARK_PROVIDER_ISSUE'] : []),
    ...(external.programTrade.marketProgram.providerIssue || external.programTrade.stockProgram.providerIssue ? ['PROGRAM_TRADE_PROVIDER_ISSUE'] : []),
    ...(external.riskFlow.providerIssue ? ['RISK_FLOW_PROVIDER_ISSUE'] : []),
    ...(external.sectorCycle.providerIssue ? ['SECTOR_CYCLE_PROVIDER_ISSUE'] : []),
  ]);
}

export function missingCriticalDataFor(source: Gate2SourceCoverage | undefined, external: Gate2ExternalDataCoverage): string[] {
  return unique([
    ...(source?.missingExternalData ?? []),
    ...(external.kisInvestorFlow.status === 'MISSING' || external.kisInvestorFlow.status === 'DEGRADED' ? ['KIS_INVESTOR_FLOW'] : []),
    ...(external.dartFinancials.status === 'MISSING' || external.dartFinancials.status === 'DEGRADED' || external.dartFinancials.status === 'EMPTY_VALID' ? ['DART_FINANCIALS'] : []),
    ...(external.benchmark.status === 'MISSING' || external.benchmark.status === 'DEGRADED' ? ['BENCHMARK_20D_RETURN'] : []),
  ]);
}

export function hasQuoteOrUnknownInputMissing(source: Gate2SourceCoverage | undefined): boolean {
  return (source?.missingInputs ?? []).some(input => {
    if (input.startsWith('ctx.kisFlow') || input.startsWith('kisFlow')) return false;
    if (input.startsWith('ctx.dartFin') || input.startsWith('dartFin')) return false;
    if (input === 'ctx.kospi20dReturn' || input === 'ctx.kosdaq20dReturn') return false;
    if (input.startsWith('benchmark.') || input.startsWith('index.')) return false;
    return true;
  });
}

export function isMissingStatus(status: Gate2ExternalProviderStatus): boolean {
  return status === 'MISSING' || status === 'EMPTY_VALID';
}

export function isDegradedStatus(status: Gate2ExternalProviderStatus): boolean {
  return status === 'DEGRADED' || status === 'STALE';
}

export function readinessFromStatus(status: Gate2ExternalProviderStatus, required: boolean): Gate2DataReadinessStatus {
  if (status === 'VERIFIED' || status === 'PARTIAL') return 'OK';
  if (status === 'STAGE_NOT_FETCHED') return required ? 'STAGE_NOT_FETCHED' : 'OPTIONAL';
  if (status === 'MISSING' || status === 'EMPTY_VALID') return required ? 'MISSING' : 'OPTIONAL';
  if (status === 'DEGRADED' || status === 'STALE') return 'DEGRADED';
  return 'UNKNOWN';
}

export function programReadiness(program: Gate2ExternalDataCoverage['programTrade']): Gate2DataReadinessStatus {
  if (program.stockProgram.status === 'VERIFIED' || program.marketProgram.status === 'VERIFIED') return 'OK';
  if (!program.scopeSeparationValid) return 'DEGRADED';
  if (program.stockProgram.status === 'DEGRADED' || program.marketProgram.status === 'DEGRADED') return 'DEGRADED';
  if (program.stockProgram.status === 'STALE' || program.marketProgram.status === 'STALE') return 'DEGRADED';
  if (program.stockProgram.status === 'UNKNOWN' && program.marketProgram.status === 'UNKNOWN') return 'UNKNOWN';
  return 'OPTIONAL';
}

export function compactReadiness(status: Gate2DataReadinessStatus): string {
  return status === 'STAGE_NOT_FETCHED' ? 'WAIT' : status;
}

export function valueText(value: number | null): string {
  return value == null ? 'null' : String(value);
}

export function buildGate2Sections(input: {
  source?: Gate2SourceCoverage;
  external: Gate2ExternalDataCoverage;
  signalAlignment: Gate2ConsolidatedDiagnostic['signalAlignment'];
  missingCriticalData: string[];
  providerIssues: string[];
}): Gate2ConsolidatedDiagnostic['sections'] {
  const { source, external, signalAlignment, missingCriticalData, providerIssues } = input;
  return {
    wiring: [
      `conditions=${source?.conditionCount ?? 0}`,
      `inputs=${source?.allDeclaredInputsAvailable === true ? 'OK' : 'DEGRADED'}`,
      `missingInputs=${(source?.missingInputs ?? []).join(',') || 'none'}`,
      `missingCriticalData=${missingCriticalData.join(',') || 'none'}`,
      `providerIssues=${providerIssues.join(',') || 'none'}`,
    ],
    kis: [
      `status=${external.kisInvestorFlow.status}`,
      `foreignNetBuy=${valueText(external.kisInvestorFlow.foreignNetBuy)}`,
      `institutionalNetBuy=${valueText(external.kisInvestorFlow.institutionalNetBuy)}`,
      `alignment=${signalAlignment.supply}`,
      `marketSignal=false`,
    ],
    dart: [
      `status=${external.dartFinancials.status}`,
      `ocfRatio=${valueText(external.dartFinancials.ocfRatio)}`,
      `roe=${valueText(external.dartFinancials.roe)}`,
      `opm=${valueText(external.dartFinancials.opm)}`,
      `alignment=${signalAlignment.financials}`,
      `marketSignal=false`,
    ],
    benchmark: [
      `status=${external.benchmark.status}`,
      `benchmarkKey=${external.benchmark.benchmarkKey}`,
      `stock20d=${valueText(external.benchmark.values.stockReturn20d)}`,
      `benchmark20d=${valueText(external.benchmark.values.benchmarkReturn20d)}`,
      `relative20d=${valueText(external.benchmark.values.relativeReturn20d)}`,
      `alignment=${signalAlignment.relativeStrength}`,
      `marketSignal=false`,
    ],
    program: [
      `stockProgram=${external.programTrade.stockProgram.status}`,
      `marketProgram=${external.programTrade.marketProgram.status}`,
      `scopeSeparationValid=${external.programTrade.scopeSeparationValid}`,
      `alignment=${signalAlignment.passiveFlow}`,
      `marketSignal=false`,
    ],
    risk: [
      `status=${external.riskFlow.status}`,
      `shortPressure=${external.riskFlow.interpretation.shortPressure}`,
      `creditOverheat=${external.riskFlow.interpretation.creditOverheat}`,
      `overallRisk=${external.riskFlow.interpretation.overallRisk}`,
      `alignment=${signalAlignment.riskFlow}`,
      `diagnosticOnly=true`,
      `marketSignal=false`,
    ],
    sector: [
      `status=${external.sectorCycle.status}`,
      `sector=${external.sectorCycle.sector ?? 'UNKNOWN'}`,
      `leaderCyclePhase=${external.leaderCycle.leaderCyclePhase}`,
      `attentionPhase=${external.leaderCycle.attentionPhase}`,
      `alignment=${signalAlignment.sectorCycle}`,
      `diagnosticOnly=true`,
      `marketSignal=false`,
    ],
  };
}

export function buildGate2TelegramText(input: {
  health: Gate2ConsolidatedHealth;
  primaryIssue: string | null;
  operatorAction: Gate2ConsolidatedOperatorAction;
  dataReadiness: Gate2ConsolidatedDiagnostic['dataReadiness'];
  signalAlignment: Gate2ConsolidatedDiagnostic['signalAlignment'];
}): string {
  const { health, primaryIssue, operatorAction, dataReadiness, signalAlignment } = input;
  return [
    'Gate2 Wiring',
    `state: ${health}`,
    ...(primaryIssue ? [`issue: ${primaryIssue}`] : []),
    `KIS: ${dataReadiness.kisInvestorFlow} / supply=${signalAlignment.supply}`,
    `DART: ${dataReadiness.dartFinancials} / financials=${signalAlignment.financials}`,
    `Benchmark: ${dataReadiness.benchmark} / RS=${signalAlignment.relativeStrength}`,
    `Program: ${dataReadiness.programTrade} / passive=${signalAlignment.passiveFlow}`,
    `Risk: ${signalAlignment.riskFlow} / Sector: ${signalAlignment.sectorCycle}`,
    ...(operatorAction !== 'NONE' ? [`action: ${operatorAction}`] : []),
    'marketSignal=false / Shadow continues',
  ].slice(0, 10).join('\n');
}

export function buildGate2Summary(health: Gate2ConsolidatedHealth, primaryIssue: string | null): string {
  if (health === 'OK') return 'Gate2 diagnostics OK; supply, financials, benchmark, and advisory context are available.';
  if (health === 'STAGE_NOT_FETCHED') return 'Gate2 external data is intentionally not fetched at discovery stage.';
  if (health === 'DATA_INCOMPLETE') return 'Gate2 diagnostic data is incomplete; core scoring is unchanged.';
  if (health === 'CONFLICT') return 'Gate2 diagnostic signals conflict; review before interpreting the score.';
  if (primaryIssue) return `Gate2 diagnostic issue: ${primaryIssue}.`;
  return 'Gate2 diagnostics are advisory; scoring and execution policy are unchanged.';
}

export function buildGate2ConsolidatedDiagnostic(input: {
  gate2: {
    sourceCoverage?: Gate2SourceCoverage;
    externalDataCoverage?: Gate2ExternalDataCoverage;
  } | null | undefined;
  evaluationStage?: Gate2EvaluationStage | null;
}): Gate2ConsolidatedDiagnostic {
  const source = input.gate2?.sourceCoverage;
  const external = input.gate2?.externalDataCoverage;
  if (!source || !external) {
    return {
      health: 'UNKNOWN',
      summary: buildGate2Summary('UNKNOWN', 'GATE2_DIAGNOSTIC_MISSING'),
      primaryIssue: 'GATE2_DIAGNOSTIC_MISSING',
      operatorAction: 'REVIEW_GATE2_INPUTS',
      dataReadiness: {
        kisInvestorFlow: 'UNKNOWN',
        dartFinancials: 'UNKNOWN',
        benchmark: 'UNKNOWN',
        programTrade: 'UNKNOWN',
        riskFlow: 'UNKNOWN',
        sectorCycle: 'UNKNOWN',
      },
      signalAlignment: {
        supply: 'UNKNOWN',
        financials: 'UNKNOWN',
        relativeStrength: 'UNKNOWN',
        passiveFlow: 'UNKNOWN',
        riskFlow: 'UNKNOWN',
        sectorCycle: 'UNKNOWN',
      },
      conflictFlags: [],
      missingCriticalData: [],
      providerIssues: [],
      marketSignal: false,
      providerIssue: true,
      executionImpact: 'DIAGNOSTIC_ONLY',
      diagnosticOnly: true,
      sections: {
        wiring: ['Gate2 diagnostic missing'],
        kis: ['status=UNKNOWN'],
        dart: ['status=UNKNOWN'],
        benchmark: ['status=UNKNOWN'],
        program: ['status=UNKNOWN'],
        risk: ['status=UNKNOWN'],
        sector: ['status=UNKNOWN'],
      },
      compactText: 'Gate2: UNKNOWN | issue=GATE2_DIAGNOSTIC_MISSING | action=REVIEW_GATE2_INPUTS | marketSignal=false',
      telegramText: [
        'Gate2 Wiring',
        'state: UNKNOWN',
        'issue: GATE2_DIAGNOSTIC_MISSING',
        'action: REVIEW_GATE2_INPUTS',
        'marketSignal=false / Shadow continues',
      ].join('\n'),
    };
  }

  const signalAlignment = {
    supply: supplyAlignment(external.kisInvestorFlow),
    financials: financialAlignment(external.dartFinancials),
    relativeStrength: relativeStrengthAlignment(external.benchmark),
    passiveFlow: passiveFlowAlignment(external.programTrade),
    riskFlow: riskFlowAlignment(external.riskFlow),
    sectorCycle: sectorCycleAlignment(external),
  };
  const conflictFlags = unique([
    ...(signalAlignment.supply === 'BULLISH' && signalAlignment.financials === 'BULLISH' && signalAlignment.relativeStrength === 'BEARISH' ? ['RS_CONFLICT'] : []),
    ...(signalAlignment.supply === 'BULLISH' && signalAlignment.sectorCycle === 'LAGGARD' ? ['SECTOR_CONFLICT'] : []),
  ]);
  const missingCriticalData = missingCriticalDataFor(source, external);
  const stageNotFetched = gate2StageNotFetched(external, input.evaluationStage);
  const providerIssues = stageNotFetched ? [] : gate2ProviderIssues(source, external);
  const dataReadiness: Gate2ConsolidatedDiagnostic['dataReadiness'] = {
    kisInvestorFlow: readinessFromStatus(external.kisInvestorFlow.status, external.kisInvestorFlow.required),
    dartFinancials: readinessFromStatus(external.dartFinancials.status, external.dartFinancials.required),
    benchmark: readinessFromStatus(external.benchmark.status, external.benchmark.required),
    programTrade: programReadiness(external.programTrade),
    riskFlow: readinessFromStatus(external.riskFlow.status, external.riskFlow.required),
    sectorCycle: readinessFromStatus(external.sectorCycle.status, external.sectorCycle.required),
  };

  let health: Gate2ConsolidatedHealth = 'OK';
  let primaryIssue: string | null = null;
  let operatorAction: Gate2ConsolidatedOperatorAction = 'NONE';

  if (stageNotFetched) {
    health = 'STAGE_NOT_FETCHED';
    primaryIssue = 'DISCOVERY_STAGE_EXTERNAL_DATA_NOT_FETCHED';
    operatorAction = 'WAIT_FOR_ENTRY_RECHECK';
  } else if (hasQuoteOrUnknownInputMissing(source)) {
    health = 'DEGRADED';
    primaryIssue = 'GATE2_INPUT_MISSING';
    operatorAction = 'REVIEW_GATE2_INPUTS';
  } else if (!external.programTrade.scopeSeparationValid) {
    health = 'DEGRADED';
    primaryIssue = 'PROGRAM_FLOW_SCOPE_MISMATCH';
    operatorAction = 'CHECK_PROGRAM_FLOW_SCOPE';
  } else if (external.kisInvestorFlow.status === 'MISSING' || external.kisInvestorFlow.status === 'DEGRADED') {
    health = 'DEGRADED';
    primaryIssue = 'KIS_INVESTOR_FLOW_UNAVAILABLE';
    operatorAction = 'CHECK_KIS_INVESTOR_FLOW';
  } else if (isMissingStatus(external.dartFinancials.status) || isDegradedStatus(external.dartFinancials.status)) {
    health = isDegradedStatus(external.dartFinancials.status) ? 'DEGRADED' : 'DATA_INCOMPLETE';
    primaryIssue = 'DART_FINANCIALS_UNAVAILABLE';
    operatorAction = 'CHECK_DART_FINANCIALS';
  } else if (isMissingStatus(external.benchmark.status) || isDegradedStatus(external.benchmark.status)) {
    health = isDegradedStatus(external.benchmark.status) ? 'DEGRADED' : 'DATA_INCOMPLETE';
    primaryIssue = 'BENCHMARK_UNAVAILABLE';
    operatorAction = 'CHECK_BENCHMARK_PROVIDER';
  } else if (conflictFlags.length > 0) {
    health = 'CONFLICT';
    primaryIssue = 'GATE2_SIGNAL_CONFLICT';
    operatorAction = 'REVIEW_SIGNAL_CONFLICT';
  } else if (signalAlignment.riskFlow === 'RISK_HIGH') {
    health = 'WARN';
    primaryIssue = 'RISK_FLOW_WARNING';
    operatorAction = 'CHECK_RISK_FLOW_PROVIDER';
  } else if (signalAlignment.sectorCycle === 'CROWDED') {
    health = 'WARN';
    primaryIssue = 'SECTOR_CYCLE_WARNING';
    operatorAction = 'CHECK_SECTOR_MAP';
  } else if (!source.allDeclaredInputsAvailable || !source.allExternalDataAvailable) {
    health = 'DATA_INCOMPLETE';
    primaryIssue = 'GATE2_INPUT_MISSING';
    operatorAction = 'REVIEW_GATE2_INPUTS';
  }

  const sections = buildGate2Sections({ source, external, signalAlignment, missingCriticalData, providerIssues });
  const compactText = [
    `Gate2: ${health}`,
    ...(primaryIssue ? [`issue=${primaryIssue}`] : []),
    `KIS=${compactReadiness(dataReadiness.kisInvestorFlow)}`,
    `DART=${compactReadiness(dataReadiness.dartFinancials)}`,
    `BM=${compactReadiness(dataReadiness.benchmark)}`,
    `supply=${signalAlignment.supply}`,
    `fin=${signalAlignment.financials}`,
    `RS=${signalAlignment.relativeStrength}`,
    `program=${compactReadiness(dataReadiness.programTrade)}`,
    `risk=${signalAlignment.riskFlow}`,
    `Sector=${signalAlignment.sectorCycle}`,
    ...(operatorAction !== 'NONE' ? [`action=${operatorAction}`] : []),
    'marketSignal=false',
  ].join(' | ');
  const telegramText = buildGate2TelegramText({
    health,
    primaryIssue,
    operatorAction,
    dataReadiness,
    signalAlignment,
  });

  return {
    health,
    summary: buildGate2Summary(health, primaryIssue),
    primaryIssue,
    operatorAction,
    dataReadiness,
    signalAlignment,
    conflictFlags,
    missingCriticalData,
    providerIssues,
    marketSignal: false,
    providerIssue: providerIssues.length > 0,
    executionImpact: health === 'OK' ? 'NONE' : 'DIAGNOSTIC_ONLY',
    diagnosticOnly: true,
    sections,
    compactText,
    telegramText,
  };
}
