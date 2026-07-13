// @responsibility ADR-0631 Shadow→Live 승격 준비도 진단 — 기존 forward-outcome/밴드/regime/counterfactual 증거를 레버별 READY/NOT_READY 로 통합하는 순수 read-only 판정기(executionImpact=NONE).
import type { Gate1ThresholdEvidenceSummary } from './gate1DryRunObservationLedgerAdr0476.js';
import type { CounterfactualOutcomeBoard } from '../../learning/counterfactualOutcomeBoard.js';
import { isGate1RegimeAwareRequiredEnabled } from '../gateConfig.js';

type PromotionLeverId = 'REGIME_AWARE_THRESHOLD_ADR0546' | 'CONDITION_WEIGHT_ADR0624';

type PromotionReadinessVerdict =
  | 'READY' // 성숙 충족 + 성과 정당화 + flag 아직 OFF → 운영자 검토 가능
  | 'NOT_READY' // 성숙 미충족 또는 성과 미정당화
  | 'ALREADY_ACTIVE' // 해당 레버 flag 가 이미 ON (재판정 불필요·정보용)
  | 'DATA_UNAVAILABLE'; // report 부재 (immature: matureD5=0 초기 상태 포함)

export interface PromotionLeverReadiness {
  lever: PromotionLeverId;
  verdict: PromotionReadinessVerdict;
  /** 성숙도 게이트 — Gate1ThresholdEvidenceSummary.reviewBlockers SSOT 그대로 재사용 (새 임계 발명 금지). */
  maturityReady: boolean;
  maturityBlockers: string[]; // reviewBlockers 부분집합 (레버별 관련 항목만)
  /** 성과 정당화 — regimeAwareWindow.verdict / counterfactual verdict 재사용. */
  performanceJustified: boolean;
  performanceReason: string; // e.g. 'WINDOW_OUTPERFORMS_70PLUS' | 'INSUFFICIENT_SAMPLE'
  /** 해당 레버 flag 의 현재 ON/OFF (관측만 — 토글하지 않음). */
  flagActive: boolean;
  /** 운영자가 켤 정확한 기구 (절차 §(b) 와 1:1). */
  activationMechanism: string; // e.g. 'GATE1_REGIME_AWARE_REQUIRED=true' | '/promote_learning apply (+ENV)'
  /** 사람이 읽는 근거 — 표시 전용. */
  notes: string[];
}

export interface PromotionReadinessBoard {
  generatedAt: string;
  /** matureD5 등 핵심 성숙 헤드라인 — 재계산 없이 evidence 에서 전사. */
  maturityHeadline: {
    matureSamplesD5: number;
    totalReviewReady: boolean; // evidence.reviewReady
    reviewBlockers: string[]; // evidence.reviewBlockers (SSOT 그대로)
  };
  levers: PromotionLeverReadiness[]; // 정확히 2개 (A, B)
  /** 불변식 backstop 표시 (항상 고정값). */
  liveThresholdAutoChanged: false;
  operatorApprovalRequired: true;
  executionImpact: 'NONE';
}

const LEVER_A_ACTIVATION =
  'GATE1_REGIME_AWARE_REQUIRED=true (운영자 검토 후·byte-equivalent 롤백 ENV 1줄)';
const LEVER_B_ACTIVATION =
  '/promote_learning apply + (LIVE) LEARNING_WEIGHT_PROMOTION_ENABLED=true / COUNTERFACTURE_GATE_APPLY_ENABLED=true';

/** ENV read-only — 토글하지 않는다 (ADR-0631 §2a.3·불변식 #8). */
function isLearningWeightPromotionEnabled(): boolean {
  return process.env.LEARNING_WEIGHT_PROMOTION_ENABLED === 'true';
}

/** ENV read-only — 토글하지 않는다 (ADR-0631 §2a.3·불변식 #8). */
function isCounterfactureGateApplyEnabled(): boolean {
  return process.env.COUNTERFACTURE_GATE_APPLY_ENABLED === 'true';
}

