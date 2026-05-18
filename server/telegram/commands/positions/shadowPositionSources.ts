import { getExecutionMode } from '../../../state.js';
import { RegimeResolver, type MarketStateSnapshot } from '../../../trading/marketStateResolver.js';
import { getOpenPositions as getShadowLedgerOpenPositions } from '../../../persistence/shadowPositionLedger.js';
import {
  getRemainingQty,
  getTotalRealizedPnl,
  loadShadowTrades,
  type ServerShadowTrade,
} from '../../../persistence/shadowTradeRepo.js';
import { computeShadowAccount, type ShadowAccountState } from '../../../persistence/shadowAccountRepo.js';
import { loadTradingSettings } from '../../../persistence/tradingSettingsRepo.js';

const TELEGRAM_OPEN_SHADOW_STATUSES = new Set([
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

const TELEGRAM_CLOSED_SHADOW_STATUSES = new Set([
  'CLOSED',
  'STOPPED',
  'TAKE_PROFIT_FULL',
  'CANCELLED',
  'REJECTED',
  'HIT_TARGET',
  'HIT_STOP',
]);

export type PositionSourceName =
  | 'ShadowPositionLedger'
  | 'ShadowTradeRepo'
  | 'VirtualAccount';

export interface TelegramPositionEntry {
  source: PositionSourceName;
  tradeId: string;
  stockCode: string;
  stockName: string;
  qty: number;
  entryPrice: number;
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPct?: number;
  realizedPnl?: number;
  rMultiple?: number;
  status: string;
}

export interface PositionModeSnapshot {
  modeLabel: string;
  liveTradingEnabled: boolean;
  paperTradingEnabled: boolean;
  shadowLearningEnabled: boolean;
  marketState: MarketStateSnapshot | null;
}

export interface PositionSourceCounts {
  shadowRegistryCount: number;
  shadowLedgerCount: number;
  shadowTradeOpenCount: number;
  virtualHoldingCount: number;
  paperOpenCount: number;
  internalCount: number;
  kisLiveCount: number | 'SKIPPED';
  totalCount: number;
}

export interface PositionSourceSnapshot {
  mode: PositionModeSnapshot;
  positions: TelegramPositionEntry[];
  account: ShadowAccountState | null;
  counts: PositionSourceCounts;
}

export interface PnlSourceCounts {
  shadowRealizedCount: number;
  shadowOpenCount: number;
  virtualAccountAvailable: boolean;
  paperLedgerCount: number;
  livePnlSkipped: boolean;
  totalPnl: number;
}

export interface PnlSourceSnapshot {
  mode: PositionModeSnapshot;
  account: ShadowAccountState | null;
  openTrades: ServerShadowTrade[];
  closedTrades: ServerShadowTrade[];
  counts: PnlSourceCounts;
}

export function isShadowDisplayOpenStatus(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();
  if (normalized.length === 0 || TELEGRAM_CLOSED_SHADOW_STATUSES.has(normalized)) {
    return false;
  }

  return TELEGRAM_OPEN_SHADOW_STATUSES.has(normalized);
}

export function resolveTelegramPositionMode(): PositionModeSnapshot {
  const engineMode = getExecutionMode();
  let marketState: MarketStateSnapshot | null = null;

  try {
    marketState = RegimeResolver.resolveMarketState();
  } catch (error) {
    console.warn('[POSITION_MODE_RESOLVE_WARN]', error);
  }

  const r6Mode =
    marketState?.effectiveRegime === 'R6_DEFENSE' ||
    marketState?.effectiveRegime === 'R6_RECOVERY_WATCH'
      ? marketState.effectiveRegime
      : null;
  const modeLabel = r6Mode ?? marketState?.executionMode ?? (engineMode === 'LIVE' ? 'LIVE' : 'SHADOW_ONLY');
  const liveTradingEnabled = engineMode === 'LIVE' && marketState?.liveNewBuyAllowed !== false && modeLabel !== 'SHADOW_ONLY';

  return {
    modeLabel,
    liveTradingEnabled,
    paperTradingEnabled: engineMode === 'PAPER' || modeLabel === 'SHADOW_ONLY',
    shadowLearningEnabled: marketState?.shadowLearningAllowed ?? true,
    marketState,
  };
}

export function aggregatePositionSources(): PositionSourceSnapshot {
  const mode = resolveTelegramPositionMode();
  const allTrades = loadShadowTrades();
  const shadowTrades = allTrades.filter(isShadowLikeTrade);
  const ledgerEntries = getShadowLedgerOpenPositions();
  const openRepoTrades = shadowTrades.filter((trade) => isQueryableOpenTrade(trade));
  const account = computeAccount(shadowTrades);
  const positions: TelegramPositionEntry[] = [];
  const seenTradeIds = new Set<string>();

  for (const entry of ledgerEntries) {
    const tradeId = entry.trade.id;
    positions.push(normalizeTradePosition(entry.trade, 'ShadowPositionLedger', entry.qty));
    seenTradeIds.add(tradeId);
  }

  for (const trade of openRepoTrades) {
    const tradeId = trade.id;
    if (seenTradeIds.has(tradeId)) {
      continue;
    }

    positions.push(normalizeTradePosition(trade, 'ShadowTradeRepo', getRemainingQty(trade)));
    seenTradeIds.add(tradeId);
  }

  for (const holding of account?.openPositions ?? []) {
    if (seenTradeIds.has(holding.tradeId)) {
      continue;
    }

    positions.push({
      source: 'VirtualAccount',
      tradeId: holding.tradeId,
      stockCode: holding.stockCode,
      stockName: holding.stockName || holding.stockCode,
      qty: holding.remainingQty,
      entryPrice: holding.entryPrice,
      currentPrice: holding.currentPrice,
      unrealizedPnl: holding.unrealizedPnl,
      unrealizedPct: holding.unrealizedPct,
      status: 'OPEN',
    });
    seenTradeIds.add(holding.tradeId);
  }

  const counts: PositionSourceCounts = {
    shadowRegistryCount: 0,
    shadowLedgerCount: ledgerEntries.length,
    shadowTradeOpenCount: openRepoTrades.length,
    virtualHoldingCount: account?.openPositions.length ?? 0,
    paperOpenCount: 0,
    internalCount: 0,
    kisLiveCount: mode.liveTradingEnabled ? 0 : 'SKIPPED',
    totalCount: positions.length,
  };

  console.info(
    `[POSITION_SOURCE_COUNTS] mode=${mode.modeLabel} liveTradingEnabled=${mode.liveTradingEnabled} ` +
      `shadowRegistryCount=${counts.shadowRegistryCount} shadowLedgerCount=${counts.shadowLedgerCount} ` +
      `shadowTradeOpenCount=${counts.shadowTradeOpenCount} virtualHoldingCount=${counts.virtualHoldingCount} ` +
      `paperOpenCount=${counts.paperOpenCount} internalCount=${counts.internalCount} ` +
      `kisLiveCount=${counts.kisLiveCount} totalCount=${counts.totalCount}`,
  );

  return { mode, positions, account, counts };
}

export function aggregatePnlSources(): PnlSourceSnapshot {
  const mode = resolveTelegramPositionMode();
  const allTrades = loadShadowTrades();
  const shadowTrades = allTrades.filter(isShadowLikeTrade);
  const openTrades = shadowTrades.filter((trade) => isQueryableOpenTrade(trade));
  const account = computeAccount(shadowTrades);
  const closedTrades = shadowTrades.filter((trade) => !isQueryableOpenTrade(trade));
  const shadowRealizedCount = shadowTrades.filter((trade) => getTotalRealizedPnl(trade) !== 0 || hasSellFill(trade)).length;
  const totalPnl = (account?.realizedPnl ?? 0) + (account?.unrealizedPnl ?? 0);
  const counts: PnlSourceCounts = {
    shadowRealizedCount,
    shadowOpenCount: openTrades.length,
    virtualAccountAvailable: account != null,
    paperLedgerCount: 0,
    livePnlSkipped: !mode.liveTradingEnabled,
    totalPnl,
  };

  console.info(
    `[PNL_SOURCE_COUNTS] mode=${mode.modeLabel} shadowRealizedCount=${counts.shadowRealizedCount} ` +
      `shadowOpenCount=${counts.shadowOpenCount} virtualAccountAvailable=${counts.virtualAccountAvailable} ` +
      `paperLedgerCount=${counts.paperLedgerCount} livePnlSkipped=${counts.livePnlSkipped} ` +
      `totalPnl=${Math.round(counts.totalPnl)}`,
  );

  return { mode, account, openTrades, closedTrades, counts };
}

export function formatMoney(value: number | undefined | null): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }

  return `${Math.round(value as number).toLocaleString('ko-KR')}원`;
}

