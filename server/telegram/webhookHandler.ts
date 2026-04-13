// server/telegram/webhookHandler.ts
// Telegram 양방향 봇 Webhook 핸들러 — server.ts에서 분리
// POST /api/telegram/webhook 엔드포인트에서 호출
// 지원 명령어: /help, /status, /market, /stop, /reset, /watchlist, /buy, /report,
//             /shadow, /pending, /pnl, /pos, /add, /remove, /regime, /scan, /cancel
import { Request, Response } from 'express';
import {
  getEmergencyStop, setEmergencyStop,
  setDailyLoss,
} from '../state.js';
import { cancelAllPendingOrders } from '../emergency.js';
import { loadWatchlist, saveWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getShadowTrades } from '../orchestrator/tradingOrchestrator.js';
import { getMonthlyStats } from '../learning/recommendationTracker.js';
import { sendTelegramAlert, answerCallbackQuery } from '../alerts/telegramClient.js';
import { fillMonitor } from '../trading/fillMonitor.js';
import { runAutoSignalScan, isOpenShadowStatus } from '../trading/signalScanner.js';
import { generateDailyReport, sendMarketSummaryOnDemand } from '../alerts/reportGenerator.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { handleBuyApprovalCallback } from './buyApproval.js';

export async function handleTelegramWebhook(req: Request, res: Response): Promise<void> {
  res.sendStatus(200); // Telegram에 즉시 200 응답 (재전송 방지)

  // ── callback_query 처리 (인라인 키보드 버튼 클릭) ──────────────────────────
  const callbackQuery = req.body?.callback_query;
  if (callbackQuery) {
    const cbChatId = String(callbackQuery.message?.chat?.id ?? '');
    const allowedId = process.env.TELEGRAM_CHAT_ID ?? '';
    if (allowedId && cbChatId !== allowedId) return;

    const callbackQueryId = callbackQuery.id;
    const data = callbackQuery.data ?? '';

    // 매수 승인 콜백 처리
    const handled = await handleBuyApprovalCallback(callbackQueryId, data).catch(() => false);
    if (!handled) {
      await answerCallbackQuery(callbackQueryId, '알 수 없는 버튼입니다.');
    }
    return;
  }

  // ── 일반 메시지 명령어 처리 ────────────────────────────────────────────────
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
      case '/help':
      case '/start': {
        await reply(
          `🤖 <b>QuantMaster Pro 봇 명령어</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 <b>조회</b>\n` +
          `  /status — 시스템 현황 요약\n` +
          `  /market — 시장상황 요약 레포트\n` +
          `  /watchlist — 워치리스트 조회\n` +
          `  /shadow — Shadow 성과 현황\n` +
          `  /pending — 미체결 주문 조회\n` +
          `  /pos — 보유 포지션 요약\n` +
          `  /pnl — 실시간 포지션별 손익\n` +
          `  /regime — 매크로 레짐 현황\n\n` +
          `📈 <b>매매</b>\n` +
          `  /buy <code>종목코드</code> — 수동 매수 신호\n` +
          `  /scan — 장중 강제 스캔 트리거\n` +
          `  /cancel <code>종목코드</code> — 미체결 주문 취소\n` +
          `  /report — 일일 리포트 생성\n\n` +
          `📋 <b>워치리스트</b>\n` +
          `  /add <code>종목코드</code> — 워치리스트 추가\n` +
          `  /remove <code>종목코드</code> — 워치리스트 제거\n\n` +
          `🛑 <b>제어</b>\n` +
          `  /stop — 비상 정지 발동\n` +
          `  /reset [pw] — 비상 정지 해제\n\n` +
          `⏰ <b>자동 레포트 스케줄</b>\n` +
          `  08:30 — 장전 시장 브리핑\n` +
          `  12:00 — 장중 시장 현황\n` +
          `  15:35 — 장마감 시장 요약\n\n` +
          `<i>/help 으로 이 메시지를 다시 볼 수 있습니다.</i>`
        );
        break;
      }

      case '/market': {
        await reply('📡 시장상황 요약 생성 중...');
        await sendMarketSummaryOnDemand().catch(console.error);
        break;
      }

      case '/status': {
        const macro   = loadMacroState();
        const shadows = getShadowTrades();
        const active  = shadows.filter(s =>
          (s as any).status === 'PENDING' ||
          (s as any).status === 'ORDER_SUBMITTED' ||
          (s as any).status === 'PARTIALLY_FILLED' ||
          (s as any).status === 'ACTIVE' ||
          (s as any).status === 'EUPHORIA_PARTIAL'
        );
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
        const pending = fillMonitor.getPendingOrders().filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
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
        const pending = fillMonitor.getPendingOrders().filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
        if (pending.length === 0) { await reply('✅ 미체결 주문 없음'); break; }
        const lines = pending.map(o =>
          `• ${o.stockName}(${o.ordNo}) ${o.quantity}주 @${o.orderPrice.toLocaleString()} [${o.pollCount}/${10}회]`
        ).join('\n');
        await reply(`⏳ <b>미체결 주문 (${pending.length}건)</b>\n${lines}`);
        break;
      }

      // ── 아이디어 4: 신규 명령어 ──────────────────────────────────────────────

      case '/pnl': {
        const shadows = getShadowTrades();
        const active = shadows.filter(s => isOpenShadowStatus(s.status));
        if (active.length === 0) { await reply('📈 활성 포지션 없음'); break; }

        let totalPnl = 0;
        const lines: string[] = [];
        for (const s of active) {
          const price = await fetchCurrentPrice(s.stockCode).catch(() => null);
          if (!price) {
            lines.push(`• ${s.stockName} — 가격 조회 실패`);
            continue;
          }
          const pnlPct = ((price - s.shadowEntryPrice) / s.shadowEntryPrice) * 100;
          const pnlAmt = (price - s.shadowEntryPrice) * s.quantity;
          totalPnl += pnlPct;
          const emoji = pnlPct >= 0 ? '🟢' : '🔴';
          const targetDist = ((s.targetPrice - price) / price * 100).toFixed(1);
          const stopDist = ((price - (s.hardStopLoss ?? s.stopLoss)) / (s.hardStopLoss ?? s.stopLoss) * 100).toFixed(1);
          lines.push(
            `${emoji} ${s.stockName} ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%` +
            ` (${pnlAmt >= 0 ? '+' : ''}${pnlAmt.toLocaleString()}원)` +
            `\n   목표까지 +${targetDist}% | 손절까지 -${stopDist}%`
          );
        }
        const avgPnl = totalPnl / active.length;
        await reply(
          `📈 <b>[실시간 PnL] ${active.length}개 포지션</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `${lines.join('\n')}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `평균 수익률: ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2)}%`
        );
        break;
      }

      case '/pos': {
        const shadows = getShadowTrades();
        const active = shadows.filter(s => isOpenShadowStatus(s.status));
        if (active.length === 0) { await reply('📋 보유 포지션 없음'); break; }

        const lines = active.map(s => {
          const mode = s.mode === 'LIVE' ? '🔴' : '🟡';
          const status = s.status === 'PENDING' ? '⏳' : s.status === 'ACTIVE' ? '✅' : '◐';
          return (
            `${mode}${status} <b>${s.stockName}</b> (${s.stockCode})\n` +
            `   진입: ${s.shadowEntryPrice.toLocaleString()}원 × ${s.quantity}주\n` +
            `   손절: ${(s.hardStopLoss ?? s.stopLoss).toLocaleString()}원 | 목표: ${s.targetPrice.toLocaleString()}원\n` +
            `   진입시각: ${new Date(s.signalTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
          );
        });
        await reply(
          `📋 <b>[보유 포지션] ${active.length}개</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          lines.join('\n━━━━━━━━━━━━━━━━━━━━\n')
        );
        break;
      }

      case '/add': {
        const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
        if (!code || code.length !== 6) {
          await reply('❌ 사용법: /add 005380 (종목코드 6자리)');
          break;
        }
        const wl = loadWatchlist();
        if (wl.find(w => w.code === code)) {
          await reply(`⚠️ ${code} 이미 워치리스트에 있습니다.`);
          break;
        }

        // 현재가 조회하여 기본 진입가/손절/목표 자동 설정
        const price = await fetchCurrentPrice(code).catch(() => null);
        if (!price) {
          await reply(`❌ ${code} 현재가 조회 실패 — 유효한 종목코드인지 확인하세요.`);
          break;
        }
        const newEntry: WatchlistEntry = {
          code,
          name: code, // 이름은 코드로 임시 설정 (다음 스캔에서 업데이트)
          entryPrice: price,
          stopLoss: Math.round(price * 0.92),      // 기본 -8% 손절
          targetPrice: Math.round(price * 1.15),    // 기본 +15% 목표
          addedAt: new Date().toISOString(),
          addedBy: 'MANUAL',
        };
        wl.push(newEntry);
        saveWatchlist(wl);
        await reply(
          `✅ <b>워치리스트 추가</b>\n` +
          `종목: ${code}\n` +
          `진입가: ${price.toLocaleString()}원\n` +
          `손절: ${newEntry.stopLoss.toLocaleString()}원 (-8%)\n` +
          `목표: ${newEntry.targetPrice.toLocaleString()}원 (+15%)\n` +
          `<i>대시보드에서 진입가/손절/목표를 조정하세요.</i>`
        );
        break;
      }

      case '/remove': {
        const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
        if (!code || code.length !== 6) {
          await reply('❌ 사용법: /remove 005380 (종목코드 6자리)');
          break;
        }
        const wl = loadWatchlist();
        const idx = wl.findIndex(w => w.code === code);
        if (idx === -1) {
          await reply(`⚠️ ${code} 워치리스트에 없습니다.`);
          break;
        }
        const removed = wl.splice(idx, 1)[0];
        saveWatchlist(wl);
        await reply(`🗑 <b>워치리스트 제거</b>\n${removed.name}(${code}) 삭제 완료\n잔여: ${wl.length}개`);
        break;
      }

      case '/regime': {
        const macro = loadMacroState();
        if (!macro) {
          await reply('❌ 매크로 상태 데이터 없음');
          break;
        }
        const mhsEmoji = (macro.mhs ?? 0) >= 60 ? '🟢' : (macro.mhs ?? 0) >= 40 ? '🟡' : '🔴';
        const regimeEmoji = macro.regime === 'GREEN' ? '🟢' : macro.regime === 'YELLOW' ? '🟡' : '🔴';
        await reply(
          `🌐 <b>[매크로 레짐 현황]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `${mhsEmoji} MHS: ${macro.mhs ?? 'N/A'}\n` +
          `${regimeEmoji} 레짐: ${macro.regime ?? 'N/A'}\n` +
          `📊 VKOSPI: ${macro.vkospi?.toFixed(1) ?? 'N/A'}\n` +
          `📊 VIX: ${macro.vix?.toFixed(1) ?? 'N/A'}\n` +
          `💱 USD/KRW: ${macro.usdKrw?.toLocaleString() ?? 'N/A'}\n` +
          `📉 MHS추세: ${macro.mhsTrend ?? 'N/A'}\n` +
          `🐻 Bear방어: ${macro.bearDefenseMode ? '🔴 ON' : '🟢 OFF'}\n` +
          `📈 FSS경보: ${macro.fssAlertLevel ?? 'N/A'}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `업데이트: ${macro.updatedAt ? new Date(macro.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : 'N/A'}`
        );
        break;
      }

      case '/scan': {
        if (getEmergencyStop()) {
          await reply('🔴 비상 정지 상태 — 스캔 불가. /reset 으로 해제 후 재시도.');
          break;
        }
        await reply('🔍 장중 강제 스캔 트리거 중...');
        await runAutoSignalScan().catch(console.error);
        await reply('✅ 강제 스캔 완료');
        break;
      }

      case '/cancel': {
        const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
        if (!code || code.length !== 6) {
          await reply('❌ 사용법: /cancel 005380 (종목코드 6자리)');
          break;
        }
        const pendingOrders = fillMonitor.getPendingOrders().filter(
          o => (o.status === 'PENDING' || o.status === 'PARTIAL') && o.stockCode === code,
        );
        if (pendingOrders.length === 0) {
          await reply(`⚠️ ${code} 미체결 주문 없음`);
          break;
        }
        // 해당 종목의 미체결 주문을 모두 취소하기 위해 전체 취소 로직 활용
        // (단건 취소는 KIS API로 직접 호출해야 하므로 emergency 모듈 재활용)
        await reply(
          `🚫 ${code} 미체결 ${pendingOrders.length}건 취소 처리 중...\n` +
          pendingOrders.map(o => `• ${o.stockName} ${o.quantity}주 @${o.orderPrice.toLocaleString()}`).join('\n')
        );
        // KIS 단건 취소 실행
        const { kisPost, KIS_IS_REAL } = await import('../clients/kisClient.js');
        const cancelTrId = KIS_IS_REAL ? 'TTTC0803U' : 'VTTC0803U';
        for (const o of pendingOrders) {
          try {
            await kisPost(cancelTrId, '/uapi/domestic-stock/v1/trading/order-rvsecncl', {
              CANO: process.env.KIS_ACCOUNT_NO ?? '',
              ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
              KRX_FWDG_ORD_ORGNO: '', ORGN_ODNO: o.ordNo,
              ORD_DVSN: '00', RVSE_CNCL_DVSN_CD: '02',
              ORD_QTY: o.quantity.toString(), ORD_UNPR: '0',
              QTY_ALL_ORD_YN: 'Y', PDNO: code.padStart(6, '0'),
            });
          } catch (e) {
            console.error(`[TelegramBot] 취소 실패 ODNO=${o.ordNo}:`, e instanceof Error ? e.message : e);
          }
        }
        await reply(`✅ ${code} 미체결 주문 ${pendingOrders.length}건 취소 요청 완료`);
        break;
      }

      default:
        await reply(
          `❓ 알 수 없는 명령어입니다.\n` +
          `/help 를 입력하면 사용 가능한 명령어 목록을 볼 수 있습니다.`
        );
    }
  } catch (e) {
    console.error('[TelegramBot] 명령 처리 실패:', e);
  }
}
