# ADR-0527: ExecutionPermissionResolution Unification and PositionPolicyDecision SSOT

@responsibility trading / execution-permission / position-policy-ssot — ExecutionPermissionResolution Unification and PositionPolicyDecision SSOT

## Status

Accepted

## Context

실행 허가(execution permission)를 산출하는 resolver 가 **둘**이고, 서로 다른 형상을 반환한다:

1. `server/runtime/executionPermissionResolver.ts` 의 `resolveExecutionPermission(input)`
   → `ExecutionPermissionResolution` 을 반환한다 (P0 SSOT). 필드:
   `liveOrderAllowed`, `liveBlockReason`, `shadowOrderAllowed`, `counterfactualAllowed`,
   `executionImpact ('NONE' | 'LIVE_ORDER_ALLOWED' | 'NEW_BUY_BLOCKED_ONLY')`,
   `sizingMultiplier`, `marketSignal`, `providerIssueIsolated`, `policyLabels`, `logTags`.
2. `server/trading/gates/finalDecisionResolver.ts` 의
   `FinalDecisionResolver.resolve(input)` / `resolveFinalExecutionDecision(input, now)`
   → `FinalDecisionResolverOutput` 을 반환한다. 필드: `decision`, `liveBuyAllowed`,
   `liveSellAllowed`, `shadowAllowed`, `learningAllowed`, `convictionLabel`,
   `strongBuyAsLabelOnly`, `blockers`, `reasonCodes`.

`buildGateUxBundle` (`gateUx.cmd.ts:149`) 는 #2 를 **더미 시각 `new Date('1970-01-01')` 로
렌더 시점 재판정**한 뒤 `executionSummaryFromAudit` 로 집계해 bundle.execution 을 만든다.
한편 persisted 정본 execution 은 `gate1Survival.liveBuyBlockedCount` /
`shadowAllowedCount` + `gate3Consolidated.executionImpact` +
`canonicalRuntimeResolution.sizing` 에 이미 있다. 두 resolver + persisted 집계 = 3중 출처.

추가로 **permission(boolean) 과 count(number) 의 이름이 뒤섞여** 있다. `shadowAllowed`
(허가 boolean) 와 `shadowAllowedCount` (집계 count), `liveBuyAllowed` 와
`liveBuyBlockedCount` 가 같은 어휘를 공유해 "허가" 와 "생성 건수" 가 혼동된다 — 예:
`shadowPermissionAllowed`(boolean) ≠ `shadowOrderCreated`(count).

PositionPolicy 도 정본이 흩어져 있다. `regimePositionPolicy.ts` 가 `posPct`/`perPositionPct`/
`maxPositions`/Kelly 비활성 사유를 산출하지만, 진단 로그(diagnostic)와 LIVE 적용(live)이
명시적으로 구분되지 않아 formatter 가 어느 값이 정본인지 추론한다.

## Decision

이중 resolver 를 **통합 `ExecutionPermissionResolution` 계약 하나**로 수렴하고,
`PositionPolicyDecision` 을 정본화한다. permission(boolean) 과 count(number) 이름을 분리한다.

1. **통합 `ExecutionPermissionResolution` 계약** — 위치:
   `server/runtime/executionPermissionResolver.ts` (P0 SSOT 유지, 확장).
   두 resolver 의 **합집합 필드**를 단일 interface 로 정의: permission boolean 군
   (`liveOrderAllowed`, `liveSellAllowed`, `shadowOrderAllowed`, `counterfactualAllowed`,
   `paperFillAllowed`, `learningAllowed`), 판단 라벨 군 (`decision`, `convictionLabel`,
   `strongBuyAsLabelOnly`, `liveBlockReason`, `executionImpact`), 사이징 군
   (`sizingMultiplier`, `scorePenalty`), provider/signal 군 (`marketSignal`,
   `providerIssueIsolated`). `finalDecisionResolver` 의 gate-result 기반 판단은
   통합 resolver 의 입력 어댑터로 흡수한다 (decision/conviction 산출은 유지하되 출력 타입 통일).
2. **permission vs count 이름 분리** — boolean 권한 필드는 `*PermissionAllowed` /
   `*OrderAllowed` 접미사, 집계 건수는 `*Count` / `*Created` 접미사로 강제한다.
   예: `shadowPermissionAllowed: boolean` (허가) vs `shadowOrderCreated: number` (생성 건수).
   집계 정본(`ExecutionPermissionResolutionAggregate`)은 per-candidate
   `ExecutionPermissionResolution` 의 roll-up 이며 모든 count 에 scope 태그를 단다.
