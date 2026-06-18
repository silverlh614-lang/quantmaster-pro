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
import { learningRepairRun } from '../learning/learningRepairCommand.js';
import { distillWeeklyKnowledge } from '../learning/silentKnowledgeDistillation.js';
import { runWalkForwardValidation } from '../learning/walkForwardValidator.js';
import { evaluateCounterfactualSuggestion } from '../learning/counterfactualShadow.js';
import { counterfactualResolveDueRun } from '../learning/learningSampleQuality.js';
import { resolveLedger, evaluateLedgerSuggestion } from '../learning/ledgerSimulator.js';
import { evaluateKellySurfaceSuggestion } from '../learning/kellySurfaceMap.js';
import { evaluateRegimeCoverageSuggestion } from '../learning/regimeBalancedSampler.js';
import {
  resolveFutureReturns,
  isFutureReturnResolverEnabled,
} from '../learning/futureReturnResolver.js';
import { fetchHistoricalClosePrice } from '../clients/historicalClosePrice.js';
import {
  isMissedLearningQueueEnabled,
  replayMissedLearningJobs,
} from '../learning/missedLearningQueue.js';
import {
  computeSafetyGateAttribution,
  isSafetyGateAttributionEnabled,
} from '../learning/safetyGateAttribution.js';
import {
  computeShadowVsLiveDelta,
  isShadowVsLiveDeltaEnabled,
} from '../learning/shadowVsLiveDelta.js';
import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import {
  runUpdateGate3ForwardReturnsJob,
  isGate3ForwardReturnCronEnabled,
} from '../trading/gate3ForwardReturnCron.js';
import {
  isUnifiedForwardOutcomeLabelerEnabled,
  runUnifiedForwardOutcomeLabeler,
} from '../learning/unifiedForwardOutcomeLabeler.js';
import {
  isShakeoutStopForwardLabelerEnabled,
  runShakeoutStopForwardLabeler,
} from '../learning/shakeoutStopForwardLabeler.js';
import { runGateThresholdReadinessAlert } from '../learning/gateThresholdReadinessAlert.js';
import { runDailyEvalFallbackIfMissed } from '../learning/dailyEvalFallback.js';
import {
  evaluateAutoActivation,
  evaluateLeverReadiness,
  formatAutoActivationReport,
  isSelfValidationAutoActivationEnabled,
  LEVER_REGISTRY,
  type AutoActivationEvaluateInput,
} from '../trading/selfValidationAutoActivationAdr0633.js';
import {
  loadAutoActivationStreaks,
  recordLeverReadiness,
} from '../persistence/autoActivationStreakRepo.js';
import { buildPromotionReadinessBoard } from '../trading/signalScanner/promotionReadinessAdr0631.js';
import {
  listGate1DryRunObservationRows,
  buildGate1ThresholdEvidenceSummary,
} from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import { buildCounterfactualOutcomeBoard } from '../learning/counterfactualOutcomeBoard.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { scheduledJob } from './scheduleGuard.js';

