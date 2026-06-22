// @responsibility ADR-0390 — ma_alignment/volume_breakout/turtle_high/relative_strength/breakout_momentum status
import { afterEach, describe, expect, it } from 'vitest';
import {
  breakoutMomentumEvaluator,
  maAlignmentEvaluator,
  relativeStrengthEvaluator,
  turtleHighEvaluator,
  volumeBreakoutEvaluator,
} from './evaluators.js';
import type { ConditionEvalContext } from './types.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../../quantFilter.js';

function makeQuote(overrides: Record<string, number | undefined>): ConditionEvalContext['quote'] {
  return overrides as unknown as ConditionEvalContext['quote'];
}

const ctx = (q: ConditionEvalContext['quote'], extras: Partial<ConditionEvalContext> = {}): ConditionEvalContext => ({
  quote: q,
  weights: DEFAULT_CONDITION_WEIGHTS,
  ...extras,
});

// ─── ma_alignment ────────────────────────────────────────────────────────────
describe('maAlignmentEvaluator status (ADR-0390)', () => {
  it('ma60=0 → DATA_UNAVAILABLE (Yahoo 시계열 < 60일)', () => {
    const r = maAlignmentEvaluator.evaluate(ctx(makeQuote({ ma5: 110, ma20: 105, ma60: 0 })));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
    expect(r!.detail).toMatch(/MA5\/MA20\/MA60/);
  });

  it('ma5/ma20=0 → DATA_UNAVAILABLE', () => {
    expect(maAlignmentEvaluator.evaluate(ctx(makeQuote({ ma5: 0, ma20: 105, ma60: 100 })))!.status).toBe('DATA_UNAVAILABLE');
    expect(maAlignmentEvaluator.evaluate(ctx(makeQuote({ ma5: 110, ma20: 0, ma60: 100 })))!.status).toBe('DATA_UNAVAILABLE');
  });

  it('정배열 (110>105>100) → FIRED', () => {
    const r = maAlignmentEvaluator.evaluate(ctx(makeQuote({ ma5: 110, ma20: 105, ma60: 100 })));
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBe(DEFAULT_CONDITION_WEIGHTS.ma_alignment);
  });

  it('non-perfect alignment is an advisory dampener, not a Gate1 hard block', () => {
    const r = maAlignmentEvaluator.evaluate(ctx(makeQuote({ ma5: 100, ma20: 105, ma60: 110 })));
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBe(DEFAULT_CONDITION_WEIGHTS.ma_alignment * 0.35);
    expect(r!.detail).toContain('MA_ALIGNMENT_ADVISORY_DAMPENER');
  });

  it('hard-blocks only technical trend death', () => {
    const r = maAlignmentEvaluator.evaluate(ctx(makeQuote({ price: 90, ma5: 95, ma20: 98, ma60: 110, return20d: -18 })));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.detail).toContain('TECHNICAL_TREND_DEATH');
  });
});

