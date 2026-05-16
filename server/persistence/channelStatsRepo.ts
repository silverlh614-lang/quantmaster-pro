// @responsibility channelStatsRepo 영속화 저장소 모듈
import fs from 'fs';
import { CHANNEL_STATS_FILE, ensureDataDir } from './paths.js';
import { AlertCategory } from '../alerts/alertCategories.js';

export type ChannelStatStatus =
  | 'emitted'
  | 'routed'
  | 'sent'
  | 'skipped'
  | 'failed'
  | 'digested'
  | 'buffered'
  | 'cooldownSkipped'
  | 'disabledSkipped'
  | 'missingChannelSkipped'
  | 'directDmBypass';

export interface ChannelStatBucket {
  emitted: number;
  routed: number;
  sent: number;
  skipped: number;
  failed: number;
  digested: number;
  buffered: number;
  cooldownSkipped: number;
  disabledSkipped: number;
  missingChannelSkipped: number;
  directDmBypass: number;
  lastEventType?: string;
  lastEmittedAt?: string;
  lastSentAt?: string;
  lastBufferedAt?: string;
  lastSkippedReason?: string;
}

type DailyCategoryStats = Record<AlertCategory, ChannelStatBucket>;

interface ChannelStatsSnapshot {
  updatedAt: string;
  days: Record<string, DailyCategoryStats>;
}

const EMPTY_BUCKET = (): ChannelStatBucket => ({
  emitted: 0,
  routed: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  digested: 0,
  buffered: 0,
  cooldownSkipped: 0,
  disabledSkipped: 0,
  missingChannelSkipped: 0,
  directDmBypass: 0,
});

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

function normalizeBucket(input: Partial<ChannelStatBucket> | undefined): ChannelStatBucket {
  return { ...EMPTY_BUCKET(), ...(input ?? {}) };
}

function normalizeDaily(input: Partial<DailyCategoryStats> | undefined): DailyCategoryStats {
  const empty = emptyDaily();
  return {
    [AlertCategory.TRADE]: normalizeBucket(input?.[AlertCategory.TRADE] ?? empty[AlertCategory.TRADE]),
    [AlertCategory.ANALYSIS]: normalizeBucket(input?.[AlertCategory.ANALYSIS] ?? empty[AlertCategory.ANALYSIS]),
    [AlertCategory.INFO]: normalizeBucket(input?.[AlertCategory.INFO] ?? empty[AlertCategory.INFO]),
    [AlertCategory.SYSTEM]: normalizeBucket(input?.[AlertCategory.SYSTEM] ?? empty[AlertCategory.SYSTEM]),
  };
}

function applyLastFields(
  bucket: ChannelStatBucket,
  status: ChannelStatStatus,
  at: string,
  options?: { eventType?: string; skippedReason?: string },
): void {
  if (options?.eventType) bucket.lastEventType = options.eventType;
  if (status === 'emitted') bucket.lastEmittedAt = at;
  if (status === 'sent' || status === 'directDmBypass') bucket.lastSentAt = at;
  if (status === 'buffered' || status === 'digested') bucket.lastBufferedAt = at;
  if (
    status === 'skipped'
    || status === 'cooldownSkipped'
    || status === 'disabledSkipped'
    || status === 'missingChannelSkipped'
  ) {
    bucket.lastSkippedReason = options?.skippedReason ?? status;
  }
}

export function incrementChannelStat(
  category: AlertCategory,
  status: ChannelStatStatus,
  options?: { dateKey?: string; count?: number; eventType?: string; skippedReason?: string },
): void {
  const dateKey = options?.dateKey ?? todayKstDateKey();
  const count = options?.count ?? 1;
  if (count <= 0) return;

  const snapshot = loadSnapshot();
  if (!snapshot.days[dateKey]) snapshot.days[dateKey] = emptyDaily();
  snapshot.days[dateKey] = normalizeDaily(snapshot.days[dateKey]);
  const bucket = snapshot.days[dateKey][category];
  bucket[status] += count;
  const updatedAt = new Date().toISOString();
  applyLastFields(bucket, status, updatedAt, options);
  snapshot.updatedAt = updatedAt;
  saveSnapshot(snapshot);
}

export function getChannelStatsByDate(dateKey?: string): DailyCategoryStats {
  const key = dateKey ?? todayKstDateKey();
  const snapshot = loadSnapshot();
  return normalizeDaily(snapshot.days[key]);
}

export function getRecentDateKeys(limit = 7): string[] {
  const snapshot = loadSnapshot();
  return Object.keys(snapshot.days).sort().slice(-Math.max(1, limit));
}
