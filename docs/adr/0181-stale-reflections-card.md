# ADR-0181 — Stale Reflections Card (Phase 4-B-2-b2 — 사용자 §7 잔여 5 지표 중 2번째)

**상태**: Accepted (Phase 4-B-2-b2 — UI 카드 1종, 신규 endpoint 0건)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase4b2b2
**의존성**:
- ADR-0084 (PR-Y2 Reflection Module Half-Life #444) — `reflectionImpactPolicy` SSOT + `getAllModuleStatuses` + `KNOWN_REFLECTION_MODULES` 13개 + 기존 endpoint `/api/learning/reflection-impact?days=N`
- ADR-0178 (Phase 4-B-1 UI) — 클라 SDK + 페이지 패턴
- ADR-0180 (Phase 4-B-2-b1 Rejected Winners) — 단일 카드 추가 패턴 정합

## 1. 문제

ADR-0180 Phase 4-B-2-b1 머지 후 Learning Sanity Dashboard 가 4 카드 (Safety Gate Attribution + Shadow vs Live Delta + MissedLearningQueue stats + Rejected Winners). 사용자 §7 잔여 5 지표 중 *stale reflections* (13 reflection 모듈 중 status='silent' 또는 'deprecated' 카운트 — 자기학습 자연선택 진행도) 우선 추가.

ADR-0084 가 도입한 `reflectionImpactPolicy` 가 13 모듈의 영향률을 자동 측정하고 4 분기 (normal / grace / silent / deprecated) 로 분류하지만, 그 결과를 운영자가 *텔레그램 명령* 또는 *직접 fetch* 으로만 확인 가능 — UI 가시화 부재. 운영 1~2주 누적 후 어느 모듈이 자연 은퇴 후보인지 사이드바 1 클릭으로 즉시 인지할 경로 신설.

## 2. 결정

### 2.1 Phase 4-B-2-b 분할 정책 (b1 머지 완료 / b2 본 PR / b3 후속)

| Phase | scope | 회귀 위험 |
|-------|-------|----------|
| Phase 4-B-2-b1 (PR #540 머지) | Rejected Winners 카드 (rejectionShadowTracker summarize) | 0 |
| **Phase 4-B-2-b2 (본 PR)** | Stale Reflections 카드 (`reflectionImpactPolicy.getAllModuleStatuses`) | 0 |
| Phase 4-B-2-b3 (별도 PR) | Unresolved Counterfactuals 카드 (counterfactualShadow) | 0 |

각 카드 단일 PR 분할 — Phase 4-B-2-a/b1 패턴 정합, 회귀 위험 격리.

### 2.2 신규 endpoint 0건

**기존 endpoint 재사용** — `GET /api/learning/reflection-impact?days=N` (ADR-0084, `learningRouter.ts:94-120`). 응답 schema 그대로:
```typescript
{
  windowDays: number;
  modules: ModuleStatusReport[];   // 13 entries
  summary: { total, normal, grace, silent, deprecated }
}
```

본 PR 은 *서버 endpoint 추가 0건* — 클라 SDK + Card + 페이지 임베드만. ADR-0180 보다 더 작은 변경량.

### 2.3 클라 SDK 확장

`src/api/learningDashboardClient.ts` +1 함수 + 타입 동기 사본:
```typescript
export type ClientReflectionModuleStatus = 'normal' | 'grace' | 'silent' | 'deprecated';

export interface ClientReflectionModuleReport {
  module: string;
  status: ClientReflectionModuleStatus;
  impactRate: number;
  runs: number;
  meaningfulRuns: number;
  firstSeenAt: string | null;
  ageDays: number | null;
}

export interface ClientReflectionImpactSummary {
  windowDays: number;
  modules: ClientReflectionModuleReport[];
  summary: {
    total: number;
    normal: number;
    grace: number;
    silent: number;
    deprecated: number;
  };
}

export async function fetchReflectionImpact(opts?: { days?: number }): Promise<ClientReflectionImpactSummary>;
```

절대 규칙 #3 (서버↔클라 직접 import 금지) 준수 — 동기 사본.

### 2.4 신규 카드

`src/components/learning/StaleReflectionsCard.tsx`:
- 4 status 카운트 grid (StatCell 4종): normal (✅) / grace (⏳) / silent (⚠️) / deprecated (❌)
- silent + deprecated 합계 = *자연 은퇴 후보*. 0건이면 emerald 정상, 1~2건 amber 경계, ≥3건 rose 자연선택 활발
- 모듈 리스트 (impactRate 오름차순 Top 5) — silent/deprecated 우선 표시
- 데이터 0건 (모든 module ageDays<30 grace) placeholder ("13 모듈 모두 grace — 30일 누적 후 활성화")
- `runs` 합산 + `meaningfulRuns` 합산 → 전체 평균 영향률 footer

### 2.5 페이지 임베드

`LearningSanityDashboardPage.tsx` 의 grid 에 5번째 카드 추가 — `xl:grid-cols-3` 그대로 (5 카드 = 1행 3 + 2행 2 reflow).

## 3. 안전 invariant (Phase 4-B-2-b2 절대 규칙)

| # | invariant | 검증 |
|---|-----------|------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | 서버 코드 0줄 변경 | learningRouter.ts 등 server/**/*.ts 무수정 — UI-only PR |
| 3 | 기존 endpoint + 카드 무수정 | ADR-0084 endpoint + ADR-0177/0178/0179/0180 모두 git diff 무변경 |
| 4 | 서버↔클라 직접 import 금지 | 클라 SDK 타입 동기 사본 (절대 규칙 #3) |
| 5 | 데이터 0건 placeholder | endpoint summary.normal+grace = 13 시 카드 placeholder 표시 |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **Phase 4-B-2-b3 통합** — 회귀 위험 격리, 단일 카드 분할
2. ❌ **신규 endpoint 추가** — ADR-0084 endpoint 그대로 재사용
3. ❌ **reflectionImpactPolicy 본체 변경** — read-only 호출만, `getAllModuleStatuses` 시그니처 무수정
4. ❌ **silent/deprecated 모듈 자동 wiring 차단 (ADR-0084 §"잔여")** — 본 PR 은 *측정만* (가시화), wiring 은 6개월 운영 데이터 누적 후 별도 ADR
5. ❌ **카드에 모듈 강제 deprecation 트리거 버튼 추가** — read-only 진단만, 운영자 결정 ADR-0084 §"잠재 영구화 정책"

## 5. Phase 4-B-2-b 후속 PR

### Phase 4-B-2-b3 — Unresolved Counterfactuals 카드
- `loadCounterfactuals()` 활용 + `return30d`/`return60d`/`return90d` 부재 카운트
- 신규 endpoint `/api/learning/counterfactual-unresolved-stats`

### Phase 4-B-2-c — Phase 3 결합 지표
- reflection injection rate (Phase 3 wiring 후)
- learning freshness score (LearningFreshnessGuard wiring 후)

## 6. 운영 효과 (Phase 4-B-2-b2 머지 후)

- 운영자 사이드바 1 클릭으로 *stale reflections* (silent + deprecated 카운트) 즉시 확인
- 13 모듈 중 ≥3건 silent/deprecated 시 rose tone alert — 자연선택 활발 → ADR-0084 §"silent/deprecated 가드 wiring" 별도 PR 결정
- Phase 4-B-2 시리즈 진행도 2/3 → 3/3 (b3 만 잔여)
