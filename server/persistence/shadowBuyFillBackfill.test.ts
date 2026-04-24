/**
 * shadowBuyFillBackfill.test.ts — PR-7 #13 SHADOW BUY fill 백필 계약.
 *
 * 다루는 케이스:
 *  - 정상 SHADOW 레거시 (BUY fill 없음, originalQuantity 있음) → 백필 1건
 *  - BUY fill 이미 있음 → 건드리지 않음 (멱등)
 *  - LIVE 모드는 건너뜀
 *  - REJECTED 는 건너뜀
 *  - 전체 시나리오: BUY 100 + SELL 50 후 getRemainingQty === 50
 */

import { describe, it, expect } from 'vitest';
import {
  backfillShadowBuyFills,
  appendFill,
  getRemainingQty,
  syncPositionCache,
  type ServerShadowTrade,
} from './shadowTradeRepo.js';

function makeShadowTrade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 't1',
    stockCode: '394280',
    stockName: '오픈엣지테크놀로지',
    signalTime: '2026-04-20T00:41:18.000Z',
    signalPrice: 1000,
    shadowEntryPrice: 1000,
    quantity: 100,
    originalQuantity: 100,
    stopLoss: 950,
    targetPrice: 1100,
    status: 'ACTIVE',
    mode: 'SHADOW',
    ...overrides,
  } as ServerShadowTrade;
}

describe('backfillShadowBuyFills — 레거시 SHADOW BUY fill 복원', () => {
  it('BUY fill 이 없는 SHADOW ACTIVE trade 는 백필됨', () => {
    const t = makeShadowTrade();
    expect(t.fills).toBeUndefined();
    const n = backfillShadowBuyFills([t]);
    expect(n).toBe(1);
    expect(t.fills).toHaveLength(1);
    expect(t.fills?.[0]?.type).toBe('BUY');
    expect(t.fills?.[0]?.qty).toBe(100);
    expect(t.fills?.[0]?.price).toBe(1000);
    expect(t.fills?.[0]?.status).toBe('CONFIRMED');
  });

  it('이미 BUY fill 있는 trade 는 건드리지 않음 (멱등)', () => {
    const t = makeShadowTrade({
      fills: [{
        id: 'existing',
        type: 'BUY',
        subType: 'INITIAL_BUY',
        qty: 100,
        price: 1000,
        reason: '기존',
        timestamp: '2026-04-20T00:41:18.000Z',
        status: 'CONFIRMED',
      }],
    });
    const beforeLen = t.fills!.length;
    const n = backfillShadowBuyFills([t]);
    expect(n).toBe(0);
    expect(t.fills).toHaveLength(beforeLen);
  });

  it('LIVE 모드 trade 는 건너뜀', () => {
    const t = makeShadowTrade({ mode: 'LIVE' });
    const n = backfillShadowBuyFills([t]);
    expect(n).toBe(0);
    expect(t.fills).toBeUndefined();
  });

  it('REJECTED 상태는 건너뜀 (체결 자체가 없었던 주문)', () => {
    const t = makeShadowTrade({ status: 'REJECTED' });
    const n = backfillShadowBuyFills([t]);
    expect(n).toBe(0);
  });

  it('originalQuantity 없고 quantity>0 이면 quantity 기준 백필', () => {
    const t = makeShadowTrade({ originalQuantity: undefined, quantity: 80 });
    const n = backfillShadowBuyFills([t]);
    expect(n).toBe(1);
    expect(t.fills?.[0]?.qty).toBe(80);
    expect(t.originalQuantity).toBe(80); // 백필 시 stabilize
  });

  it('quantity 도 originalQuantity 도 모두 0 이면 백필 안 함', () => {
    const t = makeShadowTrade({ quantity: 0, originalQuantity: 0 });
    const n = backfillShadowBuyFills([t]);
    expect(n).toBe(0);
  });

  it('두 번 호출해도 중복 없음 (멱등)', () => {
    const t = makeShadowTrade();
    backfillShadowBuyFills([t]);
    const n2 = backfillShadowBuyFills([t]);
    expect(n2).toBe(0);
    expect(t.fills).toHaveLength(1);
  });
});

describe('사용자 시나리오 — SHADOW BUY 1000×100, SELL 1050×50', () => {
  it('백필 후 SELL 50 기록하면 getRemainingQty === 50', () => {
    const t = makeShadowTrade({ quantity: 100, shadowEntryPrice: 1000 });

    // 1) 백필 — 레거시 trade 가 BUY fill 을 획득
    backfillShadowBuyFills([t]);
    expect(getRemainingQty(t)).toBe(100);

    // 2) SELL 50 @ 1050 추가 (L3 분할 익절 같은 경로 시뮬)
    appendFill(t, {
      type: 'SELL',
      subType: 'PARTIAL_TP',
      qty: 50,
      price: 1050,
      pnl: (1050 - 1000) * 50,
      pnlPct: 5,
      reason: '분할익절 50%',
      timestamp: new Date().toISOString(),
      status: 'CONFIRMED',
    });
    syncPositionCache(t);

    // 3) 잔량 50 — SSOT 기반 계산이 실제로 작동
    expect(getRemainingQty(t)).toBe(50);
    expect(t.quantity).toBe(50);   // 캐시도 싱크
    expect(t.originalQuantity).toBe(100); // 최초 진입 보존
  });

  it('백필 없이 SELL 추가하면 잔량이 과거 quantity 로 고정 (버그 재현)', () => {
    // 백필 안 하고 바로 SELL 만 추가 — 레거시 버그 재현용 대조군
    const t = makeShadowTrade({ quantity: 100, shadowEntryPrice: 1000 });
    appendFill(t, {
      type: 'SELL', subType: 'PARTIAL_TP', qty: 50, price: 1050,
      pnl: 2500, pnlPct: 5, reason: '분할익절', timestamp: new Date().toISOString(),
      status: 'CONFIRMED',
    });
    // syncPositionCache no-op (buyQty=0) → trade.quantity 변화 없음
    const changed = syncPositionCache(t);
    expect(changed).toBe(false);
    // getRemainingQty fallback → trade.quantity === 100 (잘못된 잔량)
    expect(getRemainingQty(t)).toBe(100);
  });
});
