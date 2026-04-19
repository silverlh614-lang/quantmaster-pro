import { describe, it, expect } from 'vitest';
import { ConditionRegistry, defaultRegistry } from './index';
import {
  momentumEvaluator,
  maAlignmentEvaluator,
  relativeStrengthEvaluator,
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
    high20d: 10000, high60d: 11000,
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
  it('momentum + relative_strength + volume_surge 가 quote.changePercent 공유', () => {
    const reg = new ConditionRegistry()
      .register(momentumEvaluator)
      .register(relativeStrengthEvaluator)
      .register(volumeSurgeEvaluator);
    const shared = reg.findSharedInputs();
    const cp = shared.find(s => s.input === 'quote.changePercent');
    expect(cp).toBeDefined();
    expect(cp!.evaluators.sort()).toEqual(['momentum', 'relative_strength', 'volume_surge']);
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

  it('defaultRegistry: changePercent 가 ≥ 2개 evaluator 에서 사용됨 (사용자 지적사항 자동 검증)', () => {
    const shared = defaultRegistry.findSharedInputs();
    const cp = shared.find(s => s.input === 'quote.changePercent');
    expect(cp).toBeDefined();
    expect(cp!.evaluators).toContain('momentum');
    expect(cp!.evaluators).toContain('relative_strength');
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

  it('모멘텀 +2.5% 통과 + 상대강도 절대기준(1.5%) 자동 통과 — 사용자가 지적한 changePercent 중복 사용의 결과', () => {
    const r = evaluateServerGate(quote({
      changePercent: 2.5,
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      per: 0, high20d: 0,
      avgVolume: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }));
    // changePercent 한 필드가 momentum + relative_strength 두 evaluator 모두에 통과 점수 부여.
    // findSharedInputs() 가 이 의존을 자동 발견해 사용자에게 가시화한다.
    expect(r.conditionKeys.sort()).toEqual(['momentum', 'relative_strength']);
    expect(r.gateScore).toBeCloseTo(2.0, 5);
  });

  it('모멘텀 단독 통과 — kospiDayReturn 제공으로 상대강도 격차 차단', () => {
    const r = evaluateServerGate(quote({
      changePercent: 2.5,
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      per: 0, high20d: 0,
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

  it('정배열 + 거래량 돌파 + RSI건강 + MA60우상향 + 주봉RSI = 5개 조건 통과', () => {
    const r = evaluateServerGate(quote({
      changePercent: 0,
      ma5: 10000, ma20: 9800, ma60: 9600,
      avgVolume: 100, volume: 250,   // 2.5배
      rsi14: 55, weeklyRSI: 55,
      ma60TrendUp: true,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      per: 0, high20d: 0, high60d: 0,
    }));
    expect(r.conditionKeys.sort()).toEqual(
      ['ma60_rising', 'ma_alignment', 'rsi_zone', 'volume_breakout', 'weekly_rsi_zone'].sort()
    );
    // ma_alignment(1.0) + volume_breakout(1.0) + rsi_zone(1.0) + ma60_rising(1.0) + weekly_rsi_zone(0.8)
    expect(r.gateScore).toBeCloseTo(4.8, 5);
  });

  it('상대강도 — KOSPI 미제공 시 절대 1.5% 기준', () => {
    const passed = evaluateServerGate(quote({
      changePercent: 1.6,
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      avgVolume: 0, per: 0, high20d: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }));
    expect(passed.conditionKeys).toContain('relative_strength');
  });

  it('상대강도 — KOSPI 제공 시 1.0%p 차이 기준', () => {
    const passed = evaluateServerGate(quote({
      changePercent: 1.5,
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      avgVolume: 0, per: 0, high20d: 0,
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
