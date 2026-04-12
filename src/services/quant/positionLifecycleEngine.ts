/**
 * positionLifecycleEngine.ts — 포지션 생애주기 완전 자동화 엔진
 *
 * 매수 진입부터 전량 청산까지의 5단계 생애주기를 자동화한다.
 *
 * 5단계 자동화 흐름:
 *   1단계 [ENTRY]     — Gate 1+2+3 통과 → OCO 주문 동시 등록 (목표가 + 손절가)
 *   2단계 [HOLD]      — 매일 장 종료 후 27조건 재검증 → 점수 추이 모니터링
 *   3단계 [ALERT]     — 점수 20% 이상 하락 → 포지션 50% 분할 매도 + Telegram 경보
 *   4단계 [EXIT_PREP] — Gate 1 조건 2개 이상 이탈 → 잔여 포지션 25% 추가 매도
 *   5단계 [FULL_EXIT] — Gate 1 조건 3개 이상 이탈 OR 손절 발동 → 전량 청산 실행
 */

import type { LifecycleStage, LifecycleTransition, PositionLifecycleState } from '../../types/sell';

// ─── 전환 조건 상수 ─────────────────────────────────────────────────────────────

/**
 * ALERT 단계 전환 기준: 진입 점수 대비 현재 점수 하락 비율 임계값.
 * 20% 이상 하락 시 ALERT 발동.
 */
const SCORE_DROP_ALERT_THRESHOLD = 0.20;

/**
 * EXIT_PREP 단계 전환 기준: Gate 1 조건 이탈 최소 개수.
 */
const EXIT_PREP_BREACH_COUNT = 2;

/**
 * FULL_EXIT 단계 전환 기준: Gate 1 조건 이탈 최소 개수.
 */
const FULL_EXIT_BREACH_COUNT = 3;

// ─── 단계별 매도 비율 ──────────────────────────────────────────────────────────

const ALERT_SELL_RATIO    = 0.50; // 50% 분할 매도
const EXIT_PREP_SELL_RATIO = 0.25; // 잔여 25% 추가 매도
const FULL_EXIT_SELL_RATIO = 1.00; // 전량 청산

// ─── 내부 전환 판정 함수 ─────────────────────────────────────────────────────────

/**
 * HOLD → ALERT 전환 여부 판정.
 * 진입 점수 대비 20% 이상 하락 시 발동.
 */
function shouldTransitionToAlert(
  entryScore: number,
  currentScore: number,
): boolean {
  if (entryScore <= 0) return false;
  const dropRatio = (entryScore - currentScore) / entryScore;
  return dropRatio >= SCORE_DROP_ALERT_THRESHOLD;
}

/**
 * EXIT_PREP 전환 여부 판정 (Gate 1 조건 2개 이상 이탈).
 */
function shouldTransitionToExitPrep(gate1BreachCount: number): boolean {
  return gate1BreachCount >= EXIT_PREP_BREACH_COUNT;
}

/**
 * FULL_EXIT 전환 여부 판정 (Gate 1 조건 3개 이상 이탈 OR 손절 발동).
 */
function shouldTransitionToFullExit(
  gate1BreachCount: number,
  stopLossTriggered: boolean,
): boolean {
  return gate1BreachCount >= FULL_EXIT_BREACH_COUNT || stopLossTriggered;
}

// ─── 메인 평가 함수 ──────────────────────────────────────────────────────────────

/**
 * 현재 포지션 생애주기 상태를 평가하여, 단계 전환이 필요하면 LifecycleTransition을 반환한다.
 *
 * 호출 시점: 매일 장 종료 후 (또는 중요 지표 변경 시).
 *
 * @param state - 현재 포지션 생애주기 상태
 * @returns 단계 전환이 필요하면 LifecycleTransition, 유지 중이면 null
 */
