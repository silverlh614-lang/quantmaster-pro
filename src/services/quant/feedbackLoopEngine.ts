// @responsibility quant feedbackLoopEngine 엔진 모듈
/**
 * feedbackLoopEngine.ts — 피드백 폐쇄 루프 (Feedback Closed Loop)
 *
 * 핵심 개념: 시스템 자기진화 — 30거래 누적 후부터 27조건 가중치가 실전 데이터로
 * 자동 교정된다. 구현 직후 효과는 적지만 시간이 지날수록 기하급수적으로 가치가 높아진다.
 *
 * 교정 알고리즘:
 *   1. 30건 이상 종료된 거래 기록 수집
 *   2. 조건별 승률·평균 수익률 집계
 *   3. 승률 > 60%: 가중치 +10% (최대 1.5)
 *      승률 < 40%: 가중치 -10% (최소 0.5)
 *      기타: 1.0 유지
 *   4. localStorage에 저장 → 다음 evaluateStock() 호출부터 반영
 */

import type { TradeRecord, FeedbackLoopResult, ConditionCalibration } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';
import { ALL_CONDITIONS } from './evolutionEngine';
import { saveEvolutionWeights } from './evolutionEngine';
import { getSourceMultiplier, resolveSource } from './sourceWeighting';
import { getTradeLearningWeight, summarizeLossReasonBreakdown } from './lossReasonWeighting';
import { computeConditionEdge } from './conditionEdgeScore';
import {
  recordWeightSnapshot,
  loadWeightHistory,
  evaluateDrift,
  isF2WPausedUntil,
  pauseF2W,
  getTopDeviatingConditions,
} from './f2wDriftDetector';
import { evaluateConditionCoverage } from './learningCoverage';

// ─── 캘리브레이션 임계값 ──────────────────────────────────────────────────────

/** 캘리브레이션 활성화에 필요한 최소 종료 거래 수 */
export const CALIBRATION_MIN_TRADES = 30;

/** 조건별 최소 기여 거래 수 (미달 시 가중치 유지) */
const MIN_CONDITION_TRADES = 5;

/** 가중치 범위 */
const WEIGHT_MIN = 0.5;
const WEIGHT_MAX = 1.5;
const WEIGHT_STEP = 0.10;
const UP_THRESHOLD_DEFAULT = 0.60;
const DOWN_THRESHOLD_DEFAULT = 0.40;

/**
 * ADR-0027 (PR-J): Shadow Model — 신규 학습 로직 그림자 검증 옵션.
 * shadow=true 면 saveEvolutionWeights 호출 차단 (LIVE 가중치 무영향).
 * weightStep / 임계값 override 로 다른 알고리즘 시뮬레이션 가능.
 */
export interface FeedbackLoopOptions {
  /** true → localStorage 저장 안 함 (LIVE 무영향, 결과만 반환) */
  shadow?: boolean;
  /** WEIGHT_STEP override (기본 0.10) */
  weightStep?: number;
  /** 가중치 상향 임계 (기본 0.60) */
  upThreshold?: number;
  /** 가중치 하향 임계 (기본 0.40) */
  downThreshold?: number;
}

// ─── 핵심 로직 ────────────────────────────────────────────────────────────────

/**
 * 종료된 거래 기록에서 조건별 통계를 집계하여 캘리브레이션 결과를 반환한다.
 * calibrationActive = true 일 때만 실제 가중치가 업데이트된다.
 *
 * @param closedTrades - 상태가 'CLOSED'인 거래 기록 배열
 * @param currentWeights - 현재 조건별 가중치 (conditionId → weight)
 * @returns 피드백 루프 캘리브레이션 결과
 */
