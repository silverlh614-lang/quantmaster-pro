// @responsibility ADR-0604 stratify ledger 회귀 — upsert 의미론(first/last-write)·밴드 집계·빈 표본.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildUsOvernightStratifyLines,
  loadUsOvernightRows,
  recordUsOvernightObservation,
} from './usOvernightStratifyLedger.js';

function tempFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'us-overnight-')), 'ledger.json');
}

describe('usOvernightStratifyLedger', () => {
  it('upsert — 야간 수익 first-write-wins(미국 장중 오염 방지)·kospi last-write-wins(종가 수렴)', () => {
    const file = tempFile();
    recordUsOvernightObservation({ dateKey: '2026-06-12', spxOvernight: -2.8, ndxOvernight: -3.4 }, file);
    recordUsOvernightObservation({ dateKey: '2026-06-12', spxOvernight: 1.1, kospiDayReturn: -0.9 }, file);
    recordUsOvernightObservation({ dateKey: '2026-06-12', kospiDayReturn: -1.4 }, file);
    const rows = loadUsOvernightRows(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dateKey: '2026-06-12', spxOvernight: -2.8, ndxOvernight: -3.4, kospiDayReturn: -1.4 });
  });

  it('밴드 집계 — SPX 야간 밴드별 KOSPI 평균/승률 + 미페어 행 제외', () => {
    const file = tempFile();
    recordUsOvernightObservation({ dateKey: '2026-06-10', spxOvernight: -2.8, kospiDayReturn: -1.4 }, file);
    recordUsOvernightObservation({ dateKey: '2026-06-11', spxOvernight: -2.5, kospiDayReturn: -0.6 }, file);
    recordUsOvernightObservation({ dateKey: '2026-06-12', spxOvernight: 1.2, kospiDayReturn: 0.8 }, file);
    recordUsOvernightObservation({ dateKey: '2026-06-13', spxOvernight: 0.1 }, file); // kospi 미수집 — 제외
    const text = buildUsOvernightStratifyLines(loadUsOvernightRows(file));
    expect(text).toContain('SPX <-2%: n=2 kospiAvg=-1.00% win=0%');
    expect(text).toContain('SPX +0.5~+2%: n=1 kospiAvg=0.80% win=100%');
    expect(text).toContain('pairedRows: spx=3 ndx=0');
    expect(text).not.toContain('NDX <-2%'); // ndx 표본 0 → NDX 섹션 생략
  });

  it('NDX 밴드 분리 — ndx 페어 존재 시 NDX 섹션 출력 (ADR-0604 잔여 이행)', () => {
    const file = tempFile();
    recordUsOvernightObservation({ dateKey: '2026-06-10', spxOvernight: -2.8, ndxOvernight: -3.1, kospiDayReturn: -1.4 }, file);
    recordUsOvernightObservation({ dateKey: '2026-06-11', spxOvernight: 0.2, ndxOvernight: 2.4, kospiDayReturn: 0.5 }, file);
    const text = buildUsOvernightStratifyLines(loadUsOvernightRows(file));
    expect(text).toContain('NDX <-2%: n=1 kospiAvg=-1.40% win=0%');
    expect(text).toContain('NDX >+2%: n=1 kospiAvg=0.50% win=100%');
    expect(text).toContain('pairedRows: spx=2 ndx=2');
  });

  it('표본 0 — 수집 대기 정직 표시 + 게이트 미소비 명시', () => {
    const text = buildUsOvernightStratifyLines([]);
    expect(text).toContain('pairedRows=0');
    expect(text).toContain('게이트 미소비');
  });
});
