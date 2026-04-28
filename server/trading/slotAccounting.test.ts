import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSlotConsumption } from './slotAccounting.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

// fills SSOT 우회 — getRemainingQty 가 fills 우선이므로 명시적으로 fills 채움
function makeShadow(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  const quantity = overrides.quantity ?? 100;
  const originalQuantity = overrides.originalQuantity ?? quantity;
  return {
    id: 't1',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: '2026-04-28T00:00:00Z',
    signalPrice: 50000,
    shadowEntryPrice: 50000,
    quantity,
    stopLoss: 47000,
    targetPrice: 55000,
    status: 'ACTIVE',
    originalQuantity,
    // watchlistSource: undefined → swing-eligible (INTRADAY/PRE_BREAKOUT 만 회계 제외)
    fills: [
      {
        id: 'f1',
        type: 'BUY',
        qty: originalQuantity,
        price: 50000,
        timestamp: '2026-04-28T00:00:00Z',
        status: 'CONFIRMED',
      },
    ],
    ...overrides,
  } as ServerShadowTrade;
}

// 부분 매도 fills 추가 헬퍼
function withSellFill(shadow: ServerShadowTrade, sellQty: number): ServerShadowTrade {
  return {
    ...shadow,
    fills: [
      ...(shadow.fills ?? []),
      {
        id: `f-sell-${sellQty}`,
        type: 'SELL',
        qty: sellQty,
        price: 52000,
        timestamp: '2026-04-28T01:00:00Z',
        status: 'CONFIRMED',
      },
    ],
  } as ServerShadowTrade;
}

