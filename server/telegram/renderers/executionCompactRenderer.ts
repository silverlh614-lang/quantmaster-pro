// @responsibility ADR-0523 compact execution permission renderer. Display-only.

import { checkDisplayContradictions, formatDisplayConflict } from './displayContradictionGuard.js';
import type { SnapshotBundle } from './snapshotBundle.js';

export function renderExecutionCompact(bundle: SnapshotBundle): string {
  const conflict = checkDisplayContradictions(bundle);
  if (conflict.displayRenderBlocked) return formatDisplayConflict(conflict);
  const ex = bundle.execution;
  return [
    '[Execution]',
    `snapshot: ${bundle.sourceSnapshotId}`,
    `entryReady: ${ex?.entryReady ?? 0}`,
    `liveBuy: ${ex?.liveBuyAllowed ?? 0}`,
    `shadowBuy: ${ex?.shadowBuyAllowed ?? 0}`,
    `observe: ${ex?.observeOnly ?? 0}`,
    `blocked: ${ex?.blocked ?? 0}`,
    `topBlock: ${ex?.topBlockReason ?? 'none'}`,
    `providerIssue->marketSignal: ${ex?.providerIssueConvertedToMarketSignal ?? 0}`,
    `impact: ${ex?.executionImpact ?? bundle.executionImpact}`,
    `learning: ${bundle.shadowLearning ? 'ON' : 'OFF'}`,
    `next: ${ex?.nextAction ?? 'observe / wait policy'}`,
  ].join('\n');
}
