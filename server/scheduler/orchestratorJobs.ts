/**
 * @responsibility KIS 토큰 사전 갱신 + TradingDayOrchestrator 1분 틱 cron을 등록하고 하트비트/게이팅을 관리한다.
 */
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { tradingOrchestrator } from '../orchestrator/tradingOrchestrator.js';
import { checkDailyLossLimit } from '../emergency.js';
import { runKillSwitchCheck } from '../trading/killSwitch.js';
import { forceRefreshKisTokens } from '../clients/kisClient.js';
import { getAutoTradePaused, getEmergencyStop, touchHeartbeat } from '../state.js';
import { scheduledJob } from './scheduleGuard.js';
import {
  runFomcDayMorningAlert,
  runFomcDayPreLiquidationAlert,
  liquidateAllForFomc,
} from '../trading/fomcDayLiquidation.js';
import { fetchDailyBars } from '../trading/marketDataRefresh.js';

async function runOrchestratorTick(): Promise<void> {
  touchHeartbeat('orchestrator');
  if (getEmergencyStop()) { console.warn('[Orchestrator] 비상 정지 — tick 건너뜀'); return; }
  if (getAutoTradePaused()) { console.warn('[Orchestrator] 소프트 일시정지 — tick 건너뜀'); return; }
  await tradingOrchestrator.tick().catch(console.error);
  if (process.env.AUTO_TRADE_ENABLED === 'true') {
    await checkDailyLossLimit().catch(console.error);
    await runKillSwitchCheck().catch(console.error);
  }
}

async function forceRefreshKisTokenCron(label: string): Promise<void> {
  try {
    const res = await forceRefreshKisTokens();
    console.log(
      `[Scheduler] KIS 토큰 강제 갱신 완료 (${label}) — ` +
      `main=${res.main ? 'OK' : 'FAIL'}, realData=${res.realData}`,
    );
    if (!res.main || res.realData === false) {
      await sendTelegramAlert(
        `⚠️ <b>[KIS 토큰 강제 갱신 부분 실패]</b>\n` +
        `(${label}) main=${res.main ? '✅' : '❌'}, realData=${res.realData}\n` +
        `수동 확인 필요`,
      ).catch(console.error);
    }
  } catch (e) {
    console.error(`[Scheduler] KIS 토큰 강제 갱신 실패 (${label}):`, e);
    await sendTelegramAlert(
      `⚠️ <b>[KIS 토큰 강제 갱신 실패]</b>\n(${label}) — 수동 확인 필요`,
    ).catch(console.error);
  }
}

export function registerOrchestratorJobs(): void {
  // KIS 토큰 강제 갱신 — **12시간 주기, 매일 실행**.
  // 주말도 포함 — 주말 해외 뉴스/공급망 스캔이 KIS 데이터 토큰을 쓰므로 365일 갱신.
  // PR-B-2: ALWAYS_ON — 토요일/일요일/공휴일에도 토큰 신선도 유지.
  scheduledJob('30 23 * * *', 'ALWAYS_ON', 'kis_token_refresh',
    () => forceRefreshKisTokenCron('장전 08:30 KST'), { timezone: 'UTC' });
  scheduledJob('30 11 * * *', 'ALWAYS_ON', 'kis_token_refresh',
    () => forceRefreshKisTokenCron('장후 20:30 KST'), { timezone: 'UTC' });

  // TradingDayOrchestrator — 장 사이클 State Machine.
  // PR-B-2: TRADING_DAY_ONLY — KRX 공휴일 평일에 tick 도는 무의미.
  // ① UTC 23:xx (= KST Mon-Fri 08:xx, 동시호가/장 전 준비) — Sun-Thu UTC
  scheduledJob('*/1 23 * * 0-4', 'TRADING_DAY_ONLY', 'orchestrator_tick',
    runOrchestratorTick, { timezone: 'UTC' });
  // ② UTC 00:xx~08:xx (= KST Mon-Fri 09:xx~17:xx, 장중/마감/리포트) — Mon-Fri UTC
  scheduledJob('*/1 0-8 * * 1-5', 'TRADING_DAY_ONLY', 'orchestrator_tick',
    runOrchestratorTick, { timezone: 'UTC' });

  // FOMC DAY 자동 청산 정책 (ADR-0061) — 평일 cron 등록 + DAY phase 가드는 함수 내부에서 처리.
  // cron 자체는 매일 평일 발동되지만 fomcCalendar SSOT 의 phase==='DAY' 미충족 시
  // 즉시 silent return → 비-DAY 일은 무영향. ScheduleClass='TRADING_DAY_ONLY' 로
  // KRX 휴장 평일도 자동 차단.

  // ① 평일 09:00 KST = UTC 00:00 — DAY 사전 경보 (오늘 14:30 청산 예정)
  scheduledJob('0 0 * * 1-5', 'TRADING_DAY_ONLY', 'fomc_day_morning_alert',
    () => runFomcDayMorningAlert(), { timezone: 'UTC' });

  // ② 평일 14:00 KST = UTC 05:00 — 30분 전 경보 (활성 포지션 카운트 포함)
  scheduledJob('0 5 * * 1-5', 'TRADING_DAY_ONLY', 'fomc_day_pre_liquidation_alert',
    () => runFomcDayPreLiquidationAlert(), { timezone: 'UTC' });

  // ③ 평일 14:30 KST = UTC 05:30 — 청산 시작 (5중 가드 통과 시 reserveSell 루프)
  scheduledJob('30 5 * * 1-5', 'TRADING_DAY_ONLY', 'fomc_day_liquidation',
    () => liquidateAllForFomc(), { timezone: 'UTC' });

  // ─── Yahoo heartbeat warmup (사용자 요청 2026-04-29) ───────────────────────
  // 장시작 5분 전 (KST 08:55 = UTC 23:55) Yahoo KOSPI 지수 fetch 1회 호출로
  // _yahooLastSuccessAt heartbeat 갱신. ADR-0091 STALE_BASE 결함 (Yahoo base
  // price 가 stale 상태에서 sanity 위반 발생) 의 사전 예방 — 장시작 직전에
  // Yahoo 가용성 확인되어 있어야 stockScreener autoPopulateWatchlist 의 base
  // price fetch 가 정상값 받을 가능성 ↑.
  // intent='HISTORICAL' (fetchDailyBars) 라 EgressGuard 시간 무관 통과.
  scheduledJob('55 23 * * 0-4', 'TRADING_DAY_ONLY', 'yahoo_heartbeat_warmup',
    async () => {
      try {
        const bars = await fetchDailyBars('^KS11', '5d');
        const ok = bars && bars.length > 0;
        console.log(`[Yahoo] 장시작 전 heartbeat warmup ${ok ? 'OK' : '응답 빈약'} — KOSPI bars=${bars?.length ?? 0}`);
      } catch (e) {
        console.warn('[Yahoo] heartbeat warmup 실패:', e instanceof Error ? e.message : e);
      }
    },
    { timezone: 'UTC' });
}
