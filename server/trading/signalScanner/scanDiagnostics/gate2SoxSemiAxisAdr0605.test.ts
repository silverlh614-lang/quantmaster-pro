// @responsibility ADR-0605 회귀 — flag OFF no-op·반도체 한정·기존 커버리지 보존·stockVsSector 만 주입(62 캡).
import { describe, expect, it } from 'vitest';
import { hydrateGate2SoxSemiAxisAdr0605, isGate2SoxSectorAxisEnabled } from './gate2SoxSemiAxisAdr0605.js';

describe('gate2SoxSemiAxisAdr0605', () => {
  it('flag 미설정 → default OFF, 전체 no-op', () => {
    expect(isGate2SoxSectorAxisEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    const snapshot = { symbol: '042700', sector: '반도체장비', return20d: 12 };
    const report = hydrateGate2SoxSemiAxisAdr0605({
      candidateSnapshots: [snapshot],
      sox20dReturn: 5,
      env: {} as NodeJS.ProcessEnv,
    });
    expect(report.enabled).toBe(false);
    expect(report.hydrated).toBe(0);
    expect(snapshot).not.toHaveProperty('gate2ExternalDataCoverage');
  });

  it('ON + SOX 가용 → 반도체 결손 후보만 PARTIAL 주입 (stockVsSector 만 — currentLeader 민팅 불가)', () => {
    const env = { GATE2_SOX_SECTOR_AXIS_ENABLED: 'true' } as NodeJS.ProcessEnv;
    const semi = { symbol: '042700', sector: '반도체장비', return20d: 12 };
    const semiCovered = {
      symbol: '000660',
      sector: '반도체',
      return20d: 8,
      gate2ExternalDataCoverage: { sectorCycle: { status: 'VERIFIED' } },
    };
    const nonSemi = { symbol: '035420', sector: '인터넷', return20d: 20 };
    const report = hydrateGate2SoxSemiAxisAdr0605({
      candidateSnapshots: [semi, semiCovered, nonSemi],
      sox20dReturn: 5.04,
      env,
    });
    expect(report).toMatchObject({ enabled: true, soxAvailable: true, semiconductorCandidates: 2, hydrated: 1 });

    const cycle = (semi as { gate2ExternalDataCoverage?: { sectorCycle?: Record<string, unknown> } })
      .gate2ExternalDataCoverage?.sectorCycle;
    expect(cycle).toMatchObject({
      status: 'PARTIAL',
      available: true,
      hydratedBy: 'ADR_0605_SOX_GLOBAL_SEMI_PROXY',
      values: { sectorReturn20d: 5, stockVsSectorReturn20d: 7 },
    });
    // currentLeader 경로 차단 — sectorRelativeReturn20d 미주입 (최대 62 자연 캡).
    expect((cycle?.values as Record<string, unknown>)).not.toHaveProperty('sectorRelativeReturn20d');
    expect(semiCovered.gate2ExternalDataCoverage.sectorCycle.status).toBe('VERIFIED');
    expect(nonSemi).not.toHaveProperty('gate2ExternalDataCoverage');
  });

  it('SOX 결손 → 주입 0 (결손 ≠ 신호)', () => {
    const env = { GATE2_SOX_SECTOR_AXIS_ENABLED: 'true' } as NodeJS.ProcessEnv;
    const semi = { symbol: '042700', sector: '반도체장비', return20d: 12 };
    const report = hydrateGate2SoxSemiAxisAdr0605({ candidateSnapshots: [semi], sox20dReturn: null, env });
    expect(report.soxAvailable).toBe(false);
    expect(report.hydrated).toBe(0);
  });
});
