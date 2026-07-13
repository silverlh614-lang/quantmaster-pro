// @responsibility Patch-006 KIS empty → KRX aggregate fallback router SSOT.

// =====================================================================
// Patch-MARKET-PROGRAM-TRADING-FALLBACK-RECOVERY-006 SSOT
//
// 사용자 핵심 framing (절대 변경 금지):
//   "KIS empty 는 bearish signal 이 아니다."
//   "KIS empty 는 providerIssue 도 아니다."
//   "하지만 KIS empty 는 fallback trigger 다."
//   "시장 프로그램매매 데이터가 없으면 scoring 은 제외한다."
//   "데이터 공백은 executionImpact=NONE 으로 유지한다."
//
// Patch-004 (PR #941) 가 KRX_API capability 만 declare 하고 actual fetcher wiring
// 을 후속 PR scope 로 분리했음. Patch-006 가 그 wiring 을 actual KRX fetcher
// (programTradeFetcher.ts) + KOSPI/KOSDAQ aggregate + 3-tier CACHE TTL +
// intraday session 분류로 완성.
//
// 본 SSOT 는 Patch-004 의 결정 트리 위에 stack — Patch-004 본체 무수정 + 8th
// status (PARTIAL_VERIFIED) + 9th status (UNSUPPORTED_INTRADAY) + 3-tier cache
// status 만 union 확장.
// =====================================================================

import {
  routeProgramMarketEmpty,
  formatProgramMarketRouted,
  PROGRAM_MARKET_PROVIDER_COVERAGE,
  type ClassifyProgramMarketEmptyInput,
  type ProgramMarketRoutingDecision,
  type ProgramMarketRoutedStatus,
  type ProgramMarketRoutedSource,
  type ProgramMarketScoringPolicy,
  type ProgramMarketTextVariant,
  type ProgramMarketCacheFallbackInput,
} from '../kisClient/programMarketRouterPatch004.js';
import {
  fetchKrxMarketProgramTradeAggregate,
  isKrxMarketProgramFallbackDisabled,
  isKstIntradaySession,
  type KrxMarketProgramAggregate,
} from './programTradeFetcher.js';
import {
  fetchKrxIntradayProgramTradeAggregate,
  isKrxIntradayMarketProgramEnabled,
} from './intradayProgramTradeFetcher.js';
import { logVisibilityEvent } from '../../utils/logger.js';

/** Patch-006 patch identifier (static grep guard SSOT). */
export const PATCH_006_IDENTIFIER = 'Patch-MARKET-PROGRAM-TRADING-FALLBACK-RECOVERY-006';

/** ENV gate SSOT (ADR-0157 정확 비교 의무). */
export function isPatch006Disabled(): boolean {
  return process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED === 'true';
}

/** 사용자 §7: 8-state final routedStatus + Patch-004 호환 union (절대 변경 금지). */
type ProgramMarketRoutedStatusV2 =
  | ProgramMarketRoutedStatus       // 7 from Patch-004: VERIFIED/EMPTY_VALID/UNSUPPORTED/PARAM_MISMATCH/STALE_CACHE/DEGRADED/MISSING
  | 'PARTIAL_VERIFIED'              // 8th — KOSPI 또는 KOSDAQ 한쪽만 KRX 회복
  | 'UNSUPPORTED_INTRADAY'          // 9th — 장중 KRX 미지원 (intraday endpoint 미제공)
  | 'SHAPE_CANDIDATE'                // Patch-007 — row exists but mapper is not verified (OBSERVE only)
  | 'SHAPE_VERIFIED'                 // Patch-007 — reserved for 3-business-day verified mapping
  | 'STALE_CACHE_BUT_USABLE_FOR_DIAG'  // 10th — 5min 이내 (사용자 §3 #1)
  | 'STALE_CACHE_SHADOW_ONLY'       // 11th — 5~30min (사용자 §3 #2)
  | 'CACHE_EXPIRED'                 // 12th — 30min+ (사용자 §3 #3)
  | 'SESSION_CLOSED'                // 장외/휴장: intraday-only program trading not evaluated
  | 'SESSION_CLOSED_NOT_APPLICABLE';

/** 사용자 §3: CACHE TTL tier (절대 변경 금지). */
export const PATCH_006_CACHE_FRESH_MS = 5 * 60 * 1000;        // 5min — STALE_CACHE_BUT_USABLE_FOR_DIAG
export const PATCH_006_CACHE_SHADOW_MS = 30 * 60 * 1000;      // 30min — STALE_CACHE_SHADOW_ONLY
// 30min+ → CACHE_EXPIRED (excluded)

/** 프로그램매매 데이터 평가 가능 여부 SSOT — 매매 허용/차단 판단에 사용하지 않는다. */
export function isProgramTradingIntradaySession(now: Date | number = Date.now()): boolean {
  return isKstIntradaySession(now instanceof Date ? now.getTime() : now);
}

