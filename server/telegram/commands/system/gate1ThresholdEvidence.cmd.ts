// @responsibility /gate1_threshold_evidence — read-only Gate1 Threshold Evidence + maturity status from the ADR-0476 ledger.
import {
  listGate1DryRunObservationRows,
  buildGate1ThresholdEvidenceSummary,
  formatGate1ThresholdEvidenceSection,
} from '../../../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const gate1ThresholdEvidence: TelegramCommand = {
  name: '/gate1_threshold_evidence',
  aliases: ['/gate1_evidence'],
  category: 'SYS',
  visibility: 'HIDDEN',
  riskLevel: 0,
  description: 'Gate1 Threshold Evidence 빠른 조회 (scoreBandTable + 무결성 + maturity scheduler, 조회 전용)',
  async execute({ reply, correlationId }) {
    console.info(`[GATE1_THRESHOLD_EVIDENCE_QUERY] correlationId=${correlationId ?? 'N/A'} command=/gate1_threshold_evidence`);
    const rows = await listGate1DryRunObservationRows();
    // No ledger rows yet ⟹ render the skeleton (INSUFFICIENT_SAMPLE / OBSERVE_MORE, N/A). Read-only.
    const summary = rows.length > 0 ? buildGate1ThresholdEvidenceSummary(rows) : undefined;
    const message = formatGate1ThresholdEvidenceSection(summary);
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/gate1_threshold_evidence bytes=${message.length}`);
  },
};

commandRegistry.register(gate1ThresholdEvidence);

export default gate1ThresholdEvidence;
