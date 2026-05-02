// @responsibility 거절 종목의 사후 성과로 조건별 Over-Strict / Good Defense 분류 SSOT.
/**
 * conditionAttributionShadow.ts — ADR-0087 Shadow → Condition Attribution
 *
 * 사용자 분석 (Shadow 학습 다음 단계 #3):
 *   "거절 종목이 나중에 급등했다면 → 어떤 조건 때문에 탈락했는가? VCP 미충족인데
 *    이후 +25% → VCP 조건이 너무 엄격한지 검토. 반대로 거절한 종목이 폭락했다면
 *    그 조건은 RISK_PROTECTOR 로 강화."
 *
 * `RejectionShadowEntry.conditionScores` (ADR-0087 PR-F schema 확장) 와
 * `currentReturnPct` 결합 분석:
 *
 *   - **Over-Strict** 후보 — 거절 후 ≥ +5% 종목에서 *낮은 점수* (score < 6) 였던 조건
 *     → 너무 엄격한 조건일 가능성. 빈도 ≥ MIN_FREQ 시 후보 등록.
 *
 *   - **Good Defense** 후보 — 거절 후 ≤ -5% 종목에서 *낮은 점수* 였던 조건
 *     → 잘 막아준 조건. 빈도 ≥ MIN_FREQ 시 RISK_PROTECTOR 후보 등록.
 *
 * 본 모듈은 *분석 전용* — LIVE 가중치 영향 0. 실제 조건 강화/완화 정책은 후속 PR.
 *
 * ENV 롤백: `SHADOW_CONDITION_ATTRIBUTION_DISABLED=true` → 빈 결과 반환.
 */

import { CONDITION_NAMES } from './attributionAnalyzer.js';
import {
  getAllRejectionShadow,
  type RejectionShadowEntry,
} from './rejectionShadowTracker.js';

export const SHADOW_ATTRIBUTION_CONSTANTS = {
  /** 거절 후 ≥ 본 임계 % 시 Over-Strict 후보 (alpha 누락) */
  OVER_STRICT_RETURN_THRESHOLD_PCT: 5,
  /** 거절 후 ≤ 본 임계 % 시 Good Defense 후보 (회피 알파) */
  GOOD_DEFENSE_RETURN_THRESHOLD_PCT: -5,
  /** 점수 < 본 임계 시 *해당 조건이 미달* 로 분류 */
  LOW_SCORE_THRESHOLD: 6,
  /** 분류 후보로 등록되려면 빈도 ≥ 본 임계 */
  MIN_FREQUENCY: 3,
  /** UI operator-facing sample sufficiency target. */
  SAMPLE_SUFFICIENT_TARGET: 30,
} as const;

export interface ShadowConditionStat {
  conditionId: number;
  conditionName: string;
  /** Over-Strict 후보 빈도 — 거절 후 ≥+5% 종목에서 score < 6 였던 횟수 */
  overStrictCount: number;
  /** Good Defense 후보 빈도 — 거절 후 ≤-5% 종목에서 score < 6 였던 횟수 */
  goodDefenseCount: number;
  /** Over-Strict 분기 평균 returnPct (>= 0) */
  overStrictAvgReturn: number;
  /** Good Defense 분기 평균 returnPct (<= 0) */
  goodDefenseAvgReturn: number;
  /** Over-Strict / (Over-Strict + Good Defense). >0.7 = 너무 엄격 / <0.3 = 잘 보호 */
  ratio: number;
  classification:
    | 'normal'                  // 빈도 부족 또는 균형
    | 'over_strict_candidate'   // ratio ≥ 0.7, MIN_FREQUENCY 충족
    | 'good_defense_candidate'  // ratio ≤ 0.3, MIN_FREQUENCY 충족
    | 'insufficient';           // 빈도 부족
}

export interface ShadowAttributionReport {
  totalConditions: number;
  /** ENV DISABLED / data 부재 / 정상 */
  status: 'OK' | 'DISABLED' | 'NO_DATA';
  /** 분석된 종결 entry 수 (closed=true 만) */
  closedSampleSize: number;
  progressTowardSampleSufficient?: {
    current: number;
    target: number;
    eta: string | null;
  };
  conditions: ShadowConditionStat[];
  summary: {
    overStrictCandidates: number;
    goodDefenseCandidates: number;
    insufficient: number;
    normal: number;
  };
}

export function isShadowAttributionDisabled(): boolean {
  return process.env.SHADOW_CONDITION_ATTRIBUTION_DISABLED === 'true';
}

/**
 * 거절 종목 종결 entry 만 사용 — 활성/closed=false 는 분석 제외.
 *
 * 호출자가 conditionScores 를 전달하지 않은 entry 도 자동 제외 (graceful fallback).
 */
function eligibleEntries(entries: RejectionShadowEntry[]): RejectionShadowEntry[] {
  return entries.filter((e) =>
    e.closed === true &&
    e.conditionScores !== undefined &&
    Number.isFinite(e.currentReturnPct ?? NaN),
  );
}

function estimateSampleEta(entries: RejectionShadowEntry[], current: number, target: number): string | null {
  if (current >= target) return 'complete';
  const sortedDates = entries
    .filter((e) => e.closed === true && e.conditionScores !== undefined)
    .map((e) => Date.parse(`${e.signalDate}T00:00:00Z`))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (sortedDates.length < 2) return null;
  const first = sortedDates[0];
  const last = sortedDates[sortedDates.length - 1];
  const spanDays = Math.max(1, (last - first) / 86_400_000);
  const perDay = sortedDates.length / spanDays;
  if (!Number.isFinite(perDay) || perDay <= 0) return null;
  return `${Math.ceil((target - current) / perDay)}d`;
}

