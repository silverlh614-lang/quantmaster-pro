// @responsibility leadershipBridgeLedgerRepo append/summary 회귀 (ADR-0551 shadow 검증 계측).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { LeadershipBridgeLedgerEntry } from './leadershipBridgeLedgerRepo.js';

function entry(overrides: Partial<LeadershipBridgeLedgerEntry> = {}): LeadershipBridgeLedgerEntry {
  return {
    ts: new Date().toISOString(),
    fed: 3,
    added: 0,
    refreshed: 0,
    skippedTotal: 0,
    skippedByReason: {},
    addedCodes: [],
    refreshedCodes: [],
    kospiDayReturn: 0.5,
    ...overrides,
  };
}

describe('leadershipBridgeLedgerRepo (ADR-0551 shadow 검증)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-ledger-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('파일 없으면 빈 ledger', async () => {
    const { loadLeadershipBridgeLedger } = await import('./leadershipBridgeLedgerRepo.js');
    expect(loadLeadershipBridgeLedger().entries).toEqual([]);
  });

  it('append → load roundtrip + 편입코드 보존', async () => {
    const m = await import('./leadershipBridgeLedgerRepo.js');
    m.appendLeadershipBridgeLedgerEntry(entry({ added: 2, addedCodes: ['005930', '000660'] }));
    const loaded = m.loadLeadershipBridgeLedger();
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].added).toBe(2);
    expect(loaded.entries[0].addedCodes).toEqual(['005930', '000660']);
  });

  it('summarize injectionRate = added>0 세션 비율 (1차 게이트)', async () => {
    const m = await import('./leadershipBridgeLedgerRepo.js');
    m.appendLeadershipBridgeLedgerEntry(entry({ added: 1, addedCodes: ['A'] }));
    m.appendLeadershipBridgeLedgerEntry(entry({ added: 0, skippedTotal: 3, skippedByReason: { not_qualified: 3 } }));
    m.appendLeadershipBridgeLedgerEntry(entry({ added: 2, addedCodes: ['B', 'C'] }));
    const s = m.summarizeLeadershipBridgeLedger();
    expect(s.totalSessions).toBe(3);
    expect(s.sessionsWithInjection).toBe(2);
    expect(s.injectionRate).toBeCloseTo(2 / 3);
    expect(s.totalAdded).toBe(3);
    expect(s.executionImpact).toBe('NONE');
  });

  it('summarize topSkipReasons 집계·내림차순', async () => {
    const m = await import('./leadershipBridgeLedgerRepo.js');
    m.appendLeadershipBridgeLedgerEntry(entry({ skippedByReason: { not_qualified: 5, momentum_full: 1 } }));
    m.appendLeadershipBridgeLedgerEntry(entry({ skippedByReason: { not_qualified: 2, base_momentum_exists: 4 } }));
    const s = m.summarizeLeadershipBridgeLedger();
    expect(s.topSkipReasons[0]).toEqual({ reason: 'not_qualified', count: 7 });
    expect(s.topSkipReasons.find((r) => r.reason === 'base_momentum_exists')?.count).toBe(4);
  });

  it('injectionRate 0 (added 전무) → feeder 병목 신호', async () => {
    const m = await import('./leadershipBridgeLedgerRepo.js');
    m.appendLeadershipBridgeLedgerEntry(entry({ added: 0, skippedTotal: 2, skippedByReason: { not_qualified: 2 } }));
    const s = m.summarizeLeadershipBridgeLedger();
    expect(s.injectionRate).toBe(0);
    expect(s.sessionsWithInjection).toBe(0);
  });

  it('format — injection 0 → feeder 병목 판정 + flag OFF 라인', async () => {
    const m = await import('./leadershipBridgeLedgerRepo.js');
    m.appendLeadershipBridgeLedgerEntry(entry({ added: 0, skippedTotal: 2, skippedByReason: { not_qualified: 2 } }));
    const lines = m.formatLeadershipBridgeLedgerSummaryLines(m.summarizeLeadershipBridgeLedger(), false);
    expect(lines.some((l) => l.includes('flag LEADERSHIP_BRIDGE_ENABLED=OFF'))).toBe(true);
    expect(lines.some((l) => l.includes('병목=feeder'))).toBe(true);
  });

  it('format — injection>0 → 평가 가능 판정 + flag ON 라인', async () => {
    const m = await import('./leadershipBridgeLedgerRepo.js');
    m.appendLeadershipBridgeLedgerEntry(entry({ added: 2, addedCodes: ['A', 'B'] }));
    const lines = m.formatLeadershipBridgeLedgerSummaryLines(m.summarizeLeadershipBridgeLedger(), true);
    expect(lines.some((l) => l.includes('flag LEADERSHIP_BRIDGE_ENABLED=ON'))).toBe(true);
    expect(lines.some((l) => l.includes('주입 발생'))).toBe(true);
  });

  it('format — 기록 없음 → 데이터 없음 판정', async () => {
    const m = await import('./leadershipBridgeLedgerRepo.js');
    const lines = m.formatLeadershipBridgeLedgerSummaryLines(m.summarizeLeadershipBridgeLedger(), false);
    expect(lines.some((l) => l.includes('데이터 없음'))).toBe(true);
  });
});
