// @responsibility ADR-0633 Shadow 검증 충족 시 LIVE-safe ENV 게이트를 엔진이 스스로 ON 하는 순수 evaluator + audit ledger. LIVE-money/절대보존 EXCLUDED. master OFF=byte-identical.

import type { PromotionReadinessBoard } from './signalScanner/promotionReadinessAdr0631.js';
import type { Gate1ThresholdEvidenceSummary } from './signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import type { CounterfactualOutcomeBoard } from '../learning/counterfactualOutcomeBoard.js';

// ── eligibility / verdict 분류 ────────────────────────────────────────────────

/**
 * lever 자가 활성 자격.
 * - LIVE_SAFE: ON 이 shadow/diagnostic/관측·측정만 바꿈(LIVE 실주문·SourceSnapshot·Gate 채점·universe·regime·sizing byte-identical) → 자가 활성 대상.
 * - LIVE_ADJACENT_REVIEW: ON 이 LIVE-인접 동작(R6 트리거 신선도·R6 복구 stuck-exit·Gate1 채점식·intraday universe 신선화)을
 *   바꿈 → 자가 활성 금지. EXCLUDED 와 달리 "절대 금지"가 아니라 **운영자 1-체크포인트 검토 후 수동 활성** 대상으로 인지·등재(ADR-0635).
 * - LIVE_MONEY_EXCLUDED: LIVE 실주문/사이징/learning→LIVE 가중치 영향(불변식 #7) → 자가 활성 영구 금지.
 * - ABSOLUTE_PRESERVATION_EXCLUDED: requiredScore=70/CONDITION_PASS_THRESHOLD=5/STRONG_BUY 영향 → 영구 금지.
 *
 * 자가 활성(process.env set) 대상은 **`LIVE_SAFE` 단 하나**다. 나머지 셋(`LIVE_ADJACENT_REVIEW`·
 * `LIVE_MONEY_EXCLUDED`·`ABSOLUTE_PRESERVATION_EXCLUDED`)은 evaluator 가 항상 `EXCLUDED` verdict 만 내고
 * `process.env` 를 절대 건드리지 않는다(§ADR-0635 — `LIVE_ADJACENT_REVIEW` 도 자동 활성 금지·운영자 결정 영역).
 */
export type AutoActivationEligibility =
  | 'LIVE_SAFE'
  | 'LIVE_ADJACENT_REVIEW'
  | 'LIVE_MONEY_EXCLUDED'
  | 'ABSOLUTE_PRESERVATION_EXCLUDED';

/**
 * lever 평가 결과.
 * - ACTIVATE: LIVE_SAFE + criteria 충족 + 미활성 → process.env set 실행.
 * - HOLD: LIVE_SAFE 이나 criteria 미충족(성숙/성과/anti-flap) → process.env 무접촉.
 * - ALREADY_ACTIVE: 해당 envName 이 이미 'true' → 중복 set 0 (SKIP).
 * - EXCLUDED: LIVE_MONEY/ABSOLUTE_PRESERVATION → 항상 이 verdict, process.env 절대 무접촉.
 * - DATA_UNAVAILABLE: 증거 부재(immature·matureD5=0) → process.env 무접촉.
 * - MASTER_OFF: master flag OFF → 평가 자체 미수행(byte-identical).
 */
export type AutoActivationVerdict =
  | 'ACTIVATE'
  | 'HOLD'
  | 'ALREADY_ACTIVE'
  | 'EXCLUDED'
  | 'DATA_UNAVAILABLE'
  | 'MASTER_OFF';

// ── criteria / lever registry ─────────────────────────────────────────────────

/**
 * 자가 활성 임계 — 새 임계 발명 금지. 전부 ADR-0631 PromotionReadinessBoard /
 * ADR-0476 Gate1ThresholdEvidenceSummary 산출물과 비교만 한다.
 */
