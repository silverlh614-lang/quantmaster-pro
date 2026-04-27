// @responsibility report.cmd 텔레그램 모듈
// @responsibility: /report — 일일 리포트 즉시 생성 + 이메일 발송 (generateDailyReport). TRD (read-only).
import { generateDailyReport } from '../../../alerts/reportGenerator.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const report: TelegramCommand = {
  name: '/report',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '일일 리포트 생성 + 이메일 발송',
  async execute({ reply }) {
    await reply('📄 일일 리포트 생성 중...');
    await generateDailyReport().catch(console.error);
    await reply('✅ 리포트 이메일 발송 완료');
  },
};

commandRegistry.register(report);

export default report;
