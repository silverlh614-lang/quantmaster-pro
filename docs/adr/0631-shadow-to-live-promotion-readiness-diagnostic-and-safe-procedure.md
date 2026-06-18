# ADR-0631 — Shadow→Live 승격 준비도 진단 + 안전 승격 절차

@responsibility Shadow forward-outcome 데이터로 라이브 임계/가중치 승격을 판정하는 read-only 진단 surface(레버별 READY/NOT_READY)와 byte-equivalent 안전 승격 절차를 pin. 라이브 무변경.

- **Status:** Proposed (Phase 0 — architect 경계·시그니처·판정규칙·노출지점·절차 pin. 구현 engine-dev 인계.)
- **Date:** 2026-06-18
- **Type:** ADR (신규 read-only 진단 모듈 경계 + 승격 절차 정책)
- **Supersedes / extends:** ADR-0476(forward-outcome ledger) · ADR-0546(regime-aware threshold flag) · ADR-0581/0624(condition-weight promotion 게이트) · ADR-0471(freeze rule) · ADR-0610(counterfactual board) 위에 **읽기 전용 결정 surface** 를 얹는다. 새 승격 엔진이 아니다.
- **executionImpact:** NONE (순수 read·신규 fetch 0·라이브 본체 0줄)

---

## 1. Context

운영자 장기 목표: "shadow 의 좋은 학습성과를 live 에 적용." ADR-0630 으로 shadow 매수 게이트가
방금 풀려 forward-outcome 데이터가 이제부터 쌓이기 시작한다(현 시점 `matureD5 ≈ 0`). 그
데이터로 두 라이브 레버를 켤지 결정하려면 두 가지가 필요하다:

1. **흩어진 증거를 한 화면에서 보는 결정 surface.** 현재 승격 근거 데이터는 4곳에 흩어져 있다:
   - forward-outcome 성숙도 — `Gate1ThresholdEvidenceSummary`(D1/D3/D5/D10 sample counts·`reviewReady`·`reviewBlockers`)
   - 밴드별 성과 — `Gate1ThresholdEvidenceSummary.scoreBandTable`(70+/65~70/60~65/55~60/below55 별 winRate·avgReturn·expectancyR·falseNegativeRate)
   - regime-aware verdict — `Gate1ThresholdEvidenceSummary.regimeAwareWindow`(`Gate1RegimeAwareWindowRollup`: `regimeAwareRequiredActive`·`verdict`·`windowSampleCount`)
   - counterfactual outcome — `CounterfactualOutcomeBoard`(`summary.verdict`·`review.status`·`gate1Bands`·`safety`)
   운영자는 이 4개를 따로 조회해 머릿속에서 합산해야 한다 → 휴먼 에러·"감으로 임계 낮추기" 위험.

2. **데이터 성숙 → 검토 → 활성 → 롤백의 단계별 안전 절차 문서.** 승격 기구(flag·게이트)는 이미
   존재하나(아래 §4) "언제·무엇을 근거로 켜는가"의 절차가 SSOT 로 적혀 있지 않다.

**이번 작업은 라이브를 절대 바꾸지 않는다.** `matureD5=0` 이라 어떤 레버도 READY 가 아니다. 본
ADR 은 **(a) 진단 통합 모듈 + (b) 절차 문서**만 만든다. 임계·가중치 활성은 데이터 성숙 후 별도
운영자 게이트(이미 존재하는 `/promote_learning`·ENV flag)에서 일어난다.

### 1.1 두 승격 레버 (본 진단의 판정 대상)

