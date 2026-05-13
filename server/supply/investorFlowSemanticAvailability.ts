/**
 * @responsibility ADR-0421 Investor-Flow Semantic Availability Check SSOT
 *
 * ADR-0421:
 * Investor-flow availability is semantic, not structural.
 * A non-null provider payload is not enough for supply_confluence scoring.
 * Required investor net-buy fields must exist and be scoring-eligible.
 *
 * success=0/missing>0/provider mismatch/cache empty/not wired sources
 * must not be reported as NEUTRAL. NEUTRAL is reserved for real data with
 * weak or balanced directionality.
 *
 * This module must not change gate thresholds, weights, or trading policy.
 *
 * 사용자 명시 핵심 불변식:
 *   1. Investor flow 객체가 존재해도 scoring 에 필요한 의미 필드가 없으면 available 아님.
 *   2. success 0/10 + missing 10/10 은 NEUTRAL 이 아님.
 *   3. PROVIDER_MISMATCH / NOT_WIRED / CACHE_EMPTY / KRX_ERROR 는 평가 불가 또는
 *      degraded 원인으로 노출되어야 함.
 *   4. DATA_UNAVAILABLE 은 failed 가 아님 (ADR-0416 정합).
 *   5. 본 PR 은 semantic availability 진단 PR. Gate threshold, weight, 매매 정책
 *      절대 변경 0.
 *
 * 외부 의존성 0 — 순수 함수 SSOT (KIS/Yahoo/외부 API 호출 0건).
 */

/**
 * Investor-flow semantic availability status SSOT.
 *
 * 의미 필드 부재 시 NEUTRAL 사용 절대 금지 (사용자 명시 핵심 불변식 #2/#3).
 */
export type InvestorFlowSemanticStatus =
  | 'OK'
  | 'DATA_UNAVAILABLE'
  | 'DEGRADED'
  | 'PROVIDER_MISMATCH'
  | 'KRX_ERROR'
  | 'NAVER_NOT_WIRED'
  | 'CACHE_EMPTY'
  | 'KIS_DIAGNOSTIC_ONLY'
  | 'FIELD_MISSING'
  | 'UNKNOWN';

/**
 * Semantic availability 평가 결과 — 운영자 진단 + evaluator 분류 입력 동시 제공.
 */
export interface InvestorFlowSemanticAvailability {
  available: boolean;
  status: InvestorFlowSemanticStatus;
  reason: string;
  missingFields: string[];
  /** 활성 provider (가용 시) — 진단 표시용. */
  provider?: string;
  /** 시도한 provider 별 결과 (옵셔널, 운영자 진단용). */
  providerTried?: Record<string, string>;
}

/**
 * KisInvestorFlow scoring 에 필요한 핵심 semantic 필드 SSOT.
 *
 * 본 모듈은 KisInvestorFlow type 의 *현재 구조* (foreignNetBuy / institutionalNetBuy)
 * 를 그대로 따른다. 임의 필드명 추가 금지 — 실제 타입 변경 시 본 SSOT 동시 갱신 의무.
 *
 * @see server/clients/kisClient/types.ts — KisInvestorFlow
 */
export const INVESTOR_FLOW_REQUIRED_FIELDS = ['foreignNetBuy', 'institutionalNetBuy'] as const;

/**
 * 필드 alias — 다른 provider 가 다른 이름을 사용할 수 있어 fallback 매핑 SSOT.
 *
 * 예: NAVER trend → `foreignerNetBuy` / KRX → `foreignNetAmount` 같은 alias.
 * KisInvestorFlow 는 표준 키만 사용하지만 향후 multi-provider 결합 시 확장 가능.
 */
export const INVESTOR_FLOW_FIELD_ALIASES: Record<string, readonly string[]> = {
  foreignNetBuy: ['foreignNetBuy', 'foreignNetAmount', 'foreignerNetBuy'],
  institutionalNetBuy: [
    'institutionalNetBuy',
    'institutionNetBuy',
    'institutionNetAmount',
    'institutionalNetAmount',
  ],
};

