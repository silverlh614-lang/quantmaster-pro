/**
 * @responsibility KIS 토큰 사전 갱신 + TradingDayOrchestrator 1분 틱 cron을 등록하고 하트비트/게이팅을 관리한다.
 */
import cron from 'node-cron';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { tradingOrchestrator } from '../orchestrator/tradingOrchestrator.js';
import { checkDailyLossLimit } from '../emergency.js';
import { runKillSwitchCheck } from '../trading/killSwitch.js';
import { forceRefreshKisTokens } from '../clients/kisClient.js';
import { getAutoTradePaused, getEmergencyStop, touchHeartbeat } from '../state.js';
import { wrapJob } from './scheduleCatalog.js';

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
  // 토큰 캐시 TTL(23h)과 cron 주기 사이의 1시간 공백을 제거한다.
  // 주말도 포함 — 주말 해외 뉴스/공급망 스캔이 KIS 데이터 토큰을 쓰므로
  // 토요일/일요일에도 토큰이 신선해야 한다.
  //   - 08:30 KST (UTC 23:30 전일) — 장 시작 직전 (기존 시점 유지)
  //   - 20:30 KST (UTC 11:30 당일) — 장 마감 후·미국장 전
  cron.schedule('30 23 * * *', wrapJob('kis_token_refresh', () => forceRefreshKisTokenCron('장전 08:30 KST')), { timezone: 'UTC' });
  cron.schedule('30 11 * * *', wrapJob('kis_token_refresh', () => forceRefreshKisTokenCron('장후 20:30 KST')), { timezone: 'UTC' });

  // TradingDayOrchestrator — 장 사이클 State Machine.
  // cron은 1분 간격 — INTRADAY 실제 스캔 빈도는 adaptiveScanScheduler가 결정.
  // ① UTC 23:xx (= KST Mon-Fri 08:xx, 동시호가/장 전 준비) — Sun-Thu UTC
  cron.schedule('*/1 23 * * 0-4', runOrchestratorTick, { timezone: 'UTC' });
  // ② UTC 00:xx~08:xx (= KST Mon-Fri 09:xx~17:xx, 장중/마감/리포트) — Mon-Fri UTC
  cron.schedule('*/1 0-8 * * 1-5', runOrchestratorTick, { timezone: 'UTC' });
}
