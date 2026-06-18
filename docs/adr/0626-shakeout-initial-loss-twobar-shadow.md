# ADR-0626 — Shakeout Initial-Loss Two-Bar Confirmation (shadow-only)

- **Status**: Proposed (Phase 0 — 경계·타입·ADR. ENV default OFF, LIVE byte-equivalent. 구현 engine-dev.)
- **Date**: 2026-06-18
- **Authors**: engine-dev (architect 설계 SSOT `_workspace/2026-06-18_shakeout-DA-package/architect/design.md` §2 직접 반영)
- **Series**: 진단 `_workspace/2026-06-18_shakeout-stoploss-diagnosis/diagnosis.md` 옵션 A. Two-Bar Confirmation(ADR-0085) 정책 함수 재사용·BEP_TWO_BAR_LIVE_ENABLED(ADR 기존 BEP ENV) 보존.

## 핵심 문장

> *"진입 직후 손실 초기 손절(INITIAL/REGIME)에도 wick 즉시청산 대신 2-bar 종가확인을 적용한다. 단 SHADOW 한정·얕은하락 한정. LIVE 는 절대 우회 안 함(byte-identical). 깊은하락(≤-12%)은 즉시 손절 유지. 기본 OFF."*

## 배경

2-bar 종가확인(ADR-0085)이 `isBepProtection === (stopLossExitType==='PROFIT_PROTECTION')` 일 때만 작동(`twoBarBepGate.ts`) → 진입 직후 손실 구간(INITIAL/REGIME) 손절은 wick 즉시청산(진단 Q5·근본원인 #4). "전일 진입 → 익일 급락 wick → 고정 -5% 손절 → 종가 회복" 경로가 정확히 사각지대.

## 결정

1. **seam 위치** — `hardStopLoss.ts` 의 `applyTwoBarBepGate(...)` 호출. 확대 게이트를 `twoBarBepGate.ts` 내부에 신설 (hardStopLoss 호출부는 `stopLossExitType`·`returnPct` 2 인자 추가만, 본체·기존 분기 불변).
2. **신규 ENV SSOT** `isInitialLossTwoBarShadowEnabled()` (twoBarBepGate.ts 거주) = `process.env.SHAKEOUT_INITIAL_LOSS_TWOBAR_SHADOW_ENABLED === 'true'` 정확 비교(ADR-0157), **default OFF**.
3. **확대 적용 조건 (4개 모두 참일 때만 2-bar 적용)**:
   - (a) ENV ON, **그리고**
   - (b) `getTradingMode() !== 'LIVE'` — **LIVE 는 절대 우회 안 함**(byte-equivalent·불변식 #8), **그리고**
   - (c) `stopLossExitType ∈ {INITIAL, REGIME, INITIAL_AND_REGIME}`(손실 초기·PROFIT_PROTECTION 아님), **그리고**
   - (d) 깊은하락 보호장치 미발동: `returnPct > SHAKEOUT_INITIAL_LOSS_DEEP_DROP_BYPASS_PCT`(상수 **-12.0%**, 본문 SSOT). `returnPct <= -12%` 또는 `returnPct` 부재/비정상 → 우회(SKIP)·기존 wick 즉시 손절 유지.
4. **결정 트리 (applyTwoBarBepGate 재구조화)**:
   1. `BEP_PROTECTION_DISABLED=true` → SKIP (기존, 불변).
   2. `isBepProtection=true` → 기존 BEP 2-bar 경로 (`BEP_TWO_BAR_LIVE_ENABLED`·기존 동작 100% 보존).
   3. `isBepProtection=false` 이고 손실초기 확대 조건(a∧b∧c∧d) 충족 → 신규 INITIAL_LOSS 2-bar 경로 (`evaluateTwoBarConfirmation({isBepProtection:true})` 정책 함수 재사용·SHADOW 한정).
   4. 그 외 → SKIP (=기존 즉시 청산, byte-equivalent).
5. **`evaluateTwoBarConfirmation` 재사용** — 정책 함수(`twoBarConfirmation.ts`)는 **0줄 변경**. 확대 경로는 호출 시 `isBepProtection: true` 전달(손실초기 게이트가 SHADOW·INITIAL·얕은하락을 통과시킨 뒤 "2-bar 적용 영역") → 정책함수 결정트리 그대로 재사용·두 번째 2-bar 산식 신설 0.
6. **shadow update 영속** — 1차 터치 `bepGlideTouchAt` 재사용(기존 필드). 손실초기·BEP 둘 다 같은 봉카운트 의미라 필드 공유 안전(stopLossExitType 으로 상호배타). 신규 영속 필드 0.

## 진짜 추세반전 보호장치

- **깊은하락 우회** (조건 d): `returnPct <= -12%` 면 2-bar 우회·즉시 손절 — 셰이크아웃 완충이 손실확대로 변질되는 것을 차단. 임계 `SHAKEOUT_INITIAL_LOSS_DEEP_DROP_BYPASS_PCT = -12.0` (본문 SSOT).
- **SHADOW 한정** (조건 b): LIVE PnL 0 영향. 효과 검증(ADR-0625 라벨러로 SHADOW 회피율 vs 손실확대) 후에만 운영자 승인 LIVE(별도 PR·범위 밖).
- **Entry Circuit Breaker / atrDynamicStop 무간섭**: 본 게이트는 `hardStopLoss` 규칙 내부에서만 작동·직교.

## 9대 불변식 준수

- **#1 Trading Engine 무중단** — 신규 분기는 순수 함수(throw 없음)·기존 try/catch 흐름 안.
- **#2 Shadow 무중단** — SHADOW 청산을 *지연*(2-bar 대기)할 뿐 차단 아님.
- **#8 실거래/Shadow 분리** — LIVE 는 조건 (b)에서 항상 false → 신규 경로 진입 불가 → 기존 wick 즉시손절 100% 보존.

## byte-equivalent 매트릭스

| 상태 | LIVE 경로 | SHADOW 경로 |
|------|----------|-------------|
| ENV OFF (default) | wick 즉시손절 (기존) | wick 즉시손절 (기존) — **byte-identical** |
| ENV ON | wick 즉시손절 (조건 b=false, **byte-identical**) | INITIAL/REGIME·얕은하락 → 2-bar 대기 / 깊은하락(≤-12%) → 즉시손절 / BEP → 기존 BEP 2-bar |

**LIVE 본체 0줄 의미변경**: ENV ON 이어도 LIVE 는 조건 (b) `getTradingMode()!=='LIVE'` 에서 차단 → `applyTwoBarBepGate` 반환이 기존(SKIP/CONTINUE_EXIT)과 동일 → `hardStopLoss` 청산 흐름 byte-identical. ENV OFF = 1줄 즉시 롤백.

## 타입 (additive)

`TwoBarBepGateInput` 에 `stopLossExitType?`·`returnPct?` (optional additive·기존 `isBepProtection` 보존). `ServerShadowTrade` 신규 필드 0 (`bepGlideTouchAt` 재사용). `src/types/` 무수정 — exit 정책은 server 도메인. 상수 SSOT: `SHAKEOUT_INITIAL_LOSS_DEEP_DROP_BYPASS_PCT = -12.0` (twoBarBepGate export).

## Alternatives

- (a) `twoBarConfirmation.ts` 정책 함수에 신규 분기 추가 기각 — 정책함수 재사용(`isBepProtection:true`)로 두 번째 산식 0·정책함수 0줄.
- (b) LIVE 포함 확대 기각 — byte-equivalent·SHADOW 검증 선행(불변식 #8).
- (c) default ON 기각 — opt-in·운영자 명시 활성화.
- (d) 깊은하락 우회 없이 전 손실 2-bar 기각 — 진짜 추세반전 손실확대 위험.

계보 0085 / 0157 / 0079 / 0112 / 0146.
