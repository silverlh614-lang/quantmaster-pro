// @responsibility ADR-0590 regimeBridge wiring 회귀 — trade-date 강등 / intraday recovery 공급 / flag OFF byte-equivalent / KIS 실패 carry-forward.
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import type { MacroState } from '../persistence/macroStateRepo.js';
import { defaultRegimeTransitionState } from '../persistence/regimeTransitionStateRepo.js';

const settingsMock = vi.hoisted(() => ({ loadTradingSettings: vi.fn() }));
vi.mock('../persistence/tradingSettingsRepo.js', async (importActual) => ({
  ...(await importActual<typeof import('../persistence/tradingSettingsRepo.js')>()),
  loadTradingSettings: settingsMock.loadTradingSettings,
}));

import { evaluateR6RecoveryTransition, getRawRegime } from './regimeBridge.js';

// 2026-06-09(화) 11:00 KST = KRX 거래일. 어제 = 2026-06-08(월) 거래일.
const NOW = new Date('2026-06-09T02:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const TODAY_KEY = '2026-06-09';
const YESTERDAY_KEY = '2026-06-08';

beforeEach(() => {
  settingsMock.loadTradingSettings.mockReturnValue({ r6RecoveryFastTrack: { enabled: false } } as never);
});

afterEach(() => {
  delete process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED;
  delete process.env.R6_INTRADAY_REBOUND_RELEASE_ENABLED;
  delete process.env.R6_KOSPI_INTRADAY_QUOTE_TTL_SEC;
  delete process.env.R6_STRONG_REBOUND_DECAY_ENABLED;
  delete process.env.R6_STRONG_REBOUND_THRESHOLD_PCT;
  delete process.env.R6_STRONG_REBOUND_DECAY_FLOOR;
  delete process.env.MACRO_STATE_TTL_SEC;
  settingsMock.loadTradingSettings.mockReset();
});

function macro(overrides: Partial<MacroState> = {}): MacroState {
  return {
    mhs: 70,
    regime: 'GREEN',
    updatedAt: NOW_ISO,
    kospiTriggerSourceUpdatedAt: NOW_ISO,
    vkospi: 18,
    vkospiDayChange: -2,
    usdKrwDayChange: 0.5,
    usdKrw20dChange: -1,
    kospiDayReturn: -4.0,     // stale (어제 폭락 봉)
    kospiCloseReturn: -4.0,
    kospi20dReturn: -2,
    kospiAbove20MA: true,
    kospiAbove60MA: false,
    foreignNetBuy5d: 1000,
    vkospi5dTrend: -4,
    spx20dReturn: 2,
    vix: 17,
    dxy5dChange: -1,
    shortSellingRatio: 5,
    ...overrides,
  };
}

describe('ADR-0590 regimeBridge wiring', () => {
  // 케이스 6: flag ON + intraday FRESH + 오늘 +3% → kospiDayReturnOk=true (결함 B 회귀 방지).
  it('uses today intraday return for recovery evidence when REBOUND_RELEASE flag ON (defect B)', () => {
    process.env.R6_INTRADAY_REBOUND_RELEASE_ENABLED = 'true';
    const reboundMacro = macro({
      kospiDayReturn: -4.0,            // stale 어제 폭락
      kospiCloseReturn: -4.0,
      kospiIntradayReturn: 3.2,        // 오늘 intraday 반등
      kospiIntradaySourceTradeDate: TODAY_KEY,
      kospiIntradayFetchedAt: NOW_ISO, // fetchedAt 신선(<TTL)
    });
    const state = evaluateR6RecoveryTransition(
      { ...defaultRegimeTransitionState(NOW_ISO), effectiveRegime: 'R6_DEFENSE', r6RecoveryStatus: 'R6_DEFENSE', r6StateMachineState: 'R6_DEFENSE' },
      reboundMacro,
      'R3_EARLY',
      NOW,
    );
    expect(state.r6RecoveryEvidence.kospiDayReturnOk).toBe(true);
    expect(state.r6TriggerBreakdown.intradayReturnUsed).toBe(true);
  });

  // 케이스 7: flag ON + intraday stale(어제 거래일) → 기존 close-return 폴백(우회 0).
  it('falls back to stale close-return when intraday source trade-date is yesterday', () => {
    process.env.R6_INTRADAY_REBOUND_RELEASE_ENABLED = 'true';
    const staleIntradayMacro = macro({
      kospiCloseReturn: -4.0,
      kospiIntradayReturn: 3.2,
      kospiIntradaySourceTradeDate: YESTERDAY_KEY, // 어제 — 오늘 거래일 아님 → 미사용
    });
    const state = evaluateR6RecoveryTransition(
      { ...defaultRegimeTransitionState(NOW_ISO), effectiveRegime: 'R6_DEFENSE', r6RecoveryStatus: 'R6_DEFENSE', r6StateMachineState: 'R6_DEFENSE' },
      staleIntradayMacro,
      'R3_EARLY',
      NOW,
    );
    expect(state.r6RecoveryEvidence.kospiDayReturnOk).toBe(false); // -4.0 close-return 폴백
    expect(state.r6TriggerBreakdown.intradayReturnUsed).toBe(false);
  });

  // 케이스 8: REBOUND_RELEASE flag OFF → intraday 값 있어도 live confirmation 미기여(shadow 관측만).
  it('ignores intraday return for live evidence when REBOUND_RELEASE flag OFF (byte-equivalent)', () => {
    const reboundMacro = macro({
      kospiCloseReturn: -4.0,
      kospiIntradayReturn: 3.2,
      kospiIntradaySourceTradeDate: TODAY_KEY,
    });
    const state = evaluateR6RecoveryTransition(
      { ...defaultRegimeTransitionState(NOW_ISO), effectiveRegime: 'R6_DEFENSE', r6RecoveryStatus: 'R6_DEFENSE', r6StateMachineState: 'R6_DEFENSE' },
      reboundMacro,
      'R3_EARLY',
      NOW,
    );
    expect(state.r6RecoveryEvidence.kospiDayReturnOk).toBe(false); // intraday 무시 → -4.0 폴백
    expect(state.r6TriggerBreakdown.intradayReturnUsed).toBe(false);
  });

  // 케이스 9: KIS quote 실패(intradayReturn 미설정) → recovery 기존 경로(byte-equivalent).
  it('uses legacy path when intraday return is missing (KIS carry-forward)', () => {
    process.env.R6_INTRADAY_REBOUND_RELEASE_ENABLED = 'true';
    const noIntradayMacro = macro({ kospiCloseReturn: 0.5, kospiDayReturn: 0.5 }); // 정상 close-return
    const state = evaluateR6RecoveryTransition(
      { ...defaultRegimeTransitionState(NOW_ISO), effectiveRegime: 'R6_DEFENSE', r6RecoveryStatus: 'R6_DEFENSE', r6StateMachineState: 'R6_DEFENSE' },
      noIntradayMacro,
      'R3_EARLY',
      NOW,
    );
    expect(state.r6RecoveryEvidence.kospiDayReturnOk).toBe(true); // 0.5 > -2 (legacy close-return)
    expect(state.r6TriggerBreakdown.intradayReturnUsed).toBe(false);
  });

  // 케이스 10a: TRADEDATE flag ON + 어제 폭락 봉 → intraday-low 트리거 active 제외(결함 A 회귀 방지).
  it('excludes yesterday bar intraday-low shock from active triggers when TRADEDATE flag ON (defect A)', () => {
    process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED = 'true';
    const yesterdayShock = macro({
      kospiTriggerSourceTradeDate: YESTERDAY_KEY,
      kospiIntradayLowReturn: -7.0,   // 어제 폭락 봉 intraday-low
      kospiCloseReturn: -0.3,
      kospiDayReturn: -0.3,
    });
    const breakdown = evaluateR6RecoveryTransition(
      defaultRegimeTransitionState(NOW_ISO),
      yesterdayShock,
      getRawRegime(yesterdayShock, NOW),
      NOW,
    ).r6TriggerBreakdown;
    // Codex 정합 정정: 글로벌 freshness 는 보존(age-only FRESH), intraday-low 만 per-trigger 제외.
    expect(breakdown.triggerFreshness).toBe('FRESH');
    expect(breakdown.activeR6Triggers).not.toContain('KOSPI_INTRADAY_LOW_SHOCK');
    expect(breakdown.staleR6Triggers).toContain('KOSPI_INTRADAY_LOW_SHOCK');
    expect(breakdown.tradeDateIsToday).toBe(false);
  });

  // 케이스 ①-a: TRADEDATE flag ON + 어제 봉 + close-shock(-5%) + intraday-low(-5%)
  //  → KOSPI_CLOSE_SHOCK active 유지, KOSPI_INTRADAY_LOW_SHOCK 만 stale.
  it('keeps close-shock active while only excluding intraday-low when TRADEDATE flag ON (defect A1)', () => {
    process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED = 'true';
    const yesterdayShock = macro({
      kospiTriggerSourceTradeDate: YESTERDAY_KEY,
      kospiIntradayLowReturn: -5.0,
      kospiCloseReturn: -5.0,         // 어제 종가 -5% (폭락 다음날 아침 정당 방어)
      kospiDayReturn: -5.0,
    });
    const breakdown = evaluateR6RecoveryTransition(
      defaultRegimeTransitionState(NOW_ISO),
      yesterdayShock,
      getRawRegime(yesterdayShock, NOW),
      NOW,
    ).r6TriggerBreakdown;
    expect(breakdown.triggerFreshness).toBe('FRESH');
    expect(breakdown.activeR6Triggers).toContain('KOSPI_CLOSE_SHOCK');
    expect(breakdown.activeR6Triggers).not.toContain('KOSPI_INTRADAY_LOW_SHOCK');
    expect(breakdown.staleR6Triggers).toContain('KOSPI_INTRADAY_LOW_SHOCK');
  });

  // 케이스 ①-b: TRADEDATE flag ON + 어제 봉 + VKOSPI_DAY_SPIKE(>30) → VKOSPI_DAY_SPIKE active 유지(age-freshness).
  it('keeps VKOSPI_DAY_SPIKE active under trade-date downgrade (separate source) when TRADEDATE flag ON (defect A2)', () => {
    process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED = 'true';
    const vkospiShock = macro({
      kospiTriggerSourceTradeDate: YESTERDAY_KEY,
      kospiIntradayLowReturn: -7.0,
      vkospiDayChange: 35,           // VKOSPI day spike (KOSPI 일봉 거래일과 무관)
      kospiCloseReturn: -0.3,
      kospiDayReturn: -0.3,
    });
    const breakdown = evaluateR6RecoveryTransition(
      defaultRegimeTransitionState(NOW_ISO),
      vkospiShock,
      getRawRegime(vkospiShock, NOW),
      NOW,
    ).r6TriggerBreakdown;
    expect(breakdown.activeR6Triggers).toContain('VKOSPI_DAY_SPIKE');
    expect(breakdown.activeR6Triggers).not.toContain('KOSPI_INTRADAY_LOW_SHOCK');
  });

  // 케이스 ①-c: trade-date 강등이 글로벌 recovery/staleCarryForward 동작을 회귀시키지 않음(기존 보존).
  //  어제 봉 + 강등 적용이어도 staleBlockedRecovery 는 글로벌 age-freshness(FRESH) 기준 → false 유지.
  it('does NOT regress global recovery/staleCarryForward via trade-date downgrade (defect A3)', () => {
    process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED = 'true';
    const yesterdayShock = macro({
      kospiTriggerSourceTradeDate: YESTERDAY_KEY,
      kospiIntradayLowReturn: -7.0,
      kospiCloseReturn: -0.3,
      kospiDayReturn: -0.3,
    });
    const breakdown = evaluateR6RecoveryTransition(
      defaultRegimeTransitionState(NOW_ISO),
      yesterdayShock,
      getRawRegime(yesterdayShock, NOW),
      NOW,
    ).r6TriggerBreakdown;
    // 글로벌 freshness FRESH → recovery 차단 side-effect 미발동(age-freshness 기반 byte-equivalent).
    expect(breakdown.triggerFreshness).toBe('FRESH');
    expect(breakdown.staleBlockedRecovery).toBe(false);
  });

  // 케이스 ②-a: REBOUND_RELEASE ON + 오늘 거래일 + fetchedAt 신선(<TTL) → intradayUsed=true.
  it('uses intraday return when fetchedAt is fresh within TTL (defect B TTL ok)', () => {
    process.env.R6_INTRADAY_REBOUND_RELEASE_ENABLED = 'true';
    const reboundMacro = macro({
      kospiDayReturn: -4.0,
      kospiCloseReturn: -4.0,
      kospiIntradayReturn: 3.2,
      kospiIntradaySourceTradeDate: TODAY_KEY,
      kospiIntradayFetchedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(), // 5분 전 (<15분)
    });
    const state = evaluateR6RecoveryTransition(
      { ...defaultRegimeTransitionState(NOW_ISO), effectiveRegime: 'R6_DEFENSE', r6RecoveryStatus: 'R6_DEFENSE', r6StateMachineState: 'R6_DEFENSE' },
      reboundMacro,
      'R3_EARLY',
      NOW,
    );
    expect(state.r6TriggerBreakdown.intradayReturnUsed).toBe(true);
    expect(state.r6RecoveryEvidence.kospiDayReturnOk).toBe(true);
  });

  // 케이스 ②-b: REBOUND_RELEASE ON + 오늘 거래일 + fetchedAt stale(>TTL) → intradayUsed=false, legacy 폴백.
  it('rejects stale-carry-forward intraday when fetchedAt exceeds TTL (defect B TTL stale)', () => {
    process.env.R6_INTRADAY_REBOUND_RELEASE_ENABLED = 'true';
    const staleFetchMacro = macro({
      kospiDayReturn: -4.0,
      kospiCloseReturn: -4.0,
      kospiIntradayReturn: 3.2,        // 아침 stale 반등값 carry-forward
      kospiIntradaySourceTradeDate: TODAY_KEY,
      kospiIntradayFetchedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(), // 60분 전 (>15분 TTL)
    });
    const state = evaluateR6RecoveryTransition(
      { ...defaultRegimeTransitionState(NOW_ISO), effectiveRegime: 'R6_DEFENSE', r6RecoveryStatus: 'R6_DEFENSE', r6StateMachineState: 'R6_DEFENSE' },
      staleFetchMacro,
      'R3_EARLY',
      NOW,
    );
    expect(state.r6TriggerBreakdown.intradayReturnUsed).toBe(false);          // TTL 초과 거부
    expect(state.r6RecoveryEvidence.kospiDayReturnOk).toBe(false);             // -4.0 legacy 폴백
  });

  // 케이스 ②-c: REBOUND_RELEASE ON + fetchedAt 부재 → 보수적 legacy 폴백.
  it('falls back to legacy when fetchedAt is absent (defect B conservative)', () => {
    process.env.R6_INTRADAY_REBOUND_RELEASE_ENABLED = 'true';
    const noFetchedAtMacro = macro({
      kospiDayReturn: -4.0,
      kospiCloseReturn: -4.0,
      kospiIntradayReturn: 3.2,
      kospiIntradaySourceTradeDate: TODAY_KEY,
      // kospiIntradayFetchedAt 부재
    });
    const state = evaluateR6RecoveryTransition(
      { ...defaultRegimeTransitionState(NOW_ISO), effectiveRegime: 'R6_DEFENSE', r6RecoveryStatus: 'R6_DEFENSE', r6StateMachineState: 'R6_DEFENSE' },
      noFetchedAtMacro,
      'R3_EARLY',
      NOW,
    );
    expect(state.r6TriggerBreakdown.intradayReturnUsed).toBe(false);
    expect(state.r6RecoveryEvidence.kospiDayReturnOk).toBe(false); // -4.0 legacy 폴백
  });

  // 케이스 10b: TRADEDATE flag ON + 오늘 봉 → freshness 보존, intraday-low active 유지.
  it('keeps today bar intraday-low shock active when TRADEDATE flag ON', () => {
    process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED = 'true';
    const todayShock = macro({
      kospiTriggerSourceTradeDate: TODAY_KEY,
      kospiIntradayLowReturn: -7.0,
      kospiCloseReturn: -0.3,
      kospiDayReturn: -0.3,
    });
    const breakdown = evaluateR6RecoveryTransition(
      defaultRegimeTransitionState(NOW_ISO),
      todayShock,
      getRawRegime(todayShock, NOW),
      NOW,
    ).r6TriggerBreakdown;
    expect(breakdown.triggerFreshness).toBe('FRESH');
    expect(breakdown.activeR6Triggers).toContain('KOSPI_INTRADAY_LOW_SHOCK');
    expect(breakdown.tradeDateIsToday).toBe(true);
  });

  // 케이스 10c: TRADEDATE flag OFF + 어제 봉 → 강등 안 됨(byte-equivalent, intraday-low active 유지).
  it('does NOT downgrade yesterday bar when TRADEDATE flag OFF (byte-equivalent)', () => {
    const yesterdayShock = macro({
      kospiTriggerSourceTradeDate: YESTERDAY_KEY,
      kospiIntradayLowReturn: -7.0,
      kospiCloseReturn: -0.3,
      kospiDayReturn: -0.3,
    });
    const breakdown = evaluateR6RecoveryTransition(
      defaultRegimeTransitionState(NOW_ISO),
      yesterdayShock,
      getRawRegime(yesterdayShock, NOW),
      NOW,
    ).r6TriggerBreakdown;
    expect(breakdown.triggerFreshness).toBe('FRESH');
    expect(breakdown.activeR6Triggers).toContain('KOSPI_INTRADAY_LOW_SHOCK');
  });
});
