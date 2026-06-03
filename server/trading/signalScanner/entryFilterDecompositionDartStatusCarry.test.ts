// @responsibility DART_STATUS_CARRY 오탐 정정 특성화 테스트 — 대표표본→분포집계 전환 (a)→OK·(b)→VIOLATION, KIS_FLOW_CARRY 불변.

import { describe, expect, it } from 'vitest';
import {
  buildEntryFilterDecomposition,
  formatEntryFilterDecompositionSection,
  type CandidateSnapshot,
} from './entryFilterDecomposition.js';

const now = new Date('2026-06-03T01:00:00.000Z');

function macro(overrides: Partial<NonNullable<Parameters<typeof buildEntryFilterDecomposition>[0]['macroGateState']>> = {}) {
  return {
    emergencyStop: false,
    autoTradeEnabled: true,
    regime: 'R3_EARLY',
    kellyMultiplierFromRegime: 0.7,
    fomcPhase: 'NORMAL',
    fomcKellyMultiplier: 1,
    finalKellyMultiplier: 0.26,
    vixGatingActive: false,
    bearDefenseMode: false,
    mhsBelow30: false,
    watchlistEmpty: false,
    sellOnlyMode: false,
    ...overrides,
  };
}

// candidate snapshot whose Gate2 외부 데이터의 DART line 상태를 지정한다.
// dartLineHealth.status 가 resolveFinancialBaselineView 의 dartConnectionStatus 를 결정한다:
//   NOT_ATTEMPTED|''        → NOT_ATTEMPTED (미시도)
//   DEGRADED + providerIssue → CONNECTION_DEGRADED (시도됨, transport error)
//   VERIFIED|PARTIAL|EMPTY_VALID → CONNECTED_OK (시도됨)
function dartCandidate(symbol: string, dartLineStatus: string, providerIssue = false): CandidateSnapshot {
  return {
    symbol,
    stageReached: 'WATCHLIST',
    gate2ExternalDataCoverage: {
      dartFinancials: { status: dartLineStatus === 'NOT_ATTEMPTED' ? 'MISSING' : dartLineStatus },
      dartLineHealth: { status: dartLineStatus, providerIssue },
    },
  } as CandidateSnapshot;
}

function dartStatusCarryLine(formatted: string): string {
  const line = formatted.split('\n').find((l) => l.includes('DART_STATUS_CARRY'));
  return line ?? '(DART_STATUS_CARRY line absent)';
}

function kisFlowCarryLine(formatted: string): string {
  const line = formatted.split('\n').find((l) => l.includes('KIS_FLOW_CARRY'));
  return line ?? '(KIS_FLOW_CARRY line absent)';
}

function buildWith(candidateSnapshots: CandidateSnapshot[]) {
  return buildEntryFilterDecomposition({
    now,
    universeCandidates: candidateSnapshots.length,
    watchlistCandidates: candidateSnapshots.length,
    entries: 0,
    macroGateState: macro(),
    candidateSnapshots,
  });
}

