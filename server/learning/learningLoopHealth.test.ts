import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ReflectionReport, BiasHeatmapDailyEntry } from './reflectionTypes.js';

const NOW = new Date('2026-05-02T06:00:00Z');

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function reflection(date: string, conditionIds: number[] = []): ReflectionReport {
  return {
    date,
    generatedAt: `${date}T10:00:00Z`,
    dailyVerdict: 'GOOD_DAY',
    keyLessons: [],
    questionableDecisions: [],
    tomorrowAdjustments: [],
    followUpActions: [{ text: 'follow-up', sourceIds: [] }],
    conditionConfession: conditionIds.map((conditionId) => ({
      conditionId,
      passedCount: 3,
      winCount: 0,
      lossCount: 2,
      expiredCount: 1,
      falseSignalScore: 0.8,
    })),
    mode: 'FULL',
  };
}

function day(offset: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

describe('collectLearningLoopHealth', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llh-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
    // Patch-VITEST-CAT-E-BASELINE-005: time isolation 의무.
    // 결함: server/persistence/reflectionRepo.ts:60 의 loadRecentReflections(days) 가
    // 호출자로부터 now 를 받지 않고 real new Date() 사용 → 실시간 today 기준
    // recent-N-day window 산출 → test fixture (2026-04-30~05-02) 가 real today 와
    // 멀어지면 ALL reflections 가 window 밖 → loaded=0 → INSUFFICIENT_DATA 회귀.
    // 정합 정정: collectLearningLoopHealth(NOW) 의 NOW 가 reflectionRepo 내부에서도
    // 작동하도록 system time 자체를 NOW 로 고정 (invariant #10 source inspection 결과).
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns INSUFFICIENT_DATA when fewer than 3 business-day reports exist', async () => {
    writeJson(path.join(tmpDir, 'reflections', `${day(0)}.json`), reflection(day(0)));

    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);

    expect(snap.level).toBe('INSUFFICIENT_DATA');
  });

  it('returns HEALTHY when F2W audit activity, reflectionImpact, failurePattern, and bias variance are active', async () => {
    for (let i = -2; i <= 0; i++) {
      writeJson(path.join(tmpDir, 'reflections', `${day(i)}.json`), reflection(day(i), [1]));
    }
    writeJson(path.join(tmpDir, 'f2w-audit-log.json'), [
      { ranAt: NOW.toISOString(), adjustments: [{ action: 'DECAY' }] },
    ]);
    writeJson(path.join(tmpDir, 'reflection-impact.json'), {
      schemaVersion: 1,
      records: [
        { date: day(-1), module: 'biasHeatmap', meaningful: true, capturedAt: NOW.toISOString() },
        { date: day(0), module: 'conditionConfession', meaningful: true, capturedAt: NOW.toISOString() },
      ],
    });
    writeJson(path.join(tmpDir, 'failure-patterns.json'), [
      { id: 'p1', stockCode: '005930', stockName: 'A', entryDate: day(-3), exitDate: day(-1), returnPct: -3, conditionScores: { 1: 8 }, gate1Score: 1, gate2Score: 1, gate3Score: 1, finalScore: 1, savedAt: NOW.toISOString() },
    ]);
    writeJson(path.join(tmpDir, 'bias-heatmap.json'), [
      { date: day(-2), scores: [{ bias: 'FOMO', score: 0.1, evidence: '' }] },
      { date: day(-1), scores: [{ bias: 'FOMO', score: 0.5, evidence: '' }] },
      { date: day(0), scores: [{ bias: 'FOMO', score: 0.9, evidence: '' }] },
    ] satisfies BiasHeatmapDailyEntry[]);

    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);

    expect(snap.level).toBe('HEALTHY');
  });

  it('returns STATELESS when bias variance is near zero and impact has no meaningful movement', async () => {
    for (let i = -2; i <= 0; i++) {
      writeJson(path.join(tmpDir, 'reflections', `${day(i)}.json`), reflection(day(i), [1]));
    }
    writeJson(path.join(tmpDir, 'bias-heatmap.json'), [
      { date: day(-2), scores: [{ bias: 'FOMO', score: 0.7, evidence: '' }] },
      { date: day(-1), scores: [{ bias: 'FOMO', score: 0.7, evidence: '' }] },
      { date: day(0), scores: [{ bias: 'FOMO', score: 0.7, evidence: '' }] },
    ] satisfies BiasHeatmapDailyEntry[]);
    writeJson(path.join(tmpDir, 'reflection-impact.json'), {
      schemaVersion: 1,
      records: [
        { date: day(0), module: 'biasHeatmap', meaningful: false, capturedAt: NOW.toISOString() },
      ],
    });

    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);

    expect(snap.level).toBe('STATELESS');
  });

  it('returns DEGRADED when only some inputs are active', async () => {
    for (let i = -2; i <= 0; i++) {
      writeJson(path.join(tmpDir, 'reflections', `${day(i)}.json`), reflection(day(i), [1]));
    }
    writeJson(path.join(tmpDir, 'reflection-impact.json'), {
      schemaVersion: 1,
      records: [
        { date: day(0), module: 'mainReflection', meaningful: true, capturedAt: NOW.toISOString() },
      ],
    });

    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);

    expect(snap.level).toBe('DEGRADED');
  });

  it('is read-only and reads conditionConfession and biasHeatmap from reflectionRepo sources only', async () => {
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    collectLearningLoopHealth(NOW);

    const source = fs.readFileSync(path.join(process.cwd(), 'server/learning/learningLoopHealth.ts'), 'utf-8');
    expect(source).toContain('loadRecentReflections(windowDays)');
    expect(source).toContain('loadBiasHeatmap()');
    expect(source).not.toContain('saveReflection(');
    expect(source).not.toContain('appendBiasHeatmap(');
    expect(source).not.toContain('reflectionModules/biasHeatmap');
  });
});
