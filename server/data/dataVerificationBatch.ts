// @responsibility ADR-0128 데이터 검증 배치 cron 본체 — 장 마감 후 워치리스트 전체 검증 + 텔레그램 요약
/**
 * dataVerificationBatch.ts (ADR-0128 정책 #2 — 주 검증).
 *
 * **cron 등록**: `30 7 * * 1-5` (UTC 평일 07:30 = KST 평일 16:30) — 장 마감(15:30)
 * 1시간 후. ScheduleClass `'TRADING_DAY_ONLY'` (PR-D ADR-0045 정합).
 *
 * **본체 흐름**:
 *   1. ENV `DATA_VERIFICATION_BATCH_DISABLED=true` 시 즉시 skipped 반환
 *   2. loadWatchlist() → 모든 워치리스트 종목 대상
 *   3. 각 종목 KIS daily quote (fetchKisIntraday) + safePctChangeStrict 평가
 *   4. status='OK' → recordVerificationSuccess + clearDataQuarantineMark
 *   5. status≠'OK' → recordVerificationFailure + markDataQuarantine
 *   6. failed≥1 시 텔레그램 HIGH 알림 (dedupeKey 일자별 24h)
 *
 * **5종목 단위 batch + 200ms throttle** — KIS 회로/블랙리스트 부담 차단.
 * 한 종목 throw 가 다른 종목 차단 안 함 (Promise.allSettled).
 */

import { loadWatchlist } from '../persistence/watchlistRepo.js';
import {
  markDataQuarantine,
  clearDataQuarantineMark,
} from '../persistence/watchlistRepo.js';
import {
  recordVerificationFailure,
  recordVerificationSuccess,
  getManualReviewQueue,
} from '../persistence/verificationQueueRepo.js';
import { fetchKisIntraday } from '../screener/adapters/kisQuoteAdapter.js';
import { safePctChangeStrict } from '../utils/safePctChange.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import type { DataQualityInfo, DataQualityStatus } from '../types/dataQuality.js';

const BATCH_SIZE = 5;
const BATCH_THROTTLE_MS = 200;
const SANITY_MAX_ABS_PCT = 90;

