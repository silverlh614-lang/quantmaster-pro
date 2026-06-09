# ADR-0594: Gate1 Regime-Aware Reversal Momentum Credit — risk-on 국면 한정 오늘-단일일 강세 가산 (shadow-gated, default OFF)

@responsibility policy — risk-on/반전 국면에서만 종목의 오늘 단일일 강세(quote.changePercent)를 Gate1 PRICE_MOMENTUM 점수에 bounded 양수 보너스로 가산해 다일집계 후행으로 묻힌 반등 리더를 차별화 (shadow-gated, default OFF, ADR-0593 레짐 게이트 재사용 후보)

## Status

Proposed (구현 완료 — default OFF byte-equivalent, shadow-gated)

## 구현 default (engine-dev 확정, 2026-06-09)

D1~D6 구현 시 §미해결 항목에 대해 다음 default 를 확정했다 (전부 ENV 오버라이드 제공, default OFF):

- **모듈:** `server/trading/signalScanner/reversalMomentumCredit.ts` (순수 SSOT, `riskOnFastUpgrade.ts` 동형).
  `computeReversalMomentumCredit(input): { bonus, applied, reason }` + `buildPriceMomentumReversalApplier`
  (call-site clamp applier·진단 묶음) + 4 ENV 헬퍼(정확비교·유한성·범위 가드).
- **flag:** `GATE1_REVERSAL_MOMENTUM_ENABLED` (default OFF, `=== 'true'` 정확 비교).
- **MAX_BONUS = 8** (`GATE1_REVERSAL_MOMENTUM_MAX_BONUS`) — PRICE_MOMENTUM maxScore 20 내 일부.
- **T_min = 3.0%** (`GATE1_REVERSAL_MOMENTUM_T_MIN_PCT`) — noise floor, 미만 가산 0.
- **T_cap = 12.0%** (`GATE1_REVERSAL_MOMENTUM_T_CAP_PCT`) — 초과 과급등은 MAX_BONUS **cap**(가산 미증가,
  역가산/감쇠 채택 안 함; 추격은 regime-gate 가 이미 차단). §미해결 #2 → cap 확정.
- **게이트 = §D3 (권장) canonical RISK_ON_REGIMES** (`['R1_TURBO','R2_BULL','R3_EARLY']`, 모듈 내 재선언)
  — 배선 0·src↔server 경계 무관. 이 집합으로 게이팅하면 ADR-0593 fast-upgrade(breadth+VKOSPI 통과 시에만
  R3 승급)를 transitively 상속 → breadth/VKOSPI 재게이팅 불필요(이중게이트 회피). §미해결 #3 → canonical 확정.
- **가산 적용:** PRICE_MOMENTUM weightedScore 에 bonus 직접 가산 후 `clamp(_, 0, 20)` — maxScore 20 천장 불변
  (ADR-0467 양수 회계). normalizedScore 는 다일집계 기반 그대로(진단 정합). flag OFF/non-risk-on/changePercent
  부재 → bonus 0 → weightedScore 100% 보존(byte-equivalent, 회귀 테스트 증명).
- **진단:** PRICE_MOMENTUM rawValue 에 `reversalCreditApplied`/`reversalBonus`/`reversalGateReason`/
  `reversalTodayChangePercent` additive 필드 + message 가산 노출(silent 금지).
- **테스트:** `reversalMomentumCredit.test.ts`(진리표 25케이스) +
  `gate1ReversalMomentumCreditWiringAdr0594.test.ts`(flag OFF byte-equivalent·flag ON 가산·20 clamp·
  non-risk-on 불가산·changePercent 부재 보수).

## Context

### 증상 (2026-06-09 현장, 진단 완료 — 재도출 불필요, 코드 검증만)

폭락 다음날 KOSPI 강반등(+7.45%)에도 Gate1 신호 점수가 70 근처에 못 간다. ADR-0592(R6 회복)·
ADR-0593(레짐 risk-on 조기 승급)가 **레짐 분류기**의 "lagging 다일집계 + 상승 fast-path 부재"
비대칭을 수리했으나, **종목 점수 루브릭(Gate1 min-signal)**에는 동일 병의 Gate1판이 잔존한다:
레짐을 risk-on 으로 올려도 종목 점수가 따라오지 않는 단절.

