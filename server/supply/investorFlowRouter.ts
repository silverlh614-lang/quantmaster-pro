/**
 * @responsibility 기관/외인 수급을 provider policy 순서대로 조회하는 안전 라우터.
 *
 * PR-584: KIS 를 기관/외인 수급 primary 에서 제외하고 KRX/Naver/cache 우선 라우터를 만든다.
 * PR-585: CACHE provider 를 실제 영속 cache 로 연결한다.
 * PR-592: 기존 KRX `fetchInvestorTrading` 공개 통계 client 를 KRX_INVESTOR_FLOW provider 로 연결한다.
 * PR-593: KRX no-output 원인을 date/rowCount/sampleCodes 진단 문자열로 노출한다.
 * PR-594: providerTried 요약에 reason 을 포함해 Telegram /sh 에서 진단 문자열이 실제로 보이게 한다.
 * PR-595: KRX 공개 bld 가 전일자 전체 empty rows 를 반환하면 단순 종목 미매칭이 아니라
 * provider upstream unavailable 로 분류한다.
 * PR-596: 장외/주말에는 KRX public investor provider 를 호출하지 않고 OFF_HOURS 로 스킵한다.
 * PR-597: MARKET_CLOSED/NON_TRADING_DAY/SELL_ONLY 에도 KRX previous trading day 는 source-of-truth 후보로 조회한다.
 */

import { fetchInvestorTrading, getLastKrxInvestorTradingDiagnostic } from '../clients/krxClient.js';
import {
  loadInvestorFlowCache as loadInvestorFlowCacheFromRepo,
  upsertInvestorFlowCache,
} from '../persistence/investorFlowCacheRepo.js';
import { isTradingDay } from '../utils/marketDayClassifier.js';
import type { SupplyProvider } from './supplyProviderPolicy.js';
import {
  getInvestorFlowNegativeCache,
  makeInvestorFlowProviderHealth,
  rememberInvestorFlowProviderHealth,
  resolveInvestorFlowSourceDateKst,
  setInvestorFlowNegativeCache,
  shouldSuppressInvestorFlowFetch,
  summarizeInvestorFlowProviderHealth,
  type InvestorFlowProviderHealth,
} from './investorFlowProviderHealth.js';
// ADR-0445 — KRX investor-flow parser empty rows 진단 SSOT.
//   외부 API 호출 0 (영속 ledger read/append + sanitized metadata 합성만).
//   raw payload / token / cookie / private header 영구 저장 금지.
import {
  appendKrxInvestorFlowParserDiagnostic,
  buildKrxInvestorFlowParserDiagnostic,
  buildSanitizedSample,
  classifyCacheStatus,
  isKrxParserDiagnosticDisabled,
  KRX_INVESTOR_FLOW_EXPECTED_PATHS,
  summarizeKrxInvestorFlowParserHistory,
  toKrxParserKstIso,
} from './krxInvestorFlowParserDiagnostic.js';
import { fetchKisInvestorFlowEvidence } from './kisInvestorFlowEvidence.js';

export interface InvestorFlowSample {
  stockCode: string;
  foreignNetBuy: number;
  institutionalNetBuy: number;
  individualNetBuy?: number;
  provider: Extract<SupplyProvider, 'KRX_INVESTOR_FLOW' | 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'CACHE'>;
  fetchedAt: string;
  tradingDate?: string;
}

export type InvestorFlowAttemptStatus =
  | 'OK'
  | 'PARTIAL'
  | 'NOT_WIRED'
  | 'CACHE_EMPTY'
  | 'PROVIDER_MISMATCH'
  | 'NO_OUTPUT'
  | 'OFF_HOURS'
  | 'DATA_UNAVAILABLE'
  | 'DISABLED_BY_KIS_FIRST_MODE'
  | 'ERROR';

export interface InvestorFlowAttempt {
  provider: SupplyProvider;
  status: InvestorFlowAttemptStatus;
  reason?: string;
}

export interface InvestorFlowRouteResult {
  stockCode: string;
  data: InvestorFlowSample | null;
  attempts: InvestorFlowAttempt[];
  health: InvestorFlowProviderHealth[];
  status: 'OK' | 'PROVIDER_MISMATCH' | 'PROVIDER_UNAVAILABLE' | 'CACHE_EMPTY';
  source: SupplyProvider | null;
}

