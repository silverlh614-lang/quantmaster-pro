# ADR-0052 — Today's One Decision Resolver + VOID Mode

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related PRs**: PR-Z4 (Phase 2 of UI 재설계)
- **Related ADRs**: ADR-0049 (Layout), ADR-0050 (Survival Gauge), ADR-0051 (Invalidation Meter)

## 1. 배경

페르소나 SYSTEMATIC ALPHA HUNTER 의 철학 1 ("필터링") 의 극단적 적용. AutoTradePage 는 이미 PR-Z1~Z3 으로 컨텍스트 기반 정렬 + 계좌 생존 + 포지션 무효화를 노출하지만, 사용자가 화면을 보고 *"그래서 지금 뭐 해야 하지?"* 를 여전히 머릿속으로 해석해야 한다. 23개 컴포넌트가 priority 순으로 정렬되더라도 *결정* 그 자체는 사용자의 합성 판단에 의존한다.

페르소나 답변 규칙 "불확실성이 높으면 관망을 정답으로 제시할 수 있다" (아이디어 10 VOID 모드의 출처) 는 *시스템이 자기 자신의 사용을 막는 UX* 를 요구한다. 이는 보유 효과와 후회 회피 편향에 대한 가장 강력한 행동적 방어.

본 ADR 은 **단일 결정 카드** 를 도입한다 — 6 case 우선순위 트리로 *지금* 답해야 할 단 하나의 결정을 추출.

## 2. 결정

`AutoTradePage` 최상단(AccountSurvivalGauge 위)에 `<TodayOneDecisionCard>` 를 추가. 클라이언트 단일 SSOT `oneDecisionResolver.ts` 가 6 case 우선순위 트리를 평가해 단일 `DecisionRecommendation` 을 반환.

### 2.1 6 Case 우선순위 SSOT

평가는 **위→아래 첫 매칭** 방식. 한 번 매칭되면 즉시 반환 (단락).

| # | caseId | 조건 | tier | headline |
|---|--------|------|------|----------|
| 0 | `EMERGENCY_STOP` | `emergencyStop=true` | EMERGENCY | "비상정지 활성 — 모든 매매 차단됨" |
| 1 | `DAILY_LOSS_EMERGENCY` | `survival.dailyLoss.tier === 'EMERGENCY'` | EMERGENCY | "일일 손실 한도 도달" |
| 2 | `INVALIDATED_POSITIONS` | InvalidationMeter tier=CRITICAL 포지션 ≥ 1 | CRITICAL | "포지션 N개 재평가 권고: {top}" |
| 3 | `ACCOUNT_CRITICAL` | survival 의 dailyLoss/sector/kelly 중 하나 CRITICAL | CRITICAL | "계좌 위험 영역 — 신규 진입 차단 권고" |
| 4 | `PENDING_APPROVALS` | `pendingApprovals.length > 0` | WARN | "승인 대기 N건: {top}" |
| 5 | `VOID` | §2.2 4 조건 모두 AND | VOID | "🌑 오늘은 진입하지 않는 것이 알파입니다." |
| 6 | `MONITORING` | 위 모두 미해당 | OK | "현재 결정할 것 없음 — 모니터링 모드" |

**우선순위 정합성**:
- `EMERGENCY_STOP` 가 `DAILY_LOSS_EMERGENCY` 보다 먼저 — 운영자가 명시적으로 누른 비상정지가 자동 trigger 보다 우선 설명되어야 함.
- `INVALIDATED_POSITIONS` 가 `ACCOUNT_CRITICAL` 보다 먼저 — 종목 단위 신호가 계좌 단위 신호보다 행동 가능성이 직접적 (어떤 종목을 매도할지 즉시 결정 가능).
- `PENDING_APPROVALS` 는 `INVALIDATED_POSITIONS` 보다 후순위 — 신규 진입은 *대기* 가능하지만 무효화된 포지션은 *지금* 결정 필요.
- `VOID` 는 `MONITORING` 위. "관망이 정답" 은 단순 모니터링과 다른 *적극적 비행동 신호*.

### 2.2 VOID 모드 4 조건 (모두 AND)

| # | check | 조건식 | 데이터 SSOT |
|---|-------|--------|-------------|
| 1 | 높은 변동성 | `vkospiZScore ≥ 1.5σ` (vix history 또는 vkospiDayChange 기반) | macroState.vixHistory[] 또는 vkospiDayChange |
| 2 | 활성 포지션 0 | `survival.sectorConcentration.activePositions === 0` | PR-Z2 SurvivalSnapshot |
| 3 | 승인 대기 0 | `pendingApprovals.length === 0` | server/telegram/buyApproval |
| 4 | 거시 리스크 활성 | `bearDefenseMode=true OR fssAlertLevel='HIGH_ALERT' OR regime='RED'` | macroState |

**vkospi z-score 계산** (변동성 SSOT):
- `vixHistory.length >= 3` 이면: `mean = avg(history)`, `stdev = sqrt(Σ(x-mean)²/n)`. `z = (현재 vix - mean) / stdev`. stdev=0 이면 0.
- 없으면 fallback: `vkospiDayChange ≥ 5` (절대값 기준 5%pt 이상 변화)
- 둘 다 없으면 z=0 → 변동성 조건 미충족 → VOID 활성 안 함 (보수적 기본값).

**4 조건 모두 충족** 해야 VOID. 4 중 3개 충족만으로는 VOID 아님 — 거짓 양성 차단.

