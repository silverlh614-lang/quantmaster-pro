/**
 * @responsibility Market Rally Lens read-model 타입 + Recommendation Score SSOT — 주문 생성 금지, executionImpact 항상 NONE.
 *
 * ADR-0549: 자동매매 트리(signalScanner/gates/buyPipeline)와 물리적으로 분리된 추천/관측 전용 타입 SSOT.
 * GateScore(server/trading/gates/* + ScoreBreakdown)와 별도 타입·별도 척도. RecommendationScore 는
 * GateScore 로 절대 역류하지 않는다. 모든 산출물 recommendationOnly:true · executionImpact:'NONE' 리터럴 고정.
 */

// ─── 1. MarketRallyLens (PR-1) ──────────────────────────────────────────────

export type MarketRallyReason =
  | 'KOSPI_RALLY_1_5'              // 조건1: KOSPI 당일 +1.5%↑
  | 'KOSPI_RALLY_2_0_INSTITUTION' // 조건2: +2.0% + 기관 순매수 (PR-1 degrade: 입력 부재 시 미활성)
  | 'KOSPI_RALLY_2_5'             // 조건3: +2.5% 강세 확정 (PR-1 degrade)
  | 'FOREIGN_5D_ACCUMULATION'     // 조건4: 외국인 5일 순매수 강세
  | 'KOSPI_STRONG_KOSDAQ_WEAK'    // 조건5: 코스피 강세 + 코스닥 약세 (PR-1 degrade: kosdaqDayReturn 부재)
  | 'KOSPI_20D_UPTREND_DAY_REBOUND' // 조건6: 20일 추세 상승 + 당일 반등
  | 'MARKET_BREADTH_ADVANCE'      // 조건7: 상승종목 우위 (PR-1 제외 — breadth 데이터 없음)
  | 'FEATURE_DISABLED'            // ENV OFF
  | 'RALLY_INPUT_NOT_AVAILABLE'   // 입력 필드 부재로 평가 불가
  | 'RALLY_UNKNOWN_PROVIDER_ISSUE'// 불변식#6: providerIssue/UNKNOWN → bullish 변환 금지
  | 'NO_RALLY';                   // 조건 미충족 (정상)

export interface RallyInvestorFlow {
  /** 외국인 5일 누적 순매수 (억원, MacroState.foreignNetBuy5d). null=미확보. */
  foreignNetBuy5d: number | null;
  /** 시장 프로그램/기관 순매수 근사 (억원, MacroState.programNetBuyAmount). null=미확보. */
  marketInstitutionNetBuyApprox: number | null;
  /** 'BULLISH'|'NEUTRAL'|'UNKNOWN' — UNKNOWN 은 절대 bullish/bearish 로 변환 안 함 (불변식#6). */
  label: 'BULLISH' | 'NEUTRAL' | 'UNKNOWN';
}

export interface MarketRallyLens {
  /** 활성 여부. ENV OFF/입력부재/providerIssue 시 항상 false. */
  enabled: boolean;
  /** 활성/비활성 사유 (최초 매칭 조건). */
  reason: MarketRallyReason;
  /** KOSPI 당일 수익률 % (read-only carry, 없으면 null). */
  kospiReturnPct: number | null;
  /** KOSDAQ 당일 수익률 % (PR-1 미수집 시 null). */
  kosdaqReturnPct: number | null;
  /** 시장 breadth 점수 (PR-1 미수집 시 null). */
  marketBreadth: number | null;
  /** 투자자 흐름 요약 (외국인/기관, 시장-레벨). UNKNOWN 가능. */
  investorFlow: RallyInvestorFlow;
  /** 항상 'NONE' — 타입 리터럴 고정 (RALLY_EXECUTION_IMPACT_NONE). */
  executionImpact: 'NONE';
  /** 항상 true — 타입 리터럴 고정 (MARKET_RALLY_LENS_RECOMMENDATION_ONLY). */
  recommendationOnly: true;
  /** scan 과 공유하는 동일 snapshotId (불변식 #3 정합 추적). */
  snapshotId?: string;
  /** 평가 시각 (ISO). */
  asOf: string;
}

/**
 * ENV OFF 시 buildMarketRallyLens 가 반환하는 비활성 기준값 생성기.
 * asOf 만 호출 시점으로 채우고 나머지는 모두 비활성 리터럴. (불변식 #6 — UNKNOWN 비변환)
 */
export function buildDisabledRallyLens(asOf: string): MarketRallyLens {
  return {
    enabled: false,
    reason: 'FEATURE_DISABLED',
    kospiReturnPct: null,
    kosdaqReturnPct: null,
    marketBreadth: null,
    investorFlow: { foreignNetBuy5d: null, marketInstitutionNetBuyApprox: null, label: 'UNKNOWN' },
    executionImpact: 'NONE',
    recommendationOnly: true,
    asOf,
  };
}

/** ENV OFF 정적 상수 (asOf 는 epoch — 호출 시점 표기는 buildDisabledRallyLens 사용). */
export const DISABLED_RALLY_LENS: MarketRallyLens = buildDisabledRallyLens('1970-01-01T00:00:00.000Z');

// ─── 2. RecommendationLabel union (PR-2 가 score 계산을 채움; 타입은 PR-1 SSOT) ──

