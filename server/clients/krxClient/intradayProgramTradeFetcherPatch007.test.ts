// @responsibility Patch-007 KRX intraday market program-trade fetcher + Patch-006 wiring regression.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// krxPost mock (외부 호출 0)
vi.mock('./http.js', () => ({
  krxPost: vi.fn(),
}));

import { krxPost } from './http.js';
import {
  PATCH_007_INTRADAY_IDENTIFIER,
  KRX_BLD_MARKET_PROGRAM_INTRADAY,
  getKrxIntradayMarketProgramBld,
  probeKrxIntradayProgramTradeShape,
  isKrxIntradayMarketProgramEnabled,
  fetchKrxIntradayProgramTradeSingle,
  fetchKrxIntradayProgramTradeAggregate,
} from './intradayProgramTradeFetcher.js';
import { routeProgramMarketEmptyWithKrxAggregate } from './programMarketRouterPatch006.js';
import type { KrxMarketProgramAggregate } from './programTradeFetcher.js';

const mockKrxPost = vi.mocked(krxPost);

const __dirname = dirname(fileURLToPath(import.meta.url));
const FETCHER_PATH = resolve(__dirname, 'intradayProgramTradeFetcher.ts');
const ROUTER_PATH = resolve(__dirname, 'programMarketRouterPatch006.ts');
const SUPPLY_HEALTH_PATH = resolve(__dirname, '..', '..', 'telegram', 'commands', 'system', 'supplyHealth.cmd.ts');
const FETCHER_SOURCE = readFileSync(FETCHER_PATH, 'utf8');
const ROUTER_SOURCE = readFileSync(ROUTER_PATH, 'utf8');
const SUPPLY_HEALTH_SOURCE = readFileSync(SUPPLY_HEALTH_PATH, 'utf8');

const INTRADAY_NOW_MS = Date.parse('2026-05-12T03:00:00Z'); // KST 화요일 12:00 (intraday)

describe('Patch-007 SSOT 정합', () => {
  it('PATCH_007_INTRADAY_IDENTIFIER 명시', () => {
    expect(PATCH_007_INTRADAY_IDENTIFIER).toBe('Patch-KRX-INTRADAY-MARKET-PROGRAM-WIRING-001');
  });
  it('KRX_BLD_MARKET_PROGRAM_INTRADAY default 또는 ENV override', () => {
    expect(typeof KRX_BLD_MARKET_PROGRAM_INTRADAY).toBe('string');
    expect(KRX_BLD_MARKET_PROGRAM_INTRADAY.length).toBeGreaterThan(0);
  });

  it('runtime ENV override wins for KRX_BLD_MARKET_PROGRAM_INTRADAY', () => {
    const orig = process.env.KRX_BLD_MARKET_PROGRAM_INTRADAY;
    process.env.KRX_BLD_MARKET_PROGRAM_INTRADAY = 'dbms/MDC/STAT/standard/OVERRIDE007';
    expect(getKrxIntradayMarketProgramBld()).toBe('dbms/MDC/STAT/standard/OVERRIDE007');
    if (orig === undefined) delete process.env.KRX_BLD_MARKET_PROGRAM_INTRADAY;
    else process.env.KRX_BLD_MARKET_PROGRAM_INTRADAY = orig;
  });
  it('shape probe scans required candidate paths and records firstRowKeys/numericFieldCandidates', () => {
    const probe = probeKrxIntradayProgramTradeShape({
      msgCd: 'MCA00000',
      tableData: [{ foo: 'abc', amountLike: '1,234', time: '0930' }],
    }, 'bld-test');
    expect(probe.confidence).toBe('SHAPE_CANDIDATE');
    expect(probe.topLevelKeys).toContain('tableData');
    expect(probe.shapeCandidatePath).toBe('tableData');
    expect(probe.rowCount).toBe(1);
    expect(probe.firstRowKeys).toEqual(['foo', 'amountLike', 'time']);
    expect(probe.numericFieldCandidates).toEqual(['amountLike', 'time']);
    expect(probe.bld).toBe('bld-test');
  });
});

