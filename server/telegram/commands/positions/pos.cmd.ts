// @responsibility pos.cmd 텔레그램 모듈 (ADR-0504 source-validated SSOT 사용).
/**
 * @responsibility: /pos — 활성 보유 포지션 요약 (모드/상태/잔량/진입가/손절/목표/진입시각).
 *
 * ADR-0504: shadowPositionLedger.getOpenPositions() (5중 가드 — SHADOW_NEAR_BREAKOUT
 * 학습 entry 차단) + buildShadowPositionCardPayload (POSITION_STATUS_CARD) +
 * validatePositionCardPayload (forbidden source 차단) wiring.
 */
import { getRemainingQty } from '../../../persistence/shadowTradeRepo.js';
import { getOpenPositions } from '../../../persistence/shadowPositionLedger.js';
import {
  buildShadowPositionCardPayload,
  validatePositionCardPayload,
} from '../../../alerts/positionCardValidator.js';
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
    // ADR-0504: shadowPositionLedger SSOT (학습 entry 5중 가드 차단)
    const openEntries = getOpenPositions();
    if (openEntries.length === 0) {
      await reply('📋 현재 Shadow 보유 포지션 없음');
      return;
    }

    // ADR-0504: builder + validator (POSITION_STATUS_CARD)
    const payload = await buildShadowPositionCardPayload({
      cardType: 'POSITION_STATUS_CARD',
      positions: openEntries,
    });

    const validation = validatePositionCardPayload(payload);
    if (!validation.ok) {
      console.error('[TelegramPositionCard] /pos invalid payload blocked', {
        error: validation.error,
        details: validation.details,
        mode: payload.mode,
        executionImpact: payload.executionImpact,
      });
      await reply('📋 포지션 데이터 검증 실패 — /health 확인');
      return;
    }

    // 카드 렌더 — payload.positions 기준 (lot-aggregate 결과). 진입가/손절/목표는 trade
    // 본체에서 직접 read (payload 가 currentPrice 만 보유, 기존 메시지 형식 보존).
    const lines = payload.positions.map((p) => {
      const entry = openEntries.find((e) => e.trade.stockCode === p.stockCode);
      const trade = entry?.trade;
      const isShadow = trade?.mode !== 'LIVE';
      const modeMark = isShadow ? '🟡' : '🔴';
      const modeTag = isShadow ? '[SHADOW] ' : '';
      const statusMark = trade?.status === 'PENDING' ? '⏳' : trade?.status === 'ACTIVE' ? '✅' : '◐';
      const realQty = trade ? getRemainingQty(trade) : p.qty;
      const cacheDrift =
        trade && trade.quantity !== realQty
          ? ` <i>⚠️ 캐시 ${trade.quantity}주 불일치 — reconcile 권장</i>`
          : '';
      const entryPrice = trade?.shadowEntryPrice ?? p.avgEntryPrice ?? 0;
      const stopLoss = trade?.hardStopLoss ?? trade?.stopLoss ?? 0;
      const targetPrice = trade?.targetPrice ?? 0;
      const signalTime = trade?.signalTime ?? p.entryDate ?? '';
      return (
        `${modeMark}${statusMark} ${modeTag}<b>${escapeHtml(p.stockName)}</b> (${escapeHtml(p.stockCode)})\n` +
        `   진입: ${entryPrice.toLocaleString()}원 × ${realQty}주${cacheDrift}\n` +
        `   손절: ${stopLoss.toLocaleString()}원 | 목표: ${targetPrice.toLocaleString()}원\n` +
        `   진입시각: ${signalTime ? new Date(signalTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : 'N/A'}`
      );
    });

    const hasShadow = payload.positions.some((p) => {
      const entry = openEntries.find((e) => e.trade.stockCode === p.stockCode);
      return entry?.trade.mode !== 'LIVE';
    });
    const shadowNote = hasShadow
      ? '\n━━━━━━━━━━━━━━━━\n⚠️ 🟡 [SHADOW] 표시 포지션은 가상 — 실계좌 잔고 아님'
      : '';
    await reply(
      `📋 <b>[보유 포지션] ${payload.positions.length}개</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      lines.join('\n━━━━━━━━━━━━━━━━\n') +
      shadowNote,
    );
  },
};

commandRegistry.register(pos);

export default pos;
