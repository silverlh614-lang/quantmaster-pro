/**
 * @responsibility ADR-0464 symbol feature builder.
 */

import type {
  MacroGateState,
  WaitDistribution,
  GatePassDistribution,
} from "../scanDiagnostics.js";
import {
  buildMinimumSignalScoreTrace,
  buildMinSignalScoreDecompositionReport,
  buildRiskPenaltyTrace,
  buildSignalScoreCalibrationResults,
  buildSoftFailAccumulationTrace,
  buildUnknownDataTreatmentAudit,
  type MinimumSignalScoreTrace,
  type MinSignalScoreDecompositionReport,
  type RiskPenaltyTrace,
  type SignalScoreCalibrationResult,
  type SoftFailAccumulationTrace,
  type UnknownDataTreatmentAudit,
} from "../minimumSignalScoreTrace.js";
import {
  buildEntryDecisionLedgerScoreCeilingRepairSummaryFromScore,
  type EntryDecisionLedgerScoreCeilingRepairSummary,
} from "../gate1ScoreCeilingRepair.js";
import {
  buildEntryDecisionLedgerPenaltyDedupSummaryFromScore,
  type EntryDecisionLedgerPenaltyDedupSummary,
} from "../gate1PenaltyDeduplication.js";
import {
  buildEntryDecisionLedgerRiskDoubleCountSummaryFromScore,
  type EntryDecisionLedgerRiskDoubleCountSummary,
} from "../gate1RiskDoubleCount.js";
import {
  buildEntryDecisionLedgerFinalCalibrationSummaryFromScore,
  type EntryDecisionLedgerFinalCalibrationSummary,
} from "../gate1FinalCalibration.js";
import {
  buildEntryDecisionLedgerPositiveSourceWiringSummaryFromScore,
  type EntryDecisionLedgerPositiveSourceWiringSummary,
} from "../gate1PositiveSourceWiringAdr0475.js";
import {
  resolveWatchlistUpstreamScore,
  type ResolvedWatchlistUpstreamScore,
} from "../watchlistUpstreamScoreResolver.js";
import type { GateConditionResultTrace } from "../gateConditionResultTrace.js";
import type { SanitizedInvestorFlowSemanticRow } from "../../../supply/investorFlowSemanticAvailability.js";
import {
  extractGateLayerQuoteFeatureValues,
  finitePositiveFeature,
} from "../gatePositiveFeatureMaterializer.js";
import type { CandidateSnapshot, Gate1SymbolFeatures } from './types.js';

