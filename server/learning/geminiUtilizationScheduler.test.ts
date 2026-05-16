import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Gemini learning scheduler stale repair', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-scheduler-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('marks past nextScheduledAt as stale and reschedules recommendation-only future work', async () => {
    fs.writeFileSync(path.join(tmpDir, 'gemini_learning_runs.json'), JSON.stringify([
      {
        callsThisMonth: 0,
        tradingDaysThisMonth: 22,
        utilizationRate: 0,
        nextScheduledAt: '2026-05-15T10:00:00.000Z',
        recommendationOnly: true,
        conditionWeightsChanged: 0,
      },
    ]));
    const { ensureGeminiLearningScheduleFresh } = await import('./geminiUtilizationScheduler.js');
    const status = ensureGeminiLearningScheduleFresh(new Date('2026-05-16T03:00:00.000Z'));
    expect(status.schedulerStatus).toBe('STALE');
    expect(status.recommendationOnly).toBe(true);
    expect(status.executionImpact).toBe('NONE');
    expect(status.brokerOrdersCreated).toBe(0);
    expect(new Date(status.nextScheduledAt!).getTime()).toBeGreaterThan(new Date('2026-05-16T03:00:00.000Z').getTime());
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'gemini_learning_runs.json'), 'utf-8')) as unknown[];
    expect(saved.length).toBe(2);
  });
});
