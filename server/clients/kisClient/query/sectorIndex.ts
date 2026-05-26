/**
 * @responsibility KIS 국내업종 지수 조회 — daily·current·probe (default-OFF, diagnostic-only).
 *
 * ADR-0537 — kisClient/query.ts 분해 시 섹터 지수 도메인 격리.
 * 모든 fetch 는 overrides.ts (VTS mock) 우선 + http.ts realDataKisGet 경유 (절대 규칙 #2).
 * executionImpact=NONE — 자동매매 본체 무관, SectorEnergy dry-run 진단 전용.
 */

import { HAS_REAL_DATA_CLIENT, KIS_BASE, KIS_IS_REAL, REAL_DATA_BASE } from '../constants.js';
import {
  getKisTokenRemainingHours,
  getRealDataTokenRemainingHours,
  refreshKisToken,
  refreshRealDataToken,
} from '../auth.js';
import { realDataKisGet } from '../http.js';
import { getKisOverrides } from '../overrides.js';
import {
  pickKisRowsByBucket,
  pickKisRows,
  extractKisNumber,
  extractKisNumberOptional,
} from './helpers.js';
import type { KisApiPriority } from '../../kisRateLimiter.js';
import type { SectorKey } from '../../sectorEnergyMaster.js';
import type {
  KisIndexQuoteBaseUrlKind,
  KisIndexQuoteClientStatus,
  KisSectorIndexCurrentPrice,
  KisSectorIndexCurrentPriceProbeAttempt,
  KisSectorIndexCurrentPriceProbeResult,
  KisSectorIndexValueQualityStatus,
  KisSectorIndexVerifyMode,
  KisSectorIndexVerifyTransportStage,
  KisSectorIndexVerifyVariantPolicy,
  KisSectorIndexDaily,
  KisSectorIndexDailyRow,
} from '../types.js';

export type KisSectorIscdMapRow = {
  sectorKey: SectorKey;
  iscd: string;
  label: string;
  verified: boolean;
  source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' | 'IDXCODE_MST_VERIFIED' | 'KIS_ISCD_PROBE_VERIFIED_20260514';
};

/**
 * KIS 12-sector 업종 상세코드 dry-run SSOT.
 *
 * 운영 주의:
 * - 아래 4자리 코드는 idxcode.mst 대조 전 best-effort 후보이며 live fallback 에 사용 금지.
 * - 모든 row 는 verified=false 로 고정한다. idxcode.mst 검증 후 별도 PR 에서만 true 승격.
 * - KRX 공식 SectorEnergy 원천을 대체하지 않고 diagnostic-only dry-run 에서만 순회한다.
 */
