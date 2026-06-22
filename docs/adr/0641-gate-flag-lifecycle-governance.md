# ADR-0641 — Gate Flag 수명주기 거버넌스 + 기존 OFF 플래그 burn-down 감사 (메타 정책, executionImpact NONE)

@responsibility Gate flag-gated 기능의 default-OFF 누적("플래그 무덤") 안티패턴을 봉인하는 메타 거버넌스 ADR — 각 OFF 플래그에 reviewBy 만료일 + 활성화 기준을 의무화하고, 만료 경과 시 validate 체인이 하드 실패해 flip/sunset/(기록된)연장 중 하나를 강제한다. 기계가독 SSOT 는 `scripts/gate_flag_lifecycle.json`, 검사기는 engine-dev 담당 `scripts/check_flag_lifecycle.js`. LIVE 동작 0 변화(메타 정책).

- **Status:** Proposed (Phase 0 — architect: 거버넌스 정책·기계가독 레지스트리·burn-down 감사 문서·ADR·INDEX·패치히스토리. `scripts/check_flag_lifecycle.js` + package.json `validate:flagLifecycle` 배선은 engine-dev 인계.)
- **Date:** 2026-06-21
- **Branch:** claude/gate-flag-lifecycle-governance
- **Supersedes / Extends:** ADR-0146(byte-equivalent·wiring vs 인프라·"OFF 출하" 안전 규칙을 *완결*)·ADR-0157(ENV 정확 비교)·ADR-0530(Patch Scope Guard)·ADR-0546/0611/0613/0627/0640(거버넌스 대상 5개 Gate1 OFF 플래그)
- **Patch vs ADR:** ADR (신규 경계/정책 — flag 수명주기 거버넌스 + 기계가독 레지스트리 + validate 체인 진입점). INDEX.md 0641→0642 갱신 의무.

---

## Context — "플래그 무덤" 안티패턴

Gate1 에 default-OFF 플래그가 **5개** 영원히 OFF 로 쌓였다:

| ADR | envFlag | 도입 | 성격 |
|-----|---------|------|------|
| 0546 | `GATE1_REGIME_AWARE_REQUIRED` | 2026-06-11 | 레짐 인식 required-score(임계 측) |
| 0611 | `GATE1_SECTOR_RS_COMPONENT_ENABLED` | 2026-06-15 | SECTOR_RS 8점 capacity 복원(additive) |
| 0613 | `GATE1_POSITIVE_CEILING_WIRING_ENABLED` | 2026-06-15 | 천장 배선 3종 묶음 |
| 0627 | `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` | 2026-06-18 | RS percentile 손실 복원 버그픽스 |
| 0640 | `GATE1_DENOMINATOR_NORMALIZATION_ENABLED` | 2026-06-21 | 결손 분모 제외 + 비례 축소 |

각 플래그는 동일한 안전 패턴으로 출하됐다 — "**ENV OFF = byte-identical 출하 → shadow 관측 →
운영자가 forward-outcome 으로 검증 → 승인 후 flip**"(ADR-0146). 출하 안전장치는 잘 작동했으나
**flip 단계가 제도화되지 않았다.** "언제까지 관측하고 언제 결정하는가"에 만료·강제 장치가 없어,
안전장치가 **정체(stasis)**로 변질됐다. shadow 필드는 계속 누적되는데 운영자 결정은 무기한 미뤄지고,
검증을 위해 만든 capacity 복원·정보 손실 *버그픽스*(0627)조차 영구 잠금으로 남는다. 이것이
"플래그 무덤" 안티패턴이다 — **OFF 출하는 안전하지만 OFF 망각은 안전하지 않다.**

---

## Decision

### D1. 레지스트리 등재 의무

모든 Gate flag-gated 기능은 도입 시 기계가독 레지스트리 `scripts/gate_flag_lifecycle.json`(스키마 v1)에
한 행을 등재해야 한다. 필수 필드: `envFlag` · `adr` · `title` · `introduced`(YYYY-MM-DD) ·
`reviewBy`(YYYY-MM-DD) · `status`(`SHADOW_OFF`|`ON`|`SUNSET`) · `activationCriteria` · `nextAction` · `notes`.

