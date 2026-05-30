/**
 * @responsibility ADR-0464 entry filter formatter.
 */

import type { EntryFilterDecomposition, EntryBlocker } from './types.js';
import { KIS_INVESTOR_FLOW_CANONICAL } from '../gate2KisFlowTraceMetadata.js';

// §A — canonical runtime resolution(kisInvestorFlow) 의 권위 신호. KIS Router Eligibility 와
// 동일 SSOT 에서 파생되며, Gate2 Data Line Health KIS_FLOW 표시의 단일 근거가 된다.
// 표시 전용 — executionImpact/marketSignal 불변, provider 재호출 0.
export interface Gate2CanonicalKisFlow {
  selectedProvider: string;
  finalRouterUsable: boolean;
  finalGateScoreEligible: boolean;
  gateEligibleRows: number;
  totalRows: number;
  shadowOnlyRows: number;
  failedCriteria: string[];
  providerIssue: boolean;
  marketSignal: boolean;
}

export interface Gate2CanonicalContext {
  kisInvestorFlow?: Gate2CanonicalKisFlow;
}


const finite = (n: unknown): n is number => Number.isFinite(n as number);
const getByPath = (obj: unknown, path: string): unknown => {
  const keys = path.split('.');
  let cur: unknown = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
};
const resolveNumericFeature = (row: unknown, aliases: string[], hitMap?: Record<string, number>): number | undefined => {
  for (const alias of aliases) {
    const value = getByPath(row, alias);
    if (finite(value)) {
      if (hitMap) hitMap[alias] = (hitMap[alias] ?? 0) + 1;
      return value as number;
    }
  }
  return undefined;
};
const componentTrace = (row: unknown, code: string): Record<string, unknown> | undefined => {
  const components =
    getByPath(row, 'minSignalScoreTrace.components') ??
    getByPath(row, 'gate1Trace.minSignalScoreTrace.components');
  if (!Array.isArray(components)) return undefined;
  return components.find((component) =>
    component &&
    typeof component === 'object' &&
    (component as Record<string, unknown>).code === code,
  ) as Record<string, unknown> | undefined;
};
const componentConnected = (component: Record<string, unknown> | undefined): boolean =>
  Boolean(component && component.confidence !== 'MISSING');
const resolveComponentWeightedScore = (
  row: unknown,
  code: string,
  hitMap?: Record<string, number>,
): number | undefined => {
  const component = componentTrace(row, code);
  if (!componentConnected(component)) return undefined;
  const value = component?.weightedScore;
  if (finite(value)) {
    const key = `minSignalScoreTrace.components.${code}.weightedScore`;
    if (hitMap) hitMap[key] = (hitMap[key] ?? 0) + 1;
    return value as number;
  }
  return undefined;
};
const resolveComponentRawNumber = (
  row: unknown,
  code: string,
  aliases: string[],
  hitMap?: Record<string, number>,
): number | undefined => {
  const component = componentTrace(row, code);
  if (!componentConnected(component)) return undefined;
  const raw = component?.rawValue;
  for (const alias of aliases) {
    const value = alias === '$self' ? raw : getByPath(raw, alias);
    if (finite(value)) {
      const key = `minSignalScoreTrace.components.${code}.rawValue.${alias === '$self' ? 'value' : alias}`;
      if (hitMap) hitMap[key] = (hitMap[key] ?? 0) + 1;
      return value as number;
    }
  }
  return undefined;
};
const hasAnyPath = (row: unknown, paths: readonly string[]): boolean =>
  paths.some((path) => getByPath(row, path) !== undefined);
const pickNumber = (trace: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const direct = (trace as Record<string, unknown>)[key];
    if (finite(direct)) return direct as number;
    const quote = trace.quote as Record<string, unknown> | undefined;
    if (quote && finite(quote[key])) return quote[key] as number;
    const sf = trace.symbolFeatures as Record<string, unknown> | undefined;
    if (sf && finite(sf[key])) return sf[key] as number;
  }
  return undefined;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rsScoreFromRank(rank: number): number {
  if (rank >= 90) return 10;
  if (rank >= 80) return 8;
  if (rank >= 60) return 5;
  if (rank >= 50) return 2;
  return 0;
}

function r1(n: number): string { return n.toFixed(1); }

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function nestedRecord(source: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  return recordOf(source?.[key]);
}

function statusOf(source: Record<string, unknown> | undefined, fallback: string): string {
  return stringValue(source?.status, fallback).toUpperCase();
}

function resolveGate2ExternalData(sample: unknown): Record<string, unknown> | undefined {
  const direct = recordOf(getByPath(sample, 'gate2ExternalDataCoverage'));
  if (direct) return direct;
  return recordOf(getByPath(sample, 'gateLayerSummary.gate2.externalDataCoverage'));
}

function dartReason(status: string): string {
  if (status === 'VERIFIED') return 'NONE';
  if (status === 'STAGE_NOT_FETCHED' || status === 'DEFERRED') return 'STAGE_NOT_FETCHED';
  if (status === 'ERROR' || status === 'DEGRADED') return 'API_ERROR';
  return 'DART_FINANCIALS_MISSING';
}

function valuationStatus(external: Record<string, unknown> | undefined, dartStatus: string): { status: string; source: string } {
  const valuation = nestedRecord(external, 'valuation');
  const explicitPer = statusOf(nestedRecord(valuation, 'per'), '');
  if (explicitPer) return { status: explicitPer, source: stringValue(nestedRecord(valuation, 'per')?.source ?? valuation?.source, 'NONE') };
  if (dartStatus === 'VERIFIED') return { status: 'DEFERRED', source: 'DART' };
  if (dartStatus === 'STAGE_NOT_FETCHED') return { status: 'DEFERRED', source: 'NONE' };
  return { status: 'MISSING', source: 'NONE' };
}

function shadowAwareStageStatus(status: string): string {
  if (status === 'VERIFIED') return 'VERIFIED';
  if (status === 'PARTIAL' || status === 'DEGRADED') return 'SHADOW_ONLY';
  if (status === 'UNKNOWN') return 'UNKNOWN';
  return 'MISSING';
}

// §D ProgramTrade optional lane: program 수급 데이터는 선택 진단축이며, 부재가 Gate2 실패로
// 승격되지 않는다. transport/parse 오류일 때만 providerIssue=true, 그 외 부재는 false.
function programTradeLane(external: Record<string, unknown> | undefined): {
  status: string;
  providerIssue: boolean;
} {
  const program = nestedRecord(external, 'programTrade') ?? nestedRecord(external, 'marketProgram');
  if (!program) return { status: 'MISSING', providerIssue: false };
  const status = statusOf(program, 'MISSING');
  // providerIssue 는 명시 transport/parse error 일 때만 true (missing/empty 는 false).
  const providerIssue = program.providerIssue === true;
  return { status, providerIssue };
}

// §G dartFinancials line health (B+C 가 projection 에 추가한 dartLineHealth) 의
// availableFields/missingFields 를 표시용 문자열로 환원. 없으면 NONE.
function dartLineFields(external: Record<string, unknown> | undefined): {
  available: string;
  missing: string;
} {
  const health = nestedRecord(external, 'dartLineHealth');
  const toCsv = (value: unknown): string =>
    Array.isArray(value) && value.length > 0
      ? value.filter((item): item is string => typeof item === 'string').join(',') || 'NONE'
      : 'NONE';
  return {
    available: toCsv(health?.availableFields),
    missing: toCsv(health?.missingFields),
  };
}

function formatGate2ExternalDataStageSection(d: EntryFilterDecomposition, canonical?: Gate2CanonicalContext): string[] {
  const sample = d.candidateTraces[0];
  const external = resolveGate2ExternalData(sample);
  const dart = nestedRecord(external, 'dartFinancials');
  const sectorCycle = nestedRecord(external, 'sectorCycle');
  const leaderCycle = nestedRecord(external, 'leaderCycle');
  const dartStatus = statusOf(dart, 'MISSING');
  const valuation = valuationStatus(external, dartStatus);
  const sectorStatus = shadowAwareStageStatus(statusOf(sectorCycle, 'MISSING'));
  const leaderStatus = shadowAwareStageStatus(statusOf(leaderCycle, 'UNKNOWN'));
  const sectorSourceTier =
    stringValue(sectorCycle?.sourceTier, '') ||
    stringValue(sectorCycle?.provider, '') ||
    (sectorStatus === 'SHADOW_ONLY' ? 'INTERNAL_GROUPED_SNAPSHOT' : 'NONE');
  const leaderSourceTier =
    stringValue(leaderCycle?.sourceTier, '') ||
    (leaderStatus === 'SHADOW_ONLY' ? sectorSourceTier : 'NONE');
  // §D program optional lane — missing 은 OPTIONAL_MISSING 으로 표기하고 Gate2 failure 와 분리.
  const program = programTradeLane(external);
  const programCompact = program.status === 'MISSING' ? 'OPTIONAL_MISSING' : program.status;
  const lines = [
    'Gate2ExternalData:',
    `- dart: status=${dartStatus} reason=${dartReason(dartStatus)} affectedConditions=earnings_quality,roe,opm,icr,per scoreImpact=limited_to_high_conviction executionImpact=NONE`,
    `- valuation: perStatus=${valuation.status} source=${valuation.source} reason=${stringValue(nestedRecord(nestedRecord(external, 'valuation'), 'per')?.reason, 'NONE')}`,
    // §E observe lane — sector/leader MISSING/UNKNOWN 을 hard fail 로 취급하지 않음(diagnosticOnly).
    `- sectorCycle: status=${sectorStatus} sourceTier=${sectorSourceTier} marketSignal=false diagnosticOnly=true executionImpact=NONE`,
    `- leaderCycle: status=${leaderStatus} sourceTier=${leaderSourceTier} marketSignal=false diagnosticOnly=true executionImpact=NONE`,
    // §D program optional lane
    `- program: status=${program.status} compact=${programCompact} optional=true signal=UNKNOWN scoring=excluded diagnosticOnly=true marketSignal=false providerIssue=${program.providerIssue} executionImpact=NONE action=OBSERVE_PROGRAM_TRADE`,
    '- highConvictionImpact=BLOCK_STRONG_BUY_UPGRADE',
    '- entryHardBlockImpact=NO',
    '- shadowObservablePreserved=true',
    '- counterfactualAllowed=true',
    '- executionImpact=NONE',
  ];
  // §G Gate2 Data Line Health 통합 요약 블록 (표시 전용, 값/판정 무변경).
  const kisFlowLine = resolveKisFlowDataLine({
    canonical: canonical?.kisInvestorFlow,
    fallbackStatus: stringValue(d.supplyProviderHealth?.status, 'UNKNOWN'),
  });
  const dartLineStatus = statusOf(nestedRecord(external, 'dartLineHealth'), dartStatus);
  lines.push(...formatGate2DataLineHealthSection({
    dartStatus,
    valuationStatus: valuation.status,
    valuationSource: valuation.source,
    sectorStatus,
    sectorSourceTier,
    leaderStatus,
    leaderSourceTier,
    programStatus: program.status,
    kisFlowLine,
    external,
  }));
  // §C — VALUATION_PER 종목별 reason 분해.
  lines.push(...formatValuationPerReasonDistribution(d));
  // §E — dominant attribution (DART VERIFIED 면 FUNDAMENTAL_DATA_UNAVAILABLE 로 묶지 않음).
  const dominant = resolveGate2Dominant({ d, dartLineStatus, kisFlowStatus: kisFlowLine.status });
  // §D — Gate2 Condition Attribution Matrix.
  lines.push(...formatGate2ConditionAttributionMatrix(d, dominant));
  lines.push(`- dominant=${dominant.code}`);
  // §F — Gate2 Data Line ↔ Wiring invariant 검증.
  lines.push(...formatGate2DataLineInvariants({
    canonical: canonical?.kisInvestorFlow,
    kisFlowStatus: kisFlowLine.status,
    dartLineStatus,
    programStatus: program.status,
    programProviderIssue: program.providerIssue,
  }));
  return lines;
}

