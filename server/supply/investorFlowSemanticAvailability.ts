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
  foreignNetBuy: ['foreignNetBuy', 'foreignNetAmount', 'foreignerNetBuy', 'frgn_ntby', 'frgn_ntby_qty', 'frgn_ntby_tr_pbmn', 'frgn_ntby_tr_pbmn_amt', 'frgn_seln_qty', 'frgn_shnu_qty'],
  institutionalNetBuy: [
    'institutionalNetBuy',
    'institutionNetBuy',
    'institutionNetAmount',
    'institutionalNetAmount',
    'orgn_ntby',
    'orgn_ntby_qty',
    'orgn_ntby_tr_pbmn',
    'orgn_ntby_tr_pbmn_amt',
    'orgNetBuy',
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
 * actual investor numeric row 판정 SSOT (INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001).
 *
 * adapter/router 가 carry 한 row 가 *진짜 실데이터 row* 인지 판정 — dummy/wrapper/
 * metadata-only 객체를 거부한다.
 *
 * 검사 규칙:
 *   - 후보 키 중 하나라도 finite number 또는 finite numeric-string → true
 *   - null/undefined/non-object/array → false
 *   - 후보 키 전부 부재 또는 전부 non-numeric → false (wrapper/metadata-only 거부)
 *   - 0 은 *유효한 값* — "오늘 순매수 0주" (NEUTRAL 후보).
 *
 * 외부 부작용 0.
 */
const ACTUAL_INVESTOR_NUMERIC_ROW_FIELDS: readonly string[] = [
  'foreignNetBuy',
  'institutionalNetBuy',
  'institutionNetBuy',
  'individualNetBuy',
  'frgn_ntby_qty',
  'orgn_ntby_qty',
  'prsn_ntby_qty',
  'frgn_ntby_tr_pbmn',
  'orgn_ntby_tr_pbmn',
  'prsn_ntby_tr_pbmn',
  'foreign',
  'institution',
  'individual',
  'foreignAmount',
  'institutionAmount',
  'individualAmount',
] as const;

export function hasActualInvestorNumericRow(row: unknown): boolean {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) return false;
  const obj = row as Record<string, unknown>;
  for (const key of ACTUAL_INVESTOR_NUMERIC_ROW_FIELDS) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return true;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value.replace(/,/g, ''));
      if (Number.isFinite(parsed)) return true;
    }
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

export type InvestorFlowSampleValueKind = 'number' | 'numericString' | 'empty' | 'placeholder';

export type InvestorFlowUnwrapReason =
  | 'FOUND_DIRECT_ROW'
  | 'FOUND_NESTED_INVESTOR_FLOW_SEMANTIC_ROW'
  | 'FOUND_NESTED_RAW_ROW'
  | 'FOUND_NESTED_NORMALIZED_ROW'
  | 'FOUND_ROWS_ARRAY'
  | 'FOUND_DATA_ARRAY'
  | 'ONLY_WRAPPER_METADATA'
  | 'NO_ROW_FOUND';

export interface InvestorFlowRowsUnwrapDiagnostic {
  rows: Array<Record<string, unknown>>;
  paths: string[];
  wrapperKeys: string[];
  rawFieldKeys: string[];
  numericStringFieldKeys: string[];
  placeholderFieldKeys: string[];
  selectedPath: string | null;
  reason: InvestorFlowUnwrapReason;
  rowCandidateCount?: number;
  selectedRowScore?: number;
  rejectedWrapperPathsTop?: string[];
  wrapperOnlyCount?: number;
  numericCandidateCount?: number;
  aliasCandidateCount?: number;
}

export interface InvestorFlowFieldKeyDiscoveryDiagnostic {
  kisRawFieldKeysTop: string[];
  kisNormalizedFieldKeysTop: string[];
  sampleValueKinds: Record<InvestorFlowSampleValueKind, number>;
  candidateMappedFields: {
    foreign: string[];
    institution: string[];
    individual: string[];
  };
  unwrapRows?: number;
  selectedPath?: string | null;
  unwrapReason?: InvestorFlowUnwrapReason;
  wrapperKeys?: string[];
  actualRawFieldKeysTop?: string[];
  actualNumericStringFieldKeysTop?: string[];
  actualNumberFieldKeysTop?: string[];
  actualPlaceholderFieldKeysTop?: string[];
  candidateNetBuyFieldKeysTop?: string[];
  rowCandidateCount?: number;
  selectedRowScore?: number;
  selectedActualRawFieldKeysTop?: string[];
  selectedNumericStringFieldKeysTop?: string[];
  rejectedWrapperPathsTop?: string[];
  wrapperOnlyCount?: number;
  numericCandidateCount?: number;
  aliasCandidateCount?: number;
}

export type InvestorFlowProviderScope = 'SYMBOL_LEVEL' | 'MARKET_LEVEL' | 'SECTOR_LEVEL' | 'UNKNOWN';

export interface SanitizedInvestorFlowSemanticRow {
  symbol: string | null;
  provider: string;
  providerScope: InvestorFlowProviderScope;
  materialized: boolean;
  foreignNetBuy: number | null;
  institutionalNetBuy: number | null;
  individualNetBuy: number | null;
  netBuyAmount?: number | null;
  netBuyVolume?: number | null;
  sourceFields: {
    foreign?: string;
    institutional?: string;
    individual?: string;
    netBuyAmount?: string;
    netBuyVolume?: string;
  };
  rawFieldKeys: string[];
  normalizedFieldKeys: string[];
  rowCount?: number;
  investorTypesDetected?: string[];
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
  fieldKeyDiagnostics?: InvestorFlowFieldKeyDiscoveryDiagnostic;
}

