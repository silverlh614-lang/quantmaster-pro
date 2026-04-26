// ─── 포트폴리오 · IPS · 매매일지 · 자동매매 도메인 타입 ─────────────────────

import type { ConditionId, EvaluationResult } from './core';

// ─── 백테스트 ────────────────────────────────────────────────────────────────

/** 분할 익절 트랜치 — 백테스트 포지션 단위로 저장 */
export interface BacktestProfitTranche {
  price:  number;   // 절대 익절 가격
  ratio:  number;   // 이 트랜치에서 청산할 비율 (0~1)
  taken:  boolean;  // 이미 실행됐으면 true
}

export interface BacktestPosition {
  stockCode: string;
  stockName: string;
  entryPrice: number;
  quantity: number;
  entryDate: string;
  stopLoss: number;                       // 절대 손절가
  takeProfit: number;                     // 단일 목표가 (레거시 — profitTranches 사용 시 Infinity)
  currentPrice: number;
  unrealizedReturn: number;
  // ── 분할 익절 · 트레일링 스톱 (REGIME_CONFIGS 연결 후 사용) ──────────────
  originalQuantity:        number;        // 최초 매수 수량 — 트랜치 비율 기준값
  profitTranches:          BacktestProfitTranche[];
  trailingHighWaterMark:   number;        // 매수가로 초기화, 신고가마다 갱신
  trailPct:                number;        // 고점 대비 허용 하락 폭 (e.g., 0.08)
  trailingEnabled:         boolean;       // 마지막 LIMIT 트랜치 실행 후 true
}

export interface BacktestPortfolioState {
  cash: number;
  positions: BacktestPosition[];
  equity: number;
  initialEquity: number;
}

export interface BacktestDailyLog {
  date: string;
  equity: number;
  cash: number;
  positionsValue: number;
  drawdown: number;
  returns: number;
  benchmarkValue: number;
}

export interface BacktestResult {
  dailyLogs: BacktestDailyLog[];
  finalEquity: number;
  totalReturn: number;
  cagr: number;
  mdd: number;
  sharpe: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxConsecutiveLoss: number;
  trades: number;
  cumulativeReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  volatility: number;
  performanceData: { date: string; value: number; benchmark: number }[];
  aiAnalysis: string;
  optimizationSuggestions: {
    stock: string;
    action: 'INCREASE' | 'DECREASE' | 'MAINTAIN' | 'REMOVE';
    currentWeight: number;
    recommendedWeight: number;
    reason: string;
  }[];
  newThemeSuggestions?: {
    theme: string;
    stocks: string[];
    reason: string;
  }[];
  riskyStocks?: {
    stock: string;
    reason: string;
    riskLevel: 'HIGH' | 'MEDIUM';
  }[];
  riskMetrics: {
    beta: number;
    alpha: number;
    treynorRatio: number;
  };
}

// ─── 포트폴리오 ────────────────────────────────────────────────────────────────

export interface Portfolio {
  id: string;
  name: string;
  items: { name: string; code: string; weight: number }[];
  createdAt: string;
  description?: string;
  lastBacktestResult?: BacktestResult | null;
}

// ─── 정량 스크리닝 엔진 ──────────────────────────────────────────────────────

/** 정량 스크리닝 1단계: 기본 필터 통과 종목 */
export interface QuantScreenCandidate {
  code: string;
  name: string;
  marketCap: number;           // 시가총액 (억원)
  avgTurnover20d: number;      // 20일 평균 거래대금 (억원)
  price: number;               // 현재가
  change5d: number;            // 5일 수익률 (%)
  change20d: number;           // 20일 수익률 (%)
}

/** 정량 스크리닝 2단계: 이상 신호 감지 결과 */
export interface AnomalySignal {
  type: 'VOLUME_SURGE' | 'INSTITUTIONAL_ACCUMULATION' | 'NEW_HIGH_APPROACH' | 'VCP_DETECTED' | 'SHORT_DECREASE' | 'INSIDER_BUY' | 'BUYBACK' | 'LARGE_ORDER' | 'CAPEX_SURGE';
  strength: number;            // 0-10 신호 강도
  description: string;
}

