/**
 * @responsibility 자기학습 파이프라인 cron(주간 L3 캘리브레이션 · 일일 미니 백테스트 · Sharpe 급락 경보 · F2W 역피드백 · 주간 백테스트)을 등록한다.
 */
import cron from 'node-cron';
import { runBacktest, runWeeklyMiniBacktest } from '../learning/backtestEngine.js';
import { learningOrchestrator } from '../orchestrator/learningOrchestrator.js';
import { checkWeeklySharpeAlert } from '../learning/weeklySharpeMonitor.js';
import { runF2WReverseLoop } from '../learning/failureToWeight.js';

export function registerLearningJobs(): void {
  // OHLCV 기반 백테스트 — 매주 토요일 KST 08:00 (UTC 23:00 금요일).
  // 전체 추천 이력을 Yahoo 일봉으로 재검증: Sharpe·MDD·WIN률 실계산 + Telegram 발송
  cron.schedule('0 23 * * 5', async () => { await runBacktest().catch(console.error); }, { timezone: 'UTC' });

  // L3 주간 경량 캘리브레이션 — 매주 월요일 07:00 KST (UTC 22:00 일요일).
  // 전주 AttributionRecord 기반 경량 캘리브레이션 + 전주 추천 미니 백테스트.
  // 워크포워드 동결 시 내부에서 skip. 최소 5건 미달 시 skip.
  cron.schedule('0 22 * * 0', async () => {
    console.log('[Scheduler] L3 주간 경량 캘리브레이션 시작 (월요일 07:00 KST)');
    await learningOrchestrator.runWeeklyCalib().catch(console.error);
  }, { timezone: 'UTC' });

  // 일일 미니 백테스트 — 평일 KST 00:30 (UTC 15:30). < 30초 실행.
  // 전일(월~금) 결산된 추천 신호만 빠르게 재검증.
  cron.schedule('30 15 * * 0-4', async () => {
    console.log('[Scheduler] 일일 미니 백테스트 시작 (00:30 KST)');
    await runWeeklyMiniBacktest().catch(console.error);
  }, { timezone: 'UTC' });

  // 주중 Sharpe 급락 조기 경보 — 매주 수요일 16:30 KST (UTC 07:30).
  // 각 조건의 이번 주 Sharpe가 이전 4주 평균의 50% 미만이면 월말 전 경보.
  cron.schedule('30 7 * * 3', async () => {
    console.log('[Scheduler] 주중 Sharpe 급락 체크 (수요일 16:30 KST)');
    await checkWeeklySharpeAlert().catch(console.error);
  }, { timezone: 'UTC' });

  // F2W 가중치 역피드백 — 매일 KST 03:10 (UTC 18:10). 일일 백업(UTC 18:00) 직후 동작.
  //   r ≥ +0.7 → 1.05× 부스트, r ≤ -0.7 → 0.9× 감쇠, 180d 기여 음수 → 0.2× 일몰.
  cron.schedule('10 18 * * *', async () => {
    try {
      await runF2WReverseLoop({ notifyTelegram: true });
    } catch (e) {
      console.error('[F2W] 실행 실패:', e);
    }
  }, { timezone: 'UTC' });
}
