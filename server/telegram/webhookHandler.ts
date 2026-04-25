// server/telegram/webhookHandler.ts
// Telegram 양방향 봇 Webhook 핸들러 — server.ts에서 분리
// POST /api/telegram/webhook 엔드포인트에서 호출
// 지원 명령어: /help, /status, /market, /pause, /resume, /stop, /reset, /integrity,
//             /watchlist, /buy, /sell, /report, /shadow, /pending, /pnl, /pos,
//             /add, /remove, /regime, /scan, /krx_scan, /cancel, /focus, /watchlist_channel,
//             /health, /refresh_token, /channel_test, /reconnect_ws
import { Request, Response } from 'express';
import {
  getEmergencyStop, setEmergencyStop,
  setDailyLoss, getDailyLossPct,
  getAutoTradePaused, setAutoTradePaused,
  getDataIntegrityBlocked, setDataIntegrityBlocked,
} from '../state.js';
import { cancelAllPendingOrders } from '../emergency.js';
import {
  loadShadowTrades,
  saveShadowTrades,
  getRemainingQty,
  getTotalRealizedPnl,
  updateShadow,
  appendFill,
  appendShadowLog,
  syncPositionCache,
  computeShadowMonthlyStats,
} from '../persistence/shadowTradeRepo.js';
import { loadWatchlist, saveWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getShadowTrades } from '../orchestrator/tradingOrchestrator.js';
import { sendTelegramAlert, answerCallbackQuery, isDigestEnabled, setDigestEnabled, escapeHtml } from '../alerts/telegramClient.js';
import { guardedFetch } from '../utils/egressGuard.js';
import { readAlertAuditRange } from '../alerts/alertAuditLog.js';
import { getChannelStatsByDate, getRecentDateKeys } from '../persistence/channelStatsRepo.js';
import { findAlertHistoryById, getRecentAlertHistory } from '../persistence/alertHistoryRepo.js';
import { AlertCategory } from '../alerts/alertCategories.js';
import { dispatchAlert, runChannelHealthCheck } from '../alerts/alertRouter.js';
import { fillMonitor } from '../trading/fillMonitor.js';
import { runAutoSignalScan, isOpenShadowStatus, getLastBuySignalAt, getLastScanSummary } from '../trading/signalScanner.js';
import { runFullDiscoveryPipeline } from '../screener/universeScanner.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { resetKrxCache } from '../clients/krxClient.js';
import { _resetKrxOpenApiBreaker, getKrxOpenApiStatus, resetKrxOpenApiCache } from '../clients/krxOpenApi.js';
import { generateDailyReport, sendMarketSummaryOnDemand } from '../alerts/reportGenerator.js';
import { fetchCurrentPrice, fetchStockName, getKisTokenRemainingHours, getRealDataTokenRemainingHours, refreshKisToken, invalidateKisToken, placeKisSellOrder, getCircuitBreakerStats, resetKisCircuits } from '../clients/kisClient.js';
import { getYahooHealthSnapshot } from '../trading/marketDataRefresh.js';
import { getAccountRiskBudget, formatAccountRiskBudget } from '../trading/accountRiskBudget.js';
import { loadKellyDampenerState } from '../trading/kellyDampener.js';
import { formatKellyHealthCards } from '../trading/kellyHealthCard.js';
import { formatKellySurface } from '../learning/kellySurfaceMap.js';
import { formatRegimeCoverage } from '../learning/regimeBalancedSampler.js';
import { getUniverseStats } from '../learning/ledgerSimulator.js';
import { getCounterfactualStats } from '../learning/counterfactualShadow.js';
import { loadTradingSettings } from '../persistence/tradingSettingsRepo.js';
import { MAX_SUBSCRIPTIONS, getStreamStatus, startKisStream, stopKisStream, getRealtimePrice } from '../clients/kisStreamClient.js';
import { getBudgetState, getGeminiCircuitStats, getGeminiRuntimeState } from '../clients/geminiClient.js';
import { getLastScanAt } from '../orchestrator/adaptiveScanScheduler.js';
import { verifyVolumeMount } from '../persistence/paths.js';
import { STOCK_UNIVERSE } from '../screener/stockScreener.js';
import { calcRRR } from '../trading/riskManager.js';
import { buildManualExitContext } from '../trading/manualExitContext.js';
import { appendManualExit } from '../persistence/manualExitsRepo.js';
import { evaluateAndAlertManualOverride } from '../alerts/manualOverrideMonitor.js';
import { reconcileShadowQuantities, loadLastReconcileResult } from '../persistence/shadowAccountRepo.js';
import { reconcileLivePositions, formatLiveReconcileResult } from '../trading/liveReconciler.js';
import { handleBuyApprovalCallback } from './buyApproval.js';
import { handleOperatorOverrideCallback } from './operatorOverride.js';
import { handleT1AckCallback } from '../alerts/ackTracker.js';
import {
  formatSchedulerSummary,
  formatSchedulerNext,
  formatSchedulerDetail,
  formatSchedulerHistory,
} from '../scheduler/scheduleCatalog.js';
import { getLearningStatus, getLearningHistory } from '../learning/learningHistorySummary.js';
import {
  formatLearningStatusMessage,
  formatLearningHistoryMessage,
} from '../learning/learningHistoryFormatter.js';
import {
  buildHelpMessage,
  handleMetaCommand,
  parseMetaCallback,
  type InlineKeyboardMarkup,
} from './metaCommands.js';

// ADR-0015: /reconcile live apply 60초 rate-limit 가드 — 오타 방지.
let _lastLiveReconcileApplyAt = 0;

