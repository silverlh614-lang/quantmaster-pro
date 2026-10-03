// @responsibility 폐기한 레짐 명령을 현재 Shadow 관측·연구 명령으로 안내한다.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const regime: TelegramCommand = {
  name: '/regime',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '폐기한 레짐 기능 안내',
  async execute({ reply }) {
    await reply("레짐 기반 기능은 폐기되었습니다. 새 모델 현황은 /paper, 학습·연구는 /paper_research에서 확인하세요.");
  },
};

commandRegistry.register(regime);
