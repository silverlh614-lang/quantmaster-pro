# ADR-0528: Railway Decision Log Correlation Standard

@responsibility observability / decision-log / correlation — railway decision log correlation standard

## Status

Proposed (Phase 3 of Canonical Data SSOT, follows ADR-0525/0526/0527)

## Context

운영 정본 위계(SPEC §"운영 정본 위계", 2026-05-25 사용자 확정)에서 **Railway raw logs 는 3순위**
(SourceSnapshot/CanonicalRuntimeResolution → /scan_blockers full → **Railway** → debug_gate →
compactText). Railway 로그는 시간순으로 흩어진 *부분 이벤트* 스트림이라 단일 로그로 전체 매매
판단을 해석하면 오해석이 발생한다.

물증: `[AutoTrade] LG전자 simple position policy liveGate: 7.2 (stale: ...) | MTAS: ... | tier:
...(diagnostic) | posPct: ...` (`sizingTierDecider.ts:95`) 는 그 시점 *한 단계 사이징 계산*일 뿐인데,
이 한 줄을 "최종 매수 판단"으로 읽으면 틀린다. 같은 종목의 gate 최종 verdict / execution permission /
shadow 체결은 다른 로그 라인에 흩어져 있고, 어느 사이클(어느 sourceSnapshotId)에 속하는지 식별자가
없으면 상관(correlation)이 불가능하다.

Phase 1(ADR-0526)이 `CandidateGateEvaluationView`(per-candidate `finalVerdict`=`topBlockReason` +
gate0/1/2/3 status), Phase 2(ADR-0527)가 `UnifiedExecutionPermissionResolution`
(`liveOrderAllowed`/`shadowPermissionAllowed`/`paperFillAllowed`/`executionImpact`)을 정본으로
확정했으므로, **이제 결정 로그가 이 정본 필드를 carry 할 수 있다.** Shadow 실제 체결 검증 5-event 체인
(`SHADOW_EXECUTION_START → SHADOW_ORDER_CREATED → SHADOW_PAPER_FILLED → SHADOW_POSITION_OPENED →
LEDGER_RECORDED`)은 이미 `shadowBuyExecutor.ts` / `orderPipelineSsot.ts`에 존재하나, 상관 필드
(특히 `sourceSnapshotId`)가 일부 누락되어 같은 사이클로 묶이지 않는다.

## Decision

핵심 결정 로그(매매 판단을 좌우하는 결정 지점)에 **상관 필드를 강제**하여 "디버그 재료"에서
"같은 sourceSnapshotId 로 묶이는 증거"로 승격한다.

1. **상관 필드 12종 (`DecisionLogCorrelation`)** — 모든 핵심 결정 로그가 보유:
   `sourceSnapshotId`, `candidateSetId`, `gateScoreInputSnapshotId`, `symbol`, `mode`, `decisionStage`,
   `liveOrderAllowed`, `shadowOrderAllowed`, `paperFillAllowed`, `executionImpact`, `finalVerdict`,
   `positionIntent`. 단계별 가용성을 인정한다(일부 optional) — 예: GATE_SCORE 단계에는 아직 permission
   필드가 없을 수 있으나 `sourceSnapshotId`+`decisionStage`+`symbol` 은 필수.
   필드 출처: `finalVerdict` ← `CandidateGateEvaluationView.topBlockReason`(ADR-0526),
   permission 3종 + `executionImpact` ← `UnifiedExecutionPermissionResolution`(ADR-0527),
   ids ← `SourceSnapshot`(ADR-0519) / Step27 candidate set / gateScoreInputSnapshot.

2. **구조화 로그 헬퍼** — `server/observability/decisionLogCorrelation.ts` 의
   `formatDecisionLog(stage, correlation, detail?)`. 기존 `logger.formatKeyValue`(`logger.ts:319`)와
   `orderPipelineSsot.kv` prefix/`key=value` 컨벤션과 **동형**으로 결합한다: `[DECISION] stage=... <12
   상관 필드 key=value> <detail>`. 사람이 읽는 prefix + 기계가 parse 하는 key=value suffix.
   `logOperationalEvent`(`logger.ts:331`)와 병존 — 기존 logger 를 대체하지 않고 결정 로그 라인에 상관
   필드를 *부착*한다.

