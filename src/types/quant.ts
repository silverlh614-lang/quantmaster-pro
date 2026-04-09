export type ConditionId = number;

export interface Condition {
  id: ConditionId;
  name: string;
  description: string;
  baseWeight: number;
}

export type MarketRegimeType = '상승초기' | '변동성' | '횡보' | '하락';

export interface MarketRegime {
  type: MarketRegimeType;
  weightMultipliers: Record<ConditionId, number>;
  vKospi: number;
  samsungIri: number;
}

// ─── Gate 0: 거시 환경 생존 게이트 ───────────────────────────────────────────

export type RateCycle = 'TIGHTENING' | 'EASING' | 'PAUSE';
export type FXRegime = 'DOLLAR_STRONG' | 'DOLLAR_WEAK' | 'NEUTRAL';

/** 거시 환경 4개 축 입력 데이터 */
export interface MacroEnvironment {
  // 금리 축
  bokRateDirection: 'HIKING' | 'HOLDING' | 'CUTTING'; // 한국은행 기준금리 방향
  us10yYield: number;          // 미국 10년 국채 금리 (%)
  krUsSpread: number;          // 한미 금리 스프레드 (pp, 음수 = 역전)
  // 유동성 축
  m2GrowthYoY: number;         // M2 증가율 YoY (%)
  bankLendingGrowth: number;   // 은행 여신 증가율 (%)
  nominalGdpGrowth: number;    // 명목 GDP 성장률 (%)
  // 경기 축
  oeciCliKorea: number;        // OECD 경기선행지수 한국 (100 기준)
  exportGrowth3mAvg: number;   // 수출증가율 3개월 이동평균 (%)
  // 리스크 축
  vkospi: number;              // VKOSPI
  samsungIri: number;          // 삼성 IRI (1.0 = 중립, <0.7 = 매도 압력)
  vix: number;                 // VIX
  // 환율
  usdKrw: number;              // 원/달러 환율
  // ─── Gate -1 Bear Regime Detector 보조 지표 (optional) ───────────────────
  kospiBelow120ma?: boolean;         // KOSPI 120일 이동평균선 하회 여부
  kospiIchimokuBearish?: boolean;    // KOSPI 일목 구름 아래 (하락 추세) 여부
  vkospiRising?: boolean;            // VKOSPI 상승 중 여부 (추세)
  samsungIriDelta?: number;          // 삼성 IRI 변화량 (pt, 양수=위험 증가)
  foreignFuturesSellDays?: number;   // 외국인 선물 연속 순매도 일수
  mhsTrend?: 'IMPROVING' | 'STABLE' | 'DETERIORATING'; // MHS 추세 방향
  dxyBullish?: boolean;              // 달러인덱스(DXY) 강세 전환 여부 (Inverse Gate 1용)
}

/** Gate 0 평가 결과 */
export interface Gate0Result {
  passed: boolean;
  macroHealthScore: number;    // MHS 0-100
  mhsLevel: 'HIGH' | 'MEDIUM' | 'LOW'; // HIGH ≥70 / MEDIUM 40-69 / LOW <40
  kellyReduction: number;      // 포지션 축소율: 0=정상, 0.5=50%축소, 1.0=매수중단
  buyingHalted: boolean;       // MHS < 40 → 전면 매수 중단
  rateCycle: RateCycle;
  fxRegime: FXRegime;
  details: {
    interestRateScore: number; // 0-25
    liquidityScore: number;    // 0-25
    economicScore: number;     // 0-25
    riskScore: number;         // 0-25
  };
}

// ─── 아이디어 4: Smart Money Radar (글로벌 ETF 선행 모니터) ──────────────────

export interface EtfFlowData {
  ticker: string;          // 'EWY' | 'MTUM' | 'EEMV' | 'IYW' | 'ITA'
  name: string;            // 'iShares MSCI Korea' 등
  flow: 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';
  weeklyAumChange: number; // % AUM 주간 변동
  priceChange: number;     // % 가격 주간 변동
  significance: string;    // 한국 증시와의 관계 설명
}

