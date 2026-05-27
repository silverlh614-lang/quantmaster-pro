# ADR-0535: regime-authority-hierarchy-decision-context-ssot

@responsibility governance — regime-authority-hierarchy-decision-context-ssot

## Status

Proposed

## Context

`/regime` 매크로 카드와 `/scan_blockers` 가 동일한 SourceSnapshot 위에서 5개 이상의
"regime 유사" 값을 서로 다른 형식으로 노출한다: `rawRegime`, `effectiveRegime`,
`displayRegime`, `riskOverride`, `engineMode`, `finalExecutionPolicy`,
`legacyEffectiveRegime`. 운영자는 **어느 값이 권위(authoritative)인지** 분간할 수 없고,
특히 `R3_EARLY`/`R5_CAUTION`(시장/스코어링 레짐)과 `SHADOW_ONLY`(실행/표시 정책)가 같은
"레짐" 라인에 섞여 표시되어 "실주문이 가능한가?"를 화면만 보고 판단할 수 없다.

이는 **계산(math)의 문제가 아니라 권위(authority)의 문제**다. 각 값은 이미 정본 소스에서
올바르게 산출되고 있다:

- `server/runtime/executionPermissionResolver.ts` — `ExecutionPermissionResolution`.
  실행 권한 정본. `finalExecutionPolicy` 2값(`'LIVE_ORDER_ALLOWED' | 'SHADOW_AND_DIAGNOSTIC_ONLY'`),
  `liveOrderAllowed`, `liveBlockReason`, `shadowEvaluationAllowed`(=Shadow learning, 항상 true),
  `counterfactualAllowed`(항상 true), `scorePenalty`, `sizingMultiplier`.
- `server/trading/regime/regimeResolver.ts` (`resolveRegimeSnapshot`) +
  `server/trading/regime/gate0RegimeView.ts` (`buildGate0RegimeView`) —
  raw/effective/display/riskOverride 및 legacy(deprecated) 라벨 정본.
- `server/trading/sizing/regimePositionPolicy.ts` — exposure/maxPositions/positionCap.

선행 ADR:
- **ADR-0531** (Gate0 Regime SSOT 단일화) — canonical = `resolveRegimeSnapshot().effectiveRegime`,
  legacy `getLiveRegime`/transitionState 는 `deprecated`/`notUsedForDecision` 라벨 전용,
  decision 소비처 마이그레이션은 단계적 rollout. 본 ADR 은 그 위계를 화면 계약으로 헌법화한다.
- **ADR-0527** (ExecutionPermissionResolution Unification) — 실행 권한 정본 통합. 본 ADR 은
  그 결과를 "최종 주문 권한"의 단독 권위로 못박는다.

## Decision

### 1. 5단계 권한 위계(Authority Hierarchy) 헌법화 (verbatim)

1. **최종 주문 권한 = ExecutionPolicy (`ExecutionPermissionResolution`).** 실주문 가능 여부를
   **단독으로** 결정하는 유일한 권위.
2. **운영자 톱라인 표시 권한 = `displayRegime`** (예: `SHADOW_ONLY`).
3. **스코어링/사이징/Kelly 권한 = `effectiveRegime`** (예: `R3_EARLY` / `R5_CAUTION`).
   실주문 권한을 **직접 결정하지 않는다.**
4. **시장 원시 상태 = `rawRegime`.** 순수 시장 국면이며 주문 권한 근거가 **아니다.**
5. **`legacyEffectiveRegime` = 진단/비교 전용.** `deprecated=true`, `usedForDecision=false`,
   Gate/스코어링/사이징/권한에 **절대 미투입.**

핵심 원칙(헌법 문장): *"R3_EARLY/R5_CAUTION 은 시장/스코어링 레짐, SHADOW_ONLY 는 실행/표시
정책이다. 최종 주문 권한은 레짐 이름이 아니라 ExecutionPolicySnapshot 이 결정한다."*

### 2. `SourceSnapshotDecisionContext` read-model (단일 객체)

