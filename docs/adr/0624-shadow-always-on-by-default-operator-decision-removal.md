# ADR-0624 — Shadow Always-On by Default (운영자 결정점 제거 · 플래그 표면 축소)

@responsibility process — LIVE-안전 shadow 레버 default ON(opt-out) 전환으로 운영자 결정 의존 제거·always-on 복원. 결정점은 SHADOW→LIVE 단일 경계만. 불변식 0줄.

**Status:** Proposed (Phase 0 — 정책·경계 ADR. 설계 전용·코드 0줄. 구현은 승인 후 engine-dev/quality-guard 인계.)
**Date:** 2026-06-18
**계보:** 0619 / 0608 / 0581 / 0546 / 0173 / 0157 / 0146
**불변식:** #1(엔진 무중단 — always-on 강화) · #2(shadow 무정지 — default ON 으로 실질 보장) · #7(L4·paper→live 자동 차단 — SHADOW→LIVE 단일 게이트 보존) · #8(실거래 차단 ↔ shadow 차단 분리 — default ON 으로 복원). **9대 불변식 텍스트 0줄 변경.**

---

## Context

운영자 지침(2026-06-18): **① 운영자 결정에 의존하지 말 것 · ② 가장 중요한 원칙 "always-on trading" 을 먼저 보장할 것 · ③ 기능 과잉이 운영자를 혼란시킨다.**

