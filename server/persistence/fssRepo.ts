// @responsibility fssRepo 영속화 저장소 모듈
import fs from 'fs';
import { FSS_RECORDS_FILE, ensureDataDir } from './paths.js';

export interface FssRecordRow {
  date: string;           // YYYY-MM-DD
  passiveNetBuy: number;  // Passive 순매수 (억원)
  activeNetBuy: number;   // Active 순매수 (억원)
}

/**
 * ADR-0136: FSS 레코드 신선도 분류 SSOT.
 *
 * - MISSING: 영속 파일 부재 또는 빈 배열
 * - OK     : 최신 레코드 ≤ 3 KST 일 차이
 * - STALE  : 최신 레코드 ≥ 4 KST 일 차이
 *
 * `passiveActiveBoth` 가 *데이터 결손* 때문인지 *시그널 부재* 때문인지
 * 페르소나 의사결정에서 구분 가능하게 하는 진단 입력.
 */
export type FssRecordsAgeStatus = 'OK' | 'STALE' | 'MISSING';

export interface FssRecordsAgeInfo {
  status: FssRecordsAgeStatus;
  latestDate: string | null;       // 'YYYY-MM-DD' or null
  ageDays: number | null;          // 0 = 오늘, 1 = 어제, null = MISSING
  recordCount: number;             // 영속 레코드 수
}

/** STALE 임계 (캘린더일 기준 — 영업일 환산 부담 회피, 4+ 보수적). */
export const FSS_STALE_THRESHOLD_DAYS = 4;

/**
 * 두 'YYYY-MM-DD' 일자 사이의 일 수 차이 (b - a, 양수). KST 자정 기준 캘린더일.
 * 잘못된 입력 → null.
 */
function diffDaysKst(aYyyyMmDd: string, bYyyyMmDd: string): number | null {
  const a = parseYyyyMmDd(aYyyyMmDd);
  const b = parseYyyyMmDd(bYyyyMmDd);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

function parseYyyyMmDd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  // KST 자정 (UTC+9) — Date.UTC 후 +9h 보정 불필요, 정수 일자 차이만 계산.
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isFinite(date.getTime()) ? date : null;
}

function nowKstYyyyMmDd(now: Date): string {
  const kstMs = now.getTime() + 9 * 3600 * 1000;
  const kst = new Date(kstMs);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * FSS 레코드 신선도 진단 (ADR-0136).
 *
 * - 빈 배열/파일 부재 → MISSING / latestDate=null / ageDays=null
 * - 최신 레코드 ≤ 3일 → OK
 * - 최신 레코드 ≥ 4일 → STALE
 *
 * 잘못된 latestDate 형식 (예: 'YYYY-MM' 등) → MISSING 안전 fallback.
 */
export function getFssRecordsAge(now: Date = new Date()): FssRecordsAgeInfo {
  const records = loadFssRecords();
  if (records.length === 0) {
    return { status: 'MISSING', latestDate: null, ageDays: null, recordCount: 0 };
  }
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const latestDate = sorted[sorted.length - 1].date;
  const todayKst = nowKstYyyyMmDd(now);
  const ageDays = diffDaysKst(latestDate, todayKst);
  if (ageDays === null) {
    return { status: 'MISSING', latestDate: null, ageDays: null, recordCount: records.length };
  }
  const status: FssRecordsAgeStatus = ageDays >= FSS_STALE_THRESHOLD_DAYS ? 'STALE' : 'OK';
  return { status, latestDate, ageDays, recordCount: records.length };
}

export function loadFssRecords(): FssRecordRow[] {
  ensureDataDir();
  if (!fs.existsSync(FSS_RECORDS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FSS_RECORDS_FILE, 'utf-8')); } catch { return []; }
}

export function saveFssRecords(records: FssRecordRow[]): void {
  ensureDataDir();
  // 최근 30거래일만 보관
  const trimmed = records
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);
  fs.writeFileSync(FSS_RECORDS_FILE, JSON.stringify(trimmed, null, 2));
}

export function upsertFssRecord(record: FssRecordRow): FssRecordRow[] {
  const records = loadFssRecords();
  const idx = records.findIndex(r => r.date === record.date);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  saveFssRecords(records);
  return loadFssRecords();
}
