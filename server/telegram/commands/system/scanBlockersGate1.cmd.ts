// @responsibility Compact Gate1 survival / minimum-signal forensic slice from the latest scan_blockers snapshot.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary, type ScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import {
  formatGate1SurvivalAuditSection,
  type Gate1SurvivalAuditSummary,
} from '../../../trading/signalScanner/scanDiagnostics/gateLayerDiagnostics.js';
import { formatGate1MinimumSignalForensicSection } from '../../../trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.js';
import type { Gate1MinimumSignalForensicSummaryAdr0505 } from '../../../trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.js';

function text(value: unknown, fallback = 'UNKNOWN'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'null';
}

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

function sourceSnapshotId(summary: ScanSummary | null | undefined): string {
  return text(summary?.snapshotId ?? summary?.scanEvaluation?.scanId, 'NO_SCAN_SUMMARY');
}

function forensicStatus(forensic: Gate1MinimumSignalForensicSummaryAdr0505 | undefined): string {
  if (!forensic) return 'SUMMARY_FIELD_MISSING';
  if ((forensic.totalCandidates ?? 0) <= 0) return 'BUILDER_NOT_CALLED';
  return 'EMITTED';
}

function formatDominantFailure(forensic: Gate1MinimumSignalForensicSummaryAdr0505 | undefined): string {
  return topLabel(forensic?.dominantFailureDistribution);
}

