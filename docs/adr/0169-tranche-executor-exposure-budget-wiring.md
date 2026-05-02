# ADR-0169 — trancheExecutor 추매 진입점 노출 예산 cap wiring (audit-PR-520 §M2 수리)

**상태**: Accepted (audit-PR-520 §M2 직접 수리 — 추매 정책 활성화)
**날짜**: 2026-05-02
**관련 PR**: PR-ExposureBudget-AddOnBuyDetection
**의존성**: ADR-0166 (레짐 노출 예산), ADR-0167 (currentEquityExposureAmount 정확 산출), audit-PR-520 §M2
**Audit-PR-520 §M2 추적성**: 본 PR 이 audit-PR-520 의 M2 (`isAddOnBuy=false` 4 wiring 모두 고정) 직속 수리

## 1. 문제

ADR-0166 §"잘못된 해결 방법" 명시: *"4 wiring 모두 isAddOnBuy=false 고정 — R3+ 추매 허용 정책 미활성화"*. audit-PR-520 §M2 가 본 결함을 P2 로 분류.

기존 4 wiring (buyListLoop 3 + intradayLoop 1) 은 *신규 매수* 진입 경로라 `isAddOnBuy=false` 가 의미적으로 정확. **트랜치 (3일/7일 후 추매) 는 진정한 *추매* 인데 wiring 부재 → R3+ 레짐의 추매 허용 정책 (`allowAddOnBuys=true`) 영원히 미활성화.**

기존 결함:
- `regimeExposurePolicy.ts` 의 `R3_PULLBACK` / `R4_NEUTRAL` / `R5_RECOVERY` / `R6_STRONG_BULL` 4 레짐의 `allowAddOnBuys=true` 정책이 코드 매트릭스에만 존재
- 트랜치 진입점이 노출 예산 cap 자체를 거치지 않아 R0_CRISIS / R1_DEFENSIVE 의 `allowAddOnBuys=false` 차단 효과도 부재
- `applyPortfolioExposureCap` 의 `isAddOnBuy` 분기 로직이 dead path

## 2. 결정

### 2.1 `trancheExecutor.checkPendingTranches` LIVE 주문 직전 wiring

승인 통과 (`requestBuyApproval` APPROVE) 후, LIVE 주문 (`if (isLive) kisPost(...)`) 직전에 `applyExposureBudgetCap` 호출:

```typescript
const exposureCap = applyExposureBudgetCap({
  rawQuantity: t.quantity,
  shadowEntryPrice: currentPrice,
  accountEquity: totalAssets,
  currentEquityExposureAmount,
  currentCashAmount: orderableCash,
  regime: currentRegime,
  isAddOnBuy: true,          // ← M2 핵심: 추매 정책 활성화
});
```

### 2.2 함수 진입부 1회 잔고 fetch + 캐싱 (batch 처리)

`checkPendingTranches` 는 다중 트랜치 batch 처리이므로 잔고 fetch 를 *함수 진입부* 에서 1회만 수행:

```typescript
const allShadows = loadShadowTrades();    // shadowsById 산출에 이미 사용
let totalAssets = 0;
let orderableCash = 0;
if (isLive) {
  const balance = await fetchAccountBalance().catch(() => null);
  totalAssets = Number(process.env.AUTO_TRADE_ASSETS || 0) || (balance ?? 30_000_000);
  orderableCash = balance ?? totalAssets;
} else {
  const settings = loadTradingSettings();
  const startingCapital = Number(process.env.AUTO_TRADE_ASSETS || settings.startingCapital);
  const account = computeShadowAccount(allShadows, startingCapital);
  totalAssets = account.totalAssets;
  orderableCash = Math.max(0, account.cashBalance);
}
const currentEquityExposureAmount = resolveCurrentEquityExposure(totalAssets, orderableCash, allShadows);
```

ADR-0167 의 `resolveCurrentEquityExposure` SSOT 사용 — 4 wiring (buyListLoop + intradayLoop) 와 동일 단일 진입점.

### 2.3 cap 결과 3 분기

```typescript
const cappedQty = exposureCap.applied
  ? Math.min(exposureCap.finalQuantity, t.quantity)
  : t.quantity;
```

- **(a) 차단** `cappedQty <= 0` → 트랜치 cancel + Telegram 알림 (`continue` 다음 트랜치)
- **(b) 축소** `0 < cappedQty < t.quantity` → `t.quantity = cappedQty` + Telegram 알림 + 진행
- **(c) 통과** `cappedQty >= t.quantity` → 그대로 진행 (정상 흐름, 알림 없음)

