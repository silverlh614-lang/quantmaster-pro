// @responsibility alertHistoryRepo 영속화 저장소 모듈
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

/**
 * 직전 월 키. **일(日)을 1 로 고정한 뒤 월을 빼야 한다.**
 *
 * 구 구현은 `now.setUTCMonth(m - 1)` 로 일자를 보존한 채 월만 빼서, 말일에 이전 달이
 * 더 짧으면 다음 달로 넘어갔다 — 예: 2026-07-31 → "6월 31일"(부재) → 7월 1일 →
 * `202607` 반환 → `currentMonthKey()` 와 **동일** → `getRecentAlertHistory` 가 같은 파일을
 * 두 번 읽어 **모든 알림 이력이 2배**로 집계됐다 (`/learning_pulse` suggest7d 등 영향).
 * 발현일: 31일(직전 달 30일) · 3월 29~31일(직전 2월). `Date.UTC` 는 음수 월도 연도를
 * 정확히 롤백한다 (1월 → 전년 12월).
 */
function previousMonthKey(): string {
  const now = new Date();
  const firstOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const yyyy = firstOfPrevMonth.getUTCFullYear();
  const mm = String(firstOfPrevMonth.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}${mm}`;
}

/**
 * 읽을 월별 파일 목록 — 중복 제거(방어). 두 키가 같아지는 회귀가 재발해도
 * 같은 파일을 두 번 읽어 이력이 부풀지 않도록 한다.
 */
function recentMonthFiles(): string[] {
  const keys = Array.from(new Set([currentMonthKey(), previousMonthKey()]));
  return keys.map(alertHistoryFile);
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
  const files = recentMonthFiles();
  const merged = files.flatMap(readAllFromFile).sort((a, b) => a.at.localeCompare(b.at));
  return merged.slice(-Math.max(1, limit)).reverse();
}

export function findAlertHistoryById(id: string): AlertHistoryEntry | undefined {
  const files = recentMonthFiles();
  for (const filePath of files) {
    const found = readAllFromFile(filePath).find(entry => entry.id === id);
    if (found) return found;
  }
  return undefined;
}