/** 사용자 §10 (D variant): Telegram 4-case display branches 라벨. */
type ProgramMarketDisplayCase =
  | 'A_KRX_RECOVERED'           // KRX fallback 성공
  | 'B_ALL_FAILED'              // 모든 provider empty
  | 'C_UNSUPPORTED_INTRADAY'    // 장중 KRX 미지원
  | 'D_PARAM_MISMATCH'          // 파라미터 문제
  | 'E_CACHE_USABLE'            // CACHE_BUT_USABLE_FOR_DIAG (≤5min)
  | 'F_CACHE_SHADOW_ONLY'       // CACHE_SHADOW_ONLY (5-30min)
  | 'G_PARTIAL_VERIFIED'        // KOSPI 또는 KOSDAQ 만 회복
  | 'H_KIS_VERIFIED'            // KIS 정상 응답
  | 'I_SESSION_CLOSED_NOT_APPLICABLE'
  | 'J_SHAPE_CANDIDATE';

/** 사용자 §6: KOSPI/KOSDAQ aggregate 진단 메타. */
export interface ProgramMarketAggregateMeta {
  kospiProgramNet: number | null;        // 억원
  kosdaqProgramNet: number | null;
  totalProgramNet: number | null;        // 합산
  arbitrageNet: number | null;           // 차익 합산
  nonArbitrageNet: number | null;        // 비차익 합산
  confidence: 'VERIFIED' | 'PARTIAL' | 'EMPTY';
  marketsAttempted: string[];
  marketsSucceeded: string[];
}

interface ProgramMarketShapeProbeMeta {
  confidence: 'EMPTY' | 'SHAPE_CANDIDATE';
  topLevelKeys: string[];
  shapeCandidatePath: string | null;
  rowCount: number;
  firstRowKeys: string[];
  numericFieldCandidates: string[];
  firstRowSample: Record<string, unknown> | null;
  bld: string;
  promotionGuard: 'THREE_BUSINESS_DAYS_MAPPING_REQUIRED';
}

/** 사용자 §3: CACHE TTL 분류 결과. */
export interface CacheTtlClassification {
  tier: 'FRESH' | 'SHADOW_ONLY' | 'EXPIRED';
  ageMs: number;
  routedStatus: 'STALE_CACHE_BUT_USABLE_FOR_DIAG' | 'STALE_CACHE_SHADOW_ONLY' | 'CACHE_EXPIRED';
  scoring: ProgramMarketScoringPolicy;
}

/** 사용자 §D: V2 routing decision. */
export interface ProgramMarketRoutingDecisionV2 {
  routedStatus: ProgramMarketRoutedStatusV2;
  source: ProgramMarketRoutedSource;
  rawStatus: string;
  scoring: ProgramMarketScoringPolicy;
  fallbackAttempted: boolean;
  fallbackResult: ProgramMarketRoutingDecision['fallbackResult'];
  textVariant: ProgramMarketTextVariant;
  displayCase: ProgramMarketDisplayCase;
  isIntradaySession: boolean;
  krxAttempted: boolean;
  krxAggregate: ProgramMarketAggregateMeta | null;
  cacheTtl: CacheTtlClassification | null;
  providerIssue: false;            // 사용자 §I literal 강제
  marketSignal: false;              // 사용자 §I literal 강제
  executionImpact: 'NONE';          // 사용자 §I literal 강제
  liveExecutionAllowed: false;      // literal 강제
  decisionDetail: string;
  rawDiagHidden: true;              // /program_market_raw 만 노출
  patch006Activated: boolean;       // Patch-006 활성화 여부 (ENV / aggregate 가용성)
  // Patch-007 KRX intraday endpoint wiring (모두 옵셔널 후방호환).
  intradayWiringAttempted?: boolean;     // intraday endpoint 호출 시도 여부
  intradayWiringSucceeded?: boolean;     // intraday endpoint 가 정상 응답 (VERIFIED / PARTIAL)
  intradayAggregate?: ProgramMarketAggregateMeta | null;
  intradayShapeProbe?: ProgramMarketShapeProbeMeta | null;
}

/** 사용자 §3: cache age 를 3-tier 로 분류. */
export function classifyCacheTtl(
  cache: ProgramMarketCacheFallbackInput | undefined,
): CacheTtlClassification | null {
  if (!cache || cache.available !== true || typeof cache.ageMs !== 'number' || !Number.isFinite(cache.ageMs)) {
    return null;
  }
  const ageMs = Math.max(0, cache.ageMs);
  if (ageMs <= PATCH_006_CACHE_FRESH_MS) {
    return {
      tier: 'FRESH',
      ageMs,
      routedStatus: 'STALE_CACHE_BUT_USABLE_FOR_DIAG',
      scoring: 'shadow_only_or_excluded',
    };
  }
  if (ageMs <= PATCH_006_CACHE_SHADOW_MS) {
    return {
      tier: 'SHADOW_ONLY',
      ageMs,
      routedStatus: 'STALE_CACHE_SHADOW_ONLY',
      scoring: 'shadow_only_or_excluded',
    };
  }
  return {
    tier: 'EXPIRED',
    ageMs,
    routedStatus: 'CACHE_EXPIRED',
    scoring: 'excluded',
  };
}

