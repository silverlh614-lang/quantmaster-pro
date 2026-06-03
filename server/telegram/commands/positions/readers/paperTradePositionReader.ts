// @responsibility PaperTradeLedger position source reader.

import { emitPositionOperationalWarn } from '../positionOperationalWarn.js';
import type { NormalizedPosition, PositionSourceResult } from '../positionSourceTypes.js';

/**
 * 사실상 stub — `deps.loadPaperPositions` 미주입 시 항상 EMPTY (프로덕션 주입 0건).
 *
 * 중복정리 #3 정합: 6-reader 우선순위 5순위 슬롯이지만 paper 소스 부재로 등재 0건.
 * Mock 투자 도입 시 paper 소스를 `loadPaperPositions` 로 주입하면 실 reader 로 전환.
 */

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
