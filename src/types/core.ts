// ─── 핵심 도메인 타입 — ConditionId · Gate · MarketRegime · EvaluationResult ──

import type {
  RateCycle, FXRegime,
  SmartMoneyData, ExportMomentumData, GeopoliticalRiskData, CreditSpreadData,
} from './macro';
import type {
  MomentumAcceleration, TMAResult, MAPCResult, SRRResult,
} from './technical';

// ─── 체크리스트 키 ↔ 조건 ID 양방향 매핑 ──────────────────────────────────────

export type ConditionId = number;

/** 27개 마스터 체크리스트 항목의 키 유니온 타입 */
export type ChecklistKey =
  | 'cycleVerified' | 'roeType3' | 'riskOnEnvironment' | 'mechanicalStop' | 'notPreviousLeader'
  | 'supplyInflow' | 'ichimokuBreakout' | 'economicMoatVerified' | 'technicalGoldenCross'
  | 'volumeSurgeVerified' | 'institutionalBuying' | 'consensusTarget' | 'earningsSurprise'
  | 'performanceReality' | 'policyAlignment' | 'ocfQuality' | 'relativeStrength'
  | 'momentumRanking' | 'psychologicalObjectivity' | 'turtleBreakout' | 'fibonacciLevel'
  | 'elliottWaveVerified' | 'marginAcceleration' | 'interestCoverage' | 'vcpPattern'
  | 'divergenceCheck' | 'catalystAnalysis';

/** 체크리스트 키 → ConditionId 매핑 (단일 진실 공급원) */
export const CHECKLIST_KEY_TO_CONDITION_ID: Readonly<Record<ChecklistKey, ConditionId>> = {
  cycleVerified: 1, roeType3: 3, riskOnEnvironment: 5, mechanicalStop: 7, notPreviousLeader: 9,
  supplyInflow: 4, ichimokuBreakout: 6, economicMoatVerified: 8, technicalGoldenCross: 10,
  volumeSurgeVerified: 11, institutionalBuying: 12, consensusTarget: 13, earningsSurprise: 14,
  performanceReality: 15, policyAlignment: 16, ocfQuality: 17, relativeStrength: 18,
  momentumRanking: 2, psychologicalObjectivity: 19, turtleBreakout: 20, fibonacciLevel: 21,
  elliottWaveVerified: 22, marginAcceleration: 23, interestCoverage: 24, vcpPattern: 25,
  divergenceCheck: 26, catalystAnalysis: 27,
} as const;

/** ConditionId → 체크리스트 키 역방향 매핑
 *  참고: 런타임에서 Object.fromEntries는 문자열 키를 생성하지만,
 *  TypeScript의 Record<number, V> 색인은 암묵적으로 숫자↔문자열 변환을 처리합니다.
 */
export const CONDITION_ID_TO_CHECKLIST_KEY: Readonly<Record<ConditionId, ChecklistKey>> = Object.fromEntries(
  (Object.entries(CHECKLIST_KEY_TO_CONDITION_ID) as [ChecklistKey, ConditionId][]).map(([k, v]) => [v, k])
) as Readonly<Record<ConditionId, ChecklistKey>>;

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

// ─── Gate 0 평가 결과 ────────────────────────────────────────────────────────

/** Gate 0 평가 결과 */
export interface Gate0Result {
  passed: boolean;
  macroHealthScore: number;    // MHS 0-100
  mhsLevel: 'HIGH' | 'MEDIUM' | 'LOW'; // HIGH ≥70 / MEDIUM 40-69 / LOW <40
  kellyReduction: number;      // MAPC 포지션 축소율: 1 − (MHS/100). MHS<40 → 1.0(매수중단), MHS=50 → 0.5, MHS=100 → 0.0
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

// ─── 경기 사이클 레짐 분류기 ──────────────────────────────────────────────────

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

// ─── IDEA 3: ROE 유형 전이 감지기 ────────────────────────────────────────────

/** ROE 유형 전이 감지 결과 */
export interface ROETransitionResult {
  detected: boolean;
  /** 감지에 사용된 최근 N분기 이력 */
  pattern: ROEType[];
  /** 전이 유형 */
  transitionType: 'TYPE3_TO_4' | 'ASSET_TURNOVER_DROP' | 'BOTH' | 'NONE';
  /** 연속 Type 4 분기 수 */
  consecutiveType4Count: number;
  /** 총자산회전율 QoQ 하락률 (%), 양수 = 하락 */
  assetTurnoverDropPct: number;
  /** NONE=정상 / WATCH=1분기 Type4 감지 / PENALTY=Gate1 자동 패널티 */
  alert: 'NONE' | 'WATCH' | 'PENALTY';
  penaltyApplied: boolean;
  actionMessage: string;
}

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

// ─── 종목 프로파일 ────────────────────────────────────────────────────────────

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

/** 아이디어 11: 역발상 카운터사이클 알고리즘 */
export interface ContrarianSignal {
  id: string;
  name: string;
  active: boolean;
  bonus: number;       // 발동 시 Gate 3 점수 가산
  description: string;
}

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

// ─── 최종 평가 결과 ──────────────────────────────────────────────────────────

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
  tma?: TMAResult;
  srr?: SRRResult;
  mapc?: MAPCResult;
  roeTransition?: ROETransitionResult;
  enemyChecklistEnhanced?: EnemyChecklistEnhanced;
  dataReliability?: DataReliability;
  signalVerdict?: SignalVerdict;
  conditionScores?: Record<ConditionId, number>; // 27조건 점수 스냅샷 (귀인 분석용)
  conditionSources?: Record<ConditionId, 'COMPUTED' | 'AI'>; // 조건별 데이터 출처 (실계산 vs AI추정)
}

// ─── 기타 핵심 타입 ────────────────────────────────────────────────────────────

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
