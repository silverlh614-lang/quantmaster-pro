// @responsibility Patch-004 SSOT: KIS market-program empty-output classifier + KRX/CACHE fallback router + Provider Coverage Map + stuck-empty detector + 7-state routed status display.

// =====================================================================
// Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004 SSOT
//
// 사용자 직접 framing:
//   "ACCEPTED_EMPTY는 최종 표시 상태로 쓰지 않는다. 내부 raw status로만 남긴다.
//    KIS empty output → trigger KRX fallback → CACHE fallback.
//    Empty output을 bearish signal로 해석하지 않는다.
//    latest=N/A를 foreign sell로 해석하지 않는다.
//    providerIssue=false인 empty를 live execution block으로 직접 연결하지 않는다."
//
// 본 SSOT 는 *분류 + fallback 결정 + 표시 + stuck 감지* layer 만 — 외부 API 호출 0.
// KIS empty 응답의 routedStatus(KIS_API/raw=ACCEPTED_EMPTY) → 7-value union 으로 재분류.
// =====================================================================

import type { MacroState } from '../../persistence/macroStateRepo.js';

/** 사용자 §A: 7-value routed status union (절대 변경 금지). */
export type ProgramMarketRoutedStatus =
  | 'VERIFIED'        // 유효 데이터 존재 (KIS 또는 KRX 채우기 성공)
  | 'EMPTY_VALID'     // 정상 응답, 해당 시간/시장에 데이터 없음
  | 'UNSUPPORTED'     // provider 가 해당 데이터 타입 제공 안 함 (KIS 일부 시장)
  | 'PARAM_MISMATCH'  // 요청 파라미터 문제로 빈 응답 의심 (FID_INPUT_ISCD 등)
  | 'STALE_CACHE'     // cache 만 사용 가능 (LGV TTL 초과 직전)
  | 'DEGRADED'        // provider 응답 불안정 (다중 시도 실패)
  | 'MISSING'         // 모든 provider 에서 데이터 없음
  | 'SESSION_CLOSED'; // 장외/휴장: intraday-only program trading not evaluated

/** 사용자 §B: routed source 분류. */
export type ProgramMarketRoutedSource = 'KIS_API' | 'KRX_API' | 'CACHE' | 'NONE';

/** 사용자 §B: scoring 정책. */
export type ProgramMarketScoringPolicy = 'allowed_when_non_empty' | 'shadow_only_or_excluded' | 'excluded' | 'excluded_afterhours';

/** Telegram 문구 변형 4종 (사용자 §J #6). */
export type ProgramMarketTextVariant =
  | 'A_NO_DATA'        // 진짜 데이터 없음 — `데이터 없음 (휴장/장중 비활성)`
  | 'B_UNSUPPORTED'    // provider 미지원 — `제공 미지원 (KRX 직접 조회 필요)`
  | 'C_PARAM_ISSUE'    // 파라미터 문제 — `요청 파라미터 점검 필요`
  | 'D_FALLBACK_OK';   // fallback 성공 — `KIS empty → KRX recovered`

/** raw KIS diagnostic 입력 (zeroReason / outputLength / outputKeys / responseCode). */
export interface ProgramMarketRawDiagInput {
  zeroReason?: string | null; // 'ACCEPTED_EMPTY' | 'PARAM_ERROR' | 'SESSION_UNAVAILABLE' | 'OUTPUT_EMPTY' | 'PROVIDER_ERROR' | 'FIELD_MISSING' | 'NON_ZERO' | 'RAW_ZERO' | 'FETCH_FAIL' | null
  rtCd?: string;              // KIS root response code
  msgCd?: string;             // KIS message code (e.g. MCA00000)
  msg1?: string;              // raw message (param error 분류 시)
  outputLength?: number;      // output array length (0 = empty)
  outputKeys?: string[];      // first row keys (empty array if no rows)
  firstRowSample?: Record<string, string | number | boolean | null>;
  endpoint?: string;
  trId?: string;
  marketCode?: string;        // FID_INPUT_ISCD 값
  queryParams?: Record<string, string>;
  httpStatus?: number;
  responseCode?: string;
  requestedAt?: string;       // ISO
  providerLatencyMs?: number;
}

