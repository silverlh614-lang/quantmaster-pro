/**
 * watchlistManager.ts — 워치리스트 자동 정리
 *
 * 매일 16:00 KST (장마감 후) 실행:
 *   1. expiresAt 초과 항목 자동 제거
 *   2. AUTO 항목 최대 20개 유지 (오래된 것부터 제거, MANUAL 보호)
 */

import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';

const MAX_WATCHLIST = 20;

export async function cleanupWatchlist(): Promise<void> {
  const watchlist = loadWatchlist();
  const now = new Date();

  // 1. 만료 항목 제거
  const active = watchlist.filter((w) => {
    if (w.expiresAt && new Date(w.expiresAt) < now) {
      console.log(`[Watchlist] 만료 제거: ${w.name}(${w.code}) (만료: ${w.expiresAt})`);
      return false;
    }
    return true;
  });

  // 2. 최대 개수 초과 시 AUTO 항목 중 오래된 것부터 제거 (MANUAL 보호)
  let cleaned = active;
  if (cleaned.length > MAX_WATCHLIST) {
    const manual = cleaned.filter((w) => w.addedBy === 'MANUAL');
    const auto   = cleaned
      .filter((w) => w.addedBy !== 'MANUAL')
      .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
      .slice(0, Math.max(0, MAX_WATCHLIST - manual.length));
    cleaned = [...manual, ...auto];
    console.log(`[Watchlist] 초과 제거: ${active.length}개 → ${cleaned.length}개`);
  }

  if (cleaned.length !== watchlist.length) {
    saveWatchlist(cleaned);
    console.log(`[Watchlist] 정리 완료: ${watchlist.length}개 → ${cleaned.length}개`);
  } else {
    console.log(`[Watchlist] 정리 불필요 (${watchlist.length}개 유지)`);
  }
}
