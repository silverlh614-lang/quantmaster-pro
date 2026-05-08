/**
 * @responsibility ADR-459 Approved Gate Reclassification Controlled Shadow-to-Live Rollout.
 *
 * Converts human-approved gate reclassification candidates plus ADR-458 dry-run evidence into
 * an operator-visible rollout state. This layer is diagnostic/advisory only and never mutates
 * live gate configuration or execution paths.
 */
import type { GateReclassificationApprovalItem } from './gateReclassificationApprovalPlan.js';
import type { GateReclassificationDryRunRecord } from './gateReclassificationDryRun.js';

export type GateReclassificationRolloutStage =
  | 'OBSERVE'
  | 'SHADOW_SCORE'
  | 'ADVISORY'
  | 'WEIGHTED'
  | 'GATED'
  | 'CORE';

export type GateReclassificationRolloutStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'REJECTED'
  | 'EXPIRED';

export interface GateReclassificationRolloutItem {
  id: string;

  approvalItemId: string;
  condition: string;
  source:
    | 'unavailableConditions'
    | 'thresholdNotMetConditions'
    | 'providerDegradedConditions';

  proposedClass:
    | 'HARD_BLOCK'
    | 'SOFT_PENALTY'
    | 'WAIT_TRIGGER'
    | 'SCORE_ONLY';

  rolloutStage: GateReclassificationRolloutStage;
  status: GateReclassificationRolloutStatus;

  dryRunEvidence: {
    samples: number;
    avgReturnPct: number;
    winRate: number;
    lossRate: number;
    rescuedCount: number;
    horizonDays: 3 | 5 | 10;
  };

  promotionReason: string;
  demotionReason?: string;

  startedAt: string;
  expiresAt: string;

  executionImpact: 'NONE';
  createLiveOrder: false;
  modifiesCoreGate: false;
  requiresHumanApproval: true;
}

export interface GateReclassificationRolloutPlan {
  generatedAt: string;
  items: GateReclassificationRolloutItem[];
  activeCount: number;
  pausedCount: number;
  maxStage: GateReclassificationRolloutStage;
  operatorMessage: string;
}

export interface GateReclassificationRolloutSummary {
  activeCount: number;
  byStage: Record<GateReclassificationRolloutStage, number>;
  topConditions: Array<{ condition: string; stage: GateReclassificationRolloutStage; count: number }>;
  executionImpact: 'NONE';
}

const STAGE_RANK: Record<GateReclassificationRolloutStage, number> = {
  OBSERVE: 0,
  SHADOW_SCORE: 1,
  ADVISORY: 2,
  WEIGHTED: 3,
  GATED: 4,
  CORE: 5,
};

export function isGateReclassificationRolloutDisabled(): boolean {
  return process.env.GATE_RECLASSIFICATION_ROLLOUT_DISABLED === 'true';
}