describe('Patch-007 isKrxIntradayMarketProgramEnabled ENV gate', () => {
  const orig = process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
  afterEach(() => {
    if (orig === undefined) delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
    else process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = orig;
  });

  it('default OFF (endpoint shape 미검증)', () => {
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
    expect(isKrxIntradayMarketProgramEnabled()).toBe(false);
  });
  it('=true → enabled', () => {
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'true';
    expect(isKrxIntradayMarketProgramEnabled()).toBe(true);
  });
  it('"1"/"TRUE"/"yes" 모두 거부 (ADR-0157 정확 비교)', () => {
    for (const v of ['1', 'TRUE', 'yes', 'True', '']) {
      process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = v;
      expect(isKrxIntradayMarketProgramEnabled()).toBe(false);
    }
  });
  it('=false 명시 → disabled', () => {
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'false';
    expect(isKrxIntradayMarketProgramEnabled()).toBe(false);
  });
});

describe('Patch-007 fetchKrxIntradayProgramTradeSingle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(INTRADAY_NOW_MS));
    mockKrxPost.mockReset();
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'true'; // 테스트는 활성화된 상태로
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
  });

  it('ENV disabled (default OFF) → null + krxPost 미호출', async () => {
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
    const r = await fetchKrxIntradayProgramTradeSingle('KOSPI');
    expect(r).toBeNull();
    expect(mockKrxPost).not.toHaveBeenCalled();
  });
  it('빈 응답 → null', async () => {
    mockKrxPost.mockResolvedValue({ output: [] });
    const r = await fetchKrxIntradayProgramTradeSingle('KOSPI');
    expect(r).toBeNull();
  });
  it('정상 응답 (한글 키 PRGM_NTBY_TRPMN, 다중 row 중 마지막) → 최신 row 추출', async () => {
    mockKrxPost.mockResolvedValue({
      output: [
        { TIME: '0930', PRGM_NTBY_TRPMN: '100' },
        { TIME: '1000', PRGM_NTBY_TRPMN: '500' },
        { TIME: '1100', PRGM_NTBY_TRPMN: '1500' }, // 최신
      ],
    });
    const r = await fetchKrxIntradayProgramTradeSingle('KOSPI');
    expect(r).not.toBeNull();
    expect(r?.market).toBe('KOSPI');
    expect(r?.programNetBuyAmount).toBe(1500); // 마지막 row
  });
  it('단일 row 응답 → 그 row 추출', async () => {
    mockKrxPost.mockResolvedValue({
      output: [{ PRGM_NTBY_TRPMN: '800' }],
    });
    const r = await fetchKrxIntradayProgramTradeSingle('KOSDAQ');
    expect(r?.programNetBuyAmount).toBe(800);
    expect(r?.market).toBe('KOSDAQ');
  });
  it('영문 alt 키 (NETBUY_TRDVAL) fallback', async () => {
    mockKrxPost.mockResolvedValue({
      output: [{ NETBUY_TRDVAL: '300' }],
    });
    const r = await fetchKrxIntradayProgramTradeSingle('KOSPI');
    expect(r?.programNetBuyAmount).toBe(300);
  });
  it('모든 핵심 필드 null 시 의미 없는 응답 → null 반환', async () => {
    mockKrxPost.mockResolvedValue({
      output: [{ TRD_DD: '20260512' }],
    });
    const r = await fetchKrxIntradayProgramTradeSingle('KOSPI');
    expect(r).toBeNull();
  });
  it('콤마 포함 숫자 파싱', async () => {
    mockKrxPost.mockResolvedValue({
      output: [{ PRGM_NTBY_TRPMN: '12,345,678' }],
    });
    const r = await fetchKrxIntradayProgramTradeSingle('KOSPI');
    expect(r?.programNetBuyAmount).toBe(12345678);
  });
  it('krxPost throw → null (graceful, endpoint shape 미검증 대응)', async () => {
    mockKrxPost.mockRejectedValue(new Error('KRX 404 Not Found'));
    const r = await fetchKrxIntradayProgramTradeSingle('KOSPI');
    expect(r).toBeNull();
  });
  it('OutBlock_1 fallback 키', async () => {
    mockKrxPost.mockResolvedValue({
      OutBlock_1: [{ PRGM_NTBY_TRPMN: '700' }],
    });
    const r = await fetchKrxIntradayProgramTradeSingle('KOSPI');
    expect(r?.programNetBuyAmount).toBe(700);
  });
  it('mktId 파라미터 정확 매핑 (KOSPI=STK, KOSDAQ=KSQ)', async () => {
    mockKrxPost.mockResolvedValue({ output: [{ PRGM_NTBY_TRPMN: '100' }] });
    await fetchKrxIntradayProgramTradeSingle('KOSPI');
    const [, kospiParams] = mockKrxPost.mock.calls[0];
    expect((kospiParams as Record<string, string>).mktId).toBe('STK');
    mockKrxPost.mockClear();
    await fetchKrxIntradayProgramTradeSingle('KOSDAQ');
    const [, kosdaqParams] = mockKrxPost.mock.calls[0];
    expect((kosdaqParams as Record<string, string>).mktId).toBe('KSQ');
  });
  it('endpoint = KRX_BLD_MARKET_PROGRAM_INTRADAY (BLD ID override 가능)', async () => {
    mockKrxPost.mockResolvedValue({ output: [{ PRGM_NTBY_TRPMN: '100' }] });
    await fetchKrxIntradayProgramTradeSingle('KOSPI');
    const [endpoint] = mockKrxPost.mock.calls[0];
    expect(endpoint).toBe(KRX_BLD_MARKET_PROGRAM_INTRADAY);
  });
  it('AFTER_MARKET MDCSTAT00301 session guard skips real HTTP request', async () => {
    vi.setSystemTime(new Date('2026-05-18T07:40:00Z')); // 16:40 KST
    mockKrxPost.mockResolvedValue({ output: [{ PRGM_NTBY_TRPMN: '100' }] });
    const r = await fetchKrxIntradayProgramTradeSingle('KOSPI');
    expect(r).toBeNull();
    expect(mockKrxPost).not.toHaveBeenCalled();
  });
});

