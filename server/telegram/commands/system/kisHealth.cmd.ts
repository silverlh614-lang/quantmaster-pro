// @responsibility /kis_health — KIS-only rebuild mode raw/normalized/domain diagnostic without legacy providers.

import { buildKisOnlyHealthReport, formatKisOnlyHealthReport } from '../../../diagnostics/kisOnlyHealth.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const kisHealth: TelegramCommand = {
  name: '/kis_health',
  aliases: ['/kis_supply_raw'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KIS-only raw → normalized → domain sample 진단 (legacy provider 미호출)',
  usage: '/kis_health',
  async execute({ reply }) {
    const previousTraceContext = process.env.KIS_TRACE_CONTEXT;
    process.env.KIS_TRACE_CONTEXT = 'kis_health';
    try {
      const report = await buildKisOnlyHealthReport();
      await reply(formatKisOnlyHealthReport(report));
    } catch (err) {
      console.error('[kisHealth.cmd] failed', err);
      await reply('🔴 KIS Only Health 진단 실패 — 서버 로그 확인 필요');
    } finally {
      if (previousTraceContext === undefined) delete process.env.KIS_TRACE_CONTEXT;
      else process.env.KIS_TRACE_CONTEXT = previousTraceContext;
    }
  },
};

commandRegistry.register(kisHealth);
export default kisHealth;
