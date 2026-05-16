import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('learning cohort consistency snapshot status', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-status-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('treats stale backfill snapshots as stale, not missing reflection in pulse', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ghost-portfolio.json'), JSON.stringify([
      {
        stockCode: '005930',
        stockName: 'Samsung Electronics',
        signalDate: '2026-05-15',
        signalPriceKrw: 70000,
        closed: true,
        closedAt: '2026-05-15T06:00:00.000Z',
        outcomeLabel: 'WIN',
        returnR: 1,
        cohortType: 'GHOST_REPAIR',
        caseKind: 'ghost',
      },
    ]));
    fs.writeFileSync(path.join(tmpDir, 'learning_cohort_backfill_runs.json'), JSON.stringify([
      { runAt: '2026-05-14T06:00:00.000Z', scanned: 0, after: {} },
    ]));
    const { collectLearningCohortConsistencyStatus } = await import('./learningSampleQuality.js');
    const status = collectLearningCohortConsistencyStatus(new Date('2026-05-16T06:00:00.000Z'));
    expect(status.cohortSumMatchesTotal).toBe(true);
    expect(status.ghostRepairReflectedInPulse).toBe(true);
    expect(status.snapshotStatus).toBe('COHORT_BACKFILL_SNAPSHOT_STALE');
    expect(status.metricWarnings).not.toContain('COHORT_BACKFILL_NOT_REFLECTED_IN_PULSE');
  }, 15000);
});
