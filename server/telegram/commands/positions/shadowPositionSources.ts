// @responsibility Telegram position source aggregation.
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
import {
  attachDualPositionDisplay,
  buildPositionDisplayTags,
  type AccountKind,
  type NormalizedPositionPriceSource,
  type PnlKind,
  type PositionEngineMode,
  type PositionExecutionImpact,
  type PositionKind,
  type PositionOrigin,
  type DualPositionDisplayInfo,
} from '../../positionDisplayTags.js';
import { aggregatePositionSourceResults } from './positionSourceAggregator.js';
import type {
  NormalizedPosition,
  PositionSourceAggregate,
  PositionSourceResult,
} from './positionSourceTypes.js';

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
  | 'ShadowPositionRegistry'
  | 'ShadowPositionLedger'
  | 'ShadowTradeRepo'
  | 'VirtualAccount'
  | 'KISLiveHolding'
  | 'PaperTradeLedger';

export type PositionLookupPriceSource =
  | 'REALTIME_WS'
  | 'KIS_REST'
  | 'VIRTUAL_ACCOUNT'
  | 'ENTRY_PRICE_FALLBACK';

export interface TelegramPositionEntry {
  source: PositionSourceName;
  positionKind: PositionKind;
  accountKind: AccountKind;
  origin: PositionOrigin;
  engineMode: PositionEngineMode;
  effectiveRegime: string;
  entrySource: string;
  priceSource: NormalizedPositionPriceSource;
  pnlKind: PnlKind;
  liveOrderSent: boolean;
  executionImpact: PositionExecutionImpact;
  sizingSource?: string;
  displayTags: string[];
  dualPosition?: DualPositionDisplayInfo;
  tradeId: string;
  stockCode: string;
  stockName: string;
  qty: number;
  entryPrice: number;
  currentPrice?: number;
  currentPriceSource?: PositionLookupPriceSource;
  priceAgeSeconds?: number;
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
  sourceDiagnostics: PositionSourceResult[];
  sourceAggregate: PositionSourceAggregate;
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
  liveRealizedPnl: number;
  liveUnrealizedPnl: number;
  shadowRealizedPnl: number;
  shadowUnrealizedPnl: number;
  shadowTodayPnl: number;
  virtualCash: number;
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
  sourceDiagnostics?: PositionSourceResult[];
  sourceAggregate?: PositionSourceAggregate;
}

interface PriceLookupSnapshot {
  prices: Record<string, number>;
  sourceByCode: Map<string, PositionLookupPriceSource>;
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
  const sourceAggregate = await aggregatePositionSourceResults({
    mode: mode.liveTradingEnabled ? 'LIVE' : 'SHADOW',
    includeLiveFallback: mode.liveTradingEnabled,
  });
  const allTrades = loadShadowTrades();
  const displayableShadowTrades = allTrades
    .filter(isShadowLikeTrade)
    .filter((trade) => trade.watchlistSource !== 'SHADOW_NEAR_BREAKOUT');
  const ledgerEntries = getShadowLedgerOpenPositions();
  const openRepoTrades = displayableShadowTrades.filter((trade) => isQueryableOpenTrade(trade));
  const priceLookup = await resolvePriceLookup([...ledgerEntries.map((entry) => entry.trade), ...openRepoTrades], 'POSITION');
  const account = computeAccount(displayableShadowTrades, priceLookup.prices);
  const accountPositionsByTradeId = new Map((account?.openPositions ?? []).map((position) => [position.tradeId, position]));
  const positions: TelegramPositionEntry[] = [];
  const seenTradeIds = new Set<string>();

