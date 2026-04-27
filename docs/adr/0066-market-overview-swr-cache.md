# ADR-0066: marketOverview AI 응답 SWR 캐시 — 6시간 버킷 키 제거 (PR-β)

**상태**: Accepted
**날짜**: 2026-04-27
**관련**: ADR-0061 (PR-α — Yahoo prefill overlay), ADR-0062 (PR-γ — disk snapshot), getCachedAIResponse (`src/services/stock/aiClient.ts` 3층 캐시)

---

## 1. 배경

`src/services/stock/marketOverview.ts:201-202` (PR-β 이전):

```ts
const hour = new Date().getHours();
const cacheKey = `market-overview-${todayDate}-${Math.floor(hour / 6)}`;

return getCachedAIResponse(cacheKey, async () => { /* AI 호출 */ });
```

6시간 버킷 키 정책의 문제:
- 같은 윈도우 안 (예: 12:00~17:59) 에서는 캐시 hit → 동일 응답 (의도 OK)
- **윈도우 boundary** 에서 (11:59 → 12:00, 17:59 → 18:00, 23:59 → 00:00, 05:59 → 06:00) 새 hallucinated 값 발생 → 화면 점프

PR-α 가 가격성 hallucination 의 *진짜 원인* 을 차단했지만, AI 분석/서술 부분 (sectorRotation / dynamicWeights / summary / euphoriaSignals 등) 은 여전히 6시간 boundary 에서 점프 가능.

### 1.1 사용자 진단

> "캐시 갱신 시점마다 데이터가 점프하는 인상을 줍니다."

---

## 2. 결정

**SWR (stale-while-revalidate)** 패턴 도입. 6시간 버킷 키 제거 + 단일 슬롯 SWR 캐시.

### 2.1 신규 모듈 — `src/services/stock/marketOverviewCache.ts`

- `FRESH_TTL_MS = 60_000` (60초) — 같은 화면 내 빠른 재로드 시 fetch 회피
- `STALE_TTL_MS = 5 * 60_000` (5분) — stale 즉시 반환 + 백그라운드 refresh
- `HARD_EXPIRY_MS = 30 * 60_000` (30분) — hard expiry, 강제 fetch (await)

### 2.2 SWR 분기 (`getOrFetchAiResponse(fetchFn, now)`)

| age | 분기 | 동작 |
|----|------|------|
| 캐시 부재 | `EMPTY` | 강제 fetch (await) + 결과 캐시 set |
| age < 60s | `FRESH` | 캐시 즉시 반환, fetch 안 함 |
| 60s ≤ age < 5min | `STALE` | 캐시 즉시 반환 (`isStale=true`) + 백그라운드 refresh fire-and-forget |
| 5min ≤ age | `EXPIRED` | hard expiry, 강제 fetch (await) — coalescing 적용 |

### 2.3 Inflight coalescing

동시 호출이 진행 중인 fetch 가 있으면 추가 fetch 발사 안 하고 기존 promise 에 편승. Gemini API 중복 호출 차단.

### 2.4 marketOverview.ts wiring

`getCachedAIResponse(cacheKey, fetchFn)` 호출 제거. `getOrFetchAiResponse(fetchFn)` 으로 교체.
- AI raw 응답만 캐시 (normalize 적용 *전*)
- prefill 결과는 매 호출마다 새로 적용 — `/api/historical-data` LRU + coalescing (ADR-0009/0010) 자동 보호

---

## 3. 효과

- **윈도우 boundary 점프 영구 차단** — 단일 슬롯 + age 기반 분기, *시간대 boundary 자체 부재*
- **빠른 재로드 부담 0** — 60초 fresh 안에서는 fetch 0 호출
- **부드러운 갱신** — 5분 stale 윈도우에서 사용자에게 즉시 응답 + 백그라운드에서 갱신 진행
- **prefill 신선도 보장** — 가격성 데이터는 캐시 fresh 안에서도 매번 새 prefill (PR-α overlay 가 normalize 시점 적용)

---

## 4. 자동매매 영향

`getMarketOverview` 호출자는 `useMarketData.ts:58` 만 (자동매매 경로 0건). LIVE 매매 본체 0줄 변경.

---

## 5. 메모리 only 정책

기존 `getCachedAIResponse` 가 3층 (메모리 / localStorage / 서버 Volume) 캐시. 본 모듈은 *메모리 only*:
- 모듈 로컬 단일 슬롯 — 탭 닫으면 소실 (의도된 동작)
- localStorage / 서버 Volume 영속 X — SWR 정책상 60초 fresh / 5분 stale 범위가 짧아 영속 가치 적음
- 단순화 우선 — `getCachedAIResponse` 의 3층 동기화 복잡성 회피

새 탭 / 새로고침 시 첫 호출은 항상 `EMPTY` → 강제 fetch. 30분 hard expiry 보다 짧음.

---

## 6. fetchFn 실패 처리

| 시나리오 | 동작 |
|---------|------|
| 첫 호출 (EMPTY) + fetchFn throw | 호출자에게 throw — 기존 동작과 동일 |
| STALE 윈도우 + 백그라운드 refresh throw | stale 캐시 그대로 살려둠 (사용자 영향 없음) + console.warn |
| EXPIRED + hard fetch throw | 호출자에게 throw — 캐시 entry 보존 (다음 호출에서 재시도 — STALE 분기 재진입 가능) |

---

## 7. 회귀 위험

- **stale 응답이 너무 오래 살아있음**: 30분 hard expiry 가 보호. 더 빠른 갱신 (예: 1분) 은 Gemini 비용 ↑ — 운영 데이터 누적 후 조정.
- **메모리 단일 슬롯 — 다중 prompt 미지원**: marketOverview 가 *단일 prompt* (시각만 prompt 안에 표시 차이) 라 단일 슬롯으로 충분. 다중 prompt 필요 시 후속 PR 에서 Map 기반 키별 슬롯 도입.
- **백그라운드 refresh failed 시 영구 stale**: stale 5분 만료 후엔 hard fetch 으로 자연 회복.

---

## 8. 테스트

- `src/services/stock/marketOverviewCache.test.ts` (15 케이스)
  - TTL 상수 정합 (FRESH < STALE < HARD_EXPIRY)
  - SWR 4분기: 캐시 부재 / FRESH (age 30s, 59,999ms 경계) / STALE (age 2min, 백그라운드 refresh) / EXPIRED (age 6min, 5min 경계 hard fetch)
  - Inflight coalescing: STALE 진행 중 동시 호출 / EMPTY 동시 첫 호출 (3 호출 → fetchFn 1회)
  - fetchFn 실패: 첫 호출 throw / STALE 백그라운드 실패 시 stale 보존 + console.warn
  - getCacheState 진단: EMPTY / FRESH / STALE / EXPIRED 분류

---

## 9. 후속 PR

- `getCachedAIResponse` 자체 SWR 격상 — momentumRecommendations / enrichment 등 다른 호출자 모두 적용
- 다중 prompt key 슬롯 (Map 기반)
- 운영자 진단 — `getCacheState` 결과 텔레그램 명령으로 노출