/** KRX fallback 가용성 입력 (실제 fetch 는 호출자 책임, 본 SSOT 는 라우팅만). */
export interface ProgramMarketKrxFallbackInput {
  available: boolean;          // KRX 응답에서 유효 데이터 추출 성공 여부
  programNetBuyAmount?: number; // 억원
  fetchedAt?: string;          // ISO
}

/** CACHE fallback 가용성 (macroState LGV). */
export interface ProgramMarketCacheFallbackInput {
  available: boolean;
  programNetBuyAmount?: number;
  fetchedAt?: string;
  ageMs?: number;
}

/** 사용자 §C: 분류기 입력. */
export interface ClassifyProgramMarketEmptyInput {
  rawDiag?: ProgramMarketRawDiagInput;
  marketCode?: string;       // FID_INPUT_ISCD 명시 (0001=KOSPI, 1001=KOSDAQ 등)
  krxFallback?: ProgramMarketKrxFallbackInput;
  cacheFallback?: ProgramMarketCacheFallbackInput;
}

/** 사용자 §D: routing decision. literal types 컴파일 타임 강제. */
export interface ProgramMarketRoutingDecision {
  routedStatus: ProgramMarketRoutedStatus;
  source: ProgramMarketRoutedSource;
  rawStatus: string;                // 내부 raw status (ACCEPTED_EMPTY 등)
  scoring: ProgramMarketScoringPolicy;
  fallbackAttempted: boolean;
  fallbackResult: 'NOT_TRIED' | 'KRX_OK' | 'KRX_EMPTY' | 'CACHE_OK' | 'CACHE_EMPTY' | 'ALL_FAILED';
  textVariant: ProgramMarketTextVariant;
  providerIssue: false;             // 사용자 §I literal 강제
  marketSignal: false;              // 사용자 §I literal 강제
  executionImpact: 'NONE';          // 사용자 §I literal 강제
  liveExecutionAllowed: false;      // literal 강제
  decisionDetail: string;           // 운영자 안내 (Telegram 표시용)
  rawDiagHidden: true;              // /scan_blockers · /supply_health 에는 rawDiag 미노출 (사용자 §J #5)
}

/** 사용자 §G: Provider Coverage Map 항목. */
export interface ProviderCapability {
  supportsProgramTrading: boolean;
  supportsPassiveActiveSplit: boolean | 'maybe';
  supportsKospi: boolean;
  supportsKosdaq: boolean;
  supportsIntraday: boolean;
  supportsMarketWide: boolean;
  supportsLastGoodValue?: boolean;
}

/** Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004 patch identifier (static grep guard SSOT). */
export const PATCH_004_IDENTIFIER = 'Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004';

/** 사용자 §G: Provider Coverage SSOT (절대 변경 금지). */
export const PROGRAM_MARKET_PROVIDER_COVERAGE: Readonly<Record<'KIS_API' | 'KRX_API' | 'CACHE', ProviderCapability>> =
  Object.freeze({
    KIS_API: Object.freeze({
      supportsProgramTrading: true,
      supportsPassiveActiveSplit: false,
      supportsKospi: true,
      supportsKosdaq: true,
      supportsIntraday: true,
      supportsMarketWide: true,
    }),
    KRX_API: Object.freeze({
      supportsProgramTrading: true,
      supportsPassiveActiveSplit: 'maybe',
      supportsKospi: true,
      supportsKosdaq: true,
      supportsIntraday: false,
      supportsMarketWide: true,
    }),
    CACHE: Object.freeze({
      supportsProgramTrading: true,
      supportsPassiveActiveSplit: false,
      supportsKospi: true,
      supportsKosdaq: true,
      supportsIntraday: false,
      supportsMarketWide: true,
      supportsLastGoodValue: true,
    }),
  } as const);

