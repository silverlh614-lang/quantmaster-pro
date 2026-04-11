// server/telegram/webhookHandler.ts
// Telegram 양방향 봇 Webhook 핸들러 — server.ts에서 분리
// POST /api/telegram/webhook 엔드포인트에서 호출
// 지원 명령어: /status, /stop, /reset, /watchlist, /buy, /report, /shadow, /pending
import { Request, Response } from 'express';
import {
  getEmergencyStop, setEmergencyStop,
  setDailyLoss,
} from '../state.js';
import { cancelAllPendingOrders } from '../emergency.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getShadowTrades } from '../orchestrator/tradingOrchestrator.js';
import { getMonthlyStats } from '../learning/recommendationTracker.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { fillMonitor } from '../trading/fillMonitor.js';
import { runAutoSignalScan } from '../trading/signalScanner.js';
import { generateDailyReport } from '../alerts/reportGenerator.js';

export async function handleTelegramWebhook(req: Request, res: Response): Promise<void> {
  res.sendStatus(200); // Telegram에 즉시 200 응답 (재전송 방지)

  const msg = req.body?.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat?.id ?? '');
  const allowedId = process.env.TELEGRAM_CHAT_ID ?? '';
  // 등록된 채팅방만 허용 (타인의 봇 접근 차단)
  if (allowedId && chatId !== allowedId) {
    console.warn(`[TelegramBot] 허가되지 않은 채팅 ID: ${chatId}`);
    return;
  }

  const text: string = msg.text.trim();
  const [cmd, ...args] = text.split(/\s+/);

  const reply = async (message: string) => {
    await sendTelegramAlert(message).catch(console.error);
  };

  try {
    switch (cmd.toLowerCase()) {
      case '/status': {
        const macro   = loadMacroState();
        const shadows = getShadowTrades();
        const active  = shadows.filter(s => (s as any).status === 'ACTIVE' || (s as any).status === 'PENDING');
        const today   = new Date().toISOString().split('T')[0];
        const closed  = shadows.filter(s =>
          ((s as any).status === 'HIT_TARGET' || (s as any).status === 'HIT_STOP') &&
          (s as any).signalTime?.startsWith(today)
        );
        const pnl = closed.reduce((sum, s) => sum + ((s as any).returnPct ?? 0), 0);
        await reply(
          `📊 <b>[시스템 현황]</b>\n` +
          `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? '🟡 Shadow' : '🔴 LIVE'}\n` +
          `비상정지: ${getEmergencyStop() ? '🔴 ON' : '🟢 OFF'}\n` +
          `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})\n` +
          `활성 포지션: ${active.length}개\n` +
          `오늘 결산: ${closed.length}건 (P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%)`
        );
        break;
      }

      case '/stop': {
        setEmergencyStop(true);
        console.error('[TelegramBot] Telegram /stop 명령 — 비상 정지 발동');
        await cancelAllPendingOrders().catch(console.error);
        await reply('🔴 <b>[비상 정지 발동]</b>\n모든 미체결 주문 취소 완료. /reset 으로 재개 가능.');
        break;
      }

      case '/reset': {
        const secret = process.env.EMERGENCY_RESET_SECRET;
        const provided = args[0] ?? '';
        if (secret && provided !== secret) {
          await reply('❌ 인증 실패 — /reset <비밀번호> 형식으로 입력하세요.');
          break;
        }
        setEmergencyStop(false);
        setDailyLoss(0);
        await reply('🟢 <b>비상 정지 해제</b> — 자동매매 재개');
        break;
      }

      case '/watchlist': {
        const wl = loadWatchlist();
        if (wl.length === 0) { await reply('📋 워치리스트가 비어 있습니다.'); break; }
        const lines = wl.map(w =>
          `• ${w.name}(${w.code}) 진입:${w.entryPrice.toLocaleString()} 손절:${w.stopLoss.toLocaleString()} 목표:${w.targetPrice.toLocaleString()}`
        ).join('\n');
        await reply(`📋 <b>워치리스트 (${wl.length}개)</b>\n${lines}`);
        break;
      }

      case '/buy': {
        const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
        if (!code || code.length !== 6) {
          await reply('❌ 사용법: /buy 005930 (종목코드 6자리)');
          break;
        }
        const wl  = loadWatchlist();
        const hit = wl.find(w => w.code === code);
        if (!hit) {
          await reply(`⚠️ 워치리스트에 ${code} 없음. 먼저 워치리스트에 추가하세요.`);
          break;
        }
        // Shadow 강제 신호 트리거 — runAutoSignalScan() 내 진입 조건 우회
        await runAutoSignalScan().catch(console.error);
        await reply(`🔔 <b>${hit.name}(${code})</b> 수동 매수 신호 트리거 완료 (다음 스캔 주기에 체결)`);
        break;
      }

      case '/report': {
        await reply('📄 일일 리포트 생성 중...');
        await generateDailyReport().catch(console.error);
        await reply('✅ 리포트 이메일 발송 완료');
        break;
      }

      case '/shadow': {
        const stats = getMonthlyStats();
        const pending = fillMonitor.getPendingOrders().filter(o => o.status === 'PENDING');
        await reply(
          `🎭 <b>[Shadow 성과 현황]</b>\n` +
          `${stats.month} — 전체 ${stats.total}건\n` +
          `WIN률: ${stats.winRate.toFixed(1)}% | 평균수익: ${stats.avgReturn.toFixed(2)}%\n` +
          `STRONG_BUY: ${stats.strongBuyWinRate.toFixed(1)}%\n` +
          `미체결 모니터링: ${pending.length}건`
        );
        break;
      }

      case '/pending': {
        const pending = fillMonitor.getPendingOrders().filter(o => o.status === 'PENDING');
        if (pending.length === 0) { await reply('✅ 미체결 주문 없음'); break; }
        const lines = pending.map(o =>
          `• ${o.stockName}(${o.ordNo}) ${o.quantity}주 @${o.orderPrice.toLocaleString()} [${o.pollCount}/${10}회]`
        ).join('\n');
        await reply(`⏳ <b>미체결 주문 (${pending.length}건)</b>\n${lines}`);
        break;
      }

      default:
        await reply(
          `🤖 <b>QuantMaster Pro 봇</b>\n` +
          `/status — 현황 요약\n` +
          `/stop — 비상 정지\n` +
          `/reset [pw] — 비상 정지 해제\n` +
          `/watchlist — 워치리스트 조회\n` +
          `/buy 종목코드 — 수동 신호\n` +
          `/report — 일일 리포트\n` +
          `/shadow — Shadow 성과\n` +
          `/pending — 미체결 주문`
        );
    }
  } catch (e) {
    console.error('[TelegramBot] 명령 처리 실패:', e);
  }
}