describe('Patch-007 fetchKrxIntradayProgramTradeAggregate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(INTRADAY_NOW_MS));
    mockKrxPost.mockReset();
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'true';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
  });

  it('ENV disabled (default OFF) → confidence=EMPTY + 호출 0건', async () => {
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
    const r = await fetchKrxIntradayProgramTradeAggregate(INTRADAY_NOW_MS);
    expect(r.confidence).toBe('EMPTY');
    expect(r.kospi).toBeNull();
    expect(r.kosdaq).toBeNull();
    expect(r.totalProgramNet).toBeNull();
    expect(mockKrxPost).not.toHaveBeenCalled();
  });
  it('KOSPI + KOSDAQ 둘 다 정상 → confidence=VERIFIED + 합산', async () => {
    mockKrxPost
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '500' }] })
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '200' }] });
    const r = await fetchKrxIntradayProgramTradeAggregate(INTRADAY_NOW_MS);
    expect(r.confidence).toBe('VERIFIED');
    expect(r.kospi?.programNetBuyAmount).toBe(500);
    expect(r.kosdaq?.programNetBuyAmount).toBe(200);
    expect(r.totalProgramNet).toBe(700);
    expect(r.marketsAttempted).toEqual(['KOSPI', 'KOSDAQ']);
    expect(r.marketsSucceeded).toEqual(['KOSPI', 'KOSDAQ']);
  });
  it('KOSPI 만 정상 → confidence=PARTIAL', async () => {
    mockKrxPost
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '500' }] })
      .mockResolvedValueOnce({ output: [] });
    const r = await fetchKrxIntradayProgramTradeAggregate(INTRADAY_NOW_MS);
    expect(r.confidence).toBe('PARTIAL');
    expect(r.kospi?.programNetBuyAmount).toBe(500);
    expect(r.kosdaq).toBeNull();
    expect(r.marketsSucceeded).toEqual(['KOSPI']);
  });
  it('KOSDAQ 만 정상 → confidence=PARTIAL', async () => {
    mockKrxPost
      .mockResolvedValueOnce({ output: [] })
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '200' }] });
    const r = await fetchKrxIntradayProgramTradeAggregate(INTRADAY_NOW_MS);
    expect(r.confidence).toBe('PARTIAL');
    expect(r.kosdaq?.programNetBuyAmount).toBe(200);
    expect(r.marketsSucceeded).toEqual(['KOSDAQ']);
  });
  it('둘 다 실패 → confidence=EMPTY', async () => {
    mockKrxPost
      .mockResolvedValueOnce({ output: [] })
      .mockResolvedValueOnce({ output: [] });
    const r = await fetchKrxIntradayProgramTradeAggregate(INTRADAY_NOW_MS);
    expect(r.confidence).toBe('EMPTY');
    expect(r.totalProgramNet).toBeNull();
  });
  it('한쪽 throw → graceful', async () => {
    mockKrxPost
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '500' }] })
      .mockRejectedValueOnce(new Error('KRX 500'));
    const r = await fetchKrxIntradayProgramTradeAggregate(INTRADAY_NOW_MS);
    expect(r.confidence).toBe('PARTIAL');
    expect(r.kospi?.programNetBuyAmount).toBe(500);
    expect(r.kosdaq).toBeNull();
  });
});

