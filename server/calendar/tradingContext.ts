/**
 * @responsibility Market Truth Layer 날짜 SSOT — 모든 모듈이 자체 날짜 계산 대신 단일 기준일을 쓰게 하는 resolver (BUG-2026-05-07-001, ADR-0591).
 *
 * 배경: 기술지표·수급·섹터에너지가 각자 `new Date()`/`Date.now()` 로 기준일을 계산하면
 * 휴장일·장중·장마감 경계에서 모듈별 기준일이 어긋나 가짜 Confluence/STRONG_BUY 위험
 * (BUG-2026-05-07-001 "휴장일 기준일 혼합"). 본 모듈은 KRX 거래일 달력(krxTradingCalendar SSOT)
 * 위에 단일 기준일 컨텍스트를 제공한다.
 *
 * 범위 경계: 본 SSOT 는 *날짜*만 소유한다. 실행 권한(allowSignalGeneration / allowShadowLearning 등)은
 * 기존 ExecutionPermission/SourceSnapshot SSOT 소관 — 여기서 재정의하지 않는다(경쟁 SSOT 금지).
 */

import { toKstDateKey, isKrxTradingDay, previousKrxTradingDay } from './krxTradingCalendar.js';

type TradingDateMode = 'TRADING_DAY' | 'HOLIDAY' | 'WEEKEND';

export interface TradingContext {
  /** 컨텍스트 산출 기준 시각 (ISO). 모든 파생 날짜는 이 시각에서만 도출된다. */
  asOf: string;
  /** KST 달력 일자 (YYYY-MM-DD) — 오늘. */
  calendarDate: string;
  /** 현재 유효한 거래일 (오늘이 거래일이면 오늘, 아니면 직전 거래일). 모든 모듈의 단일 기준일. */
  effectiveTradingDate: string;
  /** effectiveTradingDate 직전 거래일. */
  previousTradingDate: string;
  /** calendarDate 다음 거래일. */
  nextTradingDate: string;
  /** 오늘(calendarDate)이 KRX 거래일인가. */
  isTradingDay: boolean;
  /** 날짜 수준 모드 (거래일/휴장일/주말) — 세션(장전/장중/장후) 구분은 별도 SourceSnapshot 소관. */
  dateMode: TradingDateMode;
}

function nextKrxTradingDay(calendarDate: string): string {
  let cursor = calendarDate;
  for (let i = 0; i < 14; i += 1) {
    cursor = toKstDateKey(new Date(new Date(`${cursor}T03:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000));
    if (isKrxTradingDay(cursor)) return cursor;
  }
  return cursor;
}

function resolveDateMode(calendarDate: string): TradingDateMode {
  if (isKrxTradingDay(calendarDate)) return 'TRADING_DAY';
  const dow = new Date(`${calendarDate}T03:00:00.000Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 'WEEKEND' : 'HOLIDAY';
}

/**
 * 단일 시각(now)에서 모든 기준일을 도출한다. 모듈은 자체 `new Date()` 대신 본 함수의 결과를 사용해야 한다.
 * @param now 기준 시각 (default 현재). 결정성이 필요한 호출자(테스트·스캔 시작 시각 고정)는 명시 전달.
 */
export function resolveTradingContext(now: Date = new Date()): TradingContext {
  const calendarDate = toKstDateKey(now);
  const isTradingDay = isKrxTradingDay(calendarDate);
  // 오늘이 거래일이면 오늘이 유효 기준일, 아니면 직전 거래일.
  const effectiveTradingDate = isTradingDay ? calendarDate : previousKrxTradingDay(now);
  // effectiveTradingDate 직전 거래일 = effectiveTradingDate 다음날 00:00 기준 previousKrxTradingDay.
  const previousTradingDate = previousKrxTradingDay(
    new Date(`${effectiveTradingDate}T03:00:00.000Z`),
  );
  return {
    asOf: now.toISOString(),
    calendarDate,
    effectiveTradingDate,
    previousTradingDate,
    nextTradingDate: nextKrxTradingDay(calendarDate),
    isTradingDay,
    dateMode: resolveDateMode(calendarDate),
  };
}
