// @responsibility ADR-0593 regimeBridge wiring 회귀 — flag OFF byte-equivalent(폭락 다음날 R4 유지) / flag ON + 3가드 충족 R3_EARLY 승급 / today·breadth freshness 가드 / R3 캡.
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import type { MacroState } from '../persistence/macroStateRepo.js';

const settingsMock = vi.hoisted(() => ({ loadTradingSettings: vi.fn() }));
vi.mock('../persistence/tradingSettingsRepo.js', async (importActual) => ({
  ...(await importActual<typeof import('../persistence/tradingSettingsRepo.js')>()),
  loadTradingSettings: settingsMock.loadTradingSettings,
}));

import { buildRegimeVars, getRawRegime } from './regimeBridge.js';
import { classifyRegime } from '../../src/services/quant/regimeEngine.js';

// 2026-06-09(화) 11:00 KST. 어제 폭락(2026-06-08), 오늘 강반등 시나리오.
const NOW = new Date('2026-06-09T02:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const TODAY_KEY = '2026-06-09';
const YESTERDAY_KEY = '2026-06-08';

beforeEach(() => {
  settingsMock.loadTradingSettings.mockReturnValue({ r6RecoveryFastTrack: { enabled: false } } as never);
});

afterEach(() => {
  delete process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED;
  delete process.env.REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT;
  delete process.env.REGIME_RISK_ON_FAST_UPGRADE_BREADTH_MIN_RATIO;
  delete process.env.R6_KOSPI_INTRADAY_QUOTE_TTL_SEC;
  settingsMock.loadTradingSettings.mockReset();
});

// 폭락 다음날 강반등: 봉 종가는 어제 폭락(-6 day, 하지만 close 회복으로 R6 미진입 가정) 잔재로
// classifyRegime 정상/강제 경로 전부 실패 → 평소엔 R4 fall-through.
function crashReboundMacro(overrides: Partial<MacroState> = {}): MacroState {
  return {
    mhs: 38,                       // R3 정상 경로 MHS>=40 미달
    regime: 'GREEN',
    updatedAt: NOW_ISO,
    vkospi: 26,
    vkospiDayChange: -3,           // 진정 중(VKOSPI 가드 통과)
    usdKrwDayChange: 0.5,
    usdKrw20dChange: 1,
    kospiDayReturn: -1.5,          // 봉 기준(R6 미진입), 강제승급 미달
    kospiCloseReturn: -1.5,
    kospi20dReturn: -8,            // R3 정상 신호 부족
    kospiAbove20MA: false,
    kospiAbove60MA: false,
    kospiAboveMA20Pct: -2,         // 강제 승급(>3) 미달
    foreignContinuousBuyDays: 0,   // 강제 승급(>=1) 미달
    foreignNetBuy5d: -1000,
    vkospi5dTrend: 1,
    spx20dReturn: -4,
    vix: 26,
    dxy5dChange: 1,
    shortSellingRatio: 5,
    // ADR-0593 입력: 오늘 강반등 intraday + breadth (today-fresh)
    kospiIntradayReturn: 4.2,
    kospiIntradaySourceTradeDate: TODAY_KEY,
    kospiIntradayFetchedAt: NOW_ISO,
    kospiAdvanceCount: 700,
    kospiDeclineCount: 200,        // ratio = 0.777 (>= 0.6)
    kospiBreadthFetchedAt: NOW_ISO,
    ...overrides,
  };
}

describe('ADR-0593 regimeBridge risk-on fast-upgrade', () => {
  it('flag OFF (default) → 폭락 다음날 R4_NEUTRAL 유지 (byte-equivalent)', () => {
    const macro = crashReboundMacro();
    const vars = buildRegimeVars(macro, NOW);
    expect(vars.riskOnFastUpgradeEligible).toBeUndefined();
    expect(vars.kospiDayReturnToday).toBeUndefined();
    expect(vars.marketBreadthAdvanceRatio).toBeUndefined();
    expect(classifyRegime(vars)).toBe('R4_NEUTRAL');
    expect(getRawRegime(macro, NOW)).toBe('R4_NEUTRAL');
  });

  it('flag ON + 3가드 충족 → R3_EARLY 승급', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    const macro = crashReboundMacro();
    const vars = buildRegimeVars(macro, NOW);
    expect(vars.kospiDayReturnToday).toBeCloseTo(4.2, 5);
    expect(vars.marketBreadthAdvanceRatio).toBeCloseTo(700 / 900, 5);
    expect(vars.riskOnFastUpgradeEligible).toBe(true);
    expect(classifyRegime(vars)).toBe('R3_EARLY');
    expect(getRawRegime(macro, NOW)).toBe('R3_EARLY');
  });

  it('flag ON 이지만 intraday 거래일이 어제(stale) → 미승급 R4 (freshness 가드)', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    const macro = crashReboundMacro({ kospiIntradaySourceTradeDate: YESTERDAY_KEY });
    const vars = buildRegimeVars(macro, NOW);
    expect(vars.kospiDayReturnToday).toBeUndefined();
    expect(vars.riskOnFastUpgradeEligible).toBe(false);
    expect(classifyRegime(vars)).toBe('R4_NEUTRAL');
  });

  it('flag ON 이지만 fetchedAt TTL 초과(carry-forward stale) → 미승급 R4', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    process.env.R6_KOSPI_INTRADAY_QUOTE_TTL_SEC = '900';
    const stale = new Date(NOW.getTime() - 2000 * 1000).toISOString(); // 2000s > 900s
    const macro = crashReboundMacro({ kospiIntradayFetchedAt: stale });
    const vars = buildRegimeVars(macro, NOW);
    expect(vars.kospiDayReturnToday).toBeUndefined();
    expect(vars.riskOnFastUpgradeEligible).toBe(false);
    expect(classifyRegime(vars)).toBe('R4_NEUTRAL');
  });

  it('flag ON 이지만 breadth 부재 → 미승급 R4 (보수, 불변식 #6)', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    const macro = crashReboundMacro({ kospiAdvanceCount: undefined, kospiDeclineCount: undefined, kospiBreadthFetchedAt: undefined });
    const vars = buildRegimeVars(macro, NOW);
    expect(vars.marketBreadthAdvanceRatio).toBeUndefined();
    expect(vars.riskOnFastUpgradeEligible).toBe(false);
    expect(classifyRegime(vars)).toBe('R4_NEUTRAL');
  });

  it('flag ON + breadth 열위(하락 우세) → 미승급 R4', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    const macro = crashReboundMacro({ kospiAdvanceCount: 300, kospiDeclineCount: 600 }); // ratio 0.333
    const vars = buildRegimeVars(macro, NOW);
    expect(vars.marketBreadthAdvanceRatio).toBeCloseTo(1 / 3, 5);
    expect(vars.riskOnFastUpgradeEligible).toBe(false);
    expect(classifyRegime(vars)).toBe('R4_NEUTRAL');
  });

  it('승급 캡 = R3_EARLY (R2/R1 직행 금지) — fast-upgrade 단독으로는 R3 까지만', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    const macro = crashReboundMacro();
    expect(getRawRegime(macro, NOW)).toBe('R3_EARLY'); // R2/R1 아님
  });
});
