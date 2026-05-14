# ADR-0516 — Watchlist Tier-based KIS REST 호출 차등화

@responsibility 워치리스트 Tier별 KIS REST 호출 빈도 차등화 — KIS 400/부하 완화. MOMENTUM_PASSIVE 는 WS/cache 만, OPEN_POSITION/force buy 는 항상 REST 보호.

## 컨텍스트

KIS REST API 400/부하 누적 — `getPrice()` 가 모든 워치리스트 후보에 대해 WS 실시간 가격 미보유 시 `fetchCurrentPrice` REST fallback 을 무차별 호출한다. MOMENTUM 섹션은 `AUTO_SHADOW_FROM_MOMENTUM` 경로로 buyList 에 포함되어 학습 표본만 남기는데도, 진입 가능성이 낮은 MOMENTUM 후보까지 매 스캔 사이클마다 REST 가격을 조회해 KIS quota 를 소모한다.

기존 정책 (ADR-0437 KIS WebSocket Priority Queue, Telegram/snapshot-only) 은 WS 구독 우선순위와 알림 빈도를 다루지만, **REST 가격 조회 빈도 자체의 후보별 차등화** 는 부재했다.

## 결정

### 결정 1 — `watchlistKisTierPolicy.ts` SSOT 신설

5-tier 분류 + 정책 결정 단일 출처:

| Tier | allowRestPrice | priceTtlMs | 조건 |
|---|---|---|---|
| `OPEN_POSITION` | true | 5,000 | 보유 종목 (shadows 활성) — KIS 부하 무관 항상 보호 (P0) |
| `ENTRY_CANDIDATE` | true* | 15,000 | SWING 섹션 또는 force buy (P0). *RED 시 SWING 은 WS 우선 (false) |
| `CATALYST_ACTIVE` | true | 30,000 | CATALYST 섹션 — RED 시에도 REST 허용 (catalyst 이벤트 우선) |
| `MOMENTUM_ACTIVE` | true | 90,000 | MOMENTUM `momentumRank` 상위 N개 (GREEN 15 / YELLOW 7, env override) |
| `MOMENTUM_PASSIVE` | false | 180,000 | MOMENTUM 하위 / no-rank — REST 차단, WS/cache 만 |

`resolveWatchlistKisPolicy(input)` 결정 트리 우선순위: ① isOpenPosition → OPEN_POSITION ② isForceBuy → ENTRY_CANDIDATE ③ SWING → ENTRY_CANDIDATE ④ CATALYST → CATALYST_ACTIVE ⑤ MOMENTUM → rank 분기 ⑥ section 미상 → ENTRY_CANDIDATE (보수 fallback, REST 허용 — 기존 동작 보존).

### 결정 2 — KIS 부하 상태 ENV `KIS_LOAD_STATE`

`GREEN` (default) / `YELLOW` / `RED`. 미설정/미상 시 GREEN — 기존 동작 100% 보존.
- **YELLOW**: MOMENTUM_ACTIVE 정원 축소 (15 → 7).
- **RED**: 모든 MOMENTUM REST 금지 (MOMENTUM_PASSIVE 강제) + SWING(ENTRY_CANDIDATE) WS/cache 우선.
- **OPEN_POSITION 은 모든 부하 상태에서 항상 REST 보호** (P0).

### 결정 3 — `getPrice()` 컨텍스트 확장 + REST 차단

`GetPriceSubscriptionContext` 에 옵셔널 필드 추가: `section` / `gateScore` / `stage2Score` / `allowRestFallback` / `restTtlMs` / `pricePurpose`. `getPrice()` 는 `ctx.allowRestFallback === false` 일 때만 `fetchCurrentPrice` 를 호출하지 않고 null 반환 — `undefined` (미전달) 는 기존 동작 보존 (후방호환). **ADR-0437 `requestKisWsSubscription` WS 구독 우선순위는 무변경** — REST 차단과 무관하게 항상 호출.

### 결정 4 — `momentumRank` runtime-only 필드

`assignMomentumRanks()` 가 MOMENTUM 섹션에 1-based 순위 부여. 정렬 SSOT: stage2Score → gateScore → addedAt 최신 → code 오름차순 (deterministic). **watchlistRepo 영속 schema 변경 금지** — `momentumRank` / `isForceBuy` 는 cast 로 부여하는 runtime-only 필드. `candidateSelect.ts` 가 매 스캔 사이클마다 재계산.

