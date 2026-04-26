# ADR-0019 — Condition Source Tier 메타 + Recommendation History 노출 (PR-B)

- **Status**: Accepted (2026-04-26)
- **Scope**: ADR-0018 PR-A 후속. PR-A 가 휴리스틱 fallback 으로 노출한 데이터 품질 카운트의 정확도 격상 + 추천 이력 추적 페이지 신설.
- **Related**: ADR-0018 (UI 재설계 P0-A), 기존 `recommendationTracker` (학습 모듈).

---

## Context

ADR-0018 PR-A 는 `DataQualityBadge` 의 분류를 클라이언트 휴리스틱으로 fallback 운영했다.
ADR-0018 §3 에서 "PR-B 에서 서버 sourceTier 메타 도착 시 정확도 격상" 으로 예고했다.

PR-A 의 문제점:
- 27 조건의 출처 분류가 키 이름 기반 휴리스틱이라 enrichment 가 실제로 사용한 데이터 출처와 어긋날 수 있음.
- 예: `roeType3` 는 `API_KEYS` 그룹이지만 enrichment 가 DART 호출 실패 시 AI 추정값을 쓰면 실제로는 `AI_INFERRED`.
- 사용자가 보는 "🟢 18" 카운트가 실제 신뢰 가능한 실계산 수보다 많거나 적을 수 있음.

또한 사용자 P0-5 "추천 이력 성과 추적" 이 미충족.
- `server/learning/recommendationTracker.ts` 가 `RECOMMENDATIONS_FILE` 에 추천을 쌓고 있으나 UI 에 노출 경로 부재.
- `getMonthlyStats()` 까지 구현되어 있으나 텔레그램 일부 명령에서만 사용.

---

## Decision

### 1. ConditionSourceTier — 27 조건 출처 분류

`StockRecommendation` 에 옵셔널 필드 신설:

```typescript
type ConditionSourceTier = 'COMPUTED' | 'API' | 'AI_INFERRED';

interface StockRecommendation {
  // ...
  /** PR-B (ADR-0019): 27 조건 항목별 실제 데이터 출처. 부재 시 PR-A 휴리스틱 fallback. */
  conditionSourceTiers?: Partial<Record<ChecklistKey, ConditionSourceTier>>;
}
```

### 2. enrichment.ts — sourceTier 메타 주입

`enrichStockWithRealData` 본체에서 27 조건을 채울 때 마다 메타도 함께 채운다.
원칙:

| 항목 분류 | sourceTier | 조건 |
|---|---|---|
| RSI/MACD/볼린저/일목/VCP/거래량/모멘텀/터틀돌파/RS/피보나치 | `COMPUTED` | OHLCV 기반 클라이언트 직접 계산 시 |
| ROE/PER/PBR/시총/외인비율/부채비율/OCF/마진/이자보상/EPS성장 | `API` | DART/Naver/KIS proxy 응답 사용 시 |
| 사이클/Risk-On/리더/정책/심리/엘리엇/촉매 | `AI_INFERRED` | Gemini 추론 사용 시 |

**fallback 분기** (DART 실패 → AI fallback) 시 해당 항목 sourceTier 도 `AI_INFERRED` 로 다운그레이드.

### 3. classifyDataQuality — 메타 우선 정확도 모드

`classifyDataQuality(stock)` 가 `stock.conditionSourceTiers` 가 있으면:
- 휴리스틱 키 그룹 무시
- 메타 기반 분류로 카운트
- `sourceMetaAvailable=true` 반환 → UI 의 ? 아이콘 사라짐

부분 메타 (일부 항목만 메타 있음) 도 지원: 메타 있는 항목은 메타 기준, 메타 없는 항목은 휴리스틱 fallback. 단 `sourceMetaAvailable=true` 는 *모든* 27 조건에 메타가 있을 때만 true.

### 4. /api/recommendations HTTP 라우트

새 라우터 `server/routes/recommendationsRouter.ts`:

| Method | Path | Response |
|---|---|---|
| GET | `/api/recommendations/history` | `RecommendationRecord[]` (slice last N + 시간 역순) |
| GET | `/api/recommendations/stats` | `{ monthly: MonthlyStats, totalCount, pendingCount }` |

쿼리 파라미터: `?limit=N` (기본 100, 최대 500).

### 5. RecommendationHistoryPage — 신규 UI 페이지

위치: `src/pages/RecommendationHistoryPage.tsx`. PageRouter 에 새 view='HISTORY' 등록.

본 PR-B 범위:
- 추천 리스트 표 (시그널 시각·종목·signalType·진입가·targetPrice·stopLoss·status·실현 수익률)
- 상단 통계 박스 (총 추천 수 / 승률 / 평균 수익률 / 복리 수익률 / Profit Factor)
- 4단계 status 색상 (PENDING=회색, WIN=녹색, LOSS=적색, EXPIRED=황색)

scope 밖 (P2):
- 조건별 성과 귀인 차트
- 추천 적중률 시계열
- 레짐별 분기 통계

---

## Consequences

### Positive

1. DataQualityBadge 정확도 격상 — 사용자가 보는 카운트가 실제 데이터 흐름과 일치.
2. 추천 이력이 UI 에 노출되어 사용자가 시스템 신뢰도를 실측으로 검증 가능.
3. PR-A 의 ? 아이콘 (휴리스틱) 이 점진적으로 사라짐 (메타 적재된 종목부터).

### Negative

1. enrichment.ts 가 약간 verbose — 각 항목 채울 때 메타도 함께 채워야 함.
2. 부분 메타 케이스에서 휴리스틱 + 메타 mix 분기 — 다소 복잡.
3. RecommendationsRouter 가 fs 직접 접근 (recommendationTracker 통해서) — 대규모 트래픽에선 cache 필요할 수 있음 (현재 < 1000 건 / 라우트 호출 빈도 낮음 — 본 PR 범위 밖).

### Neutral

- 기존 PR-A 휴리스틱 fallback 보존. 메타 부재 시 무중단.
- recommendationTracker 본체 무수정 (read 만 추가).

---

## Implementation Plan (PR-B)

1. `src/types/ui.ts` — `ConditionSourceTier` 타입 export.
2. `src/services/stock/types.ts` — `conditionSourceTiers?` 옵셔널 필드 추가.
3. `src/services/stock/enrichment.ts` — 메타 주입 로직 (`buildConditionSourceTiers(...)` 헬퍼).
4. `src/utils/dataQualityClassifier.ts` — 메타 우선 분기 + sourceMetaAvailable 격상.
5. `server/routes/recommendationsRouter.ts` 신규 + `server/index.ts` 마운트.
6. `src/api/recommendationsClient.ts` 신규 — fetch 함수.
7. `src/pages/RecommendationHistoryPage.tsx` 신규 + `PageRouter.tsx` 등록.
8. 회귀 테스트:
   - `dataQualityClassifier.metaMode.test.ts` (메타 우선 분기)
   - `enrichmentSourceTier.test.ts` (메타 주입 분기)
   - `recommendationsRouter.test.ts` (라우트 응답)
9. quality-guard + commit + push.

---

## Out of Scope (deferred PRs)

- **PR-C**: PriceAlertWatcher hook + Web Notification 권한 흐름 (P0-2).
- **P1+ (별도 PR)**: 후보군 파이프라인 / 섹터 히트맵 / 분할매수 카드 / Last Trigger / Enemy Checklist.
- **P2+ (별도 PR)**: 조건별 가중치 시계열 / 수익률 귀인 차트 / 포트폴리오 상관관계.
