/**
 * @responsibility ADR-0625 shakeoutStopOutcomeRepo 회귀 — atomic write / 손상 fallback / upsert RESOLVED 불변성
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakeout-repo-'));
process.env.PERSIST_DATA_DIR = tmpDir;

let repo: typeof import('./shakeoutStopOutcomeRepo.js');
type Label = import('../learning/shakeoutStopForwardLabeler.js').ShakeoutStopOutcomeLabel;

function makeLabel(over: Partial<Label> = {}): Label {
  return {
    tradeId: 'T1',
    stockCode: '219130',
    exitTimeKst: '2026-06-02',
    exitPrice: 10000,
    maturity: 'PENDING',
    observationOnly: true,
    ...over,
  } as Label;
}

beforeEach(async () => {
  vi.resetModules();
  repo = await import('./shakeoutStopOutcomeRepo.js');
  repo.__resetShakeoutStopOutcomeLedgerForTests();
});

afterEach(() => {
  try {
    fs.readdirSync(tmpDir).forEach((f) => {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
});

describe('shakeoutStopOutcomeRepo (ADR-0625)', () => {
  it('load 부재 → 빈 배열', () => {
    expect(repo.loadLabels()).toEqual([]);
  });

  it('upsertLabel 신규 → created', () => {
    const r = repo.upsertLabel(makeLabel());
    expect(r.created).toBe(true);
    expect(repo.loadLabels()).toHaveLength(1);
  });

  it('upsertLabel PENDING 교체 → updated (last-write-wins)', () => {
    repo.upsertLabel(makeLabel({ maturity: 'PENDING' }));
    const r = repo.upsertLabel(makeLabel({ maturity: 'PENDING', forwardClose1d: 10200 }));
    expect(r.updated).toBe(true);
    expect(repo.loadLabels()[0].forwardClose1d).toBe(10200);
  });

  it('upsertLabel RESOLVED 불변성 → 재기입 skip', () => {
    repo.upsertLabel(makeLabel({ maturity: 'RESOLVED', isShakeout: true, maxRecoveryPct: 6 }));
    const r = repo.upsertLabel(makeLabel({ maturity: 'RESOLVED', isShakeout: false, maxRecoveryPct: 99 }));
    expect(r.resolvedSkipped).toBe(true);
    expect(r.created).toBe(false);
    expect(r.updated).toBe(false);
    // 불변 — 기존 RESOLVED 값 보존.
    expect(repo.loadLabels()[0].maxRecoveryPct).toBe(6);
    expect(repo.loadLabels()[0].isShakeout).toBe(true);
  });

  it('손상 JSON → 빈 배열 fallback (시스템 무중단)', async () => {
    const { SHAKEOUT_STOP_OUTCOME_LEDGER_FILE } = await import('./paths.js');
    fs.writeFileSync(SHAKEOUT_STOP_OUTCOME_LEDGER_FILE, '{ corrupted json');
    expect(repo.loadLabels()).toEqual([]);
  });

  it('atomic write — tmp 파일 잔존 0 (rename 완료)', async () => {
    repo.upsertLabel(makeLabel());
    const { SHAKEOUT_STOP_OUTCOME_LEDGER_FILE } = await import('./paths.js');
    expect(fs.existsSync(`${SHAKEOUT_STOP_OUTCOME_LEDGER_FILE}.tmp`)).toBe(false);
    expect(fs.existsSync(SHAKEOUT_STOP_OUTCOME_LEDGER_FILE)).toBe(true);
  });
});