interface KrxLookupResult {
  data: InvestorFlowSample | null;
  diagnostic: string;
  unavailable: boolean;
  offHours: boolean;
  health: InvestorFlowProviderHealth;
}

const KRX_INVESTOR_FLOW_DAYS = 5;
const KRX_INVESTOR_FLOW_MIN_SAMPLE = 1;
const ATTEMPT_REASON_MAX_LEN = 220;
const KRX_INVESTOR_CALL_START_MIN = 9 * 60;
const KRX_INVESTOR_CALL_END_MIN = 15 * 60 + 30;
const KST_OFFSET_MS = 9 * 60 * 60_000;

function hasRealInvestorFields(value: unknown): value is { foreignNetBuy: number; institutionalNetBuy: number; individualNetBuy: number } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(record.foreignNetBuy) && Number.isFinite(record.institutionalNetBuy) && Number.isFinite(record.individualNetBuy);
}

function hasKisInvestorFields(value: unknown): value is { foreignNetBuy: number; institutionalNetBuy: number; individualNetBuy?: number } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(record.foreignNetBuy) && Number.isFinite(record.institutionalNetBuy);
}


function isKrxAutoFetchDisabled(): boolean {
  return process.env.KIS_FIRST_REBUILD_MODE === 'true' || process.env.KRX_AUTO_FETCH_DISABLED === 'true';
}

function normalizeCode(code: string): string {
  const digits = code.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}

