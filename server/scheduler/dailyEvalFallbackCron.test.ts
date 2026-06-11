// @responsibility daily_eval_fallback cron 회귀 — 등록 정합 + 평일 호출 + 휴장 skip/enqueue + throw 격리 (EVAL_STALE 처방)
/**
 * dailyEvalFallbackCron.test.ts (2026-06-11 EVAL_STALE 41h 인시던트 처방, patch type)
 *
 * 신규 cron `daily_eval_fallback` (KST 평일 17:05 = UTC 08:05) 의 wiring 검증:
 *   1. cron 등록 정확 (jobName / cronExpr '5 8 * * 1-5')
 *   2. 평일 영업일 → runDailyEvalFallbackIfMissed({ trigger: 'FALLBACK_CRON' }) 1회
 *   3. KRX 휴장일 → TRADING_DAY_ONLY 가드로 본체 차단 + (ENV ON) MissedLearningQueue
 *      enqueue jobName='daily_eval_fallback' (idempotencyKey = jobName:YYYY-MM-DD)
 *   4. 본체 throw → cron 내부 catch (스케줄러 무중단 — 불변식 #1·#2)
 *
 * 가드 본체(KST 날짜 비교)의 no-op/실행/텔레그램 회귀는 dailyEvalFallback.test.ts 담당.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

type CronCallback = () => Promise<void> | void;
const _capturedCallbacks: Array<{ cronExpr: string; callback: CronCallback }> = [];

vi.mock('node-cron', () => ({
  default: {
    schedule: (_expr: string, callback: CronCallback) => {
      _capturedCallbacks.push({ cronExpr: _expr, callback });
      return { start: () => {}, stop: () => {} };
    },
  },
}));

let _envEnabled = false;
let _fallbackShouldThrow = false;
const _fallbackCalls: Array<Record<string, unknown>> = [];
const _enqueueCalls: Array<Record<string, unknown>> = [];

vi.mock('../learning/dailyEvalFallback.js', () => ({
  runDailyEvalFallbackIfMissed: async (opts: Record<string, unknown>) => {
    _fallbackCalls.push(opts);
    if (_fallbackShouldThrow) {
      throw new Error('intentional fallback failure');
    }
    return { executed: true };
  },
}));

vi.mock('../learning/missedLearningQueue.js', () => ({
  isMissedLearningQueueEnabled: () => _envEnabled,
  replayMissedLearningJobs: async () => ({ replayed: 0, failed: 0, dropped: 0 }),
  enqueueMissedLearningJob: (input: Record<string, unknown>) => {
    _enqueueCalls.push(input);
    return { id: 'mlq-mock-1', status: 'PENDING' };
  },
}));

// 학습 cron 본체 함수들 mock — 본 테스트는 daily_eval_fallback cron 만 검증
// (missedLearningReplay.test.ts 의 mock 세트와 동일 — 실 네트워크/영속 차단).
vi.mock('../learning/backtestEngine.js', () => ({
  runBacktest: async () => {},
  runWeeklyMiniBacktest: async () => {},
}));
vi.mock('../orchestrator/learningOrchestrator.js', () => ({
  learningOrchestrator: { runWeeklyCalib: async () => {}, runDailyEval: async () => {} },
}));
vi.mock('../learning/weeklySharpeMonitor.js', () => ({
  checkWeeklySharpeAlert: async () => {},
}));
vi.mock('../learning/failureToWeight.js', () => ({
  runF2WReverseLoop: async () => {},
}));
vi.mock('../learning/nightlyReflectionEngine.js', () => ({
  runNightlyReflection: async () => ({ date: '2026-06-11', mode: 'OK', executed: true }),
}));
vi.mock('../learning/ghostPortfolioTracker.js', () => ({
  refreshGhostPortfolio: async () => ({ updated: 0, closed: 0, skipped: 0 }),
}));
vi.mock('../learning/silentKnowledgeDistillation.js', () => ({
  distillWeeklyKnowledge: async () => ({ executed: false }),
}));
vi.mock('../learning/walkForwardValidator.js', () => ({
  runWalkForwardValidation: async () => ({ frozen: false }),
}));
vi.mock('../learning/counterfactualShadow.js', () => ({
  evaluateCounterfactualSuggestion: async () => ({}),
}));
vi.mock('../learning/learningSampleQuality.js', () => ({
  counterfactualResolveDueRun: () => ({
    labeled: 0,
    stillPending: 0,
    maturedNowCount: 0,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
  }),
}));
vi.mock('../learning/ledgerSimulator.js', () => ({
  resolveLedger: async () => ({ hitTP: 0, hitSL: 0, expired: 0 }),
  evaluateLedgerSuggestion: async () => ({}),
}));
vi.mock('../learning/kellySurfaceMap.js', () => ({
  evaluateKellySurfaceSuggestion: async () => ({}),
}));
vi.mock('../learning/regimeBalancedSampler.js', () => ({
  evaluateRegimeCoverageSuggestion: async () => ({}),
}));
vi.mock('../learning/futureReturnResolver.js', () => ({
  resolveFutureReturns: async () => ({
    resolvedCount: 0,
    totalSignals: 0,
    outcomesUpdated: 0,
    errors: 0,
    durationMs: 0,
  }),
  isFutureReturnResolverEnabled: () => false,
}));
vi.mock('../clients/kisClient.js', () => ({
  fetchCurrentPrice: async () => null,
  fetchAccountBalance: async () => null,
  submitBuyOrder: async () => null,
  fetchKisInvestorTradeByStockDaily: async () => null,
}));
vi.mock('../clients/historicalClosePrice.js', () => ({
  fetchHistoricalClosePrice: async () => null,
}));

const FALLBACK_CRON_EXPR = '5 8 * * 1-5';

describe('daily_eval_fallback cron 회귀 (EVAL_STALE 2026-06-11 처방)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-eval-fallback-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    _capturedCallbacks.length = 0;
    _fallbackCalls.length = 0;
    _enqueueCalls.length = 0;
    _envEnabled = false;
    _fallbackShouldThrow = false;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    vi.useRealTimers();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* SDS-ignore: tmpdir cleanup best-effort — 테스트 격리에 영향 없음. */
    }
  });

  async function registerAndFindCron(): Promise<{ cronExpr: string; callback: CronCallback }> {
    const { registerLearningJobs } = await import('./learningJobs.js');
    registerLearningJobs();
    const cron = _capturedCallbacks.find((c) => c.cronExpr === FALLBACK_CRON_EXPR);
    expect(cron, `cronExpr '${FALLBACK_CRON_EXPR}' 등록 누락`).toBeDefined();
    return cron!;
  }

  it('1. registerLearningJobs() 시 daily_eval_fallback cron 등록 (UTC 08:05 = KST 17:05 평일)', async () => {
    await registerAndFindCron();
    const { getRegisteredJobNames } = await import('./scheduleGuard.js');
    expect(getRegisteredJobNames()).toContain('daily_eval_fallback');
  }, 15000);

  it('2. 평일 영업일 → runDailyEvalFallbackIfMissed({ trigger: FALLBACK_CRON }) 1회', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T08:05:00Z')); // 화요일 KST 17:05 — 영업일 (기존 replay 테스트 검증 픽스처)
    const cron = await registerAndFindCron();
    await cron.callback();
    expect(_fallbackCalls.length).toBe(1);
    expect(_fallbackCalls[0]).toEqual({ trigger: 'FALLBACK_CRON' });
  });

  it('3. KRX 휴장일 (어린이날 5/5) → TRADING_DAY_ONLY 가드로 본체 차단 + ENV ON 시 enqueue 등재', async () => {
    _envEnabled = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T08:05:00Z')); // 어린이날 KRX 휴장
    const cron = await registerAndFindCron();
    await cron.callback();
    expect(_fallbackCalls.length).toBe(0);
    const enq = _enqueueCalls.find((c) => c.jobName === 'daily_eval_fallback');
    expect(enq).toBeDefined();
    expect(enq?.idempotencyKey).toBe('daily_eval_fallback:2026-05-05');
    expect(enq?.replayPolicy).toBe('SAFE_NEXT_TRADING_DAY');
  });

  it('4. ENV OFF 휴장일 → enqueue 0건 (default OFF 보존)', async () => {
    _envEnabled = false;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T08:05:00Z'));
    const cron = await registerAndFindCron();
    await cron.callback();
    expect(_fallbackCalls.length).toBe(0);
    expect(_enqueueCalls.length).toBe(0);
  });

  it('5. 본체 throw → cron 내부 catch + 사유 로그 (스케줄러 무중단, 불변식 #1·#2)', async () => {
    _fallbackShouldThrow = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T08:05:00Z'));
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    try {
      const cron = await registerAndFindCron();
      await expect(cron.callback()).resolves.toBeUndefined();
    } finally {
      console.error = origError;
    }
    expect(_fallbackCalls.length).toBe(1);
    expect(errors.some((l) => l.includes('[DailyEvalFallback] 실행 실패'))).toBe(true);
  });
});
