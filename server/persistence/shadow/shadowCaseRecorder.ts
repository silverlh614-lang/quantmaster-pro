// @responsibility Record shadow persistence failures as learning cases.

import type { LearningImpact } from './shadowPersistenceGateway.js';

export interface ShadowPersistenceCase {
  id: string;
  source: string;
  operation: string;
  reason: string;
  executionImpact: 'NONE';
  learningImpact: LearningImpact;
  createdAt: string;
  queueId?: string;
  details?: Record<string, unknown>;
}

const MAX_CASES = 200;
const cases: ShadowPersistenceCase[] = [];

export function recordShadowPersistenceCase(input: {
  source: string;
  operation: string;
  reason: string;
  learningImpact: LearningImpact;
  queueId?: string;
  details?: Record<string, unknown>;
}): ShadowPersistenceCase {
  const createdAt = new Date().toISOString();
  const item: ShadowPersistenceCase = {
    id: `shadow-persist-${createdAt.replace(/[^0-9]/g, '').slice(0, 14)}-${cases.length + 1}`,
    source: input.source,
    operation: input.operation,
    reason: input.reason,
    executionImpact: 'NONE',
    learningImpact: input.learningImpact,
    createdAt,
    ...(input.queueId ? { queueId: input.queueId } : {}),
    ...(input.details ? { details: input.details } : {}),
  };
  cases.push(item);
  if (cases.length > MAX_CASES) cases.splice(0, cases.length - MAX_CASES);
  return item;
}

export function listShadowPersistenceCases(): ShadowPersistenceCase[] {
  return [...cases];
}

export function formatShadowPersistenceCasesCompact(limit = 5): string {
  const rows = cases.slice(-limit);
  if (rows.length === 0) return 'ShadowPersistenceCases: none';
  return rows.map((row) => [
    `case=${row.id}`,
    `source=${row.source}`,
    `op=${row.operation}`,
    `learningImpact=${row.learningImpact}`,
    row.queueId ? `queueId=${row.queueId}` : undefined,
    `reason=${row.reason}`,
  ].filter(Boolean).join(' ')).join('\n');
}

export function __resetShadowPersistenceCasesForTests(): void {
  cases.splice(0, cases.length);
}
