# ADR-0163 — Phase 2-D Extension: 3 진입 경로 wiring 확장

**상태**: Accepted (Phase 2-D Extension — 메인 buyList 외 3 진입 경로 동일 패턴 wiring)
**날짜**: 2026-05-02
**관련 PR**: PR-Sizing-Engine-Phase2D-Extension
**의존성**: ADR-0161 (Phase 1 인프라) / ADR-0162 (Phase 2-D 메인 buyList wiring + ENV 우회 + 학습 marker)
**SLA**: ADR-0162 §"잔여 후속 PR" §"Phase2D-Extension P1" 정합

## 1. 문제

ADR-0162 가 메인 buyList 한 곳만 wiring → **3 진입 경로 (PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT 30% 선취매 / INTRADAY_STRONG) 미적용** = 사용자 SHADOW 검증 시 매수 경로별 사이징 결정 SSOT 가 *분산* (메인 = 본 모듈 / 3 경로 = legacy SSOT).

학습 데이터 격리 효과 ↓ — `sizingSource` marker 가 메인 buyList 만 영속, 3 경로는 항상 `LEGACY_SSOT` (default 부재) 로 attribution 분석 시 *전체 매수의 일부만* 본 모듈 검증 가능.

## 2. 결정

`buyListLoop.ts` 2 분기 + `intradayLoop.ts` 1 분기 = **3 호출 추가** (총 4 호출) — 모두 ADR-0162 wiring SSOT (`applyPositionSizingEngine`) 동일 패턴 재사용.

### 2.1 신호 등급 매핑 (경로별)

| 경로 | 신호 등급 | 근거 |
|------|-----------|------|
| 메인 buyList (ADR-0162) | `isStrongBuy ? STRONG_BUY : BUY` | gateScore≥9 STRONG_BUY 임계 |
| **PRE_BREAKOUT_FOLLOWTHROUGH** | `STRONG_BUY` | 추세 추격 = 돌파 확정 후 진입 (강한 신호) |
| **PRE_BREAKOUT 30% 선취매** | `BUY` | 사전 진입 (보수적 — 30% 비율로 추가 보수화) |
| **INTRADAY_STRONG** | `BUY` (RRR=0 → engine 자동 차단) | 장중 강세 (RRR 평가 부재 — legacy fallback 의도) |

### 2.2 비율 보존 정책

본 모듈의 `finalPosition` (KRW) → `quantity` (주식 수) 산출 후, 호출자 측 비율 *그대로* 적용:
- PRE_BREAKOUT_FOLLOWTHROUGH: `Math.max(1, Math.ceil(fullQty * 0.7))` = 70% (추세 확정)
- PRE_BREAKOUT 30%: `Math.max(1, Math.floor(fullPbQty * 0.3))` = 30% (선취매)
- INTRADAY_STRONG: `quantity` 100% (분할 없음)

### 2.3 INTRADAY_STRONG `rrr=0` 의도

`INTRADAY_STRONG` 경로는 RRR (Risk-Reward Ratio) 평가 부재 — 본 모듈 `rrrMultiplier=0` → `signalBasedPosition=0` → `quantity<1` → `applied=false` → `legacyIntradayQty` 사용. *의도된 fallback* — 장중 진입은 본 모듈의 7축 평가 부적합 (RRR 입력 부재) → 항상 legacy.

향후 PR 에서 INTRADAY 경로의 RRR 평가 도입 시 본 분기 자동 활성화 가능 (코드 변경 없이).

## 3. wiring 패턴 (4 호출 모두 동일)

```typescript
const { quantity: legacyXXX } = calculateOrderQuantity({ ... });
const sizingApplyXXX = applyPositionSizingEngine(ctx.shadowMode, {
  totalAssets, shadowEntryPrice, stopLoss, signalGrade,
  regimeKelly: ctx.kellyMultiplier, confidenceModifier,
  rrr, marketCap: 큰수, avgDailyVolume20d: 큰수,
  currentSectorWeight: 0,
  isNormalRegime: ctx.regime ∈ {R1_TURBO, R2_BULL, R3_EARLY},
  enemyChecklistPassed: true, highDataReliability: true, gate1AllPassed: true,
  notInDowntrend: ctx.regime ∉ {R6_DEFENSE, R5_CAUTION},
});
const fullXXX = sizingApplyXXX.applied ? sizingApplyXXX.quantity : legacyXXX;
const sizingSourceXXX = sizingApplyXXX.sizingSource;
const sizingEngineSnapshotXXX = sizingApplyXXX.applied && sizingApplyXXX.result ? { 11 필드 } : undefined;
// 비율 적용 (70% / 30% / 100%)
buildBuyTrade({ ..., quantity: 비율적용, sizingSource: sizingSourceXXX, sizingEngineSnapshot: sizingEngineSnapshotXXX });
```

