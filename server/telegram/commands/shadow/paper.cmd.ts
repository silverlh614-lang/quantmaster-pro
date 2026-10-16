// @responsibility Expose current Shadow evidence through Telegram.
import { commandRegistry } from '../../commandRegistry.js';
import { getPaperExperimentView } from '../../../trading/paper/paperExperimentRunner.js';
import { getAutoTradePaused, getTradingMode } from '../../../state.js';
import { toKstDateKey } from '../../../calendar/krxTradingCalendar.js';
import { recentPaperNews } from '../../../alerts/paperBot.js';
import { formatPaperArchivedResearch, formatPaperReport, formatPaperResearch, formatPaperBotStatus } from '../../../alerts/paperBotMessages.js';
import { loadPaperBotState } from '../../../persistence/paperBotRepo.js';
import { formatStoredPaperMorningReport } from '../../../trading/paper/paperMorningRuntime.js';

const commands: Array<{ name: string; description: string; render: () => string | string[] }> = [
  { name: '/paper_recommend', description: '08:30 추천·휴장일 연구·이후 가상 성과', render: () => formatStoredPaperMorningReport() },
  // Daily counts read every saved record, as the scheduled reports do; the 200-row screen limit would drop older entries.
  { name: '/paper', description: 'Shadow 관측·가상 매매 현황', render: () => formatPaperReport(getPaperExperimentView(true, { includeComparisons: false }), 'status', toKstDateKey(new Date()), recentPaperNews()) },
  // The archived study is its own message so the live exit-versus-D5 comparison is never cut at the length limit.
  { name: '/paper_research', description: '저장 자료 연구·조건별 검증', render: () => {
    const view = getPaperExperimentView(true);
    return [formatPaperResearch(view), formatPaperArchivedResearch(view)];
  } },
  { name: '/paper_bot', description: '알림 일정·발송 성공·실패 확인', render: () => formatPaperBotStatus(loadPaperBotState()) },
];
for (const item of commands) commandRegistry.register({ name: item.name, description: item.description, category: 'LRN', visibility: 'MENU', riskLevel: 0,
  execute: async ({ reply }) => {
    const status = `현재 모드 ${getTradingMode()} · 자동 관측 ${getAutoTradePaused() ? '일시정지' : '활성'}\n`;
    const [first, ...rest] = [item.render()].flat();
    await reply(status + first);
    for (const message of rest) await reply(message);
  },
});
