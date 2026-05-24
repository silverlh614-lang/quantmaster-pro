// @responsibility ADR-0523 compact learning outcome renderer. Display-only.

import type { LearningOutcomesSummary } from '../../learning/outcomeClosure.js';
import type { LearningSummary, SnapshotBundle } from './snapshotBundle.js';

export function learningSummaryFromOutcomeSummary(summary: LearningOutcomesSummary): LearningSummary {
  return {
    seedsCreated: summary.outcomeSeedsCreated,
    pending: summary.pendingOutcomeCount,
    labeled: summary.labeledOutcomeCount,
    win: 0,
    loss: 0,
    missedWin: summary.missedWinCount,
    avoidedLoss: summary.avoidedLossCount,
    dataInsufficient: summary.dataInsufficientOutcomeCount,
    shadowWins: 0,
    shadowLosses: 0,
    blockedMissed: summary.missedWinCount,
    blockedAvoided: summary.avoidedLossCount,
    topPositive: summary.topPositiveGate2Axis,
    topOverBlock: summary.topOverBlockingReason,
    nextAction: 'wait 10D labels',
  };
}

export function renderLearningCompact(bundle: SnapshotBundle): string {
  const lrn = bundle.learning;
  return [
    '[Learning]',
    `snapshot: ${bundle.sourceSnapshotId}`,
    `seeds: +${lrn?.seedsCreated ?? 0} / pending ${lrn?.pending ?? 0} / labeled ${lrn?.labeled ?? 0}`,
    `labels: WIN ${lrn?.win ?? 0} | LOSS ${lrn?.loss ?? 0} | MISSED ${lrn?.missedWin ?? 0} | AVOIDED ${lrn?.avoidedLoss ?? 0} | DATA ${lrn?.dataInsufficient ?? 0}`,
    `shadow: W${lrn?.shadowWins ?? 0}/L${lrn?.shadowLosses ?? 0}`,
    `blocked: missed ${lrn?.blockedMissed ?? 0} / avoided ${lrn?.blockedAvoided ?? 0}`,
    `topPositive: ${lrn?.topPositive ?? 'none'}`,
    `topOverBlock: ${lrn?.topOverBlock ?? 'none'}`,
    'impact: NONE',
    `learning: ${bundle.shadowLearning ? 'ON' : 'OFF'}`,
    `next: ${lrn?.nextAction ?? 'wait 10D labels'}`,
  ].join('\n');
}
