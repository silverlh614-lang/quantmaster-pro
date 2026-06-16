// @responsibility ADR-0617 회귀 — flag OFF byte-identical(현행 slice 동일·carry undefined)·ON union 보존·SHORT_HEAVY 보존금지·비주도 무손실·preservedCount 정확·dedup·품질통과분만·ledger FIFO/upsert/손상fallback·flag OFF 미append·try-catch 격리.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CandidateStock } from './pipelineHelpers.js';
import type { DynamicStock } from './dynamicUniverseExpander.js';
import {
  LEADER_SOURCES,
  isLeaderSource,
  isLeaderUniverseInjectionEnabled,
  carrySourceTags,
  applyLeaderPreservation,
  computeLeaderUniverseInjectionObservation,
  appendLeaderUniverseInjectionObservation,
  loadLeaderUniverseInjectionLedger,
  __resetLeaderUniverseInjectionLedgerForTests,
  todayKst,
  LEADER_UNIVERSE_INJECTION_WINDOW_SCANS,
  type LeaderUniverseInjectionObservation,
} from './leaderUniverseInjectionAdr0617.js';

// ── fixtures ────────────────────────────────────────────────────────────────────

function tmpFile(): string {
  return path.join(os.tmpdir(), `lui-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

/** 최소 후보 — stage1Score 와 source 만 의미, quote 는 캐스트로 충족. */
function candidate(
  code: string,
  stage1Score: number,
  source?: DynamicStock['source'],
): CandidateStock {
  return {
    code,
    name: code,
    symbol: code,
    sector: '반도체',
    stage1Score,
    ...(source !== undefined ? { source } : {}),
    quote: { price: 1000 } as unknown as CandidateStock['quote'],
  };
}

const NOW = new Date('2026-06-16T01:00:00Z'); // KST 2026-06-16 10:00

// ── LEADER_SOURCES / isLeaderSource ───────────────────────────────────────────────

describe('LEADER_SOURCES / isLeaderSource', () => {
  it('외인·기관·시총 3종만 주도주, 그 외·undefined 는 false', () => {
    expect(LEADER_SOURCES).toEqual(['FOREIGN_NET_BUY', 'INST_NET_BUY', 'MARKET_CAP']);
    expect(isLeaderSource('FOREIGN_NET_BUY')).toBe(true);
    expect(isLeaderSource('INST_NET_BUY')).toBe(true);
    expect(isLeaderSource('MARKET_CAP')).toBe(true);
    // SHORT_HEAVY 는 반대 신호 — 보존 절대 금지
    expect(isLeaderSource('SHORT_HEAVY')).toBe(false);
    expect(isLeaderSource('52W_HIGH')).toBe(false);
    expect(isLeaderSource('MID_RISER')).toBe(false);
    expect(isLeaderSource('LARGE_VOLUME')).toBe(false);
    expect(isLeaderSource(undefined)).toBe(false);
  });
});

// ── ENV flag ──────────────────────────────────────────────────────────────────────

describe('isLeaderUniverseInjectionEnabled', () => {
  it("=== 'true' 만 ON, 그 외 default OFF (ADR-0157)", () => {
    expect(isLeaderUniverseInjectionEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isLeaderUniverseInjectionEnabled(
      { LEADER_UNIVERSE_INJECTION_ENABLED: 'false' } as unknown as NodeJS.ProcessEnv,
    )).toBe(false);
    expect(isLeaderUniverseInjectionEnabled(
      { LEADER_UNIVERSE_INJECTION_ENABLED: '1' } as unknown as NodeJS.ProcessEnv,
    )).toBe(false);
    expect(isLeaderUniverseInjectionEnabled(
      { LEADER_UNIVERSE_INJECTION_ENABLED: 'TRUE' } as unknown as NodeJS.ProcessEnv,
    )).toBe(false);
    expect(isLeaderUniverseInjectionEnabled(
      { LEADER_UNIVERSE_INJECTION_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv,
    )).toBe(true);
  });
});

// ── carrySourceTags ───────────────────────────────────────────────────────────────

describe('carrySourceTags', () => {
  const base = [
    { symbol: 'A', code: 'A', name: 'A' },
    { symbol: 'B', code: 'B', name: 'B' },
    { symbol: 'C', code: 'C', name: 'C' },
  ];
  const sourceMap = new Map<string, DynamicStock['source']>([
    ['A', 'FOREIGN_NET_BUY'],
    ['C', 'SHORT_HEAVY'],
  ]);

  it('flag OFF → source 전건 undefined (기존 {symbol,code,name} 동치)', () => {
    const out = carrySourceTags(base, sourceMap, false);
    expect(out).toEqual([
      { symbol: 'A', code: 'A', name: 'A' },
      { symbol: 'B', code: 'B', name: 'B' },
      { symbol: 'C', code: 'C', name: 'C' },
    ]);
    // source key 자체가 없음(byte-identical)
    expect(out.every((u) => !('source' in u))).toBe(true);
  });

  it('flag ON → expandedUniverse code 만 태그, 미존재 code 는 undefined', () => {
    const out = carrySourceTags(base, sourceMap, true);
    expect(out[0].source).toBe('FOREIGN_NET_BUY');
    expect(out[1].source).toBeUndefined(); // map 미존재
    expect(out[2].source).toBe('SHORT_HEAVY'); // carry 는 식별 — 보존 판정은 별도
    // 입력 순서 보존
    expect(out.map((u) => u.code)).toEqual(['A', 'B', 'C']);
  });
});

// ── applyLeaderPreservation — flag OFF byte-identical ─────────────────────────────

describe('applyLeaderPreservation — flag OFF byte-identical', () => {
  it('flag OFF → result === 현행 sort().slice(limit) 와 동일(주도주 있어도 보존 0)', () => {
    const cands = [
      candidate('A', 10, 'FOREIGN_NET_BUY'),
      candidate('B', 9),
      candidate('C', 8, 'INST_NET_BUY'),
      candidate('D', 7, 'MARKET_CAP'),
      candidate('E', 6),
    ];
    const expectedSlice = [...cands].sort((a, b) => b.stage1Score - a.stage1Score).slice(0, 3);
    const { result, observation } = applyLeaderPreservation(cands, 3, NOW, false);
    expect(result.map((c) => c.code)).toEqual(expectedSlice.map((c) => c.code));
    // 컷 밖 주도주(D=MARKET_CAP) 가 있어도 보존 0
    expect(result.map((c) => c.code)).toEqual(['A', 'B', 'C']);
    expect(observation.preservedCount).toBe(0);
    expect(observation.executionImpact).toBe('NONE');
    expect(observation.observationOnly).toBe(true);
  });

  it('flag OFF observation 은 "보존 안 했으면 드롭됐을 수" 산출용으로 preservedCount=0 유지', () => {
    const cands = [
      candidate('A', 10),
      candidate('B', 9),
      candidate('C', 5, 'FOREIGN_NET_BUY'), // 컷 밖 주도주
    ];
    const { observation } = applyLeaderPreservation(cands, 2, NOW, false);
    expect(observation.leadersInPoolCount).toBe(1);
    expect(observation.leadersInTopNCount).toBe(0);
    expect(observation.preservedCount).toBe(0); // OFF → 보존 안 함
  });
});

// ── applyLeaderPreservation — flag ON union ───────────────────────────────────────

describe('applyLeaderPreservation — flag ON union', () => {
  it('컷 밖 주도주를 union 보존(topN 우선·preserved 뒤)', () => {
    const cands = [
      candidate('A', 10),
      candidate('B', 9),
      candidate('C', 8),
      candidate('D', 5, 'FOREIGN_NET_BUY'), // 컷 밖 주도주
      candidate('E', 4, 'INST_NET_BUY'),    // 컷 밖 주도주
    ];
    const { result, observation } = applyLeaderPreservation(cands, 3, NOW, true);
    // topN=[A,B,C] + preserved=[D,E]
    expect(result.map((c) => c.code)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(observation.preservedCount).toBe(2);
    expect(observation.executionImpact).toBe('EXECUTION_ADJACENT');
    expect(observation.observationOnly).toBe(false);
  });

  it('topN 비주도 후보를 한 건도 희생하지 않음(무손실)', () => {
    const cands = [
      candidate('A', 10),
      candidate('B', 9),
      candidate('C', 8),
      candidate('L', 2, 'MARKET_CAP'),
    ];
    const { result } = applyLeaderPreservation(cands, 3, NOW, true);
    // 비주도 top3 모두 보존 + 주도주 추가
    expect(result.map((c) => c.code)).toEqual(['A', 'B', 'C', 'L']);
    expect(result).toHaveLength(4);
  });

  it('이미 top-N 안에 든 주도주는 dedup(중복 없음)', () => {
    const cands = [
      candidate('A', 10, 'FOREIGN_NET_BUY'), // top-N 안 주도주
      candidate('B', 9),
      candidate('C', 8),
      candidate('D', 3, 'INST_NET_BUY'),     // 컷 밖 주도주
    ];
    const { result, observation } = applyLeaderPreservation(cands, 3, NOW, true);
    expect(result.map((c) => c.code)).toEqual(['A', 'B', 'C', 'D']);
    // A 는 이미 top-N → preserved 아님
    expect(observation.leadersInTopNCount).toBe(1);
    expect(observation.preservedCount).toBe(1); // D 만
    // dedup — A 가 두 번 등장하지 않음
    expect(result.filter((c) => c.code === 'A')).toHaveLength(1);
  });

  it('SHORT_HEAVY/52W_HIGH/MID_RISER/LARGE_VOLUME 은 보존 금지(컷 밖이어도 union 안 됨)', () => {
    const cands = [
      candidate('A', 10),
      candidate('B', 9),
      candidate('C', 8),
      candidate('S', 5, 'SHORT_HEAVY'),    // 반대 신호 — 보존 금지
      candidate('H', 4, '52W_HIGH'),       // 직교 — 보존 금지
      candidate('M', 3, 'MID_RISER'),      // 귀속 불명 — 보존 금지
      candidate('V', 2, 'LARGE_VOLUME'),   // 귀속 불명 — 보존 금지
    ];
    const { result, observation } = applyLeaderPreservation(cands, 3, NOW, true);
    expect(result.map((c) => c.code)).toEqual(['A', 'B', 'C']); // 보존 0
    expect(observation.preservedCount).toBe(0);
    expect(observation.leadersInPoolCount).toBe(0); // 비주도 source 는 pool 산정에서도 제외
  });

  it('preservedCount = "보존 안 했으면 드롭됐을 주도주 수" 정확', () => {
    // 5 주도주 중 2개는 top-N 안(보존 불요), 3개는 컷 밖(보존)
    const cands = [
      candidate('A', 10, 'FOREIGN_NET_BUY'),
      candidate('B', 9, 'INST_NET_BUY'),
      candidate('C', 8),
      candidate('D', 4, 'MARKET_CAP'),
      candidate('E', 3, 'FOREIGN_NET_BUY'),
      candidate('F', 2, 'INST_NET_BUY'),
    ];
    const { observation } = applyLeaderPreservation(cands, 3, NOW, true);
    expect(observation.leadersInPoolCount).toBe(5);
    expect(observation.leadersInTopNCount).toBe(2); // A,B
    expect(observation.preservedCount).toBe(3);     // D,E,F
    // source 분포 정확
    expect(observation.preservedDist.MARKET_CAP).toBe(1);
    expect(observation.preservedDist.FOREIGN_NET_BUY).toBe(1);
    expect(observation.preservedDist.INST_NET_BUY).toBe(1);
    expect(observation.leadersInPoolDist.FOREIGN_NET_BUY).toBe(2);
    expect(observation.leadersInPoolDist.INST_NET_BUY).toBe(2);
    expect(observation.leadersInPoolDist.MARKET_CAP).toBe(1);
  });

  it('컷 밖 주도주 0 → ON 이어도 보존 0·executionImpact NONE(품질 통과분만 도달)', () => {
    // 주도주가 모두 top-N 안에 있음 → 보존 대상 0
    const cands = [
      candidate('A', 10, 'FOREIGN_NET_BUY'),
      candidate('B', 9, 'MARKET_CAP'),
      candidate('C', 8),
    ];
    const { result, observation } = applyLeaderPreservation(cands, 3, NOW, true);
    expect(result.map((c) => c.code)).toEqual(['A', 'B', 'C']);
    expect(observation.preservedCount).toBe(0);
    expect(observation.executionImpact).toBe('NONE');
    expect(observation.observationOnly).toBe(true);
  });

  it('품질 필터 통과분만 candidates 에 존재(과열 주도주는 입력에 도달하지 않음 가정 정합)', () => {
    // 본 함수는 입력 candidates 만 다룬다 — candidates 에 없는 주도주는 절대 보존되지 않음.
    const cands = [candidate('A', 10), candidate('B', 9)];
    const { result, observation } = applyLeaderPreservation(cands, 5, NOW, true);
    // 모두 limit 안 → 보존 0, 추가 주도주 없음
    expect(result.map((c) => c.code)).toEqual(['A', 'B']);
    expect(observation.totalCandidates).toBe(2);
    expect(observation.leadersInPoolCount).toBe(0);
  });
});

// ── computeLeaderUniverseInjectionObservation — 결정성 ─────────────────────────────

describe('computeLeaderUniverseInjectionObservation', () => {
  it('scanDateKey = todayKst(now) 결정적', () => {
    const obs = computeLeaderUniverseInjectionObservation([], [], [], NOW);
    expect(obs.scanDateKey).toBe(todayKst(NOW));
    expect(obs.scanDateKey).toBe('2026-06-16');
    expect(obs.totalCandidates).toBe(0);
    expect(obs.preservedCount).toBe(0);
    expect(obs.executionImpact).toBe('NONE');
    expect(obs.observationOnly).toBe(true);
  });
});

// ── ledger ──────────────────────────────────────────────────────────────────────

function obsFixture(over: Partial<LeaderUniverseInjectionObservation> = {}): LeaderUniverseInjectionObservation {
  return {
    scanDateKey: '2026-06-16',
    enabled: true,
    topNLimit: 60,
    totalCandidates: 80,
    topNCount: 60,
    leadersInPoolCount: 10,
    leadersInTopNCount: 7,
    preservedCount: 3,
    leadersInPoolDist: { FOREIGN_NET_BUY: 5, INST_NET_BUY: 3, MARKET_CAP: 2 },
    preservedDist: { FOREIGN_NET_BUY: 1, INST_NET_BUY: 1, MARKET_CAP: 1 },
    executionImpact: 'EXECUTION_ADJACENT',
    observationOnly: false,
    ...over,
  };
}

describe('leaderUniverseInjectionLedger', () => {
  const files: string[] = [];
  afterEach(() => {
    for (const f of files) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    files.length = 0;
  });
  function newFile(): string {
    const f = tmpFile();
    files.push(f);
    return f;
  }

  it('append → 단일 배열 row 저장, appendedAt 부여', () => {
    const f = newFile();
    const row = appendLeaderUniverseInjectionObservation(obsFixture(), NOW, f);
    expect(row.appendedAt).toBe(NOW.toISOString());
    const all = loadLeaderUniverseInjectionLedger(f);
    expect(all).toHaveLength(1);
    expect(all[0].scanDateKey).toBe('2026-06-16');
    expect(all[0].preservedCount).toBe(3);
  });

  it('동일 scanDateKey 재스캔 → upsert last-write-wins (행 1개 유지)', () => {
    const f = newFile();
    appendLeaderUniverseInjectionObservation(obsFixture({ preservedCount: 3 }), NOW, f);
    appendLeaderUniverseInjectionObservation(obsFixture({ preservedCount: 9 }), NOW, f);
    const all = loadLeaderUniverseInjectionLedger(f);
    expect(all).toHaveLength(1);
    expect(all[0].preservedCount).toBe(9);
  });

  it('rolling FIFO — WINDOW_SCANS(60) 초과 시 가장 오래된 제거', () => {
    const f = newFile();
    const total = LEADER_UNIVERSE_INJECTION_WINDOW_SCANS + 5; // 65
    for (let i = 0; i < total; i += 1) {
      const month = i < 31 ? '04' : i < 62 ? '05' : '06';
      const d = i < 31 ? i + 1 : i < 62 ? i - 30 : i - 61;
      const dk = `2026-${month}-${String(d).padStart(2, '0')}`;
      appendLeaderUniverseInjectionObservation(obsFixture({ scanDateKey: dk }), NOW, f);
    }
    const all = loadLeaderUniverseInjectionLedger(f);
    expect(all).toHaveLength(LEADER_UNIVERSE_INJECTION_WINDOW_SCANS);
    expect(all[0].scanDateKey.localeCompare('2026-04-05')).toBeGreaterThan(0);
  });

  it('손상 JSON → 빈 배열 fallback (시스템 무중단)', () => {
    const f = newFile();
    fs.writeFileSync(f, '{ this is not valid json ]');
    expect(loadLeaderUniverseInjectionLedger(f)).toEqual([]);
    appendLeaderUniverseInjectionObservation(obsFixture(), NOW, f);
    expect(loadLeaderUniverseInjectionLedger(f)).toHaveLength(1);
  });

  it('배열 아닌 JSON(Record) → 빈 배열 fallback', () => {
    const f = newFile();
    fs.writeFileSync(f, '{"a":1}');
    expect(loadLeaderUniverseInjectionLedger(f)).toEqual([]);
  });

  it('__reset 는 파일 삭제 (멱등)', () => {
    const f = newFile();
    appendLeaderUniverseInjectionObservation(obsFixture(), NOW, f);
    __resetLeaderUniverseInjectionLedgerForTests(f);
    expect(loadLeaderUniverseInjectionLedger(f)).toEqual([]);
    expect(() => __resetLeaderUniverseInjectionLedgerForTests(f)).not.toThrow();
  });
});
