import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ReflectionReport } from './reflectionTypes.js';

vi.setConfig({ testTimeout: 15000 });

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function reflection(date: string, ids: number[]): ReflectionReport {
  return {
    date,
    generatedAt: `${date}T10:00:00Z`,
    dailyVerdict: 'BAD_DAY',
    keyLessons: [],
    questionableDecisions: [],
    tomorrowAdjustments: [],
    followUpActions: [],
    conditionConfession: ids.map((conditionId) => ({
      conditionId,
      passedCount: 1,
      winCount: 0,
      lossCount: 1,
      expiredCount: 0,
      falseSignalScore: 0.8,
    })),
    mode: 'FULL',
  };
}

describe('F2W reflection adjustment', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2w-reflection-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.LEARNING_REFLECTION_F2W_DISABLED;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('decays 0.95x when the same condition appears twice in recent 3 days', async () => {
    writeJson(path.join(tmpDir, 'reflections', `${day(-1)}.json`), reflection(day(-1), [2]));
    writeJson(path.join(tmpDir, 'reflections', `${day(0)}.json`), reflection(day(0), [2]));

    const { computeReflectionAdjustment } = await import('./failureToWeight.js');
    expect(computeReflectionAdjustment().get(2)).toBeCloseTo(0.95, 5);
  });

  it('decays 0.90x when the same condition appears three times in recent 5 days', async () => {
    writeJson(path.join(tmpDir, 'reflections', `${day(-4)}.json`), reflection(day(-4), [2]));
    writeJson(path.join(tmpDir, 'reflections', `${day(-2)}.json`), reflection(day(-2), [2]));
    writeJson(path.join(tmpDir, 'reflections', `${day(0)}.json`), reflection(day(0), [2]));

    const { computeReflectionAdjustment } = await import('./failureToWeight.js');
    expect(computeReflectionAdjustment().get(2)).toBeCloseTo(0.95 * 0.90, 5);
  });

  it('decays 0.95x when active failure patterns repeat score >= 7 twice', async () => {
    const now = new Date().toISOString();
    writeJson(path.join(tmpDir, 'failure-patterns.json'), [
      { id: 'p1', stockCode: 'A', stockName: 'A', entryDate: now, exitDate: now, returnPct: -3, conditionScores: { 2: 7 }, gate1Score: 1, gate2Score: 1, gate3Score: 1, finalScore: 1, savedAt: now },
      { id: 'p2', stockCode: 'B', stockName: 'B', entryDate: now, exitDate: now, returnPct: -4, conditionScores: { 2: 8 }, gate1Score: 1, gate2Score: 1, gate3Score: 1, finalScore: 1, savedAt: now },
    ]);

    const { computeReflectionAdjustment } = await import('./failureToWeight.js');
    expect(computeReflectionAdjustment().get(2)).toBeCloseTo(0.95, 5);
  });

  it('writes one audit row with REFLECTION_ADJUSTMENT for reflection-only adjustment', async () => {
    writeJson(path.join(tmpDir, 'reflections', `${day(-1)}.json`), reflection(day(-1), [2]));
    writeJson(path.join(tmpDir, 'reflections', `${day(0)}.json`), reflection(day(0), [2]));

    const { runF2WReverseLoop } = await import('./failureToWeight.js');
    const result = await runF2WReverseLoop();
    const adjusted = result.adjustments.filter((a) => a.conditionId === 2 && a.source === 'REFLECTION_ADJUSTMENT');
    expect(adjusted).toHaveLength(1);
    expect(adjusted[0].nextWeight).toBeCloseTo(0.95, 5);

    const audit = JSON.parse(fs.readFileSync(path.join(tmpDir, 'f2w-audit-log.json'), 'utf-8'));
    expect(audit[0].adjustments.filter((a: { conditionId: number }) => a.conditionId === 2)).toHaveLength(1);
  });

  it('combines with existing F2W correlation by multiplication and records COMBINED', async () => {
    writeJson(path.join(tmpDir, 'reflections', `${day(-1)}.json`), reflection(day(-1), [2]));
    writeJson(path.join(tmpDir, 'reflections', `${day(0)}.json`), reflection(day(0), [2]));
    const records = Array.from({ length: 10 }, (_, i) => ({
      tradeId: `t${i}`,
      stockCode: '005930',
      stockName: 'A',
      closedAt: '2025-01-01T00:00:00Z',
      returnPct: i < 5 ? -2 : 2,
      isWin: i >= 5,
      conditionScores: { 2: i < 5 ? 10 : 0 },
      holdingDays: 1,
    }));
    writeJson(path.join(tmpDir, 'attribution-records.json'), records);

    const { runF2WReverseLoop } = await import('./failureToWeight.js');
    const result = await runF2WReverseLoop({ dryRun: true });
    const adjusted = result.adjustments.find((a) => a.conditionId === 2)!;
    expect(adjusted.source).toBe('COMBINED');
    expect(adjusted.nextWeight).toBeCloseTo(0.9 * 0.95, 5);
  });

  it('returns no adjustment when LEARNING_REFLECTION_F2W_DISABLED=true', async () => {
    process.env.LEARNING_REFLECTION_F2W_DISABLED = 'true';
    writeJson(path.join(tmpDir, 'reflections', `${day(-1)}.json`), reflection(day(-1), [2]));
    writeJson(path.join(tmpDir, 'reflections', `${day(0)}.json`), reflection(day(0), [2]));
    const { computeReflectionAdjustment } = await import('./failureToWeight.js');
    expect(computeReflectionAdjustment().size).toBe(0);
  });
});
