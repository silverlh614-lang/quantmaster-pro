import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir = '';
const originalDataDir = process.env.PERSIST_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'condition-auditor-evidence-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = originalDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe('Condition Auditor evidence hygiene', () => {
  it('does not move ACTIVE to PROBATION from shadowOnly losses', async () => {
    const repo = await import('../persistence/attributionEvidenceLedgerRepo.js');
    for (let i = 0; i < 12; i++) {
      repo.upsertAttributionEvidenceRecord({
        tradeDate: '2026-05-10',
        symbol: `0059${String(i).padStart(2, '0')}`,
        regime: 'R2_BULL',
        conditionKeys: ['momentum'],
        source: 'SHADOW',
        outcomeStatus: 'CONFIRMED',
        executionStatus: 'PAPER_FILLED',
        engineMode: 'NORMAL',
        dataConfidence: 'VERIFIED',
        signalId: `signal-${i}`,
        shadowPositionId: `shadow-${i}`,
        returnPct: -5,
        winLoss: 'LOSS',
      });
    }

    const { runConditionAudit } = await import('./conditionAuditor.js');
    await runConditionAudit({ month: '2026-05' });

    expect(fs.existsSync(path.join(tmpDir, 'condition-audit.json'))).toBe(false);
  }, 20_000);
});
