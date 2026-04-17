// server/persistence/dailyBackup.ts
// DATA_DIR 내 주요 상태 JSON을 일별 백업한다. Railway Volume 마운트 전제.
// 장애·롤백·디버깅 복원을 위해 7일치 스냅샷을 /backups/YYYY-MM-DD/ 에 보관.

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './paths.js';

/** 백업 대상 파일명 목록 (DATA_DIR 기준). 누락된 파일은 무시하고 진행. */
const BACKUP_TARGETS = [
  'shadow-trades.json',
  'shadow-log.json',
  'watchlist.json',
  'watchlist-intraday.json',
  'dart-alerts.json',
  'dart-fast-seen.json',
  'fss-records.json',
  'blacklist.json',
  'failure-patterns.json',
  'recommendations.json',
  'oco-orders.json',
  'pending-orders.json',
  'pending-sell-orders.json',
  'trading-settings.json',
  'session-state.json',
  'macro-state.json',
  'orchestrator-state.json',
];

/** KST 기준 YYYY-MM-DD 문자열. */
function kstDateStr(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export interface BackupResult {
  backupDir: string;
  copied: string[];
  missing: string[];
  pruned: string[];
}

/**
 * 일일 백업 실행. DATA_DIR/backups/YYYY-MM-DD/ 에 복사 + 7일 초과 폴더 삭제.
 *
 * @param retentionDays 보관 일수 기본 7일
 */
export function runDailyBackup(retentionDays = 7): BackupResult {
  const dateStr = kstDateStr();
  const backupsRoot = path.join(DATA_DIR, 'backups');
  const backupDir = path.join(backupsRoot, dateStr);

  fs.mkdirSync(backupDir, { recursive: true });

  const copied: string[] = [];
  const missing: string[] = [];

  for (const filename of BACKUP_TARGETS) {
    const src = path.join(DATA_DIR, filename);
    if (!fs.existsSync(src)) {
      missing.push(filename);
      continue;
    }
    const dst = path.join(backupDir, filename);
    fs.copyFileSync(src, dst);
    copied.push(filename);
  }

  const pruned = pruneBackups(backupsRoot, retentionDays);

  return { backupDir, copied, missing, pruned };
}

/**
 * backups/ 하위 YYYY-MM-DD 디렉토리 중 retentionDays 초과분 삭제.
 * 날짜가 아닌 디렉토리는 건드리지 않는다.
 */
export function pruneBackups(backupsRoot: string, retentionDays: number): string[] {
  if (!fs.existsSync(backupsRoot)) return [];
  const pruned: string[] = [];
  const cutoff = Date.now() - retentionDays * 86_400_000;

  for (const entry of fs.readdirSync(backupsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const dirPath = path.join(backupsRoot, entry.name);
    const dirTime = new Date(entry.name).getTime();
    if (Number.isNaN(dirTime)) continue;
    if (dirTime < cutoff) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      pruned.push(entry.name);
    }
  }
  return pruned;
}
