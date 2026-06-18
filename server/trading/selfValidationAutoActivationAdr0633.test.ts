// @responsibility ADR-0633/0635 evaluator/ledger 회귀 — master OFF byte-identical, EXCLUDED·LIVE_ADJACENT_REVIEW 무접촉, LIVE_SAFE ACTIVATE/HOLD/DATA_UNAVAILABLE, requiresEvidence:false 활성. process.env 격리.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  evaluateAutoActivation,
  evaluateLeverReadiness,
  listAutoActivationLedger,
  resetAutoActivationLedger,
  formatAutoActivationReport,
  LEVER_REGISTRY,
  type AutoActivationLever,
  type AutoActivationEvaluateInput,
} from './selfValidationAutoActivationAdr0633.js';
import type { PromotionReadinessBoard } from './signalScanner/promotionReadinessAdr0631.js';
import type { Gate1ThresholdEvidenceSummary } from './signalScanner/gate1DryRunObservationLedgerAdr0476/types.js';

// ── 테스트가 직접 토글하는 ENV 키 (실제 LIVE env 절대 무접촉) ───────────────────
const MASTER_FLAG = 'SELF_VALIDATION_AUTO_ACTIVATION_ENABLED';
const LIVE_SAFE_ENV_KEYS = [
  'PRICE_CORRECTION_SHADOW_ENABLED',
  'TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED',
];
// ADR-0635 — requiresEvidence:false T1 측정/관측 인프라 (evidence-독립 자가 활성).
const LIVE_SAFE_T1_ENV_KEYS = [
  'FUTURE_RETURN_RESOLVER_ENABLED',
  'SHAKEOUT_STOP_FORWARD_LABELER_ENABLED',
  'SAFETY_GATE_ATTRIBUTION_ENABLED',
  'SHADOW_LIVE_DELTA_REPORT_ENABLED',
];
// ADR-0635 — LIVE_ADJACENT_REVIEW T2 (운영자 1-체크포인트 · 자동 활성 금지).
const LIVE_ADJACENT_ENV_KEYS = [
  'R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED',
  'R6_RECOVERY_STUCK_EXIT_ENABLED',
  'GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED',
  'INTRADAY_SCREENER_REFRESH_ENABLED',
];
const EXCLUDED_ENV_KEYS = [
  'GATE1_REGIME_AWARE_REQUIRED',
  'GATE1_POSITIVE_CEILING_WIRING_ENABLED',
  'LEARNING_WEIGHT_PROMOTION_ENABLED',
  'COUNTERFACTURE_GATE_APPLY_ENABLED',
];
const ALL_MANAGED_KEYS = [
  MASTER_FLAG,
  ...LIVE_SAFE_ENV_KEYS,
  ...LIVE_SAFE_T1_ENV_KEYS,
  ...LIVE_ADJACENT_ENV_KEYS,
  ...EXCLUDED_ENV_KEYS,
];

const NOW = new Date('2026-06-18T00:00:00.000Z');

// ── minimal fixtures (기존 board 값만 읽음 — 새 공식 발명 0) ────────────────────
function makeEvidence(over: Partial<Gate1ThresholdEvidenceSummary>): Gate1ThresholdEvidenceSummary {
  return {
    matureSamplesD5: 150,
    reviewReady: true,
    reviewBlockers: [],
    ...over,
  } as Gate1ThresholdEvidenceSummary;
}

/** performanceJustified 신호 — board.levers 중 최소 하나 true 이면 "성과 정당화 존재"로 해석. */
function makePromotionBoard(performanceJustified: boolean): PromotionReadinessBoard {
  return {
    generatedAt: NOW.toISOString(),
    maturityHeadline: { matureSamplesD5: 150, totalReviewReady: true, reviewBlockers: [] },
    levers: [
      {
        lever: 'REGIME_AWARE_THRESHOLD_ADR0546',
        verdict: performanceJustified ? 'READY' : 'NOT_READY',
        maturityReady: true,
        maturityBlockers: [],
        performanceJustified,
        performanceReason: performanceJustified ? 'WINDOW_OUTPERFORMS_70PLUS' : 'INSUFFICIENT_SAMPLE',
        flagActive: false,
        activationMechanism: 'GATE1_REGIME_AWARE_REQUIRED=true',
        notes: [],
      },
      {
        lever: 'CONDITION_WEIGHT_ADR0624',
        verdict: 'NOT_READY',
        maturityReady: true,
        maturityBlockers: [],
        performanceJustified: false,
        performanceReason: 'INSUFFICIENT_SAMPLE',
        flagActive: false,
        activationMechanism: '/promote_learning apply',
        notes: [],
      },
    ],
    liveThresholdAutoChanged: false,
    operatorApprovalRequired: true,
    executionImpact: 'NONE',
  };
}

