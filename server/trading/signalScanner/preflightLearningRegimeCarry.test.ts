// @responsibility preflight learningRegime carry 정합 v2 회귀 — 정본 snapshot.effectiveRegime 파생, deprecated diagnostics 강등 누수 차단.
//
// 핵심 회귀(#1383 재수리): learningRegime 은 정본 regimeSnapshot.effectiveRegime(ADR-0531 Gate0
// 레짐 정본)에서 파생해야 한다. 이전 수리는 @deprecated regimeDiagnostics.effectiveRegime(R6-recovery
// cap/forced-downgrade 적용된 강등 값)을 입력으로 써서, 정본이 R3_EARLY 여도 diagnostics 가 R4_NEUTRAL
// 로 강등되면 learningRegime 이 R4_NEUTRAL 로 누수 → R3 provisional/counterfactual 레인 영구 차단.
//
// 본 파일은 resolveRegimeSnapshot 을 직접 mock 해 정본 effectiveRegime 과 diagnostics.effectiveRegime
// 을 독립 제어한다(real resolver 는 둘을 결합하므로 #1 divergence 케이스를 표현 불가).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  getTradingMode: vi.fn().mockReturnValue('SHADOW'),
  getMacroEntryOverrideState: vi.fn().mockReturnValue(null),
}));
vi.mock('../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
  escapeHtml: vi.fn((text: string) => text),
}));
vi.mock('../../observability/operationalWarn.js', () => ({
  emitOperationalWarn: vi.fn(),
  defaultWarnTtlSec: vi.fn().mockReturnValue(300),
}));
vi.mock('../../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn().mockReturnValue({ vix: 15, vkospi: 18, mhs: 60, vixHistory: [] }),
}));
vi.mock('../../persistence/watchlistRepo.js', () => ({
  loadWatchlist: vi.fn().mockReturnValue([{ code: '005930', name: 'Samsung' }]),
}));
vi.mock('../../persistence/r3SanityBlockRepo.js', () => ({
  acknowledgeR3SanityBlock: vi.fn(),
  isR3SanityAckTokenValid: vi.fn().mockReturnValue(false),
  getEffectiveR3SanityBlockState: vi.fn().mockReturnValue({ active: false }),
}));
vi.mock('../../persistence/r3ViolationStreakRepo.js', () => ({
  getEffectiveR3ViolationStreak: vi.fn().mockReturnValue({
    schemaVersion: 1, violation: 'NONE', regime: '', consecutiveCount: 0,
    firstSeenAt: '', lastSeenAt: '', scanIds: [],
  }),
}));
vi.mock('./r3SanityProfiles.js', () => ({
  getR3SanityProfile: vi.fn().mockReturnValue({ shadowOnlyAt: 3 }),
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
  computeSlotConsumption: vi.fn().mockReturnValue({ isFull: false, consumed: 2, rawCount: 2 }),
}));
vi.mock('../volumeClock.js', () => ({
  checkVolumeClockWindow: vi.fn().mockReturnValue({ allowEntry: true, scoreBonus: 0, reason: '' }),
}));
vi.mock('../../calendar/krxTradingCalendar.js', () => ({
  isKrxTradingDay: vi.fn().mockReturnValue(true),
}));
vi.mock('./r3StreakSkipPolicy.js', () => ({
  evaluateR3CountableScan: vi.fn().mockReturnValue({ countable: true, skipReason: undefined }),
}));
vi.mock('../../persistence/conditionWeightsRepo.js', () => ({
  loadConditionWeights: vi.fn().mockReturnValue({}),
  getConditionWeightsUpdatedAt: vi.fn().mockReturnValue(new Date().toISOString()),
}));
vi.mock('../../learning/learningFreshnessGuard.js', () => ({
  applyFreshnessDecayToNeutralWeightedRecord: vi.fn((w: unknown) => w),
}));
vi.mock('../entryEngine.js', () => ({
  isOpenShadowStatus: vi.fn().mockReturnValue(true),
}));
vi.mock('./scanDiagnostics.js', () => ({
  buildMacroGateState: vi.fn((s: Record<string, unknown>) => s),
}));
vi.mock('./preflightLearningRecorder.js', () => ({
  captureSupplyHealthSnapshot: vi.fn().mockResolvedValue({}),
  recordBlockedDayShadowScan: vi.fn().mockResolvedValue(undefined),
  recordPreflightBlockedScan: vi.fn().mockResolvedValue(undefined),
  recordPreflightUniverseLearningSnapshot: vi.fn().mockResolvedValue(undefined),
}));

// 정본 vs deprecated 분리 제어: resolveRegimeSnapshot 을 직접 mock 한다.
//   snapshot.effectiveRegime          = 정본(Gate0, ADR-0531)  → learningRegime 입력
//   snapshot.diagnostics.effectiveRegime = deprecated R6-recovery 강등 → learningRegime 입력 아님(회귀 가드)
const { mockResolveRegimeSnapshot } = vi.hoisted(() => ({ mockResolveRegimeSnapshot: vi.fn() }));
vi.mock('../regime/regimeResolver.js', () => ({
  resolveRegimeSnapshot: mockResolveRegimeSnapshot,
}));

