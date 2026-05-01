# ADR-0153: Phase 3 globalIntel 합성 — riskOnEnvironment + cycleVerified + policyAlignment 격상

**날짜**: 2026-05-01
**상태**: 채택
**관련 PR**: PR-Phase2-Real-Phase3 (PR-Phase0-Audit `_workspace/audit-pr-phase0/findings.md` §E 권장)
**관련 ADR**:
- ADR-0150 (Phase 1 DART 마무리) — Phase 1 직속 후속
- ADR-0152 (Naver 외인 추세 endpoint) — 동시 진행 PR
- ADR-0114 (DataTrustLayer) — 'API' tier 정책 정합

## 문제

PR-Phase0-Audit (`_workspace/audit-pr-phase0/findings.md` §E) 가 *Phase 3 globalIntel 합성 (~150~200 LoC)* 권장:

> 3. 🟡 globalIntel 12 레이어 부분 격상 (2~3개, ~50~80 LoC each)
> - #5 `riskOnEnvironment` ← `macroEnv.regime` ('RISK_ON'/'RISK_OFF') + `bearRegimeResult` + `vkospi < 25`
> - #1 `cycleVerified` ← `marketRegimeClassifierResult` + `sectorEnergyResult`
> - #16 `policyAlignment` ← `bokRateDirection` + `nominalGdpGrowth` + `oeciCliKorea`

