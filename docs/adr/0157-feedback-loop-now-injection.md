# ADR-0157: `evaluateFeedbackLoop` 옵셔널 `now?: Date` 인자 — driftGuard 근본 해결

**날짜**: 2026-05-01
**상태**: 채택
**관련 PR**: PR-Phase5 (ADR-0154 잔여 작업 마무리)
**관련 ADR**:
- ADR-0046 (PR-Y1, F2W Drift Detector) — 본 PR 의 결함 출처
- ADR-0154 §4 (driftGuard 시간 의존 결함 차단) — 본 PR 의 직접 후속

## 문제

ADR-0154 §4 가 `quantEngine.feedbackLoop.driftGuard.test.ts:154-168` 결함을 `vi.useFakeTimers + vi.setSystemTime` 격리로 차단했지만 *근본 원인 미해결*:

**근본 원인**: `evaluateFeedbackLoop` 가 함수 본체에서 `const now = new Date()` 호출 (라인 205). 호출자가 시점 결정 권한 없음. `recordWeightSnapshot(weights, now)` / `evaluateDrift(history, now)` / `isF2WPausedUntil(now)` / `pauseF2W(reason, ratio, now)` 4 함수 모두 동일 `new Date()` 시점 사용 — *deterministic 시점 inject 불가*.

테스트 측 `vi.useFakeTimers` 의존은:
- 다른 테스트와 격리 부담 (try/finally 의무)
- 호출자 시점 결정 권한 부재 → 분리 불가능한 결합도

ADR-0154 §"잔여" 가 *근본 해결을 별도 PR 분리* 명시 — 본 PR 이 그 후속.

## 결정

### 1. `FeedbackLoopOptions.now?: Date` 옵셔널 인자 추가

```typescript
export interface FeedbackLoopOptions {
  shadow?: boolean;
  weightStep?: number;
  upThreshold?: number;
  downThreshold?: number;
  // ADR-0157 신규
  now?: Date;
}
```

### 2. `evaluateFeedbackLoop` 본체 — `options.now` 우선

```typescript
const now = options?.now ?? new Date();
```

호출자 미전달 시 `new Date()` 그대로 (LIVE 매매 영향 0). 명시 inject 시 deterministic 시점.

### 3. 호출자 영향 매트릭스

| 호출자 | now inject 여부 | 영향 |
|------|------|------|
| `MacroIntelligenceDashboard.tsx:152` | 미전달 | LIVE — 동작 무변경 |
| `learningShadowModel.ts:51, 52` | 미전달 | 학습 shadow — 동작 무변경 |
| `regimeMemoryBank.evaluateFeedbackLoopByRegime` | 미전달 | 학습 분기 — 동작 무변경 |
| `quantEngine.feedbackLoop.driftGuard.test.ts:154-168` (본 PR 갱신) | **명시 inject** | deterministic 시점 — `vi.useFakeTimers` 의존 폐기 |

→ **LIVE 호출자 4개 모두 동작 무변경**. 테스트 측만 명시 inject — 의존 결합도 단절.

### 4. 테스트 측 `vi.useFakeTimers` 폐기

ADR-0154 §4 의 `vi.useFakeTimers + vi.setSystemTime + try/finally` 패턴 제거:

```typescript
// 이전 (ADR-0154):
vi.useFakeTimers();
vi.setSystemTime(now);
try {
  // ... seedDriftHistory + evaluateFeedbackLoop ...
} finally {
  vi.useRealTimers();
}

// 본 ADR-0157:
seedDriftHistory(now);
const result = evaluateFeedbackLoop(trades, weights, { now });
```

→ 테스트 코드 가독성 ↑ + 다른 테스트 영향 0 + 시점 결정 책임이 *호출자*.

## 영향

### LIVE 매매

- `evaluateFeedbackLoop` 시그니처 옵셔널 인자 추가 — 후방호환 100%
- LIVE 호출자 4개 미전달 → `new Date()` 그대로 → 동작 무변경
- 학습 가중치 영속 / drift 판정 / pause 설정 모두 동일

### 테스트 인프라

- `quantEngine.feedbackLoop.driftGuard.test.ts:154-168` — `vi.useFakeTimers` 의존 폐기 + `options.now` 명시 inject
- 8/8 driftGuard pass — PR-Phase1 ~ Phase4 시리즈 누적 baseline 1 fail 영구 차단

### 거버넌스

- ADR-0154 §"잔여" 의 driftGuard 근본 해결 후속 작업 완료
- 시점 결정 책임 위임 패턴 — 향후 학습 함수 신규 도입 시 동일 패턴 차용 (deterministic 테스트 의무)

## 회귀 테스트

`src/services/quantEngine.feedbackLoop.driftGuard.test.ts` 정합 정정 (1 케이스):
1. `vi.useFakeTimers + try/finally` 폐기
2. `evaluateFeedbackLoop(trades, weights, { now })` 명시 inject

8/8 driftGuard pass.

## ENV 우회

본 PR 미도입. 옵셔널 인자라 ENV 우회 불필요.

## 잔여

- **다른 시점 의존 함수** — `recordWeightSnapshot` / `evaluateDrift` / `isF2WPausedUntil` / `pauseF2W` 도 이미 `now` 인자 보유. 본 PR 은 *상위 호출자* (`evaluateFeedbackLoop`) 만 옵셔널 인자 도입. 하위 4 함수는 이미 deterministic.
- **LIVE 호출자 명시 inject** — 향후 운영 진단 / 회고 모드 등에서 *과거 시점 시뮬레이션* 필요 시 `options.now` 활용 가능.
