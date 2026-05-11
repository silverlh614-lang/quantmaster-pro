/**
 * @responsibility supplyHealth.cmd read-only 수급 데이터 신뢰성 진단 회귀 테스트.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const investorMock = vi.fn();
const stockProgramMock = vi.fn();
const marketProgramMock = vi.fn();
const currentPriceMock = vi.fn();
const prevCloseMock = vi.fn();
const stockNameMock = vi.fn();
const shortSaleMock = vi.fn();
const loanTransactionMock = vi.fn();
const creditBalanceMock = vi.fn();
const investorDailyMock = vi.fn();
const foreignInstitutionMock = vi.fn();
const investorEstimateMock = vi.fn();
const marketSupplyMock = vi.fn();
const investorDailyByMarketMock = vi.fn();
const investorTimeByMarketMock = vi.fn();

vi.mock('../../../../clients/kisClient/index.js', () => ({
  fetchCurrentPrice: currentPriceMock,
  fetchKisPrevClose: prevCloseMock,
  fetchStockName: stockNameMock,
  fetchKisInvestorFlow: investorMock,
  fetchKisDailyShortSale: shortSaleMock,
  fetchKisDailyLoanTransaction: loanTransactionMock,
  fetchKisDailyCreditBalance: creditBalanceMock,
  fetchKisInvestorTradeByStockDaily: investorDailyMock,
  fetchKisForeignInstitutionTotal: foreignInstitutionMock,
  fetchKisInvestorTrendEstimate: investorEstimateMock,
  fetchKisStockProgramTrade: stockProgramMock,
  fetchKisMarketProgramTrade: marketProgramMock,
  fetchKisMarketSupply: marketSupplyMock,
  fetchKisInvestorDailyByMarket: investorDailyByMarketMock,
  fetchKisInvestorTimeByMarket: investorTimeByMarketMock,
}));

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function makeWatchlist(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      code: String(100000 + n),
      name: `S${n}`,
      entryPrice: 1000,
      stopLoss: 900,
      targetPrice: 1200,
      addedAt: '2026-05-01T00:00:00.000Z',
      addedBy: 'AUTO',
      stage2Score: n,
    };
  });
}

function writeInvestorFlowCache(dir: string, codes: string[], opts: { zero?: boolean; fetchedAt?: string; date?: string } = {}): void {
  const zero = opts.zero ?? false;
  const fetchedAt = opts.fetchedAt ?? '2026-05-01T00:30:00.000Z';
  const date = opts.date ?? '2026-04-30';
  const cache: Record<string, unknown[]> = {};
  for (const code of codes) {
    cache[code] = [{
      stockCode: code,
      date,
      foreignNetBuy: zero ? 0 : 100,
      institutionalNetBuy: zero ? 0 : 200,
      individualNetBuy: zero ? 0 : -300,
      provider: 'KRX_INVESTOR_FLOW',
      fetchedAt,
    }];
  }
  writeJson(path.join(dir, 'investor-flow-cache.json'), cache);
}

async function importCommand() {
  const registry = await import('../../../commandRegistry.js');
  registry.commandRegistry.__resetForTests();
  const mod = await import('../supplyHealth.cmd.js');
  return { registry, mod };
}

describe('/supply_health command', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supply-health-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    investorMock.mockReset();
    stockProgramMock.mockReset();
    marketProgramMock.mockReset();
    currentPriceMock.mockReset();
    prevCloseMock.mockReset();
    stockNameMock.mockReset();
    shortSaleMock.mockReset();
    loanTransactionMock.mockReset();
    creditBalanceMock.mockReset();
    investorDailyMock.mockReset();
    foreignInstitutionMock.mockReset();
    investorEstimateMock.mockReset();
    marketSupplyMock.mockReset();
    investorDailyByMarketMock.mockReset();
    investorTimeByMarketMock.mockReset();
    currentPriceMock.mockResolvedValue(null);
    prevCloseMock.mockResolvedValue(null);
    stockNameMock.mockResolvedValue(null);
    shortSaleMock.mockResolvedValue(null);
    loanTransactionMock.mockResolvedValue(null);
    creditBalanceMock.mockResolvedValue(null);
    investorDailyMock.mockResolvedValue(null);
    foreignInstitutionMock.mockResolvedValue(null);
    investorEstimateMock.mockResolvedValue(null);
    marketSupplyMock.mockResolvedValue(null);
    investorDailyByMarketMock.mockResolvedValue(null);
    investorTimeByMarketMock.mockResolvedValue(null);
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('/supply_health and /sh 등록 + 메타데이터', async () => {
    const { registry } = await importCommand();
    const cmd = registry.commandRegistry.resolve('/supply_health');
    expect(cmd).toBeDefined();
    expect(registry.commandRegistry.resolve('/sh')).toBe(cmd);
    expect(registry.commandRegistry.resolve('/investor_flow')).toBe(cmd);
    expect(registry.commandRegistry.resolve('/flow_health')).toBe(cmd);
    expect(cmd?.category).toBe('SYS');
    expect(cmd?.visibility).toBe('ADMIN');
    expect(cmd?.riskLevel).toBe(0);
  });

  it('execute는 한 메시지로 reply 한다', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(1));
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { registry } = await importCommand();
    const reply = vi.fn();

    await registry.commandRegistry.resolve('/sh')?.execute({ args: [], reply });

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][0]).toContain('Supply Health');
  });

  it('providerTried formatter prefers ADR-0477 router CACHE_STALE_HIT over legacy CACHE_EMPTY/NOT_WIRED', async () => {
    const { mod } = await importCommand();
    const text = mod.formatRouterAwareInvestorFlowAttemptSummary({
      code: '067370',
      route: 'investor_flow',
      selectedProvider: 'CACHE',
      providerTried: ['NAVER', 'SEMANTIC_NETBUY', 'CACHE', 'KIS'],
      providerReasons: {
        NAVER: 'ADR-0481 market session closed.',
        SEMANTIC_NETBUY: 'ADR-0482 stale normalized cache input.',
        CACHE: 'ADR-0491 cacheLookupResult=CACHE_STALE_HIT reason=STALE_SANITIZED_SNAPSHOT_HIT_OBSERVE_ONLY',
      },
      providerStatuses: {
        KRX: 'NON_TRADING_DAY',
        NAVER: 'NON_TRADING_DAY',
        SEMANTIC_NETBUY: 'STALE',
        CACHE: 'CACHE_STALE_HIT',
        KIS: 'PROVIDER_MISMATCH',
      },
      semanticNetBuy: null,
      status: 'STALE',
      signal: 'UNKNOWN',
      coverage: { available: 1, total: 7, missing: 5, stale: 1, acceptedEmpty: 0, providerMismatch: 1, notWired: 0 },
      freshness: { cacheState: 'STALE', sourceState: 'STALE', sourceAgeTradingDays: 5, oldestSourceAgeTradingDays: 5, lastSourceDate: null },
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'SHADOW_ONLY',
      operatorApprovalRequired: true,
      selectedReason: 'ADR-0491 sanitized snapshot cache selected: CACHE_STALE_HIT',
      rawPayloadPersistenceAllowed: false,
      diagnostics: ['cacheLookupResult=CACHE_STALE_HIT; rawPayloadPersistenceAllowed=false; liveExecutionAllowed=false'],
    });

    expect(text).toContain('NAVER_INVESTOR_TREND:NON_TRADING_DAY');
    expect(text).toContain('SEMANTIC_NETBUY:STALE');
    expect(text).toContain('CACHE:CACHE_STALE_HIT');
    expect(text).toContain('selectedProvider=CACHE');
    expect(text).toContain('CACHE selected');
    expect(text).not.toContain('CACHE:CACHE_EMPTY');
    expect(text).not.toContain('NAVER_INVESTOR_TREND:NOT_WIRED');
    expect(text).not.toContain('semantic net-buy collector not implemented');
    expect(text).not.toContain('BEARISH');
  });

  it('providerTried formatter separates SemanticNetBuy NO_INPUT_SAMPLE from NAVER reason', async () => {
    const { mod } = await importCommand();
    const text = mod.formatRouterAwareInvestorFlowAttemptSummary({
      code: '005930',
      route: 'investor_flow',
      selectedProvider: 'NONE',
      providerTried: ['NAVER', 'SEMANTIC_NETBUY', 'CACHE'],
      providerReasons: {
        NAVER_INVESTOR_TREND: 'FreshData registry bridge READY_FOR_SHADOW normalized NAVER_INVESTOR_TREND sample.',
        SEMANTIC_NETBUY: 'ADR-0482 normalizer input not supplied and no FreshData registry bridge sample.',
      },
      providerStatuses: {
        NAVER_INVESTOR_TREND: 'READY_FOR_SHADOW',
        SEMANTIC_NETBUY: 'DATA_UNAVAILABLE',
        CACHE: 'CACHE_EMPTY',
      },
      semanticNetBuy: null,
      status: 'DATA_UNAVAILABLE',
      signal: 'UNKNOWN',
      coverage: { available: 1, total: 3, missing: 2, stale: 0, acceptedEmpty: 0, providerMismatch: 0, notWired: 0 },
      freshness: { cacheState: 'EMPTY', sourceState: 'UNKNOWN', sourceAgeTradingDays: null, oldestSourceAgeTradingDays: null, lastSourceDate: null },
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'SHADOW_ONLY',
      operatorApprovalRequired: true,
      selectedReason: null,
      rawPayloadPersistenceAllowed: false,
      diagnostics: ['UNKNOWN/provider issue is not bearish'],
    });

    expect(text).toContain('NAVER_INVESTOR_TREND:READY_FOR_SHADOW');
    expect(text).toContain('SEMANTIC_NETBUY:DATA_UNAVAILABLE(NO_INPUT_SAMPLE)');
    expect(text).not.toContain('NAVER_INVESTOR_TREND:NOT_WIRED');
    expect(text).not.toContain('NAVER_INVESTOR_TREND:DATA_UNAVAILABLE(NO_INPUT_SAMPLE)');
    expect(text).not.toContain('BEARISH');
  });

  it('watchlist 10개 초과 시 stage2Score 상위 10개만 사용', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(12));
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue({ programNetBuyQty: 1, programNetBuyAmount: 100_000_000, programArbitrageNetBuy: null, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg).toContain('검증 종목: stage2Score 상위 10개 중 10개');
    expect(investorMock).toHaveBeenCalledTimes(1);
    expect(stockProgramMock).toHaveBeenCalledTimes(11);
    expect(stockProgramMock.mock.calls.filter((c) => c[1] === 'MEDIUM')).toHaveLength(10);
  });

  it('10개 미만이면 있는 만큼 표시', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(7));
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg).toContain('검증 종목: stage2Score 상위 7개');
    expect(investorMock).toHaveBeenCalledTimes(1);
  });

  it('zero-filled 의심 3/10 이상이면 경고 표시', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(10));
    writeInvestorFlowCache(tmpDir, Array.from({ length: 10 }, (_, i) => String(100001 + i)), { zero: true });
    investorMock.mockResolvedValue({ foreignNetBuy: 0, institutionalNetBuy: 0, individualNetBuy: 0, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg).toContain('zero-filled 의심: 10/10 ⚠️');
    expect(msg).toContain('🟠 기관/외인 수급: zero-filled 의심 10/10');
    expect(msg).toContain('cache: 10/10');
  });

  it('기관/외인 CACHE age가 오래되면 STALE로 표시', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(10));
    writeInvestorFlowCache(tmpDir, Array.from({ length: 10 }, (_, i) => String(100001 + i)), {
      fetchedAt: '2026-04-27T00:00:00.000Z',
    });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg).toContain('1. 🟡 기관/외인 수급');
    expect(msg).toContain('status: STALE');
    expect(msg).toContain('stale: 10');
    expect(msg).toContain('CACHE stale 10/10');
  });

  it('OK / STALE / MISSING 마커와 상세 명령 안내 표시', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(10));
    writeInvestorFlowCache(tmpDir, Array.from({ length: 10 }, (_, i) => String(100001 + i)));
    writeJson(path.join(tmpDir, 'fss-records.json'), [
      { date: '2026-04-20', passiveNetBuy: 1, activeNetBuy: 1 },
    ]);
    writeJson(path.join(tmpDir, 'macro-state.json'), {
      mhs: 50,
      regime: 'R4_NEUTRAL',
      updatedAt: '2026-05-01T00:00:00.000Z',
      marginBalanceSource: 'ECOS_API',
      marginBalance5dChange: 1,
      marginBalanceFetchedAt: '2026-05-01T00:00:00.000Z',
    });
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue(null);
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg).toContain('1. 🟢 기관/외인 수급');
    expect(msg).toContain('2. 🟠 KIS Official Supply Pack');
    expect(msg).toContain('3. 🔴 종목 프로그램매매');
    expect(msg).toContain('5. 🟡 FSS Passive/Active');
    expect(msg).toContain('6. ⚪ 공매도/대차잔고');
    expect(msg).toContain('상세: /program_today');
    expect(msg).toContain('상세: /program_market');
    expect(msg).toContain('상세: /fss_status');
    expect(msg).toContain('상세: /short_status 예정');
    expect(msg).toContain('상세: /foreigner_trend');
    expect(msg).toContain('상세: /margin_balance');
    expect(msg.length).toBeLessThan(4096);
  });

  it('하단 상세는 8채널 고정 순서로 출력', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(10));
    writeInvestorFlowCache(tmpDir, Array.from({ length: 10 }, (_, i) => String(100001 + i)));
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg.indexOf('1. 🟢 기관/외인 수급')).toBeLessThan(msg.indexOf('2. 🟠 KIS Official Supply Pack'));
    expect(msg.indexOf('2. 🟠 KIS Official Supply Pack')).toBeLessThan(msg.indexOf('3. 🟢 종목 프로그램매매'));
    expect(msg.indexOf('3. 🟢 종목 프로그램매매')).toBeLessThan(msg.indexOf('4. 🔴 시장 프로그램매매'));
    expect(msg.indexOf('4. 🔴 시장 프로그램매매')).toBeLessThan(msg.indexOf('5. ⚪ FSS Passive/Active'));
    expect(msg.indexOf('5. ⚪ FSS Passive/Active')).toBeLessThan(msg.indexOf('6. ⚪ 공매도/대차잔고'));
    expect(msg.indexOf('6. ⚪ 공매도/대차잔고')).toBeLessThan(msg.indexOf('7. ⚪ 외인 보유율 추세'));
    expect(msg.indexOf('7. ⚪ 외인 보유율 추세')).toBeLessThan(msg.indexOf('8. ⚪ 신용잔고'));
  });

  // ADR-0145: 4-way 분기 (MISSING / KIS_ESTIMATE STALE / age STALE / OK)

  it('ADR-0145 — macroState shortSellingSource 부재 시 NEUTRAL 점수 제외', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(1));
    writeJson(path.join(tmpDir, 'macro-state.json'), {
      // shortSelling* 필드 모두 부재
      mhs: 50,
      regime: 'R4_NEUTRAL',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg).toContain('6. ⚪ 공매도/대차잔고');
    expect(msg).toContain('PROVIDER_UNAVAILABLE');
    expect(msg).toContain('source: N/A');
    expect(msg).toContain('ratio: N/A');
  });

  it('ADR-0145 — source=KRX_DIRECT + 신선한 fetchedAt → OK', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(1));
    writeJson(path.join(tmpDir, 'macro-state.json'), {
      mhs: 50,
      regime: 'R4_NEUTRAL',
      updatedAt: '2026-05-01T00:00:00.000Z',
      shortSellingRatio: 4.85,
      shortSellingSource: 'KRX_DIRECT',
      shortSellingFetchedAt: '2026-04-30T17:00:00.000Z',
    });
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg).toContain('6. 🟢 공매도/대차잔고');
    expect(msg).toContain('source: KRX_DIRECT');
    expect(msg).toContain('ratio: 4.85%');
  });

  it('ADR-0145 — source=KIS_ESTIMATE → STALE (KRX 폴백 실패 격상)', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(1));
    writeJson(path.join(tmpDir, 'macro-state.json'), {
      mhs: 50,
      regime: 'R4_NEUTRAL',
      updatedAt: '2026-05-01T00:00:00.000Z',
      shortSellingRatio: 5.20,
      shortSellingSource: 'KIS_ESTIMATE',
      shortSellingFetchedAt: '2026-05-01T00:30:00.000Z',
    });
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg).toContain('6. 🟡 공매도/대차잔고');
    expect(msg).toContain('KIS_ESTIMATE');
    expect(msg).toContain('source: KIS_ESTIMATE');
  });

  it('ADR-0145 — source=KRX_DIRECT but updated 3일 전 → STALE (age)', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(1));
    writeJson(path.join(tmpDir, 'macro-state.json'), {
      mhs: 50,
      regime: 'R4_NEUTRAL',
      updatedAt: '2026-05-01T00:00:00.000Z',
      shortSellingRatio: 4.50,
      shortSellingSource: 'KRX_DIRECT',
      shortSellingFetchedAt: '2026-04-28T01:00:00.000Z',
    });
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const msg = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));

    expect(msg).toContain('6. 🟡 공매도/대차잔고');
    expect(msg).toContain('source: KRX_DIRECT');
    // age 3일 → "3일 전" 또는 "72h ago" 형태
    expect(msg).toMatch(/updated.+(?:3일 전|7\dh ago)/);
  });

  it('30초 TTL 캐시 동작', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(10));
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    const first = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));
    const second = await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:12.000Z'));

    expect(first).toContain('캐시: fresh');
    expect(second).toContain('캐시: 12s');
    expect(investorMock).toHaveBeenCalledTimes(1);
    expect(stockProgramMock).toHaveBeenCalledTimes(11);
  });

  it('30초 TTL 만료 후 새로 진단한다', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(10));
    investorMock.mockResolvedValue({ foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'));
    await mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:31.000Z'));

    expect(investorMock).toHaveBeenCalledTimes(2);
    expect(stockProgramMock).toHaveBeenCalledTimes(22);
  });

  it('개별 KIS 실패가 전체 명령 실패로 전파되지 않음', async () => {
    writeJson(path.join(tmpDir, 'watchlist.json'), makeWatchlist(10));
    writeInvestorFlowCache(tmpDir, Array.from({ length: 9 }, (_, i) => String(100001 + i)));
    investorMock.mockImplementation((code: string) => {
      if (code === '100010') throw new Error('boom');
      return { foreignNetBuy: 1, institutionalNetBuy: 1, individualNetBuy: -2, source: 'KIS_API' };
    });
    stockProgramMock.mockResolvedValue({ stockCode: 'x', programNetBuyQty: 1, programNetBuyAmount: 1, programBuyRatio: 1, fetchedAt: '2026-05-01T00:00:00.000Z', source: 'KIS_API' });
    marketProgramMock.mockResolvedValue(null);
    const { mod } = await importCommand();

    await expect(mod.buildSupplyHealthMessage(new Date('2026-05-01T01:00:00.000Z'))).resolves.toContain('success: 9/10');
  });

  it('read-only: 데이터 저장/수정 함수와 refresh 호출 없음', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'server/telegram/commands/system/supplyHealth.cmd.ts'), 'utf-8');
    expect(source).not.toMatch(/\bsave[A-Z]\w*\(/);
    expect(source).not.toMatch(/\bappend[A-Z]\w*\(/);
    expect(source).not.toMatch(/\bupsert[A-Z]\w*\(/);
    expect(source).not.toMatch(/\brefresh[A-Z]\w*\(/);
    expect(source).not.toMatch(/krxMasterRefresh|masterRefresh|saveMacroState|saveFssRecords|appendForeignerRatio/);
  });
}, 15_000);
