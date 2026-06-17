// @responsibility ADR-0622 회귀 — 양 flag OFF byte-identical(top-N 60·정렬)·②ON top-N 90·③ON positive-RS 우선/laggard 디모트·결손 중립·benchmark 결손 무변경·주도주 union 직교·dry-run flag 무관 산출·ledger atomic/FIFO/upsert/손상fallback·두 번째 RS 공식 없음·quota budget lazy.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CandidateStock } from './pipelineHelpers.js';
import type { DynamicStock } from './dynamicUniverseExpander.js';
import {
  STAGE1_TOPN_BASE,
  STAGE1_TOPN_EXPANDED,
  isUniverseStage1TopNExpansionEnabled,
  resolveStage1TopN,
  isUniverseRsPercentileRankEnabled,
  computeRsPercentiles,
  rsPriorityComparator,
  computeUniverseDiscoveryAggressivenessObservation,
  appendUniverseDiscoveryAggressivenessObservation,
  loadUniverseDiscoveryAggressivenessLedger,
  __resetUniverseDiscoveryAggressivenessLedgerForTests,
  todayKst,
  UNIVERSE_DISCOVERY_AGGRESSIVENESS_WINDOW_SCANS,
  type UniverseDiscoveryAggressivenessObservation,
} from './universeDiscoveryAggressivenessAdr0622.js';
import { UNIVERSE_RS_LEADER_THRESHOLD } from './universeCompositionBiasObservationAdr0616.js';
import { applyLeaderPreservation } from './leaderUniverseInjectionAdr0617.js';

// ── fixtures ────────────────────────────────────────────────────────────────────