/** 사용자 §H: stuck-empty 감지 상수 (절대 변경 금지). */
export const PROGRAM_MARKET_STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

/** ENV gate SSOT (ADR-0157 정확 비교 의무). */
export function isProgramMarketRouterDisabled(): boolean {
  return process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED === 'true';
}

/**
 * 사용자 §C: 결정 트리 우선순위 SSOT (절대 변경 금지).
 *
 * 우선순위:
 *   1. rawStatus 분류 (raw 응답 분석 — ACCEPTED_EMPTY / PARAM_ERROR / ... )
 *   2. KRX fallback 시도 (가능 시)
 *   3. CACHE fallback 시도 (KRX 실패 시)
 *   4. 모두 실패 시 EMPTY_VALID 또는 MISSING
 */
export function routeProgramMarketEmpty(input: ClassifyProgramMarketEmptyInput): ProgramMarketRoutingDecision {
  // ENV gate — disabled 시 패치 적용 안 함 (호환성 보존)
  if (isProgramMarketRouterDisabled()) {
    return buildDisabledDecision(input);
  }

  const rawZeroReason = input.rawDiag?.zeroReason ?? null;
  const rawStatus = rawZeroReason ?? 'UNKNOWN';
  const marketCode = input.marketCode ?? input.rawDiag?.marketCode ?? '';

  // (1) PARAM_MISMATCH — KIS 파라미터 문제로 빈 응답
  if (rawZeroReason === 'PARAM_ERROR' || rawZeroReason === 'PARAM_MISMATCH') {
    return {
      routedStatus: 'PARAM_MISMATCH',
      source: 'KIS_API',
      rawStatus,
      scoring: 'excluded',
      fallbackAttempted: false,
      fallbackResult: 'NOT_TRIED',
      textVariant: 'C_PARAM_ISSUE',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail: `요청 파라미터 점검 필요 (marketCode=${marketCode || 'NONE'})`,
      rawDiagHidden: true,
    };
  }

  // (2) UNSUPPORTED — provider 미지원 (KIS 일부 시장)
  if (rawZeroReason === 'SESSION_UNAVAILABLE' || rawZeroReason === 'PROVIDER_ERROR') {
    return buildUnsupportedOrFallback(input, rawStatus, marketCode);
  }

  // (3) ACCEPTED_EMPTY / OUTPUT_EMPTY — KIS 정상 응답 + 빈 output → fallback 시도
  if (rawZeroReason === 'ACCEPTED_EMPTY' || rawZeroReason === 'OUTPUT_EMPTY' || rawZeroReason === 'FIELD_MISSING') {
    return tryFallbackChain(input, rawStatus, marketCode);
  }

  // (4) 정상 응답 (zeroReason === null 또는 NON_ZERO) → VERIFIED
  if (rawZeroReason === null || rawZeroReason === undefined || rawZeroReason === 'NON_ZERO') {
    return {
      routedStatus: 'VERIFIED',
      source: 'KIS_API',
      rawStatus: rawStatus,
      scoring: 'allowed_when_non_empty',
      fallbackAttempted: false,
      fallbackResult: 'NOT_TRIED',
      textVariant: 'D_FALLBACK_OK',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail: 'KIS 유효 데이터 존재',
      rawDiagHidden: true,
    };
  }

  // (5) FETCH_FAIL / RAW_ZERO — fallback 체인 시도
  return tryFallbackChain(input, rawStatus, marketCode);
}

function buildDisabledDecision(input: ClassifyProgramMarketEmptyInput): ProgramMarketRoutingDecision {
  return {
    routedStatus: 'EMPTY_VALID',
    source: 'KIS_API',
    rawStatus: input.rawDiag?.zeroReason ?? 'UNKNOWN',
    scoring: 'excluded',
    fallbackAttempted: false,
    fallbackResult: 'NOT_TRIED',
    textVariant: 'A_NO_DATA',
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    decisionDetail: 'router disabled (PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED=true)',
    rawDiagHidden: true,
  };
}