/** 사용자 §6: KrxMarketProgramAggregate → ProgramMarketAggregateMeta SSOT 변환. */
export function aggregateToMeta(aggregate: KrxMarketProgramAggregate | null): ProgramMarketAggregateMeta | null {
  if (!aggregate) return null;
  return {
    kospiProgramNet: aggregate.kospi?.programNetBuyAmount ?? null,
    kosdaqProgramNet: aggregate.kosdaq?.programNetBuyAmount ?? null,
    totalProgramNet: aggregate.totalProgramNet,
    arbitrageNet: aggregate.arbitrageNet,
    nonArbitrageNet: aggregate.nonArbitrageNet,
    confidence: aggregate.confidence,
    marketsAttempted: [...aggregate.marketsAttempted],
    marketsSucceeded: [...aggregate.marketsSucceeded],
  };
}

function shapeProbeToMeta(aggregate: KrxMarketProgramAggregate | null): ProgramMarketShapeProbeMeta | null {
  const probe = aggregate?.intradayShapeProbe;
  if (!probe) return null;
  return {
    confidence: probe.confidence,
    topLevelKeys: [...probe.topLevelKeys],
    shapeCandidatePath: probe.shapeCandidatePath,
    rowCount: probe.rowCount,
    firstRowKeys: [...probe.firstRowKeys],
    numericFieldCandidates: [...probe.numericFieldCandidates],
    firstRowSample: probe.firstRowSample ? { ...probe.firstRowSample } : null,
    bld: probe.bld,
    promotionGuard: 'THREE_BUSINESS_DAYS_MAPPING_REQUIRED',
  };
}

/** 사용자 §10: routedStatus → displayCase 매핑 SSOT. */
function deriveDisplayCase(
  routedStatus: ProgramMarketRoutedStatusV2,
  source: ProgramMarketRoutedSource,
): ProgramMarketDisplayCase {
  switch (routedStatus) {
    case 'VERIFIED':
      return source === 'KRX_API' ? 'A_KRX_RECOVERED' : 'H_KIS_VERIFIED';
    case 'PARTIAL_VERIFIED':
      return 'G_PARTIAL_VERIFIED';
    case 'UNSUPPORTED_INTRADAY':
      return 'C_UNSUPPORTED_INTRADAY';
    case 'SHAPE_CANDIDATE':
    case 'SHAPE_VERIFIED':
      return 'J_SHAPE_CANDIDATE';
    case 'SESSION_CLOSED':
    case 'SESSION_CLOSED_NOT_APPLICABLE':
      return 'I_SESSION_CLOSED_NOT_APPLICABLE';
    case 'PARAM_MISMATCH':
      return 'D_PARAM_MISMATCH';
    case 'STALE_CACHE_BUT_USABLE_FOR_DIAG':
      return 'E_CACHE_USABLE';
    case 'STALE_CACHE_SHADOW_ONLY':
    case 'STALE_CACHE':
      return 'F_CACHE_SHADOW_ONLY';
    case 'CACHE_EXPIRED':
    case 'EMPTY_VALID':
    case 'UNSUPPORTED':
    case 'DEGRADED':
    case 'MISSING':
    default:
      return 'B_ALL_FAILED';
  }
}

/**
 * Patch-006 메인 진입점 — KIS empty 시 actual KRX aggregate fetch + CACHE TTL tier 분류.
 *
 * 결정 트리 우선순위 (사용자 §1 정합):
 *   1. ENV disabled → Patch-004 직접 위임
 *   2. KIS empty (zeroReason in {ACCEPTED_EMPTY, OUTPUT_EMPTY, FIELD_MISSING, SESSION_UNAVAILABLE, PROVIDER_ERROR}) → KRX fetch
 *   3. KRX aggregate 결과별 routing
 *      - confidence='VERIFIED' (KOSPI+KOSDAQ 둘 다) → routedStatus=VERIFIED + source=KRX_API + scoring=allowed_when_non_empty
 *      - confidence='PARTIAL' (한쪽만) → routedStatus=PARTIAL_VERIFIED + source=KRX_API + scoring=allowed_when_non_empty (사용자 §8: reduced_weight or shadow_only)
 *      - confidence='EMPTY' (둘 다 fail) + intradaySession → routedStatus=UNSUPPORTED_INTRADAY
 *      - confidence='EMPTY' + 비-intraday + cache 가용 → CACHE TTL tier 분류
 *      - 그 외 → Patch-004 결정 그대로 (EMPTY_VALID / MISSING)
 *   4. 정상 응답 (zeroReason=null/NON_ZERO) → Patch-004 결정 그대로 (VERIFIED + KIS_API)
 */
