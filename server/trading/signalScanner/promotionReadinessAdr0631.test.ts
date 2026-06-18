import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildPromotionReadinessBoard,
  formatPromotionReadinessSection,
  type PromotionReadinessBoard,
  type PromotionLeverReadiness,
} from './promotionReadinessAdr0631.js';
import type { Gate1ThresholdEvidenceSummary } from './gate1DryRunObservationLedgerAdr0476.js';
import type { CounterfactualOutcomeBoard } from '../../learning/counterfactualOutcomeBoard.js';

// ── Minimal typed fixtures — buildPromotionReadinessBoard is a pure leaf that reads only
//    evidence.{reviewReady,reviewBlockers,matureSamplesD5,regimeAwareWindow.verdict} and
//    counterfactual.{review.status,summary.verdict}. Unused fields are cast-filled. ──
function makeEvidence(overrides: {
  reviewReady: boolean;
  reviewBlockers: string[];
  matureSamplesD5: number;
  windowVerdict: Gate1ThresholdEvidenceSummary['regimeAwareWindow']['verdict'];
}): Gate1ThresholdEvidenceSummary {
  return {
    matureSamplesD5: overrides.matureSamplesD5,
    reviewReady: overrides.reviewReady,
    reviewBlockers: overrides.reviewBlockers,
    regimeAwareWindow: {
      verdict: overrides.windowVerdict,
    },
  } as unknown as Gate1ThresholdEvidenceSummary;
}

function makeCounterfactual(overrides: {
  reviewStatus: CounterfactualOutcomeBoard['review']['status'];
  summaryVerdict: CounterfactualOutcomeBoard['summary']['verdict'];
}): CounterfactualOutcomeBoard {
  return {
    review: { status: overrides.reviewStatus },
    summary: { verdict: overrides.summaryVerdict },
  } as unknown as CounterfactualOutcomeBoard;
}

const ALL_BLOCKERS = [
  'SCORE_BAND_D5_SAMPLE_LT_30',
  'TOTAL_D5_SAMPLE_LT_100',
  'SIXTY_TO_SEVENTY_NOT_COMPARABLE',
  'BELOW55_DEFENSE_NOT_CONFIRMED',
  'FALSE_NEGATIVE_RATE_INSUFFICIENT',
  'MFE_MAE_TIMING_SPLIT_INSUFFICIENT',
];

const NOW = new Date('2026-06-18T00:00:00.000Z');
const ENV_KEYS = [
  'GATE1_REGIME_AWARE_REQUIRED',
  'LEARNING_WEIGHT_PROMOTION_ENABLED',
  'COUNTERFACTURE_GATE_APPLY_ENABLED',
] as const;

function leverA(board: PromotionReadinessBoard): PromotionLeverReadiness {
  return board.levers.find((l) => l.lever === 'REGIME_AWARE_THRESHOLD_ADR0546')!;
}
function leverB(board: PromotionReadinessBoard): PromotionLeverReadiness {
  return board.levers.find((l) => l.lever === 'CONDITION_WEIGHT_ADR0624')!;
}