- `reviewBy = introduced + reviewWindowDays`(레지스트리 top-level `reviewWindowDays`, 기본 90).
- 레지스트리(JSON)가 **SSOT**. `docs/ai/gate-flag-lifecycle.md` 는 사람용 해설 — 값 충돌 시 JSON 우선.
- 본 ADR 발급 시점 5개 전부 등재 완료(`status: SHADOW_OFF`, `reviewBy: 2026-09-19`).

### D2. reviewBy 만료 = validate 하드 실패

`reviewBy` 가 경과한 `SHADOW_OFF` 플래그가 존재하면 `validate:flagLifecycle`(engine-dev 담당
`scripts/check_flag_lifecycle.js`)가 **하드 실패(비-0 exit)**한다. 그러면 팀/운영자는 셋 중 하나를 강제 선택한다:

1. **flip** — 검증 충족 → `status: "ON"`(+ 죽은 OFF 분기 정리, D4).
2. **sunset** — 폐기 → `status: "SUNSET"`(+ flag-gated 코드 제거).
3. **연장** — `reviewBy` 명시 갱신 + 사유 기록(D3).

오늘(2026-06-21) 기준 5개 전부 `reviewBy = 2026-09-19`(미경과) → 검사 통과. 2026-09-19 경과 후 강제 발동.

### D3. 연장은 명시 갱신 + 사유 기록 (침묵 드리프트 금지)

`reviewBy` 연장은 레지스트리 `reviewBy` 값을 명시적으로 갱신하고 `notes`(또는 후속 ADR/패치히스토리)에
연장 사유를 기록할 때만 허용한다. 검사 통과만을 위한 **침묵 드리프트**(사유 없는 날짜 밀기)는 금지 —
그 자체가 "플래그 무덤"의 재발이다. 연장은 결정이지 회피가 아니다.

### D4. ON/SUNSET 전환 시 죽은 분기 코드 정리 의무

`status` 가 `ON` 또는 `SUNSET` 으로 전환되면 해당 flag 의 OFF 분기(byte-identical 보존을 위한 죽은
경로)와 더 이상 의미 없는 ENV 게이트 호출을 정리한다. flag 전환은 코드 정리까지 포함하는 완결된
작업이지, ENV 한 줄만 바꾸고 죽은 분기를 남기는 작업이 아니다. (정리 작업은 해당 도메인 ADR/패치로
engine-dev 가 수행 — 본 ADR 은 *의무*만 규정한다.)

---

## Consequences

### 긍정
- "OFF 출하"(ADR-0146) 안전 규칙을 **폐기하지 않고 완결**한다 — 출하는 여전히 byte-identical 로 안전하되,
  flip 결정이 reviewBy 만료로 강제된다(stasis 봉인).
- 5개 기존 OFF 플래그가 burn-down 감사로 가시화·분류됐다(flip 후보 0611/0627 · 데이터 의존 0640/0546 ·
  관측 더 필요 0613) — 다음 액션이 레지스트리·문서에 명시.
- 신규 flag 도 D1 등재 의무로 거버넌스에 자동 편입 — 사각 0.
- 기계가독 SSOT(JSON) + validate 체인 진입점이라 사람 기억에 의존하지 않는다.

### 비용 / 위험
- reviewBy 만료 시 validate:flagLifecycle 하드 실패가 무관한 PR 의 CI 를 막을 수 있음 — 의도된 강제력이나,
  운영자는 만료 전에 flip/sunset/연장(D3) 으로 선제 처리해야 한다.
- 침묵 드리프트(D3) 는 검사기로 완전 차단 불가(날짜만 보면 통과) — 사유 기록은 규율(review) 의존.

### executionImpact
- **NONE** — 본 ADR 은 메타 거버넌스 정책 + 문서 + 기계가독 레지스트리(JSON)뿐이다. Gate 채점 본체·
  requiredScore=70 calibration·autoTradeEngine·kisClient·order path·SourceSnapshot 0줄. 5개 flag 의
  런타임 동작은 전부 현행 OFF(byte-identical) 그대로 — 본 ADR 은 어떤 flag 도 flip 하지 않는다.