/** criteria 전부 충족하는 입력 (PRICE_CORRECTION/TRADE_REPLACEMENT 둘 다 ACTIVATE 가능). */
function fullySatisfiedInput(
  registry?: readonly AutoActivationLever[],
): AutoActivationEvaluateInput {
  return {
    now: NOW,
    promotionReadiness: makePromotionBoard(true),
    evidence: makeEvidence({ matureSamplesD5: 150, reviewReady: true }),
    consecutiveReadyDaysByLever: {
      PRICE_CORRECTION_SHADOW_ADR0623: 5,
      TRADE_REPLACEMENT_SHADOW_EXECUTE_ADR0602: 5,
      GATE1_REGIME_AWARE_REQUIRED_ADR0546: 99,
      GATE1_POSITIVE_CEILING_WIRING_ADR0613: 99,
      LEARNING_WEIGHT_PROMOTION_ADR0581: 99,
      COUNTERFACTURE_GATE_APPLY_ADR0624: 99,
    },
    registry,
  };
}

const PRICE_LEVER = LEVER_REGISTRY.find(
  (l) => l.leverId === 'PRICE_CORRECTION_SHADOW_ADR0623',
)!;
// ADR-0635 — requiresEvidence:false T1 lever (evidence-독립).
const T1_LEVER = LEVER_REGISTRY.find(
  (l) => l.leverId === 'FUTURE_RETURN_RESOLVER_ADR0175',
)!;
// ADR-0635 — LIVE_ADJACENT_REVIEW T2 lever (자동 활성 금지).
const T2_LEVER = LEVER_REGISTRY.find(
  (l) => l.leverId === 'R6_TRIGGER_TRADEDATE_FRESHNESS_ADR0592',
)!;

beforeEach(() => {
  // ENV 정리 — 평가 전 항상 미설정 상태로.
  for (const key of ALL_MANAGED_KEYS) delete process.env[key];
  resetAutoActivationLedger();
});

afterEach(() => {
  for (const key of ALL_MANAGED_KEYS) delete process.env[key];
  resetAutoActivationLedger();
});

describe('evaluateAutoActivation — master OFF (byte-identical)', () => {
  it('master OFF → 전 lever MASTER_OFF, process.env 무변경, activatedLeverIds=[]', () => {
    // master flag 미설정 (=== OFF). LIVE_SAFE env 들의 평가 전 스냅샷.
    const before = LIVE_SAFE_ENV_KEYS.map((k) => process.env[k]);

    const report = evaluateAutoActivation(fullySatisfiedInput());

    expect(report.masterEnabled).toBe(false);
    expect(report.activatedLeverIds).toEqual([]);
    expect(report.decisions.every((d) => d.verdict === 'MASTER_OFF')).toBe(true);
    expect(report.decisions.every((d) => d.activated === false)).toBe(true);
    expect(report.liveExecutionUntouched).toBe(true);
    expect(report.requiredScoreUntouched).toBe(true);

    // byte-identical — env 무접촉.
    const after = LIVE_SAFE_ENV_KEYS.map((k) => process.env[k]);
    expect(after).toEqual(before);
    for (const k of LIVE_SAFE_ENV_KEYS) expect(process.env[k]).toBeUndefined();
    expect(listAutoActivationLedger()).toHaveLength(0);
  });
});

describe('evaluateAutoActivation — LIVE_SAFE ACTIVATE', () => {
  beforeEach(() => {
    process.env[MASTER_FLAG] = 'true';
  });

  it('criteria 전부 충족 + 미활성 → ACTIVATE, env=true, ledger append, activatedLeverIds 포함', () => {
    const report = evaluateAutoActivation(fullySatisfiedInput());

    const priceDecision = report.decisions.find(
      (d) => d.leverId === 'PRICE_CORRECTION_SHADOW_ADR0623',
    )!;
    expect(priceDecision.verdict).toBe('ACTIVATE');
    expect(priceDecision.activated).toBe(true);
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBe('true');
    expect(report.activatedLeverIds).toContain('PRICE_CORRECTION_SHADOW_ADR0623');
    expect(report.activatedLeverIds).toContain('TRADE_REPLACEMENT_SHADOW_EXECUTE_ADR0602');

    const led = listAutoActivationLedger();
    expect(led.length).toBe(2);
    expect(led.map((e) => e.leverId)).toContain('PRICE_CORRECTION_SHADOW_ADR0623');
    expect(led[0].activatedAt).toBe(NOW.toISOString());
  });
});