export interface QuantScreenResult {
  code: string;
  name: string;
  marketCap: number;
  price: number;
  signals: AnomalySignal[];
  totalSignalScore: number;    // 0-100 종합 이상 신호 점수
  newsFrequencyScore: number;  // 0-10 뉴스 빈도 역지표 (뉴스 적을수록 고점수)
  silentAccumulationScore: number; // 0-10 조용한 매집 점수
  volumeProfile: {
    current: number;           // 현재 거래량
    avg20d: number;            // 20일 평균 거래량
    ratio: number;             // 현재/평균 비율
    trend: 'DRYING' | 'NORMAL' | 'SURGING'; // 거래량 추세
  };
  pricePosition: {
    distanceFrom52wHigh: number; // 52주 고가 대비 거리 (%)
    distanceFrom52wLow: number;  // 52주 저가 대비 거리 (%)
    aboveMA200: boolean;         // 200일선 위 여부
    aboveMA60: boolean;          // 60일선 위 여부
  };
  institutionalFlow: {
    foreignNet5d: number;      // 외국인 5일 순매수 (주)
    institutionNet5d: number;  // 기관 5일 순매수 (주)
    foreignConsecutive: number;// 외국인 연속 순매수 일수
    isQuietAccumulation: boolean; // 소량 분할 매수 패턴
  };
  source: 'QUANT_SCREEN';     // 데이터 소스 구분
}

// ─── DART 공시 Pre-News 스크리너 ─────────────────────────────────────────────

export type DartDisclosureType =
  | 'LARGE_ORDER'        // 대규모 수주
  | 'CAPEX'              // 유형자산 취득 (대규모 설비투자)
  | 'INVESTMENT'         // 타법인 출자 (신사업 진출)
  | 'CB_CHANGE'          // 전환사채 조건 변경
  | 'OWNERSHIP_CHANGE'   // 최대주주 변경
  | 'PATENT'             // 특허 취득/기술이전
  | 'EARNINGS_JUMP'      // 분기 영업이익 급증 (아직 뉴스화 안 됨)
  | 'BUYBACK'            // 자사주 취득 결정
  | 'INSIDER_BUY'        // 임원/대주주 장내 매수
  | 'TREASURY_CANCEL'    // 자사주 소각
  | 'DIVIDEND_INCREASE'; // 배당 증가 결정

export interface DartDisclosureSignal {
  type: DartDisclosureType;
  title: string;              // 공시 제목
  date: string;               // 공시 일자 (ISO 8601)
  significance: number;       // 0-10 중요도 점수
  revenueImpact?: number;     // 매출 대비 영향 (%, 수주/CAPEX의 경우)
  description: string;        // 공시 요약
  dartUrl?: string;           // DART 원문 URL
}

export interface DartScreenerResult {
  code: string;
  name: string;
  disclosures: DartDisclosureSignal[];
  totalScore: number;          // 0-100 공시 종합 점수
  preNewsScore: number;        // 0-10 뉴스 선행 점수 (공시 후 아직 뉴스 안 된 정도)
  daysSinceDisclosure: number; // 가장 최근 주요 공시 이후 경과일
  isActionable: boolean;       // 즉시 분석 가치 있는지 (48시간 이내 주요 공시)
  lastUpdated: string;
}

// ─── 조용한 매집 감지기 (Silent Accumulation Detector) ────────────────────────

export interface SilentAccumulationSignal {
  type: 'VWAP_ABOVE_CLOSE'          // VWAP > 종가 & 거래량 감소 (Dark Pool 패턴)
    | 'INSTITUTIONAL_QUIET_BUY'      // 기관 소량 분할 매수 (5일+ 연속)
    | 'SHORT_DECREASE'               // 공매도 잔고 20일 감소율
    | 'CALL_OI_SURGE'               // 콜옵션 미결제약정 급증 (섹터 ETF)
    | 'INSIDER_BUY'                  // 대주주/임원 장내 매수 (DART)
    | 'BUYBACK_ACTIVE'               // 자사주 매입 진행 중 (DART)
    | 'PRICE_FLOOR_RISING';          // 하한선 상승 (저점이 점점 높아짐)
  strength: number;                  // 0-10
  description: string;
  daysDetected: number;              // 신호 지속 일수
}

