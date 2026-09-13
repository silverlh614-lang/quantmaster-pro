// @responsibility 폐기한 레짐 진단 명령을 현재 Shadow 모델로 안내한다.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
const r6Forensic: TelegramCommand = {
  name: '/r6_forensic', aliases: ["/r6f"],
  category: 'SYS', visibility: 'ADMIN', riskLevel: 0,
  description: '폐기한 레짐 기능 안내',
  async execute({ reply }) { await reply("레짐 기반 기능은 폐기되었습니다. 새 모델 현황은 /paper, 학습·연구는 /paper_research에서 확인하세요."); },
};
commandRegistry.register(r6Forensic);
export default r6Forensic;
