// @responsibility ADR-0633 evaluator/ledger 회귀 테스트 — master OFF byte-identical, EXCLUDED 영구 금지(불변식 #7/#8), LIVE_SAFE ACTIVATE/HOLD/ALREADY_ACTIVE/DATA_UNAVAILABLE, ledger 생명주기. process.env 격리.
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
const EXCLUDED_ENV_KEYS = [
  'GATE1_REGIME_AWARE_REQUIRED',
  'GATE1_POSITIVE_CEILING_WIRING_ENABLED',
  'LEARNING_WEIGHT_PROMOTION_ENABLED',
  'COUNTERFACTURE_GATE_APPLY_ENABLED',
];
const ALL_MANAGED_KEYS = [MASTER_FLAG, ...LIVE_SAFE_ENV_KEYS, ...EXCLUDED_ENV_KEYS];

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
