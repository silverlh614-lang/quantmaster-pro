/**
 * @responsibility runPreflight r3StreakSkipped 반출 회귀 가드 — 휴장일 carry + 거래일 필드 부재 byte-identical (ADR-0412 복원).
 *
 * Fix B (architect contract §B/§C-2): preflight 가 r3Countability(evaluateR3CountableScan,
 * 실모듈) 를 최종 정상 return(R6) top-level `r3StreakSkipped` 로 반출하는지 검증.
 * countable=true(거래일) 시 undefined — persistScanResults options byte-identical 계약.
 * mock 하네스는 preflightR3Gate1PassZeroDeprecation.test.ts 패턴 재사용 (밀폐 — 네트워크/실 캘린더 0).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PR #1427 패턴 — 영속 side-effect 가 실 DATA_DIR(data/) 을 오염시키지 않도록
// import hoisting 이전에 일회용 디렉터리로 격리 (persistence 계열은 전부 mock 이지만 방어적).
await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  process.env.PERSIST_DATA_DIR = mkdtempSync(join(tmpdir(), 'preflight-r3carry-test-'));
});

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
    asOf: '2026-07-04T00:00:00.000Z',
    ttlSec: 300,
    effectiveRegime: 'R3_EARLY',
    displayRegime: 'R3_EARLY',
    riskOverride: 'NONE',
    engineMode: 'NORMAL',
    sourceHealth: 'VERIFIED',
    providerIssue: false,
    conflicts: [],
    marketState: { macroState: { ageSec: 10, freshness: 'FRESH' } },
    diagnostics: {
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      recoveryBlockedReason: undefined,
      cooldownUntil: undefined,
      sourceFreshness: 'FRESH',
      recoveryEvidence: {
        vkospiTrustState: 'TRUSTED',
        reasons: ['R6_RECOVERY_EVIDENCE_OK'],
      },
    },
  }),
}));
vi.mock('../../../src/services/quant/regimeEngine.js', () => {
  const REGIME_CONFIGS: Record<string, unknown> = {
    R3_EARLY: { kellyMultiplier: 0.7, maxPositions: 5, sellOnlyException: { enabled: false } },
    R4_NEUTRAL: { kellyMultiplier: 0.5, maxPositions: 4, sellOnlyException: { enabled: false } },
    R5_CAUTION: { gate2Required: 10, gate3Required: 8, kellyMultiplier: 0.3, maxPositions: 2, sellOnlyException: { enabled: false } },
  };
  return {
    REGIME_CONFIGS,
    toCanonicalRegimeLevel: (value: unknown): string | undefined => {
      if (typeof value !== 'string' || value.length === 0) return undefined;
      if (Object.prototype.hasOwnProperty.call(REGIME_CONFIGS, value)) return value;
      const prefixMap: Record<string, string> = {
        R1: 'R1_TURBO', R2: 'R2_BULL', R3: 'R3_EARLY',
        R4: 'R4_NEUTRAL', R5: 'R5_CAUTION', R6: 'R6_DEFENSE',
      };
      return prefixMap[value.slice(0, 2).toUpperCase()];
    },
  };
});
vi.mock('../../persistence/watchlistRepo.js', () => ({
  loadWatchlist: vi.fn().mockReturnValue([{ code: '005930', name: 'Samsung' }]),
}));
vi.mock('../../persistence/r3SanityBlockRepo.js', () => ({
  acknowledgeR3SanityBlock: vi.fn(),
  isR3SanityAckTokenValid: vi.fn().mockReturnValue(false),
  loadR3SanityBlockState: vi.fn().mockReturnValue({ active: false }),
  getEffectiveR3SanityBlockState: vi.fn().mockReturnValue({ active: false }),
}));
vi.mock('../../persistence/r3ViolationStreakRepo.js', () => ({
  getEffectiveR3ViolationStreak: vi.fn().mockReturnValue({
    schemaVersion: 1,
    violation: 'NONE',
    regime: '',
    consecutiveCount: 0,
    firstSeenAt: '',
    lastSeenAt: '',
    scanIds: [],
  }),
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
// 캘린더 façade 밀폐 mock — 케이스별 거래일/휴장일 제어 (실 휴일 데이터 비의존).
// r3StreakSkipPolicy 는 실모듈 사용 — 캘린더 false → KRX_NON_TRADING_DAY 실판정 검증.
vi.mock('../../calendar/krxTradingCalendar.js', () => ({
  isKrxTradingDay: vi.fn().mockReturnValue(true),
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
import { isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';

const mockedIsKrxTradingDay = vi.mocked(isKrxTradingDay);

describe('runPreflight → r3StreakSkipped carry (Fix B, ADR-0412 복원)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KIS_APP_KEY = 'test-key';
    delete process.env.R3_GATE1_PASS_ZERO_HARDBLOCK_ENABLED;
    mockedIsKrxTradingDay.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('B1: 휴장일 — 정상(R6) return 에 r3StreakSkipped={skipped:true, reason:KRX_NON_TRADING_DAY} carry', async () => {
    mockedIsKrxTradingDay.mockReturnValue(false);
    const result = await runPreflight();
    // 휴장일에도 preflight 는 abort 하지 않는다 (불변식 4/5 — observe 스캔 지속).
    expect(result.shouldAbort).toBe(false);
    expect(result.r3StreakSkipped).toEqual({ skipped: true, reason: 'KRX_NON_TRADING_DAY' });
  });

  it('B2: 거래일 healthy — r3StreakSkipped undefined (필드 falsy — persist options byte-identical)', async () => {
    mockedIsKrxTradingDay.mockReturnValue(true);
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(false);
    expect(result.r3StreakSkipped).toBeUndefined();
    // 호출부 조건부 스프레드(`...(x ? {...} : {})`)가 필드 자체를 싣지 않음을 보장.
    expect(result.r3StreakSkipped ? { r3StreakSkipped: result.r3StreakSkipped } : {}).toEqual({});
  });

  it('B3: KIS_APP_KEY 부재 abort (R1) — skipPersist=false + r3StreakSkipped 부재 (산출 전 return 계약 고정)', async () => {
    delete process.env.KIS_APP_KEY;
    const result = await runPreflight();
    expect(result.shouldAbort).toBe(true);
    expect(result.skipPersist).toBe(false);
    expect('r3StreakSkipped' in result).toBe(false);
  });
});
