// @responsibility learningLoopHealth.cmd 텔레그램 모듈
// @responsibility: /learning_loop_health [N] — 자기학습 루프 stateless 진단 7 지표 (ADR-0130).
import {
  collectLearningLoopHealth,
  formatLearningLoopHealthMessage,
} from '../../../learning/learningLoopHealth.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/** 사용자 인자 N 파싱 — 정수 3~30 외 입력은 undefined (default 7 fallback) */
export function parseWindowDaysArg(args: string[] | undefined): number | undefined {
  if (!args || args.length === 0) return undefined;
  const n = Number(args[0]);
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

const learningLoopHealth: TelegramCommand = {
  name: '/learning_loop_health',
  aliases: ['/llh'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '자기학습 루프 stateless 진단 7 지표 — 인자 N (3~30) 으로 윈도우 조정 가능, default 7. ENV LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD 로 분산 임계 조정 (ADR-0130)',
  usage: '/learning_loop_health [N=7]  — N: 진단 윈도우 일수 (3~30)',
  async execute({ args, reply }) {
    try {
      const windowDays = parseWindowDaysArg(args);
      const snapshot = collectLearningLoopHealth(undefined, { windowDays });
      await reply(formatLearningLoopHealthMessage(snapshot));
    } catch (e) {
      console.error('[TelegramBot] /learning_loop_health 실패:', e);
      await reply('❌ 자기학습 루프 헬스 진단 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(learningLoopHealth);

export default learningLoopHealth;
