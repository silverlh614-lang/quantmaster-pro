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
});
