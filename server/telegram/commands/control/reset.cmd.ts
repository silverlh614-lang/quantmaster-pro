// @responsibility reset.cmd 텔레그램 모듈
// @responsibility: /reset [pw] — 비상 정지 해제 + 일일 손실 리셋 + circuitBreaker/forcedRegimeDowngrade 동시 해제. EMR.
import { setEmergencyStop, setDailyLoss } from '../../../state.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const reset: TelegramCommand = {
  name: '/reset',
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '비상 정지 해제 + 서킷브레이커/regime 다운그레이드 해제',
  usage: '/reset [pw]',
  async execute({ args, reply }) {
    const secret = process.env.EMERGENCY_RESET_SECRET;
    const provided = args[0] ?? '';
    if (secret && provided !== secret) {
      await reply('❌ 인증 실패 — /reset <비밀번호> 형식으로 입력하세요.');
      return;
    }
    setEmergencyStop(false);
    setDailyLoss(0);
    // 아이디어 7 (Phase 4): 서킷브레이커 상태를 함께 해제하여 재발동 가능.
    const { clearCircuitBreaker, clearForcedRegimeDowngrade } = await import(
      '../../../learning/learningState.js'
    );
    clearCircuitBreaker();
    clearForcedRegimeDowngrade();
    await reply('🟢 <b>비상 정지 해제</b> — 자동매매 재개 (서킷브레이커/다운그레이드 해제)');
  },
};

commandRegistry.register(reset);

export default reset;
