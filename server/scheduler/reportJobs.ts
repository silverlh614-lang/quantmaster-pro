/** @responsibility Shadow 알림 일정과 내부 지표 점검을 등록한다. */
import { scheduledJob } from './scheduleGuard.js';
import { runPaperBotTick } from '../alerts/paperBot.js';
import { refreshMarketRegimeVars } from '../trading/marketDataRefresh.js';
import { resetKisCircuits } from '../clients/kisClient.js';
import { _resetKrxOpenApiBreaker } from '../clients/krxOpenApi.js';
import { runHourlyCanary } from '../learning/mutationCanary.js';

export function registerReportJobs(): void {
  // 한 coordinator가 KST 거래일, 예정 시각, 재시작 복구, 전송 기록을 관리한다.
  scheduledJob('* * * * *', 'ALWAYS_ON', 'paper_bot', () => runPaperBotTick(), { timezone: 'Asia/Seoul' });

  // 알림 전용 cron은 제거하되 데이터 갱신과 내부 점검은 유지한다.
  scheduledJob('25 7 * * 1-5', 'TRADING_DAY_ONLY', 'circuit_auto_reset', () => {
    const cleared = resetKisCircuits();
    try { _resetKrxOpenApiBreaker(); }
    catch (error) { console.warn('[Scheduler] KRX 회로 reset 실패:', error instanceof Error ? error.name : 'unknown error'); }
    if (cleared > 0) console.log(`[Scheduler] KIS 회로 ${cleared}개 해제 + KRX reset`);
  }, { timezone: 'UTC' });
  scheduledJob('38 23 * * 0-4', 'TRADING_DAY_ONLY', 'market_regime_refresh_morning',
    () => refreshMarketRegimeVars(), { timezone: 'UTC' });
  scheduledJob('*/3 0-6 * * 1-5', 'TRADING_DAY_ONLY', 'market_regime_refresh_intraday_ttl',
    () => refreshMarketRegimeVars(), { timezone: 'UTC' });
  scheduledJob('30 6 * * 1-5', 'TRADING_DAY_ONLY', 'market_regime_refresh_close',
    () => refreshMarketRegimeVars(), { timezone: 'UTC' });
  scheduledJob('0 * * * *', 'ALWAYS_ON', 'hourly_canary',
    () => runHourlyCanary(), { timezone: 'UTC' });
}