async function runUnifiedForwardOutcomeLabelerJob(trigger: 'startup' | 'scheduled'): Promise<void> {
  if (!isUnifiedForwardOutcomeLabelerEnabled()) return;
  const res = await runUnifiedForwardOutcomeLabeler();
  console.log(
    `[UnifiedForwardOutcomeLabeler] trigger=${trigger} healthy=${res.unifiedOutcomeLabelerHealthy} sourceRowsScanned=${res.sourceRowsScanned} rowsUpdatedD1=${res.rowsUpdatedD1} rowsUpdatedD3=${res.rowsUpdatedD3} rowsUpdatedD5=${res.rowsUpdatedD5} rowsUpdatedD10=${res.rowsUpdatedD10} dataUnavailable=${res.dataUnavailable} duplicateSuppressed=${res.duplicateSuppressed} stalePending=${res.stalePending} gate3EvidenceSampleSize=${res.gate3EvidenceSampleSize} gate1CalibrationSampleSize=${res.gate1CalibrationSampleSize} nearMissEvidenceSampleSize=${res.nearMissEvidenceSampleSize} executionImpact=${res.executionImpact}`,
  );
}

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
  // ADR-0176 — TRADING_DAY_ONLY silent skip 시 MissedLearningQueue enqueue (ENV gate).
  scheduledJob('30 15 * * 0-4', 'TRADING_DAY_ONLY', 'daily_mini_backtest', async () => {
    console.log('[Scheduler] 일일 미니 백테스트 시작 (00:30 KST)');
    await runWeeklyMiniBacktest();
  }, { timezone: 'UTC', enqueueOnSkip: {} });

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
  // ADR-0176 — TRADING_DAY_ONLY silent skip 시 MissedLearningQueue enqueue (ENV gate).
  scheduledJob('0 10 * * 1-5', 'TRADING_DAY_ONLY', 'nightly_reflection', async () => {
    const res = await runNightlyReflection();
    console.log(`[NightlyReflection] ${res.date} mode=${res.mode} executed=${res.executed}${res.skipped ? ` skipped=${res.skipped}` : ''}`);
  }, { timezone: 'UTC', enqueueOnSkip: {} });

  // Ghost Portfolio 갱신 — 평일 KST 15:40 (UTC 06:40). 장마감 직후 current price 로 수익률 갱신.
  // PR-B: TRADING_DAY_ONLY — KRX 공휴일에 ghost portfolio 갱신해도 KIS 호출만 낭비.
  // ADR-0176 — TRADING_DAY_ONLY silent skip 시 MissedLearningQueue enqueue (ENV gate).
  scheduledJob('40 6 * * 1-5', 'TRADING_DAY_ONLY', 'ghost_portfolio', async () => {
    const res = await refreshGhostPortfolio();
    console.log(`[GhostPortfolio] updated=${res.updated} closed=${res.closed} skipped=${res.skipped}`);
  }, { timezone: 'UTC', enqueueOnSkip: {} });


  // Learning Flow Unclog Patch v1 — 장마감 후 가상 close→outcome→attribution→diagnostic suggest→Gemini schedule.
  // 실거래 주문/브로커 adapter 미사용, Ghost/Shadow executionImpact=NONE 보장.
  scheduledJob('50 6 * * 1-5', 'TRADING_DAY_ONLY', 'learning_flow_unclog_eod', async () => {
    const res = await learningRepairRun();
    console.log(`[LearningFlowUnclog] order=${res.order.join('>')} closed=${res.close.closed} attr=${res.attr.processedCount} brokerOrdersCreated=${res.brokerOrdersCreated}`);
  }, { timezone: 'UTC', enqueueOnSkip: {} });

  // 장중 15분 간격 virtual close scan — 실제 주문/포지션 변경 없음.
  scheduledJob('*/15 0-6 * * 1-5', 'TRADING_DAY_ONLY', 'learning_flow_unclog_intraday', async () => {
    const res = await learningRepairRun();
    console.log(`[LearningFlowUnclogIntraday] closed=${res.close.closed} pendingRetry=${res.close.pendingRetry} brokerOrdersCreated=${res.brokerOrdersCreated}`);
  }, { timezone: 'UTC', enqueueOnSkip: {} });

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
  // ADR-0176 — TRADING_DAY_ONLY silent skip 시 MissedLearningQueue enqueue (ENV gate).
  scheduledJob('0 7 * * 1-5', 'TRADING_DAY_ONLY', 'counterfactual_resolve', async () => {
    try {
      const res = counterfactualResolveDueRun();
      console.log(`[Counterfactual] dueResolve labeled=${res.labeled} stillPending=${res.stillPending} maturedNow=${res.maturedNowCount} metadataRepairedBeforeResolve=${res.metadataRepairedBeforeResolve} metadataEntryRecoveredBeforeResolve=${res.metadataEntryRecoveredBeforeResolve} executionImpact=${res.executionImpact} brokerOrdersCreated=${res.brokerOrdersCreated}`);
    } catch (e) {
      console.error('[Counterfactual] 실행 실패:', e);
    }
    // PR-22 / ADR-0007 — resolve 직후 하이브리드 suggest 평가. 실패는 전체 cron 을 깨뜨리지 않음.
    await evaluateCounterfactualSuggestion().catch((e) => console.warn('[Counterfactual][suggest] 평가 실패:', e));
  }, { timezone: 'UTC', enqueueOnSkip: {} });

  // Parallel Universe Ledger resolve — 평일 KST 16:15 (UTC 07:15).
  // PR-B: TRADING_DAY_ONLY — OPEN 엔트리의 TP/SL/EXPIRED 판정. KRX 공휴일에 가격 조회 무의미.
  // ADR-0176 — TRADING_DAY_ONLY silent skip 시 MissedLearningQueue enqueue (ENV gate).
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
  }, { timezone: 'UTC', enqueueOnSkip: {} });

  // Future Return Resolver — 평일 KST 16:30 (UTC 07:30). KRX 장 마감 30분 후.
  // ADR-0175 (Phase 2b-1): ShadowLearningOnlySignal 영속의 1/3/5/20일 후 future return
  // 갱신 + outcome 분류 (WIN/LOSS/BE, ADR-0112 임계 정합).
  // ENV `FUTURE_RETURN_RESOLVER_ENABLED=true` default OFF — 운영자 명시 활성화 의무.
  // Historical close priceFetcher is required here; do not fall back to current price.
  // wiring 후 KIS 일봉 / Yahoo historical API 결합 시 cron 인자에 전달.
  // ScheduleClass='TRADING_DAY_ONLY' (ADR-0045) — KRX 휴장일 자동 silent skip.
  scheduledJob('30 7 * * 1-5', 'TRADING_DAY_ONLY', 'future_return_resolve', async () => {
    if (!isFutureReturnResolverEnabled()) return;
    const result = await resolveFutureReturns({
      priceFetcher: (symbol, asOf) => fetchHistoricalClosePrice(symbol, asOf),
    });
    console.log(
      `[FutureReturnResolver] resolved=${result.resolvedCount}/${result.totalSignals} outcomes=${result.outcomesUpdated} errors=${result.errors} (${result.durationMs}ms)`,
    );
  }, { timezone: 'UTC' });

  // Gate3 Forward Return 갱신 — 평일 KST 16:35 (UTC 07:35). KRX 장 마감 35분 후.
  // P1-FIX: gate3 outcome seed 의 d1/d3/d5/d10 forward-return 갱신 잡이 어떤 스케줄러에도
  //   등록되지 않아 학습 증거가 영원히 PENDING 으로 적체(pending=1426, d1Updated=0,
  //   WARN_FORWARD_RETURN_UPDATE_MISSING)되던 결함의 wiring 사이트.
  // Shadow Learning 증거 갱신 전용 — executionImpact=NONE, LIVE 주문/SourceSnapshot/Gate 판정 본체 변경 0.
  // 9대 불변식 #2(Shadow 무중단) / #6(providerIssue≠marketSignal: 종가 실패 시 seed skip → 재시도) 준수.
  // KIS 호출은 kisClient 단일 통로(fetchCurrentPrice) + per-symbol 캐시로 quota 보호.
  // ENV `GATE3_FORWARD_RETURN_CRON_ENABLED=false` 1줄로 즉시 비활성 (ADR-0157, default ON).
  // ScheduleClass='TRADING_DAY_ONLY' (ADR-0045) — KRX 휴장일 자동 silent skip
  //   (PENDING seed 는 다음 영업일 cron 호출 시 자연 재시도, enqueue 불필요).
  scheduledJob('35 7 * * 1-5', 'TRADING_DAY_ONLY', 'gate3_forward_return_update', async () => {
    if (!isGate3ForwardReturnCronEnabled()) return;
    const res = await runUpdateGate3ForwardReturnsJob();
    console.log(
      `[Gate3ForwardReturn] pending=${res.pending} dueSeeds=${res.seedsWithDueHorizon} symbolsQueried=${res.symbolsQueried} symbolsFailed=${res.symbolsFailed} updated=${res.seedsUpdated}`,
    );
  }, { timezone: 'UTC' });

  // Shakeout Stop Forward Labeler — 평일 KST 16:50 (UTC 07:50). gate3_forward_return(16:35)·
  //   shadow_live_delta(16:45) 이후 stagger. KRX 장 마감 50분 후.
  // ADR-0625: 실행 청산(HIT_STOP) 포지션의 손절-후 1/3/5/10일 종가를 KIS 일봉(L1, read-only)
  //   으로 추적 → 청산가 대비 최대 회복률 산출 → 셰이크아웃 여부(+5%) 라벨링 (관측 전용).
  //   shadow-trades.json 영속 본체 무수정, 라벨은 물리 분리 별도 ledger 영속 (ADR-0445).
  // executionImpact=NONE — LIVE 주문/SourceSnapshot/Gate 판정 본체 변경 0.
  // Historical close priceFetcher is required here; do not fall back to current price.
  //   fetchHistoricalClosePrice(KIS-first) 주입 — KIS quota 보호 (per-symbol 캐시).
  // 9대 불변식 #2(Shadow 무중단)/#6(종가 결손 시 horizon skip → 다음 cron 재시도, 약세변환 0) 준수.
  // ENV `SHAKEOUT_STOP_FORWARD_LABELER_ENABLED=true` default OFF — 운영자 명시 활성화 의무.
  // ScheduleClass='TRADING_DAY_ONLY' (ADR-0045) — KRX 휴장일 자동 silent skip
  //   (PENDING 라벨은 다음 영업일 cron 호출 시 자연 재시도, enqueue 불필요).
  scheduledJob('50 7 * * 1-5', 'TRADING_DAY_ONLY', 'shakeout_stop_forward_labeling', async () => {
    if (!isShakeoutStopForwardLabelerEnabled()) return;
    const res = await runShakeoutStopForwardLabeler({
      fetcher: (symbol, asOf) => fetchHistoricalClosePrice(symbol, asOf),
    });
    console.log(
      `[ShakeoutStopForwardLabeler] candidates=${res.totalCandidates} resolved=${res.resolvedNow} pending=${res.pending} shakeout=${res.shakeoutCount} errors=${res.errors} (${res.durationMs}ms)`,
    );
  }, { timezone: 'UTC' });

  // Safety Gate Attribution — 평일 KST 16:40 (UTC 07:40). future_return_resolve(16:30) 직후라
  //   당일 갱신된 futureReturn{1/3/5/20}d 를 입력으로 사용.
  // ADR-0174 §2.1 (PENDING_WIRING A12 wiring): 7 게이트 사후 효과 (avoidedLoss/missedGain/
  //   netGateImpact/gatePrecision) 일일 진단 로그 — read-only 분석 SSOT 의 단일 cron 호출자.
  // executionImpact=NONE — LIVE 주문/SourceSnapshot/Gate 판정 본체 변경 0.
  // ENV `SAFETY_GATE_ATTRIBUTION_ENABLED=true` default OFF — 운영자 명시 활성화 의무 (첫 분기).
  // ScheduleClass='TRADING_DAY_ONLY' (ADR-0045) — KRX 휴장일 silent skip. 본 분석은 전체
  //   영속 위 stateless 재계산이라 skip replay 무의미 — enqueueOnSkip 비전달 (의도).
  // 9대 불변식 #2 — throw 는 scheduledJob 래퍼가 catch+로그 (상위 스케줄러 무중단).
  scheduledJob('40 7 * * 1-5', 'TRADING_DAY_ONLY', 'safety_gate_attribution', () => {
    if (!isSafetyGateAttributionEnabled()) return;
    const results = computeSafetyGateAttribution(loadShadowLearningOnlySignals());
    const active = results.filter((r) => r.sampleSize > 0);
    console.log(
      `[SafetyGateAttribution] gates=${results.length} active=${active.length}` +
        (active.length > 0
          ? ` ${active.map((r) => `${r.gate}:net=${r.netGateImpact.toFixed(2)}|n=${r.sampleSize}`).join(' ')}`
          : ''),
    );
  }, { timezone: 'UTC' });

  // Shadow vs Live Delta — 평일 KST 16:45 (UTC 07:45). safety_gate_attribution(16:40) 직후.
  // ADR-0174 §2.2 (PENDING_WIRING A13 wiring): 5 카테고리 missedAlpha 일일 진단 로그 —
  //   read-only 분석 SSOT 의 단일 cron 호출자. LIVE_BUY_SHADOW_BETTER_SIZE 비교 알고리즘은
  //   Phase 3 잔여 (본 wiring 무접촉 — cron 등록만).
  // executionImpact=NONE — LIVE 주문/SourceSnapshot/Gate 판정 본체 변경 0.
  // ENV `SHADOW_LIVE_DELTA_REPORT_ENABLED=true` default OFF — 운영자 명시 활성화 의무 (첫 분기).
  // ScheduleClass='TRADING_DAY_ONLY' — stateless 재계산이라 enqueueOnSkip 비전달 (의도).
  // 9대 불변식 #2 — throw 는 scheduledJob 래퍼가 catch+로그 (상위 스케줄러 무중단).
  scheduledJob('45 7 * * 1-5', 'TRADING_DAY_ONLY', 'shadow_live_delta_report', () => {
    if (!isShadowVsLiveDeltaEnabled()) return;
    const results = computeShadowVsLiveDelta({
      shadowSignals: loadShadowLearningOnlySignals(),
      liveTrades: loadShadowTrades(),
    });
    const active = results.filter((r) => r.sampleSize > 0);
    console.log(
      `[ShadowVsLiveDelta] categories=${results.length} active=${active.length}` +
        (active.length > 0
          ? ` ${active.map((r) => `${r.category}:alpha=${r.missedAlpha.toFixed(2)}|n=${r.sampleSize}`).join(' ')}`
          : ''),
    );
  }, { timezone: 'UTC' });

  // MissedLearningQueue replay — 평일 KST 09:30 (UTC 00:30). KRX 장 시작 30분 전 안전 시간대.
  // ADR-0176 (Phase 2b-2): KRX 휴장일·서버 장애로 silent skip 된 5 학습 cron 의 작업을
  //   다음 영업일 시점에 자동 복구 시도. enqueue 본체는 scheduleGuard hook (옵셔널 + ENV gate) 가
  //   처리하고, 본 cron 은 *복구 사이클* 의 단일 호출자.
  // ENV `MISSED_LEARNING_QUEUE_ENABLED=true` default OFF — 운영자 명시 활성화 의무.
  // ScheduleClass='TRADING_DAY_ONLY' (ADR-0045) — 휴장일 자체는 자동 silent skip
  //   (다음 영업일 cron 호출 시 자연 복구 시도).
  // 호출자 1건 — replayMissedLearningJobs 는 본 cron + 모듈/테스트 외 호출 0건 (정적 grep 가드).
  // Real dispatcher maps jobName to recovery functions; failures remain FAILED, not fake success.
  // Unified Forward Outcome Labeler: learning evidence only, no threshold or live-order mutation.
  void runUnifiedForwardOutcomeLabelerJob('startup').catch((e) => {
    console.warn('[UnifiedForwardOutcomeLabeler] startup invocation failed', e);
  });
  scheduledJob('36 7 * * *', 'ALWAYS_ON', 'unified_forward_outcome_labeling', async () => {
    await runUnifiedForwardOutcomeLabelerJob('scheduled');
  }, { timezone: 'UTC', enqueueOnSkip: {} });

  // counterfacture_gate Phase J — readiness 알람. labeler 성숙(07:36 UTC) 직후 14분 뒤.
  // gate×regime ROC 권고가 처음 actionable(≥30표본)로 넘어가면 1회 텔레그램 푸시(dedup 영속,
  // steady-state 무음). "검증 기간 됐는데 놓침" 방지. read-only — 임계 변경 0, executionImpact=NONE.
  // ENV `COUNTERFACTURE_GATE_READINESS_ALERT_DISABLED=true` 1줄 즉시 비활성(default ON).
  scheduledJob('50 7 * * *', 'ALWAYS_ON', 'counterfacture_gate_readiness_alert', async () => {
    const res = await runGateThresholdReadinessAlert();
    console.log(`[CounterfactureGateReadiness] enabled=${res.enabled} ready=${res.readyKeys.length} newlyAlerted=${res.newlyAlerted.length} sent=${res.sent}`);
  }, { timezone: 'UTC' });

  // L2 일일 평가 fallback — 평일 KST 17:05 (UTC 08:05). 2026-06-11 EVAL_STALE 41h 인시던트 처방.
  // runDailyEval 의 유일 호출(tradingOrchestrator 16:30+ REPORT_ANALYSIS tick, 일일 1회)이 그
  //   시각 서버 다운/tick 미실행이면 그날 L2 평가가 통째로 누락 — 단일 의존 제거용 보충 cron.
  // 이중 실행 방지: loadLearningState().lastEvalAt 의 KST 날짜가 오늘이면 no-op 로그 1줄
  //   (순수 가드 hasDailyEvalRunOnKstDate) — 16:30 정상 실행 시 항상 no-op → 평시 byte-equivalent.
  // 17:05 슬롯 — cron stagger 인벤토리(2026-06-10) 대조: 17:00/17:10 은 금요일 전용 잡뿐, 평일 무점유.
  // 9대 불변식 #1·#2 — 내부 try/catch + scheduleGuard 래퍼 이중 방어 (스케줄러 무중단).
  // 보충 실행 시에만 운영자 대면 NORMAL 1줄 (CH4 noiseEvent, executionImpact=NONE) — 모듈 내부 발송.
  // ADR-0176 — TRADING_DAY_ONLY silent skip 시 MissedLearningQueue enqueue (ENV gate) →
  //   missed_learning_replay(익일 09:30) 가 daily_eval_fallback dispatcher 매핑으로 보충.
  scheduledJob('5 8 * * 1-5', 'TRADING_DAY_ONLY', 'daily_eval_fallback', async () => {
    try {
      const res = await runDailyEvalFallbackIfMissed({ trigger: 'FALLBACK_CRON' });
      console.log(
        `[DailyEvalFallback] executed=${res.executed}${res.skipReason ? ` skipReason=${res.skipReason}` : ''}`,
      );
    } catch (e) {
      console.error('[DailyEvalFallback] 실행 실패:', e);
    }
  }, { timezone: 'UTC', enqueueOnSkip: {} });

  // MissedLearningQueue replay: trading-day recovery of skipped learning jobs.
  scheduledJob('30 0 * * 1-5', 'TRADING_DAY_ONLY', 'missed_learning_replay', async () => {
    if (!isMissedLearningQueueEnabled()) return;
    const today = new Date().toISOString().slice(0, 10);
    const result = await replayMissedLearningJobs({ tradingDate: today, maxJobsPerRun: 10 });
    console.log(
      `[MissedLearningReplay] replayed=${result.replayed} failed=${result.failed} dropped=${result.dropped}`,
    );
  }, { timezone: 'UTC' });

  // ADR-0634 — Shadow Self-Validation Auto-Activation runtime wiring. 평일 KST 17:00 (UTC 08:00).
  // /promotion_readiness 동일 빌더 재사용(두 번째 측정 공식 0) → LIVE_SAFE lever 일별 READY streak
  //   멱등 갱신 → ADR-0633 evaluator(두 번째 판정 공식 0)로 자가 활성 판정. ACTIVATE 시 CH4(JOURNAL)
  //   통지 1회(executionImpact=NONE, CH2 금지). 항상 Railway 로그 1줄.
  // master OFF(SELF_VALIDATION_AUTO_ACTIVATION_ENABLED!=true) → 첫 줄 early-return = repo/process.env/
  //   telegram 무접촉 = byte-identical. EXCLUDED lever 는 streak 추적 0(evaluator 항상 EXCLUDED).
  // throw 는 scheduledJob 래퍼가 catch(불변식 #1 liveness).
  scheduledJob('0 8 * * 1-5', 'TRADING_DAY_ONLY', 'self_validation_auto_activation', async () => {
    if (!isSelfValidationAutoActivationEnabled()) return; // master OFF = no-op byte-identical.

    const now = new Date();
    // (a) 측정 — /promotion_readiness 와 동일 빌더 재사용.
    const rows = await listGate1DryRunObservationRows();
    const evidence = rows.length > 0 ? buildGate1ThresholdEvidenceSummary(rows) : undefined;
    const counterfactual = await buildCounterfactualOutcomeBoard({ gate1Rows: rows });
    const board = buildPromotionReadinessBoard({ evidence, counterfactual });

    // (b) 영속 streak 갱신 — LIVE_SAFE lever 만, evaluateLeverReadiness 동일 criteria.
    const dateKey = toKstDateKey(now); // KST 'YYYY-MM-DD' (기존 KRX 캘린더 util 재사용).
    const baseInput: AutoActivationEvaluateInput = { now, promotionReadiness: board, evidence, counterfactual };
    for (const lever of LEVER_REGISTRY) {
      if (lever.eligibility !== 'LIVE_SAFE') continue; // EXCLUDED 는 streak 추적 불요.
      const { readyExclStreak } = evaluateLeverReadiness(lever, baseInput);
      recordLeverReadiness(lever.leverId, readyExclStreak, dateKey); // 멱등.
    }

    // (c) 평가 — ADR-0633 evaluator. 영속 streak 주입.
    const consecutiveReadyDaysByLever: Record<string, number> = {};
    const streaks = loadAutoActivationStreaks();
    for (const [leverId, s] of Object.entries(streaks)) consecutiveReadyDaysByLever[leverId] = s.streak;
    const report = evaluateAutoActivation({ ...baseInput, consecutiveReadyDaysByLever });

    // (d) 통지(CH4 only) + 항상 Railway 로그.
    const heldCount = report.decisions.filter((d) => d.verdict === 'HOLD').length;
    const excludedCount = report.decisions.filter((d) => d.verdict === 'EXCLUDED').length;
    console.info(
      `[SelfValidationAutoActivation] master=${report.masterEnabled} ` +
        `activated=[${report.activatedLeverIds.join(',') || 'NONE'}] ` +
        `held=${heldCount} excluded=${excludedCount} decisions=${report.decisions.length}`,
    );
    if (report.activatedLeverIds.length > 0) {
      // CH4(JOURNAL) only — sendTelegramAlert 미분류 → 기본 JOURNAL/CH4 라우팅. CH2 금지(ADR-0607).
      await sendTelegramAlert(formatAutoActivationReport(report), {
        priority: 'NORMAL',
        category: 'self_validation_auto_activation',
        dedupeKey: `self_validation_auto_activation:${report.activatedLeverIds.join(',')}`,
        cooldownMs: 12 * 60 * 60_000,
        executionImpact: 'NONE',
      });
    }
  }, { timezone: 'UTC' });
}
