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
  getDataIntegrityBlocked: vi.fn().mockReturnValue(false),
  getAutoTradePaused: vi.fn().mockReturnValue(false),
  getExecutionMode: vi.fn().mockReturnValue('LIVE'),
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
vi.mock('../regimeBridge.js', () => {
  const getLiveRegime = vi.fn();
  return {
    getLiveRegime,
    getRegimeDiagnostics: vi.fn((macroState: any) => {
      const liveRegime = getLiveRegime(macroState);
      const isR6 = liveRegime === 'R6_DEFENSE';
      // production resolveRegimeSnapshot()는 legacy R6 effectiveRegime 을 rawRegime 으로 강등한다
      // (marketStateResolver.base sanitizeLegacyR6EffectiveRegime + regimeResolver sanitizeEffectiveRegime).
      // R6 시나리오의 base(raw) regime 은 R2_BULL 로 둬 "R6 무시 → 실행 regime=R2_BULL" 불변식을 재현.
      const rawRegime = isR6 ? 'R2_BULL' : liveRegime;
      const effectiveRegime = liveRegime;
      return {
        rawRegime,
        effectiveRegime,
        sourceFreshness: 'FRESH',
        r6RecoveryStatus: isR6 ? 'R6_DEFENSE' : 'NOT_R6',
        cooldownUntil: undefined,
        transitionReason: '',
        // preflight.ts:698-699 가 recoveryEvidence.{vkospiTrustState,reasons} 를 직접 읽는다
        // (RegimeDiagnostics.recoveryEvidence: R6RecoveryEvidence, regimeBridge.base.ts).
        recoveryEvidence: {
          vkospiTrustState: 'TRUSTED',
          reasons: ['R6_RECOVERY_EVIDENCE_OK'],
        },
        activeR6Triggers: isR6 ? ['MHS_LOW'] : [],
        previousR6Triggers: [],
        r6ShockLatch: isR6,
        recoveryBlockedReason: isR6 ? 'R6_DEFENSE_ACTIVE' : undefined,
        r6TriggerBreakdown: { triggerFreshness: 'FRESH', activeR6Triggers: isR6 ? ['MHS_LOW'] : [] },
        transitionState: { r6StateMachineState: isR6 ? 'R6_DEFENSE' : 'R2_BULL' },
      };
    }),
  };
});
vi.mock('../../persistence/watchlistRepo.js', () => ({
  loadWatchlist: vi.fn(),
}));
vi.mock('../../persistence/r3SanityBlockRepo.js', () => ({
  acknowledgeR3SanityBlock: vi.fn(),
  isR3SanityAckTokenValid: vi.fn(),
  loadR3SanityBlockState: vi.fn(),
  getEffectiveR3SanityBlockState: vi.fn(),
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
// kellyDampener, biasPositionPenalty, safetyGatePolicyFeedback mocks removed:
// preflight.ts no longer imports these after Kelly multiplier chain removal.
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

// Patch-VITEST-CAT-D-PREFLIGHT-001: preflight.ts 가 isKrxTradingDay(todayKstDate) 를 호출 →
// 테스트 실행 시점이 주말/휴장일이면 resolvedMarketSessionState='NON_TRADING_DAY' → kellyPolicyBlock 가
// effectiveKelly=0 + blockedByPolicy=true 강제 → "normal day" 테스트의 0.864 expectation 실패.
// 테스트 invariant: 항상 거래일로 mock (baseline doc invariant #7 정합 — runtime 본체 무수정, 테스트만 격리).
vi.mock('../../calendar/krxTradingCalendar.js', () => ({
  isKrxTradingDay: vi.fn().mockReturnValue(true),
}));

// REGIME_CONFIGS 는 테스트용 축소 맵으로 mock 하되, toCanonicalRegimeLevel 정규화기는
// 축소 REGIME_CONFIGS 키 공간에 맞춰 동일 매핑 산식을 재현한다(learningRegime 정합 회귀 보장).
// vi.mock 팩토리는 hoist 되므로 모든 정의를 팩토리 내부에 둔다(top-level 참조 금지).
vi.mock('../../../src/services/quant/regimeEngine.js', () => {
  const TEST_REGIME_CONFIGS: Record<string, unknown> = {
    R2_BULL: { kellyMultiplier: 0.8, maxPositions: 6, sellOnlyException: { enabled: false } },
    R3_EARLY: { gate2Required: 6, gate3Required: 4, kellyMultiplier: 0.7, maxPositions: 6, allowedSignals: ['STRONG_BUY', 'BUY', 'EARLY_ENTRY'], sellOnlyException: { enabled: false } },
    R4_NEUTRAL: { gate2Required: 8, gate3Required: 6, kellyMultiplier: 0.5, maxPositions: 4, allowedSignals: ['CONFIRMED_STRONG_BUY', 'STRONG_BUY'], sellOnlyException: { enabled: false } },
    R5_CAUTION: { gate2Required: 10, gate3Required: 8, kellyMultiplier: 0.3, maxPositions: 2, allowedSignals: ['CONFIRMED_STRONG_BUY'], sellOnlyException: { enabled: false } },
    R6_DEFENSE: { gate2Required: 99, gate3Required: 99, kellyMultiplier: 0, maxPositions: 0, allowedSignals: [], sellOnlyException: { enabled: false } },
  };
  return {
    REGIME_CONFIGS: TEST_REGIME_CONFIGS,
    toCanonicalRegimeLevel: (value: unknown): string | undefined => {
      if (typeof value !== 'string' || value.length === 0) return undefined;
      if (Object.prototype.hasOwnProperty.call(TEST_REGIME_CONFIGS, value)) return value;
      const prefixMap: Record<string, string> = {
        R1: 'R1_TURBO', R2: 'R2_BULL', R3: 'R3_EARLY',
        R4: 'R4_NEUTRAL', R5: 'R5_CAUTION', R6: 'R6_DEFENSE',
      };
      return prefixMap[value.slice(0, 2).toUpperCase()];
    },
  };
});

import { fetchAccountBalance } from '../../clients/kisClient.js';
import { getManualBlockNewBuy } from '../../state.js';
import { loadWatchlist } from '../../persistence/watchlistRepo.js';
import { loadR3SanityBlockState, getEffectiveR3SanityBlockState, isR3SanityAckTokenValid, acknowledgeR3SanityBlock } from '../../persistence/r3SanityBlockRepo.js';
import { getLiveRegime, getRegimeDiagnostics } from '../regimeBridge.js';
import { getVixGating } from '../vixGating.js';
import { getFomcProximity } from '../fomcCalendar.js';
import { isDataStarvedScan } from '../../screener/dataCompletenessTracker.js';
import { computeSlotConsumption } from '../slotAccounting.js';
import { checkVolumeClockWindow } from '../volumeClock.js';
import { runShadowLearningOnlyScan } from '../shadowLearningOnlyScan.js';
import { recordCounterfactualUniverseLearningSnapshot } from './counterfactualUniverseLearningWiring.js';
import { sendTelegramAlert } from '../../alerts/telegramClient.js';

const mockedFetchAccountBalance = vi.mocked(fetchAccountBalance);
const mockedGetManualBlockNewBuy = vi.mocked(getManualBlockNewBuy);
const mockedLoadWatchlist = vi.mocked(loadWatchlist);
const mockedLoadR3SanityBlockState = vi.mocked(loadR3SanityBlockState);
// preflight 는 R3 sanity latch 를 getEffectiveR3SanityBlockState(TTL 반영)로 조회한다 — 테스트는 이걸 제어.
const mockedGetEffectiveR3SanityBlockState = vi.mocked(getEffectiveR3SanityBlockState);
const mockedIsR3SanityAckTokenValid = vi.mocked(isR3SanityAckTokenValid);
const mockedGetLiveRegime = vi.mocked(getLiveRegime);
const mockedGetRegimeDiagnostics = vi.mocked(getRegimeDiagnostics);
const mockedGetVixGating = vi.mocked(getVixGating);
const mockedGetFomcProximity = vi.mocked(getFomcProximity);
const mockedIsDataStarvedScan = vi.mocked(isDataStarvedScan);
const mockedComputeSlotConsumption = vi.mocked(computeSlotConsumption);
const mockedCheckVolumeClockWindow = vi.mocked(checkVolumeClockWindow);
const mockedRunShadowLearningOnlyScan = vi.mocked(runShadowLearningOnlyScan);
const mockedRecordCounterfactualUniverseLearningSnapshot = vi.mocked(recordCounterfactualUniverseLearningSnapshot);
const mockedSendTelegramAlert = vi.mocked(sendTelegramAlert);

describe('preflight.ts byte-equivalent tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedRunShadowLearningOnlyScan.mockResolvedValue(undefined as any);
    mockedSendTelegramAlert.mockResolvedValue(123);
    process.env.KIS_APP_KEY = 'test-key';
    process.env.AUTO_TRADE_MODE = 'SHADOW';

    // ADR-0188 (lint baseline cleanup): mock 반환값 type 정합 — `as ReturnType<...>` cast 로
    // schema 진화에 자동 정합 (필수 필드 직접 명시는 schema 변경 시 drift 위험).
    mockedLoadWatchlist.mockReturnValue([{ code: '005930', name: 'Samsung' }] as ReturnType<typeof loadWatchlist>);
    mockedLoadR3SanityBlockState.mockReturnValue({ active: false } as ReturnType<typeof loadR3SanityBlockState>);
    mockedGetEffectiveR3SanityBlockState.mockReturnValue({ active: false } as ReturnType<typeof getEffectiveR3SanityBlockState>);
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
    expect(result).toMatchObject({ shouldAbort: true, shouldAbortEngine: true, shouldAbortLiveOrder: true, shouldAbortGateEvaluation: true, shouldAbortShadowLearning: false, shouldAbortCounterfactual: false, skipPersist: false });
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
    expect(result).toMatchObject({ shouldAbort: true, shouldAbortEngine: true, shouldAbortLiveOrder: true, shouldAbortGateEvaluation: true, shouldAbortShadowLearning: false, shouldAbortCounterfactual: false, skipPersist: false });
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

  it('should NOT hard-abort R3 sanity even when legacy R3_SANITY_BLOCK_ENABLED=true is set (abort path removed)', async () => {
    process.env.R3_SANITY_BLOCK_ENABLED = 'true'; // legacy env must be ignored — no abort path exists
    mockedGetEffectiveR3SanityBlockState.mockReturnValue({ active: true, violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', triggeredAt: 'ts' } as ReturnType<typeof getEffectiveR3SanityBlockState>);
    mockedIsR3SanityAckTokenValid.mockReturnValue(false);
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(false);
    expect(result.shouldAbortGateEvaluation).toBe(false);
    expect(result.shouldAbortLiveOrder).toBe(true); // OBSERVE_ONLY: live blocked, diagnostics run
    expect(result.macroGateState).toEqual(expect.objectContaining({
      liveEntryBlockedReason: expect.stringContaining('R3_SANITY_GUARD'),
    }));
    expect(mockedRunShadowLearningOnlyScan).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'R3_SANITY_BLOCK' }));
  });

  it('should demote R3 sanity latch to OBSERVE_ONLY (live blocked, Gate diagnostics run)', async () => {
    delete process.env.R3_SANITY_BLOCK_ENABLED;
    mockedGetEffectiveR3SanityBlockState.mockReturnValue({ active: true, violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', triggeredAt: 'ts' } as ReturnType<typeof getEffectiveR3SanityBlockState>);
    mockedIsR3SanityAckTokenValid.mockReturnValue(false);
    const result = await runPreflight();
    // buyListLoop / Gate evaluation must RUN (no abort) so threshold evidence accumulates
    expect(result.shouldAbort).toBe(false);
    expect(result.shouldAbortGateEvaluation).toBe(false);
    // but LIVE execution must stay blocked (execution guard, not pipeline abort)
    expect(result.shouldAbortLiveOrder).toBe(true);
    expect(result.macroGateState).toEqual(expect.objectContaining({
      regime: 'R2_BULL',
      diagnosticLiveEntryBlocked: true,
      liveEntryAllowed: false,
      brokerOrderAllowed: false,
      liveEntryBlockedReason: expect.stringContaining('R3_SANITY_GUARD'),
      shadowLearningAllowed: true,
    }));
    // R3 sanity latch must NOT route into the HARD_BLOCK abort path
    expect(mockedRunShadowLearningOnlyScan).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'R3_SANITY_BLOCK' }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      blockedBy: ['HARD_BLOCK'],
    }));
  });

  it('should ignore R6_DEFENSE for execution while keeping diagnostics and Shadow alive', async () => {
    mockedGetLiveRegime.mockReturnValue('R6_DEFENSE');
    const result = await runPreflight();
    expect(result).toEqual(expect.objectContaining({ shouldAbort: false }));
    expect(result.macroGateState).toEqual(expect.objectContaining({
      regime: 'R2_BULL',
      bearDefenseMode: false,
      sellOnlyMode: false,
      diagnosticLiveEntryBlocked: false,
      liveEntryAllowed: true,
      brokerOrderAllowed: true,
      shadowLearningAllowed: true,
      counterfactualAllowed: true,
    }));
    // 현행: R6 무시 불변식 — regime 은 R2_BULL 로 강등(bearDefenseMode false), shadow/diagnostics alive.
    // (구 monolithic macroDiagnosticOnly 세팅은 R3_SANITY 경로로 한정됨 — R6 단언 제거.)
    expect(result.context).toEqual(expect.objectContaining({
      watchlist: expect.any(Array),
      regime: 'R2_BULL',
    }));
    expect(mockedSendTelegramAlert).not.toHaveBeenCalledWith(
      expect.stringContaining('[R6_DEFENSE]'),
      expect.anything(),
    );
    expect(mockedRunShadowLearningOnlyScan).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'RISK_OFF_REGIME' }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      blockedBy: ['R6_DEFENSE'],
    }));
  });

  it('surfaces vixGatingActive diagnostically when VIX gating is active (live-entry gating decomposed to per-symbol)', async () => {
    mockedGetVixGating.mockReturnValue({ noNewEntry: true, kellyMultiplier: 0.5, reason: 'VIX spike' } as ReturnType<typeof getVixGating>);
    const result = await runPreflight();
    expect(result).toEqual(expect.objectContaining({ shouldAbort: false }));
    // 현행: preflight 는 VIX 를 진단 surface(macroGateState.vixGatingActive)로만 노출한다.
    // live-entry 차단·shadow-only 스캔 트리거(VIX_SPIKE)는 per-symbol 파이프라인
    // (r3StreakSkipPolicy / gateDecisionRouter / counterfactualShadowLearningLane)으로 분해됨
    // — preflight 단위 책임 아님(구 monolithic macroDiagnosticOnly/liveEntryBlockedReason 단언 제거).
    expect(result.context).toEqual(expect.objectContaining({
      watchlist: expect.any(Array),
      vixGating: expect.objectContaining({ noNewEntry: true }),
    }));
    expect(result.macroGateState).toEqual(expect.objectContaining({
      vixGatingActive: true,
    }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      blockedBy: ['VIX_BLOCK'],
    }));
  });

  it('surfaces fomcProximity diagnostically on FOMC block (live-entry gating decomposed to per-symbol)', async () => {
    mockedGetFomcProximity.mockReturnValue({ noNewEntry: true, kellyMultiplier: 0.5, phase: 'BLACKOUT', description: 'FOMC blackout' } as unknown as ReturnType<typeof getFomcProximity>);
    const result = await runPreflight();
    expect(result).toEqual(expect.objectContaining({ shouldAbort: false }));
    // 현행: preflight 는 FOMC 를 진단 surface(context.fomcProximity)로만 노출한다. live-entry 차단·
    // shadow 스캔(FOMC_BLOCK)은 per-symbol 파이프라인으로 분해됨 — preflight 단위 책임 아님.
    expect(result.context).toEqual(expect.objectContaining({
      watchlist: expect.any(Array),
      fomcProximity: expect.objectContaining({ noNewEntry: true }),
    }));
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

  it('should ignore volumeClock SELL_ONLY-style blocks for scan evaluation while preserving context', async () => {
    mockedCheckVolumeClockWindow.mockReturnValue({ allowEntry: false, scoreBonus: 0, reason: 'closed' } as ReturnType<typeof checkVolumeClockWindow>);
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(false);
    expect(result.context).toEqual(expect.objectContaining({ watchlist: expect.any(Array), volumeClock: expect.objectContaining({ allowEntry: false }) }));
    expect(result.macroGateState).toEqual(expect.objectContaining({
      sellOnlyMode: false,
      liveEntryAllowed: true,
      brokerOrderAllowed: true,
      shadowLearningAllowed: true,
    }));
    expect(mockedRunShadowLearningOnlyScan).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'VOLUME_CLOCK_BLOCK' }));
    // ADR-0367: recordBlockedDayShadowScan 의 VOLUME_CLOCK_BLOCK 분기가
    // recordPreflightUniverseLearningSnapshot 를 호출 — universe snapshot 기록은 정상 동작.
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      blockedBy: ['VOLUME_CLOCK_BLOCK'],
    }));
  });

  it('should keep R6 POST_CLOSE_OBSERVE scans alive after the volume clock closes', async () => {
    mockedGetLiveRegime.mockReturnValue('R6_DEFENSE');
    mockedCheckVolumeClockWindow.mockReturnValue({ allowEntry: false, scoreBonus: 0, reason: 'closed' } as ReturnType<typeof checkVolumeClockWindow>);

    const result = await runPreflight({ candidateScanTrigger: 'POST_CLOSE_OBSERVE' });

    expect(result.shouldAbort).toBe(false);
    expect(result.macroGateState).toEqual(expect.objectContaining({
      regime: 'R2_BULL',
      sellOnlyMode: false,
      diagnosticLiveEntryBlocked: false,
      liveEntryAllowed: true,
      brokerOrderAllowed: true,
      shadowLearningAllowed: true,
    }));
    // 현행: R6 무시 + volumeClock 종료에도 scan/shadow alive. (구 macroDiagnosticOnly 단언 제거 — R3_SANITY 한정.)
    expect(result.context).toEqual(expect.objectContaining({
      watchlist: expect.any(Array),
      regime: 'R2_BULL',
      volumeClock: expect.objectContaining({ allowEntry: false }),
    }));
    expect(mockedRunShadowLearningOnlyScan).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'RISK_OFF_REGIME' }));
    expect(mockedRunShadowLearningOnlyScan).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'VOLUME_CLOCK_BLOCK' }));
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
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
    expect(result.macroGateState.finalKellyMultiplier).toBeCloseTo(0.8);

    const ctx = result.context;
    expect(ctx).toBeDefined();
    expect(ctx.shadowMode).toBe(true);
    expect(ctx.regime).toBe('R2_BULL');
    expect(ctx.kellyMultiplier).toBeCloseTo(0.8);
    expect(ctx.effectiveMaxPositions).toBe(6);
  });

  // ─── learningRegime carry 정합 회귀 (patch) ──────────────────────────────────
  // regimeDiagnostics.effectiveRegime 가 확장 R6 상태기계 어휘를 누수하면 단순 REGIME_CONFIGS
  // 키 검사로는 R4_NEUTRAL 로 폴백돼 R3 provisional/counterfactual 레인이 영구 비활성화된다.
  // toCanonicalRegimeLevel 정규화로 learningRegime 이 canonical RegimeLevel 이 됨을 검증한다.
  // live `regime`(clamp)은 본 수리와 무관 — byte-equivalent 유지.
  describe('learningRegime carry 정규화 (확장 effective 어휘 → canonical RegimeLevel)', () => {
    // diagnostics.effectiveRegime 만 확장 어휘로 강제. rawRegime 은 R2_BULL 로 둬 live `regime`
    // 파생(resolveMarketState 경유)이 확장 어휘로 누수되지 않게 격리 → live `regime` 불변 보장.
    function overrideDiagnosticsEffectiveRegime(effectiveRegime: string): void {
      mockedGetRegimeDiagnostics.mockImplementation((() => ({
        rawRegime: 'R2_BULL',
        effectiveRegime,
        sourceFreshness: 'FRESH',
        r6RecoveryStatus: 'NOT_R6',
        cooldownUntil: undefined,
        transitionReason: '',
        recoveryEvidence: { vkospiTrustState: 'TRUSTED', reasons: ['OK'] },
        activeR6Triggers: [],
        previousR6Triggers: [],
        r6ShockLatch: false,
        recoveryBlockedReason: undefined,
        r6TriggerBreakdown: { triggerFreshness: 'FRESH', activeR6Triggers: [] },
        transitionState: { r6StateMachineState: 'R2_BULL' },
      })) as any);
    }

    it('확장 R3_NORMAL diagnostics → learningRegime=R3_EARLY, live regime 은 R4_NEUTRAL clamp 유지 (분리)', async () => {
      // 운영 실측 재현: snapshot.effectiveRegime=R3_NORMAL → live `regime` 은 의도된 R4_NEUTRAL clamp.
      // 패치 전: learningRegime 도 clamp 된 R4_NEUTRAL 로 폴백(R3 레인 영구 비활성) → 버그.
      // 패치 후: learningRegime 만 canonical R3_EARLY 로 정규화(불변식 #8 분리 복원).
      overrideDiagnosticsEffectiveRegime('R3_NORMAL');
      const result = await runPreflight();
      expect(result.context.learningRegime).toBe('R3_EARLY');
      // live `regime` clamp(preflight:365-367)은 본 수리 무관 — 의도된 동작 그대로.
      expect(result.context.regime).toBe('R4_NEUTRAL');
      expect(result.macroGateState.regime).toBe('R4_NEUTRAL');
    });

    it('확장 R5_STABILIZING diagnostics → learningRegime=R5_CAUTION', async () => {
      overrideDiagnosticsEffectiveRegime('R5_STABILIZING');
      const result = await runPreflight();
      expect(result.context.learningRegime).toBe('R5_CAUTION');
    });

    it('확장 R6_RECOVERY_WATCH diagnostics → learningRegime=R6_DEFENSE', async () => {
      overrideDiagnosticsEffectiveRegime('R6_RECOVERY_WATCH');
      const result = await runPreflight();
      expect(result.context.learningRegime).toBe('R6_DEFENSE');
    });

    it('이미 canonical(R3_EARLY) diagnostics → learningRegime=R3_EARLY (무변경)', async () => {
      overrideDiagnosticsEffectiveRegime('R3_EARLY');
      const result = await runPreflight();
      expect(result.context.learningRegime).toBe('R3_EARLY');
    });

    it('live `regime` ≠ learningRegime 분리 검증: 확장 어휘에서 regime 은 clamp, learningRegime 은 정규화', async () => {
      // 핵심 불변식 #8: 실거래 차단(live regime clamp) 과 shadow 차단(learningRegime) 의 분리.
      const cases: Array<[string, string]> = [
        ['R3_NORMAL', 'R3_EARLY'],
        ['R5_STABILIZING', 'R5_CAUTION'],
        ['R6_RECOVERY_WATCH', 'R6_DEFENSE'],
      ];
      for (const [extended, canonical] of cases) {
        overrideDiagnosticsEffectiveRegime(extended);
        const result = await runPreflight();
        // learningRegime 은 canonical 로 정규화되지만 live regime 은 그와 독립적으로 clamp 된다.
        expect(result.context.learningRegime).toBe(canonical);
        expect(result.context.regime).not.toBe(extended); // 확장 어휘가 live regime 으로 누수되지 않음
        expect(Object.prototype.hasOwnProperty.call(
          { R1_TURBO: 1, R2_BULL: 1, R3_EARLY: 1, R4_NEUTRAL: 1, R5_CAUTION: 1, R6_DEFENSE: 1 },
          result.context.regime as string,
        )).toBe(true); // live regime 은 항상 canonical RegimeLevel
      }
    });
  });
});
