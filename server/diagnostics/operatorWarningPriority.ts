// @responsibility Read-only operator warning urgency taxonomy and sorting.

export type OperatorWarningPriorityRank = 1 | 2 | 3 | 4 | 5;

export type OperatorWarningDomain =
  | 'ORDER_POSITION'
  | 'PRICE_DATA'
  | 'SCAN_GATE'
  | 'LEARNING_METRIC'
  | 'PROMOTION_DISPLAY'
  | 'UNKNOWN';

export type OperatorWarningUrgency =
  | 'IMMEDIATE_OPERATOR_REVIEW'
  | 'DATA_TRUST_REVIEW'
  | 'DIAGNOSTIC_REVIEW'
  | 'LEARNING_INTEGRITY_REVIEW'
  | 'AUDIT_OBSERVE';

export interface OperatorWarningInput {
  code: string;
  source?: string;
  detail?: string;
  count?: number;
}

export interface OperatorWarningClassification extends OperatorWarningInput {
  normalizedCode: string;
  priorityRank: OperatorWarningPriorityRank;
  domain: OperatorWarningDomain;
  urgency: OperatorWarningUrgency;
  action: string;
  reason: string;
  executionImpact: 'NONE';
}

interface OperatorWarningDefinition {
  codes: readonly string[];
  priorityRank: OperatorWarningPriorityRank;
  domain: OperatorWarningDomain;
  urgency: OperatorWarningUrgency;
  action: string;
  reason: string;
}

function normalizeWarningCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const WARNING_DEFINITIONS: readonly OperatorWarningDefinition[] = Object.freeze([
  {
    codes: [
      'PENDING_APPROVALS',
      'ONE_DECISION_PENDING_APPROVALS',
      'APPROVAL_QUEUE_WAITING',
    ],
    priorityRank: 1,
    domain: 'ORDER_POSITION',
    urgency: 'IMMEDIATE_OPERATOR_REVIEW',
    action: 'Resolve the approval queue before treating lower-priority WARN items as actionable.',
    reason: 'Pending approvals are closest to order flow and can age into stale execution decisions.',
  },
  {
    codes: [
      'INVALIDATION_WARN',
      'POSITION_INVALIDATION_WARN',
      'STOP_LOSS_APPROACH',
      'LOSS_THRESHOLD',
      'STAGE_ESCALATION',
      'TARGET_REACHED',
    ],
    priorityRank: 1,
    domain: 'ORDER_POSITION',
    urgency: 'IMMEDIATE_OPERATOR_REVIEW',
    action: 'Review the affected position and decide hold, trim, exit, or target handling.',
    reason: 'A position-level invalidation warning can become CRITICAL when one more condition is met.',
  },
  {
    codes: [
      'PORTFOLIO_RISK_PASS_WARN',
      'PORTFOLIO_CORRELATION_WARNING',
      'PORTFOLIO_RISK_WARNING',
    ],
    priorityRank: 1,
    domain: 'ORDER_POSITION',
    urgency: 'IMMEDIATE_OPERATOR_REVIEW',
    action: 'Check portfolio concentration/correlation before allowing additional exposure.',
    reason: 'Portfolio risk warnings may still allow entry, but they are adjacent to sizing and exposure decisions.',
  },
  {
    codes: [
      'ENEMY_CHECKLIST_CAUTION',
      'SHORT_INCREASING',
      'MARGIN_OVERHEAT',
      'WEEKLY_RSI_OVERHEAT',
    ],
    priorityRank: 1,
    domain: 'ORDER_POSITION',
    urgency: 'IMMEDIATE_OPERATOR_REVIEW',
    action: 'Review entry caution flags before approving a new buy candidate.',
    reason: 'Enemy checklist warnings are pre-entry risk signals and should outrank diagnostic-only warnings.',
  },
]);

const FALLBACK_DEFINITION: OperatorWarningDefinition = Object.freeze({
  codes: [],
  priorityRank: 5,
  domain: 'UNKNOWN',
  urgency: 'AUDIT_OBSERVE',
  action: 'Observe and attach a more specific warning code if this item recurs.',
  reason: 'No explicit operator warning priority mapping exists for this code yet.',
});

function findDefinition(normalizedCode: string): OperatorWarningDefinition {
  return WARNING_DEFINITIONS.find((definition) => definition.codes.includes(normalizedCode))
    ?? FALLBACK_DEFINITION;
}

export function classifyOperatorWarning(input: OperatorWarningInput): OperatorWarningClassification {
  const normalizedCode = normalizeWarningCode(input.code);
  const definition = findDefinition(normalizedCode);
  return {
    ...input,
    normalizedCode,
    priorityRank: definition.priorityRank,
    domain: definition.domain,
    urgency: definition.urgency,
    action: definition.action,
    reason: definition.reason,
    executionImpact: 'NONE',
  };
}

export function sortOperatorWarnings(
  warnings: readonly OperatorWarningInput[],
): OperatorWarningClassification[] {
  return warnings
    .map(classifyOperatorWarning)
    .sort((a, b) =>
      a.priorityRank - b.priorityRank
      || (b.count ?? 0) - (a.count ?? 0)
      || a.normalizedCode.localeCompare(b.normalizedCode)
      || (a.source ?? '').localeCompare(b.source ?? ''),
    );
}

export function formatOperatorWarningQueue(warnings: readonly OperatorWarningInput[]): string {
  const sorted = sortOperatorWarnings(warnings);
  if (sorted.length === 0) return 'operatorWarnings=none';
  return sorted
    .map((warning) => [
      `P${warning.priorityRank}`,
      warning.domain,
      warning.normalizedCode,
      warning.count !== undefined ? `count=${warning.count}` : '',
      warning.source ? `source=${warning.source}` : '',
      `urgency=${warning.urgency}`,
      'executionImpact=NONE',
    ].filter(Boolean).join(' / '))
    .join('\n');
}
