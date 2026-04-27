// @responsibility scan.cmd 텔레그램 모듈
// @responsibility: /scan — 비상 정지 가드 후 장중 강제 스캔 트리거 (runAutoSignalScan). TRD.
import { getEmergencyStop } from '../../../state.js';
import { runAutoSignalScan } from '../../../trading/signalScanner.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const scan: TelegramCommand = {
  name: '/scan',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '장중 강제 스캔 트리거',
  async execute({ reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 비상 정지 상태 — 스캔 불가. /reset 으로 해제 후 재시도.');
      return;
    }
    await reply('🔍 장중 강제 스캔 트리거 중...');
    await runAutoSignalScan().catch(console.error);
    await reply('✅ 강제 스캔 완료');
  },
};

commandRegistry.register(scan);

export default scan;
