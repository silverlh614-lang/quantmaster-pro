/**
 * @responsibility ADR-457 Human-Approved Gate Reclassification Plan — read-only approval queue.
 *
 * ADR-456 제안을 실제 정책 적용 전 운영자 승인/보류/거부 단위로 변환한다.
 * 본 모듈은 실행 설정을 쓰거나 주문/진입 판단 경로를 변경하지 않는다.
 */
import type {
  GateConditionProposedClass,
  GateReclassificationProposalReport,
  GateReclassificationVerdict,
} from './gateReclassificationProposal.js';

export type GateReclassificationApprovalStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'DEFERRED';

export type GateReclassificationRiskLevel =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH';

export type GateReclassificationApprovalSource =
  | 'unavailableConditions'
  | 'thresholdNotMetConditions'
  | 'providerDegradedConditions';

export interface GateReclassificationApprovalItem {
  id: string;
  condition: string;
  source: GateReclassificationApprovalSource;

  currentClass: string;
  proposedClass:
    | 'HARD_BLOCK'
    | 'SOFT_PENALTY'
    | 'WAIT_TRIGGER'
    | 'SCORE_ONLY';

  verdict:
    | 'OVER_STRICT'
    | 'GOOD_DEFENSE'
    | 'MIXED'
    | 'INSUFFICIENT_SAMPLE';

  horizonDays: 3 | 5 | 10;
  samples: number;
  avgReturnPct: number;
  winRate: number;
  lossRate: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';

  riskLevel: GateReclassificationRiskLevel;
  status: GateReclassificationApprovalStatus;

  reason: string;
  expectedEffect: string;
  rollbackPlan: string;

  executionImpact: 'NONE';
  requiresHumanApproval: true;

  createdAt: string;
  updatedAt: string;
}

export interface GateReclassificationApprovalPlan {
  generatedAt: string;
  items: GateReclassificationApprovalItem[];
  pendingCount: number;
  highRiskCount: number;
  operatorMessage: string;
}

