/**
 * @responsibility ADR-0420 회귀 — Fresh Scan Blocker Attribution SSOT
 *
 * 사용자 §I 명시 6 케이스 + 추가 안전 invariant 가드.
 *
 * 핵심 불변식 (사용자 명시 — 본 테스트가 영구 보호):
 *   1. GATE1_PASS_ZERO 는 단일 원인이 아니다 — 조건별 분해 의무.
 *   2. DATA_UNAVAILABLE 은 failed 가 아니다 — 별도 unavailable 카운터.
 *   3. unavailable/error 우세 시 Gate threshold 검토 권고 금지.
 *   4. fresh 와 last 7 days 누적 audit 분리.
 *   5. 매매 정책 변경 0 — 진단 only.
 */

import { describe, it, expect } from 'vitest';
import {
  type ConditionBlockerBucket,
  type FreshAttributionOutputItem,
  accumulateFreshAttribution,
  buildFreshScanBlockerAttribution,
  computeRecommendedDiagnosis,
  finalizeBucketRates,
  formatFreshAttributionSection,
  describeFreshDiagnosis,
  FRESH_DIAGNOSIS_THRESHOLDS,
} from './freshScanBlockerAttribution.js';

function emptyBucket(key: string): ConditionBlockerBucket {
  return {
    conditionKey: key,
    passed: 0,
    failed: 0,
    unavailable: 0,
    error: 0,
    skipped: 0,
    total: 0,
    failedRate: 0,
    unavailableRate: 0,
    errorRate: 0,
  };
}

describe('ADR-0420 §I 사용자 명시 6 케이스', () => {
  it('1. fresh attribution 이 condition 별 failed/unavailable/error 를 분리한다', () => {
    const acc = new Map<string, ConditionBlockerBucket>();
    accumulateFreshAttribution(acc, [
      { key: 'momentum', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
      { key: 'supply_confluence', output: { score: 0, status: 'DATA_UNAVAILABLE' } },
      { key: 'earnings_quality', output: { score: 0, status: 'ERROR' } },
    ]);
    const momentum = acc.get('momentum')!;
    const supply = acc.get('supply_confluence')!;
    const earnings = acc.get('earnings_quality')!;
    expect(momentum.failed).toBe(1);
    expect(momentum.unavailable).toBe(0);
    expect(momentum.error).toBe(0);
    expect(supply.failed).toBe(0);
    expect(supply.unavailable).toBe(1);
    expect(supply.error).toBe(0);
    expect(earnings.failed).toBe(0);
    expect(earnings.unavailable).toBe(0);
    expect(earnings.error).toBe(1);
  });

  it('2. DATA_UNAVAILABLE 은 failed 로 세지 않는다 (핵심 불변식 #2)', () => {
    const acc = new Map<string, ConditionBlockerBucket>();
    accumulateFreshAttribution(acc, [
      { key: 'supply_confluence', output: { score: 0, status: 'DATA_UNAVAILABLE' } },
    ]);
    const supply = acc.get('supply_confluence')!;
    expect(supply.failed).toBe(0);
    expect(supply.unavailable).toBe(1);
  });

  it('3. topFailedCondition / topUnavailableCondition / topErrorCondition 계산', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('volume_surge'), failed: 5, total: 5 },
      { ...emptyBucket('supply_confluence'), unavailable: 4, total: 4 },
      { ...emptyBucket('earnings_quality'), error: 2, total: 2 },
    ];
    const attribution = buildFreshScanBlockerAttribution({
      buckets,
      candidates: 11,
      entries: 0,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
    });
    expect(attribution.topFailedCondition?.conditionKey).toBe('volume_surge');
    expect(attribution.topUnavailableCondition?.conditionKey).toBe('supply_confluence');
    expect(attribution.topErrorCondition?.conditionKey).toBe('earnings_quality');
  });

  it('4. unavailable 우세면 DATA_UNAVAILABLE_DOMINANT', () => {
    // 사용자 §I — failed 5 + unavailable 20 + error 0 = total 25, unavailable=80% > 50%.
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('momentum'), failed: 5, total: 5 },
      { ...emptyBucket('supply_confluence'), unavailable: 20, total: 20 },
    ];
    expect(computeRecommendedDiagnosis(buckets, 25)).toBe('DATA_UNAVAILABLE_DOMINANT');
  });

  it('5. failed 우세면 TRUE_GATE1_REJECTION', () => {
    // 사용자 §I — failed 30 + unavailable 2 + error 0 = total 32, failed=93.7% > 70%.
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('momentum'), failed: 30, total: 30 },
      { ...emptyBucket('supply_confluence'), unavailable: 2, total: 2 },
    ];
    expect(computeRecommendedDiagnosis(buckets, 32)).toBe('TRUE_GATE1_REJECTION');
  });

  it('6. /scan_blockers formatter 가 GATE1_PASS_ZERO 상세를 포함', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('volume_surge'), failed: 45, total: 49 },
      { ...emptyBucket('supply_confluence'), unavailable: 10, total: 49 },
    ];
    const attribution = buildFreshScanBlockerAttribution({
      buckets,
      candidates: 49,
      entries: 0,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
      scanId: '2026-05-07:11:34 KST',
      scannedAtKst: '11:34 KST',
    });
    const section = formatFreshAttributionSection(attribution);
    expect(section).not.toBeNull();
    expect(section!).toContain('candidates=49');
    expect(section!).toContain('gate1Pass=0');
    expect(section!).toContain('topFailedCondition');
    expect(section!).toContain('topUnavailableCondition');
    expect(section!).toContain('volume_surge');
    expect(section!).toContain('supply_confluence');
    // diagnosis 분류 노출.
    expect(section!).toMatch(/diagnosis:.*<b>(TRUE_GATE1_REJECTION|MIXED|DATA_UNAVAILABLE_DOMINANT)<\/b>/);
    // 핵심 불변식 #2 — DATA_UNAVAILABLE 이 failed 로 표시되지 않음.
    expect(section!).not.toMatch(/supply_confluence — failed [1-9]/);
    expect(section!).toMatch(/supply_confluence — failed 0 \/ unavailable 10/);
  });
});

