# ADR 0025 — 사용자 수동 lossReason 입력 헬퍼 (PR-H)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0021 (PR-D) · ADR-0022 (PR-E)

## 배경

PR-D 의 `classifyLossReason` 은 4 분기만 자동 분류 — 나머지 4 분류
(FALSE_BREAKOUT / SECTOR_ROTATION_OUT / EARNINGS_MISS / LIQUIDITY_TRAP) 은
다중 trade 분석 또는 외부 데이터 필요로 사용자 수동 입력이 필요했다. PR-D
wiring 은 `lossReasonAuto=false` 사용자 수동 입력 시 자동 분류가 덮어쓰지
않도록 보호 가드만 두었지만, 실제 사용자 입력 인터페이스 (store API + 헬퍼)
가 부재.

## 결정

useTradeStore + useTradeOps 에 `setLossReason(tradeId, reason)` API 추가.

### 1. useTradeStore.setLossReason

```ts
setLossReason: (tradeId: string, reason: LossReason | null) => void;
```

- `reason !== null` → `lossReason=reason, lossReasonAuto=false, lossReasonClassifiedAt=now`
- `reason === null` → 사용자 수동 분류 해제 → 다음 분류 시 자동 분류 가능 (PR-D 가드 해제)

### 2. UI 컴포넌트는 본 PR scope 밖

본 PR 은 store API 만 추가. 실제 dropdown UI 는 후속 별도 PR (TradeJournal
페이지 수정).

### 3. 회귀 테스트

- setLossReason 신규 API 동작 검증 (set / clear)
- closeTrade 후 사용자가 setLossReason 호출 시 자동 분류 덮어쓰기 차단
- LossReason 8 종 + UNCLASSIFIED 모두 입력 가능
