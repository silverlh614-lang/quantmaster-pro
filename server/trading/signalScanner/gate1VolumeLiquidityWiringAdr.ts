// @responsibility Gate1 VOLUME_LIQUIDITY 입력 배선 복구(avgVolume20d/volumeRatio/volume) flag-gated transform SSOT — flag OFF byte-equivalent, provider/store/now/fetch 0.

import type { CandidateEntryTrace } from "./entryFilterDecomposition.js";
import { nestedNumericTraceValue } from "./minimumSignalScoreTrace/traceFieldResolver.js";
import { finite, round1 } from "./minimumSignalScoreTrace/scoring.js";
import {
  computeVolumeLiquidityRatioScore,
  type VolumeLiquidityScore,
} from "./minimumSignalScoreTrace/componentScorers.js";
import { isGate1VolumeLiquidityWiringEnabled } from "../gateConfig.js";

/**
 * trace 의 평균거래량 입력. 기존 scorer 가 읽는 `avgVolume`(quote/quoteFeatures/symbolFeatures
 * 미러) 외에 시스템 카논 필드 `avgVolume20d`(index.ts:91·quote.avgVolume20d)를 포함한다.
 * 신규 fetch 0 — 이미 trace 에 적재된 raw 필드만 재사용. resolveNumericTracePath 의 무점(.)
 * 경로 확장으로 `avgVolume20d` 는 `symbolFeatures.avgVolume20d` 도 함께 탐색된다.
 */
function resolveAvgVolume(trace: CandidateEntryTrace): number | undefined {
  return nestedNumericTraceValue(trace, [
    "avgVolume",
    "avgVolume20d",
    "quote.avgVolume",
    "quote.avgVolume20d",
    "quoteFeatures.avgVolume",
    "quoteFeatures.avgVolume20d",
  ]);
}

/** trace 의 현재(누적)거래량 입력 — 기존 scorer 와 동일 경로 재사용(신규 필드 무도입). */
function resolveCurrentVolume(trace: CandidateEntryTrace): number | undefined {
  return nestedNumericTraceValue(trace, [
    "projectedVolume",
    "volume",
    "quote.projectedVolume",
    "quote.volume",
    "quoteFeatures.projectedVolume",
    "quoteFeatures.volume",
  ]);
}

/** trace 의 사전 계산 거래량 비율 — KIS/Gate3 가 volume/avgVolume20d 를 직접 제공한 경우. */
function resolveVolumeRatio(trace: CandidateEntryTrace): number | undefined {
  return nestedNumericTraceValue(trace, [
    "volumeRatio",
    "quote.volumeRatio",
    "quoteFeatures.volumeRatio",
  ]);
}

/**
 * WIRE_VOLUME_LIQUIDITY_INPUT — flag ON & 현행 base 가 ratio 분기 미진입(VERIFIED 가 아님)
 * & raw volume 입력이 이미 trace 에 존재할 때에만, 기존 ratio 공식
 * (computeVolumeLiquidityRatioScore)으로 점수를 복원한다.
 *
 * - flag OFF → base 그대로(identity, byte-equivalent).
 * - base.confidence === "VERIFIED" (이미 ratio 채점됨) → base 그대로(이중계상 회피).
 * - avgVolume(or avgVolume20d) + currentVolume 존재 → ratio 직접 산출(우선).
 * - 둘 다 없고 사전계산 volumeRatio 존재 → ratio×avgVolume 대용 없이 ratio 자체로 환산
 *   (currentVolume=ratio, avgVolume=1 대입 → 동일 곡선식 입력, 신규 공식 아님).
 * - 진짜 결손(입력 전무) → base 그대로(0 graceful, 불변식 #6 — 페널티 아님).
 *
 * maxScore 12·곡선식·정규화 무변경 — 끊긴 입력 경로만 복원. 신규 fetch 0.
 */
export function applyVolumeLiquidityWiring(
  base: VolumeLiquidityScore,
  trace: CandidateEntryTrace,
  forceEnabled = false,
): VolumeLiquidityScore {
  if (!forceEnabled && !isGate1VolumeLiquidityWiringEnabled()) return base;
  // 현행이 이미 ratio 로 VERIFIED 채점됐으면 무변경(이중계상 회피).
  if (base.confidence === "VERIFIED") return base;

  const avgVolume = resolveAvgVolume(trace);
  const currentVolume = resolveCurrentVolume(trace);
  if (finite(avgVolume) && avgVolume > 0 && finite(currentVolume)) {
    return computeVolumeLiquidityRatioScore(
      currentVolume,
      avgVolume,
      "Liquidity contribution restored from existing raw volume (avgVolume20d/volume) input; maxScore 12 ratio formula unchanged.",
    );
  }

  // 사전 계산 volumeRatio 만 존재하는 경우 — ratio 자체를 곡선식 입력으로 환산(currentVolume=ratio,
  // avgVolume=1). 결과는 computeVolumeLiquidityRatioScore(ratio, 1) 과 동일 = 동일 공식 재사용.
  const volumeRatio = resolveVolumeRatio(trace);
  if (finite(volumeRatio) && volumeRatio > 0) {
    return computeVolumeLiquidityRatioScore(
      volumeRatio,
      1,
      "Liquidity contribution restored from existing precomputed volumeRatio input; maxScore 12 ratio formula unchanged.",
    );
  }

  // 입력 진짜 결손 → base 그대로(0 graceful, 페널티 아님, 불변식 #6).
  return base;
}

/**
 * flag-ON 가정 하의 hypothetical delta/score/passed 를 순수 산출(force-ON 모드).
 * base 는 현행(flag OFF) 산출의 VOLUME_LIQUIDITY. 관측 전용 — actualScore/passed 본체 영향 0.
 * provider/store/now/fetch 0. 호출자(minimumSignalScoreTrace)가 try/catch 격리(불변식 #1).
 */
export interface VolumeLiquidityWiringHypothetical {
  /** force-ON 복원 weightedScore − 현행(flag OFF) weightedScore (VOLUME_LIQUIDITY). */
  volumeLiquidityWiringDelta: number;
  /** volumeLiquidityWiringDelta 반영 가상 actualScore. */
  volumeLiquidityWiringHypotheticalActualScore: number;
  /** 가상 actualScore >= requiredScore. */
  volumeLiquidityWiringHypotheticalPassed: boolean;
}

export function computeVolumeLiquidityWiringHypothetical(input: {
  base: VolumeLiquidityScore;
  trace: CandidateEntryTrace;
  actualScore: number;
  requiredScore: number;
}): VolumeLiquidityWiringHypothetical {
  const hydrated = applyVolumeLiquidityWiring(input.base, input.trace, true);
  const delta = round1(hydrated.weightedScore - input.base.weightedScore);
  const hypotheticalActualScore = round1(input.actualScore + delta);
  return {
    volumeLiquidityWiringDelta: delta,
    volumeLiquidityWiringHypotheticalActualScore: hypotheticalActualScore,
    volumeLiquidityWiringHypotheticalPassed:
      hypotheticalActualScore >= input.requiredScore,
  };
}
