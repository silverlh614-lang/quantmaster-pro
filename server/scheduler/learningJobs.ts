/**
 * @responsibility 자기학습 cron 작업(L3 캘리브레이션·일일 미니 백테스트·Sharpe 경보·F2W 피드백·Nightly Reflection·Phase 1 Learning)을 등록한다.
 */
import cron from 'node-cron';
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
import { runDeterminismCanary } from '../learning/determinismCanary.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';

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

  // Nightly Reflection Engine — 매일 KST 19:00 (UTC 10:00).
  // Silence Monday / Budget Governor / Integrity Guard 내부 적용.
  cron.schedule('0 10 * * *', async () => {
    try {
      const res = await runNightlyReflection();
      console.log(`[NightlyReflection] ${res.date} mode=${res.mode} executed=${res.executed}${res.skipped ? ` skipped=${res.skipped}` : ''}`);
    } catch (e) {
      console.error('[NightlyReflection] 실행 실패:', e);
    }
  }, { timezone: 'UTC' });

  // Ghost Portfolio 갱신 — 매일 KST 15:40 (UTC 06:40). 장마감 직후 current price 로 수익률 갱신.
  cron.schedule('40 6 * * 1-5', async () => {
    try {
      const res = await refreshGhostPortfolio();
      console.log(`[GhostPortfolio] updated=${res.updated} closed=${res.closed} skipped=${res.skipped}`);
    } catch (e) {
      console.error('[GhostPortfolio] 갱신 실패:', e);
    }
  }, { timezone: 'UTC' });

  // Silent Knowledge Distillation — 매주 일요일 KST 18:00 (UTC 09:00).
  // 지난 7일 반성 리포트 → "이번 주 1줄 교훈" → distilled-weekly.txt append.
  cron.schedule('0 9 * * 0', async () => {
    try {
      const res = await distillWeeklyKnowledge();
      if (res.executed) console.log(`[Distillation] 축적: ${res.lesson}`);
      else console.log(`[Distillation] skipped=${res.skipped}`);
    } catch (e) {
      console.error('[Distillation] 실행 실패:', e);
    }
  }, { timezone: 'UTC' });

  // Idea 11 — Walk-Forward Validation: 매월 1일 KST 07:00 (UTC 22:00 전달).
  // IS(3개월) vs OOS(직전 30일) 승률 격차 > 15%p 시 가중치 동결.
  cron.schedule('0 22 1 * *', async () => {
    try {
      const res = await runWalkForwardValidation();
      console.log(`[WalkForward] frozen=${res.frozen}`);
    } catch (e) {
      console.error('[WalkForward] 실행 실패:', e);
    }
  }, { timezone: 'UTC' });

  // Idea 4 — Counterfactual Shadow resolve: 매일 KST 16:00 (UTC 07:00).
  // 30·60·90 거래일 경과한 탈락 후보의 현재가 기준 수익률을 채워 넣는다.
  cron.schedule('0 7 * * 1-5', async () => {
    try {
      const res = await resolveCounterfactuals((code) => fetchCurrentPrice(code).catch(() => null));
      console.log(`[Counterfactual] resolved d30=${res.resolved30d} d60=${res.resolved60d} d90=${res.resolved90d}`);
    } catch (e) {
      console.error('[Counterfactual] 실행 실패:', e);
    }
    // PR-22 / ADR-0007 — resolve 직후 하이브리드 suggest 평가. 실패는 전체 cron 을 깨뜨리지 않음.
    await evaluateCounterfactualSuggestion().catch((e) => console.warn('[Counterfactual][suggest] 평가 실패:', e));
  }, { timezone: 'UTC' });

  // Idea 2 — Parallel Universe Ledger resolve: 매일 KST 16:15 (UTC 07:15).
  // OPEN 엔트리의 TP/SL/EXPIRED 판정을 단일 현재가 기준 버퍼링.
  cron.schedule('15 7 * * 1-5', async () => {
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

  // 결정성 패치 Tier 2 #6 — Determinism Canary 매일 KST 02:00 (UTC 17:00 전일).
  // fixture 5건 게이트 평가 후 직전 일자와 비교, drift 시 CRITICAL 경보.
  cron.schedule('0 17 * * *', async () => {
    try {
      const report = await runDeterminismCanary();
      if (report.unexpectedDrift.length > 0) {
        console.warn(`[DeterminismCanary] ⚠️ unexpected drift ${report.unexpectedDrift.length}건 — 가중치 미변경`);
      } else if (report.intendedDrift.length > 0) {
        console.log(`[DeterminismCanary] intended drift ${report.intendedDrift.length}건 — 가중치 변경 동반`);
      } else {
        console.log(`[DeterminismCanary] ✅ ${report.matched}/${report.totalFixtures} fixture 일치`);
      }
    } catch (e) {
      console.error('[DeterminismCanary] 실행 실패:', e instanceof Error ? e.message : e);
    }
  }, { timezone: 'UTC' });
}
