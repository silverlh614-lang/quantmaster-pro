// @responsibility: /pos — 활성 포지션 요약 (모드/상태/잔량/진입가/손절/목표/진입시각).
import { getRemainingQty } from '../../../persistence/shadowTradeRepo.js';
import { getShadowTrades } from '../../../orchestrator/tradingOrchestrator.js';
import { isOpenShadowStatus } from '../../../trading/signalScanner.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const pos: TelegramCommand = {
  name: '/pos',
  category: 'POS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '보유 포지션 요약 (모드/잔량/진입가/손절/목표/진입시각)',
  async execute({ reply }) {
    const shadows = getShadowTrades();
    const active = shadows.filter(s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0);
    if (active.length === 0) {
      await reply('📋 보유 포지션 없음');
      return;
    }

    const lines = active.map(s => {
      const isShadow = s.mode !== 'LIVE';
      const mode = isShadow ? '🟡' : '🔴';
      const modeTag = isShadow ? '[SHADOW] ' : '';
      const status = s.status === 'PENDING' ? '⏳' : s.status === 'ACTIVE' ? '✅' : '◐';
      const realQty = getRemainingQty(s);
      const cacheDrift =
        s.quantity !== realQty
          ? ` <i>⚠️ 캐시 ${s.quantity}주 불일치 — reconcile 권장</i>`
          : '';
      return (
        `${mode}${status} ${modeTag}<b>${escapeHtml(s.stockName)}</b> (${escapeHtml(s.stockCode)})\n` +
        `   진입: ${s.shadowEntryPrice.toLocaleString()}원 × ${realQty}주${cacheDrift}\n` +
        `   손절: ${(s.hardStopLoss ?? s.stopLoss).toLocaleString()}원 | 목표: ${s.targetPrice.toLocaleString()}원\n` +
        `   진입시각: ${new Date(s.signalTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
      );
    });
    const hasShadow = active.some(s => s.mode !== 'LIVE');
    const shadowNote = hasShadow
      ? '\n━━━━━━━━━━━━━━━━\n⚠️ 🟡 [SHADOW] 표시 포지션은 가상 — 실계좌 잔고 아님'
      : '';
    await reply(
      `📋 <b>[보유 포지션] ${active.length}개</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      lines.join('\n━━━━━━━━━━━━━━━━\n') +
      shadowNote,
    );
  },
};

commandRegistry.register(pos);

export default pos;
