// @responsibility: /adjust_qty <code> <qty> [memo] — 서버 장부 ↔ 실계좌 수량 drift 보정. fills SSOT 우선, 레거시 캐시 직접수정 fallback.
import {
  loadShadowTrades,
  saveShadowTrades,
  getRemainingQty,
  appendFill,
  appendShadowLog,
  syncPositionCache,
} from '../../../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../../../trading/signalScanner.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const adjustQty: TelegramCommand = {
  name: '/adjust_qty',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '장부 수량 수동 보정 (실계좌 대비 drift 교정 — 청산 아님)',
  usage: '/adjust_qty <code> <qty> [memo]',
  async execute({ args, reply }) {
    const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
    const targetQty = args[1] != null ? Number(args[1]) : NaN;
    const note = args.slice(2).join(' ').trim() || undefined;

    if (!code || code.length !== 6 || !Number.isInteger(targetQty) || targetQty < 0) {
      await reply(
        '❌ 사용법: /adjust_qty &lt;종목코드&gt; &lt;목표수량&gt; [메모]\n' +
        '예: /adjust_qty 005930 5 실계좌 대비 -3주 보정\n' +
        '• 목표수량은 0 이상 정수\n' +
        '• 포지션 종결 아님 — 청산은 /sell',
      );
      return;
    }

    const shadows = loadShadowTrades();
    const target = shadows.find(s => s.stockCode === code && isOpenShadowStatus(s.status));
    if (!target) {
      await reply(`⚠️ ${code} 보유 포지션 없음 — /pos 로 확인`);
      return;
    }

    const beforeFills = getRemainingQty(target);
    const beforeCache = target.quantity;
    const diff = targetQty - beforeFills;
    const hasSsot = (target.fills ?? []).some(f => f.type === 'BUY' && f.status !== 'REVERTED');
    const nowIso = new Date().toISOString();

    if (diff === 0 && beforeCache === targetQty) {
      await reply(`ℹ️ ${escapeHtml(target.stockName)}(${code}) 수량 이미 ${targetQty}주 — 조정 불필요`);
      return;
    }

    let method: string;
    try {
      if (hasSsot) {
        if (diff > 0) {
          appendFill(target, {
            type: 'BUY',
            subType: 'TRANCHE_BUY',
            qty: diff,
            price: target.shadowEntryPrice,
            reason: `수동 수량 보정 +${diff}주${note ? ` — ${note}` : ''}`,
            exitRuleTag: 'MANUAL_ADJUST',
            timestamp: nowIso,
            status: 'CONFIRMED',
          });
        } else if (diff < 0) {
          // pnl 의도적 생략 — 실손익이 아니라 장부 보정이므로 실현 PnL 집계 제외.
          appendFill(target, {
            type: 'SELL',
            subType: 'PARTIAL_TP',
            qty: -diff,
            price: target.shadowEntryPrice,
            reason: `수동 수량 보정 ${diff}주${note ? ` — ${note}` : ''}`,
            exitRuleTag: 'MANUAL_ADJUST',
            timestamp: nowIso,
            status: 'CONFIRMED',
          });
        }
        syncPositionCache(target);
        method = 'fills 보정';
      } else {
        target.quantity = targetQty;
        if ((target.originalQuantity ?? 0) < targetQty) target.originalQuantity = targetQty;
        method = '캐시 직접수정 (레거시 — fills 없음)';
      }

      appendShadowLog({
        event: 'MANUAL_QTY_ADJUST',
        trigger: 'telegram /adjust_qty',
        ...target,
        beforeQty: beforeFills,
        afterQty: targetQty,
        diff,
        note,
      });
      saveShadowTrades(shadows);
    } catch (e) {
      console.error('[TelegramBot] /adjust_qty 실패:', e);
      await reply(`❌ 수량 보정 저장 실패 — 서버 로그를 확인하세요.`);
      return;
    }

    const afterQty = getRemainingQty(target);
    await reply(
      `🔧 <b>[수량 수동 보정]</b> ${escapeHtml(target.stockName)} (${escapeHtml(code)})\n` +
      `이전 잔량: ${beforeFills}주 → 이후: ${afterQty}주 (${diff > 0 ? '+' : ''}${diff}주)\n` +
      `방식: ${method}\n` +
      (note ? `메모: ${escapeHtml(note)}\n` : '') +
      `🏷️ MANUAL_ADJUST — PnL·학습 집계 격리` +
      (targetQty === 0 ? `\nℹ️ 잔량 0 — 보유 목록/보유 종목 수 집계에서 제외됩니다.` : ''),
    );
  },
};

commandRegistry.register(adjustQty);

export default adjustQty;
