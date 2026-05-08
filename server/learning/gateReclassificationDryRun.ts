/**
 * @responsibility ADR-458 Approved Gate Reclassification Dry-Run Engine — shadow-only approval impact simulation.
 *
 * APPROVED Gate 재분류 항목을 live Gate/threshold/order execution에 반영하지 않고,
 * 후보가 어떤 shadow/dry-run 상태로 구조되었을지 진단 원장에 남기기 위한 순수 평가 모듈이다.
 */
import type { GateReclassificationApprovalItem } from './gateReclassificationApprovalPlan.js';

export type GateReclassificationDryRunDecision =
  | 'NO_CHANGE'
  | 'DRY_RUN_RESCUED_TO_PROBING'
  | 'DRY_RUN_RESCUED_TO_WAIT_TRIGGER'
  | 'DRY_RUN_RESCUED_TO_SCORE_ONLY'
  | 'DRY_RUN_RESCUED_TO_EXECUTABLE_SHADOW'
  | 'DRY_RUN_STILL_REJECTED';

export interface GateReclassificationDryRunInput {
  code: string;
  name: string;

  gateScore: number;
  rawScore: number;
  availableMaxScore: number;
  normalizedGateScore: number;

  unavailableConditions: string[];
  thresholdNotMetConditions: string[];
  providerDegradedConditions: string[];

  originalBucket:
    | 'EXECUTABLE'
    | 'DATA_BLOCKED_NEAR_MISS'
    | 'PROBING'
    | 'SHADOW_ONLY'
    | 'REJECTED';

  approvedItems: GateReclassificationApprovalItem[];
}

export interface GateReclassificationDryRunResult {
  code: string;
  name: string;

  originalBucket: string;
  dryRunDecision: GateReclassificationDryRunDecision;

  matchedApprovedConditions: string[];
  appliedProposedClasses: Array<{
    condition: string;
    source: string;
    proposedClass: string;
  }>;

  originalRawScore: number;
  originalNormalizedGateScore: number;

  dryRunScoreAdjustment: number;
  dryRunExplanation: string;

  executionImpact: 'NONE';
  createLiveOrder: false;
  requiresHumanApproval: true;
}

export interface GateReclassificationDryRunSummary {
  total: number;
  byDecision: Record<GateReclassificationDryRunDecision, number>;
  topMatchedConditions: Array<{ condition: string; count: number }>;
  executionImpact: 'NONE';
}

export function isGateReclassificationDryRunDisabled(): boolean {
  return process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED === 'true';
}

