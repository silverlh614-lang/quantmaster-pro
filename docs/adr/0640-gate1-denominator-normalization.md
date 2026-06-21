# ADR-0640 — Gate1 분모 정합 (Denominator Normalization) — 수급 결손이 실효 문턱을 *올리는* 갭 봉인 (flag-gated, default OFF)

@responsibility Gate1 minimum-signal scorer 의 requiredScore=70 calibration 이 full-data 분모(configuredPositiveMax)에 묶여 있어 수급 결손 시 달성 가능 max 가 줄며 실효 문턱이 *저절로 상승*하는 불변식 #6 미완결 갭을, 결손 maxScore 분모 제외 + requiredScore 비례 축소로 봉인하는 경계·정책 ADR (default OFF byte-identical, shadow 상시 관측).

- **Status:** Proposed (Phase 0 — architect: 경계·정책·ENV 계약·shadow 필드 계약·ADR·INDEX. scorer 본문·타입 필드·shadow 산출 구현은 engine-dev 인계. default OFF byte-identical.)
- **Date:** 2026-06-21
- **Branch:** claude/gate1-denominator-normalization
- **Supersedes / Extends:** ADR-0467(positive component 회계)·ADR-0471(live curve FREEZE)·ADR-0546(regime-aware required-score OFF=byte-identical 패턴)·ADR-0599(Gate2 가용 축 비례 요구 — 동형 결손 보정 선례)·ADR-0613(Gate1 positive-ceiling wiring OFF-by-default 승격 패턴)·ADR-0476(관측 ledger 패턴)·ADR-0157(ENV 정확 비교)·ADR-0146(byte-equivalent·wiring vs 인프라)·ADR-0530(Patch Scope Guard)
- **Patch vs ADR:** ADR (신규 경계/정책 — ENV flag·분모 정합 경로). INDEX.md 0640→0641 갱신 의무.

---

## Context — "데이터 결손이 문턱을 올린다"의 산술

Gate1 minimum-signal scorer(`server/trading/signalScanner/minimumSignalScoreTrace.ts`)의 판정 SSOT:

- `passed = actualScore >= requiredScore` (requiredScore 기본 70, ×10 스케일)
- `actualScore = Σ weightedScore` (16개 컴포넌트)
- 활성 양수 컴포넌트의 maxScore 총합 `configuredPositiveMax` = **108**(SECTOR_RS OFF) 또는 **116**(ON)
- requiredScore=70 은 이 **full-data 분모**에 calibrate 됨 (ADR-0467/0546 SSOT, 절대 보존)

문제의 산술 — 수급(supply) 데이터 결손 시:

