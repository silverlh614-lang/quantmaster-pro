// @responsibility ADR-458 Gate Reclassification Dry-Run Ledger 회귀 테스트
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateReclassificationDryRunRecord } from './gateReclassificationDryRunRepo.js';

let tmpDir = '';

function record(code: string, date: string, decision: GateReclassificationDryRunRecord['dryRunDecision']): GateReclassificationDryRunRecord {
  return {
    id: `${code}-${date}-${decision}`,
    observedAt: '2026-05-08T00:00:00.000Z',
    observedDateKst: date,
    status: 'OUTCOME_PENDING',
    code,
    name: `name-${code}`,
    originalBucket: 'REJECTED',
    dryRunDecision: decision,
    matchedApprovedConditions: ['entry_price'],
    appliedProposedClasses: [{ condition: 'entry_price', source: 'thresholdNotMetConditions', proposedClass: 'WAIT_TRIGGER' }],
    originalRawScore: 60,
    originalNormalizedGateScore: 0.68,
    dryRunScoreAdjustment: 0.1,
    dryRunExplanation: 'dry-run only',
    executionImpact: 'NONE',
    createLiveOrder: false,
    requiresHumanApproval: true,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr458-dryrun-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PERSIST_DATA_DIR;
  vi.resetModules();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ADR-458 Gate Reclassification Dry-Run Repo', () => {
  it('repo upsert 중복 방지', async () => {
    const repo = await import('./gateReclassificationDryRunRepo.js');
    repo.upsertGateReclassificationDryRunRecord(record('005930', '2026-05-08', 'DRY_RUN_RESCUED_TO_WAIT_TRIGGER'));
    repo.upsertGateReclassificationDryRunRecord({
      ...record('005930', '2026-05-08', 'DRY_RUN_RESCUED_TO_WAIT_TRIGGER'),
      name: 'updated',
    });

    const rows = repo.loadGateReclassificationDryRunRecords();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('updated');
  });

  it('repo 손상 JSON fallback', async () => {
    const repo = await import('./gateReclassificationDryRunRepo.js');
    const paths = await import('./paths.js');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(paths.GATE_RECLASSIFICATION_DRY_RUN_FILE, '{ broken');
    expect(repo.loadGateReclassificationDryRunRecords()).toEqual([]);
  });

  it('repo FIFO trim', async () => {
    const repo = await import('./gateReclassificationDryRunRepo.js');
    const rows = Array.from({ length: repo.GATE_RECLASSIFICATION_DRY_RUN_MAX_RECORDS + 5 }, (_, index) => (
      record(String(index).padStart(6, '0'), '2026-05-08', 'DRY_RUN_RESCUED_TO_SCORE_ONLY')
    ));

    repo.saveGateReclassificationDryRunRecords(rows);
    const loaded = repo.loadGateReclassificationDryRunRecords();
    expect(loaded).toHaveLength(repo.GATE_RECLASSIFICATION_DRY_RUN_MAX_RECORDS);
    expect(loaded[0].code).toBe('000005');
  });
});
