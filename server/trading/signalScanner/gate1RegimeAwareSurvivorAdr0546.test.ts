// @responsibility ADR-0546 Phase2 prep regime-aware survivor 관측 회귀 테스트.
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGate1RegimeAwareSurvivorObservation,
  formatGate1RegimeAwareSurvivorLine,
} from './gate1RegimeAwareSurvivorAdr0546.js';
import type { Gate1DryRunObservationRow } from './gate1DryRunObservationLedgerAdr0476.js';

function row(symbol: string, finalGate1Score: number): Gate1DryRunObservationRow {
  return { symbol, finalGate1Score } as unknown as Gate1DryRunObservationRow;
}

describe('ADR-0546 Phase2 prep — regime-aware survivor observation', () => {
  const ORIGINAL = process.env.GATE1_REGIME_AWARE_REQUIRED;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GATE1_REGIME_AWARE_REQUIRED;
    else process.env.GATE1_REGIME_AWARE_REQUIRED = ORIGINAL;
  });

  it('R3_EARLY 임계는 40(4×10), wouldPass 는 [40,70) 후보만 집계', () => {
    delete process.env.GATE1_REGIME_AWARE_REQUIRED;
    const rows = [
      row('A', 65.2), // [40,70) → wouldPass
      row('B', 54.6), // [40,70) → wouldPass
      row('C', 35.5), // < 40 → 제외
      row('D', 80.8), // ≥ 70 (이미 통과) → 제외
    ];
    const obs = buildGate1RegimeAwareSurvivorObservation(rows, 'R3_EARLY');
    expect(obs.regimeAwareRequiredScore).toBe(40);
    expect(obs.legacyRequiredScore).toBe(70);
    expect(obs.regimeAwareGap).toBe(30);
    expect(obs.scoredCandidateCount).toBe(4);
    expect(obs.regimeAwareWouldPassCount).toBe(2);
    expect(obs.regimeAwareWouldPassSymbols).toEqual(['A', 'B']); // 점수 내림차순
    expect(obs.regimeAwareRequiredActive).toBe(false); // 동작 보존
    expect(obs.executionImpact).toBe('NONE');
  });

  it('flag ON 이어도 관측 값은 동일하고 active=true 만 반영 (실행 영향 없음)', () => {
    process.env.GATE1_REGIME_AWARE_REQUIRED = 'true';
    const obs = buildGate1RegimeAwareSurvivorObservation([row('A', 50)], 'R3_EARLY');
    expect(obs.regimeAwareRequiredScore).toBe(40);
    expect(obs.regimeAwareWouldPassCount).toBe(1);
    expect(obs.regimeAwareRequiredActive).toBe(true);
    expect(obs.executionImpact).toBe('NONE');
  });

  it('regime 미전달 시 R4_NEUTRAL 폴백(5×10=50) 임계 사용', () => {
    delete process.env.GATE1_REGIME_AWARE_REQUIRED;
    const obs = buildGate1RegimeAwareSurvivorObservation([row('A', 55)], undefined);
    expect(obs.regime).toBe('R4_NEUTRAL');
    expect(obs.regimeAwareRequiredScore).toBe(50);
    expect(obs.regimeAwareWouldPassCount).toBe(1); // 55 ∈ [50,70)
  });

  it('formatGate1RegimeAwareSurvivorLine 은 표시 전용 + executionImpact=NONE 명시', () => {
    const obs = buildGate1RegimeAwareSurvivorObservation([row('A', 65.2)], 'R3_EARLY');
    const line = formatGate1RegimeAwareSurvivorLine(obs);
    expect(line).toContain('regimeAwareWouldPass=1/1');
    expect(line).toContain('executionImpact=NONE');
    expect(formatGate1RegimeAwareSurvivorLine(undefined)).toContain('regimeAwareWouldPass=N/A');
  });
});
