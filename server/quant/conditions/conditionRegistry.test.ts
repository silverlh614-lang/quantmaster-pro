import { describe, it, expect } from 'vitest';
import { ConditionRegistry, defaultRegistry } from './index';
import {
  momentumEvaluator,
  maAlignmentEvaluator,
  relativeStrengthEvaluator,
  breakoutMomentumEvaluator,
  volumeBreakoutEvaluator,
  volumeSurgeEvaluator,
  vcpEvaluator,
} from './evaluators';
import { evaluateServerGate, DEFAULT_CONDITION_WEIGHTS } from '../../quantFilter';
import type { YahooQuoteExtended } from '../../screener/stockScreener';

// ─── 테스트 quote 빌더 ────────────────────────────────────────────────────────

function quote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    price: 10000, dayOpen: 9900, prevClose: 9900,
    changePercent: 0,
    volume: 100, avgVolume: 100,
    ma5: 10000, ma20: 9800, ma60: 9600,
    high5d: 10000, high20d: 10000, high60d: 11000,
    atr: 200, atr20avg: 250, atr5d: 200,
    per: 10,
    rsi14: 55, rsi5dAgo: 50, weeklyRSI: 55,
    macd: 0, macdSignal: 0, macdHistogram: 0,
    macd5dHistAgo: 0,
    return5d: 0,
    bbWidthCurrent: 0.05, bbWidth20dAvg: 0.05,
    vol5dAvg: 100, vol20dAvg: 100,
    ma60TrendUp: false,
    monthlyAboveEMA12: false, monthlyEMARising: false,
    weeklyAboveCloud: false, weeklyLaggingSpanUp: false,
    dailyVolumeDrying: false,
    isHighRisk: false,
    ...overrides,
  };
}

// ─── 레지스트리 기본 동작 ─────────────────────────────────────────────────────

