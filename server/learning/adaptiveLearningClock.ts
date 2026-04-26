// @responsibility adaptiveLearningClock 학습 엔진 모듈
/**
 * adaptiveLearningClock.ts — 학습 주기 가속/감속 적응 스위치.
 *
 * 시장 변동성(VIX)과 레짐에 따라 학습 주기를 동적으로 조정한다.
 *   R5_CAUTION/R6_DEFENSE 또는 VIX > 30 → 가속 (7일 주기 L4)
 *   VIX > 20                             → 중간 (14일 주기 L4)
 *   그 외                                 → 표준 (28일 주기 L4)
 *
 * tradingOrchestrator의 REPORT_ANALYSIS state는 "kstDay >= 28" 하드코드 대신
 * `daysSinceLastCalib() >= calibrateTriggerDays` 로 L4 게이트를 판정한다.
 */

import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { loadLearningState } from './learningState.js';

export interface LearningInterval {
  /** evaluateRecommendations 권장 간격 (참고용 — 현재는 일 1회 고정) */
  evaluateIntervalHours: number;
  /** L4 월간 진화 루프 트리거 임계값 (일) — 이 일수가 지나면 캘리브레이션 실행 */
  calibrateTriggerDays: number;
  /** 현재 스케줄 모드 레이블 — 헬스체크/Telegram 표기용 */
  mode: 'FAST' | 'MEDIUM' | 'STANDARD';
  /** 결정 근거 요약 */
  reason: string;
}

/**
 * 현재 시장 상태에 맞는 학습 주기 설정을 반환한다.
 * 호출은 멱등 (사이드 이펙트 없음) — REPORT_ANALYSIS cron에서 매일 조회.
 */
export function getLearningInterval(): LearningInterval {
  const macroState = loadMacroState();
  const vix        = macroState?.vix ?? 15;
  const regime     = macroState ? getLiveRegime(macroState) : 'R4_NEUTRAL';

  if (vix > 30 || regime === 'R5_CAUTION' || regime === 'R6_DEFENSE') {
    return {
      evaluateIntervalHours: 2,
      calibrateTriggerDays:  7,
      mode:                  'FAST',
      reason:                `VIX ${vix.toFixed(1)} / ${regime} — 고변동성 구간`,
    };
  }
  if (vix > 20) {
    return {
      evaluateIntervalHours: 6,
      calibrateTriggerDays:  14,
      mode:                  'MEDIUM',
      reason:                `VIX ${vix.toFixed(1)} — 중간 변동성`,
    };
  }
  return {
    evaluateIntervalHours: 24,
    calibrateTriggerDays:  28,
    mode:                  'STANDARD',
    reason:                `VIX ${vix.toFixed(1)} / ${regime} — 안정 구간`,
  };
}

/**
 * 마지막 캘리브레이션 이후 경과 일수.
 * 미실행 상태면 Infinity 반환 (첫 실행을 차단하지 않기 위함).
 */
export function daysSinceLastCalib(): number {
  const ts = loadLearningState().lastCalibAt;
  if (!ts) return Infinity;
  return (Date.now() - new Date(ts).getTime()) / 86_400_000;
}

/**
 * 현재 L4 트리거 조건을 만족하는지 — adaptive 게이트.
 * tradingOrchestrator의 "28일 이후" 판정 대체.
 */
export function shouldRunMonthlyEvolution(): boolean {
  const { calibrateTriggerDays } = getLearningInterval();
  return daysSinceLastCalib() >= calibrateTriggerDays;
}
