// @responsibility step26 canonicalDisplay regimeDisplayConflict/legacyPathUsed 정합 테스트 (riskOverride 분기 정상화).

import { describe, expect, it } from 'vitest';
import { formatGatePositiveRuntimeAlignmentSection } from './runtimeResolverTraceStep26.js';
import type { ScanSummary } from './scanDiagnostics/scanSummaryTypes.js';

function makeSummary(macroGateState: Record<string, unknown>): ScanSummary {
  return {
    time: '2026-06-22T09:31:00.000+09:00',
    snapshotId: 'scan-eval-canonicaldisplay',
    candidates: 1,
    macroGateState: macroGateState as never,
    entryFilterDecomposition: {
      candidateTraces: [{ symbol: '005930' }],
    } as never,
  } as unknown as ScanSummary;
}

describe('canonicalDisplay regimeDisplayConflict — riskOverride 분기 정상화', () => {
  it('effective=R3_EARLY, display=riskOverride=R5_STABILIZING → conflict 아님 (설계상 보수적 override 표시)', () => {
    // 06-22 거래일 시나리오: scoring effective 와 보수적 display 가 다른 것은 정상.
    const out = formatGatePositiveRuntimeAlignmentSection(
      makeSummary({
        macroRegimeEffective: 'R3_EARLY',
        displayRegime: 'R5_STABILIZING',
        riskOverride: 'R5_STABILIZING',
        regime: 'R4_NEUTRAL',
      }),
    );
    expect(out).toContain('regimeDisplayConflict=false');
    expect(out).toContain('legacyPathUsed=false');
  });

  it('display 가 riskOverride 와 어긋남(R6 중 GREEN 등) → conflict 유지 (안전 신호 보존)', () => {
    const out = formatGatePositiveRuntimeAlignmentSection(
      makeSummary({
        macroRegimeEffective: 'R3_EARLY',
        displayRegime: 'GREEN',
        riskOverride: 'R6_DEFENSE',
        regime: 'R6_DEFENSE',
      }),
    );
    expect(out).toContain('regimeDisplayConflict=true');
    expect(out).toContain('legacyPathUsed=true');
  });

  it('effective=display → conflict 아님 (분기 없음)', () => {
    const out = formatGatePositiveRuntimeAlignmentSection(
      makeSummary({
        macroRegimeEffective: 'R3_EARLY',
        displayRegime: 'R3_EARLY',
        riskOverride: 'R3_EARLY',
        regime: 'R3_EARLY',
      }),
    );
    expect(out).toContain('regimeDisplayConflict=false');
    expect(out).toContain('legacyPathUsed=false');
  });

  it('legacy R6 effective 누수(staleLegacyR6Path) → conflict 아님 (기존 동작 보존)', () => {
    const out = formatGatePositiveRuntimeAlignmentSection(
      makeSummary({
        macroRegimeEffective: 'R6_DEFENSE',
        displayRegime: 'SHADOW_ONLY',
        riskOverride: 'SHADOW_ONLY',
        regime: 'R3_EARLY',
      }),
    );
    expect(out).toContain('regimeDisplayConflict=false');
  });
});
