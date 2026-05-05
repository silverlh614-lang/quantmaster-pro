# ADR-0186: Order Type Optimizer Wiring — Phase 1 (의사결정 가시화)

## Status
Accepted (PR-A2-Wiring-1)

## Context
ADR-0031 (PR-O) 가 `server/trading/orderTypeOptimizer.ts` SSOT (`decideOrderType` + `requiresUnsafeIdempotency`) + `server/persistence/slippageHistoryRepo.ts` 영속 SSOT (`recordSlippageEntry` + `getSlippageStats`) 를 신설했지만 LIVE 매매 호출자 0건 dead code 상태. 사용자 명시 *천재 아이디어 #8* (변환률 향상 — *"강한 돌파에서 limit 미체결로 다음날 갭업당하던 알파 누수"* 차단) 의 인프라.

PENDING_WIRING A2 P1 (SLA 만기 2026-06-16) 등재 항목 — `entryEngine` 의사결정 + `fillMonitor` 슬리피지 영속 wiring 잔여.

scope 분할 정책 (ADR-0146 회귀 위험 격리 정합):
- **본 PR (A2-Wiring-1)**: 의사결정 가시화만 — `buyPipeline.createBuyTask` 진입부에서 `decideOrderType` 호출 + 결과 영속 + 진단 로그. **실제 placeKisMarketBuyOrder 호출 시 orderType 무변경** (LIMIT 그대로). LIVE 매매 본체 영향 0.
- 후속 PR (A2-Wiring-2): `fillMonitor` 체결 시 `recordSlippageEntry` 호출 — 학습 데이터 수집.
- 후속 PR (A2-Wiring-3): LIVE 적용 — IOC_MARKET 사용 시 `idempotency='unsafe'` (ADR-0014 정합) + AGGRESSIVE_LIMIT chase logic.

## Decision

### Wiring — buyPipeline.createBuyTask 진입부

`createBuyTask(p)` 내 KRX code 가드 (ADR-0185 site 3) *직후*, manual exit cooldown 가드 *이전* 위치에 다음 추가:

1. ENV `ORDER_TYPE_OPTIMIZER_ENABLED=true` 명시 시에만 `decideOrderType({stockCode, volumeZ, priceMomentumPct})` 호출.
2. 결과를 `p.trade.orderTypeDecision` 옵셔널 필드 (orderType / reason / limitOffsetTicks? / chasePolicy? / decidedAt) 로 영속.
3. 진단 로그 — `console.log('[OrderTypeOptimizer] {stockName}({stockCode}) → IOC_MARKET — {reason} (ADR-0186, SHADOW-only 가시화)')`.
4. try/catch 격리 — `decideOrderType` throw 시 매수 흐름 차단 안 함, console.warn 로그만.

### CreateBuyTaskParams 옵셔널 입력 2종

- `volumeZ?: number` — 신호 시점 거래량 z-score
- `priceMomentumPct?: number` — 신호 시점 가격 모멘텀 (% 변화)

미전달 시 `decideOrderType` 내부에서 0 fallback (LIMIT 결정으로 자연 분기). 호출자가 신호 컨텍스트에서 산출 가능한 경우만 주입 권장.

### ServerShadowTrade.orderTypeDecision? 옵셔널 영속 schema

```ts
orderTypeDecision?: {
  orderType: 'IOC_MARKET' | 'LIMIT' | 'AGGRESSIVE_LIMIT';
  reason: string;
  limitOffsetTicks?: number;
  chasePolicy?: { waitSeconds: number; priceDeltaPct: number };
  decidedAt: string;
};
```

운영자 SHADOW 1주 검증 — orderType 분포 (IOC_MARKET / LIMIT / AGGRESSIVE_LIMIT) + reason 빈도 누적 후 LIVE 활성화 결정 입력.

### ENV 헬퍼 SSOT 신규 (orderTypeOptimizer.ts)

```ts
export function isOrderTypeOptimizerEnabled(): boolean {
  return process.env.ORDER_TYPE_OPTIMIZER_ENABLED === 'true';
}
```

호출자 0건 inline ENV 검사 → SSOT 위임. ADR-0157 정확 비교 (`=== 'true'`) 의무 정합.

