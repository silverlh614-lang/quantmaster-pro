// @responsibility Task B 회귀 — KOSPI 봉 인접성 sanity(stratify 전용 가드): 결손 갭 봉 → 미기록, 정상 인접 → byte-identical 기록.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { areKospiBarsAdjacentTradingDays } from './indexMacroSections.js';
import {
  buildUsOvernightStratifyLines,
  loadUsOvernightRows,
  recordUsOvernightObservation,
} from '../../learning/usOvernightStratifyLedger.js';

// Yahoo ts = epoch seconds (UTC). KST 09:00 마감 근사 — 거래일 식별엔 날짜만 사용.
function tsFor(ymd: string): number {
  // KST 정오(03:00 UTC) — 환산 후 KST 날짜가 ymd 가 되도록.
  return Math.floor(Date.UTC(
    Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)), 3, 0, 0,
  ) / 1000);
}

describe('areKospiBarsAdjacentTradingDays', () => {
  it('월→화 연속 거래일 → 인접 true', () => {
    expect(areKospiBarsAdjacentTradingDays(tsFor('2026-06-15'), tsFor('2026-06-16'))).toBe(true);
  });

  it('금→월 주말 건너뜀 → 인접 true (사이 평일 0)', () => {
    // 2026-06-12 금, 2026-06-15 월
    expect(areKospiBarsAdjacentTradingDays(tsFor('2026-06-12'), tsFor('2026-06-15'))).toBe(true);
  });

  it('금→화 (월요일 봉 결손) → 인접 false — 2일 갭이 1일로 압축됐을 위험', () => {
    // 사이에 월(2026-06-15) 평일 1개 → 결손 의심
    expect(areKospiBarsAdjacentTradingDays(tsFor('2026-06-12'), tsFor('2026-06-16'))).toBe(false);
  });

  it('수→금 (목요일 봉 결손) → 인접 false', () => {
    expect(areKospiBarsAdjacentTradingDays(tsFor('2026-06-10'), tsFor('2026-06-12'))).toBe(false);
  });

  it('같은 날 중복 봉 → false (비정상)', () => {
    expect(areKospiBarsAdjacentTradingDays(tsFor('2026-06-15'), tsFor('2026-06-15'))).toBe(false);
  });

  it('역순/비정상 ts → false', () => {
    expect(areKospiBarsAdjacentTradingDays(tsFor('2026-06-16'), tsFor('2026-06-15'))).toBe(false);
    expect(areKospiBarsAdjacentTradingDays(NaN, tsFor('2026-06-15'))).toBe(false);
  });
});

// 가드가 의존하는 메커니즘 검증: kospiDayReturn 미전달(undefined) → 행 미완성 → stratify paired 제외.
describe('stratify 가드 메커니즘 (kospiDayReturn 미전달 시 paired 제외)', () => {
  const files: string[] = [];
  afterEach(() => {
    for (const f of files) if (fs.existsSync(f)) fs.rmSync(f);
    files.length = 0;
  });
  function tmp(): string {
    const f = path.join(os.tmpdir(), `us-overnight-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    files.push(f);
    return f;
  }

  it('kospiDayReturn undefined → 행 미완성, paired 에서 자동 제외(인플레 outlier 미누적)', () => {
    const file = tmp();
    // outlier 인플레 값은 미전달(undefined) — 가드가 봉 결손 시 하는 동작.
    recordUsOvernightObservation({ dateKey: '2026-06-16', spxOvernight: 1.2, kospiDayReturn: undefined }, file);
    const rows = loadUsOvernightRows(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('kospiDayReturn');     // 행 미완성
    const lines = buildUsOvernightStratifyLines(rows);
    expect(lines).toContain('pairedRows=0');                   // paired 통계에 미누적
  });

  it('정상 인접 봉 → kospiDayReturn 전달 시 행 완성 + paired 포함(byte-identical 기록)', () => {
    const file = tmp();
    recordUsOvernightObservation({ dateKey: '2026-06-16', spxOvernight: 1.2, kospiDayReturn: 0.8 }, file);
    const rows = loadUsOvernightRows(file);
    expect(rows[0].kospiDayReturn).toBe(0.8);
    expect(buildUsOvernightStratifyLines(rows)).toContain('pairedRows: spx=1');
  });
});
