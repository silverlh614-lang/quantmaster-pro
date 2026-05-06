/**
 * @responsibility ADR-0414 PriceCorrectionEngine 회귀 테스트 (≥9 케이스)
 *
 * 작업 지침서 §10 9~17 — 결정 트리 + confidence 산출 SSOT 검증.
 * 절대 원칙 #1 (input mutate 금지) + #3 (LIVE entry 사용 금지) 영구 가드.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  evaluatePriceCorrection,
  computeCorrectionConfidence,
  isPriceCorrectionDisabled,
  buildSkippedCorrectionResult,
  PRICE_CORRECTION_LIVE_THRESHOLD,
  PRICE_CORRECTION_SHADOW_THRESHOLD,
  PRICE_CORRECTION_SOURCE_WEIGHT,
  PRICE_CORRECTION_DATE_ALIGNMENT_WEIGHT,
  PRICE_CORRECTION_CROSS_SOURCE_AGREEMENT_WEIGHT,
  type PriceCorrectionInput,
} from './priceCorrectionEngine.js';
import { evaluatePriceIntegrity } from './priceIntegrityChecker.js';

beforeEach(() => {
  delete process.env.PRICE_CORRECTION_DISABLED;
});

afterEach(() => {
  delete process.env.PRICE_CORRECTION_DISABLED;
});

describe('ADR-0414 §2 PriceCorrectionEngine — 결정 트리', () => {
  it('테스트 9: Yahoo stale + KIS 정상 → USE_KIS_CURRENT', () => {
    // Yahoo stale (currentPriceDate=T-2)
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 49500,
      currentPriceDate: '2026-05-04',
      previousClose: 49500,
      previousCloseDate: '2026-05-03',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(integrity.status).toBe('STALE');

    const result = evaluatePriceCorrection({
      integrity,
      yahoo: {
        current: 49500,
        previousClose: 49500,
        currentDate: '2026-05-04',
        previousCloseDate: '2026-05-03',
      },
      kis: {
        current: 50500,
        previousClose: 49500,
        currentDate: '2026-05-06',
        previousCloseDate: '2026-05-04',
      },
    });
    expect(result.correctionType).toBe('USE_KIS_CURRENT');
    expect(result.correctedPrice).toBe(50500);
  });

  it('테스트 10: previousCloseDate=T-3 + KRX prevClose 있음 → USE_KRX_PREV_CLOSE', () => {
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-06',
      previousClose: 35000, // 28% gap
      previousCloseDate: '2026-05-03',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(integrity.status).toBe('PRICE_BASE_MISMATCH');

    const result = evaluatePriceCorrection({
      integrity,
      yahoo: {
        current: 50000,
        previousClose: 35000,
        currentDate: '2026-05-06',
        previousCloseDate: '2026-05-03',
      },
      krx: {
        previousClose: 49500,
        previousCloseDate: '2026-05-04',
      },
    });
    expect(result.correctionType).toBe('USE_KRX_PREV_CLOSE');
    expect(result.correctedPreviousClose).toBe(49500);
    expect(result.gapBasisDate).toBe('2026-05-04');
  });

  it('테스트 11: previousClose 보정 실패 (PRICE_BASE_MISMATCH + KRX 부재) → DROP_GAP_CALCULATION', () => {
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-06',
      previousClose: 35000,
      previousCloseDate: '2026-05-03',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(integrity.status).toBe('PRICE_BASE_MISMATCH');

    const result = evaluatePriceCorrection({
      integrity,
      yahoo: {
        current: 50000,
        previousClose: 35000,
        currentDate: '2026-05-06',
        previousCloseDate: '2026-05-03',
      },
      // KRX 부재
    });
    expect(result.correctionType).toBe('DROP_GAP_CALCULATION');
    expect(result.correctedGapPct).toBeNull();
    expect(result.gapBasisDate).toBeNull();
    expect(result.usableForLiveEntry).toBe(false);
    expect(result.usableForShadow).toBe(true); // DROP 도 shadow 사용 가능
  });

  it('테스트 12: reverse gap + cross-source CONFLICT → DROP_GAP_CALCULATION', () => {
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 58410, // gap=18%
      currentPriceDate: '2026-05-06',
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(integrity.status).toBe('REVERSE_GAP_SUSPECT');

    const result = evaluatePriceCorrection({
      integrity,
      yahoo: {
        current: 58410,
        previousClose: 49500,
      },
      kis: {
        current: 49500, // 5% 이상 차이 → CONFLICT
        previousClose: 49500,
      },
    });
    expect(result.correctionType).toBe('DROP_GAP_CALCULATION');
    expect(result.correctedGapPct).toBeNull();
  });

  it('테스트 13: integrity FAILED → SHADOW_ONLY', () => {
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: null,
      previousClose: null,
      lastKrxTradingDate: '2026-05-06',
    });
    expect(integrity.status).toBe('FAILED');

    const result = evaluatePriceCorrection({ integrity });
    expect(result.correctionType).toBe('SHADOW_ONLY');
    expect(result.usableForLiveEntry).toBe(false);
    expect(result.usableForShadow).toBe(true);
  });

  it('테스트 14: confidence 산출 SSOT — KIS + MATCH + TWO_SOURCES = 1.0 × 1.0 × 0.8 = 0.8', () => {
    const c1 = computeCorrectionConfidence('KIS', 'MATCH', 'TWO_SOURCES');
    expect(c1).toBeCloseTo(1.0 * 1.0 * 0.8, 4);

    // KRX + T_MINUS_1 + SINGLE_SOURCE = 0.9 × 0.8 × 0.5 = 0.36
    const c2 = computeCorrectionConfidence('KRX', 'T_MINUS_1', 'SINGLE_SOURCE');
    expect(c2).toBeCloseTo(0.9 * 0.8 * 0.5, 4);

    // YAHOO + STALE + CONFLICT = 0.7 × 0.2 × 0.2 = 0.028
    const c3 = computeCorrectionConfidence('YAHOO', 'STALE', 'CONFLICT');
    expect(c3).toBeCloseTo(0.7 * 0.2 * 0.2, 4);

    // 가중치 SSOT 정합
    expect(PRICE_CORRECTION_SOURCE_WEIGHT.KIS).toBe(1.0);
    expect(PRICE_CORRECTION_DATE_ALIGNMENT_WEIGHT.MATCH).toBe(1.0);
    expect(PRICE_CORRECTION_CROSS_SOURCE_AGREEMENT_WEIGHT.THREE_SOURCES).toBe(1.0);

    // clamp [0, 1] 검증 — 모든 가중치 곱셈은 자연 [0, 1] 범위지만 NaN 안전
    expect(computeCorrectionConfidence('UNKNOWN', 'UNKNOWN', 'CONFLICT')).toBeGreaterThanOrEqual(0);
    expect(computeCorrectionConfidence('KIS', 'MATCH', 'THREE_SOURCES')).toBeLessThanOrEqual(1);
  });

  it('테스트 15: confidence < shadow threshold → usableForShadow=false (NONE 외)', () => {
    // YAHOO + STALE + CONFLICT = 0.028 << 0.5 (SHADOW_THRESHOLD)
    // 단 SHADOW_ONLY/DROP_GAP_CALCULATION 은 usableForShadow=true 강제 분기 — 따라서 NONE 케이스로 검증
    // NONE 이면 always usableForShadow=false
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-06',
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(integrity.status).toBe('OK');
    const result = evaluatePriceCorrection({ integrity, yahoo: { current: 50000, previousClose: 49500 } });
    expect(result.correctionType).toBe('NONE');
    expect(result.usableForShadow).toBe(false);
    expect(result.usableForLiveEntry).toBe(false);
  });

  it('테스트 16: lineage 포함 (inputSnapshot + decisionTrace + ruleVersion=v1-readonly)', () => {
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 49500,
      currentPriceDate: '2026-05-04',
      previousClose: 49500,
      previousCloseDate: '2026-05-03',
      lastKrxTradingDate: '2026-05-06',
    });

    const result = evaluatePriceCorrection({
      integrity,
      yahoo: {
        current: 49500,
        previousClose: 49500,
        currentDate: '2026-05-04',
        previousCloseDate: '2026-05-03',
      },
      kis: {
        current: 50500,
        previousClose: 49500,
        currentDate: '2026-05-06',
        previousCloseDate: '2026-05-04',
      },
    });
    expect(result.lineage.ruleVersion).toBe('priceCorrectionEngine@v1-readonly');
    expect(result.lineage.inputSnapshot.yahoo).toBeDefined();
    expect(result.lineage.inputSnapshot.kis).toBeDefined();
    expect(result.lineage.decisionTrace.length).toBeGreaterThan(0);
    expect(result.lineage.correctionType).toBe(result.correctionType);
    expect(result.lineage.confidence).toBe(result.confidence);
    expect(result.lineage.computedAt).toBeTypeOf('string');
  });

  it('테스트 17: original 데이터 변경 0건 (input 객체 mutate 금지)', () => {
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-06',
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
    });

    const yahoo = { current: 50000, previousClose: 49500 };
    const kis = { current: 50000, previousClose: 49500 };
    const krx = { previousClose: 49500 };
    const recentDailyClose = { close: 49500, date: '2026-05-04' };

    const beforeYahoo = JSON.stringify(yahoo);
    const beforeKis = JSON.stringify(kis);
    const beforeKrx = JSON.stringify(krx);
    const beforeRecent = JSON.stringify(recentDailyClose);
    const beforeIntegrity = JSON.stringify(integrity);

    evaluatePriceCorrection({ integrity, yahoo, kis, krx, recentDailyClose });

    // input 객체 mutate 0건
    expect(JSON.stringify(yahoo)).toBe(beforeYahoo);
    expect(JSON.stringify(kis)).toBe(beforeKis);
    expect(JSON.stringify(krx)).toBe(beforeKrx);
    expect(JSON.stringify(recentDailyClose)).toBe(beforeRecent);
    expect(JSON.stringify(integrity)).toBe(beforeIntegrity);
  });

  it('보너스 1: PRICE_CORRECTION_DISABLED ENV 정확 비교 (ADR-0157 정합)', () => {
    delete process.env.PRICE_CORRECTION_DISABLED;
    expect(isPriceCorrectionDisabled()).toBe(false);

    process.env.PRICE_CORRECTION_DISABLED = 'true';
    expect(isPriceCorrectionDisabled()).toBe(true);

    process.env.PRICE_CORRECTION_DISABLED = '1';
    expect(isPriceCorrectionDisabled()).toBe(false);

    process.env.PRICE_CORRECTION_DISABLED = 'TRUE';
    expect(isPriceCorrectionDisabled()).toBe(false);

    process.env.PRICE_CORRECTION_DISABLED = 'yes';
    expect(isPriceCorrectionDisabled()).toBe(false);

    process.env.PRICE_CORRECTION_DISABLED = 'false';
    expect(isPriceCorrectionDisabled()).toBe(false);

    process.env.PRICE_CORRECTION_DISABLED = '';
    expect(isPriceCorrectionDisabled()).toBe(false);
  });

  it('보너스 2: 임계 상수 SSOT — LIVE 0.8 / SHADOW 0.5', () => {
    expect(PRICE_CORRECTION_LIVE_THRESHOLD).toBe(0.8);
    expect(PRICE_CORRECTION_SHADOW_THRESHOLD).toBe(0.5);
  });

  it('보너스 3: Stage 1 절대 원칙 #3 — usableForLiveEntry 항상 false', () => {
    // 모든 분기에서 usableForLiveEntry = false 강제 검증
    const cases = [
      // OK
      evaluatePriceCorrection({
        integrity: evaluatePriceIntegrity({
          symbol: 'A',
          currentPrice: 100,
          currentPriceDate: '2026-05-06',
          previousClose: 99,
          previousCloseDate: '2026-05-06',
          lastKrxTradingDate: '2026-05-06',
        }),
      }),
      // STALE + KIS recovery
      evaluatePriceCorrection({
        integrity: evaluatePriceIntegrity({
          symbol: 'B',
          currentPrice: 100,
          currentPriceDate: '2026-05-04',
          previousClose: 99,
          previousCloseDate: '2026-05-03',
          lastKrxTradingDate: '2026-05-06',
        }),
        kis: { current: 105, previousClose: 100 },
      }),
      // FAILED → SHADOW_ONLY
      evaluatePriceCorrection({
        integrity: evaluatePriceIntegrity({
          symbol: 'C',
          currentPrice: null,
          previousClose: null,
          lastKrxTradingDate: '2026-05-06',
        }),
      }),
    ];
    for (const c of cases) {
      expect(c.usableForLiveEntry).toBe(false);
    }
  });

  it('보너스 4: buildSkippedCorrectionResult — ENV DISABLED 시 호출자가 합성', () => {
    const skipped = buildSkippedCorrectionResult('005930', new Date('2026-05-06T10:00:00.000Z'));
    expect(skipped.symbol).toBe('005930');
    expect(skipped.correctionType).toBe('NONE');
    expect(skipped.confidence).toBe(0);
    expect(skipped.usableForLiveEntry).toBe(false);
    expect(skipped.usableForShadow).toBe(false);
    expect(skipped.reasons[0]).toContain('SKIPPED');
    expect(skipped.lineage.ruleVersion).toBe('priceCorrectionEngine@v1-readonly');
  });

  it('보너스 5: USE_RECENT_DAILY_CLOSE — 다른 출처 부재 + recentDailyClose 가용', () => {
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-04', // STALE
      previousClose: 50000,
      previousCloseDate: '2026-05-03',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(integrity.status).toBe('STALE');

    // KIS / KRX 부재 — recentDailyClose 만
    const result = evaluatePriceCorrection({
      integrity,
      yahoo: { current: 50000, previousClose: 50000 },
      recentDailyClose: { close: 49500, date: '2026-05-04' },
    });
    expect(result.correctionType).toBe('USE_RECENT_DAILY_CLOSE');
    expect(result.correctedPreviousClose).toBe(49500);
    expect(result.gapBasisDate).toBe('2026-05-04');
  });
});
