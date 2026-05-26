import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeLiquidityFloorForGate1 } from './gate1LiquidityFloor.js';

const verifiedCoverage = {
  source: 'KIS_OFFICIAL',
  confidence: 'VERIFIED',
};

// 개장초(09:00~09:30 KST) 시각 — UTC 00:00:09 == KST 09:00:09.
const EARLY_SESSION_NOW = '2026-05-26T00:00:09.000Z';
// mid-session(10:30 KST) 시각 — UTC 01:30 == KST 10:30.
const MID_SESSION_NOW = '2026-05-26T01:30:00.000Z';

// 상시 유동(20일 평균 충분) + 개장초 현재거래량 저조 — 에코프로형 오탈락 재현 케이스.
const AVG_LIQUID_CURRENT_LOW_QUOTE = {
  currentPrice: 100_000,
  volume: 1_000, // intraday 누적 ≈ 0 (개장초)
  avgVolume20d: 800_000, // 20일 평균은 풍부
  tradingValue: 100_000_000, // 1억 (현재 10억 floor 미달)
  avgTradingValue20d: 80_000_000_000, // 800억 (avg floor 통과)
};

describe('Gate1 liquidity floor diagnostic normalizer', () => {
  it('returns PASS when current and average liquidity clear the advisory floor', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: {
        currentPrice: 12000,
        volume: 1_000_000,
        avgVolume20d: 800_000,
        tradingValue: 12_000_000_000,
        avgTradingValue20d: 9_600_000_000,
      },
      quoteCoverage: verifiedCoverage,
    });

    expect(result).toMatchObject({
      status: 'PASS',
      volume: 1_000_000,
      avgVolume20d: 800_000,
      tradingValue: 12_000_000_000,
      avgTradingValue20d: 9_600_000_000,
      currentPrice: 12000,
      checks: {
        volumePass: true,
        tradingValuePass: true,
        avgVolumePass: true,
        avgTradingValuePass: true,
      },
      source: 'KIS_OFFICIAL',
      sourceStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
  });

  it('derives trading values from price and volume without throwing', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: {
        currentPrice: 10000,
        volume: 200_000,
        avgVolume20d: 100_000,
      },
      quoteCoverage: verifiedCoverage,
    });

    expect(result.tradingValue).toBe(2_000_000_000);
    expect(result.avgTradingValue20d).toBe(1_000_000_000);
    expect(result.status).toBe('PASS');
    expect(result.marketSignal).toBe(false);
  });

  it('marks consistently thin liquidity below the advisory floor', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: {
        currentPrice: 10000,
        volume: 10_000,
        avgVolume20d: 8_000,
      },
      quoteCoverage: verifiedCoverage,
    });

    expect(result.status).toBe('THIN');
    expect(result.reason).toBe('LIQUIDITY_BELOW_FLOOR');
    expect(result.checks).toMatchObject({
      volumePass: false,
      tradingValuePass: false,
      avgVolumePass: false,
      avgTradingValuePass: false,
    });
    expect(result.marketSignal).toBe(false);
  });

  it('separates one-off current liquidity spikes from stable average liquidity', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: {
        currentPrice: 10000,
        volume: 1_000_000,
        avgVolume20d: 10_000,
      },
      quoteCoverage: verifiedCoverage,
    });

    expect(result.status).toBe('SPIKE_ONLY');
    expect(result.reason).toBe('CURRENT_LIQUIDITY_SPIKE_BUT_AVERAGE_THIN');
    expect(result.marketSignal).toBe(false);
  });

  it('reports missing liquidity inputs as provider coverage, not market signal', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: null,
      quoteCoverage: null,
    });

    expect(result).toMatchObject({
      status: 'MISSING',
      sourceStatus: 'MISSING',
      reason: 'LIQUIDITY_INPUT_MISSING',
      providerIssue: true,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
  });

  describe('OPENING_RAMP session-aware soft-pass (ADR-0157 ENV rollback)', () => {
    const ENV_KEY = 'GATE1_LIQUIDITY_OPENING_RAMP_ENABLED';
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env[ENV_KEY];
    });
    afterEach(() => {
      if (originalEnv === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = originalEnv;
    });

    // (a) early session + avg-liquid + current-low → OPENING_RAMP(FAIL 아님).
    it('soft-passes early-session avg-liquid current-low as OPENING_RAMP (not FAIL)', () => {
      delete process.env[ENV_KEY]; // default true
      const result = normalizeLiquidityFloorForGate1({
        quote: AVG_LIQUID_CURRENT_LOW_QUOTE,
        quoteCoverage: verifiedCoverage,
        session: { now: EARLY_SESSION_NOW },
      });

      expect(result.status).toBe('OPENING_RAMP');
      expect(result.reason).toBe('OPENING_RAMP_AVG_LIQUID_CURRENT_RAMPING');
      expect(result.checks).toMatchObject({
        volumePass: false,
        tradingValuePass: false,
        avgVolumePass: true,
        avgTradingValuePass: true,
      });
      expect(result.marketSignal).toBe(false);
      expect(result.executionImpact).toBe('DIAGNOSTIC_ONLY');
    });

    it('derives early session from quote-embedded now without explicit session input', () => {
      delete process.env[ENV_KEY];
      const result = normalizeLiquidityFloorForGate1({
        quote: { ...AVG_LIQUID_CURRENT_LOW_QUOTE, now: EARLY_SESSION_NOW },
        quoteCoverage: verifiedCoverage,
      });
      expect(result.status).toBe('OPENING_RAMP');
    });

    // --- 데이터 부착(wiring) 검증: production quote 는 top-level now/asOf 가 없다.
    // 정본 평가시각은 coverage.asOf(KIS official) 또는 quote.priceMetadata.asOf 에만 존재한다.
    // 아래 케이스가 통과해야 OPENING_RAMP 가 production 에서 실제로 발화한다(인프라-only 아님).
    describe('canonical timestamp attachment (production wiring)', () => {
      // production-shape: top-level now/currentTime/asOf 없음. coverage.asOf 만 존재.
      it('attaches early session from coverage.asOf alone (no session, no top-level now)', () => {
        delete process.env[ENV_KEY];
        const result = normalizeLiquidityFloorForGate1({
          quote: { ...AVG_LIQUID_CURRENT_LOW_QUOTE },
          quoteCoverage: { ...verifiedCoverage, asOf: EARLY_SESSION_NOW },
        });
        expect(result.status).toBe('OPENING_RAMP');
      });

      // production-shape: timestamp 가 quote.priceMetadata.asOf 에만 중첩 존재.
      it('attaches early session from quote.priceMetadata.asOf (nested canonical timestamp)', () => {
        delete process.env[ENV_KEY];
        const result = normalizeLiquidityFloorForGate1({
          quote: { ...AVG_LIQUID_CURRENT_LOW_QUOTE, priceMetadata: { asOf: EARLY_SESSION_NOW } },
          quoteCoverage: verifiedCoverage,
        });
        expect(result.status).toBe('OPENING_RAMP');
      });

      // quantFilter 실제 경로: session 객체는 넘어오지만 now 가 (스키마에 없어) undefined 다.
      // → canonical coverage.asOf 로 backfill 되어야 OPENING_RAMP 가 발화한다.
      it('backfills now from coverage.asOf when explicit session.now is undefined (quantFilter path)', () => {
        delete process.env[ENV_KEY];
        const result = normalizeLiquidityFloorForGate1({
          quote: { ...AVG_LIQUID_CURRENT_LOW_QUOTE },
          quoteCoverage: { ...verifiedCoverage, asOf: EARLY_SESSION_NOW },
          session: { now: undefined, marketSession: undefined },
        });
        expect(result.status).toBe('OPENING_RAMP');
      });

      // mid-session 을 coverage.asOf 로 인지 → 여전히 FAIL(개장초 한정 soft-pass 보장).
      it('keeps FAIL for mid-session resolved from coverage.asOf', () => {
        delete process.env[ENV_KEY];
        const result = normalizeLiquidityFloorForGate1({
          quote: { ...AVG_LIQUID_CURRENT_LOW_QUOTE },
          quoteCoverage: { ...verifiedCoverage, asOf: MID_SESSION_NOW },
        });
        expect(result.status).toBe('FAIL');
      });

      // coverage.asOf 가 quote.now 보다 우선이 아니어도 됨 — 둘 다 없을 때만 FAIL.
      it('keeps FAIL when neither coverage.asOf nor priceMetadata.asOf is present', () => {
        delete process.env[ENV_KEY];
        const result = normalizeLiquidityFloorForGate1({
          quote: { ...AVG_LIQUID_CURRENT_LOW_QUOTE },
          quoteCoverage: verifiedCoverage,
        });
        expect(result.status).toBe('FAIL');
      });
    });

    it('accepts explicit minutesSinceOpen within the ramp window', () => {
      delete process.env[ENV_KEY];
      const result = normalizeLiquidityFloorForGate1({
        quote: AVG_LIQUID_CURRENT_LOW_QUOTE,
        quoteCoverage: verifiedCoverage,
        session: { minutesSinceOpen: 5 },
      });
      expect(result.status).toBe('OPENING_RAMP');
    });

    // (b) mid-session + avg-liquid + current-low(실제 dry-up) → 여전히 FAIL.
    it('keeps FAIL for mid-session dry-up (avg-liquid current-low but not early session)', () => {
      delete process.env[ENV_KEY];
      const result = normalizeLiquidityFloorForGate1({
        quote: AVG_LIQUID_CURRENT_LOW_QUOTE,
        quoteCoverage: verifiedCoverage,
        session: { now: MID_SESSION_NOW },
      });
      expect(result.status).toBe('FAIL');
      expect(result.reason).toBe('LIQUIDITY_BELOW_FLOOR');
    });

    it('keeps FAIL when no session context is available (cannot prove early session)', () => {
      delete process.env[ENV_KEY];
      const result = normalizeLiquidityFloorForGate1({
        quote: AVG_LIQUID_CURRENT_LOW_QUOTE,
        quoteCoverage: verifiedCoverage,
      });
      expect(result.status).toBe('FAIL');
    });

    it('keeps FAIL when minutesSinceOpen exceeds the ramp window', () => {
      delete process.env[ENV_KEY];
      const result = normalizeLiquidityFloorForGate1({
        quote: AVG_LIQUID_CURRENT_LOW_QUOTE,
        quoteCoverage: verifiedCoverage,
        session: { minutesSinceOpen: 45 },
      });
      expect(result.status).toBe('FAIL');
    });

    // (c) ENV off → 기존 FAIL 동작(회귀 0).
    it('restores legacy FAIL when ENV is explicitly false (byte-equivalent rollback)', () => {
      process.env[ENV_KEY] = 'false';
      const result = normalizeLiquidityFloorForGate1({
        quote: AVG_LIQUID_CURRENT_LOW_QUOTE,
        quoteCoverage: verifiedCoverage,
        session: { now: EARLY_SESSION_NOW },
      });
      expect(result.status).toBe('FAIL');
      expect(result.reason).toBe('LIQUIDITY_BELOW_FLOOR');
    });

    // (d) 진짜 비유동(avg 도 미달) → early session 이어도 여전히 THIN/FAIL.
    it('keeps THIN for genuinely illiquid stock even in early session (avg also below floor)', () => {
      delete process.env[ENV_KEY];
      const result = normalizeLiquidityFloorForGate1({
        quote: {
          currentPrice: 10_000,
          volume: 1_000,
          avgVolume20d: 8_000, // avg 도 미달
        },
        quoteCoverage: verifiedCoverage,
        session: { now: EARLY_SESSION_NOW },
      });
      expect(result.status).toBe('THIN');
      expect(result.reason).toBe('LIQUIDITY_BELOW_FLOOR');
    });

    // (e) PASS / SPIKE_ONLY 기존 동작 불변 (early session 이어도).
    it('keeps PASS unchanged in early session when all four checks pass', () => {
      delete process.env[ENV_KEY];
      const result = normalizeLiquidityFloorForGate1({
        quote: {
          currentPrice: 12_000,
          volume: 1_000_000,
          avgVolume20d: 800_000,
          tradingValue: 12_000_000_000,
          avgTradingValue20d: 9_600_000_000,
        },
        quoteCoverage: verifiedCoverage,
        session: { now: EARLY_SESSION_NOW },
      });
      expect(result.status).toBe('PASS');
    });

    it('keeps SPIKE_ONLY unchanged in early session (current high, avg thin)', () => {
      delete process.env[ENV_KEY];
      const result = normalizeLiquidityFloorForGate1({
        quote: {
          currentPrice: 10_000,
          volume: 1_000_000,
          avgVolume20d: 10_000,
        },
        quoteCoverage: verifiedCoverage,
        session: { now: EARLY_SESSION_NOW },
      });
      expect(result.status).toBe('SPIKE_ONLY');
      expect(result.reason).toBe('CURRENT_LIQUIDITY_SPIKE_BUT_AVERAGE_THIN');
    });
  });
});
