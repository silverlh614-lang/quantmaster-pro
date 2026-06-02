// @responsibility /gate_threshold_reco — read-only counterfacture_gate gate×regime ROC 임계 권고 조회(operator 검토 전용, live 변경 0).
import {
  buildGateThresholdRecommendationReport,
  formatGateThresholdRecommendationLines,
} from '../../../learning/gateThresholdRecommendation.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const gateThresholdRecommendation: TelegramCommand = {
  name: '/gate_threshold_reco',
  aliases: ['/counterfacture_gate'],
  category: 'SYS',
  visibility: 'HIDDEN',
  riskLevel: 0,
  description: 'counterfacture_gate gate×regime ROC 임계 권고 (operator 검토 전용, liveThresholdAutoChanged=false)',
  async execute({ reply, correlationId }) {
    console.info(`[GATE_THRESHOLD_RECO_QUERY] correlationId=${correlationId ?? 'N/A'} command=/gate_threshold_reco`);
    const report = await buildGateThresholdRecommendationReport();
    const message = formatGateThresholdRecommendationLines(report).join('\n');
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/gate_threshold_reco bytes=${message.length}`);
  },
};

commandRegistry.register(gateThresholdRecommendation);

export default gateThresholdRecommendation;