export type InvestorFlowSemanticAvailabilityReason =
  | 'AVAILABLE'
  | 'NO_FOREIGN_OR_INSTITUTION_FIELD'
  | 'SEMANTIC_ROW_METADATA_ONLY'
  | 'FIELD_ALIAS_NOT_MAPPED'
  | 'ONLY_WRAPPER_OBJECT_SELECTED'
  | 'NO_ACTUAL_ROW_FOUND'
  | 'ACTUAL_INVESTOR_ROW_NOT_CARRIED'
  // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — carry 된 row 가 dummy/wrapper 라 숫자 투자자
  // 필드가 하나도 없는 경우 (실데이터 row 와 metadata-only row 구분).
  | 'NO_NUMERIC_INVESTOR_FIELD_FOUND'
  | 'DEEP_UNWRAP_NO_NUMERIC_FIELDS'
  | 'NUMERIC_FIELDS_FOUND_BUT_ALIAS_UNKNOWN'
  | 'ALIAS_MAPPED_FOREIGN_ONLY'
  | 'ALIAS_MAPPED_INSTITUTION_ONLY'
  | 'ALIAS_MAPPED_BOTH'
  | 'INVESTOR_TYPE_ROW_MAPPING_FAILED'
  | 'RAW_INVESTOR_ROW_MISSING'
  | 'ROUTER_DROPPED_SEMANTIC_ROW'
  | 'FORENSIC_INPUT_DROPPED_SEMANTIC_ROW'
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
  wouldBeSemanticAvailableIfFieldMapped?: boolean;
  wouldBeZeroNeutralIfAllZero?: boolean;
  semanticRowBreakPoint?: string;
}


const INVESTOR_FLOW_WRAPPER_METADATA_KEYS = new Set([
  'candidateSymbol',
  'quoteSymbol',
  'providerSymbol',
  'normalizedSymbol',
  'requestSymbol',
  'providerScope',
  'selectedProvider',
  'materialized',
  'usableForRouter',
  'usableForGate',
  'usableForLive',
  'usableForShadow',
  'forensicInputCarriesSemanticRow',
  'kisNormalizedRowAvailableAtRouter',
  'kisRawRowAvailableAtAdapter',
  'kisSelectedCandidateCarriesSemanticRow',
  'investorFlowSemanticRow',
  'semanticRow',
  'rawRow',
  'normalizedRow',
  'materializedCount',
  'normalizedCount',
  'rowCount',
  'scoreUsage',
  'executionImpact',
  'semanticRowBreakPoint',
  'actualInvestorFlowRowCarrier',
  'actualInvestorFlowRows',
  'actualInvestorFlowRowCount',
  'actualInvestorFlowRowSourcePath',
  'actualInvestorFlowCarried',
  'symbol',
  'provider',
  'routePurpose',
  'semanticAvailable',
  'status',
  'signal',
  'source',
  'stale',
  'liveExecutionAllowed',
]);

const PRIVATE_OR_SECRET_FIELD_PATTERN = /token|secret|password|authorization|auth|appkey|appsecret|account|acct|cano|acnt/i;

const INVESTOR_FLOW_NESTED_PATHS = [
  'input',
  'input.raw',
  'input.rawRow',
  'input.normalized',
  'input.normalizedRow',
  'input.investorFlowSemanticRow',
  'input.investorFlowSemanticRow.rawRow',
  'input.investorFlowSemanticRow.normalizedRow',
  'input.investorFlowSemanticRow.rows',
  'input.investorFlowSemanticRow.data',
  'input.semanticRow',
  'input.semanticRow.rawRow',
  'input.semanticRow.normalizedRow',
  'input.semanticRow.rows',
  'input.semanticRow.data',
  'input.actualInvestorFlowRows',
  'input.actualInvestorFlowRowCarrier.actualRows',
  'input.selectedCandidate.actualInvestorFlowRows',
  'input.selectedCandidate.actualInvestorFlowRowCarrier.actualRows',
  'input.selectedCandidate',
  'input.selectedCandidate.raw',
  'input.selectedCandidate.rawRow',
  'input.selectedCandidate.normalized',
  'input.selectedCandidate.normalizedRow',
  'input.selectedCandidate.rows',
  'input.selectedCandidate.data',
  'input.selectedCandidate.payload',
  'input.selectedCandidate.output',
  'input.selectedCandidate.result',
  'input.selectedCandidate.providerResult.raw',
  'input.selectedCandidate.providerResult.normalized',
  'input.selectedCandidate.investorFlowSemanticRow',
  'input.selectedCandidate.investorFlowSemanticRow.rawRow',
  'input.selectedCandidate.investorFlowSemanticRow.normalizedRow',
  'input.providerResult',
  'input.providerResult.raw',
  'input.providerResult.normalized',
  'input.data',
  'input.rows',
  'input.payload',
  'input.payload.rawRow',
  'input.payload.normalizedRow',
  'input.payload.output',
  'input.output',
  'input.result',
  'input.items',
] as const;

