/**
 * @responsibility ADR-0650 pullbackLaneObservationRepo 회귀 — 멱등 upsert / RESOLVED 불변성 / 손상 fallback / aggregate verdict 경계.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pullback-obs-repo-'));
process.env.PERSIST_DATA_DIR = tmpDir;

let repo: typeof import('./pullbackLaneObservationRepo.js');
type Row = import('../learning/pullbackLaneObservationTypes.js').PullbackLaneObservationRow;

function makeRow(over: Partial<Row> = {}): Row {
  return {
    scanId: 'SCAN-1',
    symbol: '005930',
    asOf: '2026-06-23T00:00:00.000Z',
    pullbackLaneHypotheticalFired: true,
    breakoutChaseLaneFired: false,
    overheatGuardTriggered: false,
    posVsHigh20d: 0.95,
    volRatio: 0.7,
    aboveMa20: true,
    maturity: 'PENDING',
    observationOnly: true,
    ...over,
  } as Row;
}

beforeEach(async () => {
  vi.resetModules();
  repo = await import('./pullbackLaneObservationRepo.js');
  repo.__resetPullbackLaneObservationLedgerForTests();
});

afterEach(() => {
  try {
    fs.readdirSync(tmpDir).forEach((f) => {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
});

describe('pullbackLaneObservationRepo (ADR-0650) — 영속/멱등', () => {
  it('load 부재 → 빈 배열', () => {
    expect(repo.loadObservations()).toEqual([]);
  });

  it('upsert 신규 → created', () => {
    const r = repo.upsertObservation(makeRow());
    expect(r.created).toBe(true);
    expect(repo.loadObservations()).toHaveLength(1);
  });

  it('멱등 키 scanId:symbol — 동일 키 재upsert 는 행 증가 0 (last-write-wins)', () => {
    repo.upsertObservation(makeRow({ posVsHigh20d: 0.95 }));
    const r = repo.upsertObservation(makeRow({ posVsHigh20d: 0.97 }));
    expect(r.updated).toBe(true);
    const rows = repo.loadObservations();
    expect(rows).toHaveLength(1);
    expect(rows[0].posVsHigh20d).toBe(0.97);
  });

  it('다른 symbol 은 별도 행', () => {
    repo.upsertObservation(makeRow({ symbol: '005930' }));
    repo.upsertObservation(makeRow({ symbol: '000660' }));
    expect(repo.loadObservations()).toHaveLength(2);
  });

  it('RESOLVED 불변성 — 재기입 skip', () => {
    repo.upsertObservation(makeRow({ maturity: 'RESOLVED', forwardReturn5d: 3.2, maturedAt: '2026-06-30T00:00:00.000Z' }));
    const r = repo.upsertObservation(makeRow({ maturity: 'PENDING', forwardReturn5d: 9.9 }));
    expect(r.resolvedSkipped).toBe(true);
    expect(repo.loadObservations()[0].forwardReturn5d).toBe(3.2);
  });

  it('손상 JSON → 빈 배열 fallback', async () => {
    const { PULLBACK_LANE_OBSERVATION_LEDGER_FILE } = await import('./paths.js');
    fs.writeFileSync(PULLBACK_LANE_OBSERVATION_LEDGER_FILE, '{ not valid json');
    expect(repo.loadObservations()).toEqual([]);
  });

  it('atomic write — .tmp 잔존 0', () => {
    repo.upsertObservation(makeRow());
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toHaveLength(0);
  });

  it('loadMaturedObservations 는 RESOLVED 만, loadPendingObservations 는 PENDING 만', () => {
    repo.upsertObservation(makeRow({ symbol: 'A', maturity: 'PENDING' }));
    repo.upsertObservation(makeRow({ symbol: 'B', maturity: 'RESOLVED', forwardReturn5d: 1 }));
    expect(repo.loadMaturedObservations().map((r) => r.symbol)).toEqual(['B']);
    expect(repo.loadPendingObservations().map((r) => r.symbol)).toEqual(['A']);
  });
});

describe('buildPullbackVsChaseComparison (ADR-0650 §D4) — verdict 경계', () => {
  function resolvedPullback(symbol: string, fwd5: number, rrr?: number): Row {
    return makeRow({
      symbol,
      maturity: 'RESOLVED',
      pullbackLaneHypotheticalFired: true,
      breakoutChaseLaneFired: false,
      forwardReturn1d: 1,
      forwardReturn3d: 2,
      forwardReturn5d: fwd5,
      entryRrr: rrr,
    });
  }
  function resolvedChase(symbol: string, fwd5: number): Row {
    return makeRow({
      symbol,
      maturity: 'RESOLVED',
      pullbackLaneHypotheticalFired: false,
      breakoutChaseLaneFired: true,
      forwardReturn1d: 0.5,
      forwardReturn3d: 1,
      forwardReturn5d: fwd5,
    });
  }

  it('표본 0 → INSUFFICIENT_OR_ROLLBACK, avg null 안전', () => {
    const c = repo.buildPullbackVsChaseComparison([]);
    expect(c.verdict).toBe('INSUFFICIENT_OR_ROLLBACK');
    expect(c.pullback.avgForwardReturn5d).toBeNull();
    expect(c.chase.avgForwardReturn5d).toBeNull();
  });

  it('N=29 (<30) → 눌림목 우월이어도 INSUFFICIENT_OR_ROLLBACK', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 29; i += 1) rows.push(resolvedPullback(`P${i}`, 5));
    rows.push(resolvedChase('C1', 1));
    const c = repo.buildPullbackVsChaseComparison(rows);
    expect(c.pullback.nD5).toBe(29);
    expect(c.verdict).toBe('INSUFFICIENT_OR_ROLLBACK');
  });

  it('N=30 && 눌림목 avg5D ≥ 추격 avg5D → HOLD', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 30; i += 1) rows.push(resolvedPullback(`P${i}`, 5));
    rows.push(resolvedChase('C1', 1));
    const c = repo.buildPullbackVsChaseComparison(rows);
    expect(c.pullback.nD5).toBe(30);
    expect(c.verdict).toBe('HOLD');
  });

  it('N=30 동률(눌림목 avg5D == 추격 avg5D) → HOLD (>= 눌림목 우월)', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 30; i += 1) rows.push(resolvedPullback(`P${i}`, 3));
    for (let i = 0; i < 5; i += 1) rows.push(resolvedChase(`C${i}`, 3));
    const c = repo.buildPullbackVsChaseComparison(rows);
    expect(c.verdict).toBe('HOLD');
  });

  it('N=30 이지만 추격 우월 → INSUFFICIENT_OR_ROLLBACK', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 30; i += 1) rows.push(resolvedPullback(`P${i}`, 1));
    for (let i = 0; i < 5; i += 1) rows.push(resolvedChase(`C${i}`, 9));
    const c = repo.buildPullbackVsChaseComparison(rows);
    expect(c.verdict).toBe('INSUFFICIENT_OR_ROLLBACK');
  });

  it('PENDING 행은 집계 제외 (RESOLVED 만)', () => {
    const rows: Row[] = [makeRow({ symbol: 'P', maturity: 'PENDING', forwardReturn5d: 5 })];
    const c = repo.buildPullbackVsChaseComparison(rows);
    expect(c.pullback.nD5).toBe(0);
  });

  it('entryLane=PULLBACK 도 눌림목 분류 (hypotheticalFired 무관)', () => {
    const rows: Row[] = [makeRow({
      symbol: 'L', maturity: 'RESOLVED', pullbackLaneHypotheticalFired: false,
      entryLane: 'PULLBACK', forwardReturn5d: 4, entryRrr: 2.5,
    })];
    const c = repo.buildPullbackVsChaseComparison(rows);
    expect(c.pullback.nD5).toBe(1);
    expect(c.pullback.avgEntryRrr).toBe(2.5);
  });
});
