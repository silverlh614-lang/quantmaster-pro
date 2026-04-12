// server/scheduler.ts — cron 스케줄러 모듈
// server.ts에서 분리: 13개 cron 작업을 한 곳에서 관리
import cron from 'node-cron';
import { getEmergencyStop } from './state.js';
import { tradingOrchestrator } from './orchestrator/tradingOrchestrator.js';
import { pollDartDisclosures, fastDartCheck } from './alerts/dartPoller.js';
import { pollBearRegime } from './alerts/bearRegimeAlert.js';
import { pollIpsAlert } from './alerts/ipsAlert.js';
import { pollMhsMorningAlert } from './alerts/mhsAlert.js';
import {
  generateWeeklyReport,
  sendWatchlistBriefing,
  sendIntradayCheckIn,
} from './alerts/reportGenerator.js';
import { checkDailyLossLimit } from './emergency.js';
import { refreshMarketRegimeVars } from './trading/marketDataRefresh.js';
import { loadMacroState } from './persistence/macroStateRepo.js';
import { getLiveRegime } from './trading/regimeBridge.js';
import { runFullDiscoveryPipeline } from './screener/universeScanner.js';
import { cleanupWatchlist } from './screener/watchlistManager.js';

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

  // 시장 지표 자동 갱신 — 평일 08:40 KST (UTC 23:40, 일~목) + 장 마감 후 15:30 KST (UTC 06:30, 월~금)
  // KOSPI/SPX/DXY/USD-KRW Yahoo Finance → classifyRegime() 7축 갱신
  cron.schedule('40 23 * * 0-4', async () => {
    await refreshMarketRegimeVars().catch(console.error);
  }, { timezone: 'UTC' });
  cron.schedule('30 6 * * 1-5', async () => {
    await refreshMarketRegimeVars().catch(console.error);
  }, { timezone: 'UTC' });

  // 장 시작 전 워치리스트 브리핑 — 평일 08:50 KST (UTC 23:50, 일~목 UTC)
  cron.schedule('50 23 * * 0-4', async () => {
    await sendWatchlistBriefing().catch(console.error);
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

  console.log('[Scheduler] 17개 cron 작업 등록 완료');
}
