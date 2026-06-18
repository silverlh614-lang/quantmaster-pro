# ADR-0627 — Gate1 RS Percentile 연속 승격 + Breakout OHLCV 필드명 정정 (positive wiring 갭 교정)

@responsibility Gate1 positive score starvation 의 진짜 wiring 갭 2종(RS percentile step 양자화·breakout OHLCV resolver 필드명 불일치)을 flag default OFF byte-identical 로 교정하는 경계·정책 ADR. requiredScore 70·condition weight 불변, 임계 완화 아님.

- **Status:** Proposed (Phase 0 — 경계·타입·ADR. default OFF byte-identical. 구현은 engine-dev 인계.)
- **Date:** 2026-06-18
- **Branch:** claude/gate2-growth-snapshot-rzifv0
- **Supersedes / Extends:** ADR-0467(positive component 회계)·ADR-0468(ceiling repair dry-run)·ADR-0471(live curve FREEZE)·ADR-0475(positive source wiring·`resolveBreakoutStructureSource` 재사용)·ADR-0613(천장 배선 OFF-by-default — **본 ADR 이 0613 의 입력 resolver 결함을 정정**)·ADR-0546(regime-aware required-score OFF=byte-identical 패턴)·ADR-0157(`=== 'true'` 정확 비교)
- **Patch vs ADR:** ADR (신규 경계/flag + 0613 입력 resolver 정정). INDEX.md 0627→0628 갱신 의무.

---

## Context

운영 실측(매 스캔 반복): Gate1 `finalScoreAvg ≈ 55` < `requiredScore = 70`(gap −14),
`primaryIssue = SCORE_THRESHOLD_NOT_MET`, `INSUFFICIENT_POSITIVE_SCORE` 빈스캔 81%.
진단 SSOT 일관: `suspectedCause = SCORE_CEILING_TOO_LOW`, positive contributors
RELATIVE_STRENGTH avg **+2.5/20**·BREAKOUT_STRUCTURE avg **+0.3/7**(나머지 zero).
모순 신호: `rsScoreUsable=47/47`·`relativeStrengthScoreComputed=47/47`·`breakoutScoreMappedToGate=47/47`
(**계산은 됨**)인데 Gate1 positive 기여는 near-zero.

### Audit 결론 — `SCORE_CEILING_TOO_LOW` 은 오진

- `configuredPositiveMaxScore = 116`(positive 컴포넌트 maxScore 합) ≫ required 70 → **천장은 충분.**
- `observedPositiveMaxScore = 16.6`(실 점화) ≪ 70 → 문제는 **천장이 아니라 positive 점화율(starvation).**
- ADR-0613 은 LIVE 경로에 배선 완료(`minimumSignalScoreTrace.ts:172/179/501`)됐으나 세 transform 모두
  **실효 0** — 입력 resolver 가 잘못된 필드를 본다(아래 두 갭).

### 진짜 갭 2종 (코드 audit 확정)

- **GAP-A (RS step 양자화):** `entryFilterDecomposition/decompositionBuilder.ts:263~266` 가 연속
  percentile `rsRankPct`(0~100)를 5-bucket step(`p≥90→10·≥80→8·≥60→5·≥50→2·else 0`)으로 붕괴.
  p<50 전부 0, p50~60 은 2(→normalized 20). RS avg +2.5/20 의 직접 원인. **연속 정보 손실 버그.**
- **GAP-B (breakout OHLCV 필드명 불일치):** ADR-0613 `gate1PositiveCeilingWiringAdr0613.ts:97~99`
  `resolveBreakoutOhlcvInput` 가 `high20`/`high60` 만 본다. 그러나 trace 카논 필드는 **`high20d`**(d접미,
  `decompositionBuilder.ts:217`). → `hasOhlcv=false` 상시 → flag ON 에서도 breakout OHLCV 재수화 no-op.
  breakout avg +0.3/7 의 직접 원인. (mapped breakoutScore 는 upstream TURTLE_HIGH_NOT_MET 로 zero-by-rule.)
- **부수 정정:** ADR-0613 `applyRsPercentileWiring` 의 입력 `crossSectionalPercentile` 은 production
  **write site 0**(죽은 필드). 실 percentile 은 `rsRankPct`. 0613 RS percentile 경로는 GAP-A 해소에 무력.

### 운영자 제약 (확정·절대)

> requiredScore=70 절대불변·condition weight 불변·STRONG_BUY 불변·CONDITION_PASS_THRESHOLD=5 불변·
> thresholdAutoChanged=false 유지. **본 작업은 점수 wiring 갭 교정이지 임계 완화가 아니다.**

---

## Decision

### 1. GAP-A — RS 연속 percentile 승격 (신규 flag default OFF)

- **flag:** `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` (default OFF, `=== 'true'` 정확 비교 ADR-0157).
  SSOT 함수 `isGate1RsPercentileContinuousEnabled()` (`server/trading/gateConfig.ts`, 호출자 inline ENV 금지).
