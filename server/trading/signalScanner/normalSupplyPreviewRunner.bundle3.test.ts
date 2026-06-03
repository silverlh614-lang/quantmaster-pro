/**
 * @responsibility ADR-0557 묶음3 차등 테스트 — flag OFF byte-equivalent(factory 미호출·기존
 * resolveMarketProgramFlow 경로) + flag ON 주입 정본 read(=직접호출 동일 출력) 두 분기 잠금.
 *
 * 검증 계약(ADR-0557 D3 Consumer Contract):
 *  (a) flag OFF → collectUnifiedSnapshot 미호출(신규 fetch 0) → runner 는 기존
 *      resolveMarketProgramFlow() fallback 사용 → persistNormalSupplyPreview 에 흐르는
 *      marketProgramFlow 가 직접호출 값과 동일 (byte-equivalent).
 *  (b) flag ON → collectUnifiedSnapshot 1회 호출 → 그 snapshot.marketProgram 이 정본으로
 *      read → fallback resolveMarketProgramFlow 미호출 → 동일 단일 함수 정본이므로 직접호출과 동일.
 *
 * 본 테스트는 runner 의 직접 의존성만 mock 하여 격리한다(deep tree 회피). golden master
 * (marketProgramFlowProvider.characterization.test.ts) 는 본 파일이 건드리지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketProgramFlowResult } from './marketProgramFlowProvider.js';

// ── runner 직접 의존성 mock (signalScanner/ 기준 상대 경로 = runner 와 동일 specifier) ──
const collectUnifiedSnapshotMock = vi.fn();
const resolveMarketProgramFlowMock = vi.fn();
const persistNormalSupplyPreviewMock = vi.fn();
const buildMarketProgramFlowCarryPayloadMock = vi.fn(() => ({ __legacyCarry: true }));

vi.mock('../symbolDataCollector.js', () => ({
  collectUnifiedSnapshot: collectUnifiedSnapshotMock,
}));
vi.mock('./marketProgramFlowProvider.js', () => ({
  resolveMarketProgramFlow: resolveMarketProgramFlowMock,
}));
vi.mock('../../state.js', () => ({
  getEmergencyStop: () => false,
  getManualBlockNewBuy: () => false,
  getManualManageOnly: () => false,
}));
vi.mock('../../persistence/macroStateRepo.js', () => ({
  loadMacroState: () => ({ regime: 'NORMAL', programSource: 'NONE' }),
}));
vi.mock('../../persistence/watchlistRepo.js', () => ({
  loadWatchlist: () => [{ code: '005930', section: 'SWING' }],
}));
vi.mock('../../replay/intradayProgramFlowSnapshotRepo.js', () => ({
  loadLatestIntradayProgramFlowSnapshot: () => null,
}));
vi.mock('./candidateSelect.js', () => ({
  selectCandidates: async () => ({ buyList: [{ code: '005930', section: 'SWING' }] }),
}));
vi.mock('./injectPerSymbolSupplyContext.js', () => ({
  createDefaultInvestorFlowRouter: () => ({}),
  injectPerSymbolSupplyContext: async () => ({
    candidates: [{ code: '005930', symbol: '005930' }],
    stats: {},
  }),
  // 실제 구현과 동치 — 6자리 코드 정규화 (factory 호출 심볼 추출용).
  normalizeSupplySymbol: (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const digits = value.replace(/[^0-9]/g, '');
    return digits.length >= 6 ? digits.slice(-6) : digits;
  },
}));
vi.mock('./marketProgramCarryWiringPolicy.js', () => ({
  buildMarketProgramFlowCarryPayload: buildMarketProgramFlowCarryPayloadMock,
}));
vi.mock('./perStockProgramFlowCarryWiringPolicy.js', () => ({
  isPerStockProgramFlowCarryWiringDisabled: () => true,
  buildPerStockProgramFlowCarryMap: () => new Map(),
}));
vi.mock('./sectorClassificationCarryWiringPolicy.js', () => ({
  isSectorClassificationCarryWiringDisabled: () => true,
  buildSectorClassificationCarryMap: () => new Map(),
}));
vi.mock('./normalSupplyPreview.js', () => ({
  deriveNormalSupplyPreviewEngineMode: () => 'NORMAL',
  persistNormalSupplyPreview: persistNormalSupplyPreviewMock,
}));

// 직접호출 정본(provider) vs 주입 정본(factory). 동일 단일 함수가 산출하므로 동일 객체여야 한다.
const CANON: MarketProgramFlowResult = {
  available: true,
  netBuyAmount: 4200,
  arbitrageNetBuyAmount: 1200,
  nonArbitrageNetBuyAmount: 3000,
  providerIssue: false,
  marketSignal: 'BULLISH',
  source: 'KIS_API',
} as unknown as MarketProgramFlowResult;

let originalFlag: string | undefined;

beforeEach(() => {
  originalFlag = process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
  collectUnifiedSnapshotMock.mockReset();
  resolveMarketProgramFlowMock.mockReset();
  persistNormalSupplyPreviewMock.mockReset();
  persistNormalSupplyPreviewMock.mockImplementation((args) => args);
  // 직접호출(fallback) 정본 = CANON. factory 주입 정본도 동일 CANON (동일 단일 함수).
  resolveMarketProgramFlowMock.mockResolvedValue(CANON);
  collectUnifiedSnapshotMock.mockResolvedValue({ marketProgram: CANON });
});

afterEach(() => {
  if (originalFlag === undefined) delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
  else process.env.USE_UNIFIED_SOURCE_SNAPSHOT = originalFlag;
  vi.restoreAllMocks();
});

describe('ADR-0557 묶음3 — normalSupplyPreviewRunner marketProgram threading (차등)', () => {
  it('(a) flag OFF → factory(collectUnifiedSnapshot) 미호출, 기존 resolveMarketProgramFlow fallback (byte-equivalent)', async () => {
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
    const { collectNormalSupplyPreviewFromWatchlist } = await import('./normalSupplyPreviewRunner.js');

    await collectNormalSupplyPreviewFromWatchlist({ reason: 'test-off' });

    // 신규 fetch 0 — factory 호출 자체가 일어나지 않아야 한다 (quota 순증 0).
    expect(collectUnifiedSnapshotMock).not.toHaveBeenCalled();
    // 기존 경로 보존 — read-site fallback 으로 resolveMarketProgramFlow 1회 호출.
    expect(resolveMarketProgramFlowMock).toHaveBeenCalledTimes(1);
    // 직접호출 값이 그대로 persist 로 흐른다 (legacy carry 로 대체되지 않음).
    expect(persistNormalSupplyPreviewMock).toHaveBeenCalledTimes(1);
    expect(persistNormalSupplyPreviewMock.mock.calls[0][0].marketProgramFlow).toBe(CANON);
    // legacy carry 는 fallback 정본이 present 이므로 사용되지 않는다.
    expect(buildMarketProgramFlowCarryPayloadMock).not.toHaveBeenCalled();
  });

  it('(b) flag ON → factory 1회 호출, snapshot.marketProgram 정본 read (=직접호출과 동일 출력)', async () => {
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';
    const { collectNormalSupplyPreviewFromWatchlist } = await import('./normalSupplyPreviewRunner.js');

    await collectNormalSupplyPreviewFromWatchlist({ reason: 'test-on' });

    // factory 1회 호출 — watchlist 후보 심볼(005930) 로 단일 호출.
    expect(collectUnifiedSnapshotMock).toHaveBeenCalledTimes(1);
    expect(collectUnifiedSnapshotMock.mock.calls[0][0]).toEqual(['005930']);
    // 정본 present → fallback resolveMarketProgramFlow 재호출 0 (quota 순증 0; 직접호출 1회를 대체).
    expect(resolveMarketProgramFlowMock).not.toHaveBeenCalled();
    // 주입 정본 = 직접호출 정본(동일 단일 함수) → flag ON 출력 불변.
    expect(persistNormalSupplyPreviewMock.mock.calls[0][0].marketProgramFlow).toBe(CANON);
    expect(buildMarketProgramFlowCarryPayloadMock).not.toHaveBeenCalled();
  });

  it('(c) 호출자 주입(C 인자) present → flag 무관, factory·fallback 모두 미호출', async () => {
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';
    const { collectNormalSupplyPreviewFromWatchlist } = await import('./normalSupplyPreviewRunner.js');

    await collectNormalSupplyPreviewFromWatchlist({
      reason: 'test-inject',
      marketProgram: CANON,
    });

    // 주입 정본이 있으면 factory(B)·fallback 둘 다 건너뛴다.
    expect(collectUnifiedSnapshotMock).not.toHaveBeenCalled();
    expect(resolveMarketProgramFlowMock).not.toHaveBeenCalled();
    expect(persistNormalSupplyPreviewMock.mock.calls[0][0].marketProgramFlow).toBe(CANON);
  });

  it('(d) flag ON factory throw → marketSignal 변환 없이 read-site fallback (불변식 #1/#6)', async () => {
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';
    collectUnifiedSnapshotMock.mockRejectedValueOnce(new Error('factory down'));
    const { collectNormalSupplyPreviewFromWatchlist } = await import('./normalSupplyPreviewRunner.js');

    await collectNormalSupplyPreviewFromWatchlist({ reason: 'test-throw' });

    // factory 장애 → throw 격리(불변식 #1) → 기존 resolveMarketProgramFlow fallback 위임.
    expect(collectUnifiedSnapshotMock).toHaveBeenCalledTimes(1);
    expect(resolveMarketProgramFlowMock).toHaveBeenCalledTimes(1);
    expect(persistNormalSupplyPreviewMock.mock.calls[0][0].marketProgramFlow).toBe(CANON);
  });
});
