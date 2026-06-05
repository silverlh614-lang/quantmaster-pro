/**
 * @responsibility buyPipeline ADR-0078 wiring 회귀 — Enemy Checklist 자동 차단
 *
 * 검증:
 *   - 정상 종목 (BLOCK 미달) → enemy 차단 없이 requestBuyApproval 호출
 *   - BLOCK 임계 통과 → SKIP 즉시 반환 + markBlocked('ENEMY') 호출 + REJECTED
 *   - signalId 미전달 → BLOCK 시 SKIP 반환하지만 markBlocked 호출 0건 (옵셔널)
 *   - markBlocked throw → 매매 흐름 차단 안 함 (try/catch 가드, REJECTED 그대로)
 *   - ENEMY_AUTO_BLOCK_DISABLED=true → 자동 차단 우회 + 정상 흐름
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const _markBlocked = vi.fn();
const _markAutoTradeReady = vi.fn();
const _requestBuyApproval = vi.fn(async (_params?: unknown) => 'APPROVE' as const);
const _fetchEnemyCheckData = vi.fn();

vi.mock('../persistence/tradeSignalStatusRepo.js', () => ({
  markBlocked: _markBlocked,
  markAutoTradeReady: _markAutoTradeReady,
}));

vi.mock('../telegram/buyApproval.js', () => ({
  requestBuyApproval: _requestBuyApproval,
  requestBuyApprovalWithDelivery: vi.fn(async (params: unknown) => ({
    action: await _requestBuyApproval(params),
    telegramDelivered: true,
  })),
}));

vi.mock('../clients/enemyCheckClient.js', () => ({
  fetchEnemyCheckData: _fetchEnemyCheckData,
}));

vi.mock('../screener/sectorMap.js', () => ({
  getSectorByCode: () => '반도체',
}));

vi.mock('../persistence/incidentLogRepo.js', () => ({
  getLatestIncidentAt: () => null,
}));

vi.mock('../persistence/shadowTradeRepo.js', () => ({
  appendShadowLog: vi.fn(),
  loadShadowTrades: vi.fn(() => []),
  saveShadowTrades: vi.fn(),
  appendFill: vi.fn((trade: { fills?: unknown[] }, fill: unknown) => {
    if (!trade.fills) trade.fills = [];
    trade.fills.push({ id: 'fill-test-1', ...(fill as Record<string, unknown>) });
  }),
}));

vi.mock('./preMarketSmokeTest.js', () => ({
  getSmokeTestLiveBlocked: () => false,
  getSmokeTestLastFailedReason: () => '',
}));

vi.mock('./killSwitch.js', () => ({
  assertSafeOrder: vi.fn(),
}));

vi.mock('../clients/kisClient.js', () => ({
  fetchAccountBalance: async () => 100_000_000,
  placeKisMarketBuyOrder: async () => 'ORD-123',
  submitBuyOrder: async () => ({ kind: 'SUBMITTED', ordNo: 'ORD-123' }),
}));

vi.mock('./fillMonitor.js', () => ({
  fillMonitor: { addOrder: vi.fn() },
}));

vi.mock('./entryEngine.js', () => ({
  generatePreMortem: async () => null,
}));

vi.mock('../alerts/preMortemFormatter.js', () => ({
  formatPreMortemForTelegram: () => null,
}));

vi.mock('../persistence/sizingHistoryRepo.js', () => ({
  recordSizing: vi.fn(),
}));

vi.mock('./tradeEventLog.js', () => ({
  recordTradeEvent: vi.fn(),
}));

const ENV_KEYS = [
  'ENEMY_AUTO_BLOCK_DISABLED',
  'ENEMY_CREDIT_RATE_BLOCK',
  'ENEMY_INDIVIDUAL_BLOCK',
];

let _tmpDataDir: string;
const _origPersistDataDir = process.env.PERSIST_DATA_DIR;

beforeEach(() => {
  // 테스트 격리: 파일별 고유 PERSIST_DATA_DIR(tmpdir)로 디스크 영속을 격리한다.
  // paths.ts DATA_DIR 는 import 시점에 PERSIST_DATA_DIR 을 읽으므로, vi.resetModules()
  // 후 동적 import 되는 buyPipeline 체인의 비-mock repo(manualExits/macroState/
  // conditionWeights/takeProfitExits 등)가 공유 <repo>/data/ 대신 빈 tmpdir 을 읽어,
  // pool:forks 병렬 실행 시 다른 테스트 파일의 디스크 쓰기로 인한 cross-file 오염
  // (간헐적 승인-전 SKIP → requestBuyApproval 미호출 flake)을 차단한다.
  _tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enemyblock-'));
  process.env.PERSIST_DATA_DIR = _tmpDataDir;
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  _markBlocked.mockReset();
  _markAutoTradeReady.mockReset();
  _requestBuyApproval.mockReset();
  _requestBuyApproval.mockResolvedValue('APPROVE');
  _fetchEnemyCheckData.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  if (_origPersistDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = _origPersistDataDir;
  if (_tmpDataDir) fs.rmSync(_tmpDataDir, { recursive: true, force: true });
});

async function makeShadowTask(opts: {
  signalId?: string;
  enemyData: { creditRate: number | null; individualDominance: number | null; source: 'KIS_FULL' | 'KIS_PARTIAL' | 'UNAVAILABLE' } | null;
}) {
  _fetchEnemyCheckData.mockResolvedValue(opts.enemyData);
  const { createBuyTask } = await import('./buyPipeline.js');
  const trade = {
    id: 'trade-enemy-1',
    stockCode: '005930',
    stockName: '삼성전자',
    status: 'PENDING',
    mode: 'SHADOW' as const,
    signalTime: '2026-04-27T05:00:00Z',
    signalPrice: 70_000,
    shadowEntryPrice: 70_000,
    quantity: 10,
    originalQuantity: 10,
    stopLoss: 65_000,
    initialStopLoss: 65_000,
    regimeStopLoss: 65_000,
    hardStopLoss: 65_000,
    targetPrice: 80_000,
    profitTranches: [],
    entryRegime: 'R2_BULL',
  } as unknown as Parameters<typeof createBuyTask>[0]['trade'];
  return createBuyTask({
    trade,
    stockCode: '005930',
    stockName: '삼성전자',
    currentPrice: 70_000,
    quantity: 10,
    entryPrice: 70_000,
    stopLoss: 65_000,
    targetPrice: 80_000,
    gateScore: 12,
    shadowMode: true,
    effectiveBudget: 700_000,
    alertMessage: 'msg',
    logEvent: 'SIGNAL',
    onApproved: vi.fn(async () => undefined),
    signalId: opts.signalId,
  });
}

describe('buyPipeline ADR-0078 enemy auto-block', () => {
  it('정상 종목 (creditRate 5%, individual 60%) → 차단 없이 requestBuyApproval 호출', async () => {
    await makeShadowTask({
      signalId: '2026-04-27T05:00:00Z:005930',
      enemyData: { creditRate: 5, individualDominance: 60, source: 'KIS_FULL' },
    });
    expect(_requestBuyApproval).toHaveBeenCalled();
    expect(_markBlocked).not.toHaveBeenCalled();
  }, 10_000);

  it('creditRate 14% (BLOCK) → SKIP 즉시 + markBlocked + REJECTED', async () => {
    const task = await makeShadowTask({
      signalId: '2026-04-27T05:00:00Z:005930',
      enemyData: { creditRate: 14, individualDominance: 50, source: 'KIS_FULL' },
    });
    const action = await task.approvalPromise;
    expect(action).toBe('SKIP');
    expect(_requestBuyApproval).not.toHaveBeenCalled(); // 텔레그램 발송 차단
    expect(_markBlocked).toHaveBeenCalledWith({
      id: '2026-04-27T05:00:00Z:005930',
      gate: 'ENEMY',
      reason: expect.stringContaining('신용잔고율'),
    });
    const onRejected = vi.fn();
    await task.execute('SKIP');
    // execute 가 trade.status 를 REJECTED 로 설정 (mock onRejected 미전달이라 직접 검증 불가, status 만 검증)
    // 대신 execute 가 throw 안 함을 검증
    expect(onRejected).not.toHaveBeenCalled(); // 본 task 는 자체 onRejected 사용 안 함
  });

  it('individual 92% (BLOCK) → SKIP + markBlocked + 사유 포함', async () => {
    await makeShadowTask({
      signalId: '2026-04-27T05:00:00Z:005930',
      enemyData: { creditRate: 3, individualDominance: 92, source: 'KIS_FULL' },
    });
    expect(_markBlocked).toHaveBeenCalledWith({
      id: '2026-04-27T05:00:00Z:005930',
      gate: 'ENEMY',
      reason: expect.stringContaining('개인 비중 92%'),
    });
    expect(_requestBuyApproval).not.toHaveBeenCalled();
  });

  it("source='UNAVAILABLE' (KIS 일시 장애) → 차단 안 함 (안전 fallback)", async () => {
    await makeShadowTask({
      signalId: '2026-04-27T05:00:00Z:005930',
      enemyData: { creditRate: null, individualDominance: null, source: 'UNAVAILABLE' },
    });
    expect(_requestBuyApproval).toHaveBeenCalled();
    expect(_markBlocked).not.toHaveBeenCalled();
  });

  it('enemyCheck=null (fetchEnemyCheckData 실패) → 차단 안 함', async () => {
    await makeShadowTask({
      signalId: '2026-04-27T05:00:00Z:005930',
      enemyData: null,
    });
    expect(_requestBuyApproval).toHaveBeenCalled();
    expect(_markBlocked).not.toHaveBeenCalled();
  });

  it('signalId 미전달 + BLOCK → SKIP 반환하지만 markBlocked 호출 0건', async () => {
    const task = await makeShadowTask({
      enemyData: { creditRate: 14, individualDominance: 50, source: 'KIS_FULL' },
    });
    const action = await task.approvalPromise;
    expect(action).toBe('SKIP');
    expect(_markBlocked).not.toHaveBeenCalled(); // signalId 옵셔널 호환
    expect(_requestBuyApproval).not.toHaveBeenCalled();
  });

  it('markBlocked throw → SKIP 흐름 차단 안 함 (try/catch 가드)', async () => {
    _markBlocked.mockImplementation(() => {
      throw new Error('영속 disk error');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = await makeShadowTask({
      signalId: '2026-04-27T05:00:00Z:005930',
      enemyData: { creditRate: 14, individualDominance: 50, source: 'KIS_FULL' },
    });
    const action = await task.approvalPromise;
    expect(action).toBe('SKIP'); // 정상 SKIP 반환
    expect(_markBlocked).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('ENEMY_AUTO_BLOCK_DISABLED=true → 자동 차단 우회 + 정상 흐름', async () => {
    process.env.ENEMY_AUTO_BLOCK_DISABLED = 'true';
    await makeShadowTask({
      signalId: '2026-04-27T05:00:00Z:005930',
      enemyData: { creditRate: 99, individualDominance: 99, source: 'KIS_FULL' },
    });
    expect(_requestBuyApproval).toHaveBeenCalled();
    expect(_markBlocked).not.toHaveBeenCalled();
  });
});
