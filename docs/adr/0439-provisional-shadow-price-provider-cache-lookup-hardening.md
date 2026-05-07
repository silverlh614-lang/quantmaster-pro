# ADR-0439 — Provisional Shadow Price Provider Cache Lookup Hardening

**Status:** Accepted
**Date:** 2026-05-07
**PR:** PR-Provisional-Shadow-Price-Provider-Cache-Lookup-Hardening
**사용자 명시 ID:** ADR-0434 (실제 ADR-0434 는 *counterfactual* 측 cache wiring 인프라 — ADR-0148 INDEX SSOT 정합으로 본 PR 은 0439 재할당)
**PENDING_WIRING:** C19 (P2 부채 해소)

## 사용자 핵심 의도

> "provisional 측 lookupCachedPrice 가 stub 상태로 모든 horizon DATA_UNAVAILABLE/PENDING. ADR-0429 priceProvider 의 INTRADAY_CANDLE_CACHE / DAILY_CANDLE_CACHE / MARKET_DATA_CACHE / READ_ONLY_QUOTE 4-tier wiring 이 ADR-0434 (counterfactual) 와 동일 패턴으로 활성화되어야 한다."

PENDING_WIRING C19 부채 — *cache lookup* 만 활성화, 외부 API 호출 도입 0 (cache-only 정책 보존).

## 배경

ADR-0429 (`createProvisionalShadowPriceProvider`) 는 cache-first read-only priceProvider 시그니처와 entry validation / horizon 도달 검증 / entryPrice 확보 흐름을 정착시켰지만, `lookupCachedPrice(_entry, _horizon): null` stub 상태였다 (server/learning/provisionalShadowPriceProvider.ts:208-214). 모든 horizon 이 cache miss → `maxExternalLookups=0` (default cache-only) → `DATA_UNAVAILABLE` 또는 `PENDING` 반환. 결과적으로 ADR-0428 / ADR-0431 의 성과 리포트가 *시그니처는 작동* 하지만 *실제 데이터 0건* 인 상태가 누적.

ADR-0434 (Counterfactual Price Provider Cache Wiring) 가 *counterfactual 측* (`counterfactualShadowPriceProviderAdapter.ts`) 에서 동일 4-tier reader 를 wiring 완료했지만, *provisional 측* (`provisionalShadowPriceProvider.ts`) 은 여전히 stub 상태로 남아 있었다.

## 결정

### 1. counterfactualShadowPriceProviderAdapter 헬퍼 export 활성화 (drift 차단)

`counterfactualShadowPriceProviderAdapter.ts` 의 4 헬퍼 (이미 ADR-0434 wiring 시점에 본체 구현 완료) 에 export 키워드만 추가. 본체 동작 0 변경, 함수 시그니처 0 변경:

- `normalizeYahooSymbol(symbol: string): string` — 6자리 KRX code 에 `.KS` 접미사 부착.
- `interface ParsedYahooPoint { price: number; observedAtKst: string; timestampMs: number; }` — Yahoo chart point.
- `parseYahooChartBody(body: string): ParsedYahooPoint[]` — Yahoo chart API JSON 파서.
- `closestPointAtOrAfter(points, targetMs): ParsedYahooPoint | null` — at-or-after closest.
- `latestPoint(points): ParsedYahooPoint | null` — 최신 점.
- `readYahooSnapshotPoint(symbol, targetAtKst, range, interval, mode)` — `getSnapshot(${normalizedSymbol}:${range}:${interval})` 통합 reader.

drift 차단을 위해 *별도 inline 재구현* 금지. provisional 측은 import 으로만 사용.

### 2. `lookupCachedPrice` 4-tier wiring

기존 `lookupCachedPrice(_entry, _horizon): null` stub 을 다음 결정 트리로 활성화 (사용자 §C, 절대 변경 금지):

1. **ENV gate** — `PROVISIONAL_CACHE_LOOKUP_DISABLED === 'true'` 시 null 반환 (legacy ADR-0429 동작 100% 복원).
2. **SCAN_SNAPSHOT** — `entry.metadata.scanQuote.lastPrice` 가용 시 우선 (entry creation 시점 캡처 quote).
3. **horizon target time 산출** — `resolveHorizonTargetTimeKst(entry.createdAtKst, horizon)` 실패 시 null.
4. **horizon → reader 라우팅 매트릭스** (절대 변경 금지):
   - `T_PLUS_30M` / `T_PLUS_1H` / `SAME_DAY_CLOSE` (intraday horizons): `provisionalIntradayReader` 우선 → MARKET_DATA → READ_ONLY_QUOTE.
   - `NEXT_OPEN` / `T_PLUS_1D_CLOSE` / `T_PLUS_3D_CLOSE` (daily horizons): `provisionalDailyReader` 우선 → MARKET_DATA → READ_ONLY_QUOTE.
