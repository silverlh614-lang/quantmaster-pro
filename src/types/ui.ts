// @responsibility UI redesign P0-A 공유 타입 + REGIME_TRADING_POLICY SSOT (ADR-0018)

import type { RegimeLevel } from './core';

// ─── MarketModeBanner — 시장 모드 정책 박스 ─────────────────────────────────

/**
 * MarketModeBanner 가 한 박스에 표시하는 4축 + 정책 SSOT.
 * 데이터 소스: useGlobalIntelStore.macroEnv + computed gate0Result + bearRegimeResult.
 * 부재 시 banner 자체는 렌더되지 않음 (loading 상태는 호출자가 handle).
 */
export interface MarketModePolicy {
  /** 6단계 레짐 식별자 — REGIME_TRADING_POLICY 키와 일치 */
  regime: RegimeLevel;
  /** Macro Health Score 0~100 — gate0Result.macroHealthScore */
  mhs: number;
  /** VKOSPI 절대값 — macroEnv.vkospi */
  vkospi: number;
  /** 원/달러 환율 — macroEnv.usdKrw */
  usdKrw: number;
  /** 허용 전략 한국어 텍스트 (3~5개) */
  allowed: string[];
  /** 금지 전략 한국어 텍스트 (3~5개) */
  forbidden: string[];
  /** 한 줄 verdict 아이콘: 🟢 정상 / 🟡 주의 / 🔴 위험 */
  verdict: '🟢' | '🟡' | '🔴';
}

// ─── DataQualityBadge — 데이터 품질 카운트 ─────────────────────────────────

export type DataQualityTier = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * 27 조건 항목별 실제 데이터 출처 (ADR-0019 PR-B).
 * - COMPUTED: 클라이언트 OHLCV 직접 계산 (RSI/MACD/볼린저/일목/VCP …)
 * - API: DART/Naver/KIS proxy 응답 (ROE/PER/PBR/시총/외인비율 …)
 * - AI_INFERRED: Gemini 추론 (사이클/Risk-On/리더/정책/심리 …)
 *
 * `StockRecommendation.conditionSourceTiers?: Partial<Record<ChecklistKey, ConditionSourceTier>>`
 * 로 첨부되어 `classifyDataQuality` 가 메타 우선 분기를 사용한다.
 */
export type ConditionSourceTier = 'COMPUTED' | 'API' | 'AI_INFERRED';

/**
 * DataQualityBadge 가 종목 카드에 노출하는 3분류 카운트.
 * - PR-A: sourceMetaAvailable=false → 클라이언트 휴리스틱 fallback (handoff.md §휴리스틱).
 * - PR-B: 서버 enrichment 응답에 sourceTier 메타가 들어오면 정확도 격상.
 *
 * tier 산출:
 *   HIGH:   computed/total ≥ 0.6
 *   MEDIUM: computed/total ≥ 0.3
 *   LOW:    그 외
 */
export interface DataQualityCount {
  /** 🟢 실계산 — RSI/MACD/볼린저/일목/VCP 같이 클라이언트가 OHLCV 로 직접 계산한 항목 수 */
  computed: number;
  /** 🟡 API — DART/Naver/KIS proxy 가 반환한 객관 수치 (ROE/PER/PBR/시총/외인비율) */
  api: number;
  /** 🔴 AI추정 — Gemini 가 추론·요약·생성한 항목 (theme/sectorAnalysis/strategicInsight) */
  aiInferred: number;
  /** computed + api + aiInferred. 표시 용도. */
  total: number;
  /** 데이터 품질 종합 등급 */
  tier: DataQualityTier;
  /** 서버 sourceTier 메타가 들어왔는지 — false 면 fallback 휴리스틱 사용 표기 (작은 회색 ?) */
  sourceMetaAvailable: boolean;
}

// ─── GateStatusCard — 압축 Gate 통과 표 ─────────────────────────────────

export type GateVerdict = 'PASS' | 'FAIL';
export type OverallVerdict = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'CAUTION' | 'AVOID';

