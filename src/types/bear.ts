// ─── Bear Market 감지 · 인버스 ETF · 방어 전략 도메인 타입 ──────────────────

// ─── 아이디어 1: Gate -1 "Market Regime Detector" — Bull/Bear 자동 판별 게이트 ──

/** 3단계 시장 레짐 유형 */
export type MarketRegimeDetectorType = 'BULL' | 'TRANSITION' | 'BEAR';

/** Bear Regime 판별 7개 조건 중 하나의 상태 */
export interface BearRegimeCondition {
  id: string;
  name: string;
  triggered: boolean;
  description: string;
}

/** Gate -1 Bear Regime Detector 평가 결과 */
export interface BearRegimeResult {
  regime: MarketRegimeDetectorType;
  conditions: BearRegimeCondition[];
  triggeredCount: number;         // 7개 중 발동된 조건 수
  threshold: number;              // Bear 활성화 기준 (기본 5)
  actionRecommendation: string;   // 투자자 행동 권고
  cashRatioRecommended: number;   // 권장 현금 비중 (%)
  defenseMode: boolean;           // 인버스/방어자산 모드 여부
  lastUpdated: string;
}

// ─── 아이디어 11: 계절성 Bear Calendar ───────────────────────────────────────────

export type BearSeasonalityWindowType =
  | 'AUTUMN_WEAKNESS'
  | 'YEAR_END_CLEARING'
  | 'PRE_Q1_EARNINGS'
  | 'PRE_FOMC';

export interface BearSeasonalityWindow {
  id: BearSeasonalityWindowType;
  name: string;
  active: boolean;
  description: string;
  period: string;
}

export interface BearSeasonalityResult {
  isBearSeason: boolean;
  windows: BearSeasonalityWindow[];
  activeWindowIds: BearSeasonalityWindowType[];
  gateThresholdAdjustment: number;     // Gate -1 임계치 조정값 (예: -1)
  inverseEntryWeightPct: number;       // 인버스 진입 확률 가중치 (%)
  vkospiRisingConfirmed: boolean;      // VKOSPI 동반 상승 여부
  actionMessage: string;
  lastUpdated: string;
}

// ─── 아이디어 4: VKOSPI 공포지수 트리거 시스템 ──────────────────────────────────

/** VKOSPI 트리거 단계 */
export type VkospiTriggerLevel =
  | 'NORMAL'         // VKOSPI < 25 — 정상 시장
  | 'WARNING'        // 25 ≤ VKOSPI < 30 — 경계경보, 현금 20% 확보
  | 'ENTRY_1'        // 30 ≤ VKOSPI < 40 — 인버스 ETF 1차 진입 (30%)
  | 'ENTRY_2'        // 40 ≤ VKOSPI < 50 — 인버스 ETF 추가 진입 (60%)
  | 'HISTORICAL_FEAR'; // VKOSPI ≥ 50 — 역사적 공포, 인버스 최대 + V자 반등 준비

/** VKOSPI 트리거 분석 결과 */
export interface VkospiTriggerResult {
  level: VkospiTriggerLevel;
  vkospi: number;
  cashRatio: number;                  // 권장 현금 비중 (%)
  inversePosition: number;            // 권장 인버스 ETF 비중 (%)
  dualPositionActive: boolean;        // VKOSPI ≥ 50: 인버스 보유 + V반등 리스트 병행
  inverseEtfSuggestions: string[];    // 추천 인버스 ETF 목록
  vRecoveryStocks?: string[];         // V자 반등 준비 리스트 (HISTORICAL_FEAR 시)
  description: string;                // 단계 설명
  actionMessage: string;              // 행동 권고 메시지
  lastUpdated: string;
}

// ─── 아이디어 2: 인버스 ETF 스코어링 시스템 — Inverse Gate 1 ────────────────

/** Inverse Gate 1 시그널 유형 */
export type InverseGate1SignalType =
  | 'STRONG_BEAR'  // 5개 조건 전부 충족 — KODEX 인버스 즉시 진입
  | 'PARTIAL'      // 3~4개 조건 충족 — 대기 상태
  | 'INACTIVE';    // 2개 이하 — 비활성

