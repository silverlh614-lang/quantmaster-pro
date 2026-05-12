// @responsibility krxClient HTTP layer SSOT — krxPost/krxGet + payload sanitize + meta state
/**
 * krxClient/http.ts — ADR-0502c (krxClient 분해) Phase 2 — HTTP layer SSOT.
 *
 * 외부 노출 (barrel 경유):
 *   - krxPost                       — KRX 공개 JSON 엔드포인트 POST
 *   - krxGet                        — KRX Open API GET (krxOpenApi 위임)
 *   - getLastKrxPostMeta            — 진단 meta 조회 (read-only)
 *   - clearLastKrxPostMetaState     — resetKrxCache 진입점용
 *   - sanitizeKrxPayload            — payload 정규화 (test-only export)
 *   - buildKrxAutoDisabledDiagnostic — KIS 모드 차단 시 진단 합성 (test-only export)
 *
 * 내부 (다른 krxClient 모듈만 사용):
 *   - classifyContentType           — Content-Type → contentType union
 *   - makeKrxResponseKind            — contentType → responseKind union
 *   - buildKrxOtpPayload             — OTP-CSV 본문 합성 (otpCsv 가 호출)
 *   - setKrxPostMeta                 — meta 영속 setter (otpCsv 가 호출)
 *   - requiredKrxPayloadKeys/forbiddenKrxPayloadKeys — variant 별 키 SSOT
 *
 * 의존성:
 *   - types.ts (KrxRawResponse, KrxPostMeta, KrxInvestorTradingDiagnostic,
 *     KrxInvestorEndpointVariant)
 *   - constants.ts (KRX_BASE/KRX_JSON_PATH/KRX_USER_AGENT/KRX_DISABLED/
 *     REQUEST_TIMEOUT_MS/BLD_KIS_FIRST_QUARANTINE_THRESHOLD + 5 mode helpers)
 *   - cooldown.ts (isBldCooldown/shouldSkipForRecoveryProbe/markRecoveryProbed/
 *     recordBldFailure/recordBldSuccess/getBldFailureState)
 *   - timeWindow.ts (shouldSkipKrxCallByTimeWindow)
 *   - 외부: logger, marketClock (isMarketDataPublished/isKstWeekend),
 *     krxOpenApi.krxGet (_openApiGet)
 */

import { logger } from '../../utils/logger.js';
import { krxGet as _openApiGet } from '../krxOpenApi.js';
import { isMarketDataPublished, isKstWeekend } from '../../utils/marketClock.js';

import type {
  KrxRawResponse,
  KrxPostMeta,
  KrxInvestorTradingDiagnostic,
  KrxInvestorEndpointVariant,
} from './types.js';
import {
  KRX_BASE,
  KRX_JSON_PATH,
  KRX_USER_AGENT,
  KRX_DISABLED,
  REQUEST_TIMEOUT_MS,
  BLD_KIS_FIRST_QUARANTINE_THRESHOLD,
  isKrxAutoFetchDisabled,
  krxAutoFetchDisabledReason,
  krxDisabledStatus,
  krxDisabledReasonMessage,
  isKisFirstRebuildMode,
} from './constants.js';
import {
  isBldCooldown,
  shouldSkipForRecoveryProbe,
  markRecoveryProbed,
  recordBldFailure,
  recordBldSuccess,
  getBldFailureState,
} from './cooldown.js';
import { shouldSkipKrxCallByTimeWindow } from './timeWindow.js';

// ── HTTP meta state SSOT ─────────────────────────────────────────────────────
// `resetKrxCache` (krxClient.ts) 가 본 모듈의 `clearLastKrxPostMetaState` 를 호출해
// 테스트 격리 + `/api/system/reset` 시점에 일괄 비운다.
const _lastKrxPostMeta = new Map<string, KrxPostMeta>();

export function setKrxPostMeta(bld: string, meta: KrxPostMeta): void {
  _lastKrxPostMeta.set(bld, meta);
}

export function getLastKrxPostMeta(bld: string): KrxPostMeta | undefined {
  return _lastKrxPostMeta.get(bld);
}

export function clearLastKrxPostMetaState(): void {
  _lastKrxPostMeta.clear();
}

