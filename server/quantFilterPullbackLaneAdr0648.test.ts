// @responsibility ADR-0648 — evaluateServerGate 눌림목 레인 entryLane 태깅 + force-ON shadow stamp + flag OFF byte-identical 회귀
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateServerGate, DEFAULT_CONDITION_WEIGHTS } from './quantFilter.js';
import type { YahooQuoteExtended } from './screener/stockScreener.js';

const FLAG = 'GATE_PULLBACK_ENTRY_LANE_ENABLED';

// 눌림목 레인만 발화하도록 구성: price/high20d=0.95, price≥ma20, vol/avgVol=0.7,
// high5d 높여 추격(레인 C) 미발화. (다른 조건 점수는 본 테스트 관심 밖.)
function pullbackQuote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    price: 95,
    changePercent: 0.2,
    rsi14: 50, rsi5dAgo: 48, return5d: 2, return20d: 4,
    ma5: 96, ma20: 90, ma60: 85,
    volume: 70, avgVolume: 100,
    high20d: 100, high5d: 200,
    bbWidthCurrent: 8, bbWidth20dAvg: 10,
    vol5dAvg: 80, vol20dAvg: 100, atr5d: 1, atr20avg: 1, atr: 1,
    macdHistogram: -0.1, macd5dHistAgo: 0,
    dailyVolumeDrying: false, monthlyAboveEMA12: true, monthlyEMARising: true,
    weeklyAboveCloud: true, weeklyLaggingSpanUp: true, weeklyRsi14: 50,
    per: 20, yahooDerivedIndicatorsReliable: true,
    ...overrides,
  } as YahooQuoteExtended;
}

describe('evaluateServerGate 눌림목 레인 정합 (ADR-0648)', () => {
  afterEach(() => { delete process.env[FLAG]; });

  it('flag OFF → entryLane undefined (byte-identical, 눌림목 레인 미태깅)', () => {
    const r = evaluateServerGate(pullbackQuote(), DEFAULT_CONDITION_WEIGHTS, 1);
    expect(r.entryLane).toBeUndefined();
  });

  it('flag ON → 눌림목 레인 FIRED 시 entryLane=PULLBACK 태깅', () => {
    process.env[FLAG] = 'true';
    const r = evaluateServerGate(pullbackQuote(), DEFAULT_CONDITION_WEIGHTS, 1);
    expect(r.entryLane).toBe('PULLBACK');
    // W4 회귀 — breakout_momentum output 이 FIRED (failed/wait 아님) → Gate2 비누수.
    const breakout = r.outputs?.find((o) => o.key === 'breakout_momentum');
    expect(breakout?.output?.status).toBe('FIRED');
  });

  it('W5 — force-ON shadow stamp 은 flag 무관 항상 산출 (flag OFF 에서도)', () => {
    const r = evaluateServerGate(pullbackQuote(), DEFAULT_CONDITION_WEIGHTS, 1);
    expect(r.pullbackLaneShadow).toBeDefined();
    expect(r.pullbackLaneShadow?.pullbackLaneHypotheticalFired).toBe(true);
    expect(r.pullbackLaneShadow?.pullbackLanePosVsHigh20d).toBeCloseTo(0.95, 5);
  });

  it('flag ON 이지만 눌림목 조건 미충족 → entryLane undefined', () => {
    process.env[FLAG] = 'true';
    // price/high20d=0.80 (하한 미달) → 눌림목 미발화.
    const r = evaluateServerGate(pullbackQuote({ price: 80, high20d: 100, ma20: 70 }), DEFAULT_CONDITION_WEIGHTS, 1);
    expect(r.entryLane).toBeUndefined();
  });
});