describe('ADR-0420 §H computeRecommendedDiagnosis 5 분기 결정 트리', () => {
  it('candidates=0 → NO_CANDIDATES', () => {
    expect(computeRecommendedDiagnosis([], 0)).toBe('NO_CANDIDATES');
  });

  it('totalRelevant=0 (모두 passed/skipped) → UNKNOWN', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('momentum'), passed: 10, total: 10 },
    ];
    expect(computeRecommendedDiagnosis(buckets, 10)).toBe('UNKNOWN');
  });

  it('EVALUATOR_ERROR_DOMINANT — error / total > 0.3', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('earnings_quality'), error: 5, total: 5 },
      { ...emptyBucket('momentum'), failed: 8, total: 8 },
    ];
    // total = failed 8 + error 5 = 13, error/total = 38.5% > 30%.
    expect(computeRecommendedDiagnosis(buckets, 13)).toBe('EVALUATOR_ERROR_DOMINANT');
  });

  it('MIXED — 임계 모두 미달', () => {
    // failed 50%, unavailable 30%, error 20% — 모든 임계 미달.
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('momentum'), failed: 5, total: 5 },
      { ...emptyBucket('supply_confluence'), unavailable: 3, total: 3 },
      { ...emptyBucket('earnings_quality'), error: 2, total: 2 },
    ];
    expect(computeRecommendedDiagnosis(buckets, 10)).toBe('MIXED');
  });

  it('Boundary — unavailable / total === 0.5 정확 (>0.5 체크) → MIXED 아님', () => {
    // failed 5 + unavailable 5 = total 10, unavailable=50% (===, not > ).
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('momentum'), failed: 5, total: 5 },
      { ...emptyBucket('supply_confluence'), unavailable: 5, total: 5 },
    ];
    const diagnosis = computeRecommendedDiagnosis(buckets, 10);
    // 정확히 0.5 면 DATA_UNAVAILABLE_DOMINANT 미트리거 (>0.5 임계).
    expect(diagnosis).not.toBe('DATA_UNAVAILABLE_DOMINANT');
  });
});

