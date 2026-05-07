# ADR-0417: Postmortem Action Taxonomy Split — LOOSEN_GATE 제거 + 분모 분리 (Phase 2)

- **상태**: Accepted (2026-05-07)
- **시리즈**: Evaluator Status Semantics (Phase 2) — 사용자 명시 *"ADR-0390 Phase 2"* 의 실제 ADR 번호. ADR-0390 (PR #658) 가 이미 다른 주제로 발급됐으므로 INDEX 다음 발급 SSOT 정합으로 0417 재할당.
- **연관 ADR**: 0387 + 0388 (status union baseline) / 0416 (Phase 1 — DATA_UNAVAILABLE 격상) / **0417 본 PR** / 0418 후속 (evaluator metadata automation).
- **영향 영역**: `server/orchestrator/emptyScanPostmortem.ts` / `server/orchestrator/adaptiveScanScheduler.ts` / 회귀 테스트.

## 배경

ADR-0416 Phase 1 후 evaluator status (`DATA_UNAVAILABLE` / `THRESHOLD_NOT_MET` / `ERROR`) 가 정확히 분류되지만 — **postmortem 권고 액션이 여전히 위험**:

기존 `emptyScanPostmortem.ts:250` `action = 'LOOSEN_GATE'` 로직 결함:

```typescript
if (isRiskOn(regime) && metrics.gateReached > 0 && metrics.gateFailRatio > 0.95) {
  action = 'LOOSEN_GATE';  // ⚠️ Gate 완화 권고
}
```

여기서 `metrics.gateFailRatio` 는 `gateFail / gateReached` 인데, **gateFail 에 데이터 부재로 인한 차단도 포함**. 따라서:

- Yahoo 일시 장애 (모든 종목 yahooFail=1) → 잘못 RISK_ON 으로 들어가는 일은 없으나, 부분 KIS/DART 결손은 gateFail 로 카운트되어 잘못된 권고.
- `findTopBlocker.failRate = s.failed / total` 의 `total = passed + failed + unavailable + error` 라 데이터 결손 종목이 분모에 포함되어 *진짜 임계 미달* 비율 왜곡.
- 운영자가 `LOOSEN_GATE` 권고를 받고 임계 완화 의사결정 → 데이터 결손이 해소된 후 정상 운영에서 잘못된 임계로 STRONG_BUY 폭주 위험.

### 사용자 명시 핵심 불변식

> *`REVIEW_GATE_THRESHOLD` 는 데이터 가용성과 evaluator 안정성이 확보된 후 에만 허용. `unavailableRate > 0.5` 또는 `errorRate > 0.3` 인 경우 절대 권고 금지.*

## 결정

### 1. `RecommendedAction` → `PostmortemAction` 격상 + `LOOSEN_GATE` 폐기

```typescript
export type PostmortemAction =
  | 'HOLD_AND_WAIT'
  | 'CHECK_DATA_SOURCE'      // ← 신규: DATA_UNAVAILABLE 우세
  | 'PATCH_EVALUATOR'        // ← 신규: ERROR 우세
  | 'REVIEW_GATE_THRESHOLD'  // ← LOOSEN_GATE 의 안전 rename (즉시 완화 ≠ 검토)
  | 'INSPECT_MARKET_REGIME'
  | 'INSPECT_CANDIDATES'
  | 'NO_ACTION'
  // Legacy aliases (후방호환만, 신규 출력에서 사용 금지):
  | 'LOOSEN_GATE'
  | 'NONE';

/** @deprecated rename → PostmortemAction */
export type RecommendedAction = PostmortemAction;
```

`LOOSEN_GATE` 는 union 에 alias 로 잔존 (호출자 후방호환), 결정 트리에서 절대 발화하지 않음 (정적 grep 가드).

### 2. `recommendedAction` → `recommendedActions: PostmortemAction[]` 배열 격상

복합 장애 표현 가능:

```typescript
{
  recommendedActions: ['CHECK_DATA_SOURCE', 'PATCH_EVALUATOR'],
  recommendedAction: 'CHECK_DATA_SOURCE', // legacy alias = recommendedActions[0]
}
```

### 3. 분모 분리 SSOT — `unavailableRate` / `errorRate` / `trueFailRate`

**`findTopBlocker` 확장**:

```typescript
// legacy failRate (분모: total) — 후방호환 보존.
const failRate = s.failed / total;

// ADR-0417 trueFailRate (분모: passed + failed, unavailable + error 제외).
const evaluatedTotal = s.passed + s.failed;
const trueFailRate = evaluatedTotal > 0 ? s.failed / evaluatedTotal : 0;
```

**`metrics.{unavailableRate, errorRate, trueFailRate}` 신규 필드** — 전체 audit 합산 (조건별 worst 가 아닌 sum).

### 4. `deriveActionsByRates` SSOT 결정 트리 (절대 변경 금지)

```typescript
const UNAVAILABLE_DOMINANT_THRESHOLD = 0.5;
const ERROR_DOMINANT_THRESHOLD = 0.3;
const TRUE_FAIL_DOMINANT_THRESHOLD = 0.95;

if (unavailableRate > 0.5) actions.push('CHECK_DATA_SOURCE');
if (errorRate > 0.3) actions.push('PATCH_EVALUATOR');
if (trueFailRate > 0.95 && unavailableRate <= 0.5 && errorRate <= 0.3) {
  actions.push('REVIEW_GATE_THRESHOLD');
}
```

### 5. `buildActionGuidance` 메시지 SSOT — 위험 문구 영구 차단

| 권고 | 메시지 |
|------|--------|
| CHECK_DATA_SOURCE | 외부 데이터 부재율이 높아 Gate 임계값을 평가할 수 없습니다. KIS/DART/Yahoo/KRX 데이터 소스를 먼저 점검하십시오. |
| PATCH_EVALUATOR | evaluator 오류율이 높아 postmortem 판단 신뢰도가 낮습니다. evaluator status wiring 또는 schema drift 를 점검하십시오. |
| REVIEW_GATE_THRESHOLD | 데이터 가용성과 evaluator 안정성이 확보된 상태에서 진짜 threshold failure 가 우세합니다. Gate threshold 또는 regime-specific weights 를 검토하십시오 (즉시 완화 금지 — 운영자 명시 검토 후). |

### 6. `topTrueFailCondition` 신규 필드 — 깨끗한 분모

기존 `topBlockerCondition` 은 분모에 unavailable + error 포함이라 데이터 결손 종목이 top 으로 표시되는 결함. `topTrueFailCondition` (분모: passed + failed) 는 운영자가 *진짜 임계 미달* 종목 만 식별 가능.

## 안전 invariant (절대 규칙)

1. **score 0 + DATA_UNAVAILABLE → unavailable++** (ADR-0416 보존).
2. **trueFailRate 분모에 unavailable + error 절대 포함 금지**.
3. **REVIEW_GATE_THRESHOLD 는 trueFailRate > 0.95 AND unavailableRate ≤ 0.5 AND errorRate ≤ 0.3 충족 시에만 발화**.
4. **신규 postmortem 출력에 `LOOSEN_GATE` 문자열 0건** (정적 grep 가드).
5. **gate threshold / weight / STRONG_BUY 조건 / SELL_ONLY / autoTradeEngine 변경 0줄**.
6. **legacy `recommendedAction` 보존** — `recommendedActions[0]` alias 로 후방호환.

## 잘못된 해결 방법 영구 차단

1. ❌ `LOOSEN_GATE` 메시지만 rename — 분모 분리 없으면 데이터 부재 시 잘못된 임계 완화 권고 재발.
2. ❌ `gateFailRatio` 임계 0.95 → 0.99 상향 — 분모 정합 결함 보존.
3. ❌ `recommendedAction` 단일값 유지 — 복합 장애 표현 불가.
4. ❌ `unavailableRate`/`errorRate`/`trueFailRate` 호출자 측 inline 계산 — drift 위험.
5. ❌ supply_confluence weight / Gate threshold / STRONG_BUY 조건 변경.
6. ❌ ADR-0418 evaluator metadata automation 본 PR 통합 (회귀 위험 격리).

## 검증

- vitest `server/orchestrator/emptyScanPostmortemAdr0417.test.ts` **19/19 pass** (5+ 핵심 결정 트리 + 통합 + 정적 grep 가드).
- 인접 회귀: 본 PR 적용 시 `server/orchestrator/emptyScanPostmortem` 22 fail → **4 fail (18 자동 해소)** — 분모 분리로 ADR-0387 기대값 정합 회복.
- lint(server tsc) — 변경 파일 0 errors.
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 — kisClient/orchestrator/autoTradeEngine 본체 무수정).
- LIVE 매매 본체 0줄 변경 — postmortem 진단 layer 만, 매매 의사결정 무관.

## 후속 PR

1. **ADR-0418 (Phase 3)**: `evaluator.inputs` 메타로부터 `registry.run()` 이 `requiredData` / `availableData` / `hadRequiredData` 자동 생성 → stockScreener 임시 inclusion list 영구 제거.
2. (선택) PR-Postmortem-Cache-Isolation: 인접 4 fail 의 `_auditCache` 모듈 캐시 격리 — `vi.resetModules()` 패턴 retrofit.
