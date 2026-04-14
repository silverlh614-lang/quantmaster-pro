/**
 * watchlistManager.ts — 워치리스트 자동 정리 + 2단계 Focus 관리
 *
 * 매일 16:00 KST (장마감 후) 실행:
 *   1. expiresAt 초과 항목 자동 제거
 *   2. entryFailCount >= 3인 AUTO 항목 제거 (진입 실패 종목 정리)
 *   3. isFocus 플래그 갱신 — gateScore 상위 FOCUS_LIST_SIZE개 AUTO 종목
 *   4. AUTO 항목 최대 MAX_WATCHLIST개 유지 (오래된 것부터 제거, MANUAL 보호)
 */

import { loadWatchlist, saveWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';

export const MAX_WATCHLIST     = 20;
export const FOCUS_LIST_SIZE   = 8;
export const MAX_ENTRY_FAIL_COUNT = 3;
/** gateScore가 이 값 이상인 AUTO 종목은 상위 8위 밖이어도 buyList에 포함된다. */
export const FOCUS_GATE_THRESHOLD = 15;

/**
 * AUTO 항목 중 매수 스캔 대상 코드 집합을 반환한다.
 * 선정 기준 (OR):
 *   1. gateScore 상위 FOCUS_LIST_SIZE(8)개
 *   2. gateScore >= FOCUS_GATE_THRESHOLD(15) — 상위 8 밖이어도 포함
 * isFocus 플래그 갱신 및 buyList 필터에 공통 사용된다.
 */
export function computeFocusCodes(list: WatchlistEntry[]): Set<string> {
  const autos = list.filter((w) => w.addedBy === 'AUTO');
  const sorted = [...autos].sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0));
  const topN = sorted.slice(0, FOCUS_LIST_SIZE).map((w) => w.code);
  const aboveThreshold = autos
    .filter((w) => (w.gateScore ?? 0) >= FOCUS_GATE_THRESHOLD)
    .map((w) => w.code);
  return new Set([...topN, ...aboveThreshold]);
}

export async function cleanupWatchlist(): Promise<void> {
  const watchlist = loadWatchlist();
  const now = new Date();

  // 1. 만료 항목 제거
  const afterExpiry = watchlist.filter((w) => {
    if (w.expiresAt && new Date(w.expiresAt) < now) {
      console.log(`[Watchlist] 만료 제거: ${w.name}(${w.code}) (만료: ${w.expiresAt})`);
      return false;
    }
    return true;
  });

  // 2. 진입 실패 횟수 초과 항목 제거 (BUG-07 fix: MANUAL 종목도 포함)
  const afterFailPrune = afterExpiry.filter((w) => {
    if ((w.entryFailCount ?? 0) >= MAX_ENTRY_FAIL_COUNT) {
      console.log(
        `[Watchlist] 진입실패 제거: ${w.name}(${w.code}) [${w.addedBy}] (실패 ${w.entryFailCount}회)`,
      );
      return false;
    }
    return true;
  });

  // 3. isFocus 플래그 갱신 (gateScore 상위 FOCUS_LIST_SIZE개 AUTO 종목)
  const focusCodes = computeFocusCodes(afterFailPrune);
  const withFocus = afterFailPrune.map((w) => ({
    ...w,
    isFocus: focusCodes.has(w.code),
  }));

  // 4. 최대 개수 초과 시 AUTO 항목 중 오래된 것부터 제거 (MANUAL 보호)
  let cleaned = withFocus;
  if (cleaned.length > MAX_WATCHLIST) {
    const manual = cleaned.filter((w) => w.addedBy === 'MANUAL');
    const auto   = cleaned
      .filter((w) => w.addedBy !== 'MANUAL')
      .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
      .slice(0, Math.max(0, MAX_WATCHLIST - manual.length));
    cleaned = [...manual, ...auto];
    console.log(`[Watchlist] 초과 제거: ${withFocus.length}개 → ${cleaned.length}개`);
  }

  if (
    cleaned.length !== watchlist.length ||
    cleaned.some((w) => {
      const orig = watchlist.find((o) => o.code === w.code);
      return orig === undefined || orig.isFocus !== w.isFocus;
    })
  ) {
    saveWatchlist(cleaned);
    console.log(`[Watchlist] 정리 완료: ${watchlist.length}개 → ${cleaned.length}개 (Focus ${focusCodes.size}개)`);
  } else {
    console.log(`[Watchlist] 정리 불필요 (${watchlist.length}개 유지, Focus ${focusCodes.size}개)`);
  }
}
