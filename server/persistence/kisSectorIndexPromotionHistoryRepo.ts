// @responsibility KIS Sector Index dry-run promotion audit history (append-only 20D observation)

import fs from 'fs';
import path from 'path';
import { KIS_SECTOR_INDEX_PROMOTION_HISTORY_FILE } from './paths.js';

type KisSectorIndexPromotionStage = 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY' | 'WEIGHTED' | 'GATED' | 'CORE';

export interface KisSectorIndexPromotionHistoryRecord {
  date: string;
  attempted: number;
  succeeded: number;
  failed: number;
  failedCodes: string[];
  latestDateTop: string | null;
  rowsBySector: Record<string, number>;
  return5dBySector: Record<string, number | null>;
  return20dBySector: Record<string, number | null>;
  officialBenchmark: boolean;
  promotionStage: KisSectorIndexPromotionStage;
  candidateCoverage: number;
  verifiedCodes?: Record<string, string>;
  unresolvedCodes?: Record<string, string>;
  sectorBoostAllowed: false;
  strongBuyAllowed: false;
  executionImpact: 'NONE';
  corePromotionAllowed: false;
  manualAuditFlagRequired: true;
  recordedAt: string;
}

const MAX_PROMOTION_HISTORY_ROWS = 60;

function ensureDir(): void {
  try { fs.mkdirSync(path.dirname(KIS_SECTOR_INDEX_PROMOTION_HISTORY_FILE), { recursive: true }); } catch { /* noop */ }
}

function validRecord(row: unknown): row is KisSectorIndexPromotionHistoryRecord {
  if (!row || typeof row !== 'object') return false;
  const r = row as Partial<KisSectorIndexPromotionHistoryRecord>;
  return typeof r.date === 'string' && /^\d{8}$/.test(r.date) && typeof r.attempted === 'number';
}

function loadKisSectorIndexPromotionHistory(): KisSectorIndexPromotionHistoryRecord[] {
  if (!fs.existsSync(KIS_SECTOR_INDEX_PROMOTION_HISTORY_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(KIS_SECTOR_INDEX_PROMOTION_HISTORY_FILE, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validRecord).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

export function appendKisSectorIndexPromotionHistoryRecord(
  record: KisSectorIndexPromotionHistoryRecord,
): KisSectorIndexPromotionHistoryRecord[] {
  if (!/^\d{8}$/.test(record.date)) return loadKisSectorIndexPromotionHistory();
  ensureDir();
  const byDate = new Map(loadKisSectorIndexPromotionHistory().map((row) => [row.date, row]));
  byDate.set(record.date, record);
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = rows.slice(Math.max(0, rows.length - MAX_PROMOTION_HISTORY_ROWS));
  const tmp = `${KIS_SECTOR_INDEX_PROMOTION_HISTORY_FILE}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
    fs.renameSync(tmp, KIS_SECTOR_INDEX_PROMOTION_HISTORY_FILE);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  }
  return trimmed;
}
