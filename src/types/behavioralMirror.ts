// ─── 투자자 행동 교정 미러 대시보드 (Behavioral Mirror Dashboard) 타입 ──────────

/** 패널 1: 시스템 vs 직관 6개월 누적 수익률 비교 */
export interface BehavioralSystemVsIntuition {
  /** 최근 6개월 시스템 매매 건수 */
  systemCount: number;
  /** 최근 6개월 직관 매매 건수 */
  intuitionCount: number;
  /** 시스템 매매 누적 수익률 (%) */
  systemCumulativeReturn: number;
  /** 직관 매매 누적 수익률 (%) */
  intuitionCumulativeReturn: number;
  /** 시스템 승률 (%) */
  systemWinRate: number;
  /** 직관 승률 (%) */
  intuitionWinRate: number;
  /** 시스템 우위 (양수 = 시스템이 앞섬) */
  systemEdge: number;
  /** 시스템 평균 수익률 (%) */
  systemAvgReturn: number;
  /** 직관 평균 수익률 (%) */
  intuitionAvgReturn: number;
}

/** 패널 2: 손절 실행 충실도 트래커 */
export interface StopLossFidelity {
  /** 총 손절 대상 포지션 수 (손실 종료 건) */
  totalStopCases: number;
  /** 기계적 손절 실행 건 (STOP_LOSS 사유로 종료) */
  mechanicalStops: number;
  /** 망설임 손절 건 (비STOP_LOSS 사유로 손실 종료) */
  hesitantStops: number;
  /** 기계적 손절 실행률 (%) */
  fidelityRate: number;
  /** 망설임 손절 시 평균 손실 확대 (기계적 손절 대비 추가 손실 %) */
  avgExtraLossOnHesitation: number;
  /** 신뢰 등급: HIGH(≥80%) / MID(≥60%) / LOW(<60%) */
  trustLevel: 'HIGH' | 'MID' | 'LOW';
}

/** Gate 조건별 3개월 기여도 */
export interface GateConditionContribution {
  /** 조건 ID */
  conditionId: number;
  /** 조건명 */
  conditionName: string;
  /** 최근 3개월 관련 매매 수 */
  tradeCount: number;
  /** 평균 수익률 기여 (해당 조건 고점수 시) */
  avgReturnContrib: number;
  /** 노이즈 판정 여부 (트레이드 수 부족하거나 수익 기여 미미) */
  isNoise: boolean;
  /** 승률 (%) */
  winRate: number;
}

/** 패널 3: Gate 조건별 기여도 히트맵 */
export interface GateContributionHeatmap {
  contributions: GateConditionContribution[];
  /** 실제 수익 기여 조건 수 */
  effectiveCount: number;
  /** 노이즈 조건 수 */
  noiseCount: number;
  /** 기준 날짜 (3개월 전 ISO) */
  fromDate: string;
}

/** 패널 4: 포트폴리오 레짐 적합도 스코어 */
export interface RegimeFitnessScore {
  /** 0~100 점수 */
  score: number;
  /** 경고 여부 (60 이하) */
  isWarning: boolean;
  /** 적합 포지션 수 */
  fitCount: number;
  /** 부적합 포지션 수 (현재 레짐과 맞지 않는 섹터/종목) */
  misfitCount: number;
  /** 현재 시장 레짐 설명 */
  currentRegimeLabel: string;
  /** 보유 포지션 중 레짐 부적합 종목명 목록 */
  misfitNames: string[];
  /** 권고 사항 */
  recommendation: string;
}

/** 이벤트 종류 */
export type EventType = 'EARNINGS' | 'LOCKUP_EXPIRY' | 'FED' | 'BOK' | 'OTHER';

/** 30일 이벤트 항목 */
export interface UpcomingEvent {
  /** 이벤트 날짜 (ISO) */
  date: string;
  /** 종목 코드 (종목 이벤트인 경우) */
  stockCode?: string;
  /** 종목명 (종목 이벤트인 경우) */
  stockName?: string;
  /** 이벤트 종류 */
  eventType: EventType;
  /** 이벤트 설명 */
  description: string;
  /** 위험도: HIGH/MID/LOW */
  riskLevel: 'HIGH' | 'MID' | 'LOW';
  /** 남은 일수 */
  daysUntil: number;
}

/** 패널 5: 30일 이벤트 타임라인 */
export interface EventTimeline {
  events: UpcomingEvent[];
  /** 고위험 이벤트 수 */
  highRiskCount: number;
  /** 타임라인 시작 날짜 (오늘) */
  fromDate: string;
  /** 타임라인 종료 날짜 (30일 후) */
  toDate: string;
}

/** 행동 교정 미러 입력 */
export interface BehavioralMirrorInput {
  /** 현재 시장 레짐 (간략 문자열, 예: 'BULL' | 'BEAR' | 'SIDEWAYS') */
  currentRegime: string;
  /** 보유 포지션 목록 */
  openPositions: Array<{
    stockCode: string;
    stockName: string;
    sector: string;
    /** 해당 종목이 현재 레짐에 적합한지 여부 */
    regimeFit: boolean;
  }>;
  /** 향후 30일 예정 이벤트 (수동 입력) */
  upcomingEvents: Array<{
    date: string;
    stockCode?: string;
    stockName?: string;
    eventType: EventType;
    description: string;
    riskLevel: 'HIGH' | 'MID' | 'LOW';
  }>;
}

/** 행동 교정 미러 대시보드 전체 결과 */
export interface BehavioralMirrorResult {
  /** 패널 1: 시스템 vs 직관 */
  systemVsIntuition: BehavioralSystemVsIntuition;
  /** 패널 2: 손절 충실도 */
  stopLossFidelity: StopLossFidelity;
  /** 패널 3: Gate 조건 기여도 히트맵 */
  gateContributionHeatmap: GateContributionHeatmap;
  /** 패널 4: 레짐 적합도 스코어 */
  regimeFitnessScore: RegimeFitnessScore;
  /** 패널 5: 30일 이벤트 타임라인 */
  eventTimeline: EventTimeline;
  /** 전체 요약 메시지 */
  summary: string;
  /** 계산 시각 */
  calculatedAt: string;
}
