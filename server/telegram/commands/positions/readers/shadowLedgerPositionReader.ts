// @responsibility ShadowPositionLedger position source reader.

import {
  getOpenPositions as getDefaultOpenPositions,
  type OpenPositionEntry,
} from '../../../../persistence/shadowPositionLedger.js';
import { normalizePositionDisplay } from '../positionDisplayNormalizer.js';
import { emitPositionOperationalWarn } from '../positionOperationalWarn.js';
import type { PositionSourceResult } from '../positionSourceTypes.js';

export interface ShadowLedgerPositionReaderDeps {
  getOpenPositions?: () => OpenPositionEntry[];
}

export async function readShadowLedgerPositions(
  deps: ShadowLedgerPositionReaderDeps = {},
): Promise<PositionSourceResult> {
  const getOpenPositions = deps.getOpenPositions ?? getDefaultOpenPositions;

  try {
    const entries = getOpenPositions();
    const positions = entries
      .map((entry) => normalizePositionDisplay({
        source: 'ShadowPositionLedger',
        symbol: entry.trade.stockCode,
        name: entry.trade.stockName,
        qty: entry.qty,
        avgPrice: entry.trade.shadowEntryPrice ?? entry.trade.signalPrice,
        currentPrice: (entry.trade as { currentPrice?: unknown }).currentPrice,
        id: entry.trade.id,
        status: entry.trade.status,
        raw: entry,
      }))
      .filter((position) => position != null);

    if (positions.length === 0) {
      return {
        source: 'ShadowPositionLedger',
        kind: 'EMPTY',
        diagnostics: { scanned: entries.length },
      };
    }

    return {
      source: 'ShadowPositionLedger',
      kind: 'SUCCESS',
      positions,
      diagnostics: { scanned: entries.length },
    };
  } catch (error) {
    emitPositionOperationalWarn({
      code: 'P0_SHADOW_POSITION_SOURCE_FAILED',
      message: 'ShadowPositionLedger position source failed',
      context: { source: 'ShadowPositionLedger' },
      cause: error,
    });
    return {
      source: 'ShadowPositionLedger',
      kind: 'FAILED',
      reason: error instanceof Error ? error.message : String(error),
      executionImpact: 'POSITION_QUERY_DEGRADED',
    };
  }
}
