// @responsibility Shadow auction idempotency key handling.
export interface DedupeStore {
  exists(key: string): Promise<boolean>;
  set(key: string, value: true, opts: { ttlSeconds: number }): Promise<void>;
  delete?(key: string): Promise<void>;
}

interface MemoryEntry { expiresAt: number }

export class MemoryDedupeStore implements DedupeStore {
  private readonly store = new Map<string, MemoryEntry>();

  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async set(key: string, _value: true, opts: { ttlSeconds: number }): Promise<void> {
    this.store.set(key, { expiresAt: Date.now() + opts.ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const shadowAuctionDedupeStore = new MemoryDedupeStore();

export function formatGateSnap(gateSnap: number | string | null | undefined): string {
  const n = Number(gateSnap);
  return Number.isFinite(n) ? n.toFixed(2) : 'n/a';
}

export function formatGapPct(gapPct: number | string | null | undefined): string {
  const n = Number(gapPct);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : 'n/a';
}

export function buildShadowAuctionTelegramFingerprint(input: {
  channelId: string;
  tradeDate: string;
  auctionSession: string;
  stockCode: string;
  plannedPrice: number;
  plannedQty: number;
  gateSnap: number | string | null | undefined;
  gapPct: number | string | null | undefined;
  accountMode: string;
}): string {
  return [
    'TELEGRAM',
    input.channelId,
    'SHADOW_AUCTION_RESERVED',
    input.tradeDate,
    input.auctionSession,
    input.stockCode.padStart(6, '0'),
    input.plannedPrice,
    input.plannedQty,
    formatGateSnap(input.gateSnap),
    formatGapPct(input.gapPct),
    input.accountMode,
  ].join(':');
}

export function buildShadowAuctionOrderKey(input: {
  tradeDate: string;
  auctionSession: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  plannedPrice: number;
  plannedQty: number;
  accountMode: string;
}): string {
  return [
    'SHADOW_AUCTION',
    input.tradeDate,
    input.auctionSession,
    input.stockCode.padStart(6, '0'),
    input.side,
    input.plannedPrice,
    input.plannedQty,
    input.accountMode,
  ].join(':');
}

export async function acquireShadowAuctionLock(input: {
  store?: DedupeStore;
  tradeDate: string;
  auctionSession: string;
  ttlSeconds?: number;
  logger?: Pick<Console, 'warn'>;
}): Promise<{ acquired: boolean; lockKey: string; release: () => Promise<void> }> {
  const store = input.store ?? shadowAuctionDedupeStore;
  const lockKey = `LOCK:SHADOW_AUCTION:${input.tradeDate}:${input.auctionSession}`;
  if (await store.exists(lockKey)) {
    input.logger?.warn('[ShadowAuction] skipped because lock already acquired', { lockKey, executionImpact: 'NONE' });
    return { acquired: false, lockKey, release: async () => undefined };
  }
  await store.set(lockKey, true, { ttlSeconds: Math.max(90, input.ttlSeconds ?? 90) });
  return {
    acquired: true,
    lockKey,
    release: async () => { await store.delete?.(lockKey); },
  };
}

export async function sendShadowAuctionTelegramOnce(input: {
  sendMessage: () => Promise<unknown>;
  store?: DedupeStore;
  fingerprint: string;
  stockCode: string;
  logger?: Pick<Console, 'warn'>;
  ttlSeconds?: number;
}): Promise<{ sent: boolean; reason?: 'DUPLICATE_SHADOW_AUCTION_MESSAGE' }> {
  const store = input.store ?? shadowAuctionDedupeStore;
  if (await store.exists(input.fingerprint)) {
    input.logger?.warn('[TelegramDedupe] duplicate shadow auction message skipped', {
      stockCode: input.stockCode,
      fingerprint: input.fingerprint,
      executionImpact: 'NONE',
    });
    return { sent: false, reason: 'DUPLICATE_SHADOW_AUCTION_MESSAGE' };
  }
  await store.set(input.fingerprint, true, { ttlSeconds: input.ttlSeconds ?? 21_600 });
  await input.sendMessage();
  return { sent: true };
}

export async function saveShadowAuctionOrderOnce<T>(input: {
  store?: DedupeStore;
  orderKey: string;
  createOrder: () => Promise<T> | T;
  existingOrder?: () => Promise<T | null> | T | null;
  ttlSeconds?: number;
  logger?: Pick<Console, 'warn'>;
}): Promise<{ saved: boolean; order: T | null; reason?: 'DUPLICATE_SHADOW_AUCTION_ORDER' }> {
  const store = input.store ?? shadowAuctionDedupeStore;
  if (await store.exists(input.orderKey)) {
    input.logger?.warn('[ShadowAuction] duplicate order skipped', { orderKey: input.orderKey, executionImpact: 'NONE' });
    const existing = input.existingOrder ? await input.existingOrder() : null;
    return { saved: false, order: existing, reason: 'DUPLICATE_SHADOW_AUCTION_ORDER' };
  }
  await store.set(input.orderKey, true, { ttlSeconds: input.ttlSeconds ?? 21_600 });
  return { saved: true, order: await input.createOrder() };
}