describe('evaluateAutoActivation — LIVE_SAFE HOLD (criteria 미충족, env 무접촉)', () => {
  beforeEach(() => {
    process.env[MASTER_FLAG] = 'true';
  });

  it('matureSamplesD5 부족 → HOLD, env 무접촉', () => {
    const input = fullySatisfiedInput();
    input.evidence = makeEvidence({ matureSamplesD5: 10, reviewReady: true });
    const report = evaluateAutoActivation(input);

    const d = report.decisions.find((x) => x.leverId === 'PRICE_CORRECTION_SHADOW_ADR0623')!;
    expect(d.verdict).toBe('HOLD');
    expect(d.activated).toBe(false);
    expect(d.reasons.some((r) => r.includes('matureSamplesD5'))).toBe(true);
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBeUndefined();
    expect(listAutoActivationLedger()).toHaveLength(0);
  });

  it('reviewReady false → HOLD, env 무접촉', () => {
    const input = fullySatisfiedInput();
    input.evidence = makeEvidence({ matureSamplesD5: 150, reviewReady: false });
    const report = evaluateAutoActivation(input);

    const d = report.decisions.find((x) => x.leverId === 'PRICE_CORRECTION_SHADOW_ADR0623')!;
    expect(d.verdict).toBe('HOLD');
    expect(d.reasons.some((r) => r.includes('reviewReady'))).toBe(true);
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBeUndefined();
  });

  it('consecutiveReadyDays 부족 → HOLD, env 무접촉', () => {
    const input = fullySatisfiedInput();
    input.consecutiveReadyDaysByLever = { PRICE_CORRECTION_SHADOW_ADR0623: 1 };
    const report = evaluateAutoActivation(input);

    const d = report.decisions.find((x) => x.leverId === 'PRICE_CORRECTION_SHADOW_ADR0623')!;
    expect(d.verdict).toBe('HOLD');
    expect(d.reasons.some((r) => r.includes('consecutiveReadyDays'))).toBe(true);
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBeUndefined();
  });

  it('performanceJustified 부정(board lever 전부 false) → HOLD, env 무접촉', () => {
    const input = fullySatisfiedInput();
    input.promotionReadiness = makePromotionBoard(false);
    const report = evaluateAutoActivation(input);

    const d = report.decisions.find((x) => x.leverId === 'PRICE_CORRECTION_SHADOW_ADR0623')!;
    expect(d.verdict).toBe('HOLD');
    expect(d.reasons.some((r) => r.includes('performanceJustified'))).toBe(true);
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBeUndefined();
  });
});

describe('evaluateAutoActivation — EXCLUDED (불변식 #7/#8, 영구 금지)', () => {
  beforeEach(() => {
    process.env[MASTER_FLAG] = 'true';
  });

  it('EXCLUDED lever 는 충족 조건을 줘도 항상 EXCLUDED, process.env 절대 무접촉', () => {
    const report = evaluateAutoActivation(fullySatisfiedInput());

    const excludedLevers = LEVER_REGISTRY.filter((l) => l.eligibility !== 'LIVE_SAFE');
    expect(excludedLevers.length).toBeGreaterThan(0);
    for (const lever of excludedLevers) {
      const d = report.decisions.find((x) => x.leverId === lever.leverId)!;
      expect(d.verdict).toBe('EXCLUDED');
      expect(d.activated).toBe(false);
      // env 절대 무접촉.
      expect(process.env[lever.envName]).toBeUndefined();
      expect(report.activatedLeverIds).not.toContain(lever.leverId);
    }
  });

  it('GATE1_REGIME_AWARE_REQUIRED_ADR0546 (ABSOLUTE_PRESERVATION) → EXCLUDED, env 미설정', () => {
    const report = evaluateAutoActivation(fullySatisfiedInput());
    const d = report.decisions.find(
      (x) => x.leverId === 'GATE1_REGIME_AWARE_REQUIRED_ADR0546',
    )!;
    expect(d.verdict).toBe('EXCLUDED');
    expect(process.env.GATE1_REGIME_AWARE_REQUIRED).toBeUndefined();
  });
});

