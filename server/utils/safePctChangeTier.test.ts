// @responsibility ADR-0113 drift 4단계 tier 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyDriftTier,
  DRIFT_TIER_THRESHOLDS,
  isDriftTieredSanityDisabled,
  safePctChangeDetailed,
  __resetSafePctChangeWarnsForTests,
} from './safePctChange.js';

const ORIGINAL_ENV = process.env.DRIFT_TIERED_SANITY_DISABLED;

beforeEach(() => {
  delete process.env.DRIFT_TIERED_SANITY_DISABLED;
  __resetSafePctChangeWarnsForTests();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.DRIFT_TIERED_SANITY_DISABLED;
  else process.env.DRIFT_TIERED_SANITY_DISABLED = ORIGINAL_ENV;
});

describe('DRIFT_TIER_THRESHOLDS SSOT', () => {
  it('4단계 임계값 정합 (NORMAL < WARN < INVALID < CORPORATE_ACTION)', () => {
    expect(DRIFT_TIER_THRESHOLDS.NORMAL_MAX).toBe(25);
    expect(DRIFT_TIER_THRESHOLDS.WARN_MAX).toBe(60);
    expect(DRIFT_TIER_THRESHOLDS.INVALID_MAX).toBe(150);
    expect(DRIFT_TIER_THRESHOLDS.CORPORATE_ACTION_MIN).toBe(150);
  });
  it('순서 일관성 — NORMAL < WARN < INVALID = CORPORATE_ACTION_MIN', () => {
    const t = DRIFT_TIER_THRESHOLDS;
    expect(t.NORMAL_MAX).toBeLessThan(t.WARN_MAX);
    expect(t.WARN_MAX).toBeLessThan(t.INVALID_MAX);
    expect(t.INVALID_MAX).toBe(t.CORPORATE_ACTION_MIN);
  });
});

describe('classifyDriftTier — 4단계 분류 SSOT', () => {
  it('NORMAL — 0%', () => {
    expect(classifyDriftTier(0)).toBe('NORMAL');
  });
  it('NORMAL — 24.99%', () => {
    expect(classifyDriftTier(24.99)).toBe('NORMAL');
  });
  it('WARN — 25%', () => {
    expect(classifyDriftTier(25)).toBe('WARN');
  });
  it('WARN — 50%', () => {
    expect(classifyDriftTier(50)).toBe('WARN');
  });
  it('WARN — 59.99%', () => {
    expect(classifyDriftTier(59.99)).toBe('WARN');
  });
  it('INVALID — 60%', () => {
    expect(classifyDriftTier(60)).toBe('INVALID');
  });
  it('INVALID — 100%', () => {
    expect(classifyDriftTier(100)).toBe('INVALID');
  });
  it('INVALID — 149.99%', () => {
    expect(classifyDriftTier(149.99)).toBe('INVALID');
  });
  it('CORPORATE_ACTION — 150%', () => {
    expect(classifyDriftTier(150)).toBe('CORPORATE_ACTION');
  });
  it('CORPORATE_ACTION — 1차 로그 098460 (221%)', () => {
    expect(classifyDriftTier(221)).toBe('CORPORATE_ACTION');
  });
  it('CORPORATE_ACTION — 1차 로그 336260 (207%)', () => {
    expect(classifyDriftTier(207)).toBe('CORPORATE_ACTION');
  });
  it('NaN → CORPORATE_ACTION 보수적 fallback', () => {
    expect(classifyDriftTier(NaN)).toBe('CORPORATE_ACTION');
  });
  it('Infinity → CORPORATE_ACTION', () => {
    expect(classifyDriftTier(Infinity)).toBe('CORPORATE_ACTION');
  });
});

describe('isDriftTieredSanityDisabled — ENV 우회', () => {
  it('미설정 → false (4단계 활성)', () => {
    expect(isDriftTieredSanityDisabled()).toBe(false);
  });
  it('"true" → 우회 활성', () => {
    process.env.DRIFT_TIERED_SANITY_DISABLED = 'true';
    expect(isDriftTieredSanityDisabled()).toBe(true);
  });
  it('"false" → 비활성', () => {
    process.env.DRIFT_TIERED_SANITY_DISABLED = 'false';
    expect(isDriftTieredSanityDisabled()).toBe(false);
  });
});

