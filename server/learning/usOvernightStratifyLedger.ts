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

const SPX_BANDS = [
  { key: '<-2%', match: (v: number) => v < -2 },
  { key: '-2~-0.5%', match: (v: number) => v >= -2 && v < -0.5 },
  { key: '-0.5~+0.5%', match: (v: number) => v >= -0.5 && v <= 0.5 },
  { key: '+0.5~+2%', match: (v: number) => v > 0.5 && v <= 2 },
  { key: '>+2%', match: (v: number) => v > 2 },
] as const;

/** SPX 야간 밴드별 KOSPI 당일 수익 실측 — 상관을 가정하지 않고 표본으로 판정 (3단계 활성화 근거). */
export function buildUsOvernightStratifyLines(rows: UsOvernightObservationRow[] = loadUsOvernightRows()): string {
  const paired = rows.filter((row) => finite(row.spxOvernight) && finite(row.kospiDayReturn));
  const lines = ['[US Overnight → KOSPI Stratify (ADR-0604 관측)]'];
  if (paired.length === 0) {
    lines.push(`pairedRows=0 (수집 누적 대기 — 총 기록 ${rows.length}건)`);
  } else {
    for (const band of SPX_BANDS) {
      const hits = paired.filter((row) => band.match(row.spxOvernight as number));
      if (hits.length === 0) {
        lines.push(`SPX ${band.key}: n=0`);
        continue;
      }
      const avg = hits.reduce((sum, row) => sum + (row.kospiDayReturn as number), 0) / hits.length;
      const win = hits.filter((row) => (row.kospiDayReturn as number) > 0).length / hits.length;
      lines.push(`SPX ${band.key}: n=${hits.length} kospiAvg=${avg.toFixed(2)}% win=${Math.round(win * 100)}%`);
    }
    lines.push(`pairedRows=${paired.length} / ndxCollected=${rows.filter((row) => finite(row.ndxOvernight)).length}`);
  }
  lines.push('게이트 미소비 — 3단계(개장 전 보수 강등) 활성화 판단 근거. executionImpact=NONE');
  return lines.join('\n');
}
