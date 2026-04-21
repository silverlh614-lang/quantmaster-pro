import fs from 'fs';
import { CHANNEL_STATS_FILE, ensureDataDir } from './paths.js';
import { AlertCategory } from '../alerts/alertCategories.js';

export type ChannelStatStatus = 'sent' | 'skipped' | 'failed' | 'digested';

export interface ChannelStatBucket {
  sent: number;
  skipped: number;
  failed: number;
  digested: number;
}

type DailyCategoryStats = Record<AlertCategory, ChannelStatBucket>;

interface ChannelStatsSnapshot {
  updatedAt: string;
  days: Record<string, DailyCategoryStats>;
}

const EMPTY_BUCKET = (): ChannelStatBucket => ({ sent: 0, skipped: 0, failed: 0, digested: 0 });

function emptyDaily(): DailyCategoryStats {
  return {
    [AlertCategory.TRADE]: EMPTY_BUCKET(),
    [AlertCategory.ANALYSIS]: EMPTY_BUCKET(),
    [AlertCategory.INFO]: EMPTY_BUCKET(),
    [AlertCategory.SYSTEM]: EMPTY_BUCKET(),
  };
}

function todayKstDateKey(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function loadSnapshot(): ChannelStatsSnapshot {
  ensureDataDir();
  if (!fs.existsSync(CHANNEL_STATS_FILE)) {
    return { updatedAt: new Date().toISOString(), days: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(CHANNEL_STATS_FILE, 'utf8')) as ChannelStatsSnapshot;
    if (!parsed.days || typeof parsed.days !== 'object') {
      return { updatedAt: new Date().toISOString(), days: {} };
    }
    return parsed;
  } catch {
    return { updatedAt: new Date().toISOString(), days: {} };
  }
}

function saveSnapshot(snapshot: ChannelStatsSnapshot): void {
  ensureDataDir();
  fs.writeFileSync(CHANNEL_STATS_FILE, JSON.stringify(snapshot, null, 2));
}

export function incrementChannelStat(
  category: AlertCategory,
  status: ChannelStatStatus,
  options?: { dateKey?: string; count?: number },
): void {
  const dateKey = options?.dateKey ?? todayKstDateKey();
  const count = options?.count ?? 1;
  if (count <= 0) return;

  const snapshot = loadSnapshot();
  if (!snapshot.days[dateKey]) snapshot.days[dateKey] = emptyDaily();
  snapshot.days[dateKey][category][status] += count;
  snapshot.updatedAt = new Date().toISOString();
  saveSnapshot(snapshot);
}

export function getChannelStatsByDate(dateKey?: string): DailyCategoryStats {
  const key = dateKey ?? todayKstDateKey();
  const snapshot = loadSnapshot();
  return snapshot.days[key] ?? emptyDaily();
}

export function getRecentDateKeys(limit = 7): string[] {
  const snapshot = loadSnapshot();
  return Object.keys(snapshot.days).sort().slice(-Math.max(1, limit));
}