/**
 * 객체에서 number-like 필드 존재 여부 검사 SSOT.
 *
 * 검사 규칙:
 *   - 후보 키 중 하나라도 typeof === 'number' && Number.isFinite(value) → true
 *   - null/undefined/NaN/Infinity → false
 *   - 0 은 *유효한 값* — 운영자가 "오늘 순매수 0주" 를 의미할 수 있음 (NEUTRAL 후보).
 *
 * 외부 부작용 0.
 */
export function hasNumberLikeField(input: unknown, candidates: readonly string[]): boolean {
  if (input == null || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  for (const key of candidates) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return true;
  }
  return false;
}

/**
 * Investor-flow semantic availability 평가 SSOT (사용자 §C 정합).
 *
 * 결정 트리 (위에서 아래 첫 매칭):
 *   1. input null/undefined → DATA_UNAVAILABLE.
 *   2. input non-object → UNKNOWN (잘못된 타입 가드).
 *   3. foreignNetBuy / institutionalNetBuy 둘 다 부재 → FIELD_MISSING (전부 부재).
 *   4. 일부만 부재 → DEGRADED + missingFields 표시.
 *   5. 둘 다 number-like → OK + provider 정보 propagate.
 *
 * 핵심 불변식 (사용자 명시 #1):
 *   객체 존재만으로 available=true 절대 금지 — 의미 필드 검증 의무.
 *
 * 외부 부작용 0.
 */
export function evaluateInvestorFlowSemanticAvailability(
  input: unknown,
): InvestorFlowSemanticAvailability {
  if (input == null) {
    return {
      available: false,
      status: 'DATA_UNAVAILABLE',
      reason: 'investor flow input is missing (null or undefined)',
      missingFields: [...INVESTOR_FLOW_REQUIRED_FIELDS],
    };
  }
  if (typeof input !== 'object') {
    return {
      available: false,
      status: 'UNKNOWN',
      reason: `investor flow input has unexpected type: ${typeof input}`,
      missingFields: [...INVESTOR_FLOW_REQUIRED_FIELDS],
    };
  }

  const missingFields: string[] = [];
  for (const required of INVESTOR_FLOW_REQUIRED_FIELDS) {
    const aliases = INVESTOR_FLOW_FIELD_ALIASES[required] ?? [required];
    if (!hasNumberLikeField(input, aliases)) {
      missingFields.push(required);
    }
  }

  // 일부 provider 가 source 필드를 노출 — 진단 메타로 propagate (선택).
  const obj = input as Record<string, unknown>;
  const provider = typeof obj.source === 'string' ? obj.source : undefined;

  if (missingFields.length === 0) {
    return {
      available: true,
      status: 'OK',
      reason: 'investor flow semantic fields are available',
      missingFields: [],
      ...(provider ? { provider } : {}),
    };
  }

  if (missingFields.length === INVESTOR_FLOW_REQUIRED_FIELDS.length) {
    return {
      available: false,
      status: 'FIELD_MISSING',
      reason: `investor flow semantic fields all missing: ${missingFields.join(', ')}`,
      missingFields,
      ...(provider ? { provider } : {}),
    };
  }

  // 일부만 부재 — DEGRADED.
  return {
    available: false,
    status: 'DEGRADED',
    reason: `investor flow semantic fields partially missing: ${missingFields.join(', ')}`,
    missingFields,
    ...(provider ? { provider } : {}),
  };
}