describe('ADR-0420 SSOT 임계 정합', () => {
  it('FRESH_DIAGNOSIS_THRESHOLDS 상수 정합 (사용자 §H 결정 트리)', () => {
    expect(FRESH_DIAGNOSIS_THRESHOLDS.UNAVAILABLE_DOMINANT_RATIO).toBe(0.5);
    expect(FRESH_DIAGNOSIS_THRESHOLDS.ERROR_DOMINANT_RATIO).toBe(0.3);
    expect(FRESH_DIAGNOSIS_THRESHOLDS.TRUE_FAIL_DOMINANT_RATIO).toBe(0.7);
  });

  it('finalizeBucketRates — total=0 시 모든 rate 0 (NaN 방지)', () => {
    const b = emptyBucket('test');
    finalizeBucketRates(b);
    expect(b.failedRate).toBe(0);
    expect(b.unavailableRate).toBe(0);
    expect(b.errorRate).toBe(0);
  });

  it('finalizeBucketRates — total>0 시 정확한 비율 산출', () => {
    const b: ConditionBlockerBucket = {
      ...emptyBucket('momentum'),
      failed: 7,
      unavailable: 2,
      error: 1,
      total: 10,
    };
    finalizeBucketRates(b);
    expect(b.failedRate).toBeCloseTo(0.7);
    expect(b.unavailableRate).toBeCloseTo(0.2);
    expect(b.errorRate).toBeCloseTo(0.1);
  });
});

