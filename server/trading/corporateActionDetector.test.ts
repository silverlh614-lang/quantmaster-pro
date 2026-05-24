// @responsibility ADR-0113 + ADR-0301 corporateActionDetector 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activeAbsoluteDeadZoneLimit,
  activeCorporateActionGapThresholdPct,
  activeRightsDriftMaxPct,
  activeStrongDriftPct,
  CORPORATE_ACTION_GAP_THRESHOLD_PCT,
  CORPORATE_ACTION_THRESHOLDS,
  detectCorporateAction,
  isAbsoluteDeadZoneDrift,
  isCorporateActionDetectorDisabled,
  isCorporateActionLegacyThresholds,
  isDailyBarVerificationDisabled,
  isStrongDriftSuspected,
  KRX_DAILY_PRICE_LIMIT_PCT,
  verifyDailyBarContinuity,
  type CorporateActionResult,
  type DailyBarLike,
} from './corporateActionDetector.js';

const ORIGINAL_DISABLED = process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
const ORIGINAL_LEGACY = process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS;
const ORIGINAL_GAP = process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT;
const ORIGINAL_DAILYBAR_DISABLED = process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;

beforeEach(() => {
  delete process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
  delete process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS;
  delete process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT;
  delete process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
  else process.env.CORPORATE_ACTION_DETECTOR_DISABLED = ORIGINAL_DISABLED;
  if (ORIGINAL_LEGACY === undefined) delete process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS;
  else process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS = ORIGINAL_LEGACY;
  if (ORIGINAL_GAP === undefined) delete process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT;
  else process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT = ORIGINAL_GAP;
  if (ORIGINAL_DAILYBAR_DISABLED === undefined) delete process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;
  else process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = ORIGINAL_DAILYBAR_DISABLED;
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

// ── ADR-0518: 일봉 연속성 검증 ────────────────────────────────────────────────

/** old→new 순서로, base 부터 매일 dailyPct% 씩 변동하는 candle 배열 생성. */
function buildContinuousCandles(base: number, dailyPct: number, count: number, startDate = '20260101'): DailyBarLike[] {
  const out: DailyBarLike[] = [];
  let close = base;
  let dateNum = parseInt(startDate, 10);
  for (let i = 0; i < count; i++) {
    out.push({ date: String(dateNum), close: Math.round(close) });
    close = close * (1 + dailyPct / 100);
    dateNum += 1; // 테스트용 단순 증가 (YYYYMMDD 단조성만 필요)
  }
  return out;
}

describe('ADR-0518 상수/ENV 헬퍼', () => {
  it('KRX_DAILY_PRICE_LIMIT_PCT = 30, CORPORATE_ACTION_GAP_THRESHOLD_PCT = 35', () => {
    expect(KRX_DAILY_PRICE_LIMIT_PCT).toBe(30);
    expect(CORPORATE_ACTION_GAP_THRESHOLD_PCT).toBe(35);
  });

  it('activeCorporateActionGapThresholdPct — 미설정 시 35', () => {
    expect(activeCorporateActionGapThresholdPct()).toBe(35);
  });

  it('(g) ENV CORPORATE_ACTION_GAP_THRESHOLD_PCT override 반영 (유한 & >0)', () => {
    process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT = '50';
    expect(activeCorporateActionGapThresholdPct()).toBe(50);
    process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT = '0';
    expect(activeCorporateActionGapThresholdPct()).toBe(35); // 0 거부
    process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT = 'abc';
    expect(activeCorporateActionGapThresholdPct()).toBe(35); // 비유한 거부
    process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT = '-10';
    expect(activeCorporateActionGapThresholdPct()).toBe(35); // 음수 거부
  });

  it('(h) isDailyBarVerificationDisabled — ADR-0157 정확 비교', () => {
    expect(isDailyBarVerificationDisabled()).toBe(false);
    process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = 'true';
    expect(isDailyBarVerificationDisabled()).toBe(true);
    process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = '1';
    expect(isDailyBarVerificationDisabled()).toBe(false);
    process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = 'TRUE';
    expect(isDailyBarVerificationDisabled()).toBe(false);
  });
});

describe('verifyDailyBarContinuity (ADR-0518 PURE)', () => {
  it('(a) 피엠티형 — 4745→9470 까지 매일 ≤+15% 연속 상승 → GENUINE_RALLY', () => {
    // 4745 * 1.05^14 ≈ 9395 — 단일일 +5% 연속, 갭 없음
    const candles = buildContinuousCandles(4745, 5, 15);
    const v = verifyDailyBarContinuity(candles);
    expect(v.status).toBe('GENUINE_RALLY');
    expect(v.maxSingleDayMovePct).not.toBeNull();
    expect(v.maxSingleDayMovePct!).toBeLessThanOrEqual(35);
    expect(v.barsExamined).toBe(15);
    expect(v.gapDate).toBeUndefined();
    expect(v.reason).toMatch(/genuine_rally/);
  });

  it('(b) 어느 하루 +100% 점프 → CONFIRMED + gapDate', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 5000 },
      { date: '20260102', close: 5100 },
      { date: '20260103', close: 10200 }, // +100% 점프
      { date: '20260104', close: 10300 },
    ];
    const v = verifyDailyBarContinuity(candles);
    expect(v.status).toBe('CONFIRMED');
    expect(v.gapDate).toBe('20260103');
    expect(v.maxSingleDayMovePct!).toBeGreaterThan(35);
    expect(v.reason).toMatch(/corporate_action_confirmed/);
  });

  it('(c) -50% 점프 → CONFIRMED (절댓값)', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 10000 },
      { date: '20260102', close: 5000 }, // -50%
      { date: '20260103', close: 5100 },
    ];
    const v = verifyDailyBarContinuity(candles);
    expect(v.status).toBe('CONFIRMED');
    expect(v.gapDate).toBe('20260102');
    expect(v.maxSingleDayMovePct!).toBeCloseTo(50, 1);
  });

  it('(d) candle 0개 → UNVERIFIABLE', () => {
    const v = verifyDailyBarContinuity([]);
    expect(v.status).toBe('UNVERIFIABLE');
    expect(v.maxSingleDayMovePct).toBeNull();
    expect(v.barsExamined).toBe(0);
  });

  it('(d) candle 1개 → UNVERIFIABLE', () => {
    const v = verifyDailyBarContinuity([{ date: '20260101', close: 5000 }]);
    expect(v.status).toBe('UNVERIFIABLE');
    expect(v.barsExamined).toBe(1);
  });

  it('(e) 경계 — 정확히 +30% 단일일 → GENUINE_RALLY (≤35)', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 10000 },
      { date: '20260102', close: 13000 }, // +30%
    ];
    const v = verifyDailyBarContinuity(candles);
    expect(v.status).toBe('GENUINE_RALLY');
    expect(v.maxSingleDayMovePct!).toBeCloseTo(30, 1);
  });

  it('(e) 경계 — +36% 단일일 → CONFIRMED (>35)', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 10000 },
      { date: '20260102', close: 13600 }, // +36%
    ];
    const v = verifyDailyBarContinuity(candles);
    expect(v.status).toBe('CONFIRMED');
    expect(v.maxSingleDayMovePct!).toBeCloseTo(36, 1);
  });

  it('(e) 경계 — +34% 단일일 → GENUINE_RALLY (임계 35 미만)', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 10000 },
      { date: '20260102', close: 13400 }, // +34% < 35
    ];
    const v = verifyDailyBarContinuity(candles);
    expect(v.status).toBe('GENUINE_RALLY');
  });

  it('(f) sinceDate 이전에만 갭, 이후 평탄 → GENUINE_RALLY', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 5000 },
      { date: '20260102', close: 11000 }, // +120% 갭 (sinceDate 이전 — 무시)
      { date: '20260301', close: 11100 },
      { date: '20260302', close: 11500 }, // sinceDate 이후 평탄
      { date: '20260303', close: 11600 },
    ];
    const v = verifyDailyBarContinuity(candles, { sinceDate: '2026-02-15T00:00:00Z' });
    expect(v.status).toBe('GENUINE_RALLY');
    expect(v.barsExamined).toBe(3); // 0301/0302/0303 만 스캔
    expect(v.maxSingleDayMovePct!).toBeLessThanOrEqual(35);
  });

  it('(f) sinceDate 이후 구간에 갭 → CONFIRMED', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 5000 },
      { date: '20260301', close: 5100 },
      { date: '20260302', close: 10500 }, // sinceDate 이후 +100% 갭
    ];
    const v = verifyDailyBarContinuity(candles, { sinceDate: '20260215' });
    expect(v.status).toBe('CONFIRMED');
    expect(v.gapDate).toBe('20260302');
  });

  it('(g) ENV gap threshold override — +40% 단일일이 임계 50 미만 → GENUINE_RALLY', () => {
    process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT = '50';
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 10000 },
      { date: '20260102', close: 14000 }, // +40% < 50
    ];
    const v = verifyDailyBarContinuity(candles);
    expect(v.status).toBe('GENUINE_RALLY');
  });

  it('opts.thresholdPct 명시 override 우선', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 10000 },
      { date: '20260102', close: 14000 }, // +40%
    ];
    expect(verifyDailyBarContinuity(candles, { thresholdPct: 50 }).status).toBe('GENUINE_RALLY');
    expect(verifyDailyBarContinuity(candles, { thresholdPct: 35 }).status).toBe('CONFIRMED');
  });

  it('close<=0 쌍은 건너뜀 — 유효 쌍 없으면 UNVERIFIABLE', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 0 },
      { date: '20260102', close: -5 },
    ];
    const v = verifyDailyBarContinuity(candles);
    expect(v.status).toBe('UNVERIFIABLE');
  });

  it('NaN close — 비유한 쌍 건너뜀, 정상 쌍만 평가', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: NaN },
      { date: '20260102', close: 10000 },
      { date: '20260103', close: 10500 }, // 유효 +5%
    ];
    const v = verifyDailyBarContinuity(candles);
    expect(v.status).toBe('GENUINE_RALLY');
  });

  it('sinceDate 이후 candle <2개 → UNVERIFIABLE (보수적)', () => {
    const candles: DailyBarLike[] = [
      { date: '20260101', close: 5000 },
      { date: '20260301', close: 5100 },
    ];
    const v = verifyDailyBarContinuity(candles, { sinceDate: '20260201' });
    expect(v.status).toBe('UNVERIFIABLE'); // 0301 1개만
  });
});
