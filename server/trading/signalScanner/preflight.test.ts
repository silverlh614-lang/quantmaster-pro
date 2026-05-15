import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPreflight } from './preflight.js';

// Mock all dependencies
vi.mock('../../clients/kisClient.js', () => ({
  fetchAccountBalance: vi.fn(),
}));
vi.mock('../../state.js', () => ({
  getManualBlockNewBuy: vi.fn().mockReturnValue(false),
  getManualManageOnly: vi.fn().mockReturnValue(false),
  getEmergencyStop: vi.fn().mockReturnValue(false),
  // ADR-0392 P0-B — preflight 가 getTradingMode() 사용 → mock 추가.
  getTradingMode: vi.fn().mockReturnValue('SHADOW'),
  getMacroEntryOverrideState: vi.fn().mockReturnValue(null),
}));
vi.mock('../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
  escapeHtml: vi.fn((text: string) => text),
}));
vi.mock('../../utils/gatingAlertWindow.js', () => ({
  getGatingAlertSession: vi.fn().mockReturnValue('OPEN'),
}));
vi.mock('../../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn(),
}));
vi.mock('../regimeBridge.js', () => ({
  getLiveRegime: vi.fn(),
}));
vi.mock('../../persistence/watchlistRepo.js', () => ({
  loadWatchlist: vi.fn(),
}));
vi.mock('../../persistence/r3SanityBlockRepo.js', () => ({
  acknowledgeR3SanityBlock: vi.fn(),
  isR3SanityAckTokenValid: vi.fn(),
  loadR3SanityBlockState: vi.fn(),
}));
vi.mock('../../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: vi.fn().mockReturnValue([]),
  saveShadowTrades: vi.fn(),
}));
vi.mock('../../persistence/shadowAccountRepo.js', () => ({
  computeShadowAccount: vi.fn().mockReturnValue({ totalAssets: 100_000_000, cashBalance: 50_000_000, totalInvested: 50_000_000 }),
}));
vi.mock('../../persistence/tradingSettingsRepo.js', () => ({
  loadTradingSettings: vi.fn().mockReturnValue({ startingCapital: 100_000_000 }),
}));
vi.mock('../exitEngine.js', () => ({
  updateShadowResults: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../shadowLearningOnlyScan.js', () => ({
  isShadowLearningOnBlockedDaysEnabled: vi.fn().mockReturnValue(true),
  runShadowLearningOnlyScan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../vixGating.js', () => ({
  getVixGating: vi.fn(),
}));
vi.mock('../fomcCalendar.js', () => ({
  getFomcProximity: vi.fn(),
}));
vi.mock('../../screener/dataCompletenessTracker.js', () => ({
  isDataStarvedScan: vi.fn().mockReturnValue(false),
  getCompletenessSnapshot: vi.fn().mockReturnValue({ mtasFailRate: 0, dartNullRate: 0, mtasAttempts: 100, dartAttempts: 100 }),
}));
vi.mock('../kellyDampener.js', () => ({
  getKellyMultiplier: vi.fn().mockReturnValue(1.0),
}));
vi.mock('../../learning/biasPositionPenalty.js', () => ({
  computeBiasPositionPenalty: vi.fn().mockReturnValue({ multiplier: 1.0, reasons: [] }),
}));
vi.mock('../../learning/safetyGatePolicyFeedback.js', () => ({
  computeSafetyGatePolicyFeedback: vi.fn().mockReturnValue({ multiplier: 1.0, active: false, reasons: [] }),
}));
vi.mock('../slotAccounting.js', () => ({
  computeSlotConsumption: vi.fn(),
}));
vi.mock('../volumeClock.js', () => ({
  checkVolumeClockWindow: vi.fn(),
}));
vi.mock('../../persistence/conditionWeightsRepo.js', () => ({
  loadConditionWeights: vi.fn().mockReturnValue({}),
  getConditionWeightsUpdatedAt: vi.fn().mockReturnValue(new Date().toISOString()),
}));
vi.mock('../entryEngine.js', () => ({
  isOpenShadowStatus: vi.fn().mockReturnValue(true),
}));