/** Lever A — Regime-aware threshold (ADR-0546). reviewBlockers + regimeAwareWindow.verdict SSOT 합성. */
function buildLeverA(evidence?: Gate1ThresholdEvidenceSummary): PromotionLeverReadiness {
  const flagActive = isGate1RegimeAwareRequiredEnabled();
  const base: Omit<PromotionLeverReadiness, 'verdict'> = {
    lever: 'REGIME_AWARE_THRESHOLD_ADR0546',
    maturityReady: false,
    maturityBlockers: evidence?.reviewBlockers ?? ['DATA_UNAVAILABLE'],
    performanceJustified: false,
    performanceReason: 'DATA_UNAVAILABLE',
    flagActive,
    activationMechanism: LEVER_A_ACTIVATION,
    notes: [],
  };

  if (!evidence) {
    return {
      ...base,
      verdict: 'DATA_UNAVAILABLE',
      notes: ['evidence 부재 (matureD5=0 초기 상태 포함) — forward-outcome 성숙 대기'],
    };
  }

  const windowVerdict = evidence.regimeAwareWindow.verdict;
  base.maturityReady = evidence.reviewReady === true;
  base.maturityBlockers = evidence.reviewReady === true ? [] : evidence.reviewBlockers;
  base.performanceReason = windowVerdict;
  base.performanceJustified =
    windowVerdict === 'WINDOW_COMPARABLE_TO_70PLUS' ||
    windowVerdict === 'WINDOW_OUTPERFORMS_70PLUS';

  if (flagActive) {
    return {
      ...base,
      verdict: 'ALREADY_ACTIVE',
      notes: ['GATE1_REGIME_AWARE_REQUIRED 이미 ON — 재판정 불필요 (정보용)'],
    };
  }
  if (evidence.reviewReady !== true) {
    return {
      ...base,
      verdict: 'NOT_READY',
      notes: ['성숙 미충족 (reviewReady=false) — reviewBlockers 잔존'],
    };
  }
  if (windowVerdict === 'INSUFFICIENT_SAMPLE') {
    return {
      ...base,
      verdict: 'NOT_READY',
      notes: ['regime-aware 창 표본 부족 (INSUFFICIENT_SAMPLE)'],
    };
  }
  if (windowVerdict === 'WINDOW_UNDERPERFORMS_70PLUS') {
    return {
      ...base,
      verdict: 'NOT_READY',
      notes: ['완화 창이 70+ 보다 성과 열위 (WINDOW_UNDERPERFORMS_70PLUS)'],
    };
  }
  return {
    ...base,
    verdict: 'READY',
    notes: [`완화 창 성과 정당화 (${windowVerdict}) — 운영자 검토 가능`],
  };
}

/** Lever B — Condition-weight promotion (ADR-0624/0581). reviewBlockers + counterfactual review/verdict SSOT 합성. */
function buildLeverB(
  evidence?: Gate1ThresholdEvidenceSummary,
  counterfactual?: CounterfactualOutcomeBoard,
): PromotionLeverReadiness {
  const weightFlag = isLearningWeightPromotionEnabled();
  const gateFlag = isCounterfactureGateApplyEnabled();
  const flagActive = weightFlag || gateFlag;
  const activeNotes: string[] = [];
  if (weightFlag) activeNotes.push('LEARNING_WEIGHT_PROMOTION_ENABLED ON (가중치)');
  if (gateFlag) activeNotes.push('COUNTERFACTURE_GATE_APPLY_ENABLED ON (Gate1 임계 provider)');

  const base: Omit<PromotionLeverReadiness, 'verdict'> = {
    lever: 'CONDITION_WEIGHT_ADR0624',
    maturityReady: false,
    maturityBlockers: evidence?.reviewBlockers ?? ['DATA_UNAVAILABLE'],
    performanceJustified: false,
    performanceReason: 'DATA_UNAVAILABLE',
    flagActive,
    activationMechanism: LEVER_B_ACTIVATION,
    notes: [],
  };

  if (!evidence) {
    return {
      ...base,
      verdict: 'DATA_UNAVAILABLE',
      notes: ['evidence 부재 (matureD5=0 초기 상태 포함) — forward-outcome 성숙 대기'],
    };
  }

  base.maturityReady = evidence.reviewReady === true;
  base.maturityBlockers = evidence.reviewReady === true ? [] : evidence.reviewBlockers;

  const reviewStatus = counterfactual?.review.status;
  const summaryVerdict = counterfactual?.summary.verdict;
  base.performanceReason = counterfactual
    ? `review=${reviewStatus},verdict=${summaryVerdict}`
    : 'COUNTERFACTUAL_UNAVAILABLE';
  base.performanceJustified =
    reviewStatus === 'READY_FOR_OPERATOR_REVIEW' &&
    (summaryVerdict === 'WATCH' || summaryVerdict === 'REVIEW_WITH_OPERATOR');

  if (flagActive) {
    return {
      ...base,
      verdict: 'ALREADY_ACTIVE',
      notes:
        activeNotes.length > 0
          ? [...activeNotes, '부분/전체 활성 — 재판정 불필요 (정보용)']
          : ['flag 활성 — 재판정 불필요 (정보용)'],
    };
  }
  if (evidence.reviewReady !== true) {
    return {
      ...base,
      verdict: 'NOT_READY',
      notes: ['성숙 미충족 (reviewReady=false) — reviewBlockers 잔존'],
    };
  }
  if (!counterfactual || reviewStatus === 'INSUFFICIENT_SAMPLE') {
    return {
      ...base,
      verdict: 'NOT_READY',
      notes: ['counterfactual 부재/표본 부족 (INSUFFICIENT_SAMPLE)'],
    };
  }
  if (summaryVerdict === 'KEEP_BLOCKS') {
    return {
      ...base,
      verdict: 'NOT_READY',
      notes: ['성과가 차단 유지를 지지 (KEEP_BLOCKS) — 가중치 승격 부적격'],
    };
  }
  if (base.performanceJustified) {
    return {
      ...base,
      verdict: 'READY',
      notes: [`counterfactual 성과 정당화 (${base.performanceReason}) — 운영자 검토 가능`],
    };
  }
  return {
    ...base,
    verdict: 'NOT_READY',
    notes: [`counterfactual 성과 미정당화 (${base.performanceReason})`],
  };
}

