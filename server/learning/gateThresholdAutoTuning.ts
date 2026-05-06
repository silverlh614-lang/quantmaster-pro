// @responsibility 게이트 임계 ROC 기반 최적값 산출 SSOT (ADR-0325 Phase 1 — pure)
/**
 * gateThresholdAutoTuning.ts (ADR-0325 Phase 1) — 게이트 임계 자기 진화 *분석기*.
 *
 * 사용자 5/6 명시 — ADR-0008 Kelly Half-Life 와 같은 원리로 게이트 임계도 자가 진화.
 *
 * 본 PR scope (Phase 1, pure SSOT only):
 *   - findOptimalThreshold 순수 함수 — 표본 + score/outcome 입력 → 권장 임계값 산출
 *   - evaluateThresholdShift — 현재 임계 vs 권장 임계 비교 (`hold`/`tighten`/`loosen`/`insufficient`)
 *   - ENV `GATE_THRESHOLD_AUTO_TUNING_DISABLED=true` 우회
 *   - **LIVE 임계 저장 미수행** — 사용자 spec 의 `saveLearnedThreshold` 는 후속 PR
 *     (회귀 위험 격리, 운영자 수동 검토 후 ENV 활성화 결정)
 *
 * ROC 알고리즘:
 *   - 표본 score 값을 후보 임계로 순회 (표본 score 자체가 유일한 의미 있는 cut-point)
 *   - 각 후보에 대해 score ≥ threshold = "PASS 예측" 으로 정의
 *     - WIN 표본 PASS → TP / LOSS 표본 PASS → FP
 *     - WIN 표본 BLOCK → FN / LOSS 표본 BLOCK → TN
 *   - Youden's J = TP/(TP+FN) - FP/(FP+TN) 최대화 임계 선택
 *   - tie-break — 가장 *낮은* threshold (보수적 진입 보존)
 *
 * 안전 제약:
 *   - WIN/LOSS 양쪽 합 ≥ MIN_SAMPLE (default 30) — 통계 신뢰도
 *   - 권장 임계와 현재 임계의 차이 < MIN_SHIFT_PCT (default 5%) → `hold`
 *   - 권장 임계 < 현재 → `loosen` (게이트 완화 후보)
 *   - 권장 임계 > 현재 → `tighten` (게이트 강화 후보)
 */

export const ROC_MIN_SAMPLE = 30;
export const ROC_MIN_SHIFT_PCT = 5;

export interface ScoredOutcome {
  /** 게이트 평가 score (예: rrr, gateScore, kellyMultiplier) */
  score: number;
  /** 결과 outcome — WIN (수익 거래) / LOSS (손실 거래) */
  outcome: 'WIN' | 'LOSS';
}

export interface OptimalThresholdResult {
  /** 권장 임계값 — null = INSUFFICIENT_SAMPLE */
  threshold: number | null;
  /** Youden's J (감도 + 특이도 - 1) — null = INSUFFICIENT_SAMPLE */
  youdenJ: number | null;
  /** WIN 표본 수 */
  winSample: number;
  /** LOSS 표본 수 */
  lossSample: number;
  /** 권장 임계에서의 TP/FP/FN/TN */
  confusion: { tp: number; fp: number; fn: number; tn: number } | null;
}

export type ThresholdShiftDecision =
  | 'hold'
  | 'tighten'
  | 'loosen'
  | 'insufficient_sample'
  | 'disabled';

export interface ThresholdShiftResult {
  decision: ThresholdShiftDecision;
  currentThreshold: number;
  suggestedThreshold: number | null;
  shiftPct: number | null;
  winSample: number;
  lossSample: number;
}

/** ENV `GATE_THRESHOLD_AUTO_TUNING_DISABLED=true` → 우회 (ADR-0157 정확 비교). */
export function isGateThresholdAutoTuningDisabled(): boolean {
  return process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED === 'true';
}

