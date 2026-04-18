/**
 * @responsibility KIS 토큰 사전 갱신 + TradingDayOrchestrator 1분 틱 cron을 등록하고 하트비트/게이팅을 관리한다.
 */
import cron from 'node-cron';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { tradingOrchestrator } from '../orchestrator/tradingOrchestrator.js';
import { checkDailyLossLimit } from '../emergency.js';
import { runKillSwitchCheck } from '../trading/killSwitch.js';
import { invalidateKisToken, refreshKisToken } from '../clients/kisClient.js';
import { getAutoTradePaused, getEmergencyStop, touchHeartbeat } from '../state.js';

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

export function registerOrchestratorJobs(): void {
  // KIS 토큰 사전 갱신 — 매일 KST 08:30 (UTC 23:30, 일~목)
  // 23시간 유효 토큰을 장 시작 전 강제 재발급하여 장중 401 만료 방지.
  cron.schedule('30 23 * * 0-4', async () => {
    try {
      invalidateKisToken();
      await refreshKisToken();
      console.log('[Scheduler] KIS 토큰 사전 갱신 완료 (장전 08:30 KST)');
    } catch (e) {
      console.error('[Scheduler] KIS 토큰 사전 갱신 실패:', e);
      await sendTelegramAlert(
        '⚠️ <b>[KIS 토큰 갱신 실패]</b>\n장 시작 전 토큰 갱신 오류 — 수동 확인 필요',
      ).catch(console.error);
    }
  }, { timezone: 'UTC' });

  // TradingDayOrchestrator — 장 사이클 State Machine.
  // cron은 1분 간격 — INTRADAY 실제 스캔 빈도는 adaptiveScanScheduler가 결정.
  // ① UTC 23:xx (= KST Mon-Fri 08:xx, 동시호가/장 전 준비) — Sun-Thu UTC
  cron.schedule('*/1 23 * * 0-4', runOrchestratorTick, { timezone: 'UTC' });
  // ② UTC 00:xx~08:xx (= KST Mon-Fri 09:xx~17:xx, 장중/마감/리포트) — Mon-Fri UTC
  cron.schedule('*/1 0-8 * * 1-5', runOrchestratorTick, { timezone: 'UTC' });
}
