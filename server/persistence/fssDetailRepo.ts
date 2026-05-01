// @responsibility fssDetailRepo 영속 저장소 — KRX 11분류 raw 일자별 (ADR-0141 Stage 1)
//
// 목적: KRX 11분류 투자자별 매매 raw 데이터 (`fetchInvestorTradingDetail`)를 일자별
//       영속 → 운영 데이터 1~2주 누적 후 ADR-0142 매핑 정책 데이터 기반 검증.
// 사용자 명시 *통념 추정 위험* 차단 — Passive/Active 매핑 *미적용*. 11 카테고리
// 한글 키 raw 그대로 보존.
//
// 영속 정책:
//   - 단일 파일: `data/fss-detail.json`
//   - 일자별 1 row (같은 날짜 중복 → 마지막 값 덮어쓰기)
//   - 30영업일 보관 (FIFO trim)
//   - atomic write (tmp → rename)
//   - 손상 JSON → 빈 배열 fallback

import fs from 'fs';
import { FSS_DETAIL_FILE, ensureDataDir } from './paths.js';
import type { KrxInvestorDetailRow } from '../clients/krxClient.js';

export interface FssDetailRecord {
  date: string;                            // YYYY-MM-DD
  rows: KrxInvestorDetailRow[];            // 11 카테고리 raw (한글 키 보존)
  fetchedAt: string;                       // ISO
}

/** 시계열 보관 한도 (영업일 기준). FIFO trim. */
export const FSS_DETAIL_MAX_ROWS = 30;

/** YYYY-MM-DD 형식 검증. */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * 영속 시계열 read.
 *
 * - 파일 부재 → []
 * - 손상 JSON → []
 * - 잘못된 row (date 형식 / rows 비배열) → silent filter
 * - date 오름차순 정렬해서 반환
 */
export function loadFssDetailRecords(): FssDetailRecord[] {
  ensureDataDir();
  if (!fs.existsSync(FSS_DETAIL_FILE)) return [];
  try {
    const raw = fs.readFileSync(FSS_DETAIL_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: FssDetailRecord[] = [];
    for (const r of parsed) {
      if (!r || typeof r !== 'object') continue;
      const obj = r as Record<string, unknown>;
      const date = typeof obj.date === 'string' ? obj.date : '';
      const rows = Array.isArray(obj.rows) ? obj.rows as KrxInvestorDetailRow[] : null;
      const fetchedAt = typeof obj.fetchedAt === 'string' ? obj.fetchedAt : '';
      if (!isValidDate(date) || !rows) continue;
      out.push({ date, rows, fetchedAt });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  } catch {
    return [];
  }
}

/**
 * 단일 record append + dedup (date 단위) + FIFO trim.
 *
 * - 잘못된 date / rows 비배열 → silent skip
 * - 같은 date record 가 이미 있으면 마지막 값으로 덮어쓰기
 * - atomic write (tmp → rename)
 */
export function appendFssDetailRecord(record: FssDetailRecord): void {
  if (!isValidDate(record.date) || !Array.isArray(record.rows)) return;
  ensureDataDir();
  const existing = loadFssDetailRecords();
  const map = new Map<string, FssDetailRecord>();
  for (const r of existing) map.set(r.date, r);
  map.set(record.date, record);
  const merged = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = merged.length > FSS_DETAIL_MAX_ROWS
    ? merged.slice(merged.length - FSS_DETAIL_MAX_ROWS)
    : merged;

  const tmp = `${FSS_DETAIL_FILE}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
    fs.renameSync(tmp, FSS_DETAIL_FILE);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* idempotent */ }
  }
}

/**
 * 가장 최신 일자 record (영속 부재 시 null).
 */
export function getLatestFssDetailRecord(): FssDetailRecord | null {
  const records = loadFssDetailRecords();
  if (records.length === 0) return null;
  return records[records.length - 1];
}

/**
 * 특정 일자 record (영속 부재 시 null).
 */
export function getFssDetailRecord(date: string): FssDetailRecord | null {
  if (!isValidDate(date)) return null;
  const records = loadFssDetailRecords();
  return records.find((r) => r.date === date) ?? null;
}

/**
 * 테스트 전용 — 영속 파일 삭제.
 */
export function __resetFssDetailForTests(): void {
  try { fs.unlinkSync(FSS_DETAIL_FILE); } catch { /* idempotent */ }
}