| 레버 | 정의 | 활성 기구(기존) | 본 ADR 의 역할 |
|------|------|------------------|-----------------|
| **Lever A — Regime-aware threshold (ADR-0546)** | 레짐별 Gate1 required-score 완화 창([regimeAwareRequired, 70)) 을 라이브 적용 | `GATE1_REGIME_AWARE_REQUIRED=true` (default OFF, `isGate1RegimeAwareRequiredEnabled`) | **READY/NOT_READY 판정만.** requiredScore=70 은 절대불변 — 승격은 flag 활성이지 70 하드코딩 변경 아님. |
| **Lever B — Condition-weight promotion (ADR-0624/0581)** | shadow 학습 조건가중치·Gate1 임계 provider 를 라이브 반영 | `/promote_learning apply` + `LEARNING_WEIGHT_PROMOTION_ENABLED` + `COUNTERFACTURE_GATE_APPLY_ENABLED` (전부 default OFF) | **READY/NOT_READY 판정만.** |

---

## 2. Decision

### (a) 승격 준비도 진단 — 신규 read-only 모듈

#### 2a.1 모듈 위치·@responsibility

- **신규 파일:** `server/trading/signalScanner/promotionReadinessAdr0631.ts`
- **분류:** 순수 leaf, executionImpact=NONE, 신규 fetch 0, 신규 carry 0.
- **@responsibility(draft, ≤25 단어):**
  > `ADR-0631 Shadow→Live 승격 준비도 진단 — 기존 forward-outcome/밴드/regime/counterfactual 증거를 레버별 READY/NOT_READY 로 통합하는 순수 read-only 판정기(executionImpact=NONE).`
- **import 허용:** `gate1RegimeAwareWindowAdr0546.js`(타입), `gate1DryRunObservationLedgerAdr0476.js`(타입·`Gate1ThresholdEvidenceSummary`), `counterfactualOutcomeBoard.js`(타입·`CounterfactualOutcomeBoard`), `gateConfig.js`(`isGate1RegimeAwareRequiredEnabled`·`LEGACY_GATE1_REQUIRED_SCORE` — read only).
- **import 금지(불변식 경계):** `autoTradeEngine`·`buyPipeline`·`kisClient`·`SourceSnapshot` 생성기·`learningWeightPromotionApply`(쓰기 seam)·`gateLearnedThresholdApply`(쓰기 seam). 본 모듈은 **상태 변경 함수(register*/unregister*)를 호출하지 않는다.**

#### 2a.2 함수 시그니처 (engine-dev pin)

본 모듈은 **이미 계산된 두 report 를 입력으로 받는 순수 함수**다. 신규 데이터 fetch·재계산 0.
호출자(노출 지점)가 기존 경로에서 이미 만든 `Gate1ThresholdEvidenceSummary` 와
`CounterfactualOutcomeBoard` 를 주입한다.

