# Gate1 Score Threshold / Scale 보정 분석 (2026-06-08)

> **type: 분석 문서 (docs-only).** 소스 코드 변경 0건 · ADR 발급 0건 · executionImpact=NONE.
> 근거 스캔: `scan-eval-20260608104213` (2026-06-08 10:42 KST, candidates=49).
> 목적: "Gate1 점수가 임계에 못 미치는 것이 **버그(배선 회귀)인가, 시장 상태인가, 임계 보정 대상인가**" 를
> 관측 데이터로 판정하고, 임계/스케일 변경의 정당성 유무를 기록한다. **변경 권고 아님 — 관측 근거 정리.**

---

## 0. 결론 (TL;DR)

- **패치 불필요.** 점수 미달의 1차 원인은 약세 레짐(R6_DEFENSE / BEAR)에서의 **진짜 약한 돌파·모멘텀 신호**이며
  데이터 배선 회귀가 아니다 (`classification: wiringRecovered=true marketConditionMissing=true patchNeeded=false`).
- 임계 완화 인프라(ADR-0546 regime-aware window, env-gated)는 **이미 완비**되어 있다. 활성화를 막는 것은
  코드가 아니라 **forward-outcome 표본 미성숙**(D5 mature=0)이다.
- 스케일 불일치(`configuredPositiveMax=116` vs `observedPositiveMax=50.6`)는 **표시·관측 전용**이며
  정규화 dry-run 에서 생존자 증가가 없다(10→10). 실행 영향 0.
- 권고: **3영업일 forward outcome 성숙 후 재검토.** 그 전 임계/스케일 변경은 ADR-0471 freeze + operator 승인
  + KIS-primary 불변식에 비추어 근거 미달.

---

## 1. 점수 분포 실측 (직전 스캔)

| 지표 | 값 |
|------|-----|
| finalScoreAvg | **54.8** |
| requiredScore (legacy) | **70.0** |
| scoreGap | **-15.2** |
| finalScoreMin~Max | 37.4 ~ 78.6 (range 41.2) |
| rawPositiveAvg | 27.1 |
| effectivePenaltyAvg | 6.3 (실효) / diagnostic 23.0 (비실행) |
| hardPass / softPass | 5 / 46 |
| minSignalLivePass | 5 |
| primaryIssue | `SCORE_THRESHOLD_NOT_MET` |

Score Band Ledger (n=33):

| band | count | D5 mature |
|------|-------|-----------|
| 70+ | 13 | 0 |
| 65~70 | 1 | 0 |
| 60~65 | 1 | 0 |
| 55~60 | 0 | 0 |
| below55 | 18 | 0 |

→ 70+ 가 13건 존재하나 **전부 정책(SHADOW_ONLY)으로 live 미승격**, 성숙 표본은 0.

---

## 2. 점수 미달의 원인 분해 (배선 vs 시장)

### 2.1 배선은 정상 (회귀 아님)
- RS rawComputed=49/49, applied 49/49 · PRICE_MOMENTUM computed 49/49 · BREAKOUT mapped 49/49 ·
  watchlist verified 49/49 · KIS metadataCarryInvariant=OK.
- 수급 semantic 44/49 GATE_SCORE_ELIGIBLE (나머지 5 = SHADOW_ONLY_NEUTRAL, `marketSignal=false`).
- Gate1 Score Invariants 11종 전부 `[OK]` (label consistency / penalty separation / survivor taxonomy 등).

### 2.2 점수가 안 오르는 실제 원인 = 약한 시장 신호
양수 기여 분해:

| 컴포넌트 | 평균 기여 | 기여 종목수 |
|----------|----------|-------------|
| TECHNICAL_TREND | +12.4 | 49 |
| PRICE_MOMENTUM | +8.2 | 39 |
| RELATIVE_STRENGTH | +4.3 | 27 |
| WATCHLIST_UPSTREAM_SCORE | +1.6 | 49 |
| VOLUME_LIQUIDITY | +0.3 | 2 |
| BREAKOUT_STRUCTURE | +0.1 | 3 |

zero 기여: WATCHLIST_PRIORITY 49, SECTOR_RELATIVE_STRENGTH 49, GHOST_SIGNAL_STRENGTH 49,
VOLUME_LIQUIDITY 47, **BREAKOUT_STRUCTURE 46**. 누락: VCP 49.

- **BREAKOUT_STRUCTURE 46/49 zero 의 사유는 `TURTLE_HIGH_NOT_MET`** — 종목이 신고가 근처에 있지 않음.
  약세장에서 당연한 결과이지, feature 미배선이 아니다 (traceAvailable 49/49, missingByMapping 0).
- PRICE_MOMENTUM return5d 평균 -3.3% — 단기 약세가 점수에 정직하게 반영됨.

**판정: 점수 부족은 "신호가 실제로 약하다" 의 정직한 표현.** provider/unknown 을 bearish 로 변환한 결과 아님
(`ProviderIssueConvertedToBearish=false`).

---

## 3. 스케일 불일치 (configured 116 vs observed 50.6)

| 지표 | 값 |
|------|-----|
| configuredPositiveMax | 116.0 |
| observedPositiveMax | 50.6 |
| utilizationByMax | 43.6% |
| utilizationByAvg | 23.4% |
| scaleMismatch | true (observationOnly=true) |
| suspectedCause | SCORE_CEILING_TOO_LOW |

