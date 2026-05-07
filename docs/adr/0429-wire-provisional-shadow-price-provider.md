# ADR-0429 — Wire Provisional Shadow priceProvider (Cache-First Read-Only)

@responsibility ADR-0428 Provisional Shadow Performance Report 의 `ProvisionalShadowPriceProvider` 시그니처 dead code 를 cache-first read-only 구현으로 처음 wiring — entry validation + horizon 도달 검증 + entryPrice 확보 SSOT 마련, 실제 candle/cache lookup 후속 PR scope.

## 배경

ADR-0428 (PR #688) 가 `buildProvisionalShadowPerformanceReport({ entries, nowKst, priceProvider })` 의 `priceProvider` 의존성 주입 패턴을 도입했지만:

- 실제 호출자 `/shadow_provisional` 텔레그램 명령이 `priceProvider` *미전달* → 모든 horizon `PENDING` 반환 (성과 데이터 0건).
- 사용자 §A 명시 — *"외부 API 호출 0 (default)"* + *"PENDING 만이 아닌 실제 horizon 도달 검증 + entryPrice 확보 + DATA_UNAVAILABLE 분류"* 의 균형 필요.
- ADR-0428 의 priceProvider 시그니처가 SSOT 로 정착됐지만 호출자 0건 dead code 상태.

## 결정

**Phase 1 (본 PR scope)** — Cache-first read-only `priceProvider` 구현 + `/shadow_provisional` wiring.

### 1. 가격 출처 우선순위 SSOT (사용자 §B)

`ProvisionalShadowPriceSource` 7-value union:

```
ENTRY_SNAPSHOT          → entry.entryPrice 자체 (참조용, 비교 불가)
SCAN_SNAPSHOT           → 동일 scan 의 다른 entry 가격 영속 (현재 미수집)
INTRADAY_CANDLE_CACHE   → 메모리 candle cache (T+30m / T+1h)
DAILY_CANDLE_CACHE      → 일봉 cache (SAME_DAY_CLOSE / NEXT_OPEN / T+1d / T+3d close)
MARKET_DATA_CACHE       → 일반 market data cache layer
READ_ONLY_QUOTE         → 외부 quote provider (default 비활성, ENV opt-in)
NONE                    → 어느 출처도 가용 X
```

### 2. 6-horizon 시간 계산 SSOT

`PROVISIONAL_HORIZON_OFFSET_MS` (Object.freeze):

| Horizon | offsetMs | 산출 규칙 |
|---------|----------|-----------|
| `T_PLUS_30M` | 30 × 60 × 1_000 | entryAtKst + offset |
| `T_PLUS_1H` | 60 × 60 × 1_000 | entryAtKst + offset |
| `SAME_DAY_CLOSE` | 8h (참조용) | entry 당일 KST 15:30 |
| `NEXT_OPEN` | 24h (참조용) | 다음 KRX 거래일 KST 09:00 (주말/공휴일 skip) |
| `T_PLUS_1D_CLOSE` | 32h (참조용) | 1 거래일 후 KST 15:30 |
| `T_PLUS_3D_CLOSE` | 80h (참조용) | 3 거래일 후 KST 15:30 |

**`offsetMs` 는 horizon 도달 검증용 lower bound** — `SAME_DAY_CLOSE`+ 는 실제로는 KST 15:30 / 거래일 기반 계산이 우선 (사용자 §B 정합).

`resolveHorizonTargetTimeKst` SSOT — `findNthTradingDayAfter` 로 KRX 휴장일/주말 자동 skip.

### 3. entryPrice 해결 우선순위 SSOT

`resolveEntryPrice(entry)`:

1. `entry.entryPrice` (positive finite number)
2. `entry.metadata.entryPriceHint` (positive finite number)
3. 그 외 → `undefined` → `DATA_UNAVAILABLE`

**positive finite 검증 의무** — NaN / 0 / 음수 / Infinity 모두 거부 (returnPct 0 division 차단).

### 4. 결정 트리 SSOT (사용자 §D)

```
ENV PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED=true
  → DATA_UNAVAILABLE (skipReason: 'ENV_DISABLED')
entry not found by symbol+entryAtKst
  → DATA_UNAVAILABLE (skipReason: 'ENTRY_NOT_FOUND')
entryPrice missing
  → DATA_UNAVAILABLE (skipReason: 'ENTRY_PRICE_MISSING')
lookupCachedPrice() hit
  → OBSERVED (returnPct 산출 + observedAtKst + source)
maxExternalLookups === 0 (default cache-only)
  → DATA_UNAVAILABLE (skipReason: 'CACHE_MISS_AND_EXTERNAL_DISABLED')
external lookup attempt (후속 PR scope)
  → 본 PR 미구현 → DATA_UNAVAILABLE
```

### 5. Default Cache-Only Mode

- `getMaxExternalLookups()` ENV `PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS` (default `0`).
- ADR-0157 정확 비교 의무 정합 + 음수/NaN → 0 fallback.
- 외부 API 호출 폭주 영구 차단 — 사용자 §A 핵심 invariant *"외부 API 호출 0 (default)"*.

### 6. `lookupCachedPrice` Phase 1 Stub

```typescript
export function lookupCachedPrice(
  _entry: ProvisionalShadowLedgerEntry,
  _horizon: ProvisionalShadowHorizon,
): { price: number; observedAtKst: string; source: ProvisionalShadowPriceSource } | null {
  return null; // 후속 PR scope — INTRADAY_CANDLE_CACHE / DAILY_CANDLE_CACHE / MARKET_DATA_CACHE 실제 lookup
}
```

호출자 측 cache layer 통합은 후속 PR 분리 (회귀 위험 격리).

### 7. 호출자 wiring (`/shadow_provisional`)

```typescript
const entries = loadProvisionalShadowLedger();
const priceProvider = createProvisionalShadowPriceProvider({ entries });
const summary = await buildProvisionalShadowPerformanceReport({
  entries,
  nowKst: new Date().toISOString(),
  priceProvider, // ← ADR-0429 wiring
});
```

기존 ADR-0428 동작 (priceProvider 미전달 → 모든 horizon PENDING) 은 ENV `PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED=true` 1줄로 즉시 복원.

## 안전 invariant

- **외부 API 호출 0 (default)** — `maxExternalLookups=0` 강제 + ENV opt-in 도 본 PR 미구현 → DATA_UNAVAILABLE.
- **KIS 주문 함수 5종 import 0건** — 정적 grep 가드 (`placeKisMarketBuyOrder` / `placeKisSellOrder` / `cancelKisOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder`).
- **autoTradeEngine import 0건** — 정적 grep 가드.
- **shadowTradeRepo import 0건** — 일반 shadow ledger 와 분리 (사용자 §J 정합).
- **provisional ledger SSOT 보존** — `loadProvisionalShadowLedger` 만 read, write 0건.
- **NaN/0/음수 entryPrice 차단** — returnPct 0 division 영구 차단.
- **eventType validation 의무** — `eventType !== 'PROVISIONAL_SHADOW_ENTRY'` entry 는 자동 skip (ADR-0427 일반 shadow buy 와 분리 보존).

## 잘못된 해결 방법 영구 차단

1. **외부 API 호출 default ON** — KIS/Yahoo/KRX outbound 폭주 위험 (사용자 §A invariant 위반).
2. **lookupCachedPrice 본 PR 통합 구현** — INTRADAY/DAILY/MARKET candle cache layer 통합은 회귀 위험 큼, 후속 PR 분리.
3. **shadowTradeRepo write/read** — 일반 shadow ledger 오염 (사용자 §J 정합 위반).
4. **provisional → paper/live 자동 승격** — 사용자 절대 원칙 (LIVE 매매 본체 0줄 변경 보존).
5. **entryPrice fallback 0** — returnPct 0 division 위험.
6. **SAME_DAY_CLOSE 를 단순 entry+8h 로 계산** — KST 15:30 (장 마감) 의미론 위반.
7. **NEXT_OPEN 단순 entry+24h** — 주말/공휴일 skip 누락.

## ENV 우회

- `PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED=true` (default OFF, ADR-0157 정확 비교) — provider 자체 비활성, 모든 horizon DATA_UNAVAILABLE → ADR-0428 단독 동작 (priceProvider 미전달 시 PENDING) 과 별도 분기. 회귀 발견 시 1줄 즉시 롤백.
- `PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS=N` (default 0) — 외부 lookup 횟수 상한 (현재 후속 PR scope 라 N>0 도 동작 X, 인터페이스 SSOT 만 정착).

## 회귀 테스트 (40 케이스)

- `provisionalShadowPriceProviderAdr0429.test.ts` — SSOT 정합 / `isHorizonReached` (4) / `resolveHorizonTargetTimeKst` (7 — 주말 skip / T+3d / 4-h boundary 포함) / `findNthTradingDayAfter` (4) / `resolveEntryPrice` (4 — NaN/0/음수 fallback) / ENV 우회 (6) / `createProvisionalShadowPriceProvider` (6 — 결정 트리 분기) / `wrapAsProviderObject` (1) / `provisional !== true` skip (1) / 정적 grep 가드 (6 — KIS 주문 5종 / autoTradeEngine / orderExecutor / shadowTradeRepo / fetch / axios 모두 부재).

## 잔여 후속 PR

- **ADR-0430+** — INTRADAY_CANDLE_CACHE 실제 wiring (T+30m / T+1h, 인메모리 quote snapshot 우선).
- **ADR-0430+** — DAILY_CANDLE_CACHE wiring (SAME_DAY_CLOSE / NEXT_OPEN / T+1d / T+3d, KIS daily bars 기반).
- **ADR-0430+** — MARKET_DATA_CACHE wiring (Yahoo / Naver fallback layer).
- **ADR-0430+** — READ_ONLY_QUOTE provider opt-in (외부 API quota 정책 결합).
- **ADR-0430+** — provisional → normal shadow 승격 조건 (성과 검증 + 운영자 명시 승인).

## 검증

- vitest 신규 40/40 + 인접 server/learning + server/telegram 무회귀 (provisionalShadowLedger 24 + provisionalShadowPerformanceReport 24 + shadowProvisional.cmd 7 모두 PASS).
- LIVE 매매 본체 0줄 변경 (`signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` 모두 0 LoC).
- ADR-0146 PR 자가 review 5 카테고리 PASS.
- KIS/KRX/Yahoo/Naver outbound 0 (default cache-only).

## 거버넌스

- ADR-0148 4 정적 검증 baseline 무회귀.
- ADR-0157 ENV 정확 비교 의무 정합 (`=== 'true'`).
- ADR-0159 별칭 정책 — 0429 신규 (충돌 없음).
- INDEX.md 다음 발급 0429 → 0430 갱신 + 전체 인덱스 0429 등재.
