/**
 * alertsFeedRepo.ts — Telegram 으로 발송된 알림을 UI 피드에도 축적.
 *
 * 페르소나가 PC 앞에 없을 때는 Telegram, 있을 때는 UI 를 본다. 양쪽이
 * 서로 다른 스트림이면 정보 비대칭이 발생한다. 이 레포는 서버에서 Telegram
 * 발송이 일어날 때마다 동일 내용을 메모리 링 버퍼에 쌓아 `/api/alerts/feed`
 * 로 조회 가능하게 한다. UI 벨 아이콘은 "마지막 읽은 ID" 이후 개수를 배지로.
 *
 * 단일 프로세스 · 메모리 보관 (경량) — 재시작 시 유실. 중요 감사 트레일은
 * 이미 shadow-log / trade-events 로 기록되므로 이 피드는 휘발성으로 충분.
 */

import type { TelegramAlertPriority } from '../alerts/telegramClient.js';

export interface AlertFeedEntry {
  id: string;             // monotonic: `${timestampMs}-${seq}`
  at: string;             // ISO timestamp
  priority: TelegramAlertPriority | 'INFO';
  /** HTML 태그 제거한 사람용 텍스트 — UI 벨 드롭다운에서 그대로 렌더 */
  text: string;
  /** dedupeKey — 같은 경보의 반복을 UI 에서도 축약 가능 */
  dedupeKey?: string;
}

const MAX_ENTRIES = 200;
const feed: AlertFeedEntry[] = [];
let seq = 0;

/** 알림 피드에 새 엔트리 추가. Telegram 발송 경로에서 호출. */
export function appendAlertFeed(
  text: string,
  priority: AlertFeedEntry['priority'] = 'INFO',
  dedupeKey?: string,
): AlertFeedEntry {
  const plain = stripHtml(text);
  const entry: AlertFeedEntry = {
    id: `${Date.now()}-${++seq}`,
    at: new Date().toISOString(),
    priority,
    text: plain,
    dedupeKey,
  };
  feed.push(entry);
  if (feed.length > MAX_ENTRIES) feed.splice(0, feed.length - MAX_ENTRIES);
  return entry;
}

export interface AlertFeedQuery {
  /** 이 ID 이후 (exclusive) 항목만 반환 — UI 의 last-read marker 용. */
  sinceId?: string;
  /** 우선순위 필터 (배열) — 지정 시 해당 항목만. */
  priority?: AlertFeedEntry['priority'][];
  /** 최대 반환 개수 (기본 50, 최대 200). */
  limit?: number;
}

export function listAlertFeed(q: AlertFeedQuery = {}): AlertFeedEntry[] {
  let list = feed.slice();
  if (q.sinceId) {
    const idx = list.findIndex(e => e.id === q.sinceId);
    if (idx >= 0) list = list.slice(idx + 1);
  }
  if (q.priority && q.priority.length > 0) {
    const set = new Set(q.priority);
    list = list.filter(e => set.has(e.priority));
  }
  const limit = Math.min(Math.max(q.limit ?? 50, 1), MAX_ENTRIES);
  // 최신순으로 반환 (최근 항목이 위로).
  return list.slice(-limit).reverse();
}

/**
 * UI 가 "마지막 읽은 ID" 를 질의할 수 있게 하는 집계 함수.
 * 주어진 ID 이후 unread 수만 반환.
 */
export function countUnreadSince(sinceId?: string): number {
  if (!sinceId) return feed.length;
  const idx = feed.findIndex(e => e.id === sinceId);
  if (idx < 0) return feed.length; // 만료된 ID — 전체가 새로움
  return feed.length - idx - 1;
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}
