/**
 * @responsibility 자기학습 cron 작업 등록 — ScheduleClass 자동 가드(ADR-0043) 적용
 *
 * 모든 cron 은 `scheduledJob(cronExpr, ScheduleClass, jobName, fn)` 래퍼를 경유.
 * ScheduleClass 가 비영업일 진입을 자동 차단 + JobMetrics 에 lastSkipReason 기록.
 *
 * cron 표현식의 `1-5` / `0-4` 평일 가드는 1차 방어선(주말 새벽 cron 자체 실행 차단).
 * ScheduleClass 가 KRX 공휴일을 평일에 차단하는 진짜 방어선.
 */
import { runBacktest, runWeeklyMiniBacktest } from '../learning/backtestEngine.js';
import { learningOrchestrator } from '../orchestrator/learningOrchestrator.js';
import { checkWeeklySharpeAlert } from '../learning/weeklySharpeMonitor.js';
import { runF2WReverseLoop } from '../learning/failureToWeight.js';
import { runNightlyReflection } from '../learning/nightlyReflectionEngine.js';
import { refreshGhostPortfolio } from '../learning/ghostPortfolioTracker.js';
import { distillWeeklyKnowledge } from '../learning/silentKnowledgeDistillation.js';
import { runWalkForwardValidation } from '../learning/walkForwardValidator.js';
import { resolveCounterfactuals, evaluateCounterfactualSuggestion } from '../learning/counterfactualShadow.js';
import { resolveLedger, evaluateLedgerSuggestion } from '../learning/ledgerSimulator.js';
import { evaluateKellySurfaceSuggestion } from '../learning/kellySurfaceMap.js';
import { evaluateRegimeCoverageSuggestion } from '../learning/regimeBalancedSampler.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { scheduledJob } from './scheduleGuard.js';

