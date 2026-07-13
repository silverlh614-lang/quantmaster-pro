/**
 * @responsibility ADR-456 Gate Reclassification Proposal Generator — read-only operator proposal layer.
 *
 * Near-Miss Outcome Analytics(ADR-455)의 OVER_STRICT / GOOD_DEFENSE verdict 를 운영자 검토용
 * Gate 조건 재분류 제안으로 변환한다. 본 모듈은 Gate 설정 변경이나 주문/실행 경로 변경을 하지 않는다.
 */
import type {
  NearMissOutcomeAnalyticsReport,
  NearMissOutcomeConditionAnalytics,
  NearMissOutcomeConditionKind,
  NearMissOutcomeStrictnessVerdict,
} from './nearMissOutcomeAnalytics.js';
import type { NearMissOutcomeHorizon } from '../persistence/nearMissOutcomeLedger.js';

export type GateConditionProposedClass =
  | 'HARD_BLOCK'
  | 'SOFT_PENALTY'
  | 'WAIT_TRIGGER'
  | 'SCORE_ONLY';

type GateConditionCurrentClass =
  | 'UNKNOWN'
  | 'HARD_BLOCK'
  | 'SOFT_PENALTY'
  | 'WAIT_TRIGGER'
  | 'SCORE_ONLY';

export type GateReclassificationVerdict =
  | 'OVER_STRICT'
  | 'GOOD_DEFENSE'
  | 'MIXED'
  | 'INSUFFICIENT_SAMPLE';

export interface GateConditionReclassificationProposal {
  condition: string;
  source: NearMissOutcomeConditionKind;
  currentClass: GateConditionCurrentClass;
  proposedClass: GateConditionProposedClass;
  verdict: GateReclassificationVerdict;
  horizonDays: 3 | 5 | 10;
  samples: number;
  avgReturnPct: number;
  winRate: number;
  lossRate: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  executionImpact: 'NONE';
  requiresHumanApproval: true;
}

export interface GateReclassificationProposalReport {
  generatedAt: string;
  proposals: GateConditionReclassificationProposal[];
  topPriority: GateConditionReclassificationProposal[];
  holdList: GateConditionReclassificationProposal[];
  operatorMessage: string;
}

const TOP_PRIORITY_LIMIT = 8;

export function isGateReclassificationProposalDisabled(): boolean {
  return process.env.GATE_RECLASSIFICATION_PROPOSAL_DISABLED === 'true';
}

export function confidenceFromSamples(samples: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (samples >= 30) return 'HIGH';
  if (samples >= 10) return 'MEDIUM';
  return 'LOW';
}

function normalizeVerdict(verdict: NearMissOutcomeStrictnessVerdict): GateReclassificationVerdict {
  switch (verdict) {
    case 'OVER_STRICT_CANDIDATE': return 'OVER_STRICT';
    case 'GOOD_DEFENSE': return 'GOOD_DEFENSE';
    case 'INSUFFICIENT_DATA': return 'INSUFFICIENT_SAMPLE';
    case 'MIXED_OR_NEUTRAL':
    default:
      return 'MIXED';
  }
}

function isWaitTriggerCondition(condition: string): boolean {
  const lower = condition.toLowerCase();
  return lower.includes('entry')
    || lower.includes('pre_breakout')
    || lower.includes('vcp')
    || lower.includes('volume');
}

function proposeClass(stat: NearMissOutcomeConditionAnalytics): GateConditionProposedClass {
  if (stat.verdict === 'GOOD_DEFENSE') return 'HARD_BLOCK';

  if (stat.verdict === 'OVER_STRICT_CANDIDATE') {
    if (stat.kind === 'unavailableConditions' || stat.kind === 'providerDegradedConditions') {
      return 'SOFT_PENALTY';
    }
    if (isWaitTriggerCondition(stat.condition)) return 'WAIT_TRIGGER';
    return 'SCORE_ONLY';
  }

  return 'SCORE_ONLY';
}

function reasonForProposal(proposal: Omit<GateConditionReclassificationProposal, 'reason'>): string {
  if (proposal.verdict === 'GOOD_DEFENSE') {
    return '후보가 관측 기간 이후 하락하는 경향을 보여 hard fail 방어 조건으로 유지할 후보입니다.';
  }
  if (proposal.verdict === 'OVER_STRICT' && proposal.proposedClass === 'SOFT_PENALTY') {
    return '차단/데이터 저하 후보가 이후 상승해 hard fail보다는 confidence downgrade 또는 soft penalty 후보입니다.';
  }
  if (proposal.verdict === 'OVER_STRICT' && proposal.proposedClass === 'WAIT_TRIGGER') {
    return '조건 미충족 후보가 이후 상승해 실패가 아니라 진입/돌파/거래량 확인 대기 조건 후보입니다.';
  }
  if (proposal.verdict === 'OVER_STRICT') {
    return '차단 후보가 이후 상승했지만 hard fail 근거가 약해 pass/fail보다 score-only 반영 후보입니다.';
  }
  if (proposal.verdict === 'INSUFFICIENT_SAMPLE') {
    return '관측 표본이 부족하여 자동 제안 우선순위에서 제외하고 추가 관측이 필요합니다.';
  }
  return '방향성이 혼재되어 hard fail이나 자동 완화보다 score-only 검토 또는 보류가 적절합니다.';
}

