// ─── 기술적 분석 도메인 타입 — TMA · SRR · MAPC · 모멘텀 ─────────────────────

/** 모멘텀 가속도 — 추세 방향보다 가속이 더 중요 */
export interface MomentumAcceleration {
  rsiTrend: number[];            // 최근 3주 RSI 값 [45, 52, 62]
  rsiAccelerating: boolean;      // 3주 연속 상승
  institutionalTrend: number[];  // 최근 5일 기관 순매수 금액
  institutionalAccelerating: boolean;
  volumeTrend: 'INCREASING' | 'STABLE' | 'DECREASING';
  overallAcceleration: boolean;  // rsi + institutional 모두 가속
}

/** TMA (추세 모멘텀 가속도 측정기) — 수익률의 2차 미분
 *  가격이 최고점이어도 가속도가 먼저 꺾이는 물리학적 원리 적용.
 *  TMA = (오늘 수익률 - N일전 수익률) / N
 *  가격보다 1~2주 선행하는 수학적 선행 지표. */
export interface TMAResult {
  tma: number;              // 현재 TMA 값 (수익률 가속도 %/일)
  returnToday: number;      // 오늘 수익률 (%)
  returnNAgo: number;       // N일 전 수익률 (%)
  period: number;           // 측정 기간 (기본 5일)
  alert: 'NONE' | 'DECELERATION' | 'IMMEDIATE'; // NONE / 감속 경보 / 즉각 대응
  /** 가속 단계 분류
   *  ACCELERATING           — TMA>0 & 상승 추세 (속도·가속 모두 양)
   *  DECELERATING_POSITIVE  — TMA>0 이지만 감소 추세 (속도는 있으나 가속 멈춤 → 경계)
   *  DECELERATING_NEGATIVE  — TMA<0 (감속 진입 → 변곡 경보)
   *  CRASHED                — TMA<-0.5 (급격한 감속 → 즉각 대응) */
  phase: 'ACCELERATING' | 'DECELERATING_POSITIVE' | 'DECELERATING_NEGATIVE' | 'CRASHED';
  /** 최근 historyLen 개 TMA 시계열 (스파크라인용) */
  tmaHistory: number[];
  /** TMA > 0 이지만 직전 대비 하락 중 (경계 구간 진입 신호) */
  tmaDecelerating: boolean;
}

/** MAPC 개별 축 상태
 *  금리·유동성·경기·리스크 4개 축 각각의 현재값과 기여 점수 */
export interface MAPCFactor {
  id: 'interest' | 'liquidity' | 'economy' | 'risk';
  /** 한국어 축 이름 */
  nameKo: string;
  /** 현재 핵심 지표 문자열 */
  currentValue: string;
  /** 이 축의 현재 기여 점수 (0-25) */
  score: number;
  /** 상태: RISK_ON(≥18) / NEUTRAL(10-17) / RISK_OFF(≤9) */
  status: 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF';
  /** 핵심 신호 설명 */
  keySignal: string;
}

/** MAPC (Macro-Adaptive Position Controller)
 *
 * 조정 켈리 = 기본 켈리 × (MHS / 100)
 *
 *   MHS 90 → 기본 켈리의 90% 집행
 *   MHS 40 → 기본 켈리의 40% 집행
 *   MHS < 40 → 전면 매수 중단
 *
 * 4개 축(금리·유동성·경기·리스크) 실시간 모니터링으로
 * 인간이 판단하기 전에 시스템이 먼저 베팅 크기를 줄인다. */
export interface MAPCResult {
  /** 기본 켈리 (Gate 2 점수 기반 원본 포지션 크기, %) */
  baseKellyPct: number;
  /** MHS 0-100 */
  mhsScore: number;
  /** 전면 매수 중단 여부 (MHS < 40) */
  buyingHalted: boolean;
  /** 4개 축 상세 */
  factors: MAPCFactor[];
  /** MHS 배율 (MHS/100, 0.0-1.0) */
  mhsMultiplier: number;
  /** 조정 켈리 (baseKellyPct × mhsMultiplier, %) */
  adjustedKellyPct: number;
  /** 축소 절대치 (baseKellyPct - adjustedKellyPct, %) */
  reductionAmt: number;
  /** 축소율 (reductionAmt / baseKellyPct × 100, %) — 기본 켈리 대비 몇 % 줄었나 */
  reductionPct: number;
  /** 실시간 모니터링 스냅샷 */
  snapshot: {
    bokRate: 'HIKING' | 'HOLDING' | 'CUTTING';
    usdKrw: number;
    vix: number;
    vkospi: number;
  };
  /** GREEN(MHS≥70) / YELLOW(40-70) / RED(<40) */
  alert: 'GREEN' | 'YELLOW' | 'RED';
  /** 경보 이유 */
  alertReason: string;
  /** 행동 권고 */
  actionMessage: string;
}

