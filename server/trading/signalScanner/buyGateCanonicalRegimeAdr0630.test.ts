// @responsibility ADR-0630 D1 회귀 — 매수/shadow 게이트 정본 raw(detectedRegime) 단일화 flag 분기 + 라이브 #8 byte-identical.
//
// D1: BUY_GATE_CANONICAL_REGIME_ENABLED ON 이면 preflight learningRegime 을 정본 raw
// (regimeSnapshot.detectedRegime = diagnostics.rawRegime, R6-recovery R5_STABILIZING override 미경유)에서
// 우선 파생한다. snapshot.effectiveRegime 이 R5_STABILIZING latch 로 오염돼도 learningRegime 은 R3_EARLY(raw).
// flag OFF → 현행 effectiveRegime 경로 byte-identical. 라이브 regime/Kelly 는 양 모드 무영향(불변식 #8).
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
// buildMacroGateState 를 identity 로 mock — context.macroGateState 의 learningRegime 병기 검증.
vi.mock('./scanDiagnostics.js', () => ({
  buildMacroGateState: vi.fn((s: Record<string, unknown>) => s),
}));
vi.mock('./preflightLearningRecorder.js', () => ({
  captureSupplyHealthSnapshot: vi.fn().mockResolvedValue({}),
  recordBlockedDayShadowScan: vi.fn().mockResolvedValue(undefined),
  recordPreflightBlockedScan: vi.fn().mockResolvedValue(undefined),
  recordPreflightUniverseLearningSnapshot: vi.fn().mockResolvedValue(undefined),
}));

const { mockResolveRegimeSnapshot } = vi.hoisted(() => ({ mockResolveRegimeSnapshot: vi.fn() }));
vi.mock('../regime/regimeResolver.js', () => ({
  resolveRegimeSnapshot: mockResolveRegimeSnapshot,
}));

import { runPreflight } from './preflight.js';

// D1 핵심: detectedRegime(정본 raw) 과 effectiveRegime(R5 오버레이 오염 가능)을 독립 제어.
function buildSnapshot(input: { detectedRegime?: string; effectiveRegime: string }): unknown {
  return {
    snapshotId: 'snap-1',
    asOf: new Date().toISOString(),
    ttlSec: 3600,
    detectedRegime: input.detectedRegime,
    effectiveRegime: input.effectiveRegime,
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
      rawRegime: input.detectedRegime ?? input.effectiveRegime,
      effectiveRegime: input.effectiveRegime,
      sourceFreshness: 'FRESH',
      r6RecoveryStatus: 'NOT_R6',
      cooldownUntil: undefined,
      recoveryBlockedReason: undefined,
      recoveryEvidence: { vkospiTrustState: 'TRUSTED', reasons: ['OK'] },
    },
  };
}