/**
 * Youden's J 최대화로 권장 임계 산출. WIN/LOSS 표본 부재 시 null 반환.
 *
 * 주의: 본 함수는 *분석 산출* 만 수행. LIVE 임계 변경은 호출자 (후속 PR cron) 가
 * 운영자 검토 후 별도 SSOT (gateLearnedThresholdsRepo 미존재) 에 영속.
 */
export function findOptimalThreshold(samples: ScoredOutcome[]): OptimalThresholdResult {
  if (isGateThresholdAutoTuningDisabled()) {
    return { threshold: null, youdenJ: null, winSample: 0, lossSample: 0, confusion: null };
  }
  const valid = samples.filter(
    s => Number.isFinite(s.score) && (s.outcome === 'WIN' || s.outcome === 'LOSS'),
  );
  const wins = valid.filter(s => s.outcome === 'WIN');
  const losses = valid.filter(s => s.outcome === 'LOSS');
  if (wins.length + losses.length < ROC_MIN_SAMPLE) {
    return {
      threshold: null,
      youdenJ: null,
      winSample: wins.length,
      lossSample: losses.length,
      confusion: null,
    };
  }
  // 후보 임계 = 표본 score 의 unique 값 정렬
  const candidates = Array.from(new Set(valid.map(s => s.score))).sort((a, b) => a - b);
  let bestJ = -1;
  let bestThreshold: number | null = null;
  let bestConfusion: { tp: number; fp: number; fn: number; tn: number } | null = null;
  for (const t of candidates) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (const s of wins) {
      if (s.score >= t) tp += 1;
      else fn += 1;
    }
    for (const s of losses) {
      if (s.score >= t) fp += 1;
      else tn += 1;
    }
    const sensitivity = tp + fn > 0 ? tp / (tp + fn) : 0;
    const specificity = fp + tn > 0 ? tn / (fp + tn) : 0;
    const j = sensitivity + specificity - 1;
    // tie-break — 가장 낮은 threshold 선택 (보수적 진입 보존)
    if (j > bestJ) {
      bestJ = j;
      bestThreshold = t;
      bestConfusion = { tp, fp, fn, tn };
    }
  }
  return {
    threshold: bestThreshold,
    youdenJ: bestJ,
    winSample: wins.length,
    lossSample: losses.length,
    confusion: bestConfusion,
  };
}

/**
 * 현재 임계 vs 권장 임계 비교 → 4 분기 결정.
 *
 * 우선순위 SSOT:
 *   1. ENV DISABLED → `disabled`
 *   2. 표본 < ROC_MIN_SAMPLE → `insufficient_sample`
 *   3. |shiftPct| < ROC_MIN_SHIFT_PCT → `hold` (변동 미미)
 *   4. 권장 > 현재 → `tighten`
 *   5. 권장 < 현재 → `loosen`
 */
export function evaluateThresholdShift(
  currentThreshold: number,
  samples: ScoredOutcome[],
): ThresholdShiftResult {
  if (isGateThresholdAutoTuningDisabled()) {
    return {
      decision: 'disabled',
      currentThreshold,
      suggestedThreshold: null,
      shiftPct: null,
      winSample: 0,
      lossSample: 0,
    };
  }
  const opt = findOptimalThreshold(samples);
  if (opt.threshold === null) {
    return {
      decision: 'insufficient_sample',
      currentThreshold,
      suggestedThreshold: null,
      shiftPct: null,
      winSample: opt.winSample,
      lossSample: opt.lossSample,
    };
  }
  const shiftPct = currentThreshold !== 0
    ? ((opt.threshold - currentThreshold) / Math.abs(currentThreshold)) * 100
    : 0;
  if (Math.abs(shiftPct) < ROC_MIN_SHIFT_PCT) {
    return {
      decision: 'hold',
      currentThreshold,
      suggestedThreshold: opt.threshold,
      shiftPct,
      winSample: opt.winSample,
      lossSample: opt.lossSample,
    };
  }
  return {
    decision: shiftPct > 0 ? 'tighten' : 'loosen',
    currentThreshold,
    suggestedThreshold: opt.threshold,
    shiftPct,
    winSample: opt.winSample,
    lossSample: opt.lossSample,
  };
}
