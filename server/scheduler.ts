// server/scheduler.ts — cron 스케줄러 모듈
// server.ts에서 분리: 13개 cron 작업을 한 곳에서 관리
import cron from 'node-cron';
import { sendTelegramAlert } from './alerts/telegramClient.js';
import { tradingOrchestrator } from './orchestrator/tradingOrchestrator.js';
import { pollDartDisclosures, fastDartCheck } from './alerts/dartPoller.js';
import { pollBearRegime } from './alerts/bearRegimeAlert.js';
import { pollIpsAlert } from './alerts/ipsAlert.js';
import { pollMhsMorningAlert } from './alerts/mhsAlert.js';
import {
  generateWeeklyReport,
  sendWatchlistBriefing,
  sendIntradayCheckIn,
  sendPreMarketReport,
  sendIntradayMarketReport,
  sendPostMarketReport,
} from './alerts/reportGenerator.js';
import { checkDailyLossLimit } from './emergency.js';
import { refreshMarketRegimeVars } from './trading/marketDataRefresh.js';
import { loadMacroState } from './persistence/macroStateRepo.js';
import { getLiveRegime } from './trading/regimeBridge.js';
import { runFullDiscoveryPipeline } from './screener/universeScanner.js';
import { cleanupWatchlist } from './screener/watchlistManager.js';
import { runGlobalScanAgent } from './alerts/globalScanAgent.js';
import { trackPendingRecords } from './learning/newsSupplyLogger.js';
import { checkFomcProximityAlert } from './trading/fomcCalendar.js';
import { runBacktest } from './learning/backtestEngine.js';
import { loadShadowTrades, saveShadowTrades } from './persistence/shadowTradeRepo.js';
import { updateShadowResults } from './trading/exitEngine.js';
import { runDynamicUniverseExpansion } from './screener/dynamicUniverseExpander.js';
import { loadWatchlist } from './persistence/watchlistRepo.js';
import { getEmergencyStop, getDailyLossPct } from './state.js';
import { getLastScanAt } from './orchestrator/adaptiveScanScheduler.js';
import { getLastBuySignalAt, getLastScanSummary } from './trading/signalScanner.js';
import { getKisTokenRemainingHours } from './clients/kisClient.js';
import { isOpenShadowStatus } from './trading/entryEngine.js';
import { runPipelineDiagnosis } from './trading/pipelineDiagnosis.js';
import { cleanupOldTraceFiles } from './trading/scanTracer.js';
import { generateDailyPickReport } from './alerts/stockPickReporter.js';