function formatGate1ForensicCompact(forensic: Gate1MinimumSignalForensicSummaryAdr0505 | undefined): string[] {
  if (!forensic || (forensic.totalCandidates ?? 0) <= 0) {
    return [
      `forensicStatus=${forensicStatus(forensic)}`,
      'evaluationState=NOT_EMITTED',
      'minScore=n/a',
      'dominantFailure=none',
      'nextAction=/scan_blockers gate full',
    ];
  }
  return [
    `forensicStatus=${forensicStatus(forensic)}`,
    `evaluationState=${text(forensic.evaluationState, 'UNKNOWN')}`,
    `diagnosticEvaluated=${numberText(forensic.evaluatedCandidateCount)}/${numberText(forensic.totalCandidates)}`,
    `traceOnly=${numberText(forensic.traceOnlyCandidateCount)}`,
    `failed=${numberText(forensic.failedCandidates)}`,
    `requiredAvg=${numberText(forensic.requiredScoreAvg)}`,
    `actualAvg=${numberText(forensic.actualScoreAvg)}`,
    `avgScoreGap=${numberText(forensic.avgScoreGap)}`,
    `dominantFailure=${formatDominantFailure(forensic)}`,
    `missingPositiveTop=${topLabel(forensic.missingPositiveSourceCounts)}`,
    `penaltyTop=${topLabel(forensic.penaltyCounts)}`,
    `supplyWarningTop=${topLabel(forensic.supplyScopeWarnings)}`,
    `watchlistImported=${numberText(forensic.watchlistScoreImportedCount)}/${numberText(forensic.totalCandidates)}`,
    `watchlistScoreScaleDistributionBefore=${topKey(forensic.watchlistScoreScaleDistributionBefore ?? forensic.watchlistScoreScaleDistribution)}`,
    `watchlistScoreNormalized=${numberText(forensic.watchlistScoreNormalizedCount ?? forensic.watchlistScoreNormalized)}/${numberText(forensic.totalCandidates)}`,
    `watchlistScoreMissing=${numberText(forensic.watchlistScoreMissingCount ?? forensic.watchlistScoreMissing)}`,
    `watchlistScoreScaleFixed=${numberText(forensic.watchlistScoreScaleFixedCount ?? forensic.watchlistScoreScaleFixed)}`,
    `promotionScoreCopied=${numberText(forensic.promotionScoreCopiedCount ?? forensic.promotionScoreCopied)}`,
    `watchlistScoreScaleDistributionAfter=${topKey(forensic.watchlistScoreScaleDistributionAfter)}`,
    `watchlistScoreNormalizationBreakPoint=${topKey(forensic.watchlistScoreNormalizationBreakPoint)}`,
    `rsScoreUsable=${numberText(forensic.rsScoreUsableCount)}/${numberText(forensic.totalCandidates)}`,
    `breakoutScoreUsable=${numberText(forensic.breakoutScoreUsableCount)}/${numberText(forensic.totalCandidates)}`,
    `technicalProjectionCoverage=${topKey(forensic.technicalProjectionCoverage)}`,
    `technicalProjected=${numberText(forensic.technicalProjectedCount)}/${numberText(forensic.totalCandidates)}`,
    `maAlignmentComputed=${numberText(forensic.maAlignmentComputedCount ?? forensic.maAlignmentComputed)}/${numberText(forensic.totalCandidates)}`,
    `aboveMA20Available=${numberText(forensic.aboveMA20AvailableCount)}/${numberText(forensic.totalCandidates)}`,
    `aboveMA60Available=${numberText(forensic.aboveMA60AvailableCount)}/${numberText(forensic.totalCandidates)}`,
    `return5dAvailable=${numberText(forensic.return5dAvailableCount ?? forensic.return5dAvailable)}/${numberText(forensic.totalCandidates)}`,
    `return20dAvailable=${numberText(forensic.return20dAvailableCount ?? forensic.return20dAvailable)}/${numberText(forensic.totalCandidates)}`,
    `technicalComputedButProjectionMissing=${numberText(forensic.technicalComputedButProjectionMissingCount)}`,
    `technicalProjectionBreakPoint=${topKey(forensic.technicalProjectionBreakPoint)}`,
    `maAlignmentPolicy=${text(forensic.maAlignmentPolicy, 'ADVISORY_DAMPENER')}`,
    `maAlignmentDampener=${numberText(forensic.maAlignmentDampenerCount ?? forensic.maAlignmentAdvisoryOnlyCount)}`,
    `maAlignmentHardBlock=${numberText(forensic.maAlignmentHardBlockCount)}`,
    `technicalTrendDeath=${numberText(forensic.technicalTrendDeathCount ?? forensic.technicalTrendDeathHardBlockCount)}`,
    `topGate1BlockReasonAfter=${text(forensic.topGate1BlockReasonAfter, 'TECHNICAL_MA_ALIGNMENT_DAMPENER')}`,
    `rsBreakPointTop=${topKey(forensic.rsBreakPointDistribution)}`,
    `rsComputedFromReturn20d=${numberText(forensic.rsComputedFromReturn20dCount)}`,
    `rsIndexFallbackUsed=${numberText(forensic.rsIndexFallbackUsedCount)}`,
    `rsTraceButScoreMissingBreakPoint=${topKey(forensic.rsTraceButScoreMissingBreakPoint)}`,
    `breakoutAdvisoryOnly=${String(forensic.breakoutAdvisoryOnly === true)}`,
    `breakoutUsedForGate1Block=${String(forensic.breakoutUsedForGate1Block ?? false)}`,
    `supplyMissingNeutralized=${numberText(forensic.supplyMissingNeutralizedCount ?? forensic.supplyMissingNeutralized)}`,
    `supplyMissingExecutionImpact=${text(forensic.supplyMissingExecutionImpact, 'NONE')}`,
    `supplyMissingMarketSignal=${String(forensic.supplyMissingMarketSignal ?? false)}`,
    `supplyRowMissingLearningTag=${numberText(forensic.supplyRowMissingLearningTagCount)}`,
    `supplySemanticAvailable=${numberText(forensic.supplySemanticAvailable)}/${numberText(forensic.totalCandidates)}`,
    `foreignNetBuyAvailable=${numberText(forensic.foreignNetBuyAvailable)}/${numberText(forensic.totalCandidates)}`,
    `institutionalNetBuyAvailable=${numberText(forensic.institutionalNetBuyAvailable)}/${numberText(forensic.totalCandidates)}`,
    `executionImpact=${text(forensic.executionImpact, 'NONE')}`,
    `liveExecutionAllowed=${String(Boolean(forensic.liveExecutionAllowed))}`,
  ];
}

function formatGate1RuntimeCalibrationCompact(forensic: Gate1MinimumSignalForensicSummaryAdr0505 | undefined): string[] {
  if (!forensic || (forensic.totalCandidates ?? 0) <= 0) return [];
  return [
    'Gate1 Runtime Calibration',
    `scoreNormalized: ${numberText(forensic.watchlistScoreNormalizedCount ?? forensic.watchlistScoreNormalized)}/${numberText(forensic.totalCandidates)}`,
    `technicalProjected: ${numberText(forensic.technicalProjectedCount)}/${numberText(forensic.totalCandidates)}`,
    `rsUsable: ${numberText(forensic.rsScoreUsableCount)}/${numberText(forensic.totalCandidates)}`,
    'maAlignmentPolicy: DAMPENER',
    `hardTechnicalDeath: ${numberText(forensic.technicalTrendDeathCount ?? forensic.technicalTrendDeathHardBlockCount)}`,
    `supplyMissingNeutralized: ${numberText(forensic.supplyMissingNeutralizedCount ?? forensic.supplyMissingNeutralized)}`,
    'executionImpact: NONE',
    'shadowLearning: true',
    'counterfactualRecorded: true',
  ];
}