export async function routeProgramMarketEmptyWithKrxAggregate(
  input: ClassifyProgramMarketEmptyInput,
  options: {
    fetchKrx?: () => Promise<KrxMarketProgramAggregate | null>;
    nowMs?: number;
  } = {},
): Promise<ProgramMarketRoutingDecisionV2> {
  const nowMs = options.nowMs ?? Date.now();
  const intradaySession = isProgramTradingIntradaySession(nowMs);

  // ENV disable → Patch-004 직접 위임 (V2 형식으로 wrap)
  if (isPatch006Disabled()) {
    const v1 = routeProgramMarketEmpty(input);
    return wrapV1Decision(v1, {
      isIntradaySession: intradaySession,
      krxAttempted: false,
      krxAggregate: null,
      cacheTtl: null,
      patch006Activated: false,
    });
  }

  const rawZeroReason = input.rawDiag?.zeroReason ?? null;
  const isEmptyTrigger =
    rawZeroReason === 'ACCEPTED_EMPTY' ||
    rawZeroReason === 'OUTPUT_EMPTY' ||
    rawZeroReason === 'FIELD_MISSING' ||
    rawZeroReason === 'SESSION_UNAVAILABLE' ||
    rawZeroReason === 'PROVIDER_ERROR' ||
    rawZeroReason === 'FETCH_FAIL' ||
    rawZeroReason === 'RAW_ZERO' ||
    (input.rawDiag?.outputLength === 0);

  // 정상 응답 또는 PARAM_ERROR → Patch-004 처리 그대로
  if (!isEmptyTrigger) {
    const v1 = routeProgramMarketEmpty(input);
    return wrapV1Decision(v1, {
      isIntradaySession: intradaySession,
      krxAttempted: false,
      krxAggregate: null,
      cacheTtl: classifyCacheTtl(input.cacheFallback),
      patch006Activated: true,
    });
  }

  // PARAM_ERROR/PARAM_MISMATCH 우선 처리 (KRX 호출 안 함)
  if (rawZeroReason === 'PARAM_ERROR' || rawZeroReason === 'PARAM_MISMATCH') {
    const v1 = routeProgramMarketEmpty(input);
    return wrapV1Decision(v1, {
      isIntradaySession: intradaySession,
      krxAttempted: false,
      krxAggregate: null,
      cacheTtl: null,
      patch006Activated: true,
    });
  }

  if (!intradaySession) {
    logVisibilityEvent({
      visibility: 'DIAGNOSTIC',
      category: 'PROGRAM',
      message:
        `[PROGRAM_TRADING_SESSION_CLOSED] scope=MARKET sessionState=CLOSED status=SESSION_CLOSED ` +
        `scoring=excluded_afterhours action=observe providerIssue=false marketSignal=false ` +
        `executionImpact=NONE reason=${rawZeroReason ?? 'EMPTY'} fallbackAttempted=false`,
      summary: { scope: 'MARKET', status: 'SESSION_CLOSED', executionImpact: 'NONE' },
      details: { rawZeroReason: rawZeroReason ?? 'EMPTY', fallbackAttempted: false },
      level: 'info',
      executionImpact: 'NONE',
    });
    return {
      routedStatus: 'SESSION_CLOSED',
      source: 'NONE',
      rawStatus: rawZeroReason ?? 'SESSION_CLOSED_EMPTY',
      scoring: 'excluded_afterhours',
      fallbackAttempted: false,
      fallbackResult: 'NOT_TRIED',
      textVariant: 'B_UNSUPPORTED',
      displayCase: 'I_SESSION_CLOSED_NOT_APPLICABLE',
      isIntradaySession: false,
      krxAttempted: false,
      krxAggregate: null,
      cacheTtl: classifyCacheTtl(input.cacheFallback),
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail: 'MARKET_PROGRAM_INTRADAY_ONLY_SESSION_CLOSED',
      rawDiagHidden: true,
      patch006Activated: true,
    };
  }

  // 사용자 §1 #2: KIS empty → KRX fallback 실제 호출
  let aggregate: KrxMarketProgramAggregate | null = null;
  let krxAttempted = false;
  if (!isKrxMarketProgramFallbackDisabled()) {
    krxAttempted = true;
    const fetcher = options.fetchKrx ?? (() => fetchKrxMarketProgramTradeAggregate(nowMs));
    try {
      // 사용자 §2: [MARKET_PROGRAM_KRX_FALLBACK_START] Railway 진단 로그
      console.info(
        `[MARKET_PROGRAM_KRX_FALLBACK_START] reason=${rawZeroReason ?? 'EMPTY'} intradaySession=${intradaySession} executionImpact=NONE providerIssue=false`,
      );
      aggregate = await fetcher();
      console.info(
        `[MARKET_PROGRAM_KRX_FALLBACK_RESULT] confidence=${aggregate?.confidence ?? 'NONE'} marketsSucceeded=${aggregate?.marketsSucceeded?.join(',') ?? 'NONE'} totalProgramNet=${aggregate?.totalProgramNet ?? 'N/A'}`,
      );
    } catch (err) {
      // KRX throw → confidence='EMPTY' 처리 (graceful)
      console.warn(
        `[MARKET_PROGRAM_KRX_FALLBACK_RESULT] confidence=ERROR err=${err instanceof Error ? err.message : String(err)} executionImpact=NONE`,
      );
      aggregate = null;
    }
  }

  const aggregateMeta = aggregateToMeta(aggregate);
  const cacheTtl = classifyCacheTtl(input.cacheFallback);

  // KRX aggregate confidence 별 분기
  if (aggregate && aggregate.confidence === 'VERIFIED') {
    return {
      routedStatus: 'VERIFIED',
      source: 'KRX_API',
      rawStatus: rawZeroReason ?? 'UNKNOWN',
      scoring: 'allowed_when_non_empty',
      fallbackAttempted: true,
      fallbackResult: 'KRX_OK',
      textVariant: 'D_FALLBACK_OK',
      displayCase: 'A_KRX_RECOVERED',
      isIntradaySession: intradaySession,
      krxAttempted,
      krxAggregate: aggregateMeta,
      cacheTtl,
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail: `KIS empty → KRX recovered (KOSPI+KOSDAQ, total=${aggregate.totalProgramNet ?? 'N/A'}억원)`,
      rawDiagHidden: true,
      patch006Activated: true,
    };
  }

  if (aggregate && aggregate.confidence === 'PARTIAL') {
    return {
      routedStatus: 'PARTIAL_VERIFIED',
      source: 'KRX_API',
      rawStatus: rawZeroReason ?? 'UNKNOWN',
      // 사용자 §8: PARTIAL_VERIFIED → reduced_weight or shadow_only — 보수적으로 shadow_only_or_excluded 채택
      scoring: 'shadow_only_or_excluded',
      fallbackAttempted: true,
      fallbackResult: 'KRX_OK',
      textVariant: 'D_FALLBACK_OK',
      displayCase: 'G_PARTIAL_VERIFIED',
      isIntradaySession: intradaySession,
      krxAttempted,
      krxAggregate: aggregateMeta,
      cacheTtl,
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail: `KIS empty → KRX partial (succeeded=${aggregate.marketsSucceeded.join(',')}, total=${aggregate.totalProgramNet ?? 'N/A'}억원)`,
      rawDiagHidden: true,
      patch006Activated: true,
    };
  }

  // KRX confidence='EMPTY' → intraday session 분류
  if (intradaySession) {
    // Patch-007: UNSUPPORTED_INTRADAY 전에 intraday endpoint candidate (MDCSTAT00301) 시도.
    // ENV `KRX_INTRADAY_MARKET_PROGRAM_ENABLED=true` opt-in (default OFF — endpoint shape 검증 의무).
    let intradayAggregate: KrxMarketProgramAggregate | null = null;
    let intradayWiringAttempted = false;
    if (isKrxIntradayMarketProgramEnabled()) {
      intradayWiringAttempted = true;
      try {
        console.info(
          `[MARKET_PROGRAM_KRX_INTRADAY_FALLBACK_START] reason=${rawZeroReason ?? 'EMPTY'} eodConfidence=EMPTY executionImpact=NONE providerIssue=false`,
        );
        intradayAggregate = await fetchKrxIntradayProgramTradeAggregate(nowMs);
        console.info(
          `[MARKET_PROGRAM_KRX_INTRADAY_FALLBACK_RESULT] confidence=${intradayAggregate.confidence} marketsSucceeded=${intradayAggregate.marketsSucceeded.join(',') || 'NONE'} totalProgramNet=${intradayAggregate.totalProgramNet ?? 'N/A'}`,
        );
      } catch (err) {
        console.warn(
          `[MARKET_PROGRAM_KRX_INTRADAY_FALLBACK_RESULT] confidence=ERROR err=${err instanceof Error ? err.message : String(err)} executionImpact=NONE`,
        );
        intradayAggregate = null;
      }
    }

    const intradayMeta = aggregateToMeta(intradayAggregate);
    const intradayWiringSucceeded =
      intradayAggregate !== null && intradayAggregate.confidence !== 'EMPTY';

    if (intradayWiringSucceeded && intradayAggregate) {
      const isPartial = intradayAggregate.confidence === 'PARTIAL';
      return {
        routedStatus: isPartial ? 'PARTIAL_VERIFIED' : 'VERIFIED',
        source: 'KRX_API',
        rawStatus: rawZeroReason ?? 'UNKNOWN',
        scoring: isPartial ? 'shadow_only_or_excluded' : 'allowed_when_non_empty',
        fallbackAttempted: true,
        fallbackResult: 'KRX_OK',
        textVariant: 'D_FALLBACK_OK',
        displayCase: isPartial ? 'G_PARTIAL_VERIFIED' : 'A_KRX_RECOVERED',
        isIntradaySession: true,
        krxAttempted,
        krxAggregate: aggregateMeta,
        cacheTtl,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        decisionDetail: `KIS empty + KRX EOD empty → KRX intraday recovered (succeeded=${intradayAggregate.marketsSucceeded.join(',')}, total=${intradayAggregate.totalProgramNet ?? 'N/A'}억원)`,
        rawDiagHidden: true,
        patch006Activated: true,
        intradayWiringAttempted,
        intradayWiringSucceeded,
        intradayAggregate: intradayMeta,
      };
    }

    const intradayShapeProbe = shapeProbeToMeta(intradayAggregate);
    if (intradayShapeProbe?.confidence === 'SHAPE_CANDIDATE') {
      return {
        routedStatus: 'SHAPE_CANDIDATE',
        source: 'KRX_API',
        rawStatus: rawZeroReason ?? 'UNKNOWN',
        scoring: 'excluded',
        fallbackAttempted: true,
        fallbackResult: 'KRX_EMPTY',
        textVariant: 'B_UNSUPPORTED',
        displayCase: 'J_SHAPE_CANDIDATE',
        isIntradaySession: true,
        krxAttempted,
        krxAggregate: aggregateMeta,
        cacheTtl,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        decisionDetail: `KRX intraday row count > 0 but mapper unverified (path=${intradayShapeProbe.shapeCandidatePath ?? 'N/A'}, rows=${intradayShapeProbe.rowCount}); 3영업일 연속 mapping 성공 전까지 OBSERVE only`,
        rawDiagHidden: true,
        patch006Activated: true,
        intradayWiringAttempted,
        intradayWiringSucceeded: false,
        intradayAggregate: intradayMeta,
        intradayShapeProbe,
      };
    }

    return {
      routedStatus: 'UNSUPPORTED_INTRADAY',
      source: 'NONE',
      rawStatus: rawZeroReason ?? 'UNKNOWN',
      scoring: 'excluded',
      fallbackAttempted: krxAttempted,
      fallbackResult: krxAttempted ? 'KRX_EMPTY' : 'NOT_TRIED',
      textVariant: 'B_UNSUPPORTED',
      displayCase: 'C_UNSUPPORTED_INTRADAY',
      isIntradaySession: true,
      krxAttempted,
      krxAggregate: aggregateMeta,
      cacheTtl,
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail: intradayWiringAttempted
        ? 'KRX EOD + intraday endpoint 모두 empty (intraday endpoint shape 또는 BLD ID 미검증 가능성)'
        : 'KRX 장중 프로그램매매 endpoint 미제공 (intraday session, EOD endpoint 만 존재, intraday wiring 비활성)',
      rawDiagHidden: true,
      patch006Activated: true,
      intradayWiringAttempted,
      intradayWiringSucceeded: false,
      intradayAggregate: intradayMeta,
      intradayShapeProbe: shapeProbeToMeta(intradayAggregate),
    };
  }

  // CACHE TTL tier 분류 (intraday 외 + KRX empty 시점)
  if (cacheTtl) {
    const decisionDetail = (() => {
      if (cacheTtl.tier === 'FRESH') {
        return `KIS empty + KRX empty → CACHE FRESH (≤5min, age=${cacheTtl.ageMs}ms, diag-only)`;
      }
      if (cacheTtl.tier === 'SHADOW_ONLY') {
        return `KIS empty + KRX empty → CACHE SHADOW_ONLY (5-30min, age=${cacheTtl.ageMs}ms)`;
      }
      return `KIS empty + KRX empty → CACHE EXPIRED (>30min, age=${cacheTtl.ageMs}ms, excluded)`;
    })();
    return {
      routedStatus: cacheTtl.routedStatus,
      source: cacheTtl.tier === 'EXPIRED' ? 'NONE' : 'CACHE',
      rawStatus: rawZeroReason ?? 'UNKNOWN',
      scoring: cacheTtl.scoring,
      fallbackAttempted: true,
      fallbackResult: cacheTtl.tier === 'EXPIRED' ? 'CACHE_EMPTY' : 'CACHE_OK',
      textVariant: 'A_NO_DATA',
      displayCase: cacheTtl.tier === 'FRESH' ? 'E_CACHE_USABLE'
        : cacheTtl.tier === 'SHADOW_ONLY' ? 'F_CACHE_SHADOW_ONLY'
        : 'B_ALL_FAILED',
      isIntradaySession: intradaySession,
      krxAttempted,
      krxAggregate: aggregateMeta,
      cacheTtl,
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      decisionDetail,
      rawDiagHidden: true,
      patch006Activated: true,
    };
  }

  // 모든 fallback 실패 → MISSING
  return {
    routedStatus: 'MISSING',
    source: 'NONE',
    rawStatus: rawZeroReason ?? 'UNKNOWN',
    scoring: 'excluded',
    fallbackAttempted: krxAttempted,
    fallbackResult: krxAttempted ? 'ALL_FAILED' : 'NOT_TRIED',
    textVariant: 'A_NO_DATA',
    displayCase: 'B_ALL_FAILED',
    isIntradaySession: intradaySession,
    krxAttempted,
    krxAggregate: aggregateMeta,
    cacheTtl: null,
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    decisionDetail: 'KIS empty + KRX empty + CACHE 부재 (모든 provider 데이터 없음)',
    rawDiagHidden: true,
    patch006Activated: true,
  };
}

