# ADR-0633 — Shadow 자가 검증 후 LIVE-safe ENV 게이트 자동 활성화 엔진

@responsibility ADR-0633 LIVE-safe shadow/diagnostic ENV 게이트를 Shadow 검증 기준 충족 시 엔진이 스스로 ON 하는 순수 evaluator + audit ledger 경계 pin. LIVE-money/절대보존 게이트 EXCLUDED. master OFF=byte-identical.

- **Status:** Proposed (Phase 0 — architect 경계·타입·lever registry·criteria·master flag/SSOT·audit/telegram seam pin. evaluator/ledger 함수 본문 engine-dev 인계.)
- **Date:** 2026-06-18
- **Type:** ADR (신규 자가활성 경계 + 정책)
- **Supersedes / extends:** ADR-0631(Shadow→Live 승격 준비도 진단·PromotionReadinessBoard 판정공식) 위에 **운영자 수동 ENV flip 제거** 를 얹는다. ADR-0546/0613/0581/0624 의 승격 기구를 호출하지 않는다. ADR-0157(=== 'true' 정확 비교)·ADR-0530(Patch Scope Guard)·ADR-0471(freeze rule) 준수.
- **executionImpact:** master OFF=NONE(byte-identical) / master ON=LIVE_SAFE shadow·diagnostic 게이트 자동 ON 만(LIVE 실주문 본체 0줄·kisClient/autoTradeEngine/order 0줄·requiredScore=70 무변경).

---

## 1. Context

운영자 장기 지침(2026-06-18, PLAN.md ①②③): "운영자 결정에 의존하지 말 것 · always-on
trading 최우선 · 기능 과잉 = 혼란." ADR-0631 이 Shadow→Live 승격 준비도를 **read-only 진단**
으로 통합했으나, 그 진단을 보고 ENV 를 flip 하는 것은 여전히 **운영자의 수동 행위**다. 즉
"증거가 충족됐는데도 운영자가 ENV 를 안 켜면 좋은 기능이 영구 잠금" 상태가 남는다 — PLAN.md
가 지적한 *"LIVE 에 안전한 기능까지 default OFF 로 잠가 운영자 flag flip 을 기다리는"* 정확히
그 병목.

본 ADR 의 처방: **LIVE 에 안전한(shadow/diagnostic) ENV 게이트에 한해**, Shadow 검증 기준이
충족되면 엔진이 스스로 그 ENV 를 런타임 ON 한다. 운영자의 수동 flip 의존을 제거한다.

**핵심 안전 원칙 — 자가 활성은 "안전한 곳에서만".** 돈이 걸린 경계(LIVE 실주문·사이징·LIVE
required-score flip·learning→LIVE 가중치 승격)는 **절대 자가 활성하지 않는다.** 그 경계는
EXCLUDED 판정만 내고 `process.env` 를 건드리지 않으며, 불변식 #7·#8·"절대 보존 임계"가
그대로 backstop 으로 남는다.

### 1.1 본 ADR 이 새로 만드는 것 / 만들지 않는 것

- **만든다:** (a) 순수 evaluator `selfValidationAutoActivationAdr0633.ts`(provider/store/now/fetch
  직접 호출 0) + (b) in-memory audit ledger + (c) master ENV flag + (d) LIVE_SAFE lever registry.
- **만들지 않는다:** 두 번째 승격 판정 공식(ADR-0631 `PromotionReadinessBoard` 판정 로직을
  재사용/참고). 신규 데이터 fetch·재계산(기존 증거를 입력으로 받음). LIVE 실주문 경로 변경.
  Gate 채점 변경. requiredScore=70 변경.

---

## 2. Decision

### 2.1 모듈 위치·@responsibility

- **신규 파일:** `server/trading/selfValidationAutoActivationAdr0633.ts`
- **분류:** 순수 leaf + in-memory ledger. provider/store/`Date.now()`/fetch 직접 호출 0
  (evaluator 는 `now`·증거를 **입력으로 받는다**). executionImpact = master OFF NONE.
- **import 허용(타입만):** `promotionReadinessAdr0631.js`(`PromotionReadinessBoard`·판정 enum 참고),
  `gate1DryRunObservationLedgerAdr0476.js`(`Gate1ThresholdEvidenceSummary` 타입),
  `counterfactualOutcomeBoard.js`(`CounterfactualOutcomeBoard` 타입).
- **import 금지(불변식 경계):** `autoTradeEngine`·`buyPipeline`·`kisClient`·`SourceSnapshot`
  생성기·`gateConfig`(read 도 금지 — 본 모듈은 게이트 채점 무관)·`learningWeightPromotionApply`·
  `gateLearnedThresholdApply`. 본 모듈은 register*/unregister* 쓰기 seam 을 호출하지 않는다.