function safeFormatGate1ForensicSection(forensic: Gate1MinimumSignalForensicSummaryAdr0505 | undefined): string | null {
  try {
    return formatGate1MinimumSignalForensicSection(forensic);
  } catch {
    return null;
  }
}

export function formatScanBlockersGate1Section(summary: ScanSummary | null | undefined): string {
  const survival = summary?.gateLayerAudit?.gate1Survival;
  const forensic = summary?.gate1MinimumSignalForensicAdr0505;
  if (!summary) {
    return [
      'Gate1 Survival / Minimum Signal',
      'evaluated: 0/0',
      'reason=SCAN_SUMMARY_NOT_AVAILABLE',
      'marketSignal=false',
      'providerIssue=false',
      'executionImpact=NONE',
      'shadowLearning=true',
      'counterfactualRecorded=true',
    ].join('\n');
  }
  const candidates = summary.candidates ?? forensic?.totalCandidates ?? 0;
  const gate1Pass = summary.gateLayerAudit?.gate1PassCount
    ?? summary.gatePassDistribution?.gate1Pass
    ?? Math.max(0, candidates - (summary.gateMisses ?? 0));
  const evaluated = survival?.samples ?? forensic?.evaluatedCandidateCount ?? candidates;
  const lines = [
    'Gate1 Survival / Minimum Signal',
    `evaluated: ${evaluated}/${candidates}`,
    `sourceSnapshotId=${sourceSnapshotId(summary)}`,
    `gate1Pass: ${gate1Pass}`,
    `topGate1BlockReason: ${summary.gateLayerAudit?.topGate1BlockReasons?.[0]?.reason ?? 'none'}`,
    `survivalSamples: ${survival?.samples ?? 0}`,
    `quoteFreshness: ${topKey(survival?.quoteFreshness)}`,
    `quoteCoverageConfidence: ${topKey(survival?.quoteCoverageConfidence)}`,
    `liquidityFloor: ${topKey(survival?.liquidityStatus)}`,
    `marketSession: ${topKey(survival?.marketSession)}`,
    `shadowMode: ${topKey(survival?.shadowMode)}`,
    `shadowExecutionImpact: ${topKey(survival?.shadowExecutionImpact)}`,
    `consolidatedHealth: ${topKey(survival?.consolidatedHealth)}`,
    `primaryIssue: ${topKey(survival?.consolidatedPrimaryIssue)}`,
    `operatorAction: ${topKey(survival?.consolidatedOperatorAction)}`,
    `consolidatedExecutionImpact: ${topKey(survival?.consolidatedExecutionImpact)}`,
    `compactText: ${topLabel(survival?.consolidatedCompactText)}`,
    `liveBuyBlockedOnly/advisory: ${survival?.liveBuyBlockedCount ?? 0}`,
    `shadowAllowed: ${survival?.shadowAllowedCount ?? 0}`,
    ...formatGate1ForensicCompact(forensic),
    ...formatGate1RuntimeCalibrationCompact(forensic),
    'marketSignal=false',
    'providerIssue=false',
    'executionImpact=NONE',
    'shadowLearning=true',
    'counterfactualRecorded=true',
  ];
  return lines.join('\n');
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

const scanBlockersGate1: TelegramCommand = {
  name: '/scan_blockers_gate1',
  aliases: ['/blockers_gate1', '/gate1_blockers', '/gate1_survival', '/gate1_min_signal'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Gate1 survival / minimum-signal forensic slice from latest scan blockers',
  usage: '/scan_blockers_gate1',
  async execute({ reply }) {
    const summary = getLastScanSummary();
    const compact = formatScanBlockersGate1Section(summary);
    const survival = formatGate1SurvivalAuditSection(summary?.gateLayerAudit?.gate1Survival as Gate1SurvivalAuditSummary | undefined);
    const forensic = safeFormatGate1ForensicSection(summary?.gate1MinimumSignalForensicAdr0505);
    await replyInChunks(reply, [
      '[scan_blockers_gate1] Gate1 Survival / Minimum Signal Forensics',
      `source=${summary ? 'lastScanSummary' : 'none'} executionImpact=NONE`,
      '',
      compact,
      ...(survival ? ['', survival] : []),
      ...(forensic ? ['', forensic] : []),
      '',
      'note: compact diagnostic only; no scan execution, no provider fetch, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(scanBlockersGate1);

export default scanBlockersGate1;