function safeObjectRows(value: unknown, limit = 8): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value
      .slice(0, limit)
      .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object' && !Array.isArray(row));
  }
  if (value != null && typeof value === 'object' && !Array.isArray(value)) return [value as Record<string, unknown>];
  return [];
}

function getPathValue(input: unknown, path: string): unknown {
  if (path === 'input') return input;
  const parts = path.replace(/^input\.?/, '').split('.').filter(Boolean);
  let current = input;
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isRawDiscoveryKey(key: string): boolean {
  return !INVESTOR_FLOW_WRAPPER_METADATA_KEYS.has(key) && !PRIVATE_OR_SECRET_FIELD_PATTERN.test(key);
}

function actualEntries(row: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(row).filter(([key, value]) => isRawDiscoveryKey(key) && (value == null || typeof value !== 'object'));
}

function rowActualKeyCount(row: Record<string, unknown>): number {
  return actualEntries(row).length;
}

function rowNumericSignalCount(row: Record<string, unknown>): number {
  return actualEntries(row).filter(([, value]) => {
    const kind = sampleValueKind(value);
    return kind === 'number' || kind === 'numericString';
  }).length;
}

function rowAliasSignalCount(row: Record<string, unknown>): number {
  const aliasGroups = [
    FOREIGN_NET_BUY_ALIASES,
    INSTITUTIONAL_NET_BUY_ALIASES,
    INDIVIDUAL_NET_BUY_ALIASES,
    NET_BUY_AMOUNT_ALIASES,
    NET_BUY_VOLUME_ALIASES,
    FOREIGN_BUY_ALIASES,
    FOREIGN_SELL_ALIASES,
    INSTITUTIONAL_BUY_ALIASES,
    INSTITUTIONAL_SELL_ALIASES,
    INDIVIDUAL_BUY_ALIASES,
    INDIVIDUAL_SELL_ALIASES,
    COMMON_BUY_AMOUNT_ALIASES,
    COMMON_SELL_AMOUNT_ALIASES,
  ];
  let count = 0;
  for (const aliases of aliasGroups) {
    if (firstNumberLikeField(row, aliases).rawMaterialized) count += 1;
  }
  return count;
}

function unwrapReasonForPath(path: string, rows: Array<Record<string, unknown>>, input: unknown): InvestorFlowUnwrapReason {
  if (path === 'input') return 'FOUND_DIRECT_ROW';
  if (path.includes('investorFlowSemanticRow') || path.includes('semanticRow')) return 'FOUND_NESTED_INVESTOR_FLOW_SEMANTIC_ROW';
  if (path.includes('rawRow') || path.endsWith('.raw')) return 'FOUND_NESTED_RAW_ROW';
  if (path.includes('normalizedRow') || path.endsWith('.normalized')) return 'FOUND_NESTED_NORMALIZED_ROW';
  if (path.includes('rows') || (Array.isArray(getPathValue(input, path)) && path !== 'input.data')) return 'FOUND_ROWS_ARRAY';
  if (path.includes('data')) return 'FOUND_DATA_ARRAY';
  return rows.length > 1 ? 'FOUND_ROWS_ARRAY' : 'FOUND_DIRECT_ROW';
}

export function unwrapInvestorFlowRows(input: unknown): InvestorFlowRowsUnwrapDiagnostic {
  const wrapperKeys = input != null && typeof input === 'object' && !Array.isArray(input)
    ? Object.keys(input as Record<string, unknown>).filter((key) => INVESTOR_FLOW_WRAPPER_METADATA_KEYS.has(key))
    : [];
  type Candidate = {
    path: string;
    rows: Array<Record<string, unknown>>;
    score: number;
    order: number;
    numericTotal: number;
    aliasTotal: number;
    wrapperOnly: boolean;
  };
  const candidates: Candidate[] = [];
  const rejectedWrapperPaths: string[] = [];
  const seen = new Set<unknown>();
  const pathsSeen = new Set<string>();
  const normalizePath = (path: string): string => path || 'input';
  const fieldNameSignalCount = (row: Record<string, unknown>): number => actualEntries(row)
    .filter(([key]) => /frgn|orgn|indv|foreign|institution|individual|net|buy|sell|ntby|shnu|seln/i.test(key))
    .length;
  const allActualValuesPlaceholder = (row: Record<string, unknown>): boolean => {
    const entries = actualEntries(row);
    return entries.length > 0 && entries.every(([, value]) => {
      const kind = sampleValueKind(value);
      return kind === 'placeholder' || kind === 'empty';
    });
  };
  const addCandidate = (path: string, value: unknown, order: number) => {
    if (value == null || seen.has(value)) return;
    seen.add(value);
    const rows = safeObjectRows(value);
    if (rows.length === 0) return;
    const normalizedPath = normalizePath(path);
    const actualKeyTotal = rows.reduce((sum, row) => sum + rowActualKeyCount(row), 0);
    const numericTotal = rows.reduce((sum, row) => sum + rowNumericSignalCount(row), 0);
    const aliasTotal = rows.reduce((sum, row) => sum + rowAliasSignalCount(row), 0);
    const fieldNameTotal = rows.reduce((sum, row) => sum + fieldNameSignalCount(row), 0);
    const investorTypeTotal = rows.filter((row) => INVESTOR_TYPE_KEYS.some((key) => classifyInvestorType(row[key]))).length;
    const buySellPairTotal = rows.filter((row) =>
      (firstNumberLikeField(row, [...FOREIGN_BUY_ALIASES, ...INSTITUTIONAL_BUY_ALIASES, ...INDIVIDUAL_BUY_ALIASES, ...COMMON_BUY_AMOUNT_ALIASES]).rawMaterialized)
      && (firstNumberLikeField(row, [...FOREIGN_SELL_ALIASES, ...INSTITUTIONAL_SELL_ALIASES, ...INDIVIDUAL_SELL_ALIASES, ...COMMON_SELL_AMOUNT_ALIASES]).rawMaterialized),
    ).length;
    const wrapperOnly = rows.every((row) => rowActualKeyCount(row) === 0);
    const placeholderPenalty = rows.filter(allActualValuesPlaceholder).length * 25;
    const metadataPenalty = wrapperOnly ? 500 : 0;
    const arrayBonus = Array.isArray(value) ? 4 : 0;
    const nestedBonus = normalizedPath === 'input' ? 0 : 6;
    const semanticWrapperPenalty = normalizedPath === 'input' && wrapperKeys.length > 0 ? 100 : 0;
    const score = aliasTotal * 100 + investorTypeTotal * 40 + buySellPairTotal * 35 + numericTotal * 20 + fieldNameTotal * 8 + actualKeyTotal + arrayBonus + nestedBonus - placeholderPenalty - metadataPenalty - semanticWrapperPenalty;
    pathsSeen.add(normalizedPath);
    if (wrapperOnly) {
      rejectedWrapperPaths.push(normalizedPath);
      return;
    }
    if (score <= 0) return;
    candidates.push({ path: normalizedPath, rows, score, order, numericTotal, aliasTotal, wrapperOnly });
  };

  INVESTOR_FLOW_NESTED_PATHS.forEach((path, index) => addCandidate(path, getPathValue(input, path), index));

  const queue: Array<{ value: unknown; path: string; depth: number }> = [{ value: input, path: 'input', depth: 0 }];
  const recursiveSeen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.value == null || typeof current.value !== 'object' || recursiveSeen.has(current.value) || current.depth > 5) continue;
    recursiveSeen.add(current.value);
    if (Array.isArray(current.value)) {
      addCandidate(current.path, current.value, 100 + current.depth);
      for (const [index, item] of current.value.slice(0, 5).entries()) {
        const itemPath = `${current.path}[${index}]`;
        addCandidate(itemPath, item, 110 + current.depth + index);
        queue.push({ value: item, path: itemPath, depth: current.depth + 1 });
      }
      continue;
    }
    const obj = current.value as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (PRIVATE_OR_SECRET_FIELD_PATTERN.test(key)) continue;
      const childPath = `${current.path}.${key}`;
      if (Array.isArray(value) || (value != null && typeof value === 'object')) {
        addCandidate(childPath, value, 100 + current.depth);
        queue.push({ value, path: childPath, depth: current.depth + 1 });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.order - b.order || a.path.localeCompare(b.path));
  const selected = candidates[0];
  const rows = selected?.rows ?? [];
  const rawFieldKeys: string[] = [];
  const numericStringFieldKeys: string[] = [];
  const placeholderFieldKeys: string[] = [];
  for (const row of rows) {
    for (const [key, value] of actualEntries(row)) {
      rawFieldKeys.push(key);
      const kind = sampleValueKind(value);
      if (kind === 'numericString') numericStringFieldKeys.push(key);
      else if (kind === 'placeholder' || kind === 'empty') placeholderFieldKeys.push(key);
    }
  }
  const hasWrapperOnly = rejectedWrapperPaths.length > 0 && rows.length === 0;
  return {
    rows,
    paths: Array.from(pathsSeen),
    wrapperKeys: topUnique(wrapperKeys),
    rawFieldKeys: topUnique(rawFieldKeys),
    numericStringFieldKeys: topUnique(numericStringFieldKeys),
    placeholderFieldKeys: topUnique(placeholderFieldKeys),
    selectedPath: selected?.path ?? null,
    reason: selected ? unwrapReasonForPath(selected.path, rows, input) : hasWrapperOnly ? 'ONLY_WRAPPER_METADATA' : 'NO_ROW_FOUND',
    rowCandidateCount: candidates.length,
    selectedRowScore: selected?.score,
    rejectedWrapperPathsTop: topUnique(rejectedWrapperPaths),
    wrapperOnlyCount: rejectedWrapperPaths.length,
    numericCandidateCount: candidates.filter((candidate) => candidate.numericTotal > 0).length,
    aliasCandidateCount: candidates.filter((candidate) => candidate.aliasTotal > 0).length,
  };
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
  'frgn_ntby_tr_pbmn_amt',
  'frgn_seln_qty',
  'frgn_shnu_qty',
  'frgn_ntby_qty_amt',
  'frgn_ntby_vol',
  'frgnPurScl',
  'netBuyAmount',
  'netBuyVolume',
  'foreigner',
] as const;
const FOREIGN_BUY_ALIASES = ['foreignBuy', 'foreignBuyAmount', 'foreignBuyVolume', 'frgnBuy', 'frgn_buy', 'frgn_shnu_qty'] as const;
const FOREIGN_SELL_ALIASES = ['foreignSell', 'foreignSellAmount', 'foreignSellVolume', 'frgnSell', 'frgn_sell', 'frgn_seln_qty'] as const;
const INSTITUTIONAL_NET_BUY_ALIASES = [
  'institutionalNetBuy',
  'institutionNetBuy',
  'instNetBuy',
  'orgNetBuy',
  'orgnNetBuy',
  'orgn_ntby',
  'orgn_ntby_qty',
  'orgn_ntby_tr_pbmn',
  'orgn_ntby_tr_pbmn_amt',
  'orgn_ntby_vol',
  '기관합계',
  '기관',
  'inst',
  'institution',
] as const;
const INSTITUTIONAL_BUY_ALIASES = ['institutionBuy', 'institutionBuyAmount', 'institutionBuyVolume', 'institutionalBuy', 'instBuy', 'orgnBuy', 'orgn_buy', 'orgn_shnu_qty'] as const;
const INSTITUTIONAL_SELL_ALIASES = ['institutionSell', 'institutionSellAmount', 'institutionSellVolume', 'institutionalSell', 'instSell', 'orgnSell', 'orgn_sell', 'orgn_seln_qty'] as const;
const INDIVIDUAL_NET_BUY_ALIASES = [
  'individualNetBuy',
  'retailNetBuy',
  'prsnNetBuy',
  'indvNetBuy',
  'indv_ntby',
  'indv_ntby_qty',
  'indv_ntby_tr_pbmn',
  '개인',
  'retail',
  'individual',
] as const;
const INDIVIDUAL_BUY_ALIASES = ['individualBuy', 'individualBuyAmount', 'individualBuyVolume', 'retailBuy', 'prsnBuy', 'indvBuy', 'indv_buy', 'indv_shnu_qty'] as const;
const INDIVIDUAL_SELL_ALIASES = ['individualSell', 'individualSellAmount', 'individualSellVolume', 'retailSell', 'prsnSell', 'indvSell', 'indv_sell', 'indv_seln_qty'] as const;
const PROGRAM_NET_BUY_ALIASES = ['programNetBuy'] as const;
const NET_BUY_AMOUNT_ALIASES = ['netBuyAmount', 'netAmount', 'netBuy', 'net_buy'] as const;
const NET_BUY_VOLUME_ALIASES = ['netBuyVolume', 'netVolume', 'netVol', 'ntby', 'ntby_qty', 'ntby_tr_pbmn'] as const;
const COMMON_BUY_AMOUNT_ALIASES = ['buyAmount', 'buyVolume', 'buyQty', 'buyQuantity', 'shnu_qty'] as const;
const COMMON_SELL_AMOUNT_ALIASES = ['sellAmount', 'sellVolume', 'sellQty', 'sellQuantity', 'seln_qty'] as const;
const ROW_ARRAY_KEYS = ['rows', 'data', 'items', 'investorFlows', 'investorFlow', 'flows', 'result', 'output'] as const;
const INVESTOR_TYPE_KEYS = ['investorType', 'invstType', 'invrDvsn', 'trdVolType', 'investorName', 'type', 'investor', 'invrDvsnName', 'invr_dvsn_name'] as const;

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