export interface LeverCriteria {
  /** Gate1ThresholdEvidenceSummary.matureSamplesD5 하한. */
  minMatureSamplesD5: number;
  /** evidence.reviewReady === true 요구. */
  requireReviewReady: boolean;
  /** PromotionReadiness 판정의 performanceJustified 요구. */
  requirePerformanceJustified: boolean;
  /** 호출자가 추적한 일별 READY 연속일수 하한 (anti-flap hysteresis). */
  minConsecutiveReadyDays: number;
  /**
   * Gate1/promotion forward-outcome 증거(`evidence`/`promotionReadiness`)를 활성 전제로 요구하는가
   * (ADR-0635 — evidence-독립 criteria).
   *
   * - `true` (기본 의미 — 기존 0633 seed 2건): 증거 부재 시 evaluator 가 `DATA_UNAVAILABLE` 로 막는다
   *   (forward-outcome 성숙 대기). matureD5·reviewReady·performanceJustified 를 criteria 와 비교한다.
   *   judgement-of-value(corrected price·trade replacement) lever 는 검증 증거 충족이 활성 전제라 `true`.
   *
   * - `false` (ADR-0635 — T1 측정/관측 인프라): "켜는 것 자체가 검증 데이터를 생성하는 인프라"라
   *   Gate1/promotion evidence 가 없어도(=`DATA_UNAVAILABLE` 여도) 활성 가능해야 한다. evaluator 는
   *   evidence 부재로 막지 않고, **master ON + consecutive READY streak(`minConsecutiveReadyDays`) 충족만으로
   *   ACTIVATE** 한다. evidence-게이트 criteria(`minMatureSamplesD5`/`requireReviewReady`/
   *   `requirePerformanceJustified`)는 0/false 로 두고 streak anti-flap 하나만 게이트로 남긴다.
   *   (관측 cron 은 executionImpact NONE 라 켜도 LIVE byte-identical — 증거를 기다릴 이유가 없고, 오히려
   *   켜야 증거가 쌓인다. 닭-달걀 deadlock 해소.)
   *
   * 평가 분기 본문(`requiresEvidence===false` 시 DATA_UNAVAILABLE 우회)은 engine-dev 가 구현한다(ADR-0635 §2.1).
   */
  requiresEvidence: boolean;
}

/** registry 의 단일 lever 정의. */
export interface AutoActivationLever {
  leverId: string;
  /** 자가 활성 시 set 할 ENV 이름 (LIVE_SAFE 만 실제 set). */
  envName: string;
  eligibility: AutoActivationEligibility;
  criteria: LeverCriteria;
  /** 사람이 읽는 분류 근거 (표시·audit 전용). */
  rationale: string;
}

/** lever 단건 평가 결과 (report 구성 요소). */
export interface AutoActivationLeverDecision {
  leverId: string;
  envName: string;
  eligibility: AutoActivationEligibility;
  verdict: AutoActivationVerdict;
  /** ACTIVATE 가 실제 process.env set 을 수행했는가 (true = 이번 평가에서 set). */
  activated: boolean;
  /** 충족·미충족 사유 (criteria 비교 결과). */
  reasons: string[];
  /** 평가에 쓰인 핵심 증거 스냅샷 (audit·표시 전용). */
  evidenceSnapshot: {
    matureSamplesD5: number | null;
    reviewReady: boolean | null;
    performanceJustified: boolean | null;
    consecutiveReadyDays: number | null;
  };
}

/** 한 회 평가의 전체 결과. */
export interface AutoActivationReport {
  generatedAt: string;
  masterEnabled: boolean;
  decisions: AutoActivationLeverDecision[];
  /** 이번 평가에서 새로 ACTIVATE 된 leverId 목록 (텔레그램 통지 seam 입력). */
  activatedLeverIds: string[];
  /** 불변식 backstop (항상 고정값). */
  liveExecutionUntouched: true;
  requiredScoreUntouched: true;
}

/** audit ledger 1행 — ACTIVATE(process.env set) 시에만 append. */
export interface AutoActivationLedgerEntry {
  leverId: string;
  envName: string;
  activatedAt: string;
  /** 활성 근거가 된 criteria 스냅샷. */
  criteria: LeverCriteria;
  /** 활성 근거가 된 증거 스냅샷. */
  evidenceSnapshot: AutoActivationLeverDecision['evidenceSnapshot'];
}

// ── master flag SSOT (ADR-0157 정확 비교) ─────────────────────────────────────

/**
 * master 자가 활성 스위치. default OFF — byte-identical(엔진 미가동).
 * 정확 비교 `=== 'true'`(ADR-0157 — `'1'`/`'TRUE'`/`'yes'` 거부). 호출자 inline ENV 검사 금지.
 */