vi.mock('./counterfactualUniverseLearningWiring.js', () => ({
  deriveUniverseLearningReason: vi.fn((reason: string) => reason),
  recordCounterfactualUniverseLearningSnapshot: vi.fn(() => ({ recorded: true })),
  // ADR-0367: recordPreflightUniverseLearningSnapshot 가 candidateSummaryCount 산출용으로 호출.
  buildCandidateSummaries: vi.fn((candidates?: unknown[]) => candidates ?? []),
}));

vi.mock('../../../src/services/quant/regimeEngine.js', () => ({
  REGIME_CONFIGS: {
    R2_BULL: { kellyMultiplier: 0.8, maxPositions: 6, sellOnlyException: { enabled: false } },
    R5_CAUTION: { gate2Required: 10, gate3Required: 8, kellyMultiplier: 0.3, maxPositions: 2, allowedSignals: ['CONFIRMED_STRONG_BUY'], sellOnlyException: { enabled: false } },
    R6_DEFENSE: { gate2Required: 99, gate3Required: 99, kellyMultiplier: 0, maxPositions: 0, allowedSignals: [], sellOnlyException: { enabled: false } },
  },
}));

import { fetchAccountBalance } from '../../clients/kisClient.js';
import { getManualBlockNewBuy } from '../../state.js';
import { loadWatchlist } from '../../persistence/watchlistRepo.js';
import { loadR3SanityBlockState, isR3SanityAckTokenValid, acknowledgeR3SanityBlock } from '../../persistence/r3SanityBlockRepo.js';
import { getLiveRegime } from '../regimeBridge.js';
import { getVixGating } from '../vixGating.js';
import { getFomcProximity } from '../fomcCalendar.js';
import { isDataStarvedScan } from '../../screener/dataCompletenessTracker.js';
import { computeSlotConsumption } from '../slotAccounting.js';
import { checkVolumeClockWindow } from '../volumeClock.js';
import { runShadowLearningOnlyScan } from '../shadowLearningOnlyScan.js';
import { recordCounterfactualUniverseLearningSnapshot } from './counterfactualUniverseLearningWiring.js';

const mockedFetchAccountBalance = vi.mocked(fetchAccountBalance);
const mockedGetManualBlockNewBuy = vi.mocked(getManualBlockNewBuy);
const mockedLoadWatchlist = vi.mocked(loadWatchlist);
const mockedLoadR3SanityBlockState = vi.mocked(loadR3SanityBlockState);
const mockedIsR3SanityAckTokenValid = vi.mocked(isR3SanityAckTokenValid);
const mockedGetLiveRegime = vi.mocked(getLiveRegime);
const mockedGetVixGating = vi.mocked(getVixGating);
const mockedGetFomcProximity = vi.mocked(getFomcProximity);
const mockedIsDataStarvedScan = vi.mocked(isDataStarvedScan);
const mockedComputeSlotConsumption = vi.mocked(computeSlotConsumption);
const mockedCheckVolumeClockWindow = vi.mocked(checkVolumeClockWindow);
const mockedRunShadowLearningOnlyScan = vi.mocked(runShadowLearningOnlyScan);
const mockedRecordCounterfactualUniverseLearningSnapshot = vi.mocked(recordCounterfactualUniverseLearningSnapshot);

