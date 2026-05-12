// @responsibility krxClient 도메인 타입 SSOT — 8 외부 노출 + 내부 공용 schema
/**
 * krxClient/types.ts — ADR-0502c (krxClient 분해) 도메인 타입 SSOT.
 *
 * 외부 의존성 0 (logger 도 import 안 함). 다른 krxClient 하위 모듈이 import 가능.
 *
 * 외부 노출 (barrel 경유 8개):
 *   - KrxInvestorRow
 *   - KrxInvestorParserStatus
 *   - KrxInvestorTradingDiagnostic
 *   - KrxPerPbrRow
 *   - KrxShortBalanceRow
 *   - KrxInvestorDetailRow
 *   - KrxMarketCapRow
 *   - FetchInvestorTradingOptions
 *
 * 내부 공용 (parser/http/csv 가 import):
 *   - KrxRawResponse
 *   - KrxPostMeta
 *   - KrxInvestorEndpointVariant
 *   - ParsedKrxCsv
 *   - ExtractRowsResult
 *   - NormalizedInvestorRowsResult
 */

export interface KrxInvestorRow {
  code: string;          // 6자리 종목코드
  name: string;          // 한글 종목명
  foreignNetBuy: number; // 외국인 순매수 수량(주)
  institutionNetBuy: number; // 기관 순매수 수량(주)
  individualNetBuy: number;  // 개인 순매수 수량(주)
}

export type KrxInvestorParserStatus =
  | 'OK'
  | 'DISABLED_BY_KIS_FIRST_MODE'
  | 'DISABLED_BY_KIS_ONLY_MODE'
  | 'PROVIDER_EMPTY_RESPONSE'
  | 'PARSER_KEY_MISMATCH'
  | 'PARSER_FIELD_MISMATCH'
  | 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE';

export interface KrxInvestorTradingDiagnostic {
  status?: 'DISABLED_BY_KIS_FIRST_MODE' | 'DISABLED_BY_KIS_ONLY_MODE';
  confidence?: 'MISSING';
  provider?: 'KRX';
  providerIssue?: boolean;
  marketSignal?: boolean;
  executionImpact?: 'NONE';
  reason?: string;
  endpoint: string;
  bld: string;
  tradeDate: string;
  selectedKrxFlowMode?: 'OTP_CSV' | 'DIRECT_JSON' | 'CACHE_FALLBACK';
  payloadMode?: 'MINIMAL_STRICT' | 'EXTENDED_VARIANT';
  routePurpose?: 'MARKET_LEVEL' | 'SYMBOL_LEVEL';
  selectedBld?: string;
  requiredParamMissing?: string | null;
  shortCodeToIsuCdResolved?: boolean;
  isuCd?: string | null;
  inqTpCd?: string | null;
  inqVal?: string | null;
  detailView?: string | null;
  endpointVariant?: string;
  routeKind?: 'MARKET_INVESTOR_FLOW' | 'SYMBOL_INVESTOR_FLOW';
  dateParam?: 'trdDd' | 'strtDd/endDd' | 'basDd' | 'searchDate';
  marketCode?: string | null;
  symbolCode?: string | null;
  symbolRequired?: boolean;
  otpRequired?: boolean;
  otpGenerated?: boolean;
  otpLength?: number;
  csvDownloaded?: boolean;
  csvRowCount?: number;
  csvColumnKeys?: string[];
  csvFailureReason?: string | null;
  csvHeaderDetected?: boolean;
  csvNoDataReason?: string | null;
  omittedKeys?: string[];
  forbiddenKeysPresent?: string[];
  requiredKeysPresent?: string[];
  requiredKeysMissing?: string[];
  sentPayloadKeys?: string[];
  parameterKeys?: string[];
  attemptedVariants?: string[];
  selectedVariant?: string | null;
  contentType: 'json' | 'html' | 'csv' | 'text' | 'empty' | 'unknown';
  httpStatus: number | null;
  responseKind: 'JSON' | 'HTML' | 'CSV' | 'TEXT' | 'EMPTY' | 'DISABLED' | 'GATED' | 'COOLDOWN' | 'HTTP_ERROR' | 'NETWORK_ERROR';
  consecutiveFailures?: number;
  cooldownActive?: boolean;
  cooldownRemainingMs?: number;
  offHoursSuppressed?: boolean;
  diagnosticOnly?: boolean;
  useForRouter?: boolean;
  useForGate?: boolean;
  useForLive?: boolean;
  useForShadow?: boolean;
  rawTopLevelKeys: string[];
  detectedCandidatePaths: string[];
  selectedRowPath: string | null;
  selectedRowCount: number;
  firstRowKeys: string[];
  normalizedRows: number;
  parserStatus: KrxInvestorParserStatus;
  fieldMappings: Record<'symbol' | 'date' | 'investorType' | 'foreignNetBuy' | 'institutionNetBuy' | 'individualNetBuy' | 'netBuyAmount' | 'netBuyVolume', string | null>;
  endpointIssueHint: 'NONE' | 'ENDPOINT_PARAMETER_ERROR' | 'MARKET_CODE_ERROR' | 'SYMBOL_CODE_FORMAT_ERROR' | 'OTP_OR_HEADER_ERROR' | 'SCHEMA_KEY_CHANGED' | 'FIELD_ALIAS_CHANGED' | 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE';
  summary: string;
}

