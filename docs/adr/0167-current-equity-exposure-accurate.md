# ADR-0167 — currentEquityExposureAmount 정확 산출 SSOT (활성 trade 평가금액 합산)

**상태**: Accepted (Phase 2-D Exposure Accuracy — ADR-0166 정확도 향상, default OFF)
**날짜**: 2026-05-02
**관련 PR**: PR-ExposureBudget-AccurateExposure
**의존성**: ADR-0166 (레짐별 총 노출 예산)
**Audit-PR-520 §M1 추적성**: 본 PR 이 audit-PR-520 의 M1 (`currentEquityExposureAmount` 단순 추정) 직속 수리

## 1. 문제

ADR-0166 §2.5 명시: *"단순 추정 (`Math.max(0, totalAssets - orderableCash)`). 정확한 계산은 후속 PR 분리"*. 4 호출 site (buyListLoop 3 + intradayLoop 1) 모두 이 추정 사용.

**단순 추정 결함**:
- closed trade (HIT_STOP/HIT_TARGET/REVERTED) 의 실현 자본이 `totalAssets` 에 반영되지만 `orderableCash` 동기화 지연 시 오차 ↑
- 미체결 매수 주문 (KIS 대기) 미반영
- SHADOW 가상 자본 ↔ LIVE 실잔고 모드 차이 미고려
- ADR-0166 cap 정확도 제한 (R6 80% 도달 직전 종목 누락 위험)

**audit-PR-520 §M1 직접 수리**.

## 2. 결정

### 2.1 신규 SSOT — `server/trading/sizing/currentEquityExposure.ts`

3 export:
- **`computeCurrentEquityExposure(input)`** — 활성 trade (PENDING/ACTIVE) 만 평가금액 합산 (보유원가 또는 시가)
- **`resolveCurrentEquityExposure(totalAssets, orderableCash, shadows)`** — ENV 분기 통합 진입점 (정확 vs 추정 자동 결정)
- **`isAccurateExposureEnabled()`** — ENV `POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED` 동적 결정

### 2.2 정확도 단계

| 단계 | 가격 출처 | 정확도 | PR |
|------|-----------|--------|-----|
| **본 PR (보유원가)** | `trade.shadowEntryPrice × getRemainingQty(trade)` | 보수적 (시가 변동 무시) | ADR-0167 |
| 후속 PR (시가 평가) | `currentPriceMap[code] × qty` (KIS 호출) | 가장 정확 | (별도 ADR) |

본 PR 의 `currentPriceMap` 옵셔널 인자는 *시그니처 미리 도입* — 후속 PR 호출자만 추가하면 즉시 활성화. 본 PR 호출자 (4 wiring) 는 `currentPriceMap` 미전달 → 보유원가 평가.

### 2.3 가격 우선순위 SSOT

```typescript
const evalPrice = (currentPrice && currentPrice > 0)
  ? currentPrice                  // 시가 평가 (currentPriceMap 매핑 시)
  : trade.shadowEntryPrice;       // 보유원가 fallback (보수적)
```

NaN/0/음수 가격은 trade 자체 제외 (panic 차단).

### 2.4 활성 trade 정의

`isOpenShadowStatus(trade.status)` → `PENDING` 또는 `ACTIVE` 만. `HIT_STOP` / `HIT_TARGET` / `REVERTED` 는 `getRemainingQty=0` 또는 status 분기로 자동 제외.

### 2.5 4 wiring 호출 site 정정

| 위치 | 변경 |
|------|------|
| `buyListLoop.ts:393` (PRE_BREAKOUT_FOLLOWTHROUGH) | `Math.max(0, totalAssets - orderableCash)` → `resolveCurrentEquityExposure(totalAssets, orderableCash, ctx.shadows)` |
| `buyListLoop.ts:606` (PRE_BREAKOUT 30%) | 동일 |
| `buyListLoop.ts:1147` (메인 buyList) | 동일 |
| `intradayLoop.ts:145` (INTRADAY_STRONG) | 동일 |

호출자 1 줄 변경 — `resolveCurrentEquityExposure` SSOT 가 ENV 분기 자동 처리.

## 3. ENV 우회 (별도 ENV)

