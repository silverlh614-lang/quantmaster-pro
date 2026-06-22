# ADR-0643 — Gate1 score starvation 실수정 — positive-max-normalization flag 분리 + projectedVolume 전파 계약 + 안전 lever 활성 (flag-gated, default OFF)

@responsibility Gate1 starvation(finalScoreAvg 49.3<70, 0 진입) 실수정의 경계·정책·flag 분리·ENV·타입 계약 SSOT — `GATE1_POSITIVE_CEILING_WIRING_ENABLED` 번들이 동시에 켜던 16/16 과개방 `applyPositiveMaxNormalization` 을 별도 flag 로 분리(default OFF 유지) + breakout high20d 재수화·RS 연속·분모 정합 안전 lever 활성 + `projectedVolume` producer→Gate1 read 전파 배선 계약 확정. requiredScore=70 리터럴·ADR-0471 weighted curve FREEZE·9대 불변식 무위반.

- **Status:** Proposed (Phase 0 — architect: 경계·flag 분리 설계·ENV 계약·타입 계약·projectedVolume 데이터플로우 추적·ADR·INDEX. 구현은 engine-dev 인계.) 운영자 승인 완료.
- **Date:** 2026-06-22
- **Branch:** claude/scan-blockers-diagnostic-wp93a3
- **Supersedes / Extends:** ADR-0613(Gate1 positive-ceiling wiring — 본 ADR 이 그 단일 flag 번들을 분리)·ADR-0640(분모 정합)·ADR-0627(RS percentile 연속)·ADR-0475(breakout structure source SSOT)·ADR-0468(NORMALIZE_TO_100 산식)·ADR-0467(positive component 회계)·ADR-0471(live weighted curve FREEZE — 절대 보존)·ADR-0546(regime-aware required-score OFF=byte-identical 패턴)·ADR-0157(ENV 정확 비교)·ADR-0146(byte-equivalent·wiring vs 인프라)·ADR-0530(Patch Scope Guard)·ADR-0641(flag-lifecycle governance)
- **Patch vs ADR:** ADR (신규 경계/정책 — 신규 ENV flag `GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED` + projectedVolume 전파 배선 계약). INDEX.md 0643→0644 갱신 의무.

---

## Context — Phase 0 추적으로 확정된 4개 사실

운영 스캔: Gate1 `finalScoreAvg=49.3 < required=70`, 0 종목 진입. Phase 0 추적 결과:

### 사실 1 — "score ceiling 16.6" 은 정적 천장이 아니라 동적 분모였다
`gate.availableMaxScore`(결손 component UNAVAILABLE 시 줄어드는 분모)가 16.6 까지 떨어진 것이며,
정적 점수 상한이 아니다. 이미 ADR-0640 분모 정합(`resolveEffectiveRequiredScore`)이 이 갭을
교정하는 코드를 제공하나 flag OFF 상태다.

### 사실 2 — 관련 수정 코드는 이미 존재하나 ENV flag OFF
| lever | 위치 | flag | 안전성 |
|-------|------|------|--------|
| ADR-0640 분모 정규화 | `gate1DenominatorNormalizationAdr0640.ts` `resolveEffectiveRequiredScore` | `GATE1_DENOMINATOR_NORMALIZATION_ENABLED` | 안전 (0.7× floor clamp, 절대 인상 안 함) |
| ADR-0627 GAP-A RS 연속 | `entryFilterDecomposition/decompositionBuilder.ts:269-271` | `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` | 안전 (분해능 복원, maxScore 10·weight 1 무변경, 게이트 단독 개방 안 함) |
| GAP-B breakout high20d | `gate1PositiveCeilingWiringAdr0613.ts:111-119` (별칭 추가 완료) | `GATE1_POSITIVE_CEILING_WIRING_ENABLED` | 안전 (결손 채움, 천장 무변) |

ADR-0640 은 `minimumSignalScoreTrace.ts:510` 에서 **live 판정부 호출**되며,
`:603 passed: actualScore >= effectiveRequiredScore` 로 effective 기준 판정한다.

### 사실 3 (핵심 위험) — flag 번들링
`GATE1_POSITIVE_CEILING_WIRING_ENABLED` **하나가 세 가지를 동시에** 켠다
(`gate1PositiveCeilingWiringAdr0613.ts` 의 3개 export 가 모두 동일 `isGate1PositiveCeilingWiringEnabled()` 게이트):