export interface KrxPerPbrRow {
  code: string;
  name: string;
  per: number;           // 주가수익비율 (음수·NaN 시 0)
  pbr: number;           // 주가순자산비율
  dividendYield: number; // 배당수익률(%)
  eps: number;           // 주당순이익
  bps: number;           // 주당순자산
  close: number;         // 종가
}

export interface KrxShortBalanceRow {
  code: string;
  name: string;
  shortBalance: number;  // 공매도 잔고 수량
  shortBalanceValue: number; // 공매도 잔고 금액
  shortRatio: number;    // 상장주식수 대비 공매도 잔고 비율(%)
}

/**
 * ADR-0141 Stage 1: 11 카테고리 raw — 시장 단위 일자별.
 */
export interface KrxInvestorDetailRow {
  /** 카테고리 한글명 raw 보존 (예: "금융투자", "외국인") */
  category: string;
  /** 순매수 수량 (주, 양수=순매수) */
  netBuyQty: number;
  /** 순매수 거래대금 (원) */
  netBuyKrw: number;
}

export interface FetchInvestorTradingOptions {
  symbol?: string | null;
  isuCd?: string | null;
  /** Allows explicit manual diagnostics or after-close validation jobs to bypass KIS-first KRX auto-fetch suppression. */
  allowDisabledAutoFetch?: boolean;
}

/**
 * 시가총액 스냅샷 — 원 단위 정수 (억/조 혼동 차단).
 */
export interface KrxMarketCapRow {
  code: string;
  name: string;
  marketCap: number;    // 원 단위 (KRX MKTCAP 원본)
  listedShares: number; // 주 단위
  market: string;       // 'KOSPI' | 'KOSDAQ' | …
}

// ── 내부 공용 ────────────────────────────────────────────────────────────────

export interface KrxRawResponse {
  /** KRX 리포트별 row 키는 가변 (OutBlock_1, output 등). 전부 맵으로 시도. */
  [key: string]: unknown;
}

export interface KrxPostMeta {
  contentType: KrxInvestorTradingDiagnostic['contentType'];
  httpStatus: number | null;
  responseKind: KrxInvestorTradingDiagnostic['responseKind'];
  selectedKrxFlowMode?: NonNullable<KrxInvestorTradingDiagnostic['selectedKrxFlowMode']>;
  payloadMode?: NonNullable<KrxInvestorTradingDiagnostic['payloadMode']>;
  otpGenerated?: boolean;
  otpLength?: number;
  csvDownloaded?: boolean;
  csvRowCount?: number;
  csvColumnKeys?: string[];
  csvFailureReason?: string | null;
  csvHeaderDetected?: boolean;
  csvNoDataReason?: string | null;
  omittedKeys?: string[];
  forbiddenKeysPresent?: string[];
  requiredKeysPresent?: string[];
  requiredKeysMissing?: string[];
  sentPayloadKeys?: string[];
  consecutiveFailures?: number;
  cooldownActive?: boolean;
  cooldownRemainingMs?: number;
  offHoursSuppressed?: boolean;
  diagnosticOnly?: boolean;
  useForRouter?: boolean;
  useForGate?: boolean;
  useForLive?: boolean;
  useForShadow?: boolean;
}

export interface KrxInvestorEndpointVariant {
  id: string;
  mode: 'OTP_CSV' | 'DIRECT_JSON';
  payloadMode: NonNullable<KrxInvestorTradingDiagnostic['payloadMode']>;
  endpoint: string;
  bld: string;
  routeKind: 'MARKET_INVESTOR_FLOW' | 'SYMBOL_INVESTOR_FLOW';
  routePurpose: 'MARKET_LEVEL' | 'SYMBOL_LEVEL';
  dateParam: NonNullable<KrxInvestorTradingDiagnostic['dateParam']>;
  marketCode: 'STK' | 'KSQ' | 'ALL';
  symbolCode: string | null;
  isuCd: string | null;
  shortCodeToIsuCdResolved: boolean;
  requiredParamMissing: string | null;
  symbolRequired: boolean;
  otpRequired: boolean;
  trdVolVal?: '1' | '2';
  inqTpCd?: string | null;
  inqVal?: string | null;
  detailView?: string | null;
  params: Record<string, string>;
}

export interface ParsedKrxCsv {
  rows: Record<string, unknown>[];
  headers: string[];
  headerDetected: boolean;
  noDataReason: string | null;
}

export interface ExtractRowsResult {
  rows: Record<string, unknown>[];
  detectedCandidatePaths: string[];
  selectedRowPath: string | null;
  firstRowKeys: string[];
}

export interface NormalizedInvestorRowsResult {
  rows: KrxInvestorRow[];
  fieldMappings: KrxInvestorTradingDiagnostic['fieldMappings'];
}

export interface KrxIsuCdResolution {
  isuCd: string | null;
  shortCodeToIsuCdResolved: boolean;
  source: 'FETCH_OPTION' | 'STOCK_MASTER' | 'NONE';
}
