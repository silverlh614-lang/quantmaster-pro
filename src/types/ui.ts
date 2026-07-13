// @responsibility UI redesign P0-A 공유 타입 + REGIME_TRADING_POLICY SSOT (ADR-0028)

import type { RegimeLevel } from './core';

// ─── MarketModeBanner — 시장 모드 정책 박스 ─────────────────────────────────
// ─── DataQualityBadge — 데이터 품질 카운트 ─────────────────────────────────

export type DataQualityTier = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * 27 조건 항목별 실제 데이터 출처 (ADR-0029 PR-B + ADR-0095 PR-Phase-A-2).
 *
 * **3-tier (PR-A 기존, 후방호환 유지)**:
 * - COMPUTED: 클라이언트 OHLCV 직접 계산 (RSI/MACD/볼린저/일목/VCP …) — UI_LANG.tier.VERIFIED
 * - API: DART/Naver/KIS proxy 응답 (ROE/PER/PBR/시총/외인비율 …) — UI_LANG.tier.EXTERNAL
 * - AI_INFERRED: Gemini 추론 (사이클/Risk-On/리더/정책/심리 …) — UI_LANG.tier.ESTIMATED
 *
 * **5-tier 확장 (PR-Phase-A-2 신규, 옵셔널)**:
 * - DELAYED: 시장 외 시간 / stale 캐시 데이터 — UI_LANG.tier.DELAYED
 * - MANUAL: 사용자 직접 입력 (TradeRecordModal 등) — UI_LANG.tier.MANUAL
 *
 * `StockRecommendation.conditionSourceTiers?: Partial<Record<ChecklistKey, ConditionSourceTier>>`
 * 로 첨부되어 `classifyDataQuality` 가 메타 우선 분기를 사용한다. 메타가 5-tier 값을 포함하면
 * 자동으로 더 정확한 분류로 격상 (사용자 #3 아이디어 — 자동 사다리).
 */
export type ConditionSourceTier = 'COMPUTED' | 'API' | 'AI_INFERRED' | 'DELAYED' | 'MANUAL';

// ─── PriceAlertWatcher (ADR-0030 PR-C) ─────────────────────────────────────

/**
 * 손절·익절 알림 4단계 레벨.
 * - NORMAL: 계획 범위 내
 * - CAUTION: 손절가까지 cautionPctToStop (기본 3 %) 이내
 * - DANGER: 손절가 도달 (currentPrice ≤ stopLoss)
 * - TAKE_PROFIT: 1차 목표가 도달 (currentPrice ≥ targetPrice)
 *
 * 우선순위: TAKE_PROFIT > DANGER > CAUTION > NORMAL.
 */
export type PriceAlertLevel = 'NORMAL' | 'CAUTION' | 'DANGER' | 'TAKE_PROFIT';

// ─── PR-D (ADR-0031) — Last Trigger / Enemy Checklist ─────────────────────

type TriggerCheckId =
  | 'VCP_BREAKOUT'
  | 'VOLUME_SURGE'
  | 'VKOSPI_STABLE'
  | 'POSITIVE_DISCLOSURE';

type TriggerCheckStatus = 'TRIGGERED' | 'PENDING';

export interface LastTriggerCheck {
  id: TriggerCheckId;
  label: string;
  status: TriggerCheckStatus;
  detail?: string;
}

export interface LastTriggerSummary {
  checks: LastTriggerCheck[];
  triggeredCount: number;
  totalChecks: number;
  /** 4/4 → EXECUTE / 1~3 → WATCHLIST / 0 → INACTIVE */
  verdict: 'EXECUTE' | 'WATCHLIST' | 'INACTIVE';
}

type EnemyFlagId = 'SHORT_INCREASING' | 'MARGIN_OVERHEAT' | 'WEEKLY_RSI_OVERHEAT';

type EnemyFlagStatus = 'WARNING' | 'CLEAR';

export interface EnemyChecklistFlag {
  id: EnemyFlagId;
  label: string;
  status: EnemyFlagStatus;
  detail?: string;
}

export interface EnemyChecklistSummary {
  flags: EnemyChecklistFlag[];
  warningCount: number;
  /** ≥2 WARNING → BLOCK / 1 → CAUTION / 0 → CLEAR */
  verdict: 'CLEAR' | 'CAUTION' | 'BLOCK';
}

/**
 * DataQualityBadge 가 종목 카드에 노출하는 분류 카운트.
 *
 * **3-tier (PR-A 기존, 후방호환 의무)**:
 * - PR-A: sourceMetaAvailable=false → 클라이언트 휴리스틱 fallback (handoff.md §휴리스틱).
 * - PR-B: 서버 enrichment 응답에 sourceTier 메타가 들어오면 정확도 격상.
 *
 * **5-tier 확장 (PR-Phase-A-2 ADR-0095, 옵셔널)**:
 * - delayed?: 시장 외 시간 / stale 캐시 카운트 — dataSourceType === 'STALE' 또는 메타 'DELAYED'
 * - manual?: 사용자 수동 입력 카운트 — 메타 'MANUAL'
 *
 * 옵셔널 필드라 기존 호출자 무수정 (delayed/manual 미정의 시 기존 동작). 사용자 #3 아이디어
 * (자동 사다리) — 휴리스틱 모드는 STALE 만 자동 분류, 메타 모드는 5-tier 정확 분류.
 *
 * tier 산출 (변경 없음 — 후방호환):
 *   HIGH:   computed/total ≥ 0.6
 *   MEDIUM: computed/total ≥ 0.3
 *   LOW:    그 외
 *
 * 향후 5-tier 종합 등급 산출은 후속 PR (DataQualityRibbon 등) 에서 별도 도입.
 */
export interface DataQualityCount {
  /** 🟢 실계산 — RSI/MACD/볼린저/일목/VCP 같이 클라이언트가 OHLCV 로 직접 계산한 항목 수 (UI_LANG.tier.VERIFIED) */
  computed: number;
  /** 🟡 API — DART/Naver/KIS proxy 가 반환한 객관 수치 (UI_LANG.tier.EXTERNAL) */
  api: number;
  /** 🔴 AI추정 — Gemini 가 추론·요약·생성한 항목 (UI_LANG.tier.ESTIMATED) */
  aiInferred: number;
  /** ⏳ 지연 — 시장 외 시간 / stale 캐시 (PR-Phase-A-2 신규, UI_LANG.tier.DELAYED). 옵셔널 */
  delayed?: number;
  /** ✏️ 수동 — 사용자 직접 입력 (PR-Phase-A-2 신규, UI_LANG.tier.MANUAL). 옵셔널 */
  manual?: number;
  /** computed + api + aiInferred + delayed + manual. 표시 용도. */
  total: number;
  /** 데이터 품질 종합 등급 (현재 computed/total 비율 기반 — 5-tier 산출은 후속 PR) */
  tier: DataQualityTier;
  /** 서버 sourceTier 메타가 들어왔는지 — false 면 fallback 휴리스틱 사용 표기 (작은 회색 ?) */
  sourceMetaAvailable: boolean;
}

// ─── GateStatusCard — 압축 Gate 통과 표 ─────────────────────────────────

type GateVerdict = 'PASS' | 'FAIL';
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
    headline: '하락/블랙스완 — 저노출 보정',
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
