// @responsibility 기존 KRX 스캔 명령을 현재 시그널 경로로 연결하고 비상정지와 오류 응답을 유지한다.
import { getEmergencyStop } from '../../../state.js';
import { runAutoSignalScan } from '../../../trading/scanDispatcher.js';
import { composeNowVerdict } from '../../metaCommands.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const krxScan: TelegramCommand = {
  name: '/krx_scan',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '현재 모델의 관측·매매 시그널 수동 스캔',
  async execute({ reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 비상 정지 상태 — 스캔 불가. /reset 으로 해제 후 재시도.');
      return;
    }
    try {
      await runAutoSignalScan();
      await reply(composeNowVerdict());
    } catch (error) {
      await reply(`❌ 스캔 실패: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
    }
  },
};
commandRegistry.register(krxScan);
export default krxScan;