### 2.2 Master ENV flag (default OFF · byte-identical)

- **flag:** `SELF_VALIDATION_AUTO_ACTIVATION_ENABLED` — default OFF.
- **SSOT reader:** `isSelfValidationAutoActivationEnabled()` — **정확 비교 `=== 'true'`**
  (ADR-0157 — `'1'`/`'TRUE'`/`'yes'` 거부). 호출자 inline ENV 검사 금지.
- **master OFF = byte-identical:** 엔진 미가동. 어떤 `process.env` 도 건드리지 않는다. lever
  registry 평가 0회. ENV 1줄(`=false`) 즉시 롤백.

### 2.3 활성화 메커니즘 (기존 reader 편집 0 · 자동 픽업)

ACTIVATE 판정된 **LIVE_SAFE** lever 에 대해서만 런타임에:

```
process.env[lever.envName] = 'true';
```

기존 `process.env.X === 'true'` reader 들이 다음 호출부터 자동 픽업한다. **실행경로 reader
편집 0줄** — 본 ADR 은 reader 를 수정하지 않는다(자동 픽업 설계). LIVE_MONEY/절대보존 lever 는
EXCLUDED 판정만 내고 **절대 `process.env` 를 건드리지 않는다.**

### 2.4 Lever registry (eligibility 3분류)

각 lever = `{ leverId, envName, eligibility, criteria }`.

| eligibility | 의미 | 자가 활성? |
|-------------|------|-----------|
| `LIVE_SAFE` | ON 이 shadow/diagnostic 만 바꿈 — LIVE 실주문·사이징 byte-identical | **예** (ACTIVATE 시 process.env set) |
| `LIVE_MONEY_EXCLUDED` | ON 이 LIVE 실주문/사이징/required-score/learning→LIVE 가중치에 영향 | **아니오** (EXCLUDED 판정만·process.env 무접촉) |
| `ABSOLUTE_PRESERVATION_EXCLUDED` | "절대 보존 임계"(requiredScore=70·CONDITION_PASS_THRESHOLD=5·STRONG_BUY) 영향 | **아니오** (EXCLUDED 판정만·process.env 무접촉) |

**오직 `LIVE_SAFE` 만 자가 활성 대상.** EXCLUDED 두 부류는 registry 에 등재되어 **자가 활성
금지가 명시적으로 기록**되며 evaluator 는 그들에 대해 항상 `EXCLUDED` verdict 만 반환한다.

#### LIVE_SAFE 분류 근거 (architect 조사)

선정 원칙: ① default OFF(`=== 'true'`) ② ON 시 `isShadow` 게이트 뒤 또는 진단/관측 전용이라
LIVE 실주문·사이징·Gate 채점 byte-identical ③ ADR-0631 승격 증거로 정당화 가능.