describe('evaluateAutoActivation — ALREADY_ACTIVE (중복 set 0)', () => {
  beforeEach(() => {
    process.env[MASTER_FLAG] = 'true';
  });

  it('이미 env=true → ALREADY_ACTIVE, ledger 무증가', () => {
    process.env.PRICE_CORRECTION_SHADOW_ENABLED = 'true';
    const report = evaluateAutoActivation(fullySatisfiedInput());

    const d = report.decisions.find((x) => x.leverId === 'PRICE_CORRECTION_SHADOW_ADR0623')!;
    expect(d.verdict).toBe('ALREADY_ACTIVE');
    expect(d.activated).toBe(false);
    expect(report.activatedLeverIds).not.toContain('PRICE_CORRECTION_SHADOW_ADR0623');
    // TRADE_REPLACEMENT 는 여전히 ACTIVATE → ledger 1행만.
    const led = listAutoActivationLedger();
    expect(led.map((e) => e.leverId)).not.toContain('PRICE_CORRECTION_SHADOW_ADR0623');
  });
});

describe('evaluateAutoActivation — DATA_UNAVAILABLE', () => {
  beforeEach(() => {
    process.env[MASTER_FLAG] = 'true';
  });

  it('evidence 부재 → DATA_UNAVAILABLE, env 무접촉', () => {
    const input = fullySatisfiedInput();
    input.evidence = undefined;
    const report = evaluateAutoActivation(input);

    const d = report.decisions.find((x) => x.leverId === 'PRICE_CORRECTION_SHADOW_ADR0623')!;
    expect(d.verdict).toBe('DATA_UNAVAILABLE');
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBeUndefined();
    expect(listAutoActivationLedger()).toHaveLength(0);
  });

  it('matureSamplesD5 null → DATA_UNAVAILABLE', () => {
    const input = fullySatisfiedInput();
    input.evidence = makeEvidence({
      matureSamplesD5: undefined as unknown as number,
      reviewReady: true,
    });
    const report = evaluateAutoActivation(input);
    const d = report.decisions.find((x) => x.leverId === 'PRICE_CORRECTION_SHADOW_ADR0623')!;
    expect(d.verdict).toBe('DATA_UNAVAILABLE');
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBeUndefined();
  });
});

describe('ledger 생명주기 (append/list/reset)', () => {
  beforeEach(() => {
    process.env[MASTER_FLAG] = 'true';
  });

  it('ACTIVATE append → list readonly 복사 → reset 비움', () => {
    evaluateAutoActivation(fullySatisfiedInput());
    const led = listAutoActivationLedger();
    expect(led.length).toBe(2);

    // readonly 복사 — 반환 배열 변형이 내부에 영향 없음.
    (led as unknown as unknown[]).push({});
    expect(listAutoActivationLedger().length).toBe(2);

    resetAutoActivationLedger();
    expect(listAutoActivationLedger()).toHaveLength(0);
  });
});

describe('formatAutoActivationReport — always-render skeleton', () => {
  it('report 부재 → N/A skeleton 렌더 (throw 없음)', () => {
    const out = formatAutoActivationReport(undefined);
    expect(out).toContain('ADR-0633');
    expect(out).toContain('masterEnabled: false');
    expect(out).toContain('liveExecutionUntouched: true');
    expect(out).toContain('requiredScoreUntouched: true');
    expect(out).toContain('DATA_UNAVAILABLE');
  });

  it('report 존재 → masterEnabled·각 decision·activatedLeverIds·guardrail 렌더', () => {
    process.env[MASTER_FLAG] = 'true';
    const report = evaluateAutoActivation(fullySatisfiedInput());
    const out = formatAutoActivationReport(report);
    expect(out).toContain('masterEnabled: true');
    expect(out).toContain('PRICE_CORRECTION_SHADOW_ADR0623');
    expect(out).toContain('verdict: ACTIVATE');
    expect(out).toContain('liveExecutionUntouched: true');
    expect(out).toContain('requiredScoreUntouched: true');
  });
});

