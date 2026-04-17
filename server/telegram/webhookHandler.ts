// server/telegram/webhookHandler.ts
// Telegram 양방향 봇 Webhook 핸들러 — server.ts에서 분리
// POST /api/telegram/webhook 엔드포인트에서 호출
// 지원 명령어: /help, /status, /market, /stop, /reset, /watchlist, /buy, /report,
//             /shadow, /pending, /pnl, /pos, /add, /remove, /regime, /scan, /cancel
import { Request, Response } from 'express';
import {
  getEmergencyStop, setEmergencyStop,
  setDailyLoss, getDailyLossPct,
} from '../state.js';
import { cancelAllPendingOrders } from '../emergency.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { loadWatchlist, saveWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getShadowTrades } from '../orchestrator/tradingOrchestrator.js';
import { getMonthlyStats } from '../learning/recommendationTracker.js';
import { sendTelegramAlert, answerCallbackQuery } from '../alerts/telegramClient.js';
import { fillMonitor } from '../trading/fillMonitor.js';
import { runAutoSignalScan, isOpenShadowStatus, getLastBuySignalAt, getLastScanSummary } from '../trading/signalScanner.js';
import { generateDailyReport, sendMarketSummaryOnDemand } from '../alerts/reportGenerator.js';
import { fetchCurrentPrice, fetchStockName, getKisTokenRemainingHours, getRealDataTokenRemainingHours, refreshKisToken, invalidateKisToken } from '../clients/kisClient.js';
import { getStreamStatus } from '../clients/kisStreamClient.js';
import { getLastScanAt } from '../orchestrator/adaptiveScanScheduler.js';
import { verifyVolumeMount } from '../persistence/paths.js';
import { STOCK_UNIVERSE } from '../screener/stockScreener.js';
import { calcRRR } from '../trading/riskManager.js';
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
          `  /watchlist — 워치리스트 전체 조회\n` +
          `  /focus — Track B 매수 대상 상세 조회\n` +
          `  /shadow — Shadow 성과 현황\n` +
          `  /pending — 미체결 주문 조회\n` +
          `  /pos — 보유 포지션 요약\n` +
          `  /pnl — 실시간 포지션별 손익\n` +
          `  /regime — 매크로 레짐 현황\n` +
          `  /health — 파이프라인 헬스체크 (KIS/스캐너/토큰)\n` +
          `  /refresh_token — KIS 토큰 강제 갱신\n\n` +
          `📈 <b>매매</b>\n` +
          `  /buy <code>종목코드</code> — 수동 매수 신호\n` +
          `  /scan — 장중 강제 스캔 트리거\n` +
          `  /cancel <code>종목코드</code> — 미체결 주문 취소\n` +
          `  /report — 일일 리포트 생성\n\n` +
          `📋 <b>워치리스트</b>\n` +
          `  /add <code>종목코드</code> — 워치리스트 추가\n` +
          `  /remove <code>종목코드</code> — 워치리스트 제거\n` +
          `  /watchlist_channel — 워치리스트 채널 발송\n\n` +
          `🛑 <b>제어</b>\n` +
          `  /stop — 비상 정지 발동\n` +
          `  /reset [pw] — 비상 정지 해제\n` +
          `  /channel_test — 채널 연결 테스트\n\n` +
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
        if (wl.length === 0) {
          await reply(
            '📋 <b>워치리스트가 비어 있습니다.</b>\n\n' +
            '💡 <i>/add 005930 으로 종목을 추가하세요.\n' +
            '자동 스크리너가 발굴한 종목도 여기에 표시됩니다.</i>'
          );
          break;
        }

        const swingList    = wl.filter(w => w.section === 'SWING' || (!w.section && (w.track === 'B' || w.addedBy === 'MANUAL')));
        const catalystList = wl.filter(w => w.section === 'CATALYST');
        const momentumList = wl.filter(w => w.section === 'MOMENTUM' || (!w.section && w.track === 'A' && w.addedBy !== 'MANUAL'));

        const formatEntry = (w: WatchlistEntry, showDetail: boolean) => {
          const focusMark = w.isFocus ? '⭐' : '';
          const sectionMark = w.addedBy === 'MANUAL' ? '👤' : w.addedBy === 'DART' ? '📢' : '🤖';
          const gate = w.gateScore !== undefined ? `Gate ${w.gateScore.toFixed(1)}` : '';
          const rrr = w.rrr !== undefined ? `RRR 1:${w.rrr.toFixed(1)}` : '';
          const sector = w.sector ? `${w.sector}` : '';
          const meta = [gate, rrr, sector].filter(Boolean).join(' · ');

          if (showDetail) {
            return (
              `${focusMark}${sectionMark} <b>${w.name}</b> (${w.code})\n` +
              `   💰 진입: ${w.entryPrice.toLocaleString()}원\n` +
              `   🛡️ 손절: ${w.stopLoss.toLocaleString()}원 → 🎯 목표: ${w.targetPrice.toLocaleString()}원\n` +
              (meta ? `   📊 ${meta}` : '') +
              (w.memo ? `\n   💬 ${w.memo}` : '')
            );
          }
          return `  ${sectionMark} ${w.name}(${w.code}) ${meta ? `| ${meta}` : ''}`;
        };

        const parts: string[] = [
          `📋 <b>[워치리스트] 총 ${wl.length}개</b>`,
          `━━━━━━━━━━━━━━━━━━━━`,
        ];

        if (swingList.length > 0) {
          parts.push(`\n🎯 <b>SWING — 스윙 매수 대상 (${swingList.length}개)</b>`);
          parts.push(...swingList.map(w => formatEntry(w, true)));
        }

        if (catalystList.length > 0) {
          parts.push(`\n📢 <b>CATALYST — 촉매 단기 (${catalystList.length}개)</b>`);
          parts.push(...catalystList.map(w => formatEntry(w, true)));
        }

        if (momentumList.length > 0) {
          parts.push(`\n📂 <b>MOMENTUM — 관찰 전용 (${momentumList.length}개)</b>`);
          const shown = momentumList.slice(0, 10);
          parts.push(...shown.map(w => formatEntry(w, false)));
          if (momentumList.length > 10) {
            parts.push(`  ... 외 ${momentumList.length - 10}개`);
          }
        }

        parts.push(
          `\n━━━━━━━━━━━━━━━━━━━━`,
          `⭐=SWING매수대상 👤=수동 📢=CATALYST 🤖=MOMENTUM`,
          `💡 /focus — SWING 상세 조회`
        );

        await reply(parts.join('\n'));
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
        // Shadow 강제 신호 트리거 — forceBuyCodes로 buyList에 강제 포함
        await runAutoSignalScan({ forceBuyCodes: [code] }).catch(console.error);
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
        const sl = Math.round(price * 0.92);       // 기본 -8% 손절
        const tp = Math.round(price * 1.15);       // 기본 +15% 목표
        // 종목명 조회: STOCK_UNIVERSE → KIS API 순으로 시도
        const univName = STOCK_UNIVERSE.find(s => s.code === code)?.name;
        const stockName = univName ?? await fetchStockName(code).catch(() => null) ?? code;
        const newEntry: WatchlistEntry = {
          code,
          name: stockName,
          entryPrice: price,
          stopLoss: sl,
          targetPrice: tp,
          rrr: parseFloat(calcRRR(price, tp, sl).toFixed(2)),
          addedAt: new Date().toISOString(),
          addedBy: 'MANUAL',
        };
        wl.push(newEntry);
        saveWatchlist(wl);
        await reply(
          `✅ <b>워치리스트 추가</b>\n` +
          `종목: ${stockName} (${code})\n` +
          `진입가: ${price.toLocaleString()}원\n` +
          `손절: ${newEntry.stopLoss.toLocaleString()}원 (-8%)\n` +
          `목표: ${newEntry.targetPrice.toLocaleString()}원 (+15%)\n` +
          `RRR: ${newEntry.rrr}\n` +
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

      case '/focus': {
        const wl = loadWatchlist();
        const focusList = wl.filter(w => w.section === 'SWING' || w.section === 'CATALYST' || (!w.section && (w.track === 'B' || w.addedBy === 'MANUAL')));
        if (focusList.length === 0) {
          await reply(
            '🎯 <b>Focus 종목이 없습니다.</b>\n\n' +
            '💡 <i>Gate Score 상위 종목이 SWING으로 자동 승격되거나,\n' +
            '/add 로 수동 추가하면 SWING에 포함됩니다.</i>'
          );
          break;
        }

        const lines: string[] = [];
        for (const w of focusList) {
          const focusMark = w.isFocus ? '⭐' : '';
          const manualMark = w.addedBy === 'MANUAL' ? '👤' : w.addedBy === 'DART' ? '📢' : '🤖';
          const gate = w.gateScore !== undefined ? `Gate ${w.gateScore.toFixed(1)}` : 'Gate -';
          const rrr = w.rrr !== undefined ? `RRR 1:${w.rrr.toFixed(1)}` : '';
          const sector = w.sector ?? '';
          const profile = w.profileType ? `[${w.profileType}]` : '';
          const cooldown = w.cooldownUntil && new Date(w.cooldownUntil) > new Date()
            ? '🧊 쿨다운중' : '';
          const addedDate = new Date(w.addedAt).toLocaleDateString('ko-KR', {
            month: 'short', day: 'numeric', timeZone: 'Asia/Seoul',
          });
          const meta = [gate, rrr, sector, profile].filter(Boolean).join(' · ');

          lines.push(
            `${focusMark}${manualMark} <b>${w.name}</b> (${w.code}) ${cooldown}\n` +
            `   💰 진입: ${w.entryPrice.toLocaleString()}원\n` +
            `   🛡️ 손절: ${w.stopLoss.toLocaleString()}원 | 🎯 목표: ${w.targetPrice.toLocaleString()}원\n` +
            `   📊 ${meta}\n` +
            `   📅 등록: ${addedDate}` +
            (w.memo ? ` | 💬 ${w.memo}` : '')
          );
        }

        await reply(
          `🎯 <b>[Track B — 매수 대상] ${focusList.length}개</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          lines.join('\n━━━━━━━━━━━━━━━━━━━━\n') +
          `\n━━━━━━━━━━━━━━━━━━━━\n` +
          `⭐=자동매수대상 👤=수동 🤖=자동발굴 🧊=쿨다운\n` +
          `💡 /buy 종목코드 — 수동 매수 신호 트리거`
        );
        break;
      }

      case '/watchlist_channel': {
        const { channelWatchlistSummary } = await import('../alerts/channelPipeline.js');
        const wl = loadWatchlist();
        if (wl.length === 0) {
          await reply('📋 워치리스트가 비어 있어 채널 발송할 내용이 없습니다.');
          break;
        }
        await channelWatchlistSummary(wl);
        await reply(`✅ 워치리스트 ${wl.length}개 종목을 채널에 발송했습니다.`);
        break;
      }

      case '/channel_test': {
        await reply(
          `🔍 <b>[채널 테스트]</b>\n` +
          `CHANNEL_ENABLED: ${process.env.CHANNEL_ENABLED ?? '미설정'}\n` +
          `TELEGRAM_CHANNEL_ID: ${process.env.TELEGRAM_CHANNEL_ID ?? '미설정'}\n` +
          `채널로 테스트 메시지를 전송합니다...`
        );
        const { sendChannelAlert } = await import('../alerts/telegramClient.js');
        const kstStr = new Date(Date.now() + 9 * 3_600_000)
          .toISOString().replace('T', ' ').slice(0, 19);
        const msgId = await sendChannelAlert(
          `🧪 <b>[채널 연결 테스트]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `✅ QuantMaster Pro 채널 연결 성공\n` +
          `⏰ ${kstStr} KST`
        ).catch(() => null);
        await reply(
          msgId
            ? `✅ 채널 발송 성공 (message_id: ${msgId})`
            : `❌ 채널 발송 실패 — TELEGRAM_CHANNEL_ID 또는 봇 권한 확인 필요`
        );
        break;
      }

      case '/health': {
        const watchlist     = loadWatchlist();
        const shadows       = loadShadowTrades();
        const emergencyStop = getEmergencyStop();
        const dailyLossPct  = getDailyLossPct();
        const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
        const autoEnabled   = process.env.AUTO_TRADE_ENABLED === 'true';
        const autoMode      = process.env.AUTO_TRADE_MODE ?? 'SHADOW';
        const kisHours      = getKisTokenRemainingHours();
        const realDataHours = getRealDataTokenRemainingHours();
        const lastScanTs    = getLastScanAt();
        const lastScanAt    = lastScanTs > 0
          ? new Date(lastScanTs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
          : '미실행';
        const lastBuyTs     = getLastBuySignalAt();
        const lastBuyAt     = lastBuyTs > 0
          ? new Date(lastBuyTs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
          : '없음';
        const scanSummary   = getLastScanSummary();
        const activeTrades  = shadows.filter(s => isOpenShadowStatus(s.status)).length;
        const yahooStatus   = !scanSummary || scanSummary.candidates === 0 ? 'UNKNOWN'
          : scanSummary.yahooFails === scanSummary.candidates ? 'DOWN'
          : scanSummary.yahooFails > scanSummary.candidates * 0.5 ? 'DEGRADED'
          : 'OK';

        // ── 서브시스템 프로브 병렬 실행 (타임아웃 3초) ──────────────────────
        const volumeCheck = verifyVolumeMount();
        const probeTimeout = (ms: number) => new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms));
        const withTimeout = <T>(p: Promise<T>, ms = 3000) =>
          Promise.race([p, probeTimeout(ms)]);
        const probes = await Promise.allSettled([
          withTimeout(fetch('https://query1.finance.yahoo.com/v7/finance/chart/^KS11?interval=1d&range=1d')
            .then(r => r.ok ? 'OK' : `HTTP ${r.status}`)),
          withTimeout(fetch(`https://opendart.fss.or.kr/api/list.json?crtfc_key=${process.env.DART_API_KEY ?? ''}&page_count=1`)
            .then(async r => {
              if (!r.ok) return `HTTP ${r.status}`;
              const j = await r.json() as { status?: string };
              return j.status === '000' ? 'OK' : `status=${j.status}`;
            })),
        ]);
        const [yahooProbe, dartProbe] = probes;
        const probeLabel = (p: PromiseSettledResult<unknown>) =>
          p.status === 'fulfilled' ? `✅ ${p.value}` : `❌ ${(p.reason as Error).message}`;

        const uptimeHours = (process.uptime() / 3600).toFixed(1);
        const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

        let verdict: string;
        if (emergencyStop)                             verdict = '🔴 EMERGENCY_STOP';
        else if (dailyLossPct >= dailyLossLimit)       verdict = '🔴 DAILY_LOSS_LIMIT';
        else if (!volumeCheck.ok)                      verdict = '🔴 VOLUME_UNMOUNTED';
        else if (watchlist.length === 0)               verdict = '🔴 WATCHLIST_EMPTY';
        else if (!autoEnabled)                         verdict = '🟡 AUTO_TRADE_DISABLED';
        else if (autoMode === 'LIVE' && kisHours === 0) verdict = '🟡 KIS_TOKEN_EXPIRED';
        else if (!lastScanTs)                          verdict = '🟡 SCANNER_IDLE';
        else if (yahooStatus === 'DOWN')               verdict = '🟡 YAHOO_DOWN';
        else                                           verdict = '🟢 OK';

        const ss = getStreamStatus();
        await reply(
          `🩺 <b>[파이프라인 헬스체크]</b> (uptime ${uptimeHours}h / mem ${memMB}MB)\n` +
          `판정: ${verdict}\n` +
          `─────────────────────\n` +
          `워치리스트: ${watchlist.length}개 | 활성 포지션: ${activeTrades}개\n` +
          `자동매매: ${autoEnabled ? '✅ 켜짐' : '❌ 꺼짐'} (${autoMode})\n` +
          `KIS 토큰: ${kisHours > 0 ? `✅ ${kisHours}시간 남음` : '❌ 만료'}` +
          (realDataHours > 0 ? ` | 실데이터: ✅ ${realDataHours}h` : '') + `\n` +
          `Yahoo probe: ${probeLabel(yahooProbe)}\n` +
          `DART probe: ${probeLabel(dartProbe)}\n` +
          `Volume: ${volumeCheck.ok ? '✅ 마운트됨' : `❌ ${volumeCheck.error ?? '미마운트'}`}\n` +
          `Yahoo 집계: ${yahooStatus === 'OK' ? '✅' : yahooStatus === 'DEGRADED' ? '⚠️ 부분장애' : yahooStatus === 'DOWN' ? '❌ 불가' : '?'}\n` +
          `마지막 스캔: ${lastScanAt} | 마지막 신호: ${lastBuyAt}\n` +
          `일일손실: ${dailyLossPct.toFixed(1)}% / 한도 ${dailyLossLimit}%\n` +
          `비상정지: ${emergencyStop ? '🛑 활성' : '✅ 해제'}\n` +
          `실시간호가: ${ss.connected ? `✅ ${ss.subscribedCount}종목` : '❌ 미연결'}\n` +
          `─────────────────────\n` +
          `<i>/refresh_token — KIS 토큰 강제 갱신</i>`
        );
        break;
      }

      case '/refresh_token': {
        try {
          invalidateKisToken();
          await refreshKisToken();
          const hours = getKisTokenRemainingHours();
          await reply(
            `🔄 <b>KIS 토큰 강제 갱신 완료</b>\n` +
            `잔여: ${hours}시간`
          );
        } catch (e) {
          await reply(
            `❌ <b>KIS 토큰 갱신 실패</b>\n` +
            `${e instanceof Error ? e.message : String(e)}`
          );
        }
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
