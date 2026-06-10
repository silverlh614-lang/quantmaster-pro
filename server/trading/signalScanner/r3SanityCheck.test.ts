/**
 * @responsibility ADR-0120 PR-B R3 Sanity Check 회귀 테스트
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateR3Sanity,
  R3_SANITY_THRESHOLDS,
} from './r3SanityCheck.js';
import type { GatePassDistribution, MacroGateState, ScanSummary, WaitDistribution } from './scanDiagnostics.js';

const baseMacro: MacroGateState = {
  emergencyStop: false,
  autoTradeEnabled: true,
  regime: 'R3_EARLY',
  kellyMultiplierFromRegime: 1.0,
  fomcPhase: 'NORMAL',
  fomcKellyMultiplier: 1.0,
  finalKellyMultiplier: 1.0,
  vixGatingActive: false,
  bearDefenseMode: false,
  mhsBelow30: false,
  watchlistEmpty: false,
  sellOnlyMode: false,
};

const baseWait: WaitDistribution = {
  dataHold: 0, preBreakout: 0, gateFail: 0, sizingBlocked: 0,
  driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0,
};

const baseGpd: GatePassDistribution = {
  gate1Pass: 5,
  gate2Pass: 2,
  gate3Pass: 1,
  lastTriggerPass: 0,
};

function makeR3Summary(
  overrides: Partial<{
    regime: string;
    candidates: number;
    entries: number;
    gpd: GatePassDistribution | undefined;
  }> = {},
): ScanSummary {
  // 'gpd' in overrides 로 명시 미전달 (default baseGpd) vs 명시 undefined (gpd 미설정) 구분.
  const gpdResolved =
    'gpd' in overrides ? overrides.gpd : { ...baseGpd };
  return {
    time: '14:30 KST',
    candidates: overrides.candidates ?? 10,
    trackB: overrides.candidates ?? 10,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    quoteFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: overrides.entries ?? 0,
    waitDistribution: { ...baseWait },
    macroGateState: { ...baseMacro, regime: overrides.regime ?? 'R3_EARLY' },
    ...(gpdResolved === undefined ? {} : { gatePassDistribution: gpdResolved }),
  };
}

describe('evaluateR3Sanity — 분기 + 임계 + dedupeKey', () => {
  it('null summary → violation=NONE', () => {
    const result = evaluateR3Sanity(null);
    expect(result.violation).toBe('NONE');
    expect(result.isR3).toBe(false);
  });

  it('R3 아닌 레짐 (R2_BULL) → violation=NONE + isR3=false', () => {
    const summary = makeR3Summary({ regime: 'R2_BULL' });
    const result = evaluateR3Sanity(summary);
    expect(result.violation).toBe('NONE');
    expect(result.isR3).toBe(false);
  });

  it('R3 + entries > 0 → violation=NONE (정상 매수 발생)', () => {
    const summary = makeR3Summary({ entries: 3 });
    const result = evaluateR3Sanity(summary);
    expect(result.violation).toBe('NONE');
    expect(result.isR3).toBe(true);
  });

  it('R3 + candidates 0 → CANDIDATES_ZERO + 메시지 + dedupeKey', () => {
    const summary = makeR3Summary({ candidates: 0 });
    const result = evaluateR3Sanity(summary);
    expect(result.violation).toBe('CANDIDATES_ZERO');
    expect(result.message).toContain('R3 Sanity Violation');
    expect(result.message).toContain('autoPopulateWatchlist');
    expect(result.dedupeKey).toMatch(/^r3_sanity_candidates_zero:\d{4}-\d{2}-\d{2}$/);
  });

  it('R3 + GatePassDistribution 부재 → GATE_PASS_DATA_MISSING 진단', () => {
    const summary = makeR3Summary({ gpd: undefined });
    const result = evaluateR3Sanity(summary);
    expect(result.violation).toBe('GATE_PASS_DATA_MISSING');
    expect(result.message).toContain('GatePassDistribution');
    expect(result.message).toContain('wiring 미완');
    expect(result.dedupeKey).toMatch(/^r3_sanity_gpd_missing:/);
  });

  it('R3 + Gate 1 통과 0개 → GATE1_PASS_ZERO + 시스템 결함 의심 메시지', () => {
    const summary = makeR3Summary({
      candidates: 50,
      gpd: { gate1Pass: 0, gate2Pass: 0, gate3Pass: 0, lastTriggerPass: 0 },
    });
    const result = evaluateR3Sanity(summary);
    expect(result.violation).toBe('GATE1_PASS_ZERO');
    expect(result.isR3).toBe(true);
    expect(result.message).toContain('시스템 결함 의심');
    expect(result.message).toContain('Gate threshold 과도');
    expect(result.message).toContain('EXECUTION_RELAXATION_ENABLED');
    expect(result.message).toContain('Yahoo stale base');
    expect(result.message).toContain('27조건 점수 산출');
    expect(result.dedupeKey).toMatch(/^r3_sanity_gate1_zero:/);
  });

  it('R3 + Gate 1 통과 ≥ 1 → violation=NONE (정상 — 시장 대기)', () => {
    const summary = makeR3Summary({
      gpd: { gate1Pass: 5, gate2Pass: 0, gate3Pass: 0, lastTriggerPass: 0 },
    });
    const result = evaluateR3Sanity(summary);
    expect(result.violation).toBe('NONE');
    expect(result.isR3).toBe(true);
  });

  it('R3_RECOVERY (R3* 변형) 도 isR3=true', () => {
    const summary = makeR3Summary({
      regime: 'R3_RECOVERY',
      gpd: { gate1Pass: 0, gate2Pass: 0, gate3Pass: 0, lastTriggerPass: 0 },
    });
    const result = evaluateR3Sanity(summary);
    expect(result.violation).toBe('GATE1_PASS_ZERO');
    expect(result.isR3).toBe(true);
  });

  it('R6_DEFENSE → isR3=false (R3 sanity 적용 안 함)', () => {
    const summary = makeR3Summary({ regime: 'R6_DEFENSE' });
    const result = evaluateR3Sanity(summary);
    expect(result.isR3).toBe(false);
    expect(result.violation).toBe('NONE');
  });

  it('macroGateState 부재 → R3 검출 불가 → violation=NONE', () => {
    const summary: ScanSummary = {
      time: '14:30 KST',
      candidates: 5,
      trackB: 5,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      quoteFails: 0,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 0,
    };
    const result = evaluateR3Sanity(summary);
    expect(result.isR3).toBe(false);
    expect(result.violation).toBe('NONE');
  });
});

describe('R3_SANITY_THRESHOLDS 상수 SSOT', () => {
  it('MIN_GATE1_PASS = 1 (사용자 §6 정합)', () => {
    expect(R3_SANITY_THRESHOLDS.MIN_GATE1_PASS).toBe(1);
  });

  it('MIN_CANDIDATES = 1 (워치리스트 최소 보장)', () => {
    expect(R3_SANITY_THRESHOLDS.MIN_CANDIDATES).toBe(1);
  });
});
