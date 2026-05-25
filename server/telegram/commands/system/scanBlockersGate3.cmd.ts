// @responsibility Compact Gate3 timing readiness / last-trigger slice from the latest scan_blockers snapshot.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import type { Gate3ConsolidatedAuditSummary, GateLayerAuditSummary } from '../../../trading/signalScanner/scanDiagnostics/gateLayerDiagnostics.js';
import { formatGate3TimingReadinessAuditSection } from '../../../trading/signalScanner/scanDiagnostics/gateLayerDiagnostics.js';
import {
  formatGate3RuntimeClosureCompact,
  formatGate3RuntimeClosureFull,
  type Gate3RuntimeClosureSummary,
} from '../../../quant/gate3RuntimeClosure.js';
import { formatGate3CandidateDetailTable } from '../../../quant/gate3CandidateDetail.js';
import { formatGate3ShadowRoutingAuditSection } from '../../../quant/gate3ShadowPolicy.js';
import { formatGate3OutcomeTrackingSummary } from '../../../quant/gate3OutcomeSeed.js';
import { formatGate3ThresholdEvidenceSection } from '../../../quant/gate3EvidenceScore.js';
import { formatGate3EvidenceWarmupSection } from '../../../quant/gate3EvidenceWarmup.js';
import { formatGate3FinalizationSection } from '../../../quant/gate3CompletionScore.js';
import { buildDiagnosticCommandHint } from '../../renderers/diagnosticButtonBuilder.js';
import { renderGate3Compact } from '../../renderers/gateCompactRenderer.js';
import { buildSnapshotBundleFromScanSummary } from '../../renderers/snapshotBundle.js';

function topKey(counts: Record<string, number> | undefined): string {
  const [top] = Object.entries(counts ?? {})
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  return top ? `${top[0]}:${top[1]}` : 'none';
}

function topLabel(counts: Record<string, number> | undefined): string {
  const [top] = Object.entries(counts ?? {})
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  return top ? top[0] : 'none';
}

type AnyRecord = Record<string, unknown>;

function recordOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

export function formatScanBlockersGate3Section(
  audit: GateLayerAuditSummary | null | undefined,
): string {
  const gate3 = audit?.gate3Consolidated;
  if (!audit || !gate3 || gate3.samples <= 0) {
    return [
      'Gate3 Timing Readiness',
      'evaluated: 0/0',
      'reason=GATE3_CONSOLIDATED_DIAGNOSTIC_NOT_CARRIED',
      'marketSignal=false',
      'shadowLearning=true',
      'counterfactualRecorded=true',
      'executionImpact=NONE',
    ].join('\n');
  }

  return [
    'Gate3 Timing Readiness',
    `evaluated: ${gate3.samples}/${gate3.samples}`,
    `gate3Pass: ${audit.gate3PassCount}`,
    `lastTriggerPass: ${gate3.lastTriggerPassCount}`,
    `lastTriggerFired: ${gate3.lastTriggerFiredCount}`,
    `lastTriggerWait: ${gate3.lastTriggerWaitCount}`,
    `lastTriggerThresholdNotMet: ${gate3.lastTriggerThresholdNotMetCount}`,
    `lastTriggerDataUnavailable: ${gate3.lastTriggerDataUnavailableCount}`,
    `priceFresh: ${topKey(gate3.priceFreshness)}`,
    `priceBreakoutConfirmed: ${gate3.priceBreakoutConfirmedCount}`,
    `priceNearBreakout: ${gate3.priceNearBreakoutCount}`,
    `pricePullbackEntry: ${gate3.pricePullbackEntryCount}`,
    `priceNotConfirmed: ${gate3.priceNotConfirmedCount}`,
    `priceOverextended: ${gate3.priceOverextendedCount}`,
    `volumeConfirmed: ${gate3.volumeConfirmedCount}`,
    `volumePartial: ${gate3.volumePartialCount}`,
    `volumeDryUp: ${gate3.volumeDryUpCount}`,
    `volumeWeak: ${gate3.volumeWeakCount}`,
    `volumeSpikeRisk: ${gate3.volumeSpikeRiskCount}`,
    `entryPriceStaleBlocked: ${gate3.entryPriceStaleCount}`,
    `rrrPass: ${gate3.rrrPassCount}`,
    `rrrWatch: ${gate3.rrrWatchCount}`,
    `rrrFail: ${gate3.rrrFailCount}`,
    `rrrMissing: ${gate3.rrrMissingCount}`,
    `rrrFallbackUsed: ${gate3.rrrFallbackUsedCount}`,
    `falseBreakoutHigh: ${gate3.falseBreakoutHighCount}`,
    `executionReady: ${gate3.executionReadyCount}`,
    `readiness: ${topKey(gate3.timingReadiness)}`,
    `lastTriggerStatus: ${topKey(gate3.lastTriggerStatus)}`,
    `executionImpact: ${topKey(gate3.executionImpact)}`,
    `compactText: ${topLabel(gate3.compactText)}`,
    `candidateDetails: ${gate3.candidateDetails?.length ?? 0}`,
    `shadowEntryAllowed: ${gate3.shadowRouting?.shadowEntryAllowedCount ?? 0}`,
    `nearEntryTracking: ${gate3.shadowRouting?.nearEntryTrackingCount ?? 0}`,
    `counterfactualOnly: ${gate3.shadowRouting?.counterfactualOnlyCount ?? 0}`,
    `diagnosticOnly: ${gate3.shadowRouting?.diagnosticOnlyCount ?? 0}`,
    `watchlistUpgrade: ${gate3.shadowRouting?.watchlistUpgradeCount ?? 0}`,
    `paperOrderAllowed: ${gate3.shadowRouting?.paperOrderAllowedCount ?? 0}`,
    `livePolicyBlocked: ${gate3.shadowRouting?.livePolicyBlockedCount ?? 0}`,
    `outcomeSeedCreatedToday: ${gate3.outcomeTracking?.seedCreatedToday ?? 0}`,
    `outcomePending: ${gate3.outcomeTracking?.pending ?? 0}`,
    `outcomeLabeled: ${gate3.outcomeTracking?.labeled ?? 0}`,
    `outcomeDataInsufficient: ${gate3.outcomeTracking?.dataInsufficient ?? 0}`,
    `outcomeDuplicateSuppressed: ${gate3.outcomeTracking?.duplicateSuppressed ?? 0}`,
    `thresholdEvidenceSampleSize: ${gate3.thresholdEvidence?.sampleSize ?? 0}`,
    `thresholdSuggestions: ${gate3.thresholdEvidence?.suggestions.length ?? 0}`,
    `evidenceWarmupSchedulerHealthy: ${gate3.evidenceWarmup?.schedulerHealthy ?? false}`,
    `evidenceWarmupWarnings: ${gate3.evidenceWarmup?.warnings.join(',') || 'none'}`,
    `completionStatus: ${gate3.completionScore?.status ?? 'N/A'}`,
    `completionScore: ${gate3.completionScore?.score ?? 0}/100`,
    `liveReadinessStatus: ${gate3.liveReadinessScore?.status ?? 'N/A'}`,
    'marketSignal=false',
    'shadowLearning=true',
    'counterfactualRecorded=true',
  ].join('\n');
}

