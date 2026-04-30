// @responsibility ADR-0113 corporateActionDetector 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CORPORATE_ACTION_THRESHOLDS,
  detectCorporateAction,
  isCorporateActionDetectorDisabled,
  type CorporateActionResult,
} from './corporateActionDetector.js';

const ORIGINAL_ENV = process.env.CORPORATE_ACTION_DETECTOR_DISABLED;

beforeEach(() => {
  delete process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
  else process.env.CORPORATE_ACTION_DETECTOR_DISABLED = ORIGINAL_ENV;
});

describe('CORPORATE_ACTION_THRESHOLDS SSOT', () => {
  it('STRONG_DRIFT_PCT = 150', () => {
    expect(CORPORATE_ACTION_THRESHOLDS.STRONG_DRIFT_PCT).toBe(150);
  });
  it('RIGHTS 윈도우 정합 50~150', () => {
    expect(CORPORATE_ACTION_THRESHOLDS.RIGHTS_DRIFT_MIN).toBe(50);
    expect(CORPORATE_ACTION_THRESHOLDS.RIGHTS_DRIFT_MAX).toBe(150);
  });
});

describe('isCorporateActionDetectorDisabled', () => {
  it('미설정 → false', () => {
    expect(isCorporateActionDetectorDisabled()).toBe(false);
  });
  it('"true" → 우회 활성', () => {
    process.env.CORPORATE_ACTION_DETECTOR_DISABLED = 'true';
    expect(isCorporateActionDetectorDisabled()).toBe(true);
  });
});

describe('detectCorporateAction — 분류 규칙', () => {
  it('+221% (1차 로그 098460) → SPLIT detected', () => {
    const r = detectCorporateAction({ driftPct: 221 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('SPLIT');
    expect(r.driftPct).toBe(221);
    expect(r.reason).toMatch(/strong_positive_drift/);
  });

  it('+207% (1차 로그 336260) → SPLIT detected', () => {
    const r = detectCorporateAction({ driftPct: 207 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('SPLIT');
  });

  it('-200% (분할 후 가격 하락 의심) → SPLIT detected', () => {
    const r = detectCorporateAction({ driftPct: -200 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('SPLIT');
    expect(r.reason).toMatch(/strong_negative_drift/);
  });

  it('boundary +151% → SPLIT', () => {
    const r = detectCorporateAction({ driftPct: 151 });
    expect(r.detected).toBe(true);
  });

  it('boundary +150% 정확 → 미감지 (경계는 INVALID 영역)', () => {
    // 임계는 *초과* (>) 만 강제 의심 — 150 정확은 INVALID 처리 (safePctChange)
    const r = detectCorporateAction({ driftPct: 150 });
    expect(r.detected).toBe(false);
  });

  it('+100% AND windowDays=1 → RIGHTS detected', () => {
    const r = detectCorporateAction({ driftPct: 100, windowDays: 1 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('RIGHTS');
    expect(r.reason).toMatch(/1d_drift.*rights/);
  });

  it('+50% AND windowDays=1 → RIGHTS (경계 하한)', () => {
    const r = detectCorporateAction({ driftPct: 50, windowDays: 1 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('RIGHTS');
  });

  it('+150% AND windowDays=1 — RIGHTS 윈도우 안이라 RIGHTS 분류', () => {
    // 150 은 RIGHTS_DRIFT_MAX (≤) 라 RIGHTS 로 잡힘 (STRONG 은 > 150)
    const r = detectCorporateAction({ driftPct: 150, windowDays: 1 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('RIGHTS');
  });

  it('+45% AND windowDays=1 → 미감지 (RIGHTS 임계 미달)', () => {
    const r = detectCorporateAction({ driftPct: 45, windowDays: 1 });
    expect(r.detected).toBe(false);
  });

  it('+100% AND windowDays=5 → 미감지 (1d 윈도우 아님)', () => {
    const r = detectCorporateAction({ driftPct: 100, windowDays: 5 });
    expect(r.detected).toBe(false);
  });

  it('+100% AND windowDays 미명시 → 미감지', () => {
    const r = detectCorporateAction({ driftPct: 100 });
    expect(r.detected).toBe(false);
  });

  it('+10% (정상) → 미감지', () => {
    const r = detectCorporateAction({ driftPct: 10 });
    expect(r.detected).toBe(false);
    expect(r.type).toBe('UNKNOWN');
  });

  it('NaN → 미감지 + invalid_drift reason', () => {
    const r = detectCorporateAction({ driftPct: NaN });
    expect(r.detected).toBe(false);
    expect(r.reason).toBe('invalid_drift');
  });

  it('Infinity → 미감지', () => {
    const r = detectCorporateAction({ driftPct: Infinity });
    expect(r.detected).toBe(false);
  });

  it('ENV CORPORATE_ACTION_DETECTOR_DISABLED=true → 항상 미감지', () => {
    process.env.CORPORATE_ACTION_DETECTOR_DISABLED = 'true';
    const r = detectCorporateAction({ driftPct: 300 });
    expect(r.detected).toBe(false);
    expect(r.type).toBe('UNKNOWN');
  });

  it('result 시그니처 — 모든 필드 존재', () => {
    const r: CorporateActionResult = detectCorporateAction({ driftPct: 100 });
    expect(typeof r.detected).toBe('boolean');
    expect(typeof r.type).toBe('string');
    expect(typeof r.driftPct).toBe('number');
    expect(typeof r.reason).toBe('string');
  });
});
