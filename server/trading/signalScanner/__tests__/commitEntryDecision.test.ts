// @responsibility commitEntryDecision 회귀 테스트 — 인라인 commit 단계 byte-equivalent 추출 검증

import { describe, expect, it, beforeEach, vi } from 'vitest';

// 외부 의존성 mock — vi.mock 은 호이스팅되어 import 보다 먼저 실행된다.
vi.mock('../../../alerts/channelPipeline.js', () => ({
  channelBuySignalEmitted: vi.fn(async () => undefined),
}));
vi.mock('../../../learning/recommendationTracker.js', () => ({
  addRecommendation: vi.fn(),
}));
vi.mock('../../../learning/ledgerSimulator.js', () => ({
  recordUniverseEntries: vi.fn(() => []),
}));
vi.mock('../../trancheExecutor.js', () => ({
  trancheExecutor: {
    scheduleTranches: vi.fn(),
  },
}));
vi.mock('../../buyPipeline.js', () => ({
  buildBuyTrade: vi.fn((opts: { stockCode: string; stockName: string; idPrefix: string }) => ({
    id: `${opts.idPrefix}_test_${opts.stockCode}`,
    stockCode: opts.stockCode,
    stockName: opts.stockName,
    status: 'PENDING',
    quantity: 0,
  })),
  createBuyTask: vi.fn(async (params: { onApproved: (t: unknown) => Promise<void> }) => ({
    approvalPromise: Promise.resolve('APPROVE'),
    execute: vi.fn(async () => undefined),
    // 테스트가 onApproved 클로저 직접 호출 가능하도록 노출
    __onApproved: params.onApproved,
  })),
}));
vi.mock('../../entryEngine.js', () => ({
  formatStopLossBreakdown: vi.fn(() => '95,000원 (-5%)'),
}));
vi.mock('../scanDiagnostics.js', () => ({
  setLastBuySignalAt: vi.fn(),
}));
vi.mock('../approvalQueue/index.js', () => ({
  applyApprovalReservation: vi.fn(),
}));
vi.mock('../perSymbolEvaluation.js', () => ({
  getAdaptiveProfitTargets: vi.fn(() => ({
    targets: [
      { type: 'LIMIT', trigger: 0.05, ratio: 0.5 },
      { type: 'LIMIT', trigger: 0.10, ratio: 0.3 },
      { type: 'TRAILING', trailPct: 0.10, trigger: null, ratio: 0 },
    ],
    trailPctAdjust: 0,
    reason: 'macro:기본',
  })),
}));

import { commitEntryDecision, type CommitEntryDecisionInput } from '../commitEntryDecision.js';
import { channelBuySignalEmitted } from '../../../alerts/channelPipeline.js';
import { addRecommendation } from '../../../learning/recommendationTracker.js';
import { recordUniverseEntries } from '../../../learning/ledgerSimulator.js';
import { trancheExecutor } from '../../trancheExecutor.js';
import { createBuyTask } from '../../buyPipeline.js';
import { setLastBuySignalAt } from '../scanDiagnostics.js';
import { applyApprovalReservation } from '../approvalQueue/index.js';
import { getAdaptiveProfitTargets } from '../perSymbolEvaluation.js';
import type { LiveBuyTask } from '../../buyPipeline.js';
import type {
  BuyListLoopContext,
  BuyListLoopMutables,
} from '../perSymbolEvaluation.js';
import type { WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import type { ServerShadowTrade, EntryKellySnapshot } from '../../../persistence/shadowTradeRepo.js';
import type { ScanCounters } from '../scanDiagnostics.js';

function makeMutables(orderableCash = 100_000_000): BuyListLoopMutables {
  return {
    liveBuyQueue: [] as LiveBuyTask[],
    reservedSlots: { value: 0 },
    probingReservedSlots: { value: 0 },
    reservedTiers: [],
    reservedIsMomentum: [],
    reservedBudgets: [],
    reservedSectorValues: [],
    pendingSectorValue: new Map(),
    currentSectorValue: new Map(),
    orderableCash: { value: orderableCash },
    watchlistMutated: { value: false },
  };
}

function makeStock(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    code: '005930',
    name: '삼성전자',
    entryPrice: 100_000,
    stopLoss: 95_000,
    targetPrice: 120_000,
    addedAt: '2026-04-26T00:00:00Z',
    addedBy: 'AUTO',
    sector: '반도체',
    rrr: 4,
    conditionKeys: ['cond_1', 'cond_2'],
    profileType: 'B',
    section: 'SWING',
    ...overrides,
  };
}

