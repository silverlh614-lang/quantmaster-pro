/**
 * @responsibility ADR-0121 Price Source Policy SSOT 회귀 테스트
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateDataQuality,
  isPriceSourcePolicyDisabled,
  PRICE_SOURCE_THRESHOLDS,
  shouldAllowExecution,
  shouldQuarantine,
  type DataQualityStatus,
} from './priceSourcePolicy.js';

describe('PRICE_SOURCE_THRESHOLDS — 임계 SSOT', () => {
  it('4 임계 단조 증가 (3 < 10 < 30 < 50)', () => {
    expect(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_VALID_PCT).toBe(3);
    expect(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_WARN_PCT).toBe(10);
    expect(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_INVALID_PCT).toBe(30);
    expect(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_CORPORATE_ACTION_PCT).toBe(50);
    expect(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_VALID_PCT)
      .toBeLessThan(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_WARN_PCT);
    expect(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_WARN_PCT)
      .toBeLessThan(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_INVALID_PCT);
    expect(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_INVALID_PCT)
      .toBeLessThan(PRICE_SOURCE_THRESHOLDS.DISCREPANCY_CORPORATE_ACTION_PCT);
  });
});

describe('isPriceSourcePolicyDisabled — ENV 우회', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.PRICE_SOURCE_POLICY_DISABLED;
    delete process.env.PRICE_SOURCE_POLICY_DISABLED;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.PRICE_SOURCE_POLICY_DISABLED;
    else process.env.PRICE_SOURCE_POLICY_DISABLED = original;
  });

  it('미설정 → false', () => {
    expect(isPriceSourcePolicyDisabled()).toBe(false);
  });

  it('"true" → true', () => {
    process.env.PRICE_SOURCE_POLICY_DISABLED = 'true';
    expect(isPriceSourcePolicyDisabled()).toBe(true);
  });

  it('"false" → false', () => {
    process.env.PRICE_SOURCE_POLICY_DISABLED = 'false';
    expect(isPriceSourcePolicyDisabled()).toBe(false);
  });
});

describe('evaluateDataQuality — 가격 출처 분기', () => {
  it('KIS + Yahoo 모두 부재 → MISSING + 매수 차단', () => {
    const result = evaluateDataQuality({});
    expect(result.status).toBe('MISSING');
    expect(result.canonicalPrice).toBeNull();
    expect(result.canonicalSource).toBe('NONE');
    expect(result.allowExecution).toBe(false);
    expect(result.allowTechnicalIndicators).toBe(false);
  });

  it('KIS 부재 + Yahoo 만 있음 → STALE + 매수 차단 + 기술지표 허용', () => {
    const result = evaluateDataQuality({ yahooPrice: 50000 });
    expect(result.status).toBe('STALE');
    expect(result.canonicalPrice).toBe(50000);
    expect(result.canonicalSource).toBe('YAHOO_VALIDATED');
    expect(result.allowExecution).toBe(false);
    expect(result.allowTechnicalIndicators).toBe(true);
  });

  it('KIS 만 있음 + Yahoo 부재 → VALID + 매수 허용', () => {
    const result = evaluateDataQuality({ kisPrice: 50000 });
    expect(result.status).toBe('VALID');
    expect(result.canonicalPrice).toBe(50000);
    expect(result.canonicalSource).toBe('KIS');
    expect(result.allowExecution).toBe(true);
    expect(result.reasons).toContain('YAHOO_PRICE_MISSING');
  });
});

describe('evaluateDataQuality — 괴리율 분기', () => {
  // Patch-VITEST-CAT-F-001: ADR-0502 runtime policy migration — yahooDiagnosticOnly default true 면
  // 모든 kisValid+yahooValid 경로가 status='VALID' 단락 (priceSourcePolicy.ts:132-169). 레거시 discrepancy
  // 로직 (WARN / INVALID / CORPORATE_ACTION_SUSPECT, line 186-254) 은 YAHOO_PRICE_ROLE='ACTIVE' opt-in 필요.
  // baseline doc invariant #10 source inspection 결과: Cat C (test stale) 확정, Cat A (regression) 아님.
  // runtime 본체 0줄 변경, test 측에서 legacy mode env 활성화만 (baseline doc invariant #7).
  let originalYahooRole: string | undefined;
  beforeEach(() => {
    originalYahooRole = process.env.YAHOO_PRICE_ROLE;
    process.env.YAHOO_PRICE_ROLE = 'ACTIVE';
  });
  afterEach(() => {
    if (originalYahooRole === undefined) delete process.env.YAHOO_PRICE_ROLE;
    else process.env.YAHOO_PRICE_ROLE = originalYahooRole;
  });

  it('괴리 0% (KIS=Yahoo) → VALID', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 50000 });
    expect(result.status).toBe('VALID');
    expect(result.discrepancyPct).toBe(0);
    expect(result.allowExecution).toBe(true);
  });

  it('괴리 2% → VALID + Yahoo 보조 허용', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 51000 });
    expect(result.status).toBe('VALID');
    expect(result.discrepancyPct).toBe(2);
    expect(result.allowExecution).toBe(true);
  });

  it('괴리 정확 3% (boundary) → VALID', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 51500 });
    expect(result.status).toBe('VALID');
    expect(result.discrepancyPct).toBe(3);
    expect(result.allowExecution).toBe(true);
  });

  it('괴리 5% → WARN + 매수 허용 (KIS canonical 신뢰)', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 52500 });
    expect(result.status).toBe('WARN');
    expect(result.discrepancyPct).toBe(5);
    expect(result.allowExecution).toBe(true);
    expect(result.canonicalSource).toBe('KIS');
  });

  it('괴리 정확 10% → WARN', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 55000 });
    expect(result.status).toBe('WARN');
    expect(result.discrepancyPct).toBe(10);
    expect(result.allowExecution).toBe(true);
  });

  it('괴리 15% → INVALID + 매수 차단', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 57500 });
    expect(result.status).toBe('INVALID');
    expect(result.discrepancyPct).toBe(15);
    expect(result.allowExecution).toBe(false);
    expect(result.allowTechnicalIndicators).toBe(true); // KIS 기반은 허용
  });

  it('괴리 정확 30% → INVALID', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 65000 });
    expect(result.status).toBe('INVALID');
    expect(result.discrepancyPct).toBe(30);
    expect(result.allowExecution).toBe(false);
  });

  it('괴리 35% → CORPORATE_ACTION_SUSPECT (액면분할 의심)', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 67500 });
    expect(result.status).toBe('CORPORATE_ACTION_SUSPECT');
    expect(result.discrepancyPct).toBe(35);
    expect(result.allowExecution).toBe(false);
    expect(result.allowTechnicalIndicators).toBe(true); // 35% < 50%
    expect(result.reasons.some((r) => r.includes('CORPORATE_ACTION_SUSPECT'))).toBe(true);
  });

  it('괴리 60% → CORPORATE_ACTION_SUSPECT + HARD_QUARANTINE (50%+)', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 80000 });
    expect(result.status).toBe('CORPORATE_ACTION_SUSPECT');
    expect(result.discrepancyPct).toBe(60);
    expect(result.allowExecution).toBe(false);
    expect(result.allowTechnicalIndicators).toBe(false); // hard quarantine
    expect(result.reasons.some((r) => r.includes('HARD_QUARANTINE'))).toBe(true);
  });

  it('1차 로그 098460 시나리오 — Yahoo +221% drift → CORPORATE_ACTION_SUSPECT 차단', () => {
    // 098460 고영: KIS=15000, Yahoo=48150 (+221% 액면병합 의심)
    const result = evaluateDataQuality({ kisPrice: 15000, yahooPrice: 48150 });
    expect(result.status).toBe('CORPORATE_ACTION_SUSPECT');
    expect(result.allowExecution).toBe(false);
    expect(result.allowTechnicalIndicators).toBe(false); // 221% > 50% hard
  });
});

describe('evaluateDataQuality — 안전 가드 (NaN/Infinity/0/음수)', () => {
  it('kisPrice=0 → KIS 무효 처리', () => {
    const result = evaluateDataQuality({ kisPrice: 0, yahooPrice: 50000 });
    expect(result.status).toBe('STALE'); // KIS 무효 → Yahoo 만 있음
    expect(result.canonicalSource).toBe('YAHOO_VALIDATED');
  });

  it('kisPrice=NaN → KIS 무효 처리', () => {
    const result = evaluateDataQuality({ kisPrice: NaN, yahooPrice: 50000 });
    expect(result.status).toBe('STALE');
  });

  it('kisPrice=Infinity → KIS 무효 처리', () => {
    const result = evaluateDataQuality({ kisPrice: Infinity, yahooPrice: 50000 });
    expect(result.status).toBe('STALE');
  });

  it('kisPrice=음수 → KIS 무효 처리', () => {
    const result = evaluateDataQuality({ kisPrice: -100, yahooPrice: 50000 });
    expect(result.status).toBe('STALE');
  });

  it('yahooPrice=0 → Yahoo 무효 (KIS 만으로 VALID)', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 0 });
    expect(result.status).toBe('VALID');
    expect(result.canonicalPrice).toBe(50000);
  });

  it('yahooPrice=NaN → Yahoo 무효', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: NaN });
    expect(result.status).toBe('VALID');
  });

  it('둘 다 0 → MISSING', () => {
    const result = evaluateDataQuality({ kisPrice: 0, yahooPrice: 0 });
    expect(result.status).toBe('MISSING');
  });

  it('둘 다 NaN → MISSING', () => {
    const result = evaluateDataQuality({ kisPrice: NaN, yahooPrice: NaN });
    expect(result.status).toBe('MISSING');
  });
});

describe('evaluateDataQuality — ENV 우회', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.PRICE_SOURCE_POLICY_DISABLED;
    process.env.PRICE_SOURCE_POLICY_DISABLED = 'true';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.PRICE_SOURCE_POLICY_DISABLED;
    else process.env.PRICE_SOURCE_POLICY_DISABLED = original;
  });

  it('ENV ON + KIS 정상 → VALID + reasons[]에 PRICE_SOURCE_POLICY_DISABLED', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 80000 });
    // ENV 우회로 60% 괴리도 VALID 판정
    expect(result.status).toBe('VALID');
    expect(result.allowExecution).toBe(true);
    expect(result.reasons).toContain('PRICE_SOURCE_POLICY_DISABLED');
  });

  it('ENV ON + KIS 부재 + Yahoo 만 있음 → VALID + 매수 차단 (KIS 부재)', () => {
    const result = evaluateDataQuality({ yahooPrice: 50000 });
    expect(result.status).toBe('VALID');
    expect(result.canonicalSource).toBe('YAHOO_VALIDATED');
    expect(result.allowExecution).toBe(false); // KIS 부재라 차단
  });
});

describe('shouldAllowExecution + shouldQuarantine — 호출자 가드 SSOT', () => {
  // Patch-VITEST-CAT-F-001: ADR-0502 runtime policy migration — yahooDiagnosticOnly default true 면
  // 모든 kisValid+yahooValid 경로가 status='VALID' 단락 (priceSourcePolicy.ts:132-169). 레거시 discrepancy
  // 로직 (WARN / INVALID / CORPORATE_ACTION_SUSPECT, line 186-254) 은 YAHOO_PRICE_ROLE='ACTIVE' opt-in 필요.
  // baseline doc invariant #10 source inspection 결과: Cat C (test stale) 확정, Cat A (regression) 아님.
  // runtime 본체 0줄 변경, test 측에서 legacy mode env 활성화만 (baseline doc invariant #7).
  let originalYahooRole: string | undefined;
  beforeEach(() => {
    originalYahooRole = process.env.YAHOO_PRICE_ROLE;
    process.env.YAHOO_PRICE_ROLE = 'ACTIVE';
  });
  afterEach(() => {
    if (originalYahooRole === undefined) delete process.env.YAHOO_PRICE_ROLE;
    else process.env.YAHOO_PRICE_ROLE = originalYahooRole;
  });

  it('VALID → 매수 허용 + 격리 안 함', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 50500 });
    expect(shouldAllowExecution(result)).toBe(true);
    expect(shouldQuarantine(result.status)).toBe(false);
  });

  it('WARN → 매수 허용 + 격리 안 함', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 53000 });
    expect(shouldAllowExecution(result)).toBe(true);
    expect(shouldQuarantine(result.status)).toBe(false);
  });

  it('INVALID → 매수 차단 + 격리', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 60000 });
    expect(shouldAllowExecution(result)).toBe(false);
    expect(shouldQuarantine(result.status)).toBe(true);
  });

  it('CORPORATE_ACTION_SUSPECT → 매수 차단 + 격리', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 70000 });
    expect(shouldAllowExecution(result)).toBe(false);
    expect(shouldQuarantine(result.status)).toBe(true);
  });

  it('STALE → 매수 차단 + 격리', () => {
    const result = evaluateDataQuality({ yahooPrice: 50000 });
    expect(shouldAllowExecution(result)).toBe(false);
    expect(shouldQuarantine(result.status)).toBe(true);
  });

  it('MISSING → 매수 차단 + 격리', () => {
    const result = evaluateDataQuality({});
    expect(shouldAllowExecution(result)).toBe(false);
    expect(shouldQuarantine(result.status)).toBe(true);
  });

  it('shouldQuarantine 직접 호출 — 6 status 분기 정합', () => {
    const matrix: Record<DataQualityStatus, boolean> = {
      VALID: false,
      WARN: false,
      INVALID: true,
      CORPORATE_ACTION_SUSPECT: true,
      STALE: true,
      MISSING: true,
    };
    for (const [status, expected] of Object.entries(matrix)) {
      expect(shouldQuarantine(status as DataQualityStatus)).toBe(expected);
    }
  });
});
