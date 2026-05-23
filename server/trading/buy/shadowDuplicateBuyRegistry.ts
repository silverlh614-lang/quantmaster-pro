// @responsibility P0 Shadow BUY duplicate registry. Blocks same symbol/strategy/day before Telegram or paper fill.

import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

export type ShadowBuyRegistrySide = 'BUY';
export type ShadowBuyRegistryMode = 'SHADOW';
export type ShadowBuyLifecycleStatus =
  | 'SIGNAL_APPROVED'
  | 'ORDER_PENDING'
  | 'PAPER_FILLED'
  | 'OPEN'
  | 'EXIT_PENDING'
  | 'CLOSED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SETTLED';

export interface ShadowBuyLifecycleRegistration {
  key: string;
  symbol: string;
  strategy: string;
  tradeDate: string;
  side: ShadowBuyRegistrySide;
  mode: ShadowBuyRegistryMode;
  tradeId: string;
  lifecycleStatus: ShadowBuyLifecycleStatus;
  registeredAt: string;
}

export interface ShadowDuplicateBuyBlocked {
  ok: false;
  reason: 'SHADOW_DUPLICATE_BUY_BLOCKED';
  key: string;
  existingTradeId: string;
  existingStatus: ShadowBuyLifecycleStatus;
  existingRawStatus?: string;
  logTags: string[];
}

export interface ShadowDuplicateBuyRegistered {
  ok: true;
  registration: ShadowBuyLifecycleRegistration;
  logTags: string[];
}

export type ShadowDuplicateBuyRegistryResult =
  | ShadowDuplicateBuyBlocked
  | ShadowDuplicateBuyRegistered;

const ACTIVE_STATUSES: ReadonlySet<ShadowBuyLifecycleStatus> = new Set([
  'SIGNAL_APPROVED',
  'ORDER_PENDING',
  'PAPER_FILLED',
  'OPEN',
  'EXIT_PENDING',
]);

const registry = new Map<string, ShadowBuyLifecycleRegistration>();

function kstTradeDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().padStart(6, '0');
}

function normalizeStrategy(strategy: string | undefined): string {
  return String(strategy ?? 'DEFAULT').trim().toUpperCase() || 'DEFAULT';
}

function tradeDateFromTrade(trade: ServerShadowTrade, now: Date): string {
  const signalMs = Date.parse(trade.signalTime);
  if (Number.isFinite(signalMs)) return kstTradeDate(new Date(signalMs));
  return kstTradeDate(now);
}

export function mapShadowTradeToBuyLifecycleStatus(
  status: ServerShadowTrade['status'],
): ShadowBuyLifecycleStatus {
  if (status === 'PENDING') return 'SIGNAL_APPROVED';
  if (status === 'ORDER_SUBMITTED') return 'ORDER_PENDING';
  if (status === 'PARTIALLY_FILLED') return 'PAPER_FILLED';
  if (status === 'ACTIVE') return 'OPEN';
  if (status === 'EUPHORIA_PARTIAL') return 'EXIT_PENDING';
  if (status === 'HIT_TARGET' || status === 'HIT_STOP') return 'CLOSED';
  return 'REJECTED';
}

