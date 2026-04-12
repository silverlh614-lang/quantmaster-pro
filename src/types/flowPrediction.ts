// ─── 수급 예측 선행 모델 (Flow Prediction Engine) 타입 ─────────────────────────

/**
 * 선행 수급 신호 분류
 * - BUY_PRECURSOR   : 외국인·기관 대량 매수 직전 패턴 포착 (1~3일 선행)
 * - DISTORTION_WARNING : 의무보유 해제/블록딜로 인한 수급 왜곡 사전 경고
 * - FOREIGN_REENTRY_CANDIDATE : 외국인 재진입 대기 종목 (보유 비중 낮음 + 펀더멘털 양호)
 * - NEUTRAL         : 특이 신호 없음
 */
export type FlowPredictionSignal =
  | 'BUY_PRECURSOR'
  | 'DISTORTION_WARNING'
  | 'FOREIGN_REENTRY_CANDIDATE'
  | 'NEUTRAL';

/** 의무보유 해제 / 블록딜 일정 */
export interface SupplyDistortionSchedule {
  /** 종목명 */
  stockName: string;
  /** 종목 코드 */
  stockCode: string;
  /** 이벤트 종류 */
  eventType: 'LOCKUP_RELEASE' | 'BLOCK_DEAL';
  /** 이벤트 예정일 (ISO 8601) */
  scheduledDate: string;
  /** 예상 물량 (주) */
  estimatedShares?: number;
  /** DART 공시 수신 번호 */
  rceptNo?: string;
}

/** FlowPredictionEngine 입력 */
export interface FlowPredictionInput {
  // ── 거래량 마름 패턴 ─────────────────────────────────────────────────────────
  /** 최근 3~5일 평균 거래량 (주) */
  recentVolume5dAvg: number;
  /** 20일 평균 거래량 (주) */
  avgVolume20d: number;

  // ── 호가 저항 약화 ──────────────────────────────────────────────────────────
  /** 저항선 대비 현재 호가 스프레드 비율 (0~1, 낮을수록 저항 약화) */
  bidAskSpreadRatio: number;

  // ── 프로그램 비차익 소폭 유입 ───────────────────────────────────────────────
  /** 최근 5거래일 프로그램 비차익 순매수 (억원, 양수=유입) */
  programNonArbitrageNetBuy: number;

  // ── 외국인 수급 ─────────────────────────────────────────────────────────────
  /** 현재 외국인 보유 비중 (%) */
  foreignOwnershipRatio: number;
  /** 외국인 재진입 임계값 (%, 기본 15) */
  foreignOwnershipThreshold?: number;
  /** 최근 5일 외국인 순매수 합계 (주) */
  foreignNetBuy5d: number;

  // ── 기관 수급 ───────────────────────────────────────────────────────────────
  /** 최근 5일 기관 순매수 합계 (주) */
  institutionalNetBuy5d: number;

  // ── 펀더멘털 점수 ───────────────────────────────────────────────────────────
  /** 펀더멘털 종합 점수 (0~100) */
  fundamentalScore: number;

  // ── 수급 왜곡 일정 ──────────────────────────────────────────────────────────
  /** 향후 5거래일 내 의무보유 해제 / 블록딜 일정 목록 */
  distortionSchedules?: SupplyDistortionSchedule[];
}

/** 거래량 마름 패턴 분석 결과 */
export interface VolumeDryUpSignal {
  /** 마름 패턴 감지 여부 */
  detected: boolean;
  /** 현재 5일 평균 / 20일 평균 거래량 비율 */
  volumeRatio: number;
  /** 설명 */
  description: string;
}

/** 프로그램 비차익 소폭 유입 분석 결과 */
export interface ProgramInflowSignal {
  /** 유입 확인 여부 */
  detected: boolean;
  /** 순매수 금액 (억원) */
  netBuyAmount: number;
  /** 설명 */
  description: string;
}

/** 호가 저항 약화 분석 결과 */
export interface ResistanceWeakeningSignal {
  /** 저항 약화 여부 */
  detected: boolean;
  /** 스프레드 비율 */
  spreadRatio: number;
  /** 설명 */
  description: string;
}

/** 수급 왜곡 경고 */
export interface DistortionWarning {
  /** 경고 활성화 여부 */
  active: boolean;
  /** 해당 일정 목록 */
  schedules: SupplyDistortionSchedule[];
  /** 설명 */
  description: string;
}

/** 외국인 재진입 대기 종목 판단 */
export interface ForeignReentrySignal {
  /** 재진입 후보 여부 */
  isCandidate: boolean;
  /** 현재 외국인 보유 비중 */
  currentOwnershipRatio: number;
  /** 임계값 */
  threshold: number;
  /** 펀더멘털 점수 */
  fundamentalScore: number;
  /** 설명 */
  description: string;
}

/** FlowPredictionEngine 출력 */
export interface FlowPredictionResult {
  /** 종합 선행 신호 */
  signal: FlowPredictionSignal;
  /** 선행 패턴 종합 점수 (0~100) */
  patternScore: number;
  /** 추정 선행 시간 (일, Gate 필터보다 몇 일 앞서는지) */
  estimatedLeadDays: number;
  /** 거래량 마름 서브 신호 */
  volumeDryUp: VolumeDryUpSignal;
  /** 프로그램 비차익 유입 서브 신호 */
  programInflow: ProgramInflowSignal;
  /** 호가 저항 약화 서브 신호 */
  resistanceWeakening: ResistanceWeakeningSignal;
  /** 수급 왜곡 경고 (의무보유 해제/블록딜) */
  distortionWarning: DistortionWarning;
  /** 외국인 재진입 후보 */
  foreignReentry: ForeignReentrySignal;
  /** 요약 메시지 */
  summary: string;
  /** 계산 기준 시각 */
  calculatedAt: string;
}