// ADR-0017: 메타 명령어 callback 으로 트리거된 재호출인지 식별하는 sentinel.
// callback → text command 재진입은 1단계만 허용하고 추가 callback 발생은 차단해
// 무한 루프를 원천 봉쇄한다.
const META_RECURSIVE_FLAG = '__metaRecursiveInvocation';

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
    const messageId = callbackQuery.message?.message_id as number | undefined;

    // 매수 승인 → T1 ACK → 운용자 오버라이드 순으로 라우팅 (prefix 매칭으로 충돌 없음)
    const buyHandled = await handleBuyApprovalCallback(callbackQueryId, data).catch(() => false);
    if (buyHandled) return;

    const ackHandled = await handleT1AckCallback(callbackQueryId, data).catch((e: unknown) => {
      console.error('[TelegramBot] T1 ACK 처리 실패:', e instanceof Error ? e.message : e);
      return false;
    });
    if (ackHandled) return;

    const overrideHandled = await handleOperatorOverrideCallback(callbackQueryId, data, messageId)
      .catch((e: unknown) => {
        console.error('[TelegramBot] operator override 처리 실패:', e instanceof Error ? e.message : e);
        return false;
      });
    if (overrideHandled) return;

    // ADR-0017: 4번째 라우터 — 메타 명령어 인라인 키보드 버튼 (`meta:<cmd>:<nonce>`)
    // 사용자가 `/watch` `/positions` 등 메타 메뉴의 하위 버튼을 탭한 경우 해당 legacy
    // 명령어를 합성 메시지로 재호출한다.
    const metaParsed = parseMetaCallback(data);
    if (metaParsed) {
      await answerCallbackQuery(callbackQueryId, `${metaParsed.targetCmd} 실행 중...`)
        .catch((e: unknown) => {
          console.error('[TelegramBot] meta callback ack 실패:', e instanceof Error ? e.message : e);
        });
      const syntheticReq = {
        body: {
          message: {
            chat: { id: cbChatId },
            text: metaParsed.targetCmd,
          },
          [META_RECURSIVE_FLAG]: true,
        },
      } as unknown as Request;
      const dummyRes = {
        sendStatus: () => undefined,
      } as unknown as Response;
      await handleTelegramWebhook(syntheticReq, dummyRes).catch((e: unknown) => {
        console.error('[TelegramBot] meta synthetic invocation 실패:', e instanceof Error ? e.message : e);
      });
      return;
    }

    await answerCallbackQuery(callbackQueryId, '알 수 없는 버튼입니다.');
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

  const reply = async (message: string, replyMarkup?: InlineKeyboardMarkup) => {
    // sendTelegramAlert 는 replyMarkup 을 Record<string, unknown> 으로 받기 때문에
    // InlineKeyboardMarkup 을 unknown 경유로 전달한다 (구조 동일).
    const opts = replyMarkup
      ? { replyMarkup: replyMarkup as unknown as Record<string, unknown> }
      : undefined;
    await sendTelegramAlert(message, opts).catch(console.error);
  };

  try {
    switch (cmd.toLowerCase()) {
      case '/help':
      case '/start': {
        // ADR-0017: 메타 메뉴 8개 우선 노출. legacy 51 명령어는 직접 입력으로 alias 유지.
        await reply(buildHelpMessage());
        break;
      }

      // ADR-0017 Stage 1 — 메타 명령어 6종. 각 case 는 metaCommands 모듈로 위임만.
      case '/now':
      case '/watch':
      case '/positions':
      case '/learning':
      case '/control':
      case '/admin': {
        await handleMetaCommand(cmd.toLowerCase(), reply);
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
          (
            (s as any).status === 'PENDING' ||
            (s as any).status === 'ORDER_SUBMITTED' ||
            (s as any).status === 'PARTIALLY_FILLED' ||
            (s as any).status === 'ACTIVE' ||
            (s as any).status === 'EUPHORIA_PARTIAL'
          ) &&
          getRemainingQty(s) > 0
        );
        const today   = new Date().toISOString().split('T')[0];
        const closed  = shadows.filter(s =>
          ((s as any).status === 'HIT_TARGET' || (s as any).status === 'HIT_STOP') &&
          (s as any).signalTime?.startsWith(today)
        );
        const pnl = closed.reduce((sum, s) => sum + ((s as any).returnPct ?? 0), 0);
        await reply(
          `📊 <b>[시스템 현황]</b>\n` +
          `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? '🟡 [SHADOW]' : '🔴 LIVE'}\n` +
          `비상정지: ${getEmergencyStop() ? '🔴 ON' : '🟢 OFF'}\n` +
          `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})\n` +
          `활성 포지션: ${active.length}개\n` +
          `오늘 결산: ${closed.length}건 (P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%)`
        );
        break;
      }

      case '/pause': {
        if (getEmergencyStop()) {
          await reply('🔴 이미 비상 정지 상태입니다. /reset 으로 해제 후 /pause 사용 가능.');
          break;
        }
        setAutoTradePaused(true);
        console.warn('[TelegramBot] /pause — 소프트 일시정지 발동');
        await reply(
          '⏸ <b>[엔진 일시정지]</b>\n' +
          '신규 tick 실행 중단 (미체결 주문·기존 포지션 유지)\n' +
          '/resume 으로 재개 | /stop 으로 완전 정지'
        );
        break;
      }

      case '/resume': {
        if (!getAutoTradePaused()) {
          await reply('✅ 이미 실행 중입니다. (일시정지 상태 아님)');
          break;
        }
        setAutoTradePaused(false);
        console.warn('[TelegramBot] /resume — 소프트 일시정지 해제');
        await reply(
          '▶️ <b>[엔진 재개]</b>\n' +
          '다음 cron tick 부터 정상 실행합니다.\n' +
          `자동매매: ${process.env.AUTO_TRADE_ENABLED === 'true' ? '✅ 켜짐' : '❌ 꺼짐 (AUTO_TRADE_ENABLED 확인)'}`
        );
        break;
      }

      case '/integrity': {
        const blocked = getDataIntegrityBlocked();
        const paused  = getAutoTradePaused();
        if (args[0] === 'clear') {
          setDataIntegrityBlocked(false);
          await reply('🟢 <b>데이터 무결성 차단 해제</b>\n신규 매수 재허용.');
          break;
        }
        await reply(
          `🔍 <b>[데이터 무결성 상태]</b>\n` +
          `무결성 차단: ${blocked ? '🔴 차단 중 (신규 매수 금지)' : '🟢 정상'}\n` +
          `엔진 일시정지: ${paused ? '⏸ 정지 중' : '▶️ 실행 중'}\n` +
          (blocked ? `\n<i>/integrity clear — 차단 수동 해제</i>` : '')
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
        // 아이디어 7 (Phase 4): 서킷브레이커 상태를 함께 해제하여 재발동 가능.
        const { clearCircuitBreaker, clearForcedRegimeDowngrade } = await import('../learning/learningState.js');
        clearCircuitBreaker();
        clearForcedRegimeDowngrade();
        await reply('🟢 <b>비상 정지 해제</b> — 자동매매 재개 (서킷브레이커/다운그레이드 해제)');
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
          const sector = w.sector ? escapeHtml(w.sector) : '';
          const meta = [gate, rrr, sector].filter(Boolean).join(' · ');

          if (showDetail) {
            return (
              `${focusMark}${sectionMark} <b>${escapeHtml(w.name)}</b> (${escapeHtml(w.code)})\n` +
              `   💰 진입: ${w.entryPrice.toLocaleString()}원\n` +
              `   🛡️ 손절: ${w.stopLoss.toLocaleString()}원 → 🎯 목표: ${w.targetPrice.toLocaleString()}원\n` +
              (meta ? `   📊 ${meta}` : '') +
              (w.memo ? `\n   💬 ${escapeHtml(w.memo)}` : '')
            );
          }
          return `  ${sectionMark} ${escapeHtml(w.name)}(${escapeHtml(w.code)}) ${meta ? `| ${meta}` : ''}`;
        };

        const parts: string[] = [
          `📋 <b>[워치리스트] 총 ${wl.length}개</b>`,
          `━━━━━━━━━━━━━━━━`,
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
          `\n━━━━━━━━━━━━━━━━`,
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
        await reply(`🔔 <b>${escapeHtml(hit.name)}(${escapeHtml(code)})</b> 수동 매수 신호 트리거 완료 (다음 스캔 주기에 체결)`);
        break;
      }

      case '/sell': {
        const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
        if (!code || code.length !== 6) {
          await reply(
            '❌ 사용법: /sell 005930 [사유] [메모]\n' +
            '사유: news | panic | correction | other (기본 other)\n' +
            '예: /sell 005930 news 실적 쇼크 확인'
          );
          break;
        }

        // ── 1단계: 보유 포지션 확인 ─────────────────────────────────────
        const shadows = loadShadowTrades();
        const target  = shadows.find(s => s.stockCode === code && isOpenShadowStatus(s.status));
        if (!target) {
          await reply(`⚠️ ${code} 보유 포지션 없음 — /pos 로 현재 포지션을 확인하세요.`);
          break;
        }

        // ── Shadow 모드 봉쇄 — 30건 검증 순도 보장 (데이터 오염 차단) ──
        // Shadow 포지션은 자동 규칙 평가로만 종결되어야 한다. 수동 청산이 섞이면
        // 조건 가중치 통계·실패 패턴 DB가 사용자 편향(후회회피·패닉)으로 오염된다.
        if (target.mode === 'SHADOW') {
          await reply(
            `🛡️ <b>[SHADOW] 수동 청산 차단</b> ${escapeHtml(target.stockName)}(${escapeHtml(code)})\n` +
            `이 포지션은 SHADOW 모드입니다 — 자동 규칙 평가만 허용됩니다.\n` +
            `(30건 검증 순도 보장 위해 SHADOW /sell 은 봉쇄됩니다)\n` +
            `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
          );
          break;
        }

        const qty = getRemainingQty(target);
        if (qty <= 0) {
          await reply(`⚠️ ${escapeHtml(target.stockName)}(${code}) 잔여 수량이 0입니다.`);
          break;
        }

        // ── 사유 코드 + 자유 메모 파싱 ────────────────────────────────
        const reasonArg = (args[1] ?? '').toLowerCase();
        const reasonCode: 'USER_NEWS' | 'USER_PANIC' | 'USER_CORRECTION' | 'USER_OTHER' =
          reasonArg === 'news' ? 'USER_NEWS'
          : reasonArg === 'panic' ? 'USER_PANIC'
          : reasonArg === 'correction' ? 'USER_CORRECTION'
          : 'USER_OTHER';
        const userNote = args.slice(2).join(' ').trim() || undefined;

        await reply(
          `🛒 <b>[수동 청산 요청]</b>\n` +
          `종목: ${escapeHtml(target.stockName)} (${escapeHtml(code)})\n` +
          `진입: ${target.shadowEntryPrice.toLocaleString()}원 × ${qty}주\n` +
          `사유: ${reasonCode}\n` +
          `현재가 조회 중...`
        );

        // ── 2단계: 현재가 조회 (실시간 → REST 폴백) ─────────────────────
        const rtPrice = getRealtimePrice(code);
        const currentPrice = rtPrice ?? await fetchCurrentPrice(code).catch(() => null);
        if (!currentPrice || currentPrice <= 0) {
          await reply(`❌ ${code} 현재가 조회 실패 — 매도 중단. KIS 토큰/네트워크 상태를 확인하세요.`);
          break;
        }
        const returnPct = ((currentPrice - target.shadowEntryPrice) / target.shadowEntryPrice) * 100;

        // ── 3단계: 전량 시장가 매도 주문 ──────────────────────────────
        const nowIso = new Date().toISOString();
        const sellRes = await placeKisSellOrder(
          target.stockCode,
          target.stockName,
          qty,
          'STOP_LOSS', // placeKisSellOrder 기존 reason 타입 재사용 — 상태는 MANUAL_EXIT 로 구분
        ).catch(err => {
          console.error('[TelegramBot] /sell placeKisSellOrder 실패:', err);
          return { ordNo: null, placed: false };
        });

        // ── 4단계: Shadow 상태 업데이트 — MANUAL_EXIT 태깅 + context 캡처 ──
        //   exitRuleTag = 'MANUAL_EXIT' 로 태깅되면 collectFlaggedTradeIds() 가 자동
        //   격리하여 조건 가중치·실패패턴 DB 학습에서 제외된다 (오염 차단).
        //   manualExitContext 는 Nightly Reflection 이 소비하는 학습 재료.
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
        // 본 채팅 응답과 독립적 경로(다른 dedupeKey) 이므로 실패해도 /sell 성공은 유지.
        evaluateAndAlertManualOverride().catch((e) =>
          console.error('[TelegramBot] manualOverrideMonitor 실패:', e instanceof Error ? e.message : e),
        );

        // ── 5단계: 결과 텔레그램 알림 ────────────────────────────────
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
          shadowSuffix
        );
        break;
      }

      case '/adjust_qty': {
        // 서버 장부(원장) ↔ 실계좌 수량이 불일치할 때 운영자가 직접 보정.
        // fills 가 있는 포지션은 보정 fill 을 추가해 SSOT(=getRemainingQty) 가
        // 목표치에 수렴하도록, fills 없는 레거시는 캐시 필드를 직접 세팅한다.
        // 포지션을 종결시키지는 않는다 — 청산은 /sell 전용.
        const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
        const targetQty = args[1] != null ? Number(args[1]) : NaN;
        const note = args.slice(2).join(' ').trim() || undefined;

        if (!code || code.length !== 6 || !Number.isInteger(targetQty) || targetQty < 0) {
          await reply(
            '❌ 사용법: /adjust_qty &lt;종목코드&gt; &lt;목표수량&gt; [메모]\n' +
            '예: /adjust_qty 005930 5 실계좌 대비 -3주 보정\n' +
            '• 목표수량은 0 이상 정수\n' +
            '• 포지션 종결 아님 — 청산은 /sell'
          );
          break;
        }

        const shadows = loadShadowTrades();
        const target = shadows.find(s => s.stockCode === code && isOpenShadowStatus(s.status));
        if (!target) {
          await reply(`⚠️ ${code} 보유 포지션 없음 — /pos 로 확인`);
          break;
        }

        const beforeFills = getRemainingQty(target);
        const beforeCache = target.quantity;
        const diff = targetQty - beforeFills;
        // SSOT 경로 판정 — BUY fill 이 1개라도 살아있으면 fills 보정으로 간다.
        const hasSsot = (target.fills ?? []).some(f => f.type === 'BUY' && f.status !== 'REVERTED');
        const nowIso = new Date().toISOString();

        if (diff === 0 && beforeCache === targetQty) {
          await reply(`ℹ️ ${escapeHtml(target.stockName)}(${code}) 수량 이미 ${targetQty}주 — 조정 불필요`);
          break;
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
              // pnl 은 의도적으로 생략 — 실손익이 아니라 장부 보정이므로 실현 PnL 집계에서 제외.
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
          break;
        }

        const afterQty = getRemainingQty(target);
        await reply(
          `🔧 <b>[수량 수동 보정]</b> ${escapeHtml(target.stockName)} (${escapeHtml(code)})\n` +
          `이전 잔량: ${beforeFills}주 → 이후: ${afterQty}주 (${diff > 0 ? '+' : ''}${diff}주)\n` +
          `방식: ${method}\n` +
          (note ? `메모: ${escapeHtml(note)}\n` : '') +
          `🏷️ MANUAL_ADJUST — PnL·학습 집계 격리` +
          (targetQty === 0 ? `\nℹ️ 잔량 0 — 보유 목록/보유 종목 수 집계에서 제외됩니다.` : '')
        );
        break;
      }

      case '/reconcile':
      case '/reconcile_qty': {
        // 안전 기본값: 인자 없이 호출하면 dry-run(점검만). apply 명시 시에만 실제 교정.
        // 사용법:
        //   /reconcile               → dry-run 점검 (변경 없음)
        //   /reconcile apply         → 실제 교정 적용
        //   /reconcile last          → 마지막 실행 결과 조회
        //   /reconcile status        → 마지막 실행 시각/모드/요약
        //   /reconcile push          → 서버 장부 현재 포지션을 강제 브로드캐스트 (다기기 동기화용)
        //   (구) /reconcile_qty 는 apply 모드 호환 유지
        const sub = (args[0] ?? '').toLowerCase();
        const isLegacyApply = cmd.toLowerCase() === '/reconcile_qty';
        const formatDetails = (details: typeof loadLastReconcileResult extends () => infer R ? R extends { details: infer D } ? D : never : never) => {
          const arr = details as Array<{ stockCode: string; stockName?: string; before: { qty: number; status: string }; after: { qty: number; status: string } }>;
          if (!arr || arr.length === 0) return '\n변경 사항 없음';
          const lines = arr.slice(0, 8).map(d =>
            `• ${escapeHtml(d.stockName ?? '')}(${escapeHtml(d.stockCode)}): ` +
            `${d.before.qty}주/${escapeHtml(d.before.status)} → ${d.after.qty}주/${escapeHtml(d.after.status)}`
          );
          const more = arr.length > 8 ? `\n...외 ${arr.length - 8}건` : '';
          return `\n${lines.join('\n')}${more}`;
        };

        if (sub === 'last') {
          const last = loadLastReconcileResult();
          if (!last) { await reply('📭 저장된 reconcile 결과가 없습니다. /reconcile 으로 점검을 실행하세요.'); break; }
          await reply(
            `🗂 <b>[마지막 reconcile 결과]</b>\n` +
            `모드: ${last.mode === 'apply' ? '🔴 APPLY (실제 교정)' : '🟡 DRY-RUN (점검만)'}\n` +
            `실행시각: ${new Date(last.ranAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n` +
            `검사: ${last.checked}건 | 교정${last.mode === 'dryRun' ? ' 후보' : ''}: ${last.fixed}건` +
            formatDetails(last.details as any)
          );
          break;
        }

        if (sub === 'status') {
          const last = loadLastReconcileResult();
          if (!last) { await reply('📭 reconcile 이력 없음 — /reconcile 으로 점검을 실행하세요.'); break; }
          const driftSeverity = last.fixed === 0 ? '🟢 깨끗' : last.fixed <= 3 ? '🟡 경미' : '🔴 심각';
          await reply(
            `📊 <b>[reconcile 상태]</b>\n` +
            `마지막 모드: ${last.mode === 'apply' ? 'APPLY' : 'DRY-RUN'}\n` +
            `마지막 실행: ${new Date(last.ranAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n` +
            `검사 ${last.checked}건 → 교정${last.mode === 'dryRun' ? ' 후보' : ''} ${last.fixed}건 (${driftSeverity})\n` +
            (last.fixed > 0 && last.mode === 'dryRun' ? '\n⚠️ DRY-RUN 결과에 변경 후보가 있습니다 — /reconcile apply 로 적용하세요.' : '')
          );
          break;
        }

        // PR-3 #9: /reconcile push — 서버 장부 스냅샷을 강제 브로드캐스트.
        // 운영자가 다른 기기에서 텔레그램 표시가 구 버전인지 의심할 때 사용.
        if (sub === 'push') {
          const shadowsNow = loadShadowTrades();
          const open = shadowsNow.filter(s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0);
          if (open.length === 0) {
            await reply('📤 <b>[Reconcile Push]</b>\n서버 장부: 활성 포지션 없음 — 동기화할 내용 없음.');
            break;
          }
          const lines = open.map(s => {
            const isShadow = s.mode !== 'LIVE';
            const modeTag = isShadow ? '[SHADOW]' : '[LIVE]';
            const realQty = getRemainingQty(s);
            const cacheDrift = s.quantity !== realQty ? ` ⚠️ 캐시 ${s.quantity}주 불일치` : '';
            return (
              `• ${modeTag} ${escapeHtml(s.stockName)}(${escapeHtml(s.stockCode)}) — ${realQty}주 @${s.shadowEntryPrice.toLocaleString()}원` +
              cacheDrift
            );
          });
          const hasShadow = open.some(s => s.mode !== 'LIVE');
          const suffix = hasShadow
            ? '\n⚠️ [SHADOW] 표시는 가상 잔고 — 실계좌 아님'
            : '';
          await reply(
            `📤 <b>[Reconcile Push]</b> 서버 장부 기준 현재 포지션 ${open.length}개\n` +
            `━━━━━━━━━━━━━━━━\n` +
            lines.join('\n') + suffix +
            `\n\n💡 수량 불일치 발견 시 <code>/reconcile apply</code>`,
          );
          break;
        }

        // ADR-0015: /reconcile live — KIS 실잔고 기준 LIVE 포지션 강제 동기화.
        //   /reconcile live          → KIS vs 로컬 dry-run 비교 (변경 없음)
        //   /reconcile live apply    → KIS 값으로 로컬 강제 덮어쓰기 (60s rate-limit)
        if (sub === 'live') {
          const sub2 = (args[1] ?? '').toLowerCase();
          const liveApply = sub2 === 'apply';

          if (liveApply) {
            const now = Date.now();
            if (now - _lastLiveReconcileApplyAt < 60_000) {
              const wait = Math.ceil((60_000 - (now - _lastLiveReconcileApplyAt)) / 1000);
              await reply(
                `⏱ <b>[Reconcile Live Apply 차단]</b>\n` +
                `최근 ${wait}초 이내 동일 명령 실행 — 오타 방지 가드. ` +
                `${wait}초 후 재시도하세요.`
              );
              break;
            }
            _lastLiveReconcileApplyAt = now;
          }

          await reply(
            liveApply
              ? '⚡ <b>[LIVE Reconcile APPLY]</b> KIS 잔고를 SSOT 로 로컬 포지션 동기화 중...'
              : '🔍 <b>[LIVE Reconcile DRY-RUN]</b> KIS vs 로컬 비교 중 — 변경 없이 결과만 표시합니다...'
          );

          try {
            const liveResult = await reconcileLivePositions({ dryRun: !liveApply });
            await reply(formatLiveReconcileResult(liveResult));
          } catch (e) {
            console.error('[TelegramBot] /reconcile live 실패:', e);
            await reply('❌ /reconcile live 실패 — 서버 로그를 확인하세요.');
          }
          break;
        }

        const apply = isLegacyApply || sub === 'apply';
        const banner = apply
          ? '🔄 Railway 서버 장부 기준 수량/상태 강제 동기화 (APPLY) 실행 중...'
          : '🔍 reconcile 점검 (DRY-RUN) 실행 중 — 변경 없이 후보만 표시합니다...';
        await reply(banner);

        try {
          const result = reconcileShadowQuantities(undefined, { dryRun: !apply });
          const headerEmoji = apply ? '✅' : '🔍';
          const headerLabel = apply ? '[수량 강제 동기화 완료]' : '[DRY-RUN 점검 결과]';
          const tail = apply
            ? ''
            : (result.fixed > 0
                ? `\n\n💡 실제 적용은 <code>/reconcile apply</code>`
                : '\n\n변경할 항목이 없어 apply 도 동일하게 무변경입니다.');

          await reply(
            `${headerEmoji} <b>${headerLabel}</b>\n` +
            `기준: Railway 서버 장부(fills → quantity/status)\n` +
            `검사: ${result.checked}건 | 교정${apply ? '' : ' 후보'}: ${result.fixed}건` +
            formatDetails(result.details as any) +
            tail
          );
        } catch (e) {
          console.error('[TelegramBot] /reconcile 실패:', e);
          await reply('❌ reconcile 실패 — 서버 로그를 확인하세요.');
        }
        break;
      }

      case '/scheduler':
      case '/schedule': {
        const sub = (args[0] ?? '').toLowerCase();
        if (sub === 'next') {
          await reply(formatSchedulerNext());
        } else if (sub === 'detail') {
          await reply(formatSchedulerDetail());
        } else if (sub === 'history') {
          const n = Number(args[1]);
          await reply(formatSchedulerHistory(Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 15));
        } else {
          await reply(formatSchedulerSummary());
        }
        break;
      }

      case '/learning_status': {
        try {
          const snapshot = getLearningStatus();
          await reply(formatLearningStatusMessage(snapshot));
        } catch (e) {
          console.error('[TelegramBot] /learning_status 실패:', e);
          await reply('❌ 학습 상태 조회 실패 — 서버 로그를 확인하세요.');
        }
        break;
      }

      case '/learning_history': {
        const raw = Number(args[0]);
        const days = Number.isFinite(raw) && raw >= 1 && raw <= 30 ? Math.floor(raw) : 7;
        try {
          const summary = getLearningHistory(days);
          await reply(formatLearningHistoryMessage(summary));
        } catch (e) {
          console.error('[TelegramBot] /learning_history 실패:', e);
          await reply('❌ 학습 이력 조회 실패 — 서버 로그를 확인하세요.');
        }
        break;
      }

      case '/report': {
        await reply('📄 일일 리포트 생성 중...');
        await generateDailyReport().catch(console.error);
        await reply('✅ 리포트 이메일 발송 완료');
        break;
      }

      case '/shadow': {
        // ADR/PR-1: Shadow 체결은 shadow-trades.json (fills SSOT) 에 있으므로
        // recommendations.json 을 읽는 getMonthlyStats() 대신 computeShadowMonthlyStats()
        // 로 교체. 과거 0건 표시 버그는 잘못된 저장소 참조가 원인이었다.
        const stats = computeShadowMonthlyStats();
        const pending = fillMonitor.getPendingOrders().filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
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
          `\n⚠️ SHADOW 모드 — 실계좌 잔고 아님`
        );
        break;
      }

      case '/pending': {
        const pending = fillMonitor.getPendingOrders().filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
        if (pending.length === 0) { await reply('✅ 미체결 주문 없음'); break; }
        const lines = pending.map(o =>
          `• ${escapeHtml(o.stockName)}(${escapeHtml(o.ordNo)}) ${o.quantity}주 @${o.orderPrice.toLocaleString()} [${o.pollCount}/${10}회]`
        ).join('\n');
        await reply(`⏳ <b>미체결 주문 (${pending.length}건)</b>\n${lines}`);
        break;
      }

      // ── 아이디어 4: 신규 명령어 ──────────────────────────────────────────────

      case '/pnl': {
        // PR-8: realized(이미 부분매도로 확정된 손익) + unrealized(잔량의 평가손익) 분리 표시.
        // 기존에는 unrealized 만 보여줘서 부분매도 누적 수익이 /pnl 에서 사라지는 혼란이 있었다.
        const shadows = getShadowTrades();
        const active = shadows.filter(s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0);
        if (active.length === 0) { await reply('📈 활성 포지션 없음'); break; }

        let totalUnrealizedPct = 0;
        let totalRealizedSum   = 0;
        let totalUnrealizedSum = 0;
        const lines: string[] = [];
        for (const s of active) {
          const price = await fetchCurrentPrice(s.stockCode).catch(() => null);
          if (!price) {
            lines.push(`• ${escapeHtml(s.stockName)} — 가격 조회 실패`);
            continue;
          }
          // fills SSOT 기반 실제 잔량 · 누적 실현손익.
          const realQty       = getRemainingQty(s);
          const originalQty   = s.originalQuantity ?? s.quantity ?? realQty;
          const realizedPnl   = getTotalRealizedPnl(s);                       // 누적 실현(원)
          const unrealizedPct = ((price - s.shadowEntryPrice) / s.shadowEntryPrice) * 100;
          const unrealizedAmt = (price - s.shadowEntryPrice) * realQty;       // 잔량 기준 평가손익
          // 총 투입원가 대비 종합 수익률 (realized + unrealized) / (originalQty × entryPrice)
          const totalCost     = originalQty * s.shadowEntryPrice;
          const totalPnlAmt   = realizedPnl + unrealizedAmt;
          const totalPct      = totalCost > 0 ? (totalPnlAmt / totalCost) * 100 : 0;

          totalUnrealizedPct += unrealizedPct;
          totalRealizedSum   += realizedPnl;
          totalUnrealizedSum += unrealizedAmt;

          const emoji = totalPct >= 0 ? '🟢' : '🔴';
          const targetDist = ((s.targetPrice - price) / price * 100).toFixed(1);
          const stopDist = ((price - (s.hardStopLoss ?? s.stopLoss)) / (s.hardStopLoss ?? s.stopLoss) * 100).toFixed(1);
          const cacheDrift = s.quantity !== realQty
            ? ` ⚠️ 캐시 ${s.quantity}주 불일치`
            : '';
          const modeTag = s.mode === 'LIVE' ? '' : '[SHADOW] ';
          const partialSoldQty = originalQty - realQty;

          // realized 블록은 부분매도가 실제로 있었을 때만 표기 (노이즈 억제).
          const realizedLine = partialSoldQty > 0
            ? `\n   실현: ${realizedPnl >= 0 ? '+' : ''}${Math.round(realizedPnl).toLocaleString()}원 (${partialSoldQty}주 부분매도 누적)`
            : '';
          lines.push(
            `${emoji} ${modeTag}${escapeHtml(s.stockName)} 총 ${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(1)}%` +
            ` (${totalPnlAmt >= 0 ? '+' : ''}${Math.round(totalPnlAmt).toLocaleString()}원)${cacheDrift}` +
            realizedLine +
            `\n   미실현: ${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(1)}% (잔여 ${realQty}주)` +
            `\n   목표까지 +${targetDist}% | 손절까지 -${stopDist}%`
          );
        }
        const avgUnrealizedPct = totalUnrealizedPct / active.length;
        const hasShadowPnl = active.some(s => s.mode !== 'LIVE');
        const pnlShadowNote = hasShadowPnl
          ? '\n⚠️ [SHADOW] 포함 — 실계좌 PnL 아님'
          : '';
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
          pnlShadowNote
        );
        break;
      }

      case '/pos': {
        const shadows = getShadowTrades();
        const active = shadows.filter(s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0);
        if (active.length === 0) { await reply('📋 보유 포지션 없음'); break; }

        const lines = active.map(s => {
          const isShadow = s.mode !== 'LIVE';
          const mode = isShadow ? '🟡' : '🔴';
          const modeTag = isShadow ? '[SHADOW] ' : '';
          const status = s.status === 'PENDING' ? '⏳' : s.status === 'ACTIVE' ? '✅' : '◐';
          // fills SSOT 기반 실제 잔량. 캐시(s.quantity)와 다르면 경보.
          const realQty = getRemainingQty(s);
          const cacheDrift = s.quantity !== realQty
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
          shadowNote
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
          `━━━━━━━━━━━━━━━━\n` +
          `${mhsEmoji} MHS: ${macro.mhs ?? 'N/A'}\n` +
          `${regimeEmoji} 레짐: ${macro.regime ?? 'N/A'}\n` +
          `📊 VKOSPI: ${macro.vkospi?.toFixed(1) ?? 'N/A'}\n` +
          `📊 VIX: ${macro.vix?.toFixed(1) ?? 'N/A'}\n` +
          `💱 USD/KRW: ${macro.usdKrw?.toLocaleString() ?? 'N/A'}\n` +
          `📉 MHS추세: ${macro.mhsTrend ?? 'N/A'}\n` +
          `🐻 Bear방어: ${macro.bearDefenseMode ? '🔴 ON' : '🟢 OFF'}\n` +
          `📈 FSS경보: ${macro.fssAlertLevel ?? 'N/A'}\n` +
          `━━━━━━━━━━━━━━━━\n` +
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

      case '/stage1_audit': {
        // BUG #1 — Stage 1 정량 필터 탈락 사유 분포. 어떤 조건이 후보를 가장 많이
        // 떨어뜨리는지 식별하여 임계값 튜닝 근거로 사용.
        const { getStage1RejectionCounts } = await import('../screener/pipelineHelpers.js');
        const s = getStage1RejectionCounts();
        if (s.totalEvaluated === 0) {
          await reply(
            `🔬 <b>[Stage 1 Audit]</b>\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `아직 실행된 스캔이 없습니다. /scan 또는 /krx_scan 실행 후 다시 시도.`,
          );
          break;
        }
        const rows = Object.entries(s.byReason)
          .sort(([, a], [, b]) => b - a)
          .map(([reason, count]) => {
            const pct = s.totalRejected > 0 ? (count / s.totalRejected) * 100 : 0;
            const bar = count === 0 ? '·'
              : pct >= 30 ? '🔴'
              : pct >= 15 ? '🟠'
              : pct >= 5  ? '🟡'
              : '🟢';
            return `${bar} ${reason.padEnd(20)} ${count.toString().padStart(3)}건 (${pct.toFixed(0)}%)`;
          })
          .join('\n');
        const passPct = s.totalEvaluated > 0 ? (s.totalPassed / s.totalEvaluated) * 100 : 0;
        await reply(
          `🔬 <b>[Stage 1 Audit — 정량 필터 탈락 분포]</b>\n` +
          `평가 ${s.totalEvaluated} · 통과 ${s.totalPassed} (${passPct.toFixed(0)}%) · 탈락 ${s.totalRejected}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `<pre>${rows}</pre>\n` +
          `<i>상위 원인이 30% 이상이면 임계값 완화 검토 — 예: OVEREXTENDED 집중 = 5일 ≥15% 상한이 엄격.</i>\n` +
          `<i>업데이트: ${new Date(s.lastUpdatedAt).toLocaleString('ko-KR')}</i>`,
        );
        break;
      }

      case '/krx_scan': {
        // KRX 종목조회(Stage1 양적 필터)가 실패했을 때 전체 발굴 파이프라인을
        // 강제 재실행한다. KRX OpenAPI 서킷 브레이커와 캐시를 초기화해 직전
        // 실패 상태를 해제한 뒤 Stage1+2+3을 한 번에 돌린다.
        if (getEmergencyStop()) {
          await reply('🔴 비상 정지 상태 — 스캔 불가. /reset 으로 해제 후 재시도.');
          break;
        }
        const before = getKrxOpenApiStatus();
        _resetKrxOpenApiBreaker();
        resetKrxOpenApiCache();
        resetKrxCache();
        await reply(
          `🇰🇷 <b>KRX 강제 스캔 트리거</b>\n` +
          `서킷: ${before.circuitState} (실패 ${before.failures}회) → RESET\n` +
          `캐시: 초기화 완료\n` +
          `Stage1(KRX 종목조회) → Stage2 → Stage3 재실행 중...`,
        );
        try {
          const macroState = loadMacroState();
          const regime = getLiveRegime(macroState);
          await runFullDiscoveryPipeline(regime, macroState);
          const after = getKrxOpenApiStatus();
          const wl   = loadWatchlist();
          await reply(
            `✅ <b>KRX 강제 스캔 완료</b>\n` +
            `서킷: ${after.circuitState} (실패 ${after.failures}회)\n` +
            `워치리스트: ${wl.length}개`,
          );
        } catch (e) {
          await reply(
            `❌ <b>KRX 강제 스캔 실패</b>\n` +
            `${escapeHtml(e instanceof Error ? e.message : String(e))}`,
          );
        }
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
          const sector = w.sector ? escapeHtml(w.sector) : '';
          const profile = w.profileType ? `[${escapeHtml(w.profileType)}]` : '';
          const cooldown = w.cooldownUntil && new Date(w.cooldownUntil) > new Date()
            ? '🧊 쿨다운중' : '';
          const addedDate = new Date(w.addedAt).toLocaleDateString('ko-KR', {
            month: 'short', day: 'numeric', timeZone: 'Asia/Seoul',
          });
          const meta = [gate, rrr, sector, profile].filter(Boolean).join(' · ');

          lines.push(
            `${focusMark}${manualMark} <b>${escapeHtml(w.name)}</b> (${escapeHtml(w.code)}) ${cooldown}\n` +
            `   💰 진입: ${w.entryPrice.toLocaleString()}원\n` +
            `   🛡️ 손절: ${w.stopLoss.toLocaleString()}원 | 🎯 목표: ${w.targetPrice.toLocaleString()}원\n` +
            `   📊 ${meta}\n` +
            `   📅 등록: ${addedDate}` +
            (w.memo ? ` | 💬 ${escapeHtml(w.memo)}` : '')
          );
        }

        await reply(
          `🎯 <b>[Track B — 매수 대상] ${focusList.length}개</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          lines.join('\n━━━━━━━━━━━━━━━━\n') +
          `\n━━━━━━━━━━━━━━━━\n` +
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

      case '/channel_health': {
        await reply('🧪 4개 채널 헬스체크를 실행합니다...');
        const result = await runChannelHealthCheck();
        const categories: AlertCategory[] = [
          AlertCategory.TRADE,
          AlertCategory.ANALYSIS,
          AlertCategory.INFO,
          AlertCategory.SYSTEM,
        ];
        const lines = categories.map((category) => {
          const item = result[category];
          const icon = item.ok ? '✅' : '❌';
          const reason = item.reason ? ` (${escapeHtml(item.reason)})` : '';
          const enabled = item.enabled ? '' : ' [disabled]';
          const configured = item.configured ? '' : ' [unconfigured]';
          return `${category}: ${icon}${enabled}${configured}${reason}`;
        });
        await reply(
          `🧪 <b>[채널 헬스체크 결과]</b>\n` +
          `${lines.join('\n')}`
        );
        break;
      }

      case '/channel_stats': {
        const raw = (args[0] ?? 'today').toLowerCase();
        const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
        const yesterdayKey = new Date(Date.now() - 24 * 60 * 60 * 1000)
          .toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
        const dateKey =
          raw === 'today'
            ? todayKey
            : raw === 'yesterday'
              ? yesterdayKey
              : raw;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          await reply('❌ 사용법: /channel_stats [YYYY-MM-DD|today|yesterday]');
          break;
        }

        const stats = getChannelStatsByDate(dateKey);
        const recentKeys = getRecentDateKeys(7);
        const categories: AlertCategory[] = [
          AlertCategory.TRADE,
          AlertCategory.ANALYSIS,
          AlertCategory.INFO,
          AlertCategory.SYSTEM,
        ];
        const lines = categories.map((category) => {
          const bucket = stats[category];
          return `${category}: sent=${bucket.sent}, skipped=${bucket.skipped}, failed=${bucket.failed}, digested=${bucket.digested}`;
        });
        const totalSent = categories.reduce((sum, category) => sum + stats[category].sent, 0);
        const totalFailed = categories.reduce((sum, category) => sum + stats[category].failed, 0);

        await reply(
          `📊 <b>[채널 통계 ${dateKey} KST]</b>\n` +
          `${lines.join('\n')}\n` +
          `total: sent=${totalSent}, failed=${totalFailed}\n` +
          `recent keys: ${recentKeys.length > 0 ? recentKeys.join(', ') : '(none)'}`
        );
        break;
      }

      case '/alert_replay': {
        const id = (args[0] ?? '').trim();
        const categoryRaw = (args[1] ?? '').trim().toUpperCase();
        if (!id) {
          await reply('❌ 사용법: /alert_replay <id> [TRADE|ANALYSIS|INFO|SYSTEM]');
          break;
        }

        const history = findAlertHistoryById(id);
        if (!history) {
          await reply(`❌ alert id not found: ${escapeHtml(id)}`);
          break;
        }

        const targetCategory = categoryRaw
          ? (Object.values(AlertCategory).includes(categoryRaw as AlertCategory)
            ? (categoryRaw as AlertCategory)
            : null)
          : history.category;

        if (!targetCategory) {
          await reply('❌ category must be one of TRADE, ANALYSIS, INFO, SYSTEM');
          break;
        }

        const replayMessage = `${history.message}\n\n<i>[replay: ${escapeHtml(id)}]</i>`;
        const msgId = await dispatchAlert(targetCategory, replayMessage, {
          priority: history.priority,
          dedupeKey: `replay:${id}:${Date.now()}`,
          delivery: 'immediate',
        }).catch(() => undefined);

        await reply(
          msgId !== undefined
            ? `✅ replay sent: ${escapeHtml(id)} -> ${targetCategory} (message_id: ${msgId})`
            : `❌ replay failed: ${escapeHtml(id)} -> ${targetCategory}`
        );
        break;
      }

      case '/alert_history': {
        const rawLimit = Number(args[0] ?? '8');
        const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, Math.floor(rawLimit))) : 8;
        const rows = getRecentAlertHistory(limit);
        if (rows.length === 0) {
          await reply('ℹ️ alert history is empty');
          break;
        }
        const lines = rows.map((row) => {
          const kst = new Date(row.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
          const status = row.success ? 'OK' : 'FAIL';
          return `${escapeHtml(row.id)} | ${row.category} | ${status} | ${kst}`;
        });
        await reply(
          `🗂️ <b>[Alert History 최근 ${rows.length}건]</b>\n` +
          `${lines.join('\n')}\n\n` +
          `<i>replay: /alert_replay &lt;id&gt; [TRADE|ANALYSIS|INFO|SYSTEM]</i>`
        );
        break;
      }

      case '/channel_test': {
        await reply(
          `🔍 <b>[채널 테스트]</b>\n` +
          `CHANNEL_ENABLED: ${process.env.CHANNEL_ENABLED ?? '미설정'}\n` +
          `TELEGRAM_CHAT_ID: ${process.env.TELEGRAM_CHAT_ID ?? '미설정'}\n` +
          `채널로 테스트 메시지를 전송합니다...`
        );
        const { sendChannelAlert } = await import('../alerts/telegramClient.js');
        const kstStr = new Date(Date.now() + 9 * 3_600_000)
          .toISOString().replace('T', ' ').slice(0, 19);
        const msgId = await sendChannelAlert(
          `🧪 <b>[채널 연결 테스트]</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `✅ QuantMaster Pro 채널 연결 성공\n` +
          `⏰ ${kstStr} KST`
        ).catch(() => null);
        await reply(
          msgId
            ? `✅ 채널 발송 성공 (message_id: ${msgId})`
            : `❌ 채널 발송 실패 — TELEGRAM_CHAT_ID 또는 봇 권한 확인 필요`
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
        const activeTrades  = shadows.filter(s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0).length;
        const geminiRuntime = getGeminiRuntimeState();
        // Yahoo 집계 상태 — 우선순위:
        //   1) 최근 스캔 결과(scanSummary) 가 있고 후보가 1개라도 있었으면 → 후보 대비 실패율로 판정
        //   2) 그렇지 않으면(스캐너 idle 또는 candidates=0) → fetchDailyBars 의 last-success heartbeat 로 fallback
        //   3) heartbeat 도 없으면 → '?'/UNKNOWN
        // (이전엔 candidates=0 일 때 무조건 UNKNOWN 이라 운영자에게 '?' 가 자주 보였다.)
        const yh = getYahooHealthSnapshot();
        let yahooStatus: 'OK' | 'DEGRADED' | 'DOWN' | 'STALE' | 'UNKNOWN';
        if (scanSummary && scanSummary.candidates > 0) {
          if (scanSummary.yahooFails === scanSummary.candidates) yahooStatus = 'DOWN';
          else if (scanSummary.yahooFails > scanSummary.candidates * 0.5) yahooStatus = 'DEGRADED';
          else yahooStatus = 'OK';
        } else {
          // 스캔 후보가 없을 땐 heartbeat 기준으로 보고 — UNKNOWN 대신 실제 가용성 표시
          yahooStatus = yh.status; // 'OK' | 'STALE' | 'DOWN' | 'UNKNOWN'
        }

        // ── 서브시스템 프로브 병렬 실행 (타임아웃 3초) ──────────────────────
        const volumeCheck = verifyVolumeMount();
        const probeTimeout = (ms: number) => new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms));
        const withTimeout = <T>(p: Promise<T>, ms = 3000) =>
          Promise.race([p, probeTimeout(ms)]);
        const probes = await Promise.allSettled([
          withTimeout(guardedFetch('https://query1.finance.yahoo.com/v7/finance/chart/^KS11?interval=1d&range=1d')
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
        // Railway 가 자동 주입하는 배포 커밋. 실제 재배포 여부를 운영자가 즉시 확인 가능.
        const commitSha = (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? 'unknown').slice(0, 7);
        await reply(
          `🩺 <b>[파이프라인 헬스체크]</b> (uptime ${uptimeHours}h / mem ${memMB}MB / build ${commitSha})\n` +
          `판정: ${verdict}\n` +
          `─────────────────────\n` +
          `워치리스트: ${watchlist.length}개 | 활성 포지션: ${activeTrades}개\n` +
          `자동매매: ${autoEnabled ? '✅ 켜짐' : '❌ 꺼짐'} (${autoMode})\n` +
          `KIS 토큰: ${kisHours > 0 ? `✅ ${kisHours}시간 남음` : '❌ 만료'}` +
          (realDataHours > 0 ? ` | 실데이터: ✅ ${realDataHours}h` : '') + `\n` +
          `Yahoo probe: ${probeLabel(yahooProbe)}\n` +
          `DART probe: ${probeLabel(dartProbe)}\n` +
          `Gemini: ${geminiRuntime.status}${geminiRuntime.reason ? ` (${geminiRuntime.reason})` : ''}\n` +
          `Volume: ${volumeCheck.ok ? '✅ 마운트됨' : `❌ ${volumeCheck.error ?? '미마운트'}`}\n` +
          `Yahoo 집계: ${
            yahooStatus === 'OK' ? '✅'
            : yahooStatus === 'DEGRADED' ? '⚠️ 부분장애'
            : yahooStatus === 'STALE' ? `🟡 STALE (마지막 성공 ${yh.lastSuccessAt > 0 ? new Date(yh.lastSuccessAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) : 'N/A'})`
            : yahooStatus === 'DOWN' ? `❌ 불가 (연속 실패 ${yh.consecutiveFailures}회)`
            : '? 미수집'
          }\n` +
          `마지막 스캔: ${lastScanAt} | 마지막 신호: ${lastBuyAt}\n` +
          `일일손실: ${dailyLossPct.toFixed(1)}% / 한도 ${dailyLossLimit}%\n` +
          `비상정지: ${emergencyStop ? '🛑 활성' : '✅ 해제'}\n` +
          `실시간호가: ${ss.connected ? `✅ ${ss.subscribedCount}종목` : '❌ 미연결'}\n` +
          `─────────────────────\n` +
          `<i>/refresh_token — KIS 토큰 강제 갱신</i>`
        );
        break;
      }

      case '/dxy_intraday':
      case '/dxy': {
        // P3-7: DXY 인트라데이 스냅샷. Yahoo 5m 우선, ALPHA_VANTAGE_API_KEY 시 fallback.
        const { getDxyIntradaySnapshot } = await import('../alerts/dxyMonitor.js');
        const snap = await getDxyIntradaySnapshot();
        if (!snap) {
          await reply(
            '💱 <b>[DXY 인트라데이]</b>\n' +
            '데이터 소스 모두 실패 — Yahoo Finance 와 Alpha Vantage 모두 응답 없음.\n' +
            '<i>ALPHA_VANTAGE_API_KEY 환경변수를 설정하면 fallback 이 활성화됩니다.</i>'
          );
          break;
        }
        const sign = snap.changePct >= 0 ? '+' : '';
        const arrow = snap.changePct >= 0 ? '▲' : '▼';
        const stale = snap.source === 'YAHOO'
          ? `최신 봉: ${new Date(snap.asOf).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}`
          : `Alpha Vantage 단일 스냅샷 (변화율 비교 불가)`;
        await reply(
          `💱 <b>[DXY 인트라데이]</b> 소스: ${snap.source}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `${arrow} DXY ${snap.last.toFixed(2)} | ${snap.windowMinutes}분 윈도우 ${sign}${snap.changePct.toFixed(2)}%\n` +
          `${stale}\n\n` +
          `<i>임계 ±${process.env.DXY_INTRADAY_THRESHOLD ?? '0.4'}% 돌파 시 자동 ANALYSIS 채널 + 개인 채팅 발송</i>`
        );
        break;
      }

      case '/news_patterns':
      case '/news_lag': {
        // P3-6: 베이지안으로 학습된 (newsType × sector) lag 분포 카탈로그.
        // T+5 결산이 누적될수록 정확도가 올라간다. 표본 < 3 인 항목은 표시 제외.
        const { listAllOptimalWindows } = await import('../learning/newsLagBayesian.js');
        const windows = listAllOptimalWindows(3);
        if (windows.length === 0) {
          await reply(
            '📡 <b>[뉴스-수급 시차 학습]</b>\n' +
            '아직 표본 ≥3 인 (newsType × sector) 조합이 없습니다.\n' +
            '<i>T+5 결산이 누적될수록 카탈로그가 채워집니다.</i>'
          );
          break;
        }
        const top = windows.slice(0, 12);
        const lines = top.map(w =>
          `• <b>${escapeHtml(w.newsType)} → ${escapeHtml(w.sector)}</b>\n` +
          `   peak ${w.meanLagDays}d ± ${w.stdDays}d ` +
          `(95% [${w.ci95LowDays}, ${w.ci95HighDays}d], n=${w.sampleSize})`
        );
        await reply(
          `📡 <b>[뉴스-수급 시차 카탈로그] ${windows.length}개</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          lines.join('\n') +
          (windows.length > 12 ? `\n...외 ${windows.length - 12}개` : '') +
          `\n\n<i>모델: Normal-Inverse-Gamma conjugate posterior on lag(business days)</i>`
        );
        break;
      }

      case '/risk_budget':
      case '/risk': {
        // 사용자 P1-2: 계좌 레벨 리스크 예산 + Fractional Kelly 가시성.
        // signalScanner 게이트와 동일 로직 — 운영자가 "지금 신규 진입이 왜 막히는지" 즉시 진단.
        const settings = loadTradingSettings();
        const totalAssets = settings.startingCapital ?? 0;
        const budget = getAccountRiskBudget({ totalAssets });
        await reply(
          formatAccountRiskBudget(budget) +
          `\n\n<i>총 자본 기준: ${(totalAssets / 10_000).toLocaleString()}만원 (settings.startingCapital)\n` +
          `Fractional Kelly: STRONG_BUY ≤0.5 / BUY ≤0.25 / HOLD ≤0.1</i>`
        );
        break;
      }

      case '/kelly_surface': {
        // Idea 9: signalType × regime 버킷별 (p, b) 학습 상태 + 신뢰구간 폭.
        await reply(formatKellySurface());
        break;
      }

      case '/regime_coverage': {
        // Idea 3: 레짐별 샘플 수 / 목표 / 부족 상태.
        await reply(formatRegimeCoverage());
        break;
      }

      case '/ledger': {
        // Idea 2: Parallel Universe Ledger Sharpe 비교.
        const stats = getUniverseStats();
        const lines = ['🌌 <b>[Parallel Universe Ledger]</b>', '━━━━━━━━━━━━━━━━'];
        for (const s of stats) {
          lines.push(
            `Universe ${s.universe} (${s.label})\n` +
            `   n=${s.closedSamples} · win=${(s.winRate * 100).toFixed(0)}% · μ=${s.meanReturn.toFixed(2)}% · σ=${s.stdReturn.toFixed(2)}%\n` +
            `   Sharpe=${s.sharpe.toFixed(2)} · PF=${s.profitFactor === null ? 'n/a' : s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)}`,
          );
        }
        lines.push('━━━━━━━━━━━━━━━━');
        lines.push('<i>Universe A 는 실 진입과 동형. B/C 는 대안 세팅 학습 표본.</i>');
        await reply(lines.join('\n'));
        break;
      }

      case '/counterfactual': {
        // Idea 4: Gate 탈락 후보의 30/60/90일 분포 통계.
        const lines = ['🔬 <b>[Counterfactual Shadow — 탈락 후보 추적]</b>', '━━━━━━━━━━━━━━━━'];
        for (const h of [30, 60, 90] as const) {
          const s = getCounterfactualStats(h);
          if (!s) {
            lines.push(`${h}일: 샘플 부족`);
            continue;
          }
          lines.push(
            `${h}일: n=${s.samples} · μ=${s.mean.toFixed(2)}% · median=${s.median.toFixed(2)}% · win=${(s.winRate * 100).toFixed(0)}% · σ=${s.stdDev.toFixed(2)}%`,
          );
        }
        lines.push('━━━━━━━━━━━━━━━━');
        lines.push('<i>만약 수익률 분포가 통과 샘플과 유의하게 다르지 않다면 Gate 기준이 과잉.</i>');
        await reply(lines.join('\n'));
        break;
      }

      case '/kelly': {
        // Idea 5 — 종목별 Kelly 헬스 카드.
        // entryKellySnapshot(Idea 1) 을 기준으로 진입 시점 대비 현재 Kelly/IPS 상태의
        // 상대 변화(decay)·레짐 전이를 한눈에 보고 HOLD / TRIM / EXIT 권고를 제시한다.
        const shadows = getShadowTrades();
        const dampener = loadKellyDampenerState();
        const macro = loadMacroState();
        const liveRegime = getLiveRegime(macro);
        await reply(
          formatKellyHealthCards({
            shadows,
            currentIps: dampener.ips,
            currentRegime: liveRegime,
            currentIpsMultiplier: dampener.multiplier,
          }),
        );
        break;
      }

      case '/circuits': {
        // KIS / KRX 회로 상태 가시성 — 저녁 추천 스캔이 회로 차단으로 인해 빈
        // 결과가 나오는 현상을 즉시 진단하기 위한 명령. (사용자 P3-8 대응)
        const kisCircuits = getCircuitBreakerStats();
        const krxStatus = getKrxOpenApiStatus();
        const kisLines = kisCircuits.length === 0
          ? '  (이력 없음)'
          : kisCircuits
              .map(c => {
                const open = c.openFor > 0;
                const tag = open ? `🔴 OPEN (${Math.ceil(c.openFor / 1000)}s 남음)` : '🟢 CLOSED';
                return `  ${tag} ${c.trId} (실패 ${c.consecutiveFailures}회)`;
              })
              .join('\n');
        await reply(
          `⚡ <b>[회로 차단기 상태]</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `<b>KIS</b>:\n${kisLines}\n\n` +
          `<b>KRX OpenAPI</b>: ${krxStatus.circuitState === 'OPEN' ? '🔴 OPEN' : '🟢 ' + krxStatus.circuitState} ` +
          `(실패 ${krxStatus.failures}회)\n\n` +
          `<i>/reset_circuits — 모든 KIS 회로 즉시 해제 (저녁 스캔 전 권장)</i>`
        );
        break;
      }

      case '/reset_circuits': {
        // 운영자 수동 회로 reset — 저녁 추천 스캔(KST 16~22) 전 일괄 해제로
        // 종목 후보 호출이 회로 차단으로 묻히는 케이스를 우회한다.
        const cleared = resetKisCircuits();
        // KRX OpenAPI 회로도 함께 reset.
        try {
          _resetKrxOpenApiBreaker();
        } catch (e) {
          console.warn('[TelegramBot] KRX 회로 reset 실패:', e instanceof Error ? e.message : e);
        }
        await reply(
          `🔧 <b>[회로 차단 해제]</b>\n` +
          `해제된 KIS 회로: ${cleared}개\n` +
          `KRX OpenAPI 회로: 함께 reset 시도\n` +
          `<i>저녁 스캔/추천 작업 전 호출 권장. 이후 5xx 가 다시 누적되면 재차 차단됩니다.</i>`
        );
        break;
      }

      case '/ai_status': {
        const budget = getBudgetState();
        const circuit = getGeminiCircuitStats();
        const runtime = getGeminiRuntimeState();
        await reply(
          `🤖 <b>[AI 상태]</b>\n` +
          `런타임: ${runtime.status}${runtime.reason ? ` (${runtime.reason})` : ''}\n` +
          `호출처: ${runtime.caller ?? '-'}\n` +
          `최근시각: ${runtime.updatedAt ?? '-'}\n` +
          `서킷: ${circuit.state} (실패 ${circuit.failures}회)\n` +
          `예산: $${budget.spentUsd.toFixed(2)} / $${budget.budgetUsd.toFixed(2)} (${budget.pctUsed.toFixed(1)}%)\n` +
          `차단: ${budget.blocked ? 'ON' : 'OFF'}`
        );
        break;
      }

      case '/todaylog': {
        // 오늘 KST 00:00 ~ 현재까지의 알림 감사 로그를 티어·카테고리별 집계.
        const nowMs = Date.now();
        const kstNow = new Date(nowMs + 9 * 3_600_000);
        const kstMidnight = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3_600_000;
        const entries = readAlertAuditRange(kstMidnight, nowMs);
        if (entries.length === 0) {
          await reply('📋 오늘 기록된 알림이 없습니다.');
          break;
        }
        const byTier: Record<string, number> = { T1_ALARM: 0, T2_REPORT: 0, T3_DIGEST: 0 };
        const byCat: Map<string, number> = new Map();
        for (const e of entries) {
          byTier[e.tier] = (byTier[e.tier] ?? 0) + 1;
          byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
        }
        const topCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        await reply(
          `📋 <b>[오늘 알림 로그] ${entries.length}건</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🚨 T1 ALARM: ${byTier.T1_ALARM}건\n` +
          `📊 T2 REPORT: ${byTier.T2_REPORT}건\n` +
          `📋 T3 DIGEST: ${byTier.T3_DIGEST}건\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `<b>카테고리 Top ${topCats.length}:</b>\n` +
          topCats.map(([k, v]) => `  ${k}: ${v}건`).join('\n')
        );
        break;
      }

      case '/digest_on': {
        setDigestEnabled(true);
        await reply('📋 다이제스트 수신 ON — 30분 단위로 요약 발송됩니다.');
        break;
      }

      case '/digest_off': {
        setDigestEnabled(false);
        await reply(
          '🔕 다이제스트 수신 OFF — T3 알림은 Telegram 으로 발송되지 않습니다.\n' +
          '<i>기록은 계속 쌓이며 /todaylog 로 조회 가능.</i>'
        );
        break;
      }

      case '/digest_status': {
        await reply(
          `📋 다이제스트 상태: <b>${isDigestEnabled() ? 'ON' : 'OFF'}</b>\n` +
          `<i>/digest_on · /digest_off 로 토글</i>`
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

      case '/reconnect_ws': {
        // ── 1단계: 현재 연결 상태 보고 ─────────────────────────────────
        const before = getStreamStatus();
        const lastPong = before.lastPongAt
          ? new Date(before.lastPongAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
          : '없음';
        await reply(
          `🔌 <b>[KIS WebSocket 재연결 요청]</b>\n` +
          `현재 상태: ${before.connected ? '✅ 연결됨' : '❌ 끊김'}\n` +
          `구독 종목: ${before.subscribedCount}개 | 활성 가격: ${before.activePrices}개\n` +
          `재연결 카운트: ${before.reconnectCount}\n` +
          `마지막 PONG: ${lastPong}\n` +
          `기존 연결 종료 → 1초 후 재연결 시도...`
        );

        // ── 2단계: 기존 연결 종료 ───────────────────────────────────
        try {
          stopKisStream();
        } catch (e) {
          console.error('[TelegramBot] /reconnect_ws stopKisStream 실패:', e);
        }

        // ── 3단계: 1초 대기 후 재연결 ───────────────────────────────
        await new Promise(resolve => setTimeout(resolve, 1000));
        const watchlist = loadWatchlist();
        // KIS 단일 세션 구독 한도(41) — gate score 상위 순으로 절삭. 초과 시 1006 강제 종료 방지.
        const codes = [...watchlist]
          .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0))
          .slice(0, MAX_SUBSCRIPTIONS)
          .map(w => w.code);
        if (codes.length === 0) {
          await reply('⚠️ 워치리스트가 비어 있어 재연결할 구독 종목이 없습니다. /add 또는 /krx_scan 후 재시도하세요.');
          break;
        }

        try {
          await startKisStream(codes);
        } catch (e) {
          await reply(
            `❌ <b>KIS WebSocket 재연결 실패</b>\n` +
            `${escapeHtml(e instanceof Error ? e.message : String(e))}`
          );
          break;
        }

        // ── 4단계: 결과 보고 ────────────────────────────────────────
        const after = getStreamStatus();
        await reply(
          `✅ <b>[KIS WebSocket 재연결 완료]</b>\n` +
          `연결: ${after.connected ? '✅ OK' : '🟡 연결 중 (핸드셰이크 진행)'}\n` +
          `구독: ${after.subscribedCount}개 / 워치리스트 ${codes.length}개\n` +
          `재연결 카운트: ${after.reconnectCount}`
        );
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