function numberLikePairDifference(
  obj: Record<string, unknown>,
  buyAliases: readonly string[],
  sellAliases: readonly string[],
): { value: number | null; sourceField?: string; rawMaterialized: boolean } {
  const buy = firstNumberLikeField(obj, buyAliases);
  const sell = firstNumberLikeField(obj, sellAliases);
  const rawMaterialized = buy.rawMaterialized || sell.rawMaterialized;
  if (buy.value === null || sell.value === null) return { value: null, rawMaterialized };
  return {
    value: buy.value - sell.value,
    sourceField: `${buy.sourceField ?? 'buy'}-${sell.sourceField ?? 'sell'}`,
    rawMaterialized: true,
  };
}

function sampleValueKind(value: unknown): InvestorFlowSampleValueKind | null {
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'placeholder';
  if (value == null) return 'placeholder';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return 'empty';
  if (trimmed === '-' || trimmed.toUpperCase() === 'N/A') return 'placeholder';
  return normalizeNumberLikeInvestorFlowValue(trimmed) !== null ? 'numericString' : null;
}

function collectRawRowsAndKeys(input: unknown): { keys: string[]; values: unknown[]; numberKeys: string[]; numericStringKeys: string[]; placeholderKeys: string[]; candidateNetBuyKeys: string[]; unwrap: InvestorFlowRowsUnwrapDiagnostic } {
  const unwrap = unwrapInvestorFlowRows(input);
  const keys: string[] = [];
  const values: unknown[] = [];
  const numberKeys: string[] = [];
  const numericStringKeys: string[] = [];
  const placeholderKeys: string[] = [];
  const candidateNetBuyKeys: string[] = [];
  const netBuyAliases = new Set<string>([
    ...FOREIGN_NET_BUY_ALIASES,
    ...INSTITUTIONAL_NET_BUY_ALIASES,
    ...INDIVIDUAL_NET_BUY_ALIASES,
    ...NET_BUY_AMOUNT_ALIASES,
    ...NET_BUY_VOLUME_ALIASES,
    ...FOREIGN_BUY_ALIASES,
    ...FOREIGN_SELL_ALIASES,
    ...INSTITUTIONAL_BUY_ALIASES,
    ...INSTITUTIONAL_SELL_ALIASES,
    ...INDIVIDUAL_BUY_ALIASES,
    ...INDIVIDUAL_SELL_ALIASES,
    ...COMMON_BUY_AMOUNT_ALIASES,
    ...COMMON_SELL_AMOUNT_ALIASES,
  ]);
  for (const row of unwrap.rows) {
    for (const [key, value] of actualEntries(row)) {
      keys.push(key);
      values.push(value);
      const kind = sampleValueKind(value);
      if (kind === 'number') numberKeys.push(key);
      if (kind === 'numericString') numericStringKeys.push(key);
      if (kind === 'placeholder' || kind === 'empty') placeholderKeys.push(key);
      if (netBuyAliases.has(key) || /ntby|netBuy|buy|sell|shnu|seln/i.test(key)) candidateNetBuyKeys.push(key);
    }
  }
  return { keys, values, numberKeys, numericStringKeys, placeholderKeys, candidateNetBuyKeys, unwrap };
}