function tmpFile(): string {
  return path.join(os.tmpdir(), `uda-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

/** 최소 후보 — stage1Score·return20d·source 만 의미. quote 는 캐스트로 충족. */
function candidate(
  code: string,
  stage1Score: number,
  return20d?: number,
  source?: DynamicStock['source'],
): CandidateStock {
  return {
    code,
    name: code,
    symbol: code,
    sector: '반도체',
    stage1Score,
    ...(source !== undefined ? { source } : {}),
    quote: { price: 1000, return20d } as unknown as CandidateStock['quote'],
  };
}

const NOW = new Date('2026-06-16T01:00:00Z'); // KST 2026-06-16 10:00

// ── ② 수량: resolveStage1TopN / flag SSOT ─────────────────────────────────────────

describe('② resolveStage1TopN', () => {
  it('상수 baseline=60·expanded=90', () => {
    expect(STAGE1_TOPN_BASE).toBe(60);
    expect(STAGE1_TOPN_EXPANDED).toBe(90);
  });

  it('flag SSOT — 정확 비교 (=== "true" 만 ON)', () => {
    expect(isUniverseStage1TopNExpansionEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isUniverseStage1TopNExpansionEnabled({ UNIVERSE_STAGE1_TOPN_EXPANSION_ENABLED: 'false' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isUniverseStage1TopNExpansionEnabled({ UNIVERSE_STAGE1_TOPN_EXPANSION_ENABLED: '1' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isUniverseStage1TopNExpansionEnabled({ UNIVERSE_STAGE1_TOPN_EXPANSION_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('(a) OFF → 60 byte-identical', () => {
    expect(resolveStage1TopN(false)).toBe(60);
  });

  it('(b) ON → 90', () => {
    expect(resolveStage1TopN(true)).toBe(90);
  });
});

// ── ③ 방향: computeRsPercentiles (두 번째 RS 공식 없음 — ADR-0616 정의 재사용) ──────

describe('③ computeRsPercentiles', () => {
  it('(g) RS = quote.return20d − benchmark (ADR-0616 정의·UNIVERSE_RS_LEADER_THRESHOLD 재사용)', () => {
    // benchmark 5% — A=+10%(rs +5 leader), B=+5%(rs 0 leader, THRESHOLD=0 귀속), C=-2%(rs -7 laggard)
    expect(UNIVERSE_RS_LEADER_THRESHOLD).toBe(0);
    const cands = [candidate('A', 50, 10), candidate('B', 40, 5), candidate('C', 30, -2)];
    const ranks = computeRsPercentiles(cands, 5);
    expect(ranks.get('A')!.rs).toBe(5);
    expect(ranks.get('B')!.rs).toBe(0);
    expect(ranks.get('C')!.rs).toBe(-7);
    expect(ranks.get('A')!.isLeader).toBe(true);
    expect(ranks.get('B')!.isLeader).toBe(true); // rs=0 → leader (>=)
    expect(ranks.get('C')!.isLeader).toBe(false);
  });

  it('percentile cross-sectional — 최하위 0·최상위 100', () => {
    const cands = [candidate('A', 50, 10), candidate('B', 40, 5), candidate('C', 30, -2)];
    const ranks = computeRsPercentiles(cands, 5);
    // denom = 3-1 = 2. C(rs -7) lower=0 → 0. B(rs 0) lower=1 → 50. A(rs 5) lower=2 → 100.
    expect(ranks.get('C')!.percentile).toBe(0);
    expect(ranks.get('B')!.percentile).toBe(50);
    expect(ranks.get('A')!.percentile).toBe(100);
  });

  it('산출 가능 후보 1건 → percentile 100', () => {
    const cands = [candidate('A', 50, 10)];
    const ranks = computeRsPercentiles(cands, 5);
    expect(ranks.get('A')!.percentile).toBe(100);
  });

  it('(③ 결손 중립) return20d 결손 후보는 rs/percentile/isLeader null', () => {
    const cands = [candidate('A', 50, 10), candidate('B', 40, undefined), candidate('C', 30, NaN)];
    const ranks = computeRsPercentiles(cands, 5);
    expect(ranks.get('A')!.rs).toBe(5);
    expect(ranks.get('B')!.rs).toBeNull();
    expect(ranks.get('B')!.percentile).toBeNull();
    expect(ranks.get('B')!.isLeader).toBeNull();
    expect(ranks.get('C')!.rs).toBeNull();
  });

  it('(d-benchmark 결손) benchmark undefined/NaN/Infinity → 전건 결손(rs null)', () => {
    const cands = [candidate('A', 50, 10), candidate('B', 40, -5)];
    for (const bad of [undefined, null, NaN, Infinity]) {
      const ranks = computeRsPercentiles(cands, bad as number | null | undefined);
      expect(ranks.get('A')!.rs).toBeNull();
      expect(ranks.get('A')!.isLeader).toBeNull();
      expect(ranks.get('B')!.rs).toBeNull();
    }
  });
});

// ── ③ rsPriorityComparator ────────────────────────────────────────────────────────

describe('③ rsPriorityComparator', () => {
  it('(c) positive-RS 우선 → 결손 중립 → laggard 후순위', () => {
    // benchmark 0. leader L(rs +5)·null N(return 결손)·laggard G(rs -5). stage1Score 동일 50.
    const L = candidate('L', 50, 5);
    const N = candidate('N', 50, undefined);
    const G = candidate('G', 50, -5);
    const ranks = computeRsPercentiles([L, N, G], 0);
    const sorted = [G, N, L].sort(rsPriorityComparator(ranks));
    expect(sorted.map((c) => c.code)).toEqual(['L', 'N', 'G']);
  });

  it('(c) 동급 내 stage1Score desc tiebreak (두 번째 정렬식 신설 없음)', () => {
    // 둘 다 leader(rs>=0). stage1Score 80 > 60.
    const A = candidate('A', 60, 10);
    const B = candidate('B', 80, 8);
    const ranks = computeRsPercentiles([A, B], 0);
    const sorted = [A, B].sort(rsPriorityComparator(ranks));
    expect(sorted.map((c) => c.code)).toEqual(['B', 'A']); // 동급 leader → stage1Score desc
  });

  it('(c) laggard 가 stage1Score 높아도 leader 뒤로 디모트', () => {
    const leaderLowScore = candidate('L', 30, 10); // leader, score 30
    const laggardHighScore = candidate('G', 90, -10); // laggard, score 90
    const ranks = computeRsPercentiles([leaderLowScore, laggardHighScore], 0);
    const sorted = [laggardHighScore, leaderLowScore].sort(rsPriorityComparator(ranks));
    expect(sorted.map((c) => c.code)).toEqual(['L', 'G']); // leader 우선 — laggard 디모트
  });
});

// ── (a) OFF byte-identical — applyLeaderPreservation 정렬 동치 ──────────────────────

describe('(a) OFF byte-identical 정렬 — applyLeaderPreservation 비교자 미주입', () => {
  it('비교자 미주입(현행) === stage1Score desc 단독', () => {
    const cands = [candidate('A', 30, 10), candidate('B', 90, -10), candidate('C', 60, 5)];
    // 비교자 미주입 → 현행 stage1Score desc (RS 무관).
    const { result } = applyLeaderPreservation(cands, 60, NOW, false, undefined);
    expect(result.map((c) => c.code)).toEqual(['B', 'C', 'A']); // 90 > 60 > 30
  });

  it('(d) ③ 비교자 주입 시에도 주도주 union 보존은 직교 유지', () => {
    // limit=1. leader 보존(0617) ON + RS percentile 정렬(0622) 동시.
    // 후보: 주도주 M(MARKET_CAP, score 10, rs -20 laggard) + 일반 H(score 90, rs +5 leader).
    const M = candidate('M', 10, -20, 'MARKET_CAP');
    const H = candidate('H', 90, 5);
    const ranks = computeRsPercentiles([M, H], 0);
    const { result } = applyLeaderPreservation([M, H], 1, NOW, true, rsPriorityComparator(ranks));
    // RS 정렬 → H(leader) top-1. M(laggard 주도주)은 컷 밖이나 union 보존 → 둘 다 결과에 존재.
    expect(result.map((c) => c.code).sort()).toEqual(['H', 'M']);
    expect(result[0].code).toBe('H'); // top-N 첫 자리는 RS 우선(leader)
  });
});

// ── dry-run 관측 (flag 무관 산출) ──────────────────────────────────────────────────

describe('(e) computeUniverseDiscoveryAggressivenessObservation — flag 무관 산출', () => {
  it('flag 둘 다 OFF 여도 dry-run delta 산출(observationOnly=true·executionImpact NONE)', () => {
    // 65개 후보 (60 컷 초과). 상위 60 stage1Score 우선. 61~65 위는 확대 컷(90)에서 편입.
    const cands = Array.from({ length: 65 }, (_, i) =>
      candidate(`C${i}`, 100 - i, 5 - i * 0.5), // score 내림차순, return 내림차순
    );
    const ranks = computeRsPercentiles(cands, 0);
    const obs = computeUniverseDiscoveryAggressivenessObservation(
      cands, ranks, 0, NOW, false, false,
    );
    expect(obs.observationOnly).toBe(true);
    expect(obs.executionImpact).toBe('NONE');
    expect(obs.appliedTopN).toBe(60);
    expect(obs.totalCandidates).toBe(65);
    // 확대 컷(90)은 65개 전부 포함 → 60 컷 밖 5개가 추가 편입.
    expect(obs.wouldExpandTopNAddedCount).toBe(5);
    expect(obs.scanDateKey).toBe(todayKst(NOW));
  });

  it('어느 한쪽 flag ON → observationOnly false·EXECUTION_ADJACENT', () => {
    const cands = [candidate('A', 50, 10)];
    const ranks = computeRsPercentiles(cands, 0);
    const obs = computeUniverseDiscoveryAggressivenessObservation(cands, ranks, 0, NOW, true, false);
    expect(obs.observationOnly).toBe(false);
    expect(obs.executionImpact).toBe('EXECUTION_ADJACENT');
    expect(obs.appliedTopN).toBe(90);
  });

  it('③ dry-run — RS 정렬 시 promote/demote 수 산출', () => {
    // 62개 후보. 컷 60. stage1Score 순서와 RS 순서가 어긋나게 구성.
    // 상위 60(score 높음)은 전부 laggard(rs<0), 하위 2(score 낮음)는 leader(rs>0).
    const cands: CandidateStock[] = [];
    for (let i = 0; i < 60; i++) cands.push(candidate(`H${i}`, 100 - i, -1)); // high score, laggard
    cands.push(candidate('L0', 5, 10)); // low score, leader
    cands.push(candidate('L1', 4, 8));  // low score, leader
    const ranks = computeRsPercentiles(cands, 0);
    const obs = computeUniverseDiscoveryAggressivenessObservation(cands, ranks, 0, NOW, false, false);
    // RS 정렬 → L0·L1(leader) 컷 안으로 끌어올림 → 2 promote, 가장 낮은 score laggard 2개 밀림.
    expect(obs.wouldRsPromoteCount).toBe(2);
    expect(obs.wouldLaggardDemoteCount).toBe(2);
  });

  it('(d) benchmark 결손 → ③ dry-run skip(promote/demote 0·불변식 #6)', () => {
    const cands = Array.from({ length: 62 }, (_, i) => candidate(`C${i}`, 100 - i, 5));
    const ranks = computeRsPercentiles(cands, undefined);
    const obs = computeUniverseDiscoveryAggressivenessObservation(cands, ranks, undefined, NOW);
    expect(obs.benchmarkReturn20d).toBeNull();
    expect(obs.wouldRsPromoteCount).toBe(0);
    expect(obs.wouldLaggardDemoteCount).toBe(0);
    expect(obs.currentLaggardShare).toBeNull(); // RS 산출 불가 → null
  });

  it('currentLaggardShare — 현행 컷 후보 중 laggard 비율(운영자 실측 추세)', () => {
    // 4개 후보(컷 60 미만이라 전부 컷). 2 leader / 2 laggard.
    const cands = [
      candidate('A', 50, 5), candidate('B', 40, 3),
      candidate('C', 30, -5), candidate('D', 20, -8),
    ];
    const ranks = computeRsPercentiles(cands, 0);
    const obs = computeUniverseDiscoveryAggressivenessObservation(cands, ranks, 0, NOW);
    expect(obs.currentLaggardShare).toBe(0.5);
  });
});

// ── ledger 영속 I/O (ADR-0614/0616/0617 패턴) ──────────────────────────────────────

describe('(f) ledger atomic/FIFO/upsert/손상 fallback', () => {
  let file: string;
  afterEach(() => {
    if (file) __resetUniverseDiscoveryAggressivenessLedgerForTests(file);
  });

  function obsFor(scanDateKey: string): UniverseDiscoveryAggressivenessObservation {
    return {
      scanDateKey,
      topNExpansionEnabled: true,
      rsPercentileRankEnabled: false,
      totalCandidates: 10,
      appliedTopN: 90,
      wouldExpandTopNAddedCount: 3,
      wouldRsPromoteCount: 1,
      wouldLaggardDemoteCount: 1,
      currentLaggardShare: 0.4,
      benchmarkReturn20d: 5,
      executionImpact: 'EXECUTION_ADJACENT',
      observationOnly: false,
    };
  }

  it('append → load round-trip', () => {
    file = tmpFile();
    appendUniverseDiscoveryAggressivenessObservation(obsFor('2026-06-16'), NOW, file);
    const rows = loadUniverseDiscoveryAggressivenessLedger(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].scanDateKey).toBe('2026-06-16');
    expect(rows[0].appendedAt).toBe(NOW.toISOString());
  });

  it('scanDateKey upsert (last-write-wins)', () => {
    file = tmpFile();
    appendUniverseDiscoveryAggressivenessObservation(obsFor('2026-06-16'), NOW, file);
    const second = { ...obsFor('2026-06-16'), totalCandidates: 99 };
    appendUniverseDiscoveryAggressivenessObservation(second, NOW, file);
    const rows = loadUniverseDiscoveryAggressivenessLedger(file);
    expect(rows).toHaveLength(1); // 동일 날짜 upsert
    expect(rows[0].totalCandidates).toBe(99);
  });

  it('rolling FIFO — WINDOW_SCANS 초과분 제거', () => {
    file = tmpFile();
    const total = UNIVERSE_DISCOVERY_AGGRESSIVENESS_WINDOW_SCANS + 5;
    for (let i = 0; i < total; i++) {
      const day = String(i + 1).padStart(2, '0');
      appendUniverseDiscoveryAggressivenessObservation(obsFor(`2026-01-${day}`), NOW, file);
    }
    const rows = loadUniverseDiscoveryAggressivenessLedger(file);
    expect(rows).toHaveLength(UNIVERSE_DISCOVERY_AGGRESSIVENESS_WINDOW_SCANS);
    // 가장 오래된 5개 제거 → 첫 row 는 2026-01-06.
    expect(rows[0].scanDateKey).toBe('2026-01-06');
  });

  it('손상 JSON → 빈 배열 fallback (시스템 무중단)', () => {
    file = tmpFile();
    fs.writeFileSync(file, '{ corrupt json');
    expect(loadUniverseDiscoveryAggressivenessLedger(file)).toEqual([]);
    // append 도 손상 위에서 정상 동작(fallback []).
    appendUniverseDiscoveryAggressivenessObservation(obsFor('2026-06-16'), NOW, file);
    const rows = loadUniverseDiscoveryAggressivenessLedger(file);
    expect(rows).toHaveLength(1);
  });

  it('비배열 JSON → 빈 배열 fallback', () => {
    file = tmpFile();
    fs.writeFileSync(file, '{"not":"array"}');
    expect(loadUniverseDiscoveryAggressivenessLedger(file)).toEqual([]);
  });

  it('todayKst — ADR-0614/0616/0617 동일 정의(KST +9h)', () => {
    expect(todayKst(new Date('2026-06-16T15:30:00Z'))).toBe('2026-06-17'); // KST 익일 00:30
    expect(todayKst(new Date('2026-06-16T14:30:00Z'))).toBe('2026-06-16'); // KST 23:30
  });
});

// ── RS percentile flag SSOT ──────────────────────────────────────────────────────

describe('③ flag SSOT', () => {
  it('정확 비교 (=== "true" 만 ON)', () => {
    expect(isUniverseRsPercentileRankEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isUniverseRsPercentileRankEnabled({ UNIVERSE_RS_PERCENTILE_RANK_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isUniverseRsPercentileRankEnabled({ UNIVERSE_RS_PERCENTILE_RANK_ENABLED: 'TRUE' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
