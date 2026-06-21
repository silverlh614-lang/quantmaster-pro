// @responsibility /promotion_readiness — read-only ADR-0631 Shadow→Live 승격 준비도 진단 조회 (레버별 READY/NOT_READY). 토글·fetch 0.
import {
  listGate1DryRunObservationRows,
  buildGate1ThresholdEvidenceSummary,
} from '../../../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import { buildCounterfactualOutcomeBoard } from '../../../learning/counterfactualOutcomeBoard.js';
import {
  buildPromotionReadinessBoard,
  formatPromotionReadinessSection,
} from '../../../trading/signalScanner/promotionReadinessAdr0631.js';
import { formatGate1FlagShadowEvidenceSection } from '../../../trading/signalScanner/gate1FlagShadowEvidenceAdr0642.js';
import { buildCumulativeGate1FlagShadowEvidenceBoard } from '../../../trading/signalScanner/gate1FlagShadowEvidenceStoreAdr0642.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const promotionReadiness: TelegramCommand = {
  name: '/promotion_readiness',
  category: 'SYS',
  visibility: 'HIDDEN',
  riskLevel: 0,
  description: 'Shadow→Live 승격 준비도 진단 (ADR-0631, 레버별 READY/NOT_READY, 조회 전용)',
  async execute({ reply, correlationId }) {
    console.info(`[PROMOTION_READINESS_QUERY] correlationId=${correlationId ?? 'N/A'} command=/promotion_readiness`);
    const rows = await listGate1DryRunObservationRows();
    // No ledger rows yet ⟹ evidence undefined → 전 레버 DATA_UNAVAILABLE skeleton. Read-only.
    const evidence = rows.length > 0 ? buildGate1ThresholdEvidenceSummary(rows) : undefined;
    const counterfactual = await buildCounterfactualOutcomeBoard({ gate1Rows: rows });
    const board = buildPromotionReadinessBoard({ evidence, counterfactual });
    // ADR-0642 — 5개 default-OFF Gate1 flag shadow 증거 섹션 append (세션 누적 레지스트리 load → render).
    // 관측 전용 read-only — flip 결정은 운영자 승인 필수, force-ON hypothetical 은 실채점 미반영.
    const flagEvidenceBoard = buildCumulativeGate1FlagShadowEvidenceBoard();
    const message =
      formatPromotionReadinessSection(board) +
      '\n' +
      formatGate1FlagShadowEvidenceSection(flagEvidenceBoard);
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/promotion_readiness bytes=${message.length}`);
  },
};

commandRegistry.register(promotionReadiness);

export default promotionReadiness;
