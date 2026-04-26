# ADR 0023 — 조건별 Profit Factor / MDD / Edge Score (PR-F)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0018 (PR-A) ~ ADR-0022 (PR-E)

## 배경

현재 `ConditionCalibration` 은 winRate / avgReturn 두 지표만 계산. 사용자 분석
3계층(조건별 성과 분석 레이어) + 보완점 1 — "단일 승률보다 손익비가 중요. 승률
70% + 평균수익 +2%/-8% 거래 vs 승률 45% + 평균수익 +25%/-5% 거래의 차이는 단순
승률로 판단 불가" 가 누락되어 있다.

추가로 사용자 분석 4계층 권장:
```
Edge Score = 승률 점수 + 평균수익률 점수 + Profit Factor 점수
           - 평균 MDD 페널티 - 허위신호 페널티 + 레짐 일관성 점수
```

## 결정

### 1. ConditionCalibration 신규 옵셔널 필드 4종

```ts
profitFactor?: number | null;  // sum(wins.return) / |sum(losses.return)|
avgReturnPosi?: number;         // 승리 거래 평균 수익률 (%)
avgReturnNeg?: number;          // 손실 거래 평균 손실률 (%, 음수)
edgeScore?: number;             // -10 ~ +10 종합 점수
```

### 2. Profit Factor 계산

- 모든 wins 의 returnPct 합계 / 모든 losses 의 |returnPct| 합계
- losses 합계 0 이면 null (정의 불가) — winSum > 0 면 강한 양호 상태로 해석
- PR-E 의 trade-level multiplier 동일 적용 (가중평균)

### 3. Edge Score 공식 (단순화)

```ts
edgeScore =
   (winRate - 0.5) * 4          // -2 ~ +2 (50% 기준)
 + clamp(avgReturn, -5, +5) * 0.4   // -2 ~ +2
 + clamp((profitFactor ?? 1) - 1, -2, +2) * 1.0   // -2 ~ +2
 - clamp(|avgReturnNeg|, 0, 15) * 0.2   // 0 ~ -3 페널티
```

범위 -7 ~ +7, 양수 = 가중치 상향 정당화, 음수 = 하향 정당화.

본 PR 은 통계 계산만 추가. Edge Score 기반 가중치 보정은 후속 PR (PR-K 같은
리팩토링 후 Phase 2 로 분리).

### 4. 영향

- 학습 알고리즘 미변경 — 기존 winRate 60%/40% 임계 그대로 + edgeScore 는 메타.
- UI 가 ProfitFactor / Edge Score 표기 가능 (실제 UI 변경은 별도 PR).