function krxFailureMeta(bld: string): Pick<KrxPostMeta, 'consecutiveFailures' | 'cooldownActive' | 'cooldownRemainingMs'> {
  const state = getBldFailureState(bld);
  return {
    consecutiveFailures: state?.consecutiveFailures ?? 0,
    cooldownActive: Boolean(state && state.cooldownUntilMs > Date.now()),
    cooldownRemainingMs: state ? Math.max(0, state.cooldownUntilMs - Date.now()) : 0,
  };
}

// ── Content-Type 분류 SSOT ───────────────────────────────────────────────────
export function classifyContentType(header: string | null, text?: string): KrxInvestorTradingDiagnostic['contentType'] {
  const lower = (header ?? '').toLowerCase();
  const trimmed = (text ?? '').trimStart();
  if (!text && !header) return 'unknown';
  if (text !== undefined && trimmed.length === 0) return 'empty';
  if (lower.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (lower.includes('html') || /^<!doctype html|<html[\s>]/i.test(trimmed)) return 'html';
  if (lower.includes('csv') || lower.includes('excel') || trimmed.includes('\n') && trimmed.includes(',')) return 'csv';
  if (lower.includes('text')) return 'text';
  return 'unknown';
}

export function makeKrxResponseKind(contentType: KrxInvestorTradingDiagnostic['contentType']): KrxPostMeta['responseKind'] {
  if (contentType === 'json') return 'JSON';
  if (contentType === 'html') return 'HTML';
  if (contentType === 'csv') return 'CSV';
  if (contentType === 'empty') return 'EMPTY';
  return 'TEXT';
}

// ── Payload sanitize / variant key SSOT ──────────────────────────────────────
const KRX_OMITTED_PAYLOAD_VALUES = new Set(['', 'NONE', 'UNKNOWN', 'N/A']);

export function sanitizeKrxPayload(input: Record<string, unknown>): { payload: Record<string, string>; omittedKeys: string[] } {
  const payload: Record<string, string> = {};
  const omittedKeys: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value == null) {
      omittedKeys.push(key);
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (KRX_OMITTED_PAYLOAD_VALUES.has(trimmed)) {
        omittedKeys.push(key);
        continue;
      }
      payload[key] = trimmed;
      continue;
    }
    payload[key] = String(value);
  }
  return { payload, omittedKeys };
}

export function requiredKrxPayloadKeys(variant: KrxInvestorEndpointVariant): string[] {
  if (variant.routePurpose === 'SYMBOL_LEVEL') {
    const dateKeys = variant.dateParam === 'strtDd/endDd' ? ['strtDd', 'endDd'] : [variant.dateParam];
    return ['bld', 'isuCd', ...dateKeys, 'inqVal'];
  }
  const dateKey = variant.dateParam === 'trdDd' ? 'trdDd' : variant.dateParam;
  return ['bld', 'inqTpCd', dateKey, 'mktId', 'inqVal'];
}

export function forbiddenKrxPayloadKeys(variant: KrxInvestorEndpointVariant): string[] {
  const common = ['symbolCode', 'isuCd2', 'codeNmisuCd_finder_stkisu0_0'];
  if (variant.payloadMode !== 'MINIMAL_STRICT') return common;
  if (variant.routePurpose === 'MARKET_LEVEL') {
    return [
      ...common,
      'isuCd',
      'trdVolVal',
      'share',
      'money',
      'detailView',
      'csvxls_isNo',
      'locale',
    ];
  }
  return [
    ...common,
    'mktId',
    'inqTpCd',
    'trdVolVal',
    'share',
    'money',
    'detailView',
    'csvxls_isNo',
    'locale',
  ];
}