export interface SmartMoneyData {
  score: number;                  // 0-10 종합 점수
  etfFlows: EtfFlowData[];        // 5개 ETF 흐름
  isEwyMtumBothInflow: boolean;   // Gate 2 완화 트리거
  leadTimeWeeks: string;          // 예상 선행 주수 (e.g. "2-4주")
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  lastUpdated: string;
}

// ─── 아이디어 5: 수출 선행지수 섹터 로테이션 엔진 ────────────────────────────

export interface ExportProductData {
  product: string;                   // '반도체' | '선박' | '자동차' | '석유화학' | '방산'
  sector: string;                    // 연계 섹터명 (KOSPI 분류)
  yoyGrowth: number;                 // % YoY 수출 증감률
  isHot: boolean;                    // 기준치 이상 성장
  consecutiveGrowthMonths?: number;  // 반도체 연속 성장 개월수
}

export interface ExportMomentumData {
  hotSectors: string[];              // 가산점 대상 섹터 목록
  products: ExportProductData[];     // 주요 수출 품목 데이터
  shipyardBonus: boolean;            // 선박 +30% YoY 달성
  semiconductorGate2Relax: boolean;  // 반도체 3개월 연속 증가 → Gate 2 완화
  lastUpdated: string;
}

// ─── ECOS (한국은행 경제통계시스템) 데이터 타입 ─────────────────────────────

/** ECOS API 원시 응답 행 */
export interface EcosRawRow {
  STAT_CODE: string;       // 통계표 코드
  STAT_NAME: string;       // 통계표명
  ITEM_CODE1: string;      // 통계항목 코드1
  ITEM_NAME1: string;      // 통계항목명1
  ITEM_CODE2?: string;     // 통계항목 코드2
  ITEM_NAME2?: string;     // 통계항목명2
  UNIT_NAME: string;       // 단위
  TIME: string;            // 시점 (YYYYMM, YYYYMMDD, YYYY 등)
  DATA_VALUE: string;      // 데이터 값
}

/** ECOS 기준금리 데이터 */
export interface EcosBokRate {
  date: string;            // YYYYMMDD
  rate: number;            // 기준금리 (%)
  direction: 'HIKING' | 'HOLDING' | 'CUTTING'; // 방향
}

/** ECOS 환율 데이터 */
export interface EcosExchangeRate {
  date: string;            // YYYYMMDD
  usdKrw: number;          // 원/달러 환율
  change: number;          // 전일 대비 변동
  changePct: number;       // 전일 대비 변동률 (%)
}

/** ECOS M2 통화량 데이터 */
export interface EcosM2Data {
  date: string;            // YYYYMM
  amount: number;          // M2 잔액 (조원)
  yoyGrowth: number;       // 전년동월 대비 증가율 (%)
}

/** ECOS GDP 데이터 */
export interface EcosGdpData {
  quarter: string;         // YYYYQN (예: 2024Q1)
  realGdpGrowth: number;   // 실질 GDP 성장률 (전기 대비, %)
  yoyGrowth: number;       // 전년동기 대비 성장률 (%)
}

/** ECOS 수출입 데이터 */
export interface EcosTradeData {
  date: string;            // YYYYMM
  exports: number;         // 수출액 (백만 달러)
  imports: number;         // 수입액 (백만 달러)
  tradeBalance: number;    // 무역수지 (백만 달러)
  exportGrowthYoY: number; // 수출 증가율 YoY (%)
}

/** ECOS 은행 대출 데이터 (104Y015 — 예금은행 여신) */
export interface EcosBankLending {
  date: string;            // YYYYMM
  balance: number;         // 원화대출금 잔액 (조원)
  yoyGrowth: number;       // YoY 증가율 (%)
}