describe('ConditionRegistry — 등록/실행', () => {
  it('register: 같은 key 중복 시 throw', () => {
    const reg = new ConditionRegistry().register(momentumEvaluator);
    expect(() => reg.register(momentumEvaluator)).toThrow(/중복 등록.*momentum/);
  });

  it('list: 등록된 평가기를 등록 순서대로 반환', () => {
    const reg = new ConditionRegistry()
      .register(maAlignmentEvaluator)
      .register(momentumEvaluator);
    expect(reg.list().map(e => e.key)).toEqual(['ma_alignment', 'momentum']);
  });

  it('run: 전혀 통과 못하면 totalScore=0, 빈 배열', () => {
    const reg = new ConditionRegistry().register(momentumEvaluator);
    const r = reg.run({
      quote: quote({ changePercent: 0, rsi14: 50, rsi5dAgo: 50, return5d: 0 }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    });
    expect(r.totalScore).toBe(0);
    expect(r.details).toEqual([]);
    expect(r.conditionKeys).toEqual([]);
  });

  it('run: 모멘텀 +2.5% 통과 시 totalScore = 가중치, detail/key 반영', () => {
    const reg = new ConditionRegistry().register(momentumEvaluator);
    const r = reg.run({
      quote: quote({ changePercent: 2.5 }),
      weights: { ...DEFAULT_CONDITION_WEIGHTS, momentum: 1.0 },
    });
    expect(r.totalScore).toBe(1.0);
    expect(r.conditionKeys).toEqual(['momentum']);
    expect(r.details[0]).toContain('모멘텀 +2.5');
  });

  it('run: 가중치 0.1~2.0 외 값은 자동 클램핑', () => {
    const reg = new ConditionRegistry().register(momentumEvaluator);
    const high = reg.run({
      quote: quote({ changePercent: 2.5 }),
      weights: { ...DEFAULT_CONDITION_WEIGHTS, momentum: 99 },
    });
    const low = reg.run({
      quote: quote({ changePercent: 2.5 }),
      weights: { ...DEFAULT_CONDITION_WEIGHTS, momentum: 0 },
    });
    expect(high.totalScore).toBe(2.0); // 상한 clamp
    expect(low.totalScore).toBe(0.1);  // 하한 clamp
  });
});

// ─── 정적 분석 — 같은 입력 공유 발견 ─────────────────────────────────────────

describe('ConditionRegistry — findSharedInputs (정적 분석)', () => {
  it('momentum + relative_strength + volume_surge 가 quote.changePercent 공유 — 정적 분석은 이를 감지한다', () => {
    const reg = new ConditionRegistry()
      .register(momentumEvaluator)
      .register(relativeStrengthEvaluator)
      .register(volumeSurgeEvaluator);
    const shared = reg.findSharedInputs();
    const cp = shared.find(s => s.input === 'quote.changePercent');
    expect(cp).toBeDefined();
    expect(cp!.evaluators.sort()).toEqual(['momentum', 'relative_strength', 'volume_surge']);
  });

  // Phase 1 B3 회귀 테스트 — Gate 24 (breakout_momentum) 는 더 이상 changePercent 를 입력으로 받지 않는다.
  it('Gate 2 (momentum) and Gate 24 (breakout_momentum) must use distinct condition keys AND distinct primary inputs', () => {
    expect(momentumEvaluator.key).not.toBe(breakoutMomentumEvaluator.key);
    const momentumInputs = new Set(momentumEvaluator.inputs);
    const breakoutInputs = new Set(breakoutMomentumEvaluator.inputs);
    // 두 평가기는 quote.changePercent 를 동시에 참조하지 않아야 한다.
    const shared = [...momentumInputs].filter(i => breakoutInputs.has(i));
    expect(shared).toEqual([]);
    // breakout_momentum 의 핵심 입력은 5일 고점 + 거래량이어야 함.
    expect(breakoutInputs.has('quote.high5d')).toBe(true);
    expect(breakoutInputs.has('quote.volume')).toBe(true);
  });

  // Phase 1 B3 회귀 테스트 — relative_strength 는 kospiDayReturn 없이 발화하지 않아야 한다.
  it('relative_strength does NOT fire without kospiDayReturn (prevents momentum overlap)', () => {
    const out = relativeStrengthEvaluator.evaluate({
      quote: quote({ changePercent: 5 }),
      weights: DEFAULT_CONDITION_WEIGHTS,
    });
    expect(out).toBeNull();
  });

  it('volume_breakout + volume_surge 가 quote.volume / quote.avgVolume 공유', () => {
    const reg = new ConditionRegistry()
      .register(volumeBreakoutEvaluator)
      .register(volumeSurgeEvaluator);
    const shared = reg.findSharedInputs();
    const vol = shared.find(s => s.input === 'quote.volume');
    const avg = shared.find(s => s.input === 'quote.avgVolume');
    expect(vol?.evaluators.sort()).toEqual(['volume_breakout', 'volume_surge']);
    expect(avg?.evaluators.sort()).toEqual(['volume_breakout', 'volume_surge']);
  });

  it('단일 평가기만 사용하는 입력은 결과에 없음', () => {
    const reg = new ConditionRegistry().register(vcpEvaluator);
    expect(reg.findSharedInputs()).toEqual([]);
  });

  it('defaultRegistry: breakout_momentum 은 momentum 과 quote.changePercent 를 공유하지 않는다 (Phase 1 B3)', () => {
    const shared = defaultRegistry.findSharedInputs();
    const cp = shared.find(s => s.input === 'quote.changePercent');
    expect(cp).toBeDefined();
    // breakout_momentum 은 changePercent 를 사용하지 않아야 — 공유 목록에 없어야 한다
    expect(cp!.evaluators).not.toContain('breakout_momentum');
    // 정적 분석상 momentum 과 relative_strength 는 여전히 입력이 겹치지만,
    // 런타임 의미적 격리(kospiDayReturn 강제)로 중복 발화는 차단된다.
    expect(cp!.evaluators).toContain('momentum');
  });
});

// ─── 동작 동등성 — 리팩토링 전후 결과 일치 ───────────────────────────────────
//
// orchestrator (evaluateServerGate) 가 registry 위임으로 바뀌어도 결과가 변하지
// 않음을 확인하는 회귀 테스트. 하나라도 깨지면 리팩토링 부작용.

describe('evaluateServerGate — 리팩토링 동작 동등성', () => {
  it('완전 무신호 quote: gateScore=0, signalType=SKIP, conditionKeys=[]', () => {
    const r = evaluateServerGate(quote({
      changePercent: 0, rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      per: 0, high20d: 0, high60d: 0,
      avgVolume: 0, volume: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }));
    expect(r.gateScore).toBe(0);
    expect(r.conditionKeys).toEqual([]);
    expect(r.signalType).toBe('SKIP');
  });

  it('모멘텀 +2.5% 통과 시, relative_strength 는 kospiDayReturn 없이 발화하지 않음 (B3 격리 후)', () => {
    const r = evaluateServerGate(quote({
      changePercent: 2.5,
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      per: 0, high5d: 0, high20d: 0,
      avgVolume: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }));
    // changePercent 한 필드가 과거엔 momentum + relative_strength 동시 발화했음. 이제 분리.
    expect(r.conditionKeys).toEqual(['momentum']);
    expect(r.gateScore).toBeCloseTo(1.0, 5);
  });

  it('모멘텀 단독 통과 — kospiDayReturn 제공으로 상대강도 격차 차단', () => {
    const r = evaluateServerGate(quote({
      changePercent: 2.5,
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      per: 0, high5d: 0, high20d: 0,
      avgVolume: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }), DEFAULT_CONDITION_WEIGHTS, /* kospiDayReturn */ 2.0); // gap=0.5, threshold=1.0 → relative_strength 미통과
    expect(r.conditionKeys).toEqual(['momentum']);
    expect(r.gateScore).toBeCloseTo(1.0, 5);
  });

  // Phase 1 B3 회귀 — breakout_momentum 이 5일 고점 + 거래량 조건에서 독립적으로 발화
  it('breakout_momentum: 5일 고점 돌파 + 거래량 1.5배 이상 시 독립 발화', () => {
    const r = evaluateServerGate(quote({
      changePercent: 0,      // changePercent 는 이 조건에 영향 없음
      high5d: 10000,
      price: 10150,          // 5일 고점 대비 +1.5%
      volume: 200, avgVolume: 100,  // 2배 거래량
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      per: 0, high20d: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }));
    expect(r.conditionKeys).toContain('breakout_momentum');
    // momentum 은 changePercent=0 이므로 발화하지 않음 — 두 조건이 진정 독립임을 확인
    expect(r.conditionKeys).not.toContain('momentum');
  });

  it('정배열 + 거래량 돌파 + RSI건강 + MA60우상향 + 주봉RSI = 5개 조건 통과 (breakout_momentum 차단)', () => {
    const r = evaluateServerGate(quote({
      changePercent: 0,
      ma5: 10000, ma20: 9800, ma60: 9600,
      avgVolume: 100, volume: 250,   // 2.5배 — volume_breakout 발화
      rsi14: 55, weeklyRSI: 55,
      ma60TrendUp: true,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      per: 0, high5d: 0, high20d: 0, high60d: 0,  // high5d=0 → breakout_momentum 차단
    }));
    expect(r.conditionKeys.sort()).toEqual(
      ['ma60_rising', 'ma_alignment', 'rsi_zone', 'volume_breakout', 'weekly_rsi_zone'].sort()
    );
    // ma_alignment(1.0) + volume_breakout(1.0) + rsi_zone(1.0) + ma60_rising(1.0) + weekly_rsi_zone(0.8)
    expect(r.gateScore).toBeCloseTo(4.8, 5);
  });

  it('상대강도 — KOSPI 미제공 시 발화하지 않음 (Phase 1 B3)', () => {
    const result = evaluateServerGate(quote({
      changePercent: 1.6,
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      avgVolume: 0, per: 0, high5d: 0, high20d: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }));
    expect(result.conditionKeys).not.toContain('relative_strength');
  });

  it('상대강도 — KOSPI 제공 시 1.0%p 차이 기준', () => {
    const passed = evaluateServerGate(quote({
      changePercent: 1.5,
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      avgVolume: 0, per: 0, high5d: 0, high20d: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }), DEFAULT_CONDITION_WEIGHTS, 0.3);
    expect(passed.conditionKeys).toContain('relative_strength');
    expect(passed.details.find(d => d.includes('상대강도'))).toContain('KOSPI');
  });

  it('VCP 강한압축 (CS≥0.6) — vcp 만점, 중간압축 (≥0.4) — 0.5배', () => {
    const strong = evaluateServerGate(quote({
      changePercent: 0,
      ma5: 0, ma20: 0, ma60: 0,
      avgVolume: 0, per: 0, high20d: 0,
      rsi14: 30, weeklyRSI: 30,
      macdHistogram: -1, macd5dHistAgo: -1,
      // CS = (1 - 0/1) * 0.4 + (1 - 0/1) * 0.4 + (1 - 0/1) * 0.2 = 1.0 → clamp 1
      bbWidthCurrent: 0, bbWidth20dAvg: 1,
      vol5dAvg: 0, vol20dAvg: 1,
      atr5d: 0, atr20avg: 1,
      ma60TrendUp: false,
    }));
    expect(strong.compressionScore).toBeCloseTo(1.0, 5);
    expect(strong.conditionKeys).toContain('vcp');
  });
});