/** Patch-004 v1 decision 을 V2 형식으로 wrap (호환 유지). */
function wrapV1Decision(
  v1: ProgramMarketRoutingDecision,
  meta: {
    isIntradaySession: boolean;
    krxAttempted: boolean;
    krxAggregate: ProgramMarketAggregateMeta | null;
    cacheTtl: CacheTtlClassification | null;
    patch006Activated: boolean;
  },
): ProgramMarketRoutingDecisionV2 {
  return {
    routedStatus: v1.routedStatus as ProgramMarketRoutedStatusV2,
    source: v1.source,
    rawStatus: v1.rawStatus,
    scoring: v1.scoring,
    fallbackAttempted: v1.fallbackAttempted,
    fallbackResult: v1.fallbackResult,
    textVariant: v1.textVariant,
    displayCase: deriveDisplayCase(v1.routedStatus as ProgramMarketRoutedStatusV2, v1.source),
    isIntradaySession: meta.isIntradaySession,
    krxAttempted: meta.krxAttempted,
    krxAggregate: meta.krxAggregate,
    cacheTtl: meta.cacheTtl,
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    decisionDetail: v1.decisionDetail,
    rawDiagHidden: true,
    patch006Activated: meta.patch006Activated,
  };
}

/**
 * 사용자 §10: V2 routedStatus → 4-case display 분기 + Telegram 표시 multi-line.
 * Patch-004 formatProgramMarketRouted 위에 V2 메타 (KRX aggregate / cache TTL / intraday) 추가.
 */
