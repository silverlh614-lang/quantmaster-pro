// @responsibility ADR-0664 getRegimeDiagnostics 히스테리시스 wiring 회귀 — flag OFF 즉시(byte-identical) / ON 보류→dwell 후 채택 / R6 즉시 예외.
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import type { MacroState } from '../persistence/macroStateRepo.js';

const settingsMock = vi.hoisted(() => ({ loadTradingSettings: vi.fn() }));
vi.mock('../persistence/tradingSettingsRepo.js', async (importActual) => ({
  ...(await importActual<typeof import('../persistence/tradingSettingsRepo.js')>()),
  loadTradingSettings: settingsMock.loadTradingSettings,
}));

import { getRegimeDiagnostics, getRawRegime } from './regimeBridge.js';
import {
  defaultRegimeTransitionState,
  resetRegimeTransitionStateForTests,
} from '../persistence/regimeTransitionStateRepo.js';

const NOW = new Date('2026-06-19T02:00:00.000Z'); // 11:00 KST
const NOW_ISO = NOW.toISOString();
const TODAY_KEY = '2026-06-19';

beforeEach(() => {
  settingsMock.loadTradingSettings.mockReturnValue({ r6RecoveryFastTrack: { enabled: false } } as never);
  // raw=R3_EARLY 를 결정적으로 만들기 위해 fast-upgrade ON + 3가드 충족.
  process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
  process.env.R6_KOSPI_INTRADAY_QUOTE_TTL_SEC = '3600';
  // confirmed = R4_NEUTRAL 로 초기화.
  resetRegimeTransitionStateForTests(defaultRegimeTransitionState(NOW_ISO));
});

afterEach(() => {
  delete process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED;
  delete process.env.R6_KOSPI_INTRADAY_QUOTE_TTL_SEC;
  delete process.env.REGIME_HYSTERESIS_ENABLED;
  delete process.env.REGIME_HYSTERESIS_MIN_DWELL_MIN;
  delete process.env.REGIME_HYSTERESIS_MIN_CONFIRMATIONS;
  resetRegimeTransitionStateForTests(defaultRegimeTransitionState());
  settingsMock.loadTradingSettings.mockReset();
});

// fast-upgrade 3가드 충족(오늘 강반등 intraday + breadth) → raw R3_EARLY.
function r3Macro(overrides: Partial<MacroState> = {}): MacroState {
  return {
    mhs: 38, regime: 'GREEN', updatedAt: NOW_ISO,
    vkospi: 26, vkospiDayChange: -3, usdKrwDayChange: 0.5, usdKrw20dChange: 1,
    kospiDayReturn: -1.5, kospiCloseReturn: -1.5, kospi20dReturn: -8,
    kospiAbove20MA: false, kospiAbove60MA: false, kospiAboveMA20Pct: -2,
    foreignContinuousBuyDays: 0, foreignNetBuy5d: -1000,
    vkospi5dTrend: 1, spx20dReturn: -4, vix: 26, dxy5dChange: 1, shortSellingRatio: 5,
    kospiIntradayReturn: 4.2, kospiIntradaySourceTradeDate: TODAY_KEY, kospiIntradayFetchedAt: NOW_ISO,
    kospiAdvanceCount: 700, kospiDeclineCount: 200, kospiBreadthFetchedAt: NOW_ISO,
    ...overrides,
  } as MacroState;
}

describe('ADR-0664 getRegimeDiagnostics 히스테리시스 wiring', () => {
  it('전제: r3Macro 의 rawRegime 은 R3_EARLY', () => {
    expect(getRawRegime(r3Macro(), NOW)).toBe('R3_EARLY');
  });

  it('flag OFF (default) → effective 즉시 R3_EARLY (byte-identical)', () => {
    delete process.env.REGIME_HYSTERESIS_ENABLED;
    const diag = getRegimeDiagnostics(r3Macro(), NOW);
    expect(diag.effectiveRegime).toBe('R3_EARLY');
  });

  it('flag ON → 첫 관측은 confirmed(R4) 보류, pending=R3_EARLY', () => {
    process.env.REGIME_HYSTERESIS_ENABLED = 'true';
    process.env.REGIME_HYSTERESIS_MIN_DWELL_MIN = '15';
    const diag = getRegimeDiagnostics(r3Macro(), NOW);
    expect(diag.effectiveRegime).toBe('R4_NEUTRAL'); // 아직 안 바뀜(안정)
    expect(diag.transitionReason).toBe('REGIME_HYSTERESIS_HOLD:R3_EARLY');
    expect(diag.transitionState.pendingEffectiveRegime).toBe('R3_EARLY');
  });

  it('flag ON → 같은 후보가 dwell 경과 후 재관측되면 R3_EARLY 채택', () => {
    process.env.REGIME_HYSTERESIS_ENABLED = 'true';
    process.env.REGIME_HYSTERESIS_MIN_DWELL_MIN = '15';
    getRegimeDiagnostics(r3Macro(), NOW); // 보류(pending since=NOW)
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const diag = getRegimeDiagnostics(r3Macro({ updatedAt: later.toISOString() }), later);
    expect(diag.effectiveRegime).toBe('R3_EARLY'); // dwell 경과 → 채택
    expect(diag.transitionState.pendingEffectiveRegime).toBeUndefined();
  });
});