| leverId | envName | LIVE_SAFE 근거 |
|---------|---------|----------------|
| `PRICE_CORRECTION_SHADOW_ADR0623` | `PRICE_CORRECTION_SHADOW_ENABLED` | ADR-0623 Stage 2 — corrected 값을 **shadow 판단에만** 채택. LIVE byte-equivalent. default OFF. |
| `TRADE_REPLACEMENT_SHADOW_EXECUTE_ADR0602` | `TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED` | ADR-0602 Phase 1 — 교체 집행이 **shadow 장부 내에서만**. `mode='LIVE'` trade 무접촉(불변식 #8). default OFF. |

> 본 두 lever 는 *예시 seed registry* 다. engine-dev/quality-guard 는 동일 분류 기준
> (shadow/diagnostic-only + default OFF + ADR-0631 증거 정당화)을 만족하는 추가 lever 를
> `LIVE_SAFE` 로 등재할 수 있다. 단 분류 변경/추가 시 본 §2.4 근거 표를 갱신한다.

#### EXCLUDED 분류 (자가 활성 영구 금지 — 명시 등재)

| leverId | envName | EXCLUDED 부류 | 근거 |
|---------|---------|---------------|------|
| `GATE1_REGIME_AWARE_REQUIRED_ADR0546` | `GATE1_REGIME_AWARE_REQUIRED` | `ABSOLUTE_PRESERVATION_EXCLUDED` | LIVE Gate1 required-score flip(ADR-0546). requiredScore=70 절대 보존 영역. |
| `GATE1_POSITIVE_CEILING_WIRING_ADR0613` | `GATE1_POSITIVE_CEILING_WIRING_ENABLED` | `ABSOLUTE_PRESERVATION_EXCLUDED` | Gate1 positive-ceiling(ADR-0613) — 채점/통과 판정 영향 가능. |
| `LEARNING_WEIGHT_PROMOTION_ADR0581` | `LEARNING_WEIGHT_PROMOTION_ENABLED` | `LIVE_MONEY_EXCLUDED` | learning→LIVE 가중치 승격(ADR-0581). 불변식 #7. |
| `COUNTERFACTURE_GATE_APPLY_ADR0624` | `COUNTERFACTURE_GATE_APPLY_ENABLED` | `LIVE_MONEY_EXCLUDED` | 학습 Gate1 임계 provider 의 LIVE 반영(ADR-0624). 불변식 #7. |

이들은 **운영자 명시 결정(ADR-0631 §(b) 단계 3 게이트)** 으로만 켤 수 있다. 본 엔진은
그들에 대해 EXCLUDED verdict 만 내고 절대 토글하지 않는다.

### 2.5 Criteria spec (ADR-0631 판정 재사용)

각 lever 의 `criteria`:

```ts
interface LeverCriteria {
  minMatureSamplesD5: number;       // Gate1ThresholdEvidenceSummary.matureSamplesD5 하한
  requireReviewReady: boolean;      // evidence.reviewReady === true 요구
  requirePerformanceJustified: boolean; // PromotionReadiness 판정의 performanceJustified 요구
  minConsecutiveReadyDays: number;  // 호출자가 추적한 consecutive-READY 일수 하한 (anti-flap)
}
```

**evaluator 는 새 임계를 발명하지 않는다.** `reviewReady`·`matureSamplesD5`·
`performanceJustified` 는 전부 ADR-0631 `buildPromotionReadinessBoard` / ADR-0476
`buildGate1ThresholdEvidenceSummary` 가 이미 계산한 산출물. evaluator 는 그것을 **입력으로 받아**
criteria 와 비교만 한다. `minConsecutiveReadyDays` 는 단발 READY 로 켜지는 flap 을 막는
hysteresis — 호출자(engine-dev wiring)가 일별 READY 연속일수를 추적해 입력으로 주입한다.

### 2.6 Audit ledger + Telegram seam

- 모든 `ACTIVATE`(process.env set 실행)에 `AutoActivationLedgerEntry` 를 in-memory ledger 에
  append(leverId·envName·activatedAt·근거 evidence 스냅샷·criteria). `EXCLUDED`/`HOLD`/`SKIP`
  은 report 에만 기록(ledger append 는 ACTIVATE 한정).
- Telegram 통지는 **seam 만**(engine-dev wiring) — 본 모듈은 ledger 와 report 를 노출하고,
  호출자가 그것을 텔레그램으로 전송한다. 본 모듈은 텔레그램을 직접 import 하지 않는다.

---

## 3. 불변식 준수 (9대 + 단일 통로)

- **#1 Trading Engine 무중단:** evaluator 는 순수 함수(throw 격리는 engine-dev wiring 책임).
  master OFF 면 미가동. 엔진 경로 밖.
- **#2 Shadow Learning 무중단:** 자가 활성은 shadow 를 *여는* 방향(LIVE_SAFE shadow 게이트 ON).
  정지 0.
- **#3/#9 SourceSnapshot 단일 통로:** evaluator 는 provider 직접 조회 0(증거를 입력으로 받음).
  SourceSnapshot 미접촉.
- **#7 AI_ESTIMATED(L4) live 금지:** LIVE_MONEY/required-score flip/learning→LIVE 가중치 승격은
  전부 EXCLUDED — 자가 활성 절대 불가. forward-outcome 검증(reviewReady) 전 LIVE 영향 0.
- **#8 실거래 차단 ≠ shadow 차단:** LIVE_SAFE 만 자동 ON(shadow/diagnostic). LIVE 실주문 경로
  byte-identical. 두 차단은 분리된 채 유지.
- **절대 보존 임계:** requiredScore=70·CONDITION_PASS_THRESHOLD=5·STRONG_BUY 는
  `ABSOLUTE_PRESERVATION_EXCLUDED` — 본 엔진이 절대 변경하지 않는다.
- **단일 통로:** kisClient/autoTradeEngine/aiUniverseService 미접촉. 자가 활성은 `process.env`
  set 으로 기존 reader 가 자동 픽업(reader 편집 0).

---

## 4. Patch Scope Guard (ADR-530)

- **targetDomain:** Self-activation-engine(신규) + Diagnostics-evidence(read) + Config-flag. (3 이하.)
- **allowedFiles:**
  - 신규 `server/trading/selfValidationAutoActivationAdr0633.ts`
  - 신규 테스트 `selfValidationAutoActivationAdr0633.test.ts`(quality-guard 검토 후 engine-dev)
  - 본 ADR 문서 · `docs/adr/INDEX.md`(0633→0634) · `docs/ai/10-patch-history-index.md`(1줄) ·
    `.env.example`(master flag 1개) · `ARCHITECTURE.md`(신규 모듈 경계 1줄)
  - (wiring) 호출 site + 텔레그램 통지 seam — engine-dev 가 별도 PR 로 결정.
- **forbiddenFiles:** `autoTradeEngine`·`buyPipeline`·`kisClient`·`SourceSnapshot` 생성기·
  `gateConfig.ts`·`gate1DryRunObservationLedgerAdr0476.ts` 본체·`counterfactualOutcomeBoard.ts`
  본체·`learningWeightPromotionApply.ts`·`gateLearnedThresholdApply.ts`·`REGIME_CONFIGS`·
  EXCLUDED lever 의 reader 본체·`src/**` 전부.
- **expectedBehaviorChange:** master ON + LIVE_SAFE lever criteria 충족 시 해당 ENV 가 런타임
  자동 ON(=shadow/diagnostic 게이트 활성). master OFF 면 0 변경.
- **sourceSnapshotImpact:** NONE (provider 직접 조회 0·snapshot 미접촉).
- **executionImpact:** master OFF=NONE / ON=LIVE_SAFE shadow·diagnostic 게이트 자동 ON 만
  (LIVE 실주문 본체 0줄·kisClient/autoTradeEngine/order 0줄·requiredScore=70 무변경).
- **shadowLearningImpact:** shadow 를 여는 방향(불변식 #2 강화). 루프 무중단.
- **telegramImpact:** ACTIVATE 통지 seam(engine-dev wiring) — 본 모듈은 직접 전송 0.
- **providerImpact:** NONE (신규 fetch 0).
- **testsRequired:** master OFF→평가 0·process.env 무접촉·byte-identical / LIVE_SAFE criteria
  충족→ACTIVATE+process.env set+ledger append / criteria 미충족→HOLD(process.env 무접촉) /
  EXCLUDED lever→항상 EXCLUDED·process.env 절대 무접촉(LIVE_MONEY·ABSOLUTE_PRESERVATION 양쪽) /
  consecutive-READY 미달→HOLD(anti-flap) / 이미 ON 인 lever→SKIP(중복 set 0) / ADR-0157 정확
  비교(`'1'`/`'TRUE'` 거부).
- **rollbackPlan:** master ENV 1줄(`SELF_VALIDATION_AUTO_ACTIVATION_ENABLED=false`) → 엔진
  미가동·byte-identical. 신규 파일 1개 + 테스트 revert(1커밋). 자가 활성된 ENV 는 각 lever ENV
  1줄로 추가 롤백 가능(기존 default OFF 복귀).

---

## 5. Alternatives Considered

1. **운영자 수동 flip 유지(ADR-0631 진단만)** — 운영자 결정 의존을 제거하라는 지침 ①과 충돌.
   안전한 곳(shadow)까지 사람을 기다리게 함. **기각**(단 EXCLUDED 경계는 의도적으로 유지).
2. **모든 default-OFF flag 자가 활성** — LIVE_MONEY/required-score flip 까지 자동화하면 불변식
   #7/#8·절대 보존 임계 위반. **기각** — LIVE_SAFE 만.
3. **reader 들을 자가 활성 판정으로 직접 교체** — 실행경로 N개 reader 편집 = byte 변경·회귀
   위험·SRP 위반. **기각** — `process.env` set + 자동 픽업(reader 0줄).
4. **새 성숙/성과 임계 정의** — ADR-0631 `PromotionReadinessBoard`·ADR-0476
   `reviewBlockers`/`matureSamplesD5` SSOT 와 이중 진실원. **기각** — 기존 판정 재사용.
5. **default ON master flag** — 자가 활성은 강한 자동화라 opt-in 이어야 안전. **기각**(default OFF).

---

## 6. References

- ADR-0631 — Shadow→Live 승격 준비도 진단 (`PromotionReadinessBoard` 판정공식 재사용)
- ADR-0476 — Gate1 dry-run observation ledger (`Gate1ThresholdEvidenceSummary` 증거 SSOT)
- ADR-0546 — regime-aware Gate1 required-score flag (EXCLUDED — required-score flip)
- ADR-0613 — Gate1 positive-ceiling wiring (EXCLUDED — 채점 영향)
- ADR-0581 — shadow→live weight promotion pipeline (EXCLUDED — LIVE money)
- ADR-0624 — `/promote_learning` 단일 게이트 + counterfacture gate apply (EXCLUDED — LIVE money)
- ADR-0623 — PriceCorrection shadow 채택 (LIVE_SAFE seed)
- ADR-0602 — sector replacement shadow execute (LIVE_SAFE seed)
- ADR-0157 — ENV 정확 비교(`=== 'true'`)
- ADR-0471 — freeze rule (관측 + 승인 선행)
- ADR-0530 — Patch Scope Guard
- CLAUDE.md §2.1 불변식 #7·#8 · §2.2 requiredScore=70 절대불변