export function isSelfValidationAutoActivationEnabled(): boolean {
  return process.env.SELF_VALIDATION_AUTO_ACTIVATION_ENABLED === 'true';
}

// ── lever registry (ADR-0633 §2.4) ───────────────────────────────────────────

/**
 * LIVE_SAFE 자가 활성 대상 + EXCLUDED 명시 등재(자가 활성 영구 금지 기록).
 * 분류 변경/추가 시 ADR-0633 §2.4 근거 표를 동기 갱신한다.
 */
export const LEVER_REGISTRY: readonly AutoActivationLever[] = [
  // ── LIVE_SAFE (자가 활성 대상) ──────────────────────────────────────────────
  {
    leverId: 'PRICE_CORRECTION_SHADOW_ADR0623',
    envName: 'PRICE_CORRECTION_SHADOW_ENABLED',
    eligibility: 'LIVE_SAFE',
    criteria: {
      minMatureSamplesD5: 100,
      requireReviewReady: true,
      requirePerformanceJustified: true,
      minConsecutiveReadyDays: 3,
      // judgement-of-value(corrected 값 shadow 채택) — forward-outcome 증거 충족이 활성 전제. 현행 동작 보존(ADR-0635).
      requiresEvidence: true,
    },
    rationale:
      'ADR-0623 Stage 2 — corrected 값을 shadow 판단에만 채택. LIVE byte-equivalent. default OFF.',
  },
  {
    leverId: 'TRADE_REPLACEMENT_SHADOW_EXECUTE_ADR0602',
    envName: 'TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED',
    eligibility: 'LIVE_SAFE',
    criteria: {
      minMatureSamplesD5: 100,
      requireReviewReady: true,
      requirePerformanceJustified: true,
      minConsecutiveReadyDays: 3,
      // judgement-of-value(shadow 장부 내 교체 집행) — forward-outcome 증거 충족이 활성 전제. 현행 동작 보존(ADR-0635).
      requiresEvidence: true,
    },
    rationale:
      'ADR-0602 Phase 1 — 교체 집행이 shadow 장부 내에서만. mode=LIVE trade 무접촉(불변식 #8). default OFF.',
  },

  // ── LIVE_SAFE · evidence-독립 T1 측정/관측 인프라 (ADR-0635 — requiresEvidence:false) ──────
  // executionImpact=NONE 검증: learningJobs.ts cron 본문이 LIVE 주문/SourceSnapshot/Gate 채점/universe/
  // regime/sizing 무접촉 — 순수 학습 ledger 갱신 또는 read-only 분석 로그(architect-registry-expansion.md 근거).
  // requiresEvidence:false → evidence 부재(DATA_UNAVAILABLE) 여도 master ON + consecutive READY streak 만으로
  // ACTIVATE(켜야 증거가 쌓이는 인프라라 닭-달걀 deadlock 회피). evidence-게이트 criteria 는 0/false.
  // minConsecutiveReadyDays:2 — 부팅 flap 방지(보수적 하한). evaluator 분기 본문은 engine-dev(ADR-0635 §2.1).
  {
    leverId: 'FUTURE_RETURN_RESOLVER_ADR0175',
    envName: 'FUTURE_RETURN_RESOLVER_ENABLED',
    eligibility: 'LIVE_SAFE',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 2,
      requiresEvidence: false,
    },
    rationale:
      'ADR-0175 Phase 2b-1 — ShadowLearningOnlySignal 의 1/3/5/20d future-return 갱신(saveShadowLearningOnlySignals). KIS 종가 read-only·학습 ledger 만 write. executionImpact=NONE(learningJobs.ts:220). 켜야 forward-outcome 증거가 쌓이는 측정 인프라라 requiresEvidence:false. default OFF.',
  },
  {
    leverId: 'SHAKEOUT_STOP_FORWARD_LABELER_ADR0625',
    envName: 'SHAKEOUT_STOP_FORWARD_LABELER_ENABLED',
    eligibility: 'LIVE_SAFE',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 2,
      requiresEvidence: false,
    },
    rationale:
      'ADR-0625 — HIT_STOP 청산 포지션 손절-후 N일 종가 KIS 일봉(L1 read-only) 라벨링(관측 전용·upsertLabel 물리분리 ledger). shadow-trades.json 본체 무수정·주문 import 0. executionImpact=NONE(learningJobs.ts:239). 켜야 라벨 증거가 쌓이는 관측 인프라라 requiresEvidence:false. default OFF.',
  },
  {
    leverId: 'SAFETY_GATE_ATTRIBUTION_ADR0174',
    envName: 'SAFETY_GATE_ATTRIBUTION_ENABLED',
    eligibility: 'LIVE_SAFE',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 2,
      requiresEvidence: false,
    },
    rationale:
      'ADR-0174 §2.1 — 7 게이트 사후효과(avoidedLoss/missedGain/netGateImpact) 일일 진단 로그. 순수 compute(영속 write 0)·console 로그만. executionImpact=NONE(learningJobs.ts:260). 켜야 귀인 관측이 쌓이는 진단 인프라라 requiresEvidence:false. default OFF.',
  },
  {
    leverId: 'SHADOW_LIVE_DELTA_REPORT_ADR0174',
    envName: 'SHADOW_LIVE_DELTA_REPORT_ENABLED',
    eligibility: 'LIVE_SAFE',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 2,
      requiresEvidence: false,
    },
    rationale:
      'ADR-0174 §2.2 — 5 카테고리 missedAlpha 일일 진단 로그. 순수 compute(영속 write 0)·console 로그만. executionImpact=NONE(learningJobs.ts:281). 켜야 delta 관측이 쌓이는 진단 인프라라 requiresEvidence:false. default OFF.',
  },

  // ── LIVE_ADJACENT_REVIEW (자가 활성 금지 — 운영자 1-체크포인트 검토 영역 · ADR-0635 §2.3 T2) ──
  // EXCLUDED 와 같이 evaluator 가 항상 EXCLUDED verdict·process.env 무접촉. "절대 금지"가 아니라
  // LIVE-인접 동작 변경이라 자동 활성하지 않고 운영자가 인지·수동 검토하도록 등재(인지하되 자동화 금지).
  // criteria 값은 무의미(evaluator 가 eligibility 로 먼저 EXCLUDED 분기 → 미평가). requiresEvidence:true 채움(무의미).
  {
    leverId: 'R6_TRIGGER_TRADEDATE_FRESHNESS_ADR0592',
    envName: 'R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED',
    eligibility: 'LIVE_ADJACENT_REVIEW',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 0,
      requiresEvidence: true,
    },
    rationale:
      'ADR-0592 — R6 트리거 tradeDate 신선도 게이트. regime/R6 상태 LIVE 경로에 인접 — 자동 활성 금지·운영자 1-체크포인트(ADR-0635 §2.3).',
  },
  {
    leverId: 'R6_RECOVERY_STUCK_EXIT_ADR0630',
    envName: 'R6_RECOVERY_STUCK_EXIT_ENABLED',
    eligibility: 'LIVE_ADJACENT_REVIEW',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 0,
      requiresEvidence: true,
    },
    rationale:
      'ADR-0630 D2 — R6 복구 stuck-exit(Kelly/display regime 정상화). LIVE regime override·exit 위상에 인접 — 자동 활성 금지·운영자 1-체크포인트(ADR-0635 §2.3).',
  },
  {
    leverId: 'GATE1_RS_PERCENTILE_CONTINUOUS_ADR0627',
    envName: 'GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED',
    eligibility: 'LIVE_ADJACENT_REVIEW',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 0,
      requiresEvidence: true,
    },
    rationale:
      'ADR-0627 — Gate1 RS 백분위 연속 채점식. Gate1 채점 경로 변경 성격 — 자동 활성 금지·운영자 1-체크포인트(ADR-0635 §2.3).',
  },
  {
    leverId: 'INTRADAY_SCREENER_REFRESH_ADR0628',
    envName: 'INTRADAY_SCREENER_REFRESH_ENABLED',
    eligibility: 'LIVE_ADJACENT_REVIEW',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 0,
      requiresEvidence: true,
    },
    rationale:
      'ADR-0628 — 장중 리더 universe 신선화(평가 풀 갱신). universe 구성 LIVE 인접 — 자동 활성 금지·운영자 1-체크포인트(ADR-0635 §2.3).',
  },

  // ── EXCLUDED (자가 활성 영구 금지 — 명시 등재) ──────────────────────────────
  {
    leverId: 'GATE1_REGIME_AWARE_REQUIRED_ADR0546',
    envName: 'GATE1_REGIME_AWARE_REQUIRED',
    eligibility: 'ABSOLUTE_PRESERVATION_EXCLUDED',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 0,
      requiresEvidence: true,
    },
    rationale:
      'LIVE Gate1 required-score flip(ADR-0546). requiredScore=70 절대 보존 영역. 운영자 명시 결정만.',
  },
  {
    leverId: 'GATE1_POSITIVE_CEILING_WIRING_ADR0613',
    envName: 'GATE1_POSITIVE_CEILING_WIRING_ENABLED',
    eligibility: 'ABSOLUTE_PRESERVATION_EXCLUDED',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 0,
      requiresEvidence: true,
    },
    rationale:
      'Gate1 positive-ceiling(ADR-0613) — 채점/통과 판정 영향 가능. 운영자 명시 결정만.',
  },
  {
    leverId: 'LEARNING_WEIGHT_PROMOTION_ADR0581',
    envName: 'LEARNING_WEIGHT_PROMOTION_ENABLED',
    eligibility: 'LIVE_MONEY_EXCLUDED',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 0,
      requiresEvidence: true,
    },
    rationale: 'learning→LIVE 가중치 승격(ADR-0581). 불변식 #7. 운영자 명시 결정만.',
  },
  {
    leverId: 'COUNTERFACTURE_GATE_APPLY_ADR0624',
    envName: 'COUNTERFACTURE_GATE_APPLY_ENABLED',
    eligibility: 'LIVE_MONEY_EXCLUDED',
    criteria: {
      minMatureSamplesD5: 0,
      requireReviewReady: false,
      requirePerformanceJustified: false,
      minConsecutiveReadyDays: 0,
      requiresEvidence: true,
    },
    rationale: '학습 Gate1 임계 provider 의 LIVE 반영(ADR-0624). 불변식 #7. 운영자 명시 결정만.',
  },
] as const;