function sourceConditions(input: GateReclassificationDryRunInput, source: string): string[] {
  if (source === 'unavailableConditions') return input.unavailableConditions;
  if (source === 'thresholdNotMetConditions') return input.thresholdNotMetConditions;
  if (source === 'providerDegradedConditions') return input.providerDegradedConditions;
  return [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function scoreAdjustmentFor(proposedClass: string): number {
  if (proposedClass === 'SOFT_PENALTY') return 0.15;
  if (proposedClass === 'WAIT_TRIGGER') return 0.1;
  if (proposedClass === 'SCORE_ONLY') return 0.05;
  return 0;
}

function decisionFor(input: GateReclassificationDryRunInput, proposedClasses: string[]): GateReclassificationDryRunDecision {
  if (input.originalBucket === 'DATA_BLOCKED_NEAR_MISS' && input.normalizedGateScore >= 0.70 && proposedClasses.length > 0) {
    return 'DRY_RUN_RESCUED_TO_EXECUTABLE_SHADOW';
  }

  if (proposedClasses.includes('WAIT_TRIGGER')) return 'DRY_RUN_RESCUED_TO_WAIT_TRIGGER';
  if (proposedClasses.includes('SCORE_ONLY')) return 'DRY_RUN_RESCUED_TO_SCORE_ONLY';
  if (proposedClasses.includes('SOFT_PENALTY')) {
    return input.originalBucket === 'DATA_BLOCKED_NEAR_MISS' || input.originalBucket === 'REJECTED'
      ? 'DRY_RUN_RESCUED_TO_PROBING'
      : 'DRY_RUN_STILL_REJECTED';
  }

  return 'DRY_RUN_STILL_REJECTED';
}

export function evaluateGateReclassificationDryRun(
  input: GateReclassificationDryRunInput,
): GateReclassificationDryRunResult {
  const approvedMatches = input.approvedItems
    .filter((item) => item.status === 'APPROVED')
    .filter((item) => sourceConditions(input, item.source).includes(item.condition));

  const matchedApprovedConditions = unique(approvedMatches.map((item) => item.condition));
  const appliedProposedClasses = approvedMatches.map((item) => ({
    condition: item.condition,
    source: item.source,
    proposedClass: item.proposedClass,
  }));
  const proposedClasses = unique(approvedMatches.map((item) => item.proposedClass));
  const dryRunDecision = approvedMatches.length === 0 ? 'NO_CHANGE' : decisionFor(input, proposedClasses);
  const dryRunScoreAdjustment = Number(
    approvedMatches.reduce((sum, item) => sum + scoreAdjustmentFor(item.proposedClass), 0).toFixed(4),
  );

  return {
    code: input.code,
    name: input.name,
    originalBucket: input.originalBucket,
    dryRunDecision,
    matchedApprovedConditions,
    appliedProposedClasses,
    originalRawScore: input.rawScore,
    originalNormalizedGateScore: input.normalizedGateScore,
    dryRunScoreAdjustment,
    dryRunExplanation: approvedMatches.length === 0
      ? 'No APPROVED gate reclassification item matched this candidate; live decision unchanged.'
      : `Matched ${approvedMatches.length} APPROVED item(s); dry-run only simulation, live decision unchanged.`,
    executionImpact: 'NONE',
    createLiveOrder: false,
    requiresHumanApproval: true,
  };
}

export function buildGateReclassificationDryRunSummary(
  results: readonly GateReclassificationDryRunResult[],
): GateReclassificationDryRunSummary {
  const byDecision: Record<GateReclassificationDryRunDecision, number> = {
    NO_CHANGE: 0,
    DRY_RUN_RESCUED_TO_PROBING: 0,
    DRY_RUN_RESCUED_TO_WAIT_TRIGGER: 0,
    DRY_RUN_RESCUED_TO_SCORE_ONLY: 0,
    DRY_RUN_RESCUED_TO_EXECUTABLE_SHADOW: 0,
    DRY_RUN_STILL_REJECTED: 0,
  };
  const conditionCounts: Record<string, number> = {};

  for (const result of results) {
    byDecision[result.dryRunDecision] += 1;
    for (const condition of result.matchedApprovedConditions) {
      conditionCounts[condition] = (conditionCounts[condition] ?? 0) + 1;
    }
  }

  return {
    total: results.length,
    byDecision,
    topMatchedConditions: Object.entries(conditionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([condition, count]) => ({ condition, count })),
    executionImpact: 'NONE',
  };
}

export function formatGateReclassificationDryRunSection(
  summary?: GateReclassificationDryRunSummary | null,
): string | null {
  if (!summary || summary.total === 0) return null;

  const lines = [
    '🧪 Gate Reclassification Dry-Run (ADR-458)',
    `  • total rescued/shadow-changed: ${summary.total}`,
    `  • PROBING: ${summary.byDecision.DRY_RUN_RESCUED_TO_PROBING ?? 0}`,
    `  • WAIT_TRIGGER: ${summary.byDecision.DRY_RUN_RESCUED_TO_WAIT_TRIGGER ?? 0}`,
    `  • SCORE_ONLY: ${summary.byDecision.DRY_RUN_RESCUED_TO_SCORE_ONLY ?? 0}`,
    `  • EXECUTABLE_SHADOW: ${summary.byDecision.DRY_RUN_RESCUED_TO_EXECUTABLE_SHADOW ?? 0}`,
    '  • executionImpact: NONE',
  ];

  if (summary.topMatchedConditions.length > 0) {
    lines.push(`  • top approved conditions: ${summary.topMatchedConditions.map((x) => `${x.condition}×${x.count}`).join(', ')}`);
  }

  return lines.join('\n');
}
