// @responsibility Expose current Shadow evidence through Telegram.
import { commandRegistry } from '../../commandRegistry.js';
import { getPaperExperimentView } from '../../../trading/paper/paperExperimentRunner.js';
import { getAutoTradePaused, getTradingMode } from '../../../state.js';
import { toKstDateKey } from '../../../calendar/krxTradingCalendar.js';
import { recentPaperNews } from '../../../alerts/paperBot.js';
import { formatPaperArchivedResearch, formatPaperReport, formatPaperResearch, formatPaperBotStatus } from '../../../alerts/paperBotMessages.js';
import { loadPaperBotState } from '../../../persistence/paperBotRepo.js';
import { formatStoredPaperMorningReport } from '../../../trading/paper/paperMorningRuntime.js';
import { readVirtualAccount } from '../../../trading/paper/paperAccountRuntime.js';

/** The running commit, as /health shows it, so a merge that never reached the server is visible from /paper. */
function buildLabel(): string {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;
  return sha ? ` · 빌드 ${sha.slice(0, 7)}` : '';
}

/** An unreadable account is left out, and the checklist reports it rather than failing the command. */
function readAccountSafely(now: Date) {
  try { return readVirtualAccount(now); } catch (error) {
    console.warn('[paper.cmd] 가상 계좌 조회 실패:', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

const commands: Array<{ name: string; description: string; render: () => string | string[] }> = [
  { name: '/paper_recommend', description: '08:30 추천·휴장일 연구·이후 가상 성과', render: () => formatStoredPaperMorningReport() },
  // Daily counts read every saved record, as the scheduled reports do; the 200-row screen limit would drop older entries.
  { name: '/paper', description: 'Shadow 관측·가상 매매 현황·운용 점검', render: () => {
    const now = new Date();
    return formatPaperReport(getPaperExperimentView(true, { includeComparisons: false }), 'status', toKstDateKey(now), recentPaperNews(), now, readAccountSafely(now));
  } },
  // The archived study is its own message so the live exit-versus-D5 comparison is never cut at the length limit.
  { name: '/paper_research', description: '저장 자료 연구·조건별 검증', render: () => {
    const now = new Date(), view = getPaperExperimentView(true);
    return [formatPaperResearch(view, now, readAccountSafely(now)), formatPaperArchivedResearch(view)];
  } },
  { name: '/paper_bot', description: '알림 일정·발송 성공·실패 확인', render: () => formatPaperBotStatus(loadPaperBotState()) },
];
for (const item of commands) commandRegistry.register({ name: item.name, description: item.description, category: 'LRN', visibility: 'MENU', riskLevel: 0,
  execute: async ({ reply }) => {
    const status = `현재 모드 ${getTradingMode()} · 자동 관측 ${getAutoTradePaused() ? '일시정지' : '활성'}${buildLabel()}\n`;
    const [first, ...rest] = [item.render()].flat();
    await reply(status + first);
    for (const message of rest) await reply(message);
  },
});
