// @responsibility Yahoo Finance range 파라미터 정책 SSOT — 자동 호출 1y 상한 cap.
/**
 * yahooRangePolicy.ts — ADR-0082 Yahoo Range Restriction Policy
 *
 * 사용자 운영 보고 "yahoo 참조는 sanity 위반이 자주 발생하므로 2년치로 선정하지 말것
 * (프로그램 전역)" 반영. 코드베이스의 모든 *자동 호출* 경로에서 Yahoo `range` 의
 * 최대값을 `'1y'` 로 제한.
 *
 * - 1y = 252영업일. MA60 + 5일 전 MA60 (65일) / ATR14 / BB20 / 주봉 RSI(9, 45영업일) /
 *   60일 최고가 / 5일 / 20일 수익률 모두 충분.
 * - 13개월 월봉은 1y 에서 12개월만 확보 → graceful fallback (KIS MTAS 보강 별도).
 * - `'2y' | '5y' | '10y' | 'max' | 'ytd' | 알 수 없는 값` → `'1y'` 자동 cap.
 *
 * ENV 롤백: `YAHOO_RANGE_CAP_DISABLED=true` 시 입력 그대로 반환 (정책 우회).
 *
 * 정적 검증: `scripts/check_yahoo_range.js` 가 화이트리스트 외 `'2y'/'5y'/'10y'/'max'`
 * 문자열 리터럴 사용을 빌드 단계에서 차단.
 */

export const YAHOO_ALLOWED_RANGES = [
  '1d',
  '5d',
  '1mo',
  '3mo',
  '6mo',
  '1y',
] as const;

export type YahooRange = (typeof YAHOO_ALLOWED_RANGES)[number];

export const YAHOO_MAX_RANGE: YahooRange = '1y';
export const YAHOO_DEFAULT_RANGE: YahooRange = '1y';

const ALLOWED_SET = new Set<string>(YAHOO_ALLOWED_RANGES);

/**
 * 입력이 정책 허용 range 인지 검증.
 * type guard 로 호출자가 narrow 가능.
 */
export function isAllowedYahooRange(input: unknown): input is YahooRange {
  return typeof input === 'string' && ALLOWED_SET.has(input);
}

/**
 * 입력 range 를 정책 상한으로 cap.
 *
 * 분기:
 *   - undefined / null / 빈 문자열 → YAHOO_DEFAULT_RANGE ('1y')
 *   - 허용된 7값 그대로 통과
 *   - '2y' / '5y' / '10y' / 'max' / 'ytd' / 알 수 없는 값 → YAHOO_MAX_RANGE ('1y') cap
 *   - ENV `YAHOO_RANGE_CAP_DISABLED=true` 시 입력 그대로 반환 (정책 우회 — 긴급 운영용)
 *
 * @returns YahooRange 의 7개 허용값 중 하나
 */
export function capYahooRange(input: string | null | undefined): YahooRange {
  // ENV 롤백 — 입력이 string 이면 그대로 반환 (긴급 운영 상황 우회)
  if (isYahooRangeCapDisabled()) {
    return typeof input === 'string' && input.length > 0
      ? (input as YahooRange)
      : YAHOO_DEFAULT_RANGE;
  }

  if (input == null || input === '') {
    return YAHOO_DEFAULT_RANGE;
  }
  if (isAllowedYahooRange(input)) {
    return input;
  }
  return YAHOO_MAX_RANGE;
}

/**
 * ENV `YAHOO_RANGE_CAP_DISABLED=true` 활성 여부.
 * 모듈 로드 시점이 아닌 호출 시점 평가 (테스트에서 env 토글 가능).
 */
export function isYahooRangeCapDisabled(): boolean {
  return process.env.YAHOO_RANGE_CAP_DISABLED === 'true';
}
