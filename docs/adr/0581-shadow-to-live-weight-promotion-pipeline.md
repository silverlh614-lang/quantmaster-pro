# ADR-0581: Shadow→Live condition-weight promotion pipeline (phased, flag-gated)

@responsibility learning — flag-gated, governance-approved promotion of shadow/candidate-validated condition weights to live (Phase 0~2 foundation now; Phase 3~4 pre-live follow-up)

## Status

Accepted (Phase 0~2 구현 완료 · Phase 3~4 follow-up, live 전환 전 마무리 예정)

## Context

학습→live 영향 딥다이브([[learning-to-live-architecture]] 메모리, 2026-06-07) 결과:
- LIVE 조건가중치 캘리브(PATH1)는 **CORE_ELIGIBLE = source=LIVE+EXECUTED+CONFIRMED+VERIFIED+NORMAL** 증거로만
  자동 튜닝(조건당 ≥100). 개발 중 SHADOW 모드에선 coreEligible=0 → live 가중치 기본값 고정.
- shadow 검증 학습이 live 로 못 감: `coldstartBootstrap` 은 출력 소비처가 없어 dead-wired,
  candidate 레인(`signalCalibrator.persistCandidateWeights` → `condition-weights-*.candidate.json`)은
  **write-only(읽는 데 0)**.
- 목표: shadow/candidate 에서 검증된 가중치를 **명시적·governance 승인·flag-gated·clamp·rollback 가능**한
  경로로 live 승격하되, **paper→live 신뢰경계(불변식 #7/#8) 보존 + 자동 적용 금지**.

부품 대부분이 이미 존재(promotionGovernance ADR-0525 승인 상태머신 · strategyVersioning ADR-0526
SHADOW→CANARY→LIVE rollout · attributionCalibrationGuardrail CANDIDATE/APPROVED 결정 · conditionWeightsRepo
live SSOT · weightHistoryRepo 스냅샷). keystone 템플릿 = `gateLearnedThresholdApply.ts`(flag + 승인 store +
clamp + 명시 provider 등록).

## Decision

새 SSOT 신설 없이 기존 라이프사이클을 **배선**한다. 단계:

```
dynamicWeightFeedback(제안) → promotionGovernance(승인+시뮬+rollback) →
strategyVersioning(SHADOW→CANARY 5종목·5%→LIVE) → registerLearnedConditionWeightProvider(flag-gated 주입) →
conditionWeightsRepo(live SSOT)
```

**Phase 0~2 (본 PR — 전부 byte-equivalent · executionImpact=NONE · live 미도달):**
- **Phase 0**: `LEARNING_WEIGHT_PROMOTION_ENABLED` flag (default OFF, `weightPromotionFlag.ts`).
- **Phase 1**: candidate 레인 read 측 `loadCandidateConditionWeights(regime)` + `conditionWeightsCandidateFile`
  경로 SSOT(paths.ts) — 기존 write-only 갭 해소. (read-only, 소비처 아직 없음.)
- **Phase 2**: `registerLearnedConditionWeightProvider` seam — `loadConditionWeights[ByRegime]` 가 등록된
  provider 를 우선 소비. **미등록(기본) → 파일 직독 byte-identical**(gateConfig provider seam 동형).

**Phase 3~4 (follow-up — live 전환 전 마무리, 별도 명시 승인 필요):**
- Phase 3: candidate→core promoter(flag ON + governance APPROVED + guardrail clamp 통과분만 provider 로 주입) +
  dynamicWeightFeedback→governance 제안 배선 + promotionGovernance repo 영속 어댑터(현재 in-memory).
- Phase 4: strategyVersioning SHADOW→CANARY→LIVE rollout 래퍼 + `weightHistoryRepo` 특정 스냅샷 live 복원/롤백 API.

## Consequences

- 본 PR: flag OFF + provider 미등록 → **byte-identical**. live 가중치/스코어링 0 변화. 신규는 전부 additive 또는
  dormant seam. 회귀: seam 테스트 8/8 · lint(tsc x2) 0 · complexity OK · responsibility 0 신규.
- Phase 3~4 ON 시: governance-APPROVED·시뮬통과·clamp(CORE_FLOOR 0.30·CRITICAL_KEYS·maxDelta)·canary(5종목/5%)
  통과분만 live 도달 + rollback. shadow-only 증거 단독으론 여전히 core 자동기록 불가(guardrail `NON_LIVE_SOURCE`
  보존) — 승격은 operator 명시 승인 필수. executionImpact: Phase 3~4 ON = execution-relevant → shadow A/B + canary 의무.
- **70 anchor 무관**(가중치 승격이지 게이트 임계 아님).

## Guardrails

- No live trading path change unless explicitly stated (Phase 0~2 = none).
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated. (Phase 3~4 는 별도 ADR-호환 승인 + flag 후.)
