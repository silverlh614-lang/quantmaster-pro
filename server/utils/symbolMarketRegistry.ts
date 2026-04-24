/**
 * @responsibility 심볼→시장 매핑 · 정규장 개장 판정 SSOT
 *
 * 단일 소스 — 심볼 → 시장(KRX/NYSE/TSE) 매핑 + 시장별 정규장 운영시간.
 * 외부 데이터 호출 게이트(marketDataRouter 등)는 `isMarketOpenFor()` 하나만 호출하고
 * regex·시간표는 본 모듈 내부 디테일로 숨긴다. 신규 시장 추가 시 MARKETS 상수와
 * 분류기만 확장하면 된다.
 *
 * 환경변수:
 *   DATA_FETCH_FORCE_MARKET=true  — 강제 장중 (모든 시장 open 취급)
 *   DATA_FETCH_FORCE_OFF=true     — 강제 장외 (모든 시장 closed 취급)
 *
 * DST 처리: NYSE 는 EST(UTC-5) 고정. EDT 기간(+0) 은 KST 23:30~06:00 개장을
 * ±1h 수용 오차로 통과시키므로 외부 호출 예산 게이트 용도에는 충분하다.
 */

export type MarketId = 'KRX' | 'NYSE' | 'TSE';

interface MarketSession {
  readonly id: MarketId;
  readonly tzOffsetHours: number;
  readonly openMin: number;
  readonly closeMin: number;
  readonly weekdays: ReadonlyArray<number>;
}

const MARKETS: Readonly<Record<MarketId, MarketSession>> = {
  KRX:  { id: 'KRX',  tzOffsetHours:  9, openMin:  9 * 60,      closeMin: 15 * 60 + 30, weekdays: [1, 2, 3, 4, 5] },
  NYSE: { id: 'NYSE', tzOffsetHours: -5, openMin:  9 * 60 + 30, closeMin: 16 * 60,      weekdays: [1, 2, 3, 4, 5] },
  TSE:  { id: 'TSE',  tzOffsetHours:  9, openMin:  9 * 60,      closeMin: 15 * 60,      weekdays: [1, 2, 3, 4, 5] },
};

// KOSPI/KOSDAQ 현물 티커 + 6자리 숫자 raw 코드
const KR_TICKER_PATTERN = /\.KS$|\.KQ$|^\d{6}$/;
// KR 변동성·지수 ^KS11 / ^KQ11 / ^VKOSPI
const KR_INDEX_PATTERN = /^\^(?:KS11|KQ11|VKOSPI)$/;
// 도쿄 티커 (.T)
const JP_TICKER_PATTERN = /\.T$/;

/**
 * 심볼을 대응 시장으로 분류한다. 매칭되지 않으면 NYSE(미국·ETF·기타 지수) 로 본다.
 * 빈 문자열 등 방어적 기본값도 NYSE 에 매핑된다 — 실제 라우터는 상위에서 빈 값을 처리.
 */
export function classifySymbol(symbol: string): MarketId {
  const s = symbol.trim();
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
  if (process.env.DATA_FETCH_FORCE_OFF === 'true') return false;
  if (process.env.DATA_FETCH_FORCE_MARKET === 'true') return true;
  const session = MARKETS[market];
  const { day, mins } = localDayAndMinutes(now, session.tzOffsetHours);
  if (!session.weekdays.includes(day)) return false;
  return mins >= session.openMin && mins < session.closeMin;
}

/** 심볼이 속한 시장의 정규장이 `now` 시점에 열려있는지. */
export function isMarketOpenFor(symbol: string, now: Date = new Date()): boolean {
  return isOpenAt(classifySymbol(symbol), now);
}

/** 등록된 시장 ID 목록. 추후 /markets 텔레그램 명령 등에서 iterate 용도. */
export function listMarkets(): ReadonlyArray<MarketId> {
  return Object.keys(MARKETS) as MarketId[];
}
