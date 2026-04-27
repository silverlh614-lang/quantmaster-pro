// @responsibility 워치리스트 자동 충전 시 탈락 사유 메모리 캐시 SSOT
/**
 * rejectionLog.ts — 워치리스트 탈락 사유 인메모리 캐시 (ADR-0029).
 *
 * autoPopulateWatchlist 가 매 회차마다 setLastRejectionLog 로 갱신하고,
 * sendWatchlistRejectionReport 가 텔레그램 일괄 송출 시 getLastRejectionLog 로
 * 읽는다. 영속화 없음 — 재시작 시 비어있는 상태로 시작.
 */

export interface RejectionEntry {
  code: string;
  name: string;
  reason: string;
}

let lastRejectionLog: RejectionEntry[] = [];

/** 탈락 로그 조회 (API·테스트·리포트용) */
export function getLastRejectionLog(): RejectionEntry[] {
  return lastRejectionLog;
}

/** 탈락 로그 일괄 갱신 — autoPopulateWatchlist 가 한 회차 종료 시 호출. */
export function setLastRejectionLog(entries: RejectionEntry[]): void {
  lastRejectionLog = entries;
}
