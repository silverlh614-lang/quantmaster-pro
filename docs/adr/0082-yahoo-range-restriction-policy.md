# ADR-0082 — Yahoo Finance `range` 제한 정책 (전역 ≤ 1y)

**상태**: Accepted (2026-04-28)
**배경**: 사용자 운영 보고 — "yahoo 참조는 sanity 위반이 자주 발생하므로 2년치로 선정하지 말것 (프로그램 전역)"

## 문제

`server/screener/adapters/yahooQuoteAdapter.ts:101` 가 매 신호 스캔마다 종목별로
`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d` 를
호출해 504영업일 OHLCV 를 fetch 한다.

누적된 사고 기록:

- **ADR-0028 §safePctChange sanity 위반** — `yahooQuoteAdapter.changePercent 305.28%`
  (`current=115,100, base=28,400` 액면분할/거래정지 stale base price)
- **ADR-0004 Yahoo ADR 비활성** — PKX/SSNLF/SKM 상장폐지 -93.69% 케이스
- **PR-29 EgressGuard / PR-24 24h 영속 블랙리스트** — Railway IP 누적 차단
- **ADR-0058 IntentTag** — 의도 무관 fetch 차단 안전망
- **PR-22 Yahoo Probe Resilience** — 단발성 503 알림 폭주

2년치는 하나의 종목당 504봉을 끌어와 (a) Railway egress 부담, (b) Yahoo IP 차단
누적 위험, (c) 액면분할/배당 이벤트 누적으로 stale base price 확률 상승,
(d) PR-S1 슬롯 회계 이후 매수 빈도 증가가 fetch 빈도 증가로 직결.

## 결정

**전역 정책**: 코드베이스의 모든 *자동 호출* 경로에서 Yahoo `range` 의 최대값을
`'1y'` 로 제한한다 (대략 252영업일).

- 1y 면 모든 자동 산출 가능: MA60 + 5일 전 MA60 (65일) / ATR14 (14일) / BB20 (20일) /
  주봉 RSI(9) (9주 = 45영업일) / 60일 최고가 / 5일 / 20일 수익률 — 모두 충분.
- 13개월 월봉은 1y 에서 12개월만 확보 → graceful fallback (이미 enrichQuoteWithKisMTAS
  가 KIS 월봉으로 별도 보강하므로 영향 없음).
- 2y, 5y, 10y, max range 자동 호출 금지. 사용자 명시 UI 옵션 (`CandleChart.tsx` 차트
  range 슬라이서) 은 *사용자 능동 선택* 이므로 클라이언트 입력은 허용하되 서버
  `marketDataRouter.ts` 가 `cap('2y') → '1y'` 자동 축소 적용 (브라우저는 알지 못함).

## 정책 SSOT — `server/utils/yahooRangePolicy.ts`

```ts
export const YAHOO_ALLOWED_RANGES = [
  '1d', '5d', '1mo', '3mo', '6mo', '1y',
] as const;
export const YAHOO_MAX_RANGE = '1y' as const;

export function capYahooRange(input: string | undefined): YahooRange {
  // 입력 검증: 미설정/빈값 → '1y' 기본
  // 허용된 값 그대로 통과
  // '2y' / '5y' / '10y' / 'max' / 'ytd' / 알 수 없는 값 → '1y' cap
}

export function isAllowedYahooRange(input: string): input is YahooRange { ... }
```

## 정적 검증 — `scripts/check_yahoo_range.js`

- `validate:yahooRange` 가 `npm run validate:all` + `precommit` 본체에 통합.
- 코드베이스에서 `range=2y` / `range=5y` / `range=10y` / `range=max` / `range=ytd` 와
  `'2y'` / `"2y"` / `'5y'` / `'10y'` / `'max'` 문자열 리터럴 발견 시 FAIL.
- 화이트리스트:
  - `server/utils/yahooRangePolicy.ts` (정책 정의 자기 자신)
  - `src/components/analysis/CandleChart.tsx` (사용자 UI 옵션 — 서버에서 cap)
  - `scripts/check_yahoo_range.js` (시그니처 정의)
  - `docs/adr/*.md` (정책 문서 자기 인용)
  - `*.test.ts` / `*.test.tsx` (회귀 시나리오)