describe('evaluateLeverReadiness — streak 제외 predicate (ADR-0634 helper)', () => {
  it('전부 충족 → matureOk/reviewOk/perfOk/readyExclStreak 모두 true (consecutive 무관)', () => {
    const input = fullySatisfiedInput();
    // streak 입력을 0 으로 만들어도 readyExclStreak 는 영향 없어야 한다 (streak 제외 기준).
    input.consecutiveReadyDaysByLever = {};
    const r = evaluateLeverReadiness(PRICE_LEVER, input);
    expect(r).toEqual({ matureOk: true, reviewOk: true, perfOk: true, readyExclStreak: true });
  });

  it('matureSamplesD5 부족 → matureOk false, readyExclStreak false', () => {
    const input = fullySatisfiedInput();
    input.evidence = makeEvidence({ matureSamplesD5: 10, reviewReady: true });
    const r = evaluateLeverReadiness(PRICE_LEVER, input);
    expect(r.matureOk).toBe(false);
    expect(r.readyExclStreak).toBe(false);
  });

  it('reviewReady false → reviewOk false, readyExclStreak false', () => {
    const input = fullySatisfiedInput();
    input.evidence = makeEvidence({ matureSamplesD5: 150, reviewReady: false });
    const r = evaluateLeverReadiness(PRICE_LEVER, input);
    expect(r.reviewOk).toBe(false);
    expect(r.readyExclStreak).toBe(false);
  });

  it('performanceJustified 부정 → perfOk false, readyExclStreak false', () => {
    const input = fullySatisfiedInput();
    input.promotionReadiness = makePromotionBoard(false);
    const r = evaluateLeverReadiness(PRICE_LEVER, input);
    expect(r.perfOk).toBe(false);
    expect(r.readyExclStreak).toBe(false);
  });

  it('evidence 부재 → matureOk false (null matureSamplesD5), readyExclStreak false', () => {
    const input = fullySatisfiedInput();
    input.evidence = undefined;
    const r = evaluateLeverReadiness(PRICE_LEVER, input);
    expect(r.matureOk).toBe(false);
    expect(r.readyExclStreak).toBe(false);
  });

  it('순수성 — process.env 무접촉 (master OFF 상태에서도 동일 결과)', () => {
    // master flag 미설정. helper 는 process.env 를 읽지 않으므로 결과 동일.
    const input = fullySatisfiedInput();
    const before = process.env.PRICE_CORRECTION_SHADOW_ENABLED;
    const r = evaluateLeverReadiness(PRICE_LEVER, input);
    expect(r.readyExclStreak).toBe(true);
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBe(before);
  });
});

