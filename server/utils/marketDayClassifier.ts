/**
 * @responsibility KRX 영업일 7분기 SSOT — 자기학습·스케줄러·매매 보수 모드 단일 컨텍스트 (ADR-0037)
 *
 * PR-A 의 `isKrxHoliday` + `marketClock.isKstWeekend` 위에 올라가는 분류기.
 * 다음/이전 영업일 산술까지 캡슐화하여 PR-C(연휴 복귀 보수 모드)·PR-D(KRX 자동 동기화)
 * 가 본 SSOT 위에서 분기 1줄로 끝나도록 한다.
 *
 * 외부 의존: 없음. `KRX_HOLIDAYS` Set 직접 import 금지 — `isKrxHoliday()` 만 사용.
 */

import { isKrxHoliday } from '../trading/krxHolidays.js';

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

/** 8일 lookahead/lookback 으로 추석 7일 연휴 + 신정 + 어린이날까지 안전 커버. */
const SCAN_HORIZON_DAYS = 8;

/** 비영업 간격이 N일 이상이면 LONG_HOLIDAY 분류. 추석 5/6일 연휴 + 주말 합쳐 일반적으로 ≥3. */
const LONG_HOLIDAY_GAP_DAYS = 3;

export type MarketDayType =
  | 'TRADING_DAY'         // KRX 정규 영업일
  | 'WEEKEND'             // 토/일 (KRX 공휴일 아닌)
  | 'KRX_HOLIDAY'         // 평일이지만 KRX 공휴일
  | 'PRE_HOLIDAY'         // 영업일이지만 다음 영업일까지 ≥ 2일 간격
  | 'POST_HOLIDAY'        // 영업일이지만 직전 영업일까지 ≥ 2일 간격
  | 'LONG_HOLIDAY_START'  // 비영업일 + 다음 영업일까지 ≥ 3일 간격
  | 'LONG_HOLIDAY_END';   // 비영업일 + 직전 영업일까지 ≥ 3일 간격

export interface MarketDayContext {
  /** YYYY-MM-DD KST */
  date: string;
  type: MarketDayType;
  isTradingDay: boolean;
  /** 본인 또는 본인 이후 가장 가까운 영업일. 본인이 영업일이면 자기 자신. 8일 내 미발견 시 빈 문자열. */
  nextTradingDay: string;
  /** 본인 또는 본인 이전 가장 가까운 영업일. 본인이 영업일이면 자기 자신. 8일 내 미발견 시 빈 문자열. */
  prevTradingDay: string;
  /** 비영업 간격이 LONG_HOLIDAY_GAP_DAYS 이상이면 true. */
  isLongHoliday: boolean;
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

function todayKst(): string {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
}

function ymdToUtcMidnight(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function shiftYmd(ymd: string, days: number): string {
  const t = ymdToUtcMidnight(ymd) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

function dayOfWeekKst(ymd: string): number {
  // YMD 문자열을 KST 기준 자정으로 보고 요일 산출 (date-only 비교라 시각 무관)
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일, 6=토
}

function isWeekendYmd(ymd: string): boolean {
  const dow = dayOfWeekKst(ymd);
  return dow === 0 || dow === 6;
}

/** 본인을 포함한 영업일 여부. */
export function isTradingDay(dateYmd?: string): boolean {
  const d = dateYmd ?? todayKst();
  if (isWeekendYmd(d)) return false;
  if (isKrxHoliday(d)) return false;
  return true;
}

/** 본인 또는 본인 이후 가장 가까운 영업일. 8일 내 미발견 시 빈 문자열. */
export function nextTradingDay(dateYmd: string): string {
  for (let i = 0; i <= SCAN_HORIZON_DAYS; i++) {
    const d = shiftYmd(dateYmd, i);
    if (isTradingDay(d)) return d;
  }
  return '';
}

/** 본인 또는 본인 이전 가장 가까운 영업일. 8일 내 미발견 시 빈 문자열. */
export function prevTradingDay(dateYmd: string): string {
  for (let i = 0; i <= SCAN_HORIZON_DAYS; i++) {
    const d = shiftYmd(dateYmd, -i);
    if (isTradingDay(d)) return d;
  }
  return '';
}

/** 두 YMD 사이 달력일 차이 (절대값). 동일 날짜는 0. */
function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((ymdToUtcMidnight(a) - ymdToUtcMidnight(b)) / DAY_MS));
}

// ── 메인 분류기 ──────────────────────────────────────────────────────────────

export function getMarketDayContext(dateYmd?: string): MarketDayContext {
  const date = dateYmd ?? todayKst();
  const trading = isTradingDay(date);

  // 다음 영업일 — 본인이 영업일이면 본인, 아니면 본인 이후 첫 영업일.
  const next = trading ? date : nextTradingDay(shiftYmd(date, 1));
  // 이전 영업일 — 본인이 영업일이면 본인, 아니면 본인 이전 첫 영업일.
  const prev = trading ? date : prevTradingDay(shiftYmd(date, -1));

  // 비영업 간격 — 다음 영업일과 이전 영업일 사이의 달력일 수.
  // 본인이 영업일이면 next === prev === date 라 nonTradingGap = 0 (PRE/POST 분기에서 별도 계산).
  const nonTradingGap = next && prev ? daysBetween(next, prev) - 1 : 0;
  const isLongHoliday = nonTradingGap >= LONG_HOLIDAY_GAP_DAYS;

  let type: MarketDayType;
  if (trading) {
    // 영업일: PRE_HOLIDAY / POST_HOLIDAY / TRADING_DAY 분기.
    // 다음 영업일까지 ≥ 2일 간격이면 PRE_HOLIDAY (본인 + 다음 영업일 사이에 비영업일이 ≥ 1).
    const nextNext = nextTradingDay(shiftYmd(date, 1));
    const gapToNext = nextNext ? daysBetween(nextNext, date) : 0;
    const prevPrev = prevTradingDay(shiftYmd(date, -1));
    const gapFromPrev = prevPrev ? daysBetween(date, prevPrev) : 0;

    if (gapFromPrev >= 2) {
      type = 'POST_HOLIDAY';
    } else if (gapToNext >= 2) {
      type = 'PRE_HOLIDAY';
    } else {
      type = 'TRADING_DAY';
    }
  } else {
    // 비영업일: WEEKEND / KRX_HOLIDAY / LONG_HOLIDAY_START / LONG_HOLIDAY_END 분기.
    if (isLongHoliday) {
      // 비영업 클러스터의 시작 vs 끝 — 직전 영업일과의 거리로 판정.
      const distFromPrev = prev ? daysBetween(date, prev) : 0;
      const distToNext = next ? daysBetween(next, date) : 0;
      type = distFromPrev <= distToNext ? 'LONG_HOLIDAY_START' : 'LONG_HOLIDAY_END';
    } else if (isKrxHoliday(date)) {
      type = 'KRX_HOLIDAY';
    } else {
      type = 'WEEKEND';
    }
  }

  return {
    date,
    type,
    isTradingDay: trading,
    nextTradingDay: next,
    prevTradingDay: prev,
    isLongHoliday,
  };
}