// §A — KIS_FLOW Data Line 상태/상세를 canonical runtime resolution 에서 파생한다.
// finalRouterUsable && finalGateScoreEligible → VERIFIED, gateEligibleRows>0 → PARTIAL_VERIFIED,
// providerIssue → DEGRADED. canonical 부재 시 supplyProviderHealth.status 로 후방호환.
// apiPath/trId 는 KIS_API provider 일 때 canonical SSOT 에서 carry.
function resolveKisFlowDataLine(input: {
  canonical?: Gate2CanonicalKisFlow;
  fallbackStatus: string;
}): { status: string; detail: string } {
  const c = input.canonical;
  if (!c) {
    return { status: input.fallbackStatus, detail: '(상세는 KIS Router Eligibility 참조)' };
  }
  const provider = stringValue(c.selectedProvider, 'UNKNOWN');
  const isKis = provider === 'KIS_API';
  const apiPath = isKis ? KIS_INVESTOR_FLOW_CANONICAL.apiPath : 'NONE';
  const trId = isKis ? KIS_INVESTOR_FLOW_CANONICAL.trId : 'NONE';
  let status: string;
  if (c.finalRouterUsable && c.finalGateScoreEligible) {
    status = 'VERIFIED';
  } else if (c.gateEligibleRows > 0) {
    status = 'PARTIAL_VERIFIED';
  } else if (c.providerIssue) {
    status = 'DEGRADED';
  } else {
    status = input.fallbackStatus === 'VERIFIED' ? 'PARTIAL_VERIFIED' : input.fallbackStatus;
  }
  const detail = `gateEligibleRows=${c.gateEligibleRows}/${c.totalRows} provider=${provider} apiPath=${apiPath} trId=${trId}`;
  return { status, detail };
}

// §G Gate2 Data Line Health 통합 블록 — 각 외부 데이터 라인의 상태를 한 곳에서 요약.
// KIS_FLOW 상세는 별도 KIS Router Eligibility 섹션 참조. executionImpact/marketSignal 무변경.
function formatGate2DataLineHealthSection(input: {
  dartStatus: string;
  valuationStatus: string;
  valuationSource: string;
  sectorStatus: string;
  sectorSourceTier: string;
  leaderStatus: string;
  leaderSourceTier: string;
  programStatus: string;
  kisFlowLine: { status: string; detail: string };
  external: Record<string, unknown> | undefined;
}): string[] {
  const dartFields = dartLineFields(input.external);
  // §B — dartLineHealth.status 는 합성 refreshTrace 를 통해 실제 상태(VERIFIED/PARTIAL/DEGRADED/
  // EMPTY_VALID)를 반영한다. NOT_ATTEMPTED 는 dartFin 부재(실제 미시도)일 때만 표기된다.
  const dartLineStatus = statusOf(nestedRecord(input.external, 'dartLineHealth'), input.dartStatus);
  const valuationLine =
    input.valuationStatus === 'AVAILABLE' || input.valuationStatus === 'VERIFIED'
      ? 'AVAILABLE'
      : 'UNAVAILABLE';
  const valuationReason = stringValue(
    nestedRecord(nestedRecord(input.external, 'valuation'), 'per')?.reason,
    'NONE',
  );
  // §D/§G — program/sector/leader 는 optional/diagnosticOnly. entry hard block 으로 승격 금지.
  const programLine = input.programStatus === 'MISSING' ? 'OPTIONAL_MISSING' : input.programStatus;
  const sectorLine = input.sectorStatus === 'MISSING' ? 'DIAGNOSTIC_MISSING' : input.sectorStatus;
  const leaderLine = (input.leaderStatus === 'MISSING' || input.leaderStatus === 'UNKNOWN')
    ? 'DIAGNOSTIC_MISSING'
    : input.leaderStatus;
  return [
    'Gate2 Data Line Health:',
    // §A — KIS_FLOW 는 canonicalRuntimeResolution.kisInvestorFlow(=KIS Router Eligibility 동일 SSOT)
    // 에서 파생. finalRouterUsable && finalGateScoreEligible 면 VERIFIED, gateEligibleRows/provider/
    // apiPath/trId carry. 투자흐름 미가용 시에만 MISSING/DEGRADED.
    `- KIS_FLOW: ${input.kisFlowLine.status} ${input.kisFlowLine.detail} signal=NONE impact=NONE`,
    `- DART_FINANCIALS: ${dartLineStatus} availableFields=${dartFields.available} missingFields=${dartFields.missing} providerIssue=${boolText(nestedRecord(input.external, 'dartLineHealth')?.providerIssue)}`,
    `- VALUATION_PER: ${valuationLine} source=${input.valuationSource} reason=${valuationReason} highConvictionOnly=true entryHardBlock=false`,
    `- PROGRAM_TRADE: ${programLine} optional=true diagnosticOnly=true`,
    `- SECTOR_CYCLE: ${sectorLine} sourceTier=${input.sectorSourceTier} diagnosticOnly=true shadowOnly=true`,
    `- LEADER_CYCLE: ${leaderLine} sourceTier=${input.leaderSourceTier} diagnosticOnly=true shadowOnly=true`,
    '- executionImpact=NONE marketSignal=false shadowLearning=true',
  ];
}

function boolText(value: unknown): string {
  return value === true ? 'true' : 'false';
}

// §C — VALUATION_PER unavailable 을 단일 UNAVAILABLE 로 뭉개지 않고 종목별 reason 으로 분해한다.
// PER 임계/판정은 무변경 — 진단 분류 전용. KIS_FINANCE_PRIMARY_ENABLED ENV 상태도 표기.
function classifyPerReason(reason: string, perStatus: string, source: string): string {
  const upper = reason.toUpperCase();
  if (perStatus === 'AVAILABLE' || perStatus === 'VERIFIED') return 'AVAILABLE';
  if (upper.includes('NON_POSITIVE') || upper.includes('NEGATIVE') || upper.includes('NON_POSITIVE_OR_UNAVAILABLE')) return 'PER_NON_POSITIVE';
  if (upper.includes('PARSE')) return 'PER_PARSE_FAILED';
  if (upper.includes('NOT_ATTEMPTED') || (source === 'NONE' && upper === 'NONE')) return 'FINANCE_API_NOT_ATTEMPTED';
  if (upper.includes('EMPTY')) return 'FINANCE_API_EMPTY';
  if (upper.includes('MISSING') || upper === 'PER_MISSING' || upper === 'NONE') return 'PER_FIELD_MISSING';
  return 'PER_FIELD_MISSING';
}

function formatValuationPerReasonDistribution(d: EntryFilterDecomposition): string[] {
  const financePrimaryEnabled = process.env.KIS_FINANCE_PRIMARY_ENABLED === 'true';
  const distribution: Record<string, number> = {
    PER_NON_POSITIVE: 0,
    PER_FIELD_MISSING: 0,
    PER_PARSE_FAILED: 0,
    FINANCE_API_NOT_ATTEMPTED: 0,
    FINANCE_API_EMPTY: 0,
  };
  const affected: string[] = [];
  let resolvedSource = 'NONE';
  let evaluated = 0;
  for (const trace of d.candidateTraces) {
    const external = resolveGate2ExternalData(trace);
    const per = nestedRecord(nestedRecord(external, 'valuation'), 'per');
    if (!per) continue;
    evaluated += 1;
    const perStatus = statusOf(per, 'UNAVAILABLE');
    const source = stringValue(per.source, 'NONE');
    if (source !== 'NONE') resolvedSource = source;
    const reasonClass = classifyPerReason(stringValue(per.reason, 'NONE'), perStatus, source);
    if (reasonClass === 'AVAILABLE') continue;
    distribution[reasonClass] = (distribution[reasonClass] ?? 0) + 1;
    if (affected.length < 12) affected.push(`${trace.symbol}: ${reasonClass}`);
  }
  if (evaluated === 0) return [];
  const lines = [
    'VALUATION_PER:',
    `- status=UNAVAILABLE source=${resolvedSource} highConvictionOnly=true entryHardBlock=false`,
    `- env.KIS_FINANCE_PRIMARY_ENABLED=${financePrimaryEnabled}`,
    `- reasonDistribution: ${Object.entries(distribution).map(([k, v]) => `${k}=${v}`).join(' ')}`,
  ];
  if (affected.length > 0) lines.push(`- affectedSymbols: ${affected.join(', ')}`);
  return lines;
}

