// @responsibility shadowLearningPromotionRecommendation — ADR-0432 read-only recommendation SSOT.
//
// ADR-0432:
// Shadow learning promotion is recommendation-only.
// It evaluates provisional/counterfactual learning samples and suggests
// enhanced watch or normal shadow watch candidates without opening live,
// paper, execution shadow, virtual-account, or order paths.
//
// This module must never mutate trading state, lower thresholds, or auto-promote
// candidates. It only ranks learning samples for further observation.
//
// 핵심 불변식 (사용자 명시 §"절대 하지 말 것" 정합):
//   1. LIVE 매수 / KIS order / orderExecutor / trancheExecutor / autoTradeEngine 호출 0
//   2. paper trade 생성 0
//   3. normal shadow-trades.json 체결 기록 추가 0
//   4. virtual account holdings/cash/equity 변경 0
//   5. Gate threshold / Gate2 / STRONG_BUY 변경 0
//   6. SectorEnergy DEGRADED/STOCK_DAILY → OK 승격 0
//   7. SELL_ONLY / R6_DEFENSE / emergencyStop 우회 0
//   8. 외부 API 호출 0 — read-time recommendation only
//   9. provisional / counterfactual / normal shadow ledger 물리적 결합 0 (source 필드 분리 의무)
//   10. PENDING / DATA_UNAVAILABLE / INSUFFICIENT_DATA / ERROR → 손실 카운트 0
//
// 입력은 두 PerformanceRecord union 중 하나:
//   - ProvisionalShadowPerformanceRecord (ADR-0428)
//   - CounterfactualShadowPerformanceRecord (ADR-0431)
//
// 출력은 ShadowLearningPromotionSummary — 이번 후보가 다음 학습 단계에서 *어떤 단계로
// 관찰될지* 추천. 매매 진입 기준 아님 (threshold 상수 주석에 명시).

import type { ProvisionalShadowPerformanceRecord } from './provisionalShadowPerformanceReport.js';
import type { CounterfactualShadowPerformanceRecord } from './counterfactualShadowLearningPerformanceReport.js';

/** 사용자 §B 정합 — 두 source 명시 분리. */
export type ShadowLearningPromotionSource = 'PROVISIONAL_SHADOW' | 'COUNTERFACTUAL_SHADOW';

/** 사용자 §B — 6-value action union. **매매 액션 아님** — 학습 관찰 단계 추천. */
export type ShadowLearningPromotionAction =
  | 'PROMOTE_TO_NORMAL_SHADOW_WATCH'
  | 'PROMOTE_TO_ENHANCED_WATCH'
  | 'KEEP_LEARNING_ONLY'
  | 'REJECT_LEARNING_HYPOTHESIS'
  | 'INSUFFICIENT_DATA'
  | 'PENDING';

/** 사용자 §B — reasons 12-value union. */
export type ShadowLearningPromotionReason =
  | 'POSITIVE_FOLLOW_THROUGH_30M'
  | 'POSITIVE_FOLLOW_THROUGH_1H'
  | 'POSITIVE_CLOSE_FOLLOW_THROUGH'
  | 'MULTI_HORIZON_STRENGTH'
  | 'LOW_ADVERSE_EXCURSION'
  | 'SELL_ONLY_OVERDEFENSE_SIGNAL'
  | 'NEGATIVE_FOLLOW_THROUGH'
  | 'HIGH_ADVERSE_EXCURSION'
  | 'INSUFFICIENT_OBSERVED_POINTS'
  | 'DATA_UNAVAILABLE'
  | 'PENDING_HORIZONS'
  | 'RISK_BLOCK_REMAINS'
  | 'UNKNOWN';

/**
 * Promotion candidate schema (사용자 §B 정합).
 *
 * literal markers (TypeScript 강제):
 *   - liveAllowed: false
 *   - paperAllowed: false
 *   - executionShadowAllowed: false
 *   - recommendationOnly: true
 *
 * 호출자가 위 4개 literal 중 하나라도 다른 값을 넣으면 컴파일 에러.
 */
