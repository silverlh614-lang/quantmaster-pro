// @responsibility ADR-0128 데이터 검증 증분 진입점 — 신규 매수 후보 발견 시점 단일 종목 검증
/**
 * dataVerificationIncremental.ts (ADR-0128 정책 #3 — 증분 검증).
 *
 * **진입점 함수만 export** — signalScanner / autoPopulateWatchlist 의 호출자 wiring
 * 은 후속 PR. 본 PR 은 함수 인프라 + 회귀 테스트만.
 *
 * **본체 흐름**:
 *   1. ENV `VERIFICATION_QUEUE_DISABLED=true` → 즉시 verified=true 반환 (회로 무력화)
 *   2. queue 에서 entry 조회
 *      - manualReviewState='QUEUED' → CACHE_MANUAL_REVIEW + DataHoldAction (즉시 차단)
 *      - manualReviewState='DROPPED' → CACHE_MANUAL_REVIEW + DataHoldAction
 *      - nextRetryAt > now → CACHE_RETRY_PENDING (cooldown 중)
 *   3. KIS quote + safePctChangeStrict 평가
 *      - status='OK' → recordVerificationSuccess + verified=true
 *      - status≠'OK' → recordVerificationFailure + verified=false + DataHoldAction
 *      - KIS throw → ERROR + verified=false + DataHoldAction (안전 차단)
 *
 * **try/catch 격리** — 호출자(signalScanner)가 throw 안 받음. 모든 실패 시
 * verified=false + action 반환으로 매매 흐름 차단 안 함.
 */

import {
  loadVerificationQueue,
  recordVerificationFailure,
  recordVerificationSuccess,
} from '../persistence/verificationQueueRepo.js';
import { fetchKisIntraday } from '../screener/adapters/kisQuoteAdapter.js';
import { safePctChangeStrict } from '../utils/safePctChange.js';
import {
  resolveDataHoldAction,
  type DataHoldAction,
  type DataHoldRole,
} from './dataHoldRolePolicy.js';
import type { DataQualityInfo } from '../types/dataQuality.js';

const SANITY_MAX_ABS_PCT = 90;

type IncrementalVerificationSource =
  | 'CACHE_RETRY_PENDING'
  | 'CACHE_MANUAL_REVIEW'
  | 'FRESH_KIS'
  | 'FRESH_OK'
  | 'ERROR';

export interface IncrementalVerificationResult {
  /** true = 검증 통과 / false = 차단 (호출자 매수 차단 의무). */
  verified: boolean;
  /** verified=false 시 호출자가 적용할 fallback 정책 (역할 기반). */
  action?: DataHoldAction;
  /** sanity 위반 시 영속될 격리 메타. */
  dataQuality?: DataQualityInfo;
  /** 운영자 진단 사유. */
  reason: string;
  /** 검증 결과 출처 — 진단 + 텔레메트리 입력. */
  source: IncrementalVerificationSource;
}

/**
 * 단일 종목 증분 검증 — 신규 매수 후보 발견 시점 호출.
 *
 * @param stockCode 6자리 종목코드.
 * @param role 종목의 현재 시점 역할 (default 'BUY_CANDIDATE').
 * @param now 테스트 주입용 (default = new Date()).
 */
export async function verifyStockIncremental(
  stockCode: string,
  role: DataHoldRole = 'BUY_CANDIDATE',
  now: Date = new Date(),
): Promise<IncrementalVerificationResult> {
  // ENV 우회 — queue 무력화 시 회로 통과 (호출자 무영향).
  if (process.env.VERIFICATION_QUEUE_DISABLED === 'true') {
    return {
      verified: true,
      reason: 'queue_disabled (ENV)',
      source: 'FRESH_OK',
    };
  }

  // 1. queue 캐시 조회 — manual review / cooldown 분기.
  let entry: ReturnType<typeof loadVerificationQueue>[number] | undefined;
  try {
    entry = loadVerificationQueue().find((e) => e.stockCode === stockCode);
  } catch {
    entry = undefined; // 손상 JSON — 안전 default (FRESH 진행)
  }

  if (entry) {
    if (entry.manualReviewState === 'QUEUED') {
      return {
        verified: false,
        action: resolveDataHoldAction(role),
        reason: 'manual_review_pending',
        source: 'CACHE_MANUAL_REVIEW',
      };
    }
    if (entry.manualReviewState === 'DROPPED') {
      return {
        verified: false,
        action: resolveDataHoldAction(role),
        reason: 'manually_dropped',
        source: 'CACHE_MANUAL_REVIEW',
      };
    }
    // APPROVED 는 즉시 재검증 가능 (cooldown 우회)
    if (entry.manualReviewState !== 'APPROVED') {
      const nextMs = new Date(entry.nextRetryAt).getTime();
      if (Number.isFinite(nextMs) && nextMs > now.getTime()) {
        return {
          verified: false,
          action: resolveDataHoldAction(role),
          reason: `retry_cooldown until ${entry.nextRetryAt}`,
          source: 'CACHE_RETRY_PENDING',
        };
      }
    }
  }

  // 2. KIS quote + safePctChangeStrict 평가 — try/catch 격리.
  try {
    const quote = await fetchKisIntraday(stockCode);
    if (!quote) {
      try {
        recordVerificationFailure(stockCode, 'KIS_QUOTE_NULL', now);
      } catch { /* persist 실패 무시 — 매매 흐름 차단 금지 */ }
      return {
        verified: false,
        action: resolveDataHoldAction(role),
        reason: 'kis_quote_null',
        source: 'FRESH_KIS',
      };
    }
    const result = safePctChangeStrict({
      current: quote.price,
      base: quote.prevClose,
      source: 'KIS_DAILY',
      context: `dataVerificationIncremental:${stockCode}`,
      maxAbsPct: SANITY_MAX_ABS_PCT,
    });
    if (result.ok) {
      try {
        recordVerificationSuccess(stockCode, now);
      } catch { /* persist 실패 무시 */ }
      return {
        verified: true,
        reason: 'kis_strict_ok',
        source: 'FRESH_OK',
      };
    }

    // sanity 위반 → record + DataQuality 부착 + DataHoldAction 반환
    try {
      recordVerificationFailure(stockCode, result.status, now);
    } catch { /* persist 실패 무시 */ }
    const dataQuality: DataQualityInfo = {
      status: result.status,
      reason: result.reason,
      current: result.current,
      base: result.base,
      source: result.source,
      context: result.context,
      updatedAt: now.toISOString(),
    };
    return {
      verified: false,
      action: resolveDataHoldAction(role),
      dataQuality,
      reason: `kis_strict_fail:${result.status}`,
      source: 'FRESH_KIS',
    };
  } catch (e) {
    // KIS throw — 안전 차단 (verified=false + DataHoldAction)
    const errMsg = e instanceof Error ? e.message : String(e);
    try {
      recordVerificationFailure(stockCode, `KIS_ERROR:${errMsg}`, now);
    } catch { /* persist 실패 무시 */ }
    return {
      verified: false,
      action: resolveDataHoldAction(role),
      reason: `kis_error:${errMsg}`,
      source: 'ERROR',
    };
  }
}
