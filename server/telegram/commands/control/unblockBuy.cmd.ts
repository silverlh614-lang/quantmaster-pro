// @responsibility unblockBuy.cmd 텔레그램 모듈
// @responsibility: /unblock_buy — 신규 매수 차단(MANUAL_BLOCK_NEW_BUY) 해제 (UI 패널 등가). EMR.
//
// ADR-0194: ADR-0193 (manage-only 대칭 coupling) 후속 — 텔레그램에서도 직접 해제 가능.
// 사용자 5/6 보고 "신규매수차단 해제기능이 구현안된건가?" 의 텔레그램 채널 보강.
//
// 별도 토글 — manage-only 와 독립적으로 blockNewBuy 만 해제. manage-only 도 함께
// 해제하려면 /unmanage_only 사용 (ADR-0193 대칭 coupling 으로 두 가드 동시 해제).
import { getManualBlockNewBuy, setManualBlockNewBuy, getManualManageOnly } from '../../../state.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const unblockBuy: TelegramCommand = {
  name: '/unblock_buy',
  aliases: ['/unblock', '/allow_buy'],
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '신규 매수 차단 해제 (UI EmergencyActionsPanel 등가)',
  async execute({ reply }) {
    const wasBlocked = getManualBlockNewBuy();
    if (!wasBlocked) {
      await reply(
        '✅ <b>이미 신규 매수 허용 상태입니다.</b>\n' +
        `<i>보유만 관리: ${getManualManageOnly() ? '🔒 활성 (자동 차단 가능)' : '✅ 비활성'}</i>`,
      );
      return;
    }
    setManualBlockNewBuy(false);
    console.warn('[TelegramBot] /unblock_buy — 신규 매수 차단 해제 (수동)');
    await reply(
      '🟢 <b>[신규 매수 차단 해제]</b>\n' +
      '신규 매수 재허용 (다음 cron tick 부터 정상 진입).\n' +
      `<i>보유만 관리: ${getManualManageOnly() ? '🔒 여전히 활성 — /unmanage_only 로 함께 해제 가능' : '✅ 비활성'}</i>`,
    );
  },
};

commandRegistry.register(unblockBuy);