### 2.3 DecisionRecommendation 타입 SSOT

```ts
export type DecisionTier = 'OK' | 'WARN' | 'CRITICAL' | 'EMERGENCY' | 'VOID';
export type DecisionCaseId = 'EMERGENCY_STOP' | 'DAILY_LOSS_EMERGENCY'
  | 'INVALIDATED_POSITIONS' | 'ACCOUNT_CRITICAL' | 'PENDING_APPROVALS'
  | 'VOID' | 'MONITORING';

export interface VoidCheck {
  key: 'HIGH_VOLATILITY' | 'ZERO_POSITIONS' | 'ZERO_APPROVALS' | 'MACRO_RISK';
  label: string;
  met: boolean;
  detail: string;
}

export interface DecisionRecommendation {
  caseId: DecisionCaseId;
  tier: DecisionTier;
  headline: string;
  detail: string;
  suggestedAction: string;
  triggerData?: Record<string, unknown>;  // 진단·디버그용
  voidChecks?: VoidCheck[];                // VOID 가 활성화되지 않은 경우에도 디버그 표시
}
```

### 2.4 신규 모듈

| 파일 | LoC 상한 | 책임 |
|------|---------|------|
| `server/routes/decisionInputsRouter.ts` | ≤ 80 | `GET /api/decision/inputs` — emergencyStop + pendingApprovals + macroSignals read-only |
| `src/api/decisionClient.ts` | ≤ 80 | `fetchDecisionInputs()` + 타입 동기 사본 |
| `src/utils/oneDecisionResolver.ts` | ≤ 200 | 6 case 우선순위 평가 + evaluateVoidConditions 순수 함수 SSOT |
| `src/components/autoTrading/TodayOneDecisionCard.tsx` | ≤ 220 | TanStack Query 60s + tier 색상 + VOID 가운데 배치 |

### 2.5 데이터 흐름

```
TodayOneDecisionCard
  ├─ useQuery(['account-survival'], fetchAccountSurvival)  ← PR-Z2 재활용
  ├─ useQuery(['decision-inputs'], fetchDecisionInputs)    ← 신규
  ├─ useAutoTradingDashboard().data.positions               ← 기존 (재사용)
  └─ resolveOneDecision({ survival, invalidatedPositions, inputs })
       ↓ (순수 함수, 외부 호출 0건)
     DecisionRecommendation
```

서버 outbound 0건 신규 (state.ts + buyApproval + macroStateRepo 모두 메모리 read).

### 2.6 통합 정책

- AutoTradePage 의 `AutoTradeContextualLayout` children 순서에서 `<TodayOneDecisionCard>` 를 `<AccountSurvivalGauge>` 보다 *먼저* 배치.
- 양쪽 모두 `priorityByContext` 모든 컨텍스트=1. Stable sort 의 originalIndex 순서로 TodayOneDecisionCard 가 첫 번째.
- AutoTradePage 본체 함수/state/handler 0줄 수정.

## 3. 검증

### 3.1 자동 검증 (≥ 25 케이스)

- `decisionInputsRouter` (≥ 5): 정상 응답 / state.ts throw → 500 / capturedAt ISO / pendingApprovals 정렬 / 빈 응답
- `resolveOneDecision` (≥ 12): 6 case 모두 + 우선순위 충돌 (EMERGENCY 가 항상 먼저, VOID 가 OK 보다 우선) + 빈 입력 fallback
- `evaluateVoidConditions` (≥ 5): 4 조건 모두 충족 / 1 조건 미충족 / vix history 부재 fallback / 거시 신호 OR 분기 / vkospiDayChange fallback
- `TodayOneDecisionCard` (≥ 5): tier 색상 / VOID 가운데 배치 / case 별 suggestedAction / data-case 속성 / loading/error

### 3.2 시각 검증 (DoD)

- AutoTradePage 진입 시 최상단에 단일 결정 카드 표시 (AccountSurvivalGauge 위)
- 6 case 우선순위로 정확한 결정 추출
- VOID 모드 활성 시 화면 90% 슬레이트 회색 처리 + 가운데 메시지

## 4. 영향

### 4.1 영향받는 파일

- 신규: `server/routes/decisionInputsRouter.ts` + `src/api/decisionClient.ts` + `src/utils/oneDecisionResolver.ts` + `src/components/autoTrading/TodayOneDecisionCard.tsx` + 4 테스트 파일
- 수정: `server/index.ts` (+/api/decision 마운트 1줄), `src/pages/AutoTradePage.tsx` (+1 섹션, AccountSurvivalGauge 위)
- 무수정: 서버 핵심 로직 / state.ts / buyApproval.ts / macroStateRepo.ts

### 4.2 외부 호출 예산

- 신규 outbound 0건. survival(60s) + decisionInputs(60s) + autoTradingDashboard(기존 polling) — 모두 read-only 캐시.
- KIS/KRX 자동매매 quota 0 침범.

## 5. 결정의 결과

- 사용자가 AutoTradePage 진입 즉시 *지금* 답해야 할 단 하나의 결정을 받음
- VOID 모드 활성 시 시스템이 자기 자신의 사용을 막는 UX (페르소나 철학 8 핵심)
- PR-Z1/Z2/Z3 자산 100% 재활용 — 신규 영속 SSOT 0개
- 후속 PR 들 (Phase 3 Nightly Reflection 등) 이 본 6 case 트리에 신규 case 자연 추가 가능
