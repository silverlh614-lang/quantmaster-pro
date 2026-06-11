// @responsibility L2 daily-eval fallback 회귀 — KST 자정 경계 순수 가드 + no-op/보충 실행/throw 전파/텔레그램 1건
/**
 * dailyEvalFallback.test.ts (2026-06-11 EVAL_STALE 인시던트 처방 회귀)
 *
 * invariant:
 *   1. 순수 가드 hasDailyEvalRunOnKstDate — KST(UTC+9) 날짜 비교 (UTC 날짜 아님),
 *      자정 직전/직후 경계 + null/invalid 입력
 *   2. lastEvalAt 오늘(KST) → no-op: runDailyEval 0회 + 텔레그램 0건 (평시 byte-equivalent)
 *   3. lastEvalAt 어제/null → runDailyEval 1회 + FALLBACK_CRON 알림 1건
 *      (NORMAL / CH4_JOURNAL / executionImpact=NONE)
 *   4. MISSED_REPLAY trigger → runDailyEval 1회 + 텔레그램 0건 (큐 로그가 가시성 담당)
 *   5. runDailyEval throw → 전파 (cron 내부 catch / replay queue FAILED 영속용)
 *   6. 텔레그램 실패 → swallow + 로그 (보충 실행 성공 유지 — 불변식 #2)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../orchestrator/learningOrchestrator.js', () => ({
  learningOrchestrator: { runDailyEval: vi.fn(async () => {}) },
}));
vi.mock('./learningState.js', () => ({ loadLearningState: vi.fn(() => ({ lastEvalAt: null })) }));
vi.mock('../alerts/telegramClient.js', () => ({ sendTelegramAlert: vi.fn(async () => {}) }));

import {
  hasDailyEvalRunOnKstDate,
  runDailyEvalFallbackIfMissed,
  toKstDateString,
} from './dailyEvalFallback.js';
import { learningOrchestrator } from '../orchestrator/learningOrchestrator.js';
import { loadLearningState, type LearningState } from './learningState.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

function mockLastEvalAt(lastEvalAt: string | null): void {
  vi.mocked(loadLearningState).mockReturnValue({ lastEvalAt } as unknown as LearningState);
}

// 인시던트 재현 기준 시각 — KST 2026-06-11 17:05 (= UTC 08:05).
const NOW_KST_1705 = new Date('2026-06-11T08:05:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  mockLastEvalAt(null);
});

describe('toKstDateString — KST(UTC+9) 날짜 변환 순수 함수', () => {
  it('UTC 15:00 (= KST 자정) 부터 다음 KST 날짜', () => {
    expect(toKstDateString(new Date('2026-06-10T14:59:59Z'))).toBe('2026-06-10');
    expect(toKstDateString(new Date('2026-06-10T15:00:00Z'))).toBe('2026-06-11');
  });
});

describe('hasDailyEvalRunOnKstDate — 이중 실행 방지 순수 가드', () => {
  it('null / undefined / 빈 문자열 / 파싱 불가 → false (보충 대상)', () => {
    expect(hasDailyEvalRunOnKstDate(null, NOW_KST_1705)).toBe(false);
    expect(hasDailyEvalRunOnKstDate(undefined, NOW_KST_1705)).toBe(false);
    expect(hasDailyEvalRunOnKstDate('', NOW_KST_1705)).toBe(false);
    expect(hasDailyEvalRunOnKstDate('not-a-date', NOW_KST_1705)).toBe(false);
  });

  it('같은 KST 날짜 — UTC 날짜가 달라도 true (16:30 KST 평가 → 17:05 fallback no-op)', () => {
    // KST 2026-06-11 01:00 (= UTC 06-10 16:00) 평가 → KST 06-11 17:05 비교: 같은 KST 날짜
    expect(hasDailyEvalRunOnKstDate('2026-06-10T16:00:00Z', NOW_KST_1705)).toBe(true);
    // 당일 16:30 KST (= UTC 07:30) 정상 평가 → 17:05 fallback no-op
    expect(hasDailyEvalRunOnKstDate('2026-06-11T07:30:00Z', NOW_KST_1705)).toBe(true);
  });

  it('KST 자정 직전 평가 vs 자정 직후 now → false (날짜 전환 경계)', () => {
    // lastEvalAt = KST 06-10 23:59:59, now = KST 06-11 00:00:01
    expect(
      hasDailyEvalRunOnKstDate('2026-06-10T14:59:59Z', new Date('2026-06-10T15:00:01Z')),
    ).toBe(false);
  });

  it('KST 자정 직후 평가 vs 같은 KST 날짜 오후 now → true', () => {
    // lastEvalAt = KST 06-11 00:00:01, now = KST 06-11 17:05
    expect(hasDailyEvalRunOnKstDate('2026-06-10T15:00:01Z', NOW_KST_1705)).toBe(true);
  });

  it('어제 평가 (인시던트: 6/10 누락 → 6/11 비교) → false', () => {
    expect(hasDailyEvalRunOnKstDate('2026-06-09T07:40:00Z', NOW_KST_1705)).toBe(false);
  });
});

describe('runDailyEvalFallbackIfMissed — 보충 실행 runner', () => {
  it('(a) lastEvalAt 오늘(KST) → no-op: runDailyEval 0회 + 텔레그램 0건', async () => {
    mockLastEvalAt('2026-06-11T07:30:05Z'); // 당일 16:30 KST 정상 평가
    const res = await runDailyEvalFallbackIfMissed({ trigger: 'FALLBACK_CRON', now: NOW_KST_1705 });
    expect(res).toEqual({ executed: false, skipReason: 'ALREADY_RAN_TODAY' });
    expect(learningOrchestrator.runDailyEval).not.toHaveBeenCalled();
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('(b) lastEvalAt 어제 → runDailyEval 1회 + NORMAL/CH4/executionImpact=NONE 알림 1건', async () => {
    mockLastEvalAt('2026-06-10T07:35:00Z'); // 전일 평가가 마지막
    const res = await runDailyEvalFallbackIfMissed({ trigger: 'FALLBACK_CRON', now: NOW_KST_1705 });
    expect(res).toEqual({ executed: true });
    expect(learningOrchestrator.runDailyEval).toHaveBeenCalledTimes(1);
    expect(sendTelegramAlert).toHaveBeenCalledTimes(1);
    const [message, opts] = vi.mocked(sendTelegramAlert).mock.calls[0]! as [
      string,
      {
        priority?: string;
        noiseEvent?: { eventType?: string; channel?: string; executionImpact?: string };
      },
    ];
    expect(message).toContain('L2 일일 평가 fallback 실행');
    expect(message).toContain('16:30 오케스트레이터 미실행 보충');
    expect(opts?.priority).toBe('NORMAL');
    expect(opts?.noiseEvent?.eventType).toBe('DAILY_EVAL_FALLBACK_EXECUTED');
    expect(opts?.noiseEvent?.channel).toBe('CH4_JOURNAL');
    expect(opts?.noiseEvent?.executionImpact).toBe('NONE');
  });

  it('(b-2) lastEvalAt null (평가 이력 없음) → runDailyEval 1회 실행', async () => {
    mockLastEvalAt(null);
    const res = await runDailyEvalFallbackIfMissed({ trigger: 'FALLBACK_CRON', now: NOW_KST_1705 });
    expect(res.executed).toBe(true);
    expect(learningOrchestrator.runDailyEval).toHaveBeenCalledTimes(1);
  });

  it('(c) runDailyEval throw → 전파 (cron 내부 catch / queue FAILED 영속) + 텔레그램 0건', async () => {
    mockLastEvalAt(null);
    vi.mocked(learningOrchestrator.runDailyEval).mockRejectedValueOnce(new Error('eval boom'));
    await expect(
      runDailyEvalFallbackIfMissed({ trigger: 'FALLBACK_CRON', now: NOW_KST_1705 }),
    ).rejects.toThrow('eval boom');
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('(d) MISSED_REPLAY trigger → runDailyEval 1회 + 텔레그램 0건 (replay 경로 무발송)', async () => {
    mockLastEvalAt('2026-06-09T07:35:00Z');
    const res = await runDailyEvalFallbackIfMissed({ trigger: 'MISSED_REPLAY', now: NOW_KST_1705 });
    expect(res.executed).toBe(true);
    expect(learningOrchestrator.runDailyEval).toHaveBeenCalledTimes(1);
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('(e) 텔레그램 실패 → swallow + 로그 (보충 실행 성공 유지 — 불변식 #2)', async () => {
    mockLastEvalAt(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendTelegramAlert).mockRejectedValueOnce(new Error('tg down'));
    await expect(
      runDailyEvalFallbackIfMissed({ trigger: 'FALLBACK_CRON', now: NOW_KST_1705 }),
    ).resolves.toEqual({ executed: true });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
