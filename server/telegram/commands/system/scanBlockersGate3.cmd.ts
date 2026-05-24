// @responsibility Compact Gate3 timing readiness / last-trigger slice from the latest scan_blockers snapshot.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import type { Gate3ConsolidatedAuditSummary, GateLayerAuditSummary } from '../../../trading/signalScanner/scanDiagnostics/gateLayerDiagnostics.js';
import { formatGate3TimingReadinessAuditSection } from '../../../trading/signalScanner/scanDiagnostics/gateLayerDiagnostics.js';

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
    `lastTriggerWait: ${gate3.lastTriggerWaitCount}`,
    `priceFresh: ${topKey(gate3.priceFreshness)}`,
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
  async execute({ reply }) {
    const summary = getLastScanSummary();
    const audit = summary?.gateLayerAudit;
    const compact = formatScanBlockersGate3Section(audit);
    const full = formatGate3TimingReadinessAuditSection(audit?.gate3Consolidated as Gate3ConsolidatedAuditSummary | undefined);
    await replyInChunks(reply, [
      '[scan_blockers_gate3] Gate3 Entry Timing / LastTrigger / Price Guard',
      `source=${summary ? 'lastScanSummary' : 'none'} executionImpact=NONE`,
      '',
      compact,
      ...(full ? ['', full] : []),
      '',
      'note: compact diagnostic only; no scan execution, no provider fetch, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(scanBlockersGate3);

export default scanBlockersGate3;
