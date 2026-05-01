// @responsibility foreignerRatioRepo 영속 저장소 — 종목별 외인 보유율 시계열 (ADR-0140)
//
// 목적: Naver Finance `foreignerOwnRatio` 단일 스냅샷을 시계열로 누적 →
//       5d/20d 변화율 (구조적 외인 진입/이탈 시그널).
// 페르소나 자료 #6 — 당일 순매수보다 보유율 변화가 *유효한* 외인 의도 신호.
//
// 영속 정책:
//   - 종목별 1 파일: `data/foreigner-ratio/{code}.json`
//   - 일자별 1 row (같은 날짜 중복 → 마지막 값 덮어쓰기)
//   - 30영업일 보관 (FIFO trim)
//   - atomic write (tmp → rename) — race 시 이전 정상 본 보존
//   - 손상 JSON → 빈 배열 fallback
//   - 잘못된 date 형식 row → silent skip

import fs from 'fs';
import path from 'path';
import { FOREIGNER_RATIO_DIR, foreignerRatioFile } from './paths.js';

export interface ForeignerRatioRow {
  date: string;       // YYYY-MM-DD
  ratio: number;      // 외인 보유율 (%)
}

export interface ForeignerRatioTrend {
  current: number;
  changePct5d: number | null;    // %p (퍼센트 포인트, 비율 변화율 아님)
  changePct20d: number | null;   // %p
  sampleSize: number;
  latestDate: string;
}

/** 시계열 보관 한도 (영업일 기준). FIFO trim. */
export const FOREIGNER_RATIO_MAX_ROWS = 30;
/** 5d 변화율 산출 표본 수 (현재값 + 5일 전 = 6 row). */
export const FOREIGNER_RATIO_5D_SAMPLE = 6;
/** 20d 변화율 산출 표본 수. */
export const FOREIGNER_RATIO_20D_SAMPLE = 21;

/** YYYY-MM-DD 형식 검증. */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 6자리 zero-padding + 영숫자 외 차단. */
function normalizeCode(code: string): string {
  return code.replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

function ensureDir(): void {
  try { fs.mkdirSync(FOREIGNER_RATIO_DIR, { recursive: true }); } catch { /* idempotent */ }
}

/**
 * 종목별 시계열 read.
 *
 * - 파일 부재 → []
 * - 손상 JSON → []
 * - 잘못된 row (date 형식 / ratio NaN) → silent filter
 * - date 오름차순 정렬해서 반환
 */
export function loadForeignerRatioSeries(code: string): ForeignerRatioRow[] {
  const file = foreignerRatioFile(code);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const rows: ForeignerRatioRow[] = [];
    for (const r of parsed) {
      if (!r || typeof r !== 'object') continue;
      const obj = r as Record<string, unknown>;
      const date = typeof obj.date === 'string' ? obj.date : '';
      const ratio = Number(obj.ratio);
      if (!isValidDate(date) || !Number.isFinite(ratio)) continue;
      rows.push({ date, ratio });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  } catch {
    return [];
  }
}

/**
 * 단일 row append + dedup (date 단위) + FIFO trim.
 *
 * - 잘못된 date / ratio NaN → silent skip
 * - 같은 date row 가 이미 있으면 마지막 ratio 로 덮어쓰기
 * - atomic write (tmp → rename)
 */
export function appendForeignerRatio(code: string, row: ForeignerRatioRow): void {
  const ratio = Number(row.ratio);
  if (!isValidDate(row.date) || !Number.isFinite(ratio)) return;
  ensureDir();
  const existing = loadForeignerRatioSeries(code);
  const map = new Map<string, ForeignerRatioRow>();
  for (const r of existing) map.set(r.date, r);
  map.set(row.date, { date: row.date, ratio });
  const merged = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  // FIFO trim
  const trimmed = merged.length > FOREIGNER_RATIO_MAX_ROWS
    ? merged.slice(merged.length - FOREIGNER_RATIO_MAX_ROWS)
    : merged;

  const file = foreignerRatioFile(code);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    // tmp 잔존 정리 (best effort)
    try { fs.unlinkSync(tmp); } catch { /* idempotent */ }
  }
}

/**
 * 5d/20d 추세 산출 SSOT.
 *
 * - 빈 series → null
 * - 표본 < 6 → 5d=null
 * - 표본 < 21 → 20d=null
 * - 변화 = 현재값 - N일 전 값 (%p, *비율 변화율* 아님 — foreignerOwnRatio 자체가 % 단위)
 *
 * @param code 종목코드 (6자리)
 * @returns ForeignerRatioTrend | null
 */
export function computeForeignerRatioTrend(code: string): ForeignerRatioTrend | null {
  const series = loadForeignerRatioSeries(code);
  if (series.length === 0) return null;

  const current = series[series.length - 1].ratio;
  const latestDate = series[series.length - 1].date;

  const changePct5d = series.length >= FOREIGNER_RATIO_5D_SAMPLE
    ? parseFloat((current - series[series.length - FOREIGNER_RATIO_5D_SAMPLE].ratio).toFixed(2))
    : null;
  const changePct20d = series.length >= FOREIGNER_RATIO_20D_SAMPLE
    ? parseFloat((current - series[series.length - FOREIGNER_RATIO_20D_SAMPLE].ratio).toFixed(2))
    : null;

  return { current, changePct5d, changePct20d, sampleSize: series.length, latestDate };
}

/**
 * 테스트 전용 — 종목 시계열 영속 파일 삭제.
 */
export function __resetForeignerRatioForTests(code?: string): void {
  if (code !== undefined) {
    const file = foreignerRatioFile(code);
    try { fs.unlinkSync(file); } catch { /* idempotent */ }
    return;
  }
  // 전체 디렉토리 비우기
  try {
    if (fs.existsSync(FOREIGNER_RATIO_DIR)) {
      const entries = fs.readdirSync(FOREIGNER_RATIO_DIR);
      for (const e of entries) {
        const p = path.join(FOREIGNER_RATIO_DIR, e);
        try { fs.unlinkSync(p); } catch { /* idempotent */ }
      }
    }
  } catch { /* idempotent */ }
}
