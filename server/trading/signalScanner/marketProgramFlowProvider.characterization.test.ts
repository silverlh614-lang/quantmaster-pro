/**
 * @responsibility Golden-master characterization harness pinning current marketProgramFlowProvider
 * output so Bundle-4 (V3 → factory supply.marketProgram absorption) can be proven byte-equivalent.
 *
 * ── BUNDLE-4 BYTE-EQUIVALENCE 합격 기준 (다음 단계 실행자가 반드시 충족) ─────────────────────
 * 1. 본 파일의 4개 시나리오 (a)KIS정상 (b)KRX폴백 (c)양쪽실패→cache (d)부분/stale 의 golden
 *    master 단언이 factory 흡수 후에도 0건 변경 없이 PASS 해야 한다 (값/필드 추가·삭제 금지).
 * 2. 비교 대상 정본 필드: supply.marketProgram 값(netBuyAmount/arbitrage/nonArbitrage) +
 *    providerIssue + marketSignal(반드시 격리) + freshness 매핑(source/cacheStatus/
 *    marketProgramDataStatus/fetchedAt) + available + breakPoint. 아래 GOLDEN_FIELDS 참조.
 * 3. 불변식6: providerIssue=true 인 어떤 시나리오에서도 marketSignal 은 BULLISH/BEARISH/NEUTRAL 로
 *    승격되면 안 된다 (UNAVAILABLE 격리). 불변식1: 어떤 입력에도 throw 0.
 * 4. Downstream Gate 입력 동일성: 본 출력이 흘러드는 normalSupplyPreviewRunner.ts:127 →
 *    persistNormalSupplyPreview → (programFlow carry) → Gate2 externalCoverage.ts:681
 *    (input.programTrade.marketProgram) 의 입력 값이 동일해야 byte-equivalent. (아래 DOWNSTREAM 참조)
 * 5. KIS/KRX quota 순증 0 — fetch 호출 횟수/순서(KIS→KRX→cache→NONE) 가 보존돼야 한다.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * DOWNSTREAM GATE 입력 비교 지점 (factory 흡수 시 동일성 검증 필수):
 *  - 직접 소비처(V3b): server/trading/signalScanner/normalSupplyPreviewRunner.ts:127
 *      `const liveMarketProgramFlow = await resolveMarketProgramFlow().catch(() => undefined);`
 *  - Gate2 입력점:    server/quant/gate2Diagnostics/externalCoverage.ts:681
 *      `const marketProgramFlow = input.programTrade?.marketProgram ?? null;`
 *      → 여기서 programNetBuyAmount/arbitrageNetBuyAmount/nonArbitrageNetBuyAmount 및
 *        providerIssue(externalCoverage.ts:878 providerIssueForOptionalProgramFlow)로 소비된다.
 *  - 본 provider 의 netBuyAmount → carry 경로(programFlowCarry.ts) → programTrade.marketProgram
 *    .programNetBuyAmount 매핑이 Gate2 입력 동일성의 핵심. 묶음4 후 이 매핑 값을 본 골든마스터와
 *    대조하라.
 *
 * 제약: 본체 로직 0줄 변경 (테스트/문서 전용). 신규 타입/enum 0. mock 은 기존
 *       marketProgramFlowProvider.test.ts 관습(vi.mock + PERSIST_DATA_DIR 격리)을 따른다.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketProgramFlowResult } from './marketProgramFlowProvider.js';

vi.mock('../../utils/logger.js', () => ({
  logVisibilityEvent: vi.fn(),
}));

// 결정적 입력 — 정규장 세션(KST 11:00) 으로 고정해 zero-placeholder/세션 분기를 회피.
const NOW = new Date('2026-05-18T02:00:00.000Z');
let tmpDir: string;
let originalPersistDir: string | undefined;

beforeEach(() => {
  vi.resetModules();
  originalPersistDir = process.env.PERSIST_DATA_DIR;
  tmpDir = mkdtempSync(join(tmpdir(), 'market-program-flow-characterization-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
});

afterEach(() => {
  if (originalPersistDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = originalPersistDir;
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * GOLDEN_FIELDS — 묶음4 흡수 후 비교해야 할 정확한 필드 목록.
 * factory 가 supply.marketProgram 으로 산출하는 값이 아래 projection 과 byte 동일해야 한다.
 */
