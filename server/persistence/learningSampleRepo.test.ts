import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLearningSampleFromDecision, type SupplyHealthSnapshot } from '../learning/supplyHealthLearning.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-sample-repo-'));
process.env.PERSIST_DATA_DIR = tmpDir;

function snapshot(): SupplyHealthSnapshot {
  return {
    summary: {
      ok: 7,
      neutral: 0,
      degraded: 0,
      missing: 0,
      stale: 0,
      cacheStatus: 'fresh',
      overallStatus: 'OK',
    },
    coverage: {
      totalSources: 7,
      okRatio: 1,
      degradedRatio: 0,
      missingRatio: 0,
      minCriticalCoverage: 1,
    },
    sources: {},
    providerTried: ['KIS_API'],
    providerFailed: [],
    providerUsed: ['KIS_API'],
    criticalFlags: {
      investorFlowDegraded: false,
      programTradingMissing: false,
      foreignerTrendDegraded: false,
      zeroFilledSuspected: false,
      offHoursMode: false,
    },
  };
}

describe('learningSampleRepo', () => {
  beforeEach(async () => {
    vi.resetModules();
    const repo = await import('./learningSampleRepo.js');
    repo.__resetLearningSamplesForTests();
  });

  it('append/load round-trip으로 supply health sample을 보존한다', async () => {
    const repo = await import('./learningSampleRepo.js');
    const sample = createLearningSampleFromDecision({
      symbol: '005930',
      name: 'SAMSUNG',
      date: '2026-05-05',
      currentPrice: 75_000,
      rawSignal: 'BUY',
      rawScore: 8,
      positionSize: 10,
      supplyHealthSnapshot: snapshot(),
    });

    repo.appendLearningSample(sample);

    const loaded = repo.loadLearningSamples();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.symbol).toBe('005930');
    expect(loaded[0]!.supplyHealthSnapshot.summary.overallStatus).toBe('OK');
    expect(loaded[0]!.rawSignal).toBe('BUY');
    expect(loaded[0]!.finalSignal).toBe('BUY');
  });
});
