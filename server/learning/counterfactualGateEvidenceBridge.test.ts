// @responsibility Gate2 seed·Gate3 evidence 표시 브리지 회귀 — 밴드 집계·빈 ledger·모드 라우팅·실패 격리.
import { describe, expect, it } from 'vitest';
import {
  appendGateEvidenceForMode,
  buildGate2SeedEvidenceLines,
  buildGate3EvidenceLines,
} from './counterfactualGateEvidenceBridge.js';

describe('counterfactualGateEvidenceBridge', () => {
  it('Gate2 seed — status 밴드 집계 (matureD5/avgD5/win)', () => {
    const text = buildGate2SeedEvidenceLines([
      { gate2Status: 'GATE2_PASS_WEAK', forwardReturns: { d5: 4 } },
      { gate2Status: 'GATE2_PASS_WEAK', forwardReturns: { d5: -2 } },
      { gate2Status: 'GATE2_WATCH', forwardReturns: { d5: null } },
    ]);
    expect(text).toContain('[Gate2 Seed Evidence — native ledger]');
    expect(text).toContain('GATE2_PASS_WEAK: n=2 matureD5=2 avgD5=1.00% win=50%');
    expect(text).toContain('GATE2_WATCH: n=1 matureD5=0 avgD5=N/A win=N/A');
    expect(text).toContain('rows=3 source=gate2OutcomeRepo executionImpact=NONE');
  });

  it('Gate3 evidence — readiness 밴드 집계 + 빈 ledger 정직 표시', () => {
    const text = buildGate3EvidenceLines([
      { readiness: 'TRIGGER_WAIT', forwardReturns: { d5: 3.5 } },
      { readiness: 'TIMING_FAIL', forwardReturns: { d5: -6 } },
    ]);
    expect(text).toContain('TRIGGER_WAIT: n=1 matureD5=1 avgD5=3.50% win=100%');
    expect(text).toContain('TIMING_FAIL: n=1');
    expect(buildGate3EvidenceLines([])).toContain('rows=0 — seed 누적 대기');
  });

  it('appendGateEvidenceForMode — gate2/gate3 만 덧붙이고 다른 모드는 무변경', () => {
    expect(appendGateEvidenceForMode('gate1', 'BASE')).toBe('BASE');
    expect(appendGateEvidenceForMode('gate3', 'BASE')).toContain('[Gate3 Outcome Evidence — native ledger]');
    expect(appendGateEvidenceForMode('gate2', 'BASE').startsWith('BASE\n')).toBe(true);
  });
});