| ENV | Default | 효과 |
|-----|---------|------|
| `POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED` | OFF | `=true` 시 정확 산출, 그 외 ADR-0166 단순 추정 |

**ADR-0166 ENV 와 별도** — 운영자 단계별 검증 의도:
- Stage A: SHADOW APPLY (ADR-0162)
- Stage B: EXPOSURE BUDGET (ADR-0166, 단순 추정)
- **Stage B-2**: ACCURATE EXPOSURE (ADR-0167, 정확 산출) ← **본 PR**
- Stage C: LIVE ENABLED (ADR-0165)

## 4. LIVE 매매 영향 0 (default OFF)

ADR-0166 §"LIVE 매매 영향 0" 동일 — `isAccurateExposureEnabled() === false` (default) 시 즉시 단순 추정 fallback → ADR-0166 동작 100% 보존.

## 5. 회귀 테스트

`currentEquityExposure.test.ts` 21 케이스:
- ENV 동적 결정 4 (default OFF / 'true' / 'false' / '1'+'TRUE' 정확히 'true' 만)
- computeCurrentEquityExposure 활성 합산 11 (빈 / 단일 PENDING / ACTIVE / 다중 / closed 제외 / quantity=0 / NaN/음수 가격 제외 / currentPriceMap 적용 / 부분 매핑 / 부재 / NaN 매핑)
- resolveCurrentEquityExposure 통합 6 (ENV OFF default / 음수 결과 0 / ENV ON 활성 / 활성 0 정확 / closed 만 정확 / 단순 vs 정확 차이)

## 6. 잘못된 해결 방법 (영구 차단)

- ❌ ADR-0166 단순 추정 직접 교체 (ENV 우회 없이) — 회귀 위험 + 운영자 검증 단계 부재. **반드시 ENV gate 통한 점진 활성화**.
- ❌ 시가 평가 (currentPriceMap) 본 PR 통합 — KIS 호출 의존 + 본 PR scope 외. **시그니처 미리 도입** 만, 호출자 wiring 후속 PR.
- ❌ 4 호출자 분기별 다른 산출 정책 — drift 위험. **`resolveCurrentEquityExposure` SSOT 단일 진입점**.
- ❌ closed trade 일부 포함 (실현 자본 합산 시도) — closed 는 `totalAssets` 에 이미 반영. **활성만 합산** 정합.

## 7. 운영자 활성화 절차

1. ADR-0166 Stage B (EXPOSURE BUDGET) 1주 운영 후 `data/peak-equity.json` + `[Sizing-ExposureBudget]` 진단 로그 분석
2. 단순 추정 vs 정확 산출 차이 검증 (운영자 SHADOW 매매 누적 데이터):
   - 활성 trade 합산 vs `totalAssets - orderableCash` 차이 ≥ 5% 시 정확 산출 도입 권장
3. `POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED=true` 추가 활성화
4. SHADOW 1주 추가 검증 — exposure cap 적용 빈도 변화 분석
5. 만족 시 운영 유지, 문제 시 ENV `=false` 1줄 즉시 롤백

## 8. 후속 PR (PENDING_WIRING B9 잔여 4 → 3)

- ~~PR-ExposureBudget-AccurateExposure (M1)~~ ← **본 PR 완료**
- PR-ExposureBudget-AddOnBuyDetection (M2): `trancheExecutor` 추매 진입점 wiring
- PR-ExposureBudget-CurrentPriceMap (신규): `currentPriceMap` 호출자 추가 (KIS 시가 매핑 SSOT)
- PR-ExposureBudget-UI: 사용자 §6 UI 출력 항목
- PR-ExposureBudget-AutoRegimeMapping (M4): 매크로 신호 R0~R6 자동 분류

## 9. audit-PR-520 §M1 추적성 (audit 학습 데이터)

audit-PR-520 §M1 (currentEquityExposureAmount 단순 추정) → **본 PR 으로 수리 완료**. 다음 audit (PR #530) 시 본 M1 항목이 *수리 완료 (DECIDED_NOT_WIRING 또는 자동 제거)* 로 추적 가능.

ADR-0146 §"audit findings 가 학습 데이터" 정합 — audit → 수리 PR 사이클 첫 사례.