// ── in-memory audit ledger (모듈 스코프 — ACTIVATE 시에만 append) ──────────────

let ledger: AutoActivationLedgerEntry[] = [];

// ── evaluator / ledger (engine-dev 구현 인계 — 시그니처 pin) ───────────────────

/**
 * evaluator 입력 — 신규 fetch/재계산 0. 호출자가 기존 경로에서 만든 증거를 주입한다.
 * `now`·증거·consecutive-READY 추적 상태를 전부 입력으로 받는다(순수성 보장).
 */
export interface AutoActivationEvaluateInput {
  now: Date;
  /** ADR-0631 buildPromotionReadinessBoard 산출 (performanceJustified 판정 재사용). */
  promotionReadiness?: PromotionReadinessBoard;
  /** ADR-0476 buildGate1ThresholdEvidenceSummary 산출 (matureSamplesD5·reviewReady). */
  evidence?: Gate1ThresholdEvidenceSummary;
  /** ADR-0610 counterfactual board (선택 — Lever B 계열 정당화 참고). */
  counterfactual?: CounterfactualOutcomeBoard;
  /** leverId → 호출자가 추적한 일별 READY 연속일수 (anti-flap). 미제공 시 0 취급. */
  consecutiveReadyDaysByLever?: Record<string, number>;
  /** 평가 대상 registry (기본 LEVER_REGISTRY — 테스트 주입용). */
  registry?: readonly AutoActivationLever[];
}