/** ECOS 종합 매크로 데이터 (모든 지표 통합) */
export interface EcosMacroSnapshot {
  bokRate: EcosBokRate | null;
  exchangeRate: EcosExchangeRate | null;
  m2: EcosM2Data | null;
  gdp: EcosGdpData | null;
  trade: EcosTradeData | null;
  bankLending: EcosBankLending | null; // 104Y015 — 은행 여신 증가율 (bankLendingGrowth 실데이터)
  fetchedAt: string;       // ISO 타임스탬프
}

/** ECOS 시계열 조회 요청 파라미터 */
export interface EcosQueryParams {
  statCode: string;        // 통계표 코드
  period: 'D' | 'M' | 'Q' | 'A'; // 주기 (일/월/분기/연)
  startDate: string;       // 시작일 (YYYYMMDD 또는 YYYYMM)
  endDate: string;         // 종료일
  itemCode1: string;       // 통계항목 코드1
  itemCode2?: string;      // 통계항목 코드2
}

// ─── 아이디어 7: 지정학 리스크 스코어링 모듈 (Geopolitical Risk Engine) ──────

export interface GeopoliticalRiskData {
  score: number;                    // GOS 0-10
  level: 'OPPORTUNITY' | 'NEUTRAL' | 'RISK'; // ≥7 / 4-6 / ≤3
  affectedSectors: string[];        // 방산, 조선, 원자력
  headlines: string[];              // 검색된 주요 뉴스 헤드라인 (최대 3개)
  toneBreakdown: {
    positive: number;               // 0-100
    neutral: number;
    negative: number;
  };
  lastUpdated: string;
}

// ─── 아이디어 9: 크레딧 스프레드 조기 경보 시스템 ────────────────────────────

export interface CreditSpreadData {
  krCorporateSpread: number;       // 한국 AA- 회사채 스프레드 (bp)
  usHySpread: number;              // 미국 하이일드 스프레드 (bp)
  embiSpread: number;              // 신흥국 EMBI+ 스프레드 (bp)
  isCrisisAlert: boolean;          // AA- ≥ 150bp → 신용 위기 경보
  isLiquidityExpanding: boolean;   // 스프레드 축소 추세 → 유동성 확장
  trend: 'WIDENING' | 'NARROWING' | 'STABLE';
  lastUpdated: string;
}

// ─── 아이디어 11: 역발상 카운터사이클 알고리즘 ──────────────────────────────

export interface ContrarianSignal {
  id: string;
  name: string;
  active: boolean;
  bonus: number;       // 발동 시 Gate 3 점수 가산
  description: string;
}

export type StockProfileType = 'A' | 'B' | 'C' | 'D'; // 대형 주도주, 중형 성장주, 소형 모멘텀주, 촉매제 플레이

export interface StockProfile {
  type: StockProfileType;
  monitoringCycle: 'WEEKLY' | 'DAILY' | 'REALTIME';
  stopLoss: number; // e.g., -15
  executionDelay: number; // days
}

export interface EuphoriaSignal {
  id: string;
  name: string;
  active: boolean;
}

export interface SellCondition {
  id: number;
  name: string;
  description: string;
  trigger: string;
}

export interface MultiTimeframe {
  monthly: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  weekly: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  daily: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  consistency: boolean;
}

export interface TranchePlan {
  tranche1: { size: number; trigger: string; status: 'PENDING' | 'EXECUTED' };
  tranche2: { size: number; trigger: string; status: 'PENDING' | 'EXECUTED' };
  tranche3: { size: number; trigger: string; status: 'PENDING' | 'EXECUTED' };
}

export interface EnemyChecklist {
  bearCase: string;
  riskFactors: string[];
  counterArguments: string[];
}

// ─── 판단엔진 고도화: 합치 스코어, 사이클, 촉매, 신호 계층 ─────────────────────

