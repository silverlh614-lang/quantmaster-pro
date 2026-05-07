# ADR-0443 — yahooSymbolResolver SSOT Migration (10 호출자 직접 concat 영구 제거)

@responsibility 10 호출자 `${code}.KS` / `${code}.KQ` direct template concat → yahooSymbolResolver SSOT 위임 마이그레이션.

## Status

Accepted (2026-05-07).

사용자 명시 1순위 #3 — *"yahooSymbolResolver `${code}.KS` direct concat → `tryGetYahooSymbol(code)` SSOT 위임으로 마이그레이션"* 직접 반영.

## Context

ADR-0231 (PR #624) 가 `server/screener/adapters/yahooSymbolResolver.ts` SSOT 를 도입했고, ADR-0241 가 sanity 회복 (Yahoo 한쪽 시장 STALE_BASE 응답 시 다른 시장 자동 fallback) 을 추가했다. 5 운영 경로 (buyPipeline / trancheExecutor / buyListLoop / intradayScanner / dryRunScanner) 가 SSOT 를 사용하고 있다.

하지만 코드베이스 audit 결과 **10 호출자가 여전히 `${code}.KS` 또는 `${code}.KQ` direct template concat 패턴** 을 사용하고 있어 SSOT 우회. 결함:

1. **drift 위험** — 신규 시장 (예: 코넥스) 추가 / 거래소 변경 시 호출자 측 정규식 갱신 누락 가능.
2. **마스터 lookup 미사용** — KOSPI/KOSDAQ 마스터 매칭이 가능한 종목도 brute-force 양 시장 fetch.
3. **ADR-0241 sanity 회복 미적용** — 한쪽 시장 STALE_BASE 응답을 다른 시장 fallback 으로 자동 회복하는 정책이 단순 concat 호출자에는 없음.
4. **ADR-0438 invalid code rejection 미적용** — `${code}.KS` 직접 조립 시 invalid KRX code (예: `INVALID.KS`) 가 outbound 도달.

본 PR 은 10 호출자를 SSOT 진입점 (`tryGetYahooSymbol` / `fetchYahooQuoteByCode` / `resolveYahooSymbolForCode`) 으로 일괄 마이그레이션 + 정적 grep 가드로 회귀 영구 차단.

## Decision

### 호출자 매트릭스 (10개)

#### Category A — Brute-force 양 시장 fetch (5개)

| 호출자 | 라인 | 패턴 | 마이그레이션 진입점 | 그레이스 fallback |
|---|---|---|---|---|
| `server/clients/historicalClosePrice.ts` | 49 | `const symbols = ['${code}.KS', '${code}.KQ']` | `tryGetYahooSymbol(code)` | 마스터 부재 시 `${code}.KS` + `${code}.KQ` 양쪽 시도 |
| `server/learning/backtestEngine.ts` | 73 | 동일 | `tryGetYahooSymbol(code)` | 동일 |
| `server/learning/lateWinEvaluator.ts` | 55 | 동일 | `tryGetYahooSymbol(code)` | 동일 |
| `server/alerts/reportGenerator.ts` | 509-510 | `await fetchYahooQuote(...) ?? await fetchYahooQuote(...)` | `fetchYahooQuoteByCode(code, fetchYahooQuote)` | SSOT 가 양 시장 fallback + ADR-0241 sanity 자동 |
| `server/screener/universeScanner.ts` | 179-180, 186 | 동일 + symbol field | `fetchYahooQuoteByCode(code, fetchYahooQuote)` + `tryGetYahooSymbol(code)` | symbol field 도 마스터 매칭 격상 |

**근거** — `historicalClosePrice` / `backtestEngine` / `lateWinEvaluator` 의 fetcher 는 historical bars (number 또는 raw close price) 반환이라 `fetchYahooQuoteByCode` (YahooQuoteExtended 반환) 시그니처 부적합. `tryGetYahooSymbol(code)` 만 사용하고 brute-force fallback 보존 (마스터 미커버 시 양쪽 시도 그레이스). `reportGenerator` / `universeScanner` 는 `fetchYahooQuote` (YahooQuoteExtended 반환) 사용 — `fetchYahooQuoteByCode(code, fetchYahooQuote)` 직접 위임.

#### Category B — 단일 `.KS` fallback (3개)

| 호출자 | 라인 | 패턴 | 마이그레이션 진입점 | 그레이스 fallback |
|---|---|---|---|---|
| `server/ai/prefetchedContext.ts` | 50 | `ref.symbol ?? '${ref.code}.KS'` | `tryGetYahooSymbol(code) ?? '${code}.KS'` | 마스터 매칭 시 정확한 시장, 부재 시 legacy `.KS` |
| `server/screener/stockScreener.ts` | 418 | `symbol: '${s.code}.KS'` | `tryGetYahooSymbol(s.code) ?? '${s.code}.KS'` | 동일 |
| `server/alerts/stockPickReporter.ts` | 103, 173 | `await fetchYahooQuote('${entry.code}.KS')` ×2 | `fetchYahooQuoteByCode(code, fetchYahooQuote)` | SSOT 가 양 시장 fallback + ADR-0241 sanity 자동 (격상) |

**근거** — `prefetchedContext` / `stockScreener` 의 `.KS` fallback 은 *호출자 의도된 default 값* (마스터 부재 종목도 .KS 시도). `tryGetYahooSymbol(code) ?? '${code}.KS'` 패턴으로 마스터 매칭 격상 + 기존 fallback 보존. `stockPickReporter` 는 단일 `.KS` 시도였지만 `fetchYahooQuoteByCode` 양 시장 fallback 자연 격상 (ADR-0241 sanity 자동).

#### Category C — KOSPI/KOSDAQ 분기 자체 구현 (1개)

| 호출자 | 라인 | 패턴 | 마이그레이션 진입점 | 비고 |
|---|---|---|---|---|
| `server/services/quantitativeCandidateGenerator.ts` | 86-87 | `if (entry.market === 'KOSPI') return '${entry.code}.KS'; if (entry.market === 'KOSDAQ') return '${entry.code}.KQ';` | `tryGetYahooSymbol(entry.code)` | yahooSymbolResolver 와 byte-equivalent (마스터 entry 와 동일 분기 사용) |

**근거** — 이 파일은 `getAllStockEntries()` 결과를 직접 입력으로 받지만, 동일 코드 (`getStockByCode(code)`) 가 yahooSymbolResolver 내부에서 호출 → byte-equivalent. 단순 lookup 위임으로 drift 영구 차단.

### 진입점 SSOT 규약

| 진입점 | 시그니처 | 사용 케이스 |
|---|---|---|
| `tryGetYahooSymbol(code)` | `(code: string) => string \| null` | 마스터 매칭만 필요 — 호출자가 `null` 분기 직접 처리 |
| `resolveYahooSymbolForCode(code)` | 동일 | tryGetYahooSymbol alias (legacy 명칭) |
| `fetchYahooQuoteByCode(code, fetcher)` | `(code, fetcher: (sym) => Promise<YahooQuoteExtended \| null>) => Promise<YahooQuoteExtended \| null>` | YahooQuoteExtended fetch + 양 시장 fallback + ADR-0241 sanity 통합 |

### 12 invariants (절대 변경 금지)

1. **yahooSymbolResolver SSOT 본체 0줄 변경** — 호출자만 마이그레이션 (회귀 위험 격리).
2. **호출자 측 `${code}.KS` / `${code}.KQ` direct template concat 0건** — 정적 grep 가드 영구 차단 (whitelist 4 파일만 허용 — `yahooSymbolResolver.ts` / `symbolNormalizer.ts` (ADR-0438 SSOT) / `defectEvolutionLedger.ts` (description 텍스트) / 본 회귀 테스트 파일).
3. **그레이스 fallback 그대로** — 마스터 부재 시 양쪽 시도 또는 `.KS` fallback 보존 (운영 안정성).
4. **byte-equivalent 동작** — 마스터 매칭 시 동일 결과, 부재 시 graceful fallback (호출자별 동작 무변경).
5. **KIS 주문 함수 5종 import 0건** — `placeKisOrder` / `placeKisSellOrder` / `cancelKisOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder` 절대 부재.
6. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `signalScanner/**` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts` 모두 0줄.
7. **외부 API 호출 추가 0건** — 마이그레이션은 SSOT 위임만 (Yahoo / KIS / KRX / Naver outbound 빈도 0 변경).
8. **`autoTradeEngine` / `orderExecutor` / `trancheExecutor` import 0건** (호출자 측 신규 추가).
9. **Gate threshold + condition weight + STRONG_BUY 조건 0 변경**.
10. **virtual account holdings/cash 무수정**.
11. **자동 paper/live 승격 0** — recommendation/observation only.
12. **ADR-0241 sanity 회복 자연 적용** — `fetchYahooQuoteByCode` 사용 호출자만 (양 시장 fallback + STALE_BASE 자동 다른 시장 시도). `tryGetYahooSymbol` 만 사용하는 historical fetcher 호출자는 기존 brute-force 동작 그대로 (sanity 회복 적용 없음, scope 외).

### ENV 우회

본 PR 은 ENV 우회를 도입하지 **않는다**. 마이그레이션 자체는 import path 변경이라 ENV 우회로 회피 불가. 회귀 발견 시 `git revert` 로 즉시 롤백 가능.

대신 **ADR-0241 sanity 회복**은 이미 `fetchYahooQuoteByCode` 본체에 적용되어 있다 (호출자 측 ENV 무관).

## Consequences

### 긍정

- **drift 영구 차단** — 정적 grep 가드가 신규 코드에서 `${code}.KS` direct concat 즉시 검출.
- **마스터 lookup 자연 격상** — KRX 마스터 매칭 시 정확한 1회 fetch (KIS quota / Yahoo outbound 빈도 일부 감소 효과).
- **ADR-0241 sanity 회복 자연 적용** — `reportGenerator` / `universeScanner` / `stockPickReporter` (3 호출자) 가 SSOT 사용 시 STALE_BASE 자동 다른 시장 fallback.
- **byte-equivalent 그레이스 보존** — 마스터 부재 종목 (예: KONEX/OTHER) 도 양쪽 시도 또는 .KS fallback 으로 동작 보존.

### 부정

- **historical fetcher 호출자 (3개)** 는 `tryGetYahooSymbol` 만 사용해 SSOT 격상 효과가 *마스터 매칭 시 first try 정확화* 만 한정. ADR-0241 sanity 회복 효과는 받지 못함 (fetcher 시그니처 부적합 — historical bars 반환). 별도 ADR 후속 (historical fetcher 용 SSOT 도입) scope 외.

## Migration Plan

각 호출자 변경량 (총 ~10 LoC):

1. **import 추가** (`from '../screener/adapters/yahooSymbolResolver.js'` 또는 동등 상대 path).
2. **직접 concat 제거** — 위 호출자 매트릭스 진입점 사용.
3. **ADR-0443 추적 주석** (한 줄) — 향후 audit 시 추적성.

### 회귀 테스트

`server/screener/adapters/yahooSymbolResolverAdr0443.test.ts` 신규 — 정적 grep 가드 + 동작 검증 통합.

- **정적 grep 가드 (~22 케이스)** — 10 호출자 각각 `${code}.KS` / `${code}.KQ` direct template concat 부재 + ADR-0443 추적 주석 보유 + SSOT import 보유.
- **동작 검증** — 마스터 매칭 / 부재 fallback / SSOT 위임 정합성.
- **whitelist 4 파일 회귀 가드** — `yahooSymbolResolver.ts` / `symbolNormalizer.ts` / `defectEvolutionLedger.ts` / 본 테스트 파일.
- **ADR-0146 PR 자가 review 5 카테고리 모두 PASS** (LIVE 안전성 / wiring / ADR INDEX / 회귀 ≥5/100 LoC heuristic / 정책 위반 baseline 무회귀).

## 잘못된 해결 방법 (영구 차단)

1. yahooSymbolResolver SSOT 본체 변경 (호출자만 마이그레이션).
2. ADR-0438 symbolNormalizer.ts 본체 변경 (별도 ADR scope).
3. LIVE 매매 본체 변경 (signalScanner / entryEngine / exitEngine / kisClient/** / orchestrator/** / autoTradeEngine / trancheExecutor / buyPipeline 모두 0줄).
4. KIS/KRX/Naver/Yahoo outbound 추가 (호출 빈도 0 변경 의무).
5. ENV 신규 도입 (마이그레이션은 import 변경, ENV 무관).
6. 호출자 측 인라인 KOSPI/KOSDAQ 분기 자체 구현 (`quantitativeCandidateGenerator` 같은 패턴 — yahooSymbolResolver SSOT 위임 의무).
7. historical fetcher 호출자 (`historicalClosePrice` / `backtestEngine` / `lateWinEvaluator`) 의 그레이스 양쪽 시도 fallback 제거 — 마스터 미커버 종목 영구 fetch 실패 위험.
8. `reportGenerator` / `universeScanner` 의 `quote ?? quote` nullish 패턴 보존 (ADR-0241 SSOT 사용 시 자동 sanity 회복으로 격상 의도 — 보존하면 사용자 5/6 보고 결함 영속).

## 잔여 후속 PR (scope 외)

- historical fetcher 용 SSOT 도입 (`fetchYahooHistoricalByCode(code, fetcher)`) — `historicalClosePrice` / `backtestEngine` / `lateWinEvaluator` 양 시장 fallback 통합.
- `defectEvolutionLedger.ts` description 텍스트 정합 (whitelist 보존, 변경 불필요 — text 만).

## References

- ADR-0231 (PR #624) — yahooSymbolResolver SSOT 도입.
- ADR-0241 — Yahoo quote sanity 회복 정책 (STALE_BASE 자동 다른 시장 fallback).
- ADR-0249 — `tryGetYahooSymbol` / `getYahooSymbol` global SSOT.
- ADR-0438 — symbol normalizer (KRX code 정규화 + Yahoo 심볼 변환 단일 진입점).
- ADR-0440 — symbolNormalizer 직접 import 마이그레이션 (deprecated wrapper 제거 패턴 정합).
- ADR-0146 — PR 자가 review 5 카테고리.
- ADR-0157 — ENV 정확 비교 의무 (본 PR ENV 신규 0건이라 무관).
