// @responsibility ADR-0176 missed_learning_replay cron 회귀 — 등록 정합 + ENV gate + 결과 로깅 + 호출자 1건 정적 가드
/**
 * missedLearningReplay.test.ts (ADR-0176, Phase 2b-2)
 *
 * 신규 cron `missed_learning_replay` (KST 평일 09:30) 의 동작 검증:
 *   1. cron 등록 정확 (jobName / ScheduleClass / cronExpr)
 *   2. ENV `MISSED_LEARNING_QUEUE_ENABLED=false` 시 replayMissedLearningJobs 미호출
 *   3. ENV ON 시 호출 + tradingDate=today + maxJobsPerRun=10
 *   4. 결과 로깅 형식 `[MissedLearningReplay] replayed=N failed=M dropped=K`
 *   5. replayMissedLearningJobs throw → catch (cron 흐름 차단 안 함)
 *   6. 호출자 1건 정적 grep 가드 (모듈 + 테스트 + replay cron 만)
 *   7. KIS 주문 import 0건 정적 가드
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

type CronCallback = () => Promise<void> | void;
const _capturedCallbacks: Array<{ jobName: string; cronExpr: string; callback: CronCallback }> = [];

vi.mock('node-cron', () => ({
  default: {
    schedule: (_expr: string, callback: CronCallback) => {
      _capturedCallbacks.push({ jobName: '', cronExpr: _expr, callback });
      return { start: () => {}, stop: () => {} };
    },
  },
}));

let _envEnabled = false;
let _replayShouldThrow = false;
const _replayCalls: Array<Record<string, unknown>> = [];

vi.mock('../learning/missedLearningQueue.js', () => ({
  isMissedLearningQueueEnabled: () => _envEnabled,
  replayMissedLearningJobs: async (opts: Record<string, unknown>) => {
    _replayCalls.push(opts);
    if (_replayShouldThrow) {
      throw new Error('intentional replay failure');
    }
    return { replayed: 2, failed: 1, dropped: 0 };
  },
  // enqueueMissedLearningJob — 5 학습 cron wiring 으로 호출됨 (본 테스트 scope 외이지만 mock 필수)
  enqueueMissedLearningJob: () => ({ id: 'mlq-mock-1', status: 'PENDING' }),
}));

// 학습 cron 본체 함수들 mock — 본 테스트는 replay cron 만 검증
vi.mock('../learning/backtestEngine.js', () => ({
  runBacktest: async () => {},
  runWeeklyMiniBacktest: async () => {},
}));
vi.mock('../orchestrator/learningOrchestrator.js', () => ({
  learningOrchestrator: { runWeeklyCalib: async () => {} },
}));
vi.mock('../learning/weeklySharpeMonitor.js', () => ({
  checkWeeklySharpeAlert: async () => {},
}));
vi.mock('../learning/failureToWeight.js', () => ({
  runF2WReverseLoop: async () => {},
}));
vi.mock('../learning/nightlyReflectionEngine.js', () => ({
  runNightlyReflection: async () => ({ date: '2026-05-04', mode: 'OK', executed: true }),
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
  resolveCounterfactuals: async () => ({ resolved30d: 0, resolved60d: 0, resolved90d: 0 }),
  evaluateCounterfactualSuggestion: async () => ({}),
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
}));
vi.mock('../clients/historicalClosePrice.js', () => ({
  fetchHistoricalClosePrice: async () => null,
}));

const ENV_KEY = 'MISSED_LEARNING_QUEUE_ENABLED';

describe('ADR-0176 — missed_learning_replay cron 회귀 (Phase 2b-2)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlq-replay-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    _capturedCallbacks.length = 0;
    _replayCalls.length = 0;
    _envEnabled = false;
    _replayShouldThrow = false;
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
  });

  // ─── cron 등록 정합 ──────────────────────────────────────────────────────────

  it('1. registerLearningJobs() 시 missed_learning_replay cron 등록', async () => {
    const { registerLearningJobs } = await import('./learningJobs.js');
    registerLearningJobs();
    // missed_learning_replay 는 cron 등록 마지막 위치 — 다른 cron 들과 함께 등록됨
    // node-cron mock 이 cronExpr 만 추적 — '30 0 * * 1-5' 정확 매칭으로 식별
    const replayCron = _capturedCallbacks.find((c) => c.cronExpr === '30 0 * * 1-5');
    expect(replayCron).toBeDefined();
  });

  it('2. cronExpr "30 0 * * 1-5" (UTC 평일 00:30 = KST 평일 09:30, 장 시작 30분 전)', async () => {
    const { registerLearningJobs } = await import('./learningJobs.js');
    registerLearningJobs();
    const replayCron = _capturedCallbacks.find((c) => c.cronExpr === '30 0 * * 1-5');
    expect(replayCron).toBeDefined();
    expect(replayCron?.cronExpr).toBe('30 0 * * 1-5');
  });

  it('3. registerLearningJobs() 가 jobName "missed_learning_replay" 등록 추적', async () => {
    const { registerLearningJobs } = await import('./learningJobs.js');
    const { getRegisteredJobNames } = await import('./scheduleGuard.js');
    registerLearningJobs();
    const names = getRegisteredJobNames();
    expect(names).toContain('missed_learning_replay');
  });

  // ─── ENV gate ────────────────────────────────────────────────────────────────

  it('4. ENV OFF → replayMissedLearningJobs 미호출 (no-op)', async () => {
    _envEnabled = false;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T00:30:00Z')); // 평일 영업일
    const { registerLearningJobs } = await import('./learningJobs.js');
    registerLearningJobs();
    const replayCron = _capturedCallbacks.find((c) => c.cronExpr === '30 0 * * 1-5');
    expect(replayCron).toBeDefined();
    await replayCron!.callback();
    expect(_replayCalls.length).toBe(0);
    vi.useRealTimers();
  });

  it('5. ENV ON + 평일 영업일 → replayMissedLearningJobs 호출 (tradingDate=today, maxJobsPerRun=10)', async () => {
    _envEnabled = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T00:30:00Z')); // 평일 영업일
    const { registerLearningJobs } = await import('./learningJobs.js');
    registerLearningJobs();
    const replayCron = _capturedCallbacks.find((c) => c.cronExpr === '30 0 * * 1-5');
    await replayCron!.callback();
    expect(_replayCalls.length).toBe(1);
    const opts = _replayCalls[0];
    expect(opts.tradingDate).toBe('2026-04-21'); // today YYYY-MM-DD
    expect(opts.maxJobsPerRun).toBe(10);
    vi.useRealTimers();
  });

  // ─── ScheduleClass 가드 — KRX 휴장일 silent skip ─────────────────────────────

  it('6. KRX 휴장일 (어린이날 5/5) → ScheduleClass=TRADING_DAY_ONLY 가드로 callback 자체 fn 호출 차단', async () => {
    _envEnabled = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:30:00Z')); // 어린이날 KRX 휴장
    const { registerLearningJobs } = await import('./learningJobs.js');
    registerLearningJobs();
    const replayCron = _capturedCallbacks.find((c) => c.cronExpr === '30 0 * * 1-5');
    await replayCron!.callback();
    // ScheduleClass='TRADING_DAY_ONLY' 가드가 fn 호출 자체 차단 → replayMissedLearningJobs 0건
    expect(_replayCalls.length).toBe(0);
    vi.useRealTimers();
  });

  // ─── 결과 로깅 형식 ──────────────────────────────────────────────────────────

  it('7. 결과 로깅 형식 `[MissedLearningReplay] replayed=N failed=M dropped=K`', async () => {
    _envEnabled = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T00:30:00Z'));
    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg: unknown) => {
      logs.push(String(msg));
    };
    try {
      const { registerLearningJobs } = await import('./learningJobs.js');
      registerLearningJobs();
      const replayCron = _capturedCallbacks.find((c) => c.cronExpr === '30 0 * * 1-5');
      await replayCron!.callback();
    } finally {
      console.log = orig;
    }
    const replayLog = logs.find((l) => l.startsWith('[MissedLearningReplay]'));
    expect(replayLog).toBeDefined();
    expect(replayLog).toMatch(/replayed=2/);
    expect(replayLog).toMatch(/failed=1/);
    expect(replayLog).toMatch(/dropped=0/);
    vi.useRealTimers();
  });

  // ─── throw catch — cron 흐름 보존 ────────────────────────────────────────────

  it('8. replayMissedLearningJobs throw → scheduleGuard wrapper catch (cron 흐름 보존, 다음 cron 주기 살아있음)', async () => {
    _envEnabled = true;
    _replayShouldThrow = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T00:30:00Z'));
    const { registerLearningJobs } = await import('./learningJobs.js');
    registerLearningJobs();
    const replayCron = _capturedCallbacks.find((c) => c.cronExpr === '30 0 * * 1-5');
    // scheduleGuard wrapper 가 catch — throw 안 함
    await expect(replayCron!.callback()).resolves.toBeUndefined();
    expect(_replayCalls.length).toBe(1); // replay 시도 1건
    vi.useRealTimers();
  });

  // ─── 호출자 1건 정적 grep 가드 ────────────────────────────────────────────────

  it('9. replayMissedLearningJobs 호출자 — 모듈 + 테스트 + replay cron 만 (정적 grep 가드)', () => {
    // server/ 트리에서 replayMissedLearningJobs 호출 위치 검색
    const serverDir = path.resolve(__dirname, '..');
    const callerFiles: string[] = [];
    function walk(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          // node_modules 등 제외
          if (e.name === 'node_modules' || e.name === '__tests__' || e.name === 'dist') continue;
          walk(full);
        } else if (e.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
          if (full.endsWith('.d.ts')) continue;
          const src = fs.readFileSync(full, 'utf-8');
          // 주석 제외 매칭
          const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
          if (/\breplayMissedLearningJobs\b/.test(stripped)) {
            callerFiles.push(full);
          }
        }
      }
    }
    walk(serverDir);
    // 허용 위치 — 모듈 정의 (missedLearningQueue.ts) + 테스트 파일 + replay cron 등록 (learningJobs.ts)
    // + 정적 grep 가드 테스트 (learningJobsCronWiring.test.ts 가 import 패턴 검증 목적으로 등장)
    const allowedSuffixes = [
      'server/learning/missedLearningQueue.ts',
      'server/learning/missedLearningQueue.test.ts',
      'server/scheduler/learningJobs.ts',
      'server/scheduler/missedLearningReplay.test.ts',
      'server/scheduler/learningJobsCronWiring.test.ts',
    ];
    for (const file of callerFiles) {
      const normalized = file.replace(/\\/g, '/');
      const isAllowed = allowedSuffixes.some((suffix) => normalized.endsWith(suffix));
      expect(isAllowed, `예상치 못한 replayMissedLearningJobs 호출자: ${file}`).toBe(true);
    }
    // 최소 — learningJobs.ts (replay cron) + missedLearningQueue.ts (모듈 본체) 포함
    expect(callerFiles.some((f) => f.replace(/\\/g, '/').endsWith('server/scheduler/learningJobs.ts'))).toBe(true);
    expect(callerFiles.some((f) => f.replace(/\\/g, '/').endsWith('server/learning/missedLearningQueue.ts'))).toBe(true);
  });

  // ─── KIS 주문 import 0건 ─────────────────────────────────────────────────────

  it('10. learningJobs.ts replay cron 본체에 KIS 주문 함수 import 0건 (절대 규칙)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, 'learningJobs.ts'),
      'utf-8',
    );
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
    // runAutoSignalScan 직접 호출도 금지 — 무한 루프 차단
    expect(code).not.toMatch(/runAutoSignalScan/);
  });

  // ─── tradingDate 정합 — KST UTC 정확 변환 ────────────────────────────────────

  it('11. tradingDate = new Date().toISOString().slice(0,10) — UTC 일자 (cron UTC 00:30 트리거)', async () => {
    _envEnabled = true;
    vi.useFakeTimers();
    // UTC 00:30 트리거 → toISOString().slice(0,10) = UTC 일자
    vi.setSystemTime(new Date('2026-04-21T00:30:00Z'));
    const { registerLearningJobs } = await import('./learningJobs.js');
    registerLearningJobs();
    const replayCron = _capturedCallbacks.find((c) => c.cronExpr === '30 0 * * 1-5');
    await replayCron!.callback();
    const opts = _replayCalls[0];
    expect(opts.tradingDate).toBe('2026-04-21');
    vi.useRealTimers();
  });

  // ─── maxJobsPerRun 정합 — 한 사이클당 10건 ────────────────────────────────────

  it('12. maxJobsPerRun=10 — 한 사이클당 처리 한도 (대량 backlog 폭주 차단)', async () => {
    _envEnabled = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T00:30:00Z'));
    const { registerLearningJobs } = await import('./learningJobs.js');
    registerLearningJobs();
    const replayCron = _capturedCallbacks.find((c) => c.cronExpr === '30 0 * * 1-5');
    await replayCron!.callback();
    expect(_replayCalls[0].maxJobsPerRun).toBe(10);
    vi.useRealTimers();
  });
});