- **(원함) `applyBreakoutWiring`** (`:143`) — breakout high20d 재수화 (GAP-B). 결손 채움, 안전.
- **(no-op) `applyRsPercentileWiring`** (`:77`) — `crossSectionalPercentile` dead-field read (ADR-0627 이 죽은 필드로 규정, production write site 0). 효과 0.
- **(DANGER) `applyPositiveMaxNormalization`** (`:187`) — `minimumSignalScoreTrace.ts:506` 에서
  **live actualScore 경로 호출**:
  ```
  const computedScore = round1(applyPositiveMaxNormalization(rawComputed, components));
  const actualScore = computedScore;
  ```
  이게 positive 합을 `× (100 / configuredPositiveMax)` 로 정규화 → 스캔 dry-run 에서
  `NORMALIZE_POSITIVE_MAX_TO_100 → survivors 16/16` (게이트 과개방, 선별력 상실).

즉 breakout 정정(GAP-B)을 켜려고 이 flag 를 켜면 **16/16 과개방 정규화가 같이 켜진다.**
운영자 제약: 통과율 target 3~7 (16/16 금지).

### 사실 4 — projectedVolume 이 producer→Gate1 read 사이에서 유실된다
Stage1 producer 는 `projectIntradayVolume(quote.volume)` 로 장중 경과율 보정 일일 예상 거래량을
산출한다 (`pipelineHelpers.ts:508`). 그러나:

- **producer (`pipelineHelpers.ts:470 evaluateStage1Filter`, `:508`)**: `projectedVolume` 은
  stage1 LOW_VOLUME 판정용 **로컬 변수**로만 산출되고, 반환 타입 `Stage1FilterResult{pass, reason?}`
  (`:392`) 에도, candidate/quote 객체에도 **stamp 되지 않는다.**
- **candidate build (`universeScanner.ts:390-398 stage1QuantFilter`)**: CandidateStock 에 `quote` 만
  넣는다. quote 객체에는 `projectedVolume` 필드가 없다 (quote.volume 은 장초반 partial 누적).
- **carry 사슬 (read-only)**:
  - `perSymbolEvaluation.ts:344` — `projectedVolume: w.symbolFeatures?.projectedVolume` (read)
  - `symbolFeatures.ts:145-146` — `provided.projectedVolume ?? finiteFeature(c.projectedVolume)` (read)
  - `decompositionBuilder.ts:214` — `c.projectedVolume ?? symbolFeatures?.projectedVolume` (read)
  - 세 read 경로 전부 upstream 이 비어 있어 `undefined` 로 귀결.
- **consumer (`componentScorers.ts:144-151 volumeLiquidityScore`)**: `projectedVolume → volume → ...`
  순으로 탐색하나 projectedVolume 부재로 partial `volume` 을 쓴다 → ratio<0.5 → normalizedScore 0,
  `penaltyApplied=true` (16 종목 전부). VOLUME_LIQUIDITY maxScore 12 가 통째로 0 + penalty.

이것은 **신규 산식 갭이 아니라 배선 갭**이다. producer 산출값(`projectIntradayVolume`)이
이미 존재하는데 carry 경로의 시작점(producer→candidate stamp)이 비어 있다.

---

## Decision

### D1 — `applyPositiveMaxNormalization` 을 별도 flag 로 분리 (16/16 봉인)

`applyPositiveMaxNormalization` 의 게이트를 `isGate1PositiveCeilingWiringEnabled()` 에서 떼어
**신규 SSOT 함수 `isGate1PositiveMaxNormalizationEnabled()`** (gateConfig.ts) 로 교체한다.
신규 ENV `GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED` (default OFF, ADR-0157 정확 비교 `=== 'true'`).

- 분리 후 `GATE1_POSITIVE_CEILING_WIRING_ENABLED` 는 **breakout(GAP-B)·RS percentile(no-op) 두 개만** 켠다.
- `applyPositiveMaxNormalization` 은 신규 flag OFF 상태로 유지 → live actualScore 경로(`:506`)
  byte-identical (정규화 미적용, rawComputed 그대로) → 16/16 과개방 봉인.

