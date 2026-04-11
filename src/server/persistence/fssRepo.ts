import fs from 'fs';
import { FSS_RECORDS_FILE, ensureDataDir } from './paths.js';

export interface FssRecordRow {
  date: string;           // YYYY-MM-DD
  passiveNetBuy: number;  // Passive 순매수 (억원)
  activeNetBuy: number;   // Active 순매수 (억원)
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
