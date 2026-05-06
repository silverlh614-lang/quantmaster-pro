// @responsibility ADR-0389 — momentum/vcp/volume_surge status 마이그레이션 + registry non-FIRED skip 회귀
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  momentumEvaluator,
  vcpEvaluator,
  volumeSurgeEvaluator,
} from './evaluators.js';
import { ConditionRegistry } from './registry.js';
import type { ConditionEvalContext, ConditionEvaluator } from './types.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../../quantFilter.js';

const ORIGINAL_MOMENTUM_LEGACY = process.env.MOMENTUM_STEP_SCORING_DISABLED;
const ORIGINAL_VCP_MODE_B_DISABLED = process.env.VCP_MODE_B_DISABLED;

beforeEach(() => {
  delete process.env.MOMENTUM_STEP_SCORING_DISABLED;
  delete process.env.VCP_MODE_B_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_MOMENTUM_LEGACY === undefined) delete process.env.MOMENTUM_STEP_SCORING_DISABLED;
  else process.env.MOMENTUM_STEP_SCORING_DISABLED = ORIGINAL_MOMENTUM_LEGACY;
  if (ORIGINAL_VCP_MODE_B_DISABLED === undefined) delete process.env.VCP_MODE_B_DISABLED;
  else process.env.VCP_MODE_B_DISABLED = ORIGINAL_VCP_MODE_B_DISABLED;
});

function makeQuote(overrides: Record<string, number | undefined>): ConditionEvalContext['quote'] {
  return overrides as unknown as ConditionEvalContext['quote'];
}

const ctx = (q: ConditionEvalContext['quote']): ConditionEvalContext => ({
  quote: q,
  weights: DEFAULT_CONDITION_WEIGHTS,
});

// ─── volume_surge ────────────────────────────────────────────────────────────
describe('volumeSurgeEvaluator status (ADR-0389)', () => {
  it('avgVolume=0 → DATA_UNAVAILABLE', () => {
    const r = volumeSurgeEvaluator.evaluate(ctx(makeQuote({ avgVolume: 0, volume: 100, changePercent: 5 })));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
    expect(r!.score).toBe(0);
    expect(r!.detail).toMatch(/avgVolume/);
  });

  it('volume NaN → DATA_UNAVAILABLE', () => {
    const r = volumeSurgeEvaluator.evaluate(ctx(makeQuote({ avgVolume: 100, volume: NaN, changePercent: 5 })));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('changePercent NaN → DATA_UNAVAILABLE', () => {
    const r = volumeSurgeEvaluator.evaluate(ctx(makeQuote({ avgVolume: 100, volume: 500, changePercent: NaN })));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('volume 3x + changePct 1.5% → FIRED', () => {
    const r = volumeSurgeEvaluator.evaluate(ctx(makeQuote({ avgVolume: 100, volume: 300, changePercent: 1.5 })));
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBe(DEFAULT_CONDITION_WEIGHTS.volume_surge);
    expect(r!.detail).toBe('거래량 급증+상승');
  });

  it('volume 2.5x → THRESHOLD_NOT_MET (3배 미달)', () => {
    const r = volumeSurgeEvaluator.evaluate(ctx(makeQuote({ avgVolume: 100, volume: 250, changePercent: 5 })));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.score).toBe(0);
    expect(r!.detail).toMatch(/임계 미달/);
  });

  it('changePct 0.5% → THRESHOLD_NOT_MET (1% 미달)', () => {
    const r = volumeSurgeEvaluator.evaluate(ctx(makeQuote({ avgVolume: 100, volume: 500, changePercent: 0.5 })));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
  });

  it('boundary 정확 3.0x + 1.0% → FIRED', () => {
    const r = volumeSurgeEvaluator.evaluate(ctx(makeQuote({ avgVolume: 100, volume: 300, changePercent: 1.0 })));
    expect(r!.status).toBe('FIRED');
  });
});

// ─── momentum ────────────────────────────────────────────────────────────────
describe('momentumEvaluator status (ADR-0389)', () => {
  function mq(overrides: Record<string, number>) {
    return ctx(makeQuote({
      changePercent: 0,
      rsi14: 50,
      rsi5dAgo: 50,
      return5d: 0,
      ...overrides,
    }));
  }

  it('changePercent NaN → DATA_UNAVAILABLE', () => {
    const r = momentumEvaluator.evaluate(mq({ changePercent: NaN }));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('changePercent 3.5% → FIRED 강한 모멘텀 (1.2x)', () => {
    const r = momentumEvaluator.evaluate(mq({ changePercent: 3.5 }));
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.momentum * 1.2, 5);
    expect(r!.detail).toMatch(/강한 모멘텀/);
  });

  it('changePercent 2.5% → FIRED 모멘텀 (1.0x)', () => {
    const r = momentumEvaluator.evaluate(mq({ changePercent: 2.5 }));
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBe(DEFAULT_CONDITION_WEIGHTS.momentum);
  });

  it('changePercent 1.5% → FIRED 중간 모멘텀 (0.7x)', () => {
    const r = momentumEvaluator.evaluate(mq({ changePercent: 1.5 }));
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.momentum * 0.7, 5);
  });

  it('changePercent 0.7% + RSI 가속 → FIRED 약한 모멘텀 (RSI가속)', () => {
    const r = momentumEvaluator.evaluate(mq({ changePercent: 0.7, rsi14: 60, rsi5dAgo: 55 }));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/RSI가속/);
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.momentum * 0.7, 5);
  });

  it('changePercent 0.7% + RSI 부재 → FIRED + RSI부재 마커 (점수 0.4x)', () => {
    const r = momentumEvaluator.evaluate(mq({ changePercent: 0.7, rsi14: NaN, rsi5dAgo: NaN }));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/RSI부재/);
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.momentum * 0.4, 5);
  });

  it('changePercent 0.3% → THRESHOLD_NOT_MET', () => {
    const r = momentumEvaluator.evaluate(mq({ changePercent: 0.3 }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.score).toBe(0);
  });

  it('legacy ENV (MOMENTUM_STEP_SCORING_DISABLED=true) — pct=2 → FIRED', () => {
    process.env.MOMENTUM_STEP_SCORING_DISABLED = 'true';
    const r = momentumEvaluator.evaluate(mq({ changePercent: 2 }));
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBe(DEFAULT_CONDITION_WEIGHTS.momentum); // flat 1.0x
  });

  it('legacy ENV — pct=1.5 + RSI 가속 → FIRED (모멘텀 RSI가속)', () => {
    process.env.MOMENTUM_STEP_SCORING_DISABLED = 'true';
    const r = momentumEvaluator.evaluate(mq({ changePercent: 1.5, rsi14: 60, rsi5dAgo: 55, return5d: 5 }));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/RSI가속/);
  });

  it('legacy ENV — pct=1.5 + 임계 미달 → THRESHOLD_NOT_MET', () => {
    process.env.MOMENTUM_STEP_SCORING_DISABLED = 'true';
    const r = momentumEvaluator.evaluate(mq({ changePercent: 1.5 })); // RSI 가속 없음
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
  });
});