describe('preflight.ts byte-equivalent tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedRunShadowLearningOnlyScan.mockResolvedValue(undefined as any);
    process.env.KIS_APP_KEY = 'test-key';
    process.env.AUTO_TRADE_MODE = 'SHADOW';

    // ADR-0188 (lint baseline cleanup): mock 반환값 type 정합 — `as ReturnType<...>` cast 로
    // schema 진화에 자동 정합 (필수 필드 직접 명시는 schema 변경 시 drift 위험).
    mockedLoadWatchlist.mockReturnValue([{ code: '005930', name: 'Samsung' }] as ReturnType<typeof loadWatchlist>);
    mockedLoadR3SanityBlockState.mockReturnValue({ active: false } as ReturnType<typeof loadR3SanityBlockState>);
    mockedGetLiveRegime.mockReturnValue('R2_BULL');
    mockedGetVixGating.mockReturnValue({ noNewEntry: false, kellyMultiplier: 1.0, reason: '' } as ReturnType<typeof getVixGating>);
    mockedGetFomcProximity.mockReturnValue({ noNewEntry: false, kellyMultiplier: 1.0, phase: 'NORMAL', description: '' } as unknown as ReturnType<typeof getFomcProximity>);
    mockedIsDataStarvedScan.mockReturnValue(false);
    mockedComputeSlotConsumption.mockReturnValue({ isFull: false, consumed: 2, rawCount: 2 } as ReturnType<typeof computeSlotConsumption>);
    mockedCheckVolumeClockWindow.mockReturnValue({ allowEntry: true, scoreBonus: 0, reason: '' } as ReturnType<typeof checkVolumeClockWindow>);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should abort if KIS_APP_KEY is not set while recording learning-only cases', async () => {
    delete process.env.KIS_APP_KEY;
    const result = await runPreflight();
    expect(result).toEqual({ shouldAbort: true, skipPersist: false });
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'KIS_CONFIG_MISSING',
    }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      preflightStage: 'BEFORE_UNIVERSE_BUILD',
      blockedBy: ['KIS_CONFIG_MISSING'],
    }));
  });

  it('should abort if watchlist is empty while recording WATCHLIST_EMPTY learning case', async () => {
    mockedLoadWatchlist.mockReturnValue([]);
    const result = await runPreflight();
    expect(result).toEqual({ shouldAbort: true, skipPersist: false });
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({
      allowRealOrder: false,
      reason: 'WATCHLIST_EMPTY',
    }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      preflightStage: 'BEFORE_UNIVERSE_BUILD',
      blockedBy: ['WATCHLIST_EMPTY'],
      universeSize: 0,
      candidateCount: 0,
    }));
  });

  it('should abort if R3 sanity block is active and not acknowledged', async () => {
    mockedLoadR3SanityBlockState.mockReturnValue({ active: true, violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', triggeredAt: 'ts' } as ReturnType<typeof loadR3SanityBlockState>);
    mockedIsR3SanityAckTokenValid.mockReturnValue(false);
    const result = await runPreflight();
    expect(result).toEqual(expect.objectContaining({ shouldAbort: true, skipPersist: true }));
    expect(result.context).toEqual(expect.objectContaining({ watchlist: expect.any(Array), regime: 'R2_BULL' }));
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({ reason: 'R3_SANITY_BLOCK' }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['HARD_BLOCK'],
    }));
  });

  it('should keep diagnostics alive in R6_DEFENSE while blocking live entry', async () => {
    mockedGetLiveRegime.mockReturnValue('R6_DEFENSE');
    const result = await runPreflight();
    expect(result).toEqual(expect.objectContaining({ shouldAbort: false }));
    expect(result.macroGateState).toEqual(expect.objectContaining({
      regime: 'R6_DEFENSE',
      diagnosticLiveEntryBlocked: true,
      liveEntryBlockedReason: 'R6_DEFENSE',
    }));
    expect(result.context).toEqual(expect.objectContaining({
      watchlist: expect.any(Array),
      regime: 'R6_DEFENSE',
      macroDiagnosticOnly: true,
      liveEntryBlockedReason: 'R6_DEFENSE',
    }));
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({ reason: 'RISK_OFF_REGIME' }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      blockedBy: ['R6_DEFENSE'],
    }));
  });

  it('should keep diagnostics alive if VIX gating is active while blocking live entry', async () => {
    mockedGetVixGating.mockReturnValue({ noNewEntry: true, kellyMultiplier: 0.5, reason: 'VIX spike' } as ReturnType<typeof getVixGating>);
    const result = await runPreflight();
    expect(result).toEqual(expect.objectContaining({ shouldAbort: false }));
    expect(result.context).toEqual(expect.objectContaining({
      watchlist: expect.any(Array),
      vixGating: expect.objectContaining({ noNewEntry: true }),
      macroDiagnosticOnly: true,
      liveEntryBlockedReason: 'VIX_BLOCK',
    }));
    expect(result.macroGateState).toEqual(expect.objectContaining({
      diagnosticLiveEntryBlocked: true,
      liveEntryBlockedReason: 'VIX_BLOCK',
    }));
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({ reason: 'VIX_SPIKE' }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      blockedBy: ['VIX_BLOCK'],
    }));
  });

  it('should keep diagnostics alive on FOMC block while blocking live entry', async () => {
    mockedGetFomcProximity.mockReturnValue({ noNewEntry: true, kellyMultiplier: 0.5, phase: 'BLACKOUT', description: 'FOMC blackout' } as unknown as ReturnType<typeof getFomcProximity>);
    const result = await runPreflight();
    expect(result).toEqual(expect.objectContaining({ shouldAbort: false }));
    expect(result.context).toEqual(expect.objectContaining({
      watchlist: expect.any(Array),
      fomcProximity: expect.objectContaining({ noNewEntry: true }),
      macroDiagnosticOnly: true,
      liveEntryBlockedReason: 'FOMC_BLOCK',
    }));
    expect(result.macroGateState).toEqual(expect.objectContaining({
      diagnosticLiveEntryBlocked: true,
      liveEntryBlockedReason: 'FOMC_BLOCK',
    }));
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({ reason: 'FOMC_BLOCK' }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      blockedBy: ['FOMC_BLOCK'],
    }));
  });

  it('skipPersist=true means normal scan persistence may be skipped, not Shadow/Universe learning', async () => {
    mockedIsDataStarvedScan.mockReturnValue(true);
    const result = await runPreflight();
    expect(result).toEqual(expect.objectContaining({ shouldAbort: true, skipPersist: true }));
    expect(result.context).toEqual(expect.objectContaining({ watchlist: expect.any(Array) }));
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({
      allowRealOrder: false,
      reason: 'DATA_STARVED',
    }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SCAN_ABORTED'],
    }));
  });

  it('should record VOLUME_CLOCK_BLOCK shadow learning when volume clock blocks entries', async () => {
    mockedCheckVolumeClockWindow.mockReturnValue({ allowEntry: false, scoreBonus: 0, reason: 'closed' } as ReturnType<typeof checkVolumeClockWindow>);
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(true);
    expect(result.skipPersist).toBe(false);
    expect(result.context).toEqual(expect.objectContaining({ watchlist: expect.any(Array), volumeClock: expect.objectContaining({ allowEntry: false }) }));
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({
      allowRealOrder: false,
      reason: 'VOLUME_CLOCK_BLOCK',
    }));
    // ADR-0367: recordBlockedDayShadowScan 의 VOLUME_CLOCK_BLOCK 분기가
    // recordPreflightUniverseLearningSnapshot 를 호출 — universe snapshot 기록은 정상 동작.
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      blockedBy: ['VOLUME_CLOCK_BLOCK'],
    }));
  });

  it('should keep diagnostic scan alive if position slots are full', async () => {
    mockedComputeSlotConsumption.mockReturnValue({ isFull: true, consumed: 8, rawCount: 8 } as ReturnType<typeof computeSlotConsumption>);
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(false);
    expect(result.macroGateState).toBeDefined();
    expect(result.context).toEqual(expect.objectContaining({
      watchlist: expect.any(Array),
      kellyMultiplier: expect.any(Number),
      positionFullDiagnosticOnly: true,
      liveEntryBlockedReason: 'POSITION_FULL',
    }));
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({
      allowRealOrder: false,
      reason: 'POSITION_FULL',
    }));
  });

  it('should successfully pass preflight with correct context on a normal day', async () => {
    const result = await runPreflight();

    expect(result.shouldAbort).toBe(false);
    expect(result.macroGateState).toBeDefined();
    expect(result.macroGateState.regime).toBe('R2_BULL');
    expect(result.macroGateState.finalKellyMultiplier).toBeCloseTo(0.8 * 1.08);

    const ctx = result.context;
    expect(ctx).toBeDefined();
    expect(ctx.shadowMode).toBe(true);
    expect(ctx.regime).toBe('R2_BULL');
    expect(ctx.kellyMultiplier).toBeCloseTo(0.8 * 1.08);
    expect(ctx.effectiveMaxPositions).toBe(6);
  });
});
