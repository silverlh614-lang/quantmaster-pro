# ADR 0027 — Shadow Model — 신규 학습 로직 그림자 검증 (PR-J)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0018 ~ ADR-0026

## 배경

사용자 분석 천재 아이디어 #12 + 보완점 6:
"새로운 학습 로직은 바로 실전에 적용하지 말고 그림자 모델로 먼저 돌린다.
30~100건 정도 그림자 검증 후 실제 모델에 승격."

PR-A~I 시리즈는 학습 알고리즘을 점진적으로 강화했지만, 향후 큰 알고리즘 변경
(예: Edge Score 기반 가중치 보정, regime-mixed weights, 새 multiplier 정책)
을 도입할 때 LIVE 학습 결과를 망치지 않고 검증할 수단이 부재.

## 결정

`evaluateFeedbackLoopShadow(closedTrades, currentWeights, options)` 함수
신설 — 기존 evaluateFeedbackLoop 와 동일 시그니처지만 **localStorage 에 저장
안 함**. 옵션으로 알고리즘 파라미터 override (multiplier 강도, threshold 등)
가능. 결과는 라이브 모델 결과와 비교하기 위한 `ShadowComparisonResult` 로 반환.

### 1. Shadow Mode 구분

```ts
export interface FeedbackLoopOptions {
  /** true → localStorage 저장 안 함 (shadow mode) */
  shadow?: boolean;
  /** WEIGHT_STEP override (기본 0.10) */
  weightStep?: number;
  /** 가중치 상향 임계 (기본 0.60) */
  upThreshold?: number;
  /** 가중치 하향 임계 (기본 0.40) */
  downThreshold?: number;
}
```

기존 `evaluateFeedbackLoop(trades, weights)` 시그니처 유지 + 옵셔널 3번째
파라미터 `options?: FeedbackLoopOptions` 추가. shadow=true 면 saveEvolutionWeights
호출 차단.

### 2. 비교 결과

```ts
export interface ShadowComparisonResult {
  live: FeedbackLoopResult;
  shadow: FeedbackLoopResult;
  divergence: ConditionDivergence[];   // 라이브 vs 섀도 newWeight 차이
  shadowConfidence: number;            // 0~1 (얼마나 다른지 비율)
}

export interface ConditionDivergence {
  conditionId: ConditionId;
  liveWeight: number;
  shadowWeight: number;
  delta: number;                       // shadow - live
  agreement: 'AGREE' | 'DISAGREE';     // direction 같으면 AGREE
}
```

### 3. compareShadowVsLive 헬퍼

```ts
compareShadowVsLive(closedTrades, weights, shadowOptions): ShadowComparisonResult;
```

라이브 (기본 옵션) + 섀도 (override 옵션) 두 번 실행 후 비교.

### 4. 영속 미적용

본 PR 은 비교 결과를 반환만 — UI 에서 사용자가 직접 검토. localStorage 저장
없음 (분석 데이터 누적 부재). 향후 PR 에서 `ShadowEvalHistory` 영속 가능.

## 비결정 (out of scope)

- 섀도 결과 자동 promotion 정책 → 별도 PR
- 섀도 vs 라이브 UI 비교 패널 → 별도 PR
- 섀도 결과 영속 → 별도 PR
