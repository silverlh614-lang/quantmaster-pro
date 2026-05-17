// @responsibility ADR-0113 + ADR-0301 corporateActionDetector 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activeAbsoluteDeadZoneLimit,
  activeRightsDriftMaxPct,
  activeStrongDriftPct,
  CORPORATE_ACTION_THRESHOLDS,
  detectCorporateAction,
  isAbsoluteDeadZoneDrift,
  isCorporateActionDetectorDisabled,
  isCorporateActionLegacyThresholds,
  isStrongDriftSuspected,
  type CorporateActionResult,
} from './corporateActionDetector.js';

const ORIGINAL_DISABLED = process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
const ORIGINAL_LEGACY = process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS;

beforeEach(() => {
  delete process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
  delete process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS;
});

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
  else process.env.CORPORATE_ACTION_DETECTOR_DISABLED = ORIGINAL_DISABLED;
  if (ORIGINAL_LEGACY === undefined) delete process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS;
  else process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = ORIGINAL_LEGACY;
});

describe('CORPORATE_ACTION_THRESHOLDS SSOT (ADR-0301)', () => {
  it('STRONG_DRIFT_PCT default = 80 (ADR-0301 — 2:1 분할 +100% 포함)', () => {
    expect(CORPORATE_ACTION_THRESHOLDS.STRONG_DRIFT_PCT).toBe(80);
  });
  it('RIGHTS 윈도우 정합 50~80 (STRONG 임계와 정합)', () => {
    expect(CORPORATE_ACTION_THRESHOLDS.RIGHTS_DRIFT_MIN).toBe(50);
    expect(CORPORATE_ACTION_THRESHOLDS.RIGHTS_DRIFT_MAX).toBe(80);
  });
  it('ABSOLUTE_DEAD_ZONE_LIMIT = 250 (실제 데이터 오염 영역)', () => {
    expect(CORPORATE_ACTION_THRESHOLDS.ABSOLUTE_DEAD_ZONE_LIMIT).toBe(250);
  });
  it('LEGACY 임계 SSOT (150/150) — ENV 우회 활성 시 적용', () => {
    expect(CORPORATE_ACTION_THRESHOLDS.LEGACY_STRONG_DRIFT_PCT).toBe(150);
    expect(CORPORATE_ACTION_THRESHOLDS.LEGACY_RIGHTS_DRIFT_MAX).toBe(150);
  });
});

describe('isCorporateActionLegacyThresholds — ENV gate (ADR-0301, ADR-0157 정확 비교)', () => {
  it('미설정 → false (default ADR-0301 임계)', () => {
    expect(isCorporateActionLegacyThresholds()).toBe(false);
  });
  it('"true" → 우회 활성', () => {
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = 'true';
    expect(isCorporateActionLegacyThresholds()).toBe(true);
  });
  it('"1" / "TRUE" / "yes" → 거부 (정확 비교)', () => {
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = '1';
    expect(isCorporateActionLegacyThresholds()).toBe(false);
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = 'TRUE';
    expect(isCorporateActionLegacyThresholds()).toBe(false);
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = 'yes';
    expect(isCorporateActionLegacyThresholds()).toBe(false);
  });
});

