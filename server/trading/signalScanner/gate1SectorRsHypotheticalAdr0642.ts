// @responsibility ADR-0642 Gate1 SECTOR_RELATIVE_STRENGTH(0611) force-ON hypothetical 산출 SSOT — flag 무관 force-ON 관측 전용, 실채점 미반영, provider/store/now/fetch 0.

import type { CandidateEntryTrace } from "./entryFilterDecomposition.js";
import { nestedNumericTraceValue } from "./minimumSignalScoreTrace/traceFieldResolver.js";
import {
  weightedFromNormalized,
  clamp,
  round1,
  finite,
} from "./minimumSignalScoreTrace/scoring.js";

// ADR-0611 SECTOR_RELATIVE_STRENGTH 재활성 capacity (maxScore 0→8). 산식 SSOT 는
// minimumSignalScoreTrace.resolveSectorRsComponentScore 이며 본 모듈은 그 force-ON 분기를
// hypothetical 전용으로 재현한다(실 component scorer 무변경 — 관측 delta 측정만).
const SECTOR_RS_COMPONENT_MAX_SCORE = 8;

/** ADR-0642 0611 force-ON 관측 hypothetical — flag 무관 산출. actualScore/passed 본체 영향 0. */
export interface Adr0642SectorRsHypothetical {
  /** force-ON sector-RS weightedScore − 현행(OFF=0) weightedScore. 양수=완화 여지. */
  sectorRsForceDelta: number;
  /** sectorRsForceDelta 반영 가상 actualScore. */
  sectorRsHypotheticalActualScore: number;
  /** 가상 actualScore >= requiredScore. */
  sectorRsHypotheticalPassed: boolean;
  /** 섹터상대(stock-sector 20d) 입력 가용 여부 — coverage% 분자. */
  sectorRsInputPresent: boolean;
}

/**
 * 섹터상대(stock − sector 20d) 입력만 소비(ADR-0469 dedup 정합 — RS 이중계상 회피).
 * minimumSignalScoreTrace.resolveSectorRsComponentScore 의 입력 resolver 와 동일 필드 집합.
 */
function resolveSectorRelative(trace: CandidateEntryTrace): number | undefined {
  return nestedNumericTraceValue(trace, [
    "sectorRelativeReturn20d",
    "featurePack.momentum.sectorRelativeReturn20d",
    "quoteFeatures.sectorRelativeReturn20d",
    "gateLayerSummary.gate2.externalDataCoverage.sectorCycle.values.stockVsSectorReturn20d",
    "gate2ExternalDataCoverage.sectorCycle.values.stockVsSectorReturn20d",
  ]);
}

/** force-ON 가정 sector-RS weightedScore(0~8). 입력 부재 → 0(결손≠페널티, 불변식 #6). */
function forceOnSectorRsWeighted(sectorRelative: number | undefined): number {
  if (!finite(sectorRelative)) return 0;
  const pct = Math.abs(sectorRelative) <= 1 ? sectorRelative * 100 : sectorRelative;
  const normalizedScore = clamp(((pct + 10) / 20) * 100, 0, 100);
  return weightedFromNormalized(normalizedScore, SECTOR_RS_COMPONENT_MAX_SCORE);
}

/**
 * flag-ON 가정 하의 sector-RS hypothetical 을 순수 산출(force-ON 모드).
 * currentSectorRsWeighted 는 현행(flag OFF=0) component weightedScore.
 * 관측 전용 — actualScore/passed 본체 영향 0. provider/store/now/fetch 0.
 */
export function computeSectorRsHypothetical(input: {
  trace: CandidateEntryTrace;
  currentSectorRsWeighted: number;
  actualScore: number;
  requiredScore: number;
}): Adr0642SectorRsHypothetical {
  const sectorRelative = resolveSectorRelative(input.trace);
  const forceOnWeighted = forceOnSectorRsWeighted(sectorRelative);
  const delta = round1(forceOnWeighted - input.currentSectorRsWeighted);
  const hypotheticalActualScore = round1(input.actualScore + delta);
  return {
    sectorRsForceDelta: delta,
    sectorRsHypotheticalActualScore: hypotheticalActualScore,
    sectorRsHypotheticalPassed: hypotheticalActualScore >= input.requiredScore,
    sectorRsInputPresent: finite(sectorRelative),
  };
}
