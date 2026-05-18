// @responsibility VirtualAccount position source reader.

import {
  computeShadowAccount as computeDefaultShadowAccount,
  type ShadowAccountState,
} from '../../../../persistence/shadowAccountRepo.js';
import {
  loadShadowTrades as loadDefaultShadowTrades,
  type ServerShadowTrade,
} from '../../../../persistence/shadowTradeRepo.js';
import { loadTradingSettings as loadDefaultTradingSettings } from '../../../../persistence/tradingSettingsRepo.js';
import { normalizePositionDisplay } from '../positionDisplayNormalizer.js';
import { emitPositionOperationalWarn } from '../positionOperationalWarn.js';
import type { PositionSourceResult } from '../positionSourceTypes.js';

export interface VirtualAccountPositionReaderDeps {
  loadShadowTrades?: () => ServerShadowTrade[];
  loadTradingSettings?: () => { startingCapital: number };
  computeShadowAccount?: (
    trades: ServerShadowTrade[],
    startingCapital: number,
    currentPrices?: Record<string, number>,
  ) => ShadowAccountState;
  currentPrices?: Record<string, number>;
}

export async function readVirtualAccountPositions(
  deps: VirtualAccountPositionReaderDeps = {},
): Promise<PositionSourceResult> {
  const loadShadowTrades = deps.loadShadowTrades ?? loadDefaultShadowTrades;
  const loadTradingSettings = deps.loadTradingSettings ?? loadDefaultTradingSettings;
  const computeShadowAccount = deps.computeShadowAccount ?? computeDefaultShadowAccount;

  try {
    const trades = loadShadowTrades()
      .filter((trade) => trade.mode !== 'LIVE')
      .filter((trade) => trade.watchlistSource !== 'SHADOW_NEAR_BREAKOUT');
    const settings = loadTradingSettings();
    const account = computeShadowAccount(trades, settings.startingCapital, deps.currentPrices ?? {});
    const positions = account.openPositions
      .map((position) => normalizePositionDisplay({
        source: 'VirtualAccount',
        symbol: position.stockCode,
        name: position.stockName,
        qty: position.remainingQty,
        avgPrice: position.entryPrice,
        currentPrice: position.currentPrice,
        unrealizedPnl: position.unrealizedPnl,
        unrealizedPnlPct: position.unrealizedPct,
        id: position.tradeId,
        status: 'OPEN',
        raw: position,
      }))
      .filter((position) => position != null);

    if (positions.length === 0) {
      return {
        source: 'VirtualAccount',
        kind: 'EMPTY',
        diagnostics: { scanned: trades.length, accountComputed: true },
      };
    }

    return {
      source: 'VirtualAccount',
      kind: 'SUCCESS',
      positions,
      diagnostics: { scanned: trades.length, accountComputed: true },
    };
  } catch (error) {
    emitPositionOperationalWarn({
      code: 'P0_VIRTUAL_ACCOUNT_POSITION_FAILED',
      message: 'VirtualAccount position source failed',
      context: { source: 'VirtualAccount' },
      cause: error,
    });
    return {
      source: 'VirtualAccount',
      kind: 'FAILED',
      reason: error instanceof Error ? error.message : String(error),
      executionImpact: 'POSITION_QUERY_DEGRADED',
    };
  }
}
