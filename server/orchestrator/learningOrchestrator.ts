/**
 * learningOrchestrator.ts — 4티어 자기학습 오케스트레이터 (아이디어 8)
 *
 * tradingOrchestrator의 REPORT_ANALYSIS state에 박혀있던 학습 호출을 분리하여
 * L1~L4 티어로 명확히 계층화한다.
 *
 *   L1 (실시간)   : Shadow 청산 이벤트 훅 — 즉시 miniEval + incrementalCalib
 *   L2 (일중)     : 16:30 KST evaluateRecommendations + detectPerformanceAnomaly
 *                   + 첫 캘리브레이션 임계값(10건) 체크
 *   L3 (주간)     : 매주 월요일 07:00 KST 경량 캘리브레이션 + 주간 미니 백테스트
 *   L4 (월간)     : 월말 28일+ WalkForward → calibrateSignalWeights →
 *                   calibrateByRegime → runConditionAudit
 *
 * 모든 티어는 learningState에 마지막 실행 시각을 기록하여 health-check에서 추적.
 */

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { evaluateRecommendations, getRecommendations } from '../learning/recommendationTracker.js';
import { detectPerformanceAnomaly } from '../learning/anomalyDetector.js';
import { calibrateSignalWeights } from '../learning/signalCalibrator.js';
import { calibrateByRegime } from '../learning/regimeAwareCalibrator.js';
import { runWalkForwardValidation } from '../learning/walkForwardValidator.js';
import { runConditionAudit } from '../learning/conditionAuditor.js';
import { runBacktest, runWeeklyMiniBacktest } from '../learning/backtestEngine.js';
import { bootstrapAttributionFromRecommendations } from '../learning/synergyBootstrap.js';
import { reEvaluateExpired } from '../learning/lateWinEvaluator.js';
import { runExperimentalConditionBacktest } from '../learning/experimentalConditionTester.js';
import {
  runIncrementalCalibration,
  calibrateSignalWeightsLite,
} from '../learning/incrementalCalibrator.js';
import { miniEvaluateSingle } from '../learning/miniEvaluate.js';
import type { ServerAttributionRecord } from '../persistence/attributionRepo.js';
import {
  markTierRan,
  markEvalRan,
  markCalibRan,
  isFirstCalibrationDone,
  markFirstCalibrationDone,
} from '../learning/learningState.js';

const FIRST_CALIB_THRESHOLD = 10;

class LearningOrchestrator {
  /**
   * L1 훅 — Shadow 거래 결산(HIT_TARGET/HIT_STOP) 직후 동일 종목 PENDING 추천
   * 즉시 평가. 학습 지연을 최대 7시간에서 5분 이내로 단축.
   * 호출자는 shadow.stockCode만 알려주면 된다.
   */
  async onShadowResolved(stockCode: string): Promise<void> {
    try {
      const changed = await miniEvaluateSingle(stockCode);
      if (changed > 0) {
        console.log(`[LearningOrch L1] ${stockCode} Shadow 청산 이벤트 → ${changed}건 즉시 결산`);
      }
      markTierRan('L1_REALTIME');
    } catch (e) {
      console.error('[LearningOrch L1] onShadowResolved 실패:', e);
    }
  }

  /**
   * L1 훅 — Attribution 레코드 신규 저장 직후 단일 레코드 기반 온라인 학습.
   * client POST /api/attribution/record 에서 setImmediate 로 호출.
   */
  async onAttributionRecorded(record: ServerAttributionRecord): Promise<void> {
    try {
      await runIncrementalCalibration(record);
      markTierRan('L1_REALTIME');
    } catch (e) {
      console.error('[LearningOrch L1] onAttributionRecorded 실패:', e);
    }
  }

  /**
   * L2 — 일일 평가 + 이상 감지 + 첫 캘리브레이션 임계값 감지.
   * 기존 tradingOrchestrator REPORT_ANALYSIS (16:30+) 에서 위임받는다.
   */
  async runDailyEval(): Promise<void> {
    console.log('[LearningOrch L2] 일일 평가 시작');
    await evaluateRecommendations().catch((e) => console.error('[L2 eval]', e));
    markEvalRan();
    await detectPerformanceAnomaly().catch((e) => console.error('[L2 anomaly]', e));
    await this.checkFirstCalibThreshold();
    markTierRan('L2_DAILY');
    console.log('[LearningOrch L2] 일일 평가 완료');
  }