## 4. LIVE 매매 영향 0

ADR-0162 §6 동일 4 보호층 적용:
1. `ctx.shadowMode=false` → `applyPositionSizingEngine` 진입부 자동 skip
2. ENV `POSITION_SIZING_ENGINE_SHADOW_APPLY` default OFF → ENV_DISABLED 분기
3. wiring 위치 = `legacyXXX` 산출 *후* override 만
4. 4 fallback 분기 모두 `applied=false` → legacy 사용

## 5. 회귀 테스트

`sizingEngineAdr0163Wiring.test.ts` 신규 (20 케이스):
- buyListLoop 2 신규 분기 정적 가드 7 (호출 3건 + STRONG_BUY/BUY 매핑 + 70%/30% 비율 보존 + sizingSource/snapshot 전달 + 진단 로그)
- intradayLoop 1 분기 정적 가드 7 (import + 호출 + BUY 매핑 + RRR=0 + 100% 비율 + sizingSource 전달 + 진단 로그)
- LIVE 회귀 격리 3 (3 경로 모두 `ctx.shadowMode` 첫 인자)
- 4 경로 누적 통합 2 (총 4 호출 + buildBuyTrade 4 marker 전달)

`buyListLoopAdr0162Wiring.test.ts` 정정:
- `applyPositionSizingEngine 호출 수` 1건 → **3건** (메인 + 신규 2 분기)
- `quantity 단독 참조 0건` allowed regex 확장 — `legacyFullQty / legacyFullPbQty / legacyIntradayQty / fullQty / fullPbQty / sizingApply\w*\.quantity` 추가

## 6. 잘못된 해결 방법 (영구 차단)

- ❌ 비율 (70%/30%/100%) 본 모듈 내부에서 결정 — 경로별 의미 (추세 확정/선취매/분할 없음) 손실. **반드시 호출자 측 비율 보존**.
- ❌ INTRADAY 의 RRR 평가 부재를 우회하기 위해 `rrr=2.5` 임의 전달 — 본 모듈 신호 우선권 잘못 활성화 + 학습 데이터 오염. **`rrr=0` 로 의도된 legacy fallback 유지**.
- ❌ PRE_BREAKOUT 30% 선취매를 `STRONG_BUY` 매핑 — 사전 진입 (RRR 미확정) + 30% 비율 = 본질적으로 보수적. `BUY` 매핑이 본 모듈의 보수성과 정합.

## 7. 운영 효과 (ENV 활성화 후)

- 사용자 SHADOW 매매에서 **모든 진입 경로** (메인 + 추세 추격 + 선취매 + 장중) 가 본 모듈 결정 사용 (INTRADAY 는 의도된 legacy fallback)
- `sizingSource='NEW_TIER_ENGINE'` 영속 trade 가 *전체 매수의 대부분* 으로 확장 → attribution 분석 통계적 신뢰도 ↑
- 진단 로그에 경로별 prefix (`PRE_BREAKOUT_FOLLOWTHROUGH` / `PRE_BREAKOUT 30%` / `INTRADAY_STRONG`) 노출 → 운영자 사후 추적 정확

## 8. 잔여 후속 PR (PENDING_WIRING B8 갱신)

본 PR 후 잔여:
- **PR-Phase3-LiveActivation** (P0, SLA 2026-05-23): `_LIVE_ENABLED=true` ENV 도입 + LIVE wiring + 운영자 활성화 절차
- **PR-DrawdownTracking**: `peakEquity` 영속 SSOT 신설
- **PR-LossStreakIntegration**: 외부 학습 SSOT 와 본 모듈 `LossStreakState` 연결
- **PR-UniverseIntegration**: `preScreenStocks` 결과 (marketCap/avgDailyVolume) ctx 노출
- **PR-SectorWeightIntegration**: `sectorPreGuard` 결과 (currentSectorWeight) 결합
- (선택) **PR-IntradayRRR**: INTRADAY 경로 RRR 평가 도입 — 본 PR `rrr=0` fallback 자동 활성화
