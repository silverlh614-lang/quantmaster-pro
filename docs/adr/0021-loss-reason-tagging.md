# ADR 0021 — 손실 원인 태그 + 자동 분류 (PR-D)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0018 (PR-A) · ADR-0019 (PR-B) · ADR-0020 (PR-C)

## 배경

자기학습 5계층 확장 시리즈의 마지막 PR. 현재 `TradeRecord.sellReason` 은
"왜 매도했나" (TARGET_HIT/STOP_LOSS/TRAILING_STOP/SELL_SIGNAL/MANUAL) 5분류로
거시적 매도 동기만 기록한다. 그러나 자기학습이 정말 답해야 할 질문은:

**"이 거래가 왜 손실났는가"** — 손절폭이 너무 좁았는지, 시장 전체가 급락했는지,
과열 진입이었는지, 손절을 너무 늦게 했는지.

사용자 분석 (보완점 3): "현재는 승률과 평균수익률 중심. 하지만 자기학습에서
더 중요한 것은 손실 원인이다."

손실 원인 8 분류 (사용자 분석에서 인용):

| 원인 | 의미 | 시스템 보정 방향 |
|---|---|---|
| FALSE_BREAKOUT | 돌파 실패 | VCP/거래량 조건 재검토 |
| MACRO_SHOCK | 시장 전체 급락 | Gate 0 강화 |
| SECTOR_ROTATION_OUT | 섹터 자금 이탈 | 섹터 로테이션 가중치 강화 |
| EARNINGS_MISS | 실적 훼손 | ROE/OCF/마진 가속도 강화 |
| LIQUIDITY_TRAP | 거래대금 부족 | 유동성 필터 강화 |
| OVERHEATED_ENTRY | 과열 진입 | 유포리아/RSI 감점 강화 |
| STOP_TOO_TIGHT | 손절폭 과도 | 프로파일별 손절 재조정 |
| STOP_TOO_LOOSE | 손절 지연 | 손절 조건 강화 |

## 결정

### 1. Schema (`src/types/portfolio.ts`)

```ts
export type LossReason =
  | 'FALSE_BREAKOUT'
  | 'MACRO_SHOCK'
  | 'SECTOR_ROTATION_OUT'
  | 'EARNINGS_MISS'
  | 'LIQUIDITY_TRAP'
  | 'OVERHEATED_ENTRY'
  | 'STOP_TOO_TIGHT'
  | 'STOP_TOO_LOOSE'
  | 'UNCLASSIFIED';

export interface TradeRecord {
  // ... 기존 필드
  lossReason?: LossReason;          // 신규 — CLOSED + returnPct < 0 일 때만 부여
  lossReasonAuto?: boolean;         // 신규 — 자동 분류 vs 사용자 수동 입력
  lossReasonClassifiedAt?: string;  // 신규 — 분류 시각 ISO
}
```

### 2. 자동 분류 함수 (`src/services/quant/lossReasonClassifier.ts` 신규)

`classifyLossReason(input)` 가 청산 시점 컨텍스트로 4가지를 자동 추론:

**입력:**
```ts
interface ClassifierInput {
  returnPct: number;                                        // 음수만 분류 진입
  holdingDays: number;
  buyPrice: number;
  sellPrice: number;
  conditionScores?: Record<ConditionId, number>;            // 매수 시점 27조건
  vkospiAtBuy?: number;                                     // 매수 시점 VKOSPI
  vkospiAtSell?: number;                                    // 매도 시점 VKOSPI
  sellReason?: TradeRecord['sellReason'];
}
```

**우선순위 (먼저 매칭되는 것 채택):**

1. **MACRO_SHOCK**: `vkospiAtSell - vkospiAtBuy >= 8` (VKOSPI 8포인트 이상 급등)
   AND `returnPct < -3%`. 시장 전체 급락 신호.
2. **STOP_TOO_TIGHT**: `holdingDays <= 3` AND `-3% > returnPct >= -10%`
   AND `sellReason === 'STOP_LOSS'`. 빠른 손절폭 도달.
