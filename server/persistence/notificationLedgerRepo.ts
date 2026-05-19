import fs from 'fs/promises';
import path from 'path';
import { DATA_DIR } from './paths.js';

export type NotificationDeliveryState =
  | 'CREATED' | 'ROUTED' | 'SENT' | 'PRIVATE_SENT' | 'DIGESTED' | 'BUFFERED'
  | 'SUPPRESSED' | 'COOLDOWN_SKIPPED' | 'DISABLED_SKIPPED' | 'MISSING_CHANNEL_SKIPPED' | 'FAILED';

export interface NotificationLedgerEntry {
  id: string; at: string; eventType: string; deliveryState: NotificationDeliveryState; message: string;
  source?: string; category?: 'TRADE' | 'ANALYSIS' | 'INFO' | 'SYSTEM' | 'PRIVATE';
  channelSemantic?: 'EXECUTION' | 'SIGNAL' | 'REGIME' | 'JOURNAL' | 'PRIVATE';
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'; noiseLevel?: 'SILENT' | 'DIGEST' | 'NOTICE' | 'WARNING' | 'CRITICAL';
  normalizedMessage?: string; reason?: string; skippedReason?: string; dedupeKey?: string; cooldownMs?: number;
  channelId?: string; messageId?: number; success?: boolean; error?: string; symbol?: string; strategy?: string;
  session?: string; engineMode?: string; executionImpact?: string; provider?: string; providerTier?: string; sensitive?: boolean;
  metadata?: Record<string, unknown>;
}

const DIR = path.join(DATA_DIR, 'notification-ledger');
const OMITTED = new Set<NotificationDeliveryState>(['SUPPRESSED', 'COOLDOWN_SKIPPED', 'DISABLED_SKIPPED', 'MISSING_CHANNEL_SKIPPED', 'DIGESTED', 'BUFFERED']);
const mask = (s: string) => s.replace(/(token|appkey|secret|account|credential)\s*[:=]\s*[^\s,]+/gi, '$1=[MASKED]');
const key = (d = new Date()) => d.toISOString().slice(0, 10);
const file = (k: string) => path.join(DIR, `${k}.jsonl`);
async function read(k: string): Promise<NotificationLedgerEntry[]> { try { const t = await fs.readFile(file(k), 'utf8'); return t.split('\n').filter(Boolean).map(v=>JSON.parse(v)); } catch { return []; } }

export async function appendNotificationLedger(entry: NotificationLedgerEntry): Promise<void> {
  try {
    await fs.mkdir(DIR, { recursive: true });
    const sanitized = { ...entry, message: mask(entry.message), normalizedMessage: entry.normalizedMessage ? mask(entry.normalizedMessage) : undefined };
    await fs.appendFile(file(key(new Date(entry.at))), `${JSON.stringify(sanitized)}\n`, 'utf8');
  } catch (e) { console.error('[NotificationLedger] append failed', e); }
}
export async function updateNotificationLedgerState(id: string, patch: Partial<NotificationLedgerEntry>): Promise<void> {
  const at = patch.at ? new Date(patch.at) : new Date();
  await appendNotificationLedger({ id, at: at.toISOString(), eventType: patch.eventType ?? 'UNKNOWN', deliveryState: patch.deliveryState ?? 'FAILED', message: patch.message ?? '', ...patch });
}
export async function getNotificationLedgerByDate(dateKey: string): Promise<NotificationLedgerEntry[]> { return read(dateKey); }
export async function queryNotificationLedger(filter: { dateKey?: string; keyword?: string; omittedOnly?: boolean } = {}): Promise<NotificationLedgerEntry[]> {
  const rows = await read(filter.dateKey ?? key());
  return rows.filter(r => (!filter.omittedOnly || OMITTED.has(r.deliveryState)) && (!filter.keyword || JSON.stringify(r).toLowerCase().includes(filter.keyword.toLowerCase())));
}
export async function getOmittedNotifications(filter: { dateKey?: string; keyword?: string } = {}): Promise<NotificationLedgerEntry[]> {
  return queryNotificationLedger({ ...filter, omittedOnly: true });
}
export async function getNotificationStats(dateKey: string): Promise<Record<string, number>> {
  const rows = await read(dateKey); const out: Record<string, number> = {};
  for (const r of rows) out[r.deliveryState] = (out[r.deliveryState] ?? 0) + 1;
  return out;
}
