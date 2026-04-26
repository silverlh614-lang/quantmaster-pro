# ADR 0022 — 손실 원인별 학습 가중치 보정 (PR-E)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0018 (PR-A) · ADR-0019 (PR-B) · ADR-0020 (PR-C) · ADR-0021 (PR-D)

## 배경

PR-D (ADR-0021) 가 손실 거래에 lossReason 을 부여했지만, 이 정보가 실제
학습에는 활용되지 않고 있다. 현재 `feedbackLoopEngine.evaluateFeedbackLoop` 는
모든 거래를 동등하게 학습 입력으로 처리해 다음 문제가 발생한다:

- `STOP_TOO_TIGHT` 손실 거래는 "조건이 나빴다" 가 아니라 "손절폭이 좁았다" 인데,
  관련 조건의 가중치를 동일하게 하향시켜 좋은 조건이 노이즈로 약화됨.
- `MACRO_SHOCK` 손실 거래는 시장 전체 문제이지 종목/조건 문제가 아닌데,
  학습이 마치 그 조건들이 잘못된 것처럼 보정.
- `OVERHEATED_ENTRY` 손실 거래는 진입 신호 노이즈가 명확한데, 관련 조건의 학습
  영향력을 더 강화하지 않고 있음.

사용자 분석 천재 아이디어 #1 (Confidence-Weighted Learning):
"조건 가중치를 단순 승률이 아니라 **데이터 신뢰도 × 표본 수 × 손익비** 로 조정.
AI 추정 조건은 아무리 성과가 좋아도 초기에는 절반만 반영. 환각성 데이터에
오염되지 않는다."

## 결정

trade-level multiplier 를 도입해 `evaluateFeedbackLoop` 의 winRate 와 평균
수익률을 가중평균으로 계산한다.

### 1. lossReasonWeighting SSOT (`src/services/quant/lossReasonWeighting.ts` 신규)

```ts
export const LOSS_REASON_LEARNING_MULTIPLIER: Record<LossReason, number> = {
  STOP_TOO_TIGHT:      0.3,  // 조건 잘못 아님 — 학습 약화
  MACRO_SHOCK:         0.2,  // 전 조건 noise — 학습 강력 약화
  OVERHEATED_ENTRY:    1.5,  // 진입 신호 노이즈 강한 학습 신호
  STOP_TOO_LOOSE:      1.5,  // 손절 신호 강화
  FALSE_BREAKOUT:      1.0,  // 기본 (조건 점검 가치는 정상)
  SECTOR_ROTATION_OUT: 0.5,  // 섹터 문제 — 조건 학습 약화
  EARNINGS_MISS:       0.5,  // 외부 충격 — 조건 학습 약화
  LIQUIDITY_TRAP:      0.7,  // 유동성 문제 — 조건 학습 부분 약화
  UNCLASSIFIED:        1.0,  // 기본
};
```

수익 거래 (`returnPct >= 0`) 와 lossReason 부재 거래 (PR-D 이전 v1 레코드) 는
일관되게 multiplier=1.0.

### 2. evaluateFeedbackLoop 가중평균 알고리즘

기존:
```ts
const wins = relevant.filter(t => t.returnPct > 0);
const winRate = wins.length / relevant.length;
const avgReturn = relevant.reduce((s, t) => s + t.returnPct, 0) / relevant.length;
```

신규:
```ts
const weightedWins = relevant.filter(t => t.returnPct > 0)
  .reduce((s, t) => s + getTradeLearningWeight(t), 0);
const weightedTotal = relevant
  .reduce((s, t) => s + getTradeLearningWeight(t), 0);
const winRate = weightedTotal > 0 ? weightedWins / weightedTotal : 0;
const avgReturn = relevant
  .reduce((s, t) => s + t.returnPct * getTradeLearningWeight(t), 0) / weightedTotal;
```

`getTradeLearningWeight(trade)`:
- `returnPct >= 0` → 1.0 (수익 거래는 그대로)
- `returnPct < 0` AND `lossReason` 부재 → 1.0 (v1/v2 레코드 호환)
- `returnPct < 0` AND `lossReason` 존재 → `LOSS_REASON_LEARNING_MULTIPLIER[lossReason]`

### 3. 수치 예시 — 동일 60% 승률에 lossReason 분포 다른 두 케이스

**Case A**: 30 거래 중 18 승 / 12 패 (모두 UNCLASSIFIED)
- 기존: winRate = 18/30 = 60%, COMPUTED 조건 → +10%
- 신규: weightedTotal = 30, weightedWins = 18, winRate = 60% (동일)

**Case B**: 30 거래 중 18 승 / 12 패 (12 패 모두 STOP_TOO_TIGHT)
- 기존: winRate = 18/30 = 60%, COMPUTED 조건 → +10%
- 신규: weightedTotal = 18 + 12×0.3 = 21.6, weightedWins = 18, winRate = 18/21.6 ≈ **83.3%**
- → 조건은 좋은데 손절폭만 문제였으니 조건 가중치 +10% (기존과 동일 방향이지만 "강한 confidence")

**Case C**: 30 거래 중 18 승 / 12 패 (12 패 모두 OVERHEATED_ENTRY)
- 기존: winRate = 18/30 = 60%
- 신규: weightedTotal = 18 + 12×1.5 = 36, weightedWins = 18, winRate = 18/36 = **50%**
- → 진입 신호 노이즈가 명확하므로 학습이 더 보수적 (가중치 변경 STABLE)

### 4. ConditionCalibration 결과 확장

```ts
export interface ConditionCalibration {
  // 기존 + PR-C source/sourceMultiplier
  // PR-E 신규
  weightedTradeCount?: number;     // sum of trade-level multipliers
  rawTradeCount?: number;          // 원래 trade 수 (UI 가 raw vs weighted 표기)
  lossReasonBreakdown?: Partial<Record<LossReason, number>>;  // 분포 진단
}
```

### 5. 환경 변수 (긴급 롤백)

```ts
LEARNING_LOSS_REASON_WEIGHTING_DISABLED=true
```

→ 모든 trade multiplier=1.0 (PR-E 이전 동작 복원).

## 비결정 (out of scope)

- 사용자 수동 lossReason 입력 UI (TradeJournal dropdown) → 별도 PR
- 조건별 Profit Factor / MDD / Edge Score 통계 확장 → 별도 PR
- 레짐별 가중치 분리 → 별도 PR
- 다중 trade 분석 기반 SECTOR_ROTATION_OUT 자동 분류 → 별도 PR

## 회귀 위험

- LIVE 자동매매 무영향 (절대 규칙 #2/#3/#4 무수정).
- lossReason 부재 v1/v2 레코드 → multiplier=1.0 자동 fallback (기존 동작).
- 0/0 division 가드 (weightedTotal === 0 → winRate=0 + STABLE).
- 모든 신규 ConditionCalibration 필드 옵셔널.

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 12 케이스:
  - lossReasonWeighting 매핑 9 LossReason 모두 검증
  - getTradeLearningWeight: 수익/lossReason 부재/STOP_TOO_TIGHT/OVERHEATED 등
  - evaluateFeedbackLoop 가중평균: Case A/B/C 전수
  - disable env 시 multiplier=1.0 복원
  - weightedTradeCount + lossReasonBreakdown 결과 정확성
  - 0/0 안전 fallback