```ts
export type PromotionLeverId = 'REGIME_AWARE_THRESHOLD_ADR0546' | 'CONDITION_WEIGHT_ADR0624';

export type PromotionReadinessVerdict =
  | 'READY'          // 성숙 충족 + 성과 정당화 + flag 아직 OFF → 운영자 검토 가능
  | 'NOT_READY'      // 성숙 미충족 또는 성과 미정당화
  | 'ALREADY_ACTIVE' // 해당 레버 flag 가 이미 ON (재판정 불필요·정보용)
  | 'DATA_UNAVAILABLE'; // report 부재 (immature: matureD5=0 초기 상태 포함)

export interface PromotionLeverReadiness {
  lever: PromotionLeverId;
  verdict: PromotionReadinessVerdict;
  /** 성숙도 게이트 — Gate1ThresholdEvidenceSummary.reviewBlockers SSOT 그대로 재사용 (새 임계 발명 금지). */
  maturityReady: boolean;
  maturityBlockers: string[];   // reviewBlockers 부분집합 (레버별 관련 항목만)
  /** 성과 정당화 — regimeAwareWindow.verdict / counterfactual verdict 재사용. */
  performanceJustified: boolean;
  performanceReason: string;    // e.g. 'WINDOW_OUTPERFORMS_70PLUS' | 'INSUFFICIENT_SAMPLE'
  /** 해당 레버 flag 의 현재 ON/OFF (관측만 — 토글하지 않음). */
  flagActive: boolean;
  /** 운영자가 켤 정확한 기구 (절차 §(b) 와 1:1). */
  activationMechanism: string;  // e.g. 'GATE1_REGIME_AWARE_REQUIRED=true' | '/promote_learning apply (+ENV)'
  /** 사람이 읽는 근거 — 표시 전용. */
  notes: string[];
}

export interface PromotionReadinessBoard {
  generatedAt: string;
  /** matureD5 등 핵심 성숙 헤드라인 — 재계산 없이 evidence 에서 전사. */
  maturityHeadline: {
    matureSamplesD5: number;
    totalReviewReady: boolean;     // evidence.reviewReady
    reviewBlockers: string[];      // evidence.reviewBlockers (SSOT 그대로)
  };
  levers: PromotionLeverReadiness[]; // 정확히 2개 (A, B)
  /** 불변식 backstop 표시 (항상 고정값). */
  liveThresholdAutoChanged: false;
  operatorApprovalRequired: true;
  executionImpact: 'NONE';
}

/**
 * 순수 함수 — 두 기존 report 를 받아 레버별 준비도를 판정한다. 신규 fetch·재계산 0.
 * evidence/board 가 undefined(immature·0 row) 이면 모든 레버 DATA_UNAVAILABLE.
 */
export function buildPromotionReadinessBoard(input: {
  now?: Date;
  evidence?: Gate1ThresholdEvidenceSummary;     // 기존 buildGate1ThresholdEvidenceSummary 산출
  counterfactual?: CounterfactualOutcomeBoard;  // 기존 buildCounterfactualOutcomeBoard 산출
}): PromotionReadinessBoard;

/** scan_blockers / 텔레그램 섹션 렌더 (표시 전용·always-render skeleton). */
export function formatPromotionReadinessSection(board?: PromotionReadinessBoard): string;
```

#### 2a.3 READY/NOT_READY 판정 규칙 (기존 SSOT 재사용 — 새 임계 발명 금지)

> **원칙:** 본 모듈은 **새 임계를 단 하나도 정의하지 않는다.** 성숙도는 `reviewBlockers`,
> 성과 정당화는 `regimeAwareWindow.verdict` / counterfactual `verdict` 를 그대로 읽어 합성만 한다.
> 30/100 등 숫자는 전부 기존 `buildGate1ThresholdEvidenceSummary`·`buildGate1RegimeAwareWindowRollup`
> 안에 이미 있고(예: `SCORE_BAND_D5_SAMPLE_LT_30`·`TOTAL_D5_SAMPLE_LT_100`·verdict 30-표본 게이트),
> 본 모듈은 그 산출물의 boolean/enum 만 소비한다.

**공통 게이트(두 레버 모두):**
- `evidence === undefined` 또는 `evidence.reviewReady === false` → `maturityReady=false`,
  `maturityBlockers = evidence?.reviewBlockers ?? ['DATA_UNAVAILABLE']`.
- `evidence === undefined` → 레버 `verdict='DATA_UNAVAILABLE'` (초기 `matureD5=0` 상태가 여기 해당).

**Lever A (Regime-aware threshold) 판정:**
| 조건 | verdict |
|------|---------|
| `evidence` 부재 | `DATA_UNAVAILABLE` |
| `isGate1RegimeAwareRequiredEnabled() === true` | `ALREADY_ACTIVE` (flagActive=true) |
| `evidence.reviewReady === false` | `NOT_READY` (maturity) |
| `regimeAwareWindow.verdict === 'INSUFFICIENT_SAMPLE'` | `NOT_READY` (performance) |
| `regimeAwareWindow.verdict === 'WINDOW_UNDERPERFORMS_70PLUS'` | `NOT_READY` (performance — 완화 창이 70+ 보다 못함) |
| `reviewReady === true` **AND** verdict ∈ {`WINDOW_COMPARABLE_TO_70PLUS`, `WINDOW_OUTPERFORMS_70PLUS`} | `READY` |
- `performanceJustified = verdict ∈ {COMPARABLE, OUTPERFORMS}`; `performanceReason = regimeAwareWindow.verdict`.
- `activationMechanism = 'GATE1_REGIME_AWARE_REQUIRED=true (운영자 검토 후·byte-equivalent 롤백 ENV 1줄)'`.