export interface InvestorFlowSemanticRowAudit {
  rowCount: number;
  investorTypesDetected: string[];
  foreignRowFound: boolean;
  institutionalRowFound: boolean;
  individualRowFound: boolean;
  rowMappingConfidence: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface InvestorFlowSemanticFields {
  foreignNetBuy: number | null;
  institutionalNetBuy: number | null;
  individualNetBuy: number | null;
  programNetBuy?: number | null;
  netBuyAmount?: number | null;
  netBuyVolume?: number | null;
  sourceFields: Record<string, string>;
  materializedCount: number;
  normalizedCount: number;
  rowCount?: number;
  investorTypesDetected?: string[];
  foreignRowFound?: boolean;
  institutionalRowFound?: boolean;
  individualRowFound?: boolean;
  rowMappingConfidence?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  allMaterializedValuesZero?: boolean;
  placeholderOnly?: boolean;
}

export type InvestorFlowSemanticAvailabilityReason =
  | 'AVAILABLE'
  | 'NO_FOREIGN_OR_INSTITUTION_FIELD'
  | 'SYMBOL_NOT_MATCHED'
  | 'PROVIDER_SCOPE_NOT_SYMBOL_LEVEL'
  | 'ONLY_MARKET_LEVEL_FLOW'
  | 'ONLY_SECTOR_LEVEL_FLOW'
  | 'PLACEHOLDER_ONLY'
  | 'STALE_ONLY'
  | 'ZERO_BUT_MATERIALIZED'
  | 'ROW_MAPPING_FAILED'
  | 'UNKNOWN';

export interface InvestorFlowSemanticAvailabilityResult extends InvestorFlowSemanticFields {
  available: boolean;
  diagnosticAvailable: boolean;
  reason: InvestorFlowSemanticAvailabilityReason;
  providerIssue: boolean;
  marketSignal: false;
  scoreUsage: 'ELIGIBLE_AFTER_SEMANTIC_MATCH' | 'SHADOW_ONLY' | 'DIAGNOSTIC_ONLY';
  executionImpact: 'NONE';
  semanticDiagnosticAvailable?: boolean;
  wouldBeNeutralIfZeroButMaterialized?: boolean;
  wouldBeEligibleIfForeignOrInstitutionFieldMapped?: boolean;
}

const FOREIGN_NET_BUY_ALIASES = [
  'foreignNetBuy',
  'foreignNetAmount',
  'foreignNetVolume',
  'foreignerNetBuy',
  'frgnNetBuy',
  'frgnNetAmount',
  'frgn_ntby',
  'frgn_ntby_qty',
  'frgn_ntby_tr_pbmn',
  'foreigner',
] as const;
const INSTITUTIONAL_NET_BUY_ALIASES = [
  'institutionalNetBuy',
  'institutionNetBuy',
  'instNetBuy',
  'orgNetBuy',
  'orgnNetBuy',
  'orgn_ntby',
  'orgn_ntby_qty',
  'orgn_ntby_tr_pbmn',
  'institution',
] as const;
const INDIVIDUAL_NET_BUY_ALIASES = [
  'individualNetBuy',
  'retailNetBuy',
  'prsnNetBuy',
  'indvNetBuy',
  'indv_ntby',
  'individual',
] as const;
const PROGRAM_NET_BUY_ALIASES = ['programNetBuy'] as const;
const NET_BUY_AMOUNT_ALIASES = ['netBuyAmount', 'netAmount', 'buyAmount', 'sellAmount'] as const;
const NET_BUY_VOLUME_ALIASES = ['netBuyVolume', 'netVolume', 'buyVolume', 'sellVolume'] as const;
const ROW_ARRAY_KEYS = ['rows', 'data', 'items', 'investorFlows', 'investorFlow', 'flows', 'result', 'output'] as const;

export function normalizeNumberLikeInvestorFlowValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed.toUpperCase() === 'N/A') return null;
  const normalized = trimmed.replace(/,/g, '');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumberLikeField(
  obj: Record<string, unknown>,
  aliases: readonly string[],
): { value: number | null; sourceField?: string; rawMaterialized: boolean } {
  let rawMaterialized = false;
  for (const key of aliases) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    rawMaterialized = true;
    const value = normalizeNumberLikeInvestorFlowValue(obj[key]);
    if (value !== null) return { value, sourceField: key, rawMaterialized: true };
  }
  return { value: null, rawMaterialized };
}

function emptyRowAudit(): InvestorFlowSemanticRowAudit {
  return {
    rowCount: 0,
    investorTypesDetected: [],
    foreignRowFound: false,
    institutionalRowFound: false,
    individualRowFound: false,
    rowMappingConfidence: 'NONE',
  };
}