function confidenceRank(confidence: GateConditionReclassificationProposal['confidence']): number {
  const ranks: Record<GateConditionReclassificationProposal['confidence'], number> = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
  };
  return ranks[confidence];
}

function priorityRank(proposal: GateConditionReclassificationProposal): number {
  const verdictRank: Record<GateReclassificationVerdict, number> = {
    OVER_STRICT: 0,
    GOOD_DEFENSE: 1,
    MIXED: 2,
    INSUFFICIENT_SAMPLE: 3,
  };
  return verdictRank[proposal.verdict];
}

function buildProposal(stat: NearMissOutcomeConditionAnalytics): GateConditionReclassificationProposal {
  const horizonDays = stat.verdictHorizonDays as NearMissOutcomeHorizon;
  const horizon = stat.horizonStats[horizonDays];
  const samples = horizon.observed;
  const winRate = horizon.winRate;
  const lossRate = samples > 0 ? Number((1 - winRate).toFixed(2)) : 0;
  const partial = {
    condition: stat.condition,
    source: stat.kind,
    currentClass: 'UNKNOWN' as const,
    proposedClass: proposeClass(stat),
    verdict: normalizeVerdict(stat.verdict),
    horizonDays,
    samples,
    avgReturnPct: horizon.avgReturnPct,
    winRate,
    lossRate,
    confidence: confidenceFromSamples(samples),
    executionImpact: 'NONE' as const,
    requiresHumanApproval: true as const,
  };

  return {
    ...partial,
    reason: reasonForProposal(partial),
  };
}

export function buildGateReclassificationProposalReport(
  analyticsReport: NearMissOutcomeAnalyticsReport,
): GateReclassificationProposalReport {
  const proposals = (Object.values(analyticsReport.conditionAnalytics) as NearMissOutcomeConditionAnalytics[][])
    .flatMap((rows) => rows.map(buildProposal))
    .sort((a, b) => priorityRank(a) - priorityRank(b)
      || confidenceRank(a.confidence) - confidenceRank(b.confidence)
      || b.samples - a.samples
      || Math.abs(b.avgReturnPct) - Math.abs(a.avgReturnPct)
      || a.condition.localeCompare(b.condition));

  const holdList = proposals.filter((proposal) =>
    proposal.confidence === 'LOW' || proposal.verdict === 'INSUFFICIENT_SAMPLE',
  );
  const holdSet = new Set(holdList);
  const topPriority = proposals
    .filter((proposal) => !holdSet.has(proposal))
    .slice(0, TOP_PRIORITY_LIMIT);

  return {
    generatedAt: new Date().toISOString(),
    proposals,
    topPriority,
    holdList,
    operatorMessage: '자동 적용 금지. ADR-457에서 운영자 승인 후 실제 Gate 재분류를 검토하세요.',
  };
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function sourceLabel(source: NearMissOutcomeConditionKind): string {
  switch (source) {
    case 'unavailableConditions': return 'unavailable';
    case 'thresholdNotMetConditions': return 'thresholdNotMet';
    case 'providerDegradedConditions': return 'providerDegraded';
    default: return source;
  }
}

function formatEvidence(proposal: GateConditionReclassificationProposal): string {
  const rate = proposal.verdict === 'GOOD_DEFENSE'
    ? `lossRate ${pct(proposal.lossRate)}`
    : `winRate ${pct(proposal.winRate)}`;
  return `${proposal.horizonDays}d avg ${proposal.avgReturnPct >= 0 ? '+' : ''}${proposal.avgReturnPct.toFixed(1)}%, ${rate}, samples ${proposal.samples}`;
}

function formatProposalBullet(proposal: GateConditionReclassificationProposal): string[] {
  return [
    `  • ${proposal.condition} ${sourceLabel(proposal.source)}`,
    `    → proposed: ${proposal.proposedClass}`,
    `    evidence: ${formatEvidence(proposal)}`,
    `    reason: ${proposal.reason}`,
    '    approval: REQUIRED',
  ];
}

export function formatGateReclassificationProposalReport(
  report: GateReclassificationProposalReport,
): string | null {
  if (report.proposals.length === 0) return null;

  const lines: string[] = ['🧭 Gate Reclassification Proposals (ADR-456)', ''];
  if (report.topPriority.length > 0) {
    lines.push('Top proposals:');
    for (const proposal of report.topPriority) {
      lines.push(...formatProposalBullet(proposal));
      lines.push('');
    }
  } else {
    lines.push('Top proposals: NO_SAMPLES');
    lines.push('');
  }

  const goodDefense = report.proposals.filter((proposal) => proposal.verdict === 'GOOD_DEFENSE');
  if (goodDefense.length > 0) {
    lines.push('Good defense:');
    for (const proposal of goodDefense.slice(0, 5)) {
      lines.push(...formatProposalBullet(proposal));
      lines.push('');
    }
  }

  if (report.holdList.length > 0) {
    lines.push(`Hold list: ${report.holdList.length} low-confidence/insufficient-sample proposals require more observations.`);
    lines.push('');
  }

  lines.push('Operator note:');
  lines.push(`  ${report.operatorMessage}`);
  lines.push('  executionImpact=NONE · requiresHumanApproval=true · live execution decision unchanged.');

  return lines.join('\n').trimEnd();
}
