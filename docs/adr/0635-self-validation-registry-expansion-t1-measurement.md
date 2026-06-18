# ADR-0635 — 자가 활성 registry 확장(T1 측정/관측) + evidence-독립 LIVE_SAFE criteria

@responsibility ADR-0633 LEVER_REGISTRY 를 T1 측정/관측 인프라 4종(executionImpact NONE 검증)으로 확장하고 evidence-독립 criteria(`requiresEvidence:false`)를 도입하는 경계·타입 pin. T2 LIVE-인접은 `LIVE_ADJACENT_REVIEW`(운영자 1-체크포인트), T3 LIVE-money/절대보존은 EXCLUDED 유지. master OFF=byte-identical. 신규 ENV 0.

- **Status:** Proposed (Phase 0 — architect: registry 데이터·`requiresEvidence`/`LIVE_ADJACENT_REVIEW` 타입·ADR·INDEX. evaluator 분기 본문 engine-dev 인계.)
- **Date:** 2026-06-18
- **Type:** ADR (registry 확장 + 신규 eligibility 값 + criteria 필드)
- **Extends:** ADR-0633(자가 활성 엔진 — evaluator·ledger·master flag·LEVER_REGISTRY)·ADR-0634(런타임 cron wiring + 영속 streak). 본 ADR 은 그 registry 에 **T1 측정/관측 lever 4종을 LIVE_SAFE 로 추가**하고, 켜야 증거가 쌓이는 인프라를 위해 **evidence-독립 criteria** 를 도입한다. ADR-0631(PromotionReadinessBoard)·ADR-0476(Gate1ThresholdEvidenceSummary)·ADR-0157(`=== 'true'`)·ADR-0530(Patch Scope Guard) 준수.
- **executionImpact:** master OFF=NONE(byte-identical) / master ON=측정·관측 cron 자동 ON 만(LIVE 실주문 본체 0줄·kisClient/autoTradeEngine/order 0줄·SourceSnapshot/Gate 채점/universe/regime/sizing 무변경·requiredScore=70 무변경).

---

## 1. Context

ADR-0633(엔진)·ADR-0634(cron wiring)가 머지돼 "Shadow 검증 충족 시 LIVE_SAFE lever 를 엔진이 스스로 ON" 하는 루프가 살아 있다. 그러나 현재 `LEVER_REGISTRY` 의 LIVE_SAFE 는 단 2개(`PRICE_CORRECTION_SHADOW_ADR0623`·`TRADE_REPLACEMENT_SHADOW_EXECUTE_ADR0602`)뿐이다.

운영자 결정(2026-06-18): **"자가활성 registry 확장."** 검증 누적 후 default 를 손으로 수정하는 대신, **registry 를 넓혀 런타임 자동화로 처리**한다. 이는 PLAN.md ①(운영자 결정 의존 제거)·②(always-on)·③(기능 과잉 금지)의 직접 후속이다.

### 1.1 닭-달걀 deadlock — evidence-독립 criteria 의 필요

기존 2 lever 는 *judgement-of-value* (가격 보정값을 shadow 판단에 채택·교체 집행)라 forward-outcome 증거(matureD5·reviewReady·performanceJustified)가 충족돼야 활성하는 것이 옳다(`requiresEvidence:true`).

그러나 본 ADR 이 추가하는 **T1 측정/관측 인프라**(future-return 갱신·셰이크아웃 라벨링·게이트 귀인·shadow-vs-live delta)는 성격이 다르다 — **켜는 것 자체가 검증 데이터를 생성하는 인프라**다. 이들을 evidence 게이트 뒤에 두면 "증거가 없어서 안 켜고 → 안 켜서 증거가 안 쌓이는" 닭-달걀 deadlock 이 생긴다(실제로 ADR-0631 `/promotion_readiness` 가 counterfactual 표본 부족으로 INSUFFICIENT 인 한 원인). executionImpact 가 NONE 이라 켜도 LIVE byte-identical 이므로, 증거를 기다릴 이유가 없고 오히려 켜야 증거가 쌓인다.

