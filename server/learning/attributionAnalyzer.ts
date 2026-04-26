// @responsibility attributionAnalyzer 학습 엔진 모듈
/**
 * attributionAnalyzer.ts — 고도화된 귀인 분석 엔진
 *
 * ServerAttributionRecord 배열을 받아 27개 조건별로 완전 분석:
 *  - 기본 지표: winRate, avgReturn, Sharpe
 *  - 레짐별 성과: R1_TURBO ~ R6_DEFENSE
 *  - 시간 추이: 최근 30일 vs 이전 30일 WIN률 비교
 *  - 상호작용 효과: 함께 높을 때 시너지/저하 조건 탐색
 *  - 권고: INCREASE_WEIGHT / MAINTAIN / DECREASE_WEIGHT / SUSPEND
 *
 * signalCalibrator.ts 가 이 결과를 읽어 서버 condition-weights.json 을 조정한다.
 */

import type { ServerAttributionRecord } from '../persistence/attributionRepo.js';
import type { ConditionKey } from '../quantFilter.js';
import {
  isTimingSensitiveConditionId,
  LATE_WIN_TIMING_PENALTY,
} from './signalCalibrator.js';

// ── 상수 ─────────────────────────────────────────────────────────────────────

/** 클라이언트 conditionId(1~27) → 조건명 */
export const CONDITION_NAMES: Record<number, string> = {
  1:  '주도주 사이클 (Cycle)',
  2:  'ROE 유형 3 (ROE Type 3)',
  3:  '시장 환경 (Risk-On)',
  4:  '기계적 손절 (-30%)',
  5:  '신규 주도주 (New Leader)',
  6:  '수급 질 개선 (Supply)',
  7:  '일목균형표 (Ichimoku)',
  8:  '경제적 해자 (Moat)',
  9:  '기술적 정배열 (Technical)',
  10: '거래량 실체 (Volume)',
  11: '기관/외인 수급 (Institutional)',
  12: '목표가 여력 (Upside)',
  13: '실적 서프라이즈 (Earnings)',
  14: '실체적 펀더멘털 (Reality)',
  15: '정책/매크로 부합 (Policy)',
  16: '이익의 질 (OCF)',
  17: '상대 강도 (RS)',
  18: '모멘텀 순위 (Momentum)',
  19: '심리적 객관성 (Psychology)',
  20: '터틀 돌파 (Turtle)',
  21: '피보나치 레벨 (Fibonacci)',
  22: '엘리엇 파동 (Elliott)',
  23: '마진 가속도 (OPM)',
  24: '재무 방어력 (ICR)',
  25: '변동성 축소 (VCP)',
  26: '다이버전스 (Divergence)',
  27: '촉매제 분석 (Catalyst)',
};

const ALL_CONDITION_IDS = Array.from({ length: 27 }, (_, i) => i + 1);

/**
 * 클라이언트 conditionId → 서버 ConditionKey 매핑.
 * 서버가 Yahoo Finance 데이터로 자동 평가하는 조건만 매핑된다.
 * null 인 조건은 분석은 하지만 가중치 조정 경로에서 제외.
 */
const CONDITION_TO_SERVER_KEY: Record<number, ConditionKey | null> = {
  9:  'ma_alignment',      // technicalGoldenCross — 정배열
  10: 'volume_breakout',   // volumeSurgeVerified — 거래량 돌파
  17: 'relative_strength', // relativeStrength — 상대강도
  18: 'momentum',          // momentumRanking — 모멘텀 순위
  20: 'turtle_high',       // turtleBreakout — 터틀 돌파
  25: 'vcp',               // vcpPattern — VCP 변동성 축소
};

const REGIME_LEVELS = ['R1_TURBO', 'R2_BULL', 'R3_EARLY', 'R4_NEUTRAL', 'R5_CAUTION', 'R6_DEFENSE'] as const;

/** conditionScore 기준 — 이 이상이면 "해당 조건이 높은 거래"로 취급 */
const HIGH_SCORE_THRESHOLD = 6;

/** 시너지 탐지 기준 — 평균 수익률 차이가 이 이상이면 bestPartner/worstPartner */
const SYNERGY_DELTA_THRESHOLD = 1.5; // %p

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface ConditionAttribution {
  conditionId:    number;
  conditionName:  string;

  // 기본 지표
  totalTrades:    number;
  winRate:        number;  // 0~1
  avgReturn:      number;  // %
  sharpe:         number;

  // 레짐별 성과
  byRegime: Record<string, {
    winRate:   number;
    avgReturn: number;
    count:     number;
  }>;

  // 시간 추이
  recentTrend:      'IMPROVING' | 'STABLE' | 'DECLINING';
  recentWinRate:    number;   // 최근 30일
  historicalWinRate: number;  // 이전 30일

  // 상호작용 효과
  bestPartners:  number[];  // 함께 높을 때 시너지 높은 조건 ID
  worstPartners: number[];  // 함께 높을 때 성과 저하 조건 ID

  // 권고
  recommendation: 'INCREASE_WEIGHT' | 'MAINTAIN' | 'DECREASE_WEIGHT' | 'SUSPEND';
  reason:         string;
}

