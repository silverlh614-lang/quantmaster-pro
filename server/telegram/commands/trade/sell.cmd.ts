// @responsibility: /sell <code> [reason] [memo] — LIVE 포지션 전량 시장가 매도 + MANUAL_EXIT 학습 격리. SHADOW 봉쇄.
import {
  loadShadowTrades,
  saveShadowTrades,
  getRemainingQty,
  appendFill,
  appendShadowLog,
  updateShadow,
} from '../../../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../../../trading/signalScanner.js';
import { fetchCurrentPrice, placeKisSellOrder } from '../../../clients/kisClient.js';
import { getRealtimePrice } from '../../../clients/kisStreamClient.js';
import { buildManualExitContext } from '../../../trading/manualExitContext.js';
import { appendManualExit } from '../../../persistence/manualExitsRepo.js';
import { evaluateAndAlertManualOverride } from '../../../alerts/manualOverrideMonitor.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const sell: TelegramCommand = {
  name: '/sell',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '포지션 전량 시장가 매도 (LIVE 만 — SHADOW 는 자동 규칙 평가만)',
  usage: '/sell <code> [news|panic|correction|other] [memo]',
  async execute({ args, reply }) {
    const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
    if (!code || code.length !== 6) {
      await reply(
        '❌ 사용법: /sell 005930 [사유] [메모]\n' +
        '사유: news | panic | correction | other (기본 other)\n' +
        '예: /sell 005930 news 실적 쇼크 확인',
      );
      return;
    }

    const shadows = loadShadowTrades();
    const target = shadows.find(s => s.stockCode === code && isOpenShadowStatus(s.status));
    if (!target) {
      await reply(`⚠️ ${code} 보유 포지션 없음 — /pos 로 현재 포지션을 확인하세요.`);
      return;
    }

    // SHADOW 봉쇄 — 30건 검증 순도 보장 (학습 데이터 오염 차단).
    if (target.mode === 'SHADOW') {
      await reply(
        `🛡️ <b>[SHADOW] 수동 청산 차단</b> ${escapeHtml(target.stockName)}(${escapeHtml(code)})\n` +
        `이 포지션은 SHADOW 모드입니다 — 자동 규칙 평가만 허용됩니다.\n` +
        `(30건 검증 순도 보장 위해 SHADOW /sell 은 봉쇄됩니다)\n` +
        `⚠️ SHADOW 모드 — 실계좌 잔고 아님`,
      );
      return;
    }

    const qty = getRemainingQty(target);
    if (qty <= 0) {
      await reply(`⚠️ ${escapeHtml(target.stockName)}(${code}) 잔여 수량이 0입니다.`);
      return;
    }

    const reasonArg = (args[1] ?? '').toLowerCase();
    const reasonCode: 'USER_NEWS' | 'USER_PANIC' | 'USER_CORRECTION' | 'USER_OTHER' =
      reasonArg === 'news'
        ? 'USER_NEWS'
        : reasonArg === 'panic'
          ? 'USER_PANIC'
          : reasonArg === 'correction'
            ? 'USER_CORRECTION'
            : 'USER_OTHER';
    const userNote = args.slice(2).join(' ').trim() || undefined;

    await reply(
      `🛒 <b>[수동 청산 요청]</b>\n` +
      `종목: ${escapeHtml(target.stockName)} (${escapeHtml(code)})\n` +
      `진입: ${target.shadowEntryPrice.toLocaleString()}원 × ${qty}주\n` +
      `사유: ${reasonCode}\n` +
      `현재가 조회 중...`,
    );

    const rtPrice = getRealtimePrice(code);
    const currentPrice = rtPrice ?? (await fetchCurrentPrice(code).catch(() => null));
    if (!currentPrice || currentPrice <= 0) {
      await reply(`❌ ${code} 현재가 조회 실패 — 매도 중단. KIS 토큰/네트워크 상태를 확인하세요.`);
      return;
    }
    const returnPct = ((currentPrice - target.shadowEntryPrice) / target.shadowEntryPrice) * 100;

    const nowIso = new Date().toISOString();
    const sellRes = await placeKisSellOrder(
      target.stockCode,
      target.stockName,
      qty,
      'STOP_LOSS',
    ).catch(err => {
      console.error('[TelegramBot] /sell placeKisSellOrder 실패:', err);
      return { ordNo: null, placed: false };
    });

    const pnl = (currentPrice - target.shadowEntryPrice) * qty;
    const manualExitContext = buildManualExitContext({
      target,
      currentPrice,
      reasonCode,
      userNote,
      nowIso,
      activeRule: target.exitRuleTag,
    });
    try {
      appendFill(target, {
        type: 'SELL',
        subType: 'STOP_LOSS',
        qty,
        price: currentPrice,
        pnl,
        pnlPct: returnPct,
        reason: `수동 청산 (/sell ${reasonCode})`,
        exitRuleTag: 'MANUAL_EXIT',
        timestamp: nowIso,
        ordNo: sellRes.ordNo ?? undefined,
      });
      updateShadow(target, {
        status: 'HIT_STOP',
        exitPrice: currentPrice,
        exitTime: nowIso,
        exitRuleTag: 'MANUAL_EXIT',
        quantity: 0,
        manualExitContext,
      });
      appendShadowLog({
        event: 'MANUAL_SELL',
        trigger: 'telegram /sell',
        reasonCode,
        ...target,
        soldQty: qty,
        exitPrice: currentPrice,
        returnPct,
        ordNo: sellRes.ordNo,
      });
      saveShadowTrades(shadows);
      appendManualExit({
        tradeId: target.id,
        stockCode: target.stockCode,
        stockName: target.stockName,
        exitPrice: currentPrice,
        returnPct,
        context: manualExitContext,
      });
    } catch (e) {
      console.error('[TelegramBot] /sell shadow 상태 업데이트 실패:', e);
    }

    // P2 #17 — 수동 개입 빈도 평가 + 3/5/7회 임계 도달 시 Telegram 경보.
    evaluateAndAlertManualOverride().catch(e =>
      console.error('[TelegramBot] manualOverrideMonitor 실패:', e instanceof Error ? e.message : e),
    );

    const modeLabel = sellRes.placed ? '🔴 LIVE 매도 접수' : '🟡 [SHADOW] 청산 기록';
    const bias = manualExitContext.biasAssessment;
    const shadowSuffix = sellRes.placed ? '' : '\n⚠️ SHADOW 모드 — 실계좌 잔고 아님';
    await reply(
      `✅ <b>[수동 청산 완료]</b> ${modeLabel}\n` +
      `종목: ${escapeHtml(target.stockName)} (${escapeHtml(code)})\n` +
      `사유: ${reasonCode}\n` +
      `수량: ${qty}주\n` +
      `현재가: ${currentPrice.toLocaleString()}원\n` +
      `손익: ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}% ` +
      `(${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()}원)\n` +
      `주문번호: ${sellRes.ordNo ?? 'N/A'}\n` +
      `🏷️ MANUAL_EXIT — 학습 격리됨 (조건 가중치 통계 미반영)\n` +
      `🧠 편향 추정 — 후회회피 ${bias.regretAvoidance} / 보유효과 ${bias.endowmentEffect} / 패닉 ${bias.panicSelling}` +
      shadowSuffix,
    );
  },
};

commandRegistry.register(sell);

export default sell;
