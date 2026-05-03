# ADR-0182 — Unresolved Counterfactuals Card (Phase 4-B-2-b3 — Phase 4-B-2-b 시리즈 완주)

**상태**: Accepted (Phase 4-B-2-b3 — read-only endpoint + UI 카드 1종)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase4b2b3
**의존성**:
- ADR-0007 (PR-22 Learning Feedback Loop Policy) — `counterfactualShadow` SSOT (`loadCounterfactuals`, `getCounterfactualStats`)
- ADR-0177 (Phase 4-A endpoint) — endpoint 패턴
- ADR-0178 (Phase 4-B-1 UI) — 클라 SDK + 페이지 패턴
- ADR-0179/0180/0181 (Phase 4-B-2-a/b1/b2 카드) — 단일 카드 추가 패턴 정합

## 1. 문제

ADR-0181 Phase 4-B-2-b2 머지 후 Learning Sanity Dashboard 가 5 카드 (Safety Gate Attribution + Shadow vs Live Delta + MissedLearningQueue stats + Rejected Winners + Stale Reflections). Phase 4-B-2-b 분할 정책의 마지막 항목 *unresolved counterfactuals* (`counterfactualShadow.loadCounterfactuals` 의 `return30d`/`return60d`/`return90d` 부재 카운트 — 가격 fetcher 미실행 또는 30/60/90 영업일 미경과) 가시화 추가.