// ── 수학 유틸 ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

function sharpeRatio(arr: number[]): number {
  if (arr.length < 2) return 0;
  const std = stdDev(arr);
  return std > 0 ? mean(arr) / std : 0;
}

/**
 * 승률 계산. conditionId 가 타이밍 민감 조건(18/20/21/22/26)이면 LATE_WIN 기여를
 * LATE_WIN_TIMING_PENALTY(0.7) 배로 감쇠하여 "신호는 맞았지만 타이밍은 빗나간"
 * 케이스를 가중치 학습 신호에서 구분한다. 기타 조건은 단순 비율.
 */
function winRateOf(recs: ServerAttributionRecord[], conditionId?: number): number {
  if (recs.length === 0) return 0;
  if (conditionId !== undefined && isTimingSensitiveConditionId(conditionId)) {
    const effectiveWins = recs.reduce((sum, r) => {
      if (!r.isWin) return sum;
      return sum + (r.lateWin ? LATE_WIN_TIMING_PENALTY : 1);
    }, 0);
    return effectiveWins / recs.length;
  }
  return recs.filter((r) => r.isWin).length / recs.length;
}

// ── 빈 결과 ───────────────────────────────────────────────────────────────────

function buildEmpty(id: number): ConditionAttribution {
  return {
    conditionId:       id,
    conditionName:     CONDITION_NAMES[id] ?? `조건 ${id}`,
    totalTrades:       0,
    winRate:           0,
    avgReturn:         0,
    sharpe:            0,
    byRegime:          {},
    recentTrend:       'STABLE',
    recentWinRate:     0,
    historicalWinRate: 0,
    bestPartners:      [],
    worstPartners:     [],
    recommendation:    'MAINTAIN',
    reason:            '샘플 없음 — 유지',
  };
}

// ── 상호작용 효과 탐지 ────────────────────────────────────────────────────────

/**
 * 조건 A(targetId)가 높은 거래 집합에서
 * 조건 B(otherId)도 높을 때 vs 낮을 때 평균 수익률 차이를 계산.
 *
 * positive=true → 시너지 파트너(차이 > SYNERGY_DELTA_THRESHOLD)
 * positive=false → 방해 파트너(차이 < -SYNERGY_DELTA_THRESHOLD)
 */
function findSynergies(
  targetId: number,
  relevant: ServerAttributionRecord[],   // targetId 점수가 높은 거래
  all: ServerAttributionRecord[],
  positive: boolean,
): number[] {
  if (relevant.length < 5) return [];

  const partners: { id: number; delta: number }[] = [];

  for (const otherId of ALL_CONDITION_IDS) {
    if (otherId === targetId) continue;

    // 두 조건 모두 높은 거래
    const both = relevant.filter((r) => (r.conditionScores[otherId] ?? 0) >= HIGH_SCORE_THRESHOLD);
    // targetId는 높지만 otherId는 낮은 거래
    const onlyTarget = relevant.filter((r) => (r.conditionScores[otherId] ?? 0) < HIGH_SCORE_THRESHOLD);

    if (both.length < 3 || onlyTarget.length < 3) continue;

    const delta = mean(both.map((r) => r.returnPct)) - mean(onlyTarget.map((r) => r.returnPct));

    if (positive && delta > SYNERGY_DELTA_THRESHOLD) {
      partners.push({ id: otherId, delta });
    } else if (!positive && delta < -SYNERGY_DELTA_THRESHOLD) {
      partners.push({ id: otherId, delta });
    }
  }

  // 절댓값 기준 상위 3개
  return partners
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
    .map((p) => p.id);
}

// ── 권고 결정 ─────────────────────────────────────────────────────────────────

function decideRecommendation(
  wr: number, sharpe: number, trend: ConditionAttribution['recentTrend'], count: number,
): ConditionAttribution['recommendation'] {
  if (count < 5) return 'MAINTAIN';           // 샘플 부족
  if (wr < 0.35 && sharpe < 0.3) return 'SUSPEND';
  if (wr < 0.45 || sharpe < 0.5) return 'DECREASE_WEIGHT';
  if (wr > 0.65 && sharpe > 1.2 && trend !== 'DECLINING') return 'INCREASE_WEIGHT';
  return 'MAINTAIN';
}

function buildReason(
  wr: number, sharpe: number, trend: ConditionAttribution['recentTrend'], count: number,
): string {
  if (count < 5) return `샘플 ${count}건 — 최소 5건 필요`;
  if (wr < 0.35 && sharpe < 0.3) return `WIN률 ${(wr * 100).toFixed(0)}%·Sharpe ${sharpe.toFixed(2)} — 사실상 비활성화`;
  if (wr < 0.45) return `WIN률 ${(wr * 100).toFixed(0)}% 미달 — 가중치 축소`;
  if (sharpe < 0.5) return `Sharpe ${sharpe.toFixed(2)} 낮음 — 위험 대비 수익 불량`;
  if (trend === 'DECLINING') return `추세 하락 감지 — 유지 (추가 관찰 필요)`;
  if (wr > 0.65 && sharpe > 1.2) return `WIN률 ${(wr * 100).toFixed(0)}%·Sharpe ${sharpe.toFixed(2)}·${trend} — 가중치 확대`;
  return `WIN률 ${(wr * 100).toFixed(0)}%·Sharpe ${sharpe.toFixed(2)} — 적정 수준 유지`;
}

