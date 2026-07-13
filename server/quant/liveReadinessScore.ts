// @responsibility Live readiness scoring with Gate3 completion contribution; no execution.

import type { Gate3CompletionScore } from './gate3CompletionScore.js';

type LiveReadinessStatus = 'LIVE_READY' | 'SHADOW_READY' | 'DIAGNOSTIC_READY' | 'NOT_READY';

export interface LiveReadinessScore {
  score: number;
  status: LiveReadinessStatus;
  components: {
    sourceSnapshotIntegrity: number;
    gate1: number;
    gate2: number;
    sectorAuthority: number;
    supplySemantic: number;
    gate3EntryTiming: number;
    gate3Completion: number;
    shadowEvidence: number;
    policySafety: number;
  };
  liveAllowedByScore: boolean;
  liveBlockedReasons: string[];
  shadowAllowed: boolean;
  counterfactualAllowed: boolean;
}

export interface BuildLiveReadinessScoreInput {
  gate3Completion: Gate3CompletionScore;
  componentScores?: Partial<Record<keyof LiveReadinessScore['components'], number>>;
  policy?: {
    allowsLive?: boolean;
    shadowOnlyMode?: boolean;
    sellOnlyMode?: boolean;
    r6DefenseMode?: boolean;
    brokerLiveOrderAllowed?: boolean | null;
  };
  shadowAllowed?: boolean;
  counterfactualAllowed?: boolean;
}

const WEIGHTS: LiveReadinessScore['components'] = {
  sourceSnapshotIntegrity: 15,
  gate1: 10,
  gate2: 12,
  sectorAuthority: 10,
  supplySemantic: 8,
  gate3EntryTiming: 15,
  gate3Completion: 10,
  shadowEvidence: 10,
  policySafety: 10,
};

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function weighted(weight: number, pct: number): number {
  return Math.round((weight * clampPct(pct)) / 100);
}

function componentPct(input: BuildLiveReadinessScoreInput, key: keyof LiveReadinessScore['components'], fallback: number): number {
  return input.componentScores?.[key] ?? fallback;
}

function checkPct(completion: Gate3CompletionScore, component: string): number {
  const check = completion.checks.find((item) => item.component === component);
  if (!check) return 0;
  const max = component === 'SOURCE_SNAPSHOT_INTEGRITY' ? 6 : component === 'THRESHOLD_EVIDENCE' ? 6 : 10;
  return (check.score / max) * 100;
}

function liveBlockedReasons(input: BuildLiveReadinessScoreInput): string[] {
  const reasons: string[] = [];
  if (input.gate3Completion.status !== 'COMPLETE') reasons.push(`GATE3_${input.gate3Completion.status}`);
  if (input.policy?.shadowOnlyMode === true) reasons.push('SHADOW_ONLY_MODE');
  if (input.policy?.sellOnlyMode === true) reasons.push('SELL_ONLY_MODE');
  if (input.policy?.r6DefenseMode === true) reasons.push('R6_DEFENSE');
  if (input.policy?.allowsLive === false) reasons.push('LIVE_POLICY_BLOCKED');
  if (input.policy?.brokerLiveOrderAllowed === false) reasons.push('BROKER_LIVE_ORDER_BLOCKED');
  return [...new Set(reasons)];
}

export function buildLiveReadinessScore(input: BuildLiveReadinessScoreInput): LiveReadinessScore {
  const policySafetyPct = input.policy?.allowsLive === false
    || input.policy?.shadowOnlyMode === true
    || input.policy?.sellOnlyMode === true
    || input.policy?.r6DefenseMode === true
    || input.policy?.brokerLiveOrderAllowed === false
    ? 60
    : 100;
  const components: LiveReadinessScore['components'] = {
    sourceSnapshotIntegrity: weighted(WEIGHTS.sourceSnapshotIntegrity, componentPct(input, 'sourceSnapshotIntegrity', checkPct(input.gate3Completion, 'SOURCE_SNAPSHOT_INTEGRITY'))),
    gate1: weighted(WEIGHTS.gate1, componentPct(input, 'gate1', 100)),
    gate2: weighted(WEIGHTS.gate2, componentPct(input, 'gate2', 100)),
    sectorAuthority: weighted(WEIGHTS.sectorAuthority, componentPct(input, 'sectorAuthority', 100)),
    supplySemantic: weighted(WEIGHTS.supplySemantic, componentPct(input, 'supplySemantic', 100)),
    gate3EntryTiming: weighted(WEIGHTS.gate3EntryTiming, componentPct(input, 'gate3EntryTiming', input.gate3Completion.evaluatedCount > 0 ? 95 : 0)),
    gate3Completion: weighted(WEIGHTS.gate3Completion, componentPct(input, 'gate3Completion', input.gate3Completion.score)),
    shadowEvidence: weighted(WEIGHTS.shadowEvidence, componentPct(input, 'shadowEvidence', checkPct(input.gate3Completion, 'THRESHOLD_EVIDENCE'))),
    policySafety: weighted(WEIGHTS.policySafety, componentPct(input, 'policySafety', policySafetyPct)),
  };
  const score = Object.values(components).reduce((sum, value) => sum + value, 0);
  const reasons = liveBlockedReasons(input);
  const shadowAllowed = input.shadowAllowed ?? true;
  const counterfactualAllowed = input.counterfactualAllowed ?? true;
  const liveEligibleByScore = score >= 90 && reasons.length === 0;
  const status: LiveReadinessStatus = liveEligibleByScore
    ? 'LIVE_READY'
    : score >= 80 && shadowAllowed
      ? 'SHADOW_READY'
      : score >= 65
        ? 'DIAGNOSTIC_READY'
        : 'NOT_READY';

  return {
    score,
    status,
    components,
    liveAllowedByScore: status === 'LIVE_READY',
    liveBlockedReasons: reasons,
    shadowAllowed,
    counterfactualAllowed,
  };
}
