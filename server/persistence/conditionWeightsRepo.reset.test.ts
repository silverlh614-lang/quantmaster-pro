// @responsibility: conditionWeightsRepo reset helper backs up and restores learned condition weights.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadModules() {
  const repo = await import('./conditionWeightsRepo.js');
  const quant = await import('../quantFilter.js');
  return { repo, DEFAULT_CONDITION_WEIGHTS: quant.DEFAULT_CONDITION_WEIGHTS };
}

describe('conditionWeightsRepo reset helper', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'condition-weights-reset-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.PERSIST_DATA_DIR;
    } else {
      process.env.PERSIST_DATA_DIR = originalDataDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('resets global weights to defaults and backs up the prior file', async () => {
    const { repo, DEFAULT_CONDITION_WEIGHTS } = await loadModules();
    repo.saveConditionWeights({ ...DEFAULT_CONDITION_WEIGHTS, momentum: 0.1 });

    const result = repo.resetConditionWeightsToDefault({
      now: new Date('2026-05-25T00:00:00.000Z'),
    });

    expect(result.scope).toBe('global');
    expect(result.resetGlobal).toBe(true);
    expect(result.resetRegimes).toEqual([]);
    expect(result.executionImpact).toBe('NONE');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.shadowLearningImpact).toBe('NONE');
    expect(result.backupFiles).toHaveLength(1);
    expect(fs.existsSync(result.backupFiles[0])).toBe(true);
    expect(JSON.parse(fs.readFileSync(result.backupFiles[0], 'utf-8')).momentum).toBe(0.1);
    expect(repo.loadConditionWeights()).toEqual(DEFAULT_CONDITION_WEIGHTS);
  }, 15000);

  it('resets global plus all known regime files when scope is all', async () => {
    const { repo, DEFAULT_CONDITION_WEIGHTS } = await loadModules();
    repo.saveConditionWeights({ ...DEFAULT_CONDITION_WEIGHTS, momentum: 0.1 });
    repo.saveConditionWeightsByRegime('R2_BULL', {
      ...DEFAULT_CONDITION_WEIGHTS,
      supply_confluence: 0.1,
    });
    repo.saveConditionWeightsByRegime('R5_CAUTION', {
      ...DEFAULT_CONDITION_WEIGHTS,
      per: 0.1,
    });

    const result = repo.resetConditionWeightsToDefault({
      scope: 'all',
      now: new Date('2026-05-25T01:02:03.000Z'),
    });

    expect(result.resetGlobal).toBe(true);
    expect(result.resetRegimes).toEqual([...repo.CONDITION_WEIGHT_REGIMES]);
    expect(result.backupFiles).toHaveLength(3);
    expect(result.touchedFiles).toHaveLength(1 + repo.CONDITION_WEIGHT_REGIMES.length);
    expect(repo.loadConditionWeights()).toEqual(DEFAULT_CONDITION_WEIGHTS);
    expect(repo.loadConditionWeightsByRegime('R2_BULL')).toEqual(DEFAULT_CONDITION_WEIGHTS);
    expect(repo.loadConditionWeightsByRegime('R5_CAUTION')).toEqual(DEFAULT_CONDITION_WEIGHTS);
  }, 15000);
});
