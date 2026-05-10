// @responsibility scanReadiness.cmd — read-only first-scan readiness command.

import {
  buildScanReadinessSummary,
  formatScanReadinessSummary,
} from '../../../diagnostics/scanReadinessSummary.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const scanReadiness: TelegramCommand = {
  name: '/scan_readiness',
  aliases: ['/first_scan', '/first_scan_readiness'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '첫 스캔 준비 상태 요약 — read-only, scanner run 없음',
  usage: '/scan_readiness',
  async execute({ reply }) {
    await reply(formatScanReadinessSummary(buildScanReadinessSummary()));
  },
};

commandRegistry.register(scanReadiness);

export default scanReadiness;
