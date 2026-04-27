/**
 * @responsibility orderTypeOptimizer 회귀 테스트 (ADR-0031 PR-O)
 */
import { describe, it, expect } from 'vitest';
import {
  decideOrderType,
  requiresUnsafeIdempotency,
  STRONG_BREAKOUT_VOLUME_Z,
  STRONG_BREAKOUT_PRICE_MOMENTUM_PCT,
  HIGH_SLIPPAGE_THRESHOLD,
  SLIPPAGE_MIN_SAMPLE,
  AGGRESSIVE_LIMIT_OFFSET_TICKS,
  CHASE_WAIT_SECONDS,
  CHASE_PRICE_DELTA_PCT,
} from './orderTypeOptimizer.js';

describe('decideOrderType — 우선순위 분기', () => {
  it('강한 돌파 (volumeZ ≥ 2 + priceMomentum > 2%) → IOC_MARKET', () => {
    const r = decideOrderType({
      stockCode: 'A005930',
      volumeZ: 2.5,
      priceMomentumPct: 3.0,
      slippageOverride: { mean: 0.001, sampleSize: 50 }, // 슬리피지 낮아도 우선순위 1 채택
    });
    expect(r.orderType).toBe('IOC_MARKET');
    expect(r.reason).toContain('강한 돌파');
  });

  it('volumeZ 정확히 2.0 boundary → IOC_MARKET (≥)', () => {
    const r = decideOrderType({
      stockCode: 'A',
      volumeZ: STRONG_BREAKOUT_VOLUME_Z,
      priceMomentumPct: 2.5,
    });
    expect(r.orderType).toBe('IOC_MARKET');
  });

  it('priceMomentum 정확히 2.0 boundary → IOC_MARKET 미진입 (strict >)', () => {
    const r = decideOrderType({
      stockCode: 'A',
      volumeZ: 2.5,
      priceMomentumPct: STRONG_BREAKOUT_PRICE_MOMENTUM_PCT, // = 2.0
      slippageOverride: { mean: 0.001, sampleSize: 50 },
    });
    expect(r.orderType).toBe('LIMIT'); // > 2 가 아니라 미진입
  });

  it('약한 돌파 + 평균 슬리피지 ≥ 0.5% (표본 ≥ 10) → AGGRESSIVE_LIMIT', () => {
    const r = decideOrderType({
      stockCode: 'A',
      volumeZ: 1.0,
      priceMomentumPct: 1.0,
      slippageOverride: { mean: 0.006, sampleSize: 15 },
    });
    expect(r.orderType).toBe('AGGRESSIVE_LIMIT');
    expect(r.limitOffsetTicks).toBe(AGGRESSIVE_LIMIT_OFFSET_TICKS);
    expect(r.chasePolicy).toEqual({
      waitSeconds: CHASE_WAIT_SECONDS,
      priceDeltaPct: CHASE_PRICE_DELTA_PCT,
    });
  });

  it('슬리피지 ≥ 0.5% 지만 표본 < 10 → 기본 LIMIT', () => {
    const r = decideOrderType({
      stockCode: 'A',
      slippageOverride: { mean: 0.01, sampleSize: 5 },
    });
    expect(r.orderType).toBe('LIMIT');
    expect(r.reason).toContain('표본 부족');
  });

  it('슬리피지 < 0.5% + 충분한 표본 → 기본 LIMIT', () => {
    const r = decideOrderType({
      stockCode: 'A',
      slippageOverride: { mean: 0.001, sampleSize: 50 },
    });
    expect(r.orderType).toBe('LIMIT');
    expect(r.reason).toContain('정상 범위');
  });

  it('데이터 부족 (slippageOverride 없음 + 종목 첫 진입) → LIMIT', () => {
    const r = decideOrderType({ stockCode: 'BRAND_NEW_CODE' });
    expect(r.orderType).toBe('LIMIT');
  });

  it('NaN/Infinity 입력 → 안전 fallback (LIMIT)', () => {
    const r = decideOrderType({
      stockCode: 'A',
      volumeZ: NaN,
      priceMomentumPct: Infinity,
      slippageOverride: { mean: 0.001, sampleSize: 5 },
    });
    expect(r.orderType).toBe('LIMIT');
  });

  it('SLIPPAGE_MIN_SAMPLE boundary 정확히 10 → AGGRESSIVE_LIMIT (≥)', () => {
    const r = decideOrderType({
      stockCode: 'A',
      slippageOverride: { mean: HIGH_SLIPPAGE_THRESHOLD, sampleSize: SLIPPAGE_MIN_SAMPLE },
    });
    expect(r.orderType).toBe('AGGRESSIVE_LIMIT');
  });

  it('reason 메시지 — IOC_MARKET 에 vol/mom 수치 포함', () => {
    const r = decideOrderType({
      stockCode: 'A',
      volumeZ: 3.5,
      priceMomentumPct: 4.2,
    });
    expect(r.reason).toContain('3.50');
    expect(r.reason).toContain('4.20');
  });

  it('reason 메시지 — AGGRESSIVE_LIMIT 에 슬리피지 % 포함', () => {
    const r = decideOrderType({
      stockCode: 'A',
      slippageOverride: { mean: 0.008, sampleSize: 20 },
    });
    expect(r.reason).toContain('0.80%');
    expect(r.reason).toContain('20건');
  });
});

describe('requiresUnsafeIdempotency — ADR-0014 호환성 가드', () => {
  it('IOC_MARKET → unsafe idempotency 필수', () => {
    expect(requiresUnsafeIdempotency({ orderType: 'IOC_MARKET', reason: '' })).toBe(true);
  });

  it('LIMIT / AGGRESSIVE_LIMIT → unsafe 불필요', () => {
    expect(requiresUnsafeIdempotency({ orderType: 'LIMIT', reason: '' })).toBe(false);
    expect(requiresUnsafeIdempotency({ orderType: 'AGGRESSIVE_LIMIT', reason: '' })).toBe(false);
  });
});

describe('상수 SSOT', () => {
  it('STRONG_BREAKOUT_VOLUME_Z=2 / PRICE_MOMENTUM=2 / HIGH_SLIPPAGE=0.005 / MIN_SAMPLE=10', () => {
    expect(STRONG_BREAKOUT_VOLUME_Z).toBe(2.0);
    expect(STRONG_BREAKOUT_PRICE_MOMENTUM_PCT).toBe(2.0);
    expect(HIGH_SLIPPAGE_THRESHOLD).toBe(0.005);
    expect(SLIPPAGE_MIN_SAMPLE).toBe(10);
  });

  it('AGGRESSIVE_LIMIT 정책 — offset 1tick / wait 60s / chase 0.3%', () => {
    expect(AGGRESSIVE_LIMIT_OFFSET_TICKS).toBe(1);
    expect(CHASE_WAIT_SECONDS).toBe(60);
    expect(CHASE_PRICE_DELTA_PCT).toBe(0.3);
  });
});
