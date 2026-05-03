# ADR-0179 — MissedLearningQueue Stats Card (Phase 4-B-2-a — 잔여 9 지표 시작 MVP)

**상태**: Accepted (Phase 4-B-2-a — read-only endpoint + UI 카드 1종)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase4b2a
**의존성**:
- ADR-0173 (Shadow Learning Persistence Phase 1) — `MissedLearningQueue` 영속 SSOT (`loadMissedLearningQueue`)
- ADR-0177 (Learning Sanity Dashboard HTTP endpoint Phase 4-A) — endpoint 패턴
- ADR-0178 (Learning Sanity Dashboard UI Phase 4-B-1) — 클라 SDK + 페이지 패턴
- ADR-0146 (PR-Pace Audit Rule) — Phase 분리 정합

## 1. 문제

Phase 4-B-1 (PR #538) 머지 후 Learning Sanity Dashboard 가 2 핵심 카드 (SafetyGateAttribution + ShadowVsLiveDelta) 만 표시. 사용자 §7 잔여 9 지표 (skipped jobs / replayed / failed replay / unresolved counterfactuals / stale reflections / rejected winners / gate opportunity cost / reflection injection rate / learning freshness score) 부재.

## 2. 결정

### 2.1 Phase 4-B-2 분할 정책 (4-B-2-a / b / c)

| Phase | scope | 회귀 위험 |
|-------|-------|----------|
| **Phase 4-B-2-a (본 PR)** | MissedLearningQueue stats 카드 (skipped/replayed/failed/dropped 3 지표) | 0 (read-only UI) |
| Phase 4-B-2-b (별도 PR) | Counterfactual + Rejection + Reflection 통계 카드 (이미 SSOT, endpoint 활용) | 0 (read-only UI) |
| Phase 4-B-2-c (별도 PR) | Phase 3 결합 지표 (reflection injection rate / learning freshness score) | Phase 3 wiring 의존 |

본 PR 은 사용자 §7 의 *3 지표* 만 (skipped learning jobs + replayed missed jobs + failed replay jobs). dropped 는 부가 통계 (14일 STALE drop, ADR-0173 §1).

### 2.2 신규 endpoint

**`GET /api/learning/missed-learning-queue-stats`**:
- `loadMissedLearningQueue()` 영속 read
- status 별 카운트 집계 — `{ pending, replayed, failed, dropped, total, lastUpdatedAt? }`
- ENV gate 부재 — Phase 1 영속 read-only (이미 영속된 데이터 노출, 빈 큐 시 모든 카운트 0)

응답 schema:
```typescript
export interface MissedLearningQueueStats {
  pending: number;        // status='PENDING' 카운트 (replay 대기)
  replayed: number;        // status='REPLAYED' 카운트
  failed: number;          // status='FAILED' 카운트 (재시도 한계 초과)
  dropped: number;         // status='DROPPED' 카운트 (14일 STALE)
  total: number;           // 전체 카운트
  lastEnqueuedAt?: string; // skippedAt 의 최대 (ISO)
}
```

기존 8+2 endpoint (ADR-0177) 와 동일 패턴 — read-only GET + try/catch + 500 fallback.

### 2.3 클라 SDK 확장

`src/api/learningDashboardClient.ts` +1 fetch 함수:
```typescript
export interface ClientMissedLearningQueueStats {
  pending: number;
  replayed: number;
  failed: number;
  dropped: number;
  total: number;
  lastEnqueuedAt?: string;
}

export async function fetchMissedLearningQueueStats(): Promise<ClientMissedLearningQueueStats>;
```

### 2.4 신규 카드

`src/components/learning/MissedLearningQueueStatsCard.tsx`:
- 4 status 카운트 grid (pending / replayed / failed / dropped)
- `pending > 0` amber tone (replay 대기 alert)
- `failed > 0` rose tone (재시도 한계 초과 alert)
- `lastEnqueuedAt` KST 시각 표시
- `total === 0` 시 placeholder ("MissedLearningQueue 비어있음 — 휴장일/장애 미발생 또는 ENV `MISSED_LEARNING_QUEUE_ENABLED` 미활성")

### 2.5 페이지 임베드

`LearningSanityDashboardPage.tsx` 의 grid 에 3번째 카드 추가:
```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
  <SafetyGateAttributionCard ... />
  <ShadowVsLiveDeltaCard ... />
  <MissedLearningQueueStatsCard ... />
</div>
```

## 3. 안전 invariant (Phase 4-B-2-a 절대 규칙)

| # | invariant | 검증 |
|---|-----------|------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | KIS 주문 함수 import 0건 | learningRouter / 신규 카드 정적 grep 가드 |
| 3 | 기존 endpoint + 카드 무수정 | ADR-0177 endpoint 2종 + ADR-0178 카드 2종 모두 git diff 무변경 |
| 4 | read-only GET | 신규 endpoint POST/PUT/DELETE 0건 |
| 5 | 서버↔클라 직접 import 금지 | 클라 SDK 타입 동기 사본 (절대 규칙 #3) |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **Phase 4-B-2-b/c 통합** — 회귀 위험 격리 (3 단계 분할)
2. ❌ **ENV gate 추가** — Phase 1 영속 read-only, ENV 부재 시에도 빈 큐 응답
3. ❌ **MissedLearningQueue 본체 변경** — read-only 호출만, `loadMissedLearningQueue` 시그니처 무수정
4. ❌ **신규 카드에 enqueue/replay 트리거 버튼 추가** — read-only UI invariant 위반 (운영자 트리거는 텔레그램 명령 또는 cron)
5. ❌ **Phase 3 의존 지표 (reflection injection rate / learning freshness score) 본 PR 통합** — Phase 3 wiring 후 별도 PR

## 5. Phase 4-B-2-b / c 후속 PR

### Phase 4-B-2-b — Counterfactual + Rejection + Reflection 통계
- unresolved counterfactuals (`counterfactualShadow` SSOT)
- stale reflections (`reflectionImpactRecorder` silent/deprecated 카운트)
- rejected winners (`rejectionShadowTracker` currentReturnPct ≥+5% 카운트)

기존 SSOT 활용 (Phase 1+2a), 신규 endpoint 3종 + 카드 3종.

### Phase 4-B-2-c — Phase 3 결합 지표
- reflection injection rate (Phase 3 ReflectionInjectionBus wiring 후)
- learning freshness score (LearningFreshnessGuard wiring 후)

Phase 3 머지 후 진행.

## 6. 운영 효과 (Phase 4-B-2-a 머지 후)

- 운영자 사이드바 *인텔리전스 → Learning Sanity* 1 클릭으로 MissedLearningQueue 상태 즉시 확인
- ENV `MISSED_LEARNING_QUEUE_ENABLED` 활성화 + KRX 휴장일 진입 시 `pending > 0` amber 표시
- replay cron 작동 후 `replayed` 증가 + `pending` 감소
- 재시도 한계 초과 시 `failed` 증가 + 운영자 즉시 인지 (rose tone)
- Phase 4-B-2-b/c 후속 PR 의 데이터 입력 인프라 확장