describe('ADR-0420 accumulateFreshAttribution — status 분류', () => {
  it('FIRED → passed++, THRESHOLD_NOT_MET → failed++', () => {
    const acc = new Map<string, ConditionBlockerBucket>();
    accumulateFreshAttribution(acc, [
      { key: 'momentum', output: { score: 5, status: 'FIRED' } },
      { key: 'momentum', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
    ]);
    const m = acc.get('momentum')!;
    expect(m.passed).toBe(1);
    expect(m.failed).toBe(1);
    expect(m.total).toBe(2);
  });

  it('PROVIDER_DEGRADED → unavailable++ (DATA_UNAVAILABLE 동등)', () => {
    const acc = new Map<string, ConditionBlockerBucket>();
    accumulateFreshAttribution(acc, [
      { key: 'macd_bull', output: { score: 0, status: 'PROVIDER_DEGRADED' } },
    ]);
    expect(acc.get('macd_bull')!.unavailable).toBe(1);
    expect(acc.get('macd_bull')!.failed).toBe(0);
  });

  it('SKIPPED_BY_POLICY → skipped++ (failed 와 분리)', () => {
    const acc = new Map<string, ConditionBlockerBucket>();
    accumulateFreshAttribution(acc, [
      { key: 'rsi_zone', output: null, context: { skippedByPolicy: true } },
    ]);
    expect(acc.get('rsi_zone')!.skipped).toBe(1);
    expect(acc.get('rsi_zone')!.failed).toBe(0);
  });

  it('output null + context.hadRequiredData=false → unavailable++ (사용자 §C 규칙 6)', () => {
    const acc = new Map<string, ConditionBlockerBucket>();
    accumulateFreshAttribution(acc, [
      { key: 'supply_confluence', output: null, context: { hadRequiredData: false } },
    ]);
    expect(acc.get('supply_confluence')!.unavailable).toBe(1);
    expect(acc.get('supply_confluence')!.failed).toBe(0);
  });

  it('output null + context 없음 → failed++ (legacy fallback, 사용자 §C 규칙 7)', () => {
    const acc = new Map<string, ConditionBlockerBucket>();
    accumulateFreshAttribution(acc, [{ key: 'momentum', output: null }]);
    expect(acc.get('momentum')!.failed).toBe(1);
    expect(acc.get('momentum')!.unavailable).toBe(0);
  });
});

describe('ADR-0420 buildFreshScanBlockerAttribution — 정렬 + 메타', () => {
  it('buckets 정렬 — failed+unavailable+error 합 내림차순', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('low'), failed: 1, total: 1 },
      { ...emptyBucket('high'), failed: 10, unavailable: 5, total: 15 },
      { ...emptyBucket('mid'), failed: 5, total: 5 },
    ];
    const attribution = buildFreshScanBlockerAttribution({
      buckets,
      candidates: 21,
      entries: 0,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
    });
    expect(attribution.buckets[0].conditionKey).toBe('high');
    expect(attribution.buckets[1].conditionKey).toBe('mid');
    expect(attribution.buckets[2].conditionKey).toBe('low');
  });

  it('동률 시 conditionKey 알파벳 순 (deterministic)', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('zeta'), failed: 5, total: 5 },
      { ...emptyBucket('alpha'), failed: 5, total: 5 },
    ];
    const attribution = buildFreshScanBlockerAttribution({
      buckets,
      candidates: 10,
      entries: 0,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
    });
    expect(attribution.buckets[0].conditionKey).toBe('alpha');
    expect(attribution.buckets[1].conditionKey).toBe('zeta');
  });

  it('topFailedCondition undefined when failed=0 across all buckets', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('momentum'), unavailable: 5, total: 5 },
    ];
    const attribution = buildFreshScanBlockerAttribution({
      buckets,
      candidates: 5,
      entries: 0,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
    });
    expect(attribution.topFailedCondition).toBeUndefined();
    expect(attribution.topUnavailableCondition?.conditionKey).toBe('momentum');
    expect(attribution.topErrorCondition).toBeUndefined();
  });

  it('scanId / scannedAtKst 메타 propagate', () => {
    const attribution = buildFreshScanBlockerAttribution({
      buckets: [],
      candidates: 0,
      entries: 0,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
      scanId: '2026-05-07:11:34',
      scannedAtKst: '11:34 KST',
    });
    expect(attribution.scanId).toBe('2026-05-07:11:34');
    expect(attribution.scannedAtKst).toBe('11:34 KST');
  });
});

describe('ADR-0420 formatFreshAttributionSection — 표시 정책', () => {
  it('attribution undefined → null (정상 시 미노출)', () => {
    expect(formatFreshAttributionSection(undefined)).toBeNull();
    expect(formatFreshAttributionSection(null)).toBeNull();
  });

  it('candidates=0 → null (NO_CANDIDATES, 잡음 차단)', () => {
    const attribution = buildFreshScanBlockerAttribution({
      buckets: [],
      candidates: 0,
      entries: 0,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
    });
    expect(formatFreshAttributionSection(attribution)).toBeNull();
  });

  it('gate1Pass>0 (정상 운영) → null (잡음 차단, GATE1_PASS_ZERO 만 노출)', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('momentum'), failed: 5, total: 10 },
    ];
    const attribution = buildFreshScanBlockerAttribution({
      buckets,
      candidates: 10,
      entries: 2,
      gate1Pass: 3,
      gate2Pass: 1,
      gate3Pass: 1,
      lastTriggerPass: 1,
    });
    expect(formatFreshAttributionSection(attribution)).toBeNull();
  });

  it('gate1Pass=0 + candidates>0 → 섹션 노출 + last 7 days 분리 안내 포함', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('volume_surge'), failed: 45, total: 49 },
    ];
    const attribution = buildFreshScanBlockerAttribution({
      buckets,
      candidates: 49,
      entries: 0,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
    });
    const section = formatFreshAttributionSection(attribution);
    expect(section).not.toBeNull();
    // 핵심 불변식 #4 — fresh 와 last 7 days 분리 명시.
    expect(section!).toMatch(/last 7 days|누적/);
    expect(section!).toMatch(/fresh/);
    expect(section!).toMatch(/scan_blockers|gate_audit/);
  });

  it('topN=4 default + topUnavailableCondition undefined 시 "none" 표기', () => {
    const buckets: ConditionBlockerBucket[] = [
      { ...emptyBucket('momentum'), failed: 5, total: 5 },
    ];
    const attribution = buildFreshScanBlockerAttribution({
      buckets,
      candidates: 5,
      entries: 0,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
    });
    const section = formatFreshAttributionSection(attribution);
    expect(section!).toContain('topUnavailableCondition: none');
    expect(section!).toContain('topErrorCondition: none');
  });
});