### 근본 원인 — 점수 루브릭에 "오늘의 단일일 강세" 입력 부재 (코드 검증)

`server/trading/signalScanner/minimumSignalScoreTrace.ts` 검증:

- **PRICE_MOMENTUM (maxScore 20, 양수 컴포넌트 중 최대 가중):** `buildMinimumSignalScoreTrace`
  line 699 `priceMomentumScore(input.trace)` → component line 702-719, `maxScore: 20`.
- **`priceMomentumScore` (line 477-548) 입력은 전부 다일집계:** `return5d`(line 486-494)·
  `return20d`(line 495-505)만 소비. `r5Score = clamp(((r5+5)/15)*100, 0, 100)`(line 512-513),
  `r20Score = normalizeAbsoluteReturn20dTo100(r20)`(line 514-515), 두 점수 평균
  (line 517-518) → `weightedFromNormalized(normalizedScore, 20)`(line 531). **오늘 단일일
  수익률 입력 0.**
- **RELATIVE_STRENGTH (maxScore 10, line 305-311)** 도 `relativeReturn20d`/`return20d`/
  `return5d` 다일집계 입력.
- **폭락이 5일창을 오염:** 진단 표본(`gate1-score-threshold-analysis-20260608.md` §2.2)에서
  PRICE_MOMENTUM 평균 기여 +8.2(천장 20 대비 41%), return5d 평균 −3.3%. 폭락 다음날엔
  return5d avg 가 음수(−6.6%)로 더 깊어 +7.45% 강반등 당일에도 momentum 점수가 바닥.
- **BREAKOUT_STRUCTURE (maxScore 10, line 776-788, `breakoutScore` line 393-475):**
  신고가 근접(turtle high) 요구 → 폭락 저점에서의 반등은 `TURTLE_HIGH_NOT_MET` → 0
  (위 분석 §2.2: 46/49 zero, 사유 `TURTLE_HIGH_NOT_MET`).
- **전수 확인:** `minimumSignalScoreTrace.ts` 전체에서 `changePercent`/`prdy_ctrt`/`todayReturn`/
  `intraday` grep 0회 = 오늘 단일일 강세 입력 부재 확정.

### 결과 — 신호 점수 천장 붕괴 + 반등 리더 미차별화

`gate1-score-threshold-analysis-20260608.md` §3 실측: `configuredPositiveMax=116` vs
`observedPositiveMax=50.6`(도달률 43.6%). 위 분석은 "신호가 실제로 약하다"의 정직한 표현이며
배선 회귀가 아니라고 결론지었으나(맞다), **반전 국면에서는 그 결론이 부분적이다**: 폭락 다음날
강반등을 주도하는 종목(오늘 +상승률 큰 리더)이 5일창 오염으로 소외주와 점수 차별화가 안 된다.
ADR-0593 이 레짐을 R3_EARLY 로 올려 universe 에 리더를 *유입*시켜도, Gate1 종목 점수가 따라오지
않으면 STRONG_BUY/requiredScore 70 게이트에서 다시 묻힌다 (레짐↔점수 단절).

### 데이터 흐름 — 수정 진입점 확정 (신규 배선 0, quota 0)

- **regime 컨텍스트 이미 threaded:** `buildMinimumSignalScoreTrace` 는 이미 `regime: string`
  (line 655)·`macroGateState`(line 657) 를 입력으로 받는다. risk-on 게이트를 *call-site*
  (priceMomentum 가산)에서 적용 가능 — 신규 regime 조회·배선 불필요.
- **오늘 강세 필드 이미 수집됨:** `CandidateEntryTrace.quote.changePercent?: number`
  (`entryFilterDecomposition/types.ts:409`) 존재 — 신규 KIS/KRX fetch 0(quota 0).
  PRICE_MOMENTUM 이 현재 소비하지 않을 뿐, 값은 trace 에 이미 있다.

## Decision