  /**
   * L3 — 주간 경량 보정 (아이디어 1).
   * 월요일 07:00 KST cron 에서 호출. 워크포워드 동결 상태면 Lite도 스킵.
   */
  async runWeeklyCalib(): Promise<void> {
    console.log('[LearningOrch L3] 주간 경량 보정 시작');
    // 아이디어 5 (Phase 3): EXPIRED → LATE_WIN 재평가 (60/90일 시점).
    // Yahoo OHLCV 호출이 있으므로 주간 1회만 실행.
    try {
      const converted = await reEvaluateExpired();
      if (converted > 0) {
        await sendTelegramAlert(
          `🕰 <b>[EXPIRED 재평가]</b> LATE_WIN 전환 ${converted}건\n` +
          `타이밍 조건(momentum, turtle_high, 피보나치, 엘리엇, 다이버전스)의 ` +
          `가중치 기여는 0.7× 페널티 적용 — "신호는 맞았지만 타이밍은 빗나감" 구분.`,
        ).catch(console.error);
      }
    } catch (e) {
      console.error('[L3 late-win-eval]', e);
    }
    await calibrateSignalWeightsLite().catch((e) => console.error('[L3 lite-calib]', e));
    await runWeeklyMiniBacktest().catch((e) => console.error('[L3 mini-backtest]', e));
    markTierRan('L3_WEEKLY');
    console.log('[LearningOrch L3] 주간 경량 보정 완료');
  }

  /**
   * L3.5 — 토요일 전체 OHLCV 백테스트 (기존 runBacktest).
   * scheduler.ts 토요일 08:00 KST cron 에서 호출. Saturday는 전체 이력 재검증.
   */
  async runWeeklyFullBacktest(): Promise<void> {
    console.log('[LearningOrch L3.5] 토요일 전체 백테스트 시작');
    await runBacktest().catch((e) => console.error('[L3.5 backtest]', e));
    markTierRan('L3_WEEKLY');
  }

  /**
   * L4 — 월말 전체 진화 루프.
   * tradingOrchestrator REPORT_ANALYSIS (월 28일+ 16:45+) 에서 위임.
   *   1. WalkForward — 과최적화 감지 시 이후 캘리브레이션 동결
   *   2. calibrateSignalWeights — 전역 가중치 재보정 (동결 시 내부 skip)
   *   3. calibrateByRegime — 레짐별 독립 가중치
   *   4. runConditionAudit — 조건 감사 + Gemini 신규 조건 후보
   */
  async runMonthlyEvolution(): Promise<void> {
    console.log('[LearningOrch L4] 월간 진화 루프 시작');
    // 아이디어 3 (Phase 2): 시너지 분석 데이터 확보용 부트스트랩 — 멱등.
    // 결산된 추천 이력을 27-score 가상 Attribution 으로 소급 전사하여
    // findSynergies()가 초기 운용 단계에서도 작동하도록 샘플을 보강한다.
    try {
      const added = bootstrapAttributionFromRecommendations();
      if (added > 0) console.log(`[L4 bootstrap] 가상 Attribution ${added}건 주입`);
    } catch (e) {
      console.error('[L4 bootstrap]', e);
    }
    await runWalkForwardValidation().catch((e) => console.error('[L4 wf]', e));
    await calibrateSignalWeights().catch((e) => console.error('[L4 signal]', e));
    markCalibRan();
    await calibrateByRegime().catch((e) => console.error('[L4 regime]', e));
    await runConditionAudit().catch((e) => console.error('[L4 audit]', e));
    // 아이디어 6 (Phase 3): 이전 월 PROPOSED 조건들의 A/B 백테스트 후 상태 전이.
    // runConditionAudit 내부 proposeNewConditions 가 이번 월 신규 PROPOSED 를
    // 등록한 직후이므로, 순서상 백테스트는 "직전 월 이전" 등록건을 평가한다.
    await runExperimentalConditionBacktest().catch((e) => console.error('[L4 exp-backtest]', e));
    markTierRan('L4_MONTHLY');
    console.log('[LearningOrch L4] 월간 진화 루프 완료');
  }

  /**
   * 아이디어 6 — Resolution 누적이 처음 10건을 돌파하는 시점에 초기 캘리브레이션 발동.
   * 시스템 런칭 후 월말 28일+ 이 되기 전에도 학습이 한 번은 일어나도록 보장.
   */
  private async checkFirstCalibThreshold(): Promise<void> {
    if (isFirstCalibrationDone()) return;
    const resolved = getRecommendations().filter((r) => r.status !== 'PENDING');
    if (resolved.length < FIRST_CALIB_THRESHOLD) return;

    console.log(`[LearningOrch] 첫 캘리브레이션 임계값 ${FIRST_CALIB_THRESHOLD}건 돌파 — 초기 캘리브레이션 실행`);
    try {
      await calibrateSignalWeights();
      markCalibRan();
      await calibrateByRegime();
      markFirstCalibrationDone();
      await sendTelegramAlert(
        `🎓 <b>[첫 학습 완료]</b> Resolution ${resolved.length}건 달성\n` +
        `초기 캘리브레이션(전역 + 레짐별) 실행 완료 — 이후 주간 L3·월간 L4 사이클로 전환`,
      ).catch(console.error);
    } catch (e) {
      console.error('[LearningOrch] 첫 캘리브레이션 실패:', e);
    }
  }
}

export const learningOrchestrator = new LearningOrchestrator();