export function buildKrxOtpPayload(variant: KrxInvestorEndpointVariant): {
  body: string;
  meta: Pick<KrxPostMeta, 'payloadMode' | 'omittedKeys' | 'forbiddenKeysPresent' | 'requiredKeysPresent' | 'requiredKeysMissing' | 'sentPayloadKeys'>;
} {
  const basePayload = variant.payloadMode === 'MINIMAL_STRICT'
    ? {
        name: 'fileDown',
        bld: variant.bld,
        ...variant.params,
      }
    : {
        name: 'fileDown',
        bld: variant.bld,
        url: variant.bld,
        csvxls_isNo: 'false',
        locale: 'ko_KR',
        ...variant.params,
      };
  const { payload, omittedKeys } = sanitizeKrxPayload(basePayload);
  const sentPayloadKeys = Object.keys(payload).sort();
  const requiredKeys = requiredKrxPayloadKeys(variant);
  const forbiddenKeys = forbiddenKrxPayloadKeys(variant);
  const requiredKeysPresent = requiredKeys.filter((key) => payload[key] != null);
  const requiredKeysMissing = requiredKeys.filter((key) => payload[key] == null);
  const forbiddenKeysPresent = forbiddenKeys.filter((key) => payload[key] != null);
  return {
    body: new URLSearchParams(payload).toString(),
    meta: {
      payloadMode: variant.payloadMode,
      omittedKeys: omittedKeys.sort(),
      forbiddenKeysPresent,
      requiredKeysPresent,
      requiredKeysMissing,
      sentPayloadKeys,
    },
  };
}

// ── KIS 모드 차단 시 진단 합성 SSOT ──────────────────────────────────────────
export function buildKrxAutoDisabledDiagnostic(input: {
  tradeDate: string;
  endpoint?: string;
  bld?: string;
  attemptedVariants?: string[];
  routePurpose?: 'MARKET_LEVEL' | 'SYMBOL_LEVEL';
  symbolCode?: string | null;
}): KrxInvestorTradingDiagnostic {
  const endpoint = input.endpoint ?? 'MDCSTAT02201';
  const bld = input.bld ?? 'dbms/MDC/STAT/standard/MDCSTAT02201';
  const reason = krxAutoFetchDisabledReason();
  const status = krxDisabledStatus();
  const reasonMessage = krxDisabledReasonMessage();
  return {
    status,
    ...(status === 'DISABLED_BY_KIS_ONLY_MODE' ? { confidence: 'MISSING' as const } : {}),
    provider: 'KRX',
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    endpoint,
    bld,
    tradeDate: input.tradeDate,
    selectedKrxFlowMode: 'DIRECT_JSON',
    payloadMode: 'MINIMAL_STRICT',
    routePurpose: input.routePurpose ?? 'MARKET_LEVEL',
    selectedBld: bld,
    requiredParamMissing: null,
    shortCodeToIsuCdResolved: false,
    isuCd: null,
    inqTpCd: null,
    inqVal: null,
    detailView: null,
    endpointVariant: `${endpoint}:AUTO_FETCH_DISABLED`,
    routeKind: input.routePurpose === 'SYMBOL_LEVEL' ? 'SYMBOL_INVESTOR_FLOW' : 'MARKET_INVESTOR_FLOW',
    dateParam: 'trdDd',
    marketCode: 'ALL',
    symbolCode: input.symbolCode ?? null,
    symbolRequired: input.routePurpose === 'SYMBOL_LEVEL',
    otpRequired: false,
    otpGenerated: false,
    otpLength: 0,
    csvDownloaded: false,
    csvRowCount: 0,
    csvColumnKeys: [],
    csvFailureReason: krxDisabledReasonMessage(),
    csvHeaderDetected: false,
    csvNoDataReason: krxDisabledReasonMessage(),
    omittedKeys: [],
    forbiddenKeysPresent: [],
    requiredKeysPresent: [],
    requiredKeysMissing: [],
    sentPayloadKeys: [],
    parameterKeys: [],
    attemptedVariants: input.attemptedVariants ?? [],
    selectedVariant: null,
    contentType: 'empty',
    httpStatus: null,
    responseKind: 'DISABLED',
    consecutiveFailures: 0,
    cooldownActive: false,
    cooldownRemainingMs: 0,
    offHoursSuppressed: false,
    diagnosticOnly: true,
    useForRouter: false,
    useForGate: false,
    useForLive: false,
    useForShadow: false,
    rawTopLevelKeys: [],
    detectedCandidatePaths: [],
    selectedRowPath: null,
    selectedRowCount: 0,
    firstRowKeys: [],
    normalizedRows: 0,
    parserStatus: status,
    fieldMappings: {
      symbol: null,
      date: null,
      investorType: null,
      foreignNetBuy: null,
      institutionNetBuy: null,
      individualNetBuy: null,
      netBuyAmount: null,
      netBuyVolume: null,
    },
    endpointIssueHint: 'NONE',
    summary: `status=${status};provider=KRX;providerIssue=false;marketSignal=false;useForRouter=false;useForGate=false;useForLive=false;useForShadow=false;executionImpact=NONE;reason=${reason};message=${reasonMessage}`,
    reason: reasonMessage,
  };
}

