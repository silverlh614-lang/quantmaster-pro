# ADR 0031 — Order Conversion Optimizer (PR-O, 사용자 #8)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0014 (KIS Retry Safety, idempotency='unsafe')

## 배경

페어 A (사후 측정) + 페어 D (사전 신호) 가 데이터 인프라 양 축이라면, #8
Order Optimizer 는 **변환률 향상** 의 직교 축. 사용자 분석:
"useSlippageStore 가 슬리피지를 추적하지만 피드백은 사람이 봐야 함. entryEngine 의
주문 타입 결정 로직은 정태적 (대부분 limit). 거래량이 충분한 강한 돌파에서
limit 으로 미체결되어 다음 날 +5% 갭업당하는 케이스가 알파 누수의 가장 흔한 패턴."

기존:
- `src/stores/useSlippageStore.ts` — 클라이언트 zustand persist 슬리피지 이력.
- `src/services/autoTrading/slippageEngine.ts` — 슬리피지 계산.
- 서버 측 슬리피지 영속 / 의사결정 로직 부재.

## 결정

### 1. 서버 영속 — `data/slippage-history.json`

paths.ts +`SLIPPAGE_HISTORY_FILE`. 종목별 슬리피지 이력 누적, 1000건 FIFO trim.

### 2. 신규 영속 모듈 — `server/persistence/slippageHistoryRepo.ts`

```ts
export interface SlippageHistoryEntry {
  id: string;
  stockCode: string;
  signalTime: string;
  theoreticalPrice: number;
  executedPrice: number;
  /** (executed - theoretical) / theoretical */
  slippagePct: number;
  orderType: 'IOC_MARKET' | 'LIMIT' | 'AGGRESSIVE_LIMIT';
  /** 신호 시점 거래량 z-score (강한 돌파 판정용 입력) */
  volumeZ?: number;
  /** 신호 시점 가격 모멘텀 (5분~1일 변화율, 결정 입력) */
  pricedMomentumPct?: number;
}

recordSlippageEntry(entry): void
loadSlippageHistory(): SlippageHistoryEntry[]
getSlippageStats(stockCode, lookback?): {
  sampleSize, mean, p50, p90, byOrderType
}
```

### 3. 신규 의사결정 모듈 — `server/trading/orderTypeOptimizer.ts`

```ts
interface OrderDecisionInput {
  stockCode: string;
  /** 신호 시점 거래량 z-score */
  volumeZ?: number;
  /** 신호 시점 가격 모멘텀 (% 변화) */
  priceMomentumPct?: number;
  /** 종목 평균 슬리피지 (서버 영속에서 계산) */
  avgSlippagePct?: number;
  /** 표본 수 */
  slippageSampleSize?: number;
}

interface OrderDecision {
  orderType: 'IOC_MARKET' | 'LIMIT' | 'AGGRESSIVE_LIMIT';
  /** AGGRESSIVE_LIMIT 의 가격 보정 (best_bid + N tick) */
  limitOffsetTicks?: number;
  /** 미체결 시 1회 chase 정책 */
  chasePolicy?: ChasePolicy;
  reason: string;
}

interface ChasePolicy {
  /** 미체결 후 N초 대기 */
  waitSeconds: number;
  /** chase 가격 = original + delta% */
  priceDeltaPct: number;
}
```

### 4. 의사결정 우선순위

```
1. 강한 돌파 — volumeZ ≥ 2 AND priceMomentumPct > 2
   → IOC_MARKET (체결 우선, ADR-0014 idempotency='unsafe' 준수 — 재시도 차단)
2. 일반 swing 진입 — 평균 슬리피지 ≥ 0.5% (충분한 표본 ≥ 10)
   → AGGRESSIVE_LIMIT @ best_bid + 1 tick + 60초 chase 정책
3. 기본 (slippage 데이터 부족 또는 약한 신호)
   → LIMIT @ best_bid (chase 없음)
```

### 5. ADR-0014 호환

IOC_MARKET 은 `idempotency='unsafe'` 정책 준수. KIS 5xx 응답 시 재시도 차단
필수 — 매칭엔진 도달 불확실성 차단.

### 6. wiring 본 PR scope 밖

`entryEngine` 의 주문 타입 결정 시점에 `decideOrderType()` 호출 + `fillMonitor`
가 슬리피지 발생 시 `recordSlippageEntry()` 호출은 후속 PR. 본 PR 은 모듈 +
영속 + 테스트만. **LIVE 매매 본체 무수정**.

## 비결정 (out of scope)

- entryEngine 호출 wiring → 별도 PR (Phase B 분해 후)
- chase 실행 로직 (orderQueue 미체결 1분 후 재발주) → 별도 PR
- useSlippageStore 의 클라이언트 데이터 서버 미러링 → 별도 PR
- 슬리피지 z-score 자동 학습 (예: 종목별 IQR 이상치 제외) → 별도 PR

## 회귀 위험

- LIVE 자동매매 무영향 (entryEngine / kisClient / autoTradeEngine 무수정).
- 신규 영속 파일 충돌 없음.
- ADR-0014 정책 위배 없음 (IOC_MARKET 사용자가 결정한 후 호출자가 실제 idempotency 처리).

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 14 케이스:
  - decideOrderType 우선순위 분기 (강한 돌파 / 슬리피지 ≥ 0.5% / 기본 / 데이터 부족)
  - ChasePolicy 적용 / 미적용
  - recordSlippageEntry: idempotent / FIFO trim
  - getSlippageStats: 분포 통계 + byOrderType 분리
  - 빈 데이터 안전 fallback
  - NaN/Infinity 입력 안전
