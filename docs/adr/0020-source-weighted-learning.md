# ADR 0020 — AI/COMPUTED 차등 학습 가중치 (PR-C)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0018 (자기학습 데이터 무결성, PR-A) · ADR-0019 (RecommendationSnapshot, PR-B)

## 배경

`feedbackLoopEngine.evaluateFeedbackLoop` 는 모든 27조건을 동등하게 학습한다 —
승률 > 60% 이면 `WEIGHT_STEP=0.10` (±10%) 으로 가중치를 보정. 그러나 27조건은
실제로는 두 가지 다른 신뢰도 등급으로 구성된다:

- **COMPUTED** (9개): 가격/지표 데이터로 직접 계산. 결정적, 재현 가능.
  - 조건 2/6/7/10/11/18/19/24/25 (RSI/일목/터틀/VCP/RS/거래량 등)
- **AI** (18개): Gemini 해석 기반 추정값. 환각 위험 + 같은 입력에 다른 출력 가능.
  - 조건 1/3/4/5/8/9/12~17/20~23/26/27 (주도주 사이클/ROE 유형/촉매제/수급 질 등)

문제: AI 가 "촉매제 9점" 으로 추정한 거래가 우연히 수익이 났을 때, 그 거래가
COMPUTED 거래와 동일한 학습 영향력을 갖게 되어 **AI 환각이 학습에 100% 반영**
된다. 사용자 분석 (보완점 2): "AI 추정 조건의 학습 반영률을 낮춰야 함 →
COMPUTED 100% / API 80% / AI 40%".

## 결정

`feedbackLoopEngine` 의 가중치 변경량(WEIGHT_STEP)에 source 별 multiplier 를 적용한다.

### 1. Source multiplier SSOT (`src/services/quant/sourceWeighting.ts` 신규)

```ts
export const SOURCE_LEARNING_MULTIPLIER: Record<'COMPUTED' | 'AI', number> = {
  COMPUTED: 1.0,  // 100% 반영 — 결정적 데이터
  AI: 0.4,        // 40% 반영 — 환각 위험 보정
};
```

향후 'API' / 'MANUAL' 등급이 SOURCE_MAP 에 추가되면 본 SSOT 에서 multiplier 만
추가하면 된다.

### 2. 학습 알고리즘 수정 (feedbackLoopEngine.evaluateFeedbackLoop)

기존:
```ts
const WEIGHT_STEP = 0.10;
if (winRate > 0.60) newWeight = clamp(prev + WEIGHT_STEP, ...);
else if (winRate < 0.40) newWeight = clamp(prev - WEIGHT_STEP, ...);
```

신규:
```ts
const baseStep = WEIGHT_STEP;
const source = CONDITION_SOURCE_MAP[id];
const multiplier = SOURCE_LEARNING_MULTIPLIER[source];
const effectiveStep = baseStep * multiplier;  // COMPUTED: 0.10, AI: 0.04
if (winRate > 0.60) newWeight = clamp(prev + effectiveStep, ...);
else if (winRate < 0.40) newWeight = clamp(prev - effectiveStep, ...);
```

### 3. 결과 — 동일 60% 승률 시 가중치 변화량

| Source | 기존 | 신규 |
|---|---|---|
| COMPUTED 조건 | +10% (1.0 → 1.10) | +10% (1.0 → 1.10) |
| AI 조건 | +10% (1.0 → 1.10) | **+4% (1.0 → 1.04)** |

AI 조건은 25 거래 동안 보정된 양을 COMPUTED 조건이 10 거래에 달성한다.
즉 **AI 조건이 학습에 반영되려면 더 많은 표본이 필요** — 환각 위험 자연 보정.

### 4. ConditionCalibration 결과 확장

```ts
export interface ConditionCalibration {
  // 기존 필드
  source: 'COMPUTED' | 'AI';   // 신규
  sourceMultiplier: number;    // 신규 — UI 가 ±X% 표기 가능
}
```

### 5. 환경 변수 (긴급 롤백 스위치)

```ts
const DISABLED = (typeof process !== 'undefined' &&
  process.env?.LEARNING_SOURCE_WEIGHTING_DISABLED === 'true');
```

`true` 면 모든 조건이 multiplier=1.0 으로 fallback (PR-C 이전 동작 복원).
브라우저 환경에서 process 미정의 시 자연스럽게 disable 되지 않음 (production
은 본 PR-C 동작 기본 유지).

### 6. 후방호환

- `TradeRecord.conditionSources` (PR-A v2) 가 있으면 trade-level 정보 우선 활용.
  부재 시 (v1 레코드) `CONDITION_SOURCE_MAP` 글로벌 SSOT 폴백.
- 기존 calibration 결과 사용처는 모두 옵셔널 새 필드 무시 가능.

## 비결정 (out of scope)

- trade 단위 source confidence 기반 학습 (예: trade 의 AI 비중이 높으면 trade
  자체를 학습에서 약화) → 후속 PR
- 'API'/'MANUAL' 등급 추가 → SOURCE_MAP 자체 수정 필요 (별도 PR)
- 손실 원인 자동 분류 → **PR-D**
- UI FeedbackLoopPanel 의 source 별 색상 분기 → 후속 PR

## 회귀 위험

- LIVE 자동매매 무영향 (절대 규칙 #2/#3/#4 무수정).
- 본 PR 이전에 학습 활성 환경에서 누적된 가중치는 그대로 유지 (clamp 0.5~1.5
  내). 단지 향후 보정 속도가 AI 조건만 60% 감속.
- v1 TradeRecord (PR-A 이전) 는 conditionScores={} 가 학습 진입 자체 배제이므로
  PR-C 의 source 차등화에 영향 받지 않음.

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 8 케이스:
  - COMPUTED 조건 +10%/-10% 그대로
  - AI 조건 +4%/-4%
  - 60%/40% 경계는 동일 (방향 결정은 변함 없음, 폭만 다름)
  - 환경 스위치 disable 시 모든 조건 multiplier=1.0
  - 가중치 clamp 0.5~1.5 그대로
  - sourceMultiplier 결과 필드 정확성
  - trade.conditionSources 없을 때 글로벌 SOURCE_MAP fallback
  - 기존 18개 feedbackLoop 테스트 무회귀