export interface SilentAccumulationResult {
  code: string;
  name: string;
  signals: SilentAccumulationSignal[];
  compositeScore: number;            // 0-100 종합 매집 점수
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  estimatedAccumulationDays: number; // 추정 매집 기간 (일)
  priceFloorTrend: 'RISING' | 'FLAT' | 'FALLING';
  volumeTrend: 'DRYING' | 'STABLE' | 'INCREASING';
  accumulationPhase: 'EARLY' | 'MID' | 'LATE' | 'NONE';
  lastUpdated: string;
}

// ─── 섹터-테마 역추적 엔진 (Sector-Theme Reverse Tracking) ──────────────────

export interface GlobalMegatrend {
  keyword: string;               // 글로벌 트렌드 키워드 (e.g., "SMR 소형모듈원자로")
  source: string;                // 발원지 (e.g., "미국 에너지부 정책")
  momentum: 'EMERGING' | 'ACCELERATING' | 'MATURE' | 'FADING';
  globalMarketSize?: string;     // 글로벌 시장 규모 (e.g., "$120B by 2030")
}

export interface ValueChainLink {
  company: string;               // 한국 기업명
  code: string;                  // 종목 코드
  role: string;                  // 밸류체인 내 역할 (e.g., "열교환기 부품 공급")
  revenueExposure: number;       // 관련 매출 비중 (0-100%)
  marketAttention: 'HIDDEN' | 'EMERGING' | 'KNOWN'; // 시장 인지도
  competitiveEdge: string;       // 경쟁우위 요약
}

export interface ThemeReverseTrackResult {
  theme: string;                 // 테마명
  globalTrend: GlobalMegatrend;
  koreaValueChain: ValueChainLink[];
  hiddenGems: ValueChainLink[];  // HIDDEN 종목만 필터
  totalCompanies: number;
  avgMarketAttention: number;    // 0-100 (낮을수록 아직 주목 안 됨)
  investmentTiming: 'TOO_EARLY' | 'OPTIMAL' | 'LATE' | 'MISSED';
  lastUpdated: string;
}

// ─── 뉴스 빈도 역지표 (Contrarian News Score) ────────────────────────────────

export interface NewsFrequencyScore {
  code: string;
  name: string;
  newsCount30d: number;          // 최근 30일 뉴스 건수
  score: number;                 // 0-10 (뉴스 적을수록 고점수)
  phase: 'SILENT' | 'EARLY' | 'GROWING' | 'CROWDED' | 'OVERHYPED';
  implication: string;           // 투자 시사점
}

// ─── IDEA 10: Pre-Mortem 무효화 조건 ─────────────────────────────────────────

/** Pre-Mortem 무효화 조건 하나 */
export interface PreMortemItem {
  id: string;              // 고유 ID (e.g., 'FUNDAMENTAL', 'SUPPLY_DEMAND', ...)
  scenario: string;        // 시나리오 (e.g., '펀더멘털 훼손')
  trigger: string;         // 무효화 조건 (e.g., 'ROE 유형 3→4 전이')
  action: string;          // 자동 행동 (e.g., '50% 청산')
  actionPct?: number;      // 청산 비율 (50=50%, 30=30%, 100=전량, undefined=금지)
  triggered: boolean;      // 발동 여부
  triggeredAt?: string;    // 발동 시점 ISO date
}

/** 매수 시 기본 제공되는 5개 Pre-Mortem 조건 */
export const DEFAULT_PRE_MORTEMS: Omit<PreMortemItem, 'triggered' | 'triggeredAt'>[] = [
  {
    id: 'FUNDAMENTAL',
    scenario: '펀더멘털 훼손',
    trigger: 'ROE 유형 3→4 전이',
    action: '50% 청산',
    actionPct: 50,
  },
  {
    id: 'SUPPLY_DEMAND',
    scenario: '수급 이탈',
    trigger: '외국인 5일 연속 순매도',
    action: '30% 청산',
    actionPct: 30,
  },
  {
    id: 'TECHNICAL',
    scenario: '기술적 붕괴',
    trigger: '60일선 데드크로스',
    action: '전량 청산',
    actionPct: 100,
  },
  {
    id: 'MACRO',
    scenario: '매크로 악화',
    trigger: 'MHS RED 전환',
    action: '신규 매수 금지',
    actionPct: undefined,
  },
  {
    id: 'DRAWDOWN',
    scenario: '고점 대비 낙폭',
    trigger: '-30% 초과',
    action: '기계적 손절',
    actionPct: 100,
  },
];

