// @responsibility ShadowTradeRepo position source reader.

import {
  getRemainingQty,
  isActiveFill,
  loadShadowTrades as loadDefaultShadowTrades,
  type ServerShadowTrade,
} from '../../../../persistence/shadowTradeRepo.js';
import { normalizePositionDisplay } from '../positionDisplayNormalizer.js';
import { emitPositionOperationalWarn } from '../positionOperationalWarn.js';
import type { PositionSourceResult } from '../positionSourceTypes.js';

const OPEN_SHADOW_STATUSES = new Set([
  'OPEN',
  'PAPER_FILLED',
  'POSITION_OPENED',
  'ACTIVE',
  'PARTIAL_TAKE_PROFIT',
  'BREAK_EVEN_ARMED',
  'TRAILING_ACTIVE',
  'PENDING',
  'ORDER_SUBMITTED',
  'PARTIALLY_FILLED',
  'EUPHORIA_PARTIAL',
]);

const CLOSED_SHADOW_STATUSES = new Set([
  'CLOSED',
  'STOPPED',
  'TAKE_PROFIT_FULL',
  'CANCELLED',
  'REJECTED',
  'HIT_TARGET',
  'HIT_STOP',
]);

export interface ShadowTradeRepoReaderDeps {
  loadShadowTrades?: () => ServerShadowTrade[];
}

export async function readShadowTradeRepoPositions(
  deps: ShadowTradeRepoReaderDeps = {},
): Promise<PositionSourceResult> {
  const loadShadowTrades = deps.loadShadowTrades ?? loadDefaultShadowTrades;

  try {
    const trades = loadShadowTrades();
    // 중복정리 #3 작업2 (safe-direction): 가드7(BUY fill≥1 orphan 숨김, ADR-0504)을
    // ShadowTradeRepo reader 에도 일관 적용 — ledger(getOpenPositions) 와 동일 기준.
    // 누락 시 orphan(BUY fill 부재, legacy quantity 캐시로만 잔량>0) 이 aggregator-only
    // 경로로 새어 표시될 수 있는 비대칭 차단. 정상 포지션(BUY fill≥1) 영향 없음.
    const openTrades = trades
      .filter((trade) => trade.mode !== 'LIVE')
      .filter((trade) => trade.watchlistSource !== 'SHADOW_NEAR_BREAKOUT')
      .filter((trade) => isShadowDisplayOpenStatus(trade.status))
      .filter((trade) => getRemainingQty(trade) > 0)
      .filter((trade) => hasActiveBuyFill(trade));

    const positions = openTrades
      .map((trade) => normalizePositionDisplay({
        source: 'ShadowTradeRepo',
        symbol: trade.stockCode,
        name: trade.stockName,
        qty: getRemainingQty(trade),
        avgPrice: trade.shadowEntryPrice ?? trade.signalPrice,
        currentPrice: (trade as { currentPrice?: unknown }).currentPrice,
        id: trade.id,
        status: trade.status,
        raw: trade,
      }))
      .filter((position) => position != null);

    if (positions.length === 0) {
      return {
        source: 'ShadowTradeRepo',
        kind: 'EMPTY',
        diagnostics: { scanned: trades.length, openTrades: openTrades.length },
      };
    }

    return {
      source: 'ShadowTradeRepo',
      kind: 'SUCCESS',
      positions,
      diagnostics: { scanned: trades.length, openTrades: openTrades.length },
    };
  } catch (error) {
    emitPositionOperationalWarn({
      code: 'P0_SHADOW_POSITION_SOURCE_FAILED',
      message: 'ShadowTradeRepo position source failed',
      context: { source: 'ShadowTradeRepo' },
      cause: error,
    });
    return {
      source: 'ShadowTradeRepo',
      kind: 'FAILED',
      reason: error instanceof Error ? error.message : String(error),
      executionImpact: 'POSITION_QUERY_DEGRADED',
    };
  }
}

function isShadowDisplayOpenStatus(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();
  if (normalized.length === 0 || CLOSED_SHADOW_STATUSES.has(normalized)) {
    return false;
  }
  return OPEN_SHADOW_STATUSES.has(normalized);
}

/** 가드7(ADR-0504) — 활성 BUY fill ≥ 1. orphan 표시 차단을 ledger 경로와 정합. */
function hasActiveBuyFill(trade: ServerShadowTrade): boolean {
  return (trade.fills ?? []).some((fill) => fill.type === 'BUY' && isActiveFill(fill));
}
