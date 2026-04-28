// @responsibility slotSizing 회귀 테스트 — default + ENABLED 분기 + ENV 토글.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateSlotSizing,
  isCapitalWeightedSizingEnabled,
} from './slotSizing.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

function makeShadow(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: `s_${Math.random().toString(36).slice(2)}`,
    stockCode: '005930',
    stockName: '삼성전자',
    signalDate: '2026-04-15',
    signalTime: '2026-04-15T01:00:00Z',
    signalType: 'BUY',
    quantity: 10,
    originalQuantity: 10,
    shadowEntryPrice: 70000,
    targetPrice: 80000,
    stopLoss: 65000,
    fills: [],
    status: 'ACTIVE',
    accountSource: 'SHADOW',
    cooldownTouches: 0,
    ...overrides,
  } as ServerShadowTrade;
}

describe('slotSizing — ENV 토글', () => {
  beforeEach(() => {
    delete process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED;
    delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;
  });
  afterEach(() => {
    delete process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED;
    delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;
  });

  it('isCapitalWeightedSizingEnabled — ENV 미설정 false', () => {
    expect(isCapitalWeightedSizingEnabled()).toBe(false);
  });

  it('isCapitalWeightedSizingEnabled — true 정확값 만', () => {
    process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED = 'true';
    expect(isCapitalWeightedSizingEnabled()).toBe(true);
    process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED = 'TRUE';
    expect(isCapitalWeightedSizingEnabled()).toBe(false);
    process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED = '1';
    expect(isCapitalWeightedSizingEnabled()).toBe(false);
  });
});

describe('slotSizing — Default (단순 카운트)', () => {
  beforeEach(() => {
    delete process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED;
    delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;
  });
  afterEach(() => {
    delete process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED;
    delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;
  });

  it('빈 shadows — denom = max', () => {
    const result = evaluateSlotSizing({
      effectiveMaxPositions: 8,
      reservedSlots: 0,
      shadows: [],
    });
    expect(result.source).toBe('SIMPLE');
    expect(result.effectiveDenominator).toBe(8);
    expect(result.rawCount).toBe(0);
  });

  it('5개 활성 + 30% 잔존 — Default 는 rawCount=5 사용', () => {
    const shadows = Array.from({ length: 5 }, () =>
      makeShadow({ originalQuantity: 10, quantity: 3 }),
    );
    const result = evaluateSlotSizing({
      effectiveMaxPositions: 8,
      reservedSlots: 0,
      shadows,
    });
    expect(result.source).toBe('SIMPLE');
    expect(result.rawCount).toBe(5);
    expect(result.effectiveDenominator).toBe(3); // 8 - 5 = 3
  });

  it('reservedSlots 차감', () => {
    const result = evaluateSlotSizing({
      effectiveMaxPositions: 8,
      reservedSlots: 2,
      shadows: [],
    });
    expect(result.effectiveDenominator).toBe(6);
  });

  it('분모 floor 1 — 만재 시 0 → 1', () => {
    const shadows = Array.from({ length: 8 }, () => makeShadow({ originalQuantity: 10, quantity: 10 }));
    const result = evaluateSlotSizing({
      effectiveMaxPositions: 8,
      reservedSlots: 0,
      shadows,
    });
    expect(result.effectiveDenominator).toBe(1); // floor
  });

  it('reservedSlots 음수 안전 → 0 처리', () => {
    const result = evaluateSlotSizing({
      effectiveMaxPositions: 8,
      reservedSlots: -3,
      shadows: [],
    });
    expect(result.effectiveDenominator).toBe(8); // -3 → 0
  });
});

describe('slotSizing — ENABLED (자본 가중)', () => {
  beforeEach(() => {
    process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED = 'true';
    delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;
  });
  afterEach(() => {
    delete process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED;
    delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;
  });

  it('5개 활성 + 30% 잔존 — ENABLED 는 consumed=1.5 사용', () => {
    const shadows = Array.from({ length: 5 }, () =>
      makeShadow({ originalQuantity: 10, quantity: 3 }),
    );
    const result = evaluateSlotSizing({
      effectiveMaxPositions: 8,
      reservedSlots: 0,
      shadows,
    });
    expect(result.source).toBe('CAPITAL_WEIGHTED');
    expect(result.consumed).toBeCloseTo(1.5, 2);
    // 8 - 1.5 = 6.5
    expect(result.effectiveDenominator).toBeCloseTo(6.5, 2);
  });

  it('만재 8개 100% — Default vs ENABLED 동일 결과', () => {
    const shadows = Array.from({ length: 8 }, () =>
      makeShadow({ originalQuantity: 10, quantity: 10 }),
    );
    const inputBase = {
      effectiveMaxPositions: 8,
      reservedSlots: 0,
      shadows,
    };
    const enabled = evaluateSlotSizing(inputBase);
    expect(enabled.effectiveDenominator).toBe(1); // floor

    delete process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED;
    const simple = evaluateSlotSizing(inputBase);
    expect(simple.effectiveDenominator).toBe(1); // 동일 floor
  });

  it('source CAPITAL_WEIGHTED 표기 + reason 활성 메시지', () => {
    const result = evaluateSlotSizing({
      effectiveMaxPositions: 8,
      reservedSlots: 0,
      shadows: [],
    });
    expect(result.source).toBe('CAPITAL_WEIGHTED');
    expect(result.reason).toContain('자본 가중 활성');
  });
});
