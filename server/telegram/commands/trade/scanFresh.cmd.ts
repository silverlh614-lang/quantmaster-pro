// @responsibility scanFresh.cmd 텔레그램 모듈
// @responsibility: /scan_fresh — 비상 정지 가드 후 백그라운드 강제 재스캔 (/scan fresh 동일). TRD.
import { getEmergencyStop } from '../../../state.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { replyFreshScanTrigger } from './scan.cmd.js';

const scanFresh: TelegramCommand = {
  name: '/scan_fresh',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '강제 재스캔 (백그라운드·중복 차단) — /scan fresh 와 동일',
  usage: '/scan_fresh',
  async execute({ reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 비상 정지 상태 — 스캔 불가. /reset 으로 해제 후 재시도.');
      return;
    }
    await replyFreshScanTrigger(reply);
  },
};

commandRegistry.register(scanFresh);

export default scanFresh;