`counterfactualShadow.ts` 는 ADR-0007 (PR-22) 부터 영속 중이며, signalScanner 의 거절 분기에 wiring 되어 있어 (PR-Z1 #483) 영속 데이터 누적 중. `getCounterfactualStats(horizon)` 가 *해결된 entry 의 수익률 분포* 만 반환하지만, *미해결 entry 카운트* (학습 입력 누락 진단 지표) 는 미노출. 운영자가 *왜 학습 데이터가 누적되지 않는가* (cron 미실행 / 가격 fetcher 실패 / 표본 부족) 를 사이드바 1 클릭으로 확인 경로 부재.

## 2. 결정

### 2.1 Phase 4-B-2-b 분할 정책 (b1 머지 / b2 머지 / b3 본 PR — 시리즈 완주)

| Phase | scope | 회귀 위험 |
|-------|-------|----------|
| Phase 4-B-2-b1 (PR #540 머지) | Rejected Winners 카드 (rejectionShadowTracker summarize) | 0 |
| Phase 4-B-2-b2 (PR #541 머지) | Stale Reflections 카드 (`reflectionImpactPolicy.getAllModuleStatuses`) | 0 |
| **Phase 4-B-2-b3 (본 PR)** | Unresolved Counterfactuals 카드 (`counterfactualShadow.loadCounterfactuals`) | 0 |

각 카드 단일 PR 분할 — Phase 4-B-2-a/b1/b2 패턴 정합. 본 PR 머지 후 Phase 4-B-2-b 시리즈 *완주* (3/3).

### 2.2 신규 endpoint

**`GET /api/learning/counterfactual-unresolved-stats`**:
- `loadCounterfactuals()` 호출 (`server/learning/counterfactualShadow.ts` SSOT)
- 응답:
  ```typescript
  {
    totalCount: number;          // 영속 entry 전체
    resolved30dCount: number;    // return30d 채워진 entry 수
    resolved60dCount: number;    // return60d 채워진 entry 수
    resolved90dCount: number;    // return90d 채워진 entry 수
    pending30dCount: number;     // signalDate 30 영업일 경과 + return30d 부재
    pending60dCount: number;     // signalDate 60 영업일 경과 + return60d 부재
    pending90dCount: number;     // signalDate 90 영업일 경과 + return90d 부재
    awaitingHorizonCount: number; // signalDate 30 영업일 미경과 (정상 대기)
    oldestSignalDate?: string;   // 최오래된 signalDate
  }
  ```
- 기존 `getCounterfactualStats(horizon)` 와 분리 — *분포 분석* 이 아닌 *학습 입력 진단* 전용
- read-only — POST/PUT/DELETE 0건

### 2.3 클라 SDK 확장

`src/api/learningDashboardClient.ts` +1 함수:
```typescript
export interface ClientCounterfactualUnresolvedStats {
  totalCount: number;
  resolved30dCount: number;
  resolved60dCount: number;
  resolved90dCount: number;
  pending30dCount: number;
  pending60dCount: number;
  pending90dCount: number;
  awaitingHorizonCount: number;
  oldestSignalDate?: string;
}

export async function fetchCounterfactualUnresolvedStats(): Promise<ClientCounterfactualUnresolvedStats>;
```

절대 규칙 #3 (서버↔클라 직접 import 금지) 준수 — 동기 사본.

### 2.4 신규 카드

`src/components/learning/UnresolvedCounterfactualsCard.tsx`:
- 4 metric grid (StatCell 4종): totalCount / resolved30dCount / pending30dCount / awaitingHorizonCount
- `pending30dCount` tone 분기 (학습 입력 누락 진단):
  - `pending30dCount === 0` + totalCount ≥ 5 → emerald *cron 정상*
  - `pending30dCount ≥ 5` → rose *cron 미실행 또는 가격 fetcher 실패*
  - `pending30dCount ≥ 1` → amber *경계*
  - `totalCount === 0` → zinc *데이터 없음*
- horizon 별 진행률 (30d / 60d / 90d) — `resolved / (resolved + pending)` % 표시
- `oldestSignalDate` footer 표시 (KST)
- `totalCount === 0` placeholder ("거절 후보 0건 — `recordCounterfactual` wiring 후 자연 누적")

### 2.5 페이지 임베드

`LearningSanityDashboardPage.tsx` 의 grid 에 6번째 카드 추가 — `xl:grid-cols-3` 그대로 (6 카드 = 2행 3 reflow).

### 2.6 영업일 산정 (사용자 §1 정합)

KST 기준 영업일 산정 — 토/일 제외 + 한국 공휴일 미반영 (rejectionShadowTracker `addBusinessDays` 동일 패턴, 후속 PR 에서 KRX 휴장일 반영 시 별도 ADR). 본 PR 의 영업일 카운트는 *근사값* — *해결된 entry 카운트* 와 *시간 경과 미해결 entry 카운트* 를 분리해 운영자가 cron 작동 여부 즉시 진단 가능.

## 3. 안전 invariant (Phase 4-B-2-b3 절대 규칙)

| # | invariant | 검증 |
|---|-----------|------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | KIS 주문 함수 import 0건 | learningRouter / 신규 카드 정적 grep 가드 |
| 3 | 기존 endpoint + 카드 무수정 | ADR-0177 + ADR-0178 + ADR-0179 + ADR-0180 + ADR-0181 모두 git diff 무변경 |
| 4 | read-only GET | 신규 endpoint POST/PUT/DELETE 0건 + 카드 trigger 버튼 0건 |
| 5 | 서버↔클라 직접 import 금지 | 클라 SDK 타입 동기 사본 |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **`counterfactualShadow` 본체 변경** — read-only 호출만, `loadCounterfactuals` / `getCounterfactualStats` 시그니처 무수정
2. ❌ **기존 `getCounterfactualStats(horizon)` 결과 재사용** — *분포 분석* 이라 *미해결 카운트* 와 시그널 의미 다름
3. ❌ **카드에 manual resolve 트리거 버튼 추가** — read-only 진단만, `resolveCounterfactuals` cron 만 영속 갱신 (ADR-0007)
4. ❌ **ENV gate 추가** — Phase 1 영속 read-only (기존 카드 패턴 정합)
5. ❌ **Phase 3 의존 지표 본 PR 통합** — reflection injection rate / learning freshness score 는 Phase 4-B-2-c 후속

## 5. Phase 4-B-2 후속 PR

본 PR 머지 후 Phase 4-B-2-b 시리즈 *완주* (3/3). 잔여:

### Phase 4-B-2-c — Phase 3 결합 지표
- reflection injection rate (Phase 3 ReflectionInjectionBus wiring 후)
- learning freshness score (LearningFreshnessGuard wiring 후)

각 지표 운영 1~2주 누적 후 별도 PR.

## 6. 운영 효과 (Phase 4-B-2-b3 머지 후)

- 운영자 사이드바 1 클릭으로 *unresolved counterfactuals* (학습 입력 진단) 즉시 확인
- `pending30dCount ≥ 5` rose tone alert — counterfactual_resolve cron 미실행 또는 가격 fetcher 실패 운영자 인지 트리거
- `oldestSignalDate` 표시로 가장 오래된 미해결 entry 추적 — 영속 누적 진행도 가시화
- Phase 4-B-2-b 시리즈 *완주* (3/3) — Phase 4-B-2-c 진입 가능
