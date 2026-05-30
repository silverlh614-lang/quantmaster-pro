# ADR-0546: Gate1 Required-Score SSOT 통합 (Phase 1, 동작 보존)

@responsibility gate-system/diagnostics — Gate1 required score 를 레짐 SSOT(resolveGate1RequiredScore)로 단일화. Phase 1 동작 보존(70 유지) + 레짐 인식값 섀도 병행 로깅. live 경로 0줄.

## Status

Accepted / Phase 1 (동작 보존, 섀도 관측). ENV `GATE1_REGIME_AWARE_REQUIRED` default OFF.
실제 완화 전환(true)은 Phase 2(별도 PR, 운영자 승인) 사안. 본 ADR 은 SSOT 신설 + 하드코딩 70 제거 + 섀도 로깅까지만.

Tags: gate-system / diagnostics / scan-blockers / config-ssot / shadow-only

## Context

buy-order drought 의 구조적 원인 — `Gate1 required score` 가 레짐 인식 SSOT 와 분리된 채
포렌식/관측/dry-run 계층에 하드코딩(70)되어 있었다.

| 경로 | 임계 소스 | R3_EARLY 실효값 | 스케일 |
|---|---|---|---|
| live 재검증/사이징 | `getMinGateScore` → `getEffectiveGateThreshold` → `GATE_SCORE_THRESHOLD_BY_REGIME` | normal **4** | ×1 (0~10) |
| 포렌식/관측/dry-run | **하드코딩 `?? 70` / `: 70` / `\|\| 70`** | **70** (≈ R4_NEUTRAL strong) | ×10 (0~100) |

- `src/constants/gateConfig.ts` 의 `R3_EARLY = { strong: 6, normal: 4 }`(문턱 완화 의도, ×10 = 40~60)가
  포렌식에 전파되지 않아 R3_EARLY 에서도 70 을 요구 → `hardPass=0` 필연.
- 하드코딩 70 이 8개 파일 ~20곳(타입 포함)에 분산 — SSOT 우회. `scaleMismatch` 판정식은 2곳에 중복 정의.

단, 재튜닝의 직접 근거였던 덤프(`scan-eval-20260530124627`)는 `marketSession=HOLIDAY`·`macroState HARD_STALE`
비거래일 샘플 → 본 ADR 은 **수치 재튜닝이 아니라 구조 통합**이다. 임계값은 1도 바꾸지 않는다.

## Decision

1. **SSOT 신설** — `server/trading/gateConfig.ts`:
   - `GATE1_SCORE_SCALE = 10` (×1↔×10 환산 명명 상수, `scoreScale ?? 10` 매직넘버 제거).
   - `LEGACY_GATE1_REQUIRED_SCORE = 70` (하드코딩 70 의 단일 출처).
   - `isGate1RegimeAwareRequiredEnabled()` — `GATE1_REGIME_AWARE_REQUIRED === 'true'` (default OFF).
   - `getRegimeAwareGate1RequiredScore(regime)` = `getEffectiveGateThreshold(regime) * GATE1_SCORE_SCALE`
     (플래그 무관 항상 레짐값 — 섀도 로깅 전용).
   - `resolveGate1RequiredScore(regime)` — 플래그 OFF 면 레거시 70, ON 이면 레짐 인식값.
2. **하드코딩 70 → SSOT 치환** — 8개 포렌식/관측/dry-run 파일(ADR-0476/0481/0482/0484~0488/0491)의
   `requiredScore: 70` / `?? 70` / `|| 70` / 타입 `70 | 65 | 60` · `70` 을 `LEGACY_GATE1_REQUIRED_SCORE`
   (또는 `number` 타입 + 기본값 주석)으로 치환. **byte-equivalent (70 === 70)**.
3. **scaleMismatch SSOT** — `gate1ScoreAccounting.isGate1ScaleMismatch(scoreAvg, netScoreAvg, util)` 로 추출,
   `gate1PositiveScoreStarvation` 가 import (중복 정의 제거).
4. **섀도 병행 로깅** — `Gate1ScoreAccountingReport` 에 `legacyRequiredScore` / `regimeAwareRequiredScore` /
   `regimeAwareGap` / `appliedRequiredScore` / `regimeAwareRequiredActive` 추가, Score Health 섹션에
   `legacyRequired=.. regimeAwareRequired=.. regimeAwareGap=.. applied=.. (ADR-0546 shadow)` 한 줄 추가.
   Phase 2 forward-outcome 관측 데이터 축적용.
5. **정적 가드** — `scripts/check_gate1_required_score_ssot.js` 가 production `.ts` 에서
   `requiredScore .* (?? | || | :) 70` 신규 출현 시 EXIT=1 (SSOT 우회 차단). `validate:all`·`precommit` 등재.

## Guardrails (동작 보존 불변)

- **Phase 1 = 항상 70 동작.** 플래그 OFF 기본 → `resolveGate1RequiredScore` 모든 레짐에서 70.
  스캔덤프 `required=70`, `hardPass/softPass` 현행과 동일 (회귀 0).
- **live 경로 0줄 변경.** `exitEngine`/`kisClient`/`autoTradeEngine`/`tradingOrchestrator`/`entryEngine`
  미수정. R3 Sanity Guard 입력·`hardPass` 산정은 legacy 70 유지.
- **임계 자동 변경 없음** (`thresholdAutoChanged=false` 불변, ADR-0007 하이브리드 상속).
- `GATE1_REGIME_AWARE_REQUIRED=false` 1줄 즉시 롤백. KIS/KRX quota 0 침범. executionImpact=NONE.

## Deferred (Phase 2 — PENDING_WIRING 등재)

- `GATE1_REGIME_AWARE_REQUIRED=true` 운영자 승인 전환 (3영업일+ forward-outcome 비손상 확인 후).
- R3 Sanity Guard 입력을 레짐 인식값으로 승격 (GATE1_PASS_ZERO 해소).
- `entryRevalidationStep`/`entryPolicySemantics.normalizeMacroRegime` 의 regime 라벨 이중 명명
  (`RegimeLevel` R*_TURBO/EARLY vs `MacroRegime` R*_RISK_ON/CAUTION) 정합 — `R3_CAUTION` 은
  `MacroRegime` 의 정규 멤버이므로 **Phase 1 에서 제거하지 않는다**(live 동작 변경 위험). Phase 2 에서
  resolvedRegime 단일 스냅샷 전달 + 분모 폴백(R4=5) 점검과 함께 다룬다.

## Consequences

- Gate1 required-score 의 단일 출처 확립 → 레짐 완화 미전파(buy-order drought 구조 원인) 해소 기반 마련.
- 섀도 로깅으로 Phase 2 전환 의사결정에 필요한 관측 데이터(legacy vs regime-aware) 축적 시작.
- 정적 가드로 향후 SSOT 우회(하드코딩 70 재출현) 차단.
