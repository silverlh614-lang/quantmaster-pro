# ADR 0046 — F2W Drift Detector — 자기학습 가중치 폭주 감시 (PR-Y1)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0007 (Learning Feedback Loop Policy), ADR-0008 (Kelly Time Decay), ADR-0027 (Shadow Model), ADR-0041 (Weekly Self-Critique)

## 배경

사용자 4 아이디어 중 1번 (브랜치 `claude/add-drift-detector-Ueere` 와 일치):

> F2W가 가중치를 자동 조정하기 시작했으니, 그 조정 자체가 폭주하지 않는지 감시할
> 메타 회로가 필요. 매주 조건별 가중치의 표준편차 변화를 추적하여 σ가 30일 평균의
> 2배를 넘으면 "F2W가 단일 시장 국면에 과적합되고 있다"고 판단, 가중치 조정을 자동
> 일시정지. **변화는 영양이지만 변화의 변화는 독.** ADR-0027 Shadow Model 인프라를
> 재활용.

PR-A~K 시리즈로 자기학습 5계층이 정착했으나 (ADR-0018~0027), F2W
(Feedback-to-Weight) 가 30거래 누적 후 자동 보정을 시작하면 그 보정 자체가 폭주할
수 있다. 단일 시장 국면 (예: 강한 상승장 / 급락장) 의 손익 패턴이 27조건 가중치를
극단으로 밀어붙이면 σ 가 정상 범위를 벗어나 "전 조건 +1.5 / 나머지 -0.5" 같은
overfit 분포가 형성된다. 다음 국면 진입 시 이 가중치가 잘못된 방향으로 작동.

기존 안전망:
- ADR-0027 Shadow Model: 새 *알고리즘* 검증 — 새 *가중치 패턴* 폭주는 미감지
- ADR-0007 Learning Feedback Loop Policy: 텔레그램 suggest 알림 — drift 임계 부재
- ADR-0041 주간 자기비판 (CH4): 통계 표면화 — 자동 일시정지 미구현

## 결정

**F2W Drift Detector** 신설 — 가중치 σ 의 *변화의 변화* 를 감시하는 메타 회로.

### 1. 데이터 SSOT — 가중치 히스토리 영속

```ts
interface WeightHistorySnapshot {
  capturedAt: string;            // ISO timestamp
  sigma: number;                 // 27조건 가중치의 σ
  weights: Record<ConditionId, number>;
}
```

- localStorage 키: `k-stock-f2w-weight-history`
- ring buffer 90일 (FIFO trim)
- `recordWeightSnapshot(weights, now)` — 매 학습 사이클 1회 누적
  - feedbackLoopEngine 가 `updatedWeights` 결정 직후 호출

### 2. drift 판정 임계 (사용자 원안 그대로)

```ts
function evaluateDrift(history, now): {
  drifted: boolean;
  sigma7d: number;     // 최근 7일 평균 σ
  sigma30dAvg: number; // 최근 30일 평균 σ
  ratio: number;       // sigma7d / sigma30dAvg
  reason?: string;
}
```

- `drifted = sigma7d ≥ sigma30dAvg × 2`
- 표본 가드: 30일 windowed 데이터가 5건 미만이면 `drifted=false` (false positive 차단)
- `sigma30dAvg = 0` 일 때 ratio 무한대 fallback → `drifted=false`
- 7일 표본이 없으면 `drifted=false`

### 3. 일시정지 정책

```ts
interface F2WPauseState {
  pausedAt: string;
  pausedUntil: string;
  reason: string;
  ratio: number;
}
```

- localStorage 키: `k-stock-f2w-pause-state`
- TTL: 7일 자동 만료 (시장 국면 전환 평균 기간)
- 운영자 수동 해제 가능: `clearF2WPause()`
- pause 중에도 **shadow 학습은 계속** — F2W 만 동결, ADR-0027 grace 보존

### 4. 기존 모듈 가드 wiring

`feedbackLoopEngine.evaluateFeedbackLoop` 진입부:

1. `recordWeightSnapshot(updatedWeights)` — 항상 호출 (히스토리 누적)
2. `evaluateDrift()` — drift 판정
3. drift=true + shadow=false (LIVE) → **`saveEvolutionWeights` 호출 차단**
4. shadow=true 는 기존대로 우회 (ADR-0027 패턴)
5. 결과 객체에 `pauseStatus?` 옵셔널 필드 추가

### 5. 텔레그램 알림 (PR-X4/X5 패턴)

drift 감지 시 클라이언트가 `POST /api/learning/f2w-drift-alert` 호출 →
서버가 dispatchAlert + sendPrivateAlert 일괄 발송.

분리 사유: F2W 학습 회로는 클라이언트 측 (localStorage 기반), 텔레그램 발송은
서버 측 (`server/alerts/`). 클라이언트가 직접 dispatchAlert 를 import 할 수 없음.

```
POST /api/learning/f2w-drift-alert
Content-Type: application/json

{
  "sigma7d": 0.32,
  "sigma30dAvg": 0.14,
  "ratio": 2.29,
  "pausedUntil": "2026-05-03T...",
  "topConditions": [
    { "conditionId": 1, "weight": 1.5, "deviation": 0.5 },
    ...
  ]
}
```

서버:
- `dispatchAlert(ChannelSemantic.JOURNAL, message, { priority: 'HIGH', dedupeKey: 'f2w_drift_detected:{KST}' })` — CH4 자동 발행
- `sendPrivateAlert(message, ...)` — 운영자 DM 즉각 인지
- 24h cooldown (dedupeKey)

### 6. 환경변수 롤백

`LEARNING_F2W_DRIFT_DISABLED=true` → drift 판정 무력화 (모든 경로 정상 동작).

## 비결정 (out of scope)

- drift 임계 동적 학습 (사용자 원안 고정 ×2 사용) → 데이터 누적 후 별도 PR
- σ 계산 시 가중치 정규화 (현재 raw 값 사용) → 운영 데이터 검토 후
- Reflection Module Half-Life (PR-Y2), Cross-Channel Contradiction (PR-Y3),
  Learning Coverage Heatmap (PR-Y4) → 후속 브랜치

## 후방호환

- ADR-0027 Shadow Model: shadow=true 호출은 drift 가드 우회 (기존 동작)
- 가중치 히스토리 미존재 시 첫 호출은 단순 누적 (drift=false)
- pause 미설정 시 모든 호출 정상 (zero-cost)
- `LEARNING_F2W_DRIFT_DISABLED` 시 본 PR 도입 전과 동일 동작

## 사용자 한 줄

**변화는 영양이지만 변화의 변화는 독이다.**
