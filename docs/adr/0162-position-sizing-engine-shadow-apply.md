# ADR-0162 — Phase 2-D: SHADOW only 사이징 엔진 wiring (옵션 D)

**상태**: Accepted (Phase 2-D — SHADOW 적용 + 학습 marker 분리, LIVE 회귀 위험 격리)
**날짜**: 2026-05-02
**관련 PR**: PR-Sizing-Engine-Phase2D (`buyListLoop.ts` 메인 buyList wiring + ENV 우회 + sizingSource marker)
**의존성**: ADR-0161 (Phase 1 인프라) — `server/trading/sizing/` 8 파일 SSOT
**SLA 충족**: ADR-0161 §"Phase 2 결정 사항" P0 SLA 21일 (만기 2026-05-23) 정합

## 1. 문제

ADR-0161 Phase 1 가 6 티어 × 7축 통합 결정 SSOT (`computeFinalPosition`) 를 신설했지만 **호출자 0건 = dead code 영속**. Phase 2 wiring 결정 옵션 (A/B/C) 모두 결함:

| 옵션 | 결함 |
|------|------|
| A. 전체 교체 (LIVE+SHADOW 모두) | ADR-0161 §7 *잘못된 해결 방법* — 기존 SSOT 6+ 모듈 누적 운영 검증 손실 |
| B. 병렬 결정 (min/max 결합) | 두 결정 동시 작동 시 *추적성 ↓* — 어느 SSOT 가 매수금액 결정했는지 불명확 + 회귀 테스트 분산 |
| C. 대형 계좌 한정 (DEFENSIVE/CAPITAL_PRESERVATION 만) | 사용자 본인 운영계좌 = **소액 (3천만 미만, SMALL/GROWTH 티어)** → *효과 0* |

사용자 명시 *"적극적 반영 (계좌규모 1000~2000시작)"* + *"현재 초기자금 3천 미만 예상 (LIVE 시 재확인)"* → **옵션 D (SHADOW 적용 + 학습 marker 분리)** 가 유일하게 정합.

## 2. 결정

### 2.1 옵션 D 채택 — SHADOW only + 학습 marker 분리

| 모드 | 사이징 결정 SSOT | ENV |
|------|------------------|-----|
| **SHADOW + ENV ON** | `computeFinalPosition` (본 모듈) | `POSITION_SIZING_ENGINE_SHADOW_APPLY=true` 명시 활성화 |
| **SHADOW + ENV OFF** | 기존 SSOT (`accountRiskBudget+slotSizing+sizingTier`) | default OFF — 본 PR 머지 후 운영자 명시 활성화 의무 |
| **LIVE (모드 무관)** | 기존 SSOT 100% 보존 | 본 PR 영향 0 — 후속 PR 별도 ENV `_LIVE_ENABLED=true` |

### 2.2 학습 데이터 격리 — `sizingSource` marker

`ServerShadowTrade.sizingSource?: 'NEW_TIER_ENGINE' | 'LEGACY_SSOT'` 옵셔널 영속. `attribution` / `failurePatternDB` 가 본 marker 로 두 SSOT 결과 분리 분석 가능 — 학습 가중치 오염 차단.

**부재 (undefined)** = 기존 영속 (PR 도입 이전) 또는 ENV OFF — `LEGACY_SSOT` 동등 처리 (후방호환).

### 2.3 사용자 GROWTH 티어 정책 (1000만~3000만)

현재 사용자 자본 = SMALL (500만~1000만) 또는 **GROWTH (1000만~3000만)** 티어. 본 모듈 활성화 시 사용자 SHADOW 매매에 직접 영향:

| 티어 | BUY | STRONG_BUY | CONFIRMED | maxPos | maxStopLoss | 권장 보유 |
|------|-----|------------|-----------|--------|-------------|-----------|
| **SMALL** | 10% | 17% | 24% | 25% | 1.7% | 4~6 |
| **GROWTH** | 8% | 12% | 18% | 20% | 1.5% | 5~8 |

`MICRO/SMALL/GROWTH` 신호 우선권 (RRR≥2.5 + Enemy 통과 + Gate1 + 정상 레짐) 활성 — 소액 계좌 진입 기회 보존 정책.

### 2.4 wiring 위치 — 메인 buyList 한 곳만