// ── ADR-0635 — requiresEvidence:false T1 evidence-독립 자가 활성 ──────────────────
describe('ADR-0635 — requiresEvidence:false T1 (evidence-독립 활성)', () => {
  it('T1 lever 는 registry 에서 requiresEvidence:false 로 등재돼 있다', () => {
    expect(T1_LEVER.criteria.requiresEvidence).toBe(false);
    expect(T1_LEVER.eligibility).toBe('LIVE_SAFE');
    expect(T1_LEVER.criteria.minMatureSamplesD5).toBe(0);
  });

  it('evidence 부재(undefined)여도 readyExclStreak=true (evidence-독립)', () => {
    const r = evaluateLeverReadiness(T1_LEVER, {
      now: NOW,
      evidence: undefined,
      consecutiveReadyDaysByLever: {},
    });
    expect(r.matureOk).toBe(true);
    expect(r.reviewOk).toBe(true);
    expect(r.perfOk).toBe(true);
    expect(r.readyExclStreak).toBe(true);
  });

  it('master ON + evidence 부재 + streak 충족 → ACTIVATE (env=true, ledger append)', () => {
    process.env[MASTER_FLAG] = 'true';
    const report = evaluateAutoActivation({
      now: NOW,
      evidence: undefined, // evidence 없음 — 활성됨을 증명.
      consecutiveReadyDaysByLever: { FUTURE_RETURN_RESOLVER_ADR0175: 2 },
      registry: [T1_LEVER],
    });

    const d = report.decisions.find((x) => x.leverId === T1_LEVER.leverId)!;
    expect(d.verdict).toBe('ACTIVATE');
    expect(d.activated).toBe(true);
    expect(process.env.FUTURE_RETURN_RESOLVER_ENABLED).toBe('true');
    expect(report.activatedLeverIds).toContain('FUTURE_RETURN_RESOLVER_ADR0175');

    const led = listAutoActivationLedger();
    expect(led.map((e) => e.leverId)).toContain('FUTURE_RETURN_RESOLVER_ADR0175');
  });

  it('master ON + evidence 부재 + streak 부족 → HOLD (env 무접촉)', () => {
    process.env[MASTER_FLAG] = 'true';
    const report = evaluateAutoActivation({
      now: NOW,
      evidence: undefined,
      consecutiveReadyDaysByLever: { FUTURE_RETURN_RESOLVER_ADR0175: 1 }, // < minConsecutiveReadyDays(2)
      registry: [T1_LEVER],
    });

    const d = report.decisions.find((x) => x.leverId === T1_LEVER.leverId)!;
    expect(d.verdict).toBe('HOLD');
    expect(d.activated).toBe(false);
    expect(d.reasons.some((r) => r.includes('consecutiveReadyDays'))).toBe(true);
    expect(process.env.FUTURE_RETURN_RESOLVER_ENABLED).toBeUndefined();
    expect(listAutoActivationLedger()).toHaveLength(0);
  });

  it('master OFF → T1 도 MASTER_OFF·process.env 무접촉 (byte-identical, evidence-독립이라도 활성 금지)', () => {
    // master flag 미설정.
    const before = process.env.FUTURE_RETURN_RESOLVER_ENABLED;
    const report = evaluateAutoActivation({
      now: NOW,
      evidence: undefined,
      consecutiveReadyDaysByLever: { FUTURE_RETURN_RESOLVER_ADR0175: 99 },
      registry: [T1_LEVER],
    });

    const d = report.decisions.find((x) => x.leverId === T1_LEVER.leverId)!;
    expect(d.verdict).toBe('MASTER_OFF');
    expect(d.activated).toBe(false);
    expect(report.activatedLeverIds).toEqual([]);
    expect(process.env.FUTURE_RETURN_RESOLVER_ENABLED).toBe(before);
    expect(process.env.FUTURE_RETURN_RESOLVER_ENABLED).toBeUndefined();
    expect(listAutoActivationLedger()).toHaveLength(0);
  });

  it('requiresEvidence:true seed + evidence 부재 → 여전히 DATA_UNAVAILABLE (무회귀)', () => {
    process.env[MASTER_FLAG] = 'true';
    const report = evaluateAutoActivation({
      now: NOW,
      evidence: undefined,
      consecutiveReadyDaysByLever: { PRICE_CORRECTION_SHADOW_ADR0623: 99 },
      registry: [PRICE_LEVER],
    });

    const d = report.decisions.find((x) => x.leverId === PRICE_LEVER.leverId)!;
    expect(d.verdict).toBe('DATA_UNAVAILABLE');
    expect(d.activated).toBe(false);
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBeUndefined();
  });
});

// ── ADR-0635 — LIVE_ADJACENT_REVIEW T2 (자동 활성 금지 · 불변식 회귀 핵심) ─────────
describe('ADR-0635 — LIVE_ADJACENT_REVIEW T2 (운영자 검토 · process.env 무접촉)', () => {
  beforeEach(() => {
    process.env[MASTER_FLAG] = 'true';
  });

  it('T2 lever 는 LIVE_ADJACENT_REVIEW 로 등재돼 있다', () => {
    expect(T2_LEVER.eligibility).toBe('LIVE_ADJACENT_REVIEW');
  });

  it('master ON + 충족 조건을 줘도 → EXCLUDED, process.env 절대 무접촉', () => {
    const report = evaluateAutoActivation({
      now: NOW,
      promotionReadiness: makePromotionBoard(true),
      evidence: makeEvidence({ matureSamplesD5: 150, reviewReady: true }),
      consecutiveReadyDaysByLever: { R6_TRIGGER_TRADEDATE_FRESHNESS_ADR0592: 99 },
      registry: [T2_LEVER],
    });

    const d = report.decisions.find((x) => x.leverId === T2_LEVER.leverId)!;
    expect(d.verdict).toBe('EXCLUDED');
    expect(d.activated).toBe(false);
    expect(report.activatedLeverIds).not.toContain(T2_LEVER.leverId);
    expect(process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED).toBeUndefined();
  });

  it('전체 T2 4종 모두 EXCLUDED·process.env 무접촉', () => {
    const report = evaluateAutoActivation({
      now: NOW,
      promotionReadiness: makePromotionBoard(true),
      evidence: makeEvidence({ matureSamplesD5: 150, reviewReady: true }),
    });
    const t2Levers = LEVER_REGISTRY.filter((l) => l.eligibility === 'LIVE_ADJACENT_REVIEW');
    expect(t2Levers.length).toBe(4);
    for (const lever of t2Levers) {
      const d = report.decisions.find((x) => x.leverId === lever.leverId)!;
      expect(d.verdict).toBe('EXCLUDED');
      expect(process.env[lever.envName]).toBeUndefined();
    }
  });
});