import { runPreflight } from './preflight.js';

function buildSnapshot(input: { effectiveRegime: string; diagnosticsEffectiveRegime: string }): unknown {
  return {
    snapshotId: 'snap-1',
    asOf: new Date().toISOString(),
    ttlSec: 3600,
    detectedRegime: input.effectiveRegime,
    effectiveRegime: input.effectiveRegime, // 정본
    displayRegime: input.effectiveRegime,
    riskOverride: 'NONE',
    engineMode: 'NORMAL',
    biasScore: 0,
    mhs: 60,
    dataHealth: {},
    sourceHealth: 'VERIFIED',
    stale: false,
    providerIssue: false,
    marketSignal: false,
    conflicts: [],
    macroState: { vix: 15, vkospi: 18, mhs: 60 },
    marketState: { macroState: { ageSec: 10, freshness: 'FRESH' } },
    diagnostics: {
      rawRegime: 'R3_EARLY',
      effectiveRegime: input.diagnosticsEffectiveRegime, // deprecated 강등 값
      sourceFreshness: 'FRESH',
      r6RecoveryStatus: 'NOT_R6',
      cooldownUntil: undefined,
      recoveryBlockedReason: undefined,
      recoveryEvidence: { vkospiTrustState: 'TRUSTED', reasons: ['OK'] },
    },
  };
}

describe('preflight learningRegime carry v2 — 정본 snapshot.effectiveRegime 파생', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KIS_APP_KEY = 'test-key';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('#1 핵심 재현: 정본 effectiveRegime=R3_EARLY + diagnostics 강등=R4_NEUTRAL → learningRegime=R3_EARLY', async () => {
    // 운영 실측 2026-06-18: rawRegime=R3_EARLY, Scoring Effective=R3_EARLY 인데 diagnostics 가
    // R6-recovery cap 으로 R4_NEUTRAL 강등. 이전 #1383 수리(diagnostics 파생)는 여기서 R4_NEUTRAL 을
    // 산출해 실패했어야 한다 — 이 케이스가 회귀 가드. v2 수리는 정본을 읽어 R3_EARLY 를 유지한다.
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ effectiveRegime: 'R3_EARLY', diagnosticsEffectiveRegime: 'R4_NEUTRAL' }),
    );
    const result = await runPreflight();
    expect(result.context.learningRegime).toBe('R3_EARLY');
    // live regime 은 정본 effectiveRegime(R3_EARLY)이 canonical 키이므로 그대로 R3_EARLY.
    expect(result.context.regime).toBe('R3_EARLY');
  });

  it('#2 R6-leak: 정본 effectiveRegime=R3_NORMAL(확장) → learningRegime=R3_EARLY, live regime=R4_NEUTRAL clamp', async () => {
    // ADR-0118 확장 어휘 누수: 정본이 R3_NORMAL 이면 observedRegime → REGIME_CONFIGS 키 부재 → live
    // regime R4_NEUTRAL clamp(byte-equivalent 보존). learningRegime 은 canonical R3_EARLY 로 정규화.
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ effectiveRegime: 'R3_NORMAL', diagnosticsEffectiveRegime: 'R4_NEUTRAL' }),
    );
    const result = await runPreflight();
    expect(result.context.learningRegime).toBe('R3_EARLY');
    expect(result.context.regime).toBe('R4_NEUTRAL');
  });

  it('#3 정본 effectiveRegime=R5_STABILIZING → learningRegime=R5_CAUTION', async () => {
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ effectiveRegime: 'R5_STABILIZING', diagnosticsEffectiveRegime: 'R4_NEUTRAL' }),
    );
    const result = await runPreflight();
    expect(result.context.learningRegime).toBe('R5_CAUTION');
  });

  it('#4 canonical 그대로(정본 R4_NEUTRAL) → learningRegime=R4_NEUTRAL', async () => {
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ effectiveRegime: 'R4_NEUTRAL', diagnosticsEffectiveRegime: 'R4_NEUTRAL' }),
    );
    const result = await runPreflight();
    expect(result.context.learningRegime).toBe('R4_NEUTRAL');
    expect(result.context.regime).toBe('R4_NEUTRAL');
  });

  it('#5 live regime byte-equivalent: diagnostics 강등 값과 무관하게 정본 effectiveRegime 만이 live regime 결정', async () => {
    // diagnostics.effectiveRegime 를 R6_DEFENSE 로 극단 강등해도 live regime 은 정본(R3_EARLY)에서만 파생.
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ effectiveRegime: 'R3_EARLY', diagnosticsEffectiveRegime: 'R6_DEFENSE' }),
    );
    const result = await runPreflight();
    expect(result.context.regime).toBe('R3_EARLY'); // 강등 R6 이 live regime 으로 누수되지 않음
    expect(result.context.learningRegime).toBe('R3_EARLY');
  });
});
