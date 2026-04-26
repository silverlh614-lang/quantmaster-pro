// @responsibility lifecycle 도메인 타입 정의
// ─── 포지션 생애주기 자동화 (Position Lifecycle Automation) ─────────────────────

/**
 * 포지션 5단계 생애주기.
 *
 * ENTRY        — 진입: Gate 1+2+3 통과 → OCO 주문 등록
 * HOLD         — 보유: 27조건 일일 재검증, 점수 추이 모니터링
 * ALERT        — 경보: 점수 20% 이상 하락 → 50% 분할 매도 예정
 * EXIT_PREP    — 청산 준비: Gate 1 조건 2개 이상 이탈 → 25% 추가 매도
 * FULL_EXIT    — 전량 청산: Gate 1 3개 이상 이탈 OR 손절 발동
 */
export type LifecycleStage = 'ENTRY' | 'HOLD' | 'ALERT' | 'EXIT_PREP' | 'FULL_EXIT';

/** 생애주기 단계 전환 결과 */
export interface LifecycleTransition {
  prevStage: LifecycleStage;
  nextStage: LifecycleStage;
  reason: string;
  /**
   * 즉시 실행할 매도 비율 (0~1).
   * ALERT: 0.50, EXIT_PREP: 0.25 (잔여 기준), FULL_EXIT: 1.0
   */
  sellRatio: number;
  sendAlert: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/** evaluatePositionLifecycle()에 주입하는 포지션별 생애주기 상태 */
export interface PositionLifecycleState {
  stage: LifecycleStage;
  /** 진입 시점 27조건 점수 (Gate 1 통과 개수, 0~8) */
  entryScore: number;
  /** 현재 27조건 점수 (현재 Gate 1 통과 개수) */
  currentScore: number;
  /** 현재 Gate 1 이탈 조건 수 */
  gate1BreachCount: number;
  /** 손절 발동 여부 */
  stopLossTriggered: boolean;
}
