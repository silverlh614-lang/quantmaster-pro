/**
 * @responsibility R3 GATE1_PASS_ZERO SHADOW_ONLY pre-scan hard-block 폐기 회귀 테스트.
 *
 * 검증 (사용자 명시 범위 — GATE1_PASS_ZERO 만 비차단화):
 *   - default(ENV 미설정) → GATE1_PASS_ZERO streak 3/3 시 더 이상 SHADOW_ONLY pre-scan abort 안 함.
 *   - default → GATE1_PASS_ZERO SHADOW_ONLY pre-scan 텔레그램 알림 미발화.
 *   - ENV R3_GATE1_PASS_ZERO_HARDBLOCK_ENABLED=true → 기존 GATE1_PASS_ZERO hard-block 복원 (1줄 롤백).
 *   - CANDIDATES_ZERO / GATE_PASS_DATA_MISSING 는 본 경로 진입 0 — 영향 불변 (byte-equivalent).
 *   - R3 persistent latch (HARD_BLOCK, ADR-0120) 경로는 본 변경 무관 — 별도 유지.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../clients/kisClient.js', () => ({
  fetchAccountBalance: vi.fn().mockResolvedValue(50_000_000),
}));
vi.mock('../../state.js', () => ({
  getManualBlockNewBuy: vi.fn().mockReturnValue(false),
  getManualManageOnly: vi.fn().mockReturnValue(false),
  getEmergencyStop: vi.fn().mockReturnValue(false),
  getTradingMode: vi.fn().mockReturnValue('SHADOW'),
  getMacroEntryOverrideState: vi.fn().mockReturnValue(null),
}));
vi.mock('../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
  escapeHtml: vi.fn((t: string) => t),
}));
vi.mock('../../observability/operationalWarn.js', () => ({
  defaultWarnTtlSec: vi.fn().mockReturnValue(900),
  emitOperationalWarn: vi.fn(),
}));
vi.mock('../../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn().mockReturnValue({ regime: 'R3_EARLY', vix: 15, mhs: 60 }),
}));
vi.mock('../regime/regimeResolver.js', () => ({
  resolveRegimeSnapshot: vi.fn().mockReturnValue({
    snapshotId: 'snap-1',
    asOf: '2026-05-26T00:00:00.000Z',
    ttlSec: 300,
    effectiveRegime: 'R3_EARLY',
    displayRegime: 'R3_EARLY',
    riskOverride: 'NONE',
    engineMode: 'NORMAL',
    sourceHealth: 'VERIFIED',
    providerIssue: false,
    conflicts: [],
    // preflight.ts:618 가 regimeSnapshot.marketState.macroState.ageSec 를 직접 읽는다
    // (ResolvedRegimeSnapshot.marketState: MarketStateSnapshot, regimeResolver.ts).
    // ageSec < ttlSec(300) 으로 둬 macroSnapshotUsableForLiveOrder=true (FRESH 경로 유지).
    marketState: { macroState: { ageSec: 10, freshness: 'FRESH' } },
    diagnostics: {
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      recoveryBlockedReason: undefined,
      cooldownUntil: undefined,
      // preflight.ts:617 가 regimeDiagnostics.sourceFreshness 를 읽어 live-order usable 판정.
      sourceFreshness: 'FRESH',
      // preflight.ts:698-699 가 recoveryEvidence.{vkospiTrustState,reasons} 를 직접 읽는다
      // (RegimeDiagnostics.recoveryEvidence: R6RecoveryEvidence, regimeBridge.base.ts).
      recoveryEvidence: {
        vkospiTrustState: 'TRUSTED',
        reasons: ['R6_RECOVERY_EVIDENCE_OK'],
      },
    },
  }),
}));
vi.mock('../../../src/services/quant/regimeEngine.js', () => ({
  REGIME_CONFIGS: {
    R3_EARLY: { kellyMultiplier: 0.7, maxPositions: 5, sellOnlyException: { enabled: false } },
    R4_NEUTRAL: { kellyMultiplier: 0.5, maxPositions: 4, sellOnlyException: { enabled: false } },
    R5_CAUTION: { gate2Required: 10, gate3Required: 8, kellyMultiplier: 0.3, maxPositions: 2, sellOnlyException: { enabled: false } },
  },
}));
vi.mock('../../persistence/watchlistRepo.js', () => ({
  loadWatchlist: vi.fn().mockReturnValue([{ code: '005930', name: 'Samsung' }]),
}));
vi.mock('../../persistence/r3SanityBlockRepo.js', () => ({
  acknowledgeR3SanityBlock: vi.fn(),
  isR3SanityAckTokenValid: vi.fn().mockReturnValue(false),
  loadR3SanityBlockState: vi.fn().mockReturnValue({ active: false }),
  // preflight 는 latch 를 getEffectiveR3SanityBlockState(TTL 반영)로 조회 — 본 파일은 latch 비활성 경로만 검증.
  getEffectiveR3SanityBlockState: vi.fn().mockReturnValue({ active: false }),
}));
vi.mock('../../persistence/r3ViolationStreakRepo.js', () => ({
  getEffectiveR3ViolationStreak: vi.fn(),
}));
vi.mock('./r3SanityProfiles.js', () => ({
  getR3SanityProfile: vi.fn().mockReturnValue({
    warningAt: 1, elevatedAt: 2, shadowOnlyAt: 3, hardBlockAt: 5, minCandidatesForHardBlock: 5,
  }),
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
vi.mock('../vixGating.js', () => ({
  getVixGating: vi.fn().mockReturnValue({ noNewEntry: false, kellyMultiplier: 1.0, reason: '' }),
}));
vi.mock('../fomcCalendar.js', () => ({
  getFomcProximity: vi.fn().mockReturnValue({ noNewEntry: false, kellyMultiplier: 1.0, phase: 'NORMAL', description: '' }),
}));
vi.mock('../../screener/dataCompletenessTracker.js', () => ({
  isDataStarvedScan: vi.fn().mockReturnValue(false),
  getCompletenessSnapshot: vi.fn().mockReturnValue({ mtasFailRate: 0, dartNullRate: 0, mtasAttempts: 100, dartAttempts: 100 }),
}));
vi.mock('../slotAccounting.js', () => ({
  computeSlotConsumption: vi.fn().mockReturnValue({ isFull: false, consumed: 1, rawCount: 1 }),
}));
vi.mock('../volumeClock.js', () => ({
  checkVolumeClockWindow: vi.fn().mockReturnValue({ allowEntry: true, scoreBonus: 0, reason: '' }),
}));
vi.mock('../../calendar/krxTradingCalendar.js', () => ({
  isKrxTradingDay: vi.fn().mockReturnValue(true),
}));
vi.mock('./r3StreakSkipPolicy.js', () => ({
  evaluateR3CountableScan: vi.fn().mockReturnValue({ countable: true }),
}));
vi.mock('../../persistence/conditionWeightsRepo.js', () => ({
  loadConditionWeights: vi.fn().mockReturnValue({}),
  getConditionWeightsUpdatedAt: vi.fn().mockReturnValue(new Date().toISOString()),
}));
vi.mock('../../learning/learningFreshnessGuard.js', () => ({
  applyFreshnessDecayToNeutralWeightedRecord: vi.fn((r: unknown) => r),
}));
vi.mock('../entryEngine.js', () => ({
  isOpenShadowStatus: vi.fn().mockReturnValue(true),
}));
vi.mock('../entryPolicySemantics.js', () => ({
  formatPreScanSkippedLog: vi.fn().mockReturnValue('skip-log'),
  normalizeMacroRegime: vi.fn((r: string) => r),
  resolveMarketSessionState: vi.fn().mockReturnValue('BUY_ALLOWED'),
}));
vi.mock('./scanDiagnostics.js', () => ({
  buildMacroGateState: vi.fn((s: unknown) => s),
}));
vi.mock('./preflightLearningRecorder.js', () => ({
  captureSupplyHealthSnapshot: vi.fn().mockResolvedValue({}),
  recordBlockedDayShadowScan: vi.fn().mockResolvedValue(undefined),
  recordPreflightBlockedScan: vi.fn().mockResolvedValue(undefined),
  recordPreflightUniverseLearningSnapshot: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./kellyPolicyBlock.js', () => ({
  computeEffectiveKelly: vi.fn().mockReturnValue({ rawKelly: 0.7, effectiveKelly: 0.7, blockedByPolicy: false }),
  formatKellyPolicyBlockedLog: vi.fn().mockReturnValue('kelly-log'),
}));

import { runPreflight } from './preflight.js';
import { getEffectiveR3ViolationStreak } from '../../persistence/r3ViolationStreakRepo.js';
import { sendTelegramAlert } from '../../alerts/telegramClient.js';
import { recordPreflightBlockedScan } from './preflightLearningRecorder.js';

const mockedGetEffectiveStreak = vi.mocked(getEffectiveR3ViolationStreak);
const mockedSendTelegramAlert = vi.mocked(sendTelegramAlert);
const mockedRecordPreflightBlockedScan = vi.mocked(recordPreflightBlockedScan);

function streak(violation: string, count: number) {
  return {
    schemaVersion: 1 as const,
    violation,
    regime: 'R3_EARLY',
    consecutiveCount: count,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-26T00:00:00.000Z',
    scanIds: ['s'],
  } as ReturnType<typeof getEffectiveR3ViolationStreak>;
}

describe('R3 GATE1_PASS_ZERO SHADOW_ONLY pre-scan hard-block deprecation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KIS_APP_KEY = 'test-key';
    delete process.env.R3_GATE1_PASS_ZERO_HARDBLOCK_ENABLED;
    mockedSendTelegramAlert.mockResolvedValue(123);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('default (ENV unset): GATE1_PASS_ZERO streak 3/3 does NOT trigger SHADOW_ONLY pre-scan abort', async () => {
    mockedGetEffectiveStreak.mockReturnValue(streak('GATE1_PASS_ZERO', 3));
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(false);
    // ABORT_SHADOW_ONLY_EPHEMERAL block snapshot 미기록
    expect(mockedRecordPreflightBlockedScan).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preflightDecision: 'ABORT_SHADOW_ONLY_EPHEMERAL' }),
    );
  });

  it('default: GATE1_PASS_ZERO SHADOW_ONLY pre-scan telegram alert NOT emitted', async () => {
    mockedGetEffectiveStreak.mockReturnValue(streak('GATE1_PASS_ZERO', 3));
    await runPreflight();
    expect(mockedSendTelegramAlert).not.toHaveBeenCalledWith(
      expect.stringContaining('[R3 Sanity - SHADOW_ONLY pre-scan]'),
      expect.anything(),
    );
  });

  it('default: effectiveStreak is not even queried when ENV disabled (trigger fully removed)', async () => {
    mockedGetEffectiveStreak.mockReturnValue(streak('GATE1_PASS_ZERO', 5));
    await runPreflight();
    expect(mockedGetEffectiveStreak).not.toHaveBeenCalled();
  });

  it('ENV=true (rollback): GATE1_PASS_ZERO streak 3/3 restores SHADOW_ONLY pre-scan hard-block', async () => {
    process.env.R3_GATE1_PASS_ZERO_HARDBLOCK_ENABLED = 'true';
    mockedGetEffectiveStreak.mockReturnValue(streak('GATE1_PASS_ZERO', 3));
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(true);
    expect(result.skipPersist).toBe(true);
    expect(mockedRecordPreflightBlockedScan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preflightDecision: 'ABORT_SHADOW_ONLY_EPHEMERAL' }),
    );
    expect(mockedSendTelegramAlert).toHaveBeenCalledWith(
      expect.stringContaining('[R3 Sanity - SHADOW_ONLY pre-scan]'),
      expect.anything(),
    );
  });

  it('ENV=true: GATE1_PASS_ZERO below shadowOnlyAt (streak 2/3) still does NOT abort', async () => {
    process.env.R3_GATE1_PASS_ZERO_HARDBLOCK_ENABLED = 'true';
    mockedGetEffectiveStreak.mockReturnValue(streak('GATE1_PASS_ZERO', 2));
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(false);
  });

  it('ADR-0157: only literal "true" enables (e.g. "1"/"TRUE" stay deprecated)', async () => {
    process.env.R3_GATE1_PASS_ZERO_HARDBLOCK_ENABLED = 'TRUE';
    mockedGetEffectiveStreak.mockReturnValue(streak('GATE1_PASS_ZERO', 5));
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(false);
    expect(mockedGetEffectiveStreak).not.toHaveBeenCalled();
  });

  it('CANDIDATES_ZERO streak never triggers the SHADOW_ONLY pre-scan path (invariant, ENV=true)', async () => {
    process.env.R3_GATE1_PASS_ZERO_HARDBLOCK_ENABLED = 'true';
    // 정당한 방어 대상이지만 이 *pre-scan* 경로는 violation==='GATE1_PASS_ZERO' 에만 진입.
    mockedGetEffectiveStreak.mockReturnValue(streak('CANDIDATES_ZERO', 9));
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(false);
    expect(mockedRecordPreflightBlockedScan).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preflightDecision: 'ABORT_SHADOW_ONLY_EPHEMERAL' }),
    );
  });

  it('GATE_PASS_DATA_MISSING streak never triggers the SHADOW_ONLY pre-scan path (invariant, ENV=true)', async () => {
    process.env.R3_GATE1_PASS_ZERO_HARDBLOCK_ENABLED = 'true';
    mockedGetEffectiveStreak.mockReturnValue(streak('GATE_PASS_DATA_MISSING', 9));
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(false);
    expect(mockedRecordPreflightBlockedScan).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preflightDecision: 'ABORT_SHADOW_ONLY_EPHEMERAL' }),
    );
  });
});
