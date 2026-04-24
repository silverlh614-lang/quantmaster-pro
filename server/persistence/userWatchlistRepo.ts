/**
 * @responsibility 프론트 관심종목 서버 영속화 - 기기 간 동기화용 경량 CRUD 저장소
 *
 * 자동매매 워치리스트(watchlistRepo.ts, preMarketOrderPrep 소비)와는 분리된
 * 사용자 큐레이션 목록. entryPrice/stopLoss/targetPrice 필수 요건이 없고,
 * UI의 "북마크" 역할만 한다.
 */

import fs from 'fs';
import { USER_WATCHLIST_FILE, ensureDataDir } from './paths.js';

export interface UserWatchlistItem {
  code:          string;
  name:          string;
  /** 사용자가 관심종목으로 찍은 시각 (ISO 또는 "2026. 4. 24." 같은 로케일). */
  watchedAt:     string;
  /** 관심 등록 시점의 가격(UI 표시용). */
  watchedPrice?: number;
  currentPrice?: number;
  signalType?:   string;
  sector?:       string;
  gateScore?:    number;
  /** UI가 추가 메타를 같이 저장하고 싶을 때 사용 — 서버는 통과시키기만. */
  [extra: string]: unknown;
}

const MAX_ITEMS = 500;

export function loadUserWatchlist(): UserWatchlistItem[] {
  ensureDataDir();
  if (!fs.existsSync(USER_WATCHLIST_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(USER_WATCHLIST_FILE, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidItem);
  } catch {
    return [];
  }
}

export function saveUserWatchlist(list: UserWatchlistItem[]): void {
  ensureDataDir();
  // 방어: 최대 MAX_ITEMS 개까지만. 폭증 공격 대비.
  const trimmed = list.filter(isValidItem).slice(-MAX_ITEMS);
  fs.writeFileSync(USER_WATCHLIST_FILE, JSON.stringify(trimmed, null, 2));
}

export function toggleUserWatchlistItem(item: UserWatchlistItem): {
  action: 'ADDED' | 'REMOVED';
  list: UserWatchlistItem[];
} {
  const list = loadUserWatchlist();
  const idx = list.findIndex(i => i.code === item.code);
  if (idx >= 0) {
    const next = list.filter(i => i.code !== item.code);
    saveUserWatchlist(next);
    return { action: 'REMOVED', list: next };
  }
  const next = [...list, { ...item, watchedAt: item.watchedAt || new Date().toISOString() }];
  saveUserWatchlist(next);
  return { action: 'ADDED', list: next };
}

export function removeUserWatchlistItem(code: string): {
  removed: boolean;
  list: UserWatchlistItem[];
} {
  const list = loadUserWatchlist();
  const next = list.filter(i => i.code !== code);
  const removed = next.length !== list.length;
  if (removed) saveUserWatchlist(next);
  return { removed, list: next };
}

function isValidItem(x: unknown): x is UserWatchlistItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.code === 'string' && typeof o.name === 'string' && o.code.length > 0;
}