function classifyInvestorType(value: unknown): 'foreign' | 'institutional' | 'individual' | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  if (!text) return null;
  if (/(외국인|FOREIGN|FRGN|FOREIGNER)/i.test(text)) return 'foreign';
  if (/(기관|INSTITUTION|INSTITUTIONAL|ORG|ORGN|INST)/i.test(text)) return 'institutional';
  if (/(개인|INDIVIDUAL|RETAIL|PRSN|INDV)/i.test(text)) return 'individual';
  return null;
}

function findRows(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) return input.filter((row): row is Record<string, unknown> => row != null && typeof row === 'object' && !Array.isArray(row));
  if (input == null || typeof input !== 'object') return [];
  const obj = input as Record<string, unknown>;
  for (const key of ROW_ARRAY_KEYS) {
    const candidate = obj[key];
    if (Array.isArray(candidate)) return candidate.filter((row): row is Record<string, unknown> => row != null && typeof row === 'object' && !Array.isArray(row));
  }
  return [];
}

function extractRowFields(input: unknown): Partial<InvestorFlowSemanticFields> & InvestorFlowSemanticRowAudit {
  const rows = findRows(input);
  const audit = emptyRowAudit();
  audit.rowCount = rows.length;
  const mapped: Partial<InvestorFlowSemanticFields> = { sourceFields: {} };
  for (const row of rows) {
    const investorTypeRaw = row.investorType ?? row.type ?? row.investor ?? row.invstType ?? row.invrDvsnName ?? row.invr_dvsn_name;
    if (typeof investorTypeRaw === 'string' && investorTypeRaw.trim()) audit.investorTypesDetected.push(investorTypeRaw.trim());
    const investorType = classifyInvestorType(investorTypeRaw);
    if (!investorType) continue;
    const net = firstNumberLikeField(row, [...NET_BUY_AMOUNT_ALIASES, ...NET_BUY_VOLUME_ALIASES, 'netBuy', 'net_buy', 'ntby', 'ntby_qty', 'ntby_tr_pbmn']);
    if (net.value === null) continue;
    if (investorType === 'foreign') {
      mapped.foreignNetBuy = net.value;
      (mapped.sourceFields as Record<string, string>).foreignNetBuy = `row.${net.sourceField ?? 'netBuyAmount'}`;
      audit.foreignRowFound = true;
    } else if (investorType === 'institutional') {
      mapped.institutionalNetBuy = net.value;
      (mapped.sourceFields as Record<string, string>).institutionalNetBuy = `row.${net.sourceField ?? 'netBuyAmount'}`;
      audit.institutionalRowFound = true;
    } else if (investorType === 'individual') {
      mapped.individualNetBuy = net.value;
      (mapped.sourceFields as Record<string, string>).individualNetBuy = `row.${net.sourceField ?? 'netBuyAmount'}`;
      audit.individualRowFound = true;
    }
  }
  const mappedCount = [audit.foreignRowFound, audit.institutionalRowFound, audit.individualRowFound].filter(Boolean).length;
  audit.rowMappingConfidence = mappedCount >= 2 ? 'HIGH' : mappedCount === 1 ? 'MEDIUM' : rows.length > 0 ? 'LOW' : 'NONE';
  audit.investorTypesDetected = Array.from(new Set(audit.investorTypesDetected));
  return { ...mapped, ...audit };
}

