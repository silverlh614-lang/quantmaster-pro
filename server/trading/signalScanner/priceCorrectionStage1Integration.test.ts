/**
 * @responsibility ADR-0414 Stage 1 Read-Only 통합 회귀 테스트 (≥4 케이스)
 *
 * 작업 지침서 §10 18~21 — Stage 1 정책 + scanDiagnostics 표시 + ENV 우회 검증.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  evaluatePriceCorrection,
  isPriceCorrectionDisabled,
  buildSkippedCorrectionResult,
} from './priceCorrectionEngine.js';
import { evaluatePriceIntegrity } from './priceIntegrityChecker.js';
import {
  formatPriceIntegritySection,
  formatPriceCorrectionOverlaySection,
  formatScanBlockersMessage,
  type ScanSummary,
} from './scanDiagnostics.js';

beforeEach(() => {
  delete process.env.PRICE_CORRECTION_DISABLED;
});

afterEach(() => {
  delete process.env.PRICE_CORRECTION_DISABLED;
});

describe('ADR-0414 Stage 1 Read-Only 통합', () => {
  it('테스트 18: corrected 결과가 Gate / Signal / Entry 판단에 사용되지 않음 — Stage 1 invariant', () => {
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-04', // STALE
      previousClose: 50000,
      previousCloseDate: '2026-05-03',
      lastKrxTradingDate: '2026-05-06',
    });

    const result = evaluatePriceCorrection({
      integrity,
      kis: { current: 51000, previousClose: 50000 },
    });

    // Stage 1 — 모든 분기에서 usableForLiveEntry=false
    expect(result.usableForLiveEntry).toBe(false);
    // corrected 값은 산출됐으나 LIVE entry 사용 금지
    expect(result.correctedPrice).toBe(51000);
    // lineage 에 Stage 1 명시 trace 포함
    expect(
      result.lineage.decisionTrace.some((t) =>
        t.includes('Stage 1') || t.includes('usableForLiveEntry=false'),
      ),
    ).toBe(true);
  });

  it('테스트 19: scanDiagnostics 에 original vs corrected 차이 표시 (formatPriceCorrectionOverlaySection)', () => {
    const summary: ScanSummary = {
      time: '10:00 KST',
      candidates: 100,
      trackB: 50,
      swing: 30,
      catalyst: 20,
      momentum: 0,
      quoteFails: 0,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 0,
      priceIntegrity: {
        totalSamples: 100,
        statusCounts: {
          OK: 70,
          SUSPECT: 5,
          STALE: 10,
          FROZEN_QUOTE: 3,
          PRICE_BASE_MISMATCH: 5,
          REVERSE_GAP_SUSPECT: 5,
          FAILED: 2,
        },
        topAffected: [
          { symbol: '005930', status: 'STALE' },
          { symbol: '000660', status: 'PRICE_BASE_MISMATCH' },
        ],
      },
      priceCorrection: {
        totalSamples: 100,
        correctionTypeCounts: {
          NONE: 70,
          USE_KIS_CURRENT: 13,
          USE_KRX_PREV_CLOSE: 5,
          USE_RECENT_DAILY_CLOSE: 5,
          DROP_GAP_CALCULATION: 5,
          SHADOW_ONLY: 2,
        },
        averageConfidence: 0.65,
        dropGapCalculationCount: 5,
        shadowOnlySuggestedCount: 2,
      },
    };

    const integritySection = formatPriceIntegritySection(summary.priceIntegrity);
    expect(integritySection).not.toBeNull();
    expect(integritySection).toContain('Price Integrity');
    expect(integritySection).toContain('Stage 1 관측');
    expect(integritySection).toContain('STALE: 10개');
    expect(integritySection).toContain('PRICE_BASE_MISMATCH: 5개');
    expect(integritySection).toContain('매수 차단 아님');

    const correctionSection = formatPriceCorrectionOverlaySection(summary.priceCorrection);
    expect(correctionSection).not.toBeNull();
    expect(correctionSection).toContain('Price Correction Overlay');
    expect(correctionSection).toContain('Stage 1 Read-Only');
    expect(correctionSection).toContain('USE_KIS_CURRENT: 13개');
    expect(correctionSection).toContain('DROP_GAP_CALCULATION');
    expect(correctionSection).toContain('절대 원칙 #3');
    expect(correctionSection).toContain('LIVE 매수 판단 사용 0건');

    // formatScanBlockersMessage 가 두 섹션 모두 wiring
    const blockersMsg = formatScanBlockersMessage(summary);
    expect(blockersMsg).toContain('Price Integrity');
    expect(blockersMsg).toContain('Price Correction Overlay');
  });

  it('테스트 20: PRICE_CORRECTION_DISABLED=true → correction 생략 / integrity 는 실행', () => {
    process.env.PRICE_CORRECTION_DISABLED = 'true';
    expect(isPriceCorrectionDisabled()).toBe(true);

    // PriceIntegrityChecker 는 ENV 무관 — 계속 실행 가능
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 49500,
      currentPriceDate: '2026-05-04',
      previousClose: 49500,
      previousCloseDate: '2026-05-03',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(integrity.status).toBe('STALE'); // 정상 평가

    // 호출자가 ENV 검사 후 buildSkippedCorrectionResult 합성
    const skipped = buildSkippedCorrectionResult('005930');
    expect(skipped.correctionType).toBe('NONE');
    expect(skipped.reasons[0]).toContain('SKIPPED');
    expect(skipped.lineage.decisionTrace[0]).toContain('SKIPPED');
  });

  it('테스트 21: PriceIntegrityChecker 는 disabled 상태에서도 실행 가능', () => {
    process.env.PRICE_CORRECTION_DISABLED = 'true';

    // PriceIntegrityChecker 는 ENV 검사 부재 — 항상 실행
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 49500,
      currentPriceDate: '2026-05-04',
      previousClose: 49500,
      previousCloseDate: '2026-05-03',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(integrity.status).toBe('STALE');
    expect(integrity.reasons.length).toBeGreaterThan(0);
  });

  it('보너스 1: priceIntegrity OK 만 — section null', () => {
    const section = formatPriceIntegritySection({
      totalSamples: 100,
      statusCounts: {
        OK: 100,
        SUSPECT: 0,
        STALE: 0,
        FROZEN_QUOTE: 0,
        PRICE_BASE_MISMATCH: 0,
        REVERSE_GAP_SUSPECT: 0,
        FAILED: 0,
      },
      topAffected: [],
    });
    expect(section).toBeNull();
  });

  it('보너스 2: priceCorrection NONE 만 — section null', () => {
    const section = formatPriceCorrectionOverlaySection({
      totalSamples: 100,
      correctionTypeCounts: {
        NONE: 100,
        USE_KIS_CURRENT: 0,
        USE_KRX_PREV_CLOSE: 0,
        USE_RECENT_DAILY_CLOSE: 0,
        DROP_GAP_CALCULATION: 0,
        SHADOW_ONLY: 0,
      },
      averageConfidence: 1.0,
      dropGapCalculationCount: 0,
      shadowOnlySuggestedCount: 0,
    });
    expect(section).toBeNull();
  });

  it('보너스 3: priceIntegrity totalSamples=0 — section null', () => {
    const section = formatPriceIntegritySection({
      totalSamples: 0,
      statusCounts: {
        OK: 0,
        SUSPECT: 0,
        STALE: 0,
        FROZEN_QUOTE: 0,
        PRICE_BASE_MISMATCH: 0,
        REVERSE_GAP_SUSPECT: 0,
        FAILED: 0,
      },
      topAffected: [],
    });
    expect(section).toBeNull();
  });
});
