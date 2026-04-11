import fs from 'fs';
import { BLACKLIST_FILE, ensureDataDir } from './paths.js';

export interface BlacklistEntry {
  stockCode: string;
  stockName: string;
  bannedAt: string;    // ISO — 편입 시각
  bannedUntil: string; // ISO — 해제 시각 (180일 후)
  reason: string;      // 예: "Cascade -30%"
}

export function loadBlacklist(): BlacklistEntry[] {
  ensureDataDir();
  if (!fs.existsSync(BLACKLIST_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf-8')); } catch { return []; }
}

export function saveBlacklist(list: BlacklistEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(list, null, 2));
}

export function addToBlacklist(stockCode: string, stockName: string, reason = 'Cascade -30%'): void {
  const list = loadBlacklist();
  const now = new Date();
  const until = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  // 이미 편입된 경우 만료일 연장
  const existing = list.find(e => e.stockCode === stockCode);
  if (existing) {
    existing.bannedUntil = until.toISOString();
    existing.bannedAt    = now.toISOString();
    existing.reason      = reason;
  } else {
    list.push({ stockCode, stockName, bannedAt: now.toISOString(), bannedUntil: until.toISOString(), reason });
  }
  saveBlacklist(list);
  console.log(`[Blacklist] ${stockName}(${stockCode}) 편입 — 해제: ${until.toISOString().split('T')[0]}`);
}

export function isBlacklisted(stockCode: string): boolean {
  const list = loadBlacklist();
  const now = Date.now();
  // 만료된 항목 자동 정리
  const active = list.filter(e => new Date(e.bannedUntil).getTime() > now);
  if (active.length !== list.length) saveBlacklist(active);
  return active.some(e => e.stockCode === stockCode);
}