/**
 * 순수 함수 — 두 기존 report 를 받아 레버별 준비도를 판정한다. 신규 fetch·재계산 0.
 * evidence/board 가 undefined(immature·0 row) 이면 모든 레버 DATA_UNAVAILABLE.
 */
export function buildPromotionReadinessBoard(input: {
  now?: Date;
  evidence?: Gate1ThresholdEvidenceSummary; // 기존 buildGate1ThresholdEvidenceSummary 산출
  counterfactual?: CounterfactualOutcomeBoard; // 기존 buildCounterfactualOutcomeBoard 산출
}): PromotionReadinessBoard {
  const { evidence, counterfactual } = input;
  const generatedAt = (input.now ?? new Date()).toISOString();
  return {
    generatedAt,
    maturityHeadline: {
      matureSamplesD5: evidence?.matureSamplesD5 ?? 0,
      totalReviewReady: evidence?.reviewReady ?? false,
      reviewBlockers: evidence?.reviewBlockers ?? ['DATA_UNAVAILABLE'],
    },
    levers: [buildLeverA(evidence), buildLeverB(evidence, counterfactual)],
    liveThresholdAutoChanged: false,
    operatorApprovalRequired: true,
    executionImpact: 'NONE',
  };
}

/** scan_blockers / 텔레그램 섹션 렌더 (표시 전용·always-render skeleton). */
export function formatPromotionReadinessSection(board?: PromotionReadinessBoard): string {
  const lines: string[] = [
    'Shadow→Live Promotion Readiness (ADR-0631)',
    '------------------------------------------',
    `generatedAt: ${board ? board.generatedAt : 'N/A'}`,
    `matureSamplesD5: ${board ? board.maturityHeadline.matureSamplesD5 : 'N/A'}`,
    `reviewReady: ${board ? board.maturityHeadline.totalReviewReady : false}`,
    `reviewBlockers: ${
      board
        ? board.maturityHeadline.reviewBlockers.length > 0
          ? board.maturityHeadline.reviewBlockers.join(',')
          : 'NONE'
        : 'DATA_UNAVAILABLE'
    }`,
    'liveThresholdAutoChanged: false',
    'operatorApprovalRequired: true',
    'executionImpact: NONE',
    '',
  ];
  const levers = board ? board.levers : [];
  for (const lever of levers) {
    lines.push(`Lever: ${lever.lever}`);
    lines.push(`- verdict: ${lever.verdict}`);
    lines.push(`- maturityReady: ${lever.maturityReady}`);
    lines.push(
      `- maturityBlockers: ${lever.maturityBlockers.length > 0 ? lever.maturityBlockers.join(',') : 'NONE'}`,
    );
    lines.push(`- performanceJustified: ${lever.performanceJustified}`);
    lines.push(`- performanceReason: ${lever.performanceReason}`);
    lines.push(`- flagActive: ${lever.flagActive}`);
    lines.push(`- activationMechanism: ${lever.activationMechanism}`);
    lines.push(`- notes: ${lever.notes.length > 0 ? lever.notes.join(' | ') : 'NONE'}`);
    lines.push('');
  }
  if (levers.length === 0) {
    lines.push('levers: DATA_UNAVAILABLE (forward-outcome 성숙 대기)');
  }
  return lines.join('\n');
}
