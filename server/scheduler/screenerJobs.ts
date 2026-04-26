/**
 * @responsibility 종목 발굴·워치리스트 관련 cron(2단계 분리 파이프라인 · 정리 · 동적 확장 · 미국장 전후 재스캔 · 글로벌 에이전트)을 등록한다.
 *
 * PR-B-2 ADR-0037: 평일 영업일 cron 은 TRADING_DAY_ONLY, 주말 cron 은 WEEKEND_MAINTENANCE,
 * 미국장 cron(US 장 시작/종료 시각)은 ALWAYS_ON (KR 휴장과 무관).
 */
import { scheduledJob } from './scheduleGuard.js';
import { runStage1PreScreening, runStage2_3FinalScreening } from '../screener/universeScanner.js';
import { cleanupWatchlist } from '../screener/watchlistManager.js';
import { runDynamicUniverseExpansion } from '../screener/dynamicUniverseExpander.js';
import { runAutoSignalScan } from '../trading/signalScanner.js';
import { runGlobalScanAgent } from '../alerts/globalScanAgent.js';
import { runSupplyChainScan } from '../alerts/supplyChainAgent.js';
import { trackPendingRecords } from '../learning/newsSupplyLogger.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';

export function registerScreenerJobs(): void {
  // ─── 2단계 분리 파이프라인 ────────────────────────────────────────────────
  // Stage1(220개 Yahoo 스캔)이 전체 시간의 80% — 전날 16:30에 선행 실행.

  // 1차 Pre-screening — 전날 16:30 KST (UTC 07:30).
  scheduledJob('30 7 * * 1-5', 'TRADING_DAY_ONLY', 'stage1_pre_screening',
    () => runStage1PreScreening(), { timezone: 'UTC' });

  // 2차 Final-screening — 당일 08:35 KST (UTC 23:35 전일).
  scheduledJob('35 23 * * 0-4', 'TRADING_DAY_ONLY', 'stage2_3_final_screening', async () => {
    const macroState = loadMacroState();
    const regime = getLiveRegime(macroState);
    await runStage2_3FinalScreening(regime, macroState);
  }, { timezone: 'UTC' });

  // 워치리스트 자동 정리 — 평일 16:00 KST (UTC 07:00).
  scheduledJob('0 7 * * 1-5', 'TRADING_DAY_ONLY', 'cleanup_watchlist',
    () => cleanupWatchlist(), { timezone: 'UTC' });

  // 장중 안전망 — 평일 30분마다 워치리스트 재정리. KST timezone (장중 시각 기준).
  scheduledJob('0,30 9-15 * * 1-5', 'TRADING_DAY_ONLY', 'cleanup_watchlist_intraday',
    () => cleanupWatchlist(), { timezone: 'Asia/Seoul' });

  // ─── 미국장 전후 스캐닝 — KR 휴장과 무관 ──────────────────────
  // 미국 장 시작 직전 확인 — KST 22:25 (UTC 13:25).
  // PR-B-2: ALWAYS_ON — 미국장은 KR 공휴일과 독립적, 한국 장 직전 검증은 평일 가드만.
  // (cron `1-5` 가 1차 가드, US 장은 KR 휴장과 별개 마켓)
  scheduledJob('25 13 * * 1-5', 'ALWAYS_ON', 'us_premarket_scan', async () => {
    console.log('[Scheduler] 미국장 프리마켓 스캔 (KST 22:25)');
    await runAutoSignalScan({ sellOnly: false });
  }, { timezone: 'UTC' });

  // 미국 장 마감 후 확인 — KST 06:10 (UTC 21:10 전일).
  scheduledJob('10 21 * * 0-4', 'ALWAYS_ON', 'us_postmarket_scan', async () => {
    console.log('[Scheduler] 미국장 마감 후 스캔 (KST 06:10+1d)');
    await runAutoSignalScan({ sellOnly: false });
  }, { timezone: 'UTC' });

  // 새벽 글로벌 스캔 에이전트 — 매일 KST 06:00 (UTC 21:00).
  // PR-B-2: ALWAYS_ON — 글로벌 지수는 KR 휴장 무관.
  scheduledJob('0 21 * * 0-4', 'ALWAYS_ON', 'global_scan_agent',
    () => runGlobalScanAgent(), { timezone: 'UTC' });

  // 뉴스-수급 시차 DB 추적 — 평일 KST 09:10 (UTC 00:10).
  scheduledJob('10 0 * * 1-5', 'TRADING_DAY_ONLY', 'news_supply_tracker',
    () => trackPendingRecords(), { timezone: 'UTC' });

  // 동적 유니버스 확장 — 매주 토요일 09:00 KST (UTC 00:00).
  scheduledJob('0 0 * * 6', 'WEEKEND_MAINTENANCE', 'dynamic_universe_expansion',
    () => runDynamicUniverseExpansion(), { timezone: 'UTC' });

  // ─── 주말 해외 뉴스·공급망 스캔 ───────────────────────────────────────────
  // 토요일·일요일 KST 02:00 / 10:00.
  scheduledJob('0 17 * * 5,6', 'WEEKEND_MAINTENANCE', 'supply_chain_scan_02kst', async () => {
    console.log('[Scheduler] 주말 해외 뉴스 스캔 (KST 02:00)');
    await runSupplyChainScan();
  }, { timezone: 'UTC' });
  scheduledJob('0 1 * * 6,0', 'WEEKEND_MAINTENANCE', 'supply_chain_scan_10kst', async () => {
    console.log('[Scheduler] 주말 해외 뉴스 재스캔 (KST 10:00)');
    await runSupplyChainScan();
  }, { timezone: 'UTC' });
}