// ── KRX POST (공개 JSON 엔드포인트) ──────────────────────────────────────────
/**
 * KRX POST 요청 1회. 실패 시 null 반환 (호출자가 빈 배열로 변환).
 * - AbortSignal timeout 으로 응답이 없어도 프로세스가 멈추지 않는다.
 * - Content-Type form-urlencoded — KRX 동적 JSON 엔드포인트 요구.
 * - Referer/Origin 헤더 — 일부 bld는 referer 없으면 거부한다.
 */
export async function krxPost(
  bld: string,
  params: Record<string, string>,
  options: { bypassTimeWindow?: boolean; allowDisabledAutoFetch?: boolean } = {},
): Promise<KrxRawResponse | null> {
  if (!options.allowDisabledAutoFetch && isKrxAutoFetchDisabled()) {
    const endpoint = bld.split('/').at(-1) ?? bld;
    console.info(`[KRX] skipped: ${krxAutoFetchDisabledReason()} auto fetch disabled endpoint=${endpoint}`);
    setKrxPostMeta(bld, { contentType: 'empty', httpStatus: null, responseKind: 'DISABLED', diagnosticOnly: true, useForRouter: false, useForGate: false, useForLive: false, useForShadow: false });
    return null;
  }

  if (KRX_DISABLED) {
    setKrxPostMeta(bld, { contentType: 'empty', httpStatus: null, responseKind: 'DISABLED' });
    return null;
  }

  // ADR-0256: 시간대 게이팅 — 통계 무의미 / 미확정 시간대 호출 차단.
  // 카운터 미누적 (ADR-0251 정합).
  const gating = options.bypassTimeWindow ? { skip: false as const } : shouldSkipKrxCallByTimeWindow();
  if (gating.skip) {
    logger.debug(`[KRX] ${bld} 시간대 게이팅 스킵 (${gating.reason}, ADR-0256)`);
    setKrxPostMeta(bld, { contentType: 'empty', httpStatus: null, responseKind: 'GATED' });
    return null;
  }

  if (isBldCooldown(bld)) {
    // ADR-0009 soft cooldown — 이미 실패가 누적된 bld 는 쿨다운 동안 skip.
    setKrxPostMeta(bld, { contentType: 'empty', httpStatus: null, responseKind: 'COOLDOWN', ...krxFailureMeta(bld), diagnosticOnly: isKisFirstRebuildMode(), useForRouter: !isKisFirstRebuildMode(), useForGate: !isKisFirstRebuildMode(), useForLive: false, useForShadow: true });
    return null;
  }

  // ADR-0259 wiring: probe 윈도우 (cooldown 만료 후 30분) 안 추가 호출 skip.
  // 1회만 시도 → 성공 시 recordBldSuccess 가 cooldownUntilMs=0 으로 reset →
  // 이후 호출은 정상 동작. 실패 시 markRecoveryProbed 마킹된 상태 유지 →
  // 다음 30분 윈도우 안 호출은 skip (또 실패해서 cooldown 재발 방지).
  if (shouldSkipForRecoveryProbe(bld)) {
    logger.debug(`[KRX] ${bld} probe 윈도우 안 추가 호출 skip (ADR-0259)`);
    setKrxPostMeta(bld, { contentType: 'empty', httpStatus: null, responseKind: 'COOLDOWN', ...krxFailureMeta(bld), diagnosticOnly: isKisFirstRebuildMode(), useForRouter: !isKisFirstRebuildMode(), useForGate: !isKisFirstRebuildMode(), useForLive: false, useForShadow: true });
    return null;
  }

  // probe 윈도우 안 첫 시도 시점 마킹 — 다음 호출은 skip.
  markRecoveryProbed(bld);

  const body = new URLSearchParams({ bld, ...params }).toString();

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${KRX_BASE}${KRX_JSON_PATH}`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': KRX_USER_AGENT,
        'Referer': `${KRX_BASE}/contents/MDC/STAT/standard/MDCSTAT0201.cmd`,
        'Origin':  KRX_BASE,
      },
      body,
    });
    if (!res.ok) {
      // 주말 KRX 400 — resolveTradeDate 가 직전 영업일로 후퇴해도 bld 별 간헐 400.
      // 정보 가치 0 + cooldown 오염 방지를 위해 silent return (recordBldFailure 도 생략).
      if (res.status === 400 && isKstWeekend()) {
        setKrxPostMeta(bld, { contentType: 'empty', httpStatus: res.status, responseKind: 'HTTP_ERROR' });
        return null;
      }
      // ADR-0251: 평일 off-hours (장 시작 전 / 점심 / 마감 후 통계 미확정 창)
      // 의 400 은 정상 동작 — 카운터 미누적 (주말과 동일 정책). 사용자 5/6
      // 보고: 점심시간 KRX 400 누적이 cooldown 트리거하던 결함 차단.
      if (res.status === 400 && !isMarketDataPublished()) {
        const kisFirst = isKisFirstRebuildMode();
        if (kisFirst) {
          recordBldFailure(bld, { cooldownThreshold: BLD_KIS_FIRST_QUARANTINE_THRESHOLD, reason: 'OFF_HOURS_HTTP400' });
        }
        logger.debug(`[KRX] ${bld} HTTP 400 (off-hours fallback — suppressed, ADR-0251, executionImpact=NONE)`);
        setKrxPostMeta(bld, { contentType: 'empty', httpStatus: res.status, responseKind: 'HTTP_ERROR', ...krxFailureMeta(bld), offHoursSuppressed: true, diagnosticOnly: kisFirst, useForRouter: !kisFirst, useForGate: !kisFirst, useForLive: false, useForShadow: true });
        return null;
      }
      console.warn(`[KRX] ${bld} HTTP ${res.status}`);
      setKrxPostMeta(bld, { contentType: 'empty', httpStatus: res.status, responseKind: 'HTTP_ERROR' });
      recordBldFailure(bld);
      return null;
    }
    const text = await res.text();
    const contentType = classifyContentType(res.headers?.get?.('content-type') ?? null, text);
    if (!text.trim()) {
      setKrxPostMeta(bld, { contentType, httpStatus: res.status, responseKind: 'EMPTY' });
      recordBldFailure(bld);
      return null;
    }
    try {
      const parsed = JSON.parse(text);
      setKrxPostMeta(bld, { contentType, httpStatus: res.status, responseKind: 'JSON' });
      recordBldSuccess(bld);
      return parsed;
    }
    catch {
      console.warn(`[KRX] ${bld} JSON 파싱 실패 (앞 120자: ${text.slice(0, 120)})`);
      setKrxPostMeta(bld, { contentType, httpStatus: res.status, responseKind: makeKrxResponseKind(contentType) });
      recordBldFailure(bld);
      return null;
    }
  } catch (e) {
    // AbortError 포함 — 네트워크/타임아웃 모두 빈 응답 처리.
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[KRX] ${bld} 네트워크 실패: ${msg}`);
    setKrxPostMeta(bld, { contentType: 'unknown', httpStatus: null, responseKind: 'NETWORK_ERROR' });
    recordBldFailure(bld);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── KRX Open API GET (krxOpenApi 위임) ───────────────────────────────────────
/**
 * KRX Open API 공통 GET 래퍼. 서킷브레이커·타임아웃·AUTH_KEY 헤더를
 * `krxOpenApi.ts` 의 `krxGet` 이 담당한다. 인증 실패·네트워크 실패·쿼터 초과는
 * 모두 null 로 정규화되어 호출자가 Yahoo 폴백을 시도할 수 있다.
 */
export function krxGet(
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  return _openApiGet(endpoint, params) as Promise<Record<string, unknown> | null>;
}
