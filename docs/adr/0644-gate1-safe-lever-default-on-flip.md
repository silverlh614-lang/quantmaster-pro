# ADR-0644 — Gate1 safe-lever default-ON flip — 3개 안전 lever SSOT 함수 `=== 'true'` → `!== 'false'` (운영자 승인, Railway 배포 단순화)

@responsibility Gate1 starvation 안전 lever 3종(분모 정합 ADR-0640·RS percentile 연속 ADR-0627·positive-ceiling 배선 ADR-0613)의 코드 default 를 OFF→ON 으로 flip 하는 경계·정책·SSOT 계약 SSOT — gateConfig 3 함수의 ENV 비교를 `=== 'true'`(default OFF)에서 `!== 'false'`(default ON, explicit `=false` kill-switch 보존)로 전환. positive-max-normalization(ADR-0643, 16/16 과개방)은 default OFF 유지(`=== 'true'` 불변). requiredScore=70 리터럴·ADR-0471 weighted curve FREEZE·9대 불변식 무위반·현 engineMode=SHADOW_ONLY live 주문 0 안전창.

- **Status:** Proposed (Phase 0 — architect: 경계·flip 정책·SSOT 계약·flag-lifecycle 레지스트리 정정·ADR·INDEX·HANDOFF. gateConfig 3 함수 본문·테스트·.env.example 은 engine-dev 인계.) **운영자(silverlh614) 승인 완료** — Railway ENV 설정 대신 코드 default 를 ON 으로 flip(재배포만으로 활성화).
- **Date:** 2026-06-22
- **Branch:** claude/scan-blockers-diagnostic-wp93a3
- **Supersedes / Extends:** ADR-0640(Gate1 분모 정합 — 본 ADR 이 그 "Phase 2 운영자 flip" 단계를 운영자 승인으로 충족)·ADR-0627(RS percentile 연속 — 동일)·ADR-0613(positive-ceiling wiring — 동일, 단 16/16 정규화는 ADR-0643 으로 이미 분리됨)·ADR-0643(positive-max-normalization flag 분리 — 본 ADR 은 그 분리 봉인을 보존, positive-max 는 default OFF 유지)·ADR-0157(ENV 정확 비교)·ADR-0471(live weighted curve FREEZE — 절대 보존)·ADR-0467(requiredScore=70 calibration SSOT)·ADR-0146(byte-equivalent·ENV 1줄 롤백)·ADR-0530(Patch Scope Guard)·ADR-0641(flag-lifecycle governance — 본 ADR 이 3 flag status SHADOW_OFF→ON flip)
- **Patch vs ADR:** ADR (신규 정책 — default OFF→ON flip = ENV 계약 변경, flag-lifecycle status 전환). INDEX.md 0644→0645 갱신 의무.

---

## Context

ADR-0643(머지 완료)으로 Gate1 starvation(`finalScoreAvg≈49.3 < required=70`, 0 진입) 실수정 코드는
완비됐다. 그러나 3개 안전 lever flag 가 **default OFF** 라 Railway ENV 미설정 시 비활성 상태로 출하된다.

| lever | flag | SSOT 함수 (gateConfig.ts) | 현 default | 안전성 (ADR-0643 D2) |
|-------|------|---------------------------|-----------|----------------------|
| 분모 정합 | `GATE1_DENOMINATOR_NORMALIZATION_ENABLED` | `isGate1DenominatorNormalizationEnabled()` (`:249`) | OFF | 안전 — 0.7× floor clamp, 절대 인상 안 함(ADR-0640) |
| RS percentile 연속 | `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` | `isGate1RsPercentileContinuousEnabled()` (`:236`) | OFF | 안전 — 분해능 복원, maxScore 10·weight 1 무변경(ADR-0627) |
| positive-ceiling 배선 | `GATE1_POSITIVE_CEILING_WIRING_ENABLED` | `isGate1PositiveCeilingWiringEnabled()` (`:207`) | OFF | 안전 — ADR-0643 분리 후 breakout high20d 재수화(GAP-B) + RS no-op 만 켬, 16/16 정규화 비포함 |

운영자(silverlh614)는 Railway ENV 3줄을 수동 설정하는 대신 **코드 default 를 ON 으로 flip** 해
재배포만으로 활성화되도록 결정했다. ADR-0640/0627/0613 이 각자 둔 "Phase 2 운영자 flip" 단계를
**운영자 승인으로 충족**한다(아래 §Decision D3).