3. **Shadow lifecycle 5-event 체인** — 각 이벤트도 `DecisionLogCorrelation` 을 보유.
   `decisionStage` 가 `SHADOW_EXECUTION_START / SHADOW_ORDER_CREATED / SHADOW_PAPER_FILLED /
   SHADOW_POSITION_OPENED / LEDGER_RECORDED` 중 하나. 동일 `sourceSnapshotId`+`symbol`로 5건이 묶여야
   "실제 Shadow 체결"이 증명된다(체인 단절 = 미체결).

4. **정적 가드** — `scripts/check_decision_log_correlation.js`: 핵심 결정 로그(분류표 (a))가 구조화
   헬퍼를 쓰지 않거나 상관 필드 누락 시 fail. 부수 로그(retry/scheduler/provider health, 분류표 (b))는
   허용 목록(allowlist)으로 오탐 방지. `validate:all` 에 통합(별도 PR 가능).

## Consequences

- **디버그 → 증거 승격**: Railway 3순위 로그가 같은 `sourceSnapshotId` 로 묶여 full(2순위)·정본
  (1순위)과 교차 검증 가능. SPEC 운영 규칙 "Railway에 snapshotId 없으면 신뢰도 낮음" 해소.
- **9대 불변식 무영향 — 로그 출력만**: Trading Engine / Shadow Learning / SourceSnapshot / Gate /
  Provider 판단 로직 0줄 변경. permission/verdict 값은 정본에서 *읽어* carry 할 뿐 재계산하지 않는다.
- **Phase 의존**: 풀 12필드는 ADR-0526/0527 정본 wiring 후 가능. `sourceSnapshotId`+`decisionStage`
  조기 스탬프는 선행 가능(부분 적용 허용).
- **영향 파일** (engine-dev 구현 단계, 본 ADR 은 타입·계약만):
  - 신규: `server/observability/decisionLogCorrelation.ts`(헬퍼), `scripts/check_decision_log_correlation.js`(가드).
  - 수정(핵심 결정 로그 상관 부착): `sizingTierDecider.ts`(position policy), execution permission 결정
    로그, `shadowBuyExecutor.ts` + `orderPipelineSsot.ts`(5-event), gate 최종 verdict 로그.
- **롤백**: 헬퍼는 로그 출력 레이어 전용 — `ENV` 불요. 가드는 `validate:all` 에서 제외하면 즉시 비활성.
  결정 로직 미변경이므로 LIVE 매매 byte-equivalent.
- **테스트**: `decisionLogCorrelation.test.ts`(필드 직렬화·optional 처리·5-event 체인 동일
  sourceSnapshotId), `check_decision_log_correlation.test.js`(핵심 로그 누락 시 fail / 부수 로그 통과).

## Alternatives Considered

- **JSON-only 구조화 로그**: Railway 가독성 저하 + 기존 `[TAG] key=value` 컨벤션 단절. → prefix +
  key=value 하이브리드 채택(헬퍼 §Decision.2).
- **모든 로그에 상관 필드 강제**: retry/scheduler/health 로그까지 강제 시 노이즈·오탐. → 핵심 결정
  로그만(분류표 (a)), 부수 로그는 allowlist(§Decision.4).
- **신규 logger 전면 교체**: 회귀 위험. → `logOperationalEvent` 병존, 결정 라인에만 부착.

## References

- SPEC: `_workspace/2026-05-25_canonical-data-ssot/SPEC.md` §"운영 정본 위계" / §"ADR-0528"
- ADR-0519 (SourceSnapshot), ADR-0526 (CandidateGateEvaluationView), ADR-0527 (ExecutionPermissionResolution)
- 정본 도출원: `candidateGateEvaluationView.ts`, `gates/unifiedExecutionContract.ts`
- 5-event 현 위치: `trading/buy/shadowBuyExecutor.ts`, `trading/orderPipelineSsot.ts`
- 결정 로그 포인트 분류: `_workspace/2026-05-25_canonical-data-ssot/architect/decision-log-points.md`

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
</content>
</invoke>