function makeCounters(): ScanCounters {
  return {
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    counterfactualRecordedToday: 0,
    pendingTraces: [],
  };
}

function makeCtx(mutables: BuyListLoopMutables, scanCounters: ScanCounters, shadows: ServerShadowTrade[]): BuyListLoopContext {
  return {
    buyList: [] as WatchlistEntry[],
    swingList: [] as WatchlistEntry[],
    watchlist: [] as WatchlistEntry[],
    shadows,
    shadowMode: false,
    totalAssets: 100_000_000,
    effectiveMaxPositions: 5,
    regime: 'R2_BULL',
    regimeConfig: {} as never,
    macroState: null,
    vixGating: { kellyMultiplier: 1 },
    fomcProximity: { kellyMultiplier: 1 },
    kellyMultiplier: 1,
    accountKellyMultiplier: 1,
    banditDecision: { budget: 1, reason: 'test', actionableArm: null } as never,
    sellOnlyExc: { allow: false, minLiveGate: 0, minMtas: 0, kellyFactor: 1 },
    volumeClock: { allowEntry: true, scoreBonus: 0 },
    conditionWeights: {} as never,
    scanCounters,
    mutables,
  };
}

function makeKellySnapshot(): EntryKellySnapshot {
  return {
    tier: 'STANDARD',
    signalGrade: 'BUY',
    rawKellyMultiplier: 0.05,
    effectiveKelly: 0.04,
    fractionalCap: 0.25,
    ipsAtEntry: 1,
    regimeAtEntry: 'R2_BULL',
    accountRiskBudgetPctAtEntry: 0,
    confidenceModifier: 1,
    snapshotAt: '2026-04-26T00:00:00Z',
  };
}

function baseInput(overrides: Partial<CommitEntryDecisionInput> = {}): CommitEntryDecisionInput {
  const mut = makeMutables();
  const scanCounters = makeCounters();
  const shadows: ServerShadowTrade[] = [];
  return {
    ctx: makeCtx(mut, scanCounters, shadows),
    stock: makeStock(),
    stockShadowMode: false,
    isMomentumShadow: false,
    isStrongBuy: false,
    shadowEntryPrice: 100_000,
    currentPrice: 99_500,
    execQty: 10,
    quantity: 10,
    positionPct: 0.05,
    gateScore: 8,
    liveGateScore: 7.5,
    reCheckGate: { mtas: 8, compressionScore: 0.6 },
    effectiveBudget: 1_000_000,
    entryKellySnapshot: makeKellySnapshot(),
    grade: 'BUY',
    stopPolicy: {
      profile: 'B',
      profileKey: 'profileB',
      isCatalyst: false,
      regimeStopRate: -0.05,
      entryATR14: 1500,
      catalystFixedStop: 95_000,
      stopLossPlan: {
        hardStopLoss: 95_000,
        initialStopLoss: 95_000,
        regimeStopLoss: 95_000,
        atrStopLoss: 96_000,
      } as never,
    },
    tierDecision: { tier: 'STANDARD' },
    stageLog: { gate: 'PASS', rrr: 'PASS' },
    pushTrace: vi.fn(),
    ...overrides,
  };
}