export const KIS_SECTOR_ISCD_MAP: ReadonlyArray<KisSectorIscdMapRow> = Object.freeze([
  { sectorKey: 'SEMICONDUCTOR', iscd: '2004', label: '반도체', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
  { sectorKey: 'BATTERY', iscd: '2012', label: '이차전지', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
  { sectorKey: 'BIO_HEALTHCARE', iscd: '2009', label: '바이오/헬스케어', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
  { sectorKey: 'FINANCE', iscd: '0021', label: '금융', verified: true, source: 'KIS_ISCD_PROBE_VERIFIED_20260514' },
  { sectorKey: 'SHIPBUILDING', iscd: '2010', label: '조선', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
  { sectorKey: 'STEEL', iscd: '2007', label: '철강', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
  { sectorKey: 'CHEMICAL', iscd: '2008', label: '에너지/화학', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
  { sectorKey: 'CONSTRUCTION', iscd: '2011', label: '건설/부동산', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
  { sectorKey: 'CONSUMER_RETAIL', iscd: '2003', label: '유통/소비재', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
  { sectorKey: 'IT_INTERNET', iscd: '0029', label: '인터넷/플랫폼', verified: true, source: 'KIS_ISCD_PROBE_VERIFIED_20260514' },
  { sectorKey: 'AUTOMOTIVE', iscd: '2002', label: '자동차', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
  { sectorKey: 'OTHER', iscd: '2001', label: '기타(KOSPI200 proxy)', verified: false, source: 'KIS_OFFICIAL_DOC_BEST_EFFORT' },
]);

/** KIS 업종 상세코드 SSOT (idxcode.mst 마스터의 well-known 집계 코드). */
export const KIS_SECTOR_INDEX_ISCD = Object.freeze({
  /** 코스피 종합 */
  KOSPI: '0001',
  /** 코스닥 종합 */
  KOSDAQ: '1001',
  /** 코스피200 */
  KOSPI200: '2001',
} as const);

const SECTOR_INDEX_DAILY_TR_ID =
  process.env.KIS_SECTOR_INDEX_DAILY_TR_ID ?? 'FHKUP03500100';
const SECTOR_INDEX_DAILY_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice';
const SECTOR_INDEX_CURRENT_TR_ID =
  process.env.KIS_SECTOR_INDEX_CURRENT_TR_ID ?? 'FHPUP02100000';
const SECTOR_INDEX_CURRENT_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-index-price';

/**
 * KIS 국내업종 지수 시세 ENV gate — ADR-0157 정확 비교 의무. default OFF.
 * 활성 전까지 `fetchKisSectorIndexDaily` 는 호출 0건 (null 반환).
 */
export function isKisSectorIndexDailyDisabled(): boolean {
  return process.env.KIS_SECTOR_INDEX_DAILY_ENABLED !== 'true';
}

export function isKisSectorIndexCurrentDisabled(): boolean {
  return process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED !== 'true';
}

function normalizeFeatureFlag(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function getKisSectorIndexVerifyMode(): KisSectorIndexVerifyMode {
  const raw = normalizeFeatureFlag(process.env.KIS_SECTOR_INDEX_VERIFY_MODE);
  if (raw === 'off' || raw === 'disabled' || raw === 'false' || raw === '0') return 'OFF';
  return 'OBSERVE';
}

function isKisSectorIndexVerifyClientDisabled(): boolean {
  const currentFlag = normalizeFeatureFlag(process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED);
  if (currentFlag === 'false' || currentFlag === '0' || currentFlag === 'off' || currentFlag === 'disabled') {
    return true;
  }
  return getKisSectorIndexVerifyMode() === 'OFF';
}

function kisSectorIndexVerifyDisabledReason(): string {
  const currentFlag = normalizeFeatureFlag(process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED);
  if (currentFlag === 'false' || currentFlag === '0' || currentFlag === 'off' || currentFlag === 'disabled') {
    return 'KIS_SECTOR_INDEX_CURRENT_ENABLED_FALSE';
  }
  return 'KIS_SECTOR_INDEX_VERIFY_MODE_OFF';
}

const SECTOR_INDEX_VALUE_FIELD_CANDIDATES = [
  'bstp_nmix_prpr',
  'stck_prpr',
  'prpr',
  'close',
];

const SECTOR_INDEX_VERIFY_TIMEOUT_MS = Number(process.env.KIS_SECTOR_INDEX_VERIFY_TIMEOUT_MS ?? 7000);

function sectorIndexVerifyTimeoutMs(): number {
  return Number.isFinite(SECTOR_INDEX_VERIFY_TIMEOUT_MS) && SECTOR_INDEX_VERIFY_TIMEOUT_MS > 0
    ? SECTOR_INDEX_VERIFY_TIMEOUT_MS
    : 7000;
}

function sanitizeTransportExceptionMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <masked>')
    .replace(/(appkey|appsecret|authorization|token)=([^&\s]+)/gi, '$1=<masked>')
    .replace(/(KIS_(?:REAL_DATA_)?APP_(?:KEY|SECRET)=)[^\s]+/gi, '$1<masked>')
    .slice(0, 240);
}

function exceptionClass(value: unknown): string {
  if (value && typeof value === 'object' && 'name' in value && typeof (value as { name?: unknown }).name === 'string') {
    return (value as { name: string }).name;
  }
  return value instanceof Error ? value.constructor.name : typeof value;
}

function isTimeoutException(value: unknown): boolean {
  const name = exceptionClass(value);
  const message = sanitizeTransportExceptionMessage(value);
  return name === 'AbortError' || /timeout|timed out|aborted/i.test(message);
}

function sectorIndexBaseUrlKind(): KisIndexQuoteBaseUrlKind {
  if (HAS_REAL_DATA_CLIENT) return 'REAL';
  return KIS_IS_REAL ? 'REAL' : 'VIRTUAL';
}

function sectorIndexBaseUrl(): string {
  return HAS_REAL_DATA_CLIENT ? REAL_DATA_BASE : KIS_BASE;
}

function sectorIndexTokenExpiresInSec(): number | null {
  const hours = HAS_REAL_DATA_CLIENT ? getRealDataTokenRemainingHours() : getKisTokenRemainingHours();
  return Number.isFinite(hours) && hours > 0 ? hours * 3600 : null;
}

function buildKisIndexQuoteClientStatus(input: {
  enabled: boolean;
  authReady: boolean;
  tokenPresent?: boolean;
  canCall: boolean;
  disabledReason?: string;
  lastExceptionClass?: string;
  lastExceptionMessageSanitized?: string;
}): KisIndexQuoteClientStatus {
  return {
    enabled: input.enabled,
    verifyMode: getKisSectorIndexVerifyMode(),
    livePromotionFromVerify: false,
    authReady: input.authReady,
    tokenPresent: input.tokenPresent === true,
    tokenExpiresInSec: input.tokenPresent === true ? sectorIndexTokenExpiresInSec() : null,
    tokenProvider: 'KIS_SHARED_TOKEN_PROVIDER',
    baseUrlKind: sectorIndexBaseUrlKind(),
    apiPath: SECTOR_INDEX_CURRENT_PATH,
    method: 'GET',
    trId: SECTOR_INDEX_CURRENT_TR_ID,
    canCall: input.canCall,
    ...(input.disabledReason ? { disabledReason: input.disabledReason } : {}),
    ...(input.lastExceptionClass ? { lastExceptionClass: input.lastExceptionClass } : {}),
    ...(input.lastExceptionMessageSanitized ? { lastExceptionMessageSanitized: input.lastExceptionMessageSanitized } : {}),
    executionImpact: 'NONE',
  };
}

function sectorIndexVerifyVariantPolicy(inputCandidates: readonly string[]): {
  candidates: string[];
  policy: KisSectorIndexVerifyVariantPolicy;
} {
  const unique = Array.from(new Set(inputCandidates.map((item) => String(item ?? '').trim()).filter(Boolean)));
  const debugOnlyRaw = unique.filter((candidate) => !/^\d{4}$/.test(candidate));
  const colonHyphenSent = process.env.KIS_SECTOR_INDEX_VERIFY_SEND_DEBUG_VARIANTS === 'true';
  const candidates = colonHyphenSent ? unique : unique.filter((candidate) => !debugOnlyRaw.includes(candidate));
  const debugOnlyKinds = Array.from(new Set(debugOnlyRaw.map((candidate) => {
    if (/^\d{5}$/.test(candidate)) return 'idxDivCompact';
    if (candidate.includes(':')) return 'colon';
    if (candidate.includes('-')) return 'hyphen';
    return 'nonFourDigit';
  })));
  return {
    candidates,
    policy: {
      enabled: true,
      triedVariants: candidates.map((candidate, index) => {
        if (/^\d{4}$/.test(candidate) && index === 0) return 'idxCode';
        if (/^\d{5}$/.test(candidate)) return 'idxDivCompact';
        return `candidate:${candidate}`;
      }),
      debugOnlyVariants: debugOnlyKinds,
      colonHyphenSent,
    },
  };
}

function emptyProbeAttempt(input: {
  fidInputIscd: string;
  reasonCode: string;
  transportStage: KisSectorIndexVerifyTransportStage;
  requestBuilt?: boolean;
  requestSent?: boolean;
  exceptionClass?: string | null;
  exceptionMessageSanitized?: string | null;
  timeoutMs?: number | null;
}): KisSectorIndexCurrentPriceProbeAttempt {
  return {
    fidCondMrktDivCode: 'U',
    fidInputIscd: input.fidInputIscd,
    apiPath: SECTOR_INDEX_CURRENT_PATH,
    method: 'GET',
    trId: SECTOR_INDEX_CURRENT_TR_ID,
    baseUrlKind: sectorIndexBaseUrlKind(),
    requestBuilt: input.requestBuilt ?? false,
    requestSent: input.requestSent ?? false,
    httpStatus: null,
    rtCd: null,
    msgCd: null,
    msg1: null,
    outputShape: null,
    indexValueFieldName: null,
    outputPresent: false,
    indexValueFieldPresent: false,
    rawTopLevelKeys: [],
    outputKeys: [],
    currentIndex: null,
    apiTransportSuccess: false,
    indexValueUsable: false,
    valueQualityStatus: input.transportStage === 'NOT_ATTEMPTED' ? 'NOT_ATTEMPTED' : 'API_TRANSPORT_FAILED',
    exceptionClass: input.exceptionClass ?? null,
    exceptionMessageSanitized: input.exceptionMessageSanitized ?? null,
    timeoutMs: input.timeoutMs ?? sectorIndexVerifyTimeoutMs(),
    retryCount: 0,
    transportStage: input.transportStage,
    verified: false,
    reasonCode: input.reasonCode,
  };
}

/** KST 기준 YYYYMMDD (날짜 helper 의존성 0 — 인라인 계산). */
function kstYyyymmdd(offsetDays = 0): string {
  const ms = Date.now() + 9 * 60 * 60 * 1000 - offsetDays * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * KIS 국내업종 기간별 지수 시세 조회 (inquire-daily-indexchartprice / FHKUP03500100).
 *
 * - ENV `KIS_SECTOR_INDEX_DAILY_ENABLED !== 'true'` → null (default OFF).
 * - VTS override (`fetchKisSectorIndexDaily`) 우선.
 * - KIS_APP_KEY 미설정 + 실계좌 클라이언트 부재 → null.
 * - realDataKisGet SSOT 경유 — 회로차단/블랙리스트/jitter 자동 적용 (절대 규칙 #2).
 * - output 필드 다중 키 매칭 — KIS 공식 응답 한글 약어 (bstp_nmix_*).
 * - fromDate/toDate 미지정 시 KST 기준 (today-30d ~ today) 기본 윈도우.
 *
 * @param sectorIscd 업종 상세코드 (KIS_SECTOR_INDEX_ISCD 또는 idxcode.mst 코드)
 */
export async function fetchKisSectorIndexDaily(
  sectorIscd: string,
  fromDate?: string,
  toDate?: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisSectorIndexDaily | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisSectorIndexDaily) return overrides.fetchKisSectorIndexDaily(sectorIscd);
  if (isKisSectorIndexDailyDisabled()) return null;
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const iscd = (sectorIscd ?? '').trim();
  if (!iscd) return null;
  const date1 = /^\d{8}$/.test(fromDate ?? '') ? (fromDate as string) : kstYyyymmdd(30);
  const date2 = /^\d{8}$/.test(toDate ?? '') ? (toDate as string) : kstYyyymmdd(0);
  try {
    const data = await realDataKisGet(
      SECTOR_INDEX_DAILY_TR_ID,
      SECTOR_INDEX_DAILY_PATH,
      {
        FID_COND_MRKT_DIV_CODE: 'U',
        FID_INPUT_ISCD: iscd,
        FID_INPUT_DATE_1: date1,
        FID_INPUT_DATE_2: date2,
        FID_PERIOD_DIV_CODE: 'D',
      },
      priority,
    );
    const buckets = pickKisRowsByBucket(data);
    const snapshot = buckets.output1[0] ?? buckets.output[0];
    const seriesRows: KisSectorIndexDailyRow[] = (
      buckets.output2.length > 0 ? buckets.output2 : buckets.output
    )
      .map((row): KisSectorIndexDailyRow | null => {
        const baseDate = String(row.stck_bsop_date ?? '').trim();
        if (!/^\d{8}$/.test(baseDate)) return null;
        return {
          baseDate,
          close: extractKisNumber(row, ['bstp_nmix_prpr']),
          open: extractKisNumber(row, ['bstp_nmix_oprc']),
          high: extractKisNumber(row, ['bstp_nmix_hgpr']),
          low: extractKisNumber(row, ['bstp_nmix_lwpr']),
          volume: extractKisNumber(row, ['acml_vol']),
          value: extractKisNumber(row, ['acml_tr_pbmn']),
        };
      })
      .filter((r): r is KisSectorIndexDailyRow => r !== null);

    return {
      sectorIscd: iscd,
      sectorName: snapshot ? String(snapshot.hts_kor_isnm ?? '').trim() : '',
      currentIndex: snapshot
        ? extractKisNumberOptional(snapshot, ['bstp_nmix_prpr']) ?? null
        : null,
      changePct: snapshot
        ? extractKisNumberOptional(snapshot, ['bstp_nmix_prdy_ctrt']) ?? null
        : null,
      series: seriesRows,
      fetchedAt: new Date().toISOString(),
      source: 'KIS_API',
    };
  } catch (e) {
    console.error('[KIS] 국내업종 기간별 지수 시세 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisSectorIndexCurrentPrice(
  sectorIscd: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisSectorIndexCurrentPrice | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisSectorIndexCurrentPrice) {
    return overrides.fetchKisSectorIndexCurrentPrice(sectorIscd);
  }
  if (isKisSectorIndexCurrentDisabled()) return null;
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const iscd = (sectorIscd ?? '').trim();
  if (!/^\d{4}$/.test(iscd)) return null;
  try {
    const data = await realDataKisGet(
      SECTOR_INDEX_CURRENT_TR_ID,
      SECTOR_INDEX_CURRENT_PATH,
      {
        FID_COND_MRKT_DIV_CODE: 'U',
        FID_INPUT_ISCD: iscd,
      },
      priority,
    );
    const buckets = pickKisRowsByBucket(data);
    const row = buckets.output[0] ?? buckets.output1[0] ?? buckets.output2[0];
    if (!row) return null;
    return {
      sectorIscd: iscd,
      sectorName: String(row.hts_kor_isnm ?? row.idx_name ?? row.bstp_kor_isnm ?? '').trim(),
      currentIndex: extractKisNumberOptional(row, ['bstp_nmix_prpr', 'bstp_nmix_prdy_vrss', 'prpr']) ?? null,
      changePct: extractKisNumberOptional(row, ['bstp_nmix_prdy_ctrt', 'prdy_ctrt']) ?? null,
      fetchedAt: new Date().toISOString(),
      source: 'KIS_API',
      rawFieldKeys: Object.keys(row),
    };
  } catch (e) {
    console.error('[KIS] sector index current price fetch failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

function classifyKisSectorIndexFailure(input: {
  httpStatus?: number | null;
  rtCd?: string | null;
  msgCd?: string | null;
  msg1?: string | null;
  outputPresent: boolean;
  indexValueFieldPresent: boolean;
  currentIndex?: number | null;
  hasRawResponse: boolean;
}): string {
  if (input.httpStatus === 401 || input.httpStatus === 403) return 'KIS_INDEX_API_AUTH_ERROR';
  if (input.httpStatus === 429) return 'KIS_INDEX_API_RATE_LIMIT';
  if (input.httpStatus != null && (input.httpStatus < 200 || input.httpStatus >= 300)) return 'KIS_INDEX_API_HTTP_ERROR';
  if (!input.hasRawResponse) return 'KIS_INDEX_API_HTTP_ERROR';
  const text = `${input.rtCd ?? ''} ${input.msgCd ?? ''} ${input.msg1 ?? ''}`;
  if (/auth|token|oauth|unauthor|egw|인증|권한/i.test(text)) return 'KIS_INDEX_API_AUTH_ERROR';
  if (/rate|limit|too many|초과|제한/i.test(text)) return 'KIS_INDEX_API_RATE_LIMIT';
  const successEquivalent = !input.rtCd || input.rtCd === '0';
  if (!successEquivalent) return 'KIS_INDEX_API_REJECTED_CODE';
  if (!input.outputPresent) return 'KIS_INDEX_API_OUTPUT_EMPTY';
  if (!input.indexValueFieldPresent) return 'KIS_INDEX_API_SCHEMA_MISMATCH';
  if (input.currentIndex == null || !Number.isFinite(input.currentIndex)) return 'KIS_INDEX_API_INDEX_VALUE_INVALID';
  if (input.currentIndex === 0) return 'VALUE_QUALITY_ZERO';
  return 'KIS_INDEX_API_VERIFY_CONDITION_NOT_MET';
}

function outputShape(data: unknown): string {
  const root = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  if (!root) return 'NONE';
  return ['output', 'output1', 'output2']
    .filter((key) => key in root)
    .map((key) => {
      const value = root[key];
      if (Array.isArray(value)) return `${key}:array(${value.length})`;
      if (value && typeof value === 'object') return `${key}:object`;
      return `${key}:${typeof value}`;
    })
    .join('|') || 'NO_OUTPUT_BUCKETS';
}

function detectKisSectorIndexValue(row: Record<string, string> | undefined): {
  currentIndex: number | null;
  fieldName: string | null;
} {
  if (!row) return { currentIndex: null, fieldName: null };
  for (const fieldName of SECTOR_INDEX_VALUE_FIELD_CANDIDATES) {
    const value = extractKisNumberOptional(row, [fieldName]);
    if (value !== undefined) return { currentIndex: value, fieldName };
  }
  return { currentIndex: null, fieldName: null };
}

function materializeKisSectorIndexProbeAttempt(input: {
  data: unknown;
  fidInputIscd: string;
  httpStatus?: number | null;
  requestBuilt?: boolean;
  requestSent?: boolean;
}): KisSectorIndexCurrentPriceProbeAttempt {
  const root = input.data && typeof input.data === 'object' ? input.data as Record<string, unknown> : null;
  const rows = pickKisRows(input.data);
  const row = rows[0];
  const value = detectKisSectorIndexValue(row);
  const currentIndex = value.currentIndex;
  const indexValueFieldPresent = currentIndex !== null;
  const outputPresent = Boolean(row);
  const rtCd = root?.rt_cd != null ? String(root.rt_cd) : null;
  const msgCd = root?.msg_cd != null ? String(root.msg_cd) : null;
  const msg1 = root?.msg1 != null ? String(root.msg1) : null;
  const successEquivalent = !rtCd || rtCd === '0';
  const httpOk = input.httpStatus == null || (input.httpStatus >= 200 && input.httpStatus < 300);
  const apiTransportSuccess = Boolean(root && httpOk && successEquivalent && outputPresent);
  const indexValueUsable = apiTransportSuccess
    && indexValueFieldPresent
    && currentIndex != null
    && Number.isFinite(currentIndex)
    && currentIndex > 0;
  const valueQualityStatus: KisSectorIndexValueQualityStatus = indexValueUsable
    ? 'USABLE'
    : currentIndex === 0
      ? 'VALUE_QUALITY_ZERO'
      : apiTransportSuccess
        ? 'VALUE_PARSE_FAILED'
        : 'API_TRANSPORT_FAILED';
  const verified = indexValueUsable;
  const reasonCode = verified
    ? 'VERIFY_SUCCESS'
    : classifyKisSectorIndexFailure({
      httpStatus: input.httpStatus ?? (root ? 200 : null),
      rtCd,
      msgCd,
      msg1,
      outputPresent,
      indexValueFieldPresent,
      currentIndex,
      hasRawResponse: Boolean(root),
    });
  return {
    fidCondMrktDivCode: 'U',
    fidInputIscd: input.fidInputIscd,
    apiPath: SECTOR_INDEX_CURRENT_PATH,
    method: 'GET',
    trId: SECTOR_INDEX_CURRENT_TR_ID,
    baseUrlKind: sectorIndexBaseUrlKind(),
    requestBuilt: input.requestBuilt ?? true,
    requestSent: input.requestSent ?? true,
    httpStatus: input.httpStatus ?? (root ? 200 : null),
    rtCd,
    msgCd,
    msg1,
    outputShape: outputShape(input.data),
    indexValueFieldName: value.fieldName,
    outputPresent,
    indexValueFieldPresent,
    rawTopLevelKeys: root ? Object.keys(root).slice(0, 32) : [],
    outputKeys: row ? Object.keys(row).slice(0, 64) : [],
    currentIndex,
    apiTransportSuccess,
    indexValueUsable,
    valueQualityStatus,
    exceptionClass: null,
    exceptionMessageSanitized: null,
    timeoutMs: sectorIndexVerifyTimeoutMs(),
    retryCount: 0,
    transportStage: verified ? 'VERIFY_SUCCESS' : 'HTTP_RESPONSE_RECEIVED',
    verified,
    reasonCode,
  };
}

async function fetchKisSectorIndexCurrentPriceProbeAttempt(
  candidate: string,
): Promise<{ attempt: KisSectorIndexCurrentPriceProbeAttempt; tokenPresent: boolean }> {
  const timeoutMs = sectorIndexVerifyTimeoutMs();
  let token: string;
  try {
    token = HAS_REAL_DATA_CLIENT ? await refreshRealDataToken() : await refreshKisToken();
  } catch (e) {
    return {
      tokenPresent: false,
      attempt: emptyProbeAttempt({
        fidInputIscd: candidate,
        reasonCode: 'KIS_INDEX_API_AUTH_ERROR',
        transportStage: 'AUTH_NOT_READY',
        requestBuilt: false,
        requestSent: false,
        exceptionClass: exceptionClass(e),
        exceptionMessageSanitized: sanitizeTransportExceptionMessage(e),
        timeoutMs,
      }),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const params = {
    FID_COND_MRKT_DIV_CODE: 'U',
    FID_INPUT_ISCD: candidate,
  };
  try {
    const res = await fetch(`${sectorIndexBaseUrl()}${SECTOR_INDEX_CURRENT_PATH}?${new URLSearchParams(params)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        appkey: HAS_REAL_DATA_CLIENT ? process.env.KIS_REAL_DATA_APP_KEY! : process.env.KIS_APP_KEY!,
        appsecret: HAS_REAL_DATA_CLIENT ? process.env.KIS_REAL_DATA_APP_SECRET! : process.env.KIS_APP_SECRET!,
        tr_id: SECTOR_INDEX_CURRENT_TR_ID,
        custtype: 'P',
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        return {
          tokenPresent: true,
          attempt: {
            ...emptyProbeAttempt({
              fidInputIscd: candidate,
              reasonCode: 'KIS_INDEX_API_SCHEMA_MISMATCH',
              transportStage: 'PARSE_FAILED',
              requestBuilt: true,
              requestSent: true,
              exceptionClass: exceptionClass(e),
              exceptionMessageSanitized: sanitizeTransportExceptionMessage(e),
              timeoutMs,
            }),
            httpStatus: res.status,
          },
        };
      }
    }
    return {
      tokenPresent: true,
      attempt: materializeKisSectorIndexProbeAttempt({
        data,
        fidInputIscd: candidate,
        httpStatus: res.status,
        requestBuilt: true,
        requestSent: true,
      }),
    };
  } catch (e) {
    const timeoutError = isTimeoutException(e);
    return {
      tokenPresent: true,
      attempt: emptyProbeAttempt({
        fidInputIscd: candidate,
        reasonCode: timeoutError ? 'KIS_INDEX_API_TIMEOUT' : 'KIS_INDEX_API_HTTP_ERROR',
        transportStage: timeoutError ? 'TIMEOUT' : 'HTTP_EXCEPTION',
        requestBuilt: true,
        requestSent: true,
        exceptionClass: exceptionClass(e),
        exceptionMessageSanitized: sanitizeTransportExceptionMessage(e),
        timeoutMs,
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchKisSectorIndexCurrentPriceProbe(
  sectorIscdCandidates: readonly string[],
  priority: KisApiPriority = 'LOW',
): Promise<KisSectorIndexCurrentPriceProbeResult | null> {
  void priority;
  const overrides = getKisOverrides();
  const { candidates, policy } = sectorIndexVerifyVariantPolicy(sectorIscdCandidates);
  if (candidates.length === 0) return null;
  if (overrides.fetchKisSectorIndexCurrentPriceProbe) {
    return overrides.fetchKisSectorIndexCurrentPriceProbe(candidates);
  }
  if (overrides.fetchKisSectorIndexCurrentPrice) {
    const attempts: KisSectorIndexCurrentPriceProbeAttempt[] = [];
    for (const candidate of candidates) {
      const result = await overrides.fetchKisSectorIndexCurrentPrice(candidate);
      const currentIndex = result?.currentIndex ?? null;
      const indexValueFieldPresent = typeof currentIndex === 'number' && Number.isFinite(currentIndex);
      const apiTransportSuccess = Boolean(result);
      const indexValueUsable = apiTransportSuccess && indexValueFieldPresent && currentIndex != null && currentIndex > 0;
      const valueQualityStatus: KisSectorIndexValueQualityStatus = indexValueUsable
        ? 'USABLE'
        : currentIndex === 0
          ? 'VALUE_QUALITY_ZERO'
          : apiTransportSuccess
            ? 'VALUE_PARSE_FAILED'
            : 'API_TRANSPORT_FAILED';
      const reasonCode = indexValueUsable
        ? 'VERIFY_SUCCESS'
        : valueQualityStatus === 'VALUE_QUALITY_ZERO'
          ? 'VALUE_QUALITY_ZERO'
          : 'KIS_INDEX_API_OUTPUT_EMPTY';
      attempts.push({
        fidCondMrktDivCode: 'U',
        fidInputIscd: candidate,
        apiPath: SECTOR_INDEX_CURRENT_PATH,
        method: 'GET',
        trId: SECTOR_INDEX_CURRENT_TR_ID,
        baseUrlKind: 'UNKNOWN',
        requestBuilt: true,
        requestSent: true,
        httpStatus: result ? 200 : null,
        rtCd: null,
        msgCd: null,
        msg1: null,
        outputShape: result ? 'override:object' : 'override:null',
        indexValueFieldName: indexValueFieldPresent ? 'currentIndex' : null,
        outputPresent: Boolean(result),
        indexValueFieldPresent,
        rawTopLevelKeys: [],
        outputKeys: result?.rawFieldKeys ?? [],
        currentIndex,
        apiTransportSuccess,
        indexValueUsable,
        valueQualityStatus,
        exceptionClass: null,
        exceptionMessageSanitized: null,
        timeoutMs: null,
        retryCount: 0,
        transportStage: indexValueUsable ? 'VERIFY_SUCCESS' : 'VERIFY_FAILED',
        verified: indexValueUsable,
        reasonCode,
      });
      if (indexValueUsable) {
        return {
          sectorIscd: candidates[0] ?? candidate,
          selectedInputIscd: candidate,
          verified: true,
          currentIndex: result?.currentIndex ?? null,
          changePct: result?.changePct ?? null,
          sectorName: result?.sectorName ?? '',
          fetchedAt: result?.fetchedAt,
          source: 'KIS_API',
          reasonCode: 'VERIFY_SUCCESS',
          clientStatus: buildKisIndexQuoteClientStatus({
            enabled: true,
            authReady: true,
            tokenPresent: false,
            canCall: true,
          }),
          verifyVariantPolicy: policy,
          attempts,
          triedCandidates: attempts.map((attempt) => attempt.fidInputIscd),
        };
      }
    }
    return {
      sectorIscd: candidates[0] ?? '',
      selectedInputIscd: null,
      verified: false,
      currentIndex: null,
      changePct: null,
      sectorName: '',
      source: 'KIS_API',
      reasonCode: 'VERIFY_VARIANTS_EXHAUSTED',
      selectedFailureReason: attempts.at(-1)?.reasonCode,
      clientStatus: buildKisIndexQuoteClientStatus({
        enabled: true,
        authReady: true,
        tokenPresent: false,
        canCall: true,
      }),
      verifyVariantPolicy: policy,
      attempts,
      triedCandidates: attempts.map((attempt) => attempt.fidInputIscd),
    };
  }
  if (isKisSectorIndexVerifyClientDisabled()) {
    const attempts = candidates.map((candidate) => emptyProbeAttempt({
      fidInputIscd: candidate,
      reasonCode: 'KIS_INDEX_API_CLIENT_DISABLED',
      transportStage: 'CLIENT_DISABLED',
    }));
    return {
      sectorIscd: candidates[0] ?? '',
      selectedInputIscd: null,
      verified: false,
      currentIndex: null,
      changePct: null,
      sectorName: '',
      source: 'KIS_API',
      reasonCode: 'VERIFY_VARIANTS_EXHAUSTED',
      selectedFailureReason: 'KIS_INDEX_API_CLIENT_DISABLED',
      clientStatus: buildKisIndexQuoteClientStatus({
        enabled: false,
        authReady: false,
        tokenPresent: false,
        canCall: false,
        disabledReason: kisSectorIndexVerifyDisabledReason(),
      }),
      verifyVariantPolicy: policy,
      attempts,
      triedCandidates: attempts.map((attempt) => attempt.fidInputIscd),
    };
  }

  const appKeyReady = HAS_REAL_DATA_CLIENT
    ? Boolean(process.env.KIS_REAL_DATA_APP_KEY && process.env.KIS_REAL_DATA_APP_SECRET)
    : Boolean(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
  if (!appKeyReady) {
    const attempts = candidates.map((candidate) => emptyProbeAttempt({
      fidInputIscd: candidate,
      reasonCode: 'KIS_INDEX_API_AUTH_ERROR',
      transportStage: 'AUTH_NOT_READY',
    }));
    return {
      sectorIscd: candidates[0] ?? '',
      selectedInputIscd: null,
      verified: false,
      currentIndex: null,
      changePct: null,
      sectorName: '',
      source: 'KIS_API',
      reasonCode: 'VERIFY_VARIANTS_EXHAUSTED',
      selectedFailureReason: 'KIS_INDEX_API_AUTH_ERROR',
      clientStatus: buildKisIndexQuoteClientStatus({
        enabled: true,
        authReady: false,
        tokenPresent: false,
        canCall: false,
        disabledReason: HAS_REAL_DATA_CLIENT ? 'KIS_REAL_DATA_APP_KEY_OR_SECRET_MISSING' : 'KIS_APP_KEY_OR_SECRET_MISSING',
      }),
      verifyVariantPolicy: policy,
      attempts,
      triedCandidates: attempts.map((attempt) => attempt.fidInputIscd),
    };
  }

  const attempts: KisSectorIndexCurrentPriceProbeAttempt[] = [];
  let tokenPresent = false;
  for (const candidate of candidates) {
    const result = await fetchKisSectorIndexCurrentPriceProbeAttempt(candidate);
    tokenPresent = tokenPresent || result.tokenPresent;
    attempts.push(result.attempt);
    if (result.attempt.verified) {
      return {
        sectorIscd: candidates[0] ?? candidate,
        selectedInputIscd: candidate,
        verified: true,
        currentIndex: result.attempt.currentIndex ?? null,
        changePct: null,
        sectorName: '',
        fetchedAt: new Date().toISOString(),
        source: 'KIS_API',
        reasonCode: 'VERIFY_SUCCESS',
        clientStatus: buildKisIndexQuoteClientStatus({
          enabled: true,
          authReady: true,
          tokenPresent,
          canCall: true,
        }),
        verifyVariantPolicy: policy,
        attempts,
        triedCandidates: attempts.map((item) => item.fidInputIscd),
      };
    }
  }

  const last = attempts.at(-1);
  return {
    sectorIscd: candidates[0] ?? '',
    selectedInputIscd: null,
    verified: false,
    currentIndex: null,
    changePct: null,
    sectorName: '',
    source: 'KIS_API',
    reasonCode: 'VERIFY_VARIANTS_EXHAUSTED',
    selectedFailureReason: last?.reasonCode,
    clientStatus: buildKisIndexQuoteClientStatus({
      enabled: true,
      authReady: attempts.every((attempt) => attempt.transportStage !== 'AUTH_NOT_READY'),
      tokenPresent,
      canCall: true,
      ...(last?.exceptionClass ? { lastExceptionClass: last.exceptionClass } : {}),
      ...(last?.exceptionMessageSanitized ? { lastExceptionMessageSanitized: last.exceptionMessageSanitized } : {}),
    }),
    verifyVariantPolicy: policy,
    attempts,
    triedCandidates: attempts.map((attempt) => attempt.fidInputIscd),
  };
}