describe('DART_STATUS_CARRY false-positive correction (대표표본 → 분포집계)', () => {
  // 시나리오 (a): 대표[0]=NOT_ATTEMPTED 이지만 후보군 분포에 attempted 종목이 다수.
  // 정정 전(대표 1건 단항 검사)이라면 VIOLATION. 정정 후(분포 집계)는 OK 여야 한다 (false-positive 해소).
  it('(a) representative[0]=NOT_ATTEMPTED with attempted symbols in distribution → OK', () => {
    const candidateSnapshots: CandidateSnapshot[] = [
      dartCandidate('A0', 'NOT_ATTEMPTED'), // 대표 표본 [0]
      ...Array.from({ length: 22 }, (_, i) => dartCandidate(`N${i}`, 'NOT_ATTEMPTED')),
      ...Array.from({ length: 25 }, (_, i) => dartCandidate(`D${i}`, 'DEGRADED', true)), // CONNECTION_DEGRADED (시도됨)
      ...Array.from({ length: 3 }, (_, i) => dartCandidate(`C${i}`, 'VERIFIED')), // CONNECTED_OK (시도됨)
    ];
    const formatted = formatEntryFilterDecompositionSection(buildWith(candidateSnapshots)) ?? '';
    // 대표 표본 한 줄은 여전히 NOT_ATTEMPTED 를 보고할 수 있으나, invariant 는 분포 기준.
    expect(dartStatusCarryLine(formatted)).toBe('[OK] DART_STATUS_CARRY');
    expect(formatted).not.toContain('[VIOLATION] DART_STATUS_CARRY');
  });

  // 시나리오 (b): 전체 NOT_ATTEMPTED — DART 배선 완전 단절. 진짜 단절은 계속 탐지(안전망 보존).
  it('(b) all candidates NOT_ATTEMPTED → VIOLATION (true wiring break still detected)', () => {
    const candidateSnapshots = Array.from({ length: 30 }, (_, i) => dartCandidate(`N${i}`, 'NOT_ATTEMPTED'));
    const formatted = formatEntryFilterDecompositionSection(buildWith(candidateSnapshots)) ?? '';
    expect(dartStatusCarryLine(formatted)).toBe('[VIOLATION] DART_STATUS_CARRY');
  });

  // 시나리오 (c): 대표[0]=CONNECTED_OK → 정정 전후 모두 OK.
  it('(c) representative[0]=CONNECTED_OK → OK (unchanged before/after)', () => {
    const candidateSnapshots: CandidateSnapshot[] = [
      dartCandidate('A0', 'VERIFIED'),
      ...Array.from({ length: 10 }, (_, i) => dartCandidate(`N${i}`, 'NOT_ATTEMPTED')),
    ];
    const formatted = formatEntryFilterDecompositionSection(buildWith(candidateSnapshots)) ?? '';
    expect(dartStatusCarryLine(formatted)).toBe('[OK] DART_STATUS_CARRY');
  });

  // KIS_FLOW_CARRY 는 이미 canonical/분포 집계 기반 — 동일 시나리오에서 불변(canonical 미주입 시 항상 OK).
  // DART 정정의 정렬 기준점이며, 본 정정으로 인해 KIS_FLOW_CARRY 판정이 바뀌지 않음을 단언한다.
  it('KIS_FLOW_CARRY remains OK across (a)/(b)/(c) (already distribution-aligned, invariant unchanged)', () => {
    const scenarioA: CandidateSnapshot[] = [
      dartCandidate('A0', 'NOT_ATTEMPTED'),
      ...Array.from({ length: 25 }, (_, i) => dartCandidate(`D${i}`, 'DEGRADED', true)),
    ];
    const scenarioB = Array.from({ length: 30 }, (_, i) => dartCandidate(`N${i}`, 'NOT_ATTEMPTED'));
    const scenarioC: CandidateSnapshot[] = [dartCandidate('A0', 'VERIFIED'), dartCandidate('N0', 'NOT_ATTEMPTED')];
    for (const snaps of [scenarioA, scenarioB, scenarioC]) {
      const formatted = formatEntryFilterDecompositionSection(buildWith(snaps)) ?? '';
      expect(kisFlowCarryLine(formatted)).toBe('[OK] KIS_FLOW_CARRY');
    }
  });

  // executionImpact / marketSignal 무변경 안전망 — DART 분포 정정은 진단/표시 전용이어야 한다.
  it('DataLine invariants block keeps executionImpact=NONE marketSignal=false (display-only)', () => {
    const candidateSnapshots: CandidateSnapshot[] = [
      dartCandidate('A0', 'NOT_ATTEMPTED'),
      dartCandidate('C0', 'VERIFIED'),
    ];
    const formatted = formatEntryFilterDecompositionSection(buildWith(candidateSnapshots)) ?? '';
    expect(formatted).toContain('Gate2 DataLine Invariants:');
    expect(formatted).toContain('executionImpact=NONE');
    expect(formatted).toContain('marketSignal=false');
  });
});