진단: 시스템이 "shadow 에서도 매수 못 함 / 학습 정체 / 게이트 빡빡" 한 이유는 로직 부재가 아니라 **LIVE 에 안전한 기능까지 전부 `default OFF` 로 잠가두고 운영자 flag flip 을 기다리는 구조** 다. 이는 가장 중요한 원칙(always-on, 불변식 #1·#2)을 진입 경로에서 실질적으로 위반한다.

- **증거 1:** ADR-0619 Context — shadow 진입이 live 와 이중 게이트(Gate1 점수 + Gate3 타이밍)를 공유해 #8 이 무력화. `entryEngine.ts:370` OR 식이 단일 차단점.
- **증거 2:** 오늘(2026-06-18) `Patch-LearningRegime-CanonicalSource-v2` 가 R3_EARLY 인식 버그를 고쳤으나 그 패치 노트 자체가 명시 — *"본 수리는 regime 을 R3 로 정확 인식시킬 뿐 — 실제 shadow 진입 개방은 ADR-0608/0619 flag ON 별도 필요."* 즉 flag 가 OFF 라 고쳐도 안 열린다.
- **증거 3:** `_workspace/PENDING_WIRING.md`(ADR-0158) active 47건 중 대부분이 "운영자 결정 대기". 운영자가 매번 flag 를 켜야 하는 구조가 곧 병목이자 혼란원.
- **핵심 통찰:** 이 flag 들은 **LIVE 와 byte-identical** 이다(shadow paper-fill 만 영향, `isShadow` 게이트로 live 경로 0 변경). 켜지 않을 *안전상* 이유가 없다 — `default OFF` 는 안전이 아니라 *관성* 이다.

불변식 #8 은 원인이 아니라 처방이다. `default OFF → ON` 으로 뒤집는 것이 #2/#8 을 *위반* 이 아니라 *지키는* 것이다.

---

## Decision

**LIVE-안전 shadow 레버를 opt-in(default OFF) 에서 opt-out(default ON) 으로 뒤집고, 운영자 결정점을 "SHADOW→LIVE 승격" 단일 경계로 축소한다.** 새 임계식·새 불변식·새 거버넌스 레이어 0. 기존 ADR(0619/0608/0581/0546) 의 설계를 *재사용* 하되 **default 극성과 운영자 게이트 위치만** 바꾼다.

### D1 — Shadow 진입 자유화 = default ON (always-on 복원)

- ADR-0619 D2(`SHADOW_PREBREAKOUT_ENTRY_ENABLED`) + ADR-0608(`GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED`) 의 **기본값을 ON 으로** 한다(구현 시 ENV resolver 기본값 반전). live 는 `isShadow=false` 라 **byte-identical** — LIVE 위험 0.
- 운영자 flag flip 불필요 → shadow 가 항상 자유롭게 관측·학습(불변식 #2 실질 보장, always-on).
- **단일 비상 kill-switch 만** 둔다: `SHADOW_LIBERALIZATION_KILL=true` (미설정=정상 가동). 이는 *기능 추가* 가 아니라 *knob 축소* 다 — opt-in flag 2개 → 비상 OFF 1개.
- ADR-0619 D2 구현(entryEngine:370 재구조화 + skipCause enum)은 여전히 필요(설계 SSOT=ADR-0619). 본 ADR 은 그 **기본값과 운영자 의존성만** 바꾼다.

### D2 — Shadow 학습 자동 적용 (운영자 승인 제거, shadow 한정)

- ADR-0581 의 shadow/candidate 가중치 학습을 **shadow 모델에 자동 반영**한다(운영자 승인 0). shadow 는 실돈을 못 건드리므로(불변식 #8) 승인 게이트가 불필요하다.
- 현 `governanceStatus: PENDING_REVIEW` 영구 정체는 **shadow 측에서 제거** — `dynamicWeightFeedback` → shadow 가중치 provider 자동 등록(shadow lane 한정).
- **운영자 승인은 오직 SHADOW→LIVE 승격 한 곳** (D4). live 가중치 주입은 `NON_LIVE_SOURCE` guardrail·clamp(CORE_FLOOR 0.30)·canary 그대로 보존(불변식 #7).

### D3 — 플래그 표면 축소 (혼란 감소)

- shadow 경로의 opt-in OFF flag 들을 정리: 진입 flag 2개(0608/0619) → default ON + 비상 kill 1개. shadow 학습 승인 flag → shadow 측 자동(LIVE 측만 유지).
- "활성화 캠페인 / 단계별 사전확약 게이트" 같은 메타 거버넌스 레이어는 **추가하지 않는다** — 그 자체가 기능 과잉·혼란원(운영자 지침 ③). 운영자 결정을 *체계화* 하는 게 아니라 *제거* 한다.

### D4 — 유일한 운영자 결정점 = SHADOW→LIVE (data-triggered 단일 확인)

- LIVE 실주문에 영향을 주는 변경(Gate1 required-score 레짐 flip = ADR-0546/C19 · 가중치 LIVE 승격 = ADR-0581 Phase 4 canary→LIVE)만 **단일 인간 확인** 게이트를 유지한다 — 돈이 걸린 유일한 경계라 1개 게이트가 정당(불변식 #7·안전).
- 단 상시 flag 관리가 아니라, **데이터 충족 시 시스템이 "증거 충족 — LIVE 승격 확인?" 을 1회 제시**(운영자가 무엇을 켤지 매번 고민 X). LIVE 측은 **default OFF 유지**(보수적).

### D5 — 본 ADR 자체 byte-equivalent

정책·경계 SSOT 문서. 코드·ENV·테스트 0 변경. 본 ADR 발급으로 runtime 0 변화. default 반전·flag 축소·shadow 자동 적용 구현은 승인 후 별도(engine-dev/quality-guard).

---

## Consequences

**긍정:**
- always-on 복원 — shadow 가 항상 매수/학습(운영자 개입 0). 불변식 #2/#8 을 *지킨다*.
- 운영자 결정점 N개 → **1개**(SHADOW→LIVE). 혼란 격감(지침 ③).
- 순-신규 설계 ≈ 0 — 기존 ADR 의 default 극성·게이트 위치만 반전. 코드 추가 최소.
- LIVE byte-identical 유지 + 비상 kill-switch 1개로 즉시 정지 가능.

**부정/리스크:**
- default ON 은 출하 시 동작 변화(shadow 대량 paper-fill) — 단 LIVE-safe, 회귀 + kill-switch 로 방어.
- 본 ADR 은 ADR-0619 Alt(h)·ADR-0608·ADR-0157 의 "default OFF" 관성을 **LIVE-safe shadow 한정으로 명시 override** 한다(운영자 지침 2026-06-18 근거). **LIVE 에 영향 주는 변경은 여전히 default OFF.**
- shadow 학습 자동 적용은 shadow 모델 품질 변동 가능 — shadow 한정이라 LIVE 무영향, 라벨 격리 + `weightHistoryRepo` 스냅샷 롤백.

**executionImpact:** 본 ADR 문서 = **NONE**. 구현 시: D1/D2 = shadow 확대·**LIVE byte-identical** / D4 = LIVE 변경(단일 게이트·default OFF 유지).

---

## Alternatives Considered

(a) **활성화 캠페인(단계별 사전확약 게이트)** — 기각. 또 다른 거버넌스 레이어 = 기능 과잉·운영자 혼란(지침 ③ 위반). 이전 ADR-0624 초안(`intelligence-activation-campaign-staged-dormant-asset-sequencing`)을 본 ADR 이 **대체·폐기**.
(b) **불변식 수정(#8 완화 등)** — 기각. VERBATIM 고정(운영자 결정). #8 은 원인 아닌 처방 — 복원이 문제를 푼다.
(c) **default OFF 유지 + 운영자 flip** — 기각. 그게 바로 병목(PENDING_WIRING 47건·오늘 패치 노트 "flag ON 별도 필요"). 지침 ① 위반.
(d) **LIVE 까지 default ON** — 기각. 돈 경계는 단일 인간 게이트가 정당(불변식 #7·안전). LIVE 는 보수적 유지.
(e) **shadow 학습도 운영자 승인 유지** — 기각. shadow 는 실돈 무관(#8) — 승인은 불필요한 병목·혼란.
(f) **patch type** — 기각. default 극성·운영자 게이트 위치 변경 = 정책 경계 변경 = ADR 의무(단 코드 0줄·executionImpact NONE).

---

## References

- ADR-0619 / ADR-0608 — shadow 진입 자유화 (D1 default 반전 대상, 진입 로직 설계 SSOT)
- ADR-0581 — shadow→live 조건가중치 승격 (D2 shadow 자동 적용 · D4 LIVE 단일 게이트)
- ADR-0546 / PENDING_WIRING C19 — live Gate1 required-score (D4 LIVE 단일 게이트)
- ADR-0173 — shadow learning persistence (shadow 무정지 SSOT)
- ADR-0157 — ENV default 정책 (본 ADR 이 LIVE-safe shadow 한정 예외 명시) · ADR-0146 — PR 자가 review 5 카테고리
- `_workspace/2026-06-18_intelligence-activation/PLAN.md` — 동반 plan (동일 thesis)
- **대체됨:** 이전 ADR-0624 초안 `intelligence-activation-campaign-staged-dormant-asset-sequencing`(캠페인 프레이밍 — 운영자 지침 ①③ 충돌로 폐기)

## Patch Scope Guard (ADR-530)

- **targetDomain:** process/policy (문서 — **0 코드 도메인**). 구현 stage: D1 entry/shadow · D2 learning(shadow) · D4 trading/gate(LIVE).
- **allowedFiles:** 본 ADR · `docs/adr/INDEX.md`(다음발급 + 인덱스 한 줄) · `docs/ai/10-patch-history-index.md`(한 줄) · `_workspace/2026-06-18_intelligence-activation/**`(plan). **소스 코드 0.**
- **forbiddenFiles:** `server/**` · `src/**` · `.env*` · 인용 ADR 본문(0619/0608/0581/0546) · `docs/ai/00-project-charter.md` 9대 불변식.
- **expectedBehaviorChange:** **0** (문서). 구현 시 D1/D2 shadow 확대(default ON)·D4 LIVE 단일 게이트.
- **sourceSnapshotImpact:** NONE (코드 0·우회 0, 불변식 #3/#9).
- **executionImpact:** 문서 **NONE** / 구현 D1·D2 = shadow 확대(**LIVE byte-identical**) · D4 = LIVE(default OFF·단일 게이트).
- **shadowLearningImpact:** NONE(문서) / 구현 시 shadow 자동 적용 + 라벨 격리(LIVE 미도달).
- **telegramImpact:** NONE (D4 승격 확인 제시는 후속 구현 소관 — 채널 라우팅 무변경).
- **providerImpact:** NONE (신규 fetch 0 — 각 stage 도 이미 fetch 된 데이터 재사용).
- **testsRequired:** 본 ADR 코드 0 → 회귀 0. 구현: D1 ADR-0619 8종 + **default ON 시 live byte-identical** 회귀 + kill-switch ON→정지 복귀. D2 shadow 자동 적용 + LIVE 미도달(`NON_LIVE_SOURCE`). D4 LIVE flag OFF byte-identical. 문서 게이트: `validate:adrIndex`(다음 발급 0625 정합) + `validate:responsibility`.
- **rollbackPlan:** 문서 revert(runtime 0). 구현: D1 kill-switch 1줄(`SHADOW_LIBERALIZATION_KILL=true`) / D2 shadow provider 미등록 → byte-identical / D4 ENV 1줄(`GATE1_REGIME_AWARE_REQUIRED` / promotion flag).
- **complexity:** 문서 — 소스 복잡도 0 영향. 구현 stage 는 인용 ADR(ADR-0619 entryEngine 572+~25 등 전부 1,500 미만).

---

### Invariant pre-check (must all hold — 9대 불변식 텍스트 0줄 변경)

- [x] **#1 Trading Engine 무중단** — always-on 강화(shadow 상시 가동). hard-block 신설 0.
- [x] **#2 Shadow Learning 무정지** — default ON 으로 **실질 보장**(운영자 미개입에도 가동). SELL_ONLY/R6/providerIssue 에서 shadowAllowed 불변.
- [x] **#3 단일 SourceSnapshot** — Gate 내부 provider fetch 0(이미 fetch 된 quote/gate 재사용).
- [x] **#4/#5 상태 ≠ 데이터** — 무관.
- [x] **#6 providerIssue ≠ 약세** — UNKNOWN skipCause → bypass 불가(ADR-0619 보수 차단 보존).
- [x] **#7 L4 미사용 / paper→live 자동 차단** — SHADOW→LIVE 단일 게이트 + `NON_LIVE_SOURCE` guardrail 보존(shadow 단독 core 자동기록 불가).
- [x] **#8 실거래 차단 ↔ shadow 차단 분리 복원** — default ON 으로 shadow 자유 복원(live byte-identical).
- [x] **#9 SourceSnapshot 우회 0** — Gate 내부 직접 조회 0.
- [x] **LIVE 본문 0줄 + 비상 kill-switch/ENV 1줄 롤백** — 문서 코드 0. shadow 확대는 kill-switch 1줄, LIVE 변경(D4)은 ENV 1줄 + default OFF.
