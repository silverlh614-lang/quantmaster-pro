# ADR-0418: Evaluator Data Availability Metadata Automation (Phase 3)

- **상태**: Accepted (2026-05-07)
- **시리즈**: Evaluator Status Semantics (Phase 3) — 사용자 명시 *"ADR-0391 Phase 3"* 의 실제 ADR 번호. ADR-0391 (PR #659) 가 이미 다른 주제(P0-A Mode Observability)로 발급되어 INDEX 다음 발급 SSOT 정합으로 0418 재할당.
- **연관 ADR**: 0416 (Phase 1 — supply + earnings DATA_UNAVAILABLE 격상 + stockScreener 임시 inclusion list) / 0417 (Phase 2 — postmortem action taxonomy split + 분모 분리) / **0418 본 PR — Phase 3 (registry metadata automation, inclusion list 영구 제거)**.
- **영향 영역**: `server/quant/conditions/registry.ts` / `server/quantFilter.ts` / `server/screener/stockScreener.ts` / 회귀 테스트.

## 배경

ADR-0416 Phase 1 에서 stockScreener 에 임시 `DATA_DEPENDENT_EVALUATORS_WITH_INTENTIONAL_SCREENING_NULL` inclusion list 를 도입했다. 이 list 는 audit 가 외부 데이터 부재 evaluator 의 legacy null 반환을 `DATA_UNAVAILABLE` 로 분류하도록 강제했지만 — **호출자(stockScreener)가 evaluator-specific knowledge 를 갖는 결함**:

```typescript
// ADR-0416 임시 wiring (drift 위험):
const DATA_DEPENDENT_EVALUATORS_WITH_INTENTIONAL_SCREENING_NULL = new Set([
  'supply_confluence',  // ← 새 외부 데이터 evaluator 추가 시마다 stockScreener 수정 필요
  'earnings_quality',
]);

recordGateAuditByStatus(gate.outputs.map(o => ({
  key: o.key,
  output: o.output,
  context: {
    hadRequiredData: !DATA_DEPENDENT_EVALUATORS_WITH_INTENTIONAL_SCREENING_NULL.has(o.key),
  },
})));
```

문제:
1. **drift 위험**: 새 외부 데이터 의존 evaluator (예: `weeklyRsiZone` + `weeklyBars`) 추가 시 stockScreener 의 inclusion list 갱신 누락 → audit 오염 재발.
2. **단일 책임 위반**: stockScreener 가 *어떤 evaluator 가 어떤 데이터를 요구하는지* 알아야 함 — evaluator 의 도메인 지식이 호출자에 누수.
3. **확장성 부재**: evaluator 마다 내부 ENV 또는 manual 캐시도 호출자가 모름.

### 사용자 명시 핵심 통찰

> *"evaluator 가 필요로 하는 외부 데이터는 evaluator 정의에 명시되어야 한다. registry.run() 은 evaluator.inputs 메타데이터를 기반으로 requiredData / availableData / hadRequiredData 를 자동 생성해야 한다. 호출자는 더 이상 supply_confluence / earnings_quality 를 알 필요가 없어야 한다."*

## 결정

### 1. `EvaluatorRunContext` 신규 SSOT

```typescript
export interface EvaluatorRunContext {
  /** evaluator 가 필요로 하는 외부 데이터 키 목록 (quote 제외). */
  requiredData: string[];
  /** 각 requiredData 키에 대해 ctx 내 가용 여부. */
  availableData: Record<string, boolean>;
  /** 모든 requiredData 가 가용한가. requiredData 가 비었으면 항상 true. */
  hadRequiredData: boolean;
}
```

### 2. SSOT 헬퍼 3종 (drift 차단)

#### `extractExternalDataKey(input)` — `EvaluatorInput` 파싱

| Input pattern | Result |
|---------------|--------|
| `'quote.X'` | `null` (quote 항상 가용, 외부 데이터 아님) |
| `'ctx.<single>'` | `'<single>'` (예: `'ctx.kospi20dReturn'` → `'kospi20dReturn'`) |
| `'ctx.<key>.<sub>'` | `'<key>'` (예: `'ctx.kisFlow.institutionalNetBuy'` → `'kisFlow'`) |

#### `isExternalDataAvailable(ctx, key)` — 가용성 검사

| Value type | Available 조건 |
|------------|----------------|
| `null` / `undefined` | `false` |
| `number` | `Number.isFinite(value)` (NaN/Infinity → false) |
| `Array` | `length > 0` (사용자 명시 edge case `weeklyBars=[]` 차단) |
| 그 외 객체/문자열 | `Boolean(value)` |

#### `deriveEvaluatorContext(evaluator, ctx)` — 통합 메타 합성

evaluator.inputs 순회하며 위 두 헬퍼로 `EvaluatorRunContext` 자동 생성.

### 3. `registry.run` 자동 첨부 wiring

```typescript
for (const ev of this.evaluators.values()) {
  const evalContext = deriveEvaluatorContext(ev, ctx);
  // ... evaluator 실행 ...
  outputs.push({ key: ev.key, output: out, context: evalContext });
}
```

`ConditionRunResult.outputs[].context` 옵셔널 필드 추가.

### 4. `ServerGateResult.outputs[].context` 격상 (호출자 자동 흡수)

```typescript
outputs?: Array<{
  key: string;
  output: { score: number; status?: string } | null;
  context?: {
    requiredData: string[];
    availableData: Record<string, boolean>;
    hadRequiredData: boolean;
  };
}>;
```

### 5. `stockScreener.ts` 임시 inclusion list 영구 제거

```typescript
// ADR-0418 후:
recordGateAuditByStatus(gate.outputs.map(o => ({
  key: o.key,
  output: o.output as AuditInputItem['output'],
  context: o.context
    ? { evaluatorKey: o.key, hadRequiredData: o.context.hadRequiredData }
    : { evaluatorKey: o.key },
})));
```

호출자는 `o.context` 를 그대로 전달. evaluator-specific knowledge 0건.

## 안전 invariant (절대 규칙)

1. **registry.run 이 모든 output 에 context 첨부** (정상 / PROVIDER_DEGRADED / ERROR 분기 모두).
2. **`requiredData` 에서 `quote` 항상 제외** — quote 는 evaluator 실행 자체의 전제 조건.
3. **`isExternalDataAvailable` 의 4 분기**:
   - `null`/`undefined` → false
   - `number` finite → true (NaN/Infinity → false)
   - 빈 배열 → false (사용자 명시 edge case)
   - 그 외 → `Boolean(value)`
4. **stockScreener inclusion list 영구 제거** — 정적 grep 가드로 재도입 차단.
5. **호출자 `recordGateAuditByStatus` 호출 시 `o.context` 그대로 전달** — 변환 / inclusion list / inline ENV 검사 0건.
6. **gate threshold / weight / STRONG_BUY 조건 / SELL_ONLY / autoTradeEngine 변경 0줄**.
7. **DATA_UNAVAILABLE → unavailable++ 핵심 불변식** (ADR-0416 보존).

## 잘못된 해결 방법 영구 차단

1. ❌ `EvaluatorInputKey` 별도 enum 신규 — `EvaluatorInput` 문자열 파싱이 충분.
2. ❌ evaluator 별 `isInputAvailable` 필수화 — 본 PR 의 default 검사 (4 분기) 가 충분.
3. ❌ stockScreener 의 inclusion list 다시 도입 — 정적 grep 가드 차단.
4. ❌ `quote` 를 `requiredData` 에 포함 — quote 부재 시 evaluator 실행 자체가 불가능.
5. ❌ 호출자 측 `o.context.hadRequiredData ?? true` 의도된 fallback — context 부재 시 명시적 분기.
6. ❌ ADR-0416 + ADR-0417 + ADR-0418 통합 단일 PR — 회귀 위험 격리 위해 3 PR 분할.

## 검증

- vitest `server/quant/conditions/registryAdr0418.test.ts` **23/23 pass** — extractExternalDataKey 4 + isExternalDataAvailable 5 + deriveEvaluatorContext 7 + registry.run 통합 4 + audit 자동 분류 2 + stockScreener inclusion list 제거 정적 가드 1.
- `evaluatorsAdr0416.test.ts` 17/17 pass (1 정합 정정 — 기존 inclusion list 존재 단언 → ADR-0418 영구 제거 단언).
- 인접 회귀: server/quant/conditions/ baseline 23 fail 그대로 (모두 사전 baseline `_auditCache` 격리 결함, ADR-0418 무관).
- lint(server tsc) — 변경 파일 0 errors.
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 — kisClient/orchestrator/autoTradeEngine 본체 무수정).
- LIVE 매매 본체 0줄 변경 — registry SSOT + ServerGateResult schema 옵셔널 격상 + stockScreener 호출자 단순화.

## 후속 PR (scope 외)

1. **PR-Conditions-Cache-Isolation**: 인접 23 fail 의 `_auditCache` 모듈 캐시 격리 — `vi.resetModules()` 패턴 retrofit.
2. **PR-Evaluator-IsInputAvailable**: 정밀 가용성 검사가 필요한 evaluator 만 옵셔널 `isInputAvailable: Partial<Record<string, (ctx) => boolean>>` 추가 (예: `weeklyBars` 길이 임계).
3. **PR-DataKind-Refinement**: KIS/DART/Yahoo fetch result kind 세분화 (PARTIAL / FRESH / STALE / DEGRADED) — ADR-0411 PROVIDER_DEGRADED 와 결합.