`buyListLoop.ts:1014` `calculateOrderQuantity` 직후 + `buildBuyTrade` 직전. `applyPositionSizingEngine(stockShadowMode, ctx)` 호출 → 활성 시 quantity override + sizingEngineSnapshot 영속 / 비활성 시 legacy quantity.

**PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT 30% 선취매 / INTRADAY_STRONG 3 곳은 후속 PR** — 메인 buyList 1주 SHADOW 검증 후 확장.

## 3. wiring 인프라

### 3.1 신규 모듈 — `server/trading/sizing/positionSizingEngineWiring.ts`

3 export:
- `shouldApplyPositionSizingEngine(shadowMode)` — ENV + SHADOW 분기 SSOT (LIVE 회귀 차단)
- `mapToPositionSizingInput(ctx)` — buyListLoop ctx → `PositionSizingInput` 매핑 + 안전 fallback (NaN/누락 시 null)
- `applyPositionSizingEngine(shadowMode, ctx)` — 통합 진입점 4 분기 (ENV OFF / 매핑 실패 / engine blocked / 정상 산출)

### 3.2 안전 fallback 정책 SSOT

| 조건 | 결과 |
|------|------|
| `shadowMode=false` (LIVE) | `applied=false`, `skipReason='LIVE_MODE'`, legacy quantity 사용 |
| ENV 미설정 또는 'true' 외 | `applied=false`, `skipReason='ENV_DISABLED'`, legacy quantity 사용 |
| 입력 매핑 실패 (NaN/누락) | `applied=false`, `skipReason='INPUT_MAPPING_FAILED'`, legacy quantity 사용 |
| `computeFinalPosition().blocked=true` | `applied=false`, `skipReason='BLOCKED_BY_ENGINE'`, legacy quantity 사용 (학습 격리 — 본 모듈 차단해도 LEGACY 그대로) |
| `Math.floor(finalPosition / price) < 1` | `applied=false`, `skipReason='QUANTITY_BELOW_ONE'`, legacy quantity 사용 |
| 정상 산출 | `applied=true`, `quantity=Math.floor(finalPosition/price)`, `sizingSource='NEW_TIER_ENGINE'` |

### 3.3 영속 schema 확장

`ServerShadowTrade` +2 옵셔널 필드:
- `sizingSource?: 'NEW_TIER_ENGINE' | 'LEGACY_SSOT'`
- `sizingEngineSnapshot?: { tierName, basePct, finalPositionPct, finalPositionKrw, drawdownMultiplier, lossStreakMultiplier, liquidityMultiplier, sectorExposureMultiplier, expectedStopLossDamagePct, signalPriorityApplied, adjustmentReasons[], snapshotAt }`

`BuildBuyTradeParams` 동일 2 옵셔널 추가 — 호출자 (buyListLoop) 가 전달 시에만 영속.

## 4. ENV 우회 정책

| ENV | Default | 효과 |
|-----|---------|------|
| `POSITION_SIZING_ENGINE_SHADOW_APPLY` | `false` (미설정) | `=true` 명시 시 SHADOW 모드 활성, 그 외 OFF |
| `POSITION_SIZING_ENGINE_LIVE_ENABLED` | `false` | **후속 PR 도입 예정** — 본 PR 시점 영원히 false (`isLivePositionSizingEngineEnabled()` 함수 자체가 false return) |

운영자 활성화 절차:
1. 본 PR 머지 후 SHADOW 모드 (`AUTO_TRADE_MODE=SHADOW`) + `POSITION_SIZING_ENGINE_SHADOW_APPLY=true` 동시 설정
2. 1주 SHADOW 매매 누적 → `sizingSource='NEW_TIER_ENGINE'` 영속 trade 분석
3. 본 모듈 quantity vs legacy quantity 차이 / 결과 수익률 / 차단 빈도 검증
4. 만족 시 후속 PR 에서 LIVE 활성화 (`_LIVE_ENABLED=true` ENV 도입)

## 5. 회귀 테스트