describe('Patch-007 routeProgramMarketEmptyWithKrxAggregate intraday wiring', () => {
  beforeEach(() => {
    mockKrxPost.mockReset();
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
    delete process.env.PROGRAM_MARKET_FALLBACK_RECOVERY_006_DISABLED;
    delete process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
  });

  it('intraday + EOD empty + ENV OFF → UNSUPPORTED_INTRADAY (legacy 동작)', async () => {
    // EOD aggregate 빈 응답
    const eodEmpty: KrxMarketProgramAggregate = {
      kospi: null,
      kosdaq: null,
      totalProgramNet: null,
      arbitrageNet: null,
      nonArbitrageNet: null,
      timestamp: new Date(INTRADAY_NOW_MS).toISOString(),
      confidence: 'EMPTY',
      fetchedAt: new Date(INTRADAY_NOW_MS).toISOString(),
      endpoint: 'mock',
      bld: 'mock',
      marketsAttempted: ['KOSPI', 'KOSDAQ'],
      marketsSucceeded: [],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: () => Promise.resolve(eodEmpty), nowMs: INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('UNSUPPORTED_INTRADAY');
    expect(decision.intradayWiringAttempted).toBe(false);
    expect(decision.intradayWiringSucceeded).toBe(false);
    expect(decision.decisionDetail).toContain('intraday wiring 비활성');
  });

  it('intraday + EOD empty + intraday VERIFIED → routedStatus=VERIFIED + source=KRX_API + intradayWiringSucceeded=true', async () => {
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'true';
    // EOD aggregate 빈
    const eodEmpty: KrxMarketProgramAggregate = {
      kospi: null,
      kosdaq: null,
      totalProgramNet: null,
      arbitrageNet: null,
      nonArbitrageNet: null,
      timestamp: new Date(INTRADAY_NOW_MS).toISOString(),
      confidence: 'EMPTY',
      fetchedAt: new Date(INTRADAY_NOW_MS).toISOString(),
      endpoint: 'mock-eod',
      bld: 'mock-eod',
      marketsAttempted: ['KOSPI', 'KOSDAQ'],
      marketsSucceeded: [],
    };
    // intraday 호출은 krxPost mock 으로 — KOSPI + KOSDAQ 둘 다 정상
    mockKrxPost
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '300' }] })
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '150' }] });
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: () => Promise.resolve(eodEmpty), nowMs: INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('VERIFIED');
    expect(decision.source).toBe('KRX_API');
    expect(decision.intradayWiringAttempted).toBe(true);
    expect(decision.intradayWiringSucceeded).toBe(true);
    expect(decision.intradayAggregate?.totalProgramNet).toBe(450);
    expect(decision.scoring).toBe('allowed_when_non_empty');
    expect(decision.decisionDetail).toContain('KRX intraday recovered');
    expect(decision.executionImpact).toBe('NONE');
    expect(decision.providerIssue).toBe(false);
    expect(decision.marketSignal).toBe(false);
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
  });

  it('intraday + EOD empty + intraday PARTIAL → routedStatus=PARTIAL_VERIFIED + scoring=shadow_only_or_excluded', async () => {
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'true';
    const eodEmpty: KrxMarketProgramAggregate = {
      kospi: null,
      kosdaq: null,
      totalProgramNet: null,
      arbitrageNet: null,
      nonArbitrageNet: null,
      timestamp: new Date(INTRADAY_NOW_MS).toISOString(),
      confidence: 'EMPTY',
      fetchedAt: new Date(INTRADAY_NOW_MS).toISOString(),
      endpoint: 'mock-eod',
      bld: 'mock-eod',
      marketsAttempted: ['KOSPI', 'KOSDAQ'],
      marketsSucceeded: [],
    };
    // intraday: KOSPI 만 정상
    mockKrxPost
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '300' }] })
      .mockResolvedValueOnce({ output: [] });
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: () => Promise.resolve(eodEmpty), nowMs: INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('PARTIAL_VERIFIED');
    expect(decision.intradayWiringSucceeded).toBe(true);
    expect(decision.scoring).toBe('shadow_only_or_excluded');
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
  });


  it('intraday + EOD empty + rows>0 but mapper unmapped → SHAPE_CANDIDATE + scoring=excluded', async () => {
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'true';
    const eodEmpty: KrxMarketProgramAggregate = {
      kospi: null,
      kosdaq: null,
      totalProgramNet: null,
      arbitrageNet: null,
      nonArbitrageNet: null,
      timestamp: new Date(INTRADAY_NOW_MS).toISOString(),
      confidence: 'EMPTY',
      fetchedAt: new Date(INTRADAY_NOW_MS).toISOString(),
      endpoint: 'mock-eod',
      bld: 'mock-eod',
      marketsAttempted: ['KOSPI', 'KOSDAQ'],
      marketsSucceeded: [],
    };
    mockKrxPost
      .mockResolvedValueOnce({ tableData: [{ mysteryAmt: '123', unknownKey: 'x' }] })
      .mockResolvedValueOnce({ output: [] });
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: () => Promise.resolve(eodEmpty), nowMs: INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('SHAPE_CANDIDATE');
    expect(decision.scoring).toBe('excluded');
    expect(decision.executionImpact).toBe('NONE');
    expect(decision.providerIssue).toBe(false);
    expect(decision.marketSignal).toBe(false);
    expect(decision.intradayShapeProbe?.shapeCandidatePath).toBe('tableData');
    expect(decision.intradayShapeProbe?.promotionGuard).toBe('THREE_BUSINESS_DAYS_MAPPING_REQUIRED');
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
  });

  it('intraday + EOD empty + intraday EMPTY → UNSUPPORTED_INTRADAY (graceful, attempted=true succeeded=false)', async () => {
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'true';
    const eodEmpty: KrxMarketProgramAggregate = {
      kospi: null,
      kosdaq: null,
      totalProgramNet: null,
      arbitrageNet: null,
      nonArbitrageNet: null,
      timestamp: new Date(INTRADAY_NOW_MS).toISOString(),
      confidence: 'EMPTY',
      fetchedAt: new Date(INTRADAY_NOW_MS).toISOString(),
      endpoint: 'mock-eod',
      bld: 'mock-eod',
      marketsAttempted: ['KOSPI', 'KOSDAQ'],
      marketsSucceeded: [],
    };
    // intraday 둘 다 실패
    mockKrxPost
      .mockResolvedValueOnce({ output: [] })
      .mockResolvedValueOnce({ output: [] });
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: () => Promise.resolve(eodEmpty), nowMs: INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('UNSUPPORTED_INTRADAY');
    expect(decision.intradayWiringAttempted).toBe(true);
    expect(decision.intradayWiringSucceeded).toBe(false);
    expect(decision.decisionDetail).toContain('intraday endpoint shape');
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
  });

  it('intraday + EOD empty + intraday throw → UNSUPPORTED_INTRADAY (graceful)', async () => {
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'true';
    const eodEmpty: KrxMarketProgramAggregate = {
      kospi: null,
      kosdaq: null,
      totalProgramNet: null,
      arbitrageNet: null,
      nonArbitrageNet: null,
      timestamp: new Date(INTRADAY_NOW_MS).toISOString(),
      confidence: 'EMPTY',
      fetchedAt: new Date(INTRADAY_NOW_MS).toISOString(),
      endpoint: 'mock-eod',
      bld: 'mock-eod',
      marketsAttempted: ['KOSPI', 'KOSDAQ'],
      marketsSucceeded: [],
    };
    // intraday krxPost throw
    mockKrxPost.mockRejectedValue(new Error('KRX 404'));
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: () => Promise.resolve(eodEmpty), nowMs: INTRADAY_NOW_MS },
    );
    // krxPost 가 throw → fetchKrxIntradayProgramTradeSingle null 반환 → aggregate confidence=EMPTY
    // → UNSUPPORTED_INTRADAY 분기 (legacy)
    expect(decision.routedStatus).toBe('UNSUPPORTED_INTRADAY');
    expect(decision.intradayWiringAttempted).toBe(true);
    expect(decision.intradayWiringSucceeded).toBe(false);
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
  });

  it('intraday + EOD VERIFIED → 정상 EOD 경로 (intraday 호출 안 함)', async () => {
    process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED = 'true';
    const eodVerified: KrxMarketProgramAggregate = {
      kospi: { market: 'KOSPI', programNetBuyAmount: 500, programBuyAmount: 1000, programSellAmount: 500, arbitrageNetBuy: 100, nonArbitrageNetBuy: 400 },
      kosdaq: { market: 'KOSDAQ', programNetBuyAmount: 200, programBuyAmount: 400, programSellAmount: 200, arbitrageNetBuy: 50, nonArbitrageNetBuy: 150 },
      totalProgramNet: 700,
      arbitrageNet: 150,
      nonArbitrageNet: 550,
      timestamp: new Date(INTRADAY_NOW_MS).toISOString(),
      confidence: 'VERIFIED',
      fetchedAt: new Date(INTRADAY_NOW_MS).toISOString(),
      endpoint: 'mock-eod',
      bld: 'mock-eod',
      marketsAttempted: ['KOSPI', 'KOSDAQ'],
      marketsSucceeded: ['KOSPI', 'KOSDAQ'],
    };
    const decision = await routeProgramMarketEmptyWithKrxAggregate(
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0 } },
      { fetchKrx: () => Promise.resolve(eodVerified), nowMs: INTRADAY_NOW_MS },
    );
    expect(decision.routedStatus).toBe('VERIFIED');
    expect(decision.source).toBe('KRX_API');
    expect(decision.intradayWiringAttempted).toBeUndefined(); // EOD VERIFIED 시 intraday 미호출
    expect(mockKrxPost).not.toHaveBeenCalled();
    delete process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED;
  });
});

