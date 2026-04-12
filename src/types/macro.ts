// ─── 거시 환경 · ECOS · FX · Rate · 수급 도메인 타입 ─────────────────────────

// ─── Gate 0 보조: 금리 사이클 · FX 레짐 ─────────────────────────────────────

export type RateCycle = 'TIGHTENING' | 'EASING' | 'PAUSE';
export type FXRegime = 'DOLLAR_STRONG' | 'DOLLAR_WEAK' | 'NEUTRAL';

// ─── Gate 0: 거시 환경 입력 ──────────────────────────────────────────────────

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
  // ─── VKOSPI 파생 (클라이언트 전송 → 서버 MacroState 동기화) ─────────────
  vkospiDayChange?: number;          // VKOSPI 당일 변화율 (%)
  vkospi5dTrend?: number;            // VKOSPI 5일 추세 변화율 (%)
  // ─── Gate -1 Bear Regime Detector 보조 지표 (optional) ───────────────────
  kospiBelow120ma?: boolean;         // KOSPI 120일 이동평균선 하회 여부
  kospiIchimokuBearish?: boolean;    // KOSPI 일목 구름 아래 (하락 추세) 여부
  vkospiRising?: boolean;            // VKOSPI 상승 중 여부 (추세)
  samsungIriDelta?: number;          // 삼성 IRI 변화량 (pt, 양수=위험 증가)
  foreignFuturesSellDays?: number;   // 외국인 선물 연속 순매도 일수
  mhsTrend?: 'IMPROVING' | 'STABLE' | 'DETERIORATING'; // MHS 추세 방향
  dxyBullish?: boolean;              // 달러인덱스(DXY) 강세 전환 여부 (Inverse Gate 1용)
}

// ─── 닛케이 5분봉 선행 지수화 (Nikkei → KOSPI) ─────────────────────────────────

/** 닛케이 섹터 5분봉 변화율 입력 */
export interface NikkeiSectorStrength {
  sector: string;
  changePct: number;
}

/** 닛케이↔KOSPI 섹터 상관 계수 테이블 항목 */
export interface NikkeiKospiSectorCorrelation {
  nikkeiSector: string;
  kospiSector: string;
  correlation: number; // 0~1
  beta: number;        // 이론 프리미엄 배율
}

/** 닛케이 선행 알파 엔진 입력 */
export interface NikkeiLeadAlphaInput {
  nikkeiSectorStrengths: NikkeiSectorStrength[];
  collectedAt?: string; // Gemini 수집 시각 (기본: now)
}

/** KOSPI 섹터별 이론 GAP 산출 결과 */
export interface NikkeiLeadGapResult {
  nikkeiSector: string;
  kospiSector: string;
  nikkeiChangePct: number;
  theoreticalGapPct: number;
  correlation: number;
  beta: number;
}