function tryFallbackChain(
  input: ClassifyProgramMarketEmptyInput,
  rawStatus: string,
  marketCode: string,
): ProgramMarketRoutingDecision {
  const krx = input.krxFallback;
  const cache = input.cacheFallback;

  // KRX fallback 성공
  if (krx?.available === true && typeof krx.programNetBuyAmount === 'number' && Number.isFinite(krx.programNetBuyAmount)) {
    return {
      routedStatus: 'VERIFIED',
      source: 'KRX_API',
      rawStatus,
      scoring: 'allowed_when_non_empty',
      fallbackAttempted: true,
      fallbackResult: 'KRX_OK',
      textVariant: 'D_FALLBACK_OK',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail: `KIS empty → KRX recovered (marketCode=${marketCode || 'NONE'})`,
      rawDiagHidden: true,
    };
  }

  // CACHE fallback 가용 (KRX 실패 후)
  if (cache?.available === true && typeof cache.programNetBuyAmount === 'number' && Number.isFinite(cache.programNetBuyAmount)) {
    return {
      routedStatus: 'STALE_CACHE',
      source: 'CACHE',
      rawStatus,
      scoring: 'shadow_only_or_excluded',
      fallbackAttempted: true,
      fallbackResult: 'CACHE_OK',
      textVariant: 'A_NO_DATA',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail: `KIS empty + KRX empty → CACHE 사용 (age=${cache.ageMs ?? 'N/A'}ms)`,
      rawDiagHidden: true,
    };
  }

  // 모든 fallback 실패
  const krxTried = krx !== undefined;
  const cacheTried = cache !== undefined;
  const allTried = krxTried && cacheTried;

  return {
    routedStatus: allTried ? 'MISSING' : 'EMPTY_VALID',
    source: 'NONE',
    rawStatus,
    scoring: 'excluded',
    fallbackAttempted: krxTried || cacheTried,
    fallbackResult: allTried ? 'ALL_FAILED' : (krxTried ? 'KRX_EMPTY' : 'NOT_TRIED'),
    textVariant: 'A_NO_DATA',
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    decisionDetail: allTried
      ? `모든 provider 데이터 없음 (KIS empty + KRX empty + CACHE empty)`
      : `KIS empty (휴장/장중 비활성 가능, marketCode=${marketCode || 'NONE'})`,
    rawDiagHidden: true,
  };
}

function buildUnsupportedOrFallback(
  input: ClassifyProgramMarketEmptyInput,
  rawStatus: string,
  marketCode: string,
): ProgramMarketRoutingDecision {
  // KRX 가 capability map 에서 marketWide 지원하지만 호출자가 fallback 시도 가능
  const krx = input.krxFallback;
  if (krx?.available === true && typeof krx.programNetBuyAmount === 'number' && Number.isFinite(krx.programNetBuyAmount)) {
    return {
      routedStatus: 'VERIFIED',
      source: 'KRX_API',
      rawStatus,
      scoring: 'allowed_when_non_empty',
      fallbackAttempted: true,
      fallbackResult: 'KRX_OK',
      textVariant: 'D_FALLBACK_OK',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail: `KIS 미지원 → KRX recovered (marketCode=${marketCode || 'NONE'})`,
      rawDiagHidden: true,
    };
  }
  return {
    routedStatus: 'UNSUPPORTED',
    source: 'KIS_API',
    rawStatus,
    scoring: 'excluded',
    fallbackAttempted: krx !== undefined,
    fallbackResult: krx !== undefined ? 'KRX_EMPTY' : 'NOT_TRIED',
    textVariant: 'B_UNSUPPORTED',
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    decisionDetail: `KIS 제공 미지원 (marketCode=${marketCode || 'NONE'}, KRX 직접 조회 필요)`,
    rawDiagHidden: true,
  };
}