3. **`PositionPolicyDecision` interface 신설** — 위치:
   `server/trading/sizing/regimePositionPolicy.ts` (정본 추가) 또는 인접 신규 모듈.
   필드: `posPct` (per-position %), `tier` (regime/positions tier), `finalKelly`
   (number | null — 현재 정책상 비활성), `diagnosticVsLive` (값이 진단 전용인지 LIVE 적용인지
   구분하는 discriminator). formatter 는 `decision.diagnosticVsLive` 로 표본을 구분한다.
4. **`buildGateUxBundle` 의 execution override 제거** — `resolveFinalExecutionDecision(..., 1970)`
   더미 시각 재판정을 제거하고, persisted 정본(또는 ADR-0526 의
   `CandidateGateEvaluationView` 에서 파생한 통합 resolution)을 읽는다.
5. **재바인딩 우선, 삭제 후순위** — 두 resolver 함수는 즉시 삭제하지 않는다. 통합 계약을
   먼저 세우고, 소비자를 이동시킨 뒤 read-guard green + 소비자 0 확인 후 legacy resolver 정리.

구현(통합 resolver body, PositionPolicyDecision 빌더)은 engine-dev 가 채운다 — 본 ADR 은
타입 계약·명명 규율·경계만 확정.

## Consequences

긍정:

- 실행 허가 출처가 단일 통로로 수렴 (3중 출처 → 1 정본 + scope 태그된 집계).
- permission/count 이름 분리로 "허가" 와 "건수" 혼동 제거.
- PositionPolicyDecision 의 diagnostic vs live 구분으로 formatter 표본 혼동 제거.
- 더미 시각(1970) 재판정 제거로 렌더 비결정성 제거.
- 9대 불변식 #8 (실거래 차단 ≠ Shadow 차단) 이 타입 레벨에서 강제됨
  (`liveOrderAllowed=false` 여도 `shadowPermissionAllowed`/`counterfactualAllowed=true` 유지).

부정 / 제약:

- 도메인 경계가 가장 넓다 (runtime / trading-gates / sizing). 본 ADR 은 **타입 통합·경계
  정의만** 다루고, 실제 resolver body merge 는 engine-dev 단계에서 회귀 테스트와 함께 수행.
- `finalDecisionResolver` 소비자(시그널 스캐너, 진단 명령)가 다수이므로 단계적 이동 필요.

## 영향 파일

- `server/runtime/executionPermissionResolver.ts` (통합 계약 확장 — SSOT)
- `server/trading/gates/finalDecisionResolver.ts` (입력 어댑터로 흡수, 출력 타입 통일)
- `server/trading/sizing/regimePositionPolicy.ts` (`PositionPolicyDecision` 정본 추가)
- `server/telegram/commands/system/gateUx.cmd.ts` (execution override 제거)
- `server/telegram/renderers/snapshotBundle.ts` (`executionSummaryFromAudit` 입력 정합)
- 회귀 테스트: `executionPermissionResolver.test.ts` (통합 계약),
  `regimePositionPolicy` PositionPolicyDecision 테스트, `executionTerminology.test.ts` 확장.

## 회귀 테스트

1. 통합 `resolveExecutionPermission` 가 두 legacy resolver 의 모든 기존 케이스에 대해
   동일 permission boolean 을 산출 (SELL_ONLY / SHADOW_ONLY / OBSERVE_ONLY / R6 / providerIssue).
2. permission(boolean) 필드와 count(number) 필드가 타입 레벨에서 분리 (컴파일 가드).
3. `shadowPermissionAllowed=true` 가 `liveOrderAllowed=false` 와 독립 유지 (#8 불변식).
4. `PositionPolicyDecision.finalKelly` 가 현 정책상 비활성(null/disabled)임을 고정.
5. debug_raw / scan_blockers / exec compact 의 execution 숫자 byte-equivalent.

## 롤백 계획

통합 resolver 는 신규 export 로 추가하고 legacy 함수를 유지하므로, 소비자 이동 커밋만
revert 하면 즉시 이전 동작 복원. LIVE 매매 본체는 byte-equivalent 유지(허가 산출 로직 불변,
표면만 통합) — ENV 플래그로 통합 경로를 토글 가능하게 둔다. KIS/KRX quota 0 침범.

## 9대 불변식 영향

- #3 (단일 SourceSnapshot): **개선** — execution 출처 3중 → 1.
- #8 (실거래 차단 ≠ Shadow 차단): **타입 레벨 강제** — permission boolean 분리로 보강.
- #6 (Provider 장애 ≠ market signal): `providerIssueIsolated` 유지, marketSignal 변환 금지.
- #7 (L4 격리): `PositionPolicyDecision.diagnosticVsLive` 로 진단/LIVE 분리, AI_ESTIMATED 미사용.
- #1/#2 (Trading Engine / Shadow Learning 생존): 통합은 허가 로직 byte-equivalent 유지.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
