// @responsibility alertAuditLog 알림 모듈
/**
 * alertAuditLog.ts — 발송된 Telegram 알림을 월별 JSONL에 append.
 *
 * Phase 6 "알림 감사" 리포트가 주간 윈도우를 읽어 티어/카테고리별 건수,
 * 빈발 dedupeKey, 쿨다운 조정 권고를 자동 산출한다. 휘발성 UI 피드
 * (alertsFeedRepo)와 달리 재시작·재배포 후에도 보존된다.
 *
 * 포맷(JSONL 1행):
 *   {"at":"2026-04-19T06:12:43.210Z","tier":"T1_ALARM","priority":"CRITICAL",
 *    "category":"kill-switch-downgrade","dedupeKey":"kill-switch-downgrade",
 *    "textLen":182,"messageId":12345}
 *
 * 월이 바뀌면 파일이 자동 롤링되므로 단일 파일이 무한 성장하지 않는다.
 */
import fs from 'fs';
import { alertAuditFile, ensureDataDir } from '../persistence/paths.js';
import type { AlertTier } from './alertTiers.js';
import type { AlertPriority } from './telegramClient.js';

export interface AlertAuditEntry {
  at: string;
  tier: AlertTier;
  priority?: AlertPriority;
  category: string;
  dedupeKey?: string;
  textLen: number;
  /** Telegram message_id — 전송 실패 시 undefined. */
  messageId?: number;
}

function yyyymmOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}${m}`;
}

/** 알림 감사 로그에 1행 append. 파일 I/O 오류는 silent — 실제 거래와 무관. */
export function appendAlertAudit(entry: AlertAuditEntry): void {
  try {
    ensureDataDir();
    const file = alertAuditFile(yyyymmOf(new Date(entry.at)));
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e: unknown) {
    // best-effort — 실패해도 알림 발송 자체는 성공했으므로 거래 흐름과 무관.
    console.warn('[AlertAudit] append 실패:', e instanceof Error ? e.message : e);
  }
}

/**
 * 시간 범위 내 알림 감사 로그를 읽어 반환 (Phase 6 주간 감사용).
 * 월 경계를 넘는 범위도 지원.
 */
export function readAlertAuditRange(startMs: number, endMs: number): AlertAuditEntry[] {
  const entries: AlertAuditEntry[] = [];
  const months = enumerateMonths(new Date(startMs), new Date(endMs));
  for (const yyyymm of months) {
    const file = alertAuditFile(yyyymm);
    if (!fs.existsSync(file)) continue;
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as AlertAuditEntry;
          const t = Date.parse(e.at);
          if (Number.isFinite(t) && t >= startMs && t <= endMs) entries.push(e);
        } catch { /* 행 파싱 실패는 무시 */ }
      }
    } catch (e: unknown) {
      console.warn('[AlertAudit] 읽기 실패:', e instanceof Error ? e.message : e);
    }
  }
  return entries;
}

function enumerateMonths(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cur <= last) {
    out.push(yyyymmOf(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}