/** stuck-empty 감지 입력 — 시간 관찰 SSOT. */
export interface ProgramMarketStuckObservation {
  routedStatus: ProgramMarketRoutedStatus;
  observedAt: number; // epoch ms
}

/**
 * 사용자 §H: stuck-empty 감지 — 30분 이상 동일 EMPTY_VALID/MISSING/UNSUPPORTED 지속 시 true.
 *
 * 첫 관찰 시점부터 PROGRAM_MARKET_STUCK_THRESHOLD_MS (30 min) 경과 + 그 동안 모든 관찰이 비-VERIFIED 면 stuck.
 */
export function detectProgramMarketStuckEmpty(
  observations: readonly ProgramMarketStuckObservation[],
  nowMs: number,
): { stuck: boolean; durationMs: number; statuses: ProgramMarketRoutedStatus[] } {
  if (!Array.isArray(observations) || observations.length === 0) {
    return { stuck: false, durationMs: 0, statuses: [] };
  }
  const sorted = [...observations].sort((a, b) => a.observedAt - b.observedAt);
  const nonVerified = sorted.every((o) => o.routedStatus !== 'VERIFIED');
  if (!nonVerified) {
    return { stuck: false, durationMs: 0, statuses: sorted.map((o) => o.routedStatus) };
  }
  const first = sorted[0];
  const durationMs = Math.max(0, nowMs - first.observedAt);
  return {
    stuck: durationMs >= PROGRAM_MARKET_STUCK_THRESHOLD_MS,
    durationMs,
    statuses: sorted.map((o) => o.routedStatus),
  };
}

/**
 * macroState 영속 데이터에서 cache fallback 입력 합성.
 * KIS_API source + programFetchedAt + programNetBuyAmount 모두 존재할 때만 활성.
 */
export function deriveCacheFallbackFromMacroState(
  macro: MacroState | null,
  nowMs: number,
  maxAgeMs: number = 4 * 60 * 60 * 1000, // 4h
): ProgramMarketCacheFallbackInput {
  if (!macro || macro.programSource !== 'KIS_API') {
    return { available: false };
  }
  if (typeof macro.programNetBuyAmount !== 'number' || !Number.isFinite(macro.programNetBuyAmount)) {
    return { available: false };
  }
  const fetchedAt = macro.programFetchedAt;
  if (!fetchedAt) {
    return { available: false };
  }
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) {
    return { available: false };
  }
  const ageMs = nowMs - fetchedMs;
  if (ageMs < 0 || ageMs > maxAgeMs) {
    return { available: false };
  }
  return {
    available: true,
    programNetBuyAmount: macro.programNetBuyAmount,
    fetchedAt,
    ageMs,
  };
}

/**
 * 사용자 §F: /supply_health · /scan_blockers 표시용 multi-line formatter.
 * Telegram 문구 변형 4종 (A/B/C/D) 자동 분기.
 * rawDiag 절대 노출 안 함 (사용자 §J #5).
 */
export function formatProgramMarketRouted(decision: ProgramMarketRoutingDecision): string[] {
  const variantLabel = (() => {
    switch (decision.textVariant) {
      case 'A_NO_DATA': return '데이터 없음';
      case 'B_UNSUPPORTED': return '제공 미지원';
      case 'C_PARAM_ISSUE': return '파라미터 점검 필요';
      case 'D_FALLBACK_OK': return decision.source === 'KRX_API' ? 'KRX recovered' : 'KIS verified';
    }
  })();
  const lines: string[] = [
    `route: KIS>KRX | fb=CACHE | diag=KIS | scoring=${decision.scoring}`,
    `source: ${decision.source}`,
    `status: ${decision.routedStatus === 'SESSION_CLOSED' ? 'SESSION_CLOSED' : decision.routedStatus}`,
    `routedStatus: ${decision.routedStatus}`,
    `rawStatus: ${decision.rawStatus}`,
    `fallback: ${decision.fallbackAttempted ? decision.fallbackResult : 'NOT_TRIED'}`,
    `scoring=${decision.scoring}`,
    'providerIssue=false',
    'marketSignal=false',
    'action=observe',
    `variant: ${decision.textVariant} (${variantLabel})`,
    `판정: ${decision.decisionDetail}`,
    'rawDiag: hidden (/program_market_raw 또는 Railway debug)',
    'executionImpact=NONE',
    '상세: /program_market',
  ];
  return lines;
}