export interface GateLineSummary {
  /** 통과한 조건 수 */
  passed: number;
  /** 통과 필요 조건 수 (REGIME_GATE_THRESHOLDS 또는 기본값) */
  required: number;
  /** 해당 게이트의 PASS/FAIL */
  verdict: GateVerdict;
}

/**
 * WatchlistCard 안에 임베드되는 Gate 0/1/2/3 압축 요약.
 * GateStatusWidget 의 expandable 풀 디테일과 별개의 read-only 카드 컴포넌트로 운영.
 */
export interface GateCardSummary {
  /** Gate 0 — 시장 환경 (단일 boolean) */
  gate0Passed: boolean;
  gate1: GateLineSummary;
  gate2: GateLineSummary;
  gate3: GateLineSummary;
  /** STRONG_BUY=4 PASS / BUY=3 PASS / HOLD=2 PASS / CAUTION=1 PASS / AVOID=0 PASS */
  overallVerdict: OverallVerdict;
}

// ─── REGIME_TRADING_POLICY — RegimeLevel → 허용·금지 전략 매핑 SSOT ──────────

interface RegimePolicyEntry {
  allowed: string[];
  forbidden: string[];
  verdict: '🟢' | '🟡' | '🔴';
  /** 운영자 시각 한국어 한 줄 요약 (배너 부제) */
  headline: string;
}

/**
 * 사용자 원안 (R1~R6 별 "주도주 추세추종 / 분할매수 가능" 류 표현) 차용 +
 * REGIME_GATE_THRESHOLDS / GATE_SCORE_THRESHOLD_BY_REGIME 의 의미와 정렬.
 */
export const REGIME_TRADING_POLICY: Record<RegimeLevel, RegimePolicyEntry> = {
  R1_TURBO: {
    headline: '최적 상승 사이클 — 공격 모드 MAX',
    verdict: '🟢',
    allowed: ['주도주 추세추종', '분할매수 가능', '신고가 돌파 매수', '섹터 1등주 집중'],
    forbidden: ['소외주 저가매수', '과열 추격매수', '잡주 단타'],
  },
  R2_BULL: {
    headline: '상승 추세 확인 — 적극 매수',
    verdict: '🟢',
    allowed: ['주도주 추세추종', '분할매수', '돌파 매매'],
    forbidden: ['소외주 저가매수', '과열 추격매수', '단기 역추세'],
  },
  R3_EARLY: {
    headline: '상승 초기 선행 신호 — 소규모 선취매',
    verdict: '🟢',
    allowed: ['선행 매수', '주도주 발굴', '소규모 분할 진입'],
    forbidden: ['풀 포지션 매수', '과열주 추격', '레버리지 사용'],
  },
  R4_NEUTRAL: {
    headline: '중립 횡보 — 선택적 진입',
    verdict: '🟡',
    allowed: ['STRONG_BUY 만 진입', 'RRR ≥ 3 종목 우선', '현금 비중 유지'],
    forbidden: ['추격 매수', '대량 분할', '소외주 저가매수'],
  },
  R5_CAUTION: {
    headline: '약세 징조 — 방어 우선',
    verdict: '🟡',
    allowed: ['보유 종목 손절선 점검', '수익 종목 부분 익절', '현금 확대'],
    forbidden: ['신규 매수', '물타기', '추격 매매'],
  },
  R6_DEFENSE: {
    headline: '하락/블랙스완 — 매수 차단',
    verdict: '🔴',
    allowed: ['전량 매도 또는 현금화', '인버스 ETF 검토', '관망'],
    forbidden: ['신규 매수 전면 금지', '저점 매수', '레버리지 진입'],
  },
};

/** RegimeLevel 미상 시 안전 fallback. */
export const REGIME_TRADING_POLICY_FALLBACK: RegimePolicyEntry = {
  headline: '레짐 데이터 없음 — 데이터 적재 대기',
  verdict: '🟡',
  allowed: ['데이터 수신 후 판단'],
  forbidden: ['신규 매수 보류'],
};