5. **모두 miss → null** (caller `createProvisionalShadowPriceProvider` 가 `maxExternalLookups=0` 분기로 `DATA_UNAVAILABLE` 처리).

### 3. 4 신규 reader (counterfactual 패턴 차용)

- **`provisionalIntradayReader(symbol, targetAtKst)`** — Yahoo `1d` range × `1m`/`5m`/`15m`/`30m`/`1h` interval 순회, `closest` mode.
- **`provisionalDailyReader(symbol, targetAtKst)`** — Yahoo `5d`/`1mo`/`1y` range × `1d` interval 순회, `closest` mode.
- **`provisionalMarketDataReader(symbol, targetAtKst)`** — Yahoo 다중 range/interval matrix `[1d:1m, 1d:5m, 5d:1d, 1mo:1d, 1y:1d]`, `latest` mode (정확 horizon target 미매칭 fallback).
- **`provisionalReadOnlyQuoteReader(entry)`** — `entry.metadata.readOnlyQuote.lastPrice` 양수 시 부착, `observedAtKst` 부재 시 `entry.createdAtKst` fallback.

### 4. ENV `PROVISIONAL_CACHE_LOOKUP_DISABLED` (default OFF, ADR-0157 정확 비교)

- `'true'` 정확 일치만 활성. `'1'`/`'TRUE'`/`'yes'`/`''` 모두 거부.
- 회귀 발견 시 1줄 즉시 `lookupCachedPrice` null 반환 → ADR-0429 stub 동작 100% 복원.
- `isProvisionalCacheLookupDisabled()` SSOT 헬퍼 — 호출자 측 inline ENV 검사 0건.

기존 ENV (`PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED` / `PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS`) 동작 무수정.

## 가격 source 우선순위 매트릭스 (사용자 §B)

| 순위 | source | 처리 위치 | 본 PR 활성화 |
|------|--------|-----------|-------------|
| 1 | `ENTRY_SNAPSHOT` | caller (`createProvisionalShadowPriceProvider`) — entryPrice 자체 또는 `entryPriceHint` | (별도, 본 함수 영역 외) |
| 2 | `SCAN_SNAPSHOT` | `lookupScanSnapshot(entry)` — `entry.metadata.scanQuote.lastPrice` | ✅ |
| 3 | `INTRADAY_CANDLE_CACHE` | `provisionalIntradayReader` — Yahoo 1d × 1m/5m/15m/30m/1h | ✅ |
| 4 | `DAILY_CANDLE_CACHE` | `provisionalDailyReader` — Yahoo 5d/1mo/1y × 1d | ✅ |
| 5 | `MARKET_DATA_CACHE` | `provisionalMarketDataReader` — Yahoo 다중 matrix latest | ✅ |
| 6 | `READ_ONLY_QUOTE` | `provisionalReadOnlyQuoteReader` — `entry.metadata.readOnlyQuote.lastPrice` | ✅ |
| 7 | `NONE` | caller — `DATA_UNAVAILABLE`/`PENDING` 분기 | (이미 정착) |

## horizon → reader 라우팅 매트릭스 (사용자 §C, 절대 변경 금지)

| horizon | 1순위 | 2순위 | 3순위 | 4순위 |
|---------|-------|-------|-------|-------|
| `T_PLUS_30M` | INTRADAY | MARKET_DATA | READ_ONLY_QUOTE | — |
| `T_PLUS_1H` | INTRADAY | MARKET_DATA | READ_ONLY_QUOTE | — |
| `SAME_DAY_CLOSE` | INTRADAY | MARKET_DATA | READ_ONLY_QUOTE | — |
| `NEXT_OPEN` | DAILY | MARKET_DATA | READ_ONLY_QUOTE | — |
| `T_PLUS_1D_CLOSE` | DAILY | MARKET_DATA | READ_ONLY_QUOTE | — |
| `T_PLUS_3D_CLOSE` | DAILY | MARKET_DATA | READ_ONLY_QUOTE | — |

(SCAN_SNAPSHOT 은 모든 horizon 의 0순위로 진입.)

## 안전 invariant (절대 원칙)

