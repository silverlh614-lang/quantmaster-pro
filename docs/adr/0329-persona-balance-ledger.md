# ADR-0329: 페르소나 매수/매도 균형 ledger (Phase 1 — pure classifier)

**Status**: Accepted (Phase 1 — pure classifier, cron wiring 후속 PR)
**Date**: 2026-05-06

## 배경

사용자 5/6 명시 — 페르소나 원칙 2 (`매수보다 매도 우선`) 가 너무 강하게 적용되어 매수가 거의 안 되는 상태인지 자동 검증. 시스템이 자기 자신의 균형 자가 검증.

## 결정

### Phase 1 (본 PR scope) — pure classifier만

**적용**:
1. `server/learning/personaBalanceLedger.ts` SSOT 신규
2. `classifyPersonaBalance(input)` 4 카운트 입력 → 5 분기 분류
3. ENV `PERSONA_BALANCE_LEDGER_DISABLED=true` 우회
4. **데이터 수집 함수 미수행** — 사용자 spec `calculateBuyConversionRate` / `calculateSellConversionRate` 는 후속 PR (scanTracer + shadowTrade 통합 wiring)

**임계 SSOT**:
- `PERSONA_MIN_EVAL_SAMPLE = 30` (통계 신뢰도)
- `OVER_CONSERVATIVE_BUY_RATE = 0.02` (매수 전환률 < 2%)
- `OVER_CONSERVATIVE_SELL_RATE = 0.5` (매도 우세 임계)
- `OVER_AGGRESSIVE_SELL_RATE = 0.8` (매도 과도 임계)

**5 분기 분류**:
1. ENV DISABLED → `DISABLED`
2. 표본 < 30 → `INSUFFICIENT_SAMPLE`
3. buy < 0.02 AND sell > 0.5 → `OVER_CONSERVATIVE_BUY` (매수 거의 차단)
4. sell > 0.8 → `OVER_AGGRESSIVE_SELL` (매도 지나치게 잦음)
5. 그 외 → `HEALTHY` (페르소나 정상 작동, 매도 우세 포함)

### 안전 invariant

- LIVE 매매 본체 0줄 변경 (read-only 분석)
- 호출자 0건 (Phase 1 dead code)
- ENV 1줄 즉시 롤백
- divide-by-zero 안전 (denom=0/NaN/Infinity → rate=0)
- 음수 numerator 안전 fallback

## 잘못된 해결 방법 영구 차단

1. **`calculateBuyConversionRate`/`calculateSellConversionRate` 본 PR 통합** — 데이터 수집 인프라 부재 (scanTracer + shadowTrade 통합), 후속 PR 분리.
2. **cron + 텔레그램 본 PR** — Phase 1 정책.
3. **HEALTHY 임계 ENV 노출** — 정적 SSOT 보존.
4. **ADR-0326 (강세장 게이트 단축) 자동 트리거** — 운영자 검토 의무, 본 ledger 는 *진단* 만.
5. **buyEvaluations 정의를 scanTrace 외부 출처로 확장** — 단일 출처 (scanTracer) 정책.

## 페르소나 원칙 정합

페르소나 원칙은 *매도 > 매수* 가 정상. 본 분류기는 그 비율이 **극단적인 경우만** 시스템 결함으로 분류:
- HEALTHY = buy 5% + sell 40% 같은 정상 매도 우세 포함
- OVER_CONSERVATIVE_BUY = buy < 2% AND sell > 50% (극단)
- OVER_AGGRESSIVE_SELL = sell > 80% (매도 자체 과도)
