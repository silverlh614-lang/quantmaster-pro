import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from './paths.js';
import { AlertCategory } from '../alerts/alertCategories.js';
import type { DispatchPriority } from '../alerts/alertRouter.js';

export interface AlertHistoryEntry {
  id: string;
  at: string;
  category: AlertCategory;
  priority: DispatchPriority;
  message: string;
  delivery: 'immediate' | 'daily_digest' | 'weekly_digest' | 'buffered' | 'skipped';
  success: boolean;
  channelId?: string;
  messageId?: number;
  error?: string;
}

function monthKeyFromIso(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}${mm}`;
}

function alertHistoryFile(yyyymm: string): string {
  return path.join(DATA_DIR, `alert-history-${yyyymm}.jsonl`);
}

function currentMonthKey(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}${mm}`;
}

function previousMonthKey(): string {
  const now = new Date();
  now.setUTCMonth(now.getUTCMonth() - 1);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}${mm}`;
}

function newAlertId(at: string, category: AlertCategory): string {
  const ts = new Date(at).getTime().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${category}-${ts}-${rand}`;
}

function appendLine(filePath: string, line: string): void {
  ensureDataDir();
  fs.appendFileSync(filePath, `${line}\n`, 'utf8');
}

function readAllFromFile(filePath: string): AlertHistoryEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const out: AlertHistoryEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as AlertHistoryEntry);
    } catch {
      // Keep append-only log robust even if one line is corrupted.
    }
  }
  return out;
}

export function appendAlertHistory(
  payload: Omit<AlertHistoryEntry, 'id' | 'at'> & { id?: string; at?: string },
): AlertHistoryEntry {
  const at = payload.at ?? new Date().toISOString();
  const id = payload.id ?? newAlertId(at, payload.category);
  const entry: AlertHistoryEntry = {
    id,
    at,
    category: payload.category,
    priority: payload.priority,
    message: payload.message,
    delivery: payload.delivery,
    success: payload.success,
    channelId: payload.channelId,
    messageId: payload.messageId,
    error: payload.error,
  };
  appendLine(alertHistoryFile(monthKeyFromIso(at)), JSON.stringify(entry));
  return entry;
}

export function getRecentAlertHistory(limit = 50): AlertHistoryEntry[] {
  const files = [alertHistoryFile(currentMonthKey()), alertHistoryFile(previousMonthKey())];
  const merged = files.flatMap(readAllFromFile).sort((a, b) => a.at.localeCompare(b.at));
  return merged.slice(-Math.max(1, limit)).reverse();
}

export function findAlertHistoryById(id: string): AlertHistoryEntry | undefined {
  const files = [alertHistoryFile(currentMonthKey()), alertHistoryFile(previousMonthKey())];
  for (const filePath of files) {
    const found = readAllFromFile(filePath).find(entry => entry.id === id);
    if (found) return found;
  }
  return undefined;
}