## 영향 분석

| 모듈 | 변경 전 | 변경 후 | 비고 |
|---|---|---|---|
| `yahooQuoteAdapter.ts:101` | `range=2y` | `range=1y` | MTAS 13개월 월봉 → 12개월 (graceful) |
| `marketDataRouter.ts:124,253` | client query 그대로 | `capYahooRange()` 통과 | 클라이언트 `'2y'` 자동 cap |
| `CandleChart.tsx` | `'2y'` 옵션 노출 | 무수정 (UX 보존) | 서버 cap 으로 데이터는 1y |
| `quantitativeCandidateGenerator.ts` | `range=3mo` | 무영향 | 안전 |
| `marketDataRefresh.ts` | `'65d'/'25d'/'10d'` | 무영향 | 변수 호출 |
| `koreanQuoteBridge.ts` | `range=5d` | 무영향 | 안전 |
| `sectorEtfMomentum.ts` | `range=${var}&interval=30m` | 무영향 | 인트라데이 |
| `dxyIntradayClient.ts` | `range='1d'` 기본 | 무영향 | 안전 |
| `yahooProbeRetry.ts` | `range=1d` | 무영향 | 안전 |
| `backtestEngine.ts` / `lateWinEvaluator.ts` | `period1/period2` (90일/95일) | 무영향 | 안전 |

## 회귀 테스트

- `server/utils/yahooRangePolicy.test.ts`: `capYahooRange` 분기 검증 — 허용 7값 통과 +
  `'2y'/'5y'/'10y'/'max'/'ytd'` cap → `'1y'` + 미설정/빈값/null/undefined fallback +
  알 수 없는 입력 fallback (≥15 케이스).
- `server/screener/adapters/yahooQuoteAdapter.test.ts`: range='1y' URL 빌드 검증 + 기존 산출
  무회귀 (closes ≥5 시 정상 / fetch null fallback / 5분 캐시).
- `server/routes/marketDataRouter.test.ts`: GET /historical-data?range=2y 시 응답 헤더 또는
  로그에 cap 적용 흔적 + 실제 outbound URL 1y 사용.
- `scripts/check_yahoo_range.test.js` (또는 동등 회귀): 화이트리스트 외 위반 패턴 1건
  주입 시 exit 1 + 화이트리스트 통과 / 빈 코드베이스 OK.

## ENV 롤백

`YAHOO_RANGE_CAP_DISABLED=true` 시 `capYahooRange` 가 입력 그대로 반환 (정책 우회).
긴급 운영 상황에서만 사용. 검증 스크립트는 ENV 와 무관 작동.

## 비-결정 / 후속

- `CandleChart.tsx` UI '2y' 옵션 *제거* 는 사용자 UX 변경이라 본 PR 미포함. 서버 cap
  으로 데이터는 이미 1y 만 노출되므로 사용자가 '2y' 선택해도 결과는 1y 동일. 추후
  사용자 결정에 따라 옵션 제거 가능.
- `'5y'/'10y'/'max'` 가 미래에 정당한 호출자가 발생할 경우 (예: 연간 백테스트), 본
  ADR §"전역 정책" 을 개정하고 화이트리스트 확장 + 임계 재정의.
- backtestEngine/lateWinEvaluator 의 `period1/period2` 직접 지정 방식은 *영업일 단위
  precision* 이 필요한 학습 경로라 정책에서 제외 (정적 검증 스크립트가 `period1/period2`
  패턴은 검사하지 않음). 단, 호출 빈도가 폭증할 경우 별도 정책으로 격상 검토.

## 참조

- ADR-0028 safePctChange (Yahoo stale base price 차단)
- ADR-0004 Yahoo ADR 비활성 (-93.69% 케이스)
- ADR-0058 EgressGuard IntentTag
- PR-29 / PR-24 EgressGuard + 24h blacklist
- 사용자 운영 보고 (2026-04-28)