처방: criteria 에 `requiresEvidence: boolean` 을 추가한다. `false` 인 lever 는 evidence 부재(`DATA_UNAVAILABLE`)로 막지 않고 **master ON + consecutive READY streak 충족만으로 ACTIVATE** 한다.

### 1.2 본 ADR 이 새로 만드는 것 / 만들지 않는 것

- **만든다:** (a) `LeverCriteria.requiresEvidence: boolean` 필드(evidence-독립 의미). (b) `AutoActivationEligibility` union 에 `LIVE_ADJACENT_REVIEW` 추가(T2 — 운영자 1-체크포인트). (c) LEVER_REGISTRY 에 T1 LIVE_SAFE 4종 + T2 LIVE_ADJACENT_REVIEW 4종 등재. (d) 기존 2 lever 에 `requiresEvidence:true` 부여(동작 보존).
- **만들지 않는다:** 새 측정/판정 공식(ADR-0631/0476 산출 재사용). 신규 데이터 fetch. 신규 ENV(기존 cron flag·0633 master flag 재사용). LIVE 실주문 경로 변경. Gate 채점 변경. requiredScore=70 변경. T3 lever 의 자동 활성(EXCLUDED 영구 유지).

---

## 2. Decision

### 2.1 evidence-독립 criteria — `requiresEvidence` 필드

`LeverCriteria` 에 boolean 필드 추가:

```ts
interface LeverCriteria {
  minMatureSamplesD5: number;
  requireReviewReady: boolean;
  requirePerformanceJustified: boolean;
  minConsecutiveReadyDays: number;
  requiresEvidence: boolean; // ADR-0635
}
```

**의미:**

- `requiresEvidence: true` (기존 seed 2건의 동작 — 보존) — 증거 부재 시 evaluator 가 `DATA_UNAVAILABLE` 로 막는다(forward-outcome 성숙 대기). matureD5·reviewReady·performanceJustified 를 criteria 와 비교한다. **현행 0633 동작과 완전 동일.**

- `requiresEvidence: false` (ADR-0635 T1 — 측정/관측 인프라) — evidence 부재(`DATA_UNAVAILABLE`)여도 활성 가능. evaluator 는 evidence 부재로 막지 않고, **master ON + consecutive READY streak(`minConsecutiveReadyDays`) 충족만으로 ACTIVATE**. evidence-게이트 criteria(`minMatureSamplesD5`/`requireReviewReady`/`requirePerformanceJustified`)는 0/false 로 두고 streak anti-flap 하나만 게이트로 남긴다.

**evaluator 분기 (engine-dev 구현 인계):** 현재 `evaluateAutoActivation` 는 LIVE_SAFE 경로에서 `if (!evidence || matureSamplesD5 === null) → DATA_UNAVAILABLE` 로 막는다. ADR-0635 는 이 분기를 `requiresEvidence` 로 게이트한다:

- `lever.criteria.requiresEvidence === true` → 현행 그대로(evidence 부재 시 DATA_UNAVAILABLE).
- `lever.criteria.requiresEvidence === false` → DATA_UNAVAILABLE 우회. evidence 부재여도 `evaluateLeverReadiness` 의 `readyExclStreak`(matureOk/reviewOk/perfOk — 0/false criteria 라 전부 true) + `consecutiveOk` 만으로 ACTIVATE. evidenceSnapshot 은 가용한 값(또는 null)을 그대로 기록한다.

`evaluateLeverReadiness` helper(ADR-0634)는 이미 `requiresEvidence:false` lever 에서 0/false criteria 를 받아 `matureOk=true`(matureSamplesD5≥0)·`reviewOk=true`·`perfOk=true` → `readyExclStreak=true` 를 반환한다(evidence 가 null 이면 `matureSamplesD5 !== null && ... >= 0` 이 false 가 되므로, engine-dev 는 `requiresEvidence:false` 시 matureOk 계산을 우회하거나 helper 에 분기를 추가한다 — §4 testsRequired). **본 ADR 은 타입·registry·의미만 확정하고 분기 본문은 engine-dev 가 구현한다.**

### 2.2 T1 — registry 확장 (LIVE_SAFE · executionImpact=NONE 만)