`useGlobalIntelStore` 의 12 레이어 데이터가 이미 영속 — KRX/ECOS/FRED 매크로 지표 + Bear Regime Detector + Market Regime Classifier + Sector Energy Engine. 그러나 클라이언트 enrichment 가 *3 키 (#5/#1/#16) 를 stock.checklist (Gemini AI 추정) 만 사용* — globalIntel 결과가 기존 입력으로 활용되지 않던 구조적 갭.

## 결정

### 1. `globalIntelSynthesis.ts` SSOT 신규 — 순수 함수 합성 헬퍼 3종

`src/services/quant/globalIntelSynthesis.ts` 신규. `GlobalIntelSynthesisCtx` 타입 (4 옵셔널 필드: macroEnv / bearRegimeResult / marketRegimeResult / sectorEnergyResult) + 3 합성 헬퍼:

#### 1.1 `synthesizeRiskOnEnvironment(ctx): number | null` — #5 격상

**임계** (모두 충족 시 1):
- `bearRegimeResult.defenseMode === false` (방어 모드 아님)
- `macroEnv.vkospi < 25` (변동성 안정)
- `marketRegimeResult.classification ∈ ['RISK_ON_BULL', 'RISK_ON_EARLY']` (RISK_OFF_* 시 0)

**fallback**: ctx 의 3 필드 모두 부재 시 null (호출자 stock.checklist 보존). vkospi 미수신 시 임계 미통과 → 0.

**의도**: *시장 환경이 위험 추구 가능한 상태인가* — Risk-On 시장 환경 정량 검증.

#### 1.2 `synthesizeCycleVerified(ctx): number | null` — #1 격상

**임계** (모두 충족 시 1):
- `marketRegimeResult.classification ∈ ['RISK_ON_BULL', 'RISK_ON_EARLY']` (강세 사이클)
- `sectorEnergyResult.leadingSectors.length >= 1` (주도 섹터 형성됨)

**fallback**: marketRegimeResult / sectorEnergyResult 둘 다 부재 시 null.

**의도**: *주도주 사이클 진행 중인가* — 강세 시장 + 주도 섹터 동시 발현.

#### 1.3 `synthesizePolicyAlignment(ctx): number | null` — #16 격상

**임계** (3 조건 중 ≥ 2 충족 시 1):
- `bokRateDirection ∈ ['HOLDING', 'CUTTING']` (긴축 아님 — 자산 친화적)
- `nominalGdpGrowth > 0` (명목 GDP 성장 중)
- `oeciCliKorea >= 100` (경기 선행지수 100 이상 — 경기 확장)

**fallback**: macroEnv 부재 시 null.

**의도**: *정책/매크로 환경이 자산 가격에 우호적인가* — 3 조건 중 다수결.

### 2. enrichment.ts main + aiFallback 두 경로 wiring

```typescript
// store.getState() 한 번 호출, ctx 합성
const _intelStore = useGlobalIntelStore.getState();
const _globalIntelCtx: GlobalIntelSynthesisCtx = {
  macroEnv: _intelStore.macroEnv,
  bearRegimeResult: _intelStore.bearRegimeResult,
  marketRegimeResult: _intelStore.marketRegimeClassifierResult,
  sectorEnergyResult: _intelStore.sectorEnergyResult,
};

// checklist 본체:
riskOnEnvironment:
  synthesizeRiskOnEnvironment(_globalIntelCtx) ??
  (stock.checklist?.riskOnEnvironment ?? 0),
cycleVerified:
  synthesizeCycleVerified(_globalIntelCtx) ??
  (stock.checklist?.cycleVerified ?? 0),
policyAlignment:
  synthesizePolicyAlignment(_globalIntelCtx) ??
  (stock.checklist?.policyAlignment ?? 0),
```

main path + aiFallback 두 경로 동일 적용 (ADR-0150 정합). globalIntel 합성은 *외부 호출 0건* (zustand store read-only) — 회로 부담 무관.

### 3. `buildConditionSourceTiers` 'API' tier 격상

```typescript
if (ctx.hasGlobalIntelSynth) {
  meta.riskOnEnvironment = 'API';
  meta.cycleVerified = 'API';
  meta.policyAlignment = 'API';
}
```

신규 ctx 필드 `hasGlobalIntelSynth?: boolean` 추가. enrichment 가 store 데이터 가용 시 (`_globalIntelCtx.macroEnv != null OR ...`) true 전달.

UI DataQualityBadge 가 #5/#1/#16 를 'API' tier 로 표시 — *합성 결과지만 입력 자체가 외부 데이터 (KRX/ECOS/FRED)* 이므로 'API' 정합. ADR-0114 DataTrustLayer 의 *Tier 1 외부 데이터 출처* 정합.

## 영향

### 27 조건 격상 진행도

| Phase | 누적 격상 % | 격상 항목 |
|---|---|---|
| Phase 1 (PR-Phase1-DartFinalize) | 52% (14개) | REAL_DATA 9 + DART 5 |
| Phase 2 (PR-Phase2-KisSupplyAudit) | 52% (14개) | 동일 |
| ADR-0152 (Naver 외인 추세) | 56% (15개) | + #4 supplyInflow |
| **본 PR (ADR-0153 globalIntel 합성)** | **67% (18개)** | **+ #5 riskOnEnvironment, #1 cycleVerified, #16 policyAlignment** |
| Phase 4 외부 컨센서스 (BLOCKED) | 78% (21개) | + #14/#13 |
| 정성 (DECIDED_NOT_WIRING) | 100% | 22% (5개) — #9/#13/#17/#20/#26 |

→ ADR-0152 + ADR-0153 동시 진행 시 **52% → 67% (4 키 격상, 14 → 18 개)**.

### LIVE 매매 영향

- 신규 매수 시점부터 #5/#1/#16 가 globalIntel 합성 결과 영속
- store 데이터 부재 시 (예: 부팅 초기) AI 추정 fallback (silent degradation 차단)
- 매수 candidate 평가 시 *시장 환경 + 주도 사이클 + 정책 매크로* 정량 검증된 종목 자연 우대

### 외부 호출 영향

- KIS/KRX/Yahoo/Naver: 0 호출 (zustand store read-only)
- store 갱신은 별도 cron (이미 작동) — 본 PR 무관

## 회귀 테스트

`src/services/quant/globalIntelSynthesis.test.ts` 신규:

1. **synthesizeRiskOnEnvironment 임계 분기** (5):
   - ctx 빈 → null
   - bearRegimeResult.defenseMode=true → 0
   - vkospi=20 + RISK_ON_BULL → 1
   - vkospi=30 + RISK_ON_BULL → 0 (변동성 임계 미달)
   - vkospi=20 + RISK_OFF_CORRECTION → 0
2. **synthesizeCycleVerified 임계 분기** (4):
   - ctx 빈 → null
   - RISK_ON_BULL + leading 1개 → 1
   - RISK_ON_EARLY + leading 0개 → 0 (주도 섹터 부재)
   - RISK_OFF_* + leading 1개 → 0
3. **synthesizePolicyAlignment 다수결 분기** (5):
   - macroEnv 부재 → null
   - 3 조건 모두 충족 → 1
   - 2 조건 충족 → 1
   - 1 조건 충족 → 0
   - 0 조건 충족 → 0
4. **synthesizeAllGlobalIntel 진단 헬퍼** (1) — 3 키 동시 산출

## ENV 우회

본 PR 미도입. 임계값 (vkospi<25, leading≥1, 다수결≥2) 은 정책 SSOT. 향후 데이터 기반 재조정 시 본 ADR 갱신.

## 잔여

- **#12 institutionalBuying 격상**: ADR-0011 정책 변경 또는 KRX 기관 순매수 데이터 출처 확보 후 별도 ADR.
- **임계값 검증** — 1~2 주 운영 데이터 누적 후 globalIntel 임계 정합성 평가.
- **추가 globalIntel 활용** — 12 레이어 중 본 PR 활용 4 레이어 외 8 레이어 (`exportMomentum / smartMoneyTracker / volatilityRegime / etc`) 향후 합성 가능성 검토.
