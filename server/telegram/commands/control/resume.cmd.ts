// @responsibility resume.cmd 텔레그램 모듈
// @responsibility: /resume — 소프트 일시정지 해제 (다음 cron tick 부터 정상 실행). EMR.
import { getAutoTradePaused, setAutoTradePaused } from '../../../state.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const resume: TelegramCommand = {
  name: '/resume',
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '소프트 일시정지 해제 (다음 cron tick 부터 정상 실행)',
  async execute({ reply }) {
    if (!getAutoTradePaused()) {
      await reply('✅ 이미 실행 중입니다. (일시정지 상태 아님)');
      return;
    }
    setAutoTradePaused(false);
    console.warn('[TelegramBot] /resume — 소프트 일시정지 해제');
    await reply(
      '▶️ <b>[엔진 재개]</b>\n' +
      '다음 cron tick 부터 정상 실행합니다.\n' +
      `자동매매: ${process.env.AUTO_TRADE_ENABLED === 'true' ? '✅ 켜짐' : '❌ 꺼짐 (AUTO_TRADE_ENABLED 확인)'}`,
    );
  },
};

commandRegistry.register(resume);

export default resume;
