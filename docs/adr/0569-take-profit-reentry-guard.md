# ADR-0569: take profit reentry guard

@responsibility trading — take profit reentry guard

## Status

Accepted

## Context

Shadow 모드 관찰에서 **익절 전량청산 직후 동일 종목 재매수**가 확인됐다(예: 네이처셀
007390 익절 매도 → 직후 재매수). 매도 이유(차익실현/과열/RRR소진)를 스스로 무효화하는
모순이며, live 진입 전 반드시 교정 대상이다.

근본원인: 재진입을 막는 가드가 두 종뿐이었다 —
- `checkManualExitCooldown`(buyPipeline) = **수동** 청산(`/sell`) 72h 한정(manualExitsRepo).
- cascadeFinal 180일 재진입 금지 = **손실** cascade 청산 한정.

익절 규칙 5종(bearishDivergence·euphoria·rrrCollapse·legacyTakeProfit·trancheTakeProfit)은
전부 `placeReservedSellOrder(..., 'TAKE_PROFIT'|'EUPHORIA')` 인데 **재진입 기록을 남기지
않았다**. 따라서 익절 전량청산은 수동 아님(72h 미적용) + 손실 아님(180일 미적용) →
스캐너가 동일 종목을 재평가해 게이트 통과하면 즉시 재매수. 청산엔진과 진입엔진이 서로
모르는 구조적 핑퐁.

## Decision

`TAKE_PROFIT_REENTRY_GUARD_ENABLED`(default OFF) 플래그로 **조건부 재진입 가드**를 신설한다.
영구 차단이 아니라 시간 무관 조건부 — 진짜 새 셋업만 통과한다.

- **barrier stamp**(reserveSell 단일 choke): `placeReservedSellOrder` 가 익절 사유
  (`TAKE_PROFIT`/`EUPHORIA`) + 전량청산(`remainingQty===0`) 시 신규
  `takeProfitExitsRepo`(월 JSONL)에 `{exitPrice, exitGateScore, exitReturnPct, exitReason,
  exitAt}` 기록. 익절 5종을 한 곳에서 커버. 손실(STOP_LOSS)·부분 트림은 제외.
- **재매수 check**(buyPipeline): `checkManualExitCooldown` 다음에
  `checkTakeProfitReentryGuard(code, currentPrice, gateScore)`. 최근(≤90일) 익절 barrier가
  있으면 아래 중 하나 충족 시에만 허용, 아니면 차단(텔레그램 ORDER_REJECTED):
  - 가격: `currentPrice ≥ exitPrice × 1.05` (청산가 **+5%** 재돌파)
  - 게이트: `currentGateScore ≥ exitGateScore + 1` (청산 진입보다 **+1 상향**)
- **entryGateScore stamp**: `ServerShadowTrade.entryGateScore` 신설, buyPipeline 이 매수 시점
  `p.gateScore` 를 포지션에 stamp(게이트 조건의 exitGateScore 기준). flag ON 시에만.

SSOT: `takeProfitReentryGuard.ts`(flag+판정), `takeProfitExitsRepo.ts`(persistence).

## Consequences

- **default OFF = byte-identical**: 하나의 플래그가 stamp·check·entryGateScore 세 터치포인트를
  동시에 gate. OFF 면 barrier 미기록 + 재진입 미검사 + entryGateScore 미stamp → 현행 불변.
  단위 테스트 12종(가격/게이트 조건·전량/부분·익절/손실·flag OFF)이 잠근다.
- **ON 시 executionImpact**: 익절 후 조건 미충족 재매수가 차단된다(매수 결정 변화 — 의도).
  live 진입 전 이 가드를 ON 하는 것이 목표.
- **레거시 포지션**: entryGateScore 미stamp(undefined) → 게이트 조건 평가불가 → 가격 조건만
  작동(graceful degradation). flag ON 이후 진입분부터 게이트 조건 완전 작동.
- **LIVE provisional revert 엣지**: LIVE 전량청산이 PROVISIONAL→REVERT 되면 barrier 가 남되
  포지션은 보유 상태 → 재매수 자체가 안 일어나므로 차단은 무해. (현재 활성 경로는 SHADOW.)
- 활성화: ENV `TAKE_PROFIT_REENTRY_GUARD_ENABLED=true`. 임계 상수(가격 5%/게이트 1/lookback
  90일)는 guard 모듈 export.

## Guardrails

- No live trading path change while flag OFF (default). 실주문/Kelly/Shadow 무변.
- **Buy decision change is intentional and flag-gated**: ON 시 익절 후 조건 미충족 재매수만
  차단. 청산엔진 로직·기존 가드(수동 72h·손실 180일)는 무변경.
- No KIS/order import added — barrier 는 기존 매도 완료 결과(remainingQty)만 읽는다.
- No provider fetch behavior change. 신규 fetch 0.
- No data promotion behavior change.