export function registerLearningJobs(): void {
  // OHLCV 기반 백테스트 — 매주 토요일 KST 08:00 (UTC 23:00 금요일).
  // 전체 추천 이력을 Yahoo 일봉으로 재검증: Sharpe·MDD·WIN률 실계산 + Telegram 발송.
  // PR-B: WEEKEND_MAINTENANCE — 평일 차단, 토요일 KST 에 실행되어 거래일 가드 통과.
  scheduledJob('0 23 * * 5', 'WEEKEND_MAINTENANCE', 'weekly_backtest', async () => {
    await runBacktest();
  }, { timezone: 'UTC' });

  // L3 주간 경량 캘리브레이션 — 매주 월요일 07:00 KST (UTC 22:00 일요일).
  // PR-B: WEEKEND_MAINTENANCE — 일요일 UTC = 일요일 KST. 비영업일 가드 통과.
  scheduledJob('0 22 * * 0', 'WEEKEND_MAINTENANCE', 'weekly_calib', async () => {
    console.log('[Scheduler] L3 주간 경량 캘리브레이션 시작 (월요일 07:00 KST)');
    await learningOrchestrator.runWeeklyCalib();
  }, { timezone: 'UTC' });

  // 일일 미니 백테스트 — 평일 KST 00:30 (UTC 15:30). < 30초 실행.
  // PR-B: TRADING_DAY_ONLY — KRX 공휴일이 월요일이면 차단.
  scheduledJob('30 15 * * 0-4', 'TRADING_DAY_ONLY', 'daily_mini_backtest', async () => {
    console.log('[Scheduler] 일일 미니 백테스트 시작 (00:30 KST)');
    await runWeeklyMiniBacktest();
  }, { timezone: 'UTC' });

  // 주중 Sharpe 급락 조기 경보 — 매주 수요일 16:30 KST (UTC 07:30).
  // PR-B: TRADING_DAY_ONLY — 수요일이 KRX 공휴일(예: 광복절 8/15가 수요일에 떨어진 해)이면 차단.
  scheduledJob('30 7 * * 3', 'TRADING_DAY_ONLY', 'weekly_sharpe_alert', async () => {
    console.log('[Scheduler] 주중 Sharpe 급락 체크 (수요일 16:30 KST)');
    await checkWeeklySharpeAlert();
  }, { timezone: 'UTC' });

  // F2W 가중치 역피드백 — 평일 KST 03:10 (UTC 일~목 18:10). 일일 백업(UTC 18:00) 직후 동작.
  // PR-A: 평일 cron 가드(0-4) + PR-B: TRADING_DAY_ONLY 로 KRX 공휴일 자동 차단.
  scheduledJob('10 18 * * 0-4', 'TRADING_DAY_ONLY', 'f2w_reverse_loop', async () => {
    await runF2WReverseLoop({ notifyTelegram: true });
  }, { timezone: 'UTC' });

  // Nightly Reflection Engine — 평일 KST 19:00 (UTC 월~금 10:00).
  // PR-A: cron 1-5 가드 + 진입부 isKstWeekend/isKrxHoliday 가드 + PR-B: TRADING_DAY_ONLY 일관성.
  scheduledJob('0 10 * * 1-5', 'TRADING_DAY_ONLY', 'nightly_reflection', async () => {
    const res = await runNightlyReflection();
    console.log(`[NightlyReflection] ${res.date} mode=${res.mode} executed=${res.executed}${res.skipped ? ` skipped=${res.skipped}` : ''}`);
  }, { timezone: 'UTC' });

  // Ghost Portfolio 갱신 — 평일 KST 15:40 (UTC 06:40). 장마감 직후 current price 로 수익률 갱신.
  // PR-B: TRADING_DAY_ONLY — KRX 공휴일에 ghost portfolio 갱신해도 KIS 호출만 낭비.
  scheduledJob('40 6 * * 1-5', 'TRADING_DAY_ONLY', 'ghost_portfolio', async () => {
    const res = await refreshGhostPortfolio();
    console.log(`[GhostPortfolio] updated=${res.updated} closed=${res.closed} skipped=${res.skipped}`);
  }, { timezone: 'UTC' });

  // Silent Knowledge Distillation — 매주 일요일 KST 18:00 (UTC 09:00).
  // PR-B: WEEKEND_MAINTENANCE — 평일 실행되지 않도록 보호.
  scheduledJob('0 9 * * 0', 'WEEKEND_MAINTENANCE', 'silent_distillation', async () => {
    const res = await distillWeeklyKnowledge();
    if (res.executed) console.log(`[Distillation] 축적: ${res.lesson}`);
    else console.log(`[Distillation] skipped=${res.skipped}`);
  }, { timezone: 'UTC' });

  // Walk-Forward Validation — 매월 1일 KST 07:00 (UTC 22:00 전달).
  // PR-B: ALWAYS_ON — 매월 1일은 KRX 공휴일(신정 등)일 수 있으나 내부 데이터 검증이라 실행 가치 있음.
  scheduledJob('0 22 1 * *', 'ALWAYS_ON', 'walk_forward_validation', async () => {
    const res = await runWalkForwardValidation();
    console.log(`[WalkForward] frozen=${res.frozen}`);
  }, { timezone: 'UTC' });

  // Counterfactual Shadow resolve — 평일 KST 16:00 (UTC 07:00).
  // PR-B: TRADING_DAY_ONLY — 30/60/90 거래일 경과 후보의 현재가 채움. KRX 공휴일에 KIS 호출 의미 없음.
  scheduledJob('0 7 * * 1-5', 'TRADING_DAY_ONLY', 'counterfactual_resolve', async () => {
    try {
      const res = await resolveCounterfactuals((code) => fetchCurrentPrice(code).catch(() => null));
      console.log(`[Counterfactual] resolved d30=${res.resolved30d} d60=${res.resolved60d} d90=${res.resolved90d}`);
    } catch (e) {
      console.error('[Counterfactual] 실행 실패:', e);
    }
    // PR-22 / ADR-0007 — resolve 직후 하이브리드 suggest 평가. 실패는 전체 cron 을 깨뜨리지 않음.
    await evaluateCounterfactualSuggestion().catch((e) => console.warn('[Counterfactual][suggest] 평가 실패:', e));
  }, { timezone: 'UTC' });

  // Parallel Universe Ledger resolve — 평일 KST 16:15 (UTC 07:15).
  // PR-B: TRADING_DAY_ONLY — OPEN 엔트리의 TP/SL/EXPIRED 판정. KRX 공휴일에 가격 조회 무의미.
  scheduledJob('15 7 * * 1-5', 'TRADING_DAY_ONLY', 'ledger_resolve', async () => {
    try {
      const res = await resolveLedger((code) => fetchCurrentPrice(code).catch(() => null));
      console.log(`[Ledger] TP=${res.hitTP} SL=${res.hitSL} EXP=${res.expired}`);
    } catch (e) {
      console.error('[Ledger] 실행 실패:', e);
    }
    // PR-22 / ADR-0007 — 같은 16:15 cron 안에서 suggest 평가 + kellySurface/regimeCoverage 일일 스윕.
    await evaluateLedgerSuggestion().catch((e) => console.warn('[Ledger][suggest] 평가 실패:', e));
    await evaluateKellySurfaceSuggestion({}).catch((e) => console.warn('[KellySurface][suggest] 평가 실패:', e));
    await evaluateRegimeCoverageSuggestion().catch((e) => console.warn('[RegimeCoverage][suggest] 평가 실패:', e));
  }, { timezone: 'UTC' });
}