**핵심 안전 관문**: 현 `engineMode=SHADOW_ONLY` — live 실주문 0. 본 flip 은 Gate1 점수/통과율을
바꾸지만 실거래 경로는 SHADOW_ONLY 차단으로 보호된다(불변식 #8: 실거래 차단 ≠ Shadow 차단).

---

## Decision

### D1 — SSOT 함수 ENV 비교 전환: `=== 'true'` → `!== 'false'`

3개 SSOT 함수의 ENV 비교 계약을 다음과 같이 전환한다(코드 본문은 engine-dev):

```
기존 (default OFF):  process.env.<FLAG> === 'true'
신규 (default ON):   process.env.<FLAG> !== 'false'
```

계약 정의:
- **미설정(undefined)** → `!== 'false'` = `true` = **활성**(default ON).
- **explicit `=false`** → `!== 'false'` = `false` = **비활성**(kill-switch 보존).
- **explicit `=true`** → `!== 'false'` = `true` = 활성(명시 ON 도 정상 동작).
- 그 외 임의 값(`'1'`/`'yes'`/`'TRUE'` 등) → `!== 'false'` = `true` = 활성. (ADR-0157 정확 비교 정신은
  **kill-switch 한정** — 끄는 값은 정확히 `'false'` 만 인정. 켜는 쪽은 default 라 임의 값도 ON 으로 흡수.)

전환 대상 3 함수: `isGate1DenominatorNormalizationEnabled`·`isGate1RsPercentileContinuousEnabled`·
`isGate1PositiveCeilingWiringEnabled`.

### D2 — positive-max-normalization 은 default OFF 유지 (분리 봉인 보존)

`isGate1PositiveMaxNormalizationEnabled()` (`GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED`, gateConfig.ts `:216`)
는 **`=== 'true'` 불변**(default OFF). ADR-0643 이 16/16 과개방(선별력 상실, 통과율 target 3~7 위반)
때문에 별도 flag 로 분리·봉인한 것을 그대로 보존한다. 본 ADR 의 default-ON flip 대상에서 **명시 제외**.

### D3 — ADR-0640/0627/0613 "Phase 2 운영자 flip" 충족 (supersede 관계)

세 ADR 은 각자 default OFF 로 byte-identical 머지 후 "Phase 2 = 운영자 forward-outcome 성숙 후 ENV flip"
단계를 남겨뒀다. 본 ADR 이 그 Phase 2 단계를 **운영자 승인으로 충족**한다:

- ADR-0640 Phase 2(운영자 ENV ON) → 본 ADR default-ON flip 으로 충족(supersede).
- ADR-0627 운영자 flip → 충족(supersede).
- ADR-0613 Phase 2(운영자 승인 flip) → 충족(supersede, 단 16/16 정규화 부분은 ADR-0643 분리로 이미 제외됨).

flag-lifecycle 레지스트리(`scripts/gate_flag_lifecycle.json`)의 해당 3 flag status 를
`SHADOW_OFF` → `ON` 으로 전환한다(ADR-0641 거버넌스 — flip 단계 제도화 충족).

### D4 — 불변 보존 (FREEZE)

- **requiredScore=70 리터럴 불변** — gateConfig requiredScore SSOT(LEGACY_GATE1_REQUIRED_SCORE) 무접촉.
  분모 정합(ADR-0640)의 effective 축소는 결손 비례·0.7× floor 로만 작동, 70 리터럴 그대로.
- **weighted curve 불변 (ADR-0471 FREEZE)** — `weightedFromNormalized`·각 component maxScore·weight 무변경.
  본 ADR 은 flag default 만 바꾼다(산식 0줄).
- **positive-max-normalization 분리 봉인 (ADR-0643)** — D2 로 default OFF 유지.
- **9대 불변식 무위반** — Trading Engine 정지 0(#1)·Shadow Learning 정지 0(#2)·SourceSnapshot 우회 0
  (#3·#9)·provider 장애→bearish 변환 0(#6)·L4→live 0(#7)·**실거래 차단 ≠ Shadow 차단(#8)**: 현
  engineMode=SHADOW_ONLY 라 본 flip 은 live 주문 0, Gate1 점수만 변화.
- **롤백 보존** — 각 flag explicit `=false` 1줄 즉시 kill-switch(ENV 1줄, ADR-0146 byte-equivalent 정신
  유지 — 단 본 ADR 은 의도적 behavior change 라 byte-identical 이 아니라 explicit `=false` 롤백 계약).

---

## Consequences

### 긍정
- Railway 재배포만으로 3개 안전 lever 활성화(운영자 ENV 3줄 수동 설정 불요).
- starvation 동적 분모 근본(ADR-0640) + RS 분해능 손실(ADR-0627) + breakout 결손 채움(ADR-0613)이
  default 로 작동 → Gate1 통과율 회복.
- explicit `=false` kill-switch 보존 → 회귀 발견 시 ENV 1줄 즉시 롤백 가능.
- flag-lifecycle "플래그 무덤" 안티패턴(ADR-0641) 해소 — 3 flag flip 으로 거버넌스 부채 상환.

### 부정 / 비용
- **byte-identical 깨짐** — 본 ADR 은 의도적 behavior change(default 동작 변경)라 "전 flag OFF byte-identical"
  이 더는 성립 안 함. 회귀 안전망은 explicit `=false` 롤백 + SHADOW_ONLY live 0 + 회귀 테스트.
- **기존 "default OFF byte-identical" assertion 테스트 회귀** — ADR-0643·0640·0627 의
  "flag 미설정 시 byte-identical" 테스트는 이제 default ON 이라 **explicit `=false` 로 setEnv** 해야 통과
  (engine-dev 인계 — HANDOFF_0644.md).
- 통과율 회복이 과도하면(예상 외 과개방) explicit `=false` 1줄로 즉시 봉인.

### 회귀 가드
- 각 SSOT 함수: 미설정→true / `=false`→false / `=true`→true 3-케이스 검증(engine-dev).
- positive-max-normalization 무회귀: `isGate1PositiveMaxNormalizationEnabled()` 미설정→**false** 유지
  (default OFF 봉인 — D2 봉인이 깨지지 않았음을 검증).
- requiredScore=70 SSOT validator(`check_gate1_required_score_ssot`) 무위반.
- `npm run validate:flagLifecycle` 통과(3 flag status ON 정합).

---

## Alternatives Considered

1. **Railway ENV 3줄 수동 설정 유지(코드 default OFF 불변)** — 거부. 운영자가 명시적으로 코드 default flip
   을 요청(재배포 단순화·ENV 누락 위험 제거). flag-lifecycle "무덤" 안티패턴(ADR-0641)도 미해소.
2. **`=== 'true'` 유지하고 .env.example 만 `=true` 로 변경** — 거부. .env.example 은 주석 처리된 문서일
   뿐 런타임 default 가 아님 → Railway ENV 미설정 시 여전히 OFF. 근본 미해결.
3. **3 flag 를 코드에서 제거하고 항상 ON 하드코딩** — 거부. kill-switch(explicit `=false`) 롤백 능력 상실.
   회귀 시 ENV 1줄 롤백 불가 → ADR-0146 byte-equivalent 롤백 원칙 위반.
4. **positive-max-normalization 도 함께 default ON** — 거부. 16/16 과개방(선별력 상실, ADR-0643 D2 통과율
   target 3~7 위반). forward-outcome 성숙 전 flip 금지 봉인 유지(D2).
5. **`!== 'false'` 대신 `!== '0' && !== 'false'` 다중 kill-switch** — 거부. 단일 kill-switch 값(`'false'`)이
   명료(ADR-0157 정신 — 정확 비교, kill-switch 한정). 다중 값은 혼동.

---

## References

- `server/trading/gateConfig.ts:207,236,249` — flip 대상 3 SSOT 함수(`=== 'true'` → `!== 'false'`)
- `server/trading/gateConfig.ts:216` — `isGate1PositiveMaxNormalizationEnabled` (default OFF 유지, D2 봉인)
- `server/trading/signalScanner/gate1DenominatorNormalizationAdr0640.ts:47` — `resolveEffectiveRequiredScore` 소비처
- `server/trading/signalScanner/gate1PositiveCeilingWiringAdr0613.ts:143` — `applyBreakoutWiring`(`isGate1PositiveCeilingWiringEnabled` 게이트, flip 영향)
- `server/trading/signalScanner/entryFilterDecomposition/decompositionBuilder.ts:269-271` — RS 연속(`isGate1RsPercentileContinuousEnabled` 게이트, flip 영향)
- `server/trading/signalScanner/minimumSignalScoreTrace.ts:506,510,603` — live actualScore·effectiveRequiredScore·passed 호출부
- `scripts/gate_flag_lifecycle.json` — 3 flag status SHADOW_OFF→ON 전환(ADR-0641 거버넌스)
- `.env.example:247,255,259` — 3 flag 주석 default-ON 갱신 (engine-dev)
- `_workspace/2026-06-22_gate1-starvation-realfix/architect/HANDOFF_0644.md` — engine-dev 변경 스펙
- ADR-0640·0627·0613(Phase 2 충족)·ADR-0643(positive-max 분리 봉인 보존)·ADR-0157·0471·0467·0146·0530·0641
