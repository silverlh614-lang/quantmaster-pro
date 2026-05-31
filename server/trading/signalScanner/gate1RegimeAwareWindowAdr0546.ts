// @responsibility ADR-0546 Phase2 — Gate1 forward-outcome 통계 + regime-aware 완화 창 롤업 (순수 leaf, 섀도 전용, executionImpact=NONE).

import type { Gate1DryRunObservationRow } from './gate1DryRunObservationLedgerAdr0476.js';
import {
  LEGACY_GATE1_REQUIRED_SCORE,
  getRegimeAwareGate1RequiredScore,
  isGate1RegimeAwareRequiredEnabled,
} from '../gateConfig.js';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * ADR-0546 Phase2 — forward-outcome 통계(D1/D3/D5 평균·승률·MFE/MAE·expectancyR).
 * scoreBandTable 의 band 별 통계와 regimeAwareWindow 롤업이 *동일 머신*을 공유하도록 추출했다.
 * 순수 함수 — row 집합만 받아 통계를 낸다(executionImpact=NONE).
 */
export interface Gate1ForwardWindowStats {
  matureD1: number;
  matureD3: number;
  matureD5: number;
  avgReturnD1: number | 'N/A';
  avgReturnD3: number | 'N/A';
  avgReturnD5: number | 'N/A';
  winRateD5: number | 'N/A';
  hitPlus3PctRate: number | 'N/A';
  hitMinus3PctRate: number | 'N/A';
  avgMFE: number | 'N/A';
  avgMAE: number | 'N/A';
  expectancyR: number | 'N/A';
}

export function computeForwardWindowStats(rows: readonly Gate1DryRunObservationRow[]): Gate1ForwardWindowStats {
  const maturedD1Rows = rows.filter((row) => finite(row.forwardReturn1D));
  const maturedD3Rows = rows.filter((row) => finite(row.forwardReturn3D));
  const maturedD5Rows = rows.filter((row) => finite(row.forwardReturn5D));
  const avgValue = (values: number[]): number | 'N/A' => (values.length > 0
    ? round1(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 'N/A');
  const rateValue = (ok: number, total: number): number | 'N/A' => (total > 0 ? round1((ok / total) * 100) : 'N/A');
  const d5Returns = maturedD5Rows.map((row) => row.forwardReturn5D as number);
  const mfeValues = maturedD5Rows
    .map((row) => row.mfeD5 ?? row.maxFavorableExcursion5D)
    .filter(finite);
  const maeValues = maturedD5Rows
    .map((row) => row.maeD5 ?? row.maxAdverseExcursion5D)
    .filter(finite);
  return {
    matureD1: maturedD1Rows.length,
    matureD3: maturedD3Rows.length,
    matureD5: maturedD5Rows.length,
    avgReturnD1: avgValue(maturedD1Rows.map((row) => row.forwardReturn1D as number)),
    avgReturnD3: avgValue(maturedD3Rows.map((row) => row.forwardReturn3D as number)),
    avgReturnD5: avgValue(d5Returns),
    winRateD5: rateValue(d5Returns.filter((value) => value > 0).length, d5Returns.length),
    hitPlus3PctRate: rateValue(d5Returns.filter((value) => value >= 3).length, d5Returns.length),
    hitMinus3PctRate: rateValue(d5Returns.filter((value) => value <= -3).length, d5Returns.length),
    avgMFE: avgValue(mfeValues),
    avgMAE: avgValue(maeValues),
    expectancyR: avgValue(d5Returns.map((value) => value / 3)),
  };
}

/**
 * ADR-0546 Phase2 — regime-aware 완화 창([regimeAwareRequired, legacyRequired)) 의 forward 성과 롤업.
 * "40점 기준이면 통과하지만 70점 기준이라 막힌" 후보들이 실제 D1/D3/D5 에서 어떤 성과를 냈는지
 * scoreBandTable 과 동일 머신으로 추적한다. liveThresholdAutoChanged=false — 관측 전용, operator 검토 근거.
 */
export interface Gate1RegimeAwareWindowRollup {
  regime: string;
  regimeAwareRequiredScore: number;
  legacyRequiredScore: number;
  regimeAwareGap: number;
  /** 창 안에 든 관측 row 수(= flag ON 시 추가 통과 추정). */
  windowSampleCount: number;
  regimeAwareRequiredActive: boolean;
  /** 창 후보 vs 70+ 후보의 성과 우열 판정 — operator 가 감으로 낮추지 않게 하는 근거. */
  verdict: 'INSUFFICIENT_SAMPLE' | 'WINDOW_UNDERPERFORMS_70PLUS' | 'WINDOW_COMPARABLE_TO_70PLUS' | 'WINDOW_OUTPERFORMS_70PLUS';
  forward: Gate1ForwardWindowStats;
}

/** dryRunScore — 미점수 row 는 NEGATIVE_INFINITY (창/밴드 밖). */
function scoreOf(row: Gate1DryRunObservationRow): number {
  return finite(row.dryRunScore) ? (row.dryRunScore as number) : Number.NEGATIVE_INFINITY;
}

/** row 의 effectiveRegime → regime 최빈값 (창 임계 산출용 dominant regime). */
function dominantRegimeOf(rows: readonly Gate1DryRunObservationRow[]): string | undefined {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const regime = row.effectiveRegime ?? row.regime;
    if (!regime) continue;
    counts.set(regime, (counts.get(regime) ?? 0) + 1);
  }
  let top: string | undefined;
  let topCount = 0;
  for (const [regime, count] of counts) {
    if (count > topCount) { top = regime; topCount = count; }
  }
  return top;
}

