/**
 * @responsibility ADR-0464 entry filter formatter.
 */

import type { EntryFilterDecomposition, EntryBlocker } from './types.js';

export function mapConservativeCode(code: string): string | null {
  switch (code) {
    case "GATE1_FAIL":
      return "GATE1_TOO_STRICT";
    case "GATE2_FAIL":
      return "GATE2_TOO_STRICT";
    case "SECTOR_ENERGY_DIAGNOSTIC_ONLY":
      return "SECTOR_ENERGY_STRONG_BUY_BLOCK_ONLY";
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
  lines.push(`• status: ${d.supplyProviderHealth.status}`);
  lines.push(`• providerIssue: ${d.supplyProviderHealth.providerIssue}`);
  lines.push(`• marketSignal: ${d.supplyProviderHealth.marketSignal}`);
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
  lines.push("• investor-flow provider warmup 상태 점검");
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