/**
 * lever 준비도 순수 predicate (ADR-0634 helper 추출) — consecutive-READY streak 제외 기준만 판정한다.
 *
 * evaluator 와 일별 streak repo 가 **동일 criteria** 를 공유하도록 단일 판정 공식으로 추출한
 * 것이다(두 번째 판정 공식 발명 금지). streak(`minConsecutiveReadyDays`)은 본 helper 가
 * 채우는 streak 자체가 입력이라 순환을 끊기 위해 제외한다 — consecutive 게이트는 evaluator 가
 * 보유한다(`readyExclStreak && consecutiveOk → ACTIVATE`).
 *
 * - `now` 의존 0 (input 만 읽음 — 순수).
 * - EXCLUDED lever 에 호출돼도 무해(criteria 0 값 → 의미 없음). evaluator 가 eligibility 로
 *   먼저 EXCLUDED 분기하므로 helper 결과는 EXCLUDED lever 에 미사용.
 */
export function evaluateLeverReadiness(
  lever: AutoActivationLever,
  input: AutoActivationEvaluateInput,
): { matureOk: boolean; reviewOk: boolean; perfOk: boolean; readyExclStreak: boolean } {
  const evidence = input.evidence;
  const matureSamplesD5 =
    evidence && typeof evidence.matureSamplesD5 === 'number'
      ? evidence.matureSamplesD5
      : null;
  const reviewReady = evidence ? evidence.reviewReady === true : null;
  // performanceJustified 출처 — ADR-0631 board 전체 신호 (board 존재 + 어떤 lever 든 true).
  // 새 성과 공식 발명 0 — 기존 board.levers[*].performanceJustified 값만 읽는다.
  const boardPerformanceJustified =
    !!input.promotionReadiness &&
    input.promotionReadiness.levers.some((l) => l.performanceJustified === true);
  const performanceJustified = input.promotionReadiness ? boardPerformanceJustified : null;

  const c = lever.criteria;
  // requiresEvidence:false (ADR-0635 T1 측정/관측 인프라) → evidence 부재(matureSamplesD5 null)여도
  // criteria 가 0/false 로 설정돼 있어 충족으로 처리한다. matureSamplesD5 가 null 일 때는
  // minMatureSamplesD5<=0(=evidence-게이트 해제) 이면 matureOk=true. evidence 가 실제로 있으면 비교는 그대로.
  // requiresEvidence:true (기존 seed/T3) → evidence 부재 시 matureSamplesD5 null → matureOk=false (현행 보존).
  const matureOk =
    matureSamplesD5 !== null
      ? matureSamplesD5 >= c.minMatureSamplesD5
      : c.requiresEvidence === false && c.minMatureSamplesD5 <= 0;
  const reviewOk = c.requireReviewReady ? reviewReady === true : true;
  const perfOk = c.requirePerformanceJustified ? performanceJustified === true : true;
  const readyExclStreak = matureOk && reviewOk && perfOk;

  return { matureOk, reviewOk, perfOk, readyExclStreak };
}