/** Inverse Gate 1 조건 하나의 상태 */
export interface InverseGate1Condition {
  id: string;
  name: string;
  triggered: boolean;
  description: string;
}

/** Inverse Gate 1 Bear 필수 조건 5개 평가 결과 */
export interface InverseGate1Result {
  signalType: InverseGate1SignalType;
  conditions: InverseGate1Condition[];
  triggeredCount: number;          // 5개 중 충족된 조건 수
  allTriggered: boolean;           // 5개 전부 충족 여부
  etfRecommendations: string[];    // STRONG_BEAR 시 추천 인버스 ETF
  actionMessage: string;           // 투자자 행동 권고
  lastUpdated: string;
}

// ─── 아이디어 9: Market Neutral 모드 — 롱/인버스 동시 보유로 변동성 수익 추구 ──

/** Market Neutral 포트폴리오 레그 유형 */
export type MarketNeutralLegType = 'LONG' | 'INVERSE' | 'CASH';

/** Market Neutral 포트폴리오의 개별 레그 (롱/인버스/현금) */
export interface MarketNeutralLeg {
  type: MarketNeutralLegType;
  weightPct: number;               // 비중 (%)
  label: string;                   // 표시 라벨
  description: string;             // 설명
  examples: string[];              // 추천 종목/ETF 예시
}

/** 베타 중립화 시나리오 — 시장 하락 시 손익 시뮬레이션 */
export interface BetaNeutralScenario {
  marketReturn: number;            // 시장 수익률 (%)
  longAlpha: number;               // 롱 종목 시장 대비 초과 수익 (알파, %)
  inverseReturn: number;           // 인버스 포지션 수익률 (%)
  totalReturn: number;             // 포트폴리오 전체 수익률 (%)
  description: string;             // 시나리오 설명
}

/** Gate -1 Market Neutral 모드 평가 결과 */
export interface MarketNeutralResult {
  /** TRANSITION 레짐에서만 활성화 */
  isActive: boolean;
  regime: MarketRegimeDetectorType;
  legs: MarketNeutralLeg[];
  /** 베타 중립화 시나리오 (기본 예시) */
  betaNeutralScenario: BetaNeutralScenario;
  /** 예상 샤프 지수 개선 효과 */
  sharpeImprovementNote: string;
  /** 전략 핵심 설명 */
  strategyDescription: string;
  actionMessage: string;
  lastUpdated: string;
}

// ─── 아이디어 3: Bear Regime 전용 종목 발굴 — "하락 수혜주" 자동 탐색 ────────

/** Bear Screener 종목 카테고리 */
export type BearScreenerCategory =
  | 'DEFENSIVE'              // 방어주 — 음식료·통신·유틸리티
  | 'COUNTER_CYCLICAL'       // 역주기주 — 채권·금·달러 ETF
  | 'VALUE_DEPRESSED'        // 숏 수혜주 — 실적 탄탄, 주가만 눌림
  | 'VOLATILITY_BENEFICIARY'; // 변동성 수혜주 — 보험·금융(NIM 개선)

/** Bear Screener 방어형 15개 조건 중 하나의 상태 */
export interface BearScreenerCondition {
  id: string;
  name: string;
  passed: boolean;
  category: BearScreenerCategory;
  description: string;
}

/** Gate -1 Bear Regime 감지 시 자동 전환되는 Bear Screener 평가 결과 */
export interface BearScreenerResult {
  /** Bear Regime 감지 시 true */
  isActive: boolean;
  /** 활성화 사유 */
  triggerReason: string;
  /** 15개 방어형 조건 */
  conditions: BearScreenerCondition[];
  /** 통과된 조건 수 */
  passedCount: number;
  /** 카테고리별 분류 */
  categories: {
    defensive: BearScreenerCondition[];
    counterCyclical: BearScreenerCondition[];
    valueDepressed: BearScreenerCondition[];
    volatilityBeneficiary: BearScreenerCondition[];
  };
  /** AI 탐색용 쿼리 목록 */
  searchQueries: string[];
  /** 스크리닝 방법 요약 */
  screeningNote: string;
  lastUpdated: string;
}

