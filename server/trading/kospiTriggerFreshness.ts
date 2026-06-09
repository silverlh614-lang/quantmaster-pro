// @responsibility KOSPI R6 트리거 freshness 를 봉 거래일(KRX) 기준으로 평가하는 순수 SSOT — age-only 오판 차단, intraday 인식 지원.
/**
 * kospiTriggerFreshness.ts — ADR-0590 결함 A 수리 SSOT.
 *
 * 문제: 기존 freshness 는 fetch 시각(age)만 보고 봉의 거래일을 무시 → 어제 폭락 봉의
 *       intraday-low(-5%↓)가 오늘 'FRESH intraday trigger' 로 오인되어 R6 false-latch.
 *
 * 본 모듈은 봉 거래일(KST date-key)이 오늘 KRX 거래일인지 판정해, 오늘이 아니면
 * intraday 트리거 계열 freshness 를 STALE 로 강등한다. close-shock(POST_CLOSE/EOD)
 * 계열은 어제여도 유효할 수 있으므로 강등하지 않는다(분리). 거래일 판정 불가 시
 * legacy age-only freshness 를 그대로 폴백(보수).
 *
 * 순수 함수 — provider/store 호출 0. flag 게이트는 호출자(regimeBridge)가 적용한다.
 * 거래일 SSOT = krxTradingCalendar(isKrxTradingDay/toKstDateKey, ADR-0559).
 */

import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';
import type { R6TriggerBreakdown } from '../persistence/regimeTransitionStateRepo.js';

/** 신규 union 금지 — 기존 R6TriggerBreakdown 의 freshness union 재사용(드리프트 방지). */
type TriggerFreshness = R6TriggerBreakdown['triggerFreshness'];

/**
 * close-shock(EOD/POST_CLOSE) 계열 freshness 는 거래일이 어제여도 유효 — intraday 강등에서 제외.
 * intraday-low/day-return 트리거는 FRESH/SOFT_STALE 일 때만 active 로 carry 되므로
 * 이 두 계열만 trade-date 강등 대상이다.
 */
function isIntradayActiveFreshness(freshness: TriggerFreshness): boolean {
  return freshness === 'FRESH' || freshness === 'SOFT_STALE';
}

/**
 * ADR-0590 D1: 봉 거래일 기준 trigger freshness 평가.
 *
 * @param input.tradeDate    봉의 거래일(YYYY-MM-DD KST) — macroState.kospiTriggerSourceTradeDate. 부재 시 legacy 폴백.
 * @param input.ageFreshness 기존 macroFreshnessFromUpdatedAt 결과(age-only).
 * @param input.now          현재 시각.
 * @returns freshness(강등 적용 후) · tradeDateIsToday · downgraded(진단용).
 */
export function resolveKospiTriggerFreshness(input: {
  tradeDate?: string;
  ageFreshness: TriggerFreshness;
  now: Date;
}): { freshness: TriggerFreshness; tradeDateIsToday: boolean; downgraded: boolean } {
  const { tradeDate, ageFreshness, now } = input;

  // 거래일 판정 불가(부재/형식 불량) → legacy age-only freshness 그대로(보수).
  if (!tradeDate || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return { freshness: ageFreshness, tradeDateIsToday: false, downgraded: false };
  }

  const todayKey = toKstDateKey(now);
  // 오늘이 KRX 거래일이 아니면(주말/휴장) 봉 거래일 게이트 적용 불가 — legacy 폴백(보수).
  if (!todayKey || !isKrxTradingDay(todayKey)) {
    return { freshness: ageFreshness, tradeDateIsToday: false, downgraded: false };
  }

  const tradeDateIsToday = tradeDate === todayKey;
  if (tradeDateIsToday) {
    // 봉이 오늘 거래일 것 — freshness 보존(정상 intraday 인식).
    return { freshness: ageFreshness, tradeDateIsToday: true, downgraded: false };
  }

  // 봉 거래일이 오늘 아님(어제 이전). intraday 활성 계열만 STALE 로 강등.
  // close-shock(POST_CLOSE/EOD) 계열은 EOD 경로로 유효 가능 → 강등 분리.
  if (isIntradayActiveFreshness(ageFreshness)) {
    return { freshness: 'STALE', tradeDateIsToday: false, downgraded: true };
  }
  return { freshness: ageFreshness, tradeDateIsToday: false, downgraded: false };
}

/** ADR-0590 D1 flag — default OFF. ON 시에만 trade-date 강등이 live freshness 에 적용된다. */
export function isTradeDateFreshnessEnabled(): boolean {
  return process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED === 'true';
}
