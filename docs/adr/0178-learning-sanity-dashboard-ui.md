# ADR-0178 — Learning Sanity Dashboard UI (Phase 4-B-1 — 클라 SDK + 2 핵심 카드 + 페이지)

**상태**: Accepted (Phase 4-B-1 — 클라 SDK + Safety Gate Attribution + Shadow vs Live Delta 2 카드 + 페이지)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase4b1
**의존성**:
- ADR-0177 (Learning Sanity Dashboard HTTP endpoint Phase 4-A) — `/api/learning/safety-gate-attribution` + `/api/learning/shadow-vs-live-delta` read-only endpoint
- ADR-0174 (Phase 2a Safety Gate Attribution + Shadow vs Live Delta 영속 분석 SSOT)
- ADR-0146 (PR-Pace Audit Rule) — Phase 분리 정합

## 1. 문제

ADR-0177 Phase 4-A 의 HTTP endpoint 2종이 *호출자 0건 dead code* 상태. UI 컴포넌트 부재로 운영자가 SHADOW 검증 시 `curl` 만으로 데이터 확인. 사용자 §7 Learning Sanity Dashboard 11 지표 UI 의 *2 핵심 지표* (Safety Gate Attribution net impact + Shadow/Live divergence) 가 endpoint 와 직접 매칭이라 우선 도입.

## 2. 결정

### 2.1 Phase 4-B 분할 정책 (4-B-1 / 4-B-2)

| Phase | scope | 회귀 위험 |
|-------|-------|----------|
| **Phase 4-B-1 (본 PR)** | 클라 SDK + 2 핵심 카드 (SafetyGateAttribution + ShadowVsLiveDelta) + 페이지 등록 | 0 (read-only UI, LIVE 매매 무관) |
| Phase 4-B-2 (별도 PR) | 사용자 §7 잔여 9 지표 (skipped jobs / replayed / failed replay / unresolved counterfactuals / stale reflections / rejected winners / gate opportunity cost / reflection injection rate / learning freshness score) | UI-only, 후속 PR |

### 2.2 클라 SDK — `src/api/learningDashboardClient.ts`

ADR-0177 endpoint 의 SDK + 타입 동기 사본 (절대 규칙 #3 준수).

```typescript
export type ClientGateName = 'FOMC' | 'VIX' | 'R0_R1_REGIME' | 'LIQUIDITY'
  | 'DATA_SANITY' | 'EXPOSURE_BUDGET' | 'ENEMY_CHECKLIST';

export interface ClientGateAttributionResult {
  gate: ClientGateName;
  avoidedLoss: number;
  missedGain: number;
  netGateImpact: number;
  blockedWinnerCount: number;
  blockedLoserCount: number;
  gatePrecision: number;
  sampleSize: number;
}

export type ClientDeltaCategory =
  | 'SHADOW_BUY_LIVE_BLOCKED'
  | 'LIVE_BUY_SHADOW_BETTER_SIZE'
  | 'EXPOSURE_CAP_REDUCED'
  | 'MACRO_GATE_BLOCKED'
  | 'LIQUIDITY_GATE_BLOCKED';

export interface ClientDeltaCategoryResult {
  category: ClientDeltaCategory;
  sampleSize: number;
  shadowReturnSum: number;
  liveReturnSum: number;
  missedAlpha: number;
  missedAlphaAvg: number;
}

export async function fetchSafetyGateAttribution(opts?: {
  days?: number;
  horizon?: 1 | 3 | 5 | 20;
}): Promise<ClientGateAttributionResult[]>;

export async function fetchShadowVsLiveDelta(opts?: {
  days?: number;
  horizon?: 1 | 3 | 5 | 20;
}): Promise<ClientDeltaCategoryResult[]>;
```

기존 `shadowLearningClient.ts` 패턴 정합 — `/api/learning` BASE_URL + fetch 함수.

### 2.3 컴포넌트 2종

**`src/components/learning/SafetyGateAttributionCard.tsx`**:
- 7 GateName 결과 grid 표시 (avoidedLoss / missedGain / netGateImpact / sampleSize)
- `netGateImpact > 0` 녹색 (손실 방지) / `< 0` 적색 (과보호) / `= 0` 회색
- `gatePrecision` 0~1 progress bar
- ENV OFF 또는 데이터 0건 시 placeholder

**`src/components/learning/ShadowVsLiveDeltaCard.tsx`**:
- 5 DeltaCategory 결과 표시 (sampleSize / missedAlpha / missedAlphaAvg)
- `missedAlpha > 0` 적색 (기회 손실) / `< 0` 녹색 (살아남은 효과)
- placeholder 동일

### 2.4 페이지 + View 등록

**`src/pages/LearningSanityDashboardPage.tsx`** 신규:
- 2 카드 grid 임베드
- 헤더 + 설명 (사용자 §7 명세 + ENV gate 안내)
- 향후 Phase 4-B-2 9 지표 추가 위치

**View 등록 4 위치**:
- `src/stores/useSettingsStore.ts` `View` enum +`'LEARNING_SANITY'`
- `src/config/viewRegistry.ts` `VIEW_LABELS.LEARNING_SANITY = 'Learning Sanity'`
- `src/config/navigation.ts` 인텔리전스 그룹에 추가 (Activity 아이콘 또는 Brain 인접)
- `src/pages/PageRouter.tsx` view 분기 추가

## 3. 안전 invariant (Phase 4-B-1 절대 규칙)

| # | invariant | 검증 |
|---|-----------|------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | 서버 코드 0줄 변경 | git diff `server/**` = 0 줄 (UI-only PR) |
| 3 | 서버↔클라 직접 import 금지 | 클라 SDK 타입 동기 사본 (절대 규칙 #3) |
| 4 | 기존 페이지 무수정 | 기존 `ShadowLearningPage` 등 모두 git diff 무변경 |
| 5 | 데이터 0건 placeholder | endpoint 빈 배열 응답 시 카드 placeholder 표시 |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **Phase 4-B-2 잔여 9 지표 본 PR 통합** — 회귀 위험 격리
2. ❌ **서버 endpoint 신규 추가** — Phase 4-A endpoint 그대로 사용
3. ❌ **서버 타입 직접 import** — 절대 규칙 #3 위반, 동기 사본 의무
4. ❌ **LIVE 매매 본체 결합** — UI-only PR
5. ❌ **기존 페이지 (ShadowLearningPage / RecommendationHistoryPage 등) 본체 변경** — 신규 페이지 분리

## 5. Phase 4-B-2 / 후속 PR

### Phase 4-B-2 — 잔여 9 지표
- skipped learning jobs (MissedLearningQueue)
- replayed missed jobs
- failed replay jobs
- unresolved counterfactuals
- stale reflections
- rejected winners
- gate opportunity cost
- reflection injection rate
- learning freshness score

각 지표는 독립 SSOT 또는 신규 endpoint 필요 — 본 PR scope 외.

### Phase 3 — LIVE 결합 (P0 SLA 21일)
- ReflectionInjectionBus + 5 early-return wiring + ENV LIVE 활성화
- `replayMissedLearningJobs` jobName → 실제 함수 매핑 dispatcher

## 6. 운영 효과 (Phase 4-B-1 머지 후)

- ADR-0177 endpoint 의 첫 UI 호출자 활성화
- 운영자 SHADOW 검증 시 사이드바 "인텔리전스 → Learning Sanity" 클릭 1회로 2 핵심 지표 즉시 확인
- 데이터 0건 시 placeholder + 향후 ENV ON 활성화 시 자연 가시화
- 회귀 위험 격리 — UI-only + 서버 0줄 + 기존 페이지 무수정