**byte-identical 호환 계약 (ADR-0146):** 기존 단일 flag `GATE1_POSITIVE_CEILING_WIRING_ENABLED=true`
ON 동작은 **두 flag 를 함께 ON** (`GATE1_POSITIVE_CEILING_WIRING_ENABLED=true` +
`GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED=true`) 으로 정확히 재현 가능해야 한다.
즉 `applyPositiveMaxNormalization` 의 게이트는 다음 동치를 만족한다:

```
신규: isGate1PositiveMaxNormalizationEnabled()
  === (process.env.GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED === 'true')
```

**관측 ledger 영향 0:** `computeCeilingWiringHypothetical`
(`gate1PositiveCeilingWiringAdr0613.ts:221`) 는 `applyPositiveMaxNormalization(..., true)`
force-ON 모드로 호출하므로(`:236`) 신규 flag 와 무관하게 hypothetical delta 를 계속 stamp 한다.
관측 가시성 무회귀.

### D2 — 활성 결정 (운영자 flip 대상)

| flag | Phase 0 권고 | 근거 |
|------|-------------|------|
| `GATE1_DENOMINATOR_NORMALIZATION_ENABLED` | **ON 권고** | 안전 (0.7× floor, 절대 인상 안 함). 사실 1 의 동적 분모 starvation 직접 교정. |
| `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` | **ON 권고** | 안전 (분해능 복원, 게이트 단독 개방 안 함). |
| `GATE1_POSITIVE_CEILING_WIRING_ENABLED` | **ON 가능 (D1 분리 후)** | 분리 후 breakout(GAP-B)+RS no-op 만 켬. 16/16 정규화 비포함. |
| `GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED` | **OFF 유지** | 16/16 과개방. 통과율 target 3~7 위반. forward-outcome 성숙 전 flip 금지. |

flip 실행은 본 ADR 의 코드 분리 머지 후 별도 운영 단계. 본 ADR 은 default 전부 OFF 로
byte-identical 머지 (ADR-0146 byte-equivalent — LIVE 본체 0줄 변경, ENV 1줄 롤백).

### D3 — projectedVolume 전파 계약 (배선 갭 정정, 신규 산식 금지)

producer 산출값 `projectIntradayVolume(quote.volume)` 을 Gate1 이 읽는
`CandidateEntryTrace.projectedVolume` 까지 **단일 stamp 지점에서 전파**한다.

**계약: stamp 지점은 producer 경계 — `pipelineHelpers.ts evaluateStage1Filter` 반환 또는
`universeScanner.ts:390-398` candidate build.** 둘 중 하나를 SSOT stamp 로 pin 한다.
권고: **producer (`evaluateStage1Filter`) 가 projectedVolume 을 반환에 포함**하고,
candidate build 가 그 값을 candidate/quote 로 stamp. carry 사슬
(`symbolFeatures:145 → decompositionBuilder:214 → perSymbolEvaluation:344`) 은 이미 read 배선이
완료되어 있으므로 **변경 불필요** (upstream 만 채우면 자동 전파).