// ─── 아이디어 6: Bear Mode Kelly Criterion — 하락 베팅에 적용하는 켈리 공식 ──

/** Bear Kelly 공식 계산 결과 */
export interface BearKellyResult {
  /** Bear Regime 감지 시 활성화 */
  isActive: boolean;
  /** Bear 신호 합치 확률 (Gate -1 충족도 기반, 0~1) */
  p: number;
  /** 기대 수익률 배수 (인버스 2X ETF ≈ 1.8) */
  b: number;
  /** 손실 확률 (1 - p) */
  q: number;
  /** 원시 켈리 분수 ((p×b - q) / b, 0~1) */
  rawKellyFraction: number;
  /** 전체 켈리 포지션 비중 (%) */
  kellyPct: number;
  /** 반 켈리 포지션 비중 (%) — 실전 권고 (시간가치 손실 감안) */
  halfKellyPct: number;
  /** 최대 보유 거래일 (Time-Stop 상한, 기본 30일) */
  maxHoldingDays: number;
  /** 포지션 진입일 (ISO 날짜 문자열, null이면 미진입) */
  entryDate: string | null;
  /** 진입 후 경과 거래일 */
  tradingDaysElapsed: number;
  /** 잔여 거래일 */
  tradingDaysRemaining: number;
  /** Time-Stop 발동 여부 */
  timeStopTriggered: boolean;
  /** 자동 청산 알림 메시지 */
  timeStopAlert: string;
  /** 켈리 공식 근거 요약 */
  formulaNote: string;
  /** 전체 행동 권고 메시지 */
  actionMessage: string;
  lastUpdated: string;
}

// ─── 아이디어 8: Bear Mode 손익 시뮬레이터 ─────────────────────────────────────

/** Bear Mode 시뮬레이터 시나리오 입력 (사용자가 하나 이상 입력 가능) */
export interface BearModeSimulatorInput {
  /** 시나리오 레이블 (예: '2024 하락장') */
  label: string;
  /** Bear 구간 시작일 (ISO 날짜 문자열, 예: '2024-01-15') */
  bearStartDate: string;
  /** Gate -1 Bear 감지일 (ISO 날짜 문자열) */
  gateDetectionDate: string;
  /** Bear 구간 종료일 (ISO 날짜 문자열) */
  bearEndDate: string;
  /** 이 기간 동안 롱 포트폴리오 수익률 (%, 예: -12.3) */
  longPortfolioReturn: number;
  /** 이 기간 동안 KOSPI 시장 수익률 (%, 예: -10.5) */
  marketReturn: number;
}

/** Bear Mode 시뮬레이터 시나리오별 계산 결과 */
export interface BearModeSimulatorScenarioResult {
  /** 시나리오 레이블 */
  label: string;
  /** Bear 구간 시작일 */
  bearStartDate: string;
  /** Bear 구간 종료일 */
  bearEndDate: string;
  /** Gate -1 감지 D+3 전환 예상일 */
  switchDate: string;
  /** 전환 지연 거래일 (3일 고정) */
  switchDayOffset: number;
  /** 롱 포트폴리오 수익률 (%) */
  longReturn: number;
  /** Bear Mode 전환 시 시뮬레이션 수익률 (%, KODEX 인버스 2X 기준) */
  bearModeReturn: number;
  /** 알파 차이 (%p = bearModeReturn - longReturn) */
  alphaDifference: number;
  /** 사용된 인버스 ETF 명칭 */
  inverseEtfName: string;
  /** 시나리오별 행동 권고 */
  recommendation: string;
}

/** Bear Mode 손익 시뮬레이터 전체 결과 */
export interface BearModeSimulatorResult {
  /** 시나리오별 계산 결과 목록 */
  scenarios: BearModeSimulatorScenarioResult[];
  /** 최고 알파 시나리오 (없으면 null) */
  bestScenario: BearModeSimulatorScenarioResult | null;
  /** 전체 결론 메시지 */
  conclusionMessage: string;
  lastUpdated: string;
}