export interface ShadowLearningPromotionCandidate {
  symbol: string;
  name?: string;
  source: ShadowLearningPromotionSource;
  /** 입력 PerformanceRecord 의 id 그대로 — duplicate symbol 분리 식별. */
  sourceEntryId: string;
  label: string;
  action: ShadowLearningPromotionAction;
  reasons: ShadowLearningPromotionReason[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  /** 0~100 정수, 정렬용. action 별로 독립 의미. */
  score: number;
  observedHorizons: string[];
  bestReturnPct?: number;
  worstReturnPct?: number;
  latestReturnPct?: number;
  avgObservedReturnPct?: number;
  winRateObserved?: number;
  blockedBy?: string[];
  liveAllowed: false;
  paperAllowed: false;
  executionShadowAllowed: false;
  recommendationOnly: true;
  createdAtKst: string;
}

export interface ShadowLearningPromotionSummary {
  generatedAtKst: string;
  totalEvaluated: number;
  promoteToNormalShadowWatch: number;
  promoteToEnhancedWatch: number;
  keepLearningOnly: number;
  rejectLearningHypothesis: number;
  insufficientData: number;
  /** Pending (모든 horizon 미도달) 별도 카운트 — 손실 아님. */
  pending: number;
  candidates: ShadowLearningPromotionCandidate[];
}

/**
 * 임계 상수 SSOT (사용자 §C 정합, 절대 변경 금지).
 *
 * 주의: NOT TRADING THRESHOLDS — 학습 단계 추천 기준일 뿐, 매매 진입 기준 아님.
 * threshold 변경은 ADR-0432 § 결정 트리 갱신 + 회귀 테스트 동반 의무.
 */
export const SHADOW_PROMOTION_THRESHOLDS = Object.freeze({
  // PROMOTE_TO_NORMAL_SHADOW_WATCH (사용자 §C-3)
  NORMAL_WATCH_MIN_OBSERVED: 3,
  NORMAL_WATCH_MIN_AVG_RETURN_PCT: 0.5,
  NORMAL_WATCH_MIN_WIN_RATE: 0.6,
  NORMAL_WATCH_MIN_LATEST_RETURN_PCT: 0,
  NORMAL_WATCH_MIN_WORST_RETURN_PCT: -2.0,

  // PROMOTE_TO_ENHANCED_WATCH (사용자 §C-2)
  ENHANCED_WATCH_MIN_OBSERVED: 2,
  ENHANCED_WATCH_MIN_AVG_RETURN_PCT: 0,
  ENHANCED_WATCH_MIN_BEST_RETURN_PCT: 1.0,
  ENHANCED_WATCH_MIN_WIN_RATE: 0.5,
  ENHANCED_WATCH_MIN_WORST_RETURN_PCT: -1.5,

  // REJECT_LEARNING_HYPOTHESIS (사용자 §C-4)
  REJECT_MIN_OBSERVED: 2,
  REJECT_MAX_AVG_RETURN_PCT: -1.0,
  REJECT_MAX_WIN_RATE: 0.33,
  REJECT_MAX_WORST_RETURN_PCT: -2.5,

  // confidence 산출
  CONFIDENCE_HIGH_MIN_OBSERVED: 4,
  CONFIDENCE_MEDIUM_MIN_OBSERVED: 2,
} as const);

/** ENV 정확 비교 (ADR-0157 정합) — `'true'` 만 비활성. */
export function isShadowLearningPromotionDisabled(): boolean {
  return process.env.SHADOW_LEARNING_PROMOTION_DISABLED === 'true';
}

/**
 * 단일 Performance record 를 promotion candidate 1건으로 평가하는 SSOT.
 *
 * 사용자 §C 결정 트리 (절대 변경 금지):
 *   1. observed point=0 → INSUFFICIENT_DATA (entryPrice 없거나 모든 horizon
 *      PENDING/DATA_UNAVAILABLE/INSUFFICIENT_DATA/ERROR)
 *   2. 모든 horizon PENDING 만 (observed=0 + 다른 fail status 0) → PENDING
 *   3. NORMAL_SHADOW_WATCH 임계 충족 → PROMOTE_TO_NORMAL_SHADOW_WATCH
 *   4. ENHANCED_WATCH 임계 충족 → PROMOTE_TO_ENHANCED_WATCH
 *   5. REJECT 임계 충족 → REJECT_LEARNING_HYPOTHESIS
 *   6. 그 외 → KEEP_LEARNING_ONLY
 *
 * 우선순위 — NORMAL > ENHANCED > REJECT > KEEP.
 *   동일 후보가 NORMAL 임계도 만족하고 ENHANCED 임계도 만족하면 NORMAL 격상.
 *
 * 안전 invariant:
 *   - PENDING / DATA_UNAVAILABLE / INSUFFICIENT_DATA / ERROR 는 손실 카운트 아님
 *   - winRate / avgReturn 분모 = OBSERVED only
 */
function evaluateRecord(
  record: ProvisionalShadowPerformanceRecord | CounterfactualShadowPerformanceRecord,
  source: ShadowLearningPromotionSource,
  nowKst: string,
): ShadowLearningPromotionCandidate {
  const T = SHADOW_PROMOTION_THRESHOLDS;

  // OBSERVED only — PENDING/DATA_UNAVAILABLE/INSUFFICIENT_DATA/ERROR 모두 제외.
  const observedPoints = record.points.filter(
    (p) => p.status === 'OBSERVED' && p.returnPct !== undefined && Number.isFinite(p.returnPct),
  );
  const observedHorizons = observedPoints.map((p) => p.horizon);
  const observedCount = observedPoints.length;

  // 통계 — observed 만 입력
  let avgObservedReturnPct: number | undefined;
  let winRateObserved: number | undefined;
  if (observedCount > 0) {
    const sum = observedPoints.reduce((acc, p) => acc + (p.returnPct ?? 0), 0);
    avgObservedReturnPct = sum / observedCount;
    const wins = observedPoints.filter((p) => (p.returnPct ?? 0) > 0).length;
    winRateObserved = wins / observedCount;
  }

  const bestReturnPct = record.summary.bestReturnPct;
  const worstReturnPct = record.summary.worstReturnPct;
  const latestReturnPct = record.summary.latestReturnPct;

  // ─────────────────────────────────────────────────────
  // reasons 합성 (관찰 기반)
  // ─────────────────────────────────────────────────────
  const reasons: ShadowLearningPromotionReason[] = [];
  const horizonSet = new Set(observedHorizons);
  const ret30m = observedPoints.find((p) => p.horizon === 'T_PLUS_30M')?.returnPct;
  const ret1h = observedPoints.find((p) => p.horizon === 'T_PLUS_1H')?.returnPct;
  const retClose = observedPoints.find((p) => p.horizon === 'SAME_DAY_CLOSE')?.returnPct;

  if (typeof ret30m === 'number' && ret30m > 0) reasons.push('POSITIVE_FOLLOW_THROUGH_30M');
  if (typeof ret1h === 'number' && ret1h > 0) reasons.push('POSITIVE_FOLLOW_THROUGH_1H');
  if (typeof retClose === 'number' && retClose > 0) reasons.push('POSITIVE_CLOSE_FOLLOW_THROUGH');
  if (observedCount >= 3 && (avgObservedReturnPct ?? 0) > 0)
    reasons.push('MULTI_HORIZON_STRENGTH');
  if (typeof worstReturnPct === 'number' && worstReturnPct > -1.0)
    reasons.push('LOW_ADVERSE_EXCURSION');
  if (
    source === 'COUNTERFACTUAL_SHADOW' &&
    observedCount >= 2 &&
    (avgObservedReturnPct ?? 0) > 0.5 &&
    (winRateObserved ?? 0) >= 0.5
  ) {
    reasons.push('SELL_ONLY_OVERDEFENSE_SIGNAL');
  }
  if (typeof avgObservedReturnPct === 'number' && avgObservedReturnPct < 0)
    reasons.push('NEGATIVE_FOLLOW_THROUGH');
  if (typeof worstReturnPct === 'number' && worstReturnPct <= -2.0)
    reasons.push('HIGH_ADVERSE_EXCURSION');

  // ─────────────────────────────────────────────────────
  // action 결정 (사용자 §C 우선순위, 절대 변경 금지)
  // ─────────────────────────────────────────────────────
  let action: ShadowLearningPromotionAction;

  // 1. observed=0 분기
  if (observedCount === 0) {
    // 모든 point PENDING → PENDING (사용자 §I 분리)
    const allPending = record.points.every((p) => p.status === 'PENDING');
    if (allPending && record.points.length > 0) {
      action = 'PENDING';
      reasons.push('PENDING_HORIZONS');
    } else {
      action = 'INSUFFICIENT_DATA';
      reasons.push('INSUFFICIENT_OBSERVED_POINTS');
      const hasUnavailable = record.points.some(
        (p) =>
          p.status === 'DATA_UNAVAILABLE' ||
          p.status === 'INSUFFICIENT_DATA' ||
          p.status === 'MARKET_CLOSED',
      );
      if (hasUnavailable) reasons.push('DATA_UNAVAILABLE');
    }
  } else if (
    // 3. NORMAL_SHADOW_WATCH 임계 (가장 strict)
    observedCount >= T.NORMAL_WATCH_MIN_OBSERVED &&
    typeof avgObservedReturnPct === 'number' &&
    avgObservedReturnPct >= T.NORMAL_WATCH_MIN_AVG_RETURN_PCT &&
    typeof winRateObserved === 'number' &&
    winRateObserved >= T.NORMAL_WATCH_MIN_WIN_RATE &&
    typeof latestReturnPct === 'number' &&
    latestReturnPct >= T.NORMAL_WATCH_MIN_LATEST_RETURN_PCT &&
    typeof worstReturnPct === 'number' &&
    worstReturnPct > T.NORMAL_WATCH_MIN_WORST_RETURN_PCT
  ) {
    action = 'PROMOTE_TO_NORMAL_SHADOW_WATCH';
  } else if (
    // 4. ENHANCED_WATCH 임계
    observedCount >= T.ENHANCED_WATCH_MIN_OBSERVED &&
    typeof avgObservedReturnPct === 'number' &&
    avgObservedReturnPct > T.ENHANCED_WATCH_MIN_AVG_RETURN_PCT &&
    typeof bestReturnPct === 'number' &&
    bestReturnPct >= T.ENHANCED_WATCH_MIN_BEST_RETURN_PCT &&
    typeof winRateObserved === 'number' &&
    winRateObserved >= T.ENHANCED_WATCH_MIN_WIN_RATE &&
    typeof worstReturnPct === 'number' &&
    worstReturnPct > T.ENHANCED_WATCH_MIN_WORST_RETURN_PCT
  ) {
    action = 'PROMOTE_TO_ENHANCED_WATCH';
  } else if (
    // 5. REJECT 임계
    observedCount >= T.REJECT_MIN_OBSERVED &&
    typeof avgObservedReturnPct === 'number' &&
    avgObservedReturnPct < T.REJECT_MAX_AVG_RETURN_PCT &&
    typeof winRateObserved === 'number' &&
    winRateObserved <= T.REJECT_MAX_WIN_RATE &&
    typeof worstReturnPct === 'number' &&
    worstReturnPct <= T.REJECT_MAX_WORST_RETURN_PCT
  ) {
    action = 'REJECT_LEARNING_HYPOTHESIS';
  } else {
    action = 'KEEP_LEARNING_ONLY';
  }

  // ─────────────────────────────────────────────────────
  // confidence
  // ─────────────────────────────────────────────────────
  let confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  if (observedCount >= T.CONFIDENCE_HIGH_MIN_OBSERVED) confidence = 'HIGH';
  else if (observedCount >= T.CONFIDENCE_MEDIUM_MIN_OBSERVED) confidence = 'MEDIUM';
  else confidence = 'LOW';

  // ─────────────────────────────────────────────────────
  // score (정렬용 0~100)
  //   - INSUFFICIENT_DATA / PENDING → 0
  //   - REJECT → 0~30 (worst 일수록 낮음)
  //   - KEEP → 30~50
  //   - ENHANCED → 50~75
  //   - NORMAL → 75~100
  // 정렬 안정성을 위한 보조 시그널 (avg, winRate) 가산.
  // ─────────────────────────────────────────────────────
  function clampScore(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  let score: number;
  switch (action) {
    case 'PROMOTE_TO_NORMAL_SHADOW_WATCH': {
      const avg = avgObservedReturnPct ?? 0;
      const wr = winRateObserved ?? 0;
      score = clampScore(75 + avg * 5 + wr * 15);
      break;
    }
    case 'PROMOTE_TO_ENHANCED_WATCH': {
      const avg = avgObservedReturnPct ?? 0;
      const wr = winRateObserved ?? 0;
      score = clampScore(50 + avg * 5 + wr * 15);
      break;
    }
    case 'REJECT_LEARNING_HYPOTHESIS': {
      const avg = avgObservedReturnPct ?? 0;
      // avg 가 더 낮을수록 score 낮음 (정렬 시 worst 가 위)
      score = clampScore(30 + avg * 5);
      break;
    }
    case 'KEEP_LEARNING_ONLY': {
      const avg = avgObservedReturnPct ?? 0;
      score = clampScore(40 + avg * 5);
      break;
    }
    case 'INSUFFICIENT_DATA':
    case 'PENDING':
      score = 0;
      break;
  }

  // sourceEntryId — record.id 그대로 사용. 동일 symbol 이 양쪽 ledger 에 있어도
  // record.id 가 source-prefix 또는 unique 라 분리됨.
  const sourceEntryId = record.id;

  // RISK_BLOCK_REMAINS — counterfactual 의 경우 router.severity HARD_BLOCK 등 잔존 의미
  if (
    source === 'COUNTERFACTUAL_SHADOW' &&
    'routerSnapshot' in record &&
    record.routerSnapshot?.severity === 'HARD_BLOCK'
  ) {
    reasons.push('RISK_BLOCK_REMAINS');
  }

  // 중복 reason 제거
  const uniqueReasons = Array.from(new Set(reasons));
  if (uniqueReasons.length === 0) uniqueReasons.push('UNKNOWN');

  // blockedBy — counterfactual 만 가짐
  const blockedBy =
    source === 'COUNTERFACTUAL_SHADOW' && 'blockedBy' in record
      ? (record as CounterfactualShadowPerformanceRecord).blockedBy
      : undefined;

  return {
    symbol: record.symbol,
    ...(record.name !== undefined ? { name: record.name } : {}),
    source,
    sourceEntryId,
    label: record.label,
    action,
    reasons: uniqueReasons,
    confidence,
    score,
    observedHorizons: Array.from(horizonSet),
    ...(bestReturnPct !== undefined ? { bestReturnPct } : {}),
    ...(worstReturnPct !== undefined ? { worstReturnPct } : {}),
    ...(latestReturnPct !== undefined ? { latestReturnPct } : {}),
    ...(avgObservedReturnPct !== undefined ? { avgObservedReturnPct } : {}),
    ...(winRateObserved !== undefined ? { winRateObserved } : {}),
    ...(blockedBy !== undefined ? { blockedBy } : {}),
    liveAllowed: false,
    paperAllowed: false,
    executionShadowAllowed: false,
    recommendationOnly: true,
    createdAtKst: nowKst,
  };
}

export interface BuildShadowLearningPromotionRecommendationsInput {
  provisionalRecords?: ProvisionalShadowPerformanceRecord[];
  counterfactualRecords?: CounterfactualShadowPerformanceRecord[];
  nowKst?: string;
  /** 후보 표시 최대 수 (정렬 후 상위만). default 50. */
  maxCandidates?: number;
  /** ENV 우회 — `SHADOW_LEARNING_PROMOTION_DISABLED=true` 시 빈 summary. */
  disableEnvCheck?: boolean;
}

/**
 * ADR-0432:
 * Shadow learning promotion is recommendation-only.
 * It evaluates provisional/counterfactual learning samples and suggests
 * enhanced watch or normal shadow watch candidates without opening live,
 * paper, execution shadow, virtual-account, or order paths.
 *
 * This module must never mutate trading state, lower thresholds, or auto-promote
 * candidates. It only ranks learning samples for further observation.
 */
export function buildShadowLearningPromotionRecommendations(
  input: BuildShadowLearningPromotionRecommendationsInput,
): ShadowLearningPromotionSummary {
  const generatedAtKst = input.nowKst ?? new Date().toISOString();
  const maxCandidates = input.maxCandidates ?? 50;

  if (!input.disableEnvCheck && isShadowLearningPromotionDisabled()) {
    return {
      generatedAtKst,
      totalEvaluated: 0,
      promoteToNormalShadowWatch: 0,
      promoteToEnhancedWatch: 0,
      keepLearningOnly: 0,
      rejectLearningHypothesis: 0,
      insufficientData: 0,
      pending: 0,
      candidates: [],
    };
  }

  const candidates: ShadowLearningPromotionCandidate[] = [];

  // provisional 평가
  for (const r of input.provisionalRecords ?? []) {
    candidates.push(evaluateRecord(r, 'PROVISIONAL_SHADOW', generatedAtKst));
  }
  // counterfactual 평가
  for (const r of input.counterfactualRecords ?? []) {
    candidates.push(evaluateRecord(r, 'COUNTERFACTUAL_SHADOW', generatedAtKst));
  }

  // 정렬: action 우선순위 → score desc → symbol
  const ACTION_ORDER: Record<ShadowLearningPromotionAction, number> = {
    PROMOTE_TO_NORMAL_SHADOW_WATCH: 0,
    PROMOTE_TO_ENHANCED_WATCH: 1,
    KEEP_LEARNING_ONLY: 2,
    REJECT_LEARNING_HYPOTHESIS: 3,
    INSUFFICIENT_DATA: 4,
    PENDING: 5,
  };
  candidates.sort((a, b) => {
    const ord = ACTION_ORDER[a.action] - ACTION_ORDER[b.action];
    if (ord !== 0) return ord;
    if (a.score !== b.score) return b.score - a.score;
    return a.symbol.localeCompare(b.symbol);
  });

  // 카운트
  const counts = {
    promoteToNormalShadowWatch: 0,
    promoteToEnhancedWatch: 0,
    keepLearningOnly: 0,
    rejectLearningHypothesis: 0,
    insufficientData: 0,
    pending: 0,
  };
  for (const c of candidates) {
    if (c.action === 'PROMOTE_TO_NORMAL_SHADOW_WATCH') counts.promoteToNormalShadowWatch += 1;
    else if (c.action === 'PROMOTE_TO_ENHANCED_WATCH') counts.promoteToEnhancedWatch += 1;
    else if (c.action === 'KEEP_LEARNING_ONLY') counts.keepLearningOnly += 1;
    else if (c.action === 'REJECT_LEARNING_HYPOTHESIS') counts.rejectLearningHypothesis += 1;
    else if (c.action === 'INSUFFICIENT_DATA') counts.insufficientData += 1;
    else if (c.action === 'PENDING') counts.pending += 1;
  }

  return {
    generatedAtKst,
    totalEvaluated: candidates.length,
    promoteToNormalShadowWatch: counts.promoteToNormalShadowWatch,
    promoteToEnhancedWatch: counts.promoteToEnhancedWatch,
    keepLearningOnly: counts.keepLearningOnly,
    rejectLearningHypothesis: counts.rejectLearningHypothesis,
    insufficientData: counts.insufficientData,
    pending: counts.pending,
    candidates: candidates.slice(0, maxCandidates),
  };
}

/**
 * 텔레그램 메시지 빌더 SSOT (사용자 §F 정합).
 *
 * 데이터 부족 시 명시적 안내. 사용자 §"중요: 추천 전용입니다" 푸터 의무.
 */
export function formatShadowLearningPromotionMessage(
  summary: ShadowLearningPromotionSummary,
): string {
  const lines: string[] = [];
  lines.push('🧪 <b>Shadow Learning Promotion Report (ADR-0432)</b>');
  lines.push('  • <i>recommendation-only — 다음 학습 단계 후보. 매매 액션 0.</i>');

  if (summary.totalEvaluated === 0) {
    lines.push('  • <i>아직 평가 가능한 provisional/counterfactual 성과 데이터가 부족합니다.</i>');
    lines.push('  • <i>/shadow_provisional, /shadow_counterfactual 을 먼저 확인하세요.</i>');
    lines.push(`  • generatedAtKst: ${summary.generatedAtKst}`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push('  <b>📊 요약</b>');
  lines.push(`    • evaluated: <b>${summary.totalEvaluated}</b>`);
  lines.push(`    • promoteToNormalShadowWatch: <b>${summary.promoteToNormalShadowWatch}</b>`);
  lines.push(`    • promoteToEnhancedWatch: <b>${summary.promoteToEnhancedWatch}</b>`);
  lines.push(`    • keepLearningOnly: <b>${summary.keepLearningOnly}</b>`);
  lines.push(`    • rejectLearningHypothesis: <b>${summary.rejectLearningHypothesis}</b>`);
  lines.push(`    • insufficientData: <b>${summary.insufficientData}</b>`);
  if (summary.pending > 0) {
    lines.push(`    • pending: <b>${summary.pending}</b>`);
  }

  // Top 5 by action group
  const normalWatch = summary.candidates
    .filter((c) => c.action === 'PROMOTE_TO_NORMAL_SHADOW_WATCH')
    .slice(0, 5);
  const enhancedWatch = summary.candidates
    .filter((c) => c.action === 'PROMOTE_TO_ENHANCED_WATCH')
    .slice(0, 5);
  const rejected = summary.candidates
    .filter((c) => c.action === 'REJECT_LEARNING_HYPOTHESIS')
    .slice(0, 5);

  if (normalWatch.length > 0) {
    lines.push('');
    lines.push('  <b>⬆️ Normal Shadow Watch 후보</b>');
    normalWatch.forEach((c, i) => {
      const avg = c.avgObservedReturnPct;
      const wr = c.winRateObserved;
      const avgStr = typeof avg === 'number' ? `${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%` : 'n/a';
      const wrStr = typeof wr === 'number' ? `${(wr * 100).toFixed(0)}%` : 'n/a';
      lines.push(
        `    ${i + 1}. ${c.symbol}${c.name ? ` ${c.name}` : ''} <i>source=${c.source}</i>`,
      );
      lines.push(
        `       score=${c.score} avg=${avgStr} winRate=${wrStr} confidence=${c.confidence}`,
      );
      const topReasons = c.reasons.slice(0, 3).join(', ');
      if (topReasons) lines.push(`       reasons: ${topReasons}`);
    });
  }

  if (enhancedWatch.length > 0) {
    lines.push('');
    lines.push('  <b>👀 Enhanced Watch 후보</b>');
    enhancedWatch.forEach((c, i) => {
      const best = c.bestReturnPct;
      const worst = c.worstReturnPct;
      const bestStr =
        typeof best === 'number' ? `${best >= 0 ? '+' : ''}${best.toFixed(2)}%` : 'n/a';
      const worstStr =
        typeof worst === 'number' ? `${worst >= 0 ? '+' : ''}${worst.toFixed(2)}%` : 'n/a';
      lines.push(
        `    ${i + 1}. ${c.symbol}${c.name ? ` ${c.name}` : ''} <i>source=${c.source}</i>`,
      );
      lines.push(`       score=${c.score} best=${bestStr} worst=${worstStr}`);
    });
  }

  if (rejected.length > 0) {
    lines.push('');
    lines.push('  <b>❌ Reject Learning Hypothesis</b>');
    rejected.forEach((c, i) => {
      const avg = c.avgObservedReturnPct;
      const avgStr = typeof avg === 'number' ? `${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%` : 'n/a';
      lines.push(
        `    ${i + 1}. ${c.symbol}${c.name ? ` ${c.name}` : ''} avg=${avgStr} <i>source=${c.source}</i>`,
      );
    });
  }

  lines.push('');
  lines.push(
    '  <i>📌 주의: 추천 전용입니다. ' +
      'LIVE/PAPER/일반 shadow 체결 영향 0. 자동 승격 없음 (ADR-0432).</i>',
  );
  lines.push(`  • generatedAtKst: ${summary.generatedAtKst}`);

  return lines.join('\n');
}

/**
 * /scan_blockers 한 줄 요약 (사용자 §G 정합).
 *
 * 데이터 없으면 null 반환 (호출자가 라인 자체 생략).
 */
export function formatShadowLearningPromotionSummaryLine(
  summary: ShadowLearningPromotionSummary,
): string | null {
  if (summary.totalEvaluated === 0) return null;
  return (
    `🧪 Shadow Learning Promotion: ` +
    `normalWatch=<b>${summary.promoteToNormalShadowWatch}</b> / ` +
    `enhancedWatch=<b>${summary.promoteToEnhancedWatch}</b> / ` +
    `keep=<b>${summary.keepLearningOnly}</b> / ` +
    `reject=<b>${summary.rejectLearningHypothesis}</b> ` +
    `<i>(detail: /shadow_promotion)</i>`
  );
}
