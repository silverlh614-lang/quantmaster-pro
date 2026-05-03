# ADR-0180 — Rejected Winners Card (Phase 4-B-2-b1 — 사용자 §7 잔여 6 지표 중 1)

**상태**: Accepted (Phase 4-B-2-b1 — read-only endpoint + UI 카드 1종)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase4b2b1
**의존성**:
- ADR-0173 (Shadow Learning Persistence Phase 1) — `rejectionShadowTracker` SSOT (`summarizeRejectionShadow`)
- ADR-0177 (Phase 4-A endpoint) — endpoint 패턴
- ADR-0178 (Phase 4-B-1 UI) — 클라 SDK + 페이지 패턴
- ADR-0179 (Phase 4-B-2-a stats card) — 단일 카드 추가 패턴 정합

## 1. 문제

ADR-0179 Phase 4-B-2-a 머지 후 Learning Sanity Dashboard 가 3 카드 (Safety Gate Attribution + Shadow vs Live Delta + MissedLearningQueue stats). 사용자 §7 잔여 6 지표 중 *rejected winners* (rejectionShadowTracker 의 closed=true + currentReturnPct ≥ +5% 카운트) 우선 추가.

## 2. 결정

### 2.1 Phase 4-B-2-b 분할 정책 (b1 / b2 / b3)

| Phase | scope | 회귀 위험 |
|-------|-------|----------|
| **Phase 4-B-2-b1 (본 PR)** | Rejected Winners 카드 (rejectionShadowTracker summarize 활용) | 0 |
| Phase 4-B-2-b2 (별도 PR) | Stale Reflections 카드 (reflectionImpactRecorder silent/deprecated) | 0 |
| Phase 4-B-2-b3 (별도 PR) | Unresolved Counterfactuals 카드 (counterfactualShadow) | 0 |

각 카드 단일 PR 분할 — Phase 4-B-2-a 패턴 정합, 회귀 위험 격리.

### 2.2 신규 endpoint

**`GET /api/learning/rejection-shadow-stats`**:
- `summarizeRejectionShadow()` 호출 (`server/learning/rejectionShadowTracker.ts` SSOT)
- 응답: `RejectionShadowSummary` 그대로 (`totalCount` / `closedCount` / `activeCount` / `avgClosedReturnPct` / `medianClosedReturnPct` / `falseNegativeRate` / `quartiles` / `reliable`)
- 기존 `/api/learning/rejection-shadow` 와 분리 — entries 제외, summary 전용 (UI 카드 부담 ↓)

### 2.3 클라 SDK 확장

`src/api/learningDashboardClient.ts` +1 함수:
```typescript
export interface ClientRejectionShadowSummary {
  totalCount: number;
  closedCount: number;
  activeCount: number;
  avgClosedReturnPct: number;
  medianClosedReturnPct: number;
  falseNegativeRate: number;        // 0~1, 종결 entry 중 +5% 이상 비율
  quartiles?: { q1: number; q2: number; q3: number };
  reliable?: boolean;                // 표본 충분 여부
}

export async function fetchRejectionShadowStats(): Promise<ClientRejectionShadowSummary>;
```

### 2.4 신규 카드

`src/components/learning/RejectedWinnersCard.tsx`:
- `falseNegativeRate * closedCount` 계산 → winnerCount
- 4 metric grid: closedCount / winnerCount / falseNegativeRate (%) / reliable (✓/✗)
- `falseNegativeRate ≥ 0.3` rose tone (high false negative — 게이트 완화 후보)
- `falseNegativeRate < 0.1 && reliable` emerald tone (게이트 정합)
- `closedCount === 0` placeholder ("종결된 거절 0건")

### 2.5 페이지 임베드

`LearningSanityDashboardPage.tsx` 의 grid 에 4번째 카드 추가 — `xl:grid-cols-3` 그대로 (4 카드 = 1행 3 + 2행 1 또는 reflow).

## 3. 안전 invariant (Phase 4-B-2-b1 절대 규칙)

| # | invariant | 검증 |
|---|-----------|------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | KIS 주문 함수 import 0건 | learningRouter / 신규 카드 정적 grep 가드 |
| 3 | 기존 endpoint + 카드 무수정 | ADR-0177 + ADR-0178 + ADR-0179 모두 git diff 무변경 |
| 4 | read-only GET | 신규 endpoint POST/PUT/DELETE 0건 + 카드 trigger 버튼 0건 |
| 5 | 서버↔클라 직접 import 금지 | 클라 SDK 타입 동기 사본 |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **Phase 4-B-2-b2/b3 통합** — 회귀 위험 격리, 단일 카드 분할
2. ❌ **rejectionShadowTracker 본체 변경** — read-only 호출만, `summarizeRejectionShadow` 시그니처 무수정
3. ❌ **기존 `/api/learning/rejection-shadow` endpoint 재사용** — entries 부담 (limit 절삭 + 클라 계산), 분리 endpoint 가 더 효율적
4. ❌ **ENV gate 추가** — Phase 1 영속 read-only (기존 endpoint 패턴 정합)
5. ❌ **Phase 3 의존 지표 본 PR 통합** — 별도 후속 PR

## 5. Phase 4-B-2-b 후속 PR

### Phase 4-B-2-b2 — Stale Reflections 카드
- `getAllModuleStatuses()` 활용 + status='silent'/'deprecated' 카운트
- 신규 endpoint `/api/learning/reflection-stale-stats`

### Phase 4-B-2-b3 — Unresolved Counterfactuals 카드
- `loadCounterfactuals()` 활용 + `return30d`/`return60d`/`return90d` 부재 카운트
- 신규 endpoint `/api/learning/counterfactual-unresolved-stats`

### Phase 4-B-2-c — Phase 3 결합 지표
- reflection injection rate (Phase 3 wiring 후)
- learning freshness score (LearningFreshnessGuard wiring 후)

## 6. 운영 효과 (Phase 4-B-2-b1 머지 후)

- 운영자 사이드바 1 클릭으로 *rejected winners* (거짓 부정 — 게이트가 너무 엄격해서 놓친 종목) 즉시 확인
- `falseNegativeRate ≥ 0.3` 시 rose tone alert — 게이트 완화 후보 운영자 인지
- Phase 4-B-2 시리즈 진행도 1/3 → 2/3