export function isGateReclassificationApprovalPlanDisabled(): boolean {
  return process.env.GATE_RECLASSIFICATION_APPROVAL_PLAN_DISABLED === 'true';
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function buildGateReclassificationApprovalId(
  condition: string,
  source: string,
  proposedClass: string,
  horizonDays: number,
): string {
  return [
    condition,
    source,
    proposedClass,
    `${horizonDays}d`,
  ].map(safeIdPart).join('__');
}

function isOverStrictHardToSoft(
  verdict: GateReclassificationVerdict,
  proposedClass: GateConditionProposedClass,
): boolean {
  return verdict === 'OVER_STRICT' && proposedClass === 'SOFT_PENALTY';
}

function riskForProposal(args: {
  currentClass: string;
  proposedClass: GateConditionProposedClass;
  verdict: GateReclassificationVerdict;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}): GateReclassificationRiskLevel {
  if (isOverStrictHardToSoft(args.verdict, args.proposedClass)) return 'HIGH';

  if (args.verdict === 'GOOD_DEFENSE' && args.proposedClass === 'HARD_BLOCK') {
    return args.confidence === 'HIGH' ? 'LOW' : 'MEDIUM';
  }

  if (args.proposedClass === 'WAIT_TRIGGER') return args.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM';
  if (args.proposedClass === 'HARD_BLOCK' || args.currentClass === 'HARD_BLOCK') return 'MEDIUM';

  if (args.confidence === 'HIGH' && (args.proposedClass === 'SCORE_ONLY' || args.proposedClass === 'SOFT_PENALTY')) {
    return 'LOW';
  }

  if (args.confidence === 'MEDIUM' && args.proposedClass === 'SOFT_PENALTY') {
    return 'MEDIUM';
  }

  return args.confidence === 'LOW' ? 'MEDIUM' : 'LOW';
}

function statusForProposal(args: {
  verdict: GateReclassificationVerdict;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}): GateReclassificationApprovalStatus {
  if (args.confidence === 'LOW' || args.verdict === 'INSUFFICIENT_SAMPLE') return 'DEFERRED';
  return 'PENDING_APPROVAL';
}

function expectedEffectForProposal(args: {
  source: GateReclassificationApprovalSource;
  proposedClass: GateConditionProposedClass;
  verdict: GateReclassificationVerdict;
}): string {
  if (args.proposedClass === 'SOFT_PENALTY') {
    if (args.source === 'unavailableConditions' || args.source === 'providerDegradedConditions') {
      return '데이터 결손/공급자 저하 후보를 hard fail처럼 취급하지 않고 confidence downgrade 후보로 분리한다.';
    }
    return '차단 후보를 즉시 실패보다 soft penalty 후보로 분리해 운영자 검토 범위를 좁힌다.';
  }

  if (args.proposedClass === 'WAIT_TRIGGER') {
    return '진입가/거래량/돌파 확인 미달 후보를 실패가 아니라 대기 후보로 보존한다.';
  }

  if (args.proposedClass === 'HARD_BLOCK' && args.verdict === 'GOOD_DEFENSE') {
    return '하락 방어 성과가 관측된 조건을 hard block 유지 후보로 명확히 표시한다.';
  }

  if (args.proposedClass === 'SCORE_ONLY') {
    return 'pass/fail 조건 변경 없이 점수 참고 후보로만 검토하도록 분리한다.';
  }

  return '조건 재분류 후보의 운영 영향과 승인 필요성을 사전에 문서화한다.';
}

function rollbackPlanForProposal(args: {
  source: GateReclassificationApprovalSource;
  proposedClass: GateConditionProposedClass;
}): string {
  if (args.proposedClass === 'WAIT_TRIGGER') {
    return 'WAIT_TRIGGER 분류를 비활성화하고 기존 thresholdNotMet 처리로 복원한다.';
  }

  if (args.proposedClass === 'SOFT_PENALTY') {
    return '해당 조건을 기존 HARD_BLOCK/failed 처리로 되돌리고 DATA_BLOCKED_NEAR_MISS bucket 성과를 재검토한다.';
  }

  if (args.proposedClass === 'SCORE_ONLY') {
    return 'SCORE_ONLY 분류 검토를 철회하고 기존 차단/미충족 진단 bucket으로 되돌린다.';
  }

  if (args.source === 'thresholdNotMetConditions') {
    return 'HARD_BLOCK 유지 결정을 철회하고 기존 thresholdNotMet 관측 자료를 재검토한다.';
  }

  return 'HARD_BLOCK 유지 결정을 철회하고 기존 데이터 차단 진단 자료를 재검토한다.';
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function sourceLabel(source: GateReclassificationApprovalSource): string {
  switch (source) {
    case 'unavailableConditions': return 'unavailable';
    case 'thresholdNotMetConditions': return 'thresholdNotMet';
    case 'providerDegradedConditions': return 'providerDegraded';
    default: return source;
  }
}

function formatEvidence(item: GateReclassificationApprovalItem): string {
  const rate = item.verdict === 'GOOD_DEFENSE'
    ? `lossRate ${pct(item.lossRate)}`
    : `winRate ${pct(item.winRate)}`;
  return `${item.horizonDays}d avg ${item.avgReturnPct >= 0 ? '+' : ''}${item.avgReturnPct.toFixed(1)}%, ${rate}, samples ${item.samples}`;
}

export function buildGateReclassificationApprovalPlan(
  proposalReport: GateReclassificationProposalReport,
): GateReclassificationApprovalPlan {
  const generatedAt = new Date().toISOString();
  const items = proposalReport.proposals.map((proposal): GateReclassificationApprovalItem => {
    const riskLevel = riskForProposal(proposal);
    const status = statusForProposal(proposal);
    return {
      id: buildGateReclassificationApprovalId(
        proposal.condition,
        proposal.source,
        proposal.proposedClass,
        proposal.horizonDays,
      ),
      condition: proposal.condition,
      source: proposal.source,
      currentClass: proposal.currentClass,
      proposedClass: proposal.proposedClass,
      verdict: proposal.verdict,
      horizonDays: proposal.horizonDays,
      samples: proposal.samples,
      avgReturnPct: proposal.avgReturnPct,
      winRate: proposal.winRate,
      lossRate: proposal.lossRate,
      confidence: proposal.confidence,
      riskLevel,
      status,
      reason: proposal.reason,
      expectedEffect: expectedEffectForProposal(proposal),
      rollbackPlan: rollbackPlanForProposal(proposal),
      executionImpact: 'NONE',
      requiresHumanApproval: true,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };
  });

  return {
    generatedAt,
    items,
    pendingCount: items.filter((item) => item.status === 'PENDING_APPROVAL').length,
    highRiskCount: items.filter((item) => item.riskLevel === 'HIGH').length,
    operatorMessage: '이 계획은 설정 변경이 아니다. ADR-458에서 운영자 승인 후 실제 Gate class mapping을 적용한다.',
  };
}

export function formatGateReclassificationApprovalPlan(
  plan: GateReclassificationApprovalPlan,
): string | null {
  if (plan.items.length === 0) return null;

  const lines: string[] = [
    '🧾 Gate Reclassification Approval Plan (ADR-457)',
    '',
    `Pending approval: ${plan.pendingCount}`,
    `High risk: ${plan.highRiskCount}`,
    '',
  ];

  plan.items.forEach((item, index) => {
    lines.push(`${index + 1}) ${item.condition} ${sourceLabel(item.source)}`);
    lines.push(`   proposed: ${item.proposedClass}`);
    lines.push(`   risk: ${item.riskLevel}`);
    lines.push(`   evidence: ${formatEvidence(item)}`);
    lines.push(`   status: ${item.status}`);
    lines.push('   approval: REQUIRED');
    lines.push(`   expectedEffect: ${item.expectedEffect}`);
    lines.push(`   rollbackPlan: ${item.rollbackPlan}`);
    lines.push('');
  });

  lines.push('Operator note:');
  lines.push(`  ${plan.operatorMessage}`);
  lines.push('  executionImpact=NONE · requiresHumanApproval=true · live execution decision unchanged.');

  return lines.join('\n').trimEnd();
}