// ─── 매매 일지 개별 기록 ─────────────────────────────────────────────────────

/** ① 매매 일지 개별 기록 */
export interface TradeRecord {
  id: string;                       // uuid
  stockCode: string;
  stockName: string;
  sector: string;

  // 매수
  buyDate: string;                  // ISO date
  buyPrice: number;
  quantity: number;
  positionSize: number;             // % of portfolio at entry

  // 매도 (완료 시 채움)
  sellDate?: string;
  sellPrice?: number;
  sellReason?: 'TARGET_HIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'SELL_SIGNAL' | 'MANUAL';

  // 시스템 신호 스냅샷 (매수 시점)
  systemSignal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL';
  recommendation: EvaluationResult['recommendation'];
  gate1Score: number;
  gate2Score: number;
  gate3Score: number;
  finalScore: number;
  conditionScores: Record<ConditionId, number>;  // 27조건 스냅샷
  // ADR-0018: 자기학습 데이터 무결성 — v2 신규 필드 (옵셔널 후방호환)
  conditionSources?: Record<ConditionId, 'COMPUTED' | 'AI'>;  // 조건별 데이터 출처
  evaluationSnapshot?: {                                       // 추천 평가 시점 메타
    capturedAt: string;
    rrr?: number;
    profile?: 'A' | 'B' | 'C' | 'D';
    confluence?: number;
    lastTrigger?: boolean;
  };
  schemaVersion?: number;                                      // 기본 2, v1 = 1

  // 시스템 vs 직관
  followedSystem: boolean;          // true=기계적 매수, false=직감 매수

  // 결과 (매도 후 계산)
  returnPct?: number;               // 수익률 (%)
  holdingDays?: number;             // 보유 일수
  status: 'OPEN' | 'CLOSED' | 'PARTIAL';

  // 현재가 추적 (OPEN 상태)
  currentPrice?: number;
  unrealizedPct?: number;           // 미실현 수익률 (%)
  lastSyncAt?: string;

  memo?: string;                    // 자유 메모

  // IDEA 10: Pre-Mortem 무효화 조건 (매수 시점에 사전 명시)
  preMortems?: PreMortemItem[];     // 무효화 조건 목록
  peakPrice?: number;               // 최고가 (고점 대비 낙폭 추적용)

  // ADR-0019 (PR-B): RecommendationSnapshot 양방향 추적
  recommendationSnapshotId?: string;  // OPEN 시 snapshot.id 연결
}

// ─── ADR-0019 (PR-B): 추천 스냅샷 lifecycle ──────────────────────────────────

/**
 * 추천 발령 시점부터 사용자 행동(매수→매도) 까지의 전 lifecycle 영속 단위.
 *
 * 자기학습 5계층 확장 시리즈 PR-B 의 핵심 SSOT — 사용자가 받은 AI 추천이
 * 실제로 얼마나 적중했는지(adoption rate, hit rate, avg return) 정량화한다.
 *
 * 서버 `recommendationTracker.RecommendationRecord` 와 별개:
 *   - 서버: SHADOW 자동매매 신호 (시장가 자동 판정)
 *   - 본 타입: 사용자 노출 추천 (사용자 행동 기반 lifecycle)
 */
export interface RecommendationSnapshot {
  id: string;                         // 'rec-snap-<timestamp>-<code>'
  recommendedAt: string;              // ISO
  stockCode: string;
  stockName: string;
  recommendation: 'BUY' | 'STRONG_BUY' | 'STRONG_SELL' | 'SELL' | 'NEUTRAL';

  // 추천 시점 가격/리스크
  entryPrice: number;
  targetPrice?: number;
  stopLossPrice?: number;
  rrr?: number;

  // 추천 시점 27조건 + Gate (PR-A adapter 산출물 재사용)
  conditionScores: Record<ConditionId, number>;
  conditionSources: Record<ConditionId, 'COMPUTED' | 'AI'>;
  gate1Score: number;
  gate2Score: number;
  gate3Score: number;
  finalScore: number;
  confluence?: number;
  sector?: string;