각 후보의 실제 executionImpact 를 `server/scheduler/learningJobs.ts` cron 본문 + 각 모듈 source/ADR 을 읽어 검증했다. **LIVE 주문·SourceSnapshot·Gate 판정·universe·regime·sizing 무영향(순수 학습/관측/진단)만 LIVE_SAFE 로 등재.** 근거 전문은 `_workspace/2026-06-18_intelligence-activation/architect-registry-expansion.md`.

| leverId | envName | executionImpact NONE 검증 | criteria |
|---------|---------|---------------------------|----------|
| `FUTURE_RETURN_RESOLVER_ADR0175` | `FUTURE_RETURN_RESOLVER_ENABLED` | ADR-0175 Phase 2b-1. ShadowLearningOnlySignal 의 1/3/5/20d future-return 갱신(`saveShadowLearningOnlySignals`). KIS 종가 read-only·학습 ledger 만 write. `learningJobs.ts:220` executionImpact=NONE 명시. | `requiresEvidence:false`, streak≥2 |
| `SHAKEOUT_STOP_FORWARD_LABELER_ADR0625` | `SHAKEOUT_STOP_FORWARD_LABELER_ENABLED` | ADR-0625. HIT_STOP 청산 포지션 손절-후 N일 종가 KIS 일봉(L1 read-only) 라벨링(관측 전용·`upsertLabel` 물리분리 ledger). shadow-trades.json 본체 무수정·주문 import 0. `learningJobs.ts:239`. | `requiresEvidence:false`, streak≥2 |
| `SAFETY_GATE_ATTRIBUTION_ADR0174` | `SAFETY_GATE_ATTRIBUTION_ENABLED` | ADR-0174 §2.1. 7 게이트 사후효과 일일 진단 로그. 순수 compute(영속 write 0·`computeSafetyGateAttribution`)·`console` 로그만. `learningJobs.ts:260`. | `requiresEvidence:false`, streak≥2 |
| `SHADOW_LIVE_DELTA_REPORT_ADR0174` | `SHADOW_LIVE_DELTA_REPORT_ENABLED` | ADR-0174 §2.2. 5 카테고리 missedAlpha 일일 진단 로그. 순수 compute(영속 write 0·`computeShadowVsLiveDelta`)·`console` 로그만. `learningJobs.ts:281`. | `requiresEvidence:false`, streak≥2 |

**검증 사실:** 4 cron 본문은 모두 첫 줄 master 가드 후 ① KIS 종가 read-only fetch(주입된 fetcher, kisClient 단일 통로) 또는 영속 read, ② 순수 compute, ③ 학습 ledger write 또는 `console` 로그 — 만 수행한다. autoTradeEngine·buyPipeline·order·SourceSnapshot 생성기·Gate 채점·aiUniverse·regime 에 닿는 호출은 0건이다(grep 검증). 4 lever 모두 `learningJobs.ts` 주석에 `executionImpact=NONE` 가 이미 명시돼 있다.

**criteria 선택:** `minMatureSamplesD5:0`·`requireReviewReady:false`·`requirePerformanceJustified:false`·`requiresEvidence:false`(evidence 게이트 전부 해제) + `minConsecutiveReadyDays:2`(부팅 flap 방지 보수적 하한 — master ON 직후 단발 평가로 켜지지 않고 2 거래일 연속 후 ACTIVATE). streak anti-flap 하나만 게이트로 남긴다.

### 2.3 T2 — `LIVE_ADJACENT_REVIEW` (신규 eligibility · 자동 활성 금지 · 운영자 1-체크포인트)

`AutoActivationEligibility` union 에 `LIVE_ADJACENT_REVIEW` 를 추가한다. EXCLUDED 와 동일하게 evaluator 가 **항상 `EXCLUDED` verdict·`process.env` 무접촉**이지만, 의미가 다르다 — *"절대 금지"가 아니라 LIVE-인접 동작 변경이라 자동 활성하지 않고 운영자가 인지·수동 검토(1-체크포인트)하는 영역"* 이다. registry 에 명시 등재해 "인지하되 자동화 금지"를 코드/문서로 박제한다.

