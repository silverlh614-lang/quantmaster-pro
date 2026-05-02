# ADR-0170 — 매크로 신호 기반 R1_DEFENSIVE 자동 격상 (audit-PR-520 §M4 수리)

**상태**: Accepted (audit-PR-520 §M4 직접 수리 — R1_DEFENSIVE 정책 활성화)
**날짜**: 2026-05-02
**관련 PR**: PR-ExposureBudget-AutoRegimeMapping
**의존성**: ADR-0166 (레짐 노출 예산 7 매트릭스), audit-PR-520 §M4
**Audit-PR-520 §M4 추적성**: 본 PR 이 audit-PR-520 의 M4 (매크로 신호 기반 R0~R6 자동 분류 부재) 직속 수리

## 1. 문제

ADR-0166 §2.4 명시: *"R1_DEFENSIVE 매핑 부재 (기존 시스템 직접 매칭 부재, 후속 PR 매크로 신호 자동 분류)"*. audit-PR-520 §M4 가 본 결함을 P2 로 분류.

기존 6 → 7 매핑 (`REGIME_MAPPING`) 은:
- R1_TURBO → R6_STRONG_BULL
- R2_BULL → R5_BULL
- R3_EARLY → R4_RECOVERY
- R4_NEUTRAL → R3_NEUTRAL
- R5_CAUTION → R2_WEAK
- R6_DEFENSE → R0_CRISIS

**R1_DEFENSIVE 정책** (target 20% / max 25% / minCash 75% / `allowAddOnBuys=false` / positionMultiplier 0.50 매우 보수적) 이 어떤 매핑 결과로도 도달하지 않아 **영원히 미사용** — 시장 변동성 폭증 시 R5_CAUTION 만 트리거되어 R2_WEAK (target 30%, allowAddOnBuys=false) 로 매핑되지만, 진짜 위기 상황 (VIX>30, bearDefenseMode 등) 에서도 동일 정책 적용 → 더 보수적인 R1_DEFENSIVE 안전망이 dead path.

## 2. 결정

### 2.1 신규 SSOT — `mapInternalToExposureRegimeWithMacro(internal, macro?)`

`server/trading/sizing/regimeExposurePolicy.ts` 에 매크로 신호 기반 격상 함수 추가. 기존 `mapInternalToExposureRegime` 그대로 보존 (호출자 무수정).

**격상 규칙** (우선순위 SSOT):
1. R6_DEFENSE → R0_CRISIS (기존 매핑, 매크로 신호 무관 — 시장 전체 붕괴)
2. R5_CAUTION + bearDefenseMode=true → **R1_DEFENSIVE** (방어 모드 진입)
3. R5_CAUTION + (vix>30 OR vkospi>30) → **R1_DEFENSIVE** (변동성 폭증)
4. R5_CAUTION + (vix>25 AND dailyLossPct<-3) → **R1_DEFENSIVE** (자본 보호)
5. 그 외 → 기존 `REGIME_MAPPING` 적용

### 2.2 매크로 입력 schema

```typescript
export interface ExposureRegimeMacroInput {
  vix?: number;
  vkospi?: number;
  bearDefenseMode?: boolean;
  dailyLossPct?: number;
}
```

모든 필드 옵셔널 — 부재 시 기존 매핑 그대로. 호출자 부담 최소화.

### 2.3 `applyExposureBudgetCap` 통합 진입점 wiring

`ApplyExposureBudgetCapInput` 에 `macro?: ExposureRegimeMacroInput` 옵셔널 추가. 본체 변경 1줄:

```typescript
const exposureRegime = input.exposureRegime
  ?? (input.macro
    ? mapInternalToExposureRegimeWithMacro(input.regime, input.macro)
    : mapInternalToExposureRegime(input.regime));   // 기존 매핑 fallback
```

`input.macro` 부재 시 기존 매핑 그대로 — **호출자 무수정 안전성 보장**.

### 2.4 4 호출자 wiring (helpers.buildExposureBudgetMacroInput SSOT)

`buildExposureBudgetMacroInput(macroState)` 헬퍼 신설 — 4 호출자 drift 차단 단일 진입점:

```typescript
export function buildExposureBudgetMacroInput(
  macroState: MacroState | null | undefined,
): { vix?: number; vkospi?: number; bearDefenseMode?: boolean } | undefined {
  if (!macroState) return undefined;
  return {
    vix: macroState.vix,
    vkospi: macroState.vkospi,
    bearDefenseMode: macroState.bearDefenseMode,
  };
}
```

4 호출자 (buyListLoop 3 + intradayLoop 1) 각각에 1줄 추가:
```typescript
macro: buildExposureBudgetMacroInput(ctx.macroState),  // ADR-0170 §M4
```

`dailyLossPct` 는 `MacroState` 에 직접 영속 부재 — 후속 PR 에서 `getDailyLossPct()` 호출자 통합 후 추가. 본 PR 은 vix/vkospi/bearDefenseMode 3 신호로 격상 트리거 활성.