// ─── MTF Confluence Score (다중 시간 프레임 합치 스코어) ────────────────────────

export type MTFSignal = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'IDLE';

/** 단일 시간 프레임 스코어 */
export interface MTFTimeframeScore {
  timeframe: 'MONTHLY' | 'WEEKLY' | 'DAILY' | 'H60';
  /** 원시 점수 0~100 */
  score: number;
  /** 가중치 (월봉 0.35 / 주봉 0.30 / 일봉 0.25 / 60분봉 0.10) */
  weight: number;
  /** score × weight */
  weightedScore: number;
  signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  detail: string;
}

/** evaluateMTFConfluence()에 주입하는 입력 데이터 */
export interface MTFConfluenceInput {
  /** 월봉: MA60 위 여부 */
  monthlyAboveMa60: boolean;
  /** 월봉: MA60 상승 추세 여부 */
  monthlyMa60TrendUp: boolean;
  /** 주봉: RSI (40~70 건강구간) */
  weeklyRsi: number;
  /** 주봉: MACD 히스토그램 양수 여부 */
  weeklyMacdHistogramPositive: boolean;
  /** 주봉: 저항 돌파 or 지지 확인 */
  weeklyBreakoutConfirmed: boolean;
  /** 일봉: 골든크로스 정배열 (price > MA5 > MA20) */
  dailyGoldenCross: boolean;
  /** 일봉: RSI 건강구간 (40~70) */
  dailyRsiHealthy: boolean;
  /** 일봉: Gate 신호 통과 여부 (Gate 1 or 2) */
  dailyGateSignal: boolean;
  /** 60분봉: 모멘텀 상승 */
  h60MomentumUp: boolean;
  /** 60분봉: 거래량 서지 동반 */
  h60VolumeSurge: boolean;
}

/** evaluateMTFConfluence() 반환 결과 */
export interface MTFConfluenceResult {
  monthly: MTFTimeframeScore;
  weekly: MTFTimeframeScore;
  daily: MTFTimeframeScore;
  h60: MTFTimeframeScore;
  /** 최종 MTF 합치 스코어 0~100 */
  mtfScore: number;
  /** 신호: STRONG_BUY(≥85) / BUY(75~84) / WATCH(65~74) / IDLE(<65) */
  signal: MTFSignal;
  /** 포지션 비율: 1.0 / 0.70 / 0 / 0 */
  positionRatio: number;
  summary: string;
}

/** SRR (섹터 내 상대강도 역전 감지)
 *
 * 종목 RS Ratio = 종목 20일 수익률 / 섹터ETF 20일 수익률
 *   RS < 1.0  3주 연속 → 주도주 지위 상실 경보
 *   RS < 0.8  5주 연속 → 즉각 교체 매매 검토
 *
 * Gate 3 연동: 매수 시 상위 5%이던 RS가 상위 20% 밖으로 이탈 → 자동 경보 */
export interface SRRResult {
  /** 현재 RS Ratio (종목 20일 수익률 ÷ 섹터ETF 20일 수익률) */
  rsRatio: number;
  /** 종목 20일 수익률 (%) */
  stockReturn20d: number;
  /** 섹터 ETF 20일 수익률 (%) */
  sectorReturn20d: number;
  /** 주간 RS Ratio 이력 (오래된 순, 최소 5주) */
  weeklyRsRatios: number[];
  /** RS Ratio < 1.0 연속 주수 */
  consecutiveBelowOne: number;
  /** RS Ratio < 0.8 연속 주수 */
  consecutiveBelowEight: number;
  /** 매수 시점 RS 순위 (%, 낮을수록 우수 — e.g., 3 = 상위 3%) */
  entryRsRank: number;
  /** 현재 RS 순위 (%) */
  currentRsRank: number;
  /** 순위 이탈 폭 = currentRsRank − entryRsRank (양수 = 악화) */
  rankDrift: number;
  /** 주도주 지위 상실 (3주 연속 RS Ratio < 1.0) */
  leadingStockLost: boolean;
  /** 즉각 교체 검토 (5주 연속 RS Ratio < 0.8) */
  replaceSignal: boolean;
  /** 매수 시 상위 5%이었으나 현재 상위 20% 밖으로 이탈 */
  rankBandBreached: boolean;
  /** 경보 단계 */
  alert: 'NORMAL' | 'WATCH' | 'WARNING' | 'CRITICAL';
  /** 행동 권고 메시지 */
  actionMessage: string;
}
