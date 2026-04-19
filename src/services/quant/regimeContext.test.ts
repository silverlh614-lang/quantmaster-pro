import { describe, it, expect } from 'vitest';
import { buildRegimeContext, mapClassificationToDynamicStop } from './regimeContext';
import { evaluateMarketRegimeClassifier } from './marketRegimeClassifier';
import { evaluatePositionLifecycle } from './positionLifecycleEngine';
import type { MarketRegimeClassifierInput } from '../../types/macro';

function classifierInput(overrides: Partial<MarketRegimeClassifierInput> = {}): MarketRegimeClassifierInput {
  return {
    vkospi: 18,
    foreignNetBuy4wTrend: 1000,
    kospiAbove200MA: true,
    dxyDirection: 'FLAT',
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
    const r = evaluateMarketRegimeClassifier(classifierInput({ vkospi: 18 }));
    const ctx = buildRegimeContext(r);

    expect(ctx.classifier.classification).toBe('RISK_ON_EARLY');
    expect(ctx.dynamicStopRegime).toBe('RISK_ON');
    expect(ctx.lifecycle.exitPrepBreachCount).toBe(2);
    expect(ctx.lifecycle.fullExitBreachCount).toBe(3);
    expect(ctx.buyingHalted).toBe(false);
    expect(ctx.positionSizeLimitPct).toBe(100);
  });

  it('RISK_OFF_CRISIS: 임계 1/1, 매수 차단, 사이즈 0%', () => {
    const r = evaluateMarketRegimeClassifier(classifierInput({ vkospi: 35 }));
    const ctx = buildRegimeContext(r);

    expect(ctx.classifier.classification).toBe('RISK_OFF_CRISIS');
    expect(ctx.dynamicStopRegime).toBe('CRISIS');
    expect(ctx.lifecycle.exitPrepBreachCount).toBe(1);
    expect(ctx.lifecycle.fullExitBreachCount).toBe(1);
    expect(ctx.buyingHalted).toBe(true);
    expect(ctx.positionSizeLimitPct).toBe(0);
  });

  it('RISK_OFF_CORRECTION: 임계 1/2 (분류기 gate1BreachThreshold=2)', () => {
    const r = evaluateMarketRegimeClassifier(classifierInput({ vkospi: 23 }));
    const ctx = buildRegimeContext(r);

    expect(ctx.classifier.classification).toBe('RISK_OFF_CORRECTION');
    expect(ctx.dynamicStopRegime).toBe('RISK_OFF');
    expect(ctx.lifecycle.fullExitBreachCount).toBe(2);
    expect(ctx.lifecycle.exitPrepBreachCount).toBe(1);
    expect(ctx.buyingHalted).toBe(false);
    expect(ctx.positionSizeLimitPct).toBe(50);
  });

  it('컨텍스트 필드는 frozen — 수정 시 TypeError', () => {
    const r = evaluateMarketRegimeClassifier(classifierInput());
    const ctx = buildRegimeContext(r);

    expect(() => { (ctx as any).buyingHalted = true; }).toThrow();
    expect(() => { (ctx.lifecycle as any).fullExitBreachCount = 99; }).toThrow();
    expect(() => { (ctx.classifier as any).classification = 'RISK_OFF_CRISIS'; }).toThrow();
  });

  it('builtAt 은 ISO 8601 문자열', () => {
    const ctx = buildRegimeContext(evaluateMarketRegimeClassifier(classifierInput()));
    expect(ctx.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('evaluatePositionLifecycle + RegimeContext — 임계값 동적 주입', () => {
  it('RISK_OFF_CRISIS 컨텍스트 주입 시 Gate1 이탈 1개로 즉시 FULL_EXIT', () => {
    const ctx = buildRegimeContext(evaluateMarketRegimeClassifier(classifierInput({ vkospi: 35 })));
    const transition = evaluatePositionLifecycle(
      { stage: 'HOLD', entryScore: 7, currentScore: 7, gate1BreachCount: 1, stopLossTriggered: false },
      ctx,
    );
    expect(transition).not.toBeNull();
    expect(transition!.nextStage).toBe('FULL_EXIT');
    expect(transition!.reason).toContain('1개');
  });

  it('컨텍스트 미주입 시 기본 임계 2/3 유지 (하위 호환)', () => {
    const transition = evaluatePositionLifecycle(
      { stage: 'HOLD', entryScore: 7, currentScore: 7, gate1BreachCount: 1, stopLossTriggered: false },
    );
    expect(transition).toBeNull();
  });

  it('RISK_ON_BULL 컨텍스트 주입 시 Gate1 이탈 2개에서 EXIT_PREP', () => {
    const ctx = buildRegimeContext(evaluateMarketRegimeClassifier(classifierInput({
      vkospi: 14, foreignNetBuy4wTrend: 5000, kospiAbove200MA: true, dxyDirection: 'DOWN',
    })));
    expect(ctx.classifier.classification).toBe('RISK_ON_BULL');
    const transition = evaluatePositionLifecycle(
      { stage: 'HOLD', entryScore: 7, currentScore: 7, gate1BreachCount: 2, stopLossTriggered: false },
      ctx,
    );
    expect(transition).not.toBeNull();
    expect(transition!.nextStage).toBe('EXIT_PREP');
  });
});