export function extractInvestorFlowSemanticFields(input: unknown): InvestorFlowSemanticFields {
  const sourceFields: Record<string, string> = {};
  const base: InvestorFlowSemanticFields = {
    foreignNetBuy: null,
    institutionalNetBuy: null,
    individualNetBuy: null,
    programNetBuy: null,
    netBuyAmount: null,
    netBuyVolume: null,
    sourceFields,
    materializedCount: 0,
    normalizedCount: 0,
    ...emptyRowAudit(),
    allMaterializedValuesZero: false,
    placeholderOnly: false,
  };
  if (input == null) return base;
  const obj = Array.isArray(input) ? {} : typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const row = extractRowFields(input);
  Object.assign(sourceFields, row.sourceFields ?? {});
  base.rowCount = row.rowCount;
  base.investorTypesDetected = row.investorTypesDetected;
  base.foreignRowFound = row.foreignRowFound;
  base.institutionalRowFound = row.institutionalRowFound;
  base.individualRowFound = row.individualRowFound;
  base.rowMappingConfidence = row.rowMappingConfidence;

  const mappings: Array<[keyof InvestorFlowSemanticFields, readonly string[]]> = [
    ['foreignNetBuy', FOREIGN_NET_BUY_ALIASES],
    ['institutionalNetBuy', INSTITUTIONAL_NET_BUY_ALIASES],
    ['individualNetBuy', INDIVIDUAL_NET_BUY_ALIASES],
    ['programNetBuy', PROGRAM_NET_BUY_ALIASES],
    ['netBuyAmount', NET_BUY_AMOUNT_ALIASES],
    ['netBuyVolume', NET_BUY_VOLUME_ALIASES],
  ];
  for (const [target, aliases] of mappings) {
    const picked = firstNumberLikeField(obj, aliases);
    if (picked.rawMaterialized) base.materializedCount += 1;
    const rowValue = row[target] as number | null | undefined;
    const value = rowValue ?? picked.value;
    if (value !== null && value !== undefined) {
      (base as unknown as Record<string, unknown>)[target] = value;
      base.normalizedCount += 1;
      if (!sourceFields[target as string]) sourceFields[target as string] = picked.sourceField ?? String(target);
    }
  }
  const rowMaterialized = [row.foreignRowFound, row.institutionalRowFound, row.individualRowFound].filter(Boolean).length;
  base.materializedCount += rowMaterialized;
  const values = [base.foreignNetBuy, base.institutionalNetBuy, base.individualNetBuy, base.programNetBuy, base.netBuyAmount, base.netBuyVolume]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  base.allMaterializedValuesZero = values.length > 0 && values.every((value) => value === 0);
  base.placeholderOnly = base.materializedCount > 0 && base.normalizedCount === 0;
  return base;
}

export function evaluateInvestorFlowSemanticAvailabilityV2(input: {
  flow: unknown;
  symbolMatched?: boolean | null;
  inferredSymbolMatched?: boolean;
  providerScope?: 'SYMBOL_LEVEL' | 'MARKET_LEVEL' | 'SECTOR_LEVEL' | 'UNKNOWN';
  stale?: boolean;
  providerIssue?: boolean;
}): InvestorFlowSemanticAvailabilityResult {
  const fields = extractInvestorFlowSemanticFields(input.flow);
  const symbolOk = input.symbolMatched === true || input.inferredSymbolMatched === true;
  const providerScope = input.providerScope ?? 'UNKNOWN';
  const hasCoreField = fields.foreignNetBuy !== null || fields.institutionalNetBuy !== null;
  const materialized = fields.materializedCount > 0 && fields.normalizedCount > 0;
  let reason: InvestorFlowSemanticAvailabilityReason = 'UNKNOWN';
  if (!symbolOk) reason = 'SYMBOL_NOT_MATCHED';
  else if (providerScope === 'MARKET_LEVEL') reason = 'ONLY_MARKET_LEVEL_FLOW';
  else if (providerScope === 'SECTOR_LEVEL') reason = 'ONLY_SECTOR_LEVEL_FLOW';
  else if (providerScope !== 'SYMBOL_LEVEL') reason = 'PROVIDER_SCOPE_NOT_SYMBOL_LEVEL';
  else if (fields.placeholderOnly) reason = 'PLACEHOLDER_ONLY';
  else if ((fields.rowCount ?? 0) > 0 && fields.rowMappingConfidence === 'LOW' && !hasCoreField) reason = 'ROW_MAPPING_FAILED';
  else if (!hasCoreField) reason = 'NO_FOREIGN_OR_INSTITUTION_FIELD';
  else if (input.stale) reason = 'STALE_ONLY';
  else if (fields.allMaterializedValuesZero) reason = 'ZERO_BUT_MATERIALIZED';
  else reason = 'AVAILABLE';

  const available = reason === 'AVAILABLE' || reason === 'ZERO_BUT_MATERIALIZED';
  const hasFlowObject = input.flow != null && typeof input.flow === 'object';
  const diagnosticAvailable = materialized || fields.materializedCount > 0 || fields.rowCount! > 0 || (hasFlowObject && symbolOk && providerScope === 'SYMBOL_LEVEL');
  return {
    ...fields,
    available,
    diagnosticAvailable,
    semanticDiagnosticAvailable: diagnosticAvailable,
    reason,
    providerIssue: input.providerIssue ?? !available,
    marketSignal: false,
    scoreUsage: available && !input.stale ? 'ELIGIBLE_AFTER_SEMANTIC_MATCH' : diagnosticAvailable ? 'SHADOW_ONLY' : 'DIAGNOSTIC_ONLY',
    executionImpact: 'NONE',
    wouldBeNeutralIfZeroButMaterialized: reason === 'ZERO_BUT_MATERIALIZED',
    wouldBeEligibleIfForeignOrInstitutionFieldMapped: !hasCoreField && symbolOk && providerScope === 'SYMBOL_LEVEL',
  };
}