describe('computeSlotConsumption — ADR-0080 자본 가중 슬롯 회계', () => {
  const originalDisabled = process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;

  beforeEach(() => {
    delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;
  });

  afterEach(() => {
    if (originalDisabled === undefined) {
      delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;
    } else {
      process.env.SLOT_CAPITAL_WEIGHTED_DISABLED = originalDisabled;
    }
    vi.restoreAllMocks();
  });

  it('빈 배열: consumed=0, rawCount=0, available=max, isFull=false', () => {
    const result = computeSlotConsumption([], 8);
    expect(result.consumed).toBe(0);
    expect(result.rawCount).toBe(0);
    expect(result.available).toBe(8);
    expect(result.isFull).toBe(false);
    expect(result.detail).toEqual([]);
  });

  it('만재 포지션 1개 (잔존 100%): consumed=1.0, rawCount=1', () => {
    const result = computeSlotConsumption([makeShadow()], 8);
    expect(result.consumed).toBe(1);
    expect(result.rawCount).toBe(1);
    expect(result.available).toBe(7);
    expect(result.isFull).toBe(false);
    expect(result.detail[0].consumed).toBe(1);
  });

  it('70% 익절 후 30% 잔존 1개: consumed=0.3, rawCount=1', () => {
    const trade = withSellFill(makeShadow({ originalQuantity: 100 }), 70);
    const result = computeSlotConsumption([trade], 8);
    expect(result.consumed).toBeCloseTo(0.3, 5);
    expect(result.rawCount).toBe(1);
    expect(result.available).toBeCloseTo(7.7, 5);
    expect(result.isFull).toBe(false);
  });

  it('30% 잔존 5개 = 1.5 슬롯 점유 (자본 가중 효과 검증)', () => {
    // ADR-0080 핵심 시나리오 — 30% 잔존 5개가 기존 5 카운트 → 1.5 슬롯 점유로 환산
    const trades = Array.from({ length: 5 }, (_, i) =>
      withSellFill(makeShadow({
        id: `t${i}`,
        stockCode: `code${i}`,
        originalQuantity: 100,
      }), 70)
    );
    const result = computeSlotConsumption(trades, 8);
    expect(result.consumed).toBeCloseTo(1.5, 5);
    expect(result.rawCount).toBe(5);
    expect(result.available).toBeCloseTo(6.5, 5);
    expect(result.isFull).toBe(false);
  });

  it('만재 포지션 8개 = consumed 8 → isFull=true', () => {
    const trades = Array.from({ length: 8 }, (_, i) =>
      makeShadow({ id: `t${i}`, stockCode: `code${i}` })
    );
    const result = computeSlotConsumption(trades, 8);
    expect(result.consumed).toBe(8);
    expect(result.rawCount).toBe(8);
    expect(result.isFull).toBe(true);
    expect(result.available).toBe(0);
  });

  it('isFull 경계값: consumed === effectiveMaxPositions → true', () => {
    const trades = Array.from({ length: 4 }, (_, i) =>
      makeShadow({ id: `t${i}`, stockCode: `code${i}` })
    );
    const result = computeSlotConsumption(trades, 4);
    expect(result.consumed).toBe(4);
    expect(result.isFull).toBe(true);
  });

  it('originalQuantity 부재 (레거시): 1.0 보수적 점유 fallback', () => {
    const trade = makeShadow({ originalQuantity: undefined, quantity: 50 });
    const result = computeSlotConsumption([trade], 8);
    // originalQuantity 부재 시 quantity 50 사용 → 50/50 = 1.0
    expect(result.consumed).toBe(1);
  });

  it('originalQuantity 0 + quantity 0 (완전 레거시): 1.0 보수적', () => {
    const trade = makeShadow({ originalQuantity: 0, quantity: 0, fills: [] });
    const result = computeSlotConsumption([trade], 8);
    expect(result.consumed).toBe(1);
  });

  it('INTRADAY watchlistSource 제외 (기존 정책 보존)', () => {
    const intraday = makeShadow({ id: 't-intra', watchlistSource: 'INTRADAY' });
    const swing = makeShadow({ id: 't-swing' }); // watchlistSource undefined → swing-eligible
    const result = computeSlotConsumption([intraday, swing], 8);
    expect(result.rawCount).toBe(1);
    expect(result.consumed).toBe(1);
    expect(result.detail).toHaveLength(1);
    expect(result.detail[0].stockCode).toBe('005930');
  });

  it('PRE_BREAKOUT watchlistSource 제외 (기존 정책 보존)', () => {
    const preBreakout = makeShadow({ id: 't-pb', watchlistSource: 'PRE_BREAKOUT' });
    const swing = makeShadow({ id: 't-sw' });
    const result = computeSlotConsumption([preBreakout, swing], 8);
    expect(result.rawCount).toBe(1);
    expect(result.consumed).toBe(1);
  });

  it('closed status 포지션 제외 (HIT_TARGET / HIT_STOP / REJECTED)', () => {
    const open = makeShadow({ id: 't-open', status: 'ACTIVE' });
    const closed1 = makeShadow({ id: 't-c1', status: 'HIT_TARGET' });
    const closed2 = makeShadow({ id: 't-c2', status: 'HIT_STOP' });
    const closed3 = makeShadow({ id: 't-c3', status: 'REJECTED' });
    const result = computeSlotConsumption([open, closed1, closed2, closed3], 8);
    expect(result.rawCount).toBe(1);
    expect(result.consumed).toBe(1);
  });

  it('PENDING 상태도 회계 포함 (기존 isOpenShadowStatus 정책)', () => {
    const pending = makeShadow({ id: 't-pend', status: 'PENDING', fills: [] });
    const result = computeSlotConsumption([pending], 8);
    expect(result.rawCount).toBe(1);
    // fills 없음 → quantity 100 사용 → 100/100 = 1.0
    expect(result.consumed).toBe(1);
  });

  it('혼재 시나리오: 만재 2개 + 50% 잔존 2개 + 25% 잔존 1개 = 3.25 슬롯', () => {
    const trades = [
      makeShadow({ id: 't1', stockCode: 'a' }),
      makeShadow({ id: 't2', stockCode: 'b' }),
      withSellFill(makeShadow({ id: 't3', stockCode: 'c', originalQuantity: 100 }), 50),
      withSellFill(makeShadow({ id: 't4', stockCode: 'd', originalQuantity: 100 }), 50),
      withSellFill(makeShadow({ id: 't5', stockCode: 'e', originalQuantity: 100 }), 75),
    ];
    const result = computeSlotConsumption(trades, 8);
    // 1.0 + 1.0 + 0.5 + 0.5 + 0.25 = 3.25
    expect(result.consumed).toBeCloseTo(3.25, 5);
    expect(result.rawCount).toBe(5);
    expect(result.available).toBeCloseTo(4.75, 5);
    expect(result.isFull).toBe(false);
  });

  it('detail 배열에 종목별 분해 정확 (디버깅 용)', () => {
    const trade = withSellFill(makeShadow({
      stockCode: '000660',
      stockName: 'SK하이닉스',
      originalQuantity: 200,
    }), 60);
    const result = computeSlotConsumption([trade], 8);
    expect(result.detail).toHaveLength(1);
    expect(result.detail[0]).toMatchObject({
      stockCode: '000660',
      stockName: 'SK하이닉스',
      originalQty: 200,
      remainingQty: 140,
      consumed: 0.7,
    });
  });

  it('SLOT_CAPITAL_WEIGHTED_DISABLED=true env: 30% 잔존도 1.0 강제 (롤백)', () => {
    process.env.SLOT_CAPITAL_WEIGHTED_DISABLED = 'true';
    const trade = withSellFill(makeShadow({ originalQuantity: 100 }), 70);
    const result = computeSlotConsumption([trade], 8);
    // ENV 롤백 — 단순 카운트 동치
    expect(result.consumed).toBe(1);
    expect(result.rawCount).toBe(1);
  });

  it('SLOT_CAPITAL_WEIGHTED_DISABLED=true env: 30% 잔존 5개 = 5 슬롯 (회귀)', () => {
    process.env.SLOT_CAPITAL_WEIGHTED_DISABLED = 'true';
    const trades = Array.from({ length: 5 }, (_, i) =>
      withSellFill(makeShadow({ id: `t${i}`, stockCode: `code${i}`, originalQuantity: 100 }), 70)
    );
    const result = computeSlotConsumption(trades, 8);
    expect(result.consumed).toBe(5); // ENV 롤백 — 5개 모두 1.0
    expect(result.rawCount).toBe(5);
  });

  it('NaN ratio 안전 fallback → 1.0 보수적', () => {
    // originalQuantity 0 + fills 부재 + quantity 양수 → ratio NaN 회피
    const trade = makeShadow({ originalQuantity: 0, quantity: 100, fills: [] });
    const result = computeSlotConsumption([trade], 8);
    // originalQuantity 0 → quantity 100 fallback → 1.0
    expect(result.consumed).toBe(1);
    expect(Number.isFinite(result.consumed)).toBe(true);
  });

  it('available floor 0 — consumed > effectiveMaxPositions 시 음수 방지', () => {
    const trades = Array.from({ length: 10 }, (_, i) =>
      makeShadow({ id: `t${i}`, stockCode: `code${i}` })
    );
    const result = computeSlotConsumption(trades, 8);
    expect(result.consumed).toBe(10);
    expect(result.available).toBe(0); // floor 0
    expect(result.isFull).toBe(true);
  });

  it('PR-S1 사용자 시나리오: 만재 4개 + 30% 잔존 4개 = 5.20/8 (isFull=false)', () => {
    // 사용자 보고: "만재 4개 + 30% 잔존 4개, effectiveMaxPositions=8" 시나리오에서
    // 상위 게이트는 통과시키지만 루프 게이트가 단순 카운트(8) 로 break 차단하던 회귀를
    // 자본 가중 슬롯 회계가 차단하는지 검증. ADR-0080 PR-S1 wiring 회귀 가드.
    const fullTrades = Array.from({ length: 4 }, (_, i) =>
      makeShadow({ id: `full-${i}`, stockCode: `f${i}` })
    );
    const partialTrades = Array.from({ length: 4 }, (_, i) =>
      withSellFill(makeShadow({ id: `p-${i}`, stockCode: `p${i}`, originalQuantity: 100 }), 70)
    );
    const result = computeSlotConsumption([...fullTrades, ...partialTrades], 8);
    // 만재 4 × 1.0 + 잔존 4 × 0.3 = 5.20
    expect(result.consumed).toBeCloseTo(5.2, 5);
    expect(result.rawCount).toBe(8); // 단순 카운트는 만재 (PR-S1 이전 break 차단 원인)
    expect(result.isFull).toBe(false); // 자본 가중은 통과 — PR-S1 효과
    expect(result.available).toBeCloseTo(2.8, 5);
  });

  it('자본 가중 동작 검증: 같은 5개라도 잔존비 다르면 점유 다름', () => {
    const fullTrades = Array.from({ length: 5 }, (_, i) =>
      makeShadow({ id: `t${i}`, stockCode: `code${i}` })
    );
    const partialTrades = Array.from({ length: 5 }, (_, i) =>
      withSellFill(makeShadow({ id: `t${i}`, stockCode: `code${i}`, originalQuantity: 100 }), 70)
    );
    const fullResult = computeSlotConsumption(fullTrades, 8);
    const partialResult = computeSlotConsumption(partialTrades, 8);
    expect(fullResult.consumed).toBe(5);
    expect(partialResult.consumed).toBeCloseTo(1.5, 5);
    // 같은 rawCount 지만 자본 가중 점유는 다름 (ADR-0080 핵심)
    expect(fullResult.rawCount).toBe(partialResult.rawCount);
  });
});