describe('ADR-0630 D1 — 매수 게이트 정본 raw 단일화 (BUY_GATE_CANONICAL_REGIME_ENABLED)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KIS_APP_KEY = 'test-key';
    delete process.env.BUY_GATE_CANONICAL_REGIME_ENABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('(a) flag OFF — learningRegime 은 현행 effectiveRegime 경로 byte-identical (오염 R5_STABILIZING → R5_CAUTION)', async () => {
    // flag 미설정. 정본 raw=R3_EARLY 인데 effectiveRegime 이 R5 오버레이로 오염.
    // OFF 경로는 effectiveRegime 만 읽으므로 learningRegime=R5_CAUTION (현행 동작 보존).
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ detectedRegime: 'R3_EARLY', effectiveRegime: 'R5_STABILIZING' }),
    );
    const result = await runPreflight();
    expect(result.context.learningRegime).toBe('R5_CAUTION');
  });

  it('(b) flag ON + snapshot.effectiveRegime=R5_STABILIZING 오염 → learningRegime=R3_EARLY (detectedRegime 우회)', async () => {
    process.env.BUY_GATE_CANONICAL_REGIME_ENABLED = 'true';
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ detectedRegime: 'R3_EARLY', effectiveRegime: 'R5_STABILIZING' }),
    );
    const result = await runPreflight();
    // 정본 raw 우회로 R5 오버레이를 무시하고 R3_EARLY 회복 (OFF 의 R5_CAUTION 을 뒤집음).
    expect(result.context.learningRegime).toBe('R3_EARLY');
  });

  it('(c) 라이브 regime/Kelly 불변(#8) — flag ON/OFF 무관 동일값', async () => {
    const snap = () => buildSnapshot({ detectedRegime: 'R3_EARLY', effectiveRegime: 'R5_STABILIZING' });

    delete process.env.BUY_GATE_CANONICAL_REGIME_ENABLED;
    mockResolveRegimeSnapshot.mockReturnValue(snap());
    const off = await runPreflight();

    process.env.BUY_GATE_CANONICAL_REGIME_ENABLED = 'true';
    mockResolveRegimeSnapshot.mockReturnValue(snap());
    const on = await runPreflight();

    // 라이브 regime 은 effectiveRegime(R5_STABILIZING → REGIME_CONFIGS 키 부재 → R4_NEUTRAL clamp)에서만 파생 → 양 모드 동일.
    expect(on.context.regime).toBe(off.context.regime);
    expect(on.context.regimeConfig?.kellyMultiplier).toBe(off.context.regimeConfig?.kellyMultiplier);
    // 바뀌는 것은 learningRegime(shadow 전용)뿐.
    expect(off.context.learningRegime).toBe('R5_CAUTION');
    expect(on.context.learningRegime).toBe('R3_EARLY');
  });

  it('(d) 진단 문자열 — macroGateState 에 learningRegime 병기 (clamp regime 단독 오표시 제거)', async () => {
    process.env.BUY_GATE_CANONICAL_REGIME_ENABLED = 'true';
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ detectedRegime: 'R3_EARLY', effectiveRegime: 'R5_STABILIZING' }),
    );
    const result = await runPreflight();
    // persistScanResults noEligibleReason 이 macroGate.learningRegime 을 표시(`learning=R3_EARLY`).
    const macroGate = (result as { macroGateState?: { learningRegime?: string; regime?: string } }).macroGateState;
    expect(macroGate?.learningRegime).toBe('R3_EARLY');
    // 라이브 clamp regime 은 R4_NEUTRAL — 운영자 헛다리(오진)의 원인이던 단독 표시.
    expect(macroGate?.regime).toBe('R4_NEUTRAL');
  });

  it('(e) flag ON + detectedRegime 부재 → effectiveRegime 경로 폴백 (현행 동작 유지)', async () => {
    process.env.BUY_GATE_CANONICAL_REGIME_ENABLED = 'true';
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ detectedRegime: undefined, effectiveRegime: 'R5_STABILIZING' }),
    );
    const result = await runPreflight();
    // detectedRegime 결손 → toCanonicalRegimeLevel(effectiveRegime) 폴백 → R5_CAUTION.
    expect(result.context.learningRegime).toBe('R5_CAUTION');
  });

  it('(f) 밴드 확대 기각 가드 — flag ON + 정본 raw=R2_BULL → learningRegime=R2_BULL (R3_EARLY 게이트 미발화)', async () => {
    process.env.BUY_GATE_CANONICAL_REGIME_ENABLED = 'true';
    mockResolveRegimeSnapshot.mockReturnValue(
      buildSnapshot({ detectedRegime: 'R2_BULL', effectiveRegime: 'R5_STABILIZING' }),
    );
    const result = await runPreflight();
    // D1.2 미채택: shadow lane 게이트는 여전히 === 'R3_EARLY'. R2_BULL 은 별도 라이브/일반 shadow 경로.
    expect(result.context.learningRegime).toBe('R2_BULL');
  });
});