function buildSampleProgress(
  allEntries: RejectionShadowEntry[],
  current: number,
): ShadowAttributionReport['progressTowardSampleSufficient'] {
  const target = SHADOW_ATTRIBUTION_CONSTANTS.SAMPLE_SUFFICIENT_TARGET;
  return {
    current,
    target,
    eta: estimateSampleEta(allEntries, current, target),
  };
}

function classifyStat(stat: Pick<ShadowConditionStat, 'overStrictCount' | 'goodDefenseCount' | 'ratio'>): ShadowConditionStat['classification'] {
  const total = stat.overStrictCount + stat.goodDefenseCount;
  if (total < SHADOW_ATTRIBUTION_CONSTANTS.MIN_FREQUENCY) return 'insufficient';
  if (stat.ratio >= 0.7) return 'over_strict_candidate';
  if (stat.ratio <= 0.3) return 'good_defense_candidate';
  return 'normal';
}

/**
 * 27조건별 Over-Strict / Good Defense 분류 산출.
 *
 * 알고리즘:
 *   1. 종결된 entry (closed=true + conditionScores 보유) 만 추출
 *   2. 각 entry 의 returnPct 분기:
 *      - ≥ +5% → Over-Strict bucket (해당 entry 의 *낮은 점수 조건* 들에 +1)
 *      - ≤ -5% → Good Defense bucket
 *      - 그 외 → 무시 (boundary 영역)
 *   3. 27조건별 빈도 + 평균 + ratio + classification 산출
 */
export function analyzeShadowAttribution(): ShadowAttributionReport {
  if (isShadowAttributionDisabled()) {
    return {
      totalConditions: 0,
      status: 'DISABLED',
      closedSampleSize: 0,
      progressTowardSampleSufficient: buildSampleProgress([], 0),
      conditions: [],
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 0, normal: 0 },
    };
  }
  const allEntries = getAllRejectionShadow();
  const eligible = eligibleEntries(allEntries);
  if (eligible.length === 0) {
    return {
      totalConditions: 0,
      status: 'NO_DATA',
      closedSampleSize: 0,
      progressTowardSampleSufficient: buildSampleProgress(allEntries, 0),
      conditions: [],
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 0, normal: 0 },
    };
  }

  // 27조건별 누적
  const overStrictCounts: Map<number, { count: number; sumReturn: number }> = new Map();
  const goodDefenseCounts: Map<number, { count: number; sumReturn: number }> = new Map();

  for (const e of eligible) {
    const ret = e.currentReturnPct ?? 0;
    const isOverStrict = ret >= SHADOW_ATTRIBUTION_CONSTANTS.OVER_STRICT_RETURN_THRESHOLD_PCT;
    const isGoodDefense = ret <= SHADOW_ATTRIBUTION_CONSTANTS.GOOD_DEFENSE_RETURN_THRESHOLD_PCT;
    if (!isOverStrict && !isGoodDefense) continue;

    const scores = e.conditionScores!;
    for (let id = 1; id <= 27; id += 1) {
      // 명시 안 된 conditionId 는 캡처 누락 — 분석 제외 (0 fallback 으로 false positive 회피).
      if (!(id in scores)) continue;
      const score = scores[id] ?? 0;
      if (score >= SHADOW_ATTRIBUTION_CONSTANTS.LOW_SCORE_THRESHOLD) continue;

      // 해당 조건이 미달 (낮은 점수) — 분류 bucket 에 카운트
      if (isOverStrict) {
        const cur = overStrictCounts.get(id) ?? { count: 0, sumReturn: 0 };
        overStrictCounts.set(id, { count: cur.count + 1, sumReturn: cur.sumReturn + ret });
      } else if (isGoodDefense) {
        const cur = goodDefenseCounts.get(id) ?? { count: 0, sumReturn: 0 };
        goodDefenseCounts.set(id, { count: cur.count + 1, sumReturn: cur.sumReturn + ret });
      }
    }
  }

  const conditions: ShadowConditionStat[] = [];
  for (let id = 1; id <= 27; id += 1) {
    const os = overStrictCounts.get(id) ?? { count: 0, sumReturn: 0 };
    const gd = goodDefenseCounts.get(id) ?? { count: 0, sumReturn: 0 };
    const total = os.count + gd.count;
    const ratio = total > 0 ? os.count / total : 0;

    const stat: ShadowConditionStat = {
      conditionId: id,
      conditionName: CONDITION_NAMES[id] ?? `조건 ${id}`,
      overStrictCount: os.count,
      goodDefenseCount: gd.count,
      overStrictAvgReturn: os.count > 0 ? os.sumReturn / os.count : 0,
      goodDefenseAvgReturn: gd.count > 0 ? gd.sumReturn / gd.count : 0,
      ratio,
      classification: 'normal',
    };
    stat.classification = classifyStat(stat);
    conditions.push(stat);
  }

  const summary = {
    overStrictCandidates: conditions.filter((c) => c.classification === 'over_strict_candidate').length,
    goodDefenseCandidates: conditions.filter((c) => c.classification === 'good_defense_candidate').length,
    insufficient: conditions.filter((c) => c.classification === 'insufficient').length,
    normal: conditions.filter((c) => c.classification === 'normal').length,
  };

  return {
    totalConditions: 27,
    status: 'OK',
    closedSampleSize: eligible.length,
    progressTowardSampleSufficient: buildSampleProgress(allEntries, eligible.length),
    conditions,
    summary,
  };
}
