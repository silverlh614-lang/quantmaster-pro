// @responsibility ADR-0411 registry.run TIMESERIES_DEPENDENT_EVALUATORS PROVIDER_DEGRADED 강등 회귀
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConditionRegistry, TIMESERIES_DEPENDENT_EVALUATORS } from './registry.js';
import type {
  ConditionEvalContext,
  ConditionEvaluator,
} from './types.js';
import type { ConditionKey } from '../../quantFilter.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../../quantFilter.js';

const ORIGINAL_DEGRADED_ENV = process.env.ADR_0411_PROVIDER_DEGRADED_DISABLED;

beforeEach(() => {
  delete process.env.ADR_0411_PROVIDER_DEGRADED_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_DEGRADED_ENV === undefined) delete process.env.ADR_0411_PROVIDER_DEGRADED_DISABLED;
  else process.env.ADR_0411_PROVIDER_DEGRADED_DISABLED = ORIGINAL_DEGRADED_ENV;
});

function makeFiredEvaluator(key: ConditionKey, score: number): ConditionEvaluator {
  return {
    key,
    description: `test fired evaluator ${key}`,
    inputs: [],
    evaluate() {
      return { score, conditionKey: key, detail: `${key} +${score}`, status: 'FIRED' };
    },
  };
}

function makeQuote(overrides: Partial<{ yahooDerivedIndicatorsReliable: boolean; dataQuality: string }>): ConditionEvalContext['quote'] {
  return overrides as unknown as ConditionEvalContext['quote'];
}

describe('TIMESERIES_DEPENDENT_EVALUATORS 카탈로그 SSOT (ADR-0411)', () => {
  it('14 시계열 의존 evaluator 등재 — Yahoo OHLCV 입력 의존', () => {
    expect(TIMESERIES_DEPENDENT_EVALUATORS.size).toBe(14);
  });

  it('ADR-0389 적용 3 evaluator (momentum / vcp / volume_surge) 포함', () => {
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('momentum')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('vcp')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('volume_surge')).toBe(true);
  });

  it('ADR-0390 적용 5 evaluator 포함', () => {
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('ma_alignment')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('volume_breakout')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('turtle_high')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('relative_strength')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('breakout_momentum')).toBe(true);
  });

  it('legacy 시계열 evaluator (rsi_zone / macd_bull / pullback / ma60_rising / weekly_rsi_zone / trend_acceleration) 포함', () => {
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('rsi_zone')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('macd_bull')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('pullback')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('ma60_rising')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('weekly_rsi_zone')).toBe(true);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('trend_acceleration')).toBe(true);
  });

  it('비포함 evaluator 검증 — per (fundamental) / supply_confluence (KIS Flow) / earnings_quality (DART)', () => {
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('per')).toBe(false);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('supply_confluence')).toBe(false);
    expect(TIMESERIES_DEPENDENT_EVALUATORS.has('earnings_quality')).toBe(false);
  });
});

