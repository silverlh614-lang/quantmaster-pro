// @responsibility ShadowTradeRepo position source reader.

import {
  getRemainingQty,
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
    const openTrades = trades
      .filter((trade) => trade.mode !== 'LIVE')
      .filter((trade) => trade.watchlistSource !== 'SHADOW_NEAR_BREAKOUT')
      .filter((trade) => isShadowDisplayOpenStatus(trade.status))
      .filter((trade) => getRemainingQty(trade) > 0);

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
