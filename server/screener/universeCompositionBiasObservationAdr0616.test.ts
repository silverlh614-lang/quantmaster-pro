// @responsibility ADR-0616 회귀 — 시장분류·RS leader/laggard 경계0·benchmark null skip·시총 tier 경계·listedShares 결손 skip·전원결손 dist null·rsMedian 짝홀·ledger FIFO60/upsert/손상fallback·flag OFF.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CandidateStock } from './pipelineHelpers.js';
import type { StockMasterEntry } from '../persistence/krxStockMasterRepo.js';
import {
  computeUniverseCompositionBiasObservation,
  classifyMarketCapTier,
  appendUniverseCompositionBiasObservation,
  loadUniverseCompositionBiasLedger,
  __resetUniverseCompositionBiasLedgerForTests,
  isUniverseCompositionBiasObservationEnabled,
  todayKst,
  UNIVERSE_COMPOSITION_BIAS_WINDOW_SCANS,
  UNIVERSE_MARKET_CAP_TIER_LARGE_KRW,
  UNIVERSE_MARKET_CAP_TIER_MID_KRW,
  UNIVERSE_TOP_LAGGARD_SAMPLE_N,
  type UniverseCompositionBiasObservation,
} from './universeCompositionBiasObservationAdr0616.js';

// ── fixtures ────────────────────────────────────────────────────────────────────