/**
 * 순수 evaluator — registry 각 lever 를 평가해 AutoActivationReport 를 반환한다.
 * master OFF → 전 lever MASTER_OFF·process.env 무접촉·byte-identical.
 * LIVE_SAFE + criteria 충족 + 미활성 → ACTIVATE(process.env[envName]='true' set).
 * EXCLUDED → 항상 EXCLUDED·process.env 절대 무접촉.
 * ACTIVATE 시 in-memory ledger 에 append.
 */
export function evaluateAutoActivation(
  input: AutoActivationEvaluateInput,
): AutoActivationReport {
  const generatedAt = input.now.toISOString();
  const masterEnabled = isSelfValidationAutoActivationEnabled();
  const registry = input.registry ?? LEVER_REGISTRY;
  const decisions: AutoActivationLeverDecision[] = [];
  const activatedLeverIds: string[] = [];

  // master OFF → 전 lever MASTER_OFF·process.env 절대 무접촉·byte-identical.
  if (!masterEnabled) {
    for (const lever of registry) {
      decisions.push({
        leverId: lever.leverId,
        envName: lever.envName,
        eligibility: lever.eligibility,
        verdict: 'MASTER_OFF',
        activated: false,
        reasons: ['MASTER_OFF: SELF_VALIDATION_AUTO_ACTIVATION_ENABLED!=true — 평가 미수행'],
        evidenceSnapshot: {
          matureSamplesD5: null,
          reviewReady: null,
          performanceJustified: null,
          consecutiveReadyDays: null,
        },
      });
    }
    return {
      generatedAt,
      masterEnabled: false,
      decisions,
      activatedLeverIds: [],
      liveExecutionUntouched: true,
      requiredScoreUntouched: true,
    };
  }

  // performanceJustified 출처 — ADR-0631 board 전체 신호 (해석 결정: engine-dev-notes 참조).
  // ADR-0631 PromotionReadinessBoard.levers 는 REGIME_AWARE_THRESHOLD/CONDITION_WEIGHT 2개뿐이라
  // LIVE_SAFE lever(PRICE_CORRECTION/TRADE_REPLACEMENT)와 1:1 매핑이 없다. 따라서
  // performanceJustified 는 board 전체 신호로 해석한다: board 가 존재하고 그 어떤 lever 의
  // performanceJustified===true 이면 "성과 정당화 증거 존재"로 간주(최소 하나 충족).
  // 새 성과 공식을 발명하지 않고 기존 board.levers[*].performanceJustified 값만 읽는다.
  const boardPerformanceJustified =
    !!input.promotionReadiness &&
    input.promotionReadiness.levers.some((l) => l.performanceJustified === true);

  for (const lever of registry) {
    const reasons: string[] = [];

    // EXCLUDED — LIVE_MONEY / ABSOLUTE_PRESERVATION → 항상 EXCLUDED·process.env 절대 무접촉.
    if (lever.eligibility !== 'LIVE_SAFE') {
      decisions.push({
        leverId: lever.leverId,
        envName: lever.envName,
        eligibility: lever.eligibility,
        verdict: 'EXCLUDED',
        activated: false,
        reasons: [
          `EXCLUDED: eligibility=${lever.eligibility} — 자가 활성 영구 금지 (불변식 #7/#8). 운영자 명시 결정만.`,
        ],
        evidenceSnapshot: {
          matureSamplesD5: null,
          reviewReady: null,
          performanceJustified: null,
          consecutiveReadyDays: null,
        },
      });
      continue;
    }

    // ── LIVE_SAFE 경로 ──
    const evidence = input.evidence;
    const matureSamplesD5 =
      evidence && typeof evidence.matureSamplesD5 === 'number'
        ? evidence.matureSamplesD5
        : null;
    const reviewReady = evidence ? evidence.reviewReady === true : null;
    const performanceJustified = input.promotionReadiness
      ? boardPerformanceJustified
      : null;
    const consecutiveReadyDays =
      input.consecutiveReadyDaysByLever?.[lever.leverId] ?? 0;

    const evidenceSnapshot: AutoActivationLeverDecision['evidenceSnapshot'] = {
      matureSamplesD5,
      reviewReady,
      performanceJustified,
      consecutiveReadyDays,
    };

    // 이미 활성 → ALREADY_ACTIVE (중복 set 0).
    if (process.env[lever.envName] === 'true') {
      decisions.push({
        leverId: lever.leverId,
        envName: lever.envName,
        eligibility: lever.eligibility,
        verdict: 'ALREADY_ACTIVE',
        activated: false,
        reasons: [`ALREADY_ACTIVE: ${lever.envName}=true 이미 활성 — 중복 set 미수행.`],
        evidenceSnapshot,
      });
      continue;
    }

    // 증거 부재 → DATA_UNAVAILABLE (process.env 무접촉) — requiresEvidence:true 만.
    // requiresEvidence:false (ADR-0635 T1 측정/관측 인프라) → DATA_UNAVAILABLE 우회. 켜야 증거가
    // 쌓이는 인프라라 evidence 부재로 막지 않고 readyExclStreak + consecutiveOk 만으로 ACTIVATE/HOLD 판정.
    if (lever.criteria.requiresEvidence === true && (!evidence || matureSamplesD5 === null)) {
      decisions.push({
        leverId: lever.leverId,
        envName: lever.envName,
        eligibility: lever.eligibility,
        verdict: 'DATA_UNAVAILABLE',
        activated: false,
        reasons: ['DATA_UNAVAILABLE: evidence 부재 또는 matureSamplesD5 null — forward-outcome 성숙 대기.'],
        evidenceSnapshot,
      });
      continue;
    }

    // criteria 평가 — streak 제외 기준은 helper 단일 공식 재사용(두 번째 판정 공식 0).
    const c = lever.criteria;
    const { matureOk, reviewOk, perfOk, readyExclStreak } = evaluateLeverReadiness(lever, input);
    const consecutiveOk = consecutiveReadyDays >= c.minConsecutiveReadyDays;

    if (!matureOk) {
      reasons.push(
        `HOLD: matureSamplesD5(${matureSamplesD5}) < minMatureSamplesD5(${c.minMatureSamplesD5}).`,
      );
    }
    if (!reviewOk) {
      reasons.push(`HOLD: reviewReady=${String(reviewReady)} (requireReviewReady=true).`);
    }
    if (!perfOk) {
      reasons.push(
        `HOLD: performanceJustified=${String(performanceJustified)} (requirePerformanceJustified=true; ADR-0631 board 신호 부재/부정).`,
      );
    }
    if (!consecutiveOk) {
      reasons.push(
        `HOLD: consecutiveReadyDays(${consecutiveReadyDays}) < minConsecutiveReadyDays(${c.minConsecutiveReadyDays}).`,
      );
    }

    if (readyExclStreak && consecutiveOk) {
      // ACTIVATE — LIVE_SAFE 만 실제 process.env set. ledger append.
      process.env[lever.envName] = 'true';
      activatedLeverIds.push(lever.leverId);
      ledger.push({
        leverId: lever.leverId,
        envName: lever.envName,
        activatedAt: generatedAt,
        criteria: c,
        evidenceSnapshot,
      });
      decisions.push({
        leverId: lever.leverId,
        envName: lever.envName,
        eligibility: lever.eligibility,
        verdict: 'ACTIVATE',
        activated: true,
        reasons: [
          `ACTIVATE: criteria 전부 충족 (matureD5=${matureSamplesD5}>=${c.minMatureSamplesD5}, reviewReady=${String(reviewReady)}, performanceJustified=${String(performanceJustified)}, consecutiveReadyDays=${consecutiveReadyDays}>=${c.minConsecutiveReadyDays}). ${lever.envName}=true set.`,
        ],
        evidenceSnapshot,
      });
      continue;
    }

    // HOLD — criteria 미충족 (process.env 무접촉).
    decisions.push({
      leverId: lever.leverId,
      envName: lever.envName,
      eligibility: lever.eligibility,
      verdict: 'HOLD',
      activated: false,
      reasons,
      evidenceSnapshot,
    });
  }

  return {
    generatedAt,
    masterEnabled: true,
    decisions,
    activatedLeverIds,
    liveExecutionUntouched: true,
    requiredScoreUntouched: true,
  };
}