/** 사용자 §F: /scan_blockers runtime 모드용 compact 1-line. */
export function formatProgramMarketRoutedCompact(decision: ProgramMarketRoutingDecision): string {
  const tag = '[PATCH-RUNTIME] (Patch-004)';
  return `${tag} programMarket: status=${decision.routedStatus} source=${decision.source} fallback=${decision.fallbackResult} scoring=${decision.scoring} executionImpact=NONE`;
}

/**
 * 사용자 §J #5: /program_market_raw 전용 rawDiag formatter.
 * Railway debug 로그 또는 dedicated command 에서만 노출.
 */
export function formatProgramMarketRawDiag(diag: ProgramMarketRawDiagInput): string[] {
  const lines: string[] = ['🔍 <b>[Program Market Raw Diagnostic]</b>', ''];
  lines.push(`endpoint: ${diag.endpoint ?? 'N/A'}`);
  lines.push(`trId: ${diag.trId ?? 'N/A'}`);
  lines.push(`marketCode: ${diag.marketCode ?? 'N/A'}`);
  if (diag.queryParams) {
    const paramStr = Object.entries(diag.queryParams).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`queryParams: ${paramStr || 'NONE'}`);
  }
  lines.push(`httpStatus: ${diag.httpStatus ?? 'N/A'}`);
  lines.push(`responseCode: ${diag.responseCode ?? diag.rtCd ?? 'N/A'}`);
  lines.push(`msgCd: ${diag.msgCd ?? 'N/A'}`);
  lines.push(`msg1: ${diag.msg1 ?? 'N/A'}`);
  lines.push(`zeroReason: ${diag.zeroReason ?? 'N/A'}`);
  lines.push(`outputLength: ${diag.outputLength ?? 'N/A'}`);
  lines.push(`outputKeys: ${diag.outputKeys?.slice(0, 8).join(', ') || 'NONE'}`);
  if (diag.firstRowSample) {
    const sampleStr = Object.entries(diag.firstRowSample).slice(0, 8).map(([k, v]) => `${k}:${v ?? 'NULL'}`).join(', ');
    lines.push(`firstRowSample: ${sampleStr || 'NONE'}`);
  }
  lines.push(`requestedAt: ${diag.requestedAt ?? 'N/A'}`);
  lines.push(`providerLatencyMs: ${diag.providerLatencyMs ?? 'N/A'}`);
  lines.push('');
  lines.push('⚠️ rawDiag 는 Telegram 일반 알림에 노출되지 않음 (Patch-004 §J #5).');
  lines.push('executionImpact=NONE, providerIssue=false, marketSignal=false');
  return lines;
}

/**
 * 사용자 §J #9: stuck-empty 감지 시 Railway 진단 로그 발화.
 * Telegram 자동 알림 절대 금지 (사용자 §I `telegramAllowed: false` 정합).
 */
export function logProgramMarketStuckIfNeeded(
  observations: readonly ProgramMarketStuckObservation[],
  nowMs: number,
  marketCode = '',
): { logged: boolean; stuck: boolean } {
  const result = detectProgramMarketStuckEmpty(observations, nowMs);
  if (!result.stuck) return { logged: false, stuck: false };
  console.warn(
    `[PROGRAM_MARKET_STUCK_EMPTY] durationMs=${result.durationMs} statuses=${result.statuses.join(',')} marketCode=${marketCode || 'NONE'} providerIssue=false marketSignal=false executionImpact=NONE telegramAllowed=false`,
  );
  return { logged: true, stuck: true };
}