/** 09:00 개장 전 브리핑 결과 */
export interface NikkeiLeadAlphaResult {
  collectionTimeKst: string; // 기본 08:30
  alertTimeKst: string;      // 기본 09:00
  collectedAt: string;
  predictiveConfidencePct: number;
  alertLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
  gapResults: NikkeiLeadGapResult[];
  unmatchedNikkeiSectors: string[];
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

// ─── 글로벌 상관관계 매트릭스 ────────────────────────────────────────────────

export interface GlobalCorrelationMatrix {
  kospiSp500: number;          // KOSPI-S&P500 상관계수 (-1~1)
  kospiNikkei: number;         // KOSPI-닛케이225
  kospiShanghai: number;       // KOSPI-상해종합
  kospiDxy: number;            // KOSPI-달러인덱스 (보통 음의 상관)
  isDecoupling: boolean;       // 디커플링 감지 (상관계수 급락)
  isGlobalSync: boolean;       // 글로벌 동조화 (상관계수 0.9+)
  lastUpdated: string;
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

// ─── 아이디어 4: FSS 외국인 수급 방향 전환 스코어 ─────────────────────────────────

/** 외국인 일별 수급 기록 (Passive/Active 분류) */
export interface ForeignSupplyDayRecord {
  /** 날짜 (YYYY-MM-DD) */
  date: string;
  /** Passive(인덱스 펀드) 순매수 (양수=매수, 음수=매도) — 금액(억원) 또는 주수 */
  passiveNetBuy: number;
  /** Active(액티브 펀드) 순매수 (양수=매수, 음수=매도) */
  activeNetBuy: number;
}

/** FSS 일별 점수 (당일 수급 분류 결과) */
export interface FssDailyScore {
  date: string;
  /** 당일 점수: -3(동반 순매도) / -1(편방 순매도) / 0(혼합) / +1(편방 순매수) / +3(동반 순매수) */
  score: number;
  /** 분류 레이블 */
  label: 'BOTH_SELL' | 'PARTIAL_SELL' | 'MIXED' | 'PARTIAL_BUY' | 'BOTH_BUY';
  passiveNetBuy: number;
  activeNetBuy: number;
}

/** FSS 경보 단계 */
export type FssAlertLevel = 'NORMAL' | 'CAUTION' | 'HIGH_ALERT';

/** FSS (Foreign Supply Shift Score) 전체 결과 */
export interface FssResult {
  /** 5일 누적 FSS 점수 (범위: -15 ~ +15) */
  cumulativeScore: number;
  /** 경보 단계: NORMAL(> -3) / CAUTION(-5 < score ≤ -3) / HIGH_ALERT(≤ -5) */
  alertLevel: FssAlertLevel;
  /** 최근 5거래일 일별 점수 내역 */
  dailyScores: FssDailyScore[];
  /** 동반 순매도 연속 일수 (현재 스트릭) */
  consecutiveBothSellDays: number;
  /** 행동 권고 메시지 */
  actionMessage: string;
  /** HIGH_ALERT 시 수급 이탈 방어 모드 권고 */
  supplyExitDefenseRecommended: boolean;
  lastUpdated: string;
}

// ─── 시장 레짐 자동 분류기 (Market Regime Classifier) ────────────────────────────

/**
 * 4개 변수 기반 시장 레짐 4단계 분류.
 *
 * RISK_ON_BULL     — Gate 2 완화(9→8/12), 공격적 포지션 허용
 * RISK_ON_EARLY    — 표준 기준 유지, 주도주 초기 신호 포착
 * RISK_OFF_CORRECTION — Gate 1 강화, 포지션 50% 제한
 * RISK_OFF_CRISIS  — Gate 1 3개 이상 미충족 시 신규 매수 전면 중단, 현금 70%+
 */
export type MarketRegimeClassification =
  | 'RISK_ON_BULL'
  | 'RISK_ON_EARLY'
  | 'RISK_OFF_CORRECTION'
  | 'RISK_OFF_CRISIS';

/** evaluateMarketRegimeClassifier()의 입력 — 4개 핵심 변수 */
export interface MarketRegimeClassifierInput {
  /** VKOSPI 현재값 (한국 공포지수) */
  vkospi: number;
  /** 외국인 순매수 4주 누적 (억원, 양수=순매수, 음수=순매도) */
  foreignNetBuy4wTrend: number;
  /** KOSPI 200일 이동평균선 위 여부 */
  kospiAbove200MA: boolean;
  /** 달러 인덱스 5일 방향 */
  dxyDirection: 'UP' | 'DOWN' | 'FLAT';
}

/** 시장 레짐 자동 분류기 평가 결과 */
export interface MarketRegimeClassifierResult {
  /** 분류된 레짐 */
  classification: MarketRegimeClassification;

  /**
   * Gate 2 통과 기준 오버라이드 (12개 기준).
   * null이면 기존 기준 유지.
   * RISK_ON_BULL: 8 (9→8 완화)
   */
  gate2RequiredOverride: number | null;

  /** Gate 1 강화 여부 (RISK_OFF_CORRECTION 이상) */
  gate1Strengthened: boolean;

  /**
   * 포지션 사이즈 허용 한도 (0~100%).
   * 100 = 제한 없음, 50 = 50% 제한.
   */
  positionSizeLimitPct: number;

  /** 신규 매수 전면 중단 여부 */
  buyingHalted: boolean;

  /**
   * 현금 비중 최소 유지 비율 (0~100%).
   * 0 = 무제한, 70 = 70% 이상 현금 유지.
   */
  cashRatioMinPct: number;

  /** Gate 1 위반 최소 개수 기준 (RISK_OFF_CRISIS에서 3개 이상) */
  gate1BreachThreshold: number;

  /** 평가에 사용된 입력값 (투명성/로깅용) */
  inputs: MarketRegimeClassifierInput;

  /** 레짐 설명 메시지 */
  description: string;

  /** 운용 지침 메시지 */
  actionMessage: string;

  lastUpdated: string;
}
