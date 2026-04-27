// @responsibility shadow.cmd 텔레그램 모듈
// @responsibility: /shadow — Shadow 월간 성과 (computeShadowMonthlyStats SSOT) + 미체결 모니터링 + STRONG_BUY WIN률.
import {
  computeShadowMonthlyStats,
} from '../../../persistence/shadowTradeRepo.js';
import { fillMonitor } from '../../../trading/fillMonitor.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const shadow: TelegramCommand = {
  name: '/shadow',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Shadow 성과 현황 (이번 달 종결/win/평균/PF/STRONG_BUY)',
  async execute({ reply }) {
    const stats = computeShadowMonthlyStats();
    const pending = fillMonitor
      .getPendingOrders()
      .filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
    const pfStr = stats.profitFactor != null ? stats.profitFactor.toFixed(2) : 'N/A';
    const sampleWarn = stats.sampleSufficient
      ? ''
      : `\n⚠️ 표본 ${stats.totalClosed}건 (< 5) — 통계 신뢰도 낮음`;
    await reply(
      `🎭 <b>[SHADOW] 성과 현황</b>\n` +
      `${stats.month} — 종결 ${stats.totalClosed}건 | 미결 ${stats.openPositions}건\n` +
      `WIN률: ${stats.winRate.toFixed(1)}% | 평균수익: ${stats.avgReturnPct.toFixed(2)}%\n` +
      `복리수익: ${stats.compoundReturnPct.toFixed(2)}% | PF: ${pfStr}\n` +
      `STRONG_BUY WIN: ${stats.strongBuyWinRate.toFixed(1)}%\n` +
      `미체결 모니터링: ${pending.length}건` +
      sampleWarn +
      `\n⚠️ SHADOW 모드 — 실계좌 잔고 아님`,
    );
  },
};

commandRegistry.register(shadow);

export default shadow;
