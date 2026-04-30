// @responsibility ADR-0116 priceAdjustment SSOT 회귀 테스트
import { describe, expect, it } from 'vitest';
import {
  PRICE_ADJUSTMENT_DEFAULT_FACTOR,
  getAdjustedPrice,
  getEntryPriceAdjusted,
  getEntryPriceForDisplay,
  getEntryPriceRawForRecord,
} from './priceAdjustment.js';

describe('PRICE_ADJUSTMENT_DEFAULT_FACTOR', () => {
  it('default factor = 1.0 (identity)', () => {
    expect(PRICE_ADJUSTMENT_DEFAULT_FACTOR).toBe(1.0);
  });
});

describe('getAdjustedPrice — RAW + factor → ADJUSTED', () => {
  it('factor=1 identity → adjusted == raw', () => {
    expect(getAdjustedPrice(10000, 1)).toBe(10000);
  });

  it('factor 부재 → identity', () => {
    expect(getAdjustedPrice(10000)).toBe(10000);
  });

  it('factor=2 분할 시나리오 → adjusted = raw / 2', () => {
    // 1주 → 2주 분할 (액면분할), 가격 절반.
    expect(getAdjustedPrice(10000, 2)).toBe(5000);
  });

  it('factor=0.5 병합 시나리오 → adjusted = raw / 0.5 = raw × 2', () => {
    expect(getAdjustedPrice(10000, 0.5)).toBe(20000);
  });

  it('factor=NaN → 1.0 fallback (identity)', () => {
    expect(getAdjustedPrice(10000, NaN)).toBe(10000);
  });

  it('factor=Infinity → 1.0 fallback', () => {
    expect(getAdjustedPrice(10000, Infinity)).toBe(10000);
  });

  it('factor=0 → 1.0 fallback (분모 0 차단)', () => {
    expect(getAdjustedPrice(10000, 0)).toBe(10000);
  });

  it('factor 음수 → 1.0 fallback', () => {
    expect(getAdjustedPrice(10000, -2)).toBe(10000);
  });

  it('rawPrice=0 → 0 (안전 fallback)', () => {
    expect(getAdjustedPrice(0, 1)).toBe(0);
  });

  it('rawPrice NaN → 0', () => {
    expect(getAdjustedPrice(NaN, 1)).toBe(0);
  });

  it('rawPrice Infinity → 0', () => {
    expect(getAdjustedPrice(Infinity, 1)).toBe(0);
  });

  it('rawPrice 음수 → 0', () => {
    expect(getAdjustedPrice(-100, 1)).toBe(0);
  });
});

describe('getEntryPriceRawForRecord — 우선순위 entryPriceRaw → shadowEntryPrice → signalPrice', () => {
  it('entryPriceRaw 만 → entryPriceRaw 사용', () => {
    expect(getEntryPriceRawForRecord({ entryPriceRaw: 10000 })).toBe(10000);
  });

  it('entryPriceRaw + shadowEntryPrice 동시 → entryPriceRaw 우선', () => {
    expect(
      getEntryPriceRawForRecord({ entryPriceRaw: 10000, shadowEntryPrice: 9500 }),
    ).toBe(10000);
  });

  it('entryPriceRaw 부재 → shadowEntryPrice 폴백 (레거시 trade)', () => {
    expect(getEntryPriceRawForRecord({ shadowEntryPrice: 9500 })).toBe(9500);
  });

  it('shadowEntryPrice 도 부재 → signalPrice 폴백', () => {
    expect(getEntryPriceRawForRecord({ signalPrice: 9000 })).toBe(9000);
  });

  it('모든 필드 부재 → 0 안전', () => {
    expect(getEntryPriceRawForRecord({})).toBe(0);
  });

  it('entryPriceRaw NaN → 다음 후보 (shadowEntryPrice)', () => {
    expect(
      getEntryPriceRawForRecord({ entryPriceRaw: NaN, shadowEntryPrice: 9500 }),
    ).toBe(9500);
  });

  it('entryPriceRaw 0 또는 음수 → 다음 후보', () => {
    expect(
      getEntryPriceRawForRecord({ entryPriceRaw: 0, shadowEntryPrice: 9500 }),
    ).toBe(9500);
    expect(
      getEntryPriceRawForRecord({ entryPriceRaw: -100, shadowEntryPrice: 9500 }),
    ).toBe(9500);
  });
});

describe('getEntryPriceAdjusted — RAW 추출 + factor 적용', () => {
  it('entryPriceRaw + factor=1 → identity', () => {
    expect(
      getEntryPriceAdjusted({ entryPriceRaw: 10000, cumulativeAdjustmentFactor: 1 }),
    ).toBe(10000);
  });

  it('entryPriceRaw + factor=2 → 분할 보정', () => {
    expect(
      getEntryPriceAdjusted({ entryPriceRaw: 10000, cumulativeAdjustmentFactor: 2 }),
    ).toBe(5000);
  });

  it('factor 부재 → 1.0 default', () => {
    expect(getEntryPriceAdjusted({ entryPriceRaw: 10000 })).toBe(10000);
  });

  it('레거시 trade (entryPriceRaw 부재 + shadowEntryPrice 만) → fallback', () => {
    expect(
      getEntryPriceAdjusted({ shadowEntryPrice: 9500, cumulativeAdjustmentFactor: 1 }),
    ).toBe(9500);
  });

  it('레거시 trade + factor=2 분할 → fallback raw / 2', () => {
    expect(
      getEntryPriceAdjusted({ shadowEntryPrice: 10000, cumulativeAdjustmentFactor: 2 }),
    ).toBe(5000);
  });
});

describe('getEntryPriceForDisplay — UI/리포트 우선순위', () => {
  it('display = adjusted (분할 보정 후 가격)', () => {
    expect(
      getEntryPriceForDisplay({ entryPriceRaw: 10000, cumulativeAdjustmentFactor: 2 }),
    ).toBe(5000);
  });

  it('factor 부재 → identity (raw 그대로)', () => {
    expect(getEntryPriceForDisplay({ entryPriceRaw: 10000 })).toBe(10000);
  });
});

describe('1차 로그 시나리오 시뮬', () => {
  it('098460 고영 — entryPriceRaw=12,610 보존, factor=1 → adjusted=12,610', () => {
    // ADR-0115: entryPrice 자동 재설정 폐기. RAW 보존.
    // ADR-0116: 분할 후 adjusted 산출 (Corporate Action Ledger 후속 PR).
    const trade = { entryPriceRaw: 12610, cumulativeAdjustmentFactor: 1 };
    expect(getEntryPriceRawForRecord(trade)).toBe(12610);
    expect(getEntryPriceAdjusted(trade)).toBe(12610);
    expect(getEntryPriceForDisplay(trade)).toBe(12610);
  });

  it('098460 고영 — 분할 1:3.21 가정 (40,500/12,610) → adjusted 산출', () => {
    // 가설: 098460 가 분할되어 currentPrice=40,500 / entryPriceRaw=12,610.
    // factor=1/3.21 (≈0.311) — 1주 → 3.21주, 가격 1/3.21.
    // 본 PR 단계: factor 미수신이라 항상 1.0 → identity. 본 케이스는
    // P3 후속 PR (Corporate Action Ledger) wiring 시뮬.
    const trade = { entryPriceRaw: 12610, cumulativeAdjustmentFactor: 0.311 };
    const adjusted = getEntryPriceAdjusted(trade);
    expect(adjusted).toBeGreaterThan(40000);
    expect(adjusted).toBeLessThan(41000);
  });
});
