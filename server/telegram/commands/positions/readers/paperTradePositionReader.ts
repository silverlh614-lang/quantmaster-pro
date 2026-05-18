// @responsibility PaperTradeLedger position source reader.

import type { PositionSourceResult } from '../positionSourceTypes.js';

export async function readPaperTradePositions(): Promise<PositionSourceResult> {
  return {
    source: 'PaperTradeLedger',
    kind: 'EMPTY',
    diagnostics: {
      reason: 'PAPER_TRADE_LEDGER_NOT_CONFIGURED',
    },
  };
}
