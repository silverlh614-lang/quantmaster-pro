import { describe, it, expect } from 'vitest';
import { buildRegimeContext, mapClassificationToDynamicStop } from './regimeContext';
import type { MarketRegimeClassifierResult } from '../../types/macro';

function historicalClassification(overrides: Partial<MarketRegimeClassifierResult> = {}): MarketRegimeClassifierResult {
  return {
    classification: 'RISK_ON_EARLY', gate2RequiredOverride: null, gate1Strengthened: false,
    positionSizeLimitPct: 100, buyingHalted: false, cashRatioMinPct: 0, gate1BreachThreshold: 3,
    inputs: { vkospi: 18, foreignNetBuy4wTrend: 1000, kospiAbove200MA: true, dxyDirection: 'FLAT' },
    description: 'Historical fixture', actionMessage: '', lastUpdated: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mapClassificationToDynamicStop — 4단계 → 3단계 매핑', () => {
  it('RISK_ON_BULL  → RISK_ON', () => {
    expect(mapClassificationToDynamicStop('RISK_ON_BULL')).toBe('RISK_ON');
  });
  it('RISK_ON_EARLY → RISK_ON', () => {
    expect(mapClassificationToDynamicStop('RISK_ON_EARLY')).toBe('RISK_ON');
  });
  it('RISK_OFF_CORRECTION → RISK_OFF', () => {
    expect(mapClassificationToDynamicStop('RISK_OFF_CORRECTION')).toBe('RISK_OFF');
  });
  it('RISK_OFF_CRISIS → CRISIS', () => {
    expect(mapClassificationToDynamicStop('RISK_OFF_CRISIS')).toBe('CRISIS');
  });
});

describe('buildRegimeContext — read-only SSoT', () => {
  it('RISK_ON_EARLY: 기본값 (lifecycle 임계 2/3, 매수 허용)', () => {
    const r = historicalClassification();
    const ctx = buildRegimeContext(r);

    expect(ctx.classifier.classification).toBe('RISK_ON_EARLY');
    expect(ctx.dynamicStopRegime).toBe('RISK_ON');
    expect(ctx.lifecycle.exitPrepBreachCount).toBe(2);
    expect(ctx.lifecycle.fullExitBreachCount).toBe(3);
    expect(ctx.buyingHalted).toBe(false);
    expect(ctx.positionSizeLimitPct).toBe(100);
  });

  it('RISK_OFF_CRISIS: 임계 1/1, 매수 차단, 사이즈 0%', () => {
    const r = historicalClassification({ classification: 'RISK_OFF_CRISIS', gate1BreachThreshold: 1, buyingHalted: true, positionSizeLimitPct: 0 });
    const ctx = buildRegimeContext(r);

    expect(ctx.classifier.classification).toBe('RISK_OFF_CRISIS');
    expect(ctx.dynamicStopRegime).toBe('CRISIS');
    expect(ctx.lifecycle.exitPrepBreachCount).toBe(1);
    expect(ctx.lifecycle.fullExitBreachCount).toBe(1);
    expect(ctx.buyingHalted).toBe(true);
    expect(ctx.positionSizeLimitPct).toBe(0);
  });

  it('RISK_OFF_CORRECTION: 임계 1/2 (분류기 gate1BreachThreshold=2)', () => {
    const r = historicalClassification({ classification: 'RISK_OFF_CORRECTION', gate1BreachThreshold: 2, positionSizeLimitPct: 50 });
    const ctx = buildRegimeContext(r);

    expect(ctx.classifier.classification).toBe('RISK_OFF_CORRECTION');
    expect(ctx.dynamicStopRegime).toBe('RISK_OFF');
    expect(ctx.lifecycle.fullExitBreachCount).toBe(2);
    expect(ctx.lifecycle.exitPrepBreachCount).toBe(1);
    expect(ctx.buyingHalted).toBe(false);
    expect(ctx.positionSizeLimitPct).toBe(50);
  });

  it('컨텍스트 필드는 frozen — 수정 시 TypeError', () => {
    const r = historicalClassification();
    const ctx = buildRegimeContext(r);

    expect(() => { (ctx as any).buyingHalted = true; }).toThrow();
    expect(() => { (ctx.lifecycle as any).fullExitBreachCount = 99; }).toThrow();
    expect(() => { (ctx.classifier as any).classification = 'RISK_OFF_CRISIS'; }).toThrow();
  });

  it('builtAt 은 ISO 8601 문자열', () => {
    const ctx = buildRegimeContext(historicalClassification());
    expect(ctx.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
