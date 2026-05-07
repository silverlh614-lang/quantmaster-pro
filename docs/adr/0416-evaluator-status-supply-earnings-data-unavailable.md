# ADR-0416: Evaluator Status Semantics — supplyConfluence + earningsQuality DATA_UNAVAILABLE wiring (Phase 1)

- **상태**: Accepted (2026-05-07)
- **시리즈**: Evaluator Status Semantics (Phase 1) — 사용자 명시 *"ADR-0389 Phase 1"* 의 실제 ADR 번호. ADR-0389 (PR #657) 가 이미 다른 주제(evaluator status migration baseline) 로 발급됐으므로 INDEX 다음 발급 번호 SSOT 정합으로 0416 재할당.
- **연관 ADR**: 0387 (status union baseline) / 0388 (ERROR 별도 카운터) / 0389 (volume_surge·momentum·vcp 격상) / 0390 (5 evaluator 격상) / **0416 본 PR (supply + earnings + stockScreener 임시 wiring)** / 0417 후속 (postmortem action taxonomy split) / 0418 후속 (evaluator metadata automation, 임시 inclusion list 제거).
- **영향 영역**: `server/quant/conditions/evaluators.ts` / `server/screener/stockScreener.ts` / 회귀 테스트.

## 배경

ADR-0387 + ADR-0388 + ADR-0389 + ADR-0390 시리즈로 27 조건 evaluator 중 다수가 `ConditionEvalStatus` 7-state union (`FIRED` / `THRESHOLD_NOT_MET` / `DATA_UNAVAILABLE` / `PROVIDER_DEGRADED` / `SKIPPED_BY_POLICY` / `SANITY_REJECTED` / `ERROR`) 으로 status 분류 격상되었지만 — **외부 데이터 의존 evaluator 2종은 잔존**:

1. `supplyConfluenceEvaluator` (`server/quant/conditions/evaluators.ts:638-668`) — `if (!kisFlow) return null;` 만, status 미명시.
2. `earningsQualityEvaluator` (`server/quant/conditions/evaluators.ts:672-687`) — `if (dartFin?.ocfRatio == null) return null;` 만, status 미명시.

### 결함

`stockScreener.ts:528` 의 `recordGateAuditByStatus(gate.outputs.map(o => ({ key, output })))` 호출에 context 미전달 → `inferStatusFromLegacyResult` (`server/persistence/gateAuditRepo.ts:106-122`) 의 우선순위 SSOT:

> `result === null` + `context?.hadRequiredData === false` → `DATA_UNAVAILABLE`
> `result === null` + 그 외 → `THRESHOLD_NOT_MET` (legacy 기본 가정)

stockScreener 가 KIS quota 절약 + DART OpenAPI rate-limit 부담 완화 차원에서 `evaluateServerGate(quote, weights, kospi20dReturn, **null, null**, regime)` (kisFlow=null + dartFin=null) 로 호출 → 두 evaluator 모두 `null` 반환 → audit 가 **THRESHOLD_NOT_MET 으로 추정 → `failed++`** 로 잘못 분류.

### 사용자 보고 시나리오

> *"supply_confluence 가 top blocker 로 100% failed 표시 — 운영자가 'gate 가 너무 엄격하다' 로 잘못된 진단을 내려 STRONG_BUY 임계 완화 의사결정을 내릴 위험."*

핵심 결함: KIS Investor Flow 일시 장애 / DART OpenAPI 미공시 종목 / stockScreener 의 의도적 lazy fetch 모두 **데이터 부재 (DATA_UNAVAILABLE)** 인데, audit 가 **임계 미달 (THRESHOLD_NOT_MET)** 로 분류 → postmortem 권고가 데이터 소스 점검 대신 *"Gate 임계 완화"* 로 잘못 흘러가는 confirmation bias 연쇄.

## 결정

**핵심 불변식 SSOT (사용자 명시, 절대 변경 금지)**:

> `status === 'DATA_UNAVAILABLE'` 인 결과는 `score` 가 `0` 이어도 **절대 `failed++` 로 세면 안 된다**. 반드시 `unavailable++` 로 세야 한다.
>
> `DATA_UNAVAILABLE` 은 *"조건 미달"* 이 아니라 *"공정한 평가 불가"* 다.

### 1. supplyConfluenceEvaluator 수정

```typescript
if (!kisFlow) {
  return {
    score: 0,
    conditionKey: 'supply_confluence',
    detail: 'KIS Investor Flow unavailable: supply_confluence skipped',
    status: 'DATA_UNAVAILABLE',
  };
}
```

`kisFlow` 가 정상이지만 양쪽 모두 매도/zero 인 경우는 *데이터 가용 + 임계 미달* 이므로 `null` 반환 보존 (THRESHOLD_NOT_MET 의도).

### 2. earningsQualityEvaluator 수정

```typescript
if (dartFin?.ocfRatio == null) {
  return {
    score: 0,
    conditionKey: 'earnings_quality',
    detail: 'DART financial data unavailable: earnings_quality skipped',
    status: 'DATA_UNAVAILABLE',
  };
}
```

`ocfRatio` 가 `< 1.0` 인 경우는 *데이터 가용 + 임계 미달* 이므로 `null` 반환 보존.

### 3. stockScreener.ts 임시 inclusion list (Phase 3 에서 영구 제거)

```typescript
const DATA_DEPENDENT_EVALUATORS_WITH_INTENTIONAL_SCREENING_NULL = new Set<string>([
  'supply_confluence',  // ctx.kisFlow.* 의존
  'earnings_quality',   // ctx.dartFin.ocfRatio 의존
]);

recordGateAuditByStatus(gate.outputs.map(o => ({
  key: o.key,
  output: o.output as ...,
  context: {
    evaluatorKey: o.key,
    hadRequiredData: !DATA_DEPENDENT_EVALUATORS_WITH_INTENTIONAL_SCREENING_NULL.has(o.key),
  },
})));
```

**왜 임시인가**: evaluator 자체가 `status='DATA_UNAVAILABLE'` 을 반환하면 audit 가 정확히 분류하지만, *legacy null 반환* 흐름이 잔존할 수 있어 stockScreener 측에서도 안전망으로 `hadRequiredData=false` 강제. ADR-0418 Phase 3 에서 `registry.run()` 이 `evaluator.inputs` 메타로부터 자동 생성하면 본 inclusion list 영구 제거.

## 안전 invariant (절대 규칙)

1. **score 0 + DATA_UNAVAILABLE → unavailable++**, 절대 failed++ 금지.
2. **데이터 가용 + 임계 미달 → null (legacy)**, THRESHOLD_NOT_MET 으로 분류 보존.
3. **conditionKey 필드명 보존** — 임의로 `key`/`condition`/`name` 으로 변경 금지.
4. **stockScreener inclusion list 는 Phase 1 임시** — Phase 3 (ADR-0418) 에서 영구 제거 의무.
5. **gate threshold / weight / STRONG_BUY 조건 / SELL_ONLY / autoTradeEngine 변경 0줄**.

## 잘못된 해결 방법 영구 차단

1. ❌ evaluator 가 `null` 반환 + stockScreener 측 fix-up — drift 위험, evaluator 가 자신의 status 를 직접 선언해야 함.
2. ❌ Gate threshold 완화 — 데이터 부재가 임계 문제인 척 가장.
3. ❌ supply_confluence 가중치 변경 — 사용자 명시 절대 변경 금지.
4. ❌ stockScreener 가 evaluator 별 정밀 데이터 페칭 강제 — KIS/DART quota 폭주.
5. ❌ inclusion list 를 다른 호출자에 export — Phase 3 자동 격상 의도 훼손.

## 검증

- vitest `server/quant/conditions/evaluatorsAdr0416.test.ts` **16/16 pass** (5+ 핵심 + 회귀 보호).
- 인접 회귀: 본 PR 적용 시 `server/quant/conditions/` 33 fail → 23 fail (10건 자동 해소 — supply/earnings 가 status 명시로 격상되어 ADR-0387/0388 audit 분류 정확화).
- lint(server tsc) — 변경 파일 0 errors.
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 — kisClient/orchestrator/autoTradeEngine 본체 무수정).
- LIVE 매매 본체 0줄 변경 — evaluator status 명시 + stockScreener context 주입만.

## 후속 PR

1. **ADR-0417 (Phase 2)**: postmortem action taxonomy split — `LOOSEN_GATE` 제거 → `REVIEW_GATE_THRESHOLD` rename + `CHECK_DATA_SOURCE` / `PATCH_EVALUATOR` 분리. `unavailableRate` / `errorRate` / `trueFailRate` 분모 분리.
2. **ADR-0418 (Phase 3)**: `evaluator.inputs` 메타로부터 `registry.run()` 이 `requiredData` / `availableData` / `hadRequiredData` 자동 생성. stockScreener 임시 inclusion list **영구 제거**.
3. (선택) PR-Audit-Conditions-Cache: 인접 23 fail 의 `_auditCache` 모듈 캐시 격리 — 본 PR 의 `vi.resetModules()` 패턴을 기존 테스트들에 retrofit.
