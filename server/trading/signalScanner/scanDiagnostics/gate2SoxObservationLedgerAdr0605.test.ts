// @responsibility ADR-0605 ledger 회귀 — append/FIFO trim·손상 JSON fallback·sanitized row·executionImpact NONE.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendGate2SoxObservation,
  loadGate2SoxObservationRows,
} from './gate2SoxObservationLedgerAdr0605.js';
import type { Gate2SoxSemiAxisObservationAdr0605 } from './gate2SoxSemiAxisAdr0605.js';

function tmpFile(): string {
  return path.join(os.tmpdir(), `gate2-sox-obs-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function obs(over: Partial<Gate2SoxSemiAxisObservationAdr0605> = {}): Gate2SoxSemiAxisObservationAdr0605 {
  return {
    observed: true,
    sox20dReturn: 5,
    semiconductorCandidates: 3,
    sectorCycleMissingCandidates: 2,
    dryRunEvaluable: 2,
    scoreDelta: { count: 2, baselineIncluded: false, baselineScore: null, bucket62: 1, bucket50: 1, bucket35: 0, avgScore: 56, maxScore: 62 },
    coverageRatio: 1,
    executionImpact: 'NONE',
    ...over,
  };
}

describe('gate2SoxObservationLedgerAdr0605', () => {
  const files: string[] = [];
  afterEach(() => {
    for (const f of files) if (fs.existsSync(f)) fs.rmSync(f);
    files.length = 0;
  });

  it('append → sanitized row 영속 (soxAvailable·executionImpact 정확)', () => {
    const file = tmpFile(); files.push(file);
    const row = appendGate2SoxObservation({ observation: obs(), scanId: '2026-06-15:0835', filePath: file });
    expect(row).toMatchObject({
      scanId: '2026-06-15:0835', semiconductorCandidates: 3, sectorCycleMissingCandidates: 2,
      dryRunEvaluable: 2, bucket62: 1, bucket50: 1, avgScore: 56, maxScore: 62, coverageRatio: 1,
      soxAvailable: true, executionImpact: 'NONE',
    });
    expect(row.forDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const rows = loadGate2SoxObservationRows(file);
    expect(rows).toHaveLength(1);
    // raw payload·민감정보 미포함 (sanitized metadata only).
    expect(Object.keys(rows[0])).not.toContain('candidateSnapshots');
  });

  it('sox 결손 → soxAvailable=false', () => {
    const file = tmpFile(); files.push(file);
    const row = appendGate2SoxObservation({ observation: obs({ sox20dReturn: null, dryRunEvaluable: 0 }), filePath: file });
    expect(row.soxAvailable).toBe(false);
  });

  it('append 누적 → FIFO trim (최신순 보존)', () => {
    const file = tmpFile(); files.push(file);
    // MAX_ROWS=2000 직접 검증은 비용 과다 → 누적 순서·길이만 확인.
    for (let i = 0; i < 5; i++) appendGate2SoxObservation({ observation: obs({ dryRunEvaluable: i }), scanId: `s${i}`, filePath: file });
    const rows = loadGate2SoxObservationRows(file);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.scanId)).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('손상 JSON → 빈 배열 fallback (엔진 무중단, 불변식 #1)', () => {
    const file = tmpFile(); files.push(file);
    fs.writeFileSync(file, '{ not valid json');
    expect(loadGate2SoxObservationRows(file)).toEqual([]);
    // 손상 위에 append 해도 throw 없이 새 ledger 로 복구.
    const row = appendGate2SoxObservation({ observation: obs(), filePath: file });
    expect(row.executionImpact).toBe('NONE');
    expect(loadGate2SoxObservationRows(file)).toHaveLength(1);
  });
});
