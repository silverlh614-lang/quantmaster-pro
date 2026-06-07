// @responsibility ADR-0583 Phase B — confluence MHS 가드 flag (default OFF byte-identical) 회귀.
import { describe, it, expect, afterEach } from 'vitest';
import { runConfluenceEngine, type ConfluenceInput } from './confluenceEngine.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import type { MacroState } from '../persistence/macroStateRepo.js';

// 매크로 축만 검증 — quote/supply/fundamental 축은 무관(빈 quote 캐스트, throw 없음).
const EMPTY_QUOTE = {} as unknown as YahooQuoteExtended;

function macroAxisFor(macroState: Partial<MacroState>): { score: number; factors: string[] } {
  const input: ConfluenceInput = {
    quote: EMPTY_QUOTE,
    macroState: macroState as MacroState,
    regime: 'R4_NEUTRAL', // REGIME_BASE = 50
    gateScore: 0,
  };
  const { macroAxis } = runConfluenceEngine(input);
  return { score: macroAxis.score, factors: macroAxis.factors };
}

describe('confluence MHS 가드 — flag OFF default byte-identical (ADR-0583)', () => {
  const original = process.env.MHS_DEGRADE_GUARD_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.MHS_DEGRADE_GUARD_ENABLED;
    else process.env.MHS_DEGRADE_GUARD_ENABLED = original;
  });

  it('flag OFF + mhs 75 GREEN(degraded) → 기존 +8 부스트 유지 (byte-identical)', () => {
    delete process.env.MHS_DEGRADE_GUARD_ENABLED;
    const { score, factors } = macroAxisFor({ mhs: 75, mhsDegraded: true });
    expect(score).toBe(58); // 50(base) + 8
    expect(factors).toContain('MHS75GREEN');
    expect(factors).not.toContain('MHS75GREEN_DEGRADED');
  });

  it('flag ON + mhs 75 GREEN + degraded → 낙관 부스트 억제 (+8 → +3)', () => {
    process.env.MHS_DEGRADE_GUARD_ENABLED = 'true';
    const { score, factors } = macroAxisFor({ mhs: 75, mhsDegraded: true });
    expect(score).toBe(53); // 50 + 3
    expect(factors).toContain('MHS75GREEN_DEGRADED');
    expect(factors).not.toContain('MHS75GREEN');
  });

  it('flag ON + mhs 75 GREEN + NOT degraded → 가드 미발동 (기존 +8)', () => {
    process.env.MHS_DEGRADE_GUARD_ENABLED = 'true';
    const { score, factors } = macroAxisFor({ mhs: 75, mhsDegraded: false });
    expect(score).toBe(58);
    expect(factors).toContain('MHS75GREEN');
  });

  it('flag ON + mhs 60 중립부스트 + degraded → +3 부스트 생략 (+3 → 0)', () => {
    process.env.MHS_DEGRADE_GUARD_ENABLED = 'true';
    const degraded = macroAxisFor({ mhs: 60, mhsDegraded: true });
    expect(degraded.score).toBe(50); // 50 + 0
    process.env.MHS_DEGRADE_GUARD_ENABLED = 'false';
    const baseline = macroAxisFor({ mhs: 60, mhsDegraded: true });
    expect(baseline.score).toBe(53); // 50 + 3 (가드 OFF)
  });

  it('flag ON + mhs 35 RED + degraded → 비관 페널티 보존(-15, 안전 방향)', () => {
    process.env.MHS_DEGRADE_GUARD_ENABLED = 'true';
    const { score, factors } = macroAxisFor({ mhs: 35, mhsDegraded: true });
    expect(score).toBe(35); // 50 - 15
    expect(factors).toContain('MHS35RED');
  });
});
