// @responsibility: /learning_history N 명령 — 최근 N일(1~30) 자기학습 이력 mode/verdict/narrative/편향 표.
import { getLearningHistory } from '../../../learning/learningHistorySummary.js';
import { formatLearningHistoryMessage } from '../../../learning/learningHistoryFormatter.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const learningHistory: TelegramCommand = {
  name: '/learning_history',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '최근 N일 자기학습 이력 (1~30, 기본 7)',
  usage: '/learning_history [n=7]',
  async execute({ args, reply }) {
    const raw = Number(args[0]);
    const days = Number.isFinite(raw) && raw >= 1 && raw <= 30 ? Math.floor(raw) : 7;
    try {
      const summary = getLearningHistory(days);
      await reply(formatLearningHistoryMessage(summary));
    } catch (e) {
      console.error('[TelegramBot] /learning_history 실패:', e);
      await reply('❌ 학습 이력 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(learningHistory);

export default learningHistory;