- 구성상 양수 천장(116)이 실측 도달 천장(50.6)을 과대표기 → **표시상의 불일치**.
- 단, ADR-0468 repair dry-run 에서 `NORMALIZE_POSITIVE_MAX_TO_100` 적용해도 **survivors 10→10**.
  즉 스케일 정규화는 생존자를 늘리지 않는다 — 천장이 낮아서가 아니라 신호가 약해서 점수가 안 차는 것.
- 결론: 스케일 보정은 **표시 정합(cosmetic) 이슈**로 분류. 실행/생존 영향 0이므로 단독 패치 정당성 없음.
  (만약 진행한다면 별도 표시-정합 patch type 로, 매매 본체 byte-equivalent 보장 하에.)

---

## 4. 임계 완화 시나리오 — 인프라는 완비, 표본이 미성숙

### 4.1 현재 코드 상태
- `gateConfig.ts`: `LEGACY_GATE1_REQUIRED_SCORE = 70` (SSOT, 하드코딩 우회 금지).
- regime-aware 경로 구현 완료: `getRegimeAwareGate1RequiredScore(regime)` + env 스위치
  `GATE1_REGIME_AWARE_REQUIRED` (**default OFF**, Phase 1 동작 보존).
- ADR-0546 Phase2 롤업(`gate1RegimeAwareWindowAdr0546.ts`)이 `[regimeAwareRequired, legacyRequired)` 창의
  forward 성과를 70+ 밴드와 대조 — **operator 가 감으로 낮추지 못하게 하는 근거 머신**.

### 4.2 완화했을 때의 추정 (관측 전용)
- regimeAwareRequired=60.0, legacyRequired=70.0, gap=10.0, **active=false**.
- `regimeAwareWouldPass=7/30` (symbols 402340,012330,009150,353200,032580,021240,032830).
- MinSignal 마스킹 sweep: thresholdMinus5Survivors=7, thresholdMinus10Survivors=19.

### 4.3 활성화를 막는 진짜 게이트 = 표본
- `verdict=INSUFFICIENT_SAMPLE` (창/70+ 양쪽 D5 mature ≥30 필요, **현재 0**).
- Gate1 Threshold Evidence: totalSamples=33, **matureD5=0**, `confidence=INSUFFICIENT_SAMPLE`,
  `reviewReady=false`.
- reviewBlockers: `SCORE_BAND_D5_SAMPLE_LT_30`, `TOTAL_D5_SAMPLE_LT_100`,
  `SIXTY_TO_SEVENTY_NOT_COMPARABLE`, `BELOW55_DEFENSE_NOT_CONFIRMED`,
  `FALSE_NEGATIVE_RATE_INSUFFICIENT`, `MFE_MAE_TIMING_SPLIT_INSUFFICIENT`.

**판정: 임계를 70→60 으로 내릴 데이터 근거가 아직 없다.** 인프라가 없어서가 아니라, 그 인프라가 요구하는
forward 성과(D5 ≥30 표본)가 안 모였다. 코드 패치로 해결되는 문제가 아님.

---

## 5. 패치 후보 검토 결과 (전부 기각/보류)

| 후보 | 판정 | 사유 |
|------|------|------|
| Gate1 임계 70→60 인하 | **보류** | D5 mature=0, INSUFFICIENT_SAMPLE. ADR-0471 freeze + operator 승인 필요 |
| Positive Max 116→100 정규화 | **기각(단독)** | survivors 10→10, 표시-정합 cosmetic. 실행 영향 0 |
| regime-aware env 기본 ON 전환 | **기각** | 관측 표본 미성숙 상태 활성화 = 검증 없는 완화 |
| BREAKOUT/RS feature 추가 배선 | **불필요** | 이미 49/49 배선·매핑 완료. zero 는 시장 상태(TURTLE_HIGH_NOT_MET) |
| UNKNOWN penalty 재보정 | **불필요** | effective penalty 0.0, diagnostic-only. gateScoreImpact 0 |

---

## 6. 권고 (nextAction)

1. **3영업일 forward outcome(1D/3D/5D) 관측 지속** — ADR-0476 ledger(33 rows) 성숙 대기.
2. D5 표본 밴드별 ≥30 / 전체 ≥100 도달 시 `regimeAwareWindow.verdict` 재확인:
   - `WINDOW_OUTPERFORMS_70PLUS` 또는 `COMPARABLE` → 그때 operator 승인 하에 완화 검토.
   - `WINDOW_UNDERPERFORMS_70PLUS` → 70 유지 확정.
3. 그 전까지 **코드·임계·스케일 무변경.** Shadow/Counterfactual 학습은 계속 기록(executionImpact=NONE).
4. 표시-정합(스케일 116→100)을 정리하고 싶으면, 매매 본체 byte-equivalent 보장하는 **별도 표시 patch** 로 분리.

---

## 부록 — 무결성 확인

- 9대 불변식 무위반: Trading Engine alive, Shadow 지속, SourceSnapshot 단일(`scan-eval-20260608104213`),
  providerIssue ≠ bearish, AI_ESTIMATED live 미사용.
- `liveExecutionAllowed=false`, `thresholdAutoChanged=false`, `operatorApprovalRequired=true` 전 구간 일관.
- Gate1 Score Invariants 11/11 `[OK]` · Gate2 DataLine Invariants 19/19 `[OK]` · Gate3 Finalization 100/100.