export function clampMaxStage(stage: GateReclassificationRolloutStage): GateReclassificationRolloutStage {
  if (stage === 'CORE') return 'GATED';
  return stage;
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function buildGateReclassificationRolloutId(
  approvalItemId: string,
  rolloutStage: GateReclassificationRolloutStage,
): string {
  return `${safeIdPart(approvalItemId)}__${rolloutStage}`;
}

function isoFromNow(now: Date | number | undefined): string {
  return new Date(now ?? Date.now()).toISOString();
}

function expiresAtFromNow(now: Date | number | undefined): string {
  const base = new Date(now ?? Date.now()).getTime();
  return new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();
}

function dryRunEvidenceKey(args: {
  condition: string;
  source: string;
  proposedClass: string;
  horizonDays: number;
}): string {
  return [
    args.condition,
    args.source,
    args.proposedClass,
    `${args.horizonDays}d`,
  ].join('\u0000');
}

function findBestDryRunRecord(
  item: GateReclassificationApprovalItem,
  records: GateReclassificationDryRunRecord[],
): GateReclassificationDryRunRecord | undefined {
  const keyed = records.filter((record) => record.approvalItemId === item.id);
  const fallback = records.filter((record) => dryRunEvidenceKey(record) === dryRunEvidenceKey({
    condition: item.condition,
    source: item.source,
    proposedClass: item.proposedClass,
    horizonDays: item.horizonDays,
  }));
  return [...keyed, ...fallback]
    .sort((a, b) => b.samples - a.samples
      || b.avgReturnPct - a.avgReturnPct
      || b.winRate - a.winRate
      || b.rescuedCount - a.rescuedCount)[0];
}

function rolloutStageForEvidence(record: GateReclassificationDryRunRecord): GateReclassificationRolloutStage | null {
  if (record.samples < 10) return null;
  if (record.avgReturnPct >= 4.0 && record.winRate >= 0.65 && record.samples >= 30) return 'WEIGHTED';
  if (record.avgReturnPct >= 3.0 && record.winRate >= 0.60 && record.samples >= 20) return 'ADVISORY';
  if (record.avgReturnPct >= 2.0 && record.winRate >= 0.55 && record.rescuedCount >= 5) return 'SHADOW_SCORE';
  return null;
}

function promotionReason(stage: GateReclassificationRolloutStage, record: GateReclassificationDryRunRecord): string {
  return `ADR-458 evidence qualifies ${stage}: ${record.samples} samples, avgReturnPct ${record.avgReturnPct.toFixed(1)}%, winRate ${Math.round(record.winRate * 100)}%, rescued ${record.rescuedCount}.`;
}

function maxStage(items: GateReclassificationRolloutItem[]): GateReclassificationRolloutStage {
  return items.reduce<GateReclassificationRolloutStage>((max, item) => (
    STAGE_RANK[item.rolloutStage] > STAGE_RANK[max] ? item.rolloutStage : max
  ), 'OBSERVE');
}

export function buildGateReclassificationRolloutPlan(input: {
  approvalItems: GateReclassificationApprovalItem[];
  dryRunRecords: GateReclassificationDryRunRecord[];
  now?: Date | number;
}): GateReclassificationRolloutPlan {
  const generatedAt = isoFromNow(input.now);

  if (isGateReclassificationRolloutDisabled()) {
    return {
      generatedAt,
      items: [],
      activeCount: 0,
      pausedCount: 0,
      maxStage: 'OBSERVE',
      operatorMessage: 'ADR-459 rollout disabled by GATE_RECLASSIFICATION_ROLLOUT_DISABLED=true. No live behavior changed.',
    };
  }

  const items = input.approvalItems.flatMap((approvalItem): GateReclassificationRolloutItem[] => {
    if (approvalItem.status !== 'APPROVED') return [];
    const record = findBestDryRunRecord(approvalItem, input.dryRunRecords);
    if (!record) return [];

    const rawStage = rolloutStageForEvidence(record);
    if (!rawStage) return [];
    const rolloutStage = clampMaxStage(rawStage);

    return [{
      id: buildGateReclassificationRolloutId(approvalItem.id, rolloutStage),
      approvalItemId: approvalItem.id,
      condition: approvalItem.condition,
      source: approvalItem.source,
      proposedClass: approvalItem.proposedClass,
      rolloutStage,
      status: 'ACTIVE',
      dryRunEvidence: {
        samples: record.samples,
        avgReturnPct: record.avgReturnPct,
        winRate: record.winRate,
        lossRate: record.lossRate,
        rescuedCount: record.rescuedCount,
        horizonDays: record.horizonDays,
      },
      promotionReason: promotionReason(rolloutStage, record),
      startedAt: generatedAt,
      expiresAt: expiresAtFromNow(input.now),
      executionImpact: 'NONE',
      createLiveOrder: false,
      modifiesCoreGate: false,
      requiresHumanApproval: true,
    }];
  });

  return {
    generatedAt,
    items,
    activeCount: items.filter((item) => item.status === 'ACTIVE').length,
    pausedCount: items.filter((item) => item.status === 'PAUSED').length,
    maxStage: maxStage(items),
    operatorMessage: 'ADR-459 controlled rollout is Shadow/Advisory state only. CORE promotion and automatic policy changes are forbidden until a later ADR.',
  };
}

export function summarizeGateReclassificationRollout(
  plan: GateReclassificationRolloutPlan | null,
): GateReclassificationRolloutSummary {
  const byStage: Record<GateReclassificationRolloutStage, number> = {
    OBSERVE: 0,
    SHADOW_SCORE: 0,
    ADVISORY: 0,
    WEIGHTED: 0,
    GATED: 0,
    CORE: 0,
  };

  const conditionCounts = new Map<string, { condition: string; stage: GateReclassificationRolloutStage; count: number }>();
  const activeItems = (plan?.items ?? []).filter((item) => item.status === 'ACTIVE');
  for (const item of activeItems) {
    byStage[item.rolloutStage] += 1;
    const key = `${item.condition}\u0000${item.rolloutStage}`;
    const current = conditionCounts.get(key) ?? { condition: item.condition, stage: item.rolloutStage, count: 0 };
    current.count += 1;
    conditionCounts.set(key, current);
  }

  return {
    activeCount: activeItems.length,
    byStage,
    topConditions: [...conditionCounts.values()]
      .sort((a, b) => b.count - a.count || STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || a.condition.localeCompare(b.condition))
      .slice(0, 5),
    executionImpact: 'NONE',
  };
}

export function formatGateReclassificationRolloutSummary(
  summary: GateReclassificationRolloutSummary,
): string | null {
  if (summary.activeCount === 0) return null;
  const top = summary.topConditions.length > 0
    ? summary.topConditions.map((item) => `${item.condition}→${item.stage}`).join(', ')
    : 'NONE';
  return [
    '🚦 Gate Reclassification Rollout (ADR-459)',
    `  • active: ${summary.activeCount}`,
    `  • SHADOW_SCORE: ${summary.byStage.SHADOW_SCORE}`,
    `  • ADVISORY: ${summary.byStage.ADVISORY}`,
    `  • WEIGHTED: ${summary.byStage.WEIGHTED}`,
    `  • GATED: ${summary.byStage.GATED}`,
    `  • CORE: ${summary.byStage.CORE}`,
    `  • executionImpact: ${summary.executionImpact}`,
    `  • top: ${top}`,
  ].join('\n');
}