/**
 * supplyHealth marker 분류 SSOT (사용자 §F 정합).
 *
 * 사용자 명시 핵심 불변식 #2 — `success === 0 && missing > 0` 은 NEUTRAL 이 아님.
 *
 * 결정 트리 (사용자 §F):
 *   1. total === 0 → MISSING (검증 대상 부재).
 *   2. success === 0 && missing > 0 → DATA_UNAVAILABLE (NEUTRAL 절대 금지).
 *   3. success > 0 && success < total (partial) → DEGRADED.
 *   4. zeroSuspicious → DEGRADED.
 *   5. staleCache > 0 → STALE.
 *   6. 그 외 → OK.
 *
 * NEUTRAL 은 본 SSOT 가 *반환하지 않음* — NEUTRAL 은 호출자가 "데이터는 있고 방향성이
 * 약함" 판단할 때만 사용 (사용자 §G 정합). 본 SSOT 의 결정 트리에는 포함되지 않음.
 *
 * 외부 부작용 0.
 */
export type InvestorFlowMarker = 'OK' | 'STALE' | 'DEGRADED' | 'MISSING' | 'DATA_UNAVAILABLE';

export interface InvestorFlowMarkerInput {
  total: number;
  success: number;
  missing: number;
  zeroSuspicious: boolean;
  staleCacheCount: number;
}

export function classifyInvestorFlowMarker(input: InvestorFlowMarkerInput): InvestorFlowMarker {
  if (input.total <= 0) return 'MISSING';
  // 사용자 명시 핵심 불변식 #2 — success=0 + missing>0 은 NEUTRAL 절대 금지.
  if (input.success === 0 && input.missing > 0) return 'DATA_UNAVAILABLE';
  if (input.success > 0 && input.success < input.total) return 'DEGRADED';
  if (input.zeroSuspicious) return 'DEGRADED';
  if (input.staleCacheCount > 0) return 'STALE';
  return 'OK';
}

/**
 * supplyHealth marker 별 운영자 가이드 텍스트 SSOT (사용자 §F 권장 문구).
 *
 * NEUTRAL 의도된 사용 영역 — 본 함수에서는 *데이터 없는* 모든 상태를 NEUTRAL 이 아닌
 * 명시적 status 로 분류. NEUTRAL 안내는 호출자 측에서 "real data + weak direction"
 * 시점에만 사용 (사용자 §G 정합).
 */
export function describeInvestorFlowMarker(marker: InvestorFlowMarker): string {
  switch (marker) {
    case 'OK':
      return '판정: OK — policy provider 실데이터 사용 가능';
    case 'STALE':
      return '판정: STALE — CACHE는 있으나 최신성 확인 필요';
    case 'DEGRADED':
      return '판정: DEGRADED — coverage/zero-filled/semantic field 일부 부재';
    case 'MISSING':
      return '판정: MISSING — 검증 대상 부재 (워치리스트 비어있음)';
    case 'DATA_UNAVAILABLE':
      return '판정: DATA_UNAVAILABLE — scoring-eligible investor flow 의미 필드 부재. KRX/NAVER/CACHE 미연결, KIS는 진단용';
  }
}
