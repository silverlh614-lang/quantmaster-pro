// @responsibility Patch-PORTFOLIO-RISK-ENTRY-MARKET-SEGMENT-001 진입 차단 경로 시장구분 가드 회귀.
/**
 * 우량기업부/KOSPI 등 KRX 소속부·시장구분이 sector 필드에 누출돼도
 * checkSectorConcentration / checkCorrelation 이 산업 섹터로 오인해
 * "100% 진입 차단" 오판을 내지 않는지 검증한다.
 *
 * PATCH-008 은 auto-action(손절선 긴축) 경로만 고쳤고, 본 패치는
 * evaluatePortfolioRisk 의 진입 차단 경로를 차단한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadShadowTrades: vi.fn(),
  loadWatchlist: vi.fn(),
  getRealtimePrice: vi.fn(),
  fetchCurrentPrice: vi.fn(),
  getDailyLossPct: vi.fn(),
  loadTradingSettings: vi.fn(),
  computeShadowAccount: vi.fn(),
}));

vi.mock('../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: mocks.loadShadowTrades,
  saveShadowTrades: vi.fn(),
}));
vi.mock('../persistence/watchlistRepo.js', () => ({ loadWatchlist: mocks.loadWatchlist }));
vi.mock('../clients/kisStreamClient.js', () => ({ getRealtimePrice: mocks.getRealtimePrice }));
vi.mock('../clients/kisClient.js', () => ({ fetchCurrentPrice: mocks.fetchCurrentPrice }));
vi.mock('../alerts/telegramClient.js', () => ({ sendTelegramAlert: vi.fn() }));
vi.mock('../state.js', () => ({ getDailyLossPct: mocks.getDailyLossPct, getTradingMode: () => 'SHADOW' }));
vi.mock('../persistence/tradingSettingsRepo.js', () => ({ loadTradingSettings: mocks.loadTradingSettings }));
vi.mock('../persistence/shadowAccountRepo.js', () => ({ computeShadowAccount: mocks.computeShadowAccount }));

const { evaluatePortfolioRisk } = await import('./portfolioRiskEngine.js');

interface PosInput { code: string; name: string; sector: string; price?: number; qty?: number }

function setup(positions: PosInput[]) {
  mocks.loadShadowTrades.mockReturnValue(
    positions.map((p) => ({
      stockCode: p.code,
      stockName: p.name,
      status: 'ACTIVE',
      quantity: p.qty ?? 10,
      shadowEntryPrice: p.price ?? 10_000,
    })),
  );
  mocks.loadWatchlist.mockReturnValue(positions.map((p) => ({ code: p.code, sector: p.sector })));
  mocks.getRealtimePrice.mockImplementation((code: string) => {
    const found = positions.find((p) => p.code === code);
    return found?.price ?? 10_000;
  });
  mocks.fetchCurrentPrice.mockResolvedValue(null);
  mocks.getDailyLossPct.mockReturnValue(0);
  mocks.loadTradingSettings.mockReturnValue({ startingCapital: 100_000_000 });
  mocks.computeShadowAccount.mockReturnValue({ totalAssets: 100_000_000 });
}

describe('Patch-PORTFOLIO-RISK-ENTRY-MARKET-SEGMENT-001 — 진입 차단 경로 시장구분 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PORTFOLIO_RISK_MARKET_SEGMENT_ENTRY_GUARD_DISABLED;
  });
  afterEach(() => {
    delete process.env.PORTFOLIO_RISK_MARKET_SEGMENT_ENTRY_GUARD_DISABLED;
  });

  it('보유 1종목이 우량기업부(100%) — 같은 소속부 후보 진입 차단하지 않음 (핵심 결함)', async () => {
    setup([{ code: '000001', name: 'A', sector: '우량기업부' }]);
    const r = await evaluatePortfolioRisk('우량기업부');
    expect(r.entryAllowed).toBe(true);
    expect(r.blockReasons.some((x) => x.includes('섹터 집중도'))).toBe(false);
  });

  it('보유 2종목 모두 우량기업부(100%) — 시장구분이므로 여전히 차단하지 않음', async () => {
    setup([
      { code: '000001', name: 'A', sector: '우량기업부' },
      { code: '000002', name: 'B', sector: '우량기업부' },
    ]);
    const r = await evaluatePortfolioRisk('우량기업부');
    expect(r.entryAllowed).toBe(true);
    expect(r.blockReasons.some((x) => x.includes('섹터 집중도'))).toBe(false);
  });

  it('KOSPI/KOSDAQ 시장구분 라벨도 집중도 차단 대상에서 제외', async () => {
    setup([
      { code: '000001', name: 'A', sector: 'KOSPI' },
      { code: '000002', name: 'B', sector: 'KOSPI' },
    ]);
    const r = await evaluatePortfolioRisk('KOSPI');
    expect(r.entryAllowed).toBe(true);
  });

  it('보유 1종목이 반도체(100%) — 단일 포지션 아티팩트이므로 차단하지 않음', async () => {
    setup([{ code: '000001', name: 'A', sector: '반도체' }]);
    const r = await evaluatePortfolioRisk('반도체');
    expect(r.entryAllowed).toBe(true);
    expect(r.blockReasons.some((x) => x.includes('섹터 집중도'))).toBe(false);
  });

  it('보유 2종목 모두 반도체(100%) — 진짜 산업 섹터 집중은 정상 차단', async () => {
    setup([
      { code: '000001', name: 'A', sector: '반도체' },
      { code: '000002', name: 'B', sector: '반도체' },
    ]);
    const r = await evaluatePortfolioRisk('반도체');
    expect(r.entryAllowed).toBe(false);
    expect(r.blockReasons.some((x) => x.includes('섹터 집중도 초과') && x.includes('반도체'))).toBe(true);
  });

  it('후보 섹터(바이오)가 0% — 다른 섹터 집중과 무관하게 진입 허용', async () => {
    setup([
      { code: '000001', name: 'A', sector: '반도체' },
      { code: '000002', name: 'B', sector: '반도체' },
    ]);
    const r = await evaluatePortfolioRisk('바이오');
    expect(r.entryAllowed).toBe(true);
  });

  it("'기타' 후보 섹터는 미분류 버킷이므로 차단하지 않음 (기존 동작 보존)", async () => {
    setup([
      { code: '000001', name: 'A', sector: '기타' },
      { code: '000002', name: 'B', sector: '기타' },
    ]);
    const r = await evaluatePortfolioRisk('기타');
    expect(r.entryAllowed).toBe(true);
  });

  it('우량기업부 3쌍 — 허위 분산 경보(상관) 발생하지 않음', async () => {
    setup([
      { code: '000001', name: 'A', sector: '우량기업부' },
      { code: '000002', name: 'B', sector: '우량기업부' },
      { code: '000003', name: 'C', sector: '우량기업부' },
    ]);
    const r = await evaluatePortfolioRisk();
    expect(r.warnings.some((x) => x.includes('허위 분산'))).toBe(false);
    expect(r.highCorrelationPairs.length).toBe(0);
  });

  it('반도체 3쌍 이상 — 진짜 산업 섹터 상관 경보는 정상 발생', async () => {
    setup([
      { code: '000001', name: 'A', sector: '반도체' },
      { code: '000002', name: 'B', sector: '반도체' },
      { code: '000003', name: 'C', sector: '반도체' },
    ]);
    const r = await evaluatePortfolioRisk();
    expect(r.highCorrelationPairs.length).toBeGreaterThanOrEqual(3);
    expect(r.warnings.some((x) => x.includes('허위 분산'))).toBe(true);
  });

  it('ENV PORTFOLIO_RISK_MARKET_SEGMENT_ENTRY_GUARD_DISABLED=true — PATCH-008 이전 동작 복원 (우량기업부 차단)', async () => {
    process.env.PORTFOLIO_RISK_MARKET_SEGMENT_ENTRY_GUARD_DISABLED = 'true';
    setup([{ code: '000001', name: 'A', sector: '우량기업부' }]);
    const r = await evaluatePortfolioRisk('우량기업부');
    expect(r.entryAllowed).toBe(false);
    expect(r.blockReasons.some((x) => x.includes('섹터 집중도 초과'))).toBe(true);
  });

  it('ENV 정확 비교 — "TRUE"/"1" 등은 가드 활성 유지 (ADR-0157)', async () => {
    process.env.PORTFOLIO_RISK_MARKET_SEGMENT_ENTRY_GUARD_DISABLED = 'TRUE';
    setup([{ code: '000001', name: 'A', sector: '우량기업부' }]);
    const r = await evaluatePortfolioRisk('우량기업부');
    expect(r.entryAllowed).toBe(true);
  });
});
