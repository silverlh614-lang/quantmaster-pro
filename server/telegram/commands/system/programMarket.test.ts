/**
 * @responsibility programMarket.cmd 회귀 테스트 — ADR-0138
 *
 * 검증:
 *   - buildProgramMarketMessage: KIS 정상/null + macroState 비교 진단 분기
 *   - cmd execute: 정상 / throw graceful
 *   - 메타데이터: name + aliases (/prog_market, /pm) + category=SYS + riskLevel=0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _fetchKisMarketProgramTrade = vi.fn();
const _loadMacroState = vi.fn();
const _captureProgramFlowSnapshot = vi.fn();

vi.mock('../../../clients/kisClient/index.js', () => ({
  fetchKisMarketProgramTrade: _fetchKisMarketProgramTrade,
}));

vi.mock('../../../persistence/macroStateRepo.js', () => ({
  loadMacroState: _loadMacroState,
}));

vi.mock('../../../replay/intradayProgramFlowSnapshotRepo.js', () => ({
  captureLatestIntradayProgramFlowSnapshotFromRuntimeContext: _captureProgramFlowSnapshot,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let programMarket: typeof import('./programMarket.cmd.js').default;
let buildProgramMarketMessage: typeof import('./programMarket.cmd.js').buildProgramMarketMessage;

beforeEach(async () => {
  vi.resetModules();
  _fetchKisMarketProgramTrade.mockReset();
  _loadMacroState.mockReset();
  _captureProgramFlowSnapshot.mockReset();
  const mod = await import('./programMarket.cmd.js');
  programMarket = mod.default;
  buildProgramMarketMessage = mod.buildProgramMarketMessage;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildProgramMarketMessage', () => {
  it('KIS 정상 양수 + macroState KIS_API → 실시간 + 영속 둘 다 표기', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue({
      programNetBuyQty: 50000,
      programNetBuyAmount: 5_000_000_000,
      programArbitrageNetBuy: 1_000_000_000,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    _loadMacroState.mockReturnValue({
      mhs: 70, regime: 'GREEN', updatedAt: '2026-05-01T01:00:00.000Z',
      programNetBuyAmount: 45.0,  // 억원 단위 영속
      programArbitrageNetBuy: 9.5,
      programFetchedAt: '2026-05-01T00:30:00.000Z',
      programSource: 'KIS_API',
    });
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('실시간 (KIS 직접 호출)');
    expect(msg).toContain('🟢');
    expect(msg).toContain('시장 프로그램 방향 후보: 순매수');
    expect(msg).toContain('+50.00억원');
    expect(msg).toContain('+10.00억원');  // 차익 1_000_000_000원 = 10억원
    expect(msg).toContain('macroState 영속');
    expect(msg).toContain('+45.0억원');  // 영속값
    expect(msg).toContain('+9.5억원');  // 영속 차익
  });

  it('KIS 정상 음수 (시장 프로그램 순매도) → 🔴', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue({
      programNetBuyQty: -80000,
      programNetBuyAmount: -7_500_000_000,
      programArbitrageNetBuy: -2_000_000_000,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    _loadMacroState.mockReturnValue(null);
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('🟡');
    expect(msg).toContain('시장 프로그램 방향 후보: 순매도');
    expect(msg).toContain('-75.00억원');
    expect(msg).toContain('-20.00억원');
  });

  it('KIS 정상 0 → ⚪ + 중립', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue({
      programNetBuyQty: 0,
      programNetBuyAmount: 0,
      programArbitrageNetBuy: 0,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    _loadMacroState.mockReturnValue(null);
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('⚪');
    expect(msg).toContain('중립');
    expect(msg).toContain('0억원');
  });

  it('KIS 차익 null → 미수집 표기', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue({
      programNetBuyQty: 10000,
      programNetBuyAmount: 1_000_000_000,
      programArbitrageNetBuy: null,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    _loadMacroState.mockReturnValue(null);
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('미수집');
    expect(msg).toContain('KIS 응답 부재');
  });

  it('KIS null 응답 → 운영자 안내 4종 (KIS_APP_KEY/회로/TR ID/Path)', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue(null);
    _loadMacroState.mockReturnValue(null);
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('KIS 실시간 조회 실패');
    expect(msg).toContain('운영자 안내');
    expect(msg).toContain('KIS_APP_KEY');
    expect(msg).toContain('회로차단');
    expect(msg).toContain('KIS_MARKET_PROGRAM_TRADE_TR_ID');
    expect(msg).toContain('KIS_MARKET_PROGRAM_TRADE_PATH');
  });

  it('macroState programSource=NONE → 마지막 cron 실패 안내', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue(null);
    _loadMacroState.mockReturnValue({
      mhs: 50, regime: 'YELLOW', updatedAt: '2026-05-01T01:00:00.000Z',
      programSource: 'NONE',
    });
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('마지막 cron 사이클 KIS 호출 실패');
  });

  it('macroState programSource 부재 → 미수집 안내', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue(null);
    _loadMacroState.mockReturnValue({ mhs: 50, regime: 'GREEN', updatedAt: '2026-05-01T00:00Z' });
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('미수집');
    expect(msg).toContain('cron 1회 미실행 또는 KIS 미연동');
  });

  it('영속 차익 null → 미수집 표기', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue({
      programNetBuyQty: 10000,
      programNetBuyAmount: 1_000_000_000,
      programArbitrageNetBuy: 500_000_000,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    _loadMacroState.mockReturnValue({
      mhs: 70, regime: 'GREEN', updatedAt: '2026-05-01T01:00:00.000Z',
      programNetBuyAmount: 10.0,
      programArbitrageNetBuy: null,  // 영속 차익 null
      programFetchedAt: '2026-05-01T00:30:00.000Z',
      programSource: 'KIS_API',
    });
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('미수집');
  });
});


  it('macroState summary는 display 값을 그대로 사용 (raw non-zero/0.01억원 미만 보존)', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue(null);
    _loadMacroState.mockReturnValue({
      programSource: 'KIS_API',
      programNetBuyAmount: 0,
      programArbitrageNetBuy: 0,
      programMarket: {
        raw: { wholeNetBuyTradeAmount: -1687944, arbitrageNetBuyTradeAmount: 46866, nonArbitrageNetBuyTradeAmount: -1734809 },
        display: { wholeNetBuy: '-27.73억원', arbitrageNetBuy: '+0.86억원', nonArbitrageNetBuy: '-28.59억원' },
        unit: { rawUnitAssumption: 'KRW_1K', mappingConfidence: 'MAPPING_VERIFIED' },
        unitCandidates: { KRW: '-0.03억원', KRW_1K: '-27.73억원', KRW_1M: '-27731.13억원' },
      },
    });
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('• 순매수: -27.73억원');
    expect(msg).toContain('• 차익: +0.86억원');
    expect(msg).toContain('• 비차익: -28.59억원');
    expect(msg).not.toContain('• 순매수: 0억원');
    expect(msg).toContain('단위: 천원 기준 확정');
    expect(msg).toContain('표시: 억원 환산');
  });

  it('일반 화면 selectedNetBuy/direction은 combined.displayWholeNetBuy를 우선 사용한다', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue({
      programNetBuyQty: -2848179,
      programNetBuyAmount: -2_848_179,
      programArbitrageNetBuy: 102_000,
      programNonArbitrageNetBuy: -2_950_179,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    _loadMacroState.mockReturnValue({
      programSource: 'KIS_API',
      programMarket: {
        finalStatus: 'MAPPING_VERIFIED',
        combinedSource: 'KOSPI_PLUS_KOSDAQ',
        unit: { rawUnitAssumption: 'KRW_1K', mappingConfidence: 'MAPPING_VERIFIED' },
        rowBreakdown: { combined: { displayWholeNetBuy: '-28.48억원', outputLength: 30, nonZeroRows: 30 } },
        display: { wholeNetBuy: '-28.48억원', arbitrageNetBuy: '+1.02억원', nonArbitrageNetBuy: '-29.51억원' },
      },
    });
    const msg = await buildProgramMarketMessage();
    expect(msg).toContain('시장 프로그램 순매도: -28.48억원');
    expect(msg).toContain('selectedNetBuy: -28.48억원');
    expect(msg).toContain('📈 차익거래 순매수: +1.02억원');
    expect(msg).toContain('비차익 순매수: -29.51억원');
    expect(msg).not.toContain('selectedNetBuy: -0.03억원');
    expect(msg).not.toContain('UNIT_UNVERIFIED');
    expect(msg).toContain('useForExecution: false');
    expect(msg).toContain('executionImpact: NONE');
  });
describe('programMarket.cmd execute', () => {
  it('정상 실행 시 reply 한 번 호출 + 헤더 포함', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue({
      programNetBuyQty: 1000,
      programNetBuyAmount: 100_000_000,
      programArbitrageNetBuy: 50_000_000,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    _loadMacroState.mockReturnValue(null);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await programMarket.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect((reply.mock.calls[0]?.[0] ?? '') as string).toContain('시장 종합 프로그램 매매');
  });

  it('fetchKisMarketProgramTrade throw 시 ❌ 실패 응답', async () => {
    _fetchKisMarketProgramTrade.mockRejectedValue(new Error('KIS 회로차단'));
    _loadMacroState.mockReturnValue(null);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await programMarket.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0]?.[0] ?? '') as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('진단 실패');
  });

  it('args 무시 — 인자 무관 동작', async () => {
    _fetchKisMarketProgramTrade.mockResolvedValue(null);
    _loadMacroState.mockReturnValue(null);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await programMarket.execute({ args: ['random'], reply });
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

describe('programMarket 메타데이터', () => {
  it('name=/program_market + alias=/prog_market + /pm', () => {
    expect(programMarket.name).toBe('/program_market');
    expect(programMarket.aliases).toEqual(['/prog_market', '/pm']);
  });

  it('category=SYS + riskLevel=0 (read-only KIS 1회) + visibility=ADMIN', () => {
    expect(programMarket.category).toBe('SYS');
    expect(programMarket.riskLevel).toBe(0);
    expect(programMarket.visibility).toBe('ADMIN');
  });

  it('description + usage 비어있지 않음', () => {
    expect(programMarket.description.length).toBeGreaterThan(10);
    expect(programMarket.usage).toBe('/program_market');
  });
});
