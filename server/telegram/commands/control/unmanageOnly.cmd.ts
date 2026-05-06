// @responsibility unmanageOnly.cmd 텔레그램 모듈
// @responsibility: /unmanage_only — 보유만 관리 모드 해제 (ADR-0193 대칭 coupling 으로 blockNewBuy 도 동시 해제). EMR.
//
// ADR-0194: ADR-0193 의 대칭 coupling 정책을 텔레그램 채널에 노출.
// 보유만 관리 OFF 시 신규 매수 차단도 함께 해제 (사용자 자연스러운 의도 정합).
//
// ENV `MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED=true` 활성 시 ADR-0193 비활성 →
// 본 명령은 manageOnly 만 해제 (legacy ON-only coupling 동작).
import {
  getManualManageOnly,
  setManualManageOnly,
  getManualBlockNewBuy,
  setManualBlockNewBuy,
} from '../../../state.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const unmanageOnly: TelegramCommand = {
  name: '/unmanage_only',
  aliases: ['/manage_off', '/unmanage'],
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '보유만 관리 모드 해제 (ADR-0193 대칭 coupling — blockNewBuy 도 동시 해제)',
  async execute({ reply }) {
    const wasManageOnly = getManualManageOnly();
    if (!wasManageOnly) {
      await reply(
        '✅ <b>이미 보유만 관리 비활성 상태입니다.</b>\n' +
        `<i>신규 매수 차단: ${getManualBlockNewBuy() ? '🔴 별도 활성 — /unblock_buy 로 해제' : '🟢 비활성'}</i>`,
      );
      return;
    }
    setManualManageOnly(false);
    // ADR-0193 대칭 coupling — engineRouter `/manage-only` 엔드포인트와 동일 정책.
    const symmetricDisabled = process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === 'true';
    if (!symmetricDisabled) {
      setManualBlockNewBuy(false);
    }
    console.warn(
      `[TelegramBot] /unmanage_only — 보유만 관리 해제 ` +
      `(${symmetricDisabled ? 'legacy: blockNewBuy 보존' : 'ADR-0193: blockNewBuy 동시 해제'})`,
    );
    await reply(
      '🟢 <b>[보유만 관리 해제]</b>\n' +
      `보유만 관리: ✅ 비활성\n` +
      `신규 매수 차단: ${getManualBlockNewBuy() ? '🔴 보존 (legacy 모드)' : '✅ 동시 해제 (ADR-0193 대칭 coupling)'}\n` +
      '<i>다음 cron tick 부터 정상 진입.</i>',
    );
  },
};

commandRegistry.register(unmanageOnly);

export default unmanageOnly;
