/**
 * @responsibility #8 회귀 — macro live-block 만 SHADOW 승격(task 생성·fill), per-symbol 비-macro 차단은 의도적 SKIP 고정.
 *
 * 의도(미래 회귀 방지): macro 차단(R4/R5/VIX/FOMC) 시에만 SHADOW 로 승격되어 shadow task 가 생성·체결된다.
 * per-symbol 단독(비-macro) live-block 은 createBuyTask 를 만들지 않고 'SKIP' 한다 (전부 shadow 승격 아님).
 * 이는 P3-1 (onApproved fill 재호출 제거) 와 독립 — block 분기는 task 생성 이전 단계다.
 *   T1: macro-only(macroDiagnosticLiveBlock=true) → createBuyTask 1회 + shadowMode=true.
 *   T2: per-symbol 비-macro(diagnosticLiveBlockReason set, macroDiagnosticLiveBlock=false)
 *       → 'SKIP' + suppressDiagnosticLiveBuyTask 1회 + createBuyTask 0회.
 *   T3: macro-only 승격이 의도임을 본 주석/테스트 설명으로 고정.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerShadowTrade } from '../../../../persistence/shadowTradeRepo.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import type { BuyListLoopContext } from '../types.js';
import type { HandleApprovalQueueInput } from './approvalQueue.js';

// createBuyTask 를 spy 로 mock — block 분기(SKIP vs task 생성)만 검증.
// 실 fill(executeShadowBuy=1회) 은 shadowExecSinglePathFillOnce.test 가 별도 봉인.
const _createBuyTask = vi.fn(async (_p: unknown) => ({
  approvalPromise: Promise.resolve('SKIP'),
  execute: vi.fn(async () => undefined),
}));
vi.mock('../../../buyPipeline.js', () => ({ createBuyTask: _createBuyTask }));

vi.mock('../../../../alerts/channelPipeline.js', () => ({
  channelBuySignalEmitted: vi.fn(async () => undefined),
}));
vi.mock('../../../../learning/ledgerSimulator.js', () => ({ recordUniverseEntries: vi.fn() }));
vi.mock('../../../trancheExecutor.js', () => ({
  trancheExecutor: { scheduleTranches: vi.fn() },
}));
vi.mock('../../scanDiagnostics.js', () => ({ setLastBuySignalAt: vi.fn() }));
vi.mock('../../approvalQueue/index.js', () => ({ applyApprovalReservation: vi.fn() }));
vi.mock('../../../gateConfig.js', () => ({
  getRegimeGateBand: () => ({ strong: 12, normal: 9 }),
}));
vi.mock('../../../entryEngine.js', () => ({
  formatStopLossBreakdown: () => '65,000원',
}));
vi.mock('../../../../persistence/tradeSignalStatusRepo.js', () => ({
  buildSignalId: (t: string, c: string) => `${t}:${c}`,
}));

function makeStock(): WatchlistEntry {
  return {
    code: '005930',
    name: '삼성전자',
    targetPrice: 80_000,
    rrr: 2.0,
    sector: '반도체',
    gateLayerSummary: undefined,
  } as unknown as WatchlistEntry;
}

function makeCtx(): BuyListLoopContext {
  return {
    regime: 'R2_BULL',
    shadows: [] as ServerShadowTrade[],
    scanCounters: { entries: 0, pendingTraces: [] } as unknown as BuyListLoopContext['scanCounters'],
    mutables: {
      liveBuyQueue: [],
      reservedSlots: { value: 0 },
      reservedTiers: [],
      reservedBudgets: [],
      reservedSectorValues: [],
      pendingSectorValue: new Map(),
      currentSectorValue: new Map(),
      orderableCash: { value: 10_000_000 },
      watchlistMutated: { value: false },
    } as unknown as BuyListLoopContext['mutables'],
  } as unknown as BuyListLoopContext;
}

function makeInput(over: Partial<HandleApprovalQueueInput>): HandleApprovalQueueInput {
  const ctx = over.ctx ?? makeCtx();
  const trade = {
    id: 'trade-1', stockCode: '005930', stockName: '삼성전자', status: 'PENDING',
    mode: 'SHADOW', quantity: 10, shadowEntryPrice: 70_000, targetPrice: 80_000,
  } as unknown as ServerShadowTrade;
  return {
    ctx,
    stock: makeStock(),
    currentPrice: 70_000,
    stockShadowMode: true,
    isMomentumShadow: false,
    isFinalStrongBuy: false,
    execQty: 10,
    supplyAdjustedFinalQuantity: 10,
    effectiveBudgetAfterHealth: 700_000,
    trade,
    shadowEntryPrice: 70_000,
    stopLossPlan: { hardStopLoss: 65_000 } as unknown as HandleApprovalQueueInput['stopLossPlan'],
    gateScore: 12,
    liveGateScore: 12,
    reCheckGate: {
      mtas: 8, compressionScore: 0.5, availableMaxScore: 27,
    } as unknown as HandleApprovalQueueInput['reCheckGate'],
    finalSignalLevel: 'BUY' as unknown as HandleApprovalQueueInput['finalSignalLevel'],
    shadowApprovalCtx: { tradeDate: '2026-05-25', marketSession: 'REGULAR' },
    diagnosticLiveBlockReason: undefined,
    macroDiagnosticLiveBlock: false,
    stageLog: {},
    pushTrace: vi.fn(),
    grade: 'A' as unknown as HandleApprovalQueueInput['grade'],
    tierDecision: { tier: 'CORE' } as unknown as HandleApprovalQueueInput['tierDecision'],
    signalTimeMain: '2026-05-25T05:00:00Z',
    suppressDiagnosticLiveBuyTask: vi.fn(),
    ...over,
  };
}

describe('#8 macro-only SHADOW 승격 회귀 (per-symbol 비-macro 는 의도적 SKIP)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    _createBuyTask.mockImplementation(async () => ({
      approvalPromise: Promise.resolve('SKIP'),
      execute: vi.fn(async () => undefined),
    }));
  });

  it('T1 macro-only live-block(R4/R5/VIX/FOMC) → createBuyTask 1회 + shadowMode=true (SHADOW 승격)', async () => {
    const { handleApprovalQueue } = await import('./approvalQueue.js');
    const input = makeInput({
      // loopInitializer 가 macro 차단 시 stockShadowMode=true 강제 + macroDiagnosticLiveBlock=true 전달.
      stockShadowMode: true,
      diagnosticLiveBlockReason: 'R4_NEUTRAL',
      macroDiagnosticLiveBlock: true,
    });
    const result = await handleApprovalQueue(input);

    expect(result).toBe('CONTINUE');
    expect(_createBuyTask).toHaveBeenCalledTimes(1);
    expect(_createBuyTask).toHaveBeenCalledWith(
      expect.objectContaining({ shadowMode: true, sourceLane: 'SHADOW' }),
    );
    expect(input.suppressDiagnosticLiveBuyTask).not.toHaveBeenCalled();
  });

  it('T2 per-symbol 비-macro live-block → SKIP + suppress 1회 + createBuyTask 0회 (의도된 SKIP)', async () => {
    const { handleApprovalQueue } = await import('./approvalQueue.js');
    const input = makeInput({
      stockShadowMode: false,
      diagnosticLiveBlockReason: 'SELF_HOLDING', // 비-macro 사유
      macroDiagnosticLiveBlock: false,
    });
    const result = await handleApprovalQueue(input);

    expect(result).toBe('SKIP');
    expect(input.suppressDiagnosticLiveBuyTask).toHaveBeenCalledTimes(1);
    expect(input.suppressDiagnosticLiveBuyTask).toHaveBeenCalledWith(
      input.ctx, input.stock, 'SELF_HOLDING',
    );
    expect(_createBuyTask).not.toHaveBeenCalled();
  });

  it('T3 (의도 고정) 비차단 정상 SHADOW → createBuyTask 1회 (block 분기와 독립적 baseline)', async () => {
    const { handleApprovalQueue } = await import('./approvalQueue.js');
    const input = makeInput({
      stockShadowMode: true,
      diagnosticLiveBlockReason: undefined,
      macroDiagnosticLiveBlock: false,
    });
    const result = await handleApprovalQueue(input);

    expect(result).toBe('CONTINUE');
    expect(_createBuyTask).toHaveBeenCalledTimes(1);
    expect(input.suppressDiagnosticLiveBuyTask).not.toHaveBeenCalled();
  });
});