  // Lifecycle
  status: 'PENDING' | 'OPEN' | 'CLOSED' | 'EXPIRED';
  openedAt?: string;
  closedAt?: string;
  expiredAt?: string;
  tradeId?: string;                   // OPEN 시 TradeRecord.id 연결

  // 평가 (CLOSED 시점)
  realizedReturnPct?: number;

  schemaVersion: number;              // 1
}

/**
 * RecommendationSnapshot 통계 — UI 적중률 패널 + 학습 입력으로 사용.
 *
 * - hitRate: CLOSED 중 realizedReturnPct > 0 비율
 * - adoptionRate: 추천 → OPEN 전환 비율 (사용자가 시스템 추천을 따른 정도)
 * - avgReturnClosed: CLOSED 의 평균 실현 수익률
 */
export interface SnapshotStats {
  totalCount: number;
  pendingCount: number;
  openCount: number;
  closedCount: number;
  expiredCount: number;
  hitRate: number;                    // 0~1
  strongBuyHitRate: number;           // 0~1
  buyHitRate: number;                 // 0~1
  avgReturnClosed: number;            // %
  adoptionRate: number;               // 0~1
}

// ─── 자동매매 엔진 타입 ──────────────────────────────────────────────────────────

/** KIS 주문 파라미터 (현금 매수/매도 공통) */
export interface KISOrderParams {
  PDNO: string;      // 종목코드 (6자리)
  ORD_DVSN: string;  // 주문구분 (00=지정가, 01=시장가)
  ORD_QTY: string;   // 주문수량
  ORD_UNPR: string;  // 주문단가 (시장가=0)
}

/** Shadow Trading 1건 — 실제 체결 없이 가상 시뮬레이션 */
export interface ShadowTrade {
  id: string;
  signalTime: string;          // ISO
  stockCode: string;
  stockName: string;
  signalPrice: number;         // 신호 발생 시점 가격
  shadowEntryPrice: number;    // 신호가 + 0.3% 슬리피지 가정
  quantity: number;
  kellyFraction: number;
  stopLoss: number;
  targetPrice: number;
  status: 'PENDING' | 'ACTIVE' | 'HIT_TARGET' | 'HIT_STOP';
  exitPrice?: number;
  exitTime?: string;
  returnPct?: number;
}

/** 체결 완료된 주문 — OCO 등록 트리거용 */
export interface FilledOrder {
  stockCode: string;
  stockName: string;
  executedPrice: number;
  quantity: number;
  rrr: number;              // Risk-Reward Ratio (EvaluationResult.rrr)
  stopLossPct?: number;     // 손절 비율 (기본 0.08 = 8%)
}

/** 큐에 보관 중인 미실행 주문 (타임 필터 대기) */
export interface PendingOrder {
  id: string;
  params: KISOrderParams;
  stockName: string;
  queuedAt: string;          // ISO
  reason: string;
}

/** 슬리피지 측정 기록 1건 */
export interface SlippageRecord {
  id: string;
  stockCode: string;
  signalTime: string;
  theoreticalPrice: number;  // 신호 발생 시점 가격
  executedPrice: number;     // 실제 KIS 체결가
  slippagePct: number;       // (executed - theoretical) / theoretical
  orderType: 'MARKET' | 'LIMIT';
  volume: number;            // 당시 거래량 (상관관계 분석용)
}

/** Gate 조건별 수익 귀인 누적 엔트리 */
export interface AttributionEntry {
  conditionId: ConditionId;
  winContrib: number;        // 승리 거래에서 이 조건의 점수 합계
  lossContrib: number;       // 손실 거래에서 이 조건의 점수 합계
  count: number;             // 분석된 거래 수
}

/** ② 27조건 실전 승률 누적 */
export interface ConditionPerformance {
  conditionId: ConditionId;
  conditionName: string;

  // 누적 통계
  totalTrades: number;              // 해당 조건 ≥ 5 였던 매매 수
  winTrades: number;                // 수익 종료된 매매 수
  lossTrades: number;
  avgReturnWhenHigh: number;        // 해당 조건 ≥ 7 일 때 평균 수익률
  avgReturnWhenLow: number;         // 해당 조건 < 5 일 때 평균 수익률