- SUPPLY_CONFLUENCE(maxScore 8) · INVESTOR_FLOW(maxScore 8) 가 confidence=UNKNOWN/STALE 이 되면
  점수는 **0 으로 중립화**된다 (불변식 #6 준수 — provider 장애를 bearish 로 변환하지 않음).
- 그러나 그 maxScore(8+8=16)는 분모 `configuredPositiveMax` 에 **그대로 남는다.**
- 달성 가능 max 가 108 → 92 로 줄어드는데 임계 70 은 **고정**이라:
  - full-data 실효 문턱: 70/108 = **65%**
  - supply 2축 결손 실효 문턱: 70/92 = **76%**
- 즉 데이터 결손이 실효 문턱을 65%→76% 로 **저절로 올린다.**

이것은 불변식 #6("provider 장애는 market signal/bearish 가 아니다")의 **미완성 부분**이다. 점수는
중립화(0)했지만 분모는 페널티로 남겨둔 상태 — 결손이 사실상 진입 문턱 상승이라는 페널티로 작동한다.
ADR-0599 가 Gate2 에서 "결손 축이 요구 개수를 역설적으로 강화"하는 동형 갭을 봉인한 것과 정확히
같은 종류의 갭이 Gate1 분모 측에 잔존하는 것이다.

---

## Decision

### D1. ENV flag 계약

| 항목 | 값 |
|------|-----|
| **flag 이름** | `GATE1_DENOMINATOR_NORMALIZATION_ENABLED` |
| **default** | OFF (미설정/`!== 'true'` = OFF) |
| **정확 비교** | `=== 'true'` (ADR-0157 — `'1'`/`'TRUE'`/`'yes'` 거부) |
| **OFF 동작** | byte-identical — 레거시 `passed = actualScore >= requiredScore`(=70) 그대로 |
| **롤백** | flag 1줄 OFF/삭제 = 즉시 baseline |

flag OFF 시 effectiveRequiredScore 산출·분모 제외·비례 축소는 **전혀 실행되지 않는다**(actualScore·passed·
requiredScore 필드 모두 현행과 byte-identical). shadow 관측 필드만 additive optional 로 산출된다(D4).

### D2. ON 동작 — ② 결손 제외 (분모에서 결손 maxScore 차감)

confidence ∈ {UNKNOWN, MISSING, STALE} 인 maxScore>0 컴포넌트를 분모에서 제외한다:

```
availableMaxScore = Σ( maxScore )  over  컴포넌트 c where
                       c.maxScore > 0  AND  c.confidence ∉ {UNKNOWN, MISSING, STALE}
```

결손 컴포넌트의 점수는 이미 0 으로 중립화(불변식 #6, 무변경)되어 있으므로, 분모에서 그 maxScore 를
빼면 "결손이 없었다면의 달성 가능 max" 에 정합한다. 결손 축을 bullish/positive 로 승격하지 않는다 —
오직 **분모에서 제외**만 한다.

### D3. ON 동작 — ① 비례 축소 (effectiveRequiredScore)

분모 축소분에 비례해 임계를 *내린다*. 절대 올리지 않는다:

```
raw          = round1( requiredScore × availableMaxScore / configuredPositiveMax )
effectiveRequiredScore = clamp( raw,  lower = requiredScore × 0.7,  upper = requiredScore )
```

- **상한 = requiredScore** — 결손이 없으면(availableMaxScore == configuredPositiveMax) raw == requiredScore
  → 임계는 절대 원 requiredScore 위로 올라가지 않는다. 결손이 있어야만 임계가 *내려간다.*
- **하한 = requiredScore × 0.7** — 대규모 동시 결손(catastrophic provider 동시 장애) 시 분모가 급감해
  게이트가 활짝 열리는 것을 방지한다(0.7× clamp). 즉 "결손 보정"은 하되 "게이트 무력화"는 막는다.
- round1 = 소수 1자리 반올림(×10 스케일 정합).

가드(아래 조건이면 requiredScore 그대로 — 하향 없음, byte-identical 판정):

- `configuredPositiveMax <= 0` (분모 비정상)
- `availableMaxScore <= 0` (가용 축 전무)
- `availableMaxScore >= configuredPositiveMax` (결손 없음 — 정상 full-data)

### D4. 판정 라인 + shadow 관측 필드

ON 일 때 판정:

```
passed   = actualScore >= effectiveRequiredScore
scoreGap = actualScore − effectiveRequiredScore
```

반환 trace 의 `requiredScore` 필드는 **configured 값(70) 그대로 유지**한다(표시 일관성 — 운영자/대시보드
표시는 calibration SSOT 를 보존). effective 는 별도 필드로 노출한다.

shadow 병행 관측 — **flag 무관하게 항상 force-ON 가정으로 산출**(flag OFF 여도 "ON 이면 어땠을지"
누적, ADR-0476/0613 ledger 철학). actualScore/passed 본체에 영향 0, try/catch 격리(불변식 #1 — 관측
실패가 scorer/엔진 정지 유발 금지). MinimumSignalScoreTrace 에 optional 필드 추가(engine-dev 가 타입·구현 담당):

| 필드 | 의미 |
|------|------|
| `denomNormConfiguredPositiveMax` | 현행 full-data 분모(108/116) |
| `denomNormAvailableMaxScore` | 결손 제외 후 가용 분모 |
| `denomNormEffectiveRequiredScore` | 비례 축소·clamp 적용된 가정 임계 |
| `denomNormHypotheticalPassed` | actualScore >= effectiveRequiredScore (가정 통과 여부) |

목적: flag OFF 상태에서도 "ON 이면 어떤 종목이 통과했을지" forward-outcome 을 누적 → 운영자가 Phase 2
flip 을 데이터 기반으로 판단.

### D5. 단계적 활성화 (ADR-0599/0613 phased 선례)

- **Phase 0(현재):** flag OFF, shadow 4필드 상시 관측. LIVE byte-identical.
- **Phase 1:** N영업일 shadow `denomNormHypotheticalPassed` 후보의 forward-outcome counterfactual 대조
  (운영자 forward-outcome 성숙).
- **Phase 2:** 운영자 forward-outcome 성숙 확인 후 ENV ON(1줄 flip). 운영자 몫 — 본 ADR 은 강제하지 않는다.

### D6. ADR-0471 freeze 정합

- ADR-0471 freeze rule: live Gate1 minimum-signal scoring **curve** 는 FROZEN. 본 패치는 곡선(weight·
  componentScore 산출)을 바꾸지 않는다 — `actualScore = Σ weightedScore` 무변경.
- 변경 대상은 **분모(달성 가능 max)와 그에 비례한 임계**뿐이며, 그것도 flag OFF 면 byte-identical.
- ADR-0546 regime-aware required-score(OFF=byte-identical)와 동일한 "임계 측 flag-gated 보정" 패턴.

---

## Consequences

### 긍정
- 불변식 #6 **완결** — 점수 중립화(기존)에 더해 **분모 제외**까지 더해, provider 장애가 진입 문턱을
  올리는 잔존 페널티를 제거. "데이터 결손이 문턱을 올린다" 갭 봉인.
- 임계는 결손 시에만 *내려가고* 절대 올라가지 않으며(상한 = 원 requiredScore), catastrophic 동시 장애는
  0.7× 하한 clamp 로 게이트 무력화 방지 — 안전 비대칭(완화는 제한적, 강화는 0).
- shadow 4필드가 flag OFF 상태에서도 hypothetical 통과를 누적 → 운영자 flip 판단 데이터 성숙.
- requiredScore=70 calibration SSOT 표시 보존(trace.requiredScore 무변경), effective 는 별도 필드 — 표시 일관성.

### 비용 / 위험
- flag ON 시 결손 환경의 진입 분포가 변할 수 있음 — 그래서 default OFF + 운영자 Phase 2 flip + 하한 clamp.
- 분모 정합은 "결손이 없었다면" 가정에 의존 — 결손 축이 만약 강세였다면 통과했을 가능성을 채우지는
  않음(점수 0 중립 유지). 이는 의도된 보수성(결손 축을 bullish 로 승격하지 않음 — ADR-0599 동형).

### executionImpact
- flag OFF: **NONE** (LIVE 매매 본체 0줄 의미변경, KIS/KRX quota 0 침범, byte-identical. requiredScore 70 표시 무변경).
- flag ON: gate1-scoring-adjacent (LIVE Gate1 진입 임계가 결손 시 비례 축소 — autoTradeEngine/kisClient/order
  path 0줄, weightedScore 곡선 무변경, configured requiredScore 70 표시 무변경).

### 9대 불변식 영향
- **#1 (Trading Engine 항상 살아 있음):** 위반 없음 — scorer 정지 0. shadow 산출 try/catch 격리.
- **#2 (Shadow Learning 멈춤 없음):** 위반 없음 — Shadow 정지 0. shadow 관측은 additive·force-ON·격리.
- **#3 / #9 (단일 SourceSnapshot · provider 직접 조회 금지):** 위반 없음 — 본 모듈은 confidence/maxScore
  trace 입력만 소비, provider/store/now/fetch 직접 호출 0, SourceSnapshot 우회 0.
- **#6 (provider 장애 ≠ market signal):** **완결** — 점수 중립화(기존) + 분모 제외(신규)로 장애가 진입
  문턱을 올리는 잔존 변환을 제거.
- **#7 (AI_ESTIMATED(L4) live 매매 금지):** 위반 없음 — 결손 축을 분모에서 *제외*만 하고 승격 0.
- **#8 (실거래 차단 ≠ Shadow 차단):** 위반 없음 — flag OFF=byte-identical, shadow 는 flag 무관 산출.

---

## Rollback

ENV 1줄 (`GATE1_DENOMINATOR_NORMALIZATION_ENABLED=false`/삭제) — 판정 즉시 baseline(passed = actualScore
>= 70) 복원. shadow 4필드는 관측 전용 optional 이라 잔존 무해(소비처 없음). byte-equivalent 원칙(ADR-0146)
충족 — LIVE 매매 본체 0줄 + ENV 1줄 즉시 롤백 + 회귀 테스트 + KIS/KRX quota 0 침범.

---

## 관측 계획 (Observation Plan)

- shadow 4필드(`denomNormConfiguredPositiveMax`/`denomNormAvailableMaxScore`/`denomNormEffectiveRequiredScore`/
  `denomNormHypotheticalPassed`)를 flag OFF 상태에서 N영업일 누적.
- 관심 지표: 결손 환경(availableMaxScore < configuredPositiveMax)에서 `denomNormHypotheticalPassed=true`
  인데 현행 `passed=false` 인 종목 수 = "분모 정합이 회복시킬 후보" 규모.
- 하한 clamp(0.7×) 가 binding 되는 빈도 = catastrophic 동시 결손 발생률(게이트 무력화 위험 측정).
- Phase 1 에서 위 후보의 forward-outcome 을 counterfactual 대조 → Phase 2 flip 근거.

---

## Alternatives Considered

1. **현행 유지(분모 페널티 잔존)** — 기각. 불변식 #6 미완결 — 점수만 중립화하고 분모는 결손을 페널티로
   남겨 진입 문턱이 65%→76% 로 저절로 상승. ADR-0599 가 Gate2 에서 봉인한 동형 갭을 Gate1 에 방치.
2. **requiredScore=70 자체를 하향(예: 60)** — 기각(절대 보존, ADR-0467/0546). calibration SSOT 변경은
   full-data 환경까지 무차별 완화. 본 ADR 은 결손 시에만·비례적으로·상한=원값으로 보정.
3. **결손 축을 중립(50%) 점수로 채움** — 기각(불변식 #6/#7). 결손 축을 점수로 승격하면 추정 매매 결정에
   기여 — L4 금지 정신 위배. 분모 제외(점수 0 유지)가 안전.
4. **clamp 하한 없이 비례 축소** — 기각. catastrophic provider 동시 장애 시 분모 급감 → 임계 급락 →
   게이트 활짝 열림(과진입 위험). 0.7× 하한으로 완화 범위를 제한.
5. **flag 없이 즉시 적용** — 기각(ADR-0471 freeze + 검증 안 된 분포 변경). default OFF + shadow 관측 +
   운영자 Phase 2 flip 패턴(ADR-0599/0613) 준수.
6. **신규 두 번째 점수 공식 작성** — 기각(단일 통로). `actualScore = Σ weightedScore` 곡선 무변경,
   분모/임계 보정만 기존 scorer seam 에 flag-gated 로 추가.

---

## References

- 진단: Gate1 minimum-signal scorer 분모 정합 추적 (configuredPositiveMax 108/116·requiredScore 70·
  supply 결손 시 실효 문턱 65%→76% 산술)
- 코드 seam: `buildMinimumSignalScoreTrace` (`server/trading/signalScanner/minimumSignalScoreTrace.ts`)
  requiredScore 결정 + passed 판정부
- ADR-0467(positive 회계)·0471(live curve FREEZE)·0546(regime-aware required-score OFF=byte-identical)·
  0599(Gate2 가용 축 비례 요구 — 동형 결손 보정 선례)·0613(Gate1 positive-ceiling wiring OFF-by-default
  승격 패턴)·0476(관측 ledger 패턴)·0157(ENV 정확 비교 `=== 'true'`)·0146(byte-equivalent·wiring vs
  인프라)·0530(Patch Scope Guard)
- 불변식 #6 (provider 장애 ≠ market signal) · #7 (L4 live 매매 금지) — `docs/ai/00-project-charter.md`
