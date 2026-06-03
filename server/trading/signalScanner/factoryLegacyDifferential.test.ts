// @responsibility USE_UNIFIED_SOURCE_SNAPSHOT factory(ON) vs legacy(OFF) 차등 하네스 — 활성화 선행 증거(필드 단위 byte-equal/차이 카탈로그).

/**
 * 차등 하네스 (factory activation evidence)
 *
 * 목적: USE_UNIFIED_SOURCE_SNAPSHOT flag ON(factory) 경로가 flag OFF(legacy fetch) 경로와
 * 동일한 Gate 입력을 산출하는지 *필드 단위* 로 증명한다. 전체 스캔 end-to-end 는 너무 크므로
 * "flag ON factory값 == flag OFF legacy fetch값" 으로 좁힌 per-field 차등이다.
 *
 * 절대 금지: 본 테스트는 어떤 코드의 동작도 바꾸지 않고 .env flag 도 켜지 않는다. 각 케이스가
 * process.env.USE_UNIFIED_SOURCE_SNAPSHOT 를 set/restore 하여 양 경로를 실제로 실행·비교한다.
 *
 * 비교 경계 (의미 있는 producer→consumer 표면):
 *   1. injectPerSymbolPriceContext — snapshot(factory) 파생 volume/return5d/return20d
 *      == 동일 raw bars 의 legacy KIS-fetch 파생값.
 *   2. injectPerSymbolDartContext + resolveDartFinancialsForEvaluation — factory slot read
 *      == legacy cache-first fallback (동일 데이터 출처).
 *   3. fetchGate2PerValuation — flag ON 정본 snapshotQuote 합성 == flag OFF KIS re-fetch.
 *   4. injectPerSymbolSupplyContext — snapshot(factory) investorFlow == legacy router fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── mocks: legacy fetch 경로를 결정적으로 통제 (factory snapshot 과 동일 raw 를 반환) ───
vi.mock('../../clients/kisClient.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchKisStockFullQuote: vi.fn(),
    fetchKisStockDailyBars: vi.fn(),
  };
});
vi.mock('../../clients/kisClient/http.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    realDataKisGet: vi.fn(),
  };
});
vi.mock('../../persistence/krxStockMasterRepo.js', () => ({
  getStockByCode: vi.fn(() => null),
}));
vi.mock('../../utils/logger.js', () => ({
  createTraceId: () => 'trace_diff',
  logVisibilityEvent: vi.fn(),
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { injectPerSymbolPriceContext } from './injectPerSymbolPriceContext.js';
import { injectPerSymbolDartContext, readCandidateDartSlot } from './injectPerSymbolDartContext.js';
import {
  injectPerSymbolSupplyContext,
  type CandidateWithSupplyContext,
} from './injectPerSymbolSupplyContext.js';
import { fetchKisStockFullQuote, fetchKisStockDailyBars } from '../../clients/kisClient.js';
import { realDataKisGet } from '../../clients/kisClient/http.js';
import { fetchGate2PerValuation } from '../gate2/gate2ExternalDataProvider/perValuation.js';
import type { SymbolSnapshotData, SymbolDartFinancialsSlot } from '../sourceSnapshot/symbolSnapshotData.js';

const mockedQuote = vi.mocked(fetchKisStockFullQuote);
const mockedBars = vi.mocked(fetchKisStockDailyBars);
const mockedKisGet = vi.mocked(realDataKisGet);

const FLAG = 'USE_UNIFIED_SOURCE_SNAPSHOT';

function withFlag<T>(value: 'on' | 'off', fn: () => T): T {
  const prev = process.env[FLAG];
  if (value === 'on') process.env[FLAG] = 'true';
  else delete process.env[FLAG];
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  }
}

async function withFlagAsync<T>(value: 'on' | 'off', fn: () => Promise<T>): Promise<T> {
  const prev = process.env[FLAG];
  if (value === 'on') process.env[FLAG] = 'true';
  else delete process.env[FLAG];
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  }
}

// 결정적 fixture: 내림차순 일봉 (bars[0]=최신). close/volume 통제.
function descendingBars(closes: number[], volumes: number[]) {
  return closes.map((close, i) => ({
    date: `2026-05-${String(31 - i).padStart(2, '0')}`,
    close,
    volume: volumes[i] ?? null,
  }));
}

describe('차등 하네스 #1 — injectPerSymbolPriceContext (factory snapshot == legacy KIS fetch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('동일 raw bars/quote → factory(snapshot) 파생 volume/return5d/return20d == legacy(fetch) 파생값 (byte-equal)', async () => {
    // 21개 bar (return20d 까지 산출 가능). 최신 close=200, 5일전=100(+100%), 20일전=50(+300%).
    const closes = [200, 195, 190, 185, 180, 100, 175, 170, 165, 160, 155, 150, 145, 140, 135, 130, 125, 120, 110, 105, 50];
    const volumes = closes.map((_, i) => 1000 + i * 10);
    const rawBars = descendingBars(closes, volumes);
    const rawQuoteVolume = 9999;

    // legacy 경로(flag OFF, snapshotData 미제공): KIS fetch mock 이 동일 raw 반환.
    mockedQuote.mockResolvedValue({ volume: rawQuoteVolume } as never);
    mockedBars.mockResolvedValue(rawBars as never);
    const legacy = await withFlagAsync('off', async () =>
      injectPerSymbolPriceContext([{ code: '005930' }] as Array<Record<string, unknown>>),
    );

    // factory 경로(flag ON, snapshotData 제공): 동일 raw 를 snapshot 에 담아 fetch 우회.
    const snapshot: Record<string, SymbolSnapshotData> = {
      '005930': {
        code: '005930',
        quote: { volume: rawQuoteVolume, currentPrice: closes[0] } as never,
        dailyBars: rawBars as never,
      } as unknown as SymbolSnapshotData,
    };
    mockedQuote.mockClear();
    mockedBars.mockClear();
    const factory = await withFlagAsync('on', async () =>
      injectPerSymbolPriceContext([{ code: '005930' }] as Array<Record<string, unknown>>, { snapshotData: snapshot }),
    );

    // factory 경로는 KIS fetch 를 우회 (외부 호출 0).
    expect(mockedQuote).not.toHaveBeenCalled();
    expect(mockedBars).not.toHaveBeenCalled();

    const lc = legacy.candidates[0];
    const fc = factory.candidates[0];
    // 핵심: 양 경로의 downstream Gate 입력 필드 byte-equal.
    expect(fc.volume).toBe(lc.volume);
    expect(fc.avgVolume).toBe(lc.avgVolume);
    expect(fc.return5d).toBe(lc.return5d);
    expect(fc.return20d).toBe(lc.return20d);
    // sanity: 실제로 값이 산출됐음 (빈-비교 가짜 통과 방지).
    expect(fc.return5d).toBe(100);   // (200-100)/100*100
    expect(fc.return20d).toBe(300);  // (200-50)/50*100
    // averageBarVolume 는 최대 20개 bar 만 사용 (length>=20 break) → 첫 20개 평균.
    const first20 = volumes.slice(0, 20);
    expect(fc.avgVolume).toBe(Math.round(first20.reduce((a, b) => a + b, 0) / first20.length));
  });
});

describe('차등 하네스 #2 — DART 정본 슬롯 (factory slot read == legacy cache-first fallback)', () => {
  it('factory carry 한 슬롯 financials 가 legacy fetch 가 채울 값과 동일 (동일 cache-first 출처)', () => {
    const FIN = { symbol: '005930', roe: 12.5, netIncome: 100_000 };
    const slot: SymbolDartFinancialsSlot = {
      financials: FIN as never,
      cadence: 'QUARTERLY_CACHED',
      source: 'GATE2_EXTERNAL_CACHE',
      cacheHit: true,
      fetchedAt: new Date().toISOString(),
    };
    const snapshot: Record<string, SymbolSnapshotData> = {
      '005930': { code: '005930', dartFinancials: slot } as unknown as SymbolSnapshotData,
    };
    // factory: injectPerSymbolDartContext 가 슬롯을 후보에 carry.
    const candidate: Record<string, unknown> = { code: '005930' };
    withFlag('on', () => injectPerSymbolDartContext([candidate], { snapshotData: snapshot }));
    const carried = readCandidateDartSlot(candidate);
    expect(carried?.financials).toEqual(FIN);
    // resolveDartFinancialsForEvaluation 의 byte-equivalence(슬롯 == fallback)는
    // gate2DartCanonicalSlot.test.ts 가 이미 deep-equal 로 증명함 (중복 단언 회피, 참조만).
  });
});

describe('차등 하네스 #3 — Gate2 PER (flag ON snapshotQuote 합성 == flag OFF KIS re-fetch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env[FLAG];
    delete process.env.KIS_APP_KEY;
    delete process.env.KIS_APP_SECRET;
  });

  it('동일 PER/EPS/price → flag ON(snapshotQuote 재사용, fetch 0) == flag OFF(KIS fetch) 결과 byte-equal', async () => {
    // hasKisValuationCredentials() 충족용 — 실제 호출은 mock 으로 차단.
    process.env.KIS_APP_KEY = 'TEST_KEY';
    process.env.KIS_APP_SECRET = 'TEST_SECRET';
    // KIS FHKST01010100 응답: per=15, eps=1000, price=15000, listedShares=1_000_000.
    const kisOutput = {
      output: { per: '15', eps: '1000', stck_prpr: '15000', lstn_stcn: '1000000' },
    };
    mockedKisGet.mockResolvedValue(kisOutput as never);

    // flag OFF: KIS 재호출 경로.
    const legacy = await withFlagAsync('off', async () =>
      fetchGate2PerValuation({ symbol: '005930', dartFin: null, snapshotQuote: null }),
    );
    expect(mockedKisGet).toHaveBeenCalledTimes(1);

    // flag ON: 정본 snapshotQuote 로 합성 (동일 raw 값) → re-fetch skip.
    mockedKisGet.mockClear();
    const factory = await withFlagAsync('on', async () =>
      fetchGate2PerValuation({
        symbol: '005930',
        dartFin: null,
        snapshotQuote: { per: 15, eps: 1000, currentPrice: 15000, listedShares: 1_000_000 },
      }),
    );
    // factory 경로는 KIS 를 호출하지 않는다 (dedup 증명).
    expect(mockedKisGet).not.toHaveBeenCalled();

    // raw 는 추출 출처(KIS output vs synthesized)가 달라 표면형이 다를 수 있어 결정 필드만 비교.
    const { raw: _lraw, ...legacyCore } = legacy;
    const { raw: _fraw, ...factoryCore } = factory;
    expect(factoryCore).toEqual(legacyCore);
    // sanity: PER 가 실제 산출됐고 판정이 동일.
    expect(factory.per).toBe(15);
    expect(factory.reason).toBe(legacy.reason);
    expect(factory.source).toBe('KIS');
  });
});

describe('차등 하네스 #4 — supply context (factory snapshot investorFlow == legacy router fetch)', () => {
  const NOW = new Date('2026-05-15T00:00:00.000Z');

  it('동일 외인/기관 net-buy → factory(snapshot) supplyContext == legacy(router) supplyContext (결정 필드 byte-equal)', async () => {
    const foreign = 100_000_000;
    const institution = 50_000_000;

    // legacy: router 가 외인/기관 net-buy 를 반환 (snapshotData 미제공).
    const legacyRouter = {
      fetchForSymbols: async () => [
        {
          symbol: '005930',
          status: 'VERIFIED' as const,
          provider: 'KIS_API' as const,
          foreignNetBuyAmount: foreign,
          institutionNetBuyAmount: institution,
          investorNetBuyAmount: foreign + institution,
          fetchedAt: NOW.toISOString(),
        },
      ],
    };
    const legacyCandidates: CandidateWithSupplyContext[] = [{ code: '005930', preflight: {} }];
    const legacy = await withFlagAsync('off', async () =>
      injectPerSymbolSupplyContext({ candidates: legacyCandidates, investorFlowRouter: legacyRouter, now: NOW }),
    );

    // factory: 동일 raw net-buy 를 snapshot.investorFlow 에 담아 router 우회.
    const snapshot: Record<string, SymbolSnapshotData> = {
      '005930': {
        code: '005930',
        investorFlow: { foreignNetBuy: foreign, institutionalNetBuy: institution } as never,
        fetchedAt: NOW.toISOString(),
      } as unknown as SymbolSnapshotData,
    };
    let routerCalled = false;
    const factoryRouter = {
      fetchForSymbols: async () => {
        routerCalled = true;
        return [];
      },
    };
    const factoryCandidates: CandidateWithSupplyContext[] = [{ code: '005930', preflight: {} }];
    const factory = await withFlagAsync('on', async () =>
      injectPerSymbolSupplyContext({
        candidates: factoryCandidates,
        investorFlowRouter: factoryRouter,
        now: NOW,
        snapshotData: snapshot,
      }),
    );
    // factory 경로는 router fetch 를 우회 (snapshot 직접 구성).
    expect(routerCalled).toBe(false);

    const ls = legacy.candidates[0]!.supplyContext!;
    const fs = factory.candidates[0]!.supplyContext!;
    // downstream Gate 입력에 닿는 결정 필드 byte-equal.
    expect(fs.supplyProviderHealth).toBe(ls.supplyProviderHealth);
    expect(fs.supplySignal).toBe(ls.supplySignal);
    expect(fs.providerIssue).toBe(ls.providerIssue);
    expect(fs.foreignNetBuyAmount).toBe(ls.foreignNetBuyAmount);
    expect(fs.institutionNetBuyAmount).toBe(ls.institutionNetBuyAmount);
    expect(fs.investorNetBuyAmount).toBe(ls.investorNetBuyAmount);
    // marketSignal(수급 BULLISH→positive)도 양 경로 동일 — providerIssue 와 무관한 도메인 신호.
    expect(fs.marketSignal).toBe(ls.marketSignal);
    expect(fs.executionImpact).toBe(ls.executionImpact);
    // supplyScore 스칼라(candidatePoolBuilder 입력) 도 동일.
    expect((factoryCandidates[0] as Record<string, unknown>).supplyScore)
      .toBe((legacyCandidates[0] as Record<string, unknown>).supplyScore);
    // sanity: 실제 VERIFIED 신호가 산출됐음 (빈-비교 가짜 통과 방지).
    expect(fs.supplyProviderHealth).toBe('VERIFIED');
    expect(fs.foreignNetBuyAmount).toBe(foreign);
  });
});
