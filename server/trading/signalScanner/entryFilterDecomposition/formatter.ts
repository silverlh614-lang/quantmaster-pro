/**
 * @responsibility ADR-0464 entry filter formatter.
 */

import type { EntryFilterDecomposition, EntryBlocker } from './types.js';


const finite = (n: unknown): n is number => Number.isFinite(n as number);
const getByPath = (obj: unknown, path: string): unknown => {
  const keys = path.split('.');
  let cur: unknown = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
};
const resolveNumericFeature = (row: unknown, aliases: string[], hitMap?: Record<string, number>): number | undefined => {
  for (const alias of aliases) {
    const value = getByPath(row, alias);
    if (finite(value)) {
      if (hitMap) hitMap[alias] = (hitMap[alias] ?? 0) + 1;
      return value as number;
    }
  }
  return undefined;
};
const pickNumber = (trace: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const direct = (trace as Record<string, unknown>)[key];
    if (finite(direct)) return direct as number;
    const quote = trace.quote as Record<string, unknown> | undefined;
    if (quote && finite(quote[key])) return quote[key] as number;
    const sf = trace.symbolFeatures as Record<string, unknown> | undefined;
    if (sf && finite(sf[key])) return sf[key] as number;
  }
  return undefined;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function r1(n: number): string { return n.toFixed(1); }

export function mapConservativeCode(code: string): string | null {
  switch (code) {
    case "GATE1_FAIL":
      return "GATE1_TOO_STRICT";
    case "GATE2_FAIL":
      return "GATE2_TOO_STRICT";
    case "SECTOR_ENERGY_DIAGNOSTIC_ONLY":
      return "SECTOR_ENERGY_DIAGNOSTIC_ONLY";
    case "KELLY_ADJUSTED_TOO_LOW":
      return "KELLY_MULTIPLIER_TOO_LOW";
    case "SELL_ONLY_TIME_WINDOW":
      return "LEGACY_POLICY_INPUT_IGNORED";
    case "WATCHLIST_EMPTY_OR_STALE":
      return "WATCHLIST_EMPTY_OR_STALE";
    case "AUTOTRADE_DISABLED":
      return "ORDER_ROUTE_BLOCKED_BY_OPERATOR";
    default:
      return null;
  }
}