## 3. 회귀 위험 격리 (3 보호층)

1. **ENV `EXPOSURE_REGIME_AUTO_MAPPING_DISABLED=true`** → 격상 비활성, 기존 매핑 그대로 (default ON)
2. **macro 입력 부재** → 기존 매핑 그대로 (NaN/undefined 모두 false 평가)
3. **상위 ENV gate** `POSITION_SIZING_EXPOSURE_BUDGET_ENABLED` (default OFF) → 정책 활성화 시점에서만 영향

운영자가 `POSITION_SIZING_EXPOSURE_BUDGET_ENABLED=true` 명시 활성화 후에만 격상 효과 발휘 — 단계별 검증 의무 (ADR-0166 §7).

## 4. LIVE 매매 영향 (의도된 변경)

ENV ON 시:
- R5_CAUTION 일반 → R2_WEAK (positionMultiplier 0.65) — 기존 동작
- R5_CAUTION + bearDefenseMode → **R1_DEFENSIVE (positionMultiplier 0.50)** — 35% 추가 사이즈 축소
- R5_CAUTION + VIX>30 → **R1_DEFENSIVE** — 변동성 폭증 시 보수화
- R5_CAUTION + VIX>25 + 일일손실 누적 → **R1_DEFENSIVE** — 자본 보호 강화

R1_DEFENSIVE 의 `allowAddOnBuys=false` 정책으로 트랜치 (PR #527 wiring) 도 차단.

ENV OFF (default) 시 ADR-0166 동작 100% 보존.

## 5. 회귀 테스트

`regimeExposureMacroMapping.test.ts` 26 케이스:
- isExposureRegimeAutoMappingDisabled ENV 4 분기
- mapInternalToExposureRegimeWithMacro 결정 트리 22 (ENV 비활성 fallback 2 + R6_DEFENSE 매크로 무관 1 + R5_CAUTION 격상 12 + R5_CAUTION 외 레짐 무관 3 + 우선순위 충돌 2 + 기존 매핑 무회귀 3 — 총 23, +6 boundary 감산)

`applyExposureBudgetCapAdr0170.test.ts` 20 케이스:
- macro 옵셔널 입력 7 분기 (미전달 / bearDefenseMode / vix>30 / 신호 없음 / exposureRegime 명시 우선 / R6_DEFENSE 무관 / ENV 비활성)
- 호출자 정합 정적 가드 13 (helpers/buyListLoop/intradayLoop/positionSizingEngineWiring × import + 호출 + ADR 추적 주석)

## 6. 잘못된 해결 방법 (영구 차단)

- ❌ 기존 `mapInternalToExposureRegime` 직접 변경 — 호출자 무수정 안전성 손실 + 회귀 위험. **신규 함수 분리**.
- ❌ R5_CAUTION 무조건 R1_DEFENSIVE 매핑 — 매크로 신호 부재 시 과도 보수화. **신호 기반 조건부 격상**.
- ❌ R3_EARLY / R4_NEUTRAL 격상 — 강세장 진입 차단 위험. **R5_CAUTION 단일 분기만 격상**.
- ❌ ENV 우회 부재 — 정책 강제 + 회귀 위험. **3 보호층 (ENV + macro + budget gate)**.
- ❌ dailyLossPct MacroState 영속 본 PR 통합 — scope 외, 회귀 위험. **vix/vkospi/bearDefenseMode 3 신호 우선, dailyLossPct 후속 PR**.

## 7. audit-PR-520 §M4 추적성 (audit 학습 데이터)

audit-PR-520 §M4 (매크로 신호 기반 R0~R6 자동 분류 부재) → **본 PR 으로 수리 완료**. 다음 audit (PR #530 예정) 시 M4 항목이 *수리 완료* 로 추적 가능.

ADR-0146 §"audit findings 가 학습 데이터" 정합 — audit → 수리 PR 사이클 **네 번째 사례** (M1: ADR-0167, M3: ADR-0168, M2: ADR-0169, **M4: 본 PR**).

**audit-PR-520 §"Medium 4건" 모두 수리 완료** — 다음 audit 시 *Critical 0건 / High 0건 / Medium 0건* 기대.

## 8. PENDING_WIRING B9 갱신

ADR-0166 의 B9 잔여:
- ~~PR-ExposureBudget-AccurateExposure (M1)~~ ← ADR-0167 완료 #525
- ~~PR-ExposureBudget-AddOnBuyDetection (M2)~~ ← ADR-0169 완료 #527
- ~~PR-ExposureBudget-AutoRegimeMapping (M4)~~ ← **본 PR 완료**
- PR-ExposureBudget-CurrentPriceMap: KIS 시가 매핑 SSOT (ADR-0167 §2.2 후속)
- PR-ExposureBudget-UI: 사용자 §6 UI 출력 항목

잔여 5 → 2 감소 (M1 + M2 + M4 완료). audit-PR-520 잔여 P2 0건 — *모든 audit 발견 수리 완료*.