**Lever B (Condition-weight promotion) 판정:**
| 조건 | verdict |
|------|---------|
| `evidence` 부재 | `DATA_UNAVAILABLE` |
| `evidence.reviewReady === false` | `NOT_READY` (maturity) |
| `counterfactual` 부재 또는 `counterfactual.review.status === 'INSUFFICIENT_SAMPLE'` | `NOT_READY` (performance) |
| `counterfactual.summary.verdict === 'KEEP_BLOCKS'` | `NOT_READY` (성과가 차단 유지를 지지 — 가중치 승격 부적격) |
| `reviewReady === true` **AND** `counterfactual.review.status === 'READY_FOR_OPERATOR_REVIEW'` **AND** `counterfactual.summary.verdict ∈ {WATCH, REVIEW_WITH_OPERATOR}` | `READY` |
- `flagActive` 는 **표시 정직성**상 두 신호로 구성: `LEARNING_WEIGHT_PROMOTION_ENABLED` ON **또는** `COUNTERFACTURE_GATE_APPLY_ENABLED` ON 이면 부분 활성 표기(notes 에 어느 쪽인지 명기). 본 모듈은 ENV 를 직접 읽되 **토글하지 않는다.**
- `activationMechanism = '/promote_learning apply + (LIVE) LEARNING_WEIGHT_PROMOTION_ENABLED=true / COUNTERFACTURE_GATE_APPLY_ENABLED=true'`.

> **`matureD5=0` 현 시점 결과:** evidence 가 immature → 두 레버 모두 `NOT_READY`/`DATA_UNAVAILABLE`.
> 즉 본 진단을 켜도 **오늘은 아무것도 READY 가 아니며 라이브는 변하지 않는다** — 의도된 상태.

#### 2a.4 노출 지점 (read-only·pin)

**결정: 신규 텔레그램 명령 `/promotion_readiness` 단일 노출 (default 가시·flag 불요).**

- **선택 근거:** ① scan_blockers 는 이미 매우 길고(출력 예산 ADR-0478) 매 스캔 출력되어 결정용 surface 로 부적합. ② 본 진단은 운영자가 *승격 결정 시점에만* 보는 on-demand 정보. ③ `/gate1_threshold_evidence`·`/counterfactual_gate1` 와 동일한 read-only 조회 명령 패턴(HIDDEN/SYS) 을 그대로 따른다.
- **명령 파일:** `server/telegram/commands/system/promotionReadiness.cmd.ts` (또는 `learning/` — engine-dev 가 카테고리 결정; 권장 `category:'SYS'`, `visibility:'HIDDEN'`, `riskLevel:0`).
- **명령 동작(=`/gate1_threshold_evidence` 와 동형 read 패턴):**
  1. `listGate1DryRunObservationRows()` → rows.
  2. `rows.length > 0 ? buildGate1ThresholdEvidenceSummary(rows) : undefined` → evidence.
  3. `buildCounterfactualOutcomeBoard({ gate1Rows: rows })` (기존 함수·신규 fetch 0) → counterfactual. (성숙도 비용 우려 시 `counterfactual` 생략 → Lever B 는 `DATA_UNAVAILABLE` graceful.)
  4. `buildPromotionReadinessBoard({ evidence, counterfactual })` → board.
  5. `reply(formatPromotionReadinessSection(board))`.
