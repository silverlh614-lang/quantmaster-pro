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

// 묶음0 freshness 검증을 위해 quote/bars mock 을 변수로 캡처해 케이스별 override 가능하게 한다.
const fetchKisStockFullQuote = vi.fn(async (_code: string) => null as unknown);
const fetchKisStockDailyBars = vi.fn(async (_code: string, _n?: number) => [] as unknown[]);

vi.mock('../clients/kisClient.js', () => ({
  fetchKisStockFullQuote: (code: string) => fetchKisStockFullQuote(code),
  fetchKisStockDailyBars: (code: string, n?: number) => fetchKisStockDailyBars(code, n),
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

// ─── ADR-0556 묶음0: per-field freshness 통합 격리 ───────────────────────────

/** 기술지표가 완전 산출(VERIFIED)되도록 60+ 일봉(완만한 상승)을 생성. bars[0]=최신. */
function makeBars(count: number): Array<{ date: string; close: number; volume: number }> {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026${String(count - i).padStart(4, '0')}`,
    close: 1000 + (count - i), // bars[0]=최신=가장 큰 close → 상승 추세
    volume: 100000 + i,
  }));
}

const FULL_QUOTE = {
  code: '005930',
  currentPrice: 1100,
  volume: 500000,
  changePercent: 1.5,
  prevClose: 1080,
  fetchedAt: new Date().toISOString(),
  per: 12.3,
  eps: 90,
  listedShares: 100000,
};

describe('ADR-0556 묶음0 — per-field freshness 통합 격리', () => {
  it('happy path — 전 필드 정상이면 freshness 가 채워지고 providerIssue=false', async () => {
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
    fetchKisStockFullQuote.mockResolvedValueOnce(FULL_QUOTE);
    fetchKisStockDailyBars.mockResolvedValueOnce(makeBars(65));

    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    const snapshot = await collectUnifiedSnapshot(['005930']);
    const sym = snapshot.perSymbol['005930'];

    expect(sym.freshness).toBeDefined();
    expect(sym.freshness?.quote).toBe('VERIFIED');
    expect(sym.freshness?.technicalIndicators).toBe('VERIFIED');
    expect(sym.freshness?.supply).toBe('VERIFIED');
    // DART 슬롯은 flag OFF 라 미수집(null) → MISSING. providerIssue=true 의 원인은 dart 뿐.
    expect(sym.freshness?.dartFinancials).toBe('MISSING');
    // dart 제외 핵심 L1 필드(quote/technical/supply)는 전부 VERIFIED.
    expect(sym.freshness?.marketSignal).toBe(false);
  });

  it('한 fetch(quote) 실패 → quote 만 MISSING, 나머지 격리·throw 없음', async () => {
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
    // quote=null (실패), 일봉은 정상 → technicals 는 quote 없이 bars[0] 로 산출 가능.
    fetchKisStockFullQuote.mockResolvedValueOnce(null);
    fetchKisStockDailyBars.mockResolvedValueOnce(makeBars(65));

    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    const snapshot = await collectUnifiedSnapshot(['005930']);
    const sym = snapshot.perSymbol['005930'];

    // throw 없이 snapshot 반환됨 (불변식 #1).
    expect(sym).toBeDefined();
    expect(sym.freshness?.quote).toBe('MISSING');
    // 나머지 필드는 독립 격리 — supply 는 정상(VERIFIED) 유지.
    expect(sym.freshness?.supply).toBe('VERIFIED');
    // 한 필드라도 비VERIFIED → providerIssue=true.
    expect(sym.freshness?.providerIssue).toBe(true);
  });

  it('불변식 #6 — provider 장애 필드가 있어도 marketSignal=false 격리 유지', async () => {
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
    // 전 fetch 실패(quote null, bars 빈) → providerIssue=true 이지만 marketSignal 은 절대 true 가 아님.
    fetchKisStockFullQuote.mockResolvedValueOnce(null);
    fetchKisStockDailyBars.mockResolvedValueOnce([]);

    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    const snapshot = await collectUnifiedSnapshot(['005930']);
    const sym = snapshot.perSymbol['005930'];

    expect(sym.freshness?.providerIssue).toBe(true);
    // 핵심 불변식: provider 장애 ≠ 약세 신호.
    expect(sym.freshness?.marketSignal).toBe(false);
    // 타입 수준에서도 marketSignal 은 항상 false (literal type) — 런타임 단언으로 회귀 잠금.
    expect(sym.freshness?.marketSignal as boolean).not.toBe(true);
  });

  it('flag OFF byte-equivalent — collectUnifiedSnapshot 은 flag ON 경로 전용 호출이며 OFF 에서 DART 슬롯 미수집', async () => {
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
    buildSymbolDartFinancialsSlot.mockClear();
    fetchKisStockFullQuote.mockResolvedValueOnce(FULL_QUOTE);
    fetchKisStockDailyBars.mockResolvedValueOnce(makeBars(65));

    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    const snapshot = await collectUnifiedSnapshot(['005930']);
    const sym = snapshot.perSymbol['005930'];

    // flag OFF: DART 정본 슬롯 build 미호출(외부 fetch 0) + dartFinancials=null.
    expect(buildSymbolDartFinancialsSlot).not.toHaveBeenCalled();
    expect(sym.dartFinancials).toBeNull();
    // freshness 매핑은 순수 계산이라 OFF 에서도 동일하게 산출(네트워크/quota 무관) — dart 는 MISSING.
    expect(sym.freshness?.dartFinancials).toBe('MISSING');
  });
});
