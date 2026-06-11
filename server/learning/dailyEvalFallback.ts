// @responsibility L2 일일 평가 fallback SSOT — KST 날짜 이중 실행 방지 순수 가드 + 누락 보충 runner (17:05 cron·replay dispatcher 공용)
/**
 * dailyEvalFallback.ts — 2026-06-11 EVAL_STALE 41h 인시던트 처방 (patch type, ADR 발급 0건).
 *
 * `learningOrchestrator.runDailyEval()` 의 유일한 호출자가 tradingOrchestrator 의
 * REPORT_ANALYSIS tick (KST 16:30+, 일일 1회) 이라 그 시각 서버 다운/tick 미실행이면
 * 그날 L2 평가가 통째로 누락되고 보충 메커니즘이 0 이었다 (불변식 #2 위협).
 *
 * 본 모듈은 단일 의존 제거의 SSOT:
 *   - `hasDailyEvalRunOnKstDate` — lastEvalAt 의 KST 날짜 == 오늘 판정 순수 함수 (단위 테스트 대상)
 *   - `runDailyEvalFallbackIfMissed` — 가드 통과 시에만 runDailyEval 보충 실행.
 *     호출자 2곳: learningJobs `daily_eval_fallback` cron (KST 17:05) +
 *     missedLearningReplayDispatcher (익일 09:30 replay).
 *
 * 평시(16:30 오케스트레이터 정상 실행) byte-equivalent — 가드가 항상 no-op 로그 1줄.
 * runDailyEval 본체/tradingOrchestrator 16:30 경로 무접촉. 실주문/Gate/SourceSnapshot 0줄.
 */

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { learningOrchestrator } from '../orchestrator/learningOrchestrator.js';
import { loadLearningState } from './learningState.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST(UTC+9) 기준 YYYY-MM-DD — 순수 함수 (timezone ENV 무관 결정적). */
export function toKstDateString(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 이중 실행 방지 가드 (순수 함수) — lastEvalAt 의 KST 날짜가 `now` 의 KST 날짜와
 * 같으면 true (오늘 이미 평가됨 → fallback no-op).
 *
 * null/파싱 불가 lastEvalAt 은 false (평가 이력 없음 → 보충 대상).
 */
export function hasDailyEvalRunOnKstDate(
  lastEvalAt: string | null | undefined,
  now: Date,
): boolean {
  if (!lastEvalAt) return false;
  const ms = Date.parse(lastEvalAt);
  if (!Number.isFinite(ms)) return false;
  return toKstDateString(new Date(ms)) === toKstDateString(now);
}

export type DailyEvalFallbackTrigger = 'FALLBACK_CRON' | 'MISSED_REPLAY';

export interface DailyEvalFallbackResult {
  executed: boolean;
  skipReason?: 'ALREADY_RAN_TODAY';
}

/**
 * L2 일일 평가 누락 보충 실행.
 *
 * - 가드: `loadLearningState().lastEvalAt` 의 KST 날짜가 오늘 → no-op (로그 1줄).
 *   runDailyEval 내부 markEvalRan() 이 lastEvalAt 을 갱신하므로 재진입 안전 (멱등).
 * - 실행: `learningOrchestrator.runDailyEval()` — throw 는 호출자에게 전파
 *   (cron 은 내부 catch + scheduleGuard 이중 방어, replay 는 queue FAILED 영속).
 * - trigger='FALLBACK_CRON' 시에만 운영자 대면 1줄 텔레그램 (NORMAL, CH4 noiseEvent,
 *   executionImpact='NONE'). replay 경로는 큐 진단 로그가 가시성 담당 — 무발송.
 */
export async function runDailyEvalFallbackIfMissed(opts: {
  trigger: DailyEvalFallbackTrigger;
  now?: Date;
}): Promise<DailyEvalFallbackResult> {
  const now = opts.now ?? new Date();
  const lastEvalAt = loadLearningState().lastEvalAt;

  if (hasDailyEvalRunOnKstDate(lastEvalAt, now)) {
    console.log(
      `[DailyEvalFallback] already ran — lastEvalAt=${lastEvalAt} trigger=${opts.trigger} (no-op)`,
    );
    return { executed: false, skipReason: 'ALREADY_RAN_TODAY' };
  }

  console.log(
    `[DailyEvalFallback] L2 일일 평가 누락 감지 — lastEvalAt=${lastEvalAt ?? 'null'} ` +
      `trigger=${opts.trigger} → runDailyEval 보충 실행`,
  );
  await learningOrchestrator.runDailyEval();

  if (opts.trigger === 'FALLBACK_CRON') {
    await sendTelegramAlert(
      '🛟 L2 일일 평가 fallback 실행 — 16:30 오케스트레이터 미실행 보충',
      {
        priority: 'NORMAL',
        category: 'daily_eval_fallback',
        noiseEvent: {
          eventType: 'DAILY_EVAL_FALLBACK_EXECUTED',
          channel: 'CH4_JOURNAL',
          status: 'RECOVERED',
          executionImpact: 'NONE',
        },
      },
    ).catch((e) => console.error('[DailyEvalFallback] 텔레그램 발송 실패:', e));
  }

  return { executed: true };
}
