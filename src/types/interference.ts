// @responsibility interference 도메인 타입 정의
// ─── 시스템 상호간섭 파라미터 충돌 감지 타입 ───────────────────────────────────────

/**
 * 개별 파라미터 충돌의 심각도.
 *
 * CRITICAL — 즉각적인 자금 손실 위험 (e.g., 매수 중단 신호 무시)
 * HIGH     — 레짐 불일치로 인한 잘못된 손절 배수 적용
 * MEDIUM   — 제한 조건이 반영되지 않아 과다 포지션 가능
 * LOW      — 경미한 임계값 차이, 모니터링 권고
 */
export type ConflictSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * 두 개 이상의 시스템 간에 발생한 단일 파라미터 충돌.
 */
export interface ParameterConflict {
  /** 충돌 고유 ID */
  id: string;
  /** 충돌 심각도 */
  severity: ConflictSeverity;
  /** 충돌에 관여된 시스템 이름 목록 */
  systems: string[];
  /** 충돌 제목 (한 줄 요약) */
  title: string;
  /** 충돌 상세 설명 */
  description: string;
  /** 권고 해결 방법 */
  resolution: string;
  /** 충돌 관련 파라미터 비교 (optional) */
  parameterDetails?: {
    expected: string;
    actual: string;
  };
}

/**
 * checkSystemInterference() 전체 반환 결과.
 */
export interface SystemInterferenceResult {
  /** 감지된 파라미터 충돌 목록 */
  conflicts: ParameterConflict[];
  /** 총 충돌 수 */
  totalConflicts: number;
  /** CRITICAL 수준 충돌 수 */
  criticalCount: number;
  /** HIGH 수준 충돌 수 */
  highCount: number;
  /** MEDIUM 수준 충돌 수 */
  mediumCount: number;
  /**
   * 즉각적인 운용 차단이 필요한 충돌 존재 여부.
   * (CRITICAL 충돌이 1개 이상 존재하면 true)
   */
  hasBlockingConflict: boolean;
  /** 전체 시스템 정합성 요약 메시지 */
  summary: string;
  /** 검사 시각 (ISO 8601) */
  checkedAt: string;
}