export function evaluateFeedbackLoop(
  closedTrades: TradeRecord[],
  currentWeights: Record<number, number> = {},
  options?: FeedbackLoopOptions,
): FeedbackLoopResult {
  const isShadow = options?.shadow === true;
  const weightStep = options?.weightStep ?? WEIGHT_STEP;
  const upThreshold = options?.upThreshold ?? UP_THRESHOLD_DEFAULT;
  const downThreshold = options?.downThreshold ?? DOWN_THRESHOLD_DEFAULT;
  const closedCount = closedTrades.length;
  const calibrationActive = closedCount >= CALIBRATION_MIN_TRADES;
  const calibrationProgress = Math.min(1, closedCount / CALIBRATION_MIN_TRADES);

  if (!calibrationActive || closedCount === 0) {
    return {
      closedTradeCount: closedCount,
      calibrationActive: false,
      calibrationProgress,
      calibrations: [],
      boostedCount: 0,
      reducedCount: 0,
      lastCalibratedAt: null,
      summary: closedCount === 0
        ? '매매 기록 없음 — 첫 거래를 시작하세요.'
        : `${closedCount}/${CALIBRATION_MIN_TRADES}거래 누적 중 — ${CALIBRATION_MIN_TRADES - closedCount}건 추가 필요`,
    };
  }

  // ── 조건별 통계 집계 ────────────────────────────────────────────────────────
  const conditionIds = Object.keys(ALL_CONDITIONS).map(Number) as ConditionId[];
  const calibrations: ConditionCalibration[] = [];
  const updatedWeights: Record<number, number> = { ...currentWeights };
  const coverageGated: NonNullable<FeedbackLoopResult['coverageGated']> = [];

  for (const id of conditionIds) {
    // 해당 조건이 ≥ 5점인 거래만 대상
    const relevant = closedTrades.filter(t => (t.conditionScores?.[id] ?? 0) >= 5);
    if (relevant.length < MIN_CONDITION_TRADES) continue;

    // ADR-0048 (PR-Y4): Learning Coverage 게이트 — 어떤 (조건 × 레짐) 셀도
    // 30건 미만이면 가중치 보정 스킵 (노이즈 학습 차단). LEARNING_COVERAGE_GATE_DISABLED
    // 환경변수 시 무력화 (evaluateConditionCoverage 내부 처리).
    const coverage = evaluateConditionCoverage(relevant);
    if (!coverage.sufficient) {
      coverageGated.push({
        conditionId: id,
        maxCellCount: coverage.maxCellCount,
        reason: 'INSUFFICIENT_COVERAGE',
      });
      continue;
    }

    // ADR-0022 (PR-E): trade-level confidence weighting — lossReason 별 multiplier 로
    // winRate / avgReturn 가중평균. 수익 거래는 항상 1.0, 손실 거래는 lossReason
    // 매핑 (STOP_TOO_TIGHT 0.3 / MACRO_SHOCK 0.2 / OVERHEATED_ENTRY 1.5 등).
    // lossReason 부재 v1/v2 레코드는 1.0 fallback.
    const tradeWeights = relevant.map(t => getTradeLearningWeight(t));
    const weightedTotal = tradeWeights.reduce((s, w) => s + w, 0);
    const wins = relevant.filter(t => (t.returnPct ?? 0) > 0);
    const weightedWins = wins.reduce((s, t) => s + getTradeLearningWeight(t), 0);
    // 0/0 안전 fallback — weightedTotal 이 0 이면 winRate=0 으로 STABLE 진입
    const winRate = weightedTotal > 0 ? weightedWins / weightedTotal : 0;
    const avgReturn = weightedTotal > 0
      ? relevant.reduce((s, t) => s + (t.returnPct ?? 0) * getTradeLearningWeight(t), 0) / weightedTotal
      : 0;

    const prevWeight = currentWeights[id] ?? 1.0;
    let newWeight = prevWeight;

    // ADR-0020 (PR-C): AI/COMPUTED 차등 학습 — relevant trades 의 conditionSources
    // 다수결로 trade-level source 결정 (PR-A v2 레코드만 있음). 부재 시 글로벌 SSOT.
    // Trade 별로 다를 수 있지만 단일 conditionId 의 source 는 안정적으로 동일하므로
    // 대표 1건의 conditionSources[id] 만 추출해도 충분. 부재 시 SOURCE_MAP fallback.
    const tradeSourceOverride = relevant
      .map(t => t.conditionSources?.[id])
      .find((s): s is 'COMPUTED' | 'AI' => s === 'COMPUTED' || s === 'AI');
    const source = resolveSource(id, tradeSourceOverride);
    const sourceMultiplier = getSourceMultiplier(id, tradeSourceOverride);
    const effectiveStep = weightStep * sourceMultiplier;

    if (winRate > upThreshold) {
      newWeight = parseFloat(Math.min(WEIGHT_MAX, prevWeight + effectiveStep).toFixed(2));
    } else if (winRate < downThreshold) {
      newWeight = parseFloat(Math.max(WEIGHT_MIN, prevWeight - effectiveStep).toFixed(2));
    }

    const delta = parseFloat((newWeight - prevWeight).toFixed(2));
    const direction: ConditionCalibration['direction'] =
      delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'STABLE';

    updatedWeights[id] = newWeight;

    // ADR-0023 (PR-F): Profit Factor + Edge Score 진단 메타
    const edgeStats = computeConditionEdge(relevant, winRate, avgReturn);

    calibrations.push({
      conditionId: id,
      conditionName: ALL_CONDITIONS[id].name,
      tradeCount: relevant.length,
      winRate,
      avgReturn,
      prevWeight,
      newWeight,
      direction,
      delta,
      source,
      sourceMultiplier,
      // ADR-0022 (PR-E): 가중평균 진단 메타
      rawTradeCount: relevant.length,
      weightedTradeCount: parseFloat(weightedTotal.toFixed(2)),
      lossReasonBreakdown: summarizeLossReasonBreakdown(relevant),
      // ADR-0023 (PR-F): Profit Factor / Edge Score
      profitFactor: edgeStats.profitFactor,
      avgReturnPosi: edgeStats.avgReturnPosi,
      avgReturnNeg: edgeStats.avgReturnNeg,
      edgeScore: edgeStats.edgeScore,
    });
  }

  // ── 가중치 저장 ────────────────────────────────────────────────────────────
  const saveMap: Record<number, number> = {};
  for (const c of calibrations) {
    if (c.newWeight !== c.prevWeight) saveMap[c.conditionId] = c.newWeight;
  }

  // ADR-0046 (PR-Y1): F2W Drift Detector — 변화의 변화 감시
  //   1. 매 학습 사이클 가중치 σ 누적 (히스토리 SSOT)
  //   2. drift 판정 (sigma7d ≥ sigma30dAvg × 2)
  //   3. drift 시 LIVE saveEvolutionWeights 차단 + pause flag 7일 설정
  //   4. shadow=true 호출은 본 가드 우회 (ADR-0027 grace 보존)
  const now = new Date();
  let pauseStatus: FeedbackLoopResult['pauseStatus'] = undefined;
  let driftBlockedSave = false;

  if (!isShadow) {
    const finalWeights = { ...currentWeights, ...saveMap };
    // 본 사이클 결정된 가중치를 히스토리에 누적
    recordWeightSnapshot(finalWeights, now);
    const history = loadWeightHistory();
    const drift = evaluateDrift(history, now);

    // 기존 pause 가 활성이면 그대로 유지
    const existingPauseUntil = isF2WPausedUntil(now);
    if (existingPauseUntil) {
      driftBlockedSave = true;
      pauseStatus = {
        paused: true,
        until: existingPauseUntil.toISOString(),
        reason: 'pause active',
        ratio: drift.ratio,
        sigma7d: drift.sigma7d,
        sigma30dAvg: drift.sigma30dAvg,
      };
    } else if (drift.drifted) {
      // 신규 drift 감지 → pause 설정
      const pauseState = pauseF2W(drift.reason ?? 'σ7d ≥ σ30d × 2', drift.ratio, now);
      driftBlockedSave = true;
      pauseStatus = {
        paused: true,
        until: pauseState.pausedUntil,
        reason: pauseState.reason,
        ratio: drift.ratio,
        sigma7d: drift.sigma7d,
        sigma30dAvg: drift.sigma30dAvg,
      };
      // drift 알림은 호출자(useTradeOps) 가 결과 객체를 보고 fetch — 본 모듈은
      // 클라이언트 측 순수 함수로 유지 (서버 텔레그램 callsite 와 분리, ADR-0046 §5)
    }
  }

  // ADR-0027 (PR-J): shadow=true → LIVE 가중치 무영향
  // ADR-0046 (PR-Y1): drift 감지 시 LIVE 가중치 동결
  if (Object.keys(saveMap).length > 0 && !isShadow && !driftBlockedSave) {
    saveEvolutionWeights({ ...currentWeights, ...saveMap });
  }

  const boostedCount  = calibrations.filter(c => c.direction === 'UP').length;
  const reducedCount  = calibrations.filter(c => c.direction === 'DOWN').length;
  const lastCalibratedAt = new Date().toISOString();

  const summary = driftBlockedSave
    ? `${closedCount}건 누적 — F2W drift 감지로 가중치 동결 중 (사유: ${pauseStatus?.reason ?? 'drift'})`
    : calibrations.length === 0
      ? `${closedCount}건 누적 — 조건별 데이터 부족 (조건당 최소 ${MIN_CONDITION_TRADES}건 필요)`
      : `${closedCount}건 실전 데이터 반영 — 상향 ${boostedCount}개 / 하향 ${reducedCount}개 조건 조정 완료`;

  return {
    closedTradeCount: closedCount,
    calibrationActive: true,
    calibrationProgress: 1,
    calibrations,
    boostedCount,
    reducedCount,
    lastCalibratedAt,
    summary,
    pauseStatus,
    coverageGated: coverageGated.length > 0 ? coverageGated : undefined,
  };
}