function goldenProjection(result: MarketProgramFlowResult) {
  return {
    // supply.marketProgram 값
    available: result.available,
    netBuyAmount: result.netBuyAmount,
    arbitrageNetBuyAmount: result.arbitrageNetBuyAmount,
    nonArbitrageNetBuyAmount: result.nonArbitrageNetBuyAmount,
    // 불변식6 격리 대상
    providerIssue: result.providerIssue,
    marketSignal: result.marketSignal,
    // freshness 매핑
    source: result.source,
    fetchedAt: result.fetchedAt,
    cacheStatus: result.cacheStatus,
    marketProgramDataStatus: result.marketProgramDataStatus,
    breakPoint: result.breakPoint,
    // 진단 메타 (executionImpact 격리 보존)
    executionImpact: result.executionImpact,
    programFlowUsedForLiveDecision: result.programFlowUsedForLiveDecision,
  };
}

/** 불변식 가드 — 모든 시나리오에 공통 적용 (불변식6 + 불변식1 throw0 + executionImpact 격리). */
function assertInvariants(result: MarketProgramFlowResult): void {
  // 불변식6: providerIssue=true → marketSignal 은 격리(UNAVAILABLE)되어야 한다.
  if (result.providerIssue) {
    expect(result.marketSignal).toBe('UNAVAILABLE');
  }
  // provider 데이터를 매매 결정으로 변환하지 않음 (격리 불변).
  expect(result.executionImpact).toBe('NONE');
  expect(result.programFlowUsedForLiveDecision).toBe(false);
  expect(result.passiveProxyUsedForLiveDecision).toBe(false);
  expect(result.programPenaltyApplied).toBe(false);
}