function topUnique(values: readonly string[], limit = 16): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

function buildFieldKeyDiagnostics(
  input: unknown,
  fields: Pick<InvestorFlowSemanticFields, 'sourceFields' | 'foreignNetBuy' | 'institutionalNetBuy' | 'individualNetBuy' | 'programNetBuy' | 'netBuyAmount' | 'netBuyVolume'>,
): InvestorFlowFieldKeyDiscoveryDiagnostic {
  const raw = collectRawRowsAndKeys(input);
  const sampleValueKinds: Record<InvestorFlowSampleValueKind, number> = { number: 0, numericString: 0, empty: 0, placeholder: 0 };
  for (const value of raw.values) {
    const kind = sampleValueKind(value);
    if (kind) sampleValueKinds[kind] += 1;
  }
  const normalizedKeys = Object.entries(fields)
    .filter(([key, value]) => key !== 'sourceFields' && typeof value === 'number' && Number.isFinite(value))
    .map(([key]) => key);
  const source = fields.sourceFields ?? {};
  return {
    kisRawFieldKeysTop: topUnique(raw.keys),
    kisNormalizedFieldKeysTop: topUnique(normalizedKeys),
    sampleValueKinds,
    candidateMappedFields: {
      foreign: source.foreignNetBuy ? [source.foreignNetBuy.replace(/^row\./, '')] : [],
      institution: source.institutionalNetBuy ? [source.institutionalNetBuy.replace(/^row\./, '')] : [],
      individual: source.individualNetBuy ? [source.individualNetBuy.replace(/^row\./, '')] : [],
    },
    unwrapRows: raw.unwrap.rows.length,
    selectedPath: raw.unwrap.selectedPath,
    unwrapReason: raw.unwrap.reason,
    wrapperKeys: raw.unwrap.wrapperKeys,
    actualRawFieldKeysTop: topUnique(raw.keys),
    actualNumericStringFieldKeysTop: topUnique(raw.numericStringKeys),
    actualNumberFieldKeysTop: topUnique(raw.numberKeys),
    actualPlaceholderFieldKeysTop: topUnique(raw.placeholderKeys),
    candidateNetBuyFieldKeysTop: topUnique(raw.candidateNetBuyKeys),
    rowCandidateCount: raw.unwrap.rowCandidateCount,
    selectedRowScore: raw.unwrap.selectedRowScore,
    selectedActualRawFieldKeysTop: topUnique(raw.keys),
    selectedNumericStringFieldKeysTop: topUnique(raw.numericStringKeys),
    rejectedWrapperPathsTop: raw.unwrap.rejectedWrapperPathsTop,
    wrapperOnlyCount: raw.unwrap.wrapperOnlyCount,
    numericCandidateCount: raw.unwrap.numericCandidateCount,
    aliasCandidateCount: raw.unwrap.aliasCandidateCount,
  };
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
  return unwrapInvestorFlowRows(input).rows;
}