/**
 * ADR-0046 (PR-Y1): drift 알림 페이로드 빌더 — 호출자(예: useTradeOps useEffect)
 * 가 본 함수 결과를 `POST /api/learning/f2w-drift-alert` 로 전송하면 서버가
 * dispatchAlert(JOURNAL) + sendPrivateAlert 일괄 발송.
 *
 * pauseStatus.paused=true + 신규 감지 시점에만 호출. 만료 / shadow / 기존 pause
 * 유지 시에는 호출하지 않음 (24h dedupe 는 서버에서 추가 보장).
 */
export function buildDriftAlertPayload(
  weights: Record<number, number>,
  pauseStatus: NonNullable<FeedbackLoopResult['pauseStatus']>,
): {
  sigma7d: number;
  sigma30dAvg: number;
  ratio: number;
  pausedUntil: string;
  reason: string;
  topConditions: Array<{ conditionId: number; weight: number; deviation: number }>;
} {
  const top = getTopDeviatingConditions(weights, 3);
  return {
    sigma7d: pauseStatus.sigma7d ?? 0,
    sigma30dAvg: pauseStatus.sigma30dAvg ?? 0,
    ratio: pauseStatus.ratio ?? 0,
    pausedUntil: pauseStatus.until ?? '',
    reason: pauseStatus.reason ?? 'F2W drift detected',
    topConditions: top.map(t => ({
      conditionId: t.conditionId,
      weight: t.weight,
      deviation: t.deviation,
    })),
  };
}