describe('commitEntryDecision', () => {
  beforeEach(() => vi.clearAllMocks());

  it('LIVE BUY — addRecommendation + scanCounters.entries++ + queue.push + applyApprovalReservation 모두 byte-equivalent', async () => {
    const input = baseInput();
    await commitEntryDecision(input);

    expect(addRecommendation).toHaveBeenCalledOnce();
    const recCall = (addRecommendation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recCall.signalType).toBe('BUY');
    expect(recCall.gateScore).toBe(8);
    expect(recCall.kellyPct).toBe(5);
    expect(recCall.conditionKeys).toEqual(['cond_1', 'cond_2']);
    expect(recCall.entryRegime).toBe('R2_BULL');

    expect(input.ctx.scanCounters.entries).toBe(1);
    expect(setLastBuySignalAt).toHaveBeenCalledOnce();
    expect(input.stageLog.buy).toBe('LIVE');
    expect(input.pushTrace).toHaveBeenCalledOnce();
    expect(input.ctx.mutables.liveBuyQueue.length).toBe(1);

    expect(applyApprovalReservation).toHaveBeenCalledOnce();
    const apCall = (applyApprovalReservation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(apCall.tier).toBe('STANDARD');
    expect(apCall.effectiveBudget).toBe(1_000_000);
    expect(apCall.stockCode).toBe('005930');
    expect(apCall.isMomentumShadow).toBe(false);
  });

  it('LIVE STRONG_BUY — signalType=STRONG_BUY + alert "분할 1차" 라벨', async () => {
    const input = baseInput({ isStrongBuy: true, grade: 'STRONG_BUY', execQty: 5, quantity: 10 });
    await commitEntryDecision(input);

    const recCall = (addRecommendation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recCall.signalType).toBe('STRONG_BUY');

    const taskCall = (createBuyTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(taskCall.alertMessage).toContain('분할 1차');
    expect(taskCall.alertMessage).toContain('총10주');
  });

  it('SHADOW mode — stageLog.buy=SHADOW, logEvent=SIGNAL, alertMessage 모드 라벨 SHADOW', async () => {
    const input = baseInput({ stockShadowMode: true });
    await commitEntryDecision(input);
    expect(input.stageLog.buy).toBe('SHADOW');

    const taskCall = (createBuyTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(taskCall.logEvent).toBe('SIGNAL');
    expect(taskCall.shadowMode).toBe(true);
    expect(taskCall.alertMessage).toContain('Shadow');
    expect(taskCall.alertMessage).toContain('매수 신호');
  });

  it('MOMENTUM Shadow — idPrefix=srv_mom_shadow + logEvent=MOMENTUM_SHADOW_SIGNAL', async () => {
    const input = baseInput({ isMomentumShadow: true, stockShadowMode: true });
    await commitEntryDecision(input);

    const taskCall = (createBuyTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(taskCall.logEvent).toBe('MOMENTUM_SHADOW_SIGNAL');
    expect(taskCall.alertMessage).toContain('Shadow(학습)');
  });

  it('onApproved 클로저 호출 시 ctx.shadows.push + channelBuySignalEmitted + recordUniverseEntries 모두 발화', async () => {
    const input = baseInput();
    await commitEntryDecision(input);

    const taskCall = (createBuyTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as { onApproved: (t: unknown) => Promise<void> };
    const fakeTrade: ServerShadowTrade = { id: 'srv_test', stockCode: '005930' } as never;
    await taskCall.onApproved(fakeTrade);

    expect(input.ctx.shadows).toContain(fakeTrade);
    expect(channelBuySignalEmitted).toHaveBeenCalledOnce();
    const channelCall = (channelBuySignalEmitted as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(channelCall.mode).toBe('LIVE');
    expect(channelCall.stockCode).toBe('005930');
    expect(channelCall.rrr).toBe(4);
    expect(channelCall.signalType).toBe('BUY');

    expect(recordUniverseEntries).toHaveBeenCalledOnce();
    const ledgerCall = (recordUniverseEntries as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ledgerCall.signalGrade).toBe('BUY');
    expect(ledgerCall.regime).toBe('R2_BULL');
  });

  it('STRONG_BUY + quantity > 1 + LIVE → trancheExecutor.scheduleTranches 호출', async () => {
    const input = baseInput({ isStrongBuy: true, grade: 'STRONG_BUY', execQty: 5, quantity: 10 });
    await commitEntryDecision(input);

    const taskCall = (createBuyTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as { onApproved: (t: unknown) => Promise<void> };
    const fakeTrade: ServerShadowTrade = { id: 'srv_test', stockCode: '005930' } as never;
    await taskCall.onApproved(fakeTrade);

    expect(trancheExecutor.scheduleTranches).toHaveBeenCalledTimes(1);
    const sched = (trancheExecutor.scheduleTranches as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sched.parentTradeId).toBe('srv_test');
    expect(sched.totalQuantity).toBe(10);
    expect(sched.firstQuantity).toBe(5);
  });

  it('MOMENTUM Shadow → STRONG_BUY 여도 trancheExecutor 미호출 (학습 격리)', async () => {
    const input = baseInput({
      isStrongBuy: true, grade: 'STRONG_BUY', execQty: 5, quantity: 10,
      isMomentumShadow: true, stockShadowMode: true,
    });
    await commitEntryDecision(input);

    const taskCallMs = (createBuyTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as { onApproved: (t: unknown) => Promise<void> };
    const fakeTrade: ServerShadowTrade = { id: 'srv_mom_shadow_test', stockCode: '005930' } as never;
    await taskCallMs.onApproved(fakeTrade);

    expect(trancheExecutor.scheduleTranches).not.toHaveBeenCalled();
  });

  it('PROBING tier → applyApprovalReservation 의 tier=PROBING', async () => {
    const input = baseInput({ tierDecision: { tier: 'PROBING' } });
    await commitEntryDecision(input);

    const apCall = (applyApprovalReservation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(apCall.tier).toBe('PROBING');
  });

  it('CATALYST 섹션 — symbolProfile.profileType=CATALYST 로 getAdaptiveProfitTargets 호출', async () => {
    const input = baseInput({
      stopPolicy: { ...baseInput().stopPolicy, isCatalyst: true },
    });
    await commitEntryDecision(input);

    const ctxCall = (getAdaptiveProfitTargets as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ctxCall[2].profileType).toBe('CATALYST');
  });

  it('MOMENTUM 섹션 / profileType=A → symbolProfile.profileType=LEADER', async () => {
    const input = baseInput({
      stock: makeStock({ section: 'MOMENTUM' }),
    });
    await commitEntryDecision(input);

    const ctxCall = (getAdaptiveProfitTargets as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ctxCall[2].profileType).toBe('LEADER');
  });

  it('alertMessage gateLabel 정합성 — Gate/MTAS/CS 포맷 byte-equivalent', async () => {
    const input = baseInput({
      liveGateScore: 7.5,
      reCheckGate: { mtas: 8, compressionScore: 0.6 },
    });
    await commitEntryDecision(input);

    const taskCall = (createBuyTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(taskCall.alertMessage).toContain('Gate 7.5 | MTAS 8/10 | CS 0.60');
    expect(taskCall.alertMessage).toContain('손절: 95,000원 (-5%)');
    expect(taskCall.alertMessage).toContain('목표: 120,000원');
  });

  it('recordUniverseEntries throw → console.warn 만, exit 차단 안 함', async () => {
    (recordUniverseEntries as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('ledger 실패');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const input = baseInput();
    await commitEntryDecision(input);

    const taskCallW = (createBuyTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as { onApproved: (t: unknown) => Promise<void> };
    const fakeTrade: ServerShadowTrade = { id: 'srv_test', stockCode: '005930' } as never;
    await expect(taskCallW.onApproved(fakeTrade)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
