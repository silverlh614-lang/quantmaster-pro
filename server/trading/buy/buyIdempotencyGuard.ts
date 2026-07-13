/**
 * @responsibility 매수 식별자 기반 dedup 키로 중복 매수 예약을 차단하는 멱등성 가드를 제공한다.
 */

import type { BuyApprovalMode } from './buyApprovalPolicy.js';

type BuySide = 'BUY' | 'SELL';
export type BuyIdempotencyStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'REJECTED';

export interface BuyDedupIdentity {
  mode: BuyApprovalMode;
  symbol: string;
  strategy: string;
  session: string;
  side: BuySide;
}

export interface BuyIdempotencyRecord {
  key: string;
  identity: BuyDedupIdentity;
  status: BuyIdempotencyStatus;
  tradeId?: string;
  signalId?: string;
  reservedAt: string;
  updatedAt: string;
}

export interface BuyIdempotencyReserveInput extends BuyDedupIdentity {
  tradeId?: string;
  signalId?: string;
  now?: Date;
}

export interface BuyIdempotencyReserveResult {
  allowed: boolean;
  key: string;
  record: BuyIdempotencyRecord;
  existing?: BuyIdempotencyRecord;
}

const ACTIVE_STATUSES: ReadonlySet<BuyIdempotencyStatus> = new Set(['PENDING', 'OPEN']);

function normalizePart(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'UNKNOWN';
}

export function buildBuyDedupKey(identity: BuyDedupIdentity): string {
  return [
    'buy',
    identity.mode,
    normalizePart(identity.symbol),
    normalizePart(identity.strategy),
    normalizePart(identity.session),
    normalizePart(identity.side),
  ].join(':');
}

function isBuyIdempotencyStatusActive(status: BuyIdempotencyStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export class BuyIdempotencyGuard {
  private readonly records = new Map<string, BuyIdempotencyRecord>();

  reserve(input: BuyIdempotencyReserveInput): BuyIdempotencyReserveResult {
    const key = buildBuyDedupKey(input);
    const existing = this.records.get(key);
    if (existing && isBuyIdempotencyStatusActive(existing.status)) {
      return {
        allowed: false,
        key,
        record: existing,
        existing,
      };
    }

    const nowIso = (input.now ?? new Date()).toISOString();
    const record: BuyIdempotencyRecord = {
      key,
      identity: {
        mode: input.mode,
        symbol: normalizePart(input.symbol),
        strategy: normalizePart(input.strategy),
        session: normalizePart(input.session),
        side: input.side,
      },
      status: 'PENDING',
      ...(input.tradeId ? { tradeId: input.tradeId } : {}),
      ...(input.signalId ? { signalId: input.signalId } : {}),
      reservedAt: nowIso,
      updatedAt: nowIso,
    };
    this.records.set(key, record);
    return { allowed: true, key, record };
  }

  markOpen(key: string, now = new Date()): BuyIdempotencyRecord | null {
    return this.updateStatus(key, 'OPEN', now);
  }

  release(key: string, status: Extract<BuyIdempotencyStatus, 'CLOSED' | 'REJECTED'>, now = new Date()): BuyIdempotencyRecord | null {
    return this.updateStatus(key, status, now);
  }

  get(key: string): BuyIdempotencyRecord | null {
    return this.records.get(key) ?? null;
  }

  clear(): void {
    this.records.clear();
  }

  snapshot(): BuyIdempotencyRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  private updateStatus(
    key: string,
    status: BuyIdempotencyStatus,
    now: Date,
  ): BuyIdempotencyRecord | null {
    const existing = this.records.get(key);
    if (!existing) return null;
    const updated: BuyIdempotencyRecord = {
      ...existing,
      status,
      updatedAt: now.toISOString(),
    };
    this.records.set(key, updated);
    return updated;
  }
}

export function createBuyIdempotencyGuard(): BuyIdempotencyGuard {
  return new BuyIdempotencyGuard();
}

export const buyIdempotencyGuard = createBuyIdempotencyGuard();

export function logBuyDuplicateBlocked(record: BuyIdempotencyRecord): void {
  const tag = record.identity.mode === 'SHADOW'
    ? '[SHADOW_DUPLICATE_BLOCKED]'
    : '[BUY_DUPLICATE_BLOCKED]';
  console.log(
    tag,
    JSON.stringify({
      dedupKey: record.key,
      symbol: record.identity.symbol,
      strategy: record.identity.strategy,
      session: record.identity.session,
      side: record.identity.side,
      status: record.status,
      tradeId: record.tradeId,
      signalId: record.signalId,
    }),
  );
}