| leverId | envName | LIVE-인접 사유 |
|---------|---------|----------------|
| `R6_TRIGGER_TRADEDATE_FRESHNESS_ADR0592` | `R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED` | ADR-0592. R6 트리거 tradeDate 신선도 게이트 — regime/R6 상태 LIVE 경로 인접. |
| `R6_RECOVERY_STUCK_EXIT_ADR0630` | `R6_RECOVERY_STUCK_EXIT_ENABLED` | ADR-0630 D2. R6 복구 stuck-exit(Kelly/display regime 정상화) — LIVE regime override·exit 위상 인접. |
| `GATE1_RS_PERCENTILE_CONTINUOUS_ADR0627` | `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` | ADR-0627. Gate1 RS 백분위 연속 채점식 — Gate1 채점 경로 변경 성격. |
| `INTRADAY_SCREENER_REFRESH_ADR0628` | `INTRADAY_SCREENER_REFRESH_ENABLED` | ADR-0628. 장중 리더 universe 신선화 — universe 구성 LIVE 인접. |

evaluator 분기는 추가 코드가 불필요하다 — 현행 `if (lever.eligibility !== 'LIVE_SAFE') → EXCLUDED` 분기가 `LIVE_ADJACENT_REVIEW` 도 자동 포섭한다(EXCLUDED verdict·process.env 무접촉). reasons/표시에 eligibility 가 그대로 노출돼 운영자가 "검토 대상"임을 인지한다.

### 2.4 T3 — EXCLUDED 유지 (LIVE-money / 절대 보존)