describe('safePctChangeDetailed — 4단계 분기 통합', () => {
  it('NORMAL 5% → valid + tier=NORMAL', () => {
    const r = safePctChangeDetailed(105, 100, { silent: true });
    expect(r.valid).toBe(true);
    expect(r.value).toBeCloseTo(5, 5);
    expect(r.tier).toBe('NORMAL');
    expect(r.reason).toBe('OK');
  });

  it('WARN 30% → valid (tier=WARN, 진단 마커)', () => {
    const r = safePctChangeDetailed(130, 100, { silent: true });
    expect(r.valid).toBe(true);
    expect(r.value).toBeCloseTo(30, 5);
    expect(r.tier).toBe('WARN');
    expect(r.reason).toBe('OK');
  });

  it('WARN 50% — value 사용 가능', () => {
    const r = safePctChangeDetailed(150, 100, { silent: true });
    expect(r.valid).toBe(true);
    expect(r.tier).toBe('WARN');
  });

  it('INVALID 80% → valid=false + tier=INVALID', () => {
    const r = safePctChangeDetailed(180, 100, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.value).toBe(0);
    expect(r.tier).toBe('INVALID');
    expect(r.reason).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
  });

  it('1차 로그 027360 아주IB투자 -86.34% → INVALID', () => {
    const r = safePctChangeDetailed(2555, 18700, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.tier).toBe('INVALID');
    expect(r.reason).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
  });

  it('CORPORATE_ACTION 200% → reason=CORPORATE_ACTION_SUSPECTED + tier=CORPORATE_ACTION', () => {
    const r = safePctChangeDetailed(300, 100, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.value).toBe(0);
    expect(r.tier).toBe('CORPORATE_ACTION');
    expect(r.reason).toBe('CORPORATE_ACTION_SUSPECTED');
  });

  it('1차 로그 098460 고영 (221% drift) → CORPORATE_ACTION', () => {
    // drift = (40500 - 12610) / 12610 * 100 ≈ 221.17%
    const r = safePctChangeDetailed(40500, 12610, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.tier).toBe('CORPORATE_ACTION');
    expect(r.reason).toBe('CORPORATE_ACTION_SUSPECTED');
  });

  it('1차 로그 336260 두산테스나 (207% drift) → CORPORATE_ACTION', () => {
    const r = safePctChangeDetailed(61300, 19960, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.tier).toBe('CORPORATE_ACTION');
  });

  it('boundary 정확히 25% → WARN', () => {
    const r = safePctChangeDetailed(125, 100, { silent: true });
    expect(r.tier).toBe('WARN');
  });

  it('boundary 정확히 60% → INVALID', () => {
    const r = safePctChangeDetailed(160, 100, { silent: true });
    expect(r.tier).toBe('INVALID');
  });

  it('boundary 정확히 150% → CORPORATE_ACTION', () => {
    const r = safePctChangeDetailed(250, 100, { silent: true });
    expect(r.tier).toBe('CORPORATE_ACTION');
  });

  it('음수 drift 200% → CORPORATE_ACTION (-91.6%) — 실제 INVALID band', () => {
    // 드리프트 절대값으로 분류 — current=10, base=120 일 때 ((10-120)/120)*100 ≈ -91.67%
    // |91.67%| 는 INVALID band 안 (60~150%)
    const r = safePctChangeDetailed(10, 120, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.tier).toBe('INVALID');
  });

  it('음수 drift 95% → INVALID (절대값 분류)', () => {
    const r = safePctChangeDetailed(5, 100, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.tier).toBe('INVALID');
  });

  it('sanityBoundPct override 명시 → 4단계 분기 우회 (sectorEnergy ±1000% 호환)', () => {
    const r = safePctChangeDetailed(500, 100, { sanityBoundPct: 1000, silent: true });
    expect(r.valid).toBe(true);
    expect(r.value).toBeCloseTo(400, 5);
    expect(r.tier).toBeUndefined();
  });

  it('ENV DRIFT_TIERED_SANITY_DISABLED=true → 기존 단일 ±90% bound 복원', () => {
    process.env.DRIFT_TIERED_SANITY_DISABLED = 'true';
    // 95% drift — 기존 bound 90% 위반 → INVALID 처럼 보이지만 reason 만 STALE_BASE_OR_SPLIT_ADJUSTMENT, tier 없음
    const r = safePctChangeDetailed(195, 100, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(r.tier).toBeUndefined();
  });

  it('ENV 우회 + 30% drift → valid (기존 90% 미만)', () => {
    process.env.DRIFT_TIERED_SANITY_DISABLED = 'true';
    const r = safePctChangeDetailed(130, 100, { silent: true });
    expect(r.valid).toBe(true);
    expect(r.tier).toBeUndefined();
  });

  it('NaN current → INVALID_PRICE (4단계 분기 이전 가드)', () => {
    const r = safePctChangeDetailed(NaN, 100, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('INVALID_PRICE');
  });

  it('base=0 → INVALID_PRICE', () => {
    const r = safePctChangeDetailed(100, 0, { silent: true });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('INVALID_PRICE');
  });
});