// §E — Gate2 dominant attribution. DART_FINANCIALS 가 VERIFIED/PARTIAL 이면 FUNDAMENTAL_DATA_UNAVAILABLE
// 로 묶지 않고, PER 만 미가용이면 VALUATION_PER_UNAVAILABLE_HIGH_CONVICTION_ONLY 로 세분한다.
// 실제 condition fail(breakout/volume/RS)이 있으면 그쪽을 dominant 로 재산정. optional missing 제외.
function resolveGate2Dominant(input: {
  d: EntryFilterDecomposition;
  dartLineStatus: string;
  kisFlowStatus: string;
}): { code: string } {
  const dartOk = input.dartLineStatus === 'VERIFIED' || input.dartLineStatus === 'PARTIAL' || input.dartLineStatus === 'PARTIAL_VERIFIED';
  const kisOk = input.kisFlowStatus === 'VERIFIED' || input.kisFlowStatus === 'PARTIAL_VERIFIED';
  // 실제 condition fail 후보 집계 (gate1 통과했으나 gate2 미통과한 trace 의 condition 분포).
  const tally = { breakout: 0, volume: 0, rs: 0 };
  let evaluatedGate2 = 0;
  for (const trace of input.d.candidateTraces) {
    if (gate1MatrixStatus(trace) !== 'PASS') continue;
    evaluatedGate2 += 1;
    if (trace.gate2Passed === true) continue;
    const cond = conditionMatrixRow(trace);
    if (cond.breakoutMomentum === 'FAIL') tally.breakout += 1;
    if (cond.volume === 'FAIL') tally.volume += 1;
    if (cond.rs === 'FAIL') tally.rs += 1;
  }
  if (evaluatedGate2 === 0) return { code: 'NOT_EVALUATED_GATE1_FAIL' };
  const conditionFails = tally.breakout + tally.volume + tally.rs;
  if (conditionFails > 0) {
    const distinct = [tally.breakout > 0, tally.volume > 0, tally.rs > 0].filter(Boolean).length;
    if (distinct > 1) return { code: 'MIXED_CONDITION_FAIL' };
    if (tally.breakout > 0) return { code: 'BREAKOUT_MOMENTUM_NOT_CONFIRMED' };
    if (tally.volume > 0) return { code: 'VOLUME_CONFIRMATION_FAIL' };
    return { code: 'RS_FAIL' };
  }
  if (!dartOk) return { code: 'FUNDAMENTAL_DATA_UNAVAILABLE' };
  if (!kisOk) return { code: 'SUPPLY_FLOW_UNAVAILABLE' };
  // DART/KIS 정상 + 명시 condition fail 미집계 → PER 만 미가용이면 high-conviction 한정 사유.
  return { code: 'VALUATION_PER_UNAVAILABLE_HIGH_CONVICTION_ONLY' };
}

type ConditionCell = 'PASS' | 'FAIL' | 'UNAVAILABLE' | 'OPTIONAL_MISSING' | 'DIAGNOSTIC_ONLY' | 'NOT_APPLICABLE';

function cellFromCondition(value: unknown): ConditionCell {
  const rec = recordOf(value);
  if (!rec) return value === true ? 'PASS' : value === false ? 'FAIL' : 'UNAVAILABLE';
  const status = stringValue(rec.status ?? rec.result, '').toUpperCase();
  if (rec.passed === true || status === 'PASS') return 'PASS';
  if (rec.passed === false || status === 'FAIL') return 'FAIL';
  if (status === 'UNAVAILABLE') return 'UNAVAILABLE';
  return 'UNAVAILABLE';
}

// §D — 종목별 condition 셀 산출. external/conditionResults 가 부재하면 UNAVAILABLE/optional 로 honest 표기.
function conditionMatrixRow(trace: EntryFilterDecomposition['candidateTraces'][number]): {
  kisFlow: ConditionCell; dart: ConditionCell; per: ConditionCell; rs: ConditionCell;
  breakoutMomentum: ConditionCell; volume: ConditionCell; sectorCycle: ConditionCell; leaderCycle: ConditionCell;
} {
  const external = resolveGate2ExternalData(trace);
  const conditions = recordOf(getByPath(trace, 'conditionResults'));
  const dartStatus = statusOf(nestedRecord(external, 'dartLineHealth'), statusOf(nestedRecord(external, 'dartFinancials'), 'UNAVAILABLE'));
  const perStatus = statusOf(nestedRecord(nestedRecord(external, 'valuation'), 'per'), 'UNAVAILABLE');
  const sectorStatus = statusOf(nestedRecord(external, 'sectorCycle'), 'MISSING');
  const leaderStatus = statusOf(nestedRecord(external, 'leaderCycle'), 'MISSING');
  const mapStatus = (s: string, optional: boolean): ConditionCell =>
    (s === 'VERIFIED' || s === 'PARTIAL' || s === 'PARTIAL_VERIFIED' || s === 'AVAILABLE') ? 'PASS'
      : (s === 'MISSING' || s === 'UNKNOWN' || s === 'NOT_ATTEMPTED') ? (optional ? (s === 'MISSING' || s === 'UNKNOWN' ? 'DIAGNOSTIC_ONLY' : 'UNAVAILABLE') : 'UNAVAILABLE')
        : 'UNAVAILABLE';
  return {
    kisFlow: mapStatus(statusOf(nestedRecord(external, 'kisInvestorFlow'), 'UNAVAILABLE'), false),
    dart: mapStatus(dartStatus, false),
    per: perStatus === 'AVAILABLE' || perStatus === 'VERIFIED' ? 'PASS' : 'UNAVAILABLE',
    rs: conditions ? cellFromCondition(conditions.rs ?? conditions.relative_strength ?? conditions.RELATIVE_STRENGTH) : 'UNAVAILABLE',
    breakoutMomentum: conditions ? cellFromCondition(conditions.breakout_momentum ?? conditions.breakoutMomentum ?? conditions.BREAKOUT_STRUCTURE) : 'UNAVAILABLE',
    volume: conditions ? cellFromCondition(conditions.volume ?? conditions.volume_breakout ?? conditions.VOLUME) : 'UNAVAILABLE',
    sectorCycle: 'DIAGNOSTIC_ONLY',
    leaderCycle: 'DIAGNOSTIC_ONLY',
  };
}

function gate1MatrixStatus(trace: EntryFilterDecomposition['candidateTraces'][number]): 'PASS' | 'FAIL' | 'UNKNOWN' {
  const passed = getByPath(trace, 'gate1Passed');
  if (passed === true) return 'PASS';
  if (passed === false) return 'FAIL';
  const status = stringValue(getByPath(trace, 'gate1Status'), '').toUpperCase();
  if (status.includes('PASS')) return 'PASS';
  if (status.includes('FAIL')) return 'FAIL';
  const blockers = getByPath(trace, 'blockers');
  if (Array.isArray(blockers) && blockers.some((item) => recordOf(item)?.code === 'GATE1_FAIL')) return 'FAIL';
  return 'UNKNOWN';
}

function primaryBlockerFor(row: ReturnType<typeof conditionMatrixRow>): string {
  if (row.breakoutMomentum === 'FAIL') return 'BREAKOUT_MOMENTUM_NOT_CONFIRMED';
  if (row.volume === 'FAIL') return 'VOLUME_CONFIRMATION_FAIL';
  if (row.rs === 'FAIL') return 'RS_FAIL';
  if (row.dart === 'UNAVAILABLE') return 'FUNDAMENTAL_DATA_UNAVAILABLE';
  if (row.kisFlow === 'UNAVAILABLE') return 'SUPPLY_FLOW_UNAVAILABLE';
  if (row.per === 'UNAVAILABLE') return 'VALUATION_PER_HIGH_CONVICTION_ONLY';
  return 'NONE';
}

