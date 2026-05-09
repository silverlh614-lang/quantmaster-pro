import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFreshDataSchedulerObservationRowAdr0492,
  collectOperatorActionSourcesFromFreshDataSchedulerAdr0492,
  formatFreshDataSchedulerCompactAdr0492,
  formatFreshDataSchedulerDetailAdr0492,
  formatRuntimePipelineFreshDataSchedulerEvidenceLineAdr0492,
  runFreshDataSchedulerAdr0492,
  shouldRunFreshDataSchedulerAdr0492,
  type FreshDataSchedulerJobAdr0492,
} from './freshDataSchedulerAdr0492.js';
import { replaySupplySnapshotsAdr0491 } from './supplySnapshotStoreReplayAdr0491.js';

const tempFiles: string[] = [];
function tempFile(): string {
  const file = path.join(os.tmpdir(), `adr0492-${Date.now()}-${Math.random()}.json`);
  tempFiles.push(file);
  return file;
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    try { fs.rmSync(file, { force: true }); } catch { /* noop */ }
  }
});

function completed(name: FreshDataSchedulerJobAdr0492['name']): FreshDataSchedulerJobAdr0492 {
  return { name, status: 'COMPLETED', providerIssue: false, marketSignal: false, diagnostics: [] };
}

describe('ADR-0492 Fresh Data Scheduler / Non-Live Cron', () => {
  it('is disabled by default and preserves hard guardrails', async () => {
    const report = await runFreshDataSchedulerAdr0492({ session: 'AFTER_MARKET', generatedAt: '2026-05-09T18:00:00.000Z' });
    expect(report.enabled).toBe(false);
    expect(report.status).toBe('DISABLED');
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.operatorApprovalRequired).toBe(true);
    expect(report.snapshotWritten).toBe(false);
  });

  it('applies deterministic cadence rules and after-market full diagnostics', () => {
    expect(shouldRunFreshDataSchedulerAdr0492({ enabled: true, mode: 'OBSERVE_ONLY', session: 'AFTER_MARKET', now: '2026-05-09T18:10:00.000Z', lastRunAt: '2026-05-09T18:00:00.000Z', minIntervalMinutes: 30 }).reason).toBe('MIN_INTERVAL_NOT_ELAPSED');
    const run = shouldRunFreshDataSchedulerAdr0492({ enabled: true, mode: 'OBSERVE_ONLY', session: 'AFTER_MARKET', now: '2026-05-09T18:40:00.000Z', lastRunAt: '2026-05-09T18:00:00.000Z', minIntervalMinutes: 30 });
    expect(run.shouldRun).toBe(true);
    expect(run.plannedJobs).toEqual(['SECTOR_ENERGY_MASTER', 'INVESTOR_FLOW_SAMPLE', 'PROGRAM_TRADING_SAMPLE', 'SUPPLY_COVERAGE_RECOVERY', 'SUPPLY_READINESS_AUDIT', 'SNAPSHOT_STORE_WRITE']);
    const nonTrading = shouldRunFreshDataSchedulerAdr0492({ enabled: true, mode: 'OBSERVE_ONLY', session: 'NON_TRADING_DAY' });
    expect(nonTrading.shouldRun).toBe(false);
    expect(nonTrading.reason).toBe('NON_TRADING_DAY_REPLAY_ONLY');
    expect(nonTrading.plannedJobs).toEqual([]);
  });

  it('isolates failed jobs and keeps provider issues non-bearish', async () => {
    const report = await runFreshDataSchedulerAdr0492({
      enabled: true,
      mode: 'OBSERVE_ONLY',
      session: 'AFTER_MARKET',
      generatedAt: '2026-05-09T18:00:00.000Z',
      jobRunners: {
        SECTOR_ENERGY_MASTER: async () => completed('SECTOR_ENERGY_MASTER'),
        INVESTOR_FLOW_SAMPLE: async () => ({ name: 'INVESTOR_FLOW_SAMPLE', status: 'DATA_UNAVAILABLE', providerIssue: true, marketSignal: false, diagnostics: ['missing sample'] }),
        PROGRAM_TRADING_SAMPLE: async () => { throw new Error('provider timeout'); },
        SUPPLY_COVERAGE_RECOVERY: async () => completed('SUPPLY_COVERAGE_RECOVERY'),
        SUPPLY_READINESS_AUDIT: async () => completed('SUPPLY_READINESS_AUDIT'),
        SNAPSHOT_STORE_WRITE: async () => completed('SNAPSHOT_STORE_WRITE'),
      },
    });
    expect(report.status).toBe('PARTIAL');
    expect(report.jobs.find((row) => row.name === 'PROGRAM_TRADING_SAMPLE')?.status).toBe('FAILED_PROVIDER');
    expect(report.providerIssue).toBe(true);
    expect(report.marketSignal).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('captures internal failure without throwing into caller', async () => {
    const report = await runFreshDataSchedulerAdr0492({
      enabled: true,
      mode: 'OBSERVE_ONLY',
      session: 'AFTER_MARKET',
      jobRunners: { SECTOR_ENERGY_MASTER: async () => { throw new Error('unexpected mapper bug'); } },
    });
    expect(report.status).toBe('FAILED_INTERNAL');
    expect(report.jobs[0]?.status).toBe('FAILED_INTERNAL');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('writes sanitized ADR-0491 snapshots and degrades write failures diagnostically', async () => {
    const filePath = tempFile();
    const report = await runFreshDataSchedulerAdr0492({ enabled: true, mode: 'OBSERVE_ONLY', session: 'AFTER_MARKET', generatedAt: '2026-05-09T18:00:00.000Z', snapshotFilePath: filePath });
    expect(report.snapshotWritten).toBe(true);
    const replay = replaySupplySnapshotsAdr0491({ filePath, mode: 'LATEST' });
    expect(replay.snapshots[0]?.rawProviderPayloadPersisted).toBe(false);

    const failed = await runFreshDataSchedulerAdr0492({
      enabled: true,
      mode: 'OBSERVE_ONLY',
      session: 'AFTER_MARKET',
      jobRunners: { SNAPSHOT_STORE_WRITE: async () => { throw new Error('disk unavailable'); } },
    });
    expect(failed.status).toBe('FAILED_INTERNAL');
    expect(failed.snapshotWritten).toBe(false);
  });

  it('formats diagnostics and exposes ADR-0476/0480/runtime evidence', async () => {
    const report = await runFreshDataSchedulerAdr0492({ enabled: true, mode: 'OBSERVE_ONLY', session: 'AFTER_MARKET', generatedAt: '2026-05-09T18:00:00.000Z', jobRunners: { SECTOR_ENERGY_MASTER: async () => completed('SECTOR_ENERGY_MASTER'), INVESTOR_FLOW_SAMPLE: async () => completed('INVESTOR_FLOW_SAMPLE'), PROGRAM_TRADING_SAMPLE: async () => completed('PROGRAM_TRADING_SAMPLE'), SUPPLY_COVERAGE_RECOVERY: async () => completed('SUPPLY_COVERAGE_RECOVERY'), SUPPLY_READINESS_AUDIT: async () => completed('SUPPLY_READINESS_AUDIT'), SNAPSHOT_STORE_WRITE: async () => completed('SNAPSHOT_STORE_WRITE') } });
    expect(formatFreshDataSchedulerCompactAdr0492(report)).toContain('impact=NONE');
    expect(formatFreshDataSchedulerDetailAdr0492(report)).toContain('liveExecutionAllowed=false');
    expect(formatRuntimePipelineFreshDataSchedulerEvidenceLineAdr0492(report)).toContain('ADR-0492 status=OBSERVING');
    expect(buildFreshDataSchedulerObservationRowAdr0492(report).requiredScore).toBe(70);
    expect(collectOperatorActionSourcesFromFreshDataSchedulerAdr0492(report).some((source) => source.code === 'COLLECT_AFTER_MARKET_FRESH_DATA_SAMPLES')).toBe(true);
  });
});