describe('ADR-0631 buildPromotionReadinessBoard', () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  // (1) matureD5=0 / reviewBlockers 가득 → 전 레버 NOT_READY (현 상태)
  it('immature evidence (matureD5=0, blockers full) → both levers NOT_READY', () => {
    const evidence = makeEvidence({
      reviewReady: false,
      reviewBlockers: ALL_BLOCKERS,
      matureSamplesD5: 0,
      windowVerdict: 'INSUFFICIENT_SAMPLE',
    });
    const counterfactual = makeCounterfactual({
      reviewStatus: 'INSUFFICIENT_SAMPLE',
      summaryVerdict: 'INSUFFICIENT_SAMPLE',
    });
    const board = buildPromotionReadinessBoard({ evidence, counterfactual, now: NOW });
    expect(board.levers).toHaveLength(2);
    expect(leverA(board).verdict).toBe('NOT_READY');
    expect(leverB(board).verdict).toBe('NOT_READY');
    expect(leverA(board).maturityReady).toBe(false);
    expect(leverA(board).maturityBlockers).toEqual(ALL_BLOCKERS);
    expect(board.maturityHeadline.matureSamplesD5).toBe(0);
    expect(board.executionImpact).toBe('NONE');
    expect(board.liveThresholdAutoChanged).toBe(false);
    expect(board.operatorApprovalRequired).toBe(true);
  });

  // (2) reviewReady=true + verdict=WINDOW_OUTPERFORMS_70PLUS → Lever A READY
  it('reviewReady + WINDOW_OUTPERFORMS_70PLUS → Lever A READY', () => {
    const evidence = makeEvidence({
      reviewReady: true,
      reviewBlockers: [],
      matureSamplesD5: 150,
      windowVerdict: 'WINDOW_OUTPERFORMS_70PLUS',
    });
    const board = buildPromotionReadinessBoard({ evidence, now: NOW });
    const a = leverA(board);
    expect(a.verdict).toBe('READY');
    expect(a.maturityReady).toBe(true);
    expect(a.performanceJustified).toBe(true);
    expect(a.performanceReason).toBe('WINDOW_OUTPERFORMS_70PLUS');
    expect(a.flagActive).toBe(false);
  });

  it('reviewReady + WINDOW_COMPARABLE_TO_70PLUS → Lever A READY', () => {
    const evidence = makeEvidence({
      reviewReady: true,
      reviewBlockers: [],
      matureSamplesD5: 120,
      windowVerdict: 'WINDOW_COMPARABLE_TO_70PLUS',
    });
    expect(leverA(buildPromotionReadinessBoard({ evidence, now: NOW })).verdict).toBe('READY');
  });

  it('reviewReady + WINDOW_UNDERPERFORMS_70PLUS → Lever A NOT_READY (performance)', () => {
    const evidence = makeEvidence({
      reviewReady: true,
      reviewBlockers: [],
      matureSamplesD5: 120,
      windowVerdict: 'WINDOW_UNDERPERFORMS_70PLUS',
    });
    const a = leverA(buildPromotionReadinessBoard({ evidence, now: NOW }));
    expect(a.verdict).toBe('NOT_READY');
    expect(a.performanceJustified).toBe(false);
  });

  // (3) flag 이미 ON → ALREADY_ACTIVE
  it('GATE1_REGIME_AWARE_REQUIRED=true → Lever A ALREADY_ACTIVE', () => {
    process.env.GATE1_REGIME_AWARE_REQUIRED = 'true';
    const evidence = makeEvidence({
      reviewReady: true,
      reviewBlockers: [],
      matureSamplesD5: 150,
      windowVerdict: 'WINDOW_OUTPERFORMS_70PLUS',
    });
    const a = leverA(buildPromotionReadinessBoard({ evidence, now: NOW }));
    expect(a.verdict).toBe('ALREADY_ACTIVE');
    expect(a.flagActive).toBe(true);
  });

  it('LEARNING_WEIGHT_PROMOTION_ENABLED=true → Lever B ALREADY_ACTIVE (flagActive + note)', () => {
    process.env.LEARNING_WEIGHT_PROMOTION_ENABLED = 'true';
    const evidence = makeEvidence({
      reviewReady: true,
      reviewBlockers: [],
      matureSamplesD5: 150,
      windowVerdict: 'WINDOW_OUTPERFORMS_70PLUS',
    });
    const counterfactual = makeCounterfactual({
      reviewStatus: 'READY_FOR_OPERATOR_REVIEW',
      summaryVerdict: 'WATCH',
    });
    const b = leverB(buildPromotionReadinessBoard({ evidence, counterfactual, now: NOW }));
    expect(b.verdict).toBe('ALREADY_ACTIVE');
    expect(b.flagActive).toBe(true);
    expect(b.notes.some((n) => n.includes('LEARNING_WEIGHT_PROMOTION_ENABLED'))).toBe(true);
  });

  it('COUNTERFACTURE_GATE_APPLY_ENABLED=true → Lever B ALREADY_ACTIVE', () => {
    process.env.COUNTERFACTURE_GATE_APPLY_ENABLED = 'true';
    const evidence = makeEvidence({
      reviewReady: true,
      reviewBlockers: [],
      matureSamplesD5: 150,
      windowVerdict: 'WINDOW_OUTPERFORMS_70PLUS',
    });
    const b = leverB(buildPromotionReadinessBoard({ evidence, now: NOW }));
    expect(b.verdict).toBe('ALREADY_ACTIVE');
    expect(b.flagActive).toBe(true);
  });

  // (4) evidence/counterfactual 입력 없음 → DATA_UNAVAILABLE (throw 0)
  it('no inputs → both levers DATA_UNAVAILABLE, no throw', () => {
    const board = buildPromotionReadinessBoard({ now: NOW });
    expect(leverA(board).verdict).toBe('DATA_UNAVAILABLE');
    expect(leverB(board).verdict).toBe('DATA_UNAVAILABLE');
    expect(board.maturityHeadline.matureSamplesD5).toBe(0);
    expect(board.maturityHeadline.reviewBlockers).toEqual(['DATA_UNAVAILABLE']);
  });

  it('evidence present but counterfactual absent → Lever B NOT_READY (when mature)', () => {
    const evidence = makeEvidence({
      reviewReady: true,
      reviewBlockers: [],
      matureSamplesD5: 150,
      windowVerdict: 'WINDOW_OUTPERFORMS_70PLUS',
    });
    const b = leverB(buildPromotionReadinessBoard({ evidence, now: NOW }));
    expect(b.verdict).toBe('NOT_READY');
    expect(b.performanceReason).toBe('COUNTERFACTUAL_UNAVAILABLE');
  });

  // (5) counterfactual review.status / summary.verdict 별 Lever B 판정
  describe('Lever B counterfactual truth table (mature evidence, flags OFF)', () => {
    const evidence = makeEvidence({
      reviewReady: true,
      reviewBlockers: [],
      matureSamplesD5: 150,
      windowVerdict: 'WINDOW_OUTPERFORMS_70PLUS',
    });

    it('READY_FOR_OPERATOR_REVIEW + WATCH → READY', () => {
      const cf = makeCounterfactual({ reviewStatus: 'READY_FOR_OPERATOR_REVIEW', summaryVerdict: 'WATCH' });
      const b = leverB(buildPromotionReadinessBoard({ evidence, counterfactual: cf, now: NOW }));
      expect(b.verdict).toBe('READY');
      expect(b.performanceJustified).toBe(true);
    });

    it('READY_FOR_OPERATOR_REVIEW + REVIEW_WITH_OPERATOR → READY', () => {
      const cf = makeCounterfactual({ reviewStatus: 'READY_FOR_OPERATOR_REVIEW', summaryVerdict: 'REVIEW_WITH_OPERATOR' });
      expect(leverB(buildPromotionReadinessBoard({ evidence, counterfactual: cf, now: NOW })).verdict).toBe('READY');
    });

    it('summary KEEP_BLOCKS → NOT_READY', () => {
      const cf = makeCounterfactual({ reviewStatus: 'READY_FOR_OPERATOR_REVIEW', summaryVerdict: 'KEEP_BLOCKS' });
      expect(leverB(buildPromotionReadinessBoard({ evidence, counterfactual: cf, now: NOW })).verdict).toBe('NOT_READY');
    });

    it('review INSUFFICIENT_SAMPLE → NOT_READY', () => {
      const cf = makeCounterfactual({ reviewStatus: 'INSUFFICIENT_SAMPLE', summaryVerdict: 'OBSERVE_MORE' });
      expect(leverB(buildPromotionReadinessBoard({ evidence, counterfactual: cf, now: NOW })).verdict).toBe('NOT_READY');
    });

    it('READY review but OBSERVE_MORE verdict (not justified) → NOT_READY', () => {
      const cf = makeCounterfactual({ reviewStatus: 'READY_FOR_OPERATOR_REVIEW', summaryVerdict: 'OBSERVE_MORE' });
      expect(leverB(buildPromotionReadinessBoard({ evidence, counterfactual: cf, now: NOW })).verdict).toBe('NOT_READY');
    });

    it('reviewReady=false dominates counterfactual READY → NOT_READY (maturity)', () => {
      const immature = makeEvidence({
        reviewReady: false,
        reviewBlockers: ['TOTAL_D5_SAMPLE_LT_100'],
        matureSamplesD5: 10,
        windowVerdict: 'INSUFFICIENT_SAMPLE',
      });
      const cf = makeCounterfactual({ reviewStatus: 'READY_FOR_OPERATOR_REVIEW', summaryVerdict: 'WATCH' });
      const b = leverB(buildPromotionReadinessBoard({ evidence: immature, counterfactual: cf, now: NOW }));
      expect(b.verdict).toBe('NOT_READY');
      expect(b.maturityReady).toBe(false);
    });
  });

  // (6) 순수성 — 동일 입력 동일 출력, ENV read-only (toggle 0)
  it('pure: identical input → identical output (deterministic)', () => {
    const evidence = makeEvidence({
      reviewReady: true,
      reviewBlockers: [],
      matureSamplesD5: 150,
      windowVerdict: 'WINDOW_OUTPERFORMS_70PLUS',
    });
    const cf = makeCounterfactual({ reviewStatus: 'READY_FOR_OPERATOR_REVIEW', summaryVerdict: 'WATCH' });
    const a = buildPromotionReadinessBoard({ evidence, counterfactual: cf, now: NOW });
    const b = buildPromotionReadinessBoard({ evidence, counterfactual: cf, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('pure: does not mutate process.env (no toggle)', () => {
    const before = { ...process.env };
    buildPromotionReadinessBoard({ now: NOW });
    for (const k of ENV_KEYS) {
      expect(process.env[k]).toBe(before[k]);
    }
  });
});

describe('ADR-0631 formatPromotionReadinessSection', () => {
  it('renders graceful skeleton when board undefined (no throw)', () => {
    const text = formatPromotionReadinessSection(undefined);
    expect(text).toContain('Shadow→Live Promotion Readiness (ADR-0631)');
    expect(text).toContain('executionImpact: NONE');
    expect(text).toContain('DATA_UNAVAILABLE');
  });

  it('renders both lever verdicts', () => {
    const board = buildPromotionReadinessBoard({ now: NOW });
    const text = formatPromotionReadinessSection(board);
    expect(text).toContain('REGIME_AWARE_THRESHOLD_ADR0546');
    expect(text).toContain('CONDITION_WEIGHT_ADR0624');
    expect(text).toContain('verdict: DATA_UNAVAILABLE');
    expect(text).toContain('liveThresholdAutoChanged: false');
  });
});
