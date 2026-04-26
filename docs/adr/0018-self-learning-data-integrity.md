# ADR 0018 — 자기학습 데이터 파이프라인 무결성 (PR-A)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0006 (Attribution composite key), ADR-0007 (Learning feedback loop policy)

## 배경

`feedbackLoopEngine.evaluateFeedbackLoop` 와 `evolutionEngine.saveEvolutionWeights`
는 30거래 누적 시 27조건 가중치를 자동 보정하도록 설계됐지만, 실제 데이터
파이프라인 audit (2026-04-26) 결과 다음 두 가지 critical 결함이 확인됐다.

1. **TradeRecordModal 이 conditionScores 를 hardcoded `{}`, gate scores 를 `0`
   으로 전달한다** (`TradeRecordModal.tsx:188-194`). 모든 수동 매수 기록이
   학습 가능한 조건 점수를 잃고 저장된다.
2. **`TradeRecord` 스키마에 `conditionSources` 필드가 없다** (`portfolio.ts:313`).
   PR-C (AI 추정 vs 실계산 차등 학습) 의 전제 데이터가 영구 손실된다.

결과적으로 `FeedbackLoopPanel` 이 "30/30 거래 달성 — 자동 교정 활성화"
배지를 띄워도 calibrations[] 는 빈 배열이 되어 자기학습 루프가 사실상
**관측 가능한 비활성 상태**에 있다.

## 결정

PR-A 에서 다음 4가지를 단일 PR 로 묶어 보강한다.

### 1. `TradeRecord` 스키마 v2 — 옵셔널 필드 3개 추가 (후방호환)

```ts
export interface TradeRecord {
  // ... 기존 필드 (변경 없음)
  conditionScores: Record<ConditionId, number>;  // 기존 — 입력 보강
  conditionSources?: Record<ConditionId, 'COMPUTED' | 'AI'>;  // 신규
  evaluationSnapshot?: {                          // 신규
    capturedAt: string;       // ISO — 추천 평가 시점
    rrr?: number;             // Risk-Reward Ratio
    profile?: 'A' | 'B' | 'C' | 'D';
    confluence?: number;      // 0~100
    lastTrigger?: boolean;    // Last Trigger 통과 여부
  };
  schemaVersion?: number;     // 신규 — 기본 2, v1 레코드는 sanitize 시 1 부여
}
```

- 모두 옵셔널. v1 레코드는 sanitize 시 `schemaVersion=1` 자동 부여로 호환.
- `evaluationSnapshot` 은 향후 PR-D 의 손실원인 분류에서 진입 시점 메타로 재사용.

### 2. 신규 adapter `src/services/quant/checklistToConditionScores.ts`

`StockRecommendation.checklist` 의 27개 named field 를 `Record<ConditionId, number>`
로 단방향 변환한다. `evaluateStock()` 재호출 없이 추천 시점에 이미 계산된
점수를 무손실 전달한다.

매핑 (StockRecommendation.checklist → ConditionId):

| checklist field | ConditionId | name |
|---|---|---|
| cycleVerified | 1 | 주도주 사이클 |
| momentumRanking | 2 | 모멘텀 |
| roeType3 | 3 | ROE 유형 3 |
| supplyInflow | 4 | 수급 질 |
| riskOnEnvironment | 5 | 시장 환경 Risk-On |
| ichimokuBreakout | 6 | 일목균형표 |
| mechanicalStop | 7 | 기계적 손절 설정 |
| economicMoatVerified | 8 | 경제적 해자 |
| notPreviousLeader | 9 | 신규 주도주 여부 |
| technicalGoldenCross | 10 | 기술적 정배열 |
| volumeSurgeVerified | 11 | 거래량 |
| institutionalBuying | 12 | 기관/외인 수급 |
| consensusTarget | 13 | 목표가 여력 |
| earningsSurprise | 14 | 실적 서프라이즈 |
| performanceReality | 15 | 실체적 펀더멘털 |
| policyAlignment | 16 | 정책/매크로 |
| psychologicalObjectivity | 17 | 심리적 객관성 |
| turtleBreakout | 18 | 터틀 돌파 |
| fibonacciLevel | 19 | 피보나치 |
| elliottWaveVerified | 20 | 엘리엇 파동 |
| ocfQuality | 21 | 이익의 질 OCF |
| marginAcceleration | 22 | 마진 가속도 |
| interestCoverage | 23 | 재무 방어력 ICR |
| relativeStrength | 24 | 상대강도 RS |
| vcpPattern | 25 | VCP |
| divergenceCheck | 26 | 다이버전스 |
| catalystAnalysis | 27 | 촉매제 |

