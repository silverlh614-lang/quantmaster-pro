import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttributionEvidenceUpsertInput } from './attributionEvidenceLedgerRepo.js';

let tmpDir = '';
const originalDataDir = process.env.PERSIST_DATA_DIR;

function baseEvidence(overrides: Partial<AttributionEvidenceUpsertInput> = {}): AttributionEvidenceUpsertInput {
  return {
    tradeDate: '2026-05-02',
    symbol: '005930',
    stockName: 'Samsung',
    regime: 'R2_BULL',
    conditionKeys: ['momentum'],
    source: 'LIVE',
    outcomeStatus: 'CONFIRMED',
    executionStatus: 'EXECUTED',
    engineMode: 'NORMAL',
    dataConfidence: 'VERIFIED',
    signalId: 'signal-1',
    positionId: 'position-1',
    returnPct: 1.2,
    winLoss: 'WIN',
    executionImpact: 'NONE',
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-evidence-ledger-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = originalDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe('attribution evidence ledger', () => {
  it('upserts duplicate evidenceId instead of inserting another record', async () => {
    const repo = await import('./attributionEvidenceLedgerRepo.js');

    const first = repo.upsertAttributionEvidenceRecord(baseEvidence({ returnPct: 1.2, auditTags: ['FIRST'] }));
    const second = repo.upsertAttributionEvidenceRecord(baseEvidence({ returnPct: -0.4, winLoss: 'LOSS', auditTags: ['UPDATED'] }));
    const records = repo.loadAttributionEvidenceForMonth('2026-05');

    expect(second.evidenceId).toBe(first.evidenceId);
    expect(records).toHaveLength(1);
    expect(records[0].returnPct).toBe(-0.4);
    expect(records[0].winLoss).toBe('LOSS');
    expect(records[0].auditTags).toEqual(['UPDATED']);
    expect(records[0].createdAt).toBe(first.createdAt);
  });
});
