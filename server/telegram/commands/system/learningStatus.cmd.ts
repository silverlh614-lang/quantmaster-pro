// @responsibility: /learning_status 명령 — 직전 nightly reflection 1건 + 편향 + 실험 + suggest 7일 요약.
import { getLearningStatus } from '../../../learning/learningHistorySummary.js';
import { formatLearningStatusMessage } from '../../../learning/learningHistoryFormatter.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const learningStatus: TelegramCommand = {
  name: '/learning_status',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '직전 reflection · 편향 · 실험 제안 · suggest 알림 7일 요약',
  async execute({ reply }) {
    try {
      const snapshot = getLearningStatus();
      await reply(formatLearningStatusMessage(snapshot));
    } catch (e) {
      console.error('[TelegramBot] /learning_status 실패:', e);
      await reply('❌ 학습 상태 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(learningStatus);

export default learningStatus;
