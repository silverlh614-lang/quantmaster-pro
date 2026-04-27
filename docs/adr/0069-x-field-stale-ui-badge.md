# ADR-0069: X-Field-Stale 헤더 → 클라이언트 store + UI 배지

**상태**: Accepted
**날짜**: 2026-04-27
**관련**: ADR-0065 (market-indicators disk snapshot, X-Field-Stale 헤더 노출), ADR-0067 (boundary 가드), ADR-0068 (macroState staleness)

---

## 1. 배경

ADR-0065 (PR-γ) 가 `/api/market-indicators` 응답에 `X-Field-Stale: vix,us10yYield` 헤더를
노출했지만, 클라이언트는 헤더 무시하고 데이터 본체만 사용. 사용자는 화면에서 어느
필드가 stale 인지 알 수 없었음.

본 ADR 은 헤더를 클라이언트에서 파싱 → store 영속 → UI 배지로 시각화한다.

---

## 2. 결정

### 2.1 `parseStaleFieldsHeader(header: string | null): string[]` SSOT

`src/services/stock/marketOverview.ts` 에 신규 export 함수. 헤더 형식
`"vix,us10yYield,kospi"` 콤마 구분 + 공백 trim + 빈 항목 제거. null/빈 문자열 → 빈 배열.

알 수 없는 필드명도 그대로 유지 — 서버 응답 필드 이름 변경 시 UI 가 자연 적응
(라벨 매핑은 화이트리스트, 미매핑은 raw 키 표시).

### 2.2 `MarketIndicatorsResult.staleFields?: string[]` 옵셔널 필드

`fetchMarketIndicators()` 응답 인터페이스에 옵셔널 추가:
- 헤더 ≥1 필드 → `staleFields: ['vix', 'us10yYield']`
- 헤더 부재 / 빈 문자열 → `undefined` (기존 호출자 호환)

기존 호출자 4건 (`marketOverview.ts:87` / `momentumRecommendations.ts:238` /
`batchIntel.ts:227,315`) 무영향 — 응답 객체 spread 사용 패턴이 아니라 키 직접 접근.

### 2.3 `useMarketStore.staleFields` 영속

```ts
staleFields: string[];
setStaleFields: (fields: string[]) => void;
```

기본값 `[]` — 부팅 직후 빈 배열, 첫 fetch 후 갱신.

### 2.4 `useMarketData` hook wiring

부팅 시 + 5분 폴링 (`setInterval(sync, 5 * 60_000)`) 으로 자동 갱신:
- `fetchMarketIndicators()` 호출 → `result.staleFields ?? []` → `setStaleFields()`
- `cancelled` 플래그로 unmount 시 race 안전

### 2.5 UI 배지 — `MarketDataStaleBadge`

`src/components/common/MarketDataStaleBadge.tsx` 신규.
- `staleFields.length === 0` → 미렌더 (정상 상태 시 화면 깨끗)
- ≥1 → amber 배지 + ⚠️ 아이콘 + "시장 데이터 N개 stale"
- 클릭 → expand: 필드 이름 목록 (한국어 라벨 매핑)
- `data-testid="market-data-stale-badge"` + `data-stale-count` (e2e 친화)
- compact / full variant 분기

### 2.6 라벨 매핑 SSOT

```
FIELD_LABELS = {
  vix: 'VIX',
  us10yYield: '미국 10Y',
  usShortRate: '미국 단기금리',
  samsungIri: '삼성 IRI',
  vkospi: 'VKOSPI',
  vkospiDayChange: 'VKOSPI 당일',
  vkospi5dTrend: 'VKOSPI 5일',
  kospi: 'KOSPI', kosdaq: 'KOSDAQ',
  ewyReturn: 'EWY 수익률',
  mtumReturn: 'MTUM 수익률',
};
```

미매핑 필드는 raw 키 표시 (서버 신규 필드 즉시 노출).

### 2.7 배치 위치

`MarketOverviewHeader` (StatusBanner 직후, MarketModeBanner 직전). compact variant
+ `flex justify-end` 우측 정렬. 다른 섹션의 시각 흐름 방해 최소화.

---

## 3. 회귀 위험

- `fetchMarketIndicators` 호출자 4건 모두 키 직접 접근 — `staleFields` 옵셔널 추가
  무영향 (회귀 테스트 12 케이스 검증)
- `useMarketStore` partialize 에 `staleFields` 미포함 — 영속 안 함 (재로드 시 빈
  배열로 시작, 첫 fetch 후 자동 갱신)
- `useMarketData` 의 `setInterval(5min)` 은 unmount 시 cleanup — 메모리 누수 없음
- 헤더 파싱 false positive: 빈 문자열·공백·콤마 연속 모두 fallback 로 안전 처리

---

## 4. 검증

회귀 테스트 12 케이스 — `src/services/stock/marketOverview.staleHeader.test.ts`:
- `parseStaleFieldsHeader` 8: null / 빈 / 단일 / 다중 / 공백 trim / 빈 항목 제거 / 공백만 제거 / 알 수 없는 필드
- `fetchMarketIndicators` 4: 헤더 정상 / 헤더 부재 → undefined / HTTP 실패 → 모든 null / 빈 헤더 → undefined

전체 lint + validate:all 9종 + precommit 통과.

---

## 5. 후속 ADR

- **ADR-0070** (MarketDataHealthScore): 본 staleFields 카운트를 점수 0-100 기여 인자
  로 통합 — 1개 stale → -10점, 3개 → -30점, 5+ → -50점.
