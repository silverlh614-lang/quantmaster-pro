// @responsibility: /digest_on /digest_off /digest_status — T3 다이제스트 수신 토글 + 현재 상태 조회.
import { isDigestEnabled, setDigestEnabled } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const digestOn: TelegramCommand = {
  name: '/digest_on',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'T3 다이제스트 수신 ON (30분 단위 발송 재개)',
  async execute({ reply }) {
    setDigestEnabled(true);
    await reply('📋 다이제스트 수신 ON — 30분 단위로 요약 발송됩니다.');
  },
};

const digestOff: TelegramCommand = {
  name: '/digest_off',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'T3 다이제스트 수신 OFF (기록은 유지)',
  async execute({ reply }) {
    setDigestEnabled(false);
    await reply(
      '🔕 다이제스트 수신 OFF — T3 알림은 Telegram 으로 발송되지 않습니다.\n' +
      '<i>기록은 계속 쌓이며 /todaylog 로 조회 가능.</i>',
    );
  },
};

const digestStatus: TelegramCommand = {
  name: '/digest_status',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '다이제스트 수신 상태 조회 (ON/OFF)',
  async execute({ reply }) {
    await reply(
      `📋 다이제스트 상태: <b>${isDigestEnabled() ? 'ON' : 'OFF'}</b>\n` +
      `<i>/digest_on · /digest_off 로 토글</i>`,
    );
  },
};

commandRegistry.register(digestOn);
commandRegistry.register(digestOff);
commandRegistry.register(digestStatus);

export { digestOn, digestOff, digestStatus };