risk-on/반전 국면에서만 종목의 **오늘 단일일 강세(`quote.changePercent`)**를 Gate1
PRICE_MOMENTUM 점수에 **bounded 양수 보너스**로 가산하는 **flag-gated 경로**를 도입한다.
ADR-0593(레짐 risk-on)·ADR-0550(Stage1 score normal/risk-on 분기)의 Gate1판 대칭이다.
default OFF 시 PRICE_MOMENTUM 점수 100% 보존(byte-equivalent).

### D1. reversal momentum credit 순수 SSOT (신규 모듈)

신규 모듈 `server/trading/signalScanner/reversalMomentumCredit.ts` 를 **반전 모멘텀 가산
판정·산출의 순수 SSOT** 로 둔다 (ADR-0593 `riskOnFastUpgrade.ts` 분리 선례, ADR-0467
양수 컴포넌트 회계 정합). 입력 = 오늘 단일일 수익률(`changePercent`) + regime 컨텍스트
(risk-on 여부). 출력 = PRICE_MOMENTUM 에 더할 **bounded 양수 보너스(점수, ≥0)** + 진단 사유.
순수 함수 — provider/store/now 호출 0.

가산 공식 (초기 제안, counterfactual 튜닝 대상):

```
bonus = 0  (default — 아래 게이트 미충족 시 항상 0)

게이트 충족 시:
  c = quote.changePercent (today single-day return %)
  if c < T_min: bonus = 0                       // 미미한 강세는 미보상 (noise 격리)
  else if c <= T_cap: bonus = scale·(c − T_min) // 선형 가산
  else (c > T_cap, 과급등): bonus = capBonus, 또는 역가산/감쇠 (난제 §아래)
  bonus = clamp(bonus, 0, MAX_BONUS)            // 상한
```

- `T_min` (가산 시작 임계, 제안 +3.0%) — noise floor. 미미한 상승은 보상 0.
- `T_cap` (과열 상한 임계, 제안 +12~15%) — 이 위는 buy-the-top 위험 → 가산 미증가/감쇠.
- `MAX_BONUS` (보너스 상한) — **PRICE_MOMENTUM maxScore 20 내 일부**(제안 6~8점), 또는
  **별도 소액 보너스로 정규화 점수 상향**. 천장 회계(configuredPositiveMax)와의 정합 §Guardrails.
- 전부 ENV 오버라이드 제공. **운영자 확정 필요** (§미해결).

### D2. priceMomentumScore 가산 적용 (flag-gated, 양수만)

`priceMomentumScore` 또는 그 call-site(`buildMinimumSignalScoreTrace` line 699)에서 reversal
credit 을 **양수 보너스로만** 적용:

```
// flag ON + risk-on regime + changePercent 충족 → PRICE_MOMENTUM normalizedScore 상향
const credit = evaluateReversalMomentumCredit({ changePercent, regime });
normalizedScore = clamp(normalizedScore + credit.bonusNormalized, 0, 100);
// weightedScore 는 가산된 normalizedScore 로 재산출 — maxScore 20 천장 불변
```

