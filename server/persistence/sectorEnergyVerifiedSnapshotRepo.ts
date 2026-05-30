// @responsibility ADR-0545 last-known verified sector snapshot 영속 — 휴일/세션닫힘 표시·shadow 근거 전용 read/write (live promotion 비활성).

import fs from 'fs';
import path from 'path';
import { SECTOR_ENERGY_VERIFIED_SNAPSHOT_FILE } from './paths.js';

/**
 * 장중 official sector verify 성공 시점의 검증 스냅샷 레코드.
 * tradeDate 는 KST yyyy-mm-dd. asOf 는 ISO 시각. promotionCoverage 는 0~1.
 * 본 레코드는 표시 + shadowEvidence 전용 — live promotion/sectorBoost/strongBuy 게이팅에 사용 금지.
 */
export interface SectorEnergyVerifiedSnapshotRecord {
  snapshotId: string;
  asOf: string;
  /** KST 거래일 yyyy-mm-dd. */
  tradeDate: string;
  verifiedOfficialSectorCount: number;
  /** 0~1 (verified/11). */
  promotionCoverage: number;
  selectedSourceTier: string;
}

const MAX_SNAPSHOT_ROWS = 30;
const TRADE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ensureDir(): void {
  try {
    fs.mkdirSync(path.dirname(SECTOR_ENERGY_VERIFIED_SNAPSHOT_FILE), { recursive: true });
  } catch (e) {
    console.warn('[SectorEnergyVerifiedSnapshot] dir 생성 실패:', e instanceof Error ? e.message : e);
  }
}

function validRecord(row: unknown): row is SectorEnergyVerifiedSnapshotRecord {
  if (!row || typeof row !== 'object') return false;
  const r = row as Partial<SectorEnergyVerifiedSnapshotRecord>;
  return (
    typeof r.snapshotId === 'string' &&
    typeof r.tradeDate === 'string' &&
    TRADE_DATE_RE.test(r.tradeDate) &&
    typeof r.verifiedOfficialSectorCount === 'number' &&
    typeof r.promotionCoverage === 'number' &&
    typeof r.selectedSourceTier === 'string' &&
    typeof r.asOf === 'string'
  );
}

/** 전체 verified snapshot 레코드 (tradeDate 오름차순). 파일 부재·파손 시 빈 배열. */
export function loadSectorEnergyVerifiedSnapshots(): SectorEnergyVerifiedSnapshotRecord[] {
  if (!fs.existsSync(SECTOR_ENERGY_VERIFIED_SNAPSHOT_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(SECTOR_ENERGY_VERIFIED_SNAPSHOT_FILE, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validRecord).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  } catch (e) {
    console.warn('[SectorEnergyVerifiedSnapshot] 로드 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * verify 성공 시에만 호출 — tradeDate 단위로 마지막 verified snapshot 을 영속(upsert).
 * 잘못된 tradeDate / count<=0 이면 write 하지 않는다 (실패·휴일 시 미저장 보장).
 */
export function writeSectorEnergyVerifiedSnapshot(
  record: SectorEnergyVerifiedSnapshotRecord,
): SectorEnergyVerifiedSnapshotRecord[] {
  if (!TRADE_DATE_RE.test(record.tradeDate)) return loadSectorEnergyVerifiedSnapshots();
  if (!Number.isFinite(record.verifiedOfficialSectorCount) || record.verifiedOfficialSectorCount <= 0) {
    return loadSectorEnergyVerifiedSnapshots();
  }
  ensureDir();
  const byDate = new Map(loadSectorEnergyVerifiedSnapshots().map((row) => [row.tradeDate, row]));
  byDate.set(record.tradeDate, record);
  const rows = [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const trimmed = rows.slice(Math.max(0, rows.length - MAX_SNAPSHOT_ROWS));
  const tmp = `${SECTOR_ENERGY_VERIFIED_SNAPSHOT_FILE}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
    fs.renameSync(tmp, SECTOR_ENERGY_VERIFIED_SNAPSHOT_FILE);
  } catch (e) {
    console.warn('[SectorEnergyVerifiedSnapshot] 저장 실패:', e instanceof Error ? e.message : e);
    try { fs.unlinkSync(tmp); } catch { /* SDS-ignore: tmp 정리 실패는 무해 */ }
  }
  return trimmed;
}

/** 가장 최근(최신 tradeDate) verified snapshot. 없으면 null. */
export function readLatestSectorEnergyVerifiedSnapshot(): SectorEnergyVerifiedSnapshotRecord | null {
  const rows = loadSectorEnergyVerifiedSnapshots();
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

/** 특정 tradeDate 의 verified snapshot. 없으면 null. */
export function readSectorEnergyVerifiedSnapshotForTradeDate(
  tradeDate: string,
): SectorEnergyVerifiedSnapshotRecord | null {
  if (!TRADE_DATE_RE.test(tradeDate)) return null;
  return loadSectorEnergyVerifiedSnapshots().find((row) => row.tradeDate === tradeDate) ?? null;
}

/**
 * ADR-0545 휴일/세션닫힘 read 우선순위:
 *   1) same tradeDate intraday verified (오늘 장중 verify 가 있었던 경우)
 *   2) previous trading day EOD verified
 *   3) 없으면 null (부재 → SESSION_CLOSED_NO_LAST_KNOWN_SECTOR_SNAPSHOT)
 */
export function readLastKnownSectorEnergyVerifiedSnapshot(args: {
  tradeDate: string;
  prevTradingDay: string;
}): SectorEnergyVerifiedSnapshotRecord | null {
  const sameDay = readSectorEnergyVerifiedSnapshotForTradeDate(args.tradeDate);
  if (sameDay) return sameDay;
  const prev = readSectorEnergyVerifiedSnapshotForTradeDate(args.prevTradingDay);
  if (prev) return prev;
  // prev 정확 일치가 없으면 prevTradingDay 이하의 가장 최근 EOD verified 를 fallback 으로 본다.
  const rows = loadSectorEnergyVerifiedSnapshots().filter((row) => row.tradeDate <= args.prevTradingDay);
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

/** 테스트 전용 — 파일 삭제. */
export function __resetSectorEnergyVerifiedSnapshotForTests(): void {
  try {
    if (fs.existsSync(SECTOR_ENERGY_VERIFIED_SNAPSHOT_FILE)) fs.unlinkSync(SECTOR_ENERGY_VERIFIED_SNAPSHOT_FILE);
  } catch { /* SDS-ignore: 테스트 정리 실패는 무해 */ }
}