제약:
- **신규 산식 금지** — `projectIntradayVolume`(`pipelineHelpers.ts:314`) 재사용. 2번째 projection 공식 신설 금지.
- **stamp 1회** — 동일 값을 carry 사슬 여러 곳에서 재계산 금지 (drift 방지, 불변식 #3).
- `projectedVolume` 부재 시 graceful — `volumeLiquidityScore` 는 `volume` fallback 유지
  (불변식 #6: 결손이 bearish penalty 로 둔갑하지 않도록, ADR-0640 분모 정합과 결합 시 결손 축은
  분모 제외로도 보호됨).

### D4 — 불변 보존 (FREEZE)

- **requiredScore=70 리터럴 불변** — gateConfig requiredScore SSOT 미수정. effective 축소는
  ADR-0640 경로(분모 제외 비례)로만, 70 리터럴은 그대로.
- **weighted curve 불변 (ADR-0471 FREEZE)** — `weightedFromNormalized`·각 component maxScore·weight
  무변경. 본 ADR 은 분모(D1 분리로 정규화 OFF 유지)·임계(D2 미수정)·배선(D3)만 다룬다.
- **9대 불변식 무위반** — SourceSnapshot 우회 0(불변식 #3·#9, projectedVolume 은 quote 파생 in-snapshot),
  provider 장애→bearish 변환 0(불변식 #6), Trading Engine/Shadow 정지 0(불변식 #1·#2,
  hypothetical 관측은 force-ON·try/catch 격리 유지).

---

## Consequences

### 긍정
- breakout high20d 재수화(GAP-B)를 16/16 과개방 정규화와 **독립적으로** 켤 수 있다 (운영자 통제 회복).
- 분모 정합(ADR-0640) + RS 연속(ADR-0627) 안전 lever 가 starvation 의 동적 분모 근본을 교정.
- projectedVolume 전파로 VOLUME_LIQUIDITY(maxScore 12)가 장초반에도 정당 점수 획득 → 16 종목 일괄 0/penalty 해소.
- 모든 신규 동작 default OFF → 머지 시 LIVE byte-identical, ENV 1줄 롤백.

### 부정 / 비용
- ENV flag 1개 추가 (`GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED`) — governance(ADR-0641) 추적 대상.
- D3 producer stamp 1줄 추가 — Stage1 핫패스이나 `projectIntradayVolume` 은 이미 매 quote 호출 중
  (재사용, 신규 연산 0). projectedVolume 미stamp 시 기존 동작과 byte-identical(read 경로 ?? fallback).

### 회귀 가드
- D1 분리: `GATE1_POSITIVE_CEILING_WIRING_ENABLED=true` 단독 ON 시 actualScore 가 정규화되지 않음을
  검증하는 테스트 (분리 전: 정규화됨 / 분리 후: 정규화 안 됨, 신규 flag OFF). 두 flag 동시 ON = 기존 동작 재현.
- D3 전파: projectedVolume stamp 후 volumeLiquidityScore ratio 가 partial volume 이 아니라 projected
  기준임을 검증.
- baseline 무회귀 (ADR-0146 카테고리 5) — 전 flag default OFF 로 기존 통과율 baseline 무변경.

---

## Alternatives Considered

1. **`applyPositiveMaxNormalization` live 호출(`:506`)을 영구 제거** — 거부. ADR-0613 hypothetical
   관측 ledger 가 force-ON 으로 그 함수를 재사용하므로 함수 자체는 보존 필요. flag 분리가
   최소 침습 + governance 추적 가능.
2. **단일 flag 유지하고 통과율로 사후 필터** — 거부. 16/16 과개방은 선별력 상실(선별기 자체 무력화).
   사후 필터는 임계 calibration(ADR-0471 FREEZE)을 우회하는 hack.
3. **projectedVolume 을 carry 사슬 중간(symbolFeatures)에서 재계산** — 거부. drift(불변식 #3),
   2번째 projection site. producer 단일 stamp 가 SSOT.
4. **분모 정합 대신 requiredScore 리터럴 인하** — 거부. ADR-0471 FREEZE 위반 + 70 calibration 손실.

---

## References

- `server/trading/signalScanner/gate1PositiveCeilingWiringAdr0613.ts:77,143,187,221` — 분리 대상 3 transform + hypothetical
- `server/trading/signalScanner/minimumSignalScoreTrace.ts:506,510,603` — live actualScore·effectiveRequiredScore·passed 호출부
- `server/trading/signalScanner/gate1DenominatorNormalizationAdr0640.ts:47` — `resolveEffectiveRequiredScore`
- `server/trading/signalScanner/entryFilterDecomposition/decompositionBuilder.ts:214,269-271` — projectedVolume carry read · RS 연속
- `server/trading/signalScanner/minimumSignalScoreTrace/componentScorers.ts:144-151` — `volumeLiquidityScore` consumer
- `server/screener/pipelineHelpers.ts:314,470,508,392` — `projectIntradayVolume` · `evaluateStage1Filter` · stamp 갭 · `Stage1FilterResult`
- `server/screener/universeScanner.ts:390-398` — candidate build 경계
- `server/trading/signalScanner/entryFilterDecomposition/symbolFeatures.ts:145-146` · `perSymbolEvaluation.ts:344` — carry read 경로
- `server/trading/gateConfig.ts:207,227,240` — flag SSOT 함수
- `.env.example:247,255,258` — 기존 flag 항목
- ADR-0613·0640·0627·0475·0468·0471·0157·0146 — extends/freeze