/** 합치(Confluence) 스코어 — 4개 독립 축의 동시 방향 확인 */
export interface ConfluenceScore {
  technical: 'BULLISH' | 'NEUTRAL' | 'BEARISH';   // 축1: RSI·MACD·BB·일목·VCP (실계산)
  supply: 'BULLISH' | 'NEUTRAL' | 'BEARISH';      // 축2: 기관·외인 수급 (실데이터)
  fundamental: 'BULLISH' | 'NEUTRAL' | 'BEARISH';  // 축3: ROE·OCF·ICR·마진 (실데이터)
  macro: 'BULLISH' | 'NEUTRAL' | 'BEARISH';        // 축4: MHS·FSI·BDI·FOMC (글로벌인텔)
  bullishCount: number;  // 0-4
  confirmed: boolean;    // 4/4 = true
}

/** 섹터 사이클 위치 — 진입 품질 결정 */
export type CyclePosition = 'EARLY' | 'MID' | 'LATE';

export interface CycleAnalysis {
  position: CyclePosition;
  sectorRsRank: number;        // 섹터 RS 순위 (% 상위)
  sectorRsTrend: 'ACCELERATING' | 'STABLE' | 'DECELERATING';
  newsPhase: 'SILENT' | 'EARLY' | 'GROWING' | 'CROWDED' | 'OVERHYPED';
  foreignFlowPhase: 'NONE' | 'ACTIVE_ONLY' | 'ACTIVE_PASSIVE' | 'PASSIVE_ONLY';
  kellyMultiplier: number;     // EARLY=1.0, MID=0.7, LATE=0
}

/** 촉매 품질 등급 */
export type CatalystGrade = 'A' | 'B' | 'C';

export interface CatalystAnalysis {
  grade: CatalystGrade;
  type: string;              // "구조적 수주잔고" / "실적 서프라이즈" / "테마 뉴스"
  durability: 'STRUCTURAL' | 'CYCLICAL' | 'TEMPORARY';
  description: string;
  strongBuyAllowed: boolean; // A=true, B=false(BUY만), C=false(HOLD)
}

/** 모멘텀 가속도 — 추세 방향보다 가속이 더 중요 */
export interface MomentumAcceleration {
  rsiTrend: number[];            // 최근 3주 RSI 값 [45, 52, 62]
  rsiAccelerating: boolean;      // 3주 연속 상승
  institutionalTrend: number[];  // 최근 5일 기관 순매수 금액
  institutionalAccelerating: boolean;
  volumeTrend: 'INCREASING' | 'STABLE' | 'DECREASING';
  overallAcceleration: boolean;  // rsi + institutional 모두 가속
}

/** 강화된 적의 체크리스트 — STRONG BUY 전 역검증 7항목 */
export interface EnemyChecklistEnhanced extends EnemyChecklist {
  lockupExpiringSoon: boolean;      // 1. 보호예수 60일 이내 해제
  majorShareholderSelling: boolean; // 2. 최대주주 장내 매도
  creditBalanceSurge: boolean;      // 3. 신용잔고 1개월 급증
  shortInterestSurge: boolean;      // 4. 공매도 잔고 2주 30%↑
  targetPriceDowngrade: boolean;    // 5. 증권사 목표가 하향
  fundMaturityDue: boolean;         // 6. 보호예수 펀드 만기
  clientPerformanceWeak: boolean;   // 7. 주요 고객사 실적 악화
  blockedCount: number;             // 위 7개 중 YES 개수
  strongBuyBlocked: boolean;        // 2개 이상이면 true
}

/** 데이터 신뢰도 추적 */
export interface DataReliability {
  realDataCount: number;      // 실계산 기반 조건 수
  aiEstimateCount: number;    // AI 추정 기반 조건 수
  reliabilityPct: number;     // 실데이터 비율 (%)
  degraded: boolean;          // AI 추정 비율 > 50%이면 BUY로 강등
}

/** 신호 계층 (재정의) */
export type SignalGrade = 'CONFIRMED_STRONG_BUY' | 'STRONG_BUY' | 'BUY' | 'WATCH' | 'HOLD';