- **양수 보너스만** — hard-fail/감점 로직 무변경(설계 제약 #3). 가산은 점수를 **올리기만** 한다.
  어떤 입력도 기존 PRICE_MOMENTUM 점수보다 낮아지지 않는다(ADR-0572 단방향 cap 패턴).
- flag OFF → `evaluateReversalMomentumCredit` 즉시 0 반환 → 기존 점수 100% 보존(byte-equivalent).
- **maxScore 20 천장 불변** — 가산은 normalizedScore(0~100) 내에서만, weightedScore 는
  `weightedFromNormalized(normalizedScore, 20)` 로 재산출 → 컴포넌트 천장 20 유지(ADR-0467
  양수 회계 정합, configuredPositiveMax 불변).

### D3. regime 게이트 — risk-on 인식 일관성 (ADR-0593 게이트 재사용 검토)

가산 발동 게이트는 **ADR-0593 이 레짐을 risk-on 으로 인식한 그 조건과 동일**해야 "레짐↔점수"
단절이 해소된다(레짐이 반전 인식 → Gate1 도 반전 강세 보상). 두 후보:

- **(권장) ADR-0593 canonical risk-on 소비:** `input.regime ∈ RISK_ON_REGIMES`
  (R1_TURBO/R2_BULL/R3_EARLY, `pipelineHelpers.ts:643`). ADR-0593 의 provisional R3_EARLY
  승급이 ON 이면 이 집합에 자연 포함 → **동일 게이트 재사용, 신규 게이트 0**. ADR-0550 의
  `calcStage1Score` 가 동일 canonical risk-on 집합으로 normal/risk-on 분기하는 패턴과 동형.
- **(대안) `riskOnFastUpgrade.ts` eligibility 직접 소비:** ADR-0593 `shouldFastUpgradeToR3Early`
  자격을 Gate1 가산 게이트로 직접 재사용. 단 src↔server 경계·input 주입 추가 필요.

**난제 — 과열 천장 추격(buy-the-top) 경계 (ADR 본문 핵심):**
단일일 급등을 무조건 가산하면 +7.45% 꼭대기 추격이 된다. 3중 방어:
1. **regime-gated:** 평시(R4_NEUTRAL normal)엔 가산 0(byte-equivalent). risk-on/ADR-0593
   fast-upgrade-eligible 컨텍스트에서만 발동 — ADR-0550 normal(눌림목) vs risk-on(모멘텀)
   분기 차용. risk-on 국면에서의 강세는 "테이프를 따르는" 정당한 모멘텀이지 고립된 급등이 아니다.
2. **bounded:** `T_cap`(예 +12~15%) 위 과급등은 가산 미증가(cap) 또는 역가산/감쇠 — 단일 종목의
   고립 급등(거래정지·이상 급등)을 추격하지 않음. `MAX_BONUS`(예 6~8점) 상한으로 PRICE_MOMENTUM
   maxScore 20 의 일부만 차지.
3. **breadth/레짐 정합:** ADR-0593 게이트 재사용 시 그 게이트가 이미 breadth 우위 + VKOSPI 진정을
   AND 로 요구 → "시장 전체가 반등 중"일 때만 종목 가산. dead-cat-bounce 의 고립 급등은 게이트 미통과.

### D4. 타입 변경 — additive optional

- 신규 입력 타입은 `reversalMomentumCredit.ts` 내부 interface 로 격리 (RegimeVariables/
  MacroState 확장 불필요 — regime/changePercent 모두 기존 input 에서 도달).
- `CandidateEntryTrace.quote.changePercent` 는 이미 optional 존재(types.ts:409) — 타입 변경 0.
- 가산 진단 노출용으로 PRICE_MOMENTUM component rawValue 에 `reversalCreditApplied`(boolean)·
  `reversalBonus`(number)·`reversalGateReason`(string) additive 필드 추가(표시 전용).

### D5. 단계적 활성화 (ADR-0592/0593/0581 phased 선례)

신규 ENV `GATE1_REVERSAL_MOMENTUM_ENABLED` (default OFF). 헬퍼는 ADR-0593 `riskOnFastUpgrade.ts`
패턴 동형(`isGate1ReversalMomentumEnabled()`, `=== 'true'` 정확 비교).

1. **Phase 0 (데이터 가시화):** flag OFF — `evaluateReversalMomentumCredit` 가 가산 없이
   진단만(`[GATE1_REVERSAL_MOMENTUM_OBSERVE]` 로그: changePercent/regime/would-be bonus).
   PRICE_MOMENTUM 점수 byte-equivalent.
2. **Phase 1 (shadow 관측):** N영업일 counterfactual — flag ON 가정 시 가산됐을 종목·승급량
   기록. buy-the-top 사후 성과(가산 후 진입 종목의 forward outcome) 추적.
3. **Phase 2 (검증):** 반등 리더 점수 차별화 효과 + 과열 추격 false-positive 율 counterfactual
   검증 (ADR-0546 forward-outcome ledger 와 같은 성숙 게이트).
4. **Phase 3 (live 기여):** 운영자 ENV ON → risk-on 국면 Gate1 점수에 반전 강세 반영.

### D6. 진단 가시화 (silent 금지)

- 가산 발동 시 `[GATE1_REVERSAL_MOMENTUM]` 로그 — changePercent·regime·bonus·T_min/T_cap·
  executionImpact 명시.
- regime non-risk-on/changePercent 부재로 미발동 시 사유 로그(silent swallow 금지, SDS 정책).
- PRICE_MOMENTUM message 에 가산 적용 여부 노출(/scan_blockers 진단 정합).

## Guardrails (ADR-0550/0593 상속)

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated. (changePercent 는 기존 trace 필드 — fetch 0)
- **No Gate1 hard-block change** — 가산은 **양수 보너스만**. hard-fail/감점/`requiredScore 70`
  게이트·blockerReason 무변경. ADR-0467 양수 컴포넌트 회계 정합(maxScore 20 천장 불변).
- **No Gate/Kelly/STRONG_BUY threshold change** — requiredScore·STRONG_BUY 게이팅 임계 무변경.
  점수만 상향(게이트가 점수를 평가하는 방식은 불변).
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated (changePercent 기존 수집 필드, fetch 0).
- No data promotion behavior change unless explicitly stated.

## Consequences

### 긍정

- risk-on/반전 국면에서 폭락 다음날 강반등 리더가 PRICE_MOMENTUM 점수로 소외주와 차별화 →
  ADR-0593 이 universe 에 유입시킨 리더가 Gate1 점수 게이트도 통과 가능(레짐↔점수 단절 해소).
- PRICE_MOMENTUM 의 다일집계 후행 비대칭 구조 완화 — 레짐 fast-path(ADR-0593)의 종목-점수 대칭.
- changePercent 기존 필드 재사용 → quota 0, 신규 배선 0(regime 이미 threaded).

### 비용·위험

- **buy-the-top 위험** (단일일 급등 꼭대기 추격) → default OFF + regime-gate(risk-on 한정) +
  bounded(T_cap/MAX_BONUS) + ADR-0593 breadth/VKOSPI 게이트 재사용 + shadow N영업일 검증으로 봉인.
- **점수 인플레이션 위험** (risk-on 국면 전반 점수 상승) → bounded MAX_BONUS(PRICE_MOMENTUM 20
  내 일부) + maxScore 20 천장 불변으로 제한. requiredScore 70 게이트 임계는 무변경 — 점수만 상향.
- **과급등 cap 경계 미확정** → counterfactual 튜닝(§미해결). 초기값 보수적(T_cap 12~15%).

## Rollback

1. `GATE1_REVERSAL_MOMENTUM_ENABLED=false` (1줄) → `evaluateReversalMomentumCredit` 항상 0 반환,
   PRICE_MOMENTUM 점수 즉시 100% 복원 (ADR-0146 byte-equivalent).
2. flag OFF = 현 baseline byte-equivalent. LIVE 매매 본체(entryEngine/autoTradeEngine/Gate
   hard-block/Kelly/order) 0줄 변경. executionImpact=NONE.

## Alternatives Considered

- **A1. ADR-0546 임계 완화(70→60)에 의존.** 기각(단독) — 0546 은 "바를 낮춤"(임계 하향),
  본 ADR 은 "점수를 올림"(반전 신호 인식). 둘은 **상보적·독립**이며 본 ADR 이 더 근본:
  0546 은 모든 종목의 바를 낮춰 약한 신호도 통과시키지만, 본 ADR 은 반전 *리더만* 차별 보상한다.
  0546 은 또한 D5 forward 표본 미성숙으로 활성화 불가 상태. 둘 다 가능하나 본문 §A1 에 관계 명시.
- **A2. PRICE_MOMENTUM 다일집계에 오늘 수익률을 무조건 평균 추가.** 기각 — regime-gate 없는 상시
  가산은 평시 buy-the-top + byte-equivalent 위반(flag 없는 상시 변경).
- **A3. return5d 정규화 공식 자체 완화(폭락창 deweight).** 기각 — 다일집계의 의미(추세)를
  훼손하고 약세장 전반에 점수 인플레. 오늘-단일일 *별도 입력*이 반전을 정확히 포착.
- **A4. flag 없이 즉시 live 가산.** 기각 — ADR-0146 byte-equivalent + buy-the-top 위험.
  shadow 선검증 필수(ADR-0592/0593/0581 phased 선례).
- **A5. 가산 상한 없이(unbounded) changePercent 비례 가산.** 기각 — 과급등(+20%↑ 고립 급등·
  거래정지 복귀)을 추격. T_cap/MAX_BONUS bounded 필수(난제 §D3).
- **A6. BREAKOUT_STRUCTURE 의 turtle-high 요구 완화로 반등 보상.** 기각 — breakout 의 의미
  (신고가 돌파)를 훼손하고 폭락 저점 반등을 "돌파"로 오인. PRICE_MOMENTUM 가산이 의미 정합.

## References

- ADR-0593 (regime risk-on fast-upgrade — 본 ADR 의 **레짐판 선례**, RISK_ON_REGIMES 게이트
  재사용 후보 §D3, `riskOnFastUpgrade.ts` 순수 SSOT 분리 패턴)
- ADR-0550 (stage1 risk-on regime leader capture — `calcStage1Score` normal/risk-on 점수 분기
  패턴 차용, universe 확장 가드레일 상속, RISK_ON_REGIMES 소비)
- ADR-0592 (R6 trigger freshness — 하방/상방 비대칭 + 다일집계 후행 병의 R6판 선례)
- ADR-0546 (Gate1 required score SSOT / regime-aware window — **상보·독립** §A1: 0546=바 낮춤,
  본 ADR=점수 올림. forward-outcome 성숙 게이트 패턴 차용)
- ADR-0467 (Positive Score Starvation Audit — 양수 컴포넌트 회계 정합, maxScore 20 천장 불변)
- ADR-0146 (byte-equivalent PR 자가 review — flag OFF baseline 100% 보존 · ENV 1줄 롤백 ·
  executionImpact NONE)
- ADR-0581 (shadow→live phased flag 파이프라인 선례)
- ADR-0572 (단방향 cap 패턴 — 어떤 입력도 baseline 보다 나빠지지 않음)
- `docs/ai/00-project-charter.md` §2.1 (9대 불변식 — #6 결손≠signal/providerIssue≠bullish,
  #7 AI_ESTIMATED(L4) live 미사용)
- `docs/gate1-score-threshold-analysis-20260608.md` (PRICE_MOMENTUM/BREAKOUT zero 진단 표본)
- `server/trading/signalScanner/minimumSignalScoreTrace.ts:477` (priceMomentumScore — 다일집계
  입력) · `:699` (buildMinimumSignalScoreTrace, regime threaded line 655) ·
  `:393` (breakoutScore — turtle-high) ·
  `server/trading/signalScanner/entryFilterDecomposition/types.ts:409`
  (CandidateEntryTrace.quote.changePercent — 기존 필드, quota 0) ·
  `server/screener/pipelineHelpers.ts:643` (RISK_ON_REGIMES — 재사용 게이트)

### 미해결 (운영자/engine-dev 확정 필요)

1. **가산 크기** — `MAX_BONUS`(PRICE_MOMENTUM 20 내 일부, 제안 6~8) vs 별도 소액 보너스.
   `scale`·`T_min`(제안 +3.0%). counterfactual 튜닝으로 운영자 확정. ENV 오버라이드 제공.
2. **과급등 캡 임계** — `T_cap`(제안 +12~15%) 위 처리: cap(가산 고정) vs 역가산/감쇠.
   고립 급등 회피 강도 운영자 결정.
3. **ADR-0593 게이트 재사용 여부** — §D3 (권장) canonical RISK_ON_REGIMES 소비 vs (대안)
   `shouldFastUpgradeToR3Early` eligibility 직접 소비. 전자가 배선 0·src↔server 경계 무관.
4. **shadow 관측 N영업일** 수 (ADR-0592/0593 선례 참조) — 운영자 결정. ADR-0546 forward-outcome
   ledger 성숙 게이트와 정렬 검토.
