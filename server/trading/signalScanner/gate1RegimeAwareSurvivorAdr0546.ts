// @responsibility ADR-0546 Phase2 prep — Gate1 레짐 인식 임계 survivor 관측(섀도 전용, flag OFF 불변).

import type { Gate1DryRunObservationRow } from './gate1DryRunObservationLedgerAdr0476.js';
import {
  GATE1_SCORE_SCALE,
  LEGACY_GATE1_REQUIRED_SCORE,
  getRegimeAwareGate1RequiredScore,
  isGate1RegimeAwareRequiredEnabled,
} from '../gateConfig.js';

/**
 * ADR-0546 Phase 2 prep 관측 결과. `GATE1_REGIME_AWARE_REQUIRED=true` 로 전환했을 때
 * 레거시 70 대비 추가로 Gate1 을 통과할 후보 수를 섀도로 집계한다. 플래그 OFF(Phase 1)
 * 라도 항상 계산되며 live/실행 동작에는 영향이 없다(executionImpact=NONE).
 */
export interface Gate1RegimeAwareSurvivorObservation {
  /** 적용 중인 레짐(scoring-effective). */
  regime: string;
  /** 현행 적용 임계(×10). Phase 1 은 항상 LEGACY_GATE1_REQUIRED_SCORE(70). */
  legacyRequiredScore: number;
  /** 레짐 인식 임계(×10) = getEffectiveGateThreshold(regime) × GATE1_SCORE_SCALE. */
  regimeAwareRequiredScore: number;
  /** legacy - regimeAware (양수 = 레짐 완화 여지). */
  regimeAwareGap: number;
  /** 점수가 평가된(스코어 보유) 후보 수 — wouldPass 분모. */
  scoredCandidateCount: number;
  /** finalGate1Score ∈ [regimeAwareRequired, legacyRequired) 인 후보 수 = flag ON 시 추가 통과 추정. */
  regimeAwareWouldPassCount: number;
  /** 추가 통과 후보 심볼(상위 N, forward-outcome 추적용). */
  regimeAwareWouldPassSymbols: string[];
  /** GATE1_REGIME_AWARE_REQUIRED 활성 여부. Phase 1 항상 false. */
  regimeAwareRequiredActive: boolean;
  /** 본 관측은 섀도 전용 — live 주문/Gate 판정 무영향. */
  executionImpact: 'NONE';
}

const MAX_WOULD_PASS_SYMBOLS = 10;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 후보의 real Gate1 final score — finalGate1Score → actualScore → dryRunScore 순 폴백. */
function realGate1Score(row: Gate1DryRunObservationRow): number | null {
  if (finite(row.finalGate1Score)) return row.finalGate1Score;
  if (finite(row.actualScore)) return row.actualScore;
  if (finite(row.dryRunScore)) return row.dryRunScore;
  return null;
}

/**
 * dry-run 관측 row 에서 레짐 인식 survivor 를 집계한다. regime 미전달 시
 * getRegimeAwareGate1RequiredScore 의 R4_NEUTRAL 폴백을 사용한다.
 */
export function buildGate1RegimeAwareSurvivorObservation(
  rows: readonly Gate1DryRunObservationRow[],
  regime?: string,
): Gate1RegimeAwareSurvivorObservation {
  const legacyRequiredScore = LEGACY_GATE1_REQUIRED_SCORE;
  const regimeAwareRequiredScore = Math.round(getRegimeAwareGate1RequiredScore(regime) * 10) / 10;
  const regimeAwareGap = Math.round((legacyRequiredScore - regimeAwareRequiredScore) * 10) / 10;

  const scored: Array<{ symbol: string; score: number }> = [];
  for (const row of rows) {
    const score = realGate1Score(row);
    if (score === null) continue;
    scored.push({ symbol: row.symbol, score });
  }
  const wouldPass = scored.filter(
    (item) => item.score >= regimeAwareRequiredScore && item.score < legacyRequiredScore,
  );

  return {
    regime: regime ?? 'R4_NEUTRAL',
    legacyRequiredScore,
    regimeAwareRequiredScore,
    regimeAwareGap,
    scoredCandidateCount: scored.length,
    regimeAwareWouldPassCount: wouldPass.length,
    regimeAwareWouldPassSymbols: wouldPass
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_WOULD_PASS_SYMBOLS)
      .map((item) => item.symbol),
    regimeAwareRequiredActive: isGate1RegimeAwareRequiredEnabled(),
    executionImpact: 'NONE',
  };
}

/** Score Health/scan_blockers 진단용 단일 라인 렌더 (표시 전용). */
export function formatGate1RegimeAwareSurvivorLine(
  obs: Gate1RegimeAwareSurvivorObservation | null | undefined,
): string {
  if (!obs) {
    return `- regimeAwareWouldPass=N/A (ADR-0546 Phase2 shadow obs; scale=${GATE1_SCORE_SCALE})`;
  }
  const symbols = obs.regimeAwareWouldPassSymbols.length > 0
    ? obs.regimeAwareWouldPassSymbols.join(',')
    : 'none';
  return (
    `- regimeAwareWouldPass=${obs.regimeAwareWouldPassCount}/${obs.scoredCandidateCount} ` +
    `regimeAwareRequired=${obs.regimeAwareRequiredScore.toFixed(1)} legacyRequired=${obs.legacyRequiredScore.toFixed(1)} ` +
    `gap=${obs.regimeAwareGap.toFixed(1)} active=${obs.regimeAwareRequiredActive} symbols=${symbols} ` +
    `(ADR-0546 Phase2 shadow obs; executionImpact=NONE)`
  );
}