function tmpFile(): string {
  return path.join(os.tmpdir(), `ucb-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

/** 최소 후보 — quote 는 산출에 쓰이는 return20d/price 만 의미, 나머지는 캐스트로 충족. */
function candidate(code: string, return20d: number | undefined, price: number): CandidateStock {
  return {
    code,
    name: code,
    symbol: code,
    sector: '반도체',
    stage1Score: 0,
    quote: { return20d, price } as unknown as CandidateStock['quote'],
  };
}

function master(
  market: StockMasterEntry['market'],
  listedShares?: number,
): StockMasterEntry {
  return { code: '000000', name: 'x', market, ...(listedShares !== undefined ? { listedShares } : {}) };
}

/** market/listedShares 를 code 별로 매핑하는 fake getStockByCode. */
function fakeMaster(
  byCode: Record<string, StockMasterEntry | null>,
): (code: string) => StockMasterEntry | null {
  return (code: string) => byCode[code] ?? null;
}

const NOW = new Date('2026-06-16T01:00:00Z'); // KST 2026-06-16 10:00

// ── compute: 시장 구성 ──────────────────────────────────────────────────────────

describe('computeUniverseCompositionBiasObservation — market', () => {
  it('KOSPI/KOSDAQ/KONEX·null 을 kospi/kosdaq/other 로 분류한다', () => {
    const cands = [
      candidate('A', 5, 1000),
      candidate('B', 5, 1000),
      candidate('C', 5, 1000),
      candidate('D', 5, 1000),
    ];
    const get = fakeMaster({
      A: master('KOSPI'),
      B: master('KOSDAQ'),
      C: master('KONEX'),
      D: null, // 마스터 미매칭 → other
    });
    const obs = computeUniverseCompositionBiasObservation(cands, 0, NOW, get);
    expect(obs.totalCandidates).toBe(4);
    expect(obs.kospiCount).toBe(1);
    expect(obs.kosdaqCount).toBe(1);
    expect(obs.otherCount).toBe(2); // KONEX + null
  });

  it('후보 0건도 graceful (totalCandidates 0, dist null)', () => {
    const obs = computeUniverseCompositionBiasObservation([], 0, NOW, fakeMaster({}));
    expect(obs.totalCandidates).toBe(0);
    expect(obs.rsComputedCount).toBe(0);
    expect(obs.rsAvg).toBeNull();
    expect(obs.rsMedian).toBeNull();
    expect(obs.marketCapTierDist).toBeNull();
    expect(obs.executionImpact).toBe('NONE');
    expect(obs.observationOnly).toBe(true);
  });
});

// ── compute: RS leader/laggard ──────────────────────────────────────────────────

describe('computeUniverseCompositionBiasObservation — RS', () => {
  it('RS=0 경계는 leader 에 귀속(>=), RS<0 은 laggard', () => {
    // benchmark=5 → A:return5 → rs=0 leader, B:return4 → rs=-1 laggard, C:return10 → rs=5 leader
    const cands = [candidate('A', 5, 1000), candidate('B', 4, 1000), candidate('C', 10, 1000)];
    const get = fakeMaster({ A: master('KOSPI'), B: master('KOSPI'), C: master('KOSPI') });
    const obs = computeUniverseCompositionBiasObservation(cands, 5, NOW, get);
    expect(obs.rsComputedCount).toBe(3);
    expect(obs.leaderCount).toBe(2); // rs 0, 5
    expect(obs.laggardCount).toBe(1); // rs -1
    expect(obs.benchmarkReturn20d).toBe(5);
  });

  it('benchmark null → RS 전건 skip (결손≠0, 불변식 #6)', () => {
    const cands = [candidate('A', 5, 1000), candidate('B', -3, 1000)];
    const get = fakeMaster({ A: master('KOSPI'), B: master('KOSDAQ') });
    const obs = computeUniverseCompositionBiasObservation(cands, null, NOW, get);
    expect(obs.rsComputedCount).toBe(0);
    expect(obs.leaderCount).toBe(0);
    expect(obs.laggardCount).toBe(0);
    expect(obs.rsAvg).toBeNull();
    expect(obs.rsMedian).toBeNull();
    expect(obs.benchmarkReturn20d).toBeNull();
    expect(obs.topLaggardCodes).toEqual([]);
    // 시장 구성은 여전히 산출
    expect(obs.kospiCount).toBe(1);
    expect(obs.kosdaqCount).toBe(1);
  });

  it('quote.return20d 비유한 후보는 RS skip (rsComputedCount 미증가)', () => {
    const cands = [candidate('A', 5, 1000), candidate('B', undefined, 1000)];
    const get = fakeMaster({ A: master('KOSPI'), B: master('KOSPI') });
    const obs = computeUniverseCompositionBiasObservation(cands, 0, NOW, get);
    expect(obs.rsComputedCount).toBe(1);
    expect(obs.leaderCount).toBe(1);
  });

  it('rsAvg/rsMedian — 홀수 길이는 중앙값', () => {
    // benchmark=0 → rs = return20d. values: 1,3,9 → avg=13/3, median=3
    const cands = [candidate('A', 1, 1000), candidate('B', 3, 1000), candidate('C', 9, 1000)];
    const get = fakeMaster({ A: master('KOSPI'), B: master('KOSPI'), C: master('KOSPI') });
    const obs = computeUniverseCompositionBiasObservation(cands, 0, NOW, get);
    expect(obs.rsAvg).toBeCloseTo(13 / 3, 9);
    expect(obs.rsMedian).toBe(3);
  });

  it('rsMedian — 짝수 길이는 중앙 2값 평균', () => {
    // benchmark=0 → rs values 2,4,6,8 → median=(4+6)/2=5
    const cands = [
      candidate('A', 2, 1000),
      candidate('B', 4, 1000),
      candidate('C', 6, 1000),
      candidate('D', 8, 1000),
    ];
    const get = fakeMaster({
      A: master('KOSPI'), B: master('KOSPI'), C: master('KOSPI'), D: master('KOSPI'),
    });
    const obs = computeUniverseCompositionBiasObservation(cands, 0, NOW, get);
    expect(obs.rsMedian).toBe(5);
    expect(obs.rsAvg).toBe(5);
  });

  it('topLaggardCodes 는 RS 오름차순 하위 N (=5) 만', () => {
    // 7 후보, benchmark=0, rs = -6..0 → 하위 5 = -6,-5,-4,-3,-2
    const cands = Array.from({ length: 7 }, (_, i) => candidate(`C${i}`, -6 + i, 1000));
    const get = fakeMaster(
      Object.fromEntries(cands.map((c) => [c.code, master('KOSPI')])),
    );
    const obs = computeUniverseCompositionBiasObservation(cands, 0, NOW, get);
    expect(obs.topLaggardCodes).toHaveLength(UNIVERSE_TOP_LAGGARD_SAMPLE_N);
    expect(obs.topLaggardCodes[0].rs).toBe(-6);
    expect(obs.topLaggardCodes.map((s) => s.rs)).toEqual([-6, -5, -4, -3, -2]);
  });
});

// ── compute: 시총 tier ──────────────────────────────────────────────────────────

describe('computeUniverseCompositionBiasObservation — market cap tier', () => {
  it('경계값 정확히 3조→LARGE, 1조→MID (>= 귀속)', () => {
    expect(classifyMarketCapTier(UNIVERSE_MARKET_CAP_TIER_LARGE_KRW)).toBe('LARGE');
    expect(classifyMarketCapTier(UNIVERSE_MARKET_CAP_TIER_LARGE_KRW - 1)).toBe('MID');
    expect(classifyMarketCapTier(UNIVERSE_MARKET_CAP_TIER_MID_KRW)).toBe('MID');
    expect(classifyMarketCapTier(UNIVERSE_MARKET_CAP_TIER_MID_KRW - 1)).toBe('SMALL');
  });

  it('listedShares × price 로 tier 분포 산출', () => {
    // A: 3조(LARGE), B: 1조(MID), C: 0.5조(SMALL)
    const cands = [
      candidate('A', 0, 1_000_000), // shares 3,000,000 → 3조
      candidate('B', 0, 1_000_000), // shares 1,000,000 → 1조
      candidate('C', 0, 1_000_000), // shares 500,000 → 0.5조
    ];
    const get = fakeMaster({
      A: master('KOSPI', 3_000_000),
      B: master('KOSPI', 1_000_000),
      C: master('KOSPI', 500_000),
    });
    const obs = computeUniverseCompositionBiasObservation(cands, 0, NOW, get);
    expect(obs.marketCapTierDist).not.toBeNull();
    expect(obs.marketCapTierDist!.largeCount).toBe(1);
    expect(obs.marketCapTierDist!.midCount).toBe(1);
    expect(obs.marketCapTierDist!.smallCount).toBe(1);
    expect(obs.marketCapTierDist!.computedCount).toBe(3);
    expect(obs.marketCapTierDist!.skippedCount).toBe(0);
  });

  it('listedShares 결손·price<=0 종목은 skippedCount 만 증가 (가짜 시총 0, 불변식 #6)', () => {
    const cands = [
      candidate('A', 0, 1_000_000), // shares 3,000,000 → LARGE computed
      candidate('B', 0, 1_000_000), // listedShares 결손 → skip
      candidate('C', 0, 0),         // price 0 → skip
    ];
    const get = fakeMaster({
      A: master('KOSPI', 3_000_000),
      B: master('KOSPI'),          // listedShares undefined
      C: master('KOSPI', 1_000_000),
    });
    const obs = computeUniverseCompositionBiasObservation(cands, 0, NOW, get);
    expect(obs.marketCapTierDist!.computedCount).toBe(1);
    expect(obs.marketCapTierDist!.largeCount).toBe(1);
    expect(obs.marketCapTierDist!.skippedCount).toBe(2);
  });

  it('전원 산출 불가 → marketCapTierDist null (SKIP)', () => {
    const cands = [candidate('A', 0, 1000), candidate('B', 0, 1000)];
    const get = fakeMaster({ A: master('KOSPI'), B: master('KOSDAQ') }); // listedShares 없음
    const obs = computeUniverseCompositionBiasObservation(cands, 0, NOW, get);
    expect(obs.marketCapTierDist).toBeNull();
  });
});

// ── compute: 결정성 (now 주입) ──────────────────────────────────────────────────

describe('computeUniverseCompositionBiasObservation — determinism', () => {
  it('scanDateKey = todayKst(now) 결정적', () => {
    const obs = computeUniverseCompositionBiasObservation([], 0, NOW, fakeMaster({}));
    expect(obs.scanDateKey).toBe(todayKst(NOW));
    expect(obs.scanDateKey).toBe('2026-06-16');
  });
});

// ── ledger ──────────────────────────────────────────────────────────────────────

function obsFixture(over: Partial<UniverseCompositionBiasObservation> = {}): UniverseCompositionBiasObservation {
  return {
    scanDateKey: '2026-06-16',
    totalCandidates: 3,
    kospiCount: 1,
    kosdaqCount: 1,
    otherCount: 1,
    rsComputedCount: 3,
    leaderCount: 2,
    laggardCount: 1,
    rsAvg: 1.5,
    rsMedian: 1,
    benchmarkReturn20d: 5,
    marketCapTierDist: null,
    topLaggardCodes: [],
    executionImpact: 'NONE',
    observationOnly: true,
    ...over,
  };
}

describe('universeCompositionBiasLedger', () => {
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
    const row = appendUniverseCompositionBiasObservation(obsFixture(), NOW, f);
    expect(row.appendedAt).toBe(NOW.toISOString());
    const all = loadUniverseCompositionBiasLedger(f);
    expect(all).toHaveLength(1);
    expect(all[0].scanDateKey).toBe('2026-06-16');
  });

  it('동일 scanDateKey 재스캔 → upsert last-write-wins (행 1개 유지)', () => {
    const f = newFile();
    appendUniverseCompositionBiasObservation(obsFixture({ totalCandidates: 3 }), NOW, f);
    appendUniverseCompositionBiasObservation(obsFixture({ totalCandidates: 9 }), NOW, f);
    const all = loadUniverseCompositionBiasLedger(f);
    expect(all).toHaveLength(1);
    expect(all[0].totalCandidates).toBe(9);
  });

  it('rolling FIFO — WINDOW_SCANS(60) 초과 시 가장 오래된 제거', () => {
    const f = newFile();
    const total = UNIVERSE_COMPOSITION_BIAS_WINDOW_SCANS + 5; // 65
    for (let i = 0; i < total; i += 1) {
      const day = String(i + 1).padStart(2, '0');
      // 2026-04 / 2026-05 / 2026-06 범위로 유니크 날짜키 생성
      const month = i < 31 ? '04' : i < 62 ? '05' : '06';
      const d = i < 31 ? i + 1 : i < 62 ? i - 30 : i - 61;
      const dk = `2026-${month}-${String(d).padStart(2, '0')}`;
      void day;
      appendUniverseCompositionBiasObservation(obsFixture({ scanDateKey: dk }), NOW, f);
    }
    const all = loadUniverseCompositionBiasLedger(f);
    expect(all).toHaveLength(UNIVERSE_COMPOSITION_BIAS_WINDOW_SCANS);
    // 가장 오래된 (2026-04-01..05) 제거됨 — 첫 행이 04-06 이상
    expect(all[0].scanDateKey.localeCompare('2026-04-05')).toBeGreaterThan(0);
  });

  it('손상 JSON → 빈 배열 fallback (시스템 무중단)', () => {
    const f = newFile();
    fs.writeFileSync(f, '{ this is not valid json ]');
    expect(loadUniverseCompositionBiasLedger(f)).toEqual([]);
    // append 도 fallback 위에 정상 동작
    appendUniverseCompositionBiasObservation(obsFixture(), NOW, f);
    expect(loadUniverseCompositionBiasLedger(f)).toHaveLength(1);
  });

  it('배열 아닌 JSON(Record) → 빈 배열 fallback', () => {
    const f = newFile();
    fs.writeFileSync(f, '{"a":1}');
    expect(loadUniverseCompositionBiasLedger(f)).toEqual([]);
  });

  it('__reset 는 파일 삭제 (멱등)', () => {
    const f = newFile();
    appendUniverseCompositionBiasObservation(obsFixture(), NOW, f);
    __resetUniverseCompositionBiasLedgerForTests(f);
    expect(loadUniverseCompositionBiasLedger(f)).toEqual([]);
    // 재호출(미존재)도 throw 안 함
    expect(() => __resetUniverseCompositionBiasLedgerForTests(f)).not.toThrow();
  });
});

// ── ENV flag ──────────────────────────────────────────────────────────────────────

describe('isUniverseCompositionBiasObservationEnabled', () => {
  it("=== 'true' 만 ON, 그 외 default OFF (ADR-0157)", () => {
    expect(isUniverseCompositionBiasObservationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isUniverseCompositionBiasObservationEnabled(
      { UNIVERSE_COMPOSITION_BIAS_OBSERVATION_ENABLED: 'false' } as unknown as NodeJS.ProcessEnv,
    )).toBe(false);
    expect(isUniverseCompositionBiasObservationEnabled(
      { UNIVERSE_COMPOSITION_BIAS_OBSERVATION_ENABLED: '1' } as unknown as NodeJS.ProcessEnv,
    )).toBe(false);
    expect(isUniverseCompositionBiasObservationEnabled(
      { UNIVERSE_COMPOSITION_BIAS_OBSERVATION_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv,
    )).toBe(true);
  });
});
