import { describe, it, expect, vi } from 'vitest';

// macroState/KRX master는 경량 stub — 수급 경로만 검증
vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: () => null,
}));
vi.mock('../persistence/krxStockMasterRepo.js', () => ({
  getAllStockEntries: () => [],
}));

// 출처 통일(FHPTJ04160001): collector는 정본 fetchKisInvestorTradeByStockDaily 만 사용해야 한다.
// 폐기된 fetchKisInvestorFlow(inquire-investor/FHKST01010300) 는 mock 에 제공하지 않는다 —
// collector 가 그걸 부르면 undefined 호출로 즉시 실패한다.
const fetchKisInvestorTradeByStockDaily = vi.fn(async (code: string) => ({
  stockCode: code,
  tradingDate: '20260522',
  foreignNetBuy: 1000,
  institutionalNetBuy: 500,
  individualNetBuy: -1500,
  source: 'KIS_API' as const,
  fetchedAt: new Date().toISOString(),
}));

vi.mock('../clients/kisClient.js', () => ({
  fetchKisStockFullQuote: vi.fn(async () => null),
  fetchKisStockDailyBars: vi.fn(async () => []),
  fetchKisStockProgramTrade: vi.fn(async () => null),
  fetchKisInvestorTradeByStockDaily: (code: string) =>
    fetchKisInvestorTradeByStockDaily(code),
}));

// ADR-0529: DART 정본 슬롯 build 를 mock — flag ON 경로에서 build 실패가 4 KIS 수집/scan 을
// 막지 않는지(불변식 #1) 검증한다. flag OFF 기본 테스트는 이 mock 를 호출하지 않는다.
const buildSymbolDartFinancialsSlot = vi.fn(async () => {
  throw new Error('DART_BUILD_FAILED');
});
vi.mock('./gate2/gate2DartCanonicalSlot.js', () => ({
  buildSymbolDartFinancialsSlot: () => buildSymbolDartFinancialsSlot(),
}));

describe('SymbolDataCollector 수급 출처 통일 (FHPTJ04160001)', () => {
  it('정본 fetchKisInvestorTradeByStockDaily 로 수급을 수집하고 supplySignal 을 도출한다', async () => {
    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    const snapshot = await collectUnifiedSnapshot(['005930']);
    const sym = snapshot.perSymbol['005930'];

    // 정본 fetch 가 종목 코드로 호출됨 (= 출처 통일)
    expect(fetchKisInvestorTradeByStockDaily).toHaveBeenCalledWith('005930');

    // 수급이 MISSING 이 아니라 실제 순매수로 채워짐
    expect(sym.investorFlow).not.toBeNull();
    expect(sym.investorFlow?.foreignNetBuy).toBe(1000);
    expect(sym.investorFlow?.institutionalNetBuy).toBe(500);

    // 외국인+기관 동반 순매수 → supplySignal 은 UNKNOWN 이 아님 (provider 장애가 아님)
    expect(sym.supplySignal).not.toBeNull();
    expect(sym.supplySignal?.supplySignal).not.toBe('UNKNOWN');
    expect(sym.supplySignal?.providerHealth).toBe('VERIFIED');
  });

  it('flag OFF 기본 — DART 정본 슬롯 build 를 호출하지 않고 dartFinancials=null (회귀 0)', async () => {
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
    buildSymbolDartFinancialsSlot.mockClear();
    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    const snapshot = await collectUnifiedSnapshot(['005930']);
    const sym = snapshot.perSymbol['005930'];

    expect(buildSymbolDartFinancialsSlot).not.toHaveBeenCalled();
    expect(sym.dartFinancials).toBeNull();
  });

  it('불변식 #1 — flag ON 에서 DART 슬롯 build 실패해도 수급/supplySignal 무영향 + MISSING 슬롯 + scan 무중단', async () => {
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';
    buildSymbolDartFinancialsSlot.mockClear();
    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    const snapshot = await collectUnifiedSnapshot(['005930']);
    const sym = snapshot.perSymbol['005930'];

    // DART build 가 시도되었으나 throw — 그래도 종목 수집 결과는 정상 반환되어야 한다.
    expect(buildSymbolDartFinancialsSlot).toHaveBeenCalled();
    // 4 KIS 파생 수급은 DART 실패와 무관하게 보존.
    expect(sym.supplySignal?.supplySignal).not.toBe('UNKNOWN');
    expect(sym.supplySignal?.providerHealth).toBe('VERIFIED');
    // DART 실패는 MISSING 슬롯으로 격리 (financials=null, cadence=MISSING).
    expect(sym.dartFinancials?.financials).toBeNull();
    expect(sym.dartFinancials?.cadence).toBe('MISSING');
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
  });
});
