// @responsibility: /regime 명령 — 매크로 레짐(MHS·VKOSPI·VIX·USD/KRW·Bear방어) 1메시지 요약.
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const regime: TelegramCommand = {
  name: '/regime',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '매크로 레짐 + MHS + VKOSPI + USD/KRW + Bear방어 현황',
  async execute({ reply }) {
    const macro = loadMacroState();
    if (!macro) {
      await reply('❌ 매크로 상태 데이터 없음');
      return;
    }
    const mhsEmoji = (macro.mhs ?? 0) >= 60 ? '🟢' : (macro.mhs ?? 0) >= 40 ? '🟡' : '🔴';
    const regimeEmoji = macro.regime === 'GREEN' ? '🟢' : macro.regime === 'YELLOW' ? '🟡' : '🔴';
    await reply(
      `🌐 <b>[매크로 레짐 현황]</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${mhsEmoji} MHS: ${macro.mhs ?? 'N/A'}\n` +
      `${regimeEmoji} 레짐: ${macro.regime ?? 'N/A'}\n` +
      `📊 VKOSPI: ${macro.vkospi?.toFixed(1) ?? 'N/A'}\n` +
      `📊 VIX: ${macro.vix?.toFixed(1) ?? 'N/A'}\n` +
      `💱 USD/KRW: ${macro.usdKrw?.toLocaleString() ?? 'N/A'}\n` +
      `📉 MHS추세: ${macro.mhsTrend ?? 'N/A'}\n` +
      `🐻 Bear방어: ${macro.bearDefenseMode ? '🔴 ON' : '🟢 OFF'}\n` +
      `📈 FSS경보: ${macro.fssAlertLevel ?? 'N/A'}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `업데이트: ${macro.updatedAt ? new Date(macro.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : 'N/A'}`,
    );
  },
};

commandRegistry.register(regime);

export default regime;
