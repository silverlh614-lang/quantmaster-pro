/**
 * @responsibility 종목 발굴·워치리스트 관련 cron(2단계 분리 파이프라인 · 정리 · 동적 확장 · 미국장 전후 재스캔 · 글로벌 에이전트)을 등록한다.
 *
 * PR-B-2 ADR-0043: 평일 영업일 cron 은 TRADING_DAY_ONLY, 주말 cron 은 WEEKEND_MAINTENANCE,
 * 미국장 cron(US 장 시작/종료 시각)은 ALWAYS_ON (KR 휴장과 무관).
 */
import { scheduledJob } from './scheduleGuard.js';
import { runStage1PreScreening, runStage2_3FinalScreening } from '../screener/universeScanner.js';
import { cleanupWatchlist } from '../screener/watchlistManager.js';
import { runDynamicUniverseExpansion } from '../screener/dynamicUniverseExpander.js';
import { runGlobalScanAgent } from '../alerts/globalScanAgent.js';
import { runSupplyChainScan } from '../alerts/supplyChainAgent.js';
import { trackPendingRecords } from '../learning/newsSupplyLogger.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { withForcedMarket } from '../utils/forceMarketGuard.js';

export function registerScreenerJobs(): void {
  scheduledJob('30 7 * * 1-5', 'TRADING_DAY_ONLY', 'stage1_pre_screening',
    () => withForcedMarket(() => runStage1PreScreening()), { timezone: 'UTC' });

  scheduledJob('35 23 * * 0-4', 'TRADING_DAY_ONLY', 'stage2_3_final_screening', () => withForcedMarket(async () => {
    const macroState = loadMacroState();
    const regime = getLiveRegime(macroState);
    await runStage2_3FinalScreening(regime, macroState);
  }), { timezone: 'UTC' });

  scheduledJob('0 7 * * 1-5', 'TRADING_DAY_ONLY', 'cleanup_watchlist',
    () => cleanupWatchlist(), { timezone: 'UTC' });

  scheduledJob('0,30 9-15 * * 1-5', 'TRADING_DAY_ONLY', 'cleanup_watchlist_intraday',
    () => cleanupWatchlist(), { timezone: 'Asia/Seoul' });

  // ADR-0403: US-market cron slots must not invoke the KR auto-signal scan path.
  // They now run the global market diagnostic agent only, so KR R3/Gate1 streaks are not touched.
  scheduledJob('25 13 * * 1-5', 'ALWAYS_ON', 'us_premarket_scan', () => withForcedMarket(async () => {
    console.log('[Scheduler] US premarket global diagnostics (KST 22:25)');
    await runGlobalScanAgent();
  }), { timezone: 'UTC' });

  scheduledJob('10 21 * * 0-4', 'ALWAYS_ON', 'us_postmarket_scan', () => withForcedMarket(async () => {
    console.log('[Scheduler] US postmarket global diagnostics (KST 06:10)');
    await runGlobalScanAgent();
  }), { timezone: 'UTC' });

  scheduledJob('0 21 * * 0-4', 'ALWAYS_ON', 'global_scan_agent',
    () => withForcedMarket(() => runGlobalScanAgent()), { timezone: 'UTC' });

  scheduledJob('10 0 * * 1-5', 'TRADING_DAY_ONLY', 'news_supply_tracker',
    () => trackPendingRecords(), { timezone: 'UTC' });

  scheduledJob('0 0 * * 6', 'WEEKEND_MAINTENANCE', 'dynamic_universe_expansion',
    () => runDynamicUniverseExpansion(), { timezone: 'UTC' });

  scheduledJob('0 17 * * 5,6', 'WEEKEND_MAINTENANCE', 'supply_chain_scan_02kst', async () => {
    console.log('[Scheduler] 주말 해외 뉴스 스캔 (KST 02:00)');
    await runSupplyChainScan();
  }, { timezone: 'UTC' });

  scheduledJob('0 1 * * 6,0', 'WEEKEND_MAINTENANCE', 'supply_chain_scan_10kst', async () => {
    console.log('[Scheduler] 주말 해외 뉴스 재스캔 (KST 10:00)');
    await runSupplyChainScan();
  }, { timezone: 'UTC' });
}