`positionSizingEngineWiring.test.ts` 신규:
- ENV OFF (default) → applied=false / skipReason='ENV_DISABLED' / sizingSource='LEGACY_SSOT'
- ENV ON + LIVE → applied=false / skipReason='LIVE_MODE'
- ENV ON + SHADOW + 정상 입력 → applied=true / sizingSource='NEW_TIER_ENGINE' / quantity > 0
- ENV ON + SHADOW + 매핑 실패 (NaN totalAssets) → applied=false / skipReason='INPUT_MAPPING_FAILED'
- ENV ON + SHADOW + engine blocked (RRR=0) → applied=false / skipReason='BLOCKED_BY_ENGINE'
- ENV ON + SHADOW + quantity<1 (price > finalPosition) → applied=false / skipReason='QUANTITY_BELOW_ONE'
- 입력 매핑 6 필드 매칭 (totalAssets / shadowEntryPrice / stopLoss / signalGrade / regimeKelly / rrr)
- 신호 등급 매핑 (isStrongBuy → STRONG_BUY / 그 외 → BUY)

`buyListLoop` 정적 grep 가드:
- `applyPositionSizingEngine` import + 호출 정합 (한 곳만)
- `legacyQuantity` rename + `finalQuantity` 4 위치 정합
- `buildBuyTrade` 호출에 `sizingSource` + `sizingEngineSnapshot` 전달

## 6. LIVE 매매 영향

**본 PR 영향 0** — 4 보호층:

1. `applyPositionSizingEngine()` 진입부 `if (!shouldApplyPositionSizingEngine(shadowMode)) return {applied: false, ...}` — `shadowMode=false` (LIVE) 시 본 모듈 자체 미실행
2. ENV `POSITION_SIZING_ENGINE_SHADOW_APPLY` default 미설정 → `=== 'true'` false → ENV_DISABLED 분기
3. wiring 위치 = `calculateOrderQuantity` 직후 — 기존 사이징 결정 (legacyQuantity) 100% 그대로 산출 + 본 모듈 결과는 *override 만*
4. 매핑 실패 / engine blocked / quantity<1 4 분기 모두 `applied=false` → legacyQuantity 사용 (panic 차단)

## 7. 잘못된 해결 방법 (영구 차단)

- ❌ 본 모듈을 LIVE 모드에 직접 적용 — 사용자 *"LIVE 시 재확인"* 명시 위반 + 회귀 위험 ↑. 후속 PR 별도 ENV 의무.
- ❌ `legacyQuantity` 변수 제거 — fallback 안전망 손실. 본 모듈 차단 시 panic.
- ❌ `sizingSource` marker 미영속 — 학습 데이터 오염 (두 SSOT 결과 섞여 attribution 가중치 왜곡).
- ❌ 입력 매핑 실패 시 throw — buyListLoop 본체 차단 위험. *반드시* `null` 반환 + caller fallback.

## 8. 잔여 후속 PR

- **PR-Phase2D-Extension** (P1): PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT 30% 선취매 / INTRADAY_STRONG 3 곳 동일 패턴 wiring
- **PR-Phase3-LiveActivation** (P0 후속): SHADOW 1주 검증 후 `_LIVE_ENABLED=true` ENV 도입 + 회귀 테스트 + 운영자 활성화 절차
- **PR-DrawdownTracking**: `peakEquity` 영속 SSOT 신설 (현재 매핑은 `peakEquity = totalAssets` 가정 — drawdown 자동 추적 부재)
- **PR-LossStreakIntegration**: 외부 SSOT (학습 모듈 `consecutiveLosses`) 와 본 모듈 `LossStreakState` 연결
- **PR-UniverseIntegration**: `preScreenStocks` 결과 (marketCap/avgDailyVolume) 를 buyListLoop ctx 에 노출 → 본 모듈 universe 기준 정확 적용
- **PR-SectorWeightIntegration**: `sectorPreGuard` 결과 (currentSectorWeight) 를 본 모듈 sectorExposure 입력으로 결합

## 9. 운영 효과 (ENV 활성화 후)

- 사용자 본인 SHADOW 매매에서 6 티어 매트릭스 직접 검증 가능 (SMALL/GROWTH 티어)
- `sizingEngineSnapshot` 영속으로 *왜 이 사이즈가 나왔는지* 사후 추적 가능 (7축 배수 분해)
- attribution / failurePatternDB 가 `sizingSource` marker 로 학습 데이터 분리 가능 — 두 SSOT 비교 분석
- LIVE 매매 0 영향 — 후속 PR 까지 회귀 위험 격리