export interface SignalVerdict {
  grade: SignalGrade;
  kellyPct: number;           // 100 / 70 / 50 / 0 / 0
  positionRule: string;       // "풀 포지션, 자동매매 허용" 등
  passedConditions: string[]; // 통과한 상위 조건 목록
  failedConditions: string[]; // 미달 조건 목록
}

export interface SeasonalityData {
  month: number;
  historicalPerformance: number;
  winRate: number;
  isPeakSeason: boolean;
}

export interface AttributionAnalysis {
  sectorContribution: number;
  momentumContribution: number;
  valueContribution: number;
  alpha: number;
}

export interface EvaluationResult {
  gate0Result?: Gate0Result;
  smartMoneyData?: SmartMoneyData;
  exportMomentumData?: ExportMomentumData;
  geopoliticalRisk?: GeopoliticalRiskData;
  creditSpreadData?: CreditSpreadData;
  contrarianSignals?: ContrarianSignal[];
  gate1Passed: boolean;
  gate2Passed: boolean;
  gate3Passed: boolean;
  gate1Score: number;
  gate2Score: number;
  gate3Score: number;
  finalScore: number;
  fxAdjustmentFactor: number;      // FX 조정 팩터 (-3 ~ +3)
  recommendation: '풀 포지션' | '절반 포지션' | '관망' | '매도' | '강력 매도';
  positionSize: number; // % of portfolio
  rrr: number; // Risk-Reward Ratio
  lastTrigger: boolean;
  euphoriaLevel: number; // 0-5
  emergencyStop: boolean;
  profile: StockProfile;
  sellScore: number; // 0-27
  sellSignals: number[]; // IDs of triggered sell conditions
  multiTimeframe?: MultiTimeframe;
  tranchePlan?: TranchePlan;
  enemyChecklist?: EnemyChecklist;
  seasonality?: SeasonalityData;
  attribution?: AttributionAnalysis;
  correlationScore?: number; // Correlation with existing portfolio

  // ── 판단엔진 고도화 필드 ──────────────────────────────────────────────────
  confluence?: ConfluenceScore;
  cycleAnalysis?: CycleAnalysis;
  catalystAnalysis?: CatalystAnalysis;
  momentumAcceleration?: MomentumAcceleration;
  enemyChecklistEnhanced?: EnemyChecklistEnhanced;
  dataReliability?: DataReliability;
  signalVerdict?: SignalVerdict;
  conditionScores?: Record<ConditionId, number>; // 27조건 점수 스냅샷 (귀인 분석용)
  conditionSources?: Record<ConditionId, 'COMPUTED' | 'AI'>; // 조건별 데이터 출처 (실계산 vs AI추정)
}

export interface SectorRotation {
  name: string;
  rank: number;
  strength: number;
  isLeading: boolean;
  sectorLeaderNewHigh: boolean; // 2순위: 대장주 신고가 경신 여부
  leadingSectors?: string[];
}

export interface EmergencyStopSignal {
  id: string;
  name: string;
  triggered: boolean;
}

export interface MacroEvent {
  id: string;
  title: string;
  date: string; // ISO 8601
  dDay: number;
  type: 'MACRO' | 'EARNINGS' | 'POLICY';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  strategyAdjustment: string;
  probability?: number; // e.g., 55 for surprise probability
}

export interface RecommendationHistory {
  stockCode: string;
  stockName: string;
  recommendedAt: string;      // "2026-03-15"
  priceAtRecommend: number;   // 245,000
  type: 'STRONG_BUY' | 'BUY';
  stopLoss: number;
  targetPrice: number;
  outcome: 'WIN' | 'LOSS' | 'PENDING';
  actualReturn: number;       // +12.3% or -8.5%
}

