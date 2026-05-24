// @responsibility ADR-0523 detail summary renderer for top distributions without full forensic payloads.

import type { SnapshotBundle } from './snapshotBundle.js';

export function renderGateDetailSummary(bundle: SnapshotBundle): string {
  const g1 = bundle.gate1;
  const g2 = bundle.gate2;
  const g3 = bundle.gate3;
  const ex = bundle.execution;
  return [
    '[QMP Gate Detail]',
    `snapshot: ${bundle.sourceSnapshotId}`,
    `session/mode/regime: ${bundle.marketSession} / ${bundle.engineMode} / ${bundle.effectiveRegime}`,
    `G1: evaluated ${g1?.evaluated ?? 0}/${g1?.total ?? 0} pass ${g1?.pass ?? 0} topBlock=${g1?.topBlockReason ?? g1?.mainIssue ?? 'none'}`,
    `G1 coverage: normalized ${g1?.scoreNormalized ?? 0} technical ${g1?.technicalProjected ?? 0} rs ${g1?.rsUsable ?? 0}`,
    `G2: strong ${g2?.passStrong ?? 0} weak ${g2?.passWeak ?? 0} watch ${g2?.watch ?? 0} fail ${g2?.fail ?? 0} data ${g2?.dataIncomplete ?? 0}`,
    `G2 axes: positive=${g2?.topPositiveAxis ?? 'none'} missing=${g2?.topMissingAxis ?? 'none'}`,
    `G3: ready ${g3?.ready ?? 0} wait ${g3?.triggerWait ?? 0} setup ${g3?.setupReady ?? 0} data ${g3?.dataIncomplete ?? 0} fail ${g3?.timingFail ?? 0}`,
    `G3 checks: rrr ${g3?.rrrComputed ?? 0}/${g3?.evaluated ?? 0} price ${g3?.priceConfirmed ?? 0} volumeWeak ${g3?.volumeWeak ?? 0}`,
    `Execution: entryReady ${ex?.entryReady ?? 0} live ${ex?.liveBuyAllowed ?? 0} shadow ${ex?.shadowBuyAllowed ?? 0} observe ${ex?.observeOnly ?? 0}`,
    `TopBlock: ${ex?.topBlockReason ?? 'none'}`,
    `ProviderIssue->MarketSignal: ${ex?.providerIssueConvertedToMarketSignal ?? 0}`,
    `impact: ${bundle.executionImpact}`,
    `learning: ${bundle.shadowLearning ? 'ON' : 'OFF'}`,
    'Full forensic: /gate_full or /scan_blockers full',
  ].join('\n');
}
