// @responsibility Expose current Shadow evidence through Telegram.
import { commandRegistry } from '../../commandRegistry.js';
import { getPaperExperimentView } from '../../../trading/paper/paperExperimentRunner.js';
import { getAutoTradePaused, getTradingMode } from '../../../state.js';
import { toKstDateKey } from '../../../calendar/krxTradingCalendar.js';
import { recentPaperNews } from '../../../alerts/paperBot.js';
import { formatPaperReport, formatPaperResearch, formatPaperBotStatus } from '../../../alerts/paperBotMessages.js';
import { loadPaperBotState } from '../../../persistence/paperBotRepo.js';

const commands = [
  { name: '/paper', description: 'Shadow 관측·가상 매매 현황', render: () => formatPaperReport(getPaperExperimentView(), 'status', toKstDateKey(new Date()), recentPaperNews()) },
  { name: '/paper_research', description: '저장 자료 연구·조건별 검증', render: () => formatPaperResearch(getPaperExperimentView()) },
  { name: '/paper_bot', description: '알림 일정·발송 성공·실패 확인', render: () => formatPaperBotStatus(loadPaperBotState()) },
];
for (const item of commands) commandRegistry.register({ name: item.name, description: item.description, category: 'LRN', visibility: 'MENU', riskLevel: 0,
  execute: async ({ reply }) => {
    const status = `현재 모드 ${getTradingMode()} · 자동 관측 ${getAutoTradePaused() ? '일시정지' : '활성'}\n`;
    await reply(status + item.render());
  },
});