// ── 메인 분석 함수 ────────────────────────────────────────────────────────────

/**
 * ServerAttributionRecord 배열을 conditionId 1~27 별로 완전 분석.
 *
 * "이 조건이 높은(≥6) 점수를 받은 거래"를 집합으로 선별하고
 * winRate, Sharpe, 레짐별 성과, 시간 추이, 상호작용을 계산한다.
 */
export function analyzeAttribution(
  records: ServerAttributionRecord[],
): ConditionAttribution[] {
  if (records.length === 0) return ALL_CONDITION_IDS.map(buildEmpty);

  const now = Date.now();
  const MS_30D = 30 * 86_400_000;
  const MS_60D = 60 * 86_400_000;

  return ALL_CONDITION_IDS.map((id) => {
    // 이 조건이 높은 점수(≥ HIGH_SCORE_THRESHOLD)였던 거래만 선별
    const relevant = records.filter(
      (r) => (r.conditionScores[id] ?? 0) >= HIGH_SCORE_THRESHOLD,
    );
    if (relevant.length === 0) return buildEmpty(id);

    // ── 기본 지표 ──
    const returns = relevant.map((r) => r.returnPct);
    const wr      = winRateOf(relevant, id);
    const avgRet  = mean(returns);
    const sharpe  = sharpeRatio(returns);

    // ── 레짐별 성과 ──
    const byRegime: ConditionAttribution['byRegime'] = {};
    for (const regime of REGIME_LEVELS) {
      const sub = relevant.filter((r) => r.entryRegime === regime);
      if (sub.length === 0) continue;
      byRegime[regime] = {
        winRate:   parseFloat(winRateOf(sub, id).toFixed(3)),
        avgReturn: parseFloat(mean(sub.map((r) => r.returnPct)).toFixed(2)),
        count:     sub.length,
      };
    }

    // ── 시간 추이 ──
    const recent30   = relevant.filter((r) => now - new Date(r.closedAt).getTime() < MS_30D);
    const prev30     = relevant.filter((r) => {
      const age = now - new Date(r.closedAt).getTime();
      return age >= MS_30D && age < MS_60D;
    });
    const recentWR   = recent30.length >= 3 ? winRateOf(recent30, id) : wr;
    const historWR   = prev30.length   >= 3 ? winRateOf(prev30, id)   : wr;
    const wrDiff     = recentWR - historWR;
    const trend: ConditionAttribution['recentTrend'] =
      wrDiff > 0.10  ? 'IMPROVING' :
      wrDiff < -0.10 ? 'DECLINING' : 'STABLE';

    // ── 상호작용 효과 ──
    const bestPartners  = findSynergies(id, relevant, records, true);
    const worstPartners = findSynergies(id, relevant, records, false);

    // ── 권고 ──
    const recommendation = decideRecommendation(wr, sharpe, trend, relevant.length);
    const reason         = buildReason(wr, sharpe, trend, relevant.length);

    return {
      conditionId:       id,
      conditionName:     CONDITION_NAMES[id] ?? `조건 ${id}`,
      totalTrades:       relevant.length,
      winRate:           parseFloat(wr.toFixed(3)),
      avgReturn:         parseFloat(avgRet.toFixed(2)),
      sharpe:            parseFloat(sharpe.toFixed(2)),
      byRegime,
      recentTrend:       trend,
      recentWinRate:     parseFloat(recentWR.toFixed(3)),
      historicalWinRate: parseFloat(historWR.toFixed(3)),
      bestPartners,
      worstPartners,
      recommendation,
      reason,
    };
  });
}

/**
 * 클라이언트 conditionId → 서버 ConditionKey.
 * 서버가 자동 평가하는 6개 조건만 매핑; 나머지는 null.
 */
export function serverConditionKey(conditionId: number): ConditionKey | null {
  return CONDITION_TO_SERVER_KEY[conditionId] ?? null;
}

/**
 * 서버 ConditionKey → 클라이언트 conditionId (역매핑).
 * 시너지 부트스트랩 등에서 RecommendationRecord.conditionKeys 를
 * 27-score 벡터로 확장할 때 사용.
 */
const SERVER_KEY_TO_CONDITION_ID: Record<string, number> = Object.fromEntries(
  Object.entries(CONDITION_TO_SERVER_KEY)
    .filter(([, v]) => v !== null)
    .map(([id, key]) => [key as string, Number(id)]),
);

export function conditionIdFromServerKey(key: string): number | null {
  return SERVER_KEY_TO_CONDITION_ID[key] ?? null;
}