### 결정 5 — MOMENTUM_PASSIVE no-price 는 SKIP, FAIL 아님

`buyListLoop.ts` 가 tier 정책 REST 차단으로 가격 미확보 시 `stageLog.price = 'SKIP_TIER_PASSIVE_NO_REST'` + `waitTierRestSuppressed` 카운터 누적 + `continue`. **DATA_VACUUM / providerIssue / marketSignal / NEW_BUY_BLOCKED 으로 격상 금지.** Shadow learning 은 계속되나 가격 부재 MOMENTUM_PASSIVE 후보는 이번 사이클 학습 표본을 건너뛴다.

### 결정 6 — `investorFlowWarmupJob` tier-aware 선정

warmup 후보를 active / passive 2-bucket 으로 분리 — MOMENTUM_PASSIVE 는 후순위 (lower-priority). warmup capacity 를 SWING/CATALYST/MOMENTUM_ACTIVE 에 집중. 하드 exclude 아님 — 잔여 limit capacity 있으면 MOMENTUM_PASSIVE 도 warmup.

## 불변식

- 매매엔진 / 주문 / 매도 / 보유 관리 / Shadow learning 로직 0줄 변경
- `kisPost` / `kisGet` 저수준 HTTP 동작 무변경
- ADR-0437 KIS WebSocket priority builder 정책 무변경 — REST 차단과 독립
- watchlistRepo 영속 schema 무변경 — `momentumRank` / `isForceBuy` 는 runtime-only cast
- `getPrice(stockCode)` ctx 미전달 기존 호출자 동작 100% 보존 (`allowRestFallback` undefined → REST 허용)
- ENV `KIS_LOAD_STATE` 미설정 시 GREEN — 기존 동작 100% 보존
- Telegram 알림 추가 0건 — compact DEBUG 로그만 (`WATCHLIST_KIS_TIER_DEBUG=true` 게이팅)
- P0 보호 — OPEN_POSITION (보유 종목) + force buy 는 KIS 부하 무관 항상 REST 허용
- KIS/KRX/Yahoo/Naver outbound 빈도 감소 (REST 호출 차등화) — 신규 outbound 0건

## 잘못된 해결 방법 영구 차단

- MOMENTUM_PASSIVE no-price 를 FAIL / DATA_VACUUM / providerIssue / NEW_BUY_BLOCKED 으로 격상 — 후보 없음 ≠ 데이터 결손
- OPEN_POSITION / force buy 를 KIS 부하 상태로 REST 차단 — P0 보호 위반
- `momentumRank` / `isForceBuy` 를 watchlistRepo 영속 schema 에 추가 — runtime-only 의무
- `getPrice` 의 REST 차단을 `allowRestFallback` truthy 검사로 — `=== false` 정확 비교 의무 (후방호환)
- KIS WebSocket priority builder 를 REST 차단 로직에 결합 — 독립 유지
- 호출자 측 inline `process.env.KIS_LOAD_STATE` 검사 — `resolveKisLoadStateFromEnv()` SSOT 위임

## 회귀 테스트

- `watchlistKisTierPolicy.test.ts` — resolveWatchlistKisPolicy 결정 트리 (OPEN_POSITION P0 / force buy P0 / SWING·CATALYST·MOMENTUM 분기 / GREEN·YELLOW·RED 부하 분기 / section 미상 fallback) + assignMomentumRanks 정렬 SSOT (stage2Score → gateScore → addedAt → code) + resolveKisLoadStateFromEnv ENV 도출 + 상수 SSOT 정합
- `getPriceTierPolicy.test.ts` — allowRestFallback false 시 fetchCurrentPrice 미호출 + null + WS subscription 은 호출 / true·undefined 시 REST fallback / ctx 미전달 후방호환 / WATCHLIST_KIS_TIER_DEBUG 게이팅
- `buyListLoopTierWiring.test.ts` — buyListLoop + candidateSelect + helpers + investorFlowWarmupJob 정적 grep 가드 (wiring 위치·인자·SKIP 처리·격상 금지·runtime-only cast 보존)
