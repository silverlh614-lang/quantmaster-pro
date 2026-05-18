import { getExecutionMode } from '../../../state.js';
import { RegimeResolver, type MarketStateSnapshot } from '../../../trading/marketStateResolver.js';
import { fetchCurrentPrice } from '../../../clients/kisClient.js';
import { getRealtimePrice } from '../../../clients/kisStreamClient.js';
import { getOpenPositions as getShadowLedgerOpenPositions } from '../../../persistence/shadowPositionLedger.js';
import {
  getRemainingQty,
  getTotalRealizedPnl,
  loadShadowTrades,
  type ServerShadowTrade,
} from '../../../persistence/shadowTradeRepo.js';
import { computeShadowAccount, type ActivePosition, type ShadowAccountState } from '../../../persistence/shadowAccountRepo.js';
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

export type PositionPriceSource =
  | 'REALTIME_WS'
  | 'KIS_REST'
  | 'VIRTUAL_ACCOUNT'
  | 'ENTRY_PRICE_FALLBACK';

export interface TelegramPositionEntry {
  source: PositionSourceName;
  tradeId: string;
  stockCode: string;
  stockName: string;
  qty: number;
  entryPrice: number;
  currentPrice?: number;
  currentPriceSource?: PositionPriceSource;
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

export interface ShadowPnlSummary {
  realizedPnl: number;
  unrealizedPnl: number;
  todayPnl: number;
  cumulativePnl: number;
  virtualTotalAssets: number;
  closedTradeCount: number;
}

export interface PnlSourceSnapshot {
  mode: PositionModeSnapshot;
  account: ShadowAccountState | null;
  openTrades: ServerShadowTrade[];
  closedTrades: ServerShadowTrade[];
  counts: PnlSourceCounts;
  pnl: ShadowPnlSummary;
}

interface PriceLookupSnapshot {
  prices: Record<string, number>;
  sourceByCode: Map<string, PositionPriceSource>;
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

export async function aggregatePositionSources(): Promise<PositionSourceSnapshot> {
  const mode = resolveTelegramPositionMode();
  const allTrades = loadShadowTrades();
  const shadowTrades = allTrades.filter(isShadowLikeTrade);
  const ledgerEntries = getShadowLedgerOpenPositions();
  const openRepoTrades = shadowTrades.filter((trade) => isQueryableOpenTrade(trade));
  const priceLookup = await resolvePriceLookup([...ledgerEntries.map((entry) => entry.trade), ...openRepoTrades], 'POSITION');
  const account = computeAccount(shadowTrades, priceLookup.prices);
  const accountPositionsByTradeId = new Map((account?.openPositions ?? []).map((position) => [position.tradeId, position]));
  const positions: TelegramPositionEntry[] = [];
  const seenTradeIds = new Set<string>();

  for (const entry of ledgerEntries) {
    const tradeId = entry.trade.id;
    positions.push(normalizeTradePosition(
      entry.trade,
      'ShadowPositionLedger',
      entry.qty,
      accountPositionsByTradeId.get(tradeId),
      priceLookup,
    ));
    seenTradeIds.add(tradeId);
  }

  for (const trade of openRepoTrades) {
    const tradeId = trade.id;
    if (seenTradeIds.has(tradeId)) {
      continue;
    }

    positions.push(normalizeTradePosition(
      trade,
      'ShadowTradeRepo',
      getRemainingQty(trade),
      accountPositionsByTradeId.get(tradeId),
      priceLookup,
    ));
    seenTradeIds.add(tradeId);
  }

  for (const holding of account?.openPositions ?? []) {
    if (seenTradeIds.has(holding.tradeId)) {
      continue;
    }

    const currentPrice = finitePositive(holding.currentPrice) ?? finitePositive(holding.entryPrice);
    const currentPriceSource = holding.currentPrice !== undefined
      ? priceLookup.sourceByCode.get(holding.stockCode) ?? 'VIRTUAL_ACCOUNT'
      : 'ENTRY_PRICE_FALLBACK';
    const unrealizedPnl = computeUnrealizedPnl(currentPrice, holding.entryPrice, holding.remainingQty);
    const unrealizedPct = computeUnrealizedPct(currentPrice, holding.entryPrice);

    positions.push({
      source: 'VirtualAccount',
      tradeId: holding.tradeId,
      stockCode: holding.stockCode,
      stockName: holding.stockName || holding.stockCode,
      qty: holding.remainingQty,
      entryPrice: holding.entryPrice,
      currentPrice,
      currentPriceSource,
      unrealizedPnl,
      unrealizedPct,
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

export async function aggregatePnlSources(): Promise<PnlSourceSnapshot> {
  const mode = resolveTelegramPositionMode();
  const allTrades = loadShadowTrades();
  const shadowTrades = allTrades.filter(isShadowLikeTrade);
  const openTrades = shadowTrades.filter((trade) => isQueryableOpenTrade(trade));
  const priceLookup = await resolvePriceLookup(openTrades, 'PNL');
  const account = computeAccount(shadowTrades, priceLookup.prices);
  const closedTrades = shadowTrades.filter((trade) => !isQueryableOpenTrade(trade));
  const shadowRealizedCount = shadowTrades.filter((trade) => getTotalRealizedPnl(trade) !== 0 || hasSellFill(trade)).length;
  const realizedPnl = shadowTrades.reduce((sum, trade) => sum + getTotalRealizedPnl(trade), 0);
  const unrealizedPnl = account?.unrealizedPnl ?? 0;
  const todayPnl = sumTodaySellPnl(shadowTrades);
  const cumulativePnl = realizedPnl + unrealizedPnl;
  const startingCapital = account?.startingCapital ?? loadTradingSettings().startingCapital;
  const pnl: ShadowPnlSummary = {
    realizedPnl,
    unrealizedPnl,
    todayPnl,
    cumulativePnl,
    virtualTotalAssets: startingCapital + cumulativePnl,
    closedTradeCount: account?.closedTrades.length ?? closedTrades.length,
  };
  const counts: PnlSourceCounts = {
    shadowRealizedCount,
    shadowOpenCount: openTrades.length,
    virtualAccountAvailable: account != null,
    paperLedgerCount: 0,
    livePnlSkipped: !mode.liveTradingEnabled,
    totalPnl: pnl.cumulativePnl,
  };

  console.info(
    `[PNL_SOURCE_COUNTS] mode=${mode.modeLabel} shadowRealizedCount=${counts.shadowRealizedCount} ` +
      `shadowOpenCount=${counts.shadowOpenCount} virtualAccountAvailable=${counts.virtualAccountAvailable} ` +
      `paperLedgerCount=${counts.paperLedgerCount} livePnlSkipped=${counts.livePnlSkipped} ` +
      `totalPnl=${Math.round(counts.totalPnl)}`,
  );

  return { mode, account, openTrades, closedTrades, counts, pnl };
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

function computeAccount(
  trades: ServerShadowTrade[],
  currentPrices: Record<string, number> = {},
): ShadowAccountState | null {
  try {
    const settings = loadTradingSettings();
    return computeShadowAccount(trades, settings.startingCapital, currentPrices);
  } catch (error) {
    console.warn('[VIRTUAL_ACCOUNT_COMPUTE_WARN]', error);
    return null;
  }
}

function normalizeTradePosition(
  trade: ServerShadowTrade,
  source: PositionSourceName,
  qty: number,
  accountPosition: ActivePosition | undefined,
  priceLookup: PriceLookupSnapshot,
): TelegramPositionEntry {
  const entryPrice = finitePositive(trade.shadowEntryPrice) ?? finitePositive(trade.signalPrice) ?? 0;
  const lookupPrice = finitePositive(accountPosition?.currentPrice) ?? finitePositive(priceLookup.prices[trade.stockCode]);
  const currentPrice = lookupPrice ?? finitePositive(entryPrice);
  const currentPriceSource = lookupPrice !== undefined
    ? priceLookup.sourceByCode.get(trade.stockCode) ?? 'VIRTUAL_ACCOUNT'
    : currentPrice !== undefined
      ? 'ENTRY_PRICE_FALLBACK'
      : undefined;
  const unrealizedPnl = computeUnrealizedPnl(currentPrice, entryPrice, qty);
  const unrealizedPct = computeUnrealizedPct(currentPrice, entryPrice);
  const rMultiple = computeRMultiple(currentPrice, entryPrice, trade.stopLoss);

  return {
    source,
    tradeId: trade.id,
    stockCode: trade.stockCode,
    stockName: trade.stockName || trade.stockCode,
    qty,
    entryPrice,
    currentPrice,
    currentPriceSource,
    unrealizedPnl,
    unrealizedPct,
    realizedPnl: getTotalRealizedPnl(trade),
    rMultiple,
    status: String(trade.status ?? 'OPEN'),
  };
}

async function resolvePriceLookup(
  trades: ServerShadowTrade[],
  logScope: 'POSITION' | 'PNL',
): Promise<PriceLookupSnapshot> {
  const codes = Array.from(new Set(
    trades
      .map((trade) => trade.stockCode?.padStart(6, '0'))
      .filter((code): code is string => typeof code === 'string' && code.length > 0),
  ));
  const prices: Record<string, number> = {};
  const sourceByCode = new Map<string, PositionPriceSource>();
  let realtimeCount = 0;
  let kisRestCount = 0;
  let missingCount = 0;

  for (const code of codes) {
    const realtime = finitePositive(getRealtimePrice(code));
    if (realtime !== undefined) {
      prices[code] = realtime;
      sourceByCode.set(code, 'REALTIME_WS');
      realtimeCount += 1;
      continue;
    }

    const restPrice = await fetchCurrentPrice(code).catch((error) => {
      console.warn(`[${logScope}_PRICE_LOOKUP_WARN] code=${code} source=KIS_REST`, error instanceof Error ? error.message : error);
      return null;
    });
    const normalizedRestPrice = finitePositive(restPrice);
    if (normalizedRestPrice !== undefined) {
      prices[code] = normalizedRestPrice;
      sourceByCode.set(code, 'KIS_REST');
      kisRestCount += 1;
      continue;
    }

    missingCount += 1;
  }

  console.info(
    `[${logScope}_PRICE_SOURCE_COUNTS] requested=${codes.length} realtime=${realtimeCount} ` +
      `kisRest=${kisRestCount} entryFallback=${missingCount} missing=${missingCount}`,
  );

  return { prices, sourceByCode };
}

function finitePositive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function computeUnrealizedPnl(
  currentPrice: number | undefined,
  entryPrice: number,
  qty: number,
): number | undefined {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(entryPrice) || !Number.isFinite(qty)) {
    return undefined;
  }
  return ((currentPrice as number) - entryPrice) * qty;
}

function computeUnrealizedPct(currentPrice: number | undefined, entryPrice: number): number | undefined {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return undefined;
  }
  return (((currentPrice as number) / entryPrice) - 1) * 100;
}

function computeRMultiple(
  currentPrice: number | undefined,
  entryPrice: number,
  stopLoss: number | undefined,
): number | undefined {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(entryPrice) || !Number.isFinite(stopLoss)) {
    return undefined;
  }
  const riskPerShare = entryPrice - (stopLoss as number);
  if (riskPerShare <= 0) return undefined;
  return ((currentPrice as number) - entryPrice) / riskPerShare;
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

function sumTodaySellPnl(trades: ServerShadowTrade[]): number {
  const todayKst = kstDateString(new Date());
  let total = 0;

  for (const trade of trades) {
    for (const fill of trade.fills ?? []) {
      if (fill.type !== 'SELL' || fill.status === 'REVERTED') {
        continue;
      }
      if (kstDateString(new Date(fill.timestamp)) !== todayKst) {
        continue;
      }

      total += fill.pnl ?? 0;
    }
  }

  return total;
}

function kstDateString(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}
