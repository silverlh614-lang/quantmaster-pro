// @responsibility ADR-0605 회귀 — flag OFF no-op·반도체 한정·기존 커버리지 보존·stockVsSector 만 주입(62 캡)·flag 무관 관측 산출.
import { describe, expect, it } from 'vitest';
import {
  buildGate2SoxObservation,
  hydrateGate2SoxSemiAxisAdr0605,
  isGate2SoxSectorAxisEnabled,
} from './gate2SoxSemiAxisAdr0605.js';

describe('gate2SoxSemiAxisAdr0605', () => {
  it('flag 미설정 → default OFF, hydration 전체 no-op (스냅샷 mutate 0)', () => {
    expect(isGate2SoxSectorAxisEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    const snapshot = { symbol: '042700', sector: '반도체장비', return20d: 12 };
    const report = hydrateGate2SoxSemiAxisAdr0605({
      candidateSnapshots: [snapshot],
      sox20dReturn: 5,
      env: {} as NodeJS.ProcessEnv,
    });
    expect(report.enabled).toBe(false);
    expect(report.hydrated).toBe(0);
    // flag OFF 여도 스냅샷은 mutate 되지 않는다 (관측은 read-only).
    expect(snapshot).not.toHaveProperty('gate2ExternalDataCoverage');
  });

  it('flag OFF 여도 observation 산출 — 결손-커버리지 모집단·dry-run 버킷 정확 (스냅샷 mutate 0)', () => {
    const semiMissing = { symbol: '042700', sector: '반도체장비', return20d: 12 };          // stockVsSector=7 → 62
    const semiNeutral = { symbol: '000990', sector: '반도체', return20d: 6 };               // stockVsSector=1 → 50
    const semiCovered = {
      symbol: '000660', sector: '반도체', return20d: 8,
      gate2ExternalDataCoverage: { sectorCycle: { status: 'VERIFIED' } },
    };
    const nonSemi = { symbol: '035420', sector: '인터넷', return20d: 20 };
    const report = hydrateGate2SoxSemiAxisAdr0605({
      candidateSnapshots: [semiMissing, semiNeutral, semiCovered, nonSemi],
      sox20dReturn: 5,
      env: {} as NodeJS.ProcessEnv,        // flag OFF
    });
    expect(report.enabled).toBe(false);
    const obs = report.observation!;
    expect(obs.observed).toBe(true);
    expect(obs.sox20dReturn).toBe(5);
    expect(obs.semiconductorCandidates).toBe(3);          // covered 포함 (semi 식별)
    expect(obs.sectorCycleMissingCandidates).toBe(2);     // covered 제외 (결손-커버리지 모집단)
    expect(obs.dryRunEvaluable).toBe(2);
    expect(obs.scoreDelta).toMatchObject({
      count: 2, baselineIncluded: false, baselineScore: null,
      bucket62: 1, bucket50: 1, bucket35: 0,
    });
    expect(obs.scoreDelta.avgScore).toBe(56);             // (62+50)/2 — null 산술 없음
    expect(obs.scoreDelta.maxScore).toBe(62);
    expect(obs.coverageRatio).toBe(1);                    // 2/2
    expect(obs.executionImpact).toBe('NONE');
    // flag OFF → 스냅샷 어느 것도 mutate 되지 않는다.
    expect(semiMissing).not.toHaveProperty('gate2ExternalDataCoverage');
    expect(semiNeutral).not.toHaveProperty('gate2ExternalDataCoverage');
  });

  it('SOX 결손 → observation: sox20dReturn=null·evaluable=0, 모집단은 계속 집계 (결손 ≠ 신호)', () => {
    const semiMissing = { symbol: '042700', sector: '반도체장비', return20d: 12 };
    const obs = buildGate2SoxObservation([semiMissing], null);
    expect(obs.sox20dReturn).toBeNull();
    expect(obs.sectorCycleMissingCandidates).toBe(1);     // 모집단은 sox 결손과 무관하게 집계
    expect(obs.dryRunEvaluable).toBe(0);                  // dry-run 은 sox 결손이면 미평가
    expect(obs.scoreDelta).toMatchObject({ count: 0, bucket62: 0, bucket50: 0, bucket35: 0, avgScore: 0, maxScore: 0 });
    expect(obs.coverageRatio).toBe(0);                    // delta-from-0 산술 없음 (null 미산술)
  });

  it('dry-run 점수는 {62,50} 두 값으로 닫힘 — bucket35 도달 불가(방어적 0), rsAxis BULLISH 도 62', () => {
    const stockLeaderByReturn = { symbol: '042700', sector: '반도체', return20d: 10 };       // vsSector=5 → 62
    const stockLeaderByRs = { symbol: '000990', sector: '반도체', return20d: 5, rsAxisStatus: 'BULLISH' }; // vsSector=0 이지만 BULLISH → 62
    const neutral = { symbol: '000660', sector: '반도체', return20d: 4 };                    // vsSector=-1 → 50
    const deepLag = { symbol: '011070', sector: '반도체', return20d: -2 };                   // vsSector=-7 (≤-5) 이지만 sectorRelative null → 35 미도달 → 50
    const obs = buildGate2SoxObservation([stockLeaderByReturn, stockLeaderByRs, neutral, deepLag], 5);
    expect(obs.scoreDelta.bucket62).toBe(2);
    expect(obs.scoreDelta.bucket50).toBe(2);
    expect(obs.scoreDelta.bucket35).toBe(0);              // 도달 불가 — sectorRelative null
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
    // flag ON 에서도 observation 은 additive 로 공존 — 기존 7필드·주입 동작 byte-identical 유지.
    expect(report.observation?.observed).toBe(true);
    expect(report.observation?.sectorCycleMissingCandidates).toBe(1);
    expect(report.observation?.executionImpact).toBe('NONE');
  });

  it('SOX 결손 → 주입 0 (결손 ≠ 신호)', () => {
    const env = { GATE2_SOX_SECTOR_AXIS_ENABLED: 'true' } as NodeJS.ProcessEnv;
    const semi = { symbol: '042700', sector: '반도체장비', return20d: 12 };
    const report = hydrateGate2SoxSemiAxisAdr0605({ candidateSnapshots: [semi], sox20dReturn: null, env });
    expect(report.soxAvailable).toBe(false);
    expect(report.hydrated).toBe(0);
  });
});