describe('marketProgramFlowProvider golden master (Bundle-4 byte-equivalence safety net)', () => {
  // ── 시나리오 (a): KIS 정상 → 정상 marketProgram flow ────────────────────────────────────
  it('(a) KIS success → normal marketProgram flow (golden master)', async () => {
    const { resolveMarketProgramFlow } = await import('./marketProgramFlowProvider.js');
    const krxSpy = vi.fn(async () => {
      throw new Error('KRX should not be called when KIS succeeds');
    });
    const result = await resolveMarketProgramFlow({
      now: NOW,
      fetchKis: async () => ({
        programNetBuyAmount: 4200,
        programArbitrageNetBuy: 1200,
        programNonArbitrageNetBuy: 3000,
        fetchedAt: NOW.toISOString(),
        source: 'KIS_API',
        rawFieldKeys: ['programNetBuyAmount'],
      } as never),
      fetchKrx: krxSpy,
    });

    // golden master — 묶음4 흡수 후 이 값이 변하면 byte-equivalence 실패.
    expect(goldenProjection(result)).toEqual({
      available: true,
      netBuyAmount: 4200,
      arbitrageNetBuyAmount: 1200,
      nonArbitrageNetBuyAmount: 3000,
      providerIssue: false,
      marketSignal: 'BULLISH',
      source: 'KIS_API',
      fetchedAt: NOW.toISOString(),
      cacheStatus: 'MISS',
      marketProgramDataStatus: 'PARSED',
      breakPoint: 'OK_MARKET_PROGRAM_WIRED',
      executionImpact: 'NONE',
      programFlowUsedForLiveDecision: false,
    });
    expect(result.kisStatus).toBe('PARSED');
    expect(result.krxFallbackAttempted).toBe(false);
    expect(krxSpy).not.toHaveBeenCalled(); // 호출 순서/quota 보존: KIS 성공 시 KRX 미호출.
    assertInvariants(result);
  }, 15000);

  // ── 시나리오 (b): KIS 실패(throw) → KRX fallback 성공 ───────────────────────────────────
  it('(b) KIS failure → KRX fallback success (golden master)', async () => {
    const { resolveMarketProgramFlow } = await import('./marketProgramFlowProvider.js');
    const result = await resolveMarketProgramFlow({
      now: NOW,
      fetchKis: async () => {
        throw new Error('KIS provider down');
      },
      fetchKrx: async () => ({
        kospi: null,
        kosdaq: null,
        totalProgramNet: -2500,
        arbitrageNet: -700,
        nonArbitrageNet: -1800,
        timestamp: NOW.toISOString(),
        confidence: 'PARTIAL',
        fetchedAt: NOW.toISOString(),
        endpoint: 'test',
        bld: 'test',
        marketsAttempted: ['KOSPI'],
        marketsSucceeded: ['KOSPI'],
      }),
    });

    expect(goldenProjection(result)).toEqual({
      available: true,
      netBuyAmount: -2500,
      arbitrageNetBuyAmount: -700,
      nonArbitrageNetBuyAmount: -1800,
      // KIS throw 시 providerIssue 는 KRX 성공으로 흡수 → false (격리, marketSignal 정상).
      providerIssue: false,
      marketSignal: 'BEARISH',
      source: 'KRX_FALLBACK',
      fetchedAt: NOW.toISOString(),
      cacheStatus: 'MISS',
      marketProgramDataStatus: 'PARSED',
      breakPoint: 'OK_MARKET_PROGRAM_WIRED',
      executionImpact: 'NONE',
      programFlowUsedForLiveDecision: false,
    });
    expect(result.kisStatus).toBe('ERROR');
    expect(result.kisAttempted).toBe(true);
    expect(result.krxFallbackAttempted).toBe(true);
    expect(result.krxFallbackStatus).toBe('SUCCESS');
    assertInvariants(result);
  }, 15000);

  // ── 시나리오 (c): KIS·KRX 둘 다 실패(throw) → cache MISS → providerIssue=true, signal 격리 ──
  it('(c) KIS + KRX both fail → no cache → providerIssue=true, marketSignal isolated (불변식6)', async () => {
    const { resolveMarketProgramFlow } = await import('./marketProgramFlowProvider.js');
    const result = await resolveMarketProgramFlow({
      now: NOW,
      fetchKis: async () => {
        throw new Error('KIS provider down');
      },
      fetchKrx: async () => {
        throw new Error('KRX provider down');
      },
    });

    expect(goldenProjection(result)).toEqual({
      available: false,
      netBuyAmount: null,
      arbitrageNetBuyAmount: null,
      nonArbitrageNetBuyAmount: null,
      // 불변식6: 양쪽 provider 장애 → providerIssue=true 이지만 marketSignal 은 UNAVAILABLE 격리.
      providerIssue: true,
      marketSignal: 'UNAVAILABLE',
      source: 'NONE',
      fetchedAt: null,
      cacheStatus: 'MISS',
      marketProgramDataStatus: 'PROVIDER_ERROR',
      breakPoint: 'KIS_ERROR_KRX_ERROR_CACHE_MISS',
      executionImpact: 'NONE',
      programFlowUsedForLiveDecision: false,
    });
    expect(result.kisStatus).toBe('ERROR');
    expect(result.krxFallbackStatus).toBe('ERROR');
    expect(result.cacheFallbackAttempted).toBe(true);
    assertInvariants(result);
  }, 15000);

  // ── 시나리오 (c'): 양쪽 실패하지만 cache STALE 존재 → stale 흐름 + providerIssue 격리 ─────
  it("(c') KIS + KRX fail but STALE cache present → CACHE_STALE carries providerIssue (불변식6)", async () => {
    const { resolveMarketProgramFlow } = await import('./marketProgramFlowProvider.js');

    // 1) cache 시드: 정규장 KIS 성공으로 last-market-program-snapshot.json 기록.
    const seedNow = new Date('2026-05-18T02:00:00.000Z');
    await resolveMarketProgramFlow({
      now: seedNow,
      fetchKis: async () => ({
        programNetBuyAmount: 5000,
        programArbitrageNetBuy: 1000,
        programNonArbitrageNetBuy: 4000,
        fetchedAt: seedNow.toISOString(),
        source: 'KIS_API',
        rawFieldKeys: ['programNetBuyAmount'],
      } as never),
      fetchKrx: async () => null,
    });

    // 2) intraday TTL(15분) 초과 시점 + 양쪽 provider 장애 → CACHE_STALE.
    const staleNow = new Date('2026-05-18T02:30:00.000Z');
    const result = await resolveMarketProgramFlow({
      now: staleNow,
      fetchKis: async () => {
        throw new Error('KIS provider down');
      },
      fetchKrx: async () => {
        throw new Error('KRX provider down');
      },
    });

    expect(goldenProjection(result)).toEqual({
      available: false,
      netBuyAmount: 5000,
      arbitrageNetBuyAmount: 1000,
      nonArbitrageNetBuyAmount: 4000,
      // STALE cache 가 값을 carry 하지만 available=false 이며 providerIssue=true → signal 격리.
      providerIssue: true,
      marketSignal: 'UNAVAILABLE',
      source: 'CACHE_STALE',
      fetchedAt: seedNow.toISOString(),
      cacheStatus: 'STALE',
      marketProgramDataStatus: 'MISSING',
      breakPoint: 'KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_STALE',
      executionImpact: 'NONE',
      programFlowUsedForLiveDecision: false,
    });
    expect(result.cacheStatus).toBe('STALE');
    assertInvariants(result);
  }, 15000);

  // ── 시나리오 (d): 부분 데이터 / accepted-empty (provider 장애 아님, signal 미격상) ────────
  it('(d) partial / accepted-empty data → NOT providerIssue, marketSignal UNAVAILABLE (격리)', async () => {
    const { resolveMarketProgramFlow } = await import('./marketProgramFlowProvider.js');
    const result = await resolveMarketProgramFlow({
      now: NOW,
      fetchKis: async () => null, // KIS accepted-empty (장애 아님)
      fetchKrx: async () => null, // KRX empty
    });

    expect(goldenProjection(result)).toEqual({
      available: false,
      netBuyAmount: null,
      arbitrageNetBuyAmount: null,
      nonArbitrageNetBuyAmount: null,
      // 불변식6 정밀: accepted-empty 는 provider 장애가 아니므로 providerIssue=false 유지.
      providerIssue: false,
      marketSignal: 'UNAVAILABLE',
      source: 'NONE',
      fetchedAt: null,
      cacheStatus: 'MISS',
      marketProgramDataStatus: 'ACCEPTED_EMPTY',
      breakPoint: 'KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS',
      executionImpact: 'NONE',
      programFlowUsedForLiveDecision: false,
    });
    expect(result.kisStatus).toBe('ACCEPTED_EMPTY');
    expect(result.krxFallbackStatus).toBe('EMPTY');
    assertInvariants(result);
  }, 15000);

  // ── 불변식 가드 통합: throw 0 (불변식1 — engine always-on) ───────────────────────────────
  it('never throws under any provider failure permutation (불변식1: throw 0)', async () => {
    const { resolveMarketProgramFlow } = await import('./marketProgramFlowProvider.js');
    const permutations: Array<() => Promise<MarketProgramFlowResult>> = [
      () => resolveMarketProgramFlow({ now: NOW, fetchKis: async () => { throw new Error('x'); }, fetchKrx: async () => { throw new Error('y'); } }),
      () => resolveMarketProgramFlow({ now: NOW, fetchKis: async () => null, fetchKrx: async () => { throw new Error('y'); } }),
      () => resolveMarketProgramFlow({ now: NOW, fetchKis: async () => { throw new Error('x'); }, fetchKrx: async () => null }),
      () => resolveMarketProgramFlow({ now: NOW, fetchKis: async () => null, fetchKrx: async () => null }),
    ];
    for (const run of permutations) {
      const result = await run();
      expect(result.executionImpact).toBe('NONE');
      assertInvariants(result);
    }
  }, 15000);
});