export interface BacktestPosition {
  stockCode: string;
  stockName: string;
  entryPrice: number;
  quantity: number;
  entryDate: string;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  unrealizedReturn: number;
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

// ─── 경기 사이클 레짐 분류기 (Idea 2) ────────────────────────────────────────

export type EconomicRegime = 'RECOVERY' | 'EXPANSION' | 'SLOWDOWN' | 'RECESSION' | 'UNCERTAIN' | 'CRISIS' | 'RANGE_BOUND';

/**
 * ROE 5유형
 * 1: 레버리지 의존형 (부채 기반 자산 확장)
 * 2: 자본경량형 (무형자산·플랫폼 기반)
 * 3: 매출·마진 동반 성장형 (최강 알파 유형)
 * 4: 비용 통제형 (매출 정체, 비용 절감)
 * 5: 재무 왜곡형 (자사주 매입·자본 축소)
 */
export type ROEType = 1 | 2 | 3 | 4 | 5;

/** Gemini 기반 경기 레짐 분류 결과 */
export interface EconomicRegimeData {
  regime: EconomicRegime;
  confidence: number;        // 0-100
  rationale: string;         // 분류 근거 요약
  allowedSectors: string[];  // 현재 레짐 허용 섹터 화이트리스트
  avoidSectors: string[];    // 회피 섹터
  keyIndicators: {
    exportGrowth: string;       // 수출 증가율
    bokRateDirection: string;   // 한국은행 금리 방향
    oeciCli: string;            // OECD CLI 수치
    gdpGrowth: string;          // GDP 성장률
  };
  lastUpdated: string;
}

export interface Portfolio {
  id: string;
  name: string;
  items: { name: string; code: string; weight: number }[];
  createdAt: string;
  description?: string;
  lastBacktestResult?: BacktestResult | null;
}

// ─── 정량 스크리닝 엔진 (Quantitative Screening Engine) ──────────────────────

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

// ─── 불확실성 레짐 확장 (Extended Regime Classification) ──────────────────────

/** 확장 레짐 분류 결과 */
export interface ExtendedRegimeData extends EconomicRegimeData {
  regime: EconomicRegime;
  uncertaintyMetrics?: {
    regimeClarity: number;       // 0-100 레짐 명확도 (낮을수록 불확실)
    signalConflict: number;      // 0-100 신호 충돌도 (높을수록 혼조)
    kospi60dVolatility: number;  // KOSPI 60일 변동성 (%)
    leadingSectorCount: number;  // 명확한 주도 섹터 수 (0이면 주도주 부재)
    foreignFlowDirection: 'CONSISTENT_BUY' | 'CONSISTENT_SELL' | 'ALTERNATING'; // 외국인 수급 방향
    correlationBreakdown: boolean; // 글로벌 상관관계 이탈 여부
  };
  systemAction: {
    mode: 'NORMAL' | 'DEFENSIVE' | 'CASH_HEAVY' | 'FULL_STOP' | 'PAIR_TRADE';
    cashRatio: number;           // 권장 현금 비중 (0-100%)
    gateAdjustment: {
      gate1Threshold: number;    // Gate 1 통과 기준 (기본 5)
      gate2Required: number;     // Gate 2 필요 조건 수 (기본 9)
      gate3Required: number;     // Gate 3 필요 조건 수 (기본 7)
    };
    message: string;             // 시스템 행동 설명
  };
}

/** 글로벌 상관관계 매트릭스 */
export interface GlobalCorrelationMatrix {
  kospiSp500: number;          // KOSPI-S&P500 상관계수 (-1~1)
  kospiNikkei: number;         // KOSPI-닛케이225
  kospiShanghai: number;       // KOSPI-상해종합
  kospiDxy: number;            // KOSPI-달러인덱스 (보통 음의 상관)
  isDecoupling: boolean;       // 디커플링 감지 (상관계수 급락)
  isGlobalSync: boolean;       // 글로벌 동조화 (상관계수 0.9+)
  lastUpdated: string;
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

// ─── 해외 뉴스 멀티소스 집계 (Global Multi-Source Intelligence) ───────────────

export interface GlobalMultiSourceData {
  fedWatch: {
    nextMeetingDate: string;
    holdProbability: number;     // %
    cutProbability: number;
    hikeProbability: number;
  };
  chinaPmi: {
    manufacturing: number;       // 50 기준
    services: number;
    trend: 'EXPANDING' | 'CONTRACTING' | 'FLAT';
  };
  tsmcRevenue: {
    monthlyRevenueTWD: number;   // 억 대만달러
    yoyGrowth: number;           // %
    trend: 'ACCELERATING' | 'STABLE' | 'DECELERATING';
    implication: string;         // 한국 반도체 섹터 시사점
  };
  bojPolicy: {
    currentRate: number;
    direction: 'HIKING' | 'HOLDING' | 'CUTTING';
    yenCarryRisk: 'HIGH' | 'MEDIUM' | 'LOW';
    implication: string;
  };
  usIsm: {
    manufacturing: number;       // 50 기준
    services: number;
    newOrders: number;
    trend: 'EXPANDING' | 'CONTRACTING' | 'FLAT';
  };
  fredData: {
    usCpi: number;               // % YoY
    usUnemployment: number;      // %
    usRetailSales: number;       // % MoM
  };
  lastUpdated: string;
}

// ─── 레이어 I: 공급망 물동량 인텔리전스 ─────────────────────────────────────────
export interface SupplyChainIntelligence {
  bdi: {
    current: number;
    mom3Change: number;       // 3개월 변화율 (%)
    trend: 'SURGING' | 'RISING' | 'FLAT' | 'FALLING' | 'COLLAPSING';
    sectorImplication: string;
  };
  semiBillings: {
    latestBillionUSD: number;
    yoyGrowth: number;        // %
    bookToBill: number;       // 1.0 이상 = 수요 > 공급
    implication: string;
  };
  gcfi: {
    shanghaiEurope: number;   // $/40ft
    transPacific: number;
    trend: 'RISING' | 'FLAT' | 'FALLING';
  };
  lastUpdated: string;
}

// ─── 레이어 J: 섹터별 글로벌 수주 인텔리전스 ────────────────────────────────────
export interface SectorOrderIntelligence {
  globalDefense: {
    natoGdpAvg: number;
    usDefenseBudget: number;  // 억달러
    trend: 'EXPANDING' | 'STABLE' | 'CUTTING';
    koreaExposure: string;
  };
  lngOrders: {
    newOrdersYTD: number;
    qatarEnergy: string;
    orderBookMonths: number;
    implication: string;
  };
  smrContracts: {
    usNrcApprovals: number;
    totalGwCapacity: number;
    koreaHyundai: string;
    timing: 'TOO_EARLY' | 'OPTIMAL' | 'LATE';
  };
  lastUpdated: string;
}

// ─── 레이어 K: 금융시스템 스트레스 인덱스 ────────────────────────────────────────
export interface FinancialStressIndex {
  tedSpread: {
    bps: number;
    alert: 'NORMAL' | 'ELEVATED' | 'CRISIS';
  };
  usHySpread: {
    bps: number;
    trend: 'TIGHTENING' | 'STABLE' | 'WIDENING';
  };
  moveIndex: {
    current: number;
    alert: 'NORMAL' | 'ELEVATED' | 'EXTREME';
  };
  compositeScore: number;     // 0~100, 높을수록 위험
  systemAction: 'NORMAL' | 'CAUTION' | 'DEFENSIVE' | 'CRISIS';
  lastUpdated: string;
}

// ─── 레이어 L: FOMC 문서 감성 분석 ──────────────────────────────────────────────
export interface FomcSentimentAnalysis {
  hawkDovishScore: number;    // -10(극비둘기) ~ +10(극매파)
  keyPhrases: string[];
  dotPlotShift: 'MORE_CUTS' | 'UNCHANGED' | 'FEWER_CUTS';
  kospiImpact: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  rationale: string;
  lastUpdated: string;
}

// ─── 실전 성과 관리 시스템 ──────────────────────────────────────────────────────

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