export function formatProgramMarketRoutedV2(decision: ProgramMarketRoutingDecisionV2): string[] {
  const v1Like: ProgramMarketRoutingDecision = {
    routedStatus: (decision.routedStatus === 'PARTIAL_VERIFIED' ? 'STALE_CACHE'
      : decision.routedStatus === 'SHAPE_CANDIDATE' ? 'UNSUPPORTED'
      : decision.routedStatus === 'SHAPE_VERIFIED' ? 'UNSUPPORTED'
      : decision.routedStatus === 'UNSUPPORTED_INTRADAY' ? 'UNSUPPORTED'
      : decision.routedStatus === 'SESSION_CLOSED' ? 'SESSION_CLOSED'
      : decision.routedStatus === 'SESSION_CLOSED_NOT_APPLICABLE' ? 'SESSION_CLOSED'
      : decision.routedStatus === 'STALE_CACHE_BUT_USABLE_FOR_DIAG' ? 'STALE_CACHE'
      : decision.routedStatus === 'STALE_CACHE_SHADOW_ONLY' ? 'STALE_CACHE'
      : decision.routedStatus === 'CACHE_EXPIRED' ? 'MISSING'
      : decision.routedStatus) as ProgramMarketRoutedStatus,
    source: decision.source,
    rawStatus: decision.rawStatus,
    scoring: decision.scoring,
    fallbackAttempted: decision.fallbackAttempted,
    fallbackResult: decision.fallbackResult,
    textVariant: decision.textVariant,
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    decisionDetail: decision.decisionDetail,
    rawDiagHidden: true,
  };
  const baseLines = formatProgramMarketRouted(v1Like);
  const v2Lines: string[] = [];

  // V2 격상 라인: routedStatus 정확 노출 + displayCase + intraday + KRX aggregate
  v2Lines.push(`routedStatusV2: ${decision.routedStatus}`);
  v2Lines.push(`displayCase: ${decision.displayCase}`);
  v2Lines.push(`intradaySession: ${decision.isIntradaySession}`);
  if (decision.krxAttempted) {
    if (decision.krxAggregate) {
      v2Lines.push(
        `krx: confidence=${decision.krxAggregate.confidence} kospi=${formatEokwon(decision.krxAggregate.kospiProgramNet)} kosdaq=${formatEokwon(decision.krxAggregate.kosdaqProgramNet)} total=${formatEokwon(decision.krxAggregate.totalProgramNet)}`,
      );
      v2Lines.push(`krxMarkets: attempted=${decision.krxAggregate.marketsAttempted.join(',')} succeeded=${decision.krxAggregate.marketsSucceeded.join(',')}`);
    } else {
      v2Lines.push('krx: confidence=ERROR (fetch failed or null)');
    }
  } else {
    v2Lines.push('krx: NOT_ATTEMPTED');
  }
  if (decision.cacheTtl) {
    v2Lines.push(`cacheTtl: tier=${decision.cacheTtl.tier} ageMs=${decision.cacheTtl.ageMs} → ${decision.cacheTtl.routedStatus}`);
  }
  v2Lines.push(`patch006: activated=${decision.patch006Activated}`);
  // Patch-007: intraday endpoint wiring 진단 라인 (intradayWiringAttempted=true 일 때만 노출).
  if (decision.intradayWiringAttempted === true) {
    if (decision.intradayWiringSucceeded === true && decision.intradayAggregate) {
      v2Lines.push(
        `krxIntraday: confidence=${decision.intradayAggregate.confidence} kospi=${formatEokwon(decision.intradayAggregate.kospiProgramNet)} kosdaq=${formatEokwon(decision.intradayAggregate.kosdaqProgramNet)} total=${formatEokwon(decision.intradayAggregate.totalProgramNet)}`,
      );
      v2Lines.push(`krxIntradayMarkets: attempted=${decision.intradayAggregate.marketsAttempted.join(',')} succeeded=${decision.intradayAggregate.marketsSucceeded.join(',')}`);
    } else {
      v2Lines.push('krxIntraday: confidence=EMPTY (endpoint shape/BLD ID 미검증 가능성)');
    }
  }
  if (decision.intradayShapeProbe) {
    v2Lines.push(`krxIntradayShape: confidence=${decision.intradayShapeProbe.confidence} path=${decision.intradayShapeProbe.shapeCandidatePath ?? 'NONE'} rows=${decision.intradayShapeProbe.rowCount}`);
    v2Lines.push(`krxIntradayKeys: top=${decision.intradayShapeProbe.topLevelKeys.join(',') || 'NONE'} firstRow=${decision.intradayShapeProbe.firstRowKeys.slice(0, 12).join(',') || 'NONE'}`);
    v2Lines.push(`krxIntradayNumericCandidates: ${decision.intradayShapeProbe.numericFieldCandidates.slice(0, 12).join(',') || 'NONE'}`);
    v2Lines.push('promotionGuard: 3영업일 연속 row>0 + field mapping 성공 전까지 scoring=excluded');
  }

  return [...baseLines, ...v2Lines];
}

