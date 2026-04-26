# ADR 0024 — 레짐별 가중치 분리 (Regime Memory Bank, PR-G)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0018 ~ ADR-0023

## 배경

사용자 분석 Phase 4 + 천재 아이디어 #2 — "전체 통합 가중치 하나만 쓰면 안 됨.
EXPANSION 에서는 RS/VCP/거래량 가중치 상승 / CRISIS 에서는 OCF/ICR/손절 가중치
상승. 시장 국면별 기억을 가진 시스템."

기존 `evolutionEngine` 의 `localStorage('k-stock-evolution-weights')` 는 단일
글로벌 weight map. 시장 레짐 변화 시 학습이 평준화되어 국면별 알파 신호 손실.

## 결정

### 1. Regime 분류 (이미 시스템에 존재)

`MarketRegimeClassifierResult.regime` ∈ ('RECOVERY' | 'EXPANSION' | 'SLOWDOWN'
| 'RECESSION' | 'RANGE_BOUND' | 'UNCERTAIN' | 'CRISIS')

### 2. TradeRecord 에 entryRegime 추가 (옵셔널)

```ts
interface TradeRecord {
  // 기존 필드
  entryRegime?: string;  // 매수 시점 시장 레짐 — PR-G 학습 분리 키
}
```

매수 시 `useGlobalIntelStore.marketRegimeClassifierResult?.regime` 캡처.
부재 시 학습은 글로벌 fallback.

### 3. evolutionEngine 의 레짐별 weight store

기존 키 `k-stock-evolution-weights` 는 글로벌 fallback 으로 유지.
신규 키 `k-stock-evolution-weights-by-regime` 추가:

```ts
type RegimeKey = 'RECOVERY' | 'EXPANSION' | 'SLOWDOWN' | 'RECESSION'
              | 'RANGE_BOUND' | 'UNCERTAIN' | 'CRISIS';

interface RegimeWeightStore {
  byRegime: Partial<Record<RegimeKey, Record<number, number>>>;
}

getEvolutionWeightsByRegime(regime: RegimeKey | null): Record<number, number>;
saveEvolutionWeightsByRegime(regime: RegimeKey, weights: Record<number, number>): void;
```

`getEvolutionWeightsByRegime(regime)` 우선순위:
1. byRegime[regime] 존재 → 반환
2. byRegime[regime] 부재 → 글로벌 fallback (기존 동작)

### 4. feedbackLoopEngine — 옵셔널 레짐 분리 학습

신규 함수 `evaluateFeedbackLoopByRegime(closedTrades, regime?)`:

- regime 미지정 → 기존 동작 (전체 trades 학습 → 글로벌 weight 갱신)
- regime 지정 → trade.entryRegime === regime 인 trade 만 필터 → 해당 레짐
  weight 만 갱신

기존 `evaluateFeedbackLoop` 함수는 무수정 (호환성).

### 5. 환경 변수

`LEARNING_REGIME_BANK_DISABLED=true` → 모든 함수가 글로벌 fallback 으로 동작.

## 비결정 (out of scope)

- evaluateStock 에서 레짐별 weight 자동 선택 → 별도 PR (Stage 2)
- 레짐 전환 시 가중치 보간/혼합 → 별도 PR
- 레짐별 통계 UI → 별도 PR