describe('registry.run PROVIDER_DEGRADED 자동 강등 (ADR-0411)', () => {
  it('yahooDerivedIndicatorsReliable=false 시 시계열 evaluator → PROVIDER_DEGRADED + score 미합산', () => {
    const reg = new ConditionRegistry();
    reg.register(makeFiredEvaluator('momentum', 5));
    reg.register(makeFiredEvaluator('per', 1)); // 비시계열 — 정상 합산

    const ctx: ConditionEvalContext = {
      quote: makeQuote({ yahooDerivedIndicatorsReliable: false, dataQuality: 'KIS_PRIMARY_YAHOO_STALE_DETECTED' }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    expect(result.totalScore).toBe(1); // per 만 합산
    expect(result.conditionKeys).toEqual(['per']);
    const momentumOut = result.outputs.find(o => o.key === 'momentum');
    expect(momentumOut?.output?.status).toBe('PROVIDER_DEGRADED');
    expect(momentumOut?.output?.score).toBe(0);
  });

  it('yahooDerivedIndicatorsReliable=true 시 정상 합산 (강등 미적용)', () => {
    const reg = new ConditionRegistry();
    reg.register(makeFiredEvaluator('momentum', 5));
    reg.register(makeFiredEvaluator('per', 1));

    const ctx: ConditionEvalContext = {
      quote: makeQuote({ yahooDerivedIndicatorsReliable: true, dataQuality: 'OK' }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    expect(result.totalScore).toBe(6);
    expect(result.conditionKeys).toEqual(['momentum', 'per']);
  });

  it('yahooDerivedIndicatorsReliable 미설정 (legacy quote) 시 강등 미적용 — 후방호환', () => {
    const reg = new ConditionRegistry();
    reg.register(makeFiredEvaluator('momentum', 5));

    const ctx: ConditionEvalContext = {
      quote: makeQuote({}),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    expect(result.totalScore).toBe(5);
    expect(result.conditionKeys).toEqual(['momentum']);
  });

  it('비시계열 evaluator (supply_confluence/earnings_quality/per) 는 reliable=false 여도 정상 합산', () => {
    const reg = new ConditionRegistry();
    reg.register(makeFiredEvaluator('supply_confluence', 1));
    reg.register(makeFiredEvaluator('earnings_quality', 1));
    reg.register(makeFiredEvaluator('per', 1));

    const ctx: ConditionEvalContext = {
      quote: makeQuote({ yahooDerivedIndicatorsReliable: false }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    expect(result.totalScore).toBe(3);
    expect(result.conditionKeys).toEqual(['supply_confluence', 'earnings_quality', 'per']);
  });

  it('14 시계열 evaluator 모두 reliable=false 시 PROVIDER_DEGRADED 일괄 강등', () => {
    const reg = new ConditionRegistry();
    for (const key of TIMESERIES_DEPENDENT_EVALUATORS) {
      reg.register(makeFiredEvaluator(key, 5));
    }

    const ctx: ConditionEvalContext = {
      quote: makeQuote({ yahooDerivedIndicatorsReliable: false }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    expect(result.totalScore).toBe(0);
    expect(result.conditionKeys).toHaveLength(0);
    const degraded = result.outputs.filter(o => o.output?.status === 'PROVIDER_DEGRADED');
    expect(degraded).toHaveLength(14);
  });

  it('PROVIDER_DEGRADED detail 에 dataQuality marker 포함 — 운영자 진단', () => {
    const reg = new ConditionRegistry();
    reg.register(makeFiredEvaluator('momentum', 5));

    const ctx: ConditionEvalContext = {
      quote: makeQuote({ yahooDerivedIndicatorsReliable: false, dataQuality: 'KIS_PRIMARY_YAHOO_STALE_DETECTED' }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    const momentumOut = result.outputs.find(o => o.key === 'momentum');
    expect(momentumOut?.output?.detail).toContain('PROVIDER_DEGRADED');
    expect(momentumOut?.output?.detail).toContain('KIS_PRIMARY_YAHOO_STALE_DETECTED');
  });

  it('dataQuality 미명시 시 detail 에 unknown fallback', () => {
    const reg = new ConditionRegistry();
    reg.register(makeFiredEvaluator('momentum', 5));

    const ctx: ConditionEvalContext = {
      quote: makeQuote({ yahooDerivedIndicatorsReliable: false }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    const momentumOut = result.outputs.find(o => o.key === 'momentum');
    expect(momentumOut?.output?.detail).toContain('unknown');
  });
});

describe('ENV ADR_0411_PROVIDER_DEGRADED_DISABLED 우회 (ADR-0411)', () => {
  it('ENV=true 시 강등 미적용 — legacy 동작 복원', () => {
    process.env.ADR_0411_PROVIDER_DEGRADED_DISABLED = 'true';

    const reg = new ConditionRegistry();
    reg.register(makeFiredEvaluator('momentum', 5));

    const ctx: ConditionEvalContext = {
      quote: makeQuote({ yahooDerivedIndicatorsReliable: false, dataQuality: 'KIS_PRIMARY_YAHOO_STALE_DETECTED' }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    expect(result.totalScore).toBe(5); // 강등 비활성화 → 정상 합산
    expect(result.conditionKeys).toEqual(['momentum']);
  });

  it('ENV=잘못된 값 (정확 비교 의무) 시 default 정책 적용', () => {
    process.env.ADR_0411_PROVIDER_DEGRADED_DISABLED = '1'; // ADR-0157 정확 비교 — 'true' 외 모두 false

    const reg = new ConditionRegistry();
    reg.register(makeFiredEvaluator('momentum', 5));

    const ctx: ConditionEvalContext = {
      quote: makeQuote({ yahooDerivedIndicatorsReliable: false }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    expect(result.totalScore).toBe(0); // '1' 은 'true' 가 아니므로 강등 적용
  });
});

describe('점수 시뮬레이션 — WATCHLIST_HOLD 자연 차단 (사용자 micro-correction)', () => {
  it('14 시계열 evaluator 강등 + per/supply_confluence/earnings_quality 만점 = max 합 ~3.0 (R3_EARLY 임계 4 미달)', () => {
    const reg = new ConditionRegistry();
    // 14 시계열 evaluator — 강등될 것
    for (const key of TIMESERIES_DEPENDENT_EVALUATORS) {
      reg.register(makeFiredEvaluator(key, 5));
    }
    // 비시계열 3 evaluator — 만점 합산
    reg.register(makeFiredEvaluator('per', 1));
    reg.register(makeFiredEvaluator('supply_confluence', 1));
    reg.register(makeFiredEvaluator('earnings_quality', 1));

    const ctx: ConditionEvalContext = {
      quote: makeQuote({ yahooDerivedIndicatorsReliable: false }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    };

    const result = reg.run(ctx);
    expect(result.totalScore).toBe(3); // per 1 + supply_confluence 1 + earnings_quality 1
    expect(result.totalScore).toBeLessThan(4); // R3_EARLY NORMAL 임계 미달 → 자연 진입 차단
  });
});
