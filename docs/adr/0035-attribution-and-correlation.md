# ADR-0035 — 조건별 수익률 귀인 + 글로벌 상관관계 (PR-H)

- **Status**: Accepted (2026-04-26)
- **Scope**: 사용자 P2-2 (포트폴리오 상관관계 방어막) + P2-3 (수익률 귀인 분석) + P2-5 (조건별 가중치 변화 시각화).
- **Related**: ADR-0029 (PR-B), ADR-0034 (PR-G).

---

## Context

서버 `attributionRepo.computeAttributionStats()` 가 27 조건별 가중 winRate /
avgReturn / avgReturnWhenHigh / avgReturnWhenLow 를 보유. UI 노출 경로 부재.

`useGlobalIntelStore.globalCorrelation` 이 KOSPI-S&P500 / Nikkei / Shanghai / DXY
4축 상관계수를 보유. UI 부재.

본 PR-H 는 이 두 데이터를 시각화로 표면화. 사용자별 보유 종목 간 상관관계는 종목별 OHLCV
요청 인프라 필요 — 후속 PR.

---

## Decision

### 1. /api/attribution/stats HTTP 엔드포인트

신규 라우터 `server/routes/attributionRouter.ts`:

```
GET /api/attribution/stats
→ {
    stats: AttributionConditionStat[];  // 27 조건별 winRate/avgReturn/...
    totalRecords: number;
  }
```

### 2. ConditionAttributionChart 컴포넌트

`src/components/analysis/ConditionAttributionChart.tsx`:
- TanStack Query useQuery (`['attribution', 'stats']`, 60초 staleTime).
- 조건별 막대 그래프 — winRate (% 0~100) + avgReturn (% 양/음 색상).
- conditionId 별 이름 매핑 (`CONDITION_NAMES` SSOT 재사용).
- 정렬: avgReturn 내림차순.
- 데이터 부재 시 placeholder.

### 3. GlobalCorrelationCard 컴포넌트

`src/components/macro/GlobalCorrelationCard.tsx`:
- `useGlobalIntelStore.globalCorrelation` 직접 읽기.
- 4축 상관계수 (KOSPI-S&P500 / Nikkei / Shanghai / DXY) gauge bar 시각화.
- isDecoupling / isGlobalSync 알림 배지.
- 데이터 부재 시 placeholder.

### 4. 임베드 위치

- `RecommendationHistoryPage` 끝부분에 `ConditionAttributionChart` 추가 (수익률 귀인 + 가중치 통합).
- `MacroIntelligencePage` 7번째 카드로 `GlobalCorrelationCard` 추가.

---

## Consequences

### Positive

1. 사용자 P2-3 + P2-5 충족 — server attributionRepo 자산이 차트로 표면화.
2. 사용자 P2-2 (간략) — globalCorrelation store 자산이 카드로 노출.
3. 운영자가 27 조건 중 어느 조건이 실제 수익에 기여하는지 가시화 → 가중치 조정 의사결정.

### Negative

1. 사용자 보유 종목 간 직접 상관관계는 본 PR 미포함 (별도 인프라 필요) — globalCorrelation 으로 1차 대체.
2. attribution 데이터가 적게 쌓인 환경(신규 사용자) 에선 차트 의미 부족 — placeholder 유도.

### Neutral

- attributionRepo 본체 무수정 (read-only 노출).
- 라우터는 외부 호출 0건.

---

## Implementation Plan (PR-H)

1. `server/routes/attributionRouter.ts` 신규 + 단위 테스트.
2. `server/index.ts` 마운트 (`/api/attribution`).
3. `src/api/attributionClient.ts` 신규.
4. `src/components/analysis/ConditionAttributionChart.tsx` 신규.
5. `src/components/macro/GlobalCorrelationCard.tsx` 신규.
6. `RecommendationHistoryPage` + `MacroIntelligencePage` 임베드.
7. quality-guard + commit + push.

---

## Out of Scope

- 사용자 보유 종목 간 직접 상관관계 매트릭스 — 종목 OHLCV 인프라 필요, 후속 PR.
- 시계열 추이 차트 (어제 vs 오늘 winRate 변화) — 후속 PR.
- 조건별 가중치 사용자 편집 UI — 후속 PR.