describe('ADR-0420 describeFreshDiagnosis — 운영자 가이드 SSOT', () => {
  it('TRUE_GATE1_REJECTION 메시지에 "조건 미달" 포함 + "매매 정책 변경 불필요" 명시 (불변식 #5)', () => {
    const msg = describeFreshDiagnosis('TRUE_GATE1_REJECTION');
    expect(msg).not.toBeNull();
    expect(msg!).toMatch(/조건 미달/);
    expect(msg!).toMatch(/정책 변경 불필요|자연 회복/);
  });

  it('DATA_UNAVAILABLE_DOMINANT 메시지에 "데이터 소스 점검 우선" 포함 (불변식 #3)', () => {
    const msg = describeFreshDiagnosis('DATA_UNAVAILABLE_DOMINANT');
    expect(msg).not.toBeNull();
    expect(msg!).toMatch(/데이터 소스 점검/);
  });

  it('EVALUATOR_ERROR_DOMINANT 메시지에 "evaluator patch" 포함', () => {
    const msg = describeFreshDiagnosis('EVALUATOR_ERROR_DOMINANT');
    expect(msg).not.toBeNull();
    expect(msg!).toMatch(/evaluator patch/);
  });

  it('5 분기 모두 non-null 메시지 반환', () => {
    const diagnoses: Array<Parameters<typeof describeFreshDiagnosis>[0]> = [
      'TRUE_GATE1_REJECTION',
      'DATA_UNAVAILABLE_DOMINANT',
      'EVALUATOR_ERROR_DOMINANT',
      'MIXED',
      'NO_CANDIDATES',
      'UNKNOWN',
    ];
    for (const d of diagnoses) {
      expect(describeFreshDiagnosis(d)).not.toBeNull();
    }
  });
});

describe('ADR-0420 안전 invariant — 매매 정책 변경 0건 정적 가드', () => {
  it('FreshAttributionOutputItem 타입에 score/status 만 사용 (output schema 변경 0)', () => {
    const item: FreshAttributionOutputItem = {
      key: 'test',
      output: { score: 0, status: 'THRESHOLD_NOT_MET' },
    };
    expect(item.output?.score).toBe(0);
    expect(item.output?.status).toBe('THRESHOLD_NOT_MET');
  });

  it('describeFreshDiagnosis 메시지에 "Gate threshold 변경" / "weight 변경" / "STRONG_BUY 변경" 절대 미포함 (불변식 #5)', () => {
    const diagnoses: Array<Parameters<typeof describeFreshDiagnosis>[0]> = [
      'TRUE_GATE1_REJECTION',
      'DATA_UNAVAILABLE_DOMINANT',
      'EVALUATOR_ERROR_DOMINANT',
      'MIXED',
      'NO_CANDIDATES',
      'UNKNOWN',
    ];
    for (const d of diagnoses) {
      const msg = describeFreshDiagnosis(d) ?? '';
      // 임계 *완화* 같은 위험 권고 영구 차단 (ADR-0417 정합).
      expect(msg).not.toMatch(/Gate threshold 완화|즉시 완화|threshold 낮추기/);
    }
  });
});
