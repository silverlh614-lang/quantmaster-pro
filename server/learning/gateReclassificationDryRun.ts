/**
 * @responsibility ADR-458 Gate Reclassification Dry-Run evidence types.
 *
 * This module is intentionally type/summary-only for ADR-459 consumers. It does not alter
 * live gate configuration, thresholds, entry decisions, or order paths.
 */
import type { GateReclassificationApprovalSource } from './gateReclassificationApprovalPlan.js';
import type { GateConditionProposedClass } from './gateReclassificationProposal.js';

export interface GateReclassificationDryRunRecord {
  id: string;
  approvalItemId: string;
  condition: string;
  source: GateReclassificationApprovalSource;
  proposedClass: GateConditionProposedClass;
  samples: number;
  avgReturnPct: number;
  winRate: number;
  lossRate: number;
  rescuedCount: number;
  horizonDays: 3 | 5 | 10;
  recordedAt: string;
  executionImpact: 'NONE';
}

export function isGateReclassificationDryRunRecord(value: unknown): value is GateReclassificationDryRunRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<GateReclassificationDryRunRecord>;
  return typeof record.id === 'string'
    && typeof record.approvalItemId === 'string'
    && typeof record.condition === 'string'
    && typeof record.source === 'string'
    && typeof record.proposedClass === 'string'
    && typeof record.samples === 'number'
    && typeof record.avgReturnPct === 'number'
    && typeof record.winRate === 'number'
    && typeof record.lossRate === 'number'
    && typeof record.rescuedCount === 'number'
    && (record.horizonDays === 3 || record.horizonDays === 5 || record.horizonDays === 10)
    && typeof record.recordedAt === 'string'
    && record.executionImpact === 'NONE';
}
