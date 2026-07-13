// @responsibility Gate2 external data coverage builder.

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
  Gate2EvaluationStage,
  Gate2ExternalDataCoverage,
  Gate2ExternalCoverageInput,
  Gate2ExternalProviderStatus,
  Gate2RiskPressure,
  Gate2SourceCoverage,
  Gate2WiringDiagnostic,
} from './types.js';
import { isBenchmarkInput, isDartInput, isKisInput, unique } from './wiringDiagnostics.js';
import { buildGate2ExternalProjection } from '../../trading/gate2/gate2ExternalDataProvider.js';
import { isSectorEnergyGate2WiringEnabled } from '../../trading/gate2/sectorEnergyGate2WiringFlag.js';
import { produceSectorThemeCycleForGate2 } from './sectorThemeCycleProducer.js';
import type { Gate2ExternalRefreshTrace } from '../../trading/gate2/gate2ExternalDataProvider/types.js';

/**
 * §B 정합 — DART 데이터 라인 헬스가 NOT_ATTEMPTED 로 오표시되는 문제를 고친다.
 *
 * 근본 원인: buildGate2ExternalProjection 는 refreshTrace.dartRequestAttempted 가 없으면
 * classifyDartLineHealth 가 NOT_ATTEMPTED 를 반환한다. 진단 빌더(externalCoverage)는 실제
 * fetch trace 를 보유하지 않으므로, 이미 해석된 dartStatus(=external.dartFinancials.status)와
 * dartFin 존재 여부로부터 attempted/transport-error 사실을 SSOT 정합하게 합성한다.
 *
 * 합성 규칙(거짓 표시 금지 — attempt 근거가 있을 때만 attempted=true):
 *  - dartFin 부재 또는 STAGE_NOT_FETCHED → undefined (NOT_ATTEMPTED 유지, 정상).
 *  - dartFin 존재 → dartRequestAttempted=true.
 *  - dartStatus=DEGRADED(transport/parse/provider error) → dartErrorCode 부여 → classifyDartLineHealth DEGRADED.
 *  - 어떤 경우에도 marketSignal/executionImpact 불변(분류 함수가 보존), provider 호출 0.
 */
function synthesizeDartRefreshTraceForDisplay(input: {
  symbol: string;
  dartFin: Gate2ExternalCoverageInput['dartFin'];
  dartStatus: Gate2ExternalProviderStatus;
  dartProviderStatus: string | null;
  anyDartFieldAvailable: boolean;
}): Gate2ExternalRefreshTrace | undefined {
  if (!input.dartFin || input.dartStatus === 'STAGE_NOT_FETCHED') return undefined;
  const transportError = input.dartStatus === 'DEGRADED';
  const rawRows = input.anyDartFieldAvailable ? 1 : 0;
  return {
    symbol: input.symbol,
    corpCodeResolveStatus: 'FOUND',
    fiscalPeriodStatus: 'RESOLVED',
    corpCodeRequestAttempted: true,
    dartRequestAttempted: true,
    dartHttpStatus: transportError && input.dartProviderStatus === 'HTTP_ERROR' ? 503 : undefined,
    dartErrorCode: transportError ? (input.dartProviderStatus ?? 'DART_PROVIDER_DEGRADED') : undefined,
    dartRawRows: rawRows,
    normalizedRows: rawRows,
    derivedMetricsComputed: input.anyDartFieldAvailable,
    kisPerRequestAttempted: false,
    finalConfidence: input.dartStatus === 'VERIFIED' ? 'VERIFIED' : input.dartStatus === 'STALE' ? 'STALE' : 'MISSING',
    unavailableConditions: [],
    executionImpact: 'NONE',
  };
}

function fieldAvailable(wiring: readonly Gate2WiringDiagnostic[], input: string): boolean {
  return wiring.some(item => item.availableInputs.includes(input));
}

function requiredExternal(wiring: readonly Gate2WiringDiagnostic[], label: string): boolean {
  return wiring.some(item => item.requiredExternalData.includes(label));
}

function externalMissing(wiring: readonly Gate2WiringDiagnostic[], label: string): boolean {
  return wiring.some(item => item.missingExternalData.includes(label));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function statusFromMetadata(value: unknown): Gate2ExternalProviderStatus | null {
  if (!isRecord(value)) return null;
  const record = value;
  const raw = String(record.providerStatus ?? record.sourceStatus ?? record.status ?? record.dataQuality ?? '').toUpperCase();
  if (raw.includes('VERIFIED') || raw === 'OK' || raw === 'OK_WITH_DATA') return 'VERIFIED';
  if (raw.includes('STALE')) return 'STALE';
  if (raw === 'OK_EMPTY' || raw.includes('EMPTY_VALID')) return 'EMPTY_VALID';
  if (raw.includes('MISSING')) return 'MISSING';
  if (raw.includes('DEGRADED') || raw.includes('ERROR') || raw.includes('RATE_LIMIT') || raw.includes('TOKEN')) return 'DEGRADED';
  return null;
}

function providerFromMetadata(value: unknown, defaults: { verified: string; cache: string; unknown: string }): string {
  if (!value || typeof value !== 'object') return defaults.unknown;
  const record = value as Record<string, unknown>;
  const raw = String(record.provider ?? record.source ?? record.dataSource ?? '').toUpperCase();
  if (raw.includes('CACHE')) return defaults.cache;
  if (raw.includes('KIS_OFFICIAL')) return 'KIS_OFFICIAL';
  if (raw.includes('KIS')) return 'KIS_API';
  if (raw.includes('DART')) return 'DART';
  if (raw.includes('KOSPI') || raw.includes('INDEX')) return 'KOSPI_INDEX';
  if (raw.includes('QMP')) return 'QMP_MACRO';
  return defaults.verified;
}

function normalizeKisEndpointKey(value: unknown): KisInvestorFlowEndpointKey | 'UNKNOWN' {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'INQUIRE_INVESTOR' || raw === 'INQUIREINVESTOR') return 'INQUIRE_INVESTOR';
  if (raw === 'INVESTOR_TRADE_BY_STOCK_DAILY' || raw === 'INVESTORTRADEBYSTOCKDAILY') return 'INVESTOR_TRADE_BY_STOCK_DAILY';
  return 'UNKNOWN';
}

function kisProviderStatus(value: unknown): KisInvestorFlowProviderStatus | null {
  if (!isRecord(value)) return null;
  const raw = String(value.providerStatus ?? '').toUpperCase();
  const allowed: KisInvestorFlowProviderStatus[] = [
    'OK_WITH_DATA',
    'OK_EMPTY',
    'HTTP_ERROR',
    'KIS_ERROR_CODE',
    'TOKEN_EXPIRED',
    'RATE_LIMITED',
    'FIELD_MISSING',
    'PARSE_ERROR',
    'UNKNOWN_ERROR',
  ];
  if ((allowed as string[]).includes(raw)) return raw as KisInvestorFlowProviderStatus;
  return null;
}

