// @responsibility Compact Gate0 macro / permission guard slice from the latest scan_blockers snapshot.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  buildGate0Decision,
  formatGate0Decision,
  getLastScanSummary,
  type ScanSummary,
} from '../../../trading/signalScanner/scanDiagnostics.js';

function sourceSnapshotId(summary: ScanSummary | null | undefined): string {
  const value = summary?.snapshotId ?? summary?.scanEvaluation?.scanId ?? summary?.macroGateState?.regimeSnapshotId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'NO_SCAN_SUMMARY';
}

export function formatScanBlockersGate0Section(summary: ScanSummary | null | undefined): string {
  const mg = summary?.macroGateState;
  if (!summary || !mg) {
    const decision = buildGate0Decision({
      snapshotId: sourceSnapshotId(summary),
    } as ScanSummary);
    return formatGate0Decision(decision, false);
  }
  return formatGate0Decision(buildGate0Decision(summary));
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

const scanBlockersGate0: TelegramCommand = {
  name: '/scan_blockers_gate0',
  aliases: ['/blockers_gate0', '/gate0_blockers', '/gate0_macro'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Gate0 macro regime / permission guard slice from latest scan blockers',
  usage: '/scan_blockers_gate0',
  async execute({ reply }) {
    const summary = getLastScanSummary();
    await replyInChunks(reply, [
      '[scan_blockers_gate0] Gate0 Macro / Permission Guard',
      `source=${summary ? 'lastScanSummary' : 'none'} executionImpact=NONE`,
      '',
      formatScanBlockersGate0Section(summary),
    ].join('\n'));
  },
};

commandRegistry.register(scanBlockersGate0);

export default scanBlockersGate0;
