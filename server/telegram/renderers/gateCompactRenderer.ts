// @responsibility ADR-0523 compact Gate summary renderers. Display-only, no runtime decisions.

import { checkDisplayContradictions, formatDisplayConflict } from './displayContradictionGuard.js';
import {
  compactNumber,
  formatKst,
  lineCount,
  type SnapshotBundle,
} from './snapshotBundle.js';

function header(bundle: SnapshotBundle, title = '[QMP Gate Summary]'): string[] {
  return [
    title,
    `snapshot: ${bundle.sourceSnapshotId}`,
    `asOf: ${formatKst(bundle.asOf)}`,
    `session/mode/regime: ${bundle.marketSession} / ${bundle.engineMode} / ${bundle.effectiveRegime}`,
    `impact: ${bundle.executionImpact}`,
    `learning: ${bundle.shadowLearning ? 'ON' : 'OFF'}`,
  ];
}

function compactLines(lines: string[], limit = 12): string {
  return lines.slice(0, limit).join('\n');
}

export function renderGateCompactSummary(bundle: SnapshotBundle): string {
  const conflict = checkDisplayContradictions(bundle);
  if (conflict.displayRenderBlocked) return formatDisplayConflict(conflict);
  const g1 = bundle.gate1;
  const g2 = bundle.gate2;
  const g3 = bundle.gate3;
  const ex = bundle.execution;
  const learning = bundle.learning;
  const lines = [
    ...header(bundle),
    `G1 Survival: PASS ${g1?.pass ?? 0}/${g1?.total ?? 0} | main: ${g1?.mainIssue ?? 'none'}`,
    `G2 Growth: STRONG ${g2?.passStrong ?? 0} / WEAK ${g2?.passWeak ?? 0} / WATCH ${g2?.watch ?? 0}`,
    `G3 Timing: READY ${g3?.ready ?? 0} / WAIT ${g3?.triggerWait ?? 0} / DATA ${g3?.dataIncomplete ?? 0}`,
    `Execution: Live ${ex?.liveBuyAllowed ?? 0} / Shadow ${ex?.shadowBuyAllowed ?? 0} / Observe ${ex?.observeOnly ?? 0}`,
    `Learning: seeds +${learning?.seedsCreated ?? 0} / pending ${learning?.pending ?? 0} / labeled ${learning?.labeled ?? 0}`,
    `Next: ${ex?.nextAction ?? g3?.nextAction ?? g2?.nextAction ?? g1?.nextAction ?? 'OBSERVE_3D_THEN_REVIEW'}`,
  ];
  if (lineCount(lines.join('\n')) > 12) return compactLines(lines);
  return lines.join('\n');
}

export function renderGate1Compact(bundle: SnapshotBundle): string {
  const conflict = checkDisplayContradictions(bundle);
  if (conflict.displayRenderBlocked) return formatDisplayConflict(conflict);
  const g1 = bundle.gate1;
  const total = g1?.total ?? 0;
  return [
    '[Gate1 Survival]',
    `snapshot: ${bundle.sourceSnapshotId}`,
    `evaluated: ${g1?.evaluated ?? 0}/${total}`,
    `pass: ${g1?.pass ?? 0}`,
    `avg: ${compactNumber(g1?.averageScore)} / req ${compactNumber(g1?.requiredScore)}`,
    `scoreNormalized: ${g1?.scoreNormalized ?? 0}/${total}`,
    `technicalProjected: ${g1?.technicalProjected ?? 0}/${total}`,
    `rsUsable: ${g1?.rsUsable ?? 0}/${total}`,
    `mainIssue: ${g1?.mainIssue ?? 'none'}`,
    `impact: ${bundle.executionImpact}`,
    `learning: ${bundle.shadowLearning ? 'ON' : 'OFF'}`,
    `next: ${g1?.nextAction ?? 'Gate2 confluence review'}`,
  ].join('\n');
}

export function renderGate2Compact(bundle: SnapshotBundle): string {
  const conflict = checkDisplayContradictions(bundle);
  if (conflict.displayRenderBlocked) return formatDisplayConflict(conflict);
  const g2 = bundle.gate2;
  const evaluated = g2?.evaluated ?? 0;
  return [
    '[Gate2 Growth]',
    `snapshot: ${bundle.sourceSnapshotId}`,
    `evaluated: ${evaluated}`,
    `strong: ${g2?.passStrong ?? 0} / weak: ${g2?.passWeak ?? 0} / watch: ${g2?.watch ?? 0} / fail: ${g2?.fail ?? 0}`,
    `axis: RS ${g2?.rsUsable ?? 0}/${evaluated} | Supply ${g2?.supplyUsable ?? 0}/${evaluated} | Sector ${g2?.sectorUsable ?? 0}/${evaluated} | Tech ${g2?.technicalUsable ?? 0}/${evaluated} | Fund ${g2?.fundamentalUsable ?? 0}/${evaluated}`,
    `topPositive: ${g2?.topPositiveAxis ?? 'none'}`,
    `topMissing: ${g2?.topMissingAxis ?? 'none'}`,
    `impact: ${bundle.executionImpact}`,
    `learning: ${bundle.shadowLearning ? 'ON' : 'OFF'}`,
    `next: ${g2?.nextAction ?? 'Gate3 timing review'}`,
  ].join('\n');
}

export function renderGate3Compact(bundle: SnapshotBundle): string {
  const conflict = checkDisplayContradictions(bundle);
  if (conflict.displayRenderBlocked) return formatDisplayConflict(conflict);
  const g3 = bundle.gate3;
  const evaluated = g3?.evaluated ?? 0;
  return [
    '[Gate3 Timing]',
    `snapshot: ${bundle.sourceSnapshotId}`,
    `evaluated: ${evaluated}`,
    `ready: ${g3?.ready ?? 0} / triggerWait: ${g3?.triggerWait ?? 0} / setupReady: ${g3?.setupReady ?? 0} / dataIncomplete: ${g3?.dataIncomplete ?? 0}`,
    `rrrComputed: ${g3?.rrrComputed ?? 0}/${evaluated}`,
    `lastTrigger: TRIGGERED ${g3?.lastTriggerTriggered ?? 0} / WAIT ${g3?.lastTriggerWait ?? 0}`,
    `price: confirmed ${g3?.priceConfirmed ?? 0}`,
    `volume: weak ${g3?.volumeWeak ?? 0}`,
    `falseBreakout: pass ${g3?.falseBreakoutPass ?? 0} / watch ${g3?.falseBreakoutWatch ?? 0}`,
    `impact: ${bundle.executionImpact}`,
    `learning: ${bundle.shadowLearning ? 'ON' : 'OFF'}`,
    `next: ${g3?.nextAction ?? 'wait trigger / observe 3D'}`,
  ].join('\n');
}
