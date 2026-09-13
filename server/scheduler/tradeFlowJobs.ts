/**
 * @responsibility 체결·OCO·포트폴리오 리스크·시장 변동성 수집 cron과 매도 체결 폴링 setInterval 을 등록한다.
 *
 * 매도 체결 확인 폐루프는 cron 최소 단위(1분)보다 짧아 setInterval 로 구동한다.
 * PR-B-2 ADR-0043: 모든 cron 이 TRADING_DAY_ONLY — KRX 공휴일 평일에 OCO/매도 폴링은 무의미.
 */
import { scheduledJob } from './scheduleGuard.js';
import { pollOcoConfirm } from '../trading/ocoConfirmLoop.js';
import { cancelAllActiveOco, pollOcoSurvival } from '../trading/ocoCloseLoop.js';
import { runOcoRecoveryRound } from '../trading/ocoRecoveryAgent.js';
import { SELL_POLL_INTERVAL, pollSellFills } from '../trading/fillMonitor.js';
import { runPortfolioRiskCheck } from '../trading/portfolioRiskEngine.js';
import { refreshMarketVolatility } from '../trading/macroSectorSync.js';

export function registerTradeFlowJobs(): void {
  // OCO 체결 확정 (30초) — 빠른 반대 주문 취소. 15분 pollOcoSurvival 은 안전망.
  // KST 09:00~15:30 = UTC 00:00~06:30 (Mon-Fri). node-cron 은 초 단위 cron 지원.
  scheduledJob('*/30 * 0-6 * * 1-5', 'TRADING_DAY_ONLY', 'oco_confirm',
    () => pollOcoConfirm(), { timezone: 'UTC' });

  // 포트폴리오 리스크 정기 점검 — 장중 15분 간격.
  scheduledJob('*/15 0-6 * * 1-5', 'TRADING_DAY_ONLY', 'portfolio_risk_check',
    () => runPortfolioRiskCheck(), { timezone: 'UTC' });

  // OCO 생존 확인 폴링 — 장중 15분 간격. 한쪽 체결 시 다른쪽 자동 취소.
  scheduledJob('*/15 0-6 * * 1-5', 'TRADING_DAY_ONLY', 'oco_survival',
    () => pollOcoSurvival(), { timezone: 'UTC' });

  // OCO 자동 복구 라운드 — 장중 5분 간격. FAILED 사이드 재등록.
  scheduledJob('*/5 0-6 * * 1-5', 'TRADING_DAY_ONLY', 'oco_recovery_round',
    () => runOcoRecoveryRound(), { timezone: 'UTC' });

  // OCO 장마감 정리 — 15:20 KST (UTC 06:20). ACTIVE OCO 주문 쌍 전량 취소.
  scheduledJob('20 6 * * 1-5', 'TRADING_DAY_ONLY', 'cancel_all_active_oco',
    () => cancelAllActiveOco(), { timezone: 'UTC' });

  // VIX 실측값은 장 시작과 장중 30분마다 갱신한다.
  scheduledJob('0 0 * * 1-5', 'TRADING_DAY_ONLY', 'market_volatility_open',
    () => refreshMarketVolatility(), { timezone: 'UTC' });
  scheduledJob('0,30 0-5 * * 1-5', 'TRADING_DAY_ONLY', 'market_volatility_intraday', async () => {
    const now = new Date();
    if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) return;
    await refreshMarketVolatility();
  }, { timezone: 'UTC' });

  // 매도 체결 확인 폐루프 — 장중 30초 간격 (setInterval).
  // cron 최소 단위가 1분이므로 setInterval로 30초 간격 실행.
  let sellPollTimer: ReturnType<typeof setInterval> | null = null;

  scheduledJob('0 0 * * 1-5', 'TRADING_DAY_ONLY', 'sell_poll_start', () => {
    if (sellPollTimer) return;
    sellPollTimer = setInterval(() => {
      pollSellFills().catch(console.error);
    }, SELL_POLL_INTERVAL);
    console.log(`[Scheduler] 매도 체결 폴링 시작 (${SELL_POLL_INTERVAL / 1000}초 간격)`);
  }, { timezone: 'UTC' });

  scheduledJob('35 6 * * 1-5', 'TRADING_DAY_ONLY', 'sell_poll_stop', () => {
    if (sellPollTimer) { clearInterval(sellPollTimer); sellPollTimer = null; }
    console.log('[Scheduler] 매도 체결 폴링 종료');
  }, { timezone: 'UTC' });
}