/**
 * regime-aware 완화 창 롤업을 산출한다. b70MatureD5 는 비교 대조군(70+ 밴드)의 D5 성숙 표본 수,
 * b70AvgReturnD5 는 그 평균 — 둘 다 호출자가 동일 row 집합에서 계산해 전달한다(중복 계산 방지).
 */
export function buildGate1RegimeAwareWindowRollup(
  rows: readonly Gate1DryRunObservationRow[],
  b70SampleCount: number,
  b70AvgReturnD5: number | 'N/A',
): Gate1RegimeAwareWindowRollup {
  const dominantRegime = dominantRegimeOf(rows);
  const regimeAwareRequiredScore = round1(getRegimeAwareGate1RequiredScore(dominantRegime));
  const windowRows = rows.filter((row) => {
    const s = scoreOf(row);
    return s >= regimeAwareRequiredScore && s < LEGACY_GATE1_REQUIRED_SCORE;
  });
  const forward = computeForwardWindowStats(windowRows);
  const verdict = ((): Gate1RegimeAwareWindowRollup['verdict'] => {
    const windowAvg = forward.avgReturnD5;
    // 양쪽 모두 D5 성숙 표본이 30 이상일 때만 우열 판정 — 그 전엔 INSUFFICIENT_SAMPLE.
    if (forward.matureD5 < 30 || b70SampleCount < 30 || windowAvg === 'N/A' || b70AvgReturnD5 === 'N/A') {
      return 'INSUFFICIENT_SAMPLE';
    }
    if (windowAvg < b70AvgReturnD5 - 0.5) return 'WINDOW_UNDERPERFORMS_70PLUS';
    if (windowAvg > b70AvgReturnD5 + 0.5) return 'WINDOW_OUTPERFORMS_70PLUS';
    return 'WINDOW_COMPARABLE_TO_70PLUS';
  })();
  return {
    regime: dominantRegime ?? 'R4_NEUTRAL',
    regimeAwareRequiredScore,
    legacyRequiredScore: LEGACY_GATE1_REQUIRED_SCORE,
    regimeAwareGap: round1(LEGACY_GATE1_REQUIRED_SCORE - regimeAwareRequiredScore),
    windowSampleCount: windowRows.length,
    regimeAwareRequiredActive: isGate1RegimeAwareRequiredEnabled(),
    verdict,
    forward,
  };
}

function cell(value: number | 'N/A' | undefined): string {
  return value === undefined || value === 'N/A' ? 'N/A' : String(value);
}

/**
 * Gate1 Threshold Evidence 섹션의 "Regime-Aware Window" 블록 렌더 (표시 전용).
 * rollup 부재(immature summary) 시 N/A skeleton 을 낸다.
 */
export function formatGate1RegimeAwareWindowLines(rollup?: Gate1RegimeAwareWindowRollup | null): string[] {
  const f = rollup?.forward;
  return [
    '',
    'Regime-Aware Window (legacy70 vs regime-relaxed):',
    `- regime: ${rollup ? rollup.regime : 'N/A'}`,
    `- window: [${rollup ? rollup.regimeAwareRequiredScore.toFixed(1) : 'N/A'}, ${rollup ? rollup.legacyRequiredScore.toFixed(1) : LEGACY_GATE1_REQUIRED_SCORE.toFixed(1)}) gap=${rollup ? rollup.regimeAwareGap.toFixed(1) : 'N/A'}`,
    `- windowSampleCount: ${rollup ? rollup.windowSampleCount : 'N/A'}`,
    `- regimeAwareRequiredActive: ${rollup ? rollup.regimeAwareRequiredActive : false}`,
    `- matureD1/D3/D5: ${f ? f.matureD1 : 'N/A'}/${f ? f.matureD3 : 'N/A'}/${f ? f.matureD5 : 'N/A'}`,
    `- avgReturnD1/D3/D5: ${cell(f?.avgReturnD1)}/${cell(f?.avgReturnD3)}/${cell(f?.avgReturnD5)}`,
    `- winRateD5: ${cell(f?.winRateD5)}`,
    `- expectancyR: ${cell(f?.expectancyR)}`,
    `- verdict: ${rollup ? rollup.verdict : 'INSUFFICIENT_SAMPLE'}`,
    '- liveThresholdAutoChanged=false (관측 전용, operator 검토 근거)',
    '- executionImpact=NONE',
  ];
}
