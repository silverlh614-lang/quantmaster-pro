# ADR-0166 — 레짐별 총 계좌 노출 예산 (positionSizingEngine 상위 계층)

**상태**: Accepted (Phase 2-D Exposure Budget — 신규 상위 계층, default OFF)
**날짜**: 2026-05-02
**관련 PR**: PR-Regime-Exposure-Budget
**의존성**: ADR-0161~0165 (Sizing Engine 5 ADR 시리즈)
**사용자 명시 프롬프트**: 7 레짐 매트릭스 + 3 함수 + 8 테스트 케이스 + UI 출력

## 1. 문제

ADR-0161~0165 의 `positionSizingEngine` 은 *개별 종목의 최종 매수금액* 을 계산. 하지만 실전 운용은 **개별 사이징보다 먼저 "현재 시장 레짐에서 계좌 전체를 얼마나 주식에 노출할 것인가"** 결정 의무. 사용자 명시:

> "이번 패치의 목적은 R1~R6 시장 레짐별로 총 주식 노출 목표/상한을 정의하고, 개별 종목 매수금액이 이 총 노출 예산을 초과하지 않도록 상위 레이어를 추가하는 것이다."

## 2. 결정

**`positionSizingEngine` 상위 계층** 신설 — `regimeExposurePolicy.ts` SSOT + 통합 진입점 `applyExposureBudgetCap`.

### 2.1 7 레짐 매트릭스 (사용자 §1 매트릭스 그대로)

| 레짐 | 라벨 | 목표 | 최대 | 최소 현금 | 신규 매수 | 추매 | multiplier |
|------|------|------|------|-----------|-----------|------|------------|
| **R0_CRISIS** | 위기장 | 0% | 5% | 95% | ❌ | ❌ | 0.0 |
| **R1_DEFENSIVE** | 보수적 접근 | 20% | 25% | 75% | ✅ | ❌ | 0.50 |
| **R2_WEAK** | 약세/불확실 | 30% | 35% | 65% | ✅ | ❌ | 0.65 |
| **R3_NEUTRAL** | 중립장 | 45% | 50% | 50% | ✅ | ✅ | 0.80 |
| **R4_RECOVERY** | 회복장 | 60% | 65% | 35% | ✅ | ✅ | 1.00 |
| **R5_BULL** | 상승장 | 75% | 80% | 20% | ✅ | ✅ | 1.10 |
| **R6_STRONG_BULL** | 강력한 상승장 | 85% | 90% | **10%** | ✅ | ✅ | 1.20 |

**핵심 원칙** (사용자 §8):
- R6 강력한 상승장도 **100% 몰빵 금지** — 10~20% 비상 현금 보존
- R1 보수장은 좋은 종목이 보여도 **20% 수준 제한**
- 종목 사이징은 *총 예산 안* 에서만 작동

### 2.2 신규 type — `MarketRegimeLevel` (R0~R6)

기존 `RegimeLevel` (`src/types/core.ts` R1_TURBO~R6_DEFENSE) 와 **역순 의미**:
- 기존: R1=강세 / R6=방어
- 사용자: R1=보수 / R6=강력한 상승장

따라서 별도 type 도입 + 매핑 함수:

```typescript
mapInternalToExposureRegime(R1_TURBO)   → R6_STRONG_BULL
mapInternalToExposureRegime(R2_BULL)    → R5_BULL
mapInternalToExposureRegime(R3_EARLY)   → R4_RECOVERY
mapInternalToExposureRegime(R4_NEUTRAL) → R3_NEUTRAL
mapInternalToExposureRegime(R5_CAUTION) → R2_WEAK
mapInternalToExposureRegime(R6_DEFENSE) → R0_CRISIS
```

R1_DEFENSIVE 매핑 부재 — 기존 시스템에 직접 매칭 없음. 향후 매크로 신호 기반 자동 분류 (별도 PR).

### 2.3 3 함수 SSOT (사용자 §2+§3)

- **`computePortfolioExposureBudget(input)`** — 7 레짐 정책 매트릭스 + 현재 보유 → 예산 산출 (`PortfolioExposureBudget`: target/max/minCash + remaining + isOverTarget/Max + multiplier)
- **`applyPortfolioExposureCap(params)`** — `rawPositionAmount × positionMultiplier` cap + 4 분기 차단 (신규 매수 금지 / 추매 금지 / 최대 한도 초과 / 정상 cap)
- **`applyExposureBudgetCap(input)`** — 통합 진입점 (호출자가 ENV/매핑 분기 없이 호출 가능)

### 2.4 wiring — 4 진입 경로 통합

`buyListLoop.ts` 3 곳 + `intradayLoop.ts` 1 곳, ADR-0163 패턴 그대로:

| 경로 | rawQuantity | isAddOnBuy |
|------|-------------|------------|
| 메인 buyList | `baseQuantity = sizingApply.applied ? sizingApply.quantity : legacyQuantity` | false (신규) |
| PRE_BREAKOUT_FOLLOWTHROUGH | `followQtyRaw = Math.ceil(fullQty × 0.7)` | false (추세) |
| PRE_BREAKOUT 30% 선취매 | `pbQtyRaw = Math.floor(fullPbQty × 0.3)` | false (선취매) |
| INTRADAY_STRONG | `baseIntradayQty = sizingApplyIntra.applied ? sizingApplyIntra.quantity : legacyIntradayQty` | false (장중) |

**비율 적용 *후* exposure cap** — 사용자 §4 "최종 매수금액에 cap" 정합. PRE_BREAKOUT 분기 70%/30% 비율은 호출자 측 보존, cap 은 *최종 quantity* 에 적용.

### 2.5 currentEquityExposureAmount 산출