function kisConfidence(value: unknown): KisInvestorFlowConfidence | null {
  if (!isRecord(value)) return null;
  const raw = String(value.dataConfidence ?? value.confidence ?? '').toUpperCase();
  const allowed: KisInvestorFlowConfidence[] = ['VERIFIED', 'DEGRADED', 'STALE', 'MISSING', 'EMPTY_VALID', 'AI_ESTIMATED'];
  if ((allowed as string[]).includes(raw)) return raw as KisInvestorFlowConfidence;
  return null;
}

function gate2StatusFromKisProviderStatus(status: KisInvestorFlowProviderStatus | null, confidence: KisInvestorFlowConfidence | null): Gate2ExternalProviderStatus | null {
  if (confidence === 'EMPTY_VALID') return 'EMPTY_VALID';
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'FIELD_MISSING' || status === 'PARSE_ERROR') return 'DEGRADED';
  if (status === 'HTTP_ERROR' || status === 'KIS_ERROR_CODE' || status === 'TOKEN_EXPIRED' || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR') return 'DEGRADED';
  return null;
}

function kisEndpointMetadata(value: unknown): {
  endpointKey: KisInvestorFlowEndpointKey | 'UNKNOWN';
  endpoint: string | null;
  trId: string | null;
  driftDiagnostics: KisInvestorFlowDriftDiagnostic[];
} {
  const record = isRecord(value) ? value : {};
  const endpointKey = normalizeKisEndpointKey(record.endpointKey ?? record.sourceKind);
  const spec = endpointKey === 'UNKNOWN' ? null : KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS[endpointKey];
  const endpoint = stringOrNull(record.endpoint ?? record.actualPath ?? record.path) ?? spec?.path ?? null;
  const trId = stringOrNull(record.trId ?? record.actualTrId) ?? spec?.trId ?? null;
  const existingDrift = Array.isArray(record.driftDiagnostics)
    ? record.driftDiagnostics.filter(isRecord) as unknown as KisInvestorFlowDriftDiagnostic[]
    : [];
  if (existingDrift.length > 0 || !spec || !endpoint || !trId) return { endpointKey, endpoint, trId, driftDiagnostics: existingDrift };
  if (endpoint === spec.path && trId === spec.trId) return { endpointKey, endpoint, trId, driftDiagnostics: [] };
  return {
    endpointKey,
    endpoint,
    trId,
    driftDiagnostics: [{
      type: 'KIS_OFFICIAL_DRIFT_DETECTED',
      api: endpointKey as KisInvestorFlowEndpointKey,
      expectedPath: spec.path,
      actualPath: endpoint,
      expectedTrId: spec.trId,
      actualTrId: trId,
      action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW',
    }],
  };
}

function kisRawFieldCoverage(value: unknown, missingFields: string[]): KisInvestorFlowRawFieldCoverage {
  const record = isRecord(value) ? value : {};
  const embedded = record.rawFieldCoverage;
  if (isRecord(embedded)) {
    return {
      requiredFields: Array.isArray(embedded.requiredFields) ? embedded.requiredFields.map(String) : ['foreignNetBuy', 'institutionalNetBuy'],
      presentFields: Array.isArray(embedded.presentFields) ? embedded.presentFields.map(String) : [],
      missingFields: Array.isArray(embedded.missingFields) ? embedded.missingFields.map(String) : missingFields,
      allRequiredFieldsPresent: embedded.allRequiredFieldsPresent === true,
    };
  }
  return {
    requiredFields: ['foreignNetBuy', 'institutionalNetBuy'],
    presentFields: ['foreignNetBuy', 'institutionalNetBuy'].filter(field => !missingFields.includes(field)),
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };
}

function resolveKisStatus(input: {
  required: boolean;
  fieldsAvailable: boolean;
  missing: boolean;
  kisFlow: Gate2ExternalCoverageInput['kisFlow'];
  evaluationStage?: Gate2EvaluationStage | null;
}): Gate2ExternalProviderStatus {
  if (!input.required) return 'UNKNOWN';
  if (!input.kisFlow) {
    return input.evaluationStage === 'DISCOVERY_GATE' ? 'STAGE_NOT_FETCHED' : 'MISSING';
  }
  const metadataStatus = gate2StatusFromKisProviderStatus(kisProviderStatus(input.kisFlow), kisConfidence(input.kisFlow))
    ?? statusFromMetadata(input.kisFlow);
  if (metadataStatus && metadataStatus !== 'VERIFIED') return metadataStatus;
  if (input.fieldsAvailable && !input.missing) return 'VERIFIED';
  return 'DEGRADED';
}

