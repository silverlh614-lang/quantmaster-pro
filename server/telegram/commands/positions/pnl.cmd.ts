// @responsibility pnl.cmd 텔레그램 모듈
// @responsibility: /pnl — 활성 포지션별 realized + unrealized 분리 표시 (PR-8 fills SSOT 기준).
import { fetchCurrentPrice } from '../../../clients/kisClient.js';
import { getRemainingQty, getTotalRealizedPnl } from '../../../persistence/shadowTradeRepo.js';
import { getShadowTrades } from '../../../orchestrator/tradingOrchestrator.js';
import { isOpenShadowStatus } from '../../../trading/signalScanner.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const pnl: TelegramCommand = {
  name: '/pnl',
  category: 'POS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '실시간 포지션별 손익 (실현 + 미실현 분리)',
  async execute({ reply }) {
    const shadows = getShadowTrades();
    const active = shadows.filter(s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0);
    if (active.length === 0) {
      await reply('📈 활성 포지션 없음');
      return;
    }

    let totalUnrealizedPct = 0;
    let totalRealizedSum = 0;
    let totalUnrealizedSum = 0;
    const lines: string[] = [];
    for (const s of active) {
      const price = await fetchCurrentPrice(s.stockCode).catch(() => null);
      if (!price) {
        lines.push(`• ${escapeHtml(s.stockName)} — 가격 조회 실패`);
        continue;
      }
      const realQty = getRemainingQty(s);
      const originalQty = s.originalQuantity ?? s.quantity ?? realQty;
      const realizedPnl = getTotalRealizedPnl(s);
      const unrealizedPct = ((price - s.shadowEntryPrice) / s.shadowEntryPrice) * 100;
      const unrealizedAmt = (price - s.shadowEntryPrice) * realQty;
      const totalCost = originalQty * s.shadowEntryPrice;
      const totalPnlAmt = realizedPnl + unrealizedAmt;
      const totalPct = totalCost > 0 ? (totalPnlAmt / totalCost) * 100 : 0;

      totalUnrealizedPct += unrealizedPct;
      totalRealizedSum += realizedPnl;
      totalUnrealizedSum += unrealizedAmt;

      const emoji = totalPct >= 0 ? '🟢' : '🔴';
      const targetDist = (((s.targetPrice - price) / price) * 100).toFixed(1);
      const stopDist = (
        ((price - (s.hardStopLoss ?? s.stopLoss)) / (s.hardStopLoss ?? s.stopLoss)) *
        100
      ).toFixed(1);
      const cacheDrift = s.quantity !== realQty ? ` ⚠️ 캐시 ${s.quantity}주 불일치` : '';
      const modeTag = s.mode === 'LIVE' ? '' : '[SHADOW] ';
      const partialSoldQty = originalQty - realQty;

      const realizedLine =
        partialSoldQty > 0
          ? `\n   실현: ${realizedPnl >= 0 ? '+' : ''}${Math.round(realizedPnl).toLocaleString()}원 (${partialSoldQty}주 부분매도 누적)`
          : '';
      lines.push(
        `${emoji} ${modeTag}${escapeHtml(s.stockName)} 총 ${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(1)}%` +
        ` (${totalPnlAmt >= 0 ? '+' : ''}${Math.round(totalPnlAmt).toLocaleString()}원)${cacheDrift}` +
        realizedLine +
        `\n   미실현: ${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(1)}% (잔여 ${realQty}주)` +
        `\n   목표까지 +${targetDist}% | 손절까지 -${stopDist}%`,
      );
    }
    const avgUnrealizedPct = totalUnrealizedPct / active.length;
    const hasShadowPnl = active.some(s => s.mode !== 'LIVE');
    const pnlShadowNote = hasShadowPnl ? '\n⚠️ [SHADOW] 포함 — 실계좌 PnL 아님' : '';
    const totalSum = totalRealizedSum + totalUnrealizedSum;
    await reply(
      `📈 <b>[실시간 PnL] ${active.length}개 포지션</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${lines.join('\n')}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `실현 누계: ${totalRealizedSum >= 0 ? '+' : ''}${Math.round(totalRealizedSum).toLocaleString()}원 | ` +
      `미실현 합계: ${totalUnrealizedSum >= 0 ? '+' : ''}${Math.round(totalUnrealizedSum).toLocaleString()}원\n` +
      `총 손익: ${totalSum >= 0 ? '+' : ''}${Math.round(totalSum).toLocaleString()}원 | ` +
      `평균 미실현률: ${avgUnrealizedPct >= 0 ? '+' : ''}${avgUnrealizedPct.toFixed(2)}%` +
      pnlShadowNote,
    );
  },
};

commandRegistry.register(pnl);

export default pnl;
