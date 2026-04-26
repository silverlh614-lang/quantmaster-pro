# ADR 0026 — 조건 귀인 분석 (PR-I)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0018 ~ ADR-0025

## 배경

사용자 분석 5계층 + 천재 아이디어 (귀인 분석):
"매매 종료 후 다음을 계산:
- 수익 거래에서 높았던 조건 → Alpha Driver
- 손실 회피에 도움 → Risk Protector
- 수익/손실과 무관 → Noise Factor
- 손실 거래에서 높게 나옴 → False Comfort"

PR-A 가 conditionScores 데이터를 영속하고, PR-D 가 lossReason 을 부여하고,
PR-E 가 거래 신뢰도를 학습에 반영했지만, 27 조건 각각이 어떤 역할을 하는지의
질적 분류가 부재.

## 결정

순수 분류기 함수 `classifyConditionAttribution(conditionId, trades)` 를 신설.
가중치 보정과 별개의 **읽기 전용 분석** 레이어.

### 1. 4 Attribution 분류

```ts
export type AttributionClass =
  | 'ALPHA_DRIVER'      // 수익 거래에서 반복 강함 (가중치 상향 정당화)
  | 'RISK_PROTECTOR'    // 손실 거래에서 낮음 / 수익에서 정상 (방어력)
  | 'NOISE_FACTOR'      // 수익/손실과 무관 (가중치 하향 정당화)
  | 'FALSE_COMFORT';    // 손실 거래에서 높게 나옴 (강한 감점 / 후행 신호 의심)
```

### 2. 분류 알고리즘

```ts
const winAvgScore = mean(wins.map(t => t.conditionScores[id]));
const lossAvgScore = mean(losses.map(t => t.conditionScores[id]));
const overallSpread = winAvgScore - lossAvgScore;  // -10 ~ +10

if (overallSpread >= 2 && winAvgScore >= 5)        return 'ALPHA_DRIVER';
if (overallSpread <= -2 && lossAvgScore >= 5)       return 'FALSE_COMFORT';
if (winAvgScore < 3 && lossAvgScore < 3)            return 'RISK_PROTECTOR';
                                                    return 'NOISE_FACTOR';
```

- ALPHA_DRIVER: 승리에서 평균 점수가 패배보다 2점 이상 높고 절대값도 5+
- FALSE_COMFORT: 패배에서 평균 점수가 승리보다 2점 이상 높고 절대값도 5+
- RISK_PROTECTOR: 양쪽 모두 점수 낮음 — 발동 안 했어도 손실 회피
- NOISE_FACTOR: 위 모두 미해당 (의미 없는 조건)

### 3. 결과 인터페이스

```ts
interface ConditionAttribution {
  conditionId: ConditionId;
  classification: AttributionClass;
  winAvgScore: number;
  lossAvgScore: number;
  spread: number;
  winCount: number;
  lossCount: number;
  /** 신뢰 표본 충족 여부 (각 그룹 ≥ 5건) */
  reliable: boolean;
}
```

### 4. PR-E lossReason multiplier 미적용

본 분류는 raw 점수 분포만 본다 — multiplier 가중평균은 학습 가중치 보정 단계
(feedbackLoopEngine) 에서만 사용. 분류는 raw 패턴 식별이 목적이라 multiplier
미사용 (의미 왜곡 방지).

### 5. 본 PR scope

- 순수 함수 + 회귀 테스트만. UI/학습 wiring 은 후속 PR.