async function replyInChunks(reply: (message: string) => Promise<void>, message: string): Promise<void> {
  const maxLen = 3600;
  if (message.length <= maxLen) {
    await reply(message);
    return;
  }
  let chunk = '';
  for (const line of message.split('\n')) {
    if (chunk.length + line.length + 1 > maxLen) {
      await reply(chunk.trimEnd());
      chunk = '';
    }
    chunk += `${line}\n`;
  }
  if (chunk.trim()) await reply(chunk.trimEnd());
}

const scanBlockersGate3: TelegramCommand = {
  name: '/scan_blockers_gate3',
  aliases: ['/blockers_gate3', '/gate3_blockers', '/gate3_timing'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Gate3 timing readiness / last trigger slice from latest scan blockers',
  usage: '/scan_blockers_gate3',
  async execute({ args, reply }) {
    const summary = getLastScanSummary();
    const summaryRecord = recordOf(summary);
    // ADR-0526 §Decision.5: gate3 정본 = 스캔-시점 View(gate3Consolidated 투영 + candidateGate3Closure).
    // buildGate3RuntimeClosureSummary / buildGate2ConfluenceSummary formatter 측 재실행 제거 → persist 정본 read.
    const runtimeClosure = (summaryRecord?.candidateGate3Closure ?? null) as Gate3RuntimeClosureSummary | null;
    const wantsFull = args.some(arg => ['full', 'detail'].includes(arg.toLowerCase()));
    if (!wantsFull) {
      // compact gate3 는 gateLayerAudit.gate3Consolidated 정본 투영(buildSnapshotBundleFromScanSummary.gate3)을 그대로 쓴다.
      await reply([
        renderGate3Compact(buildSnapshotBundleFromScanSummary(summary)),
        buildDiagnosticCommandHint('gate'),
      ].join('\n'));
      return;
    }
    const audit = summary?.gateLayerAudit;
    const compact = formatScanBlockersGate3Section(audit);
    const runtimeCompact = formatGate3RuntimeClosureCompact(runtimeClosure);
    const runtimeFull = formatGate3RuntimeClosureFull(runtimeClosure);
    const full = formatGate3TimingReadinessAuditSection(audit?.gate3Consolidated as Gate3ConsolidatedAuditSummary | undefined);
    const routing = formatGate3ShadowRoutingAuditSection(audit?.gate3Consolidated?.shadowRouting);
    const outcomes = formatGate3OutcomeTrackingSummary(audit?.gate3Consolidated?.outcomeTracking);
    const thresholdEvidence = formatGate3ThresholdEvidenceSection(audit?.gate3Consolidated?.thresholdEvidence);
    const warmup = formatGate3EvidenceWarmupSection(audit?.gate3Consolidated?.evidenceWarmup);
    const finalization = formatGate3FinalizationSection({
      completionScore: audit?.gate3Consolidated?.completionScore,
      liveReadinessScore: audit?.gate3Consolidated?.liveReadinessScore,
    });
    const details = formatGate3CandidateDetailTable({
      detailsByReadiness: audit?.gate3Consolidated?.detailsByReadiness,
      candidateDetails: audit?.gate3Consolidated?.candidateDetails,
    });
    await replyInChunks(reply, [
      '[scan_blockers_gate3] Gate3 Entry Timing / LastTrigger / Price & Volume Guard',
      `source=${summary ? 'lastScanSummary' : 'none'} executionImpact=NONE`,
      '',
      compact,
      '',
      runtimeCompact,
      ...(runtimeFull ? ['', runtimeFull] : []),
      ...(full ? ['', full] : []),
      ...(routing ? ['', routing] : []),
      ...(outcomes ? ['', outcomes] : []),
      ...(warmup ? ['', warmup] : []),
      ...(thresholdEvidence ? ['', thresholdEvidence] : []),
      ...(finalization ? ['', finalization] : []),
      ...(details ? ['', details] : []),
      '',
      'note: compact diagnostic only; no scan execution, no provider fetch, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(scanBlockersGate3);

export default scanBlockersGate3;