export function evaluatePositionLifecycle(
  state: PositionLifecycleState,
): LifecycleTransition | null {
  const { stage, entryScore, currentScore, gate1BreachCount, stopLossTriggered } = state;

  // ENTRY → HOLD: 진입 직후 최초 보유 상태로 전환
  if (stage === 'ENTRY') {
    return {
      prevStage: 'ENTRY',
      nextStage: 'HOLD',
      reason: 'OCO 주문 등록 완료. 일일 27조건 재검증 모니터링 시작.',
      sellRatio: 0,
      sendAlert: false,
      severity: 'LOW',
    };
  }

  // FULL_EXIT 판정 (최우선 — 어떤 단계에서든 즉시 전환)
  if (stage !== 'FULL_EXIT' && shouldTransitionToFullExit(gate1BreachCount, stopLossTriggered)) {
    const reason = stopLossTriggered
      ? `손절 발동. Gate 1 이탈 ${gate1BreachCount}개. 전량 청산 실행.`
      : `Gate 1 조건 ${gate1BreachCount}개 이탈 (기준: ${FULL_EXIT_BREACH_COUNT}개). 전량 청산 실행.`;
    return {
      prevStage: stage,
      nextStage: 'FULL_EXIT',
      reason,
      sellRatio: FULL_EXIT_SELL_RATIO,
      sendAlert: true,
      severity: 'CRITICAL',
    };
  }

  // EXIT_PREP 판정 (HOLD 또는 ALERT에서)
  if ((stage === 'HOLD' || stage === 'ALERT') && shouldTransitionToExitPrep(gate1BreachCount)) {
    return {
      prevStage: stage,
      nextStage: 'EXIT_PREP',
      reason: `Gate 1 조건 ${gate1BreachCount}개 이탈 (기준: ${EXIT_PREP_BREACH_COUNT}개). 잔여 포지션 25% 추가 매도.`,
      sellRatio: EXIT_PREP_SELL_RATIO,
      sendAlert: true,
      severity: 'HIGH',
    };
  }

  // ALERT 판정 (HOLD에서만)
  if (stage === 'HOLD' && shouldTransitionToAlert(entryScore, currentScore)) {
    const dropPct = entryScore > 0
      ? ((entryScore - currentScore) / entryScore * 100).toFixed(1)
      : '0';
    return {
      prevStage: 'HOLD',
      nextStage: 'ALERT',
      reason: `진입 점수 대비 ${dropPct}% 하락 (${entryScore}→${currentScore}점). 포지션 50% 분할 매도 + 경보.`,
      sellRatio: ALERT_SELL_RATIO,
      sendAlert: true,
      severity: 'HIGH',
    };
  }

  // 전환 불필요 — 현재 단계 유지
  return null;
}

// ─── 생애주기 단계 설명 ───────────────────────────────────────────────────────────

/** 생애주기 단계별 한국어 레이블 */
export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  ENTRY:     '1단계: 진입',
  HOLD:      '2단계: 보유',
  ALERT:     '3단계: 경보',
  EXIT_PREP: '4단계: 청산 준비',
  FULL_EXIT: '5단계: 전량 청산',
};

/** 생애주기 단계별 설명 */
export const LIFECYCLE_DESCRIPTIONS: Record<LifecycleStage, string> = {
  ENTRY:     'Gate 1+2+3 통과 → OCO 주문 동시 등록 (목표가 + 손절가)',
  HOLD:      '매일 장 종료 후 27조건 재검증 → 점수 추이 모니터링',
  ALERT:     '점수 20% 이상 하락 → 포지션 50% 분할 매도 + Telegram 경보 발송',
  EXIT_PREP: 'Gate 1 조건 2개 이상 이탈 → 잔여 포지션 25% 추가 매도',
  FULL_EXIT: 'Gate 1 조건 3개 이상 이탈 OR 손절 발동 → 전량 청산 실행',
};

/**
 * 생애주기 단계에 따른 다음 자동 조치 안내 메시지 반환.
 * UI 표시 및 사용자 안내용.
 */
export function getLifecycleNextAction(
  state: PositionLifecycleState,
): string {
  const { stage, entryScore, currentScore, gate1BreachCount } = state;

  switch (stage) {
    case 'ENTRY':
      return 'OCO 주문 등록 후 HOLD 단계로 자동 전환됩니다.';
    case 'HOLD': {
      const dropPct = entryScore > 0
        ? ((entryScore - currentScore) / entryScore * 100).toFixed(1)
        : '0';
      const alertTarget = Math.ceil(entryScore * (1 - SCORE_DROP_ALERT_THRESHOLD));
      return `점수 추이 모니터링 중 (${currentScore}점 / 진입: ${entryScore}점, 하락률 ${dropPct}%). `
        + `${alertTarget}점 이하 시 ALERT 전환. Gate 1 이탈: ${gate1BreachCount}개.`;
    }
    case 'ALERT':
      return `50% 매도 실행 완료. Gate 1 이탈 ${gate1BreachCount}개 모니터링 중. `
        + `${EXIT_PREP_BREACH_COUNT}개 이상 시 EXIT_PREP 전환.`;
    case 'EXIT_PREP':
      return `25% 추가 매도 완료. Gate 1 이탈 ${gate1BreachCount}개. `
        + `${FULL_EXIT_BREACH_COUNT}개 이상 시 전량 청산 전환.`;
    case 'FULL_EXIT':
      return '전량 청산 완료. 포지션 종료.';
  }
}