### 9대 불변식 영향
- **#1 (Trading Engine 항상 살아 있음):** 위반 없음 — 거버넌스 메타 정책, 엔진 경로 0줄.
- **#2 (Shadow Learning 멈춤 없음):** 위반 없음 — shadow 관측은 그대로, 거버넌스는 flip 결정만 강제.
- **#3 / #9 (단일 SourceSnapshot · provider 직접 조회 금지):** 위반 없음 — provider/fetch/store 0접촉.
- **#6 (provider 장애 ≠ market signal):** 무관 — 메타 정책.
- **#7 (AI_ESTIMATED(L4) live 매매 금지):** 위반 없음 — 매매 결정 경로 무접촉.
- **#8 (실거래 차단 ≠ Shadow 차단):** 위반 없음 — 본 ADR 은 어떤 flag 도 flip 하지 않음(전부 OFF 유지).

본 거버넌스가 "ENV OFF = byte-identical" 안전 규칙(ADR-0146)을 **폐기하는 게 아니라 완결한다** —
출하 안전(OFF byte-identical) + flip 강제(reviewBy 만료)의 두 축으로 수명주기를 닫는다.

---

## Rollback

거버넌스는 LIVE 동작 0 변화(메타 정책)라 LIVE 롤백 대상이 없다. 거버넌스 자체를 비활성화하려면
package.json `validate:flagLifecycle`(engine-dev 배선) 을 validate 체인에서 제외하면 된다 — 단 그 경우
"플래그 무덤" 안티패턴이 재발한다. byte-equivalent 원칙(ADR-0146): LIVE 매매 본체 0줄 · KIS/KRX quota 0 침범.

---

## Alternatives Considered

1. **현행 유지(만료·강제 없는 default OFF)** — 기각. 정확히 본 ADR 이 해결하는 "플래그 무덤" 안티패턴 그
   자체. 출하 안전은 있으나 flip 결정 강제가 없어 영구 정체.
2. **운영자 캘린더 리마인더(코드 외부)** — 기각. 사람 기억·외부 도구 의존이라 사각 발생. 기계가독 SSOT +
   validate 하드 실패가 강제력 확보.
3. **만료 시 자동 flip** — 기각(불변식 #8). flip 은 forward-outcome 검증·운영자 승인이 필요한 결정이라
   자동화하면 미검증 분포 변경 위험(특히 데이터 의존 0640/0546). validate 는 *강제 선택*만 하고 결정은 사람.
4. **만료 시 자동 sunset(코드 제거)** — 기각. 관측 더 필요(0613)·flip 후보(0611/0627) 를 무차별 폐기.
   sunset 도 결정이라 사람 몫.
5. **레지스트리를 .ts 상수로** — 기각(SRP·단일 통로). 검사기(engine-dev)·문서·CI 가 공유하는 기계가독
   계약은 JSON(스키마 v1)이 적합 — 빌드 비의존·언어 중립. flag reader 본체는 여전히 gateConfig.ts SSOT.
6. **reviewWindowDays 를 flag 별 가변** — 기각(현 단계). top-level 단일 90일로 시작, 필요 시 후속 ADR 에서
   flag 별 override 추가(YAGNI).

---

## References

- 기계가독 SSOT: `scripts/gate_flag_lifecycle.json`(스키마 v1·`reviewWindowDays` 90·flags 5)
- 사람용 해설/감사: `docs/ai/gate-flag-lifecycle.md`
- 검사기(engine-dev 인계): `scripts/check_flag_lifecycle.js` + package.json `validate:flagLifecycle`
- flag reader SSOT: `server/trading/gateConfig.ts`(isGate1RegimeAwareRequiredEnabled·
  isGate1PositiveCeilingWiringEnabled·isGate1RsPercentileContinuousEnabled·isGate1DenominatorNormalizationEnabled) ·
  `server/trading/signalScanner/minimumSignalScoreTrace.ts`(isGate1SectorRsComponentEnabled)
- 거버넌스 대상 5개 ADR: 0546(regime-aware required-score)·0611(SECTOR_RS 재활성)·0613(positive-ceiling
  wiring)·0627(RS percentile 연속)·0640(denominator normalization)
- ADR-0146(byte-equivalent·"OFF 출하" 안전 규칙 — 본 ADR 이 *완결*)·0157(ENV 정확 비교)·0530(Patch Scope Guard)
- 불변식 #8(실거래 차단 ≠ Shadow 차단) — `docs/ai/00-project-charter.md`
