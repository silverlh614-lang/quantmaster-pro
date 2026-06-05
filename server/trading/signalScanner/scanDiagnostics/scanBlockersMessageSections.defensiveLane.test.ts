import { describe, it, expect, afterEach } from 'vitest';
import { buildDefensiveEntryLaneSection } from './scanBlockersMessageSections.js';
import type { MacroGateState } from './scanSummaryTypes.js';

// 방어 적격 trace: 고점 10000 대비 7500(−25%), RSI28, RS +3%, 부채80%, ROE12%.
const qualifyingTrace = {
  symbol: '005930',
  name: '삼성전자',
  quote: { price: 7500, high60d: 10000, rsi14: 28 },
  symbolFeatures: { relativeReturn20d: 3 },
  gateLayerSummary: { gate2: { externalDataCoverage: { dartFinancials: { debtRatio: 80, roe: 12 } } } },
};
// 부적격(과매도 아님: 고점 −5%).
const nonQualifyingTrace = {
  symbol: '000660',
  quote: { price: 9500, high60d: 10000, rsi14: 50 },
  symbolFeatures: { relativeReturn20d: -2 },
  gateLayerSummary: { gate2: { externalDataCoverage: { dartFinancials: { debtRatio: 80, roe: 12 } } } },
};
const r6Defense = { regime: 'R6_DEFENSE', activeR6Triggers: ['KOSPI_CLOSE_SHOCK'], riskOverride: 'SHADOW_ONLY' } as unknown as MacroGateState;
const r6Panic = { regime: 'R6_DEFENSE', activeR6Triggers: ['KOSPI_CRASH'], riskOverride: 'SHADOW_ONLY' } as unknown as MacroGateState;
const r4Neutral = { regime: 'R4_NEUTRAL', activeR6Triggers: [] } as unknown as MacroGateState;

describe('buildDefensiveEntryLaneSection (ADR-0575 Phase1b)', () => {
  const ORIG = process.env.DEFENSIVE_ENTRY_LANE_ENABLED;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.DEFENSIVE_ENTRY_LANE_ENABLED;
    else process.env.DEFENSIVE_ENTRY_LANE_ENABLED = ORIG;
  });

  it('flag OFF → 빈 배열(byte-identical)', () => {
    process.env.DEFENSIVE_ENTRY_LANE_ENABLED = 'false';
    expect(buildDefensiveEntryLaneSection([qualifyingTrace], r6Defense)).toEqual([]);
  });

  it('비-R6(R4_NEUTRAL) → 빈 배열(레인 비활성)', () => {
    process.env.DEFENSIVE_ENTRY_LANE_ENABLED = 'true';
    expect(buildDefensiveEntryLaneSection([qualifyingTrace], r4Neutral)).toEqual([]);
  });

  it('R6 DEFENSE + flag + 적격 trace → 적격 표시 + Kelly ×0.30', () => {
    process.env.DEFENSIVE_ENTRY_LANE_ENABLED = 'true';
    const lines = buildDefensiveEntryLaneSection([qualifyingTrace], r6Defense);
    const text = lines.join('\n');
    expect(text).toContain('방어 진입 레인');
    expect(text).toContain('R6_DEFENSE');
    expect(text).toContain('×0.30');
    expect(text).toContain('방어 적격 1건');
    expect(text).toContain('005930');
    expect(text).toContain('executionImpact=NONE');
  });

  it('R6 PANIC(KOSPI_CRASH) → ×0.15', () => {
    process.env.DEFENSIVE_ENTRY_LANE_ENABLED = 'true';
    const text = buildDefensiveEntryLaneSection([qualifyingTrace], r6Panic).join('\n');
    expect(text).toContain('R6_PANIC');
    expect(text).toContain('×0.15');
  });

  it('R6 + 부적격 trace(과매도 아님) → 적격 0건', () => {
    process.env.DEFENSIVE_ENTRY_LANE_ENABLED = 'true';
    const text = buildDefensiveEntryLaneSection([nonQualifyingTrace], r6Defense).join('\n');
    expect(text).toContain('방어 적격 0건');
  });

  it('재무 미상(externalDataCoverage 없음) → 보수적 탈락(0건)', () => {
    process.env.DEFENSIVE_ENTRY_LANE_ENABLED = 'true';
    const noFin = { symbol: '111', quote: { price: 7000, high60d: 10000, rsi14: 25 }, symbolFeatures: { relativeReturn20d: 5 } };
    const text = buildDefensiveEntryLaneSection([noFin], r6Defense).join('\n');
    expect(text).toContain('방어 적격 0건');
  });
});