export interface BatchVerificationResult {
  /** ENV 비활성 등으로 스킵 시 true. */
  skipped: boolean;
  /** skipped=true 일 때만 의미 있음 ('DISABLED' / 'EMPTY_WATCHLIST'). */
  reason?: string;
  /** 검증 시도 종목 수. */
  total?: number;
  /** OK 종목 수. */
  ok?: number;
  /** 위반 종목 수 (status≠'OK'). */
  failed?: number;
  /** manualReviewState='QUEUED' 격상된 종목 수. */
  manualReviewQueued?: number;
  /** 실행 소요 시간 (ms). */
  durationMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kstDateStr(now: Date = new Date()): string {
  // KST = UTC+9. 일자만 추출 (YYYY-MM-DD).
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** sanity 위반 → DataQualityInfo 변환 SSOT. */
function strictResultToDataQuality(
  result: { status: DataQualityStatus; reason: string; current: number; base: number; source: string; context: string },
  now: Date,
): DataQualityInfo {
  return {
    status: result.status,
    reason: result.reason,
    current: result.current,
    base: result.base,
    source: result.source,
    context: result.context,
    updatedAt: now.toISOString(),
  };
}

/**
 * 단일 종목 검증 — KIS daily quote + safePctChangeStrict.
 *
 * @returns ok=true: 정상 통과, ok=false: 사유 + dataQuality 부착
 */
async function verifyOne(stockCode: string, stockName?: string): Promise<{
  ok: boolean;
  reason?: string;
  dataQuality?: DataQualityInfo;
}> {
  try {
    const quote = await fetchKisIntraday(stockCode);
    if (!quote) {
      return { ok: false, reason: 'KIS_QUOTE_NULL' };
    }
    const result = safePctChangeStrict({
      current: quote.price,
      base: quote.prevClose,
      source: 'KIS_DAILY',
      context: `dataVerificationBatch:${stockCode}`,
      maxAbsPct: SANITY_MAX_ABS_PCT,
    });
    if (result.ok) return { ok: true };
    return {
      ok: false,
      reason: result.status,
      dataQuality: strictResultToDataQuality(
        {
          status: result.status,
          reason: result.reason,
          current: result.current,
          base: result.base,
          source: result.source,
          context: result.context,
        },
        new Date(),
      ),
    };
  } catch (e) {
    void stockName;
    return {
      ok: false,
      reason: `KIS_ERROR:${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 배치 검증 본체 — cron 진입점.
 *
 * @param now 테스트 주입용 (default = new Date()).
 */
export async function runDataVerificationBatch(now: Date = new Date()): Promise<BatchVerificationResult> {
  if (process.env.DATA_VERIFICATION_BATCH_DISABLED === 'true') {
    return { skipped: true, reason: 'DISABLED' };
  }

  const t0 = Date.now();
  const watchlist = loadWatchlist();
  if (watchlist.length === 0) {
    return { skipped: true, reason: 'EMPTY_WATCHLIST' };
  }

  let okCount = 0;
  let failedCount = 0;

  // 5종목 단위 batch + 200ms throttle — KIS 회로 부담 차단.
  for (let i = 0; i < watchlist.length; i += BATCH_SIZE) {
    const chunk = watchlist.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      chunk.map((entry) => verifyOne(entry.code, entry.name)),
    );
    for (let j = 0; j < chunk.length; j++) {
      const entry = chunk[j]!;
      const r = results[j];
      if (!r) continue;
      if (r.status === 'fulfilled' && r.value.ok) {
        try {
          recordVerificationSuccess(entry.code, now);
          clearDataQuarantineMark(entry.code);
        } catch (e) {
          console.error(
            `[DataVerificationBatch] ${entry.code} success record 실패:`,
            e instanceof Error ? e.message : e,
          );
        }
        okCount++;
      } else {
        const reason = r.status === 'fulfilled'
          ? (r.value.reason ?? 'UNKNOWN')
          : `THROW:${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
        try {
          recordVerificationFailure(entry.code, reason, now, entry.name);
          if (r.status === 'fulfilled' && r.value.dataQuality) {
            markDataQuarantine(entry.code, r.value.dataQuality);
          }
        } catch (e) {
          console.error(
            `[DataVerificationBatch] ${entry.code} failure record 실패:`,
            e instanceof Error ? e.message : e,
          );
        }
        failedCount++;
      }
    }
    if (i + BATCH_SIZE < watchlist.length) {
      await delay(BATCH_THROTTLE_MS);
    }
  }

  const queueAfter = getManualReviewQueue();
  const manualReviewQueued = queueAfter.length;

  // failed≥1 시 텔레그램 HIGH 발송 — dedupeKey 일자별 24h.
  if (failedCount > 0) {
    const dateKst = kstDateStr(now);
    const message =
      `🛡️ [Data Verification Batch] ${dateKst} KST 16:30 검증 결과\n`
      + `총 ${watchlist.length}종 / OK ${okCount} / 실패 ${failedCount}\n`
      + `Manual Review 대기: ${manualReviewQueued}건\n`
      + `상세 — /data_verification_review`;
    try {
      await sendTelegramAlert(message, {
        priority: 'HIGH',
        dedupeKey: `data_verification_batch:${dateKst}`,
        cooldownMs: 24 * 60 * 60 * 1000,
        category: 'analysis_meta',
      });
    } catch (e) {
      console.error(
        '[DataVerificationBatch] 텔레그램 발송 실패:',
        e instanceof Error ? e.message : e,
      );
    }
  }

  return {
    skipped: false,
    total: watchlist.length,
    ok: okCount,
    failed: failedCount,
    manualReviewQueued,
    durationMs: Date.now() - t0,
  };
}