export function isActiveShadowBuyLifecycleStatus(status: ShadowBuyLifecycleStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function buildShadowBuyLifecycleKey(input: {
  symbol: string;
  strategy?: string;
  tradeDate: string;
  side?: ShadowBuyRegistrySide;
  mode?: ShadowBuyRegistryMode;
}): string {
  return [
    'SHADOW_BUY',
    input.tradeDate,
    input.mode ?? 'SHADOW',
    input.side ?? 'BUY',
    normalizeSymbol(input.symbol),
    normalizeStrategy(input.strategy),
  ].join(':');
}

function strategyForTrade(trade: ServerShadowTrade, fallback?: string): string {
  return normalizeStrategy(trade.profileType ?? trade.watchlistSource ?? fallback);
}

function activeTradeForKey(input: {
  key: string;
  trade: ServerShadowTrade;
  allTrades: ServerShadowTrade[];
  strategy: string;
  tradeDate: string;
}): { trade: ServerShadowTrade; lifecycleStatus: ShadowBuyLifecycleStatus } | null {
  for (const candidate of input.allTrades) {
    if (candidate.id === input.trade.id) continue;
    if (candidate.mode !== 'SHADOW') continue;
    const candidateDate = tradeDateFromTrade(candidate, new Date(`${input.tradeDate}T00:00:00.000Z`));
    const candidateKey = buildShadowBuyLifecycleKey({
      symbol: candidate.stockCode,
      strategy: strategyForTrade(candidate, input.strategy),
      tradeDate: candidateDate,
    });
    if (candidateKey !== input.key) continue;
    const lifecycleStatus = mapShadowTradeToBuyLifecycleStatus(candidate.status);
    if (isActiveShadowBuyLifecycleStatus(lifecycleStatus)) return { trade: candidate, lifecycleStatus };
  }
  return null;
}

export function registerShadowBuyLifecycle(input: {
  trade: ServerShadowTrade;
  allTrades: ServerShadowTrade[];
  strategy?: string;
  now?: Date;
}): ShadowDuplicateBuyRegistryResult {
  const now = input.now ?? new Date();
  const tradeDate = tradeDateFromTrade(input.trade, now);
  const strategy = strategyForTrade(input.trade, input.strategy);
  const key = buildShadowBuyLifecycleKey({
    symbol: input.trade.stockCode,
    strategy,
    tradeDate,
  });
  const existingMemory = registry.get(key);
  if (existingMemory && existingMemory.tradeId !== input.trade.id && isActiveShadowBuyLifecycleStatus(existingMemory.lifecycleStatus)) {
    const persistedExisting = input.allTrades.find((trade) => trade.id === existingMemory.tradeId);
    if (!persistedExisting || isActiveShadowBuyLifecycleStatus(mapShadowTradeToBuyLifecycleStatus(persistedExisting.status))) {
      return {
        ok: false,
        reason: 'SHADOW_DUPLICATE_BUY_BLOCKED',
        key,
        existingTradeId: existingMemory.tradeId,
        existingStatus: existingMemory.lifecycleStatus,
        logTags: ['[SHADOW_DUPLICATE_BUY_BLOCKED]', '[TELEGRAM_DUPLICATE_SUPPRESSED]'],
      };
    }
    registry.delete(key);
  }

  const existingTrade = activeTradeForKey({
    key,
    trade: input.trade,
    allTrades: input.allTrades,
    strategy,
    tradeDate,
  });
  if (existingTrade) {
    const logTags = ['[SHADOW_DUPLICATE_BUY_BLOCKED]', '[TELEGRAM_DUPLICATE_SUPPRESSED]'];
    if (existingTrade.lifecycleStatus === 'OPEN' || existingTrade.lifecycleStatus === 'EXIT_PENDING') {
      logTags.push('[SHADOW_POSITION_ALREADY_OPEN]');
    }
    return {
      ok: false,
      reason: 'SHADOW_DUPLICATE_BUY_BLOCKED',
      key,
      existingTradeId: existingTrade.trade.id,
      existingStatus: existingTrade.lifecycleStatus,
      existingRawStatus: existingTrade.trade.status,
      logTags,
    };
  }

  const registration: ShadowBuyLifecycleRegistration = {
    key,
    symbol: normalizeSymbol(input.trade.stockCode),
    strategy,
    tradeDate,
    side: 'BUY',
    mode: 'SHADOW',
    tradeId: input.trade.id,
    lifecycleStatus: 'SIGNAL_APPROVED',
    registeredAt: now.toISOString(),
  };
  registry.set(key, registration);
  const extension = input.trade as ServerShadowTrade & {
    shadowBuyLifecycleKey?: string;
    shadowBuyLifecycleStatus?: ShadowBuyLifecycleStatus;
    shadowBuyLifecycleRegisteredAt?: string;
  };
  extension.shadowBuyLifecycleKey = registration.key;
  extension.shadowBuyLifecycleStatus = registration.lifecycleStatus;
  extension.shadowBuyLifecycleRegisteredAt = registration.registeredAt;
  return {
    ok: true,
    registration,
    logTags: ['[SHADOW_SIGNAL_LIFECYCLE_REGISTERED]'],
  };
}

export function updateShadowBuyLifecycleStatus(input: {
  key?: string;
  tradeId: string;
  status: ShadowBuyLifecycleStatus;
  now?: Date;
}): void {
  if (!input.key) return;
  const existing = registry.get(input.key);
  if (!existing || existing.tradeId !== input.tradeId) return;
  registry.set(input.key, {
    ...existing,
    lifecycleStatus: input.status,
    registeredAt: input.now?.toISOString() ?? existing.registeredAt,
  });
}

export function __resetShadowDuplicateBuyRegistryForTests(): void {
  registry.clear();
}