describe('활성 임계 헬퍼 (ADR-0301)', () => {
  it('default — STRONG=80, RIGHTS_MAX=80, DEAD_ZONE=250', () => {
    expect(activeStrongDriftPct()).toBe(80);
    expect(activeRightsDriftMaxPct()).toBe(80);
    expect(activeAbsoluteDeadZoneLimit()).toBe(250);
  });
  it('legacy ENV → STRONG=150, RIGHTS_MAX=150, DEAD_ZONE=Infinity', () => {
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = 'true';
    expect(activeStrongDriftPct()).toBe(150);
    expect(activeRightsDriftMaxPct()).toBe(150);
    expect(activeAbsoluteDeadZoneLimit()).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('isStrongDriftSuspected (ADR-0301)', () => {
  it('+100% (2:1 분할) → true (default 80 초과)', () => {
    expect(isStrongDriftSuspected(100)).toBe(true);
  });
  it('+85% → true (default 80 초과)', () => {
    expect(isStrongDriftSuspected(85)).toBe(true);
  });
  it('-100% → true (절댓값)', () => {
    expect(isStrongDriftSuspected(-100)).toBe(true);
  });
  it('+80% 정확 → false (초과 비교, > 만)', () => {
    expect(isStrongDriftSuspected(80)).toBe(false);
  });
  it('+50% → false (default 임계 미달)', () => {
    expect(isStrongDriftSuspected(50)).toBe(false);
  });
  it('legacy ENV — +100% → false (legacy 150 미달)', () => {
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = 'true';
    expect(isStrongDriftSuspected(100)).toBe(false);
  });
  it('NaN → false', () => {
    expect(isStrongDriftSuspected(NaN)).toBe(false);
  });
  it('Infinity → false', () => {
    expect(isStrongDriftSuspected(Infinity)).toBe(false);
  });
});

describe('isAbsoluteDeadZoneDrift (ADR-0301)', () => {
  it('+260% → true (default 250 초과)', () => {
    expect(isAbsoluteDeadZoneDrift(260)).toBe(true);
  });
  it('-300% → true (절댓값)', () => {
    expect(isAbsoluteDeadZoneDrift(-300)).toBe(true);
  });
  it('+250% 정확 → false (초과 비교)', () => {
    expect(isAbsoluteDeadZoneDrift(250)).toBe(false);
  });
  it('+200% → false', () => {
    expect(isAbsoluteDeadZoneDrift(200)).toBe(false);
  });
  it('legacy ENV — +1000% → false (legacy DEAD_ZONE=Infinity, 영구 미감지)', () => {
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = 'true';
    expect(isAbsoluteDeadZoneDrift(1000)).toBe(false);
  });
  it('NaN/Infinity → false', () => {
    expect(isAbsoluteDeadZoneDrift(NaN)).toBe(false);
    expect(isAbsoluteDeadZoneDrift(Infinity)).toBe(false);
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

  it('+100% (2:1 분할 시나리오) → SPLIT detected (ADR-0301 — default 80 초과)', () => {
    const r = detectCorporateAction({ driftPct: 100 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('SPLIT');
    expect(r.reason).toMatch(/strong_positive_drift/);
  });

  it('boundary +81% → SPLIT (ADR-0301 — default 80 초과)', () => {
    const r = detectCorporateAction({ driftPct: 81 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('SPLIT');
  });

  it('boundary +80% 정확 → RIGHTS (windowDays=1) 또는 미감지 (초과 비교)', () => {
    // 80 은 STRONG (>) 미달 + RIGHTS_MAX (≤) 통과 — windowDays=1 이면 RIGHTS
    const rWithDay = detectCorporateAction({ driftPct: 80, windowDays: 1 });
    expect(rWithDay.detected).toBe(true);
    expect(rWithDay.type).toBe('RIGHTS');
    // windowDays 미명시 → 미감지
    const rNoDay = detectCorporateAction({ driftPct: 80 });
    expect(rNoDay.detected).toBe(false);
  });

  it('+70% AND windowDays=1 → RIGHTS detected (50~80 윈도우 안)', () => {
    const r = detectCorporateAction({ driftPct: 70, windowDays: 1 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('RIGHTS');
    expect(r.reason).toMatch(/1d_drift.*rights/);
  });

  it('+50% AND windowDays=1 → RIGHTS (경계 하한)', () => {
    const r = detectCorporateAction({ driftPct: 50, windowDays: 1 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('RIGHTS');
  });

  it('+100% AND windowDays=1 → SPLIT (ADR-0301 — STRONG 우선, RIGHTS 윈도우 외)', () => {
    // ADR-0301 default: STRONG=80, RIGHTS_MAX=80 정합 → +100 > 80 → SPLIT 우선
    const r = detectCorporateAction({ driftPct: 100, windowDays: 1 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('SPLIT');
  });

  it('legacy ENV — +100% AND windowDays=1 → RIGHTS (legacy 150 임계 복원)', () => {
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = 'true';
    const r = detectCorporateAction({ driftPct: 100, windowDays: 1 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('RIGHTS');
  });

  it('legacy ENV — +151% → SPLIT (legacy 150 초과 정합)', () => {
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = 'true';
    const r = detectCorporateAction({ driftPct: 151 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('SPLIT');
  });

  it('legacy ENV — +85% → 미감지 (legacy 150 미달, windowDays 미명시)', () => {
    process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = 'true';
    const r = detectCorporateAction({ driftPct: 85 });
    expect(r.detected).toBe(false);
  });

  it('+45% AND windowDays=1 → 미감지 (RIGHTS 임계 미달)', () => {
    const r = detectCorporateAction({ driftPct: 45, windowDays: 1 });
    expect(r.detected).toBe(false);
  });

  // ADR-0301 정합: RIGHTS_DRIFT_MAX 150→80 + |drift|>80% → STRONG drift → SPLIT (windowDays 무관)
  it('+100% AND windowDays=5 → SPLIT 감지 (ADR-0301 STRONG drift >80%)', () => {
    const r = detectCorporateAction({ driftPct: 100, windowDays: 5 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('SPLIT');
  });

  // ADR-0301 정합: windowDays 미명시여도 STRONG drift >80% → SPLIT
  it('+100% AND windowDays 미명시 → SPLIT 감지 (ADR-0301 STRONG drift >80%)', () => {
    const r = detectCorporateAction({ driftPct: 100 });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('SPLIT');
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
