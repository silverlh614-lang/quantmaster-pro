// @responsibility krxClient KST 날짜 유틸 — todayKst·valid·previousBusinessDay·resolveTradeDate
/**
 * krxClient/dateUtils.ts — ADR-0502c 분해 SSOT.
 *
 * 외부 의존: `marketClock.isMarketDataPublished` 만.
 * 순수 KST 날짜 산술 — 런타임 TZ 영향 없음.
 */

import { isMarketDataPublished } from '../../utils/marketClock.js';

/** KST 기준 오늘(YYYYMMDD). 외부 조회 기본값. */
function todayKstYYYYMMDD(): string {
  // UTC → KST(+09) 변환. 런타임 TZ 영향을 받지 않도록 수동 계산.
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** YYYYMMDD 형식 검증 — 외부 입력값 방어. */
export function isValidYyyymmdd(v: string): boolean {
  return /^\d{8}$/.test(v);
}

/**
 * KST 기준 직전 영업일(YYYYMMDD). 공휴일 캘린더 없이 "토/일 건너뛰기" 만 적용.
 * 입력이 월요일이면 금요일, 주말이면 직전 금요일, 평일이면 전일을 반환.
 * ADR-0009 — KRX 공개 통계가 당일 미확정(18:00 KST 전) 이거나 주말일 때 후퇴용.
 */
function previousBusinessDayYYYYMMDD(now: Date = new Date()): string {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  // 최대 7일 되돌려서 첫 평일을 찾는다.
  for (let i = 1; i <= 7; i++) {
    const probe = new Date(kst.getTime() - i * 24 * 60 * 60_000);
    const day = probe.getUTCDay();
    if (day >= 1 && day <= 5) {
      const y = probe.getUTCFullYear();
      const m = String(probe.getUTCMonth() + 1).padStart(2, '0');
      const d = String(probe.getUTCDate()).padStart(2, '0');
      return `${y}${m}${d}`;
    }
  }
  // 도달하지 않지만 안전망.
  return todayKstYYYYMMDD();
}

/**
 * ADR-0009 — date 미지정 시 KRX 공개 통계 조회에 쓸 "안전한" 거래일자를 결정한다.
 *   - 수동 date 인자가 유효하면 그대로 존중 (백필/디버깅 경로).
 *   - 그렇지 않고 isMarketDataPublished=false (평일 18:00 이전 또는 DATA_FETCH_FORCE_OFF)
 *     면 직전 영업일로 후퇴.
 *   - 주말 역시 직전 영업일로 후퇴 (오늘이 토/일이면 오늘 날짜는 비영업일이므로).
 *   - 그 외(평일 18:00 이후) 오늘 KST 날짜를 그대로 사용.
 */
function resolveTradeDate(date: string | undefined, now: Date = new Date()): string {
  if (date && isValidYyyymmdd(date)) return date;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  const day = kst.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend || !isMarketDataPublished(now)) {
    return previousBusinessDayYYYYMMDD(now);
  }
  return todayKstYYYYMMDD();
}

/**
 * ADR-0009 / Patch-D — 장중(isMarketDataPublished=false) tradeDate 고착 문제 해소.
 * 수동 date 인자가 유효하면 { primary: date, fallback: date } 그대로 반환.
 * 주말이면 직전 영업일만 반환 (당일이 유효한 거래일이 아니므로 fallback 불필요).
 * 평일 장중에는 todayKst 를 primary, previousBusinessDay 를 fallback 으로 제공.
 *   → 호출부는 primary 로 KRX 요청을 먼저 시도하고, ENDPOINT_PARAM_NOT_READY /
 *     GATED / 빈 행 응답 시 fallback 으로 재시도한다.
 * 평일 18:00 이후(isMarketDataPublished=true) 에는 당일만 반환 (fallback=undefined).
 */
export function resolveTradeDateWithFallback(
  date: string | undefined,
  now: Date = new Date(),
): { primary: string; fallback: string | undefined } {
  // 수동 지정 날짜 — 백필/디버깅 경로, 변환 없이 존중.
  if (date && isValidYyyymmdd(date)) {
    return { primary: date, fallback: undefined };
  }
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  const day = kst.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  // 주말 — 직전 영업일만 유효, fallback 불필요.
  if (isWeekend) {
    return { primary: previousBusinessDayYYYYMMDD(now), fallback: undefined };
  }
  const published = isMarketDataPublished(now);
  if (published) {
    // 18:00 이후 확정 데이터 — 당일만 사용, fallback 불필요.
    return { primary: todayKstYYYYMMDD(), fallback: undefined };
  }
  // 평일 장중(18:00 이전) — 당일을 우선 시도, 전일을 fallback 으로 제공.
  // Patch-D: 이전 동작은 전일 고착이었으나 당일 KRX 데이터가 공개되어 있을 수 있어 당일 우선.
  return { primary: todayKstYYYYMMDD(), fallback: previousBusinessDayYYYYMMDD(now) };
}

/** YYYY-MM-DD 또는 다른 separator 가 섞인 값을 YYYYMMDD 만으로 정규화. */
export function compactTradeDate(date: string): string {
  return date.replace(/[^0-9]/g, '');
}