function providerIssueForKisStatus(required: boolean, status: Gate2ExternalProviderStatus): boolean {
  if (!required) return false;
  return !['VERIFIED', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
}

export function dartProviderStatus(value: unknown): DartFinancialProviderStatus | null {
  if (!isRecord(value)) return null;
  const raw = String(value.providerStatus ?? '').toUpperCase();
  const allowed: DartFinancialProviderStatus[] = [
    'OK_WITH_DATA',
    'OK_EMPTY',
    'HTTP_ERROR',
    'DART_ERROR_CODE',
    'RATE_LIMITED',
    'FIELD_MISSING',
    'PARSE_ERROR',
    'STALE_CACHE',
    'UNKNOWN_ERROR',
  ];
  if ((allowed as string[]).includes(raw)) return raw as DartFinancialProviderStatus;
  return null;
}

function dartConfidence(value: unknown): DartFinancialConfidence | null {
  if (!isRecord(value)) return null;
  const raw = String(value.dataConfidence ?? value.confidence ?? '').toUpperCase();
  const allowed: DartFinancialConfidence[] = ['VERIFIED', 'DEGRADED', 'STALE', 'MISSING', 'EMPTY_VALID', 'AI_ESTIMATED'];
  if ((allowed as string[]).includes(raw)) return raw as DartFinancialConfidence;
  return null;
}

export function gate2StatusFromDartProviderStatus(status: DartFinancialProviderStatus | null, confidence: DartFinancialConfidence | null): Gate2ExternalProviderStatus | null {
  // FIELD_MISSING(일부 필드 부재 — OCF/이자비용 등)은 데이터 완전성 문제이지 transport 장애가 아니다 → PARTIAL(연결 정상).
  // providerStatus 가 confidence 보다 구체적 신호이므로 confidence=DEGRADED 보다 먼저 평가한다(DEGRADED 오분류 차단).
  if (status === 'FIELD_MISSING') return 'PARTIAL';
  if (confidence === 'EMPTY_VALID') return 'EMPTY_VALID';
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'STALE_CACHE') return 'STALE';
  // PARSE_ERROR 는 transport/parse 장애 → DEGRADED 유지.
  if (status === 'PARSE_ERROR') return 'DEGRADED';
  if (status === 'HTTP_ERROR' || status === 'DART_ERROR_CODE' || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR') return 'DEGRADED';
  return null;
}

function dartProviderFromMetadata(value: unknown): Gate2ExternalDataCoverage['dartFinancials']['provider'] {
  if (!isRecord(value)) return 'UNKNOWN';
  const raw = String(value.provider ?? value.source ?? value.dataSource ?? '').toUpperCase();
  if (raw.includes('DART_CACHE')) return 'DART_CACHE';
  if (raw.includes('QMP_CACHE') || raw === 'CACHE') return 'QMP_CACHE';
  if (raw.includes('DART')) return 'DART';
  return 'UNKNOWN';
}

function dartRawFieldCoverage(value: unknown, missingFields: string[], legacyRequiredField: boolean): DartFinancialRawFieldCoverage {
  const record = isRecord(value) ? value : {};
  const embedded = record.rawFieldCoverage;
  if (isRecord(embedded)) {
    return {
      requiredFields: Array.isArray(embedded.requiredFields) ? embedded.requiredFields.map(String) : ['operatingCashFlow', 'netIncome'],
      presentFields: Array.isArray(embedded.presentFields) ? embedded.presentFields.map(String) : [],
      missingFields: Array.isArray(embedded.missingFields) ? embedded.missingFields.map(String) : missingFields,
      allRequiredFieldsPresent: embedded.allRequiredFieldsPresent === true,
    };
  }
  const requiredFields = legacyRequiredField ? ['ocfRatio'] : ['operatingCashFlow', 'netIncome'];
  return {
    requiredFields,
    presentFields: requiredFields.filter(field => !missingFields.includes(field)),
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };
}

export function resolveDartStatus(input: {
  required: boolean;
  ocfAvailable: boolean;
  missing: boolean;
  dartFin: Gate2ExternalCoverageInput['dartFin'];
  evaluationStage?: Gate2EvaluationStage | null;
}): Gate2ExternalProviderStatus {
  if (!input.required) return 'UNKNOWN';
  if (!input.dartFin) {
    return input.evaluationStage === 'DISCOVERY_GATE' ? 'STAGE_NOT_FETCHED' : 'MISSING';
  }
  const metadataStatus = gate2StatusFromDartProviderStatus(dartProviderStatus(input.dartFin), dartConfidence(input.dartFin))
    ?? statusFromMetadata(input.dartFin);
  if (metadataStatus && metadataStatus !== 'VERIFIED') return metadataStatus;
  if (input.ocfAvailable && !input.missing) return 'VERIFIED';
  return 'DEGRADED';
}

export function providerIssueForDartStatus(required: boolean, status: Gate2ExternalProviderStatus): boolean {
  if (!required) return false;
  // PARTIAL(일부 필드 부재, 연결 정상)은 provider 장애가 아니다 — VERIFIED/EMPTY_VALID 와 함께 providerIssue=false.
  return !['VERIFIED', 'PARTIAL', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
}

function gate2StatusFromBenchmarkProviderStatus(
  status: BenchmarkProviderStatus | null,
  confidence: BenchmarkConfidence | null,
): Gate2ExternalProviderStatus | null {
  if (confidence === 'EMPTY_VALID') return 'EMPTY_VALID';
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'STALE_CACHE') return 'STALE';
  if (status === 'FIELD_MISSING') return 'MISSING';
  if (status === 'PARSE_ERROR' || status === 'HTTP_ERROR' || status === 'PROVIDER_ERROR' || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR') return 'DEGRADED';
  return null;
}

function resolveBenchmarkStatus(input: {
  required: boolean;
  benchmark: QmpBenchmarkReturn;
  missing: boolean;
  evaluationStage?: Gate2EvaluationStage | null;
}): Gate2ExternalProviderStatus {
  if (!input.required) return 'UNKNOWN';
  const fieldsAvailable = input.benchmark.stockReturn != null && input.benchmark.benchmarkReturn != null;
  if (!fieldsAvailable && input.evaluationStage === 'DISCOVERY_GATE') return 'STAGE_NOT_FETCHED';
  const metadataStatus = gate2StatusFromBenchmarkProviderStatus(input.benchmark.providerStatus, input.benchmark.dataConfidence);
  if (metadataStatus && metadataStatus !== 'VERIFIED') return metadataStatus;
  if (fieldsAvailable && !input.missing) return 'VERIFIED';
  return 'MISSING';
}

function providerIssueForBenchmarkStatus(required: boolean, status: Gate2ExternalProviderStatus): boolean {
  if (!required) return false;
  return !['VERIFIED', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
}

function gate2StatusFromProgramProviderStatus(
  status: KisProgramTradeProviderStatus | null,
  confidence: KisProgramTradeConfidence | null,
): Gate2ExternalProviderStatus | null {
  if (confidence === 'EMPTY_VALID') return 'EMPTY_VALID';
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'FIELD_MISSING' || status === 'PARSE_ERROR') return 'DEGRADED';
  if (status === 'HTTP_ERROR' || status === 'KIS_ERROR_CODE' || status === 'TOKEN_EXPIRED' || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR') return 'DEGRADED';
  return null;
}

function programStageStatus(value: QmpProgramFlow | null | undefined, evaluationStage?: Gate2EvaluationStage | null): Gate2ExternalProviderStatus {
  if (value) {
    return gate2StatusFromProgramProviderStatus(value.providerStatus, value.dataConfidence)
      ?? statusFromMetadata(value)
      ?? 'UNKNOWN';
  }
  return evaluationStage === 'DISCOVERY_GATE' ? 'STAGE_NOT_FETCHED' : 'MISSING';
}

function providerIssueForProgramStatus(status: Gate2ExternalProviderStatus): boolean {
  return !['VERIFIED', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
}

function providerIssueForOptionalProgramFlow(
  value: QmpProgramFlow | null | undefined,
  status: Gate2ExternalProviderStatus,
  scopeValid: boolean,
): boolean {
  if (!scopeValid) return true;
  if (!value) return false;
  return providerIssueForProgramStatus(status);
}

function programRawFieldCoverage(value: QmpProgramFlow | null | undefined, requiredFields: string[]): KisProgramFlowRawFieldCoverage {
  return value?.rawFieldCoverage ?? {
    requiredFields,
    presentFields: [],
    missingFields: requiredFields,
    allRequiredFieldsPresent: false,
  };
}

function programProviderFromFlows(
  marketProgram: QmpProgramFlow | null | undefined,
  stockProgram: QmpProgramFlow | null | undefined,
): Gate2ExternalDataCoverage['programTrade']['provider'] {
  const sources = [marketProgram?.source, stockProgram?.source].filter(Boolean).map(String);
  if (sources.includes('KIS_OFFICIAL')) return 'KIS_OFFICIAL';
  if (sources.includes('KIS_API')) return 'KIS_API';
  if (sources.includes('CACHE')) return 'CACHE';
  return 'UNKNOWN';
}

function normalizeRiskPressure(value: unknown): Gate2RiskPressure {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'HIGH' || raw === 'RISK_HIGH' || raw === 'OVERHEATED' || raw === 'BLOCK') return 'HIGH';
  if (raw === 'MEDIUM' || raw === 'MID' || raw === 'WARN') return 'MEDIUM';
  if (raw === 'LOW' || raw === 'OK' || raw === 'NORMAL') return 'LOW';
  return 'UNKNOWN';
}

function pressureFromValue(value: number | null): Gate2RiskPressure {
  if (value == null) return 'UNKNOWN';
  const abs = Math.abs(value);
  if (abs >= 20) return 'HIGH';
  if (abs >= 10) return 'MEDIUM';
  return 'LOW';
}

function maxRiskPressure(values: readonly Gate2RiskPressure[]): Gate2RiskPressure {
  if (values.includes('HIGH')) return 'HIGH';
  if (values.includes('MEDIUM')) return 'MEDIUM';
  if (values.includes('LOW')) return 'LOW';
  return 'UNKNOWN';
}

function riskProviderFromMetadata(value: unknown): Gate2ExternalDataCoverage['riskFlow']['provider'] {
  if (!isRecord(value)) return 'UNKNOWN';
  const raw = String(value.provider ?? value.source ?? value.dataSource ?? '').toUpperCase();
  if (raw.includes('KIS_OFFICIAL')) return 'KIS_OFFICIAL';
  if (raw.includes('KIS')) return 'KIS_API';
  if (raw.includes('KRX')) return 'KRX_CACHE';
  if (raw.includes('QMP')) return 'QMP_CACHE';
  if (raw.includes('CACHE')) return 'CACHE';
  return 'UNKNOWN';
}

function buildGate2RiskFlowCoverage(
  riskFlow: unknown,
  evaluationStage?: Gate2EvaluationStage | null,
): Gate2ExternalDataCoverage['riskFlow'] {
  const record = isRecord(riskFlow) ? riskFlow : {};
  const interpretation = isRecord(record.interpretation) ? record.interpretation : {};
  const shortSaleIncreaseRate = numberOrNull(record.shortSaleIncreaseRate ?? record.shortIncreaseRate ?? record.shortPressureValue);
  const loanIncreaseRate = numberOrNull(record.loanIncreaseRate ?? record.loanPressureValue);
  const creditIncreaseRate = numberOrNull(record.creditIncreaseRate ?? record.creditOverheatValue);
  const creditBalanceRatio = numberOrNull(record.creditBalanceRatio ?? record.creditRate);
  const shortPressure = normalizeRiskPressure(interpretation.shortPressure ?? record.shortPressure) !== 'UNKNOWN'
    ? normalizeRiskPressure(interpretation.shortPressure ?? record.shortPressure)
    : pressureFromValue(shortSaleIncreaseRate);
  const loanPressure = normalizeRiskPressure(interpretation.loanPressure ?? record.loanPressure) !== 'UNKNOWN'
    ? normalizeRiskPressure(interpretation.loanPressure ?? record.loanPressure)
    : pressureFromValue(loanIncreaseRate);
  const creditOverheat = normalizeRiskPressure(interpretation.creditOverheat ?? record.creditOverheat) !== 'UNKNOWN'
    ? normalizeRiskPressure(interpretation.creditOverheat ?? record.creditOverheat)
    : maxRiskPressure([pressureFromValue(creditIncreaseRate), creditBalanceRatio != null && creditBalanceRatio >= 8 ? 'MEDIUM' : pressureFromValue(null)]);
  const overallRisk = normalizeRiskPressure(interpretation.overallRisk ?? record.overallRisk) !== 'UNKNOWN'
    ? normalizeRiskPressure(interpretation.overallRisk ?? record.overallRisk)
    : maxRiskPressure([shortPressure, loanPressure, creditOverheat]);
  const metadataStatus = statusFromMetadata(riskFlow);
  const status: Gate2ExternalProviderStatus = !riskFlow
    ? evaluationStage === 'DISCOVERY_GATE' ? 'STAGE_NOT_FETCHED' : 'MISSING'
    : metadataStatus ?? (overallRisk !== 'UNKNOWN' ? 'VERIFIED' : 'UNKNOWN');
  const providerIssue = Boolean(riskFlow) && !['VERIFIED', 'PARTIAL', 'EMPTY_VALID', 'STAGE_NOT_FETCHED', 'MISSING'].includes(status);
  const notes = unique([
    ...(overallRisk === 'HIGH' ? ['RISK_FLOW_HIGH_DIAGNOSTIC_ONLY'] : []),
    ...(status === 'STAGE_NOT_FETCHED' ? ['RISK_FLOW_STAGE_NOT_FETCHED_NOT_PROVIDER_ERROR'] : []),
  ]);

  return {
    required: false,
    available: status === 'VERIFIED' || status === 'PARTIAL',
    provider: riskProviderFromMetadata(riskFlow),
    status,
    fields: {
      shortPressure: shortPressure !== 'UNKNOWN',
      loanPressure: loanPressure !== 'UNKNOWN',
      creditOverheat: creditOverheat !== 'UNKNOWN',
    },
    values: {
      shortSaleIncreaseRate,
      loanIncreaseRate,
      creditIncreaseRate,
      creditBalanceRatio,
    },
    interpretation: {
      shortPressure,
      loanPressure,
      creditOverheat,
      overallRisk,
    },
    notes,
    stageNotFetched: status === 'STAGE_NOT_FETCHED',
    providerIssue,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    diagnosticOnly: true,
  };
}

function gate2StatusFromSectorThemeCycle(
  providerStatus: SectorThemeCycleProviderStatus | null,
  confidence: SectorThemeCycleConfidence | null,
): Gate2ExternalProviderStatus {
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'PARTIAL') return 'PARTIAL';
  if (confidence === 'EMPTY_VALID') return 'EMPTY_VALID';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (providerStatus === 'OK_WITH_DATA') return 'VERIFIED';
  if (providerStatus === 'PARTIAL_WITH_DATA') return 'PARTIAL';
  if (providerStatus === 'OK_EMPTY') return 'EMPTY_VALID';
  if (providerStatus === 'STALE_CACHE') return 'STALE';
  if (providerStatus === 'FIELD_MISSING') return 'MISSING';
  return providerStatus ? 'DEGRADED' : 'UNKNOWN';
}

function providerIssueForSectorStatus(status: Gate2ExternalProviderStatus): boolean {
  return !['VERIFIED', 'PARTIAL', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
}

function quoteSymbol(input: Gate2ExternalCoverageInput): string {
  const quote = isRecord(input.quote) ? input.quote : {};
  const stockMaster = isRecord(input.stockMaster) ? input.stockMaster : {};
  return stringOrNull(quote.symbol ?? quote.code ?? stockMaster.symbol ?? stockMaster.code) ?? 'UNKNOWN';
}

export function buildGate2ExternalDataCoverage(
  wiring: readonly Gate2WiringDiagnostic[],
  input: Gate2ExternalCoverageInput = {},
): Gate2ExternalDataCoverage {
  const kisRequired = requiredExternal(wiring, 'KIS_INVESTOR_FLOW');
  const dartRequired = requiredExternal(wiring, 'DART_FINANCIALS');
  const benchmarkRequired = requiredExternal(wiring, 'BENCHMARK_20D_RETURN')
    || requiredExternal(wiring, 'BENCHMARK_KOSPI_20D_RETURN');

  const kisRecord: Record<string, unknown> = isRecord(input.kisFlow) ? input.kisFlow : {};
  const kisForeignNetBuy = numberOrNull(kisRecord.foreignNetBuy);
  const kisInstitutionalNetBuy = numberOrNull(kisRecord.institutionalNetBuy ?? kisRecord.institutionNetBuy);
  const kisIndividualNetBuy = numberOrNull(kisRecord.individualNetBuy);
  const kisFields = {
    foreignNetBuy: fieldAvailable(wiring, 'ctx.kisFlow.foreignNetBuy') || fieldAvailable(wiring, 'kisFlow.foreignNetBuy') || kisForeignNetBuy != null,
    institutionalNetBuy: fieldAvailable(wiring, 'ctx.kisFlow.institutionalNetBuy') || fieldAvailable(wiring, 'kisFlow.institutionalNetBuy') || kisInstitutionalNetBuy != null,
    individualNetBuy: kisIndividualNetBuy != null,
  };
  const kisMissingFields = ['foreignNetBuy', 'institutionalNetBuy'].filter(field => kisFields[field as 'foreignNetBuy' | 'institutionalNetBuy'] !== true);
  const dartRecord: Record<string, unknown> = isRecord(input.dartFin) ? input.dartFin : {};
  const dartOcfRatio = numberOrNull(dartRecord.ocfRatio);
  const dartRoe = numberOrNull(dartRecord.roe);
  const dartOpm = numberOrNull(dartRecord.opm);
  const dartOpmYoYDelta = numberOrNull(dartRecord.opmYoYDelta);
  const dartMarginAcceleration = numberOrNull(dartRecord.marginAcceleration);
  const dartInterestCoverageRatio = numberOrNull(dartRecord.interestCoverageRatio);
  const dartOperatingCashFlow = numberOrNull(dartRecord.operatingCashFlow);
  const dartNetIncome = numberOrNull(dartRecord.netIncome);
  const dartLegacyRequiredField = dartOcfRatio != null && dartOperatingCashFlow == null && dartNetIncome == null && !isRecord(dartRecord.rawFieldCoverage);
  const dartFields = {
    ocfRatio: fieldAvailable(wiring, 'ctx.dartFin.ocfRatio') || fieldAvailable(wiring, 'dartFin.ocfRatio'),
    operatingCashFlow: dartOperatingCashFlow != null,
    netIncome: dartNetIncome != null,
    roe: dartRoe != null,
    opm: dartOpm != null,
    opmYoYDelta: dartOpmYoYDelta != null,
    marginAcceleration: dartMarginAcceleration != null,
    interestCoverageRatio: dartInterestCoverageRatio != null,
  };
  const dartMissingFields = dartLegacyRequiredField
    ? []
    : ['operatingCashFlow', 'netIncome'].filter(field => dartFields[field as 'operatingCashFlow' | 'netIncome'] !== true);
  const benchmarkDiagnostic = input.benchmarkReturn ?? normalizeBenchmarkReturnForGate2({
    symbol: quoteSymbol(input),
    market: input.market,
    quote: input.quote,
    stockMaster: input.stockMaster,
    benchmarkRaw: input.benchmarkRaw,
    kospi20dReturn: input.kospi20dReturn,
    kosdaq20dReturn: input.kosdaq20dReturn,
    period: '20D',
    evaluationStage: input.evaluationStage,
  });
  const benchmarkFields = {
    stockReturn20d: benchmarkDiagnostic.stockReturn != null,
    benchmarkReturn20d: benchmarkDiagnostic.benchmarkReturn != null,
    relativeReturn20d: benchmarkDiagnostic.relativeReturn != null,
    kospi20dReturn: fieldAvailable(wiring, 'ctx.kospi20dReturn') || typeof input.kospi20dReturn === 'number' && Number.isFinite(input.kospi20dReturn),
    kosdaq20dReturn: typeof input.kosdaq20dReturn === 'number' && Number.isFinite(input.kosdaq20dReturn),
  };
  // ADR-0571 완결편: 후보별 sectorThemeCycle.sector 합성. repo 전체에 sectorThemeCycle producer 가
  // 0건이라 sector=UNKNOWN → SECTOR_THEME_CYCLE_MISSING → "Sector 0/25" 였다. flag(ON)일 때만,
  // 호출자가 명시 제공하지 않은 경우에 한해 quote/stockMaster.sector→canonical 정규화 또는 종목코드
  // →getSectorByCode 로 canonical 섹터명을 합성한다. 매칭 실패/미분류→undefined(byte-equal graceful).
  const producedSectorThemeCycle = isSectorEnergyGate2WiringEnabled()
    ? produceSectorThemeCycleForGate2({
        symbol: quoteSymbol(input),
        stockSector:
          stringOrNull(isRecord(input.quote) ? input.quote.sector : null) ??
          stringOrNull(isRecord(input.stockMaster) ? input.stockMaster.sector : null),
        existingSectorThemeCycle: input.sectorThemeCycle,
      })
    : undefined;
  const sectorThemeCycleDiagnostic = normalizeSectorThemeCycleForGate2({
    symbol: quoteSymbol(input),
    quote: input.quote,
    stockMaster: input.stockMaster,
    sectorThemeCycle: input.sectorThemeCycle ?? producedSectorThemeCycle,
    // ADR-0568 배선 갭 픽스: SECTOR_ENERGY_GATE2_WIRING_ENABLED OFF(default) 면 undefined 로
    // 무시 → sectorCycle 빌드가 현행과 byte-identical. ON 일 때만 caller(stockScreener/
    // universeScanner)가 thread 한 macroState.sectorEnergyResult 를 SECTOR_LEADERSHIP 축으로 소비.
    sectorEnergyResult: isSectorEnergyGate2WiringEnabled() ? input.sectorEnergyResult : undefined,
    benchmarkReturn20d: benchmarkDiagnostic.benchmarkReturn,
    market: input.market,
  });
  const sectorCycleStatus = gate2StatusFromSectorThemeCycle(
    sectorThemeCycleDiagnostic.providerStatus,
    sectorThemeCycleDiagnostic.dataConfidence,
  );
  const sectorCycleFields = {
    sector: sectorThemeCycleDiagnostic.sector != null,
    industry: sectorThemeCycleDiagnostic.industry != null,
    themeTags: sectorThemeCycleDiagnostic.themeTags.length > 0,
    sectorReturn20d: sectorThemeCycleDiagnostic.sectorReturn20d != null,
    sectorReturn60d: sectorThemeCycleDiagnostic.sectorReturn60d != null,
    benchmarkReturn20d: sectorThemeCycleDiagnostic.benchmarkReturn20d != null,
    benchmarkReturn60d: sectorThemeCycleDiagnostic.benchmarkReturn60d != null,
    sectorRelativeReturn20d: sectorThemeCycleDiagnostic.sectorRelativeReturn20d != null,
    sectorRelativeReturn60d: sectorThemeCycleDiagnostic.sectorRelativeReturn60d != null,
    stockReturn20d: sectorThemeCycleDiagnostic.stockReturn20d != null,
    stockReturn60d: sectorThemeCycleDiagnostic.stockReturn60d != null,
    stockVsSectorReturn20d: sectorThemeCycleDiagnostic.stockVsSectorReturn20d != null,
    stockVsSectorReturn60d: sectorThemeCycleDiagnostic.stockVsSectorReturn60d != null,
  };
  const marketProgramFlow = input.programTrade?.marketProgram ?? null;
  const stockProgramFlow = input.programTrade?.stockProgram ?? null;
  const marketProgramScopeValid = !marketProgramFlow || marketProgramFlow.scope === 'MARKET';
  const stockProgramScopeValid = !stockProgramFlow || stockProgramFlow.scope === 'STOCK';
  const scopeSeparationValid = marketProgramScopeValid && stockProgramScopeValid;
  const marketProgramBaseStatus = programStageStatus(marketProgramFlow, input.evaluationStage);
  const stockProgramBaseStatus = programStageStatus(stockProgramFlow, input.evaluationStage);
  const marketProgramStatus = marketProgramScopeValid ? marketProgramBaseStatus : 'DEGRADED';
  const stockProgramStatus = stockProgramScopeValid ? stockProgramBaseStatus : 'DEGRADED';
  const marketProgramFields = {
    programNetBuyAmount: marketProgramFlow?.programNetBuyAmount != null,
    arbitrageNetBuyAmount: marketProgramFlow?.arbitrageNetBuyAmount != null,
    nonArbitrageNetBuyAmount: marketProgramFlow?.nonArbitrageNetBuyAmount != null,
  };
  const stockProgramFields = {
    programNetBuyAmount: stockProgramFlow?.programNetBuyAmount != null,
    programNetBuyVolume: stockProgramFlow?.programNetBuyVolume != null,
  };
  const programTradeNotes = unique([
    ...(marketProgramFlow ? ['MARKET_PROGRAM_TRADE_IS_CONTEXT_ONLY_NOT_STOCK_SIGNAL'] : []),
    ...(stockProgramStatus === 'VERIFIED' ? ['STOCK_PROGRAM_TRADE_AVAILABLE_FOR_SYMBOL'] : []),
    ...(marketProgramStatus === 'EMPTY_VALID' || stockProgramStatus === 'EMPTY_VALID' ? ['PROGRAM_TRADE_EMPTY_VALID_NOT_BEARISH'] : []),
    ...(marketProgramFlow && stockProgramStatus === 'STAGE_NOT_FETCHED' ? ['MARKET_PROGRAM_ONLY_STOCK_PROGRAM_NOT_FETCHED'] : []),
    ...(!scopeSeparationValid ? ['SCOPE_MISMATCH_MARKET_DATA_USED_AS_STOCK_FLOW'] : []),
  ]);
  const riskFlowCoverage = buildGate2RiskFlowCoverage(input.riskFlow, input.evaluationStage);

  const kisFieldsAvailable = kisRequired && kisFields.foreignNetBuy && kisFields.institutionalNetBuy;
  const kisStatus = resolveKisStatus({
    required: kisRequired,
    fieldsAvailable: kisFieldsAvailable,
    missing: externalMissing(wiring, 'KIS_INVESTOR_FLOW'),
    kisFlow: input.kisFlow,
    evaluationStage: input.evaluationStage,
  });
  const kisAvailable = kisFieldsAvailable && !externalMissing(wiring, 'KIS_INVESTOR_FLOW') && kisStatus === 'VERIFIED';
  const dartStatus = resolveDartStatus({
    required: dartRequired,
    ocfAvailable: dartFields.ocfRatio,
    missing: externalMissing(wiring, 'DART_FINANCIALS'),
    dartFin: input.dartFin,
    evaluationStage: input.evaluationStage,
  });
  const dartAvailable = dartRequired && dartFields.ocfRatio && !externalMissing(wiring, 'DART_FINANCIALS') && dartStatus === 'VERIFIED';
  const benchmarkStatus = resolveBenchmarkStatus({
    required: benchmarkRequired,
    benchmark: benchmarkDiagnostic,
    missing: externalMissing(wiring, 'BENCHMARK_20D_RETURN')
      || externalMissing(wiring, 'BENCHMARK_KOSPI_20D_RETURN'),
    evaluationStage: input.evaluationStage,
  });
  const benchmarkAvailable = benchmarkRequired
    && benchmarkFields.stockReturn20d
    && benchmarkFields.benchmarkReturn20d
    && !externalMissing(wiring, 'BENCHMARK_20D_RETURN')
    && !externalMissing(wiring, 'BENCHMARK_KOSPI_20D_RETURN')
    && benchmarkStatus === 'VERIFIED';
  const kisEndpoint = kisEndpointMetadata(input.kisFlow);
  const kisProviderStatusValue = kisProviderStatus(input.kisFlow);
  const kisDataConfidence = kisConfidence(input.kisFlow);
  const dartProviderStatusValue = dartProviderStatus(input.dartFin);
  const dartDataConfidence = dartConfidence(input.dartFin);
  // §B — 합성 refreshTrace 를 전달해 dartLineHealth 가 NOT_ATTEMPTED 대신 실제 상태
  // (VERIFIED/PARTIAL/DEGRADED/EMPTY_VALID)를 반영하게 한다. provider 재호출 0.
  const anyDartFieldAvailable = dartFields.roe || dartFields.opm || dartFields.interestCoverageRatio
    || dartFields.ocfRatio || dartFields.operatingCashFlow || dartFields.netIncome;
  const dartRefreshTraceForDisplay = synthesizeDartRefreshTraceForDisplay({
    symbol: quoteSymbol(input),
    dartFin: input.dartFin,
    dartStatus,
    dartProviderStatus: dartProviderStatusValue,
    anyDartFieldAvailable,
  });
  const gate2FinancialProjection = buildGate2ExternalProjection({
    symbol: quoteSymbol(input),
    dartFin: input.dartFin,
    quote: input.quote,
    refreshTrace: dartRefreshTraceForDisplay,
  });

  return {
    kisInvestorFlow: {
      required: kisRequired,
      available: kisAvailable,
      provider: providerFromMetadata(input.kisFlow, { verified: kisRequired && input.kisFlow ? 'KIS_API' : 'UNKNOWN', cache: 'CACHE', unknown: 'UNKNOWN' }) as Gate2ExternalDataCoverage['kisInvestorFlow']['provider'],
      endpointKey: kisEndpoint.endpointKey,
      endpoint: kisEndpoint.endpoint,
      trId: kisEndpoint.trId,
      providerStatus: kisProviderStatusValue,
      dataConfidence: kisDataConfidence,
      status: kisStatus,
      fields: kisFields,
      foreignNetBuy: kisForeignNetBuy,
      institutionalNetBuy: kisInstitutionalNetBuy,
      individualNetBuy: kisIndividualNetBuy,
      missingFields: kisMissingFields,
      rawFieldCoverage: kisRawFieldCoverage(input.kisFlow, kisMissingFields),
      driftDiagnostics: kisEndpoint.driftDiagnostics,
      stageNotFetched: kisStatus === 'STAGE_NOT_FETCHED',
      providerIssue: providerIssueForKisStatus(kisRequired, kisStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    },
    dartFinancials: {
      required: dartRequired,
      available: dartAvailable,
      provider: dartProviderFromMetadata(input.dartFin),
      providerStatus: dartProviderStatusValue,
      dataConfidence: dartDataConfidence,
      status: dartStatus,
      fields: dartFields,
      ocfRatio: dartOcfRatio,
      roe: dartRoe,
      opm: dartOpm,
      opmYoYDelta: dartOpmYoYDelta,
      marginAcceleration: dartMarginAcceleration,
      interestCoverageRatio: dartInterestCoverageRatio,
      missingFields: dartMissingFields,
      rawFieldCoverage: dartRawFieldCoverage(input.dartFin, dartMissingFields, dartLegacyRequiredField),
      fiscalPeriod: gate2FinancialProjection.financialSnapshot.fiscalPeriod,
      lastUpdated: gate2FinancialProjection.financialSnapshot.lastUpdated,
      financialSnapshot: gate2FinancialProjection.financialSnapshot as unknown as Record<string, unknown>,
      profitability: gate2FinancialProjection.profitability as unknown as Record<string, unknown>,
      stability: gate2FinancialProjection.stability as unknown as Record<string, unknown>,
      earningsQuality: gate2FinancialProjection.earningsQuality as unknown as Record<string, unknown>,
      stageNotFetched: dartStatus === 'STAGE_NOT_FETCHED',
      providerIssue: providerIssueForDartStatus(dartRequired, dartStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    },
    valuation: gate2FinancialProjection.valuation as unknown as Record<string, unknown>,
    profitability: gate2FinancialProjection.profitability as unknown as Record<string, unknown>,
    stability: gate2FinancialProjection.stability as unknown as Record<string, unknown>,
    earningsQuality: gate2FinancialProjection.earningsQuality as unknown as Record<string, unknown>,
    // followup ②: projection dartLineHealth 를 external 레코드에 carry → entryFilterDecomposition
    // formatter 의 DART_FINANCIALS availableFields/missingFields 표시가 NONE 대신 실값을 읽는다.
    // 새 외부 호출 0, executionImpact=NONE + providerIssue/marketSignal=false 보존.
    dartLineHealth: gate2FinancialProjection.dartLineHealth as unknown as Record<string, unknown>,
    conditionResults: gate2FinancialProjection.conditionResults as unknown as Record<string, unknown>,
    gate2ConditionProjection: gate2FinancialProjection.conditionResults as unknown as Record<string, unknown>,
    unavailableCount: gate2FinancialProjection.unavailableCount,
    highConvictionImpact: gate2FinancialProjection.highConvictionImpact,
    entryHardBlockImpact: gate2FinancialProjection.entryHardBlockImpact,
    shadowObservablePreserved: gate2FinancialProjection.shadowObservablePreserved,
    counterfactualAllowed: gate2FinancialProjection.counterfactualAllowed,
    executionImpact: 'NONE',
    benchmark: {
      required: benchmarkRequired,
      available: benchmarkAvailable,
      provider: benchmarkDiagnostic.source,
      providerStatus: benchmarkDiagnostic.providerStatus,
      dataConfidence: benchmarkDiagnostic.dataConfidence,
      status: benchmarkStatus,
      market: benchmarkDiagnostic.market,
      benchmarkKey: benchmarkDiagnostic.benchmarkKey,
      period: '20D',
      fields: benchmarkFields,
      values: {
        stockReturn20d: benchmarkDiagnostic.stockReturn,
        benchmarkReturn20d: benchmarkDiagnostic.benchmarkReturn,
        relativeReturn20d: benchmarkDiagnostic.relativeReturn,
      },
      missingFields: benchmarkDiagnostic.rawFieldCoverage?.missingFields ?? [],
      rawFieldCoverage: benchmarkDiagnostic.rawFieldCoverage ?? {
        requiredFields: ['stockReturn20d', 'benchmarkReturn20d'],
        presentFields: [],
        missingFields: ['stockReturn20d', 'benchmarkReturn20d'],
        allRequiredFieldsPresent: false,
      },
      stageNotFetched: benchmarkStatus === 'STAGE_NOT_FETCHED',
      providerIssue: providerIssueForBenchmarkStatus(benchmarkRequired, benchmarkStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      notes: benchmarkDiagnostic.notes,
    },
    programTrade: {
      required: false,
      available: marketProgramStatus === 'VERIFIED' || stockProgramStatus === 'VERIFIED',
      provider: programProviderFromFlows(marketProgramFlow, stockProgramFlow),
      marketProgram: {
        available: marketProgramScopeValid && marketProgramStatus === 'VERIFIED',
        endpointKey: marketProgramFlow?.endpointKey === 'COMP_PROGRAM_TRADE_TODAY' ? 'COMP_PROGRAM_TRADE_TODAY' : 'UNKNOWN',
        endpoint: marketProgramFlow?.endpoint ?? null,
        trId: marketProgramFlow?.trId ?? null,
        providerStatus: marketProgramFlow?.providerStatus ?? null,
        dataConfidence: marketProgramFlow?.dataConfidence ?? null,
        status: marketProgramStatus,
        scope: 'MARKET',
        fields: marketProgramFields,
        values: {
          programNetBuyAmount: marketProgramFlow?.programNetBuyAmount ?? null,
          arbitrageNetBuyAmount: marketProgramFlow?.arbitrageNetBuyAmount ?? null,
          nonArbitrageNetBuyAmount: marketProgramFlow?.nonArbitrageNetBuyAmount ?? null,
        },
        rawFieldCoverage: programRawFieldCoverage(marketProgramFlow, ['programNetBuyAmount']),
        driftDiagnostics: marketProgramFlow?.driftDiagnostics ?? [],
        stageNotFetched: marketProgramStatus === 'STAGE_NOT_FETCHED',
        providerIssue: providerIssueForOptionalProgramFlow(marketProgramFlow, marketProgramStatus, marketProgramScopeValid),
        marketSignal: false,
      },
      stockProgram: {
        available: stockProgramScopeValid && stockProgramStatus === 'VERIFIED',
        endpointKey: stockProgramFlow?.endpointKey === 'PROGRAM_TRADE_BY_STOCK_DAILY' ? 'PROGRAM_TRADE_BY_STOCK_DAILY' : 'UNKNOWN',
        endpoint: stockProgramFlow?.endpoint ?? null,
        trId: stockProgramFlow?.trId ?? null,
        providerStatus: stockProgramFlow?.providerStatus ?? null,
        dataConfidence: stockProgramFlow?.dataConfidence ?? null,
        status: stockProgramStatus,
        scope: 'STOCK',
        fields: stockProgramFields,
        values: {
          programNetBuyAmount: stockProgramFlow?.programNetBuyAmount ?? null,
          programNetBuyVolume: stockProgramFlow?.programNetBuyVolume ?? null,
        },
        rawFieldCoverage: programRawFieldCoverage(stockProgramFlow, ['programNetBuyAmount']),
        driftDiagnostics: stockProgramFlow?.driftDiagnostics ?? [],
        stageNotFetched: stockProgramStatus === 'STAGE_NOT_FETCHED',
        providerIssue: providerIssueForOptionalProgramFlow(stockProgramFlow, stockProgramStatus, stockProgramScopeValid),
        marketSignal: false,
      },
      scopeSeparationValid,
      notes: programTradeNotes,
      executionImpact: 'DIAGNOSTIC_ONLY',
      marketSignal: false,
    },
    riskFlow: riskFlowCoverage,
    sectorCycle: {
      required: false,
      available: sectorThemeCycleDiagnostic.sector != null && ['VERIFIED', 'PARTIAL'].includes(sectorCycleStatus),
      provider: sectorThemeCycleDiagnostic.source,
      providerStatus: sectorThemeCycleDiagnostic.providerStatus,
      dataConfidence: sectorThemeCycleDiagnostic.dataConfidence,
      status: sectorCycleStatus,
      symbol: sectorThemeCycleDiagnostic.symbol,
      sector: sectorThemeCycleDiagnostic.sector,
      industry: sectorThemeCycleDiagnostic.industry,
      themeTags: sectorThemeCycleDiagnostic.themeTags,
      market: sectorThemeCycleDiagnostic.market,
      fields: sectorCycleFields,
      values: {
        sectorReturn20d: sectorThemeCycleDiagnostic.sectorReturn20d,
        sectorReturn60d: sectorThemeCycleDiagnostic.sectorReturn60d,
        benchmarkReturn20d: sectorThemeCycleDiagnostic.benchmarkReturn20d,
        benchmarkReturn60d: sectorThemeCycleDiagnostic.benchmarkReturn60d,
        sectorRelativeReturn20d: sectorThemeCycleDiagnostic.sectorRelativeReturn20d,
        sectorRelativeReturn60d: sectorThemeCycleDiagnostic.sectorRelativeReturn60d,
        stockReturn20d: sectorThemeCycleDiagnostic.stockReturn20d,
        stockReturn60d: sectorThemeCycleDiagnostic.stockReturn60d,
        stockVsSectorReturn20d: sectorThemeCycleDiagnostic.stockVsSectorReturn20d,
        stockVsSectorReturn60d: sectorThemeCycleDiagnostic.stockVsSectorReturn60d,
        sectorRank20d: sectorThemeCycleDiagnostic.sectorRank20d,
        sectorRank60d: sectorThemeCycleDiagnostic.sectorRank60d,
        sectorPercentile20d: sectorThemeCycleDiagnostic.sectorPercentile20d,
        sectorPercentile60d: sectorThemeCycleDiagnostic.sectorPercentile60d,
      },
      missingFields: sectorThemeCycleDiagnostic.rawFieldCoverage?.missingFields ?? [],
      rawFieldCoverage: sectorThemeCycleDiagnostic.rawFieldCoverage ?? {
        requiredFields: ['sector', 'stockReturn20d', 'sectorReturn20d'],
        presentFields: [],
        missingFields: ['sector', 'stockReturn20d', 'sectorReturn20d'],
        allRequiredFieldsPresent: false,
      },
      providerIssue: providerIssueForSectorStatus(sectorCycleStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      diagnosticOnly: true,
      notes: sectorThemeCycleDiagnostic.notes ?? [],
    },
    leaderCycle: {
      required: false,
      available: sectorThemeCycleDiagnostic.leaderCyclePhase !== 'UNKNOWN'
        && ['VERIFIED', 'PARTIAL'].includes(sectorCycleStatus),
      status: sectorCycleStatus,
      leaderCyclePhase: sectorThemeCycleDiagnostic.leaderCyclePhase,
      isCurrentLeadingSector: sectorThemeCycleDiagnostic.isCurrentLeadingSector,
      isSectorLeader: sectorThemeCycleDiagnostic.isSectorLeader,
      isPreviousCycleLeader: sectorThemeCycleDiagnostic.isPreviousCycleLeader,
      isNewLeaderCandidate: sectorThemeCycleDiagnostic.isNewLeaderCandidate,
      newsFrequency30d: sectorThemeCycleDiagnostic.newsFrequency30d,
      newsCrowdingScore: sectorThemeCycleDiagnostic.newsCrowdingScore,
      attentionPhase: sectorThemeCycleDiagnostic.attentionPhase,
      providerIssue: providerIssueForSectorStatus(sectorCycleStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      diagnosticOnly: true,
      notes: sectorThemeCycleDiagnostic.notes ?? [],
    },
  };
}
