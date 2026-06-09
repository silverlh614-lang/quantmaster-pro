// @responsibility KOSPI R6 트리거 freshness 를 봉 거래일(KRX) 기준으로 평가하는 순수 SSOT — age-only 오판 차단, intraday-low per-trigger 강등 산출.
/**
 * kospiTriggerFreshness.ts — ADR-0590 결함 A 수리 SSOT.
 *
 * 문제: 기존 freshness 는 fetch 시각(age)만 보고 봉의 거래일을 무시 → 어제 폭락 봉의
 *       intraday-low(-5%↓)가 오늘 'FRESH intraday trigger' 로 오인되어 R6 false-latch.
 *
 * 본 모듈은 봉 거래일(KST date-key)이 오늘 KRX 거래일인지 판정해, 오늘이 아니면
 * intraday-low 트리거(KOSPI_INTRADAY_LOW_SHOCK)만 per-trigger 로 강등(active 에서 제외)한다.
 * close-shock(어제 종가 -5%)·VKOSPI_DAY_SPIKE·USDKRW_DAY_SHOCK 은 어제 일봉 intraday-low 와
 * 무관(폭락 다음날 아침 정당 방어 신호 / KOSPI 일봉 거래일과 별도 소스)하므로 강등하지 않는다.
 *
 * Codex review 정합 정정(ADR-0590 addendum): 기존엔 글로벌 freshness 를 STALE 로 떨궈
 * detected 전체를 일괄 게이팅 → close-shock 과소억제(D1 위반). 이제 글로벌 freshness 는
 * age-only 그대로 보존(recovery/latch side-effect byte-equivalent)하고, trade-date 강등은
 * `intradayDowngraded` boolean 으로만 노출 → 호출자(regimeBridge)가 intraday-low 만 분리 제외.
 *
 * 순수 함수 — provider/store 호출 0. flag 게이트는 호출자(regimeBridge)가 적용한다.
 * 거래일 SSOT = krxTradingCalendar(isKrxTradingDay/toKstDateKey, ADR-0559).
 */

import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';
import type { R6TriggerBreakdown } from '../persistence/regimeTransitionStateRepo.js';

/** 신규 union 금지 — 기존 R6TriggerBreakdown 의 freshness union 재사용(드리프트 방지). */
type TriggerFreshness = R6TriggerBreakdown['triggerFreshness'];

/**
 * intraday-low 트리거가 active 로 carry 될 수 있는 age-freshness 인가.
 * FRESH/SOFT_STALE 일 때만 active 게이팅 대상이라, 이 두 계열에서만 trade-date 강등이 의미를 갖는다.
 */
function isIntradayActiveFreshness(freshness: TriggerFreshness): boolean {
  return freshness === 'FRESH' || freshness === 'SOFT_STALE';
}

/**
 * ADR-0590 D1 (+ Codex 정합 정정): 봉 거래일 기준 intraday-low per-trigger 강등 여부.
 *
 * 글로벌 freshness 는 강등하지 않는다(age-only 그대로 반환) — recovery/latch side-effect 보존.
 * 봉 거래일이 오늘이 아니고 age 가 active 계열(FRESH/SOFT_STALE)이면 `intradayDowngraded=true` 만 산출.
 *
 * @param input.tradeDate    봉의 거래일(YYYY-MM-DD KST) — macroState.kospiTriggerSourceTradeDate. 부재 시 강등 안 함.
 * @param input.ageFreshness 기존 macroFreshnessFromUpdatedAt 결과(age-only) — 글로벌 freshness 로 그대로 반환.
 * @param input.now          현재 시각.
 * @returns freshness(=ageFreshness, 무강등) · tradeDateIsToday · intradayDowngraded(KOSPI_INTRADAY_LOW_SHOCK 분리 제외 여부).
 */
export function resolveKospiTriggerFreshness(input: {
  tradeDate?: string;
  ageFreshness: TriggerFreshness;
  now: Date;
}): { freshness: TriggerFreshness; tradeDateIsToday: boolean; intradayDowngraded: boolean } {
  const { tradeDate, ageFreshness, now } = input;

  // 거래일 판정 불가(부재/형식 불량) → 강등 안 함(보수, age-only 그대로).
  if (!tradeDate || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return { freshness: ageFreshness, tradeDateIsToday: false, intradayDowngraded: false };
  }

  const todayKey = toKstDateKey(now);
  // 오늘이 KRX 거래일이 아니면(주말/휴장) 봉 거래일 게이트 적용 불가 — 강등 안 함(보수).
  if (!todayKey || !isKrxTradingDay(todayKey)) {
    return { freshness: ageFreshness, tradeDateIsToday: false, intradayDowngraded: false };
  }

  const tradeDateIsToday = tradeDate === todayKey;
  if (tradeDateIsToday) {
    // 봉이 오늘 거래일 것 — 정상 intraday 인식, 강등 안 함.
    return { freshness: ageFreshness, tradeDateIsToday: true, intradayDowngraded: false };
  }

  // 봉 거래일이 오늘 아님(어제 이전). intraday-low 만 per-trigger 강등 대상.
  // 글로벌 freshness 는 보존 → close-shock/VKOSPI/USDKRW 는 age-freshness 게이팅 그대로.
  return {
    freshness: ageFreshness,
    tradeDateIsToday: false,
    intradayDowngraded: isIntradayActiveFreshness(ageFreshness),
  };
}

/** ADR-0590 D1 flag — default OFF. ON 시에만 trade-date 강등이 live freshness 에 적용된다. */
export function isTradeDateFreshnessEnabled(): boolean {
  return process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED === 'true';
}
