import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir = '';
const originalDataDir = process.env.PERSIST_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regime-calibrator-evidence-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = originalDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe('RegimeCalibrator evidence hygiene', () => {
  it('does not change active regime weights from counterfactualOnly losses', async () => {
    const weightFile = path.join(tmpDir, 'condition-weights-R2_BULL.json');
    fs.writeFileSync(weightFile, JSON.stringify({ momentum: 1 }, null, 2));

    const repo = await import('../persistence/attributionEvidenceLedgerRepo.js');
    for (let i = 0; i < 12; i++) {
      repo.upsertAttributionEvidenceRecord({
        tradeDate: '2026-05-11',
        symbol: `0060${String(i).padStart(2, '0')}`,
        regime: 'R2_BULL',
        conditionKeys: ['momentum'],
        source: 'COUNTERFACTUAL',
        outcomeStatus: 'CONFIRMED',
        executionStatus: 'NOT_EXECUTED',
        engineMode: 'NORMAL',
        dataConfidence: 'VERIFIED',
        signalId: `signal-${i}`,
        counterfactualId: `cf-${i}`,
        returnPct: -8,
        winLoss: 'LOSS',
      });
    }

    const { calibrateByRegime } = await import('./regimeAwareCalibrator.js');
    await calibrateByRegime({ month: '2026-05' });

    expect(JSON.parse(fs.readFileSync(weightFile, 'utf-8'))).toEqual({ momentum: 1 });
  }, 20_000);
});