export function startScheduler() {
  // ─── TradingDayOrchestrator — 장 사이클 State Machine ──────────────────
  // cron은 1분 간격 — INTRADAY 실제 스캔 빈도는 adaptiveScanScheduler가 결정.
  // ① UTC 23:xx (= KST Mon-Fri 08:xx, 동시호가/장 전 준비) — Sun-Thu UTC
  cron.schedule('*/1 23 * * 0-4', async () => {
    if (getEmergencyStop()) { console.warn('[Orchestrator] 비상 정지 — tick 건너뜀'); return; }
    await tradingOrchestrator.tick().catch(console.error);
    if (process.env.AUTO_TRADE_ENABLED === 'true') {
      await checkDailyLossLimit().catch(console.error);
    }
  }, { timezone: 'UTC' });

  // ② UTC 00:xx~08:xx (= KST Mon-Fri 09:xx~17:xx, 장중/마감/리포트) — Mon-Fri UTC
  cron.schedule('*/1 0-8 * * 1-5', async () => {
    if (getEmergencyStop()) { console.warn('[Orchestrator] 비상 정지 — tick 건너뜀'); return; }
    await tradingOrchestrator.tick().catch(console.error);
    if (process.env.AUTO_TRADE_ENABLED === 'true') {
      await checkDailyLossLimit().catch(console.error);
    }
  }, { timezone: 'UTC' });

  // 아이디어 6: DART 공시 30분 폴링 — 장중 08:30~18:00 KST (UTC 23:30~09:00)
  // 오케스트레이터와 독립 실행 (AUTO_TRADE_ENABLED 무관)
  cron.schedule('*/30 23,0,1,2,3,4,5,6,7,8,9 * * 1-5', async () => {
    await pollDartDisclosures().catch(console.error);
  }, { timezone: 'UTC' });

  // 아이디어 11: DART 고속 폴링 — 장중 1분 간격, 고영향 키워드 즉시 반응
  // UTC 23:xx (KST 08:xx) + UTC 00-09 (KST 09-18) 커버
  cron.schedule('* 23 * * 0-4', async () => {
    await fastDartCheck().catch(console.error);
  }, { timezone: 'UTC' });
  cron.schedule('* 0-9 * * 1-5', async () => {
    await fastDartCheck().catch(console.error);
  }, { timezone: 'UTC' });

  // 아이디어 10: Bear Regime Push 알림 — 15분 간격 폴링, 장중 KST 08:00~17:00
  // UTC 23:xx (KST 08:xx) + UTC 00-08 (KST 09-17) 커버
  cron.schedule('*/15 23 * * 0-4', async () => {
    await pollBearRegime().catch(console.error);
  }, { timezone: 'UTC' });
  cron.schedule('*/15 0-8 * * 1-5', async () => {
    await pollBearRegime().catch(console.error);
  }, { timezone: 'UTC' });

  // 아이디어 11: IPS 변곡점 경보 — 15분 간격 24/7 폴링 (장 외 시간 포함)
  cron.schedule('*/15 * * * *', async () => {
    await pollIpsAlert().catch(console.error);
  }, { timezone: 'UTC' });

  // 아이디어 8: MHS 임계값 모닝 알림 — 평일 오전 09:00 KST (UTC 00:00 Mon-Fri)
  // RED 레짐(MHS < 40) 또는 GREEN 레짐 전환(MHS ≥ 70) 시 즉시 Telegram 알림
  cron.schedule('0 0 * * 1-5', async () => {
    await pollMhsMorningAlert().catch(console.error);
  }, { timezone: 'UTC' });

  // 주간 리포트 — 매주 금요일 16:30 KST (UTC 07:30)
  cron.schedule('30 7 * * 5', async () => {
    await generateWeeklyReport().catch(console.error);
  }, { timezone: 'UTC' });

  // 일일 종목 픽 리포트 — 평일 16:30 KST (UTC 07:30, 월~금)
  // TELEGRAM_PICK_CHANNEL_ID 채널로 발송 (구독자용 픽 채널)
  cron.schedule('30 7 * * 1-5', async () => {
    await generateDailyPickReport().catch(console.error);
  }, { timezone: 'UTC' });

  // 시장 지표 자동 갱신 — 평일 08:40 KST (UTC 23:40, 일~목) + 장 마감 후 15:30 KST (UTC 06:30, 월~금)
  // KOSPI/SPX/DXY/USD-KRW Yahoo Finance → classifyRegime() 7축 갱신
  cron.schedule('40 23 * * 0-4', async () => {
    await refreshMarketRegimeVars().catch(console.error);
  }, { timezone: 'UTC' });
  cron.schedule('30 6 * * 1-5', async () => {
    await refreshMarketRegimeVars().catch(console.error);
  }, { timezone: 'UTC' });

  // 장 시작 전 워치리스트 브리핑 — 평일 08:50 KST (UTC 23:50, 일~목 UTC)
  // FOMC 근접도 경보도 함께 발송 (하루 1회, NORMAL 구간이면 스킵)
  cron.schedule('50 23 * * 0-4', async () => {
    await sendWatchlistBriefing().catch(console.error);
    await checkFomcProximityAlert().catch(console.error);
  }, { timezone: 'UTC' });

  // 장전 시장 브리핑 — 평일 08:30 KST (UTC 23:30, 일~목 UTC)
  // 간밤 글로벌 시장 + MHS + USD/KRW + 섹터 경보 + AI 전망 요약
  cron.schedule('30 23 * * 0-4', async () => {
    await sendPreMarketReport().catch(console.error);
  }, { timezone: 'UTC' });

  // 장중 시장 현황 레포트 — 평일 12:00 KST (UTC 03:00, 월~금 UTC)
  // KOSPI 실시간 + 오전 거래 요약 + 활성 포지션 현황
  cron.schedule('0 3 * * 1-5', async () => {
    await sendIntradayMarketReport().catch(console.error);
  }, { timezone: 'UTC' });

  // 장마감 시장 요약 레포트 — 평일 15:35 KST (UTC 06:35, 월~금 UTC)
  // KOSPI 종가 + 당일 거래 결과 + 월간 통계 + AI 내일 전망
  cron.schedule('35 6 * * 1-5', async () => {
    await sendPostMarketReport().catch(console.error);
  }, { timezone: 'UTC' });

  // 장중 중간 점검 — 오전 11:30 KST (UTC 02:30, 월~금 UTC)
  cron.schedule('30 2 * * 1-5', async () => {
    await sendIntradayCheckIn('midday').catch(console.error);
  }, { timezone: 'UTC' });

  // 마감 전 점검 — 오후 14:00 KST (UTC 05:00, 월~금 UTC)
  cron.schedule('0 5 * * 1-5', async () => {
    await sendIntradayCheckIn('preclose').catch(console.error);
  }, { timezone: 'UTC' });

  // 자동 발굴 파이프라인 — 평일 08:35 KST (UTC 23:35, 일~목)
  // Stage1(Yahoo스캔) → Stage2(Gate+섹터) → Stage3(Gemini배치) → 워치리스트 등록
  cron.schedule('35 23 * * 0-4', async () => {
    const macroState = loadMacroState();
    const regime     = getLiveRegime(macroState);
    await runFullDiscoveryPipeline(regime, macroState).catch(console.error);
  }, { timezone: 'UTC' });

  // 워치리스트 자동 정리 — 평일 16:00 KST (UTC 07:00, 월~금)
  // expiresAt 초과 항목 제거 + 최대 20개 유지
  cron.schedule('0 7 * * 1-5', async () => {
    await cleanupWatchlist().catch(console.error);
  }, { timezone: 'UTC' });

  // 새벽 글로벌 스캔 에이전트 — 매일 KST 06:00 (UTC 21:00, 일~목)
  // S&P500·나스닥·다우·VIX·EWY·ITA·SOXX·XLE·WOOD + Gemini 요약 + Telegram 알림
  // Layer 13(EWY 수급) · Layer 14(섹터ETF) + 공급망 역추적(Gemini Search) 포함
  cron.schedule('0 21 * * 0-4', async () => {
    await runGlobalScanAgent().catch(console.error);
  }, { timezone: 'UTC' });

  // 뉴스-수급 시차 DB 추적 — 평일 KST 09:10 (UTC 00:10, 월~금)
  // 경보 발생 후 T+1·T+3·T+5 거래일 경과 레코드의 EWY·주가 변화율 자동 채움
  cron.schedule('10 0 * * 1-5', async () => {
    await trackPendingRecords().catch(console.error);
  }, { timezone: 'UTC' });

  // OHLCV 기반 백테스트 — 매주 토요일 KST 08:00 (UTC 23:00 금요일)
  // 전체 추천 이력을 Yahoo 일봉으로 재검증: Sharpe·MDD·WIN률 실계산 + Telegram 발송
  cron.schedule('0 23 * * 5', async () => {
    await runBacktest().catch(console.error);
  }, { timezone: 'UTC' });

  // ─── Shadow Trade 자동 청산 — 장중 5분 간격 (브라우저 독립) ──────────────────
  // 클라이언트 resolveShadowTrade 루프의 서버 측 대응.
  // AUTO_TRADE_ENABLED 무관하게 항상 동작하여, 브라우저 종료 시에도
  // Shadow 포지션 목표가/손절가 도달 시 자동 청산 처리.
  // KST 09:00~15:30 = UTC 00:00~06:30 (Mon-Fri)
  cron.schedule('*/5 0-6 * * 1-5', async () => {
    const shadows = loadShadowTrades();
    const activeShadows = shadows.filter(
      (s) => s.status === 'PENDING' || s.status === 'ACTIVE'
    );
    if (activeShadows.length === 0) return;
    try {
      await updateShadowResults(shadows, getLiveRegime(loadMacroState()));
      saveShadowTrades(shadows);
    } catch (e) {
      console.error('[Scheduler] Shadow trade resolution 실패:', e);
    }
  }, { timezone: 'UTC' });

  // 아이디어 5: 탈락 사유 리포트는 tradingOrchestrator openAuction(08:45 KST) 직후 발송으로 이전
  // (기존 16:10 cron 제거 — autoPopulateWatchlist 완료 직후가 가장 신선한 데이터)

  // 아이디어 6: 동적 유니버스 확장 — 매주 토요일 09:00 KST (UTC 00:00 토요일)
  // KIS API 52주 신고가 + 외국인 순매수 상위 → STOCK_UNIVERSE 임시 확장
  cron.schedule('0 0 * * 6', async () => {
    await runDynamicUniverseExpansion().catch(console.error);
  }, { timezone: 'UTC' });

  // 파이프라인 헬스체크 — 매일 KST 09:05 (UTC 00:05, 월~금) Telegram 자동 전송
  cron.schedule('5 0 * * 1-5', async () => {
    try {
      const watchlist    = loadWatchlist();
      const shadows      = loadShadowTrades();
      const emergencyStop = getEmergencyStop();
      const dailyLossPct  = getDailyLossPct();
      const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
      const autoEnabled   = process.env.AUTO_TRADE_ENABLED === 'true';
      const autoMode      = process.env.AUTO_TRADE_MODE ?? 'SHADOW';
      const kisHours      = getKisTokenRemainingHours();
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

      let verdict: string;
      if (emergencyStop)                             verdict = '🔴 EMERGENCY_STOP';
      else if (dailyLossPct >= dailyLossLimit)       verdict = '🔴 DAILY_LOSS_LIMIT';
      else if (watchlist.length === 0)               verdict = '🔴 WATCHLIST_EMPTY';
      else if (!autoEnabled)                         verdict = '🟡 AUTO_TRADE_DISABLED';
      else if (autoMode === 'LIVE' && kisHours === 0) verdict = '🟡 KIS_TOKEN_EXPIRED';
      else if (!lastScanTs)                          verdict = '🟡 SCANNER_IDLE';
      else if (yahooStatus === 'DOWN')               verdict = '🟡 YAHOO_DOWN';
      else                                           verdict = '🟢 OK';

      await sendTelegramAlert(
        `🩺 <b>[파이프라인 헬스체크] 09:05 KST</b>\n` +
        `판정: ${verdict}\n` +
        `─────────────────────\n` +
        `워치리스트: ${watchlist.length}개 | 활성 포지션: ${activeTrades}개\n` +
        `자동매매: ${autoEnabled ? '✅ 켜짐' : '❌ 꺼짐'} (${autoMode})\n` +
        `KIS 토큰: ${kisHours > 0 ? `✅ ${kisHours}시간 남음` : '❌ 만료'}\n` +
        `Yahoo: ${yahooStatus === 'OK' ? '✅' : yahooStatus === 'DEGRADED' ? '⚠️ 부분장애' : yahooStatus === 'DOWN' ? '❌ 불가' : '?'}\n` +
        `마지막 스캔: ${lastScanAt} | 마지막 신호: ${lastBuyAt}\n` +
        `일일손실: ${dailyLossPct.toFixed(1)}% / 한도 ${dailyLossLimit}%\n` +
        `비상정지: ${emergencyStop ? '🛑 활성' : '✅ 해제'}`
      ).catch(console.error);
    } catch (e) {
      console.error('[Scheduler] 파이프라인 헬스체크 전송 실패:', e);
    }
  }, { timezone: 'UTC' });

  // 새벽 자가진단 — 매일 KST 02:00 (UTC 17:00) 파이프라인 치명 이슈 조기 감지 (아이디어 11)
  cron.schedule('0 17 * * *', async () => {
    try {
      const diagnosis = await runPipelineDiagnosis();
      if (diagnosis.hasCriticalIssue || diagnosis.warnings.length > 0) {
        const sections: string[] = [];
        if (diagnosis.issues.length > 0) {
          sections.push(
            `🚨 <b>치명 이슈 (${diagnosis.issues.length}건)</b>\n` +
            diagnosis.issues.map(i => `• ${i}`).join('\n'),
          );
        }
        if (diagnosis.warnings.length > 0) {
          sections.push(
            `⚠️ <b>경고 (${diagnosis.warnings.length}건)</b>\n` +
            diagnosis.warnings.map(w => `• ${w}`).join('\n'),
          );
        }
        await sendTelegramAlert(
          `🩺 <b>[새벽 자가진단] ${diagnosis.checkedAt}</b>\n\n` +
          sections.join('\n\n') +
          (diagnosis.hasCriticalIssue ? '\n\n→ 오늘 장 시작 전 조치 필요' : ''),
        ).catch(console.error);
      } else {
        console.log('[Scheduler] 새벽 자가진단 이상 없음');
      }
    } catch (e) {
      console.error('[Scheduler] 새벽 자가진단 실패:', e);
    }
  }, { timezone: 'UTC' });

  // 스캔 트레이스 파일 정리 — 매주 일요일 KST 03:00 (UTC 18:00 토요일) 7일 이상 된 파일 삭제
  cron.schedule('0 18 * * 6', async () => {
    cleanupOldTraceFiles();
  }, { timezone: 'UTC' });

  console.log('[Scheduler] 30개 cron 작업 등록 완료 (장중 Intraday Watchlist는 Orchestrator INTRADAY tick 내부에서 처리)');
}
