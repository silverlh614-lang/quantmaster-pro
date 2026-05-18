// @responsibility PaperTradeLedger position source reader.

import { emitPositionOperationalWarn } from '../positionOperationalWarn.js';
import type { NormalizedPosition, PositionSourceResult } from '../positionSourceTypes.js';

export interface PaperTradePositionReaderDeps {
  loadPaperPositions?: () => Promise<NormalizedPosition[]> | NormalizedPosition[];
}

export async function readPaperTradePositions(
  deps: PaperTradePositionReaderDeps = {},
): Promise<PositionSourceResult> {
  try {
    if (!deps.loadPaperPositions) {
      return {
        source: 'PaperTradeLedger',
        kind: 'EMPTY',
        diagnostics: {
          reason: 'PAPER_TRADE_LEDGER_NOT_CONFIGURED',
        },
      };
    }

    const positions = await deps.loadPaperPositions();
    if (positions.length === 0) {
      return {
        source: 'PaperTradeLedger',
        kind: 'EMPTY',
        diagnostics: { scanned: 0 },
      };
    }

    return {
      source: 'PaperTradeLedger',
      kind: 'SUCCESS',
      positions,
      diagnostics: { scanned: positions.length },
    };
  } catch (error) {
    emitPositionOperationalWarn({
      code: 'P0_PAPER_LEDGER_POSITION_FAILED',
      message: 'PaperTradeLedger position source failed',
      context: { source: 'PaperTradeLedger' },
      cause: error,
    });
    return {
      source: 'PaperTradeLedger',
      kind: 'FAILED',
      reason: error instanceof Error ? error.message : String(error),
      executionImpact: 'POSITION_QUERY_DEGRADED',
    };
  }
}