  // 동적 가중치 (실전 데이터 기반)
  evolutionWeight: number;          // 1.0 = 기본, > 1.0 = 실전 강화
  lastUpdated: string;
}

/** ③ 시스템 vs 직관 대결 요약 */
export interface SystemVsIntuitionStats {
  // 시스템 매수 (followedSystem = true)
  systemTrades: number;
  systemWins: number;
  systemAvgReturn: number;          // %
  systemMaxDrawdown: number;        // %

  // 직관 매수 (followedSystem = false)
  intuitionTrades: number;
  intuitionWins: number;
  intuitionAvgReturn: number;
  intuitionMaxDrawdown: number;

  // 종합 비교
  systemWinRate: number;            // %
  intuitionWinRate: number;         // %
  systemEdge: number;               // 시스템 승률 - 직관 승률 (양수=시스템 우위)

  lastUpdated: string;
}

// ─── 아이디어 11: IPS 통합 변곡점 확률 엔진 ─────────────────────────────────────

/** IPS 구성 신호 ID */
export type IpsSignalId = 'THS' | 'VDA' | 'FSS' | 'FBS' | 'TMA' | 'SRR';

/** IPS 개별 신호 평가 결과 */
export interface IpsSignal {
  id: IpsSignalId;
  /** 영문 약어 전체 이름 */
  name: string;
  /** 한국어 설명 */
  nameKo: string;
  /** 가중치 (0~1, 합계 = 1.0) */
  weight: number;
  /** 신호 발동 여부 */
  triggered: boolean;
  /** 이번 신호의 IPS 기여분 (weight × 100 if triggered, else 0) */
  contribution: number;
  /** 발동 근거 설명 */
  description: string;
}

/** IPS 경보 단계 */
export type IpsLevel = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXTREME';

/** IPS 통합 변곡점 확률 엔진 전체 결과 */
export interface IpsResult {
  /** 통합 점수 (0~100 %) */
  ips: number;
  /** 경보 단계: NORMAL(<60) / WARNING(≥60) / CRITICAL(≥80) / EXTREME(≥90) */
  level: IpsLevel;
  /** 6개 신호 평가 목록 */
  signals: IpsSignal[];
  /** 발동된 신호 ID 목록 */
  triggeredSignals: IpsSignalId[];
  /** 행동 권고 메시지 */
  actionMessage: string;
  /** IPS ≥ 80 → 50% 비중 축소 권고 */
  positionReduceRecommended: boolean;
  /** IPS ≥ 90 → Pre-Mortem 체크리스트 실행 권고 */
  preMortemRequired: boolean;
  lastUpdated: string;
}

// ─── 피드백 폐쇄 루프 (Feedback Closed Loop) ────────────────────────────────────

/** 단일 조건의 실전 학습 결과 */
export interface ConditionCalibration {
  conditionId: ConditionId;
  conditionName: string;
  /** 기여 거래 수 (해당 조건 ≥ 5인 거래) */
  tradeCount: number;
  /** 승률 (0~1) */
  winRate: number;
  /** 평균 수익률 (%) */
  avgReturn: number;
  /** 이전 가중치 */
  prevWeight: number;
  /** 새 가중치 (실전 데이터 반영 후) */
  newWeight: number;
  /** 가중치 변화 방향 */
  direction: 'UP' | 'DOWN' | 'STABLE';
  /** 변화량 */
  delta: number;
}

/** 피드백 폐쇄 루프 캘리브레이션 결과 */
export interface FeedbackLoopResult {
  /** 총 누적 종료 거래 수 */
  closedTradeCount: number;
  /** 30거래 달성 여부 (캘리브레이션 활성화 기준) */
  calibrationActive: boolean;
  /** 30거래 달성 진척도 (0~1) */
  calibrationProgress: number;
  /** 조건별 캘리브레이션 결과 (calibrationActive=true 일 때만 채워짐) */
  calibrations: ConditionCalibration[];
  /** 상향 조정된 조건 수 */
  boostedCount: number;
  /** 하향 조정된 조건 수 */
  reducedCount: number;
  /** 마지막 캘리브레이션 시각 (ISO) */
  lastCalibratedAt: string | null;
  /** 요약 메시지 */
  summary: string;
}