// ── ADR-0635 — 실제 LEVER_REGISTRY 통합 (evidence 부재 시나리오) ───────────────────
describe('ADR-0635 — 실제 LEVER_REGISTRY 통합 (evidence 부재 · streak 누적)', () => {
  beforeEach(() => {
    process.env[MASTER_FLAG] = 'true';
  });

  it('master ON + evidence 부재 + T1 4종 streak 충족 → T1 만 활성 / T2·T3·requiresEvidence:true seed 무접촉 / LIVE env 무접촉', () => {
    // LIVE master env 가 평가 전 무접촉임을 보장 (실제 LIVE env 절대 무접촉 — 등재조차 안 됨).
    const liveAutoTradeBefore = process.env.AUTO_TRADE_ENABLED;
    const kisRealBefore = process.env.KIS_IS_REAL;

    const consecutiveReadyDaysByLever: Record<string, number> = {};
    for (const k of [
      'FUTURE_RETURN_RESOLVER_ADR0175',
      'SHAKEOUT_STOP_FORWARD_LABELER_ADR0625',
      'SAFETY_GATE_ATTRIBUTION_ADR0174',
      'SHADOW_LIVE_DELTA_REPORT_ADR0174',
    ]) {
      consecutiveReadyDaysByLever[k] = 2; // minConsecutiveReadyDays 충족.
    }

    const report = evaluateAutoActivation({
      now: NOW,
      evidence: undefined, // evidence 부재 — requiresEvidence:true seed 는 DATA_UNAVAILABLE.
      consecutiveReadyDaysByLever,
      // registry 미지정 → 실제 LEVER_REGISTRY.
    });

    // T1 4종 → ACTIVATE.
    for (const envKey of LIVE_SAFE_T1_ENV_KEYS) {
      expect(process.env[envKey]).toBe('true');
    }
    expect(report.activatedLeverIds.sort()).toEqual(
      [
        'FUTURE_RETURN_RESOLVER_ADR0175',
        'SAFETY_GATE_ATTRIBUTION_ADR0174',
        'SHADOW_LIVE_DELTA_REPORT_ADR0174',
        'SHAKEOUT_STOP_FORWARD_LABELER_ADR0625',
      ].sort(),
    );

    // requiresEvidence:true seed 2종 → DATA_UNAVAILABLE (evidence 부재 무회귀).
    for (const lever of LEVER_REGISTRY.filter(
      (l) => l.eligibility === 'LIVE_SAFE' && l.criteria.requiresEvidence === true,
    )) {
      const d = report.decisions.find((x) => x.leverId === lever.leverId)!;
      expect(d.verdict).toBe('DATA_UNAVAILABLE');
      expect(process.env[lever.envName]).toBeUndefined();
    }

    // T2 (LIVE_ADJACENT_REVIEW) + T3 (EXCLUDED) → 모두 process.env 무접촉.
    for (const lever of LEVER_REGISTRY.filter((l) => l.eligibility !== 'LIVE_SAFE')) {
      const d = report.decisions.find((x) => x.leverId === lever.leverId)!;
      expect(d.verdict).toBe('EXCLUDED');
      expect(process.env[lever.envName]).toBeUndefined();
    }

    // LIVE master env 절대 무접촉 (registry 비등재).
    expect(process.env.AUTO_TRADE_ENABLED).toBe(liveAutoTradeBefore);
    expect(process.env.KIS_IS_REAL).toBe(kisRealBefore);
  });
});

describe('registry 주입 (테스트용)', () => {
  beforeEach(() => {
    process.env[MASTER_FLAG] = 'true';
  });

  it('input.registry 로 단일 lever 만 평가', () => {
    const report = evaluateAutoActivation(fullySatisfiedInput([PRICE_LEVER]));
    expect(report.decisions).toHaveLength(1);
    expect(report.decisions[0].leverId).toBe('PRICE_CORRECTION_SHADOW_ADR0623');
  });
});