모든 운영자 화면이 읽는 단일 진단 read-model 을 정의한다
(`server/runtime/sourceSnapshotDecisionContext.ts`). 구조: `snapshotId/asOf/ttlSec` +
`marketRegime`(위계 2~5) + `executionPolicy`(위계 1) + `scoringPolicy`(위계 3).

- **READ-MODEL ONLY** — 기존 정본 소스 위의 타입 투영(projection)일 뿐. resolver 계산을
  변경하지 않는다. resolver 의 `finalExecutionPolicy` 는 기존 2값 union 그대로 유지한다.
- 화면용 4값 DISPLAY 라벨 `FinalExecutionPolicyDisplayLabel`
  (`LIVE_ALLOWED | SHADOW_AND_DIAGNOSTIC_ONLY | SELL_ONLY | OBSERVE_ONLY`)은 read-model 의
  **파생 표시 필드**이며 resolver 변경이 아니다. 매핑 규칙:
  `LIVE_ORDER_ALLOWED → LIVE_ALLOWED`; `SHADOW_AND_DIAGNOSTIC_ONLY` 유지;
  `displayRegime/engineMode === SELL_ONLY → SELL_ONLY`;
  `engineMode === OBSERVE_ONLY → OBSERVE_ONLY`. (매핑 구현은 engine-dev.)
- **byte-equivalent to live trading** — Gate threshold 변경 없음, supply semantic 변경 없음,
  ConditionResults 변경 없음, live-order-permission 변경 없음. **`executionImpact = NONE`.**

### 3. 위계 불변식 8개 (engine-dev assert / quality-guard test)

invariant-spec 의 7개 + "legacyUsedForDecision 은 항상 리터럴 false" 를 포함한다. 상세는
`_workspace/2026-05-27_regime-authority-hierarchy/architect/invariant-spec.md`.

### 4. 단계적 rollout (staged)

본 패치는 read-model 계약(architect)과 **2개 소비 화면 wiring(engine-dev)**에 한정한다:
`server/telegram/commands/system/regime.cmd.ts`(매크로 카드)와
`server/trading/signalScanner/scanDiagnostics/scanBlockersFormatter.ts`(`/scan_blockers`).
나머지 화면(`normal_supply_preview`, `entry_filter_decomposition`, gate diagnostics,
telegram summary)은 **후속 패치**로 분리한다. `buildDiagnosticRegimeContext()` 는 이번
패치에서 변경하지 않는다(entry-filter 섹션 의존, 후속 분리).

## Consequences

- **권위 명확화** — 운영자는 `executionPolicy.finalExecutionPolicy` 한 곳에서 실주문 가능
  여부를 본다. 레짐 이름이 표시되더라도 그것이 "표시"인지 "스코어링"인지 "주문 권한"인지
  화면 라벨로 구분된다.
- **계산 불변** — resolver/regimeResolver/positionPolicy 의 산출 로직은 0줄 변경.
  read-model 은 순수 투영. `executionImpact = NONE`, byte-equivalent.
- **불변식 강제** — `legacyUsedForDecision: false` 리터럴, `marketSignal: false` 리터럴 등을
  타입 레벨에서 컴파일 타임 강제(불변식 #4, #6 보호). engine-dev 는 런타임 assert, quality-guard 는
  회귀 테스트로 위계 7+1 불변식을 커버한다.
- **화면 정합성** — 동일 `snapshotId` 면 두 화면이 동일 권위값을 렌더해야 하며, 다르면
  `DIFFERENT_SNAPSHOT` 마커로 거짓 동치(false equivalence)를 차단한다(불변식 #5).
- **후속 scope** — 빌더 본문 구현(`buildSourceSnapshotDecisionContext`)과 2개 화면 wiring 은
  engine-dev. 나머지 화면 마이그레이션은 별도 후속 ADR/패치. resolver 의 4값 승격은 본 ADR
  범위 밖(영구적으로 DISPLAY 파생으로만 유지하거나 후속 ADR 에서 별도 결정).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