// ─── vcp ─────────────────────────────────────────────────────────────────────
describe('vcpEvaluator status (ADR-0389)', () => {
  function vq(overrides: Record<string, number>) {
    return ctx(makeQuote({
      bbWidthCurrent: 0.05,
      bbWidth20dAvg: 0.10,
      vol5dAvg: 100,
      vol20dAvg: 100,
      atr5d: 1.0,
      atr20avg: 1.0,
      ma5: 110,
      ma20: 105,
      ma60: 100,
      ...overrides,
    }));
  }

  it('bbWidthCurrent=0 → DATA_UNAVAILABLE', () => {
    const r = vcpEvaluator.evaluate(vq({ bbWidthCurrent: 0 }));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
    expect(r!.detail).toMatch(/입력 데이터 부재/);
  });

  it('atr20avg=0 → DATA_UNAVAILABLE (ADR-0387 결함 차단 — 기존엔 cs<0.4 false 분류)', () => {
    const r = vcpEvaluator.evaluate(vq({ atr20avg: 0 }));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('ma60=0 → DATA_UNAVAILABLE (정배열 평가 불가)', () => {
    const r = vcpEvaluator.evaluate(vq({ ma60: 0 }));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('CS ≥ 0.6 (강한 압축) → FIRED', () => {
    // bbWidth 0.5x + vol 0.5x + atr 0.5x → CS 높음
    const r = vcpEvaluator.evaluate(vq({
      bbWidthCurrent: 0.03, bbWidth20dAvg: 0.10,
      vol5dAvg: 30, vol20dAvg: 100,
      atr5d: 0.3, atr20avg: 1.0,
    }));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/VCP/);
  });

  it('Mode B (정배열 + ATR 안정) → FIRED', () => {
    // CS 낮지만 정배열 + atr5d≈atr20avg
    const r = vcpEvaluator.evaluate(vq({
      bbWidthCurrent: 0.10, bbWidth20dAvg: 0.10, // 압축 없음
      vol5dAvg: 100, vol20dAvg: 100,
      atr5d: 1.0, atr20avg: 1.0, // 안정 (delta=0)
      ma5: 110, ma20: 105, ma60: 100, // 정배열
    }));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/Mode B/);
  });

  it('CS 낮음 + 역배열 → THRESHOLD_NOT_MET', () => {
    const r = vcpEvaluator.evaluate(vq({
      bbWidthCurrent: 0.10, bbWidth20dAvg: 0.10,
      vol5dAvg: 100, vol20dAvg: 100,
      atr5d: 1.0, atr20avg: 1.0,
      ma5: 100, ma20: 105, ma60: 110, // 역배열
    }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
  });

  it('legacy ENV (VCP_MODE_B_DISABLED=true) + CS<0.4 → THRESHOLD_NOT_MET', () => {
    process.env.VCP_MODE_B_DISABLED = 'true';
    const r = vcpEvaluator.evaluate(vq({
      bbWidthCurrent: 0.10, bbWidth20dAvg: 0.10,
      vol5dAvg: 100, vol20dAvg: 100,
      atr5d: 1.0, atr20avg: 1.0,
      ma5: 110, ma20: 105, ma60: 100, // 정배열이어도 Mode B 비활성
    }));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.detail).toMatch(/Mode B 비활성/);
  });
});

// ─── registry.run non-FIRED skip 회귀 ────────────────────────────────────────
describe('ConditionRegistry.run — non-FIRED status conditionKeys 미합산 (ADR-0389)', () => {
  function makeStaticEvaluator(
    key: string,
    output: { score: number; status?: import('./types.js').ConditionEvalStatus } | null,
  ): ConditionEvaluator {
    return {
      key: key as ConditionEvaluator['key'],
      description: 'static eval',
      inputs: [],
      evaluate() {
        if (output === null) return null;
        return {
          ...output,
          conditionKey: key as ConditionEvaluator['key'],
          detail: `${key} ${output.status ?? 'legacy'}`,
        };
      },
    };
  }

  const baseCtx = ctx(makeQuote({}));

  it('FIRED status → conditionKeys 등재 + score 합산', () => {
    const reg = new ConditionRegistry().register(makeStaticEvaluator('per', { score: 5, status: 'FIRED' }));
    const r = reg.run(baseCtx);
    expect(r.conditionKeys).toEqual(['per']);
    expect(r.totalScore).toBe(5);
    expect(r.details).toEqual(['per FIRED']);
  });

  it('DATA_UNAVAILABLE status → conditionKeys/details/score 모두 미합산', () => {
    const reg = new ConditionRegistry().register(
      makeStaticEvaluator('per', { score: 0, status: 'DATA_UNAVAILABLE' }),
    );
    const r = reg.run(baseCtx);
    expect(r.conditionKeys).toEqual([]);
    expect(r.totalScore).toBe(0);
    expect(r.details).toEqual([]);
  });

  it('THRESHOLD_NOT_MET status → 미합산', () => {
    const reg = new ConditionRegistry().register(
      makeStaticEvaluator('per', { score: 0, status: 'THRESHOLD_NOT_MET' }),
    );
    const r = reg.run(baseCtx);
    expect(r.conditionKeys).toEqual([]);
  });

  it('PROVIDER_DEGRADED status → 미합산', () => {
    const reg = new ConditionRegistry().register(
      makeStaticEvaluator('per', { score: 0, status: 'PROVIDER_DEGRADED' }),
    );
    const r = reg.run(baseCtx);
    expect(r.conditionKeys).toEqual([]);
  });

  it('legacy null return → 미합산 (기존 동작 보존)', () => {
    const reg = new ConditionRegistry().register(makeStaticEvaluator('per', null));
    const r = reg.run(baseCtx);
    expect(r.conditionKeys).toEqual([]);
  });

  it('legacy status 미명시 + score>0 → 합산 (후방호환)', () => {
    const reg = new ConditionRegistry().register(makeStaticEvaluator('per', { score: 5 }));
    const r = reg.run(baseCtx);
    expect(r.conditionKeys).toEqual(['per']);
    expect(r.totalScore).toBe(5);
  });

  it('outputs 배열은 status 와 무관하게 모두 등재 (recordGateAuditByStatus 입력)', () => {
    const reg = new ConditionRegistry()
      .register(makeStaticEvaluator('per', { score: 5, status: 'FIRED' }))
      .register(makeStaticEvaluator('momentum', { score: 0, status: 'DATA_UNAVAILABLE' }))
      .register(makeStaticEvaluator('vcp', { score: 0, status: 'THRESHOLD_NOT_MET' }))
      .register(makeStaticEvaluator('volume_surge', null));
    const r = reg.run(baseCtx);
    expect(r.outputs).toHaveLength(4);
    expect(r.conditionKeys).toEqual(['per']); // FIRED 만
  });
});