본 PR 단순 추정: `Math.max(0, ctx.totalAssets - ctx.mutables.orderableCash.value)`. 정확한 계산 (활성 trade 평가금액 합산) 은 후속 PR 분리 (회귀 위험 격리).

## 3. ENV 우회

| ENV | Default | 효과 |
|-----|---------|------|
| `POSITION_SIZING_EXPOSURE_BUDGET_ENABLED` | OFF | `=true` 시 본 모듈 활성 (default OFF — 운영자 명시) |

**ADR-0162/0165 ENV 와 별도 정책** — 두 ENV 독립 활성화 가능. 운영자 단계별 검증 의도:
- Stage A: `_SHADOW_APPLY=true` SHADOW 검증 (ADR-0162)
- Stage B: `_LIVE_ENABLED=true` LIVE 활성화 (ADR-0165)
- Stage C: `_EXPOSURE_BUDGET_ENABLED=true` 노출 예산 통합 (ADR-0166, 본 PR)

## 4. 사용자 §7 8 테스트 케이스 (모두 검증)

| TC | 시나리오 | 기대 결과 |
|----|----------|-----------|
| 1 | R6 1000만 / 600만 보유 | 최대 추가 매수 300만 |
| 2 | R6 1000만 / 850만 (목표 도달) | 최대 50만까지 |
| 3 | R6 1000만 / 900만 (최대 도달) | 신규 매수 금지 |
| 4 | R1 1000만 / 100만 | 목표까지 100만, 최대까지 150만 |
| 5 | R1 1000만 / 250만 (최대 도달) | 신규 매수 금지 |
| 6 | R1 1000만 / 300만 (최대 초과) | 신규/추매 금지 + 리밸런싱 후보 |
| 7 | R0 어떤 계좌 | 신규/추매 전면 금지 |
| 8 | R5 5000만 / 3000만 | 최대 추가 매수 1000만 |

회귀 테스트 31 케이스 전부 PASS — 사용자 매트릭스 정확 정합.

## 5. LIVE 매매 영향 0 (default OFF)

ADR-0162 §6 4 보호층 + ADR-0166 추가 1 층:
- **`isExposureBudgetEnabled() === false` (default)** → `applyExposureBudgetCap` 진입부 즉시 `applied=false` + `rawQuantity` 그대로 → exposure cap 미적용 → ADR-0162~0165 동작 100% 보존

## 6. 잘못된 해결 방법 (영구 차단)

- ❌ 기존 `RegimeLevel` (R1_TURBO~R6_DEFENSE) 에 직접 사용자 매트릭스 매핑 — 의미 충돌 (R6 = 방어 vs 강력한 상승장).
- ❌ 비율 (70%/30%) *전* exposure cap 적용 — 사용자 §4 "최종 매수금액에 cap" 위반 + 비율 보존 의미 손실.
- ❌ `currentEquityExposureAmount` 정확한 산출 (활성 trade 평가금액 합산) 본 PR 통합 — 호출자 ctx 변경 + 회귀 위험. 후속 PR 분리.
- ❌ `applyPositionSizingEngine` 내부에 통합 — 단일 진입점 정책 위반 + 호출자가 ctx 추가 필드 (`currentEquityExposureAmount`) 의무 → 회귀 위험.

## 7. 운영자 활성화 절차

1. PR 머지 후 SHADOW 1주 검증 (`POSITION_SIZING_ENGINE_SHADOW_APPLY=true` 활성, exposure budget 비활성)
2. SHADOW 매매 누적 분석 → 만족 시 `POSITION_SIZING_EXPOSURE_BUDGET_ENABLED=true` 추가 활성화
3. SHADOW 1주 추가 검증 (exposure cap 활성, `[Sizing-ExposureBudget]` 진단 로그 분석)
4. LIVE 활성화 결정 시 `POSITION_SIZING_ENGINE_LIVE_ENABLED=true` (ADR-0165) 추가
5. 문제 발생 시 ENV `=false` 1줄 즉시 롤백

## 8. UI 출력 항목 (사용자 §6)

본 PR scope 외 — `PortfolioExposureBudget` 결과를 `applyExposureBudgetCap` result 에 포함하여 UI 호출자가 표시 가능. 실제 UI 변경은 후속 PR (Phase 3 UI Integration) 분리.

## 9. 잔여 후속 PR (PENDING_WIRING B9 신규)

본 PR = Phase A 인프라 + Phase B 4 wiring 통합 (default OFF). 후속:
- **PR-ExposureBudget-AccurateExposure** — `currentEquityExposureAmount` 정확 산출 (`ctx.shadows.reduce(활성 trade 평가금액 합산)`)
- **PR-ExposureBudget-AddOnBuyDetection** — `trancheExecutor` 등 추매 진입점에서 `isAddOnBuy=true` 명시 전달
- **PR-ExposureBudget-UI** — 사용자 §6 UI 출력 항목 통합 (Telegram 메시지 / 대시보드)
- **PR-ExposureBudget-AutoRegimeMapping** — 매크로 신호 기반 R0~R6 자동 분류 (현재 기존 RegimeLevel → 매핑 의존)

## 10. 핵심 설계 원칙 (사용자 §8)

> 최종 매수금액 =
> 개별 종목 적정 매수금액 (positionSizingEngine)
> ∩ 계좌 규모별 한도 (티어 매트릭스, ADR-0161)
> ∩ 손절 손실률 한도 (positionSizingEngine §11)
> ∩ **레짐별 총 주식 노출 예산 (ADR-0166, 본 PR)**

이 4 가지 교집합 안에서만 집행. 본 PR 이 마지막 ∩ (가장 상위 계층) 추가.