- **default-OFF flag 불요 근거:** 노출이 순수 read·신규 fetch 0·라이브 무접촉·on-demand 명령이라 항상 가시여도 안전(불변식 #8 — shadow 진단 ≠ live). flag 가 필요한 것은 *활성*(레버 ON)이지 *진단*이 아니다.
- **대안 노출(채택 안 함):** scan_blockers 신규 섹션 — §6 Alternatives 참조.

---

### (b) 안전 승격 절차 (정책 본문)

데이터 미성숙 상태에서 라이브로 가는 길은 다음 4단계 게이트를 **순서대로** 통과해야 한다. 각
단계는 이전 단계 없이 진행 불가(monotonic).

#### 단계 1 — 데이터 성숙 (자동·관측)
- forward-outcome 이 ADR-0476 ledger 에 쌓이고 D1/D3/D5/D10 이 성숙한다.
- 게이트: `Gate1ThresholdEvidenceSummary.reviewReady === true`
  (= `reviewBlockers` 전부 해소: `SCORE_BAND_D5_SAMPLE_LT_30`·`TOTAL_D5_SAMPLE_LT_100`·
  `SIXTY_TO_SEVENTY_NOT_COMPARABLE`·`BELOW55_DEFENSE_NOT_CONFIRMED`·
  `FALSE_NEGATIVE_RATE_INSUFFICIENT`·`MFE_MAE_TIMING_SPLIT_INSUFFICIENT`).
- **불변식 #7:** forward-outcome 검증 전 미검증 추정으로 live 결정 금지 — 본 단계가 그 backstop.
- **ADR-0471 freeze rule:** 관측 + 승인 선행. 데이터 성숙 전 어떤 임계도 자동 변경 0.

#### 단계 2 — 운영자 검토 (`/promotion_readiness` → 사람 판단)
- 운영자가 `/promotion_readiness` 로 레버별 `READY/NOT_READY` + 사유를 본다.
- READY 가 아닌 레버는 활성 금지. READY 여도 자동 활성 0 — 운영자 명시 결정만.
- **ADR-0146 5카테고리 자가 review(live 안전성)** 를 이 시점 수행:
  (1) LIVE 매매 안전성(ENV 롤백·회귀·quota) (2) wiring 완료 vs 인프라만
  (3) ADR 발급 무결성 (4) 회귀 테스트 적정성 (5) 정책 위반 baseline 무회귀.

#### 단계 3 — flag-gated 활성 (운영자 단일 게이트)
- **Lever A:** `GATE1_REGIME_AWARE_REQUIRED=true` (ENV 1줄). requiredScore=70 은 **하드코딩 그대로** — `resolveGate1RequiredScore` 가 flag ON 시 레짐값을 반환하는 것이지 70 상수를 바꾸는 게 아니다.
- **Lever B:** `/promote_learning apply`(이미 존재하는 ADR-0624 D4 단일 확인 게이트) + LIVE 모드에서는 추가로 `LEARNING_WEIGHT_PROMOTION_ENABLED=true`(가중치) / `COUNTERFACTURE_GATE_APPLY_ENABLED=true`(Gate1 임계 provider).
- **불변식 #8:** shadow 차단 ≠ live 차단. 승격은 **명시적 operator 게이트**를 통해서만. shadow/PAPER 모드는 apply 만으로 즉시 반영(실돈 영향 0), LIVE 는 추가 ENV 필수(byte-identical backstop).

#### 단계 4 — byte-equivalent 롤백 (항상 보장)
- **Lever A:** `GATE1_REGIME_AWARE_REQUIRED=false` (ENV 1줄) → 즉시 byte-identical 복귀.
- **Lever B:** `/promote_learning revert`(provider 해제) 또는 ENV flag OFF → `loadConditionWeights`/Gate1 임계 byte-identical 복귀.
- 모든 활성은 **ENV 1줄/명령 1개로 즉시 가역.** 비가역 변경 0.

#### 본 ADR 과 기존 승격 기구의 관계 (명시)
- 본 ADR 은 **켜는 결정을 돕는 진단 + 절차**다. **새 승격 엔진이 아니다.**
- 활성 기구는 이미 존재: ADR-0624 D4 `/promote_learning`(단일 확인 게이트)·ADR-0546 flag·ADR-0581 weight promotion pipeline.
- 본 모듈은 그 기구들을 **호출하지 않는다**(register/unregister/ENV write 0). 오직 그 기구들의 *현재 상태*(flagActive)와 *켤 자격*(READY/NOT_READY)만 읽어 표시한다.

---

## 3. 데이터 소스 재사용 매핑 (신규 fetch 0 증명)

| 진단 입력 | 기존 SSOT | 반환형 필드 | 본 모듈 소비 |
|-----------|-----------|-------------|--------------|
| forward 성숙도 | `buildGate1ThresholdEvidenceSummary(rows)` (`gate1DryRunObservationLedgerAdr0476.ts:1046`) | `reviewReady`·`reviewBlockers`·`matureSamplesD5` | 그대로 read |
| 밴드별 성과 | 同 위 `.scoreBandTable[]` | `band`·`winRateD5`·`avgReturnD5`·`expectancyR`·`falseNegativeRate` | 표시·참고(판정은 verdict 우선) |
| regime-aware verdict | 同 위 `.regimeAwareWindow` (`Gate1RegimeAwareWindowRollup`, `gate1RegimeAwareWindowAdr0546.ts:74`) | `verdict`·`regimeAwareRequiredActive`·`windowSampleCount` | Lever A 판정 |
| counterfactual outcome | `buildCounterfactualOutcomeBoard({gate1Rows})` (`counterfactualOutcomeBoard.ts`) | `summary.verdict`·`review.status`·`gate1Bands` | Lever B 판정 |
| flag 상태 A | `isGate1RegimeAwareRequiredEnabled()` (`gateConfig.ts:148`) | boolean | `flagActive` (read only) |
| ledger rows | `listGate1DryRunObservationRows()` (`gate1DryRunObservationLedgerAdr0476.ts:808`) | `Gate1DryRunObservationRow[]` | 호출자가 read(파일 load·신규 KIS/KRX fetch 0) |

신규 KIS/KRX/DART/Yahoo 호출 0. 모든 입력은 이미 디스크에 있는 ledger row + 그로부터 파생되는
순수 계산. ADR-0561 KIS-primary 무관(외부 provider 미접촉).

---

## 4. Patch Scope Guard (ADR-530)

- **targetDomain:** Diagnostics(read-only) + Promotion-procedure(docs). (3 도메인 이하.)
- **allowedFiles:**
  - 신규 `server/trading/signalScanner/promotionReadinessAdr0631.ts`
  - 신규 `server/telegram/commands/system/promotionReadiness.cmd.ts` (+ 명령 레지스트리 등록 1줄)
  - 신규 테스트 `promotionReadinessAdr0631.test.ts` (quality-guard 회귀 검토 후 engine-dev 작성)
  - 본 ADR 문서 · `docs/adr/INDEX.md`(0631→0632) · `docs/ai/10-patch-history-index.md`(1줄) · `ARCHITECTURE.md`(신규 모듈 경계 1줄)
- **forbiddenFiles:** `autoTradeEngine`·`buyPipeline`·`kisClient`·`SourceSnapshot` 생성기·`gateConfig.ts`(read만, 수정 0)·`gate1DryRunObservationLedgerAdr0476.ts` 본체·`counterfactualOutcomeBoard.ts` 본체·`learningWeightPromotionApply.ts`·`gateLearnedThresholdApply.ts`·`REGIME_CONFIGS`·`src/**` 전부.
- **expectedBehaviorChange:** 신규 read-only 텔레그램 명령 1개 추가. 기존 출력·판정 0 변경.
- **sourceSnapshotImpact:** NONE (불변식 #3/#9 — provider 직접 조회 0, snapshot 미접촉).
- **executionImpact:** NONE (라이브 본체 0줄).
- **shadowLearningImpact:** NONE (관측만·shadow 루프 무중단 — 불변식 #2).
- **telegramImpact:** 신규 조회 명령 1개(read-only·HIDDEN). dedup/라우팅 무영향.
- **providerImpact:** NONE (신규 fetch 0).
- **testsRequired:** 판정 진리표(READY/NOT_READY/ALREADY_ACTIVE/DATA_UNAVAILABLE 각 분기)·immature(`matureD5=0`)→전 레버 NOT_READY/DATA_UNAVAILABLE·flag ON→ALREADY_ACTIVE·`reviewBlockers` 부분집합 정합·skeleton 렌더 graceful.
- **rollbackPlan:** 신규 파일 2개 + 명령 등록 1줄 revert(라이브 무관·1커밋). flag·ENV 변경 0이라 롤백 위험 0.

---

## 5. 불변식 준수 (9대 + 단일 통로)

- **#1 Trading Engine 무중단:** 본 모듈은 엔진 경로 밖 read-only. 영향 0.
- **#2 Shadow Learning 무중단:** 관측만. shadow 루프 미접촉.
- **#3/#9 SourceSnapshot 단일 통로:** Gate 내부 provider 직접 조회 0. 본 모듈은 ledger row(이미 snapshot 파생)만 읽는다.
- **#7 AI_ESTIMATED(L4) live 금지:** forward-outcome 검증 전 미검증 추정으로 live 결정 금지 — 단계 1 `reviewReady` 게이트가 backstop.
- **#8 shadow 차단 ≠ live 차단:** 승격은 명시적 operator 게이트(단계 3)에서만. 진단은 토글 0.
- **단일 통로:** kisClient/autoTradeEngine/aiUniverseService 미접촉. requiredScore=70 절대불변 — 승격은 flag 활성이지 70 변경 아님.

---

## 6. Alternatives Considered

1. **scan_blockers 신규 섹션 노출** — 매 스캔 출력되어 출력 예산(ADR-0478) 압박 + 결정용 on-demand 정보엔 부적합. **기각**, 단 운영자가 추후 원하면 `formatPromotionReadinessSection` 을 scan_blockers full 에 `pushOptionalSection` 으로 추가하는 건 default-OFF flag 하에서 가능(별도 patch).
2. **새 승격 엔진/자동 활성** — 불변식 #7/#8·ADR-0471 freeze rule 위반(자동 임계 변경). 운영자 게이트를 우회하므로 **기각**. 본 ADR 은 진단+절차로 한정.
3. **새 성숙/성과 임계 정의** — `reviewBlockers`/`verdict` SSOT 와 충돌·이중 진실원 위험. **기각** — 기존 SSOT boolean/enum 만 합성.
4. **`/promotion_readiness` 를 `/promote_learning status` 에 흡수** — `/promote_learning` 은 *활성/해제* 명령(riskLevel 2)이고 본 진단은 read-only(riskLevel 0). 책임 분리(SRP)상 별도 명령. **기각.**

---

## 7. References

- ADR-0476 — Gate1 dry-run observation ledger (forward-outcome SSOT)
- ADR-0546 — shadow-only regime-aware Gate1 entry threshold (Lever A flag)
- ADR-0581 — shadow→live weight promotion pipeline
- ADR-0624 — shadow always-on + `/promote_learning` 단일 게이트 (Lever B)
- ADR-0471 — freeze rule (관측 + 승인 선행)
- ADR-0146 — PR 자가 review 5 카테고리 (live 안전성)
- ADR-0610 — counterfactual outcome board format
- ADR-0630 — shadow 매수 게이트 단일화 (본 forward-outcome 데이터의 출처)
- CLAUDE.md §2.1 불변식 #7·#8 · §2.2 requiredScore=70 절대불변
