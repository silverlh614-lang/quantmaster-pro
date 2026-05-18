// @responsibility KIS live holdings position source reader.

import { fetchKisHoldings, type KisHolding } from '../../../../clients/kisClient.js';
import { normalizePositionDisplay } from '../positionDisplayNormalizer.js';
import { emitPositionOperationalWarn } from '../positionOperationalWarn.js';
import type { PositionSourceResult } from '../positionSourceTypes.js';

export interface LiveKisPositionReaderDeps {
  fetchKisHoldings?: () => Promise<KisHolding[] | null>;
}

export async function readLiveKisPositions(
  deps: LiveKisPositionReaderDeps = {},
): Promise<PositionSourceResult> {
  const queryHoldings = deps.fetchKisHoldings ?? fetchKisHoldings;

  try {
    const holdings = await queryHoldings();
    if (!holdings) {
      return {
        source: 'KISLiveHolding',
        kind: 'EMPTY',
        diagnostics: { reason: 'KIS_HOLDINGS_UNAVAILABLE' },
      };
    }

    const positions = holdings
      .map((holding) => normalizePositionDisplay({
        source: 'KISLiveHolding',
        symbol: holding.pdno,
        name: holding.prdtName,
        qty: holding.hldgQty,
        avgPrice: holding.pchsAvgPric,
        currentPrice: holding.prpr,
        unrealizedPnl: holding.evluPflsAmt,
        unrealizedPnlPct: computePnlPct(holding),
        status: 'OPEN',
        raw: holding,
      }))
      .filter((position) => position != null);

    if (positions.length === 0) {
      return {
        source: 'KISLiveHolding',
        kind: 'EMPTY',
        diagnostics: { scanned: holdings.length },
      };
    }

    return {
      source: 'KISLiveHolding',
      kind: 'SUCCESS',
      positions,
      diagnostics: { scanned: holdings.length },
    };
  } catch (error) {
    emitPositionOperationalWarn({
      code: 'P0_POSITION_QUERY_DEGRADED',
      message: 'KIS live holdings position source failed',
      context: { source: 'KISLiveHolding' },
      cause: error,
    });
    return {
      source: 'KISLiveHolding',
      kind: 'FAILED',
      reason: error instanceof Error ? error.message : String(error),
      executionImpact: 'POSITION_QUERY_DEGRADED',
    };
  }
}

function computePnlPct(holding: KisHolding): number | undefined {
  const pnl = Number(holding.evluPflsAmt);
  const basis = Number(holding.pchsAvgPric) * Number(holding.hldgQty);
  if (!Number.isFinite(pnl) || !Number.isFinite(basis) || basis <= 0) {
    return undefined;
  }
  return (pnl / basis) * 100;
}
