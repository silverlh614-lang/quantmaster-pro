// @responsibility ADR-0480 /operator_actions diagnostic command.
/**
 * ADR-0480 Operator Action Queue — read-only remediation guidance.
 * No provider fetches, no order imports, no Gate/Kelly/requiredScore mutation.
 */
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import {
  collectOperatorActionSourcesFromScanSummaryAdr0480,
  formatOperatorActionDetailAdr0480,
  safeBuildOperatorActionQueueAdr0480,
} from '../../../trading/signalScanner/operatorActionRouterAdr0480.js';

const operatorActions: TelegramCommand = {
  name: '/operator_actions',
  aliases: ['/actions', '/remediation_queue'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'ADR-0480 operator remediation queue (diagnostic-only)',
  usage: '/operator_actions',
  async execute({ reply }) {
    try {
      const report = safeBuildOperatorActionQueueAdr0480({
        sources: collectOperatorActionSourcesFromScanSummaryAdr0480(getLastScanSummary()),
      });
      await reply(formatOperatorActionDetailAdr0480(report));
    } catch (error) {
      console.warn('[operator_actions] ADR-0480 command failed:', error);
      await reply('🛠 Operator Action Queue (ADR-0480)\n- No open P0/P1 actions. Continue observation.\n- executionImpact=NONE\n- liveExecutionAllowed=false');
    }
  },
};

commandRegistry.register(operatorActions);