export function formatSignedMoney(value: number | undefined | null): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }

  const amount = Math.round(value as number);
  const sign = amount > 0 ? '+' : '';
  return `${sign}${amount.toLocaleString('ko-KR')}원`;
}

export function formatPercent(value: number | undefined | null): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }

  const pct = value as number;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatMultiple(value: number | undefined | null): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }

  return `${(value as number).toFixed(2)}R`;
}

function computeAccount(trades: ServerShadowTrade[]): ShadowAccountState | null {
  try {
    const settings = loadTradingSettings();
    return computeShadowAccount(trades, settings.startingCapital);
  } catch (error) {
    console.warn('[VIRTUAL_ACCOUNT_COMPUTE_WARN]', error);
    return null;
  }
}

function normalizeTradePosition(
  trade: ServerShadowTrade,
  source: PositionSourceName,
  qty: number,
): TelegramPositionEntry {
  const entryPrice = Number(trade.shadowEntryPrice ?? trade.signalPrice ?? 0);
  const unrealizedPnl = undefined;
  const unrealizedPct = undefined;
  const rMultiple = undefined;

  return {
    source,
    tradeId: trade.id,
    stockCode: trade.stockCode,
    stockName: trade.stockName || trade.stockCode,
    qty,
    entryPrice,
    unrealizedPnl,
    unrealizedPct,
    realizedPnl: getTotalRealizedPnl(trade),
    rMultiple,
    status: String(trade.status ?? 'OPEN'),
  };
}

function isQueryableOpenTrade(trade: ServerShadowTrade): boolean {
  if (!isShadowDisplayOpenStatus(trade.status)) {
    return false;
  }

  if (trade.watchlistSource === 'SHADOW_NEAR_BREAKOUT') {
    return false;
  }

  return getRemainingQty(trade) > 0;
}

function isShadowLikeTrade(trade: ServerShadowTrade): boolean {
  return trade.mode !== 'LIVE';
}

function hasSellFill(trade: ServerShadowTrade): boolean {
  return Array.isArray(trade.fills) && trade.fills.some((fill) => fill.type === 'SELL');
}