/**
 * in-memory audit ledger 스냅샷 (ACTIVATE 기록). 텔레그램 통지 seam·진단 표시용.
 */
export function listAutoActivationLedger(): readonly AutoActivationLedgerEntry[] {
  return ledger.slice();
}

/**
 * in-memory ledger 초기화 (테스트·재시작 정리용).
 */
export function resetAutoActivationLedger(): void {
  ledger = [];
}

/**
 * 텔레그램/진단 섹션 렌더 (표시 전용·always-render skeleton).
 */
export function formatAutoActivationReport(report?: AutoActivationReport): string {
  const lines: string[] = [
    'Shadow Self-Validation Auto-Activation (ADR-0633)',
    '-------------------------------------------------',
    `generatedAt: ${report ? report.generatedAt : 'N/A'}`,
    `masterEnabled: ${report ? report.masterEnabled : false}`,
    `activatedLeverIds: ${
      report
        ? report.activatedLeverIds.length > 0
          ? report.activatedLeverIds.join(',')
          : 'NONE'
        : 'N/A'
    }`,
    '',
  ];

  const decisions = report ? report.decisions : [];
  for (const decision of decisions) {
    lines.push(`Lever: ${decision.leverId}`);
    lines.push(`- envName: ${decision.envName}`);
    lines.push(`- eligibility: ${decision.eligibility}`);
    lines.push(`- verdict: ${decision.verdict}`);
    lines.push(`- activated: ${decision.activated}`);
    lines.push(`- matureSamplesD5: ${decision.evidenceSnapshot.matureSamplesD5 ?? 'N/A'}`);
    lines.push(`- reviewReady: ${decision.evidenceSnapshot.reviewReady ?? 'N/A'}`);
    lines.push(
      `- performanceJustified: ${decision.evidenceSnapshot.performanceJustified ?? 'N/A'}`,
    );
    lines.push(
      `- consecutiveReadyDays: ${decision.evidenceSnapshot.consecutiveReadyDays ?? 'N/A'}`,
    );
    lines.push(`- reasons: ${decision.reasons.length > 0 ? decision.reasons.join(' | ') : 'NONE'}`);
    lines.push('');
  }
  if (decisions.length === 0) {
    lines.push('decisions: DATA_UNAVAILABLE (report 부재 또는 registry 비어 있음)');
    lines.push('');
  }

  lines.push(`liveExecutionUntouched: ${report ? report.liveExecutionUntouched : true}`);
  lines.push(`requiredScoreUntouched: ${report ? report.requiredScoreUntouched : true}`);
  return lines.join('\n');
}
