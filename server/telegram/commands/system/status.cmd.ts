// @responsibility: /status 명령 — 모드·비상정지·MHS·활성 포지션·오늘 결산을 1메시지 요약.
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { getRemainingQty } from '../../../persistence/shadowTradeRepo.js';
import { getShadowTrades } from '../../../orchestrator/tradingOrchestrator.js';
import { getEmergencyStop } from '../../../state.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const status: TelegramCommand = {
  name: '/status',
  category: 'SYS',
  visibility: 'MENU',
  riskLevel: 0,
  description: '시스템 현황 요약 (모드/비상정지/MHS/활성 포지션/오늘 결산)',
  async execute({ reply }) {
    const macro = loadMacroState();
    const shadows = getShadowTrades();
    const active = shadows.filter(s => {
      const st = (s as { status?: string }).status;
      const open =
        st === 'PENDING' ||
        st === 'ORDER_SUBMITTED' ||
        st === 'PARTIALLY_FILLED' ||
        st === 'ACTIVE' ||
        st === 'EUPHORIA_PARTIAL';
      return open && getRemainingQty(s) > 0;
    });
    const today = new Date().toISOString().split('T')[0];
    const closed = shadows.filter(s => {
      const r = s as { status?: string; signalTime?: string };
      return (r.status === 'HIT_TARGET' || r.status === 'HIT_STOP') && r.signalTime?.startsWith(today);
    });
    const pnl = closed.reduce(
      (sum, s) => sum + ((s as { returnPct?: number }).returnPct ?? 0),
      0,
    );
    await reply(
      `📊 <b>[시스템 현황]</b>\n` +
      `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? '🟡 [SHADOW]' : '🔴 LIVE'}\n` +
      `비상정지: ${getEmergencyStop() ? '🔴 ON' : '🟢 OFF'}\n` +
      `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})\n` +
      `활성 포지션: ${active.length}개\n` +
      `오늘 결산: ${closed.length}건 (P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%)`,
    );
  },
};

commandRegistry.register(status);

export default status;