function extractRowFields(input: unknown): Partial<InvestorFlowSemanticFields> & InvestorFlowSemanticRowAudit {
  const rows = findRows(input);
  const audit = emptyRowAudit();
  audit.rowCount = rows.length;
  const mapped: Partial<InvestorFlowSemanticFields> = { sourceFields: {} };
  for (const row of rows) {
    const investorTypeRaw = INVESTOR_TYPE_KEYS.map((key) => row[key]).find((value) => typeof value === 'string' && value.trim());
    if (typeof investorTypeRaw === 'string' && investorTypeRaw.trim()) audit.investorTypesDetected.push(investorTypeRaw.trim());
    const investorType = classifyInvestorType(investorTypeRaw);
    if (!investorType) continue;
    const direct = firstNumberLikeField(row, [...NET_BUY_AMOUNT_ALIASES, ...NET_BUY_VOLUME_ALIASES, 'ntby', 'ntby_qty', 'ntby_tr_pbmn']);
    const typedPair = investorType === 'foreign'
      ? numberLikePairDifference(row, FOREIGN_BUY_ALIASES, FOREIGN_SELL_ALIASES)
      : investorType === 'institutional'
        ? numberLikePairDifference(row, INSTITUTIONAL_BUY_ALIASES, INSTITUTIONAL_SELL_ALIASES)
        : numberLikePairDifference(row, INDIVIDUAL_BUY_ALIASES, INDIVIDUAL_SELL_ALIASES);
    const commonPair = numberLikePairDifference(row, COMMON_BUY_AMOUNT_ALIASES, COMMON_SELL_AMOUNT_ALIASES);
    const pair = typedPair.value !== null ? typedPair : commonPair;
    const net = direct.value !== null ? direct : pair;
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
  const unwrap = unwrapInvestorFlowRows(input);
  const obj = unwrap.rows[0] ?? (Array.isArray(input) ? {} : typeof input === 'object' ? (input as Record<string, unknown>) : {});
  const row = extractRowFields(input);
  Object.assign(sourceFields, row.sourceFields ?? {});
  base.rowCount = row.rowCount;
  base.investorTypesDetected = row.investorTypesDetected;
  base.foreignRowFound = row.foreignRowFound;
  base.institutionalRowFound = row.institutionalRowFound;
  base.individualRowFound = row.individualRowFound;
  base.rowMappingConfidence = row.rowMappingConfidence;

  const mappings: Array<[keyof InvestorFlowSemanticFields, readonly string[], readonly string[] | undefined, readonly string[] | undefined]> = [
    ['foreignNetBuy', FOREIGN_NET_BUY_ALIASES, FOREIGN_BUY_ALIASES, FOREIGN_SELL_ALIASES],
    ['institutionalNetBuy', INSTITUTIONAL_NET_BUY_ALIASES, INSTITUTIONAL_BUY_ALIASES, INSTITUTIONAL_SELL_ALIASES],
    ['individualNetBuy', INDIVIDUAL_NET_BUY_ALIASES, INDIVIDUAL_BUY_ALIASES, INDIVIDUAL_SELL_ALIASES],
    ['programNetBuy', PROGRAM_NET_BUY_ALIASES, undefined, undefined],
    ['netBuyAmount', NET_BUY_AMOUNT_ALIASES, undefined, undefined],
    ['netBuyVolume', NET_BUY_VOLUME_ALIASES, undefined, undefined],
  ];
  for (const [target, aliases, buyAliases, sellAliases] of mappings) {
    const direct = firstNumberLikeField(obj, aliases);
    const pair = buyAliases && sellAliases ? numberLikePairDifference(obj, buyAliases, sellAliases) : { value: null, rawMaterialized: false };
    const picked = direct.value !== null ? direct : pair;
    if (direct.rawMaterialized || pair.rawMaterialized) base.materializedCount += 1;
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
  base.fieldKeyDiagnostics = buildFieldKeyDiagnostics(input, base);
  return base;
}


export function buildSanitizedInvestorFlowSemanticRow(input: {
  flow: unknown;
  symbol?: string | null;
  provider?: string;
  providerScope?: InvestorFlowProviderScope;
  materialized?: boolean;
}): SanitizedInvestorFlowSemanticRow {
  const fields = extractInvestorFlowSemanticFields(input.flow);
  const source = fields.sourceFields ?? {};
  return {
    symbol: input.symbol ?? null,
    provider: input.provider ?? 'UNKNOWN',
    providerScope: input.providerScope ?? 'UNKNOWN',
    materialized: input.materialized ?? fields.normalizedCount > 0,
    foreignNetBuy: fields.foreignNetBuy,
    institutionalNetBuy: fields.institutionalNetBuy,
    individualNetBuy: fields.individualNetBuy,
    netBuyAmount: fields.netBuyAmount,
    netBuyVolume: fields.netBuyVolume,
    sourceFields: {
      ...(source.foreignNetBuy ? { foreign: source.foreignNetBuy } : {}),
      ...(source.institutionalNetBuy ? { institutional: source.institutionalNetBuy } : {}),
      ...(source.individualNetBuy ? { individual: source.individualNetBuy } : {}),
      ...(source.netBuyAmount ? { netBuyAmount: source.netBuyAmount } : {}),
      ...(source.netBuyVolume ? { netBuyVolume: source.netBuyVolume } : {}),
    },
    rawFieldKeys: fields.fieldKeyDiagnostics?.kisRawFieldKeysTop ?? [],
    normalizedFieldKeys: fields.fieldKeyDiagnostics?.kisNormalizedFieldKeysTop ?? [],
    rowCount: fields.rowCount,
    investorTypesDetected: fields.investorTypesDetected,
  };
}

function isMetadataOnlySemanticRow(input: unknown): boolean {
  if (input == null || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  const metadataKeys = new Set(['symbol', 'requestSymbol', 'candidateSymbol', 'quoteSymbol', 'providerSymbol', 'normalizedSymbol', 'provider', 'selectedProvider', 'providerScope', 'routePurpose', 'materialized', 'usableForRouter', 'usableForGate', 'usableForLive', 'usableForShadow', 'semanticAvailable', 'status', 'signal', 'source', 'stale']);
  const keys = Object.keys(obj).filter((key) => obj[key] !== undefined);
  return keys.length > 0 && keys.every((key) => metadataKeys.has(key));
}
export function evaluateInvestorFlowSemanticAvailabilityV2(input: {
  flow: unknown;
  symbolMatched?: boolean | null;
  inferredSymbolMatched?: boolean;
  providerScope?: 'SYMBOL_LEVEL' | 'MARKET_LEVEL' | 'SECTOR_LEVEL' | 'UNKNOWN';
  stale?: boolean;
  providerIssue?: boolean;
  rawInvestorRowAvailable?: boolean;
  semanticRowExpected?: boolean;
  semanticRowDropped?: boolean;
  forensicInputDroppedSemanticRow?: boolean;
  actualInvestorRowCarried?: boolean;
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
  else if (input.forensicInputDroppedSemanticRow) reason = 'FORENSIC_INPUT_DROPPED_SEMANTIC_ROW';
  else if (input.actualInvestorRowCarried === false && !hasCoreField) reason = 'ACTUAL_INVESTOR_ROW_NOT_CARRIED';
  // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — row 는 carry 됐으나 (actualInvestorRowCarried
  // === true) carry 된 객체에 숫자 투자자 필드가 하나도 없는 경우 (dummy/wrapper). ACTUAL_
  // INVESTOR_ROW_NOT_CARRIED (carry 자체가 안 됨) 와 구분 — 단절 위치 정밀 진단.
  else if (input.actualInvestorRowCarried === true && !hasCoreField && !hasActualInvestorNumericRow(input.flow)) reason = 'NO_NUMERIC_INVESTOR_FIELD_FOUND';
  else if (input.semanticRowDropped) reason = 'ROUTER_DROPPED_SEMANTIC_ROW';
  else if (input.rawInvestorRowAvailable === false && !hasCoreField) reason = 'RAW_INVESTOR_ROW_MISSING';
  else if (isMetadataOnlySemanticRow(input.flow) && !hasCoreField) reason = 'SEMANTIC_ROW_METADATA_ONLY';
  else if (fields.placeholderOnly) reason = 'PLACEHOLDER_ONLY';
  else if (fields.fieldKeyDiagnostics?.unwrapReason === 'ONLY_WRAPPER_METADATA' && !hasCoreField) reason = 'ONLY_WRAPPER_OBJECT_SELECTED';
  else if (fields.fieldKeyDiagnostics?.unwrapReason === 'NO_ROW_FOUND' && !hasCoreField) reason = 'NO_ACTUAL_ROW_FOUND';
  else if ((fields.fieldKeyDiagnostics?.numericCandidateCount ?? 0) === 0 && (fields.fieldKeyDiagnostics?.rowCandidateCount ?? 0) > 0 && !hasCoreField) reason = 'DEEP_UNWRAP_NO_NUMERIC_FIELDS';
  else if ((fields.rowCount ?? 0) > 0 && fields.rowMappingConfidence === 'LOW' && (fields.investorTypesDetected?.length ?? 0) > 0 && !hasCoreField) reason = 'INVESTOR_TYPE_ROW_MAPPING_FAILED';
  else if ((fields.fieldKeyDiagnostics?.actualNumericStringFieldKeysTop?.length ?? 0) + (fields.fieldKeyDiagnostics?.actualNumberFieldKeysTop?.length ?? 0) > 0 && !hasCoreField) reason = 'NUMERIC_FIELDS_FOUND_BUT_ALIAS_UNKNOWN';
  else if ((fields.rowCount ?? 0) > 0 && fields.rowMappingConfidence === 'LOW' && !hasCoreField) reason = 'FIELD_ALIAS_NOT_MAPPED';
  else if (fields.materializedCount > 0 && !hasCoreField) reason = 'FIELD_ALIAS_NOT_MAPPED';
  else if (!hasCoreField) reason = input.semanticRowExpected ? 'ROUTER_DROPPED_SEMANTIC_ROW' : 'NO_FOREIGN_OR_INSTITUTION_FIELD';
  else if (input.stale) reason = 'STALE_ONLY';
  else if (fields.allMaterializedValuesZero) reason = 'ZERO_BUT_MATERIALIZED';
  else reason = 'AVAILABLE';

  const available = reason === 'AVAILABLE' || reason === 'ZERO_BUT_MATERIALIZED';
  const fieldDiagnostics = fields.fieldKeyDiagnostics;
  const actualNumericFieldCount = (fieldDiagnostics?.actualNumericStringFieldKeysTop?.length ?? 0) + (fieldDiagnostics?.actualNumberFieldKeysTop?.length ?? 0);
  const semanticRowBreakPoint = available
    ? 'FIELD_ALIAS_MAPPED'
    : fieldDiagnostics?.unwrapReason === 'ONLY_WRAPPER_METADATA'
      ? 'ONLY_WRAPPER_METADATA'
      : fieldDiagnostics?.unwrapReason === 'NO_ROW_FOUND'
        ? 'NO_ROW_FOUND'
        : (fields.rowCount ?? 0) > 0 && (fields.investorTypesDetected?.length ?? 0) > 0 && fields.rowMappingConfidence === 'LOW'
          ? 'ROW_ARRAY_FOUND_BUT_INVESTOR_TYPE_NOT_MAPPED'
          : actualNumericFieldCount > 0
            ? 'NUMERIC_FIELDS_FOUND_BUT_NOT_RECOGNIZED'
            : (fieldDiagnostics?.unwrapRows ?? 0) > 0
              ? 'NESTED_ROW_UNWRAPPED_BUT_ALIAS_NOT_MAPPED'
              : 'NO_ROW_FOUND';
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
    wouldBeSemanticAvailableIfFieldMapped: !hasCoreField && symbolOk && providerScope === 'SYMBOL_LEVEL',
    wouldBeZeroNeutralIfAllZero: fields.allMaterializedValuesZero === true,
    semanticRowBreakPoint,
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