describe('Patch-007 정적 grep 안전 invariants', () => {
  it('KIS 주문 함수 5종 import 0건 (intradayProgramTradeFetcher.ts)', () => {
    for (const fn of ['placeKisMarketBuyOrder', 'placeKisMarketSellOrder', 'placeKisStopLossOrder', 'placeKisTakeProfitOrder', 'cancelKisOrder']) {
      expect(FETCHER_SOURCE).not.toContain(fn);
    }
  });
  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(FETCHER_SOURCE).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
    expect(FETCHER_SOURCE).not.toMatch(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/);
    expect(FETCHER_SOURCE).not.toMatch(/from\s+['"][^'"]*trancheExecutor[^'"]*['"]/);
  });
  it('외부 fetch / axios / node-fetch import 0건 (krxPost SSOT 단일 통로)', () => {
    expect(FETCHER_SOURCE).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(FETCHER_SOURCE).not.toMatch(/from\s+['"]axios['"]/);
    // 'fetch(' 직접 호출은 krxPost SSOT 가 내부에서만 사용
    expect(FETCHER_SOURCE).not.toMatch(/\bfetch\s*\(/);
  });
  it('Patch-007 추적 주석 + ENV 정확 비교 (ADR-0157)', () => {
    expect(FETCHER_SOURCE).toContain('Patch-KRX-INTRADAY-MARKET-PROGRAM-WIRING-001');
    expect(FETCHER_SOURCE).toContain("=== 'true'");
  });
  it('router 가 intraday fetcher SSOT import + UNSUPPORTED_INTRADAY 전 시도', () => {
    expect(ROUTER_SOURCE).toContain('intradayProgramTradeFetcher.js');
    expect(ROUTER_SOURCE).toContain('isKrxIntradayMarketProgramEnabled');
    expect(ROUTER_SOURCE).toContain('fetchKrxIntradayProgramTradeAggregate');
    // UNSUPPORTED_INTRADAY 전에 intraday 시도하는 분기 존재
    expect(ROUTER_SOURCE).toContain('intradayWiringAttempted');
    expect(ROUTER_SOURCE).toContain('intradayWiringSucceeded');
  });
  it('supplyHealth.cmd.ts 가 intradayWiringAttempted 분기 처리', () => {
    expect(SUPPLY_HEALTH_SOURCE).toContain('intradayWiringAttempted');
    // wiring 활성화 안내 + BLD ID override 안내 둘 다 존재
    expect(SUPPLY_HEALTH_SOURCE).toContain('KRX_INTRADAY_MARKET_PROGRAM_ENABLED');
    expect(SUPPLY_HEALTH_SOURCE).toContain('KRX_BLD_MARKET_PROGRAM_INTRADAY');
  });
});
