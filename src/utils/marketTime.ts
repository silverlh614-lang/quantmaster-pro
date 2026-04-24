/**
 * 한국 정규장 판정 + 심볼별 시장 분류 유틸 — 클라이언트 SSOT.
 *
 * 서버 `server/utils/symbolMarketRegistry.ts` 와 동일 로직을 복제한 twin.
 * 이후 shared 모듈로 승격 계획이 있으나 (Tier 3 ⑩), 현재는 두 쪽이 동일 결과를
 * 내도록 시간표·regex 를 1:1 로 맞춘다.
 *
 * NYSE 는 EST(UTC-5) 고정 — DST 는 게이트 용도에 ±1h 오차 수용.
 */

export type MarketId = 'KRX' | 'NYSE' | 'TSE';

interface MarketSession {
  readonly tzOffsetHours: number;
  readonly openMin: number;
  readonly closeMin: number;
  readonly weekdays: ReadonlyArray<number>;
}

const MARKETS: Readonly<Record<MarketId, MarketSession>> = {
  KRX:  { tzOffsetHours:  9, openMin:  9 * 60,      closeMin: 15 * 60 + 30, weekdays: [1, 2, 3, 4, 5] },
  NYSE: { tzOffsetHours: -5, openMin:  9 * 60 + 30, closeMin: 16 * 60,      weekdays: [1, 2, 3, 4, 5] },
  TSE:  { tzOffsetHours:  9, openMin:  9 * 60,      closeMin: 15 * 60,      weekdays: [1, 2, 3, 4, 5] },
};

const KR_TICKER_PATTERN = /\.KS$|\.KQ$|^\d{6}$/;
const KR_INDEX_PATTERN = /^\^(?:KS11|KQ11|VKOSPI)$/;
const JP_TICKER_PATTERN = /\.T$/;

/** 한국 정규장(평일 09:00 ~ 15:30 KST) 여부 — 기존 호환 API */
export function isMarketOpen(now: Date = new Date()): boolean {
  return isOpenAt('KRX', now);
}

/** KST 주말 여부 */
export function isKstWeekend(now: Date = new Date()): boolean {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const day = kst.getUTCDay();
  return day === 0 || day === 6;
}

/** 심볼 → 시장 분류. 미매칭 시 NYSE 기본. */
export function classifySymbol(symbol: string): MarketId {
  const s = (symbol ?? '').trim();
  if (KR_TICKER_PATTERN.test(s)) return 'KRX';
  if (KR_INDEX_PATTERN.test(s)) return 'KRX';
  if (JP_TICKER_PATTERN.test(s)) return 'TSE';
  return 'NYSE';
}

function localDayAndMinutes(now: Date, tzOffsetHours: number): { day: number; mins: number } {
  const shifted = new Date(now.getTime() + tzOffsetHours * 3_600_000);
  return {
    day: shifted.getUTCDay(),
    mins: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** 특정 시장이 `now` 시점에 정규장 운영 중인지. */
export function isOpenAt(market: MarketId, now: Date = new Date()): boolean {
  const session = MARKETS[market];
  const { day, mins } = localDayAndMinutes(now, session.tzOffsetHours);
  if (!session.weekdays.includes(day)) return false;
  return mins >= session.openMin && mins < session.closeMin;
}

/** 심볼이 속한 시장이 `now` 시점에 열려있는지. */
export function isMarketOpenFor(symbol: string, now: Date = new Date()): boolean {
  return isOpenAt(classifySymbol(symbol), now);
}

/** 특정 시장의 다음 개장 시각 (UTC Date). 서버 nextOpenAt 과 동일 규약. */
export function nextOpenAt(market: MarketId, now: Date = new Date()): Date {
  const session = MARKETS[market];
  const DAY_MS = 86_400_000;
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const shifted = new Date(now.getTime() + dayOffset * DAY_MS + session.tzOffsetHours * 3_600_000);
    if (!session.weekdays.includes(shifted.getUTCDay())) continue;
    const candidate = new Date(shifted);
    candidate.setUTCHours(Math.floor(session.openMin / 60), session.openMin % 60, 0, 0);
    const candidateUtc = new Date(candidate.getTime() - session.tzOffsetHours * 3_600_000);
    if (candidateUtc.getTime() > now.getTime()) return candidateUtc;
  }
  throw new Error(`nextOpenAt: no open window found in 8 days for ${market}`);
}

/** 심볼 기준 다음 개장 시각. OffHoursBanner 등에서 직접 사용. */
export function nextOpenAtFor(symbol: string, now: Date = new Date()): Date {
  return nextOpenAt(classifySymbol(symbol), now);
}

/** 사람이 읽을 수 있는 라벨 — "KST 월 09:00" 형식. */
export function formatNextOpenKst(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 3_600_000);
  const dayLabel = ['일', '월', '화', '수', '목', '금', '토'][kst.getUTCDay()];
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${dayLabel} ${hh}:${mm} KST`;
}

/** 디버깅·배너용 시장 phase 라벨. */
export function describeMarketPhase(market: MarketId = 'KRX', now: Date = new Date()): 'OPEN' | 'CLOSED' {
  return isOpenAt(market, now) ? 'OPEN' : 'CLOSED';
}