export function finiteFeature(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function quoteFeature(c: CandidateSnapshot, key: string): number | undefined {
  const sources = [c.quoteFeatures, c.quote];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const value = finiteFeature((source as Record<string, unknown>)[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function buildSymbolFeatures(
  c: CandidateSnapshot,
): Gate1SymbolFeatures | undefined {
  const provided = c.symbolFeatures ?? {};
  const featurePack = (c as unknown as Record<string, unknown>).featurePack as Record<string, unknown> | undefined;
  const momentum = featurePack && typeof featurePack.momentum === 'object' ? featurePack.momentum as Record<string, unknown> : undefined;
  const momentumProjection = (c as unknown as Record<string, unknown>).momentumProjection as Record<string, unknown> | undefined;
  const gateLayerFeatures = extractGateLayerQuoteFeatureValues(c);
  const breakout = featurePack && typeof featurePack.breakout === 'object' ? featurePack.breakout as Record<string, unknown> : undefined;
  const breakoutTrace = (c as unknown as Record<string, unknown>).breakoutTrace as Record<string, unknown> | undefined;
  const features: Gate1SymbolFeatures = {
    ...provided,
    price:
      provided.price ??
      finiteFeature(c.price) ??
      finiteFeature(c.currentPrice) ??
      quoteFeature(c, "price") ??
      quoteFeature(c, "currentPrice") ??
      finitePositiveFeature(gateLayerFeatures.price),
    currentPrice:
      ((provided as Record<string, unknown>).currentPrice as number | undefined) ??
      finiteFeature(c.currentPrice) ??
      quoteFeature(c, "currentPrice") ??
      quoteFeature(c, "price") ??
      finitePositiveFeature(gateLayerFeatures.currentPrice),
    high5d:
      ((provided as Record<string, unknown>).high5d as number | undefined) ??
      finiteFeature(c.high5d) ??
      quoteFeature(c, "high5d") ??
      finitePositiveFeature(gateLayerFeatures.high5d),
    high20d:
      ((provided as Record<string, unknown>).high20d as number | undefined) ??
      finiteFeature(c.high20d) ??
      quoteFeature(c, "high20d") ??
      finitePositiveFeature(gateLayerFeatures.high20d),
    high60:
      ((provided as Record<string, unknown>).high60 as number | undefined) ??
      finiteFeature(c.high60) ??
      quoteFeature(c, "high60") ??
      finitePositiveFeature(gateLayerFeatures.high60),
    volumeRatio:
      ((provided as Record<string, unknown>).volumeRatio as number | undefined) ??
      finiteFeature(c.volumeRatio) ??
      quoteFeature(c, "volumeRatio") ??
      finitePositiveFeature(gateLayerFeatures.volumeRatio),
    ma20: provided.ma20 ?? finiteFeature(c.ma20) ?? quoteFeature(c, "ma20") ?? finitePositiveFeature(gateLayerFeatures.ma20),
    ma60: provided.ma60 ?? finiteFeature(c.ma60) ?? quoteFeature(c, "ma60") ?? finitePositiveFeature(gateLayerFeatures.ma60),
    return5d:
      provided.return5d ??
      finiteFeature(c.return5d) ??
      quoteFeature(c, "return5d") ??
      finiteFeature(momentum?.return5d) ??
      finiteFeature(momentumProjection?.return5d) ??
      finitePositiveFeature(gateLayerFeatures.return5d),
    return20d:
      provided.return20d ??
      finiteFeature(c.return20d) ??
      quoteFeature(c, "return20d") ??
      finiteFeature(momentum?.return20d) ??
      finiteFeature(momentumProjection?.return20d) ??
      finitePositiveFeature(gateLayerFeatures.return20d),
    volume:
      provided.volume ?? finiteFeature(c.volume) ?? quoteFeature(c, "volume") ?? finitePositiveFeature(gateLayerFeatures.volume),
    avgVolume:
      provided.avgVolume ??
      finiteFeature(c.avgVolume) ??
      quoteFeature(c, "avgVolume") ??
      finitePositiveFeature(gateLayerFeatures.avgVolume),
    projectedVolume:
      provided.projectedVolume ?? finiteFeature(c.projectedVolume),
    rsi14: provided.rsi14 ?? finiteFeature(c.rsi14) ?? quoteFeature(c, "rsi14") ?? finitePositiveFeature(gateLayerFeatures.rsi14),
    atr: provided.atr ?? finiteFeature(c.atr) ?? quoteFeature(c, "atr") ?? finitePositiveFeature(gateLayerFeatures.atr),
    atr20avg:
      provided.atr20avg ??
      finiteFeature(c.atr20avg) ??
      quoteFeature(c, "atr20avg") ??
      finitePositiveFeature(gateLayerFeatures.atr20avg),
    kospi20dReturn:
      provided.kospi20dReturn ??
      finiteFeature(c.kospi20dReturn) ??
      quoteFeature(c, "kospi20dReturn") ??
      finiteFeature(momentum?.kospi20dReturn) ??
      finiteFeature(momentumProjection?.kospi20dReturn) ??
      finitePositiveFeature(gateLayerFeatures.kospi20dReturn),
    marketRelativeReturn:
      provided.marketRelativeReturn ??
      finiteFeature(c.marketRelativeReturn) ??
      quoteFeature(c, "marketRelativeReturn") ??
      finiteFeature(momentum?.marketRelativeReturn) ??
      finiteFeature(momentumProjection?.marketRelativeReturn) ??
      finitePositiveFeature(gateLayerFeatures.marketRelativeReturn),
    kospiRelativeReturn:
      provided.kospiRelativeReturn ??
      finiteFeature(c.kospiRelativeReturn) ??
      quoteFeature(c, "kospiRelativeReturn") ??
      finiteFeature(momentum?.kospiRelativeReturn) ??
      finiteFeature(momentumProjection?.kospiRelativeReturn) ??
      finitePositiveFeature(gateLayerFeatures.kospiRelativeReturn),
    relativeReturn20d:
      provided.relativeReturn20d ??
      finiteFeature(c.relativeReturn20d) ??
      quoteFeature(c, "relativeReturn20d") ??
      finiteFeature(momentum?.relativeReturn20d) ??
      finiteFeature(momentumProjection?.relativeReturn20d) ??
      finitePositiveFeature(gateLayerFeatures.relativeReturn20d),
    rsRankPct:
      provided.rsRankPct ??
      finiteFeature(c.rsRankPct) ??
      quoteFeature(c, "rsRankPct") ??
      finiteFeature(momentum?.rsRankPct) ??
      finiteFeature(momentumProjection?.rsRankPct),
    sector:
      provided.sector ??
      (typeof (c as unknown as Record<string, unknown>).sector === "string"
        ? (c as unknown as Record<string, string>).sector
        : undefined),
    gateScore: provided.gateScore ?? finiteFeature(c.gateScore),
    stage1Score: provided.stage1Score ?? finiteFeature(c.stage1Score),
    stage2Score: provided.stage2Score ?? finiteFeature(c.stage2Score),
    totalGateScore: provided.totalGateScore ?? finiteFeature(c.totalGateScore),
    watchlistPriorityScore:
      provided.watchlistPriorityScore ??
      finiteFeature(c.priorityScore) ??
      finiteFeature(c.watchlistScore) ??
      finiteFeature(c.watchlistUpstreamScore),
    relativeStrengthScore:
      provided.relativeStrengthScore ??
      finiteFeature(c.relativeStrengthScore) ??
      quoteFeature(c, "relativeStrengthScore") ??
      finiteFeature(momentum?.relativeStrengthScore),
    breakoutScore:
      provided.breakoutScore ??
      finiteFeature(c.breakoutScore) ??
      finiteFeature(breakoutTrace?.breakoutScore) ??
      finiteFeature(breakout?.breakoutScore),
    vcpScore:
      provided.vcpScore ??
      finiteFeature(c.vcpScore) ??
      finiteFeature(breakoutTrace?.vcpScore) ??
      finiteFeature(breakout?.vcpScore) ??
      finiteFeature(breakout?.volumeDryupScore),
  };
  const watchlistScore = resolveWatchlistUpstreamScore({
    ...c,
    symbolFeatures: { ...provided, ...features },
  });
  features.watchlistScore = watchlistScore;
  return Object.values(features).some((value) => value !== undefined)
    ? features
    : undefined;
}