- **위치:** `decompositionBuilder.ts:263~266`. flag ON 시 `relativeStrengthScore = clamp(rsRankPct/10, 0, 10)`
  (연속 0~10). flag OFF → 기존 step 함수 **byte-identical**.
- 하류 `scoreRelativeStrength` explicit 경로(0~10 → ×10 normalized)가 그대로 소비. maxScore 10·weight 1 무변경.

### 2. GAP-B — breakout OHLCV resolver 필드명 정정 (기존 0613 flag 재사용)

- **위치:** `gate1PositiveCeilingWiringAdr0613.ts:97~99` `resolveBreakoutOhlcvInput`.
  키 배열에 `high20d`·`quote.high20d`·`quoteFeatures.high20d`(high60·high120 동형) 추가.
- 게이팅 그대로 `GATE1_POSITIVE_CEILING_WIRING_ENABLED`(신규 flag 아님). flag OFF → transform 미실행
  → byte-identical. ADR-0475 `resolveBreakoutStructureSource` 재사용(두 번째 공식 신설 금지).

### 3. 관측 dry-run (flag 무관 상시 산출)

- ADR-0613 `computeCeilingWiringHypothetical` 의 breakout hypothetical 이 §2 정정으로 실효화.
- GAP-A 용 신규 hypothetical 필드(force-ON·관측 전용·actualScore 본체 영향 0·try/catch 격리 불변식 #1):
  `rsContinuousPromotionDelta`·`rsContinuousHypotheticalActualScore`·`rsContinuousHypotheticalPassed`.

### 4. 채택 안 함 (명시 기각)

- ADR-0613 `applyPositiveMaxNormalization`(116 분모 정규화) **default OFF 유지·본 PR 미활성.**
  작은 positive 를 `×100/116` 로 축소하는 역효과 + required 70 과 충돌 소지.
- ceiling 인상·required 완화·condition weight 인상·STRONG_BUY/threshold 변경 — 전부 금지.

---

## Consequences

- **flag OFF:** Gate1 점수 산식 byte-identical. 신규 fetch 0(`rsRankPct`·`high20d` 재사용). LIVE 무영향.
- **flag ON:** Gate1 positive 점수 상향(RS 연속 복원 + breakout OHLCV 재수화). 현 SHADOW_ONLY 안전 —
  shadow 관측으로 forward-outcome 성숙 후 운영자 flip. executionImpact OFF=NONE / ON=Gate1 점수 변화.
- **requiredScore 70·weight 불변:** 70 리터럴 무접촉(validator `check_gate1_required_score_ssot.js`
  FORBIDDEN 정규식 무위반). RS maxScore 10·weight 1 무변경.
- **ADR-0471 freezeRule 정합:** step→연속은 이미 계산된 percentile 의 **손실 복원**(0인/저평가 컴포넌트를
  정상 기여), 곡선 완화·weight 인상 아님. p=100 은 step·연속 동일 10(천장 무변), 차이는 중간 구간 선형화.

---

## Alternatives Considered

- **(a) ADR-0613 percentile 경로(`crossSectionalPercentile`) 부활** — 기각. write site 0 죽은 필드.
  실 percentile 은 `rsRankPct`. GAP-A 를 decompositionBuilder 단에서 교정하는 것이 정답.
- **(b) `applyPositiveMaxNormalization` 활성화** — 기각. 116 분모로 작은 positive 축소(역효과) + required 충돌.
- **(c) ceiling 인상 / required 70 완화** — 기각. 천장 116 충분·required 절대불변. starvation 은 점화율 문제.
- **(d) RS maxScore/weight 인상** — 기각. weight 불변 위반. 연속 승격으로 분해능만 복원.
- **(e) 신규 breakout 공식 / 신규 RS 공식** — 기각. ADR-0475 `resolveBreakoutStructureSource`·기존
  `scoreRelativeStrength` 재사용(두 번째 산식 0).
- **(f) default ON** — 기각. opt-in(ADR-0157/0546/0613 선례)·forward-outcome 성숙 후 flip.

---

## References

- 진단 SSOT: `gate1PositiveScoreStarvation.ts`(ADR-0467)·`gate1ScoreCeilingRepair.ts`(ADR-0468)·
  `gate1PositiveSourceWiringAdr0475.ts`(ADR-0475)·`gate1PositiveCeilingWiringAdr0613.ts`(ADR-0613)
- 산식: `minimumSignalScoreTrace/componentScorers.ts`(`normalizedRelativeStrength`·`breakoutScore`)·
  `scoring.ts`(`scoreRelativeStrength`·`normalizeSignalScoreTo100`)·
  `entryFilterDecomposition/decompositionBuilder.ts:217/263`(`high20d`·step 양자화)
- 불변식: CLAUDE.md §2(requiredScore 70 절대보존·weight 불변)·9대 불변식 #1/#6
- 인계: `_workspace/2026-06-18_gate1-positive-wiring/architect/AUDIT_AND_DESIGN.md`