ENV `ORDER_TYPE_OPTIMIZER_ENABLED` **default OFF** — 본 PR 머지 직후 코드베이스 동작 100% 보존. 운영자 SHADOW 1주 검증 후 후속 PR (A2-Wiring-2/-3) 진행 결정.

## Consequences

### LIVE 매매 영향

**LIVE 매매 본체 영향 0** — 본 PR 은 *의사결정 가시화* 만:
- `decideOrderType` 결과는 `p.trade.orderTypeDecision` 영속 + 진단 로그만.
- 실제 `placeKisMarketBuyOrder` 호출 시 orderType (LIMIT) **무변경**.
- IOC_MARKET 결정 났어도 LIMIT 으로 호출 → ADR-0014 idempotency 무관.
- AGGRESSIVE_LIMIT 결정 + chase policy 영속만 — 실제 chase 호출 0건.

ENV default OFF 시 wiring 자체 비활성 → SHADOW 도 영향 0.

### 후속 PR 의존

- A2-Wiring-2: `fillMonitor` 체결 confirm 시점에 `recordSlippageEntry` 호출. SHADOW + LIVE 모두 영속 (의사결정 변경 없는 학습 데이터 수집).
- A2-Wiring-3: LIVE 적용. IOC_MARKET 사용 시 `kisPost` 호출에 `idempotency: 'unsafe'` 명시 (ADR-0014 §"재시도 안전성"). AGGRESSIVE_LIMIT 의 경우 `placeKisMarketBuyOrder` → `placeKisLimitOrder(price=best_bid+N tick)` + 60초 chase logic 추가.

### 운영자 활성화 절차

1. 본 PR 머지 후 ENV `ORDER_TYPE_OPTIMIZER_ENABLED=true` 운영 환경 설정.
2. 1주 SHADOW 검증 — `data/shadow-trades.json` 의 `orderTypeDecision` 영속 분포 분석:
   - IOC_MARKET 빈도 (강한 돌파 신호 비율)
   - AGGRESSIVE_LIMIT 빈도 (학습된 슬리피지 ≥ 0.5% 종목 비율)
   - LIMIT default 빈도 (보통 케이스)
3. 분포 합리적이면 후속 PR (A2-Wiring-2: slippage 영속) 진입.
4. slippage 영속 누적 1~2주 후 후속 PR (A2-Wiring-3: LIVE 적용) 진입.
5. 문제 시 ENV `=false` 1줄 즉시 롤백.

## Rollback

ENV 우회 — `ORDER_TYPE_OPTIMIZER_ENABLED=false` (default) 또는 미설정. 즉시 의사결정 호출 0건으로 복원.

코드 레벨 롤백은 `buyPipeline.ts` 의 `if (isOrderTypeOptimizerEnabled())` 블록 제거 + import 2종 + `CreateBuyTaskParams` 옵셔널 2 필드 + `ServerShadowTrade.orderTypeDecision?` 옵셔널 필드 제거. additive 패턴.

## 잘못된 해결 방법 영구 차단

1. **본 PR 에서 placeKisMarketBuyOrder 호출 시 orderType 변경** — LIVE 매매 본체 변경. 회귀 위험 ↑. A2-Wiring-3 별도 PR.
2. **ENV default ON** — SHADOW 검증 없이 영속 시작. 운영자 결정 위임.
3. **호출자 측 inline ENV 검사** — drift 위험. SSOT 헬퍼 위임 의무.
4. **decideOrderType throw 가 매수 흐름 차단** — try/catch 격리 의무 (ADR-0185 패턴 정합).
5. **fillMonitor wiring 본 PR 통합** — 회귀 위험. A2-Wiring-2 별도 PR.
6. **CreateBuyTaskParams 의 volumeZ/priceMomentumPct 필수화** — 호출자 측 신호 컨텍스트 영속 부담. 옵셔널 + 미전달 시 fallback 의무.

## References

- ADR-0031 Order Type Optimizer (모듈 신설)
- ADR-0014 KIS retry safety policy (idempotency='unsafe' 정합)
- ADR-0146 PR 자가 review 5 카테고리 정합
- ADR-0157 ENV `=== 'true'` 정확 비교 의무
- ADR-0185 PR-B12-B (try/catch 격리 + 호출자 SSOT 위임 패턴 정합)
- PENDING_WIRING A2 P1 (SLA 만기 2026-06-16)
