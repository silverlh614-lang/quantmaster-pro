// @responsibility learningLoopHealth.cmd 텔레그램 모듈
// @responsibility: /learning_loop_health 명령 — 자기학습 루프 stateless 진단 7 지표 (ADR-0130).
import {
  collectLearningLoopHealth,
  formatLearningLoopHealthMessage,
} from '../../../learning/learningLoopHealth.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const learningLoopHealth: TelegramCommand = {
  name: '/learning_loop_health',
  aliases: ['/llh'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '자기학습 루프 stateless 진단 7 지표 — narrative 유사도/biasHeatmap 분산/failurePattern 주입/reflectionImpact Phase/tomorrow ↔ narrative 일치/SILENT 비율 (ADR-0130)',
  async execute({ reply }) {
    try {
      const snapshot = collectLearningLoopHealth();
      await reply(formatLearningLoopHealthMessage(snapshot));
    } catch (e) {
      console.error('[TelegramBot] /learning_loop_health 실패:', e);
      await reply('❌ 자기학습 루프 헬스 진단 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(learningLoopHealth);

export default learningLoopHealth;