`Math.min(exposureCap.finalQuantity, t.quantity)` — cap 결과가 t.quantity 보다 큰 경우 (확장) 는 의미 없음. 트랜치는 *축소* 만 의미.

### 2.4 SHADOW vs LIVE 동일 wiring (학습 데이터 누적)

cap 적용은 SHADOW + LIVE 모두. SHADOW 는 LIVE 주문 미실행이지만 (`if (isLive)` 분기), cap 결과로 `t.quantity` 가 축소되면 *학습 데이터* (Shadow 영속) 에도 정합 반영. 추매 정책의 효과를 SHADOW 로 사전 검증 가능.

### 2.5 회귀 위험 격리

본 wiring 은 ENV `POSITION_SIZING_EXPOSURE_BUDGET_ENABLED=true` 활성 시에만 작동 (ADR-0166 정합):
- ENV OFF (default) → `exposureCap.applied=false` → `cappedQty = t.quantity` → 기존 동작 100% 보존
- 정상 cap 통과 (`cappedQty >= t.quantity`) → `t.quantity` 무변경 → byte-equivalent
- 차단/축소 → 의도된 cap 효과 (운영자 ENV 명시 활성화 의무)

## 3. LIVE 매매 영향 — 의도된 변경

본 PR 은 **추매 정책 활성화** — ENV ON 시:
- R0_CRISIS / R1_DEFENSIVE → `allowAddOnBuys=false` → 모든 추매 차단 (자본 보호)
- R3_PULLBACK / R4_NEUTRAL → 노출 예산 한도 안에서 추매 허용 (정상 운영)
- R5_RECOVERY / R6_STRONG_BULL → 추매 허용 + 노출 한도 격상

ENV OFF (default) 시 ADR-0166 동작 100% 보존 — 트랜치 자체가 cap 거치지 않던 상태와 동일.

## 4. 회귀 테스트

`trancheExecutorAdr0166Wiring.test.ts` 18 케이스:
- 정적 grep 가드 15 (4 import 정합 + 잔고 fetch 분기 / cap 호출 / `isAddOnBuy=true` 명시 / `isAddOnBuy=false` 부재 / cap 결과 3 분기 / Telegram 2 알림 / ADR 추적 주석 2)
- 호출 위치 정합 3 (승인 후 / LIVE 주문 직전 / `t.quantity` LIVE 주문 자연 반영)

## 5. 잘못된 해결 방법 (영구 차단)

- ❌ `isAddOnBuy=false` 전달 — audit M2 의도 위반. **반드시 true 명시**.
- ❌ 잔고 fetch 트랜치별 반복 — KIS 호출 빈도 ↑ + batch 비효율. **함수 진입부 1회 fetch**.
- ❌ `currentEquityExposureAmount = totalAssets - orderableCash` 단순 추정 — ADR-0167 정합 위반. **`resolveCurrentEquityExposure` SSOT 사용**.
- ❌ cap 결과 무시 (warning 만 로깅) — 정책 비활성화. **차단/축소 분기 의무 적용**.
- ❌ `if (isLive)` 분기 안 cap 호출 — SHADOW 학습 데이터 누락. **분기 외부 위치**.

## 6. audit-PR-520 §M2 추적성 (audit 학습 데이터)

audit-PR-520 §M2 (`isAddOnBuy=false` 4 wiring 모두 고정) → **본 PR 으로 수리 완료**. 다음 audit (PR #530 예정) 시 M2 항목이 *수리 완료* 로 추적 가능.

ADR-0146 §"audit findings 가 학습 데이터" 정합 — audit → 수리 PR 사이클 **세 번째 사례** (첫 번째: ADR-0167 §M1, 두 번째: ADR-0168 §M3, 세 번째: 본 PR §M2).

audit-PR-520 잔여 P2 1건 — M4 (R0~R6 매크로 신호 자동 분류) 만 후속 PR 분리 진행 예정.

## 7. PENDING_WIRING B9 갱신

ADR-0166 의 PENDING_WIRING B9 잔여 PR:
- ~~PR-ExposureBudget-AccurateExposure (M1)~~ ← **ADR-0167 완료**
- ~~PR-ExposureBudget-AddOnBuyDetection (M2)~~ ← **본 PR 완료**
- PR-ExposureBudget-AutoRegimeMapping (M4): 매크로 신호 R0~R6 자동 분류
- PR-ExposureBudget-CurrentPriceMap: KIS 시가 매핑 SSOT (ADR-0167 §2.2 후속)
- PR-ExposureBudget-UI: 사용자 §6 UI 출력 항목

잔여 5 → 3 감소 (M1 + M2 완료).