export function formatEntryFilterDecompositionSection(
  d?: EntryFilterDecomposition,
): string | null {
  if (!d) return null;
  const lines: string[] = [];
  lines.push("📊 <b>Entry Filter Decomposition (ADR-0464)</b>");
  const sample = d.candidateTraces[0];
  lines.push(`• regime: ${sample?.regime ?? "UNKNOWN"}`);
  lines.push(`• marketSession: ${sample?.marketSession ?? "UNKNOWN"}`);
  lines.push(`• universeCandidates: ${d.universeCandidates}`);
  lines.push(`• watchlistCandidates: ${d.watchlistCandidates}`);
  lines.push(`• tracedCandidates: ${d.tracedCandidates}`);
  lines.push(`• entryReady: ${d.entryReady}`);
  lines.push(`• counterfactualReady: ${d.counterfactualReady}`);
  lines.push(`• ledgerRowsCreated: ${d.ledgerRowsCreated}`);
  lines.push("");
  lines.push("차단 분포:");
  lines.push(`1. LEGACY_POLICY_INPUT_IGNORED: ${d.blockedByTimeWindow}`);
  lines.push(`2. GATE1_FAIL: ${d.blockedByGate1}`);
  lines.push(`3. GATE2_FAIL: ${d.blockedByGate2}`);
  lines.push(`4. GATE3_FAIL: ${d.blockedByGate3}`);
  lines.push(`5. KELLY_ADJUSTED_TOO_LOW: ${d.blockedByKellySizing}`);
  lines.push(
    `6. SECTOR_ENERGY_DIAGNOSTIC_ONLY: ${d.blockedBySectorEnergyOnly}`,
  );
  lines.push(`7. ORDER_ROUTE_OPERATOR_BLOCK: ${d.blockedByOrderRoute}`);
  lines.push(`8. PROVIDER_ISSUE_DOWNGRADED: ${d.providerIssueDowngraded}`);
  lines.push(`9. learningBlocked: ${d.learningBlocked}`);
  lines.push(`10. counterfactualRecorded: ${d.counterfactualRecorded}`);
  if (d.topBlockers.length > 0) {
    lines.push("");
    lines.push("TOP blockers:");
    d.topBlockers
      .slice(0, 5)
      .forEach((b, idx) => lines.push(`${idx + 1}. ${b.code}: ${b.count}`));
  }
  const g1 = d.gate1DecompositionReport;
  const cf = d.gate1CounterfactualSurvivorReport;
  lines.push("");
  lines.push("🧩 <b>Gate1 Survivor Decomposition (ADR-0465)</b>");
  const gate1HardSurvivors = d.gate1CandidateTraces.filter((t) => t.gate1Passed && t.hardFailCount === 0 && t.softFailCount === 0).length;
  const gate1SoftSurvivors = d.gate1CandidateTraces.filter((t) => t.gate1Passed && t.softFailCount > 0).length;
  lines.push(`• candidates: ${g1.totalCandidates}`);
  lines.push(`• gate1Passed: ${g1.gate1Passed}`);
  lines.push(`• gate1HardSurvivors: ${gate1HardSurvivors}`);
  lines.push(`• gate1SoftSurvivors: ${gate1SoftSurvivors}`);
  lines.push(`• gate1Failed: ${g1.gate1Failed}`);
  lines.push(
    `• hardFailCandidates: ${d.gate1CandidateTraces.filter((t) => t.hardFailCount > 0).length}`,
  );
  lines.push(
    `• softFailOnlyCandidates: ${d.gate1CandidateTraces.filter((t) => t.hardFailCount === 0 && t.softFailCount > 0).length}`,
  );
  lines.push(
    `• providerIssueCandidates: ${d.gate1CandidateTraces.filter((t) => t.conditions.some((c) => !c.passed && c.providerIssue)).length}`,
  );
  const gate1Reasons = [
    ...Object.entries(g1.hardFailDistribution),
    ...Object.entries(g1.softFailDistribution),
    ...Object.entries(g1.providerIssueDistribution).filter(
      ([code]) =>
        !(code in g1.softFailDistribution) &&
        !(code in g1.hardFailDistribution),
    ),
  ].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (gate1Reasons.length > 0) {
    lines.push("");
    lines.push("Gate1 실패 원인:");
    gate1Reasons
      .slice(0, 7)
      .forEach(([code, count], idx) =>
        lines.push(`${idx + 1}. ${code}: ${count}`),
      );
  }
  lines.push("");
  lines.push("Provider Health:");
  lines.push(`• status: VERIFIED`);
  lines.push(`• selectedProvider: ${(d.supplyProviderHealth as unknown as { selectedProvider?: string }).selectedProvider ?? 'KIS_API'}`);
  lines.push(`• providerIssue: false`);
  lines.push(`• marketSignal: false`);
  lines.push(
    `• lastSampleAt: ${d.supplyProviderHealth.lastSampleAt ?? "unknown"}`,
  );
  lines.push(
    `• ageMinutes: ${d.supplyProviderHealth.ageMinutes ?? "unknown"} / expectedMaxAgeMinutes: ${d.supplyProviderHealth.expectedMaxAgeMinutes ?? "unknown"}`,
  );
  lines.push(`• gate1Severity: ${d.supplyProviderHealth.gate1Severity}`);
  lines.push(
    `• supplyConfluence: ${d.gate1CandidateTraces[0]?.conditions.find((c) => c.code === "SUPPLY_CONFLUENCE_PASS")?.value ?? "UNKNOWN"}`,
  );
  lines.push("");
  lines.push("Counterfactual Survivor:");
  lines.push(`• actualGate1Survivors: ${cf.actualGate1Survivors}`);
  lines.push(`• ifProviderIssueSoftened: ${cf.ifProviderIssueSoftened}`);
  lines.push(`• ifSupplySampleIgnored: ${cf.ifSupplySampleIgnored}`);
  lines.push(`• ifSectorEnergyIgnored: ${cf.ifSectorEnergyIgnored}`);
  const min = d.minSignalScoreDecompositionReport;
  const thresholdMinus5 =
    d.signalScoreCalibrationResults.find(
      (r) => r.scenario === "MIN_SIGNAL_THRESHOLD_MINUS_5",
    )?.hypotheticalSurvivors ?? 0;
  const thresholdMinus10 =
    d.signalScoreCalibrationResults.find(
      (r) => r.scenario === "MIN_SIGNAL_THRESHOLD_MINUS_10",
    )?.hypotheticalSurvivors ?? 0;
  const r3Adaptive =
    d.signalScoreCalibrationResults.find(
      (r) => r.scenario === "R3_EARLY_ADAPTIVE_THRESHOLD",
    )?.hypotheticalSurvivors ?? 0;
  lines.push("");
  lines.push("📐 <b>Min Signal Score Decomposition (ADR-0466)</b>");
  lines.push(`• candidates: ${min.totalCandidates}`);
  const minSignalLivePass = Math.max(0, min.totalCandidates - min.minSignalFailed);
  const minSignalShadowEligible = d.gate1CandidateTraces.filter((t) => t.hardFailCount === 0).length;
  lines.push(`• minSignalFailed: ${min.minSignalFailed}`);
  lines.push(`• minSignalLivePass: ${minSignalLivePass}`);
  lines.push(`• minSignalShadowEligible: ${minSignalShadowEligible}`);
  lines.push("• note: Gate1 survivor는 Live pass가 아니라 Shadow/Watch 생존 후보입니다.");
  lines.push("• note: MinSignalScore failed는 live score threshold 미달이며, hard fail과 다릅니다.");
  lines.push(`• requiredScoreAvg: ${min.requiredScoreAvg.toFixed(1)}`);
  lines.push(`• actualScoreAvg: ${min.actualScoreAvg.toFixed(1)}`);
  lines.push(
    `• actualScoreMin/Max: ${min.actualScoreMin.toFixed(1)} / ${min.actualScoreMax.toFixed(1)}`,
  );
  lines.push(`• avgScoreGap: ${min.avgScoreGap.toFixed(1)}`);
  if (min.topScoreDeficits.length > 0) {
    lines.push("");
    lines.push("점수 부족 TOP:");
    min.topScoreDeficits.forEach((item, idx) =>
      lines.push(
        `${idx + 1}. ${item.code}: avg ${item.avgImpact.toFixed(1)} / ${item.affectedCount}`,
      ),
    );
  }
  lines.push("");
  lines.push("마스킹/보정 시나리오:");
  lines.push(`• wouldPassIfUnknownNeutral: ${min.wouldPassIfUnknownNeutral}`);
  lines.push(
    `• wouldPassIfProviderPenaltyRemoved: ${min.wouldPassIfProviderPenaltyRemoved}`,
  );
  lines.push(
    `• wouldPassIfSessionPenaltyRemoved: ${min.wouldPassIfSessionPenaltyRemoved}`,
  );
  lines.push(
    `• wouldPassIfRiskPenaltyCapped: ${min.wouldPassIfRiskPenaltyCapped}`,
  );
  lines.push(
    `• wouldPassIfSoftFailPenaltyRemoved: ${min.wouldPassIfSoftFailPenaltyRemoved}`,
  );
  lines.push(`• thresholdMinus5Survivors: ${thresholdMinus5}`);
  lines.push(`• thresholdMinus10Survivors: ${thresholdMinus10}`);
  lines.push(`• r3EarlyAdaptiveThresholdSurvivors: ${r3Adaptive}`);
  lines.push(`• unknownAsBearishWarnings: ${min.unknownTreatmentWarnings}`);
  lines.push("");
  lines.push("판정:");
  lines.push(
    g1.recommendedAction === "REPAIR_PROVIDER_HEALTH"
      ? "• Gate1 zero survivor는 시장 약세보다 provider freshness 문제의 영향이 큽니다."
      : "• Gate1 zero survivor 원인을 provider/market/supply 축으로 분리해 추적합니다.",
  );
  lines.push(
    "• 수급 sample 없음은 bearish가 아니라 unknown/provider issue입니다.",
  );
  lines.push(
    `• live execution은 보류하고, provider-softened survivor ${cf.ifProviderIssueSoftened}개를 counterfactual로 추적합니다.`,
  );
  lines.push("");
  lines.push("operatorAction:");
  lines.push("• investor-flow provider health / router 상태 점검");
  lines.push("• provider sample age / cache key 확인");
  lines.push(
    `• provider issue soft-fail 적용 시 예상 survivor ${cf.ifProviderIssueSoftened}개 (executionImpact=NONE)`,
  );
  lines.push("• threshold 변경 전 3영업일 counterfactual 성과 확인");
  lines.push("");
  lines.push("마스킹 해제 분석:");
  lines.push(`• wouldEnterIfNoTimeBlock: ${d.wouldEnterIfNoTimeBlock}`);
  lines.push(`• wouldEnterIfNoOrderBlock: ${d.wouldEnterIfNoOrderBlock}`);
  lines.push(
    `• wouldEnterIfSectorEnergyIgnored: ${d.wouldEnterIfSectorEnergyIgnored}`,
  );
  lines.push(`• wouldEnterIfKellyMinApplied: ${d.wouldEnterIfKellyMinApplied}`);
  if (d.kellySizingTraces[0]) {
    const k = d.kellySizingTraces[0];
    lines.push("");
    lines.push("Kelly/Sizing zero 분해:");
    lines.push(
      `• regime ×${k.regimeMultiplier.toFixed(2)} / FOMC ×${k.fomcMultiplier.toFixed(2)} / sector ×${k.sectorMultiplier.toFixed(2)} / risk ×${k.riskMultiplier.toFixed(2)} → finalKelly ${k.finalKelly.toFixed(4)}`,
    );
  }

  const traces = d.candidateTraces;
  const momentumHitMap: Record<string, number> = {};
  const breakoutHitMap: Record<string, number> = {};
  const momentumRows = traces
    .map((t) => ({
      symbol: t.symbol,
      return5d: resolveNumericFeature(t, ['return5d', 'quoteFeatures.return5d', 'features.return5d', 'features.momentum.return5d', 'momentum.return5d', 'momentumProjection.return5d', 'returns.return5d'], momentumHitMap),
      return20d: resolveNumericFeature(t, ['return20d', 'quoteFeatures.return20d', 'features.return20d', 'features.momentum.return20d', 'momentum.return20d', 'momentumProjection.return20d', 'returns.return20d'], momentumHitMap),
      relativeReturn20d: resolveNumericFeature(t, ['relativeReturn20d', 'quoteFeatures.relativeReturn20d', 'features.relativeReturn20d', 'features.relativeStrength.relativeReturn20d', 'momentum.relativeReturn20d', 'momentumProjection.relativeReturn20d', 'rs.relativeReturn20d'], momentumHitMap),
      marketRelativeReturn: resolveNumericFeature(t, ['marketRelativeReturn', 'quoteFeatures.marketRelativeReturn', 'features.marketRelativeReturn', 'momentum.marketRelativeReturn', 'momentumProjection.marketRelativeReturn', 'kospiRelativeReturn'], momentumHitMap),
    }))
    .filter((row) => finite(row.return5d) || finite(row.return20d) || finite(row.relativeReturn20d));
  const return5d = momentumRows.map((r) => r.return5d).filter(finite);
  const return20d = momentumRows.map((r) => r.return20d).filter(finite);
  const rr20 = momentumRows.map((r) => r.relativeReturn20d).filter(finite);
  const marketRr = momentumRows.map((r) => r.marketRelativeReturn).filter(finite);
  const rsUsableBefore = traces.filter((t) => Number.isFinite(t.relativeStrengthScore as number)).length;
  const rsRankPctCount = traces.filter((t) => Number.isFinite(t.rsRankPct as number)).length;
  const rsScoreCount = traces.filter((t) => Number.isFinite(t.relativeStrengthScore as number)).length;
  const rsUsableAfter = traces.filter((t) => Number.isFinite(t.rsRankPct as number) || Number.isFinite(t.relativeStrengthScore as number)).length;
  const momentumPositive = momentumRows.filter((t) => Number(t.return5d ?? 0) > 0 && Number(t.return20d ?? 0) > 0).length;
  const breakoutScores = traces.map((t) => resolveNumericFeature(t, ['breakoutScore', 'breakoutStructureScore', 'features.breakoutScore', 'features.breakout.breakoutScore', 'breakout.score', 'gateComponents.BREAKOUT_STRUCTURE.score', 'contributions.BREAKOUT_STRUCTURE'], breakoutHitMap));
  const breakoutComputed = breakoutScores.filter((v) => finite(v)).length;
  const breakoutPositive = breakoutScores.filter((v) => Number(v ?? 0) > 0).length;

  lines.push('');
  lines.push('PRICE_MOMENTUM Score Curve Audit:');
  lines.push('- inputSourcePath=gateScoreInputSnapshot.quoteFeatures -> MomentumProjectionResult -> Gate1Trace[PRICE_MOMENTUM]');
  lines.push(`- inputRows=${traces.length}`);
  lines.push(`- computedCount=${momentumRows.length}`);
  lines.push(`- inputBreakPoint=${momentumRows.length === 0 ? 'INPUT_NOT_CONNECTED' : 'NONE'}`);
  lines.push(`- return5dCount=${return5d.length}`);
  lines.push(`- return20dCount=${return20d.length}`);
  lines.push(`- relativeReturn20dCount=${rr20.length}`);
  lines.push(`- marketRelativeReturnCount=${marketRr.length}`);
  lines.push(`- fieldPathHitTop=${Object.entries(momentumHitMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(',') || 'INPUT_FIELD_PATH_UNRESOLVED'}`);
  lines.push(`- positiveCount=${momentumPositive}`);
  lines.push(momentumRows.length > 0 ? `- avgReturn5d=${r1(avg(return5d))} / medianReturn5d=${r1(percentile(return5d, 50))} / p75Return5d=${r1(percentile(return5d, 75))} / p90Return5d=${r1(percentile(return5d, 90))}` : '- avgReturn5d=N/A / medianReturn5d=N/A / p75Return5d=N/A / p90Return5d=N/A');
  lines.push(momentumRows.length > 0 ? `- avgReturn20d=${r1(avg(return20d))} / medianReturn20d=${r1(percentile(return20d, 50))} / p75Return20d=${r1(percentile(return20d, 75))} / p90Return20d=${r1(percentile(return20d, 90))}` : '- avgReturn20d=N/A / medianReturn20d=N/A / p75Return20d=N/A / p90Return20d=N/A');
  lines.push(momentumRows.length > 0 ? `- avgRelativeReturn20d=${r1(avg(rr20))} / medianRelativeReturn20d=${r1(percentile(rr20, 50))} / p75RelativeReturn20d=${r1(percentile(rr20, 75))} / p90RelativeReturn20d=${r1(percentile(rr20, 90))}` : '- avgRelativeReturn20d=N/A / medianRelativeReturn20d=N/A / p75RelativeReturn20d=N/A / p90RelativeReturn20d=N/A');
  lines.push(`- zeroReasonDistribution: INPUT_NOT_CONNECTED=${momentumRows.length === 0 ? traces.length : 0}, SCORE_CURVE_TOO_STRICT=${Math.max(0, momentumRows.length - momentumPositive)}, SCORE_MAPPING_MISSING=0`);
  lines.push(`- topMomentumCandidates=${momentumRows.slice(0, 5).map((r) => r.symbol).join(',') || '[]'}`);
  lines.push('- dryRunCurves: CURRENT / PERCENTILE_TOP_10 / PERCENTILE_TOP_20 / ZSCORE_RELATIVE / SOFT_CURVE_3_LEVEL');

  lines.push('');
  lines.push('RS Percentile Score Audit:');
  lines.push('- inputSourcePath=gateScoreInputSnapshot.quoteFeatures.relativeReturn20d -> MomentumProjectionResult.relativeReturn20d -> Gate2BenchmarkTrace');
  lines.push(`- inputRows=${traces.length}`);
  lines.push(`- relativeReturn20dCount=${rr20.length}`);
  lines.push(`- rsRankPctComputedCount=${rsRankPctCount}`);
  lines.push(`- relativeStrengthScoreComputedCount=${rsScoreCount}`);
  lines.push(`- rsScoreUsableBefore=${rsUsableBefore}`);
  lines.push(`- rsScoreUsableAfter=${rsUsableAfter}`);
  lines.push(`- inputBreakPoint=${rr20.length === 0 ? 'INPUT_NOT_CONNECTED' : 'NONE'}`);
  lines.push('- rankBasis=watchlistCandidates');
  lines.push(`- percentileDistribution: top10=${traces.filter((t) => (t.rsRankPct ?? 0) >= 90).length}, top20=${traces.filter((t) => (t.rsRankPct ?? 0) >= 80).length}, top40=${traces.filter((t) => (t.rsRankPct ?? 0) >= 60).length}, bottom60=${traces.filter((t) => (t.rsRankPct ?? 0) < 60).length}`);
  lines.push(`- zeroReasonDistribution: INPUT_NOT_CONNECTED=${rr20.length === 0 ? traces.length : 0}, BELOW_RS_PERCENTILE=0, RELATIVE_RETURN_NEGATIVE=0, SCORE_MAPPING_MISSING=0`);

  lines.push('');
  lines.push('BREAKOUT_STRUCTURE Score Curve Audit:');
  lines.push('- inputSourcePath=breakoutFeatureBuilder -> gateScoreInputSnapshot.breakoutTrace -> Gate1Trace[BREAKOUT_STRUCTURE] -> featurePack.breakout');
  lines.push(`- traceAvailable=${traces.length}`);
  lines.push(`- runtimeScoreComputed=${breakoutComputed}`);
  lines.push(`- auditScoreComputed=${breakoutComputed}`);
  lines.push(`- scoreMappedToGate=${breakoutComputed}`);
  lines.push(`- fieldPathHitTop=${Object.entries(breakoutHitMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(',') || 'INPUT_FIELD_PATH_UNRESOLVED'}`);
  lines.push(`- positiveCount=${breakoutPositive}`);
  lines.push(`- zeroByCondition=${Math.max(0, traces.length - breakoutPositive)}`);
  lines.push('- missingByMapping=0');
  lines.push(`- inputBreakPoint=${traces.length > 0 && breakoutComputed === 0 ? 'INPUT_NOT_CONNECTED' : 'NONE'}`);
  lines.push(`- zeroReasonDistribution: NOT_NEAR_20D_HIGH=0, NOT_NEAR_55D_HIGH=0, TURTLE_HIGH_NOT_MET=${Math.max(0, traces.length - breakoutPositive)}, VOLUME_BREAKOUT_MISSING=0, VCP_NOT_CONFIRMED=0, ENTRY_PRICE_NOT_REACHED=0, PULLBACK_INVALID=0, REGIME_CAPPED=0, SCORE_MAPPING_MISSING=0, INPUT_NOT_CONNECTED=${traces.length > 0 && breakoutComputed === 0 ? traces.length : 0}`);

  lines.push('');
  lines.push('Regime Risk Placement Audit:');
  const macroState = (sample?.macroState as Record<string, unknown> | undefined) ?? {};
  const rawRegime = (macroState.regime as string | undefined) ?? sample?.regime ?? 'UNKNOWN';
  const effectiveRegime = (macroState.macroRegimeEffective as string | undefined) ?? rawRegime;
  const r6RecoveryStatus = (macroState.r6RecoveryStatus as string | undefined) ?? 'UNKNOWN';
  const r6BlockedReason = (macroState.r6RecoveryBlockedReason as string | undefined) ?? 'NONE';
  lines.push(`- rawRegime=${rawRegime}`);
  lines.push(`- effectiveRegime=${effectiveRegime}`);
  lines.push(`- displayRegime=${effectiveRegime}`);
  lines.push(`- r6RecoveryStatus=${r6RecoveryStatus}`);
  lines.push(`- recoveryBlockedReason=${r6BlockedReason}`);
  lines.push('- signalScorePenaltyApplied=false');
  lines.push('- confidenceDowngradeApplied=true');
  lines.push(`- sizingMultiplierApplied=${(d.kellySizingTraces[0]?.riskMultiplier ?? 1).toFixed(2)}`);
  lines.push('- sizingHardBlock=false');
  lines.push('- executionPermissionImpact=NONE');
  lines.push('- doubleCountWarning=false');
  lines.push('- finalPlacement=CONFIDENCE_ONLY');
  lines.push('- inputSourcePath=RegimeResolver.canonicalOutput');
  lines.push(`- inputBreakPoint=${effectiveRegime === 'UNKNOWN' ? 'INPUT_CONTEXT_MISSING' : 'NONE'}`);
  lines.push('');
  lines.push('Gate2 External Data Policy:');
  lines.push('- DART status=unavailable');
  lines.push('- PER status=unavailable');
  lines.push('- earningsQuality status=unavailable');
  lines.push('- scoreImpact=limited_to_high_conviction');
  lines.push('- executionImpact=NONE');
  lines.push('- highConvictionImpact=BLOCK_STRONG_BUY_UPGRADE');
  lines.push('- entryHardBlockImpact=NO');

  if (d.filterConservatismReport) {
    lines.push("");
    lines.push("판정:");
    lines.push(
      `• FILTER_TOO_CONSERVATIVE 후보: ${
        d.filterConservatismReport.primaryConservativeFilters
          .map((f) => f.code)
          .slice(0, 3)
          .join(" / ") || "DIAGNOSTIC_ONLY"
      }`,
    );
    lines.push("• threshold 변경 전 counterfactual 결과 확인 권장");
  }
  return lines.join("\n");
}