function nowKstParts(now = new Date()): { dow: number; minutes: number; label: string } {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const dow = kst.getUTCDay();
  const hh = kst.getUTCHours();
  const mm = kst.getUTCMinutes();
  return { dow, minutes: hh * 60 + mm, label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} KST` };
}

function toKstDateYmd(now = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function isKrxInvestorCallWindow(now = new Date()): boolean {
  const kst = nowKstParts(now);
  if (kst.dow === 0 || kst.dow === 6) return false;
  if (!isTradingDay(toKstDateYmd(now))) return false;
  return kst.minutes >= KRX_INVESTOR_CALL_START_MIN && kst.minutes <= KRX_INVESTOR_CALL_END_MIN;
}

function previousBusinessDayYmd(now: Date, offset: number): string {
  let cursor = toKstDateYmd(now);
  let consumed = 0;
  for (let i = 0; i < 32; i += 1) {
    if (isTradingDay(cursor)) {
      if (consumed === offset) return cursor.replace(/-/g, '');
      consumed += 1;
    }
    cursor = shiftYmd(cursor, -1);
  }
  return cursor.replace(/-/g, '');
}

function ymdToDate(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function sampleCodes(codes: string[]): string {
  return codes.length > 0 ? codes.slice(0, 6).join(',') : 'NONE';
}

async function fetchKrxInvestorFlow(code: string, now = new Date()): Promise<KrxLookupResult> {
  const safeCode = normalizeCode(code);
  const sourceDateKst = resolveInvestorFlowSourceDateKst(now);
  if (!/^\d{6}$/.test(safeCode)) {
    const health = makeInvestorFlowProviderHealth({
      provider: 'KRX',
      status: 'PARAM_INVALID',
      reason: `invalid investor-flow code: ${code}`,
      now,
      sourceDateKst,
      endpoint: 'MDCSTAT02203',
      retryable: false,
      cacheFallback: true,
    });
    return { data: null, diagnostic: `invalid_code:${code}`, unavailable: true, offHours: false, health };
  }

  if (isKrxAutoFetchDisabled()) {
    const health = makeInvestorFlowProviderHealth({
      provider: 'KRX',
      status: 'DISABLED_BY_KIS_FIRST_MODE',
      reason: 'KIS-first mode; KRX retained for manual validation only',
      now,
      sourceDateKst,
      endpoint: 'MDCSTAT02201',
      retryable: false,
      cacheFallback: false,
      dataAvailable: false,
      semanticAvailable: false,
    });
    console.info('[KRX] skipped: KIS_FIRST_REBUILD_MODE auto fetch disabled endpoint=MDCSTAT02201');
    return {
      data: null,
      diagnostic: 'status=DISABLED_BY_KIS_FIRST_MODE;provider=KRX;providerIssue=false;marketSignal=false;useForRouter=false;useForGate=false;useForLive=false;useForShadow=false;executionImpact=NONE;reason=KIS-first mode; KRX retained for manual validation only',
      unavailable: false,
      offHours: false,
      health,
    };
  }

  const suppressed = shouldSuppressInvestorFlowFetch(now);
  const outsideCallWindow = !isKrxInvestorCallWindow(now);
  const forcePreviousTradingDay = suppressed.suppress || outsideCallWindow;
  const negative = getInvestorFlowNegativeCache('KRX', safeCode, now);
  const negativeIsSessionOnly = negative?.status === 'LUNCH_BREAK' || negative?.status === 'MARKET_CLOSED' || negative?.status === 'NON_TRADING_DAY';
  if (negative && !negativeIsSessionOnly) {
    return {
      data: null,
      diagnostic: `code=${safeCode};sourceDate=${negative.sourceDateKst ?? sourceDateKst};status=${negative.status};reason=NEGATIVE_CACHE_HIT`,
      unavailable: true,
      offHours: false,
      health: negative,
    };
  }

  let foreignNetBuy = 0;
  let institutionalNetBuy = 0;
  let individualNetBuy = 0;
  let sampleSize = 0;
  let latestDate: string | null = null;
  let totalRows = 0;
  const datesTried: string[] = [];
  const sampleCodeSet = new Set<string>();
  const emptyDates: string[] = [];
  const endpointSummaries: string[] = [];
  const previousTradingDayOffset = forcePreviousTradingDay ? 1 : 0;
  for (let i = 0; i < KRX_INVESTOR_FLOW_DAYS; i += 1) {
    const ymd = previousBusinessDayYmd(now, i + previousTradingDayOffset);
    datesTried.push(ymd);
    const rows = await fetchInvestorTrading(ymd);
    const krxDiagnostic = getLastKrxInvestorTradingDiagnostic(ymd);
    endpointSummaries.push(`date=${ymd}|${krxDiagnostic?.summary ?? 'diagnostic=NONE'}`);
    totalRows += rows.length;
    if (rows.length === 0) {
      emptyDates.push(ymd);
      continue;
    }
    for (const r of rows.slice(0, 10)) sampleCodeSet.add(normalizeCode(String(r.code ?? '')));
    const row = rows.find((r) => normalizeCode(String(r.code ?? '')) === safeCode);
    if (!row) continue;
    foreignNetBuy += Number(row.foreignNetBuy ?? 0);
    institutionalNetBuy += Number(row.institutionNetBuy ?? 0);
    individualNetBuy += Number(row.individualNetBuy ?? 0);
    sampleSize += 1;
    if (!latestDate) latestDate = ymdToDate(ymd);
  }

  const allDatesEmpty = datesTried.length > 0 && totalRows === 0 && emptyDates.length === datesTried.length;
  const issueHints = endpointSummaries.map((line) => line.match(/endpointIssueHint=([^;]+)/)?.[1]).filter(Boolean);
  const parserStatuses = endpointSummaries.map((line) => line.match(/parserStatus=([^;]+)/)?.[1]).filter(Boolean);
  const allProviderEmpty = parserStatuses.length > 0 && parserStatuses.every((status) => status === 'PROVIDER_EMPTY_RESPONSE');
  const anyKeyMismatch = parserStatuses.includes('PARSER_KEY_MISMATCH');
  const anyFieldMismatch = parserStatuses.includes('PARSER_FIELD_MISMATCH');
  const upstream = allDatesEmpty
    ? allProviderEmpty ? 'PROVIDER_EMPTY_RESPONSE'
      : anyKeyMismatch ? 'PARSER_KEY_MISMATCH'
        : anyFieldMismatch ? 'PARSER_FIELD_MISMATCH'
          : issueHints.includes('MARKET_CLOSED_NO_PREVIOUS_SAMPLE') ? 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE'
            : 'KRX_PUBLIC_EMPTY_ROWS_OR_HTTP400'
    : 'OK';
  const diagnostic = [
    `code=${safeCode}`,
    `sample=${sampleSize}`,
    `dates=${datesTried.join(',')}`,
    `rows=${totalRows}`,
    `empty=${emptyDates.length > 0 ? emptyDates.join(',') : 'NONE'}`,
    `sampleCodes=${sampleCodes([...sampleCodeSet])}`,
    `previousTradingDateCandidate=${datesTried[0] ?? 'NONE'}`,
    `sessionFallback=${forcePreviousTradingDay ? (suppressed.status ?? 'MARKET_CLOSED') : 'NONE'}`,
    `upstream=${upstream}`,
    `endpointSummary=${endpointSummaries.join('||') || 'NONE'}`,
  ].join(';');

  if (sampleSize < KRX_INVESTOR_FLOW_MIN_SAMPLE || !latestDate) {
    // ADR-0445 — parser empty rows 시 sanitized metadata + last-good cache 진단 layer.
    //   외부 API 호출 0 (영속 ledger read 만, 기존 KRX 호출 결과만 분석).
    //   try/catch 격리 — 진단 빌더 throw 가 router 본체 흐름 차단 0.
    const parserStatus: 'PARSER_EMPTY_ROWS' | 'PROVIDER_EMPTY_RESPONSE' | 'PARSER_KEY_MISMATCH' | 'PARSER_FIELD_MISMATCH' | 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE' | 'CACHE_EMPTY' = allDatesEmpty
      ? upstream === 'PROVIDER_EMPTY_RESPONSE' ? 'PROVIDER_EMPTY_RESPONSE'
        : upstream === 'PARSER_KEY_MISMATCH' ? 'PARSER_KEY_MISMATCH'
          : upstream === 'PARSER_FIELD_MISMATCH' ? 'PARSER_FIELD_MISMATCH'
            : upstream === 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE' ? 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE'
              : 'PARSER_EMPTY_ROWS'
      : 'CACHE_EMPTY';
    const adr0445 = buildKrxParserHealthExtras({
      now,
      parserStatus,
      sampleSize,
      datesTried,
      emptyDates,
      reason: diagnostic,
      payload: { datesTried, emptyDates, totalRows, upstream },
      lastGoodCachedAt: null,
    });
    const health = makeInvestorFlowProviderHealth({
      provider: 'KRX',
      status: parserStatus,
      reason: diagnostic,
      now,
      sourceDateKst: datesTried[0] ? ymdToDate(datesTried[0]) : sourceDateKst,
      endpoint: 'MDCSTAT02203',
      retryable: !allDatesEmpty,
      cacheFallback: true,
      ...adr0445,
    });
    setInvestorFlowNegativeCache('KRX', safeCode, health, now);
    return { data: null, diagnostic, unavailable: true, offHours: false, health };
  }

  const sample: InvestorFlowSample = {
    stockCode: safeCode,
    foreignNetBuy,
    institutionalNetBuy,
    individualNetBuy,
    provider: 'KRX_INVESTOR_FLOW',
    fetchedAt: new Date().toISOString(),
    tradingDate: latestDate,
  };

  upsertInvestorFlowCache({
    stockCode: safeCode,
    date: latestDate,
    foreignNetBuy,
    institutionalNetBuy,
    individualNetBuy,
    provider: 'KRX_INVESTOR_FLOW',
    fetchedAt: sample.fetchedAt,
  });

  // ADR-0445 — OK path 도 진단 ledger 에 success entry 영속 (lastSuccess 추적).
  const adr0445Ok = buildKrxParserHealthExtras({
    now,
    parserStatus: 'OK',
    sampleSize,
    datesTried,
    emptyDates,
    reason: diagnostic,
    payload: { datesTried, emptyDates, totalRows, upstream, latestDate },
    lastGoodCachedAt: sample.fetchedAt,
    firstRowFields: { foreignNetBuy, institutionalNetBuy },
  });
  const health = makeInvestorFlowProviderHealth({
    provider: 'KRX',
    status: 'OK',
    reason: diagnostic,
    now,
    sourceDateKst: latestDate,
    semantic: {
      foreignNetBuy,
      institutionNetBuy: institutionalNetBuy,
      individualNetBuy,
    },
    endpoint: 'MDCSTAT02203',
    retryable: false,
    cacheFallback: false,
    ...adr0445Ok,
  });

  return { data: sample, diagnostic, unavailable: false, offHours: false, health };
}

// ---------------------------------------------------------------------------
// ADR-0445 — KRX parser 진단 SSOT 위임 helper.
//
// `makeInvestorFlowProviderHealth` 의 옵셔널 propagate 필드를 KRX 한정으로 합성.
// 외부 API 호출 0 — 영속 ledger read/append 만, 기존 KRX 호출 결과 분석.
// try/catch 격리 — 진단 빌더 throw 가 router 흐름 차단 0.
// ---------------------------------------------------------------------------

interface BuildKrxParserHealthExtrasInput {
  now: Date;
  parserStatus: 'OK' | 'PARSER_EMPTY_ROWS' | 'PROVIDER_EMPTY_RESPONSE' | 'PARSER_KEY_MISMATCH' | 'PARSER_FIELD_MISMATCH' | 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE' | 'CACHE_EMPTY';
  sampleSize: number;
  datesTried: string[];
  emptyDates: string[];
  reason: string;
  payload: unknown;
  lastGoodCachedAt: string | null;
  firstRowFields?: { foreignNetBuy: number; institutionalNetBuy: number };
}

/**
 * makeInvestorFlowProviderHealth 의 ADR-0445 옵셔널 필드 합성 SSOT.
 *
 * 진단 ledger 영속 + parser history summary 결합 + cache age 분류. throw 시
 * 부분 결과 반환으로 router 본체 흐름 보호.
 */
function buildKrxParserHealthExtras(input: BuildKrxParserHealthExtrasInput): {
  lastSuccessAtKst?: string;
  lastSuccessRowCount?: number;
  lastFailureAtKst?: string;
  lastFailureReason?: string;
  expectedPaths?: string[];
  detectedCandidatePaths?: string[];
  cacheStatus?: 'CACHE_EMPTY' | 'CACHE_HIT' | 'LAST_GOOD_STALE';
} {
  if (isKrxParserDiagnosticDisabled()) return {};
  try {
    const sanitized = buildSanitizedSample({ payload: input.payload, now: input.now });
    const cacheStatus = classifyCacheStatus(input.lastGoodCachedAt, input.now);
    const history = summarizeKrxInvestorFlowParserHistory();
    const diag = buildKrxInvestorFlowParserDiagnostic({
      status: input.parserStatus,
      rowCount: input.sampleSize,
      sanitizedSample: sanitized,
      expectedPaths: KRX_INVESTOR_FLOW_EXPECTED_PATHS,
      firstRowFields: input.firstRowFields,
      lastSuccessAtKst: history.lastSuccessAtKst,
      lastSuccessRowCount: history.lastSuccessRowCount,
      lastFailureAtKst: history.lastFailureAtKst,
      lastFailureReason: history.lastFailureReason,
      cacheStatus,
      note: input.reason.slice(0, 200),
    });
    // 진단 ledger 영속 — 다음 호출 시 propagate 입력.
    appendKrxInvestorFlowParserDiagnostic({
      diagnosedAt: toKrxParserKstIso(input.now),
      diagnostic: diag,
      sanitizedSample: sanitized,
    });
    // OK 인 경우 본 호출이 lastSuccess 가 되도록 즉시 propagate (history 는 ledger read
    // 가 본 호출 *이전* 값 — 다음 호출 시점부터 이번 OK 가 history.lastSuccess 로
    // 자연 노출됨. 본 호출의 health 객체는 이번 OK 가 아닌 *직전* success 를 가리킴).
    return {
      ...(diag.lastSuccessAtKst ? { lastSuccessAtKst: diag.lastSuccessAtKst } : {}),
      ...(diag.lastSuccessRowCount !== undefined ? { lastSuccessRowCount: diag.lastSuccessRowCount } : {}),
      ...(diag.lastFailureAtKst ? { lastFailureAtKst: diag.lastFailureAtKst } : {}),
      ...(diag.lastFailureReason ? { lastFailureReason: diag.lastFailureReason } : {}),
      expectedPaths: diag.expectedPaths,
      ...(diag.detectedCandidatePaths.length > 0
        ? { detectedCandidatePaths: diag.detectedCandidatePaths }
        : {}),
      ...(diag.cacheStatus ? { cacheStatus: diag.cacheStatus } : {}),
    };
  } catch (err) {
    console.warn(
      '[InvestorFlow] KRX parser diagnostic builder failed (router 흐름 보호, ADR-0445):',
      err,
    );
    return {};
  }
}

async function fetchNaverInvestorTrend(_code: string): Promise<InvestorFlowSample | null> {
  // NAVER_FOREIGNER_RATIO 는 보유율 추세 provider 이며 순매수 semantic field 가 없다.
  // fake-zero 방지를 위해 외인/기관/개인 순매수 필드가 검증되는 endpoint 전에는 NOT_WIRED 유지.
  return null;
}

async function loadInvestorFlowCache(code: string, now = new Date()): Promise<InvestorFlowSample | null> {
  return loadInvestorFlowCacheFromRepo(code, toKstDateYmd(now));
}

function pushAttempt(attempts: InvestorFlowAttempt[], provider: SupplyProvider, status: InvestorFlowAttemptStatus, reason?: string): void {
  attempts.push({ provider, status, ...(reason ? { reason } : {}) });
}

function compactReason(reason: string): string {
  const oneLine = reason.replace(/\s+/g, ' ').trim();
  return oneLine.length > ATTEMPT_REASON_MAX_LEN ? `${oneLine.slice(0, ATTEMPT_REASON_MAX_LEN)}…` : oneLine;
}

export function summarizeInvestorFlowAttempts(attempts: InvestorFlowAttempt[]): string {
  return attempts
    .map((a) => `${a.provider}:${a.status}${a.reason ? `(${compactReason(a.reason)})` : ''}`)
    .join(' / ');
}

export { summarizeInvestorFlowProviderHealth };

export async function fetchInvestorFlowWithPolicy(code: string, now = new Date()): Promise<InvestorFlowRouteResult> {
  const attempts: InvestorFlowAttempt[] = [];
  const health: InvestorFlowProviderHealth[] = [];

  try {
    const kis = await fetchKisInvestorFlowEvidence(code, now);
    health.push(kis.health);
    if (kis.data && hasKisInvestorFields(kis.data)) {
      const kisAttemptStatus: InvestorFlowAttemptStatus = kis.sample?.confidence === 'DEGRADED' ? 'PARTIAL' : 'OK';
      pushAttempt(attempts, 'KIS_API', kisAttemptStatus, kis.diagnostic);

      if (kis.selectableForRouter) {
        const composite = makeInvestorFlowProviderHealth({
          provider: 'COMPOSITE',
          status: 'OK',
          reason: [
            'KIS official investor-flow semantic net-buy available',
            'source=KIS_OFFICIAL_STANDARD_API',
            `promotionStage=${kis.promotionStage}`,
            'liveExecutionAllowed=false',
            'executionImpact=NONE',
          ].join(';'),
          now,
          sourceDateKst: kis.data.tradingDate,
          semantic: {
            foreignNetBuy: kis.data.foreignNetBuy,
            institutionNetBuy: kis.data.institutionalNetBuy,
            ...(Number.isFinite(kis.data.individualNetBuy) ? { individualNetBuy: kis.data.individualNetBuy } : {}),
          },
        });
        health.push(composite);
        rememberInvestorFlowProviderHealth(health);
        return {
          stockCode: code,
          data: kis.data,
          attempts,
          health,
          status: 'OK',
          source: 'KIS_API',
        };
      }
    } else {
      pushAttempt(
        attempts,
        'KIS_API',
        kis.health.status === 'UNKNOWN_ERROR' ? 'ERROR' : 'DATA_UNAVAILABLE',
        kis.diagnostic,
      );
    }
  } catch (err) {
    health.push(makeInvestorFlowProviderHealth({
      provider: 'KIS',
      status: 'UNKNOWN_ERROR',
      reason: [
        `reason=${err instanceof Error ? err.message : String(err)}`,
        'source=KIS_OFFICIAL_STANDARD_API',
        'providerIssue=true',
        'marketSignal=false',
        'liveExecutionAllowed=false',
        'executionImpact=NONE',
      ].join(';'),
      now,
      sourceDateKst: resolveInvestorFlowSourceDateKst(now),
      endpoint: 'KIS_INQUIRE_INVESTOR_STRICT',
      semanticAvailable: false,
      dataAvailable: false,
      retryable: true,
      cacheFallback: true,
    }));
    pushAttempt(attempts, 'KIS_API', 'ERROR', err instanceof Error ? err.message : String(err));
  }

  try {
    const krx = await fetchKrxInvestorFlow(code, now);
    health.push(krx.health);
    if (krx.data && hasRealInvestorFields(krx.data)) {
      pushAttempt(attempts, 'KRX_INVESTOR_FLOW', 'OK', krx.diagnostic);
      const composite = makeInvestorFlowProviderHealth({
        provider: 'COMPOSITE',
        status: 'OK',
        reason: 'KRX investor-flow semantic net-buy available',
        now,
        sourceDateKst: krx.data.tradingDate,
        semantic: {
          foreignNetBuy: krx.data.foreignNetBuy,
          institutionNetBuy: krx.data.institutionalNetBuy,
          individualNetBuy: krx.data.individualNetBuy,
        },
      });
      health.push(composite);
      rememberInvestorFlowProviderHealth(health);
      return { stockCode: code, data: krx.data, attempts, health, status: 'OK', source: 'KRX_INVESTOR_FLOW' };
    }
    pushAttempt(attempts, 'KRX_INVESTOR_FLOW', krx.offHours ? 'OFF_HOURS' : krx.unavailable ? 'DATA_UNAVAILABLE' : 'NO_OUTPUT', krx.diagnostic);
  } catch (err) {
    health.push(makeInvestorFlowProviderHealth({
      provider: 'KRX',
      status: err instanceof Error && err.name === 'AbortError' ? 'TIMEOUT' : 'UNKNOWN_ERROR',
      reason: err instanceof Error ? err.message : String(err),
      now,
      sourceDateKst: resolveInvestorFlowSourceDateKst(now),
      endpoint: 'MDCSTAT02203',
      retryable: true,
      cacheFallback: true,
    }));
    pushAttempt(attempts, 'KRX_INVESTOR_FLOW', 'ERROR', err instanceof Error ? err.message : String(err));
  }

  try {
    const naver = await fetchNaverInvestorTrend(code);
    if (naver && hasRealInvestorFields(naver)) {
      pushAttempt(attempts, 'NAVER_INVESTOR_TREND', 'OK');
      const naverHealth = makeInvestorFlowProviderHealth({
        provider: 'NAVER',
        status: 'OK',
        reason: 'NAVER investor trend semantic net-buy available',
        now,
        sourceDateKst: naver.tradingDate,
        semantic: {
          foreignNetBuy: naver.foreignNetBuy,
          institutionNetBuy: naver.institutionalNetBuy,
          individualNetBuy: naver.individualNetBuy,
        },
      });
      const composite = makeInvestorFlowProviderHealth({
        provider: 'COMPOSITE',
        status: 'OK',
        reason: 'NAVER investor-flow semantic net-buy available',
        now,
        sourceDateKst: naver.tradingDate,
        semantic: {
          foreignNetBuy: naver.foreignNetBuy,
          institutionNetBuy: naver.institutionalNetBuy,
          individualNetBuy: naver.individualNetBuy,
        },
      });
      health.push(naverHealth, composite);
      rememberInvestorFlowProviderHealth(health);
      return { stockCode: code, data: naver, attempts, health, status: 'OK', source: 'NAVER_INVESTOR_TREND' };
    }
    health.push(makeInvestorFlowProviderHealth({
      provider: 'NAVER',
      status: 'NOT_WIRED',
      reason: 'NAVER investor trend collector not implemented; modulePath=server/supply/investorFlowRouter.ts#fetchNaverInvestorTrend; wiring=local_stub; runtimeMount=missing; buildArtifactCheck=ensure ADR-0481 collector import is registered',
      now,
      sourceDateKst: resolveInvestorFlowSourceDateKst(now),
      retryable: false,
      cacheFallback: true,
    }));
    pushAttempt(attempts, 'NAVER_INVESTOR_TREND', 'NOT_WIRED', 'NAVER investor trend collector not implemented; modulePath=server/supply/investorFlowRouter.ts#fetchNaverInvestorTrend; wiring=local_stub; runtimeMount=missing; buildArtifactCheck=ensure ADR-0481 collector import is registered');
  } catch (err) {
    health.push(makeInvestorFlowProviderHealth({
      provider: 'NAVER',
      status: 'UNKNOWN_ERROR',
      reason: err instanceof Error ? err.message : String(err),
      now,
      sourceDateKst: resolveInvestorFlowSourceDateKst(now),
      retryable: true,
      cacheFallback: true,
    }));
    pushAttempt(attempts, 'NAVER_INVESTOR_TREND', 'ERROR', err instanceof Error ? err.message : String(err));
  }

  try {
    const cached = await loadInvestorFlowCache(code, now);
    if (cached && hasRealInvestorFields(cached)) {
      pushAttempt(attempts, 'CACHE', 'OK');
      const cacheHealth = makeInvestorFlowProviderHealth({
        provider: 'CACHE',
        status: 'CACHE_HIT',
        reason: 'usable investor-flow cache hit',
        now,
        sourceDateKst: cached.tradingDate,
        semantic: {
          foreignNetBuy: cached.foreignNetBuy,
          institutionNetBuy: cached.institutionalNetBuy,
          individualNetBuy: cached.individualNetBuy,
        },
      });
      const composite = makeInvestorFlowProviderHealth({
        provider: 'COMPOSITE',
        status: 'OK',
        reason: 'cached investor-flow semantic net-buy available',
        now,
        sourceDateKst: cached.tradingDate,
        semantic: {
          foreignNetBuy: cached.foreignNetBuy,
          institutionNetBuy: cached.institutionalNetBuy,
          individualNetBuy: cached.individualNetBuy,
        },
      });
      health.push(cacheHealth, composite);
      rememberInvestorFlowProviderHealth(health);
      return { stockCode: code, data: cached, attempts, health, status: 'OK', source: 'CACHE' };
    }
    health.push(makeInvestorFlowProviderHealth({
      provider: 'CACHE',
      status: 'CACHE_EMPTY',
      reason: 'no usable investor-flow cache',
      now,
      sourceDateKst: resolveInvestorFlowSourceDateKst(now),
      retryable: true,
      cacheFallback: false,
    }));
    pushAttempt(attempts, 'CACHE', 'CACHE_EMPTY', 'no usable investor-flow cache');
  } catch (err) {
    health.push(makeInvestorFlowProviderHealth({
      provider: 'CACHE',
      status: 'UNKNOWN_ERROR',
      reason: err instanceof Error ? err.message : String(err),
      now,
      sourceDateKst: resolveInvestorFlowSourceDateKst(now),
      retryable: true,
    }));
    pushAttempt(attempts, 'CACHE', 'ERROR', err instanceof Error ? err.message : String(err));
  }

  const hasHardProviderError = attempts.some((a) => a.provider !== 'KIS_API' && a.status === 'ERROR');
  health.push(makeInvestorFlowProviderHealth({
    provider: 'COMPOSITE',
    status: hasHardProviderError ? 'UNKNOWN_ERROR' : 'PROVIDER_UNAVAILABLE',
    reason: 'investor-flow semantic net-buy unavailable; not a confirmed negative flow',
    now,
    sourceDateKst: resolveInvestorFlowSourceDateKst(now),
    semanticAvailable: false,
    dataAvailable: false,
    retryable: !hasHardProviderError,
    cacheFallback: true,
  }));
  rememberInvestorFlowProviderHealth(health);
  return {
    stockCode: code,
    data: null,
    attempts,
    health,
    status: hasHardProviderError ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_MISMATCH',
    source: null,
  };
}