/** /scan_blockers runtime compact line. */
export function formatProgramMarketRoutedV2Compact(decision: ProgramMarketRoutingDecisionV2): string {
  const tag = '[PATCH-RUNTIME] (Patch-006)';
  if (decision.routedStatus === 'UNSUPPORTED_INTRADAY') {
    return `${tag} programMarket: status=UNSUPPORTED_INTRADAY source=NONE reason=KIS accepted empty + KRX intraday empty scoring=excluded action=observe providerIssue=false marketSignal=false executionImpact=NONE detail=/program_market_raw`;
  }
  return `${tag} programMarket: status=${decision.routedStatus} source=${decision.source} fallback=${decision.fallbackResult} display=${decision.displayCase} intraday=${decision.isIntradaySession} scoring=${decision.scoring} action=observe providerIssue=false marketSignal=false executionImpact=NONE`;
}

function formatEokwon(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)}조원`;
  return `${value.toFixed(0)}억원`;
}

/** 사용자 §5: marketCode mapping validation table SSOT. */
export interface MarketCodeMapping {
  market: 'KOSPI' | 'KOSDAQ' | 'ALL';
  kisCode: string;       // FID_INPUT_ISCD
  krxCode: string;       // mktId
  kisName: string;
  krxName: string;
}

export const PROGRAM_MARKET_CODE_MAPPING: readonly MarketCodeMapping[] = Object.freeze([
  Object.freeze({ market: 'KOSPI', kisCode: '0001', krxCode: 'STK', kisName: 'KOSPI', krxName: 'STK (유가증권)' }),
  Object.freeze({ market: 'KOSDAQ', kisCode: '1001', krxCode: 'KSQ', kisName: 'KOSDAQ', krxName: 'KSQ (코스닥)' }),
  Object.freeze({ market: 'ALL', kisCode: 'ALL', krxCode: 'ALL', kisName: 'ALL', krxName: 'ALL' }),
] as const);

/** Provider Coverage Map V2 (Patch-004 PROGRAM_MARKET_PROVIDER_COVERAGE re-export + intraday 명시). */
export const PATCH_006_PROVIDER_COVERAGE = PROGRAM_MARKET_PROVIDER_COVERAGE;
