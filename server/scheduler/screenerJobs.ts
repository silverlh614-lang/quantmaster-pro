/**
 * @responsibility 종목 발굴·워치리스트 관련 cron(2단계 분리 파이프라인 · 정리 · 동적 확장 · 미국장 전후 재스캔 · 글로벌 에이전트)을 등록한다.
 */
import cron from 'node-cron';
import { runStage1PreScreening, runStage2_3FinalScreening } from '../screener/universeScanner.js';
import { cleanupWatchlist } from '../screener/watchlistManager.js';
import { runDynamicUniverseExpansion } from '../screener/dynamicUniverseExpander.js';
import { runAutoSignalScan } from '../trading/signalScanner.js';
import { runGlobalScanAgent } from '../alerts/globalScanAgent.js';
import { trackPendingRecords } from '../learning/newsSupplyLogger.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';

export function registerScreenerJobs(): void {
  // ─── 2단계 분리 파이프라인 ────────────────────────────────────────────────
  // Stage1(220개 Yahoo 스캔)이 전체 시간의 80% — 전날 16:30에 선행 실행.
  // 당일 08:35에는 캐시된 60개에 간밤 글로벌 신호를 반영한 Stage2+3만 실행.

  // 1차 Pre-screening — 전날 16:30 KST (UTC 07:30).
  cron.schedule('30 7 * * 1-5', async () => { await runStage1PreScreening().catch(console.error); }, { timezone: 'UTC' });

  // 2차 Final-screening — 당일 08:35 KST (UTC 23:35).
  // 캐시 미존재 시 전체 파이프라인(Stage1+2+3) fallback 실행
  cron.schedule('35 23 * * 0-4', async () => {
    const macroState = loadMacroState();
    const regime = getLiveRegime(macroState);
    await runStage2_3FinalScreening(regime, macroState).catch(console.error);
  }, { timezone: 'UTC' });

  // 워치리스트 자동 정리 — 평일 16:00 KST (UTC 07:00).
  // expiresAt 초과 항목 제거 + 최대 20개 유지
  cron.schedule('0 7 * * 1-5', async () => { await cleanupWatchlist().catch(console.error); }, { timezone: 'UTC' });

  // ─── 미국장 전후 스캐닝 — 나스닥/S&P 시세 반영 재검증 ──────────────────────
  // 미국 장 시작 직전 확인 — KST 22:25 (UTC 13:25).
  cron.schedule('25 13 * * 1-5', async () => {
    console.log('[Scheduler] 미국장 프리마켓 스캔 (KST 22:25)');
    await runAutoSignalScan({ sellOnly: false }).catch(console.error);
  }, { timezone: 'UTC' });

  // 미국 장 마감 후 확인 — KST 06:10 (UTC 21:10 전일). 익일 한국 장 대비 마지막 검증.
  cron.schedule('10 21 * * 0-4', async () => {
    console.log('[Scheduler] 미국장 마감 후 스캔 (KST 06:10+1d)');
    await runAutoSignalScan({ sellOnly: false }).catch(console.error);
  }, { timezone: 'UTC' });

  // 새벽 글로벌 스캔 에이전트 — 매일 KST 06:00 (UTC 21:00).
  // S&P500·나스닥·다우·VIX·EWY·ITA·SOXX·XLE·WOOD + Gemini 요약 + Telegram 알림
  cron.schedule('0 21 * * 0-4', async () => { await runGlobalScanAgent().catch(console.error); }, { timezone: 'UTC' });

  // 뉴스-수급 시차 DB 추적 — 평일 KST 09:10 (UTC 00:10).
  // 경보 발생 후 T+1·T+3·T+5 거래일 경과 레코드의 EWY·주가 변화율 자동 채움
  cron.schedule('10 0 * * 1-5', async () => { await trackPendingRecords().catch(console.error); }, { timezone: 'UTC' });

  // 동적 유니버스 확장 — 매주 토요일 09:00 KST (UTC 00:00).
  // KIS API 52주 신고가 + 외국인 순매수 상위 → STOCK_UNIVERSE 임시 확장
  cron.schedule('0 0 * * 6', async () => { await runDynamicUniverseExpansion().catch(console.error); }, { timezone: 'UTC' });
}
