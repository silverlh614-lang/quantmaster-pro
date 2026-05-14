// @responsibility 워치리스트 cleanup 후 OPEN Shadow 포지션 detachedFromWatchlist 마커 동기화 SSOT
/**
 * watchlistDetachmentSync.ts — Patch-WATCHLIST-DETACHMENT-SYNC-001
 *
 * 워치리스트 cleanup/rotation 으로 종목이 candidate store(`data/watchlist.json`)에서
 * 제거됐을 때, 그 종목의 OPEN Shadow 포지션에 `detachedFromWatchlist` 진단 마커를
 * 부착한다. 워치리스트 재진입 시 마커를 자동 해제한다.
 *
 * 핵심 불변식 (사용자 명시 — verbatim):
 *   "Watchlist cleanup may remove candidates.
 *    Watchlist cleanup must not close, delete, or stop managing OPEN Shadow positions."
 *
 *   - 이 모듈은 OPEN Shadow 포지션을 절대 닫거나 삭제하지 않는다 (마커 부착/해제만).
 *   - 마커는 *진단 전용* — exit management(손절/익절/트레일링)을 차단하지 않는다.
 *     실제 영향 범위는 신규 진입 후보 발굴에서 제외되는 것뿐.
 *   - `data/watchlist.json` 은 read-only 로만 참조 (saveWatchlist 호출 0건).
 *   - `data/shadow-trades.json` 은 마커 변경이 있을 때만 saveShadowTrades.
 *
 * ENV `WATCHLIST_DETACHMENT_SYNC_DISABLED=true` → 전체 no-op (마커 변경 0건).
 */

import { loadWatchlist } from '../persistence/watchlistRepo.js';
import {
  loadShadowTrades,
  saveShadowTrades,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';

// entryEngine.isOpenShadowStatus 와 동일 로직 — 순환/heavy import 회피를 위해 중복 정의.
function isOpenShadowStatus(status: ServerShadowTrade['status']): boolean {
  return (
    status === 'PENDING' ||
    status === 'ORDER_SUBMITTED' ||
    status === 'PARTIALLY_FILLED' ||
    status === 'ACTIVE' ||
    status === 'EUPHORIA_PARTIAL'
  );
}

/** ENV `WATCHLIST_DETACHMENT_SYNC_DISABLED` 정확 비교 (ADR-0157). */
export function isWatchlistDetachmentSyncDisabled(): boolean {
  return process.env.WATCHLIST_DETACHMENT_SYNC_DISABLED === 'true';
}

export interface WatchlistDetachmentSyncSummary {
  /** 검사한 OPEN Shadow 포지션 수 */
  scannedOpenPositions: number;
  /** 이번 호출에서 새로 detachedFromWatchlist=true 부착된 포지션 수 */
  newlyDetached: number;
  /** 이번 호출에서 워치리스트 재진입으로 마커 해제된 포지션 수 */
  reattached: number;
  /** 이미 detachedFromWatchlist=true 였던 포지션 수 (변경 없음) */
  alreadyDetached: number;
  /** ENV 우회로 전체 skip 됐는지 */
  disabled: boolean;
  /** saveShadowTrades 호출 여부 */
  persisted: boolean;
}

/**
 * 워치리스트 cleanup 직후 호출 — OPEN Shadow 포지션의 detachedFromWatchlist 마커를
 * 현재 워치리스트 상태와 동기화한다. CLOSED 포지션은 건드리지 않는다.
 *
 * @param now 테스트 결정성을 위한 시각 주입 (미전달 시 new Date()).
 */
export function syncDetachedFromWatchlist(now: Date = new Date()): WatchlistDetachmentSyncSummary {
  if (isWatchlistDetachmentSyncDisabled()) {
    return {
      scannedOpenPositions: 0,
      newlyDetached: 0,
      reattached: 0,
      alreadyDetached: 0,
      disabled: true,
      persisted: false,
    };
  }

  const watchlistCodes = new Set(loadWatchlist().map((w) => w.code));
  const trades = loadShadowTrades();
  const nowIso = now.toISOString();

  let scannedOpenPositions = 0;
  let newlyDetached = 0;
  let reattached = 0;
  let alreadyDetached = 0;
  let changed = false;

  for (const trade of trades) {
    if (!isOpenShadowStatus(trade.status)) continue;
    scannedOpenPositions += 1;

    const inWatchlist = watchlistCodes.has(trade.stockCode);

    if (!inWatchlist) {
      if (trade.detachedFromWatchlist === true) {
        alreadyDetached += 1;
        continue;
      }
      // 신규 detach — 마커 부착만, 포지션은 그대로 OPEN 유지.
      trade.detachedFromWatchlist = true;
      trade.detachedFromWatchlistAt = nowIso;
      newlyDetached += 1;
      changed = true;
      console.log(
        `[WatchlistDetachment] OPEN Shadow 포지션 detach 마커 부착: ` +
          `${trade.stockName ?? trade.stockCode}(${trade.stockCode}) — ` +
          `워치리스트에서 제거됨, 포지션 유지 + exit management 계속`,
      );
    } else if (trade.detachedFromWatchlist === true) {
      // 워치리스트 재진입 — 마커 해제.
      trade.detachedFromWatchlist = false;
      trade.detachedFromWatchlistAt = undefined;
      reattached += 1;
      changed = true;
      console.log(
        `[WatchlistDetachment] 워치리스트 재진입으로 detach 마커 해제: ` +
          `${trade.stockName ?? trade.stockCode}(${trade.stockCode})`,
      );
    }
  }

  if (changed) {
    saveShadowTrades(trades);
  }

  if (newlyDetached > 0 || reattached > 0) {
    console.log(
      `[WatchlistDetachment] 동기화 완료 — OPEN ${scannedOpenPositions}건 검사, ` +
        `신규 detach ${newlyDetached}건 / 재진입 해제 ${reattached}건 / ` +
        `기존 detach 유지 ${alreadyDetached}건`,
    );
  }

  return {
    scannedOpenPositions,
    newlyDetached,
    reattached,
    alreadyDetached,
    disabled: false,
    persisted: changed,
  };
}