기존대로 변경 없음. `GATE1_REGIME_AWARE_REQUIRED`·`GATE1_POSITIVE_CEILING_WIRING_ENABLED`(`ABSOLUTE_PRESERVATION_EXCLUDED`)·`LEARNING_WEIGHT_PROMOTION_ENABLED`·`COUNTERFACTURE_GATE_APPLY_ENABLED`(`LIVE_MONEY_EXCLUDED`)는 자가 활성 영구 금지·운영자 명시 결정만(불변식 #7). `AUTO_TRADE_ENABLED`·`KIS_IS_REAL`·`VTS_PAPER_TRADING_ENABLED`(LIVE master)는 **registry 비등재**(절대 자가 토글 금지 — 등재 자체를 하지 않아 evaluator 가 인지조차 못 한다).

---

## 3. 불변식 준수 (9대 + 단일 통로)

- **#1 Trading Engine 무중단:** 본 ADR 은 registry 데이터·타입만 확장. evaluator 는 순수 함수(throw 격리는 cron wiring 책임). master OFF 면 미가동. 엔진 경로 밖.
- **#2 Shadow Learning 무중단:** T1 4종은 전부 shadow/learning 측정·관측을 *여는* 방향(future-return 갱신·라벨링·귀인·delta 분석). 정지 0 — 오히려 학습 증거 생산을 가속한다.
- **#3/#9 SourceSnapshot 단일 통로:** evaluator 는 provider 직접 조회 0. T1 cron 의 KIS 종가 fetch 는 kisClient 단일 통로(주입 fetcher). SourceSnapshot 생성기 미접촉.
- **#7 AI_ESTIMATED(L4) live 금지:** T3 LIVE_MONEY/required-score flip/learning→LIVE 가중치는 EXCLUDED 유지. T2 LIVE-인접은 `LIVE_ADJACENT_REVIEW`(자동 활성 금지). T1 은 측정/관측이라 LIVE 결정 무관.
- **#8 실거래 차단 ≠ shadow 차단:** T1 자동 ON 은 측정/관측 cron 만(executionImpact NONE). LIVE 실주문 경로 byte-identical. 두 차단 분리 유지.
- **절대 보존 임계:** requiredScore=70·CONDITION_PASS_THRESHOLD=5·STRONG_BUY 는 `ABSOLUTE_PRESERVATION_EXCLUDED` — 본 엔진이 절대 변경하지 않는다.
- **단일 통로:** kisClient/autoTradeEngine/aiUniverseService 미접촉. 자가 활성은 `process.env` set 으로 기존 reader 가 자동 픽업(reader 편집 0).

---

## 4. Patch Scope Guard (ADR-530)

- **targetDomain:** Self-activation-registry(데이터 확장) + Self-activation-engine-type(criteria/eligibility 타입). (2 이하.)
- **allowedFiles:**
  - 수정 `server/trading/selfValidationAutoActivationAdr0633.ts`(`LeverCriteria.requiresEvidence` 필드 + `AutoActivationEligibility` `LIVE_ADJACENT_REVIEW` + LEVER_REGISTRY T1 4종·T2 4종 등재 + 기존 2 lever `requiresEvidence:true` — architect. evaluator `requiresEvidence:false` 분기 본문 — engine-dev)
  - 본 ADR 문서 · `docs/adr/INDEX.md`(0635→0636) · `docs/ai/10-patch-history-index.md`(1줄) · `_workspace/2026-06-18_intelligence-activation/architect-registry-expansion.md`
  - 신규/추가 테스트 `selfValidationAutoActivationAdr0633.test.ts`(requiresEvidence:false ACTIVATE·streak anti-flap·LIVE_ADJACENT_REVIEW EXCLUDED) — quality-guard 검토 후 engine-dev
  - (wiring 무변경) cron 호출 site·streak repo 는 ADR-0634 그대로 — 본 ADR 은 registry 만 확장(cron 은 LEVER_REGISTRY 를 자동 순회).
- **forbiddenFiles:** `autoTradeEngine`·`buyPipeline`·`kisClient`·`SourceSnapshot` 생성기·`gateConfig.ts`·`learningJobs.ts` cron 본문(읽기만·수정 0)·T1/T2/T3 lever 의 reader 본체·`futureReturnResolver.ts`/`shakeoutStopForwardLabeler.ts`/`safetyGateAttribution.ts`/`shadowVsLiveDelta.ts` 본체·`src/**`·`.env.example`(신규 ENV 0).
- **expectedBehaviorChange:** master ON + T1 lever 가 streak≥2 거래일 충족 시 일일 cron 이 해당 측정/관측 ENV 를 런타임 자동 ON(evidence 부재여도). master OFF 면 0 변경. T2/T3 는 evaluator 가 항상 EXCLUDED(process.env 무접촉).
- **sourceSnapshotImpact:** NONE (provider 직접 조회 0).
- **executionImpact:** master OFF=NONE(byte-identical) / ON=측정·관측 cron 자동 ON 만(LIVE 실주문 본체 0줄·kisClient/autoTradeEngine/order 0줄·SourceSnapshot/Gate 채점/universe/regime/sizing/requiredScore=70 무변경).
- **shadowLearningImpact:** shadow/learning 측정·관측을 여는 방향(불변식 #2 강화·증거 생산 가속). 루프 무중단.
- **telegramImpact:** ACTIVATE 시 CH4(JOURNAL) 통지(ADR-0634 seam 재사용·executionImpact NONE). CH2 절대 금지. 신규 통지 경로 0.
- **providerImpact:** NONE (신규 fetch 0 — T1 cron 의 KIS 종가는 기존 ADR-0175/0625 경로·본 ADR 무변경).
- **신규 ENV:** **없음** — T1 4 flag(`FUTURE_RETURN_RESOLVER_ENABLED`·`SHAKEOUT_STOP_FORWARD_LABELER_ENABLED`·`SAFETY_GATE_ATTRIBUTION_ENABLED`·`SHADOW_LIVE_DELTA_REPORT_ENABLED`)·T2 4 flag·master flag 전부 `.env.example` 기존 등재. `.env.example` 변경 0.
- **testsRequired:** master OFF→전 lever MASTER_OFF·process.env 무접촉·byte-identical / T1 `requiresEvidence:false` lever + evidence 부재 + master ON + streak≥2 → ACTIVATE(DATA_UNAVAILABLE 우회·process.env set) / T1 lever + streak<2 → HOLD(anti-flap) / 기존 2 `requiresEvidence:true` lever + evidence 부재 → DATA_UNAVAILABLE(현행 무회귀) / T2 `LIVE_ADJACENT_REVIEW` lever → 항상 EXCLUDED·process.env 무접촉 / T3 EXCLUDED → 항상 EXCLUDED(무회귀) / 기존 15+ 테스트 무회귀.
- **rollbackPlan:** master ENV 1줄(`SELF_VALIDATION_AUTO_ACTIVATION_ENABLED=false`) → 엔진 미가동·byte-identical. registry 확장 + 타입 필드 revert(1커밋). 자가 활성된 T1 ENV 는 각 lever ENV 1줄로 추가 롤백(기존 default OFF 복귀·LIVE 영향 0 — 측정/관측 정지뿐).

---

## 5. Alternatives Considered

1. **검증 누적 후 default 를 손으로 수정** — 운영자 결정 의존(지침 ①)·"증거 충족인데 영구 잠금" 병목 잔존. **기각** — registry 확장 + 런타임 자동화(운영자 결정).
2. **T1 도 `requiresEvidence:true` 유지** — 측정/관측은 켜야 증거가 쌓이는데 evidence 게이트 뒤에 두면 닭-달걀 deadlock. executionImpact NONE 라 막을 안전상 이유 0. **기각** — `requiresEvidence:false`.
3. **T2 LIVE-인접도 LIVE_SAFE 자동 활성** — R6 트리거/복구·Gate1 채점식·universe 신선화는 LIVE 동작을 바꾼다(executionImpact ≠ NONE). 자동 활성 시 불변식 #8 위험. **기각** — `LIVE_ADJACENT_REVIEW`(운영자 1-체크포인트).
4. **T2 를 기존 EXCLUDED 계열로 등재** — "절대 금지"와 "운영자 검토 후 가능"은 의미가 달라 혼동·미래 운영자 결정 정보 손실. **기각** — 신규 `LIVE_ADJACENT_REVIEW` 값으로 의미 분리(인지하되 자동화 금지).
5. **T1 4 flag 를 default ON 으로 직접 flip** — registry 자동화 우회·운영자 수동 결정·anti-flap streak 보호 상실·롤백 단일 스위치(master) 무력화. **기각** — registry + cron 자동화.
6. **executionImpact 미검증 후보까지 LIVE_SAFE 일괄 등재** — 의심 플래그를 LIVE_SAFE 에 넣으면 #8 위험. **기각** — source/ADR 검증된 NONE 4종만 LIVE_SAFE, 의심분(T2)은 `LIVE_ADJACENT_REVIEW`.

---

## 6. References

- ADR-0633 — 자가 활성 엔진(evaluator·ledger·master flag·LEVER_REGISTRY — 본 ADR 이 확장)
- ADR-0634 — 자가 활성 런타임 cron wiring + 영속 streak(본 ADR 은 registry 만 확장·wiring 무변경)
- ADR-0631 — PromotionReadinessBoard 판정공식 (evidence 게이트 lever 재사용)
- ADR-0476 — Gate1ThresholdEvidenceSummary 증거 SSOT
- ADR-0175 — Future Return Resolver cron (T1 LIVE_SAFE)
- ADR-0625 — Shakeout stop forward labeler (T1 LIVE_SAFE)
- ADR-0174 — Safety gate attribution + shadow-vs-live delta (T1 LIVE_SAFE)
- ADR-0592 — R6 trigger freshness / intraday rebound (T2 LIVE_ADJACENT_REVIEW)
- ADR-0630 — R6 recovery stuck-exit (T2 LIVE_ADJACENT_REVIEW)
- ADR-0627 — Gate1 RS percentile continuous (T2 LIVE_ADJACENT_REVIEW)
- ADR-0628 — Intraday leader universe freshness (T2 LIVE_ADJACENT_REVIEW)
- ADR-0546/0613/0581/0624 — T3 EXCLUDED(required-score flip·positive-ceiling·weight promotion·counterfacture gate)
- ADR-0157 — ENV 정확 비교(`=== 'true'`) · ADR-0530 — Patch Scope Guard
- CLAUDE.md §2.1 불변식 #1·#2·#7·#8 · §2.2 requiredScore=70 절대불변
