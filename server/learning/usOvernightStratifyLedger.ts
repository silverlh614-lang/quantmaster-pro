// @responsibility ADR-0604 미국 야간(SPX/NDX)↔KOSPI 당일 수익 stratify 관측 ledger — 상관 실측 전용 (게이트 미소비).

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';

export const US_OVERNIGHT_STRATIFY_FILE = path.join(DATA_DIR, 'us-overnight-kospi-stratify.json');
const MAX_ROWS = 400; // ~1.5년 — 로그성(당일 완성 행)이라 단순 절단 무해.

export interface UsOvernightObservationRow {
  dateKey: string;
  spxOvernight?: number;
  ndxOvernight?: number;
  kospiDayReturn?: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function loadUsOvernightRows(filePath = US_OVERNIGHT_STRATIFY_FILE): UsOvernightObservationRow[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * KST 일자 단위 upsert — 야간 수익(spx/ndx)은 **first-write-wins**(KST 아침 첫 기록 고정,
 * 미국 장중(KST 야간) 재계산의 당일 오염 방지), kospiDayReturn 은 last-write-wins(종가 수렴).
 */
export function recordUsOvernightObservation(
  input: UsOvernightObservationRow,
  filePath = US_OVERNIGHT_STRATIFY_FILE,
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) return;
  ensureDataDir();
  const rows = loadUsOvernightRows(filePath);
  const existing = rows.find((row) => row.dateKey === input.dateKey);
  if (existing) {
    if (!finite(existing.spxOvernight) && finite(input.spxOvernight)) existing.spxOvernight = input.spxOvernight;
    if (!finite(existing.ndxOvernight) && finite(input.ndxOvernight)) existing.ndxOvernight = input.ndxOvernight;
    if (finite(input.kospiDayReturn)) existing.kospiDayReturn = input.kospiDayReturn;
  } else {
    rows.push({
      dateKey: input.dateKey,
      ...(finite(input.spxOvernight) ? { spxOvernight: input.spxOvernight } : {}),
      ...(finite(input.ndxOvernight) ? { ndxOvernight: input.ndxOvernight } : {}),
      ...(finite(input.kospiDayReturn) ? { kospiDayReturn: input.kospiDayReturn } : {}),
    });
  }
  fs.writeFileSync(filePath, JSON.stringify(rows.slice(-MAX_ROWS)));
}

const OVERNIGHT_BANDS = [
  { key: '<-2%', match: (v: number) => v < -2 },
  { key: '-2~-0.5%', match: (v: number) => v >= -2 && v < -0.5 },
  { key: '-0.5~+0.5%', match: (v: number) => v >= -0.5 && v <= 0.5 },
  { key: '+0.5~+2%', match: (v: number) => v > 0.5 && v <= 2 },
  { key: '>+2%', match: (v: number) => v > 2 },
] as const;

function appendBandLines(
  lines: string[],
  label: 'SPX' | 'NDX',
  paired: { overnight: number; kospi: number }[],
): void {
  for (const band of OVERNIGHT_BANDS) {
    const hits = paired.filter((pair) => band.match(pair.overnight));
    if (hits.length === 0) {
      lines.push(`${label} ${band.key}: n=0`);
      continue;
    }
    const avg = hits.reduce((sum, pair) => sum + pair.kospi, 0) / hits.length;
    const win = hits.filter((pair) => pair.kospi > 0).length / hits.length;
    lines.push(`${label} ${band.key}: n=${hits.length} kospiAvg=${avg.toFixed(2)}% win=${Math.round(win * 100)}%`);
  }
}

/** SPX/NDX 야간 밴드별 KOSPI 당일 수익 실측 — 상관을 가정하지 않고 표본으로 판정 (3단계 활성화 근거).
 *  ADR-0604 잔여 이행: NDX 밴드 분리 통계 (수집만 하던 ndxOvernight 표시 — 게이트 미소비 동일). */
export function buildUsOvernightStratifyLines(rows: UsOvernightObservationRow[] = loadUsOvernightRows()): string {
  const spxPaired = rows
    .filter((row) => finite(row.spxOvernight) && finite(row.kospiDayReturn))
    .map((row) => ({ overnight: row.spxOvernight as number, kospi: row.kospiDayReturn as number }));
  const ndxPaired = rows
    .filter((row) => finite(row.ndxOvernight) && finite(row.kospiDayReturn))
    .map((row) => ({ overnight: row.ndxOvernight as number, kospi: row.kospiDayReturn as number }));
  const lines = ['[US Overnight → KOSPI Stratify (ADR-0604 관측)]'];
  if (spxPaired.length === 0 && ndxPaired.length === 0) {
    lines.push(`pairedRows=0 (수집 누적 대기 — 총 기록 ${rows.length}건)`);
  } else {
    appendBandLines(lines, 'SPX', spxPaired);
    if (ndxPaired.length > 0) appendBandLines(lines, 'NDX', ndxPaired);
    lines.push(`pairedRows: spx=${spxPaired.length} ndx=${ndxPaired.length}`);
  }
  lines.push('게이트 미소비 — 3단계(개장 전 보수 강등) 활성화 판단 근거. executionImpact=NONE');
  return lines.join('\n');
}