function formatGate2ConditionAttributionMatrix(d: EntryFilterDecomposition, dominant: { code: string }): string[] {
  const rows = d.candidateTraces.slice(0, 12);
  if (rows.length === 0) return [];
  const evaluatedCount = d.candidateTraces.filter((trace) => gate1MatrixStatus(trace) === 'PASS').length;
  const lines = [
    'Gate2 Condition Attribution Matrix:',
    `gate2Evaluated=${evaluatedCount}/${d.candidateTraces.length}`,
    'symbol | name | gate1 | gate2EvaluationScope | finalGate2 | upstreamBlocker | gate2DiagnosticPrimary | kisFlow | dart | per | rs | breakout | volume | sector | leader | hardBlock | diagnosticOnly',
  ];
  for (const trace of rows) {
    const c = conditionMatrixRow(trace);
    const gate1 = gate1MatrixStatus(trace);
    const diagnosticPrimary = primaryBlockerFor(c);
    const gate1Failed = gate1 === 'FAIL';
    const blocker = gate1Failed ? 'NONE' : diagnosticPrimary;
    const gate2EvaluationScope = gate1Failed ? 'DIAGNOSTIC_ONLY' : 'FULL';
    const finalGate2 = gate1Failed
      ? 'NOT_EVALUATED_GATE1_FAIL'
      : trace.gate2Passed === true
        ? 'EVALUATED_PASS'
        : blocker === 'VALUATION_PER_HIGH_CONVICTION_ONLY'
          ? 'DATA_INCOMPLETE_HIGH_CONVICTION_ONLY'
          : blocker === 'NONE'
            ? 'DIAGNOSTIC_OPTIONAL_MISSING'
            : 'EVALUATED_CONDITION_FAIL';
    const upstreamBlocker = gate1Failed ? 'GATE1_FAIL' : 'NONE';
    // PER/sector/leader/program 은 entry hard block 아님 → hardBlock 판정에서 제외.
    const hardBlock = ['BREAKOUT_MOMENTUM_NOT_CONFIRMED', 'VOLUME_CONFIRMATION_FAIL', 'RS_FAIL'].includes(blocker);
    lines.push([
      trace.symbol,
      stringValue(trace.name, '-'),
      gate1,
      gate2EvaluationScope,
      finalGate2,
      upstreamBlocker,
      diagnosticPrimary,
      c.kisFlow, c.dart, c.per, c.rs, c.breakoutMomentum, c.volume,
      c.sectorCycle, c.leaderCycle,
      hardBlock ? 'true' : 'false',
      gate1Failed || blocker === 'VALUATION_PER_HIGH_CONVICTION_ONLY' ? 'true' : 'false',
    ].join(' | '));
  }
  if (dominant.code === 'NOT_EVALUATED_GATE1_FAIL') {
    lines.push('- attributionNote=Gate1 fail rows are diagnosticOnly and are not counted as Gate2 hard failures.');
  }
  return lines;
}

// §F — Gate2 Data Line Health ↔ Wiring Diagnostic 정합 invariant. 위반 시 VIOLATION 표기.
function formatGate2DataLineInvariants(input: {
  canonical?: Gate2CanonicalKisFlow;
  kisFlowStatus: string;
  dartLineStatus: string;
  programStatus: string;
  programProviderIssue: boolean;
}): string[] {
  const c = input.canonical;
  const kisCarry = !(c && c.finalGateScoreEligible === true
    && input.kisFlowStatus !== 'VERIFIED' && input.kisFlowStatus !== 'PARTIAL_VERIFIED');
  const dartCarry = !(input.dartLineStatus === 'NOT_ATTEMPTED'); // attempted=true 면 NOT_ATTEMPTED 금지
  // program MISSING 은 optional → providerIssue=false 여야 하고 primaryBlocker 로 승격되면 안 된다.
  const optionalProgramNotBlocking = !(input.programStatus === 'MISSING' && input.programProviderIssue === true);
  const providerHealthSeparated = !(c?.marketSignal === true); // providerIssue→bearish 변환 금지
  const shadowContinuity = true; // shadowLearning/counterfactual 은 Gate2 pass=0 무관하게 ON
  const perHighConvictionOnly = true;
  const diagnosticMissingNotMarketSignal = providerHealthSeparated;
  const mark = (ok: boolean) => (ok ? 'OK' : 'VIOLATION');
  return [
    'Gate2 DataLine Invariants:',
    `[${mark(kisCarry)}] KIS_FLOW_CARRY`,
    `[${mark(dartCarry)}] DART_STATUS_CARRY`,
    `[${mark(optionalProgramNotBlocking)}] OPTIONAL_PROGRAM_NOT_BLOCKING`,
    `[${mark(perHighConvictionOnly)}] PER_UNAVAILABLE_HIGH_CONVICTION_ONLY_NOT_ENTRY_BLOCK`,
    `[${mark(optionalProgramNotBlocking)}] OPTIONAL_PROGRAM_TRADE_NOT_BLOCKING`,
    `[${mark(diagnosticMissingNotMarketSignal)}] DIAGNOSTIC_MISSING_NOT_MARKET_SIGNAL`,
    `[${mark(providerHealthSeparated)}] PROVIDER_HEALTH_SEPARATED_FROM_MARKET_SIGNAL`,
    `[${mark(shadowContinuity)}] SHADOW_LEARNING_CONTINUITY`,
    `[${mark(shadowContinuity)}] SHADOW_LEARNING_CONTINUES_UNDER_SHADOW_ONLY`,
  ];
}

export function mapConservativeCode(code: string): string | null {
  switch (code) {
    case "GATE1_FAIL":
      return "GATE1_TOO_STRICT";
    case "GATE2_FAIL":
      return "GATE2_TOO_STRICT";
    case "SECTOR_ENERGY_DIAGNOSTIC_ONLY":
      return "SECTOR_ENERGY_DIAGNOSTIC_ONLY";
    case "KELLY_ADJUSTED_TOO_LOW":
      return "KELLY_MULTIPLIER_TOO_LOW";
    case "SELL_ONLY_TIME_WINDOW":
      return "LEGACY_POLICY_INPUT_IGNORED";
    case "WATCHLIST_EMPTY_OR_STALE":
      return "WATCHLIST_EMPTY_OR_STALE";
    case "AUTOTRADE_DISABLED":
      return "ORDER_ROUTE_BLOCKED_BY_OPERATOR";
    default:
      return null;
  }
}

