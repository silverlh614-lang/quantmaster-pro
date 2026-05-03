// @responsibility ADR-0176 scheduleGuard enqueueOnSkip hook 회귀 — 옵션 미전달 100% 보존 + ENV gate + 화이트리스트 + KIS 주문 import 0건 정적 가드
/**
 * scheduleGuardEnqueueHook.test.ts (ADR-0176, Phase 2b-2)
 *
 * `scheduledJob` 의 신규 옵셔널 인자 `enqueueOnSkip` 분기 회귀 — 6 안전 invariant 검증:
 *   1. 옵션 미전달 시 hook 미실행 (기존 동작 100% 보존, 회귀 위험 0)
 *   2. ENV `MISSED_LEARNING_QUEUE_ENABLED !== 'true'` 시 hook 미실행 (default OFF)
 *   3. 옵션 + ENV ON + skip 발생 시 enqueueMissedLearningJob 호출
 *   4. skip reason='KRX_HOLIDAY' / 그 외 → MissedLearningReason 매핑
 *   5. enqueue throw 시 console.error catch — cron 흐름 차단 안 함
 *   6. KIS 주문 함수 import 0건 (정적 grep 가드)
 *
 * cron.schedule mock — callback 직접 캡처 + 실행 (실제 cron 시간 대기 없음).
 * missedLearningQueue mock — enqueueMissedLearningJob 호출 횟수 + 인자 검증.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

type CronCallback = () => Promise<void> | void;
const _capturedCallbacks: CronCallback[] = [];
const _enqueueCalls: unknown[] = [];

vi.mock('node-cron', () => ({
  default: {
    schedule: (_expr: string, callback: CronCallback) => {
      _capturedCallbacks.push(callback);
      return { start: () => {}, stop: () => {} };
    },
  },
}));

// missedLearningQueue mock — 본 PR scope: enqueue 호출 검증 + ENV gate 동작 + throw 케이스
let _enqueueShouldThrow = false;
let _envEnabled = false;
vi.mock('../learning/missedLearningQueue.js', () => ({
  isMissedLearningQueueEnabled: () => _envEnabled,
  enqueueMissedLearningJob: (input: unknown) => {
    _enqueueCalls.push(input);
    if (_enqueueShouldThrow) {
      throw new Error('intentional enqueue failure');
    }
    return { id: 'mlq-test-1', status: 'PENDING', retryCount: 0, ...(input as object) };
  },
}));

const ENV_KEY = 'MISSED_LEARNING_QUEUE_ENABLED';

describe('ADR-0176 scheduleGuard enqueueOnSkip hook — 회귀 6 invariant', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-enqueue-hook-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    _capturedCallbacks.length = 0;
    _enqueueCalls.length = 0;
    _enqueueShouldThrow = false;
    _envEnabled = false;
    delete process.env[ENV_KEY];
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env[ENV_KEY];
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    vi.useRealTimers();
  });

  // ─── invariant #1: 옵션 미전달 100% 보존 ───────────────────────────────────────

  it('1. enqueueOnSkip 옵션 미전달 + skip 발생 → hook 미실행 (기존 동작 100% 보존)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T10:00:00Z')); // 어린이날 KRX 휴장
    _envEnabled = true; // ENV ON 이어도 옵션 미전달 시 hook 미실행
    const { scheduledJob } = await import('./scheduleGuard.js');
    const { __resetScheduleMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const fn = vi.fn(async () => {});
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'no_hook_job', fn);
    expect(_capturedCallbacks.length).toBe(1);
    await _capturedCallbacks[0]();
    expect(fn).not.toHaveBeenCalled();
    expect(_enqueueCalls.length).toBe(0); // 핵심 — 옵션 미전달 시 enqueue 0건
  });

  // ─── invariant #2: ENV default OFF ────────────────────────────────────────────

  it('2. enqueueOnSkip 옵션 전달 + ENV OFF + skip 발생 → hook 미실행 (ENV gate)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T10:00:00Z')); // KRX 휴장
    _envEnabled = false; // ENV OFF
    const { scheduledJob } = await import('./scheduleGuard.js');
    const fn = vi.fn(async () => {});
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'env_off_job', fn, {
      enqueueOnSkip: {},
    });
    await _capturedCallbacks[0]();
    expect(_enqueueCalls.length).toBe(0);
  });

  it('3. enqueueOnSkip 옵션 + ENV ON + 정상 영업일 (skip 미발생) → enqueue 미호출', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T10:00:00Z')); // 평일 영업일
    _envEnabled = true;
    const { scheduledJob } = await import('./scheduleGuard.js');
    const fn = vi.fn(async () => {});
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'normal_day_job', fn, {
      enqueueOnSkip: {},
    });
    await _capturedCallbacks[0]();
    expect(fn).toHaveBeenCalled(); // 정상 실행
    expect(_enqueueCalls.length).toBe(0); // skip 미발생 → enqueue 0건
  });

  // ─── invariant #3: 옵션 + ENV ON + skip → enqueue 호출 ────────────────────────

  it('4. enqueueOnSkip 옵션 + ENV ON + KRX 휴장 → enqueue 1건 (reason=KRX_HOLIDAY)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T10:00:00Z')); // 어린이날 KRX 휴장
    _envEnabled = true;
    const { scheduledJob } = await import('./scheduleGuard.js');
    const fn = vi.fn(async () => {});
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'nightly_reflection', fn, {
      enqueueOnSkip: {},
    });
    await _capturedCallbacks[0]();
    expect(fn).not.toHaveBeenCalled(); // skip
    expect(_enqueueCalls.length).toBe(1);
    const call = _enqueueCalls[0] as Record<string, unknown>;
    expect(call.jobName).toBe('nightly_reflection');
    expect(call.reason).toBe('KRX_HOLIDAY'); // KRX_HOLIDAY 1:1 매핑
    expect(call.replayPolicy).toBe('SAFE_NEXT_TRADING_DAY'); // default
    expect(call.skippedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(call.idempotencyKey).toMatch(/^nightly_reflection:\d{4}-\d{2}-\d{2}$/);
  });

  // ─── invariant #4: reason 매핑 ────────────────────────────────────────────────

  it('5. skip reason=WEEKEND → enqueue reason=MARKET_DATA_MISSING (KRX_HOLIDAY 외 fallback)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z')); // 토요일
    _envEnabled = true;
    const { scheduledJob } = await import('./scheduleGuard.js');
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'ledger_resolve', async () => {}, {
      enqueueOnSkip: {},
    });
    await _capturedCallbacks[0]();
    expect(_enqueueCalls.length).toBe(1);
    const call = _enqueueCalls[0] as Record<string, unknown>;
    expect(call.reason).toBe('MARKET_DATA_MISSING'); // WEEKEND → MARKET_DATA_MISSING fallback
  });

  it('6. skip reason=LONG_HOLIDAY → enqueue reason=MARKET_DATA_MISSING (KRX_HOLIDAY 외 fallback)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z')); // 추석 LONG_HOLIDAY
    _envEnabled = true;
    const { scheduledJob } = await import('./scheduleGuard.js');
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'counterfactual_resolve', async () => {}, {
      enqueueOnSkip: {},
    });
    await _capturedCallbacks[0]();
    expect(_enqueueCalls.length).toBe(1);
    const call = _enqueueCalls[0] as Record<string, unknown>;
    expect(call.reason).toBe('MARKET_DATA_MISSING'); // LONG_HOLIDAY → MARKET_DATA_MISSING fallback
  });

  // ─── replayPolicy override ────────────────────────────────────────────────────

  it('7. replayPolicy override 명시 시 사용 (default 무시)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T10:00:00Z'));
    _envEnabled = true;
    const { scheduledJob } = await import('./scheduleGuard.js');
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'ghost_portfolio', async () => {}, {
      enqueueOnSkip: { replayPolicy: 'REPLAY_IMMEDIATELY' },
    });
    await _capturedCallbacks[0]();
    expect(_enqueueCalls.length).toBe(1);
    const call = _enqueueCalls[0] as Record<string, unknown>;
    expect(call.replayPolicy).toBe('REPLAY_IMMEDIATELY');
  });

  // ─── idempotencyKey 합성 ─────────────────────────────────────────────────────

  it('8. idempotencyKey 합성 정확 — `${jobName}:${YYYY-MM-DD}` (skippedAt KST 일자)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T10:23:45Z')); // 어린이날
    _envEnabled = true;
    const { scheduledJob } = await import('./scheduleGuard.js');
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'daily_mini_backtest', async () => {}, {
      enqueueOnSkip: {},
    });
    await _capturedCallbacks[0]();
    const call = _enqueueCalls[0] as Record<string, unknown>;
    expect(call.idempotencyKey).toBe('daily_mini_backtest:2026-05-05');
    expect(call.skippedAt).toBe('2026-05-05T10:23:45.000Z'); // ISO 그대로
  });

  // ─── invariant #5: enqueue throw catch ────────────────────────────────────────

  it('9. enqueue throw → console.error catch (cron 흐름 보존, return 정상)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T10:00:00Z'));
    _envEnabled = true;
    _enqueueShouldThrow = true;
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const { scheduledJob } = await import('./scheduleGuard.js');
      scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'nightly_reflection', async () => {}, {
        enqueueOnSkip: {},
      });
      // throw 가 cron 콜백을 깨뜨리지 않아야 함
      await expect(_capturedCallbacks[0]()).resolves.toBeUndefined();
      expect(_enqueueCalls.length).toBe(1); // enqueue 시도는 발생
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const errMsg = errors.map((a) => String(a)).join(' ');
      expect(errMsg).toContain('[Scheduler:nightly_reflection] enqueueOnSkip 실패');
    } finally {
      console.error = orig;
    }
  });

  // ─── recordScheduleRun 영속 정합 ──────────────────────────────────────────────

  it('10. enqueue hook 호출 후에도 recordScheduleRun(skipped) 메트릭 정확 갱신', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T10:00:00Z'));
    _envEnabled = true;
    const { scheduledJob } = await import('./scheduleGuard.js');
    const { __resetScheduleMetricsForTests, getJobMetrics } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'nightly_reflection', async () => {}, {
      enqueueOnSkip: {},
    });
    await _capturedCallbacks[0]();
    // 메트릭이 enqueue hook 와 *독립적으로* 갱신 (영속 SSOT 정밀도 보존)
    const m = getJobMetrics('nightly_reflection');
    expect(m?.skippedCount).toBe(1);
    expect(m?.lastSkipReason).toBe('KRX_HOLIDAY');
    // enqueue 도 동시에 호출
    expect(_enqueueCalls.length).toBe(1);
  });

  // ─── invariant #6: KIS 주문 함수 import 0건 정적 grep 가드 ────────────────────

  it('11. scheduleGuard.ts 에 KIS 주문 함수 import 0건 (절대 규칙)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, 'scheduleGuard.ts'),
      'utf-8',
    );
    // 주석 strip
    const stripComments = (s: string): string => {
      let out = s.replace(/\/\*[\s\S]*?\*\//g, '');
      out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
      return out;
    };
    const code = stripComments(src);
    expect(code).not.toMatch(/placeKisMarketOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/cancelKisOrder/);
    expect(code).not.toMatch(/placeKisStopLossOrder/);
    expect(code).not.toMatch(/placeKisTakeProfitOrder/);
    expect(code).not.toMatch(/from ['"][^'"]*kisClient/);
    // runAutoSignalScan 직접 호출도 금지
    expect(code).not.toMatch(/runAutoSignalScan/);
  });

  // ─── 다중 jobName 독립 동작 ───────────────────────────────────────────────────

  it('12. 여러 cron 등록 시 옵션 전달자만 enqueue 호출 (선택적 wiring)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T10:00:00Z'));
    _envEnabled = true;
    const { scheduledJob } = await import('./scheduleGuard.js');
    // cron A — 옵션 전달
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'wired_cron', async () => {}, {
      enqueueOnSkip: {},
    });
    // cron B — 옵션 미전달
    scheduledJob('* * * * *', 'TRADING_DAY_ONLY', 'unwired_cron', async () => {});
    expect(_capturedCallbacks.length).toBe(2);
    await _capturedCallbacks[0](); // wired_cron
    await _capturedCallbacks[1](); // unwired_cron
    expect(_enqueueCalls.length).toBe(1); // wired_cron 만 enqueue
    const call = _enqueueCalls[0] as Record<string, unknown>;
    expect(call.jobName).toBe('wired_cron');
  });
});