3. **OVERHEATED_ENTRY**: 매수 시점 RSI 조건(없음 — proxy: 조건 17 "심리적 객관성"
   ≤ 3 또는 조건 25 VCP 0점) AND `holdingDays <= 5`. 과열 진입 후 즉시 하락.
4. **STOP_TOO_LOOSE**: `returnPct <= -15%`. 손절폭 너무 넓어 큰 손실.
5. **UNCLASSIFIED**: 위 모두 미해당.

자동 분류 외 4 분류 (FALSE_BREAKOUT / SECTOR_ROTATION_OUT / EARNINGS_MISS /
LIQUIDITY_TRAP) 는 사용자 수동 입력 또는 후속 PR (다중 trade 분석 필요).

### 3. Wiring (`src/hooks/useTradeOps.ts`)

```ts
const closeTrade = (tradeId, sellPrice, sellReason) => {
  // ... 기존 로직
  if (returnPct < 0) {
    const macroEnv = useGlobalIntelStore.getState().macroEnv;
    const classification = classifyLossReason({
      returnPct, holdingDays, buyPrice: trade.buyPrice, sellPrice,
      conditionScores: trade.conditionScores,
      vkospiAtBuy: trade.evaluationSnapshot?.vkospiAtBuy,  // ADR-0018 evaluationSnapshot 확장
      vkospiAtSell: macroEnv?.vkospi,
      sellReason,
    });
    // 거래 record 에 lossReason / lossReasonAuto / lossReasonClassifiedAt 부여
  }
};
```

### 4. evaluationSnapshot 에 vkospiAtBuy 추가 (PR-A 확장)

PR-A 의 `TradeRecord.evaluationSnapshot` 에 옵셔널 `vkospiAtBuy?: number` 추가.
TradeRecordModal 이 매수 시점 macroEnv.vkospi 를 캡처해 저장. 부재 시
classifyLossReason 의 MACRO_SHOCK 분기는 자동 스킵.

### 5. SnapshotStats 확장 (PR-B)

향후 PR 에서 `getLossReasonBreakdown(closedTrades)` 통계 함수 추가 가능.
본 PR scope 밖 — UI 노출은 데이터 누적 후 별도 PR.

## 비결정 (out of scope)

- UI TradeJournal 손실원인 dropdown (사용자 수동 입력) → 후속 PR
- FALSE_BREAKOUT / SECTOR_ROTATION_OUT / EARNINGS_MISS / LIQUIDITY_TRAP 자동
  분류 → 다중 trade 분석 또는 외부 데이터 필요, 별도 PR
- 손실 원인 별 학습 가중치 보정 (예: STOP_TOO_TIGHT 거래는 학습 약화) → 후속 PR
- 귀인 분석 (Alpha Driver / Risk Protector / Noise Factor / False Comfort
  4분류) → 별도 ADR

## 회귀 위험

- LIVE 자동매매 무영향 (절대 규칙 #2/#3/#4 무수정).
- 모든 신규 필드 옵셔널. lossReason 부재 v1/v2 레코드 호환.
- 분류기는 순수 함수 — 부수효과 없음. 입력 부족 시 UNCLASSIFIED 안전 fallback.
- evaluationSnapshot.vkospiAtBuy 추가는 PR-A 와 동일한 옵셔널 후방호환 패턴.

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 12 케이스:
  - classifyLossReason 우선순위 5분기 (MACRO_SHOCK / STOP_TOO_TIGHT /
    OVERHEATED_ENTRY / STOP_TOO_LOOSE / UNCLASSIFIED)
  - returnPct ≥ 0 → 분류 진입 안 함 (UNCLASSIFIED)
  - VKOSPI 데이터 부재 시 MACRO_SHOCK 자동 스킵
  - holdingDays / sellReason 부재 시 안전 fallback
  - 우선순위 충돌 (MACRO_SHOCK + STOP_TOO_TIGHT 동시 매칭) 검증
  - 경계값: -3% / -10% / -15% 임계
