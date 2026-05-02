/**
 * currentEquityExposure.test.ts (ADR-0167)
 *
 * 정확 산출 SSOT 회귀 — 활성 trade 합산 + closed 제외 + currentPriceMap + ENV 우회 + 안전 fallback.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  computeCurrentEquityExposure,
  resolveCurrentEquityExposure,
  isAccurateExposureEnabled,
} from './currentEquityExposure.js';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

const ORIGINAL_ENV = process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED;
beforeEach(() => { delete process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED; });
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED;
  else process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED = ORIGINAL_ENV;
});

// ─── 테스트 fixtures ────────────────────────────────────────────────────────

const buildTrade = (overrides: Partial<ServerShadowTrade>): ServerShadowTrade => ({
  id: 'test_001',
  stockCode: '005930',
  stockName: 'Test',
  signalTime: '2026-05-02T00:00:00Z',
  signalPrice: 50_000,
  shadowEntryPrice: 50_000,
  quantity: 10,
  originalQuantity: 10,
  stopLoss: 46_000,
  initialStopLoss: 46_000,
  regimeStopLoss: 46_000,
  hardStopLoss: 46_000,
  targetPrice: 60_000,
  status: 'PENDING',
  mode: 'SHADOW',
  entryRegime: 'R3_EARLY',
  profileType: 'B',
  watchlistSource: undefined,
  profitTranches: [],
  trailingHighWaterMark: 50_000,
  trailPct: 0.10,
  trailingEnabled: false,
  ...overrides,
});

// ─── isAccurateExposureEnabled ─────────────────────────────────────────────

describe('isAccurateExposureEnabled — ENV 동적 결정 (default OFF)', () => {
  it('ENV 미설정 (default) → false', () => {
    expect(isAccurateExposureEnabled()).toBe(false);
  });

  it("ENV 'true' 명시 → true", () => {
    process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED = 'true';
    expect(isAccurateExposureEnabled()).toBe(true);
  });

  it("ENV 'false' → false", () => {
    process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED = 'false';
    expect(isAccurateExposureEnabled()).toBe(false);
  });

  it("ENV '1' / 'TRUE' → false (정확히 'true' 만)", () => {
    process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED = '1';
    expect(isAccurateExposureEnabled()).toBe(false);
    process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED = 'TRUE';
    expect(isAccurateExposureEnabled()).toBe(false);
  });
});

// ─── computeCurrentEquityExposure — 활성 trade 합산 ────────────────────────

describe('computeCurrentEquityExposure — 활성 trade 평가금액 합산', () => {
  it('빈 shadows → totalAmount=0 / activeTradeCount=0', () => {
    const result = computeCurrentEquityExposure({ shadows: [] });
    expect(result.totalAmount).toBe(0);
    expect(result.activeTradeCount).toBe(0);
    expect(result.usedCurrentPrice).toBe(false);
  });

  it('단일 PENDING trade → shadowEntryPrice × quantity', () => {
    const result = computeCurrentEquityExposure({
      shadows: [buildTrade({ stockCode: '005930', shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' })],
    });
    expect(result.totalAmount).toBe(500_000);
    expect(result.activeTradeCount).toBe(1);
  });

  it('단일 ACTIVE trade → 동일 산출', () => {
    const result = computeCurrentEquityExposure({
      shadows: [buildTrade({ stockCode: '005930', shadowEntryPrice: 60_000, quantity: 5, status: 'ACTIVE' })],
    });
    expect(result.totalAmount).toBe(300_000);
    expect(result.activeTradeCount).toBe(1);
  });

  it('다중 trade 합산', () => {
    const result = computeCurrentEquityExposure({
      shadows: [
        buildTrade({ id: 't1', stockCode: '005930', shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' }),
        buildTrade({ id: 't2', stockCode: '000660', shadowEntryPrice: 100_000, quantity: 3, status: 'ACTIVE' }),
        buildTrade({ id: 't3', stockCode: '035420', shadowEntryPrice: 200_000, quantity: 2, status: 'ACTIVE' }),
      ],
    });
    expect(result.totalAmount).toBe(500_000 + 300_000 + 400_000);
    expect(result.activeTradeCount).toBe(3);
  });

  it('closed trade (HIT_STOP / HIT_TARGET / REJECTED) 모두 제외', () => {
    const result = computeCurrentEquityExposure({
      shadows: [
        buildTrade({ id: 't1', shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' }),
        buildTrade({ id: 't2', shadowEntryPrice: 100_000, quantity: 5, status: 'HIT_STOP' }),
        buildTrade({ id: 't3', shadowEntryPrice: 200_000, quantity: 3, status: 'HIT_TARGET' }),
        buildTrade({ id: 't4', shadowEntryPrice: 80_000, quantity: 2, status: 'REJECTED' }),
      ],
    });
    expect(result.totalAmount).toBe(500_000); // PENDING 만
    expect(result.activeTradeCount).toBe(1);
  });

  it('quantity=0 (전량 청산) → 자동 제외', () => {
    // getRemainingQty 가 0 반환 시 활성 카운트 안 함
    const result = computeCurrentEquityExposure({
      shadows: [buildTrade({ shadowEntryPrice: 50_000, quantity: 0, status: 'ACTIVE' })],
    });
    expect(result.totalAmount).toBe(0);
    expect(result.activeTradeCount).toBe(0);
  });

  it('NaN/0/음수 shadowEntryPrice → 해당 trade 제외 (panic 차단)', () => {
    const result = computeCurrentEquityExposure({
      shadows: [
        buildTrade({ id: 't1', shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' }),
        buildTrade({ id: 't2', shadowEntryPrice: 0, quantity: 5, status: 'ACTIVE' }),
        buildTrade({ id: 't3', shadowEntryPrice: -100, quantity: 3, status: 'ACTIVE' }),
        buildTrade({ id: 't4', shadowEntryPrice: NaN, quantity: 2, status: 'ACTIVE' }),
      ],
    });
    expect(result.totalAmount).toBe(500_000);
    expect(result.activeTradeCount).toBe(1);
  });

  it('currentPriceMap 적용 — 시가 평가 우선', () => {
    const priceMap = new Map<string, number>([
      ['005930', 55_000],   // 보유원가 50_000 → 시가 55_000
      ['000660', 90_000],   // 보유원가 100_000 → 시가 90_000 (-10%)
    ]);
    const result = computeCurrentEquityExposure({
      shadows: [
        buildTrade({ id: 't1', stockCode: '005930', shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' }),
        buildTrade({ id: 't2', stockCode: '000660', shadowEntryPrice: 100_000, quantity: 3, status: 'ACTIVE' }),
      ],
      currentPriceMap: priceMap,
    });
    expect(result.totalAmount).toBe(55_000 * 10 + 90_000 * 3);  // 550_000 + 270_000 = 820_000
    expect(result.usedCurrentPrice).toBe(true);
    expect(result.activeTradeCount).toBe(2);
  });

  it('currentPriceMap 부분 매핑 — 부재 종목 fallback shadowEntryPrice', () => {
    const priceMap = new Map<string, number>([['005930', 55_000]]);
    const result = computeCurrentEquityExposure({
      shadows: [
        buildTrade({ id: 't1', stockCode: '005930', shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' }),
        buildTrade({ id: 't2', stockCode: '000660', shadowEntryPrice: 100_000, quantity: 3, status: 'ACTIVE' }),
      ],
      currentPriceMap: priceMap,
    });
    // 005930: 시가 55_000 × 10 = 550_000
    // 000660: fallback 100_000 × 3 = 300_000
    expect(result.totalAmount).toBe(550_000 + 300_000);
    expect(result.usedCurrentPrice).toBe(true); // 1 종목 시가 사용 → true
  });

  it('currentPriceMap 부재 → usedCurrentPrice=false', () => {
    const result = computeCurrentEquityExposure({
      shadows: [buildTrade({ shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' })],
    });
    expect(result.usedCurrentPrice).toBe(false);
  });

  it('currentPriceMap 의 NaN/0 가격 → fallback shadowEntryPrice', () => {
    const priceMap = new Map<string, number>([
      ['005930', NaN],
      ['000660', 0],
    ]);
    const result = computeCurrentEquityExposure({
      shadows: [
        buildTrade({ id: 't1', stockCode: '005930', shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' }),
        buildTrade({ id: 't2', stockCode: '000660', shadowEntryPrice: 100_000, quantity: 3, status: 'ACTIVE' }),
      ],
      currentPriceMap: priceMap,
    });
    expect(result.totalAmount).toBe(500_000 + 300_000);
    expect(result.usedCurrentPrice).toBe(false); // 모두 fallback
  });
});

// ─── resolveCurrentEquityExposure — ADR-0166 통합 헬퍼 ─────────────────────

describe('resolveCurrentEquityExposure — ADR-0166 통합 진입점', () => {
  it('ENV OFF (default) → ADR-0166 단순 추정 (totalAssets - orderableCash)', () => {
    const result = resolveCurrentEquityExposure(10_000_000, 7_000_000, []);
    expect(result).toBe(3_000_000);
  });

  it('ENV OFF + 음수 결과 → 0 fallback (안전)', () => {
    const result = resolveCurrentEquityExposure(5_000_000, 8_000_000, []);
    expect(result).toBe(0);
  });

  it("ENV ON ('true') → 정확 산출 (활성 trade 합산)", () => {
    process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED = 'true';
    const result = resolveCurrentEquityExposure(10_000_000, 7_000_000, [
      buildTrade({ id: 't1', shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' }),
      buildTrade({ id: 't2', shadowEntryPrice: 100_000, quantity: 3, status: 'HIT_STOP' }), // 제외
    ]);
    expect(result).toBe(500_000); // 활성 1건만 (단순 추정 3_000_000 과 다름)
  });

  it('ENV ON + 활성 trade 0 → 0 (단순 추정과 다름, 정확)', () => {
    process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED = 'true';
    const result = resolveCurrentEquityExposure(10_000_000, 7_000_000, []);
    expect(result).toBe(0); // 단순 추정 = 3_000_000, 정확 = 0 (활성 trade 없음)
  });

  it('ENV ON + closed trade 만 → 0 (정확, 단순 추정 = 차이)', () => {
    process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED = 'true';
    const shadows = [
      buildTrade({ id: 't1', shadowEntryPrice: 50_000, quantity: 10, status: 'HIT_TARGET' }),
      buildTrade({ id: 't2', shadowEntryPrice: 100_000, quantity: 5, status: 'HIT_STOP' }),
    ];
    const result = resolveCurrentEquityExposure(10_000_000, 9_000_000, shadows);
    expect(result).toBe(0); // closed 만 → 정확 0
    // 단순 추정 = 1_000_000 (수익 실현분이 totalAssets 에 반영)
  });

  it('ENV ON + 단순 추정 vs 정확 결과 차이 검증', () => {
    process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED = 'true';
    const shadows = [
      buildTrade({ id: 't1', shadowEntryPrice: 50_000, quantity: 10, status: 'PENDING' }),
      buildTrade({ id: 't2', shadowEntryPrice: 100_000, quantity: 5, status: 'ACTIVE' }),
    ];
    const accurate = resolveCurrentEquityExposure(10_000_000, 5_000_000, shadows);
    expect(accurate).toBe(500_000 + 500_000); // = 1_000_000

    delete process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED;
    const approx = resolveCurrentEquityExposure(10_000_000, 5_000_000, shadows);
    expect(approx).toBe(5_000_000); // 단순 추정 (totalAssets - orderableCash)

    // 정확 산출이 단순 추정보다 *낮음* — 미체결 매수 주문 / 원가 < 시가 등으로 차이 발생
    expect(accurate).toBeLessThan(approx);
  });
});