1. **counterfactualShadowPriceProviderAdapter 본체 동작 0 변경** — export 키워드만 추가. 기존 ADR-0431 회귀 테스트 (4 케이스) 그대로 통과.
2. **ProvisionalShadowPriceProvider 시그니처 변경 0** — `{ available: true; price; observedAtKst }` 그대로. caller 코드 0 변경.
3. **`yahooProxyCacheRepo` (offHoursSnapshotRepo) read-only** — `getSnapshot` 호출만, `setSnapshot` 호출 0건 (정적 grep 가드).
4. **KIS 주문 함수 5종 import 0건** — `placeKisMarketOrder` / `placeKisSellOrder` / `cancelKisOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder` 모두 부재 (정적 grep 가드).
5. **외부 fetch / axios / node-fetch 신규 import 0건** — `getSnapshot` 만 사용, cache-only 정책 보존.
6. **ENV `PROVISIONAL_CACHE_LOOKUP_DISABLED` default OFF** — ADR-0157 정확 비교. 활성화는 *캐시 lookup 만*, 외부 API 도입 0.
7. **호출자 측 inline ENV 검사 0건** — `isProvisionalCacheLookupDisabled()` SSOT 헬퍼 위임.
8. **`maxExternalLookups` default 0 그대로** — 본 PR 은 cache lookup 만 활성화. 외부 API 호출 도입 시 별도 ADR.
9. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts` 모두 0줄.
10. **`autoTradeEngine` / `orderExecutor` / `trancheExecutor` import 0건** (정적 grep 가드).

## 잘못된 해결 방법 영구 차단

1. **외부 API 호출 도입** — cache-only 정책 위반. `maxExternalLookups>0` 활성화는 별도 ADR (운영 비용·quota 정책 검토 의무).
2. **counterfactualShadowPriceProviderAdapter 본체 변경** — drift 위험. export 키워드만 추가, 함수 본체 / 시그니처 / 동작 변경 0.
3. **`lookupCachedPrice` 의 ENTRY_SNAPSHOT 처리** — caller 책임 (entryPrice 자체 / `entryPriceHint`). 본 함수는 *cache* lookup 만.
4. **`PENDING` / `DATA_UNAVAILABLE` 을 손실로 처리** — ADR-0428 정합 (failed 아님, 학습 표본 제외).
5. **`SCAN_SNAPSHOT` 부재 시 `ERROR` 반환** — `DATA_UNAVAILABLE` 정합 (다음 reader 진행).
6. **inline 재구현** — counterfactual 측과 drift 위험. import 으로만 reuse 의무.
7. **`source` 필드를 `ProvisionalShadowPriceProvider` 시그니처에 추가** — caller 무수정 의무. `source` 는 `lookupCachedPrice` 반환 객체 내부 진단용.
8. **Yahoo proxy cache write** — read-only. `setSnapshot` import 0건.

## 잔여 후속 PR

1. **`maxExternalLookups>0` 외부 API 활성화** — Yahoo/KIS daily bars / 실시간 quote 직접 호출. 별도 ADR (외부 quota 정책 + 비용 분석 + circuit breaker 결합 의무).
2. **`SCAN_SNAPSHOT` schema 확장** — `ProvisionalShadowLedgerEntry.metadata.scanQuote` 정식 schema 격상 (현재 옵셔널 free-form, ADR-0427 정합 검증 후).
3. **캐시 staleness 검증** — `targetAtKst` 와 `point.observedAtKst` 차이 임계 (예: 24시간 초과 시 DATA_STALE 분류). 현재는 `closest` mode 의 첫 hit 무조건 통과.
4. **`SAME_DAY_CLOSE` daily fallback** — intraday horizon 이지만 DAILY reader 도 fallback 으로 시도 (현재 INTRADAY → MARKET_DATA → READ_ONLY_QUOTE 순서).
5. **`provisional → counterfactual` source attribution** — `lookupCachedPrice` 반환 source 정보를 wrapAsProviderObject 의 `source` 필드에 정확 propagate (현재 `'ENTRY_SNAPSHOT'` 하드코딩, ADR-0429 시점 결정).

## 검증

- vitest `server/learning/provisionalShadowPriceProviderCacheLookupAdr0439.test.ts` — 38/38 PASS.
- vitest `server/learning/provisionalShadowPriceProviderAdr0429.test.ts` + `counterfactualShadowPriceProviderAdapterAdr0431.test.ts` + `provisionalShadowPerformanceReportAdr0428.test.ts` + `counterfactualShadowLearningPerformanceReportAdr0431.test.ts` — 111/111 PASS (인접 무회귀).
- vitest `server/learning` 전체 — 5 사전 baseline fail (`learningLoopHealth` 3 + `nightlyReflectionEngine` 1 + `shadowVsLiveDelta` 1) 모두 본 PR 무관 (`git stash --include-untracked` 동일 재현 확정).
- lint(client + server tsc) — 변경 파일 0 errors.
- ALLOW_DEPLOY_WINDOW=1 precommit 본체 EXIT=0.
- KIS/KRX/Yahoo/Naver outbound 0 — `getSnapshot` 만 사용, 외부 API 호출 0건.

## 사용자 명시 ADR-0434 ↔ 실제 발급 ADR-0439

- 사용자 명시 ID: `ADR-0434` (PENDING_WIRING C19 후속)
- 실제 ADR-0434: *Counterfactual Price Provider Cache Wiring* (counterfactual 측 4-tier reader wiring 인프라, 본 PR 의 정합 모델)
- 실제 발급: `ADR-0439` (INDEX `다음 발급` SSOT, ADR-0148 정합)