export type RecommendationLabel =
  | 'MARKET_RALLY_WATCH'
  | 'KOSPI_RALLY_PARTICIPATION'
  | 'INSTITUTION_LED_WATCH'
  | 'INDEX_SYNC_WATCH'
  | 'RALLY_ACCUMULATING'
  | 'RALLY_PRE_BREAKOUT'
  | 'LARGE_CAP_REBOUND_WATCH'
  | 'KOSPI_STRONG_KOSDAQ_WEAK'
  | 'WATCH_NOT_BUY'   // 운영자 오인 차단 — 매수 신호 아님 명시
  | 'SEARCH_ONLY';    // 검색/관측 전용

// ─── 3. RecommendationScore breakdown (PR-2 가 계산을 채움; 타입은 PR-1 SSOT) ──

export type RecommendationTier =
  | 'STRONG_WATCH'   // 80~100
  | 'WATCH'          // 60~79
  | 'SOFT_WATCH'     // 40~59
  | 'OBSERVE'        // 20~39
  | 'LOW_PRIORITY';  // 0~19

export interface RecommendationScoreBreakdown {
  // ── 9 가산 항목 (사용자 명시) ──
  kospiRallyAlignment: number;     // 지수 급등 동조도
  institutionInflow: number;       // 기관 순매수 동조
  foreignInflow: number;           // 외국인 순매수 동조
  indexSyncStrength: number;       // 지수-종목 동기화 강도
  accumulationPattern: number;     // 매집 패턴
  preBreakoutProximity: number;    // 돌파 근접도
  largeCapRebound: number;         // 대형주 반등
  relativeStrength: number;        // 상대강도(RS)
  volumeExpansion: number;         // 거래량 확대
  // ── 2 감산 항목 ──
  staleDataPenalty: number;        // 데이터 신선도 결손 감산 (음수)
  providerUncertaintyPenalty: number; // providerIssue/UNKNOWN 감산 (음수, 불변식#6 — bearish 변환 아님)
}

export interface RecommendationScore {
  /** 0~100 합산 (clamp). GateScore 와 무관·역류 금지. */
  total: number;
  tier: RecommendationTier;
  breakdown: RecommendationScoreBreakdown;
  /** 항상 'NONE'. */
  executionImpact: 'NONE';
}

export interface RecommendationCandidate {
  symbol: string;
  name?: string;
  /** scan 과 동일 snapshotId (불변식#3). */
  snapshotId?: string;
  label: RecommendationLabel;
  score: RecommendationScore;
  /** 항상 true. */
  recommendationOnly: true;
  // 주문 관련 필드 절대 미포함 (orderId/paperExecutable/shadowBuy 금지).
}

// ─── 4. Gate1 Lane Split (PR-2) — read-only lane 분류 (재계산 0, 자동매매 무영향) ──
// LIVE_HARD_PASS_BYTE_IDENTICAL: liveHardPass === (gate1Passed && minSignalScorePassed) 미러.
// gate1DryRunObservationLedgerAdr0476.ts:500 의 hardPass 와 동일 boolean 식 — 재계산/임계 재정의 금지.

export type Gate1LaneLabel =
  | 'LIVE_HARD_PASS'              // 기존 Gate1 hardPass 미러 (재계산 0, byte-identical)
  | 'SEARCH_RECOMMENDATION_PASS' // 검색/추천 lane (finalScore degrade-safe OR)
  | 'INDEX_RALLY_WATCH_PASS'     // 지수 급등 관측 lane (rallyLens.enabled 게이트)
  | 'NO_LANE';                   // 어느 lane 도 미해당

export interface Gate1SymbolLaneResult {
  symbol: string;
  /** Gate1 평가 점수 read-only (= CandidateSnapshot.gateScore). 부재 시 null. */
  finalScore: number | null;
  /** live 70 read-only (minSignalRequiredScore ?? LEGACY_GATE1_REQUIRED_SCORE). */
  requiredScore: number;
  /** finalScore - requiredScore. finalScore 부재 시 null. */
  scoreGap: number | null;
  /** = (gate1Passed === true && minSignalScorePassed === true). 미러식, 재계산 금지. */
  liveHardPass: boolean;
  searchRecommendationPass: boolean;
  indexRallyWatchPass: boolean;
  laneLabels: Gate1LaneLabel[];
  /** 입력 부재/비변환 사유 라벨 (불변식#6 — bullish/bearish 비변환). */
  degradeReasons: string[];
}

export interface Gate1LaneResult {
  /** ENV OFF / rallyLens.enabled=false 시 false (lane 전부 비활성/undefined 효과). */
  enabled: boolean;
  symbols: Gate1SymbolLaneResult[];
  liveHardPassCount: number;
  searchRecommendationPassCount: number;
  indexRallyWatchPassCount: number;
  /** 항상 false — 리터럴 고정 (lane 은 매수 신호 아님). */
  buySignal: false;
  /** 항상 'NONE' — 리터럴 고정. */
  executionImpact: 'NONE';
  /** 항상 true — 리터럴 고정. */
  recommendationOnly: true;
  /** scan 과 동일 snapshotId (불변식#3). */
  snapshotId?: string;
  asOf: string;
}
