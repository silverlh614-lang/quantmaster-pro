# ADR 0019 — 추천 스냅샷 lifecycle 영속 레이어 (PR-B)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0018 (자기학습 데이터 무결성, PR-A)

## 배경

자기학습 5계층 확장 시리즈의 두 번째 PR. 사용자가 받은 AI 추천이 실제로
얼마나 적중했는지 정량화할 SSOT 가 클라이언트에 부재하다.

기존 자산:
- `useRecommendationStore.recommendationHistory` — 30개 limit 의 lightweight
  이력 (date + stocks + hitRate). lifecycle 추적용 SSOT 가 아님.
- `server/learning/recommendationTracker.ts` — SHADOW 자동매매 신호 평가용
  (PENDING/WIN/LOSS/EXPIRED). `fetchCurrentPrice` 로 시장가 도달을 자동
  판정하므로 사용자 행동 (수동 매수/매도) 과 무관함.

부재한 것:
- 추천 발령 시점부터 사용자 행동(매수→매도)을 따라가는 lifecycle SSOT.
- 추천 → 매수 → 매도 의 종단 적중률 (사용자가 시스템 추천을 따랐을 때 얼마나
  실현했나).
- 추천을 받았지만 매수 안 한 종목 (Missed Opportunity / 회피 정확도) 추적.

## 결정

클라이언트 측 RecommendationSnapshot 영속 레이어를 신설한다.

### 1. Schema (RecommendationSnapshot)

```ts
export interface RecommendationSnapshot {
  id: string;                           // 'rec-snap-<timestamp>-<code>'
  recommendedAt: string;                // ISO
  stockCode: string;
  stockName: string;
  recommendation: 'BUY' | 'STRONG_BUY' | 'STRONG_SELL' | 'SELL' | 'NEUTRAL';
  // 추천 시점 가격/리스크
  entryPrice: number;
  targetPrice?: number;
  stopLossPrice?: number;
  rrr?: number;
  // 추천 시점 27조건 + Gate (PR-A adapter 산출물 재사용)
  conditionScores: Record<ConditionId, number>;
  conditionSources: Record<ConditionId, 'COMPUTED' | 'AI'>;
  gate1Score: number;
  gate2Score: number;
  gate3Score: number;
  finalScore: number;
  confluence?: number;
  sector?: string;
  // Lifecycle
  status: 'PENDING' | 'OPEN' | 'CLOSED' | 'EXPIRED';
  openedAt?: string;
  closedAt?: string;
  expiredAt?: string;
  tradeId?: string;                     // OPEN 시 TradeRecord.id 연결
  // 평가
  realizedReturnPct?: number;
  schemaVersion: number;                // 1
}
```

### 2. State machine

```
                  (사용자 매수)
PENDING ──────────────────────────► OPEN
   │                                  │
   │                                  │ (사용자 매도)
   │                                  ▼
   │                                CLOSED
   │
   │ (30일 무액션, 자동)
   ▼
EXPIRED
```

전이 규칙:
- PENDING → OPEN: `markSnapshotOpen(stockCode, tradeId)` — TradeRecord 생성 시
  useTradeOps.recordTrade 가 호출.
- OPEN → CLOSED: `markSnapshotClosed(tradeId, returnPct)` — useTradeOps.closeTrade
  가 호출.
- PENDING → EXPIRED: `expireStaleSnapshots(now?)` — 30일 경과 PENDING 자동 전이.
  페이지 진입 시 또는 useStockSearch.fetchStocks 직전에 호출.
- EXPIRED → OPEN/CLOSED: 금지. 만료된 추천으로는 성과 추적 불가.
- 중복 capture 방지: 동일 stockCode 의 PENDING snapshot 이 이미 있으면 새
  capture 무시 (idempotent).

### 3. Storage

- zustand persist (`k-stock-recommendation-snapshots-store`)
- localStorage (현재 5MB 제한 내 — snapshot 1건 ~2KB × 1000건 = 2MB)
- 1000건 hard cap (FIFO trim) — PR-A 의 server attributionRepo 와 동일 정책
- 서버 영속은 본 PR scope 밖 (후속 PR 에서 추가 가능)

### 4. Wiring

- `src/services/quant/recommendationSnapshotRepo.ts` (신규) — CRUD + state machine
- `src/stores/useRecommendationSnapshotStore.ts` (신규) — zustand persist
- `src/hooks/useStockSearch.ts` — `fetchStocks` 완료 후 `captureSnapshots(diversified)`
  + `expireStaleSnapshots()` 호출
- `src/hooks/useTradeOps.ts` — `recordTrade` 가 `markSnapshotOpen(stockCode, tradeId)`
  호출, `closeTrade` 가 `markSnapshotClosed(tradeId, returnPct)` 호출
- `src/types/portfolio.ts` — `TradeRecord.recommendationSnapshotId?: string` 옵셔널 필드 추가

### 5. 통계 API

- `getSnapshotStats()` — 전체 lifecycle 카운트 + 등급별 hitRate
- `getRecentSnapshots(limit)` — UI 표시용 (limit 기본 50)
- 출력:
  ```ts
  interface SnapshotStats {
    totalCount: number;
    pendingCount: number;
    openCount: number;
    closedCount: number;
    expiredCount: number;
    // CLOSED 중 returnPct > 0 비율
    hitRate: number;
    // 등급별
    strongBuyHitRate: number;
    buyHitRate: number;
    avgReturnClosed: number;
    // Adoption rate: 추천 → OPEN 전환 비율
    adoptionRate: number;
  }
  ```

## 비결정 (out of scope)

- 시뮬레이션 평가 (PENDING/EXPIRED snapshot 의 가상 매수 가격 추적) → 후속 PR
- 서버 영속 (다기기 동기화) → 후속 PR
- AI/COMPUTED 차등 학습 가중치 → **PR-C**
- 손실 원인 자동 분류 → **PR-D**
- UI 적중률 패널 → 후속 PR (snapshot 통계가 노출 가치 있는 표본 도달 후)

## 회귀 위험

- LIVE 자동매매 무영향 (절대 규칙 #2/#3/#4 — 무수정).
- 기존 `useRecommendationStore.recommendationHistory` 호환 유지 — 신규 store
  와 별개로 운영.
- 신규 zustand persist key 라 기존 영속 데이터에 영향 없음.

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 12 케이스:
  - snapshotRepo CRUD 4 (capture / dedupe / markOpen / markClosed)
  - 상태 전이 4 (PENDING→OPEN / OPEN→CLOSED / PENDING→EXPIRED / EXPIRED→OPEN 거부)
  - 통계 4 (hitRate / strongBuyHitRate / adoptionRate / 빈 데이터)