누락/undefined 필드는 0 fallback. 변환 결과의 `conditionSources` 는 항상
`CONDITION_SOURCE_MAP` 그대로 동봉.

### 3. `TradeRecordModal` — checklist 변환 + 메타 첨부

```ts
const conditionScores = checklistToConditionScores(stock.checklist);
const conditionSources = CONDITION_SOURCE_MAP;
const evaluationSnapshot = {
  capturedAt: new Date().toISOString(),
  rrr: stock.targetPrice && stock.stopLoss && bp > 0
    ? (stock.targetPrice - bp) / (bp - stock.stopLoss)
    : undefined,
  profile: undefined, // StockRecommendation 미보유 — 향후 EvaluationResult 직결 시 보강
  confluence: stock.confidenceScore,
  lastTrigger: undefined,
};
const finalScore =
  Object.values(conditionScores).reduce((a, b) => a + b, 0); // 0~270 raw sum

onRecordTrade(stock, bp, qty, ps, followedSystem,
  conditionScores, conditionSources, evaluationSnapshot,
  { g1: ..., g2: ..., g3: ..., final: finalScore },
  preMortems);
```

gate1/2/3 score 는 `gate1/2/3PassCount × 5` 근사값으로 계산한다 (각 Gate
조건 통과 개수 × 5점). 향후 `EvaluationResult` 직결 PR 에서 정확값으로 교체.

### 4. `useTradeOps.recordTrade` — 시그니처 확장 + schemaVersion 명시

```ts
recordTrade(
  stock, buyPrice, quantity, positionSize, followedSystem,
  conditionScores,
  gateScores,
  conditionSources?: Record<ConditionId, 'COMPUTED' | 'AI'>,
  evaluationSnapshot?: TradeRecord['evaluationSnapshot'],
  preMortems?: PreMortemItem[],
)
```

저장 시 `schemaVersion: 2` 명시. `useTradeStore.sanitizeTradeRecord` 는
v1 레코드를 만나면 `schemaVersion=1` 자동 부여하고 신규 필드는 보존.

## 비결정 (out of scope)

- AI 추정 vs 실계산 학습 가중치 차등화 → **PR-C** (별도 PR)
- 손실 원인 분류 enum + 자동 태깅 → **PR-D** (별도 PR)
- RecommendationSnapshot 영속 레이어 (PENDING/OPEN/CLOSED 상태 추적) → **PR-B** (별도 PR)
- 레짐별/섹터별 가중치 분리 → 후속 ADR (PR-E~)

## 회귀 위험

- LIVE 자동매매 무영향 (절대 규칙 #2/#3/#4 모두 미수정).
- 클라이언트 측 매수 기록 폼 + zustand persist + 학습 루프만 영향.
- 기존 v1 TradeRecord 는 schemaVersion=1 이 자동 부여되며 conditionScores 가 빈
  객체이면 학습 진입 자체가 안 되므로 v1 레코드는 학습에서 자연스럽게 배제 —
  잘못된 데이터로 학습이 오염되지 않는다.

## 검증

- `npm run lint` (client + server tsc)
- `npm run validate:all` (gemini/complexity/sds/exposure/responsibility/boundary 6종)
- `npm run precommit` 전체
- 회귀 테스트 ≥ 8 케이스:
  - `checklistToConditionScores.test.ts` 4 (27 필드 매핑 / undefined 0 fallback / source 분류 / 빈 checklist)
  - `useTradeStore.sanitize.test.ts` 2 (v1 마이그레이션 / 신규 필드 보존)
  - `feedbackLoopEngine.test.ts` +2 (변환된 conditionScores 로 학습 진입 / sourceless v1 레코드 배제)
