/**
 * watchlistManager.ts — 워치리스트 자동 정리 + 2-Track 구조 관리
 *
 * 아이디어 8: 워치리스트 등록과 매수 신호 분리 — 2-Track 구조
 *   Track A (Candidate Pool): 느슨한 조건으로 등록된 후보군 (최대 MAX_CANDIDATE_POOL개)
 *   Track B (Buy Watch):      타이트한 조건으로 선별된 매수 대상 (Focus 선정)
 *
 * 매일 16:00 KST (장마감 후) 실행:
 *   1. expiresAt 초과 항목 자동 제거
 *   2. entryFailCount >= 3인 AUTO 항목 제거 (진입 실패 종목 정리)
 *   3. Track B 승격: Gate Score 상위 + 임계값 초과 → track='B', isFocus=true
 *   4. 나머지 AUTO 항목 → track='A' (후보군 유지)
 *   5. Track A 최대 MAX_CANDIDATE_POOL개 유지 (오래된 것부터 제거, MANUAL 보호)
 */

import { loadWatchlist, saveWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';

/** Track A (Candidate Pool) 최대 크기 — 느슨한 조건으로 넓게 유지 */
export const MAX_CANDIDATE_POOL = 40;
/** Track B (Buy Watch) 최대 Focus 수 — 실제 매수 스캔 대상 */
export const FOCUS_LIST_SIZE   = 8;
export const MAX_ENTRY_FAIL_COUNT = 3;
/** gateScore가 이 값 이상인 AUTO 종목은 상위 8위 밖이어도 Track B에 포함된다. */
export const FOCUS_GATE_THRESHOLD = 8; // 수정: 15 → 8 (evaluateServerGate max score ~11)

/**
 * entryPrice 드리프트 임계값 (%).
 * 현재가가 entryPrice 대비 이 비율 이상 상승했으면 워치리스트 갱신/제거 대상.
 */
export const ENTRY_PRICE_DRIFT_PCT = 10;

/** @deprecated MAX_WATCHLIST → MAX_CANDIDATE_POOL 으로 교체. 하위 호환용. */
export const MAX_WATCHLIST = MAX_CANDIDATE_POOL;

/**
 * entryPrice 대비 현재가 드리프트 판정.
 *
 *  - AUTO 항목: 10% 이상 올랐으면 'REMOVE' (발굴 시점 대비 너무 멀리 상승)
 *  - MANUAL 항목: 'UPDATE' (사용자 확신 종목 → entryPrice를 현재가로 트레일 업)
 *  - 그 외 또는 미도달: 'KEEP'
 */
export function applyEntryPriceDrift(
  entry: WatchlistEntry,
  currentPrice: number,
): 'REMOVE' | 'UPDATE' | 'KEEP' {
  if (currentPrice <= 0 || entry.entryPrice <= 0) return 'KEEP';
  const driftPct = ((currentPrice - entry.entryPrice) / entry.entryPrice) * 100;
  if (driftPct < ENTRY_PRICE_DRIFT_PCT) return 'KEEP';
  return entry.addedBy === 'AUTO' ? 'REMOVE' : 'UPDATE';
}

/**
 * AUTO 항목 중 Track B (매수 스캔 대상) 코드 집합을 반환한다.
 * 선정 기준 (OR):
 *   1. gateScore 상위 FOCUS_LIST_SIZE(8)개
 *   2. gateScore >= FOCUS_GATE_THRESHOLD(8) — 상위 8 밖이어도 포함
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

  // 3. 아이디어 8: 2-Track 갱신 — Track B(매수 대상) + Track A(후보군)
  const focusCodes = computeFocusCodes(afterFailPrune);
  const withTrack = afterFailPrune.map((w) => {
    const isTrackB = focusCodes.has(w.code);
    return {
      ...w,
      isFocus: isTrackB,
      track: (w.addedBy === 'MANUAL' ? 'B' : isTrackB ? 'B' : 'A') as 'A' | 'B',
    };
  });

  const trackACount = withTrack.filter((w) => w.track === 'A').length;
  const trackBCount = withTrack.filter((w) => w.track === 'B').length;

  // 4. Track A 최대 개수 초과 시 오래된 것부터 제거 (MANUAL 보호, Track B 보호)
  let cleaned = withTrack;
  if (cleaned.length > MAX_CANDIDATE_POOL) {
    const protected_ = cleaned.filter((w) => w.addedBy === 'MANUAL' || w.track === 'B');
    const trackA = cleaned
      .filter((w) => w.addedBy !== 'MANUAL' && w.track === 'A')
      .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
      .slice(0, Math.max(0, MAX_CANDIDATE_POOL - protected_.length));
    cleaned = [...protected_, ...trackA];
    console.log(`[Watchlist] 초과 제거: ${withTrack.length}개 → ${cleaned.length}개`);
  }

  if (
    cleaned.length !== watchlist.length ||
    cleaned.some((w) => {
      const orig = watchlist.find((o) => o.code === w.code);
      return orig === undefined || orig.isFocus !== w.isFocus || orig.track !== w.track;
    })
  ) {
    saveWatchlist(cleaned);
    console.log(
      `[Watchlist] 정리 완료: ${watchlist.length}개 → ${cleaned.length}개 ` +
      `(Track A ${trackACount}개 / Track B ${trackBCount}개 / Focus ${focusCodes.size}개)`,
    );
  } else {
    console.log(
      `[Watchlist] 정리 불필요 (${watchlist.length}개 유지, ` +
      `Track A ${trackACount}개 / Track B ${trackBCount}개 / Focus ${focusCodes.size}개)`,
    );
  }
}