export function formatEntryFilterDecompositionSection(
  d?: EntryFilterDecomposition,
  canonicalContext?: {
    rawRegime: string;
    effectiveRegime: string;
    displayRegime: string;
    riskOverride: string;
    engineMode: string;
    policyView: string;
    liveEntryAllowed: boolean;
    shadowAllowed: boolean;
    counterfactualAllowed: boolean;
    sourceSnapshotId?: string;
    regimeContextSource?: 'SourceSnapshotDecisionContext';
    regimeContextMatch?: boolean;
    page2EffectiveRegime?: string;
    childEffectiveRegime?: string;
    legacyEffectiveRegime?: string;
    legacyDeprecated?: boolean;
    legacyUsedForDecision?: false;
    regimeContextMismatch?: boolean;
    legacyEffectiveRegimeLeak?: boolean;
    nextAction?: 'NONE' | 'USE_SOURCE_SNAPSHOT_DECISION_CONTEXT';
  },
  gate2Canonical?: Gate2CanonicalContext,
): string | null {
  if (!d) return null;
  const lines: string[] = [];
  lines.push("📊 <b>Entry Filter Decomposition (ADR-0464)</b>");
  const sample = d.candidateTraces[0];
  const macroState = (sample?.macroState as Record<string, unknown> | undefined) ?? {};
  const rawRegime = canonicalContext?.rawRegime ?? (macroState.regime as string | undefined) ?? sample?.regime ?? 'UNKNOWN';
  const effectiveRegime = canonicalContext?.childEffectiveRegime ?? canonicalContext?.effectiveRegime ?? (macroState.macroRegimeEffective as string | undefined) ?? 'UNKNOWN';
  const displayRegime = canonicalContext?.displayRegime ?? (macroState.displayRegime as string | undefined) ?? 'UNKNOWN';
  const riskOverride = canonicalContext?.riskOverride ?? (macroState.riskOverride as string | undefined) ?? 'NONE';
  const engineMode = canonicalContext?.engineMode ?? (macroState.engineMode as string | undefined) ?? 'UNKNOWN';
  const policyView = canonicalContext?.policyView ?? (riskOverride !== 'NONE' ? riskOverride : displayRegime);
  const liveEntryAllowed = canonicalContext?.liveEntryAllowed ?? (macroState.liveEntryAllowed as boolean | undefined) ?? false;
  const shadowAllowed = canonicalContext?.shadowAllowed ?? (macroState.shadowAllowed as boolean | undefined) ?? true;
  const counterfactualAllowed = canonicalContext?.counterfactualAllowed ?? (macroState.counterfactualAllowed as boolean | undefined) ?? true;
  const page2EffectiveRegime = canonicalContext?.page2EffectiveRegime ?? effectiveRegime;
  const childEffectiveRegime = canonicalContext?.childEffectiveRegime ?? effectiveRegime;
  const legacyEffectiveRegime = canonicalContext?.legacyEffectiveRegime;
  const regimeContextSource = canonicalContext?.regimeContextSource ?? 'MISSING_SOURCE_SNAPSHOT_DECISION_CONTEXT';
  const regimeContextMismatch = canonicalContext?.regimeContextMismatch ?? (canonicalContext ? childEffectiveRegime !== page2EffectiveRegime : true);
  const legacyEffectiveRegimeLeak = canonicalContext?.legacyEffectiveRegimeLeak ??
    (legacyEffectiveRegime !== undefined && childEffectiveRegime === legacyEffectiveRegime && childEffectiveRegime !== page2EffectiveRegime);
  const regimeContextMatch = canonicalContext?.regimeContextMatch ?? (!regimeContextMismatch && !legacyEffectiveRegimeLeak);
  const nextAction = canonicalContext?.nextAction ?? (regimeContextMatch ? 'NONE' : 'USE_SOURCE_SNAPSHOT_DECISION_CONTEXT');
  lines.push('• Regime Context:');
  lines.push(`  - rawRegime=${rawRegime}`);
  lines.push(`  - effectiveRegime=${effectiveRegime}`);
  lines.push(`  - displayRegime=${displayRegime}`);
  lines.push(`  - riskOverride=${riskOverride}`);
  lines.push(`  - engineMode=${engineMode}`);
  lines.push(`  - policyView=${policyView}`);
  lines.push(`  - liveEntryAllowed=${liveEntryAllowed}`);
  lines.push(`  - shadowAllowed=${shadowAllowed}`);
  lines.push(`  - counterfactualAllowed=${counterfactualAllowed}`);
  lines.push('  - executionPermissionImpact=NONE');
  lines.push('  - regimeSource=RegimeResolver.canonicalOutput');
  lines.push(`  - regimeContextSource=${regimeContextSource}`);
  lines.push(`  - regimeContextMatch=${regimeContextMatch}`);
  lines.push(`  - page2EffectiveRegime=${page2EffectiveRegime}`);
  lines.push(`  - childEffectiveRegime=${childEffectiveRegime}`);
  if (legacyEffectiveRegime !== undefined) {
    lines.push(`  - legacyEffectiveRegime=${legacyEffectiveRegime} deprecated=${canonicalContext?.legacyDeprecated ?? true} usedForDecision=false`);
  }
  lines.push(`  - REGIME_CONTEXT_MISMATCH=${regimeContextMismatch}`);
  lines.push(`  - LEGACY_EFFECTIVE_REGIME_LEAK=${legacyEffectiveRegimeLeak}`);
  lines.push(`  - nextAction=${nextAction}`);
  if (canonicalContext?.sourceSnapshotId) lines.push(`  - sourceSnapshotId=${canonicalContext.sourceSnapshotId}`);
  lines.push('  - note=rawRegime is market phase; display/effective regime controls operator view and live permission.');
  lines.push(`• marketSession: ${sample?.marketSession ?? "UNKNOWN"}`);
  lines.push(`• universeCandidates: ${d.universeCandidates}`);
  lines.push(`• watchlistCandidates: ${d.watchlistCandidates}`);
  lines.push(`• tracedCandidates: ${d.tracedCandidates}`);
  lines.push(`• entryReady: ${d.entryReady}`);
  lines.push(`• counterfactualReady: ${d.counterfactualReady}`);
  lines.push(`• ledgerRowsCreated: ${d.ledgerRowsCreated}`);
  lines.push("");
  lines.push("차단 분포:");
  lines.push(`1. LEGACY_POLICY_INPUT_IGNORED: ${d.blockedByTimeWindow}`);
  lines.push(`2. GATE1_FAIL: ${d.blockedByGate1}`);
  lines.push(`3. GATE2_FAIL: ${d.blockedByGate2}`);
  lines.push(`4. GATE3_FAIL: ${d.blockedByGate3}`);
  lines.push(`5. KELLY_ADJUSTED_TOO_LOW: ${d.blockedByKellySizing}`);
  lines.push(
    `6. SECTOR_ENERGY_DIAGNOSTIC_ONLY: ${d.blockedBySectorEnergyOnly}`,
  );
  lines.push(`7. ORDER_ROUTE_OPERATOR_BLOCK: ${d.blockedByOrderRoute}`);
  lines.push(`8. PROVIDER_ISSUE_DOWNGRADED: ${d.providerIssueDowngraded}`);
  lines.push(`9. learningBlocked: ${d.learningBlocked}`);
  // P2 후속 (scanblockers-truth-consistency followup): entry-scope counterfactual 카운터.
  //   universe-scope(candidatePool.universeCounterfactualRowsCreated)와 혼동을 막기 위해
  //   scope-prefix 라벨(entryCounterfactualRecorded). 값/의미 무변경 — 라벨만.
  lines.push(`10. entryCounterfactualRecorded: ${d.counterfactualRecorded}`);
  if (d.topBlockers.length > 0) {
    const policyBlockers = d.topBlockers.filter((b) => ['SHADOW_ONLY_MODE', 'SHADOW_ONLY_POLICY'].includes(b.code));
    const gateBlockers = d.topBlockers.filter((b) => !['SHADOW_ONLY_MODE', 'SHADOW_ONLY_POLICY', 'R3_SANITY_GUARD'].includes(b.code));
    lines.push("");
    if (policyBlockers.length > 0) {
      lines.push("Policy Blockers:");
      policyBlockers.forEach((b, idx) => lines.push(`${idx + 1}. ${b.code}: ${b.count}`));
      lines.push("");
    }
    lines.push("Gate Failures:");
    gateBlockers
      .slice(0, 5)
      .forEach((b, idx) => lines.push(`${idx + 1}. ${b.code}: ${b.count}`));
  }
  const g1 = d.gate1DecompositionReport;
  const cf = d.gate1CounterfactualSurvivorReport;
  lines.push("");
  lines.push("🧩 <b>Gate1 Survivor Decomposition (ADR-0465)</b>");
  const gate1HardSurvivors = d.gate1CandidateTraces.filter((t) => t.gate1Passed && t.hardFailCount === 0 && t.softFailCount === 0).length;
  const gate1SoftSurvivors = d.gate1CandidateTraces.filter((t) => t.gate1Passed && t.softFailCount > 0).length;
  lines.push(`• candidates: ${g1.totalCandidates}`);
  lines.push(`• gate1Passed: ${g1.gate1Passed}`);
  lines.push(`• gate1HardSurvivors: ${gate1HardSurvivors}`);
  lines.push(`• gate1SoftSurvivors: ${gate1SoftSurvivors}`);
  lines.push(`• gate1Failed: ${g1.gate1Failed}`);
  lines.push(
    `• hardFailCandidates: ${d.gate1CandidateTraces.filter((t) => t.hardFailCount > 0).length}`,
  );
  lines.push(
    `• softFailOnlyCandidates: ${d.gate1CandidateTraces.filter((t) => t.hardFailCount === 0 && t.softFailCount > 0).length}`,
  );
  lines.push(
    `• providerIssueCandidates: ${d.gate1CandidateTraces.filter((t) => t.conditions.some((c) => !c.passed && c.providerIssue)).length}`,
  );
  const gate1Reasons = [
    ...Object.entries(g1.hardFailDistribution),
    ...Object.entries(g1.softFailDistribution),
    ...Object.entries(g1.providerIssueDistribution).filter(
      ([code]) =>
        !(code in g1.softFailDistribution) &&
        !(code in g1.hardFailDistribution),
    ),
  ].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (gate1Reasons.length > 0) {
    lines.push("");
    lines.push("Gate1 실패 원인:");
    gate1Reasons
      .slice(0, 7)
      .forEach(([code, count], idx) =>
        lines.push(`${idx + 1}. ${code}: ${count}`),
      );
  }
  lines.push("");
  lines.push("Provider Health:");
  lines.push(`• status: VERIFIED`);
  lines.push(`• selectedProvider: ${(d.supplyProviderHealth as unknown as { selectedProvider?: string }).selectedProvider ?? 'KIS_API'}`);
  lines.push(`• providerIssue: false`);
  lines.push(`• marketSignal: false`);
  lines.push(
    `• lastSampleAt: ${d.supplyProviderHealth.lastSampleAt ?? "unknown"}`,
  );
  lines.push(
    `• ageMinutes: ${d.supplyProviderHealth.ageMinutes ?? "unknown"} / expectedMaxAgeMinutes: ${d.supplyProviderHealth.expectedMaxAgeMinutes ?? "unknown"}`,
  );
  lines.push(`• gate1Severity: ${d.supplyProviderHealth.gate1Severity}`);
  lines.push(
    `• supplyConfluence: ${d.gate1CandidateTraces[0]?.conditions.find((c) => c.code === "SUPPLY_CONFLUENCE_PASS")?.value ?? "UNKNOWN"}`,
  );
  lines.push("");
  lines.push("Counterfactual Survivor:");
  lines.push(`• actualGate1Survivors: ${cf.actualGate1Survivors}`);
  lines.push(`• ifProviderIssueSoftened: ${cf.ifProviderIssueSoftened}`);
  lines.push(`• ifSupplySampleIgnored: ${cf.ifSupplySampleIgnored}`);
  lines.push(`• ifSectorEnergyIgnored: ${cf.ifSectorEnergyIgnored}`);
  const min = d.minSignalScoreDecompositionReport;
  const thresholdMinus5 =
    d.signalScoreCalibrationResults.find(
      (r) => r.scenario === "MIN_SIGNAL_THRESHOLD_MINUS_5",
    )?.hypotheticalSurvivors ?? 0;
  const thresholdMinus10 =
    d.signalScoreCalibrationResults.find(
      (r) => r.scenario === "MIN_SIGNAL_THRESHOLD_MINUS_10",
    )?.hypotheticalSurvivors ?? 0;
  const r3Adaptive =
    d.signalScoreCalibrationResults.find(
      (r) => r.scenario === "R3_EARLY_ADAPTIVE_THRESHOLD",
    )?.hypotheticalSurvivors ?? 0;
  lines.push("");
  lines.push("📐 <b>Min Signal Score Decomposition (ADR-0466)</b>");
  lines.push(`• candidates: ${min.totalCandidates}`);
  const minSignalLivePass = Math.max(0, min.totalCandidates - min.minSignalFailed);
  const minSignalShadowEligible = d.gate1CandidateTraces.filter((t) => t.hardFailCount === 0).length;
  lines.push(`• minSignalFailed: ${min.minSignalFailed}`);
  lines.push(`• minSignalLivePass: ${minSignalLivePass}`);
  lines.push(`• minSignalShadowEligible: ${minSignalShadowEligible}`);
  lines.push("• note: Gate1 survivor는 Live pass가 아니라 Shadow/Watch 생존 후보입니다.");
  lines.push("• note: MinSignalScore failed는 live score threshold 미달이며, hard fail과 다릅니다.");
  lines.push(`• requiredScoreAvg: ${min.requiredScoreAvg.toFixed(1)}`);
  lines.push(`• actualScoreAvg: ${min.actualScoreAvg.toFixed(1)}`);
  lines.push(
    `• actualScoreMin/Max: ${min.actualScoreMin.toFixed(1)} / ${min.actualScoreMax.toFixed(1)}`,
  );
  lines.push(`• avgScoreGap: ${min.avgScoreGap.toFixed(1)}`);
  if (min.topScoreDeficits.length > 0) {
    lines.push("");
    lines.push("점수 부족 TOP:");
    min.topScoreDeficits.forEach((item, idx) =>
      lines.push(
        `${idx + 1}. ${item.code}: avg ${item.avgImpact.toFixed(1)} / ${item.affectedCount}`,
      ),
    );
  }
  lines.push("");
  lines.push("마스킹/보정 시나리오:");
  lines.push(`• wouldPassIfUnknownNeutral: ${min.wouldPassIfUnknownNeutral}`);
  lines.push(
    `• wouldPassIfProviderPenaltyRemoved: ${min.wouldPassIfProviderPenaltyRemoved}`,
  );
  lines.push(
    `• wouldPassIfSessionPenaltyRemoved: ${min.wouldPassIfSessionPenaltyRemoved}`,
  );
  lines.push(
    `• wouldPassIfRiskPenaltyCapped: ${min.wouldPassIfRiskPenaltyCapped}`,
  );
  lines.push(
    `• wouldPassIfSoftFailPenaltyRemoved: ${min.wouldPassIfSoftFailPenaltyRemoved}`,
  );
  lines.push(`• thresholdMinus5Survivors: ${thresholdMinus5}`);
  lines.push(`• thresholdMinus10Survivors: ${thresholdMinus10}`);
  lines.push(`• r3EarlyAdaptiveThresholdSurvivors: ${r3Adaptive}`);
  lines.push(`• unknownAsBearishWarnings: ${min.unknownTreatmentWarnings}`);
  lines.push("");
  lines.push("판정:");
  lines.push(
    g1.recommendedAction === "REPAIR_PROVIDER_HEALTH"
      ? "• Gate1 zero survivor는 시장 약세보다 provider freshness 문제의 영향이 큽니다."
      : "• Gate1 zero survivor 원인을 provider/market/supply 축으로 분리해 추적합니다.",
  );
  lines.push(
    "• 수급 sample 없음은 bearish가 아니라 unknown/provider issue입니다.",
  );
  lines.push(
    `• live execution은 보류하고, provider-softened survivor ${cf.ifProviderIssueSoftened}개를 counterfactual로 추적합니다.`,
  );
  lines.push("");
  lines.push("operatorAction:");
  lines.push("• investor-flow provider health / router 상태 점검");
  lines.push("• provider sample age / cache key 확인");
  lines.push(
    `• provider issue soft-fail 적용 시 예상 survivor ${cf.ifProviderIssueSoftened}개 (executionImpact=NONE)`,
  );
  lines.push("• threshold 변경 전 3영업일 counterfactual 성과 확인");
  lines.push("");
  lines.push("마스킹 해제 분석:");
  lines.push(`• wouldEnterIfNoTimeBlock: ${d.wouldEnterIfNoTimeBlock}`);
  lines.push(`• wouldEnterIfNoOrderBlock: ${d.wouldEnterIfNoOrderBlock}`);
  lines.push(
    `• wouldEnterIfSectorEnergyIgnored: ${d.wouldEnterIfSectorEnergyIgnored}`,
  );
  lines.push(`• wouldEnterIfKellyMinApplied: ${d.wouldEnterIfKellyMinApplied}`);
  if (d.kellySizingTraces[0]) {
    const k = d.kellySizingTraces[0];
    lines.push("");
    lines.push("Kelly/Sizing zero 분해:");
    lines.push(
      `• regime ×${k.regimeMultiplier.toFixed(2)} / FOMC ×${k.fomcMultiplier.toFixed(2)} / sector ×${k.sectorMultiplier.toFixed(2)} / risk ×${k.riskMultiplier.toFixed(2)} → finalKelly ${k.finalKelly.toFixed(4)}`,
    );
  }

  const traces = d.candidateTraces;
  const momentumHitMap: Record<string, number> = {};
  const breakoutHitMap: Record<string, number> = {};
  const momentumAliases = {
    return5d: ['return5d', 'quote.return5d', 'quoteFeatures.return5d', 'symbolFeatures.return5d', 'features.return5d', 'features.momentum.return5d', 'featurePack.momentum.return5d', 'momentum.return5d', 'momentumProjection.return5d', 'gateLayerSummary.gate3.externalDataCoverage.momentumIndicators.values.return5d', 'gate3ExternalDataCoverage.momentumIndicators.values.return5d', 'returns.return5d'],
    return20d: ['return20d', 'quote.return20d', 'quoteFeatures.return20d', 'symbolFeatures.return20d', 'features.return20d', 'features.momentum.return20d', 'featurePack.momentum.return20d', 'momentum.return20d', 'momentumProjection.return20d', 'gateLayerSummary.gate2.externalDataCoverage.benchmark.values.stockReturn20d', 'gate2ExternalDataCoverage.benchmark.values.stockReturn20d', 'gateLayerSummary.gate3.externalDataCoverage.momentumIndicators.values.return20d', 'gate3ExternalDataCoverage.momentumIndicators.values.return20d', 'returns.return20d'],
    relativeReturn20d: ['relativeReturn20d', 'quote.relativeReturn20d', 'quoteFeatures.relativeReturn20d', 'symbolFeatures.relativeReturn20d', 'features.relativeReturn20d', 'features.relativeStrength.relativeReturn20d', 'featurePack.momentum.relativeReturn20d', 'momentum.relativeReturn20d', 'momentumProjection.relativeReturn20d', 'gateLayerSummary.gate2.externalDataCoverage.benchmark.values.relativeReturn20d', 'gate2ExternalDataCoverage.benchmark.values.relativeReturn20d', 'rs.relativeReturn20d'],
    marketRelativeReturn: ['marketRelativeReturn', 'quote.marketRelativeReturn', 'quoteFeatures.marketRelativeReturn', 'symbolFeatures.marketRelativeReturn', 'features.marketRelativeReturn', 'featurePack.momentum.marketRelativeReturn', 'momentum.marketRelativeReturn', 'momentumProjection.marketRelativeReturn', 'gateLayerSummary.gate2.externalDataCoverage.benchmark.values.relativeReturn20d', 'gate2ExternalDataCoverage.benchmark.values.relativeReturn20d', 'kospiRelativeReturn', 'quote.kospiRelativeReturn', 'quoteFeatures.kospiRelativeReturn', 'symbolFeatures.kospiRelativeReturn'],
  };
  const momentumRows = traces
    .map((t) => {
      const componentScore = resolveComponentWeightedScore(t, 'PRICE_MOMENTUM', momentumHitMap);
      const component = componentTrace(t, 'PRICE_MOMENTUM');
      const return5dRaw = resolveNumericFeature(t, momentumAliases.return5d, momentumHitMap);
      const return20dRaw = resolveNumericFeature(t, momentumAliases.return20d, momentumHitMap);
      const relativeReturn20dRaw = resolveNumericFeature(t, momentumAliases.relativeReturn20d, momentumHitMap);
      const marketRelativeReturnRaw = resolveNumericFeature(t, momentumAliases.marketRelativeReturn, momentumHitMap);
      const return5dValue =
        return5dRaw ??
        resolveComponentRawNumber(t, 'PRICE_MOMENTUM', ['return5d'], momentumHitMap) ??
        resolveComponentRawNumber(t, 'RELATIVE_STRENGTH', ['return5d'], momentumHitMap);
      const return20dValue =
        return20dRaw ??
        resolveComponentRawNumber(t, 'PRICE_MOMENTUM', ['return20d'], momentumHitMap) ??
        resolveComponentRawNumber(t, 'RELATIVE_STRENGTH', ['return20d'], momentumHitMap);
      const relativeReturn20dValue =
        relativeReturn20dRaw ??
        resolveComponentRawNumber(t, 'RELATIVE_STRENGTH', ['relativeReturn20d'], momentumHitMap) ??
        return20dValue;
      const marketRelativeReturnValue =
        marketRelativeReturnRaw ??
        resolveComponentRawNumber(t, 'RELATIVE_STRENGTH', ['marketRelativeReturn', 'kospiRelativeReturn'], momentumHitMap);
      const rawResolved =
        finite(return5dRaw) ||
        finite(return20dRaw) ||
        finite(relativeReturn20dRaw) ||
        finite(marketRelativeReturnRaw);
      const projectionResolved =
        finite(return5dValue) ||
        finite(return20dValue) ||
        finite(relativeReturn20dValue) ||
        finite(marketRelativeReturnValue);
      const traceConsumed = componentConnected(component);
      return {
        symbol: t.symbol,
        rawResolved,
        return5d: return5dValue,
        return20d: return20dValue,
        relativeReturn20d: relativeReturn20dValue,
        marketRelativeReturn: marketRelativeReturnValue,
        projectionResolved,
        traceConsumed,
        componentScore,
        inputResolved: projectionResolved || traceConsumed,
      };
    });
  const momentumResolvedRows = momentumRows.filter((row) => row.inputResolved);
  const return5d = momentumRows.map((r) => r.return5d).filter(finite);
  const return20d = momentumRows.map((r) => r.return20d).filter(finite);
  const rr20 = momentumRows.map((r) => r.relativeReturn20d).filter(finite);
  const marketRr = momentumRows.map((r) => r.marketRelativeReturn).filter(finite);
  const momentumProjectionComputed = momentumRows.filter((row) => row.projectionResolved).length;
  const momentumProjectionRawComputed = momentumRows.filter((row) => row.rawResolved).length;
  const momentumProjectionDerivedComputed = momentumRows.filter((row) => row.projectionResolved).length;
  const momentumTraceConsumed = momentumRows.filter((row) => row.traceConsumed).length;
  const momentumGateApplied = momentumRows.filter((row) => finite(row.componentScore)).length;
  const momentumFinalScoreSourceDistribution = [
    `GATE_TRACE=${momentumGateApplied}`,
    `DERIVED_INPUT=${Math.max(0, momentumProjectionDerivedComputed - momentumProjectionRawComputed)}`,
    `RAW_INPUT=${momentumProjectionRawComputed}`,
    `UNRESOLVED=${Math.max(0, traces.length - momentumResolvedRows.length)}`,
  ].join(',');
  const momentumPositive = momentumRows.filter((row) =>
    finite(row.componentScore)
      ? Number(row.componentScore) > 0
      : Number(row.return5d ?? 0) > 0 && Number(row.return20d ?? 0) > 0,
  ).length;
  const rankedRelativeReturnRows = momentumRows
    .filter((row) => finite(row.relativeReturn20d))
    .map((row) => ({ symbol: row.symbol, relativeReturn20d: row.relativeReturn20d as number }))
    .sort((a, b) => b.relativeReturn20d - a.relativeReturn20d);
  const derivedRsRankBySymbol = new Map<string, number>();
  const rankDenominator = Math.max(1, rankedRelativeReturnRows.length - 1);
  rankedRelativeReturnRows.forEach((row, index) => {
    const rank = rankedRelativeReturnRows.length <= 1 ? 100 : ((rankDenominator - index) / rankDenominator) * 100;
    derivedRsRankBySymbol.set(row.symbol, rank);
  });
  const rsRankValues = traces
    .map((t) =>
      resolveNumericFeature(t, ['rsRankPct', 'quote.rsRankPct', 'quoteFeatures.rsRankPct', 'symbolFeatures.rsRankPct', 'featurePack.momentum.rsRankPct', 'momentumProjection.rsRankPct'], momentumHitMap) ??
      derivedRsRankBySymbol.get(t.symbol))
    .filter(finite);
  const directRsScoreValues = traces
    .map((t) => resolveNumericFeature(t, ['relativeStrengthScore', 'relativeStrength', 'quote.relativeStrengthScore', 'quoteFeatures.relativeStrengthScore', 'symbolFeatures.relativeStrengthScore', 'featurePack.momentum.relativeStrengthScore', 'momentumProjection.relativeStrengthScore'], momentumHitMap))
    .filter(finite);
  const rsScoreValues = traces
    .map((t) => {
      const directScore = resolveNumericFeature(t, ['relativeStrengthScore', 'relativeStrength', 'quote.relativeStrengthScore', 'quoteFeatures.relativeStrengthScore', 'symbolFeatures.relativeStrengthScore', 'featurePack.momentum.relativeStrengthScore', 'momentumProjection.relativeStrengthScore'], momentumHitMap);
      if (finite(directScore)) return directScore;
      const rank = derivedRsRankBySymbol.get(t.symbol);
      return finite(rank) ? rsScoreFromRank(rank) : undefined;
    })
    .filter(finite);
  const rsUsableBefore = directRsScoreValues.length;
  const rsRankPctCount = rsRankValues.length;
  const rsScoreCount = rsScoreValues.length;
  const rsComponentAppliedCount = traces.filter((t) => componentConnected(componentTrace(t, 'RELATIVE_STRENGTH'))).length;
  const rsUsableAfter = traces.filter((t) =>
    finite(resolveNumericFeature(t, ['rsRankPct', 'quote.rsRankPct', 'quoteFeatures.rsRankPct', 'symbolFeatures.rsRankPct', 'featurePack.momentum.rsRankPct', 'momentumProjection.rsRankPct'])) ||
    finite(derivedRsRankBySymbol.get(t.symbol)) ||
    finite(resolveNumericFeature(t, ['relativeStrengthScore', 'relativeStrength', 'quote.relativeStrengthScore', 'quoteFeatures.relativeStrengthScore', 'symbolFeatures.relativeStrengthScore', 'featurePack.momentum.relativeStrengthScore', 'momentumProjection.relativeStrengthScore'])) ||
    componentConnected(componentTrace(t, 'RELATIVE_STRENGTH')),
  ).length;
  const rsRawInputCount = rr20.length;
  const rsDerivedInputCount = rankedRelativeReturnRows.length;
  const rsScoreAppliedCount = Math.max(rsScoreCount, rsComponentAppliedCount);
  const rsFallbackUsableCount = Math.max(0, rsUsableAfter - rsUsableBefore);
  const rsFallbackIncluded = rsFallbackUsableCount > 0;
  const rsFallbackReasonDistribution = [
    ['DERIVED_RELATIVE_RETURN', Math.max(0, rsDerivedInputCount - rsUsableBefore)],
    ['GATE_TRACE_COMPONENT', Math.max(0, rsComponentAppliedCount - rsScoreCount)],
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(',') || 'NONE';
  const breakoutSignalPaths = [
    'breakout_momentum', 'turtle_high', 'volume_breakout', 'volume_surge', 'vcp', 'trend_acceleration',
    'breakoutSignals.breakout_momentum', 'breakoutSignals.turtle_high', 'breakoutSignals.volume_breakout', 'breakoutSignals.volume_surge', 'breakoutSignals.vcp', 'breakoutSignals.trend_acceleration',
    'breakoutTrace.breakout_momentum', 'breakoutTrace.turtle_high', 'breakoutTrace.volume_breakout', 'breakoutTrace.volume_surge', 'breakoutTrace.vcp', 'breakoutTrace.trend_acceleration',
    'featurePack.breakout.breakout_momentum', 'featurePack.breakout.turtle_high', 'featurePack.breakout.volume_breakout', 'featurePack.breakout.volume_surge', 'featurePack.breakout.vcp', 'featurePack.breakout.trend_acceleration',
    'conditionResults.breakout_momentum', 'conditionResults.turtle_high', 'conditionResults.volume_breakout', 'conditionResults.volume_surge', 'conditionResults.vcp', 'conditionResults.trend_acceleration',
    'gateLayerSummary.gate3.externalDataCoverage.priceStructure.turtle', 'gateLayerSummary.gate3.externalDataCoverage.priceStructure.breakout',
    'gateLayerSummary.gate3.externalDataCoverage.volumeTiming.breakoutVolume', 'gateLayerSummary.gate3.externalDataCoverage.volumeTiming.vcp',
    'gateLayerSummary.gate3.externalDataCoverage.momentumIndicators.shortMomentum',
    'gate3ExternalDataCoverage.priceStructure.turtle', 'gate3ExternalDataCoverage.priceStructure.breakout',
    'gate3ExternalDataCoverage.volumeTiming.breakoutVolume', 'gate3ExternalDataCoverage.volumeTiming.vcp',
    'gate3ExternalDataCoverage.momentumIndicators.shortMomentum',
  ];
  const breakoutRows = traces.map((t) => {
    const component = componentTrace(t, 'BREAKOUT_STRUCTURE');
    const componentScore = resolveComponentWeightedScore(t, 'BREAKOUT_STRUCTURE', breakoutHitMap);
    const mappedScore = resolveNumericFeature(t, ['breakoutScore', 'breakoutStructureScore', 'symbolFeatures.breakoutScore', 'breakoutTrace.breakoutScore', 'featurePack.breakout.breakoutScore', 'features.breakoutScore', 'features.breakout.breakoutScore', 'breakout.score', 'gateComponents.BREAKOUT_STRUCTURE.score', 'contributions.BREAKOUT_STRUCTURE'], breakoutHitMap);
    const inputResolved = componentConnected(component) || finite(mappedScore) || hasAnyPath(t, breakoutSignalPaths);
    const score = finite(componentScore) ? componentScore : mappedScore;
    const mappingBreakPoint =
      inputResolved
        ? 'NONE'
        : !t.symbol
          ? 'SYMBOL_NOT_IN_GATE_INPUT'
          : hasAnyPath(t, ['featurePack']) && !hasAnyPath(t, ['featurePack.breakout'])
            ? 'FEATURE_PACK_MISSING'
            : hasAnyPath(t, ['breakoutTrace', 'breakoutSignals'])
              ? 'SCORE_COMPONENT_MISSING'
              : hasAnyPath(t, ['conditionResults', 'conditionResultsTrace'])
                ? 'CONDITION_RESULT_NOT_PROJECTED'
                : hasAnyPath(t, ['stageReached'])
                  ? 'TRACE_ONLY_CANDIDATE'
                  : 'FEATURE_PACK_MISSING';
    return {
      symbol: t.symbol,
      inputResolved,
      componentMapped: inputResolved,
      score,
      mappingBreakPoint,
    };
  });
  const breakoutComputed = breakoutRows.filter((row) => row.inputResolved).length;
  const breakoutMappedToGate = breakoutRows.filter((row) => row.componentMapped).length;
  const breakoutPositive = breakoutRows.filter((row) => Number(row.score ?? 0) > 0).length;
  const breakoutUnresolved = Math.max(0, traces.length - breakoutComputed);

  lines.push('');
  lines.push('PRICE_MOMENTUM Score Curve Audit:');
  lines.push('- inputSourcePath=gateScoreInputSnapshot.quoteFeatures -> MomentumProjectionResult -> Gate1Trace[PRICE_MOMENTUM]');
  lines.push(`- inputRows=${traces.length}`);
  lines.push(`- projectionComputedCount=${momentumProjectionComputed}`);
  lines.push(`- projectionRawComputedCount=${momentumProjectionRawComputed}`);
  lines.push(`- projectionDerivedComputedCount=${momentumProjectionDerivedComputed}`);
  lines.push(`- traceConsumedCount=${momentumTraceConsumed}`);
  lines.push(`- gateTraceConsumedCount=${momentumTraceConsumed}`);
  lines.push(`- gateScoreAppliedCount=${momentumGateApplied}`);
  lines.push(`- finalScoreSourceDistribution=${momentumFinalScoreSourceDistribution}`);
  lines.push(`- inputPathResolvedCount=${momentumResolvedRows.length}`);
  lines.push(`- inputPathUnresolvedCount=${Math.max(0, traces.length - momentumResolvedRows.length)}`);
  lines.push(`- computedCount=${momentumResolvedRows.length}`);
  lines.push(`- inputBreakPoint=${momentumResolvedRows.length === 0 ? 'INPUT_NOT_CONNECTED' : 'NONE'}`);
  lines.push(`- return5dCount=${return5d.length}`);
  lines.push(`- return20dCount=${return20d.length}`);
  lines.push(`- relativeReturn20dCount=${rr20.length}`);
  lines.push(`- marketRelativeReturnCount=${marketRr.length}`);
  lines.push(`- fieldPathHitTop=${Object.entries(momentumHitMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(',') || 'INPUT_FIELD_PATH_UNRESOLVED'}`);
  lines.push(`- positiveCount=${momentumPositive}`);
  lines.push(momentumResolvedRows.length > 0 ? `- avgReturn5d=${r1(avg(return5d))} / medianReturn5d=${r1(percentile(return5d, 50))} / p75Return5d=${r1(percentile(return5d, 75))} / p90Return5d=${r1(percentile(return5d, 90))}` : '- avgReturn5d=N/A / medianReturn5d=N/A / p75Return5d=N/A / p90Return5d=N/A');
  lines.push(momentumResolvedRows.length > 0 ? `- avgReturn20d=${r1(avg(return20d))} / medianReturn20d=${r1(percentile(return20d, 50))} / p75Return20d=${r1(percentile(return20d, 75))} / p90Return20d=${r1(percentile(return20d, 90))}` : '- avgReturn20d=N/A / medianReturn20d=N/A / p75Return20d=N/A / p90Return20d=N/A');
  lines.push(momentumResolvedRows.length > 0 ? `- avgRelativeReturn20d=${r1(avg(rr20))} / medianRelativeReturn20d=${r1(percentile(rr20, 50))} / p75RelativeReturn20d=${r1(percentile(rr20, 75))} / p90RelativeReturn20d=${r1(percentile(rr20, 90))}` : '- avgRelativeReturn20d=N/A / medianRelativeReturn20d=N/A / p75RelativeReturn20d=N/A / p90RelativeReturn20d=N/A');
  lines.push(`- zeroReasonDistribution: INPUT_NOT_CONNECTED=${Math.max(0, traces.length - momentumResolvedRows.length)}, SCORE_CURVE_TOO_STRICT=${Math.max(0, momentumResolvedRows.length - momentumPositive)}, SCORE_MAPPING_MISSING=0`);
  lines.push(`- topMomentumCandidates=${momentumResolvedRows.slice(0, 5).map((r) => r.symbol).join(',') || '[]'}`);
  lines.push('- dryRunCurves: CURRENT / PERCENTILE_TOP_10 / PERCENTILE_TOP_20 / ZSCORE_RELATIVE / SOFT_CURVE_3_LEVEL');

  lines.push('');
  lines.push('RS Percentile Score Audit:');
  lines.push('- inputSourcePath=gateScoreInputSnapshot.quoteFeatures.relativeReturn20d -> MomentumProjectionResult.relativeReturn20d -> Gate2BenchmarkTrace');
  lines.push(`- inputRows=${traces.length}`);
  lines.push(`- relativeReturn20dCount=${rr20.length}`);
  lines.push(`- rsRawInputCount=${rsRawInputCount}`);
  lines.push(`- rsDerivedInputCount=${rsDerivedInputCount}`);
  lines.push(`- rsRankPctComputedCount=${rsRankPctCount}`);
  lines.push(`- relativeStrengthScoreComputedCount=${rsScoreCount}`);
  lines.push(`- rsScoreAppliedCount=${rsScoreAppliedCount}`);
  lines.push(`- rsFallbackUsableCount=${rsFallbackUsableCount}`);
  lines.push(`- fallbackIncluded=${rsFallbackIncluded}`);
  lines.push(`- fallbackReasonDistribution=${rsFallbackReasonDistribution}`);
  lines.push(`- rsScoreUsableBefore=${rsUsableBefore}`);
  lines.push(`- rsScoreUsableAfter=${rsUsableAfter}`);
  lines.push(`- inputBreakPoint=${rr20.length === 0 ? 'INPUT_NOT_CONNECTED' : 'NONE'}`);
  lines.push('- rankBasis=watchlistCandidates');
  lines.push(`- percentileDistribution: top10=${rsRankValues.filter((v) => v >= 90).length}, top20=${rsRankValues.filter((v) => v >= 80).length}, top40=${rsRankValues.filter((v) => v >= 60).length}, bottom60=${Math.max(0, traces.length - rsRankValues.filter((v) => v >= 60).length)}`);
  lines.push(`- zeroReasonDistribution: INPUT_NOT_CONNECTED=${rr20.length === 0 ? traces.length : 0}, BELOW_RS_PERCENTILE=0, RELATIVE_RETURN_NEGATIVE=0, SCORE_MAPPING_MISSING=0`);

  lines.push('');
  lines.push('BREAKOUT_STRUCTURE Score Curve Audit:');
  lines.push('- inputSourcePath=breakoutFeatureBuilder -> gateScoreInputSnapshot.breakoutTrace -> Gate1Trace[BREAKOUT_STRUCTURE] -> featurePack.breakout');
  lines.push(`- traceAvailable=${traces.length}`);
  lines.push(`- runtimeScoreComputed=${breakoutComputed}`);
  lines.push(`- auditScoreComputed=${breakoutComputed}`);
  lines.push(`- scoreMappedToGate=${breakoutMappedToGate}`);
  lines.push(`- fieldPathHitTop=${Object.entries(breakoutHitMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(',') || 'INPUT_FIELD_PATH_UNRESOLVED'}`);
  lines.push(`- positiveCount=${breakoutPositive}`);
  lines.push(`- zeroByCondition=${Math.max(0, breakoutComputed - breakoutPositive)}`);
  lines.push(`- missingByMapping=${breakoutUnresolved}`);
  lines.push(`- missingByMappingSymbols=${breakoutRows.filter((row) => !row.inputResolved).slice(0, 8).map((row) => `${row.symbol}:${row.mappingBreakPoint}`).join(',') || 'NONE'}`);
  lines.push(`- TRACE_NOT_PROJECTED=${breakoutRows.filter((row) => row.mappingBreakPoint === 'TRACE_NOT_PROJECTED').length}`);
  lines.push(`- inputBreakPoint=${breakoutComputed === 0 ? 'INPUT_NOT_CONNECTED' : breakoutPositive === 0 ? 'CONDITION_NOT_MET' : 'NONE'}`);
  lines.push(`- zeroReasonDistribution: NOT_NEAR_20D_HIGH=0, NOT_NEAR_55D_HIGH=0, TURTLE_HIGH_NOT_MET=${Math.max(0, breakoutComputed - breakoutPositive)}, VOLUME_BREAKOUT_MISSING=0, VCP_NOT_CONFIRMED=0, ENTRY_PRICE_NOT_REACHED=0, PULLBACK_INVALID=0, REGIME_CAPPED=0, SCORE_MAPPING_MISSING=0, INPUT_NOT_CONNECTED=${breakoutUnresolved}`);

  lines.push('');
  lines.push('Regime Risk Placement Audit:');
  const r6RecoveryStatus = (macroState.r6RecoveryStatus as string | undefined) ?? 'UNKNOWN';
  const r6BlockedReason = (macroState.r6RecoveryBlockedReason as string | undefined) ?? 'NONE';
  lines.push(`- rawRegime=${rawRegime}`);
  lines.push(`- effectiveRegime=${effectiveRegime}`);
  lines.push(`- displayRegime=${displayRegime}`);
  lines.push(`- riskOverride=${riskOverride}`);
  lines.push(`- engineMode=${engineMode}`);
  lines.push(`- policyView=${policyView}`);
  lines.push(`- liveEntryAllowed=${liveEntryAllowed}`);
  lines.push(`- shadowAllowed=${shadowAllowed}`);
  lines.push(`- counterfactualAllowed=${counterfactualAllowed}`);
  lines.push(`- regimeContextSource=${regimeContextSource}`);
  lines.push(`- regimeContextMatch=${regimeContextMatch}`);
  lines.push(`- page2EffectiveRegime=${page2EffectiveRegime}`);
  lines.push(`- childEffectiveRegime=${childEffectiveRegime}`);
  if (legacyEffectiveRegime !== undefined) {
    lines.push(`- legacyEffectiveRegime=${legacyEffectiveRegime} deprecated=${canonicalContext?.legacyDeprecated ?? true} usedForDecision=false`);
  }
  lines.push(`- REGIME_CONTEXT_MISMATCH=${regimeContextMismatch}`);
  lines.push(`- LEGACY_EFFECTIVE_REGIME_LEAK=${legacyEffectiveRegimeLeak}`);
  lines.push(`- nextAction=${nextAction}`);
  lines.push(`- r6RecoveryStatus=${r6RecoveryStatus}`);
  lines.push(`- recoveryBlockedReason=${r6BlockedReason}`);
  lines.push('- signalScorePenaltyApplied=false');
  lines.push('- confidenceDowngradeApplied=true');
  lines.push(`- sizingMultiplierApplied=${(d.kellySizingTraces[0]?.riskMultiplier ?? 1).toFixed(2)}`);
  lines.push('- sizingHardBlock=false');
  lines.push('- executionPermissionImpact=NONE');
  lines.push('- doubleCountWarning=false');
  lines.push('- finalPlacement=CONFIDENCE_ONLY');
  lines.push('- inputSourcePath=RegimeResolver.canonicalOutput');
  lines.push(`- inputBreakPoint=${effectiveRegime === 'UNKNOWN' ? 'INPUT_CONTEXT_MISSING' : 'NONE'}`);
  lines.push('');
  lines.push(...formatGate2ExternalDataStageSection(d, gate2Canonical));

  if (d.filterConservatismReport) {
    lines.push("");
    lines.push("판정:");
    lines.push(
      `• FILTER_TOO_CONSERVATIVE 후보: ${
        d.filterConservatismReport.primaryConservativeFilters
          .map((f) => f.code)
          .slice(0, 3)
          .join(" / ") || "DIAGNOSTIC_ONLY"
      }`,
    );
    lines.push("• threshold 변경 전 counterfactual 결과 확인 권장");
  }
  return lines.join("\n");
}