  for (const entry of ledgerEntries) {
    const tradeId = entry.trade.id;
    positions.push(normalizeTradePosition(
      entry.trade,
      'ShadowPositionLedger',
      mode,
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
      mode,
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

    const stockCode = normalizeStockCode(holding.stockCode);
    const currentPrice = finitePositive(holding.currentPrice);
    const currentPriceSource = holding.currentPrice !== undefined
      ? priceLookup.sourceByCode.get(stockCode) ?? 'VIRTUAL_ACCOUNT'
      : 'ENTRY_PRICE_FALLBACK';
    const unrealizedPnl = computeUnrealizedPnl(currentPrice, holding.entryPrice, holding.remainingQty);
    const unrealizedPct = computeUnrealizedPct(currentPrice, holding.entryPrice);
    const displayContext = buildDisplayContext(mode);
    const priceSource = normalizePriceSource(currentPriceSource);
    const positionKind: PositionKind = 'VIRTUAL';
    const accountKind: AccountKind = 'VIRTUAL_SHADOW';
    const origin: PositionOrigin = 'VIRTUAL_ACCOUNT';
    const liveOrderSent = false;
    const executionImpact: PositionExecutionImpact = 'NONE';
    const entrySource = 'VIRTUAL_ACCOUNT';

    positions.push({
      source: 'VirtualAccount',
      positionKind,
      accountKind,
      origin,
      engineMode: displayContext.engineMode,
      effectiveRegime: displayContext.effectiveRegime,
      entrySource,
      priceSource,
      pnlKind: 'VIRTUAL_UNREALIZED',
      liveOrderSent,
      executionImpact,
      sizingSource: undefined,
      displayTags: buildPositionDisplayTags({
        positionKind,
        accountKind,
        origin,
        engineMode: displayContext.engineMode,
        effectiveRegime: displayContext.effectiveRegime,
        entrySource,
        liveOrderSent,
        executionImpact,
      }),
      tradeId: holding.tradeId,
      stockCode,
      stockName: holding.stockName || stockCode,
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

  appendAggregatorOnlyPositions(positions, seenTradeIds, sourceAggregate.positions, mode);

  const counts: PositionSourceCounts = {
    shadowRegistryCount: countAggregateSourcePositions(sourceAggregate, 'ShadowPositionRegistry'),
    shadowLedgerCount: ledgerEntries.length,
    shadowTradeOpenCount: openRepoTrades.length,
    virtualHoldingCount: account?.openPositions.length ?? 0,
    paperOpenCount: countAggregateSourcePositions(sourceAggregate, 'PaperTradeLedger'),
    internalCount: 0,
    kisLiveCount: isAggregateSourceSkipped(sourceAggregate, 'KISLiveHolding')
      ? 'SKIPPED'
      : countAggregateSourcePositions(sourceAggregate, 'KISLiveHolding'),
    totalCount: positions.length,
  };

  console.info(
    `[POSITION_SOURCE_COUNTS] mode=${mode.modeLabel} liveTradingEnabled=${mode.liveTradingEnabled} ` +
      `shadowRegistryCount=${counts.shadowRegistryCount} shadowLedgerCount=${counts.shadowLedgerCount} ` +
      `shadowTradeOpenCount=${counts.shadowTradeOpenCount} virtualHoldingCount=${counts.virtualHoldingCount} ` +
      `paperOpenCount=${counts.paperOpenCount} internalCount=${counts.internalCount} ` +
      `kisLiveCount=${counts.kisLiveCount} totalCount=${counts.totalCount}`,
  );

  return {
    mode,
    positions: attachDualPositionDisplay(positions),
    account,
    counts,
    sourceDiagnostics: sourceAggregate.results,
    sourceAggregate,
  };
}

export async function aggregatePnlSources(): Promise<PnlSourceSnapshot> {
  const mode = resolveTelegramPositionMode();
  const sourceAggregate = await aggregatePositionSourceResults({
    mode: mode.liveTradingEnabled ? 'LIVE' : 'SHADOW',
    includeLiveFallback: mode.liveTradingEnabled,
  });
  const allTrades = loadShadowTrades();
  const shadowTrades = allTrades
    .filter(isShadowLikeTrade)
    .filter((trade) => trade.watchlistSource !== 'SHADOW_NEAR_BREAKOUT');
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
    liveRealizedPnl: 0,
    liveUnrealizedPnl: 0,
    shadowRealizedPnl: realizedPnl,
    shadowUnrealizedPnl: unrealizedPnl,
    shadowTodayPnl: todayPnl,
    virtualCash: account?.cashBalance ?? startingCapital,
    virtualTotalAssets: startingCapital + cumulativePnl,
    closedTradeCount: account?.closedTrades.length ?? closedTrades.length,
  };
  const counts: PnlSourceCounts = {
    shadowRealizedCount,
    shadowOpenCount: openTrades.length,
    virtualAccountAvailable: account != null,
    paperLedgerCount: countAggregateSourcePositions(sourceAggregate, 'PaperTradeLedger'),
    livePnlSkipped: !mode.liveTradingEnabled,
    totalPnl: pnl.cumulativePnl,
  };

  console.info(
    `[PNL_SOURCE_COUNTS] mode=${mode.modeLabel} shadowRealizedCount=${counts.shadowRealizedCount} ` +
      `shadowOpenCount=${counts.shadowOpenCount} virtualAccountAvailable=${counts.virtualAccountAvailable} ` +
      `paperLedgerCount=${counts.paperLedgerCount} livePnlSkipped=${counts.livePnlSkipped} ` +
      `totalPnl=${Math.round(counts.totalPnl)}`,
  );

  return {
    mode,
    account,
    openTrades,
    closedTrades,
    counts,
    pnl,
    sourceDiagnostics: sourceAggregate.results,
    sourceAggregate,
  };
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
  mode: PositionModeSnapshot,
  qty: number,
  accountPosition: ActivePosition | undefined,
  priceLookup: PriceLookupSnapshot,
): TelegramPositionEntry {
  const stockCode = normalizeStockCode(trade.stockCode);
  const entryPrice = finitePositive(trade.shadowEntryPrice) ?? finitePositive(trade.signalPrice) ?? 0;
  const lookupPrice = finitePositive(accountPosition?.currentPrice) ?? finitePositive(priceLookup.prices[stockCode]);
  const currentPrice = lookupPrice;
  const currentPriceSource = lookupPrice !== undefined
    ? priceLookup.sourceByCode.get(stockCode) ?? 'VIRTUAL_ACCOUNT'
    : 'ENTRY_PRICE_FALLBACK';
  const unrealizedPnl = computeUnrealizedPnl(currentPrice, entryPrice, qty);
  const unrealizedPct = computeUnrealizedPct(currentPrice, entryPrice);
  const rMultiple = computeRMultiple(currentPrice, entryPrice, trade.stopLoss);
  const displayContext = buildDisplayContext(mode, trade);
  const positionKind: PositionKind = trade.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
  const accountKind: AccountKind = trade.mode === 'LIVE' ? 'KIS_LIVE' : 'VIRTUAL_SHADOW';
  const origin = source === 'ShadowPositionLedger'
    ? 'SHADOW_POSITION_LEDGER'
    : 'SHADOW_TRADE_REPO';
  const entrySource = resolveEntrySource(trade, source);
  const liveOrderSent = trade.mode === 'LIVE' || (trade as { liveOrderSent?: boolean }).liveOrderSent === true;
  const executionImpact: PositionExecutionImpact = trade.mode === 'LIVE' ? 'LIVE_POSITION' : 'NONE';
  const priceSource = normalizePriceSource(currentPriceSource);

  return {
    source,
    positionKind,
    accountKind,
    origin,
    engineMode: displayContext.engineMode,
    effectiveRegime: displayContext.effectiveRegime,
    entrySource,
    priceSource,
    pnlKind: positionKind === 'LIVE' ? 'UNREALIZED_LIVE' : 'VIRTUAL_UNREALIZED',
    liveOrderSent,
    executionImpact,
    sizingSource: trade.sizingSource,
    displayTags: buildPositionDisplayTags({
      positionKind,
      accountKind,
      origin,
      engineMode: displayContext.engineMode,
      effectiveRegime: displayContext.effectiveRegime,
      entrySource,
      liveOrderSent,
      executionImpact,
    }),
    tradeId: trade.id,
    stockCode,
    stockName: trade.stockName || stockCode,
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

function appendAggregatorOnlyPositions(
  positions: TelegramPositionEntry[],
  seenTradeIds: Set<string>,
  normalizedPositions: NormalizedPosition[],
  mode: PositionModeSnapshot,
): void {
  for (const normalized of normalizedPositions) {
    const source = normalizeAggregateSourceName(normalized.source);
    const tradeId = normalized.id ?? `${source}:${normalized.symbol}`;
    if (seenTradeIds.has(tradeId)) {
      continue;
    }

    positions.push(normalizeAggregatedPosition(normalized, source, tradeId, mode));
    seenTradeIds.add(tradeId);
  }
}

function normalizeAggregatedPosition(
  normalized: NormalizedPosition,
  source: PositionSourceName,
  tradeId: string,
  mode: PositionModeSnapshot,
): TelegramPositionEntry {
  const displayContext = buildDisplayContext(mode);
  const positionKind = normalized.sourceTag as PositionKind;
  const accountKind = accountKindForSourceTag(normalized.sourceTag);
  const origin = originForSource(source);
  const entrySource = source;
  const liveOrderSent = normalized.sourceTag === 'LIVE';
  const executionImpact: PositionExecutionImpact = normalized.sourceTag === 'LIVE' ? 'LIVE_POSITION' : 'NONE';
  const priceSource = normalized.currentPrice !== undefined
    ? (normalized.sourceTag === 'LIVE' ? 'KIS' : 'CACHE')
    : 'MISSING';
  const currentPriceSource = normalized.currentPrice !== undefined
    ? (normalized.sourceTag === 'LIVE' ? 'KIS_REST' : 'VIRTUAL_ACCOUNT')
    : 'ENTRY_PRICE_FALLBACK';
  const entryPrice = finitePositive(normalized.avgPrice) ?? 0;

  return {
    source,
    positionKind,
    accountKind,
    origin,
    engineMode: displayContext.engineMode,
    effectiveRegime: displayContext.effectiveRegime,
    entrySource,
    priceSource,
    pnlKind: positionKind === 'LIVE' ? 'UNREALIZED_LIVE' : 'VIRTUAL_UNREALIZED',
    liveOrderSent,
    executionImpact,
    sizingSource: undefined,
    displayTags: buildPositionDisplayTags({
      positionKind,
      accountKind,
      origin,
      engineMode: displayContext.engineMode,
      effectiveRegime: displayContext.effectiveRegime,
      entrySource,
      liveOrderSent,
      executionImpact,
    }),
    tradeId,
    stockCode: normalized.symbol,
    stockName: normalized.name || normalized.symbol,
    qty: normalized.qty,
    entryPrice,
    currentPrice: normalized.currentPrice,
    currentPriceSource,
    unrealizedPnl: normalized.unrealizedPnl ?? computeUnrealizedPnl(normalized.currentPrice, entryPrice, normalized.qty),
    unrealizedPct: normalized.unrealizedPnlPct ?? computeUnrealizedPct(normalized.currentPrice, entryPrice),
    realizedPnl: undefined,
    rMultiple: undefined,
    status: normalized.status ?? 'OPEN',
  };
}

function normalizeAggregateSourceName(source: unknown): PositionSourceName {
  const normalized = String(source ?? '');
  if (
    normalized === 'ShadowPositionRegistry' ||
    normalized === 'ShadowPositionLedger' ||
    normalized === 'ShadowTradeRepo' ||
    normalized === 'VirtualAccount' ||
    normalized === 'KISLiveHolding' ||
    normalized === 'PaperTradeLedger'
  ) {
    return normalized;
  }
  return 'ShadowTradeRepo';
}

function accountKindForSourceTag(sourceTag: NormalizedPosition['sourceTag']): AccountKind {
  if (sourceTag === 'LIVE') return 'KIS_LIVE';
  if (sourceTag === 'PAPER') return 'PAPER_LEDGER';
  return 'VIRTUAL_SHADOW';
}

function originForSource(source: PositionSourceName): PositionOrigin {
  if (source === 'KISLiveHolding') return 'KIS_HOLDING';
  if (source === 'PaperTradeLedger') return 'PAPER_TRADE_LEDGER';
  if (source === 'VirtualAccount') return 'VIRTUAL_ACCOUNT';
  if (source === 'ShadowTradeRepo') return 'SHADOW_TRADE_REPO';
  return 'SHADOW_POSITION_LEDGER';
}

function countAggregateSourcePositions(
  sourceAggregate: PositionSourceAggregate,
  source: PositionSourceName,
): number {
  const result = sourceAggregate.results.find((item) => item.source === source);
  return result?.kind === 'SUCCESS' ? result.positions.length : 0;
}

function isAggregateSourceSkipped(
  sourceAggregate: PositionSourceAggregate,
  source: PositionSourceName,
): boolean {
  const result = sourceAggregate.results.find((item) => item.source === source);
  return result?.kind === 'EMPTY' &&
    (result.diagnostics as { skipped?: unknown } | undefined)?.skipped !== undefined;
}

function buildDisplayContext(
  mode: PositionModeSnapshot,
  trade?: ServerShadowTrade,
): { engineMode: PositionEngineMode; effectiveRegime: string } {
  const rawEngineMode = String(mode.marketState?.executionMode ?? mode.modeLabel ?? '').toUpperCase();
  let engineMode: PositionEngineMode = 'NORMAL';
  if (rawEngineMode.includes('SELL_ONLY')) engineMode = 'SELL_ONLY';
  else if (rawEngineMode.includes('SHADOW_ONLY')) engineMode = 'SHADOW_ONLY';
  else if (rawEngineMode.includes('OBSERVE_ONLY')) engineMode = 'OBSERVE_ONLY';
  else if (rawEngineMode.includes('DEGRADED')) engineMode = 'DEGRADED';
  else if (!mode.liveTradingEnabled && mode.shadowLearningEnabled) engineMode = 'SHADOW_ONLY';

  const effectiveRegime =
    trade?.r6Counterfactual?.regime ??
    trade?.entryRegime ??
    mode.marketState?.effectiveRegime ??
    mode.modeLabel ??
    engineMode;

  return { engineMode, effectiveRegime };
}

function resolveEntrySource(trade: ServerShadowTrade, source: PositionSourceName): string {
  return trade.entryType ??
    trade.entryReason ??
    trade.riskUnit ??
    trade.watchlistSource ??
    source;
}

function normalizePriceSource(source: PositionLookupPriceSource | undefined): NormalizedPositionPriceSource {
  if (source === 'REALTIME_WS' || source === 'KIS_REST') return 'KIS';
  if (source === 'VIRTUAL_ACCOUNT') return 'CACHE';
  if (source === 'ENTRY_PRICE_FALLBACK') return 'MISSING';
  return 'MISSING';
}

async function resolvePriceLookup(
  trades: ServerShadowTrade[],
  logScope: 'POSITION' | 'PNL',
): Promise<PriceLookupSnapshot> {
  const codes = Array.from(new Set(
    trades
      .map((trade) => normalizeStockCode(trade.stockCode))
      .filter((code): code is string => code.length > 0),
  ));
  const prices: Record<string, number> = {};
  const sourceByCode = new Map<string, PositionLookupPriceSource>();
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

function normalizeStockCode(code: unknown): string {
  const raw = String(code ?? '').trim();
  return raw.length > 0 ? raw.padStart(6, '0') : '';
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