// ─── volume_breakout ─────────────────────────────────────────────────────────
describe('volumeBreakoutEvaluator status (ADR-0390)', () => {
  it('avgVolume=0 → DATA_UNAVAILABLE', () => {
    const r = volumeBreakoutEvaluator.evaluate(ctx(makeQuote({ avgVolume: 0, volume: 100 })));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('volume NaN → DATA_UNAVAILABLE', () => {
    const r = volumeBreakoutEvaluator.evaluate(ctx(makeQuote({ avgVolume: 100, volume: NaN })));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('volume 2x → FIRED', () => {
    const r = volumeBreakoutEvaluator.evaluate(ctx(makeQuote({ avgVolume: 100, volume: 200 })));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/2.0배/);
  });

  it('volume 1.5x → THRESHOLD_NOT_MET', () => {
    const r = volumeBreakoutEvaluator.evaluate(ctx(makeQuote({ avgVolume: 100, volume: 150 })));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.detail).toMatch(/1.5배.*2배 미달/);
  });
});

// ─── turtle_high ─────────────────────────────────────────────────────────────
describe('turtleHighEvaluator status (ADR-0390)', () => {
  it('high20d=0 → DATA_UNAVAILABLE', () => {
    const r = turtleHighEvaluator.evaluate(ctx(makeQuote({ high20d: 0, price: 100 })));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('price=0 → DATA_UNAVAILABLE', () => {
    const r = turtleHighEvaluator.evaluate(ctx(makeQuote({ high20d: 100, price: 0 })));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('20일 신고가 돌파 → FIRED', () => {
    const r = turtleHighEvaluator.evaluate(ctx(makeQuote({ high20d: 100, price: 105 })));
    expect(r!.status).toBe('FIRED');
  });

  it('boundary price === high20d → FIRED', () => {
    const r = turtleHighEvaluator.evaluate(ctx(makeQuote({ high20d: 100, price: 100 })));
    expect(r!.status).toBe('FIRED');
  });

  it('현재가 < 20일고점 → THRESHOLD_NOT_MET', () => {
    const r = turtleHighEvaluator.evaluate(ctx(makeQuote({ high20d: 100, price: 95 })));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
  });
});

// ─── relative_strength ──────────────────────────────────────────────────────
describe('relativeStrengthEvaluator status (ADR-0390)', () => {
  it('kospi20dReturn undefined → DATA_UNAVAILABLE (벤치마크 부재)', () => {
    const r = relativeStrengthEvaluator.evaluate(ctx(makeQuote({ return20d: 10 })));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
    expect(r!.detail).toMatch(/벤치마크/);
  });

  it('kospi20dReturn NaN → DATA_UNAVAILABLE', () => {
    const r = relativeStrengthEvaluator.evaluate(ctx(makeQuote({ return20d: 10 }), { kospi20dReturn: NaN }));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('return20d NaN → DATA_UNAVAILABLE', () => {
    const r = relativeStrengthEvaluator.evaluate(ctx(makeQuote({ return20d: NaN }), { kospi20dReturn: 5 }));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('gap +5%p (3.0 초과) → FIRED', () => {
    const r = relativeStrengthEvaluator.evaluate(ctx(makeQuote({ return20d: 10 }), { kospi20dReturn: 5 }));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/\+5.0%p/);
  });

  it('gap +2%p → THRESHOLD_NOT_MET (3.0 미달)', () => {
    const r = relativeStrengthEvaluator.evaluate(ctx(makeQuote({ return20d: 7 }), { kospi20dReturn: 5 }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
  });

  it('gap negative → THRESHOLD_NOT_MET', () => {
    const r = relativeStrengthEvaluator.evaluate(ctx(makeQuote({ return20d: 0 }), { kospi20dReturn: 5 }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
  });
});

// ─── breakout_momentum ──────────────────────────────────────────────────────
describe('breakoutMomentumEvaluator status (ADR-0390)', () => {
  function bq(overrides: Record<string, number>) {
    return ctx(makeQuote({
      high5d: 100,
      price: 102,
      volume: 200,
      avgVolume: 100,
      ...overrides,
    }));
  }

  it('high5d=0 → DATA_UNAVAILABLE', () => {
    const r = breakoutMomentumEvaluator.evaluate(bq({ high5d: 0 }));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('avgVolume=0 → DATA_UNAVAILABLE', () => {
    const r = breakoutMomentumEvaluator.evaluate(bq({ avgVolume: 0 }));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('volume NaN → DATA_UNAVAILABLE', () => {
    const r = breakoutMomentumEvaluator.evaluate(bq({ volume: NaN }));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('5일돌파 +1% + 거래량 2배 → FIRED 강한 돌파', () => {
    const r = breakoutMomentumEvaluator.evaluate(bq({ price: 102, volume: 200 }));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/5일돌파/);
  });

  it('5일고점근접 -0.5% + 거래량 1.3배 → FIRED (0.6x)', () => {
    const r = breakoutMomentumEvaluator.evaluate(bq({ price: 99.5, volume: 130 }));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/5일고점근접/);
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.breakout_momentum * 0.6, 5);
  });

  it('가격 미달 + 거래량 미달 → THRESHOLD_NOT_MET', () => {
    const r = breakoutMomentumEvaluator.evaluate(bq({ price: 95, volume: 100 }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.detail).toMatch(/임계 미달/);
  });
});

// ─── breakout_momentum 눌림목 레인 + 과열 가드 (ADR-0648) ────────────────────────
describe('breakoutMomentumEvaluator 눌림목 레인 + 과열 가드 (ADR-0648)', () => {
  const FLAG = 'GATE_PULLBACK_ENTRY_LANE_ENABLED';
  afterEach(() => { delete process.env[FLAG]; });

  // 눌림목 임계: 0.92 ≤ price/high20d ≤ 0.99 + price≥ma20 + 0.5 ≤ vol/avgVol ≤ 0.9.
  // 5일 레인 미충족(돌파/약돌파 아님)이도록 high5d 를 충분히 높게 둔다.
  function pullbackQuote(overrides: Record<string, number> = {}) {
    return ctx(makeQuote({
      high5d: 200,      // price 95 → posVsHigh5d=0.475 → 레인 C 미발화
      high20d: 100,     // price 95 → 0.95 (0.92~0.99 내)
      ma20: 90,         // price 95 ≥ 90 → aboveMA20 true
      price: 95,
      volume: 70,
      avgVolume: 100,   // volRatio=0.7 (0.5~0.9 내)
      ...overrides,
    }));
  }

  it('flag OFF(=false) → 눌림목 조건 충족이어도 미FIRED (byte-identical, THRESHOLD_NOT_MET)', () => {
    process.env[FLAG] = 'false';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote());
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.detail).not.toMatch(/눌림목/);
  });

  it('flag 미설정(default ON, ADR-0649) → 눌림목 조건 충족 시 FIRED (w*0.6)', () => {
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote());
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/눌림목 진입/);
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.breakout_momentum * 0.6, 5);
  });

  it('flag ON(=true) → 눌림목 조건 충족 시 FIRED (w*0.6)', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote());
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/눌림목 진입/);
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.breakout_momentum * 0.6, 5);
  });

  it('flag ON 경계 — price/high20d=0.92 (하한 포함) → FIRED', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote({ price: 92, high20d: 100 }));
    expect(r!.status).toBe('FIRED');
  });

  it('flag ON 경계 — price/high20d=0.99 (상한 포함) → FIRED', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote({ price: 99, high20d: 100, ma20: 90 }));
    expect(r!.status).toBe('FIRED');
  });

  it('flag ON 경계 — price/high20d=0.91 (하한 미달) → THRESHOLD_NOT_MET', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote({ price: 91, high20d: 100, ma20: 90 }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.detail).not.toMatch(/눌림목/);
  });

  it('flag ON — price < ma20 (추세 붕괴) → 눌림목 미FIRED', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote({ price: 95, high20d: 100, ma20: 96 }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.detail).not.toMatch(/눌림목/);
  });

  it('flag ON 경계 — vol/avgVol=0.5 (하한 포함) → FIRED', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote({ volume: 50, avgVolume: 100 }));
    expect(r!.status).toBe('FIRED');
  });

  it('flag ON 경계 — vol/avgVol=0.9 (상한 포함) → FIRED', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote({ volume: 90, avgVolume: 100 }));
    expect(r!.status).toBe('FIRED');
  });

  it('flag ON — vol/avgVol=0.95 (거래량 마름 아님) → 눌림목 미FIRED', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote({ volume: 95, avgVolume: 100 }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
  });

  it('flag ON — high20d/ma20 데이터 부재 시 눌림목 평가 생략 (레인 C THRESHOLD_NOT_MET, DATA_UNAVAILABLE 강제 전환 안 함)', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(pullbackQuote({ high20d: 0, ma20: 0 }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.detail).not.toMatch(/눌림목/);
  });

  // ─── 과열 가드 (레인 C) ────────────────────────────────────────────────────
  it('flag ON — price/high5d=1.07 (>1.06) → 과열 거부 THRESHOLD_NOT_MET/OVEREXTENDED', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(ctx(makeQuote({
      high5d: 100, price: 107, volume: 200, avgVolume: 100, high20d: 100, ma20: 90,
    })));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.detail).toMatch(/OVEREXTENDED/);
  });

  it('flag ON — price/high5d=1.06 (경계, >1.06 아님) → 과열 거부 안 함, 강돌파 FIRED', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(ctx(makeQuote({
      high5d: 100, price: 106, volume: 200, avgVolume: 100, high20d: 100, ma20: 90,
    })));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/5일돌파/);
  });

  it('flag OFF(=false) — price/high5d=1.10 (과열) 이어도 과열 가드 미적용 → 기존 강돌파 FIRED (byte-identical)', () => {
    process.env[FLAG] = 'false';
    const r = breakoutMomentumEvaluator.evaluate(ctx(makeQuote({
      high5d: 100, price: 110, volume: 200, avgVolume: 100,
    })));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/5일돌파/);
  });

  it('flag ON — 기존 강돌파(+1%/2배)는 과열 미해당 → FIRED 무변경 (회귀)', () => {
    process.env[FLAG] = 'true';
    const r = breakoutMomentumEvaluator.evaluate(ctx(makeQuote({
      high5d: 100, price: 102, volume: 200, avgVolume: 100, high20d: 100, ma20: 90,
    })));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/5일돌파/);
    expect(r!.score).toBe(DEFAULT_CONDITION_WEIGHTS.breakout_momentum);
  });
});
