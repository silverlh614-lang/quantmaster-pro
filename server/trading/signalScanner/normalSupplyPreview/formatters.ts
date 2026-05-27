// @responsibility Pure formatters for normal supply preview diagnostics.
import type {
  ActivePassiveConfluence,
  ProgramFlowDiagnosticsSummary,
  ProgramFlowMarketProgramDisplayStatus,
  ProgramFlowSignal,
} from "./programFlowTypes.js";
import {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
  NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE,
  NORMAL_SUPPLY_SCORE_THRESHOLDS,
} from "./constants.js";
import type {
  NormalSupplyPreview,
  NormalSupplyPreviewCandidate,
} from "./types.js";

function escapeHtmlText(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function activeDirection(
  foreign?: number,
  institution?: number,
): "BUY" | "SELL" | "NEUTRAL" {
  if (
    foreign !== undefined &&
    institution !== undefined &&
    foreign > 0 &&
    institution > 0
  )
    return "BUY";
  if (
    foreign !== undefined &&
    institution !== undefined &&
    foreign < 0 &&
    institution < 0
  )
    return "SELL";
  return "NEUTRAL";
}

export function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

export function formatReasonDistribution(
  distribution: Record<string, number>,
): string {
  const entries = Object.entries(distribution).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return entries.length > 0
    ? entries.map(([reason, count]) => `${reason}=${count}`).join(", ")
    : "none";
}

export function formatSampleList(samples: string[]): string {
  return samples.length > 0
    ? samples
        .map((sample, index) => `${index + 1}. "${escapeHtmlText(sample)}"`)
        .join("\n  ")
    : "none";
}

export function formatStockProgramFieldKeysTop(
  keys: string[],
  counts: Record<string, number>,
): string {
  if (keys.length === 0) return "none";
  return keys
    .slice(0, 8)
    .map((key) => `${key}=${counts[key] ?? 0}`)
    .join(", ");
}

export function formatAvailabilityLine(
  label: string,
  value: number,
  total: number,
): string {
  return `  ${label}: ${value}/${total}`;
}

export function formatAmount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "N/A";
  return Math.trunc(value).toLocaleString("en-US");
}

function formatMarketProgramStatusLines(
  status: ProgramFlowMarketProgramDisplayStatus,
  input: {
    providerIssue: boolean;
    marketSignal: ProgramFlowSignal;
    currentSession: string;
    liveWindow: string;
    executionImpact: string;
  },
): string[] {
  return [
    `rawBreakPoint: ${status.rawBreakPoint}`,
    `displayBreakPoint: ${status.displayBreakPoint}`,
    `rawReason: ${status.rawReason}`,
    `displayReason: ${status.displayReason}`,
    `dataParsed: ${status.programDataParsed}`,
    `dataAvailable: ${status.programDataAvailable}`,
    `providerIssue: ${input.providerIssue}`,
    `marketSignal: ${input.marketSignal}`,
    `liveWindow: ${input.liveWindow}`,
    `currentSession: ${input.currentSession}`,
    `liveDecision: ${status.usedForLiveDecision ? 'USED_FOR_LIVE_DECISION' : status.outsideLiveWindow ? 'NOT_USED_OUTSIDE_LIVE_WINDOW' : 'NOT_USED_FOR_LIVE_DECISION'}`,
    `shadowUse: ${status.usedForShadow ? 'DIAGNOSTIC_ONLY' : 'NOT_USED'}`,
    `diagnosticOnly: ${status.diagnosticOnly}`,
    `executionImpact: ${input.executionImpact}`,
    `message: ${escapePreviewHtmlText(status.userMessage)}`,
  ];
}

function legacyMarketProgramStatus(
  rawBreakPoint: string,
  rawReason: string,
): ProgramFlowMarketProgramDisplayStatus {
  return {
    rawBreakPoint,
    displayBreakPoint: rawBreakPoint,
    rawReason,
    displayReason: rawReason,
    programDataParsed: false,
    programDataAvailable: false,
    outsideLiveWindow: false,
    diagnosticOnly: true,
    usedForLiveDecision: false,
    usedForShadow: false,
    userMessage: '시장 프로그램매매 display status가 없는 legacy payload입니다. raw breakpoint/reason을 그대로 표시합니다.',
  };
}

export function nextActionForProgramReason(
  reason: string,
): ProgramFlowDiagnosticsSummary["nextAction"] {
  if (reason === "PROGRAM_FLOW_CONTEXT_NOT_FOUND")
    return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
  if (reason === "PROGRAM_FLOW_WIRED_BUT_NO_FIELDS")
    return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
  if (reason === "PROGRAM_FLOW_WIRED_BUT_ALL_NA")
    return "CHECK_STOCK_PROGRAM_CONSUMER_PARSE";
  if (reason === "PROGRAM_UPSTREAM_SNAPSHOT_CACHE_MISSING")
    return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
  if (reason === "PROGRAM_UPSTREAM_VALUE_MISSING")
    return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
  if (reason === "PROGRAM_SNAPSHOT_VALUE_NULL")
    return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
  if (reason === "PROGRAM_CACHE_VALUE_NOT_CARRIED")
    return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
  if (reason === "PROGRAM_TRADING_VALUE_NOT_CARRIED")
    return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
  if (reason === "MARKET_PROGRAM_AVAILABLE_STOCK_PROGRAM_MISSING")
    return "OBSERVE_DIAGNOSTIC_ONLY";
  if (reason === "PROGRAM_VALUE_PLACEHOLDER_ONLY")
    return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
  if (reason === "PROGRAM_VALUE_UNIT_NORMALIZATION_REQUIRED")
    return "CHECK_STOCK_PROGRAM_CONSUMER_PARSE";
  if (reason === "PROGRAM_VALUE_UNSUPPORTED_FORMAT")
    return "CHECK_STOCK_PROGRAM_CONSUMER_PARSE";
  if (reason === "PROGRAM_VALUE_NORMALIZATION_REQUIRED")
    return "CHECK_STOCK_PROGRAM_CONSUMER_PARSE";
  if (reason === "PROGRAM_CONTEXT_HAS_STATUS_ONLY")
    return "CHECK_MARKET_PROGRAM_CONSUMER_PARSE";
  if (reason === "PROGRAM_PROVIDER_ISSUE_DIAGNOSTIC_ONLY")
    return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
  if (reason === "PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY")
    return "OBSERVE_DIAGNOSTIC_ONLY";
  return "CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER";
}

export function classifyActivePassiveConfluence(input: {
  foreignNetBuy?: number;
  institutionNetBuy?: number;
  passiveProxySignal: ProgramFlowSignal;
}): ActivePassiveConfluence {
  const active = activeDirection(input.foreignNetBuy, input.institutionNetBuy);
  const passive =
    input.passiveProxySignal === "BULLISH"
      ? "BUY"
      : input.passiveProxySignal === "BEARISH"
        ? "SELL"
        : input.passiveProxySignal === "NEUTRAL"
          ? "NEUTRAL"
          : "UNAVAILABLE";
  if (active === "BUY" && passive === "BUY")
    return "ACTIVE_PASSIVE_CONFIRMED_BUY";
  if (active === "SELL" && passive === "SELL")
    return "ACTIVE_PASSIVE_CONFIRMED_SELL";
  if (active === "BUY" && passive === "UNAVAILABLE")
    return "ACTIVE_BUYING_ONLY";
  if (active === "SELL" && passive === "UNAVAILABLE")
    return "ACTIVE_SELLING_ONLY";
  if (active === "NEUTRAL" && passive === "BUY") return "PASSIVE_BUYING_ONLY";
  if (active === "NEUTRAL" && passive === "SELL") return "PASSIVE_SELLING_ONLY";
  if (
    (active === "BUY" && passive === "SELL") ||
    (active === "SELL" && passive === "BUY")
  )
    return "MIXED_FLOW";
  if (passive === "UNAVAILABLE") return "PROGRAM_FLOW_UNAVAILABLE";
  return "NEUTRAL_FLOW";
}

export function describeActiveFlow(
  foreign?: number,
  institution?: number,
): string {
  const active = activeDirection(foreign, institution);
  if (active === "BUY") return "외인+기관 동반 순매수";
  if (active === "SELL") return "외인+기관 동반 순매도";
  if ((foreign ?? 0) > 0) return "외인 순매수 우위";
  if ((institution ?? 0) > 0) return "기관 순매수 우위";
  return "NEUTRAL_FLOW";
}

export function describeProgramSignal(signal: ProgramFlowSignal): string {
  if (signal === "BULLISH") return "PROGRAM_PASSIVE_PROXY_BUY";
  if (signal === "BEARISH") return "PROGRAM_PASSIVE_PROXY_SELL";
  if (signal === "NEUTRAL") return "PROGRAM_PASSIVE_PROXY_NEUTRAL";
  if (signal === "UNKNOWN") return "PROGRAM_FLOW_UNKNOWN";
  return "PROGRAM_FLOW_UNAVAILABLE";
}

const CONFLUENCE_LABELS: ActivePassiveConfluence[] = [
  'ACTIVE_PASSIVE_CONFIRMED_BUY',
  'ACTIVE_BUYING_ONLY',
  'PASSIVE_BUYING_ONLY',
  'ACTIVE_PASSIVE_CONFIRMED_SELL',
  'ACTIVE_SELLING_ONLY',
  'PASSIVE_SELLING_ONLY',
  'MIXED_FLOW',
  'NEUTRAL_FLOW',
  'PROGRAM_FLOW_UNAVAILABLE',
];

export function formatNormalSupplyPreviewSection(
  preview: NormalSupplyPreview | null | undefined,
  canonicalContextOrOptions?: {
    engineMode: string;
    effectiveRegime: string;
    displayRegime: string;
    riskOverride: string;
    policyView: string;
    liveEntryAllowed: boolean;
  } | { maxTopCandidates?: number },
  options: { maxTopCandidates?: number } = {},
): string | null {
  if (!preview) return null;
  const canonicalContext = canonicalContextOrOptions && 'engineMode' in canonicalContextOrOptions
    ? canonicalContextOrOptions
    : undefined;
  const resolvedOptions = canonicalContext ? options : (canonicalContextOrOptions ?? options);
  const maxTop = resolvedOptions.maxTopCandidates ?? 5;
  const top = preview.topCandidates[0];
  const activeBuyCount = countActiveBuyCandidates(preview.candidates);
  const bullishThreshold = NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold;
  const lines: string[] = [];
  lines.push('🧪 <b>Normal Supply Preview with legacy defense policy disabled (ADR-0518)</b>');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`previewBasis: ${preview.previewMode}`);
  lines.push(`actualEngineMode: ${canonicalContext?.engineMode ?? preview.runtimePermission.engineMode}`);
  lines.push(`actualEffectiveRegime: ${canonicalContext?.effectiveRegime ?? (preview as { actualEffectiveRegime?: string }).actualEffectiveRegime ?? 'UNKNOWN'}`);
  lines.push(`actualDisplayRegime: ${canonicalContext?.displayRegime ?? (preview as { actualDisplayRegime?: string }).actualDisplayRegime ?? 'UNKNOWN'}`);
  lines.push(`actualRiskOverride: ${canonicalContext?.riskOverride ?? (preview as { actualRiskOverride?: string }).actualRiskOverride ?? 'NONE'}`);
  lines.push(`actualPolicyView: ${canonicalContext?.policyView ?? (canonicalContext?.riskOverride && canonicalContext.riskOverride !== 'NONE' ? canonicalContext.riskOverride : canonicalContext?.displayRegime ?? 'UNKNOWN')}`);
  lines.push(`actualLiveExecutionAllowed: ${preview.runtimePermission.actualLiveOrderAllowed}`);
  lines.push(`source: ${preview.source}`);
  if (preview.reason) lines.push(`reason: ${preview.reason}`);
  if (preview.preflightDecision) lines.push(`preflightDecision: ${preview.preflightDecision}`);
  lines.push(`liveExecutionAllowed: ${preview.liveExecutionAllowed}`);
  lines.push(`realOrderAllowed: ${preview.realOrderAllowed}`);
  lines.push(`actualLiveOrderAllowed: ${preview.runtimePermission.actualLiveOrderAllowed}`);
  lines.push(`liveBlockReason: ${preview.runtimePermission.liveBlockReason}`);
  lines.push(`gatePolicyLiveAllowed: ${preview.runtimePermission.gatePolicyLiveAllowed}`);
  lines.push(`macroLiveAllowed: ${preview.runtimePermission.macroLiveAllowed}`);
  lines.push(`brokerOrderAllowed: ${preview.runtimePermission.brokerOrderAllowed}`);
  lines.push(`operatorOrderAllowed: ${preview.runtimePermission.operatorOrderAllowed}`);
  lines.push(`shadowAllowed: ${preview.runtimePermission.shadowAllowed}`);
  lines.push(`counterfactualAllowed: ${preview.runtimePermission.counterfactualAllowed}`);
  lines.push(`strongBuyAllowed: ${preview.strongBuyAllowed}`);
  lines.push(`shadowObservableAllowed: ${preview.shadowObservableAllowed}`);
  lines.push(`executionImpact: ${preview.executionImpact}`);
  lines.push('');
  lines.push('note: This is a diagnostic preview under NORMAL supply assumptions, not the actual engine mode.');
  lines.push('');
  lines.push(`정상모드 기준 후보 수: ${preview.candidateCount}`);
  lines.push('수급 주입 상태:');
  lines.push(`  VERIFIED: ${preview.healthCounts.VERIFIED}`);
  lines.push(`  DEGRADED: ${preview.healthCounts.DEGRADED}`);
  lines.push(`  STALE: ${preview.healthCounts.STALE}`);
  lines.push(`  MISSING: ${preview.healthCounts.MISSING}`);
  lines.push(`  UNKNOWN: ${preview.healthCounts.UNKNOWN}`);
  lines.push(`  routerConnected: ${preview.supplyInjection.routerConnected}`);
  lines.push(`  gateContextConnected: ${preview.supplyInjection.gateContextConnected}`);
  lines.push('');
  lines.push('정상모드 기준 수급 판정:');
  lines.push(`  BULLISH: ${preview.signalCounts.BULLISH}`);
  lines.push(`  ACCUMULATING: ${preview.signalCounts.ACCUMULATING}`);
  lines.push(`  NEUTRAL: ${preview.signalCounts.NEUTRAL}`);
  lines.push(`  BEARISH: ${preview.signalCounts.BEARISH}`);
  lines.push(`  UNUSABLE: ${preview.signalCounts.UNUSABLE}`);
  lines.push('');
  lines.push('📌 수급 해석 요약');
  lines.push(`- 데이터 상태: VERIFIED ${preview.healthCounts.VERIFIED}/${preview.candidateCount} 정상`);
  lines.push(`- 외인/기관 순매수 감지 종목: ${activeBuyCount}개`);
  lines.push(`- 최종 ACCUMULATING 후보: ${preview.signalCounts.ACCUMULATING}개`);
  lines.push(`- 최종 BULLISH 후보: ${preview.signalCounts.BULLISH}개`);
  lines.push('- 설명: 외인/기관 순매수 감지는 원천 active flow 기준이며, ACCUMULATING/BULLISH는 프로그램 수급, 점수 임계값, 정책 차단까지 반영한 최종 수급 판정입니다.');
  lines.push(`- 최고 수급점수: ${top?.supplyScore ?? 'N/A'}`);
  lines.push(`- BULLISH 기준: ${bullishThreshold}`);
  lines.push(`- 현재 판정: ${top?.supplySignal ?? 'N/A'}`);
  lines.push(`- 미승격 사유: ${formatPromotionBlockedReason(top)}`);
  lines.push(`- 실거래 차단: ${formatLiveDecisionBlockReason(preview)}`);
  lines.push('- 허용 동작: Shadow 관찰 / Watchlist Boost');
  lines.push(`- executionImpact: ${preview.executionImpact}`);
  lines.push('');
  lines.push('상위 수급 후보:');
  if (preview.topCandidates.length === 0) {
    lines.push('  none');
  } else {
    preview.topCandidates.slice(0, maxTop).forEach((candidate, index) => {
      lines.push(formatCompactCandidateDetail(candidate, index + 1, preview));
    });
  }
  lines.push('');
  lines.push('주의:');
  lines.push('Legacy defense policy does not change buy permission; Gate/data quality remains authoritative.');
  lines.push('본 결과는 정상모드 기준 수급 진단이며 주문 영향 없습니다.');
  return lines.join('\n');
}

function countActiveBuyCandidates(candidates: NormalSupplyPreviewCandidate[]): number {
  return candidates.filter((candidate) =>
    (candidate.foreignNetBuyAmount ?? 0) > 0 || (candidate.institutionNetBuyAmount ?? 0) > 0
  ).length;
}

function formatPromotionBlockedReason(candidate: NormalSupplyPreviewCandidate | undefined): string {
  if (!candidate) return 'N/A';
  const bullishThreshold = NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold;
  if (candidate.supplySignal === 'ACCUMULATING' && candidate.supplyScore < bullishThreshold) {
    return `supplyScore ${candidate.supplyScore} < bullishThreshold ${bullishThreshold}`;
  }
  if (candidate.supplySignal === 'BULLISH') return 'none';
  return `not ACCUMULATING top signal (${candidate.supplySignal})`;
}

function formatPromotionBlockedCode(candidate: NormalSupplyPreviewCandidate): string {
  if (
    candidate.supplySignal === 'ACCUMULATING' &&
    candidate.supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold
  ) {
    return 'BELOW_BULLISH_THRESHOLD';
  }
  return candidate.supplySignal === 'BULLISH' ? 'NONE' : 'NOT_BULLISH_SIGNAL';
}

function formatLiveDecisionBlockReason(preview: NormalSupplyPreview): string {
  return preview.runtimePermission.liveBlockReason;
}

function formatCompactLiveDecision(preview: NormalSupplyPreview): string {
  if (preview.runtimePermission.actualLiveOrderAllowed) return 'LIVE_DECISION_ALLOWED';
  return `BLOCKED_BY_${preview.runtimePermission.liveBlockReason}`;
}

function formatCompactActiveFlow(candidate: NormalSupplyPreviewCandidate): string {
  const foreign = candidate.foreignNetBuyAmount ?? 0;
  const institution = candidate.institutionNetBuyAmount ?? 0;
  if (foreign > 0 && institution > 0) return '외인+기관 동반 순매수';
  if (foreign > 0) return '외인 순매수';
  if (institution > 0) return '기관 순매수';
  return candidate.activeFlow;
}

function formatCompactCandidateDetail(
  candidate: NormalSupplyPreviewCandidate,
  rank: number,
  preview: NormalSupplyPreview,
): string {
  const name = candidate.name ? ` ${candidate.name}` : '';
  return [
    `${rank}. ${candidate.symbol}${name}`,
    `   activeFlow=${escapePreviewHtmlText(formatCompactActiveFlow(candidate))}`,
    `   supplyScore=${candidate.supplyScore}/${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold}`,
    `   signal=${candidate.supplySignal}`,
    `   promotionBlocked=${formatPromotionBlockedCode(candidate)}`,
    `   liveDecision=${formatCompactLiveDecision(preview)}`,
    `   shadowObservable=${preview.shadowObservableAllowed}`,
    ...formatWatchlistBoostLines(candidate),
    `   watchlistPriorityBoost=${candidate.watchlistPriorityBoost}`,
    `   executionImpact=${preview.executionImpact}`,
  ].join('\n');
}

function formatWatchlistBoostLines(candidate: NormalSupplyPreviewCandidate): string[] {
  const withOptionalBoost = candidate as NormalSupplyPreviewCandidate & { watchlistBoost?: number };
  if (typeof withOptionalBoost.watchlistBoost !== 'number') return [];
  const boostState = candidate.watchlistPriorityBoost > 0 ? 'APPLIED' : 'NONE';
  return [`   watchlistBoost=${boostState}`];
}

export function formatNormalSupplyPreviewFullSections(
  preview: NormalSupplyPreview | null | undefined,
  options: { maxTopCandidates?: number; maxChars?: number } = {},
): string[] {
  if (!preview) return [formatNormalSupplyPreviewMissingSection()];
  const sections = buildNormalSupplyPreviewFullSections(preview, options);
  return paginateNormalSupplyPreviewSections(sections, options.maxChars ?? 3500);
}

export function buildNormalSupplyPreviewFullSections(
  preview: NormalSupplyPreview,
  options: { maxTopCandidates?: number } = {},
): string[] {
  const thresholds = NORMAL_SUPPLY_SCORE_THRESHOLDS;
  const top = preview.topCandidates[0];
  const diagnosticsMarketProgramStatus =
    preview.programFlowDiagnostics.marketProgramStatus ??
    legacyMarketProgramStatus(
      preview.programFlowDiagnostics.marketProgramBreakPoint,
      preview.programFlowDiagnostics.marketProgramReason,
    );
  const fieldMarketProgramStatus =
    preview.fieldAvailability.marketProgramStatus ?? diagnosticsMarketProgramStatus;
  const contamination =
    preview.signalSourceSplit.bearishFromProviderIssue +
    preview.signalSourceSplit.bullishFromProviderIssue +
    preview.signalSourceSplit.accumulatingFromProviderIssue;
  const sections: string[] = [];

  sections.push([
    '🧪 <b>Normal Supply Preview FULL with legacy defense policy disabled (ADR-0518)</b>',
    '━━━━━━━━━━━━━━━━',
    `mode: ${escapePreviewHtmlText(preview.engineMode)}`,
    `previewMode: ${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE}`,
    `source: ${escapePreviewHtmlText(preview.source)}`,
    preview.reason ? `reason: ${escapePreviewHtmlText(preview.reason)}` : '',
    preview.preflightDecision ? `preflightDecision: ${escapePreviewHtmlText(preview.preflightDecision)}` : '',
    `liveExecutionAllowed=${preview.liveExecutionAllowed}`,
    `realOrderAllowed=${preview.realOrderAllowed}`,
    `strongBuyAllowed=${preview.strongBuyAllowed}`,
    `shadowObservableAllowed=${preview.shadowObservableAllowed}`,
    `executionImpact=${preview.executionImpact}`,
    '',
    `candidateCount=${preview.candidateCount}`,
    `routerConnected=${preview.supplyInjection.routerConnected}`,
    `gateContextConnected=${preview.supplyInjection.gateContextConnected}`,
    '',
    'Injection:',
    `  VERIFIED=${preview.healthCounts.VERIFIED}`,
    `  DEGRADED=${preview.healthCounts.DEGRADED}`,
    `  STALE=${preview.healthCounts.STALE}`,
    `  MISSING=${preview.healthCounts.MISSING}`,
    `  UNKNOWN=${preview.healthCounts.UNKNOWN}`,
    '',
    'Signal:',
    `  BULLISH=${preview.signalCounts.BULLISH}`,
    `  ACCUMULATING=${preview.signalCounts.ACCUMULATING}`,
    `  NEUTRAL=${preview.signalCounts.NEUTRAL}`,
    `  BEARISH=${preview.signalCounts.BEARISH}`,
    `  UNUSABLE=${preview.signalCounts.UNUSABLE}`,
    '',
    'Safety:',
    `  providerIssueAsBearish=${preview.safety.providerIssueAsBearish}`,
    `  unknownPenaltyApplied=${preview.safety.unknownPenaltyApplied}`,
    `  staleAsBearish=${preview.safety.staleAsBearish}`,
    `  missingAsBearish=${preview.safety.missingAsBearish}`,
    `  realOrderAllowed=${preview.safety.realOrderAllowed}`,
    `  accumulatingUsedForLiveDecision=${preview.safety.accumulatingUsedForLiveDecision}`,
    `  accumulatingAllowsStrongBuy=${preview.safety.accumulatingAllowsStrongBuy}`,
    `  accumulatingAllowsWatchlistBoost=${preview.safety.accumulatingAllowsWatchlistBoost}`,
    `  accumulatingAllowsShadowTracking=${preview.safety.accumulatingAllowsShadowTracking}`,
    `  executionImpact=${preview.executionImpact}`,
    contamination > 0 ? `  warning=PROVIDER_SIGNAL_CONTAMINATION count=${contamination}` : '',
    '',
    '📐 <b>Supply Score Threshold</b>',
    `  bullishThreshold: ${thresholds.bullishThreshold}`,
    `  accumulatingRange: ${thresholds.accumulatingThreshold}~${thresholds.bullishThreshold - 1}`,
    `  bearishThreshold: ${thresholds.bearishThreshold}`,
    `  neutralRange: ${thresholds.bearishThreshold}~${thresholds.accumulatingThreshold - 1}`,
    `  topSupplyScore: ${top?.supplyScore ?? 'N/A'}`,
    `  topSignal: ${top?.supplySignal ?? 'N/A'}`,
    `  explanation: ${escapePreviewHtmlText(buildThresholdExplanation(top))}`,
    '',
    '📊 <b>Program Passive Proxy Availability</b> (Program Flow Availability)',
    formatAvailabilityLine('stockProgramNetBuyField', preview.fieldAvailability.stockProgramNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramAvailable', preview.fieldAvailability.stockProgramAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsAvailable', preview.fieldAvailability.stockProgramRowsAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsWithAnyProgramKey', preview.fieldAvailability.stockProgramRowsWithAnyProgramKey, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsWithNumericProgramValue', preview.fieldAvailability.stockProgramRowsWithNumericProgramValue, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsWithParsableProgramValue', preview.fieldAvailability.stockProgramRowsWithParsableProgramValue, preview.fieldAvailability.total),
    `  stockProgramValueReasonTop: ${preview.fieldAvailability.stockProgramValueReasonTop}`,
    formatAvailabilityLine('programNetBuyField', preview.fieldAvailability.programNetBuyField, preview.fieldAvailability.total),
    `  marketProgramAvailable: ${preview.fieldAvailability.marketProgramAvailable}`,
    `  marketProgramSignal: ${preview.fieldAvailability.marketProgramSignal}`,
    `  marketProgramSource: ${preview.fieldAvailability.marketProgramSource}`,
    `  marketProgramContextFound: ${preview.fieldAvailability.marketProgramContextFound}`,
    `  marketProgramBreakPoint: ${preview.fieldAvailability.marketProgramBreakPoint}`,
    `  marketProgramReason: ${preview.fieldAvailability.marketProgramReason}`,
    `  marketProgramDataStatus: ${preview.fieldAvailability.marketProgramDataStatus}`,
    `  marketProgramDisplayBreakPoint: ${fieldMarketProgramStatus.displayBreakPoint}`,
    `  marketProgramDisplayReason: ${fieldMarketProgramStatus.displayReason}`,
    `  marketProgramUserMessage: ${escapePreviewHtmlText(fieldMarketProgramStatus.userMessage)}`,
    `  marketProgramNetBuyAmount: ${preview.fieldAvailability.marketProgramNetBuyAmount}`,
    `  marketProgramParsableFieldsFound: ${formatList(preview.fieldAvailability.marketProgramParsableFieldsFound)}`,
    `  marketProgramValueReasonTop: ${preview.fieldAvailability.marketProgramValueReasonTop}`,
    `  marketProgramProviderIssue: ${preview.fieldAvailability.marketProgramProviderIssue}`,
    `  marketProgramMarketSignal: ${preview.fieldAvailability.marketProgramMarketSignal}`,
    `  missingProgramFlowAsBearish=${preview.fieldAvailability.missingProgramFlowAsBearish}`,
    `  programPenaltyApplied=${preview.fieldAvailability.programPenaltyApplied}`,
    `  programFlowUsedForLiveDecision=${preview.fieldAvailability.programFlowUsedForLiveDecision}`,
    `  passiveProxyUsedForLiveDecision=${preview.fieldAvailability.passiveProxyUsedForLiveDecision}`,
    `  providerCallsAdded=${preview.fieldAvailability.providerCallsAdded}`,
    `  executionImpact=${preview.fieldAvailability.executionImpact}`,
    '',
    '🔌 <b>Program Flow Wiring Forensic</b>',
    '  session:',
    `    marketSession=${preview.programFlowDiagnostics.sessionGuard.marketSession}`,
    `    isTradingDay=${preview.programFlowDiagnostics.sessionGuard.isTradingDay}`,
    `    kstTime=${preview.programFlowDiagnostics.sessionGuard.kstTime}`,
    `    programFlowExpected=${preview.programFlowDiagnostics.programFlowExpected}`,
    `    reason=${preview.programFlowDiagnostics.reason}`,
    `    providerIssueSuppressedByMarketClosed=${preview.programFlowDiagnostics.providerIssueSuppressedByMarketClosed}`,
    `    recheckWindowKST=${preview.programFlowDiagnostics.recheckWindowKST}`,
    `    nextAction=${preview.programFlowDiagnostics.nextAction}`,
    `    programNetBuyNullRootCause=${preview.programFlowDiagnostics.programNetBuyNullRootCause}`,
    '',
    '  marketCarry:',
    `    macroStateFound=${preview.programFlowDiagnostics.marketCarryTrace.macroStateFound}`,
    `    macroStateProgramSource=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramSource}`,
    `    macroStateProgramNetBuyAmountPresent=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramNetBuyAmountPresent}`,
    `    macroStateProgramNetBuyAmountValue=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramNetBuyAmountValue}`,
    `    macroStateProgramArbitragePresent=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramArbitragePresent}`,
    `    macroStateProgramFetchedAt=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramFetchedAt}`,
    `    marketProgramFlowPayloadPresent=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowPayloadPresent}`,
    `    marketProgramFlowPayloadKeys=${formatList(preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowPayloadKeys)}`,
    `    marketProgramFlowPayloadSourceProvider=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowPayloadSourceProvider}`,
    `    marketProgramFlowProviderIssue=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowProviderIssue}`,
    `    marketProgramFlowExecutionImpact=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowExecutionImpact}`,
    `    marketProgramFlowMarketSignal=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowMarketSignal}`,
    `    marketProgramCarrySource=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramCarrySource}`,
    `    marketProgramBreakPoint=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramBreakPoint}`,
    '',
    '  stockCarry:',
    `    latestSnapshotFound=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotFound}`,
    `    latestSnapshotCapturedAt=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotCapturedAt}`,
    `    latestSnapshotStockRowsTotal=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotStockRowsTotal}`,
    `    latestSnapshotRowsWithValue=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotStockRowsWithProgramValue}`,
    `    latestSnapshotMarketProgramAvailable=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotMarketProgramAvailable}`,
    `    perStockCarryMapSize=${preview.programFlowDiagnostics.stockCarryTrace.perStockCarryMapSize}`,
    `    candidateStockProgramFlowAttached=${preview.programFlowDiagnostics.stockCarryTrace.candidateStockProgramFlowAttached}/${preview.fieldAvailability.total}`,
    `    candidateStockProgramFlowAttachedWithValue=${preview.programFlowDiagnostics.stockCarryTrace.candidateStockProgramFlowAttachedWithValue}/${preview.fieldAvailability.total}`,
    `    candidateContextProgramNetBuyAmountFieldCreated=${preview.programFlowDiagnostics.stockCarryTrace.candidateContextProgramNetBuyAmountFieldCreated}/${preview.fieldAvailability.total}`,
    `    candidateContextProgramNetBuyAmountNonNull=${preview.programFlowDiagnostics.stockCarryTrace.candidateContextProgramNetBuyAmountNonNull}/${preview.fieldAvailability.total}`,
    `    consumerParsedStockProgramRows=${preview.programFlowDiagnostics.stockCarryTrace.consumerParsedStockProgramRows}/${preview.fieldAvailability.total}`,
    `    stockCarrySource=${preview.programFlowDiagnostics.stockCarryTrace.stockCarrySource}`,
    `    stockProgramBreakPoint=${preview.programFlowDiagnostics.stockCarryTrace.stockProgramBreakPoint}`,
    '',
    '  safety:',
    `    programMissingAsBearish=${preview.programFlowDiagnostics.programMissingAsBearish}`,
    `    programPenaltyApplied=${preview.programFlowDiagnostics.programPenaltyApplied}`,
    `    programFlowUsedForLiveDecision=${preview.programFlowDiagnostics.programFlowUsedForLiveDecision}`,
    `    passiveProxyUsedForLiveDecision=${preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision}`,
    `    providerCallsAdded=${preview.programFlowDiagnostics.providerCallsAdded}`,
    `    executionImpact=${preview.programFlowDiagnostics.executionImpact}`,
    '',
    '🔀 <b>Active/Passive Proxy Confluence</b> (Active/Passive Confluence)',
    ...CONFLUENCE_LABELS.map((label) => `  ${label}: ${preview.activePassiveConfluenceCounts[label]}`),
    '',
    '📊 <b>Signal Source Split</b>',
    `  bullishFromMarketSignal: ${preview.signalSourceSplit.bullishFromMarketSignal}`,
    `  bullishFromProviderIssue: ${preview.signalSourceSplit.bullishFromProviderIssue}`,
    `  accumulatingFromMarketSignal: ${preview.signalSourceSplit.accumulatingFromMarketSignal}`,
    `  accumulatingFromProviderIssue: ${preview.signalSourceSplit.accumulatingFromProviderIssue}`,
    `  bearishFromMarketSignal: ${preview.signalSourceSplit.bearishFromMarketSignal}`,
    `  bearishFromProviderIssue: ${preview.signalSourceSplit.bearishFromProviderIssue}`,
    `  neutralFromVerifiedData: ${preview.signalSourceSplit.neutralFromVerifiedData}`,
    `  unusableFromDataQuality: ${preview.signalSourceSplit.unusableFromDataQuality}`,
    '  note: providerIssue is not a directional market signal.',
  ].filter(Boolean).join('\n'));

  const maxTop = options.maxTopCandidates ?? 10;
  const topCandidates = [...preview.candidates]
    .sort((a, b) => b.supplyScore - a.supplyScore || a.symbol.localeCompare(b.symbol))
    .slice(0, maxTop);
  sections.push([
    '📈 <b>Top Supply Candidates</b>',
    topCandidates.length === 0 ? 'none' : topCandidates.map((candidate, index) =>
      formatFullCandidateDetail(candidate, index + 1, {
        includeThreshold: true,
        includeInvalidWarning: true,
      }),
    ).join('\n\n'),
  ].join('\n'));

  const bearish = preview.candidates
    .filter((candidate) => candidate.supplySignal === 'BEARISH')
    .sort((a, b) => a.supplyScore - b.supplyScore || a.symbol.localeCompare(b.symbol));
  sections.push([
    `📉 <b>BEARISH Supply Candidates ${bearish.length}</b>`,
    bearish.length === 0 ? 'none' : bearish.map((candidate, index) =>
      formatFullCandidateDetail(candidate, index + 1, {
        includeThreshold: false,
        includeInvalidWarning: true,
      }),
    ).join('\n\n'),
  ].join('\n'));

  const unknownOrUnusable = preview.candidates
    .filter((candidate) =>
      candidate.supplySignal === 'UNUSABLE' ||
      candidate.supplyProviderHealth === 'UNKNOWN' ||
      candidate.supplyProviderHealth === 'MISSING' ||
      candidate.supplyProviderHealth === 'STALE',
    )
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  sections.push([
    '🔌 <b>Supply Field Availability</b>',
    formatAvailabilityLine('foreignNetBuyField', preview.fieldAvailability.foreignNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('institutionNetBuyField', preview.fieldAvailability.institutionNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('programNetBuyField', preview.fieldAvailability.programNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramAvailable', preview.fieldAvailability.stockProgramAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsAvailable', preview.fieldAvailability.stockProgramRowsAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('semanticRowAvailable', preview.fieldAvailability.semanticRowAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('rawInvestorRowAvailable', preview.fieldAvailability.rawInvestorRowAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('selectedCandidateCarriesSemanticRow', preview.fieldAvailability.selectedCandidateCarriesSemanticRow, preview.fieldAvailability.total),
    formatAvailabilityLine('selectedCandidateCarriesActualRow', preview.fieldAvailability.selectedCandidateCarriesActualRow, preview.fieldAvailability.total),
    '',
    '⚪ <b>UNUSABLE / UNKNOWN Supply Rows</b>',
    `count=${unknownOrUnusable.length}`,
    unknownOrUnusable.length === 0 ? '' : unknownOrUnusable.map((candidate, index) =>
      formatUnknownCandidateDetail(candidate, index + 1),
    ).join('\n\n'),
    '',
    'Diagnostics:',
    '  usedForLiveDecision=false',
    '  penaltyApplied=false',
    '  unknownPenaltyApplied=false',
    '  providerCallsAdded=0',
    '  executionImpact=NONE',
  ].filter((line) => line !== '').join('\n'));

  sections.push([
    '⚪ <b>Program Passive Proxy Diagnostics</b> (Program Flow Diagnostics)',
    formatAvailabilityLine('stockProgramRowsAvailable', preview.programFlowDiagnostics.stockProgramRowsAvailable, preview.programFlowDiagnostics.total),
    formatAvailabilityLine('stockProgramRowsWithAnyProgramKey', preview.programFlowDiagnostics.stockProgramRowsWithAnyProgramKey, preview.programFlowDiagnostics.total),
    formatAvailabilityLine('stockProgramRowsWithNumericProgramValue', preview.programFlowDiagnostics.stockProgramRowsWithNumericProgramValue, preview.programFlowDiagnostics.total),
    formatAvailabilityLine('stockProgramRowsWithParsableProgramValue', preview.programFlowDiagnostics.stockProgramRowsWithParsableProgramValue, preview.programFlowDiagnostics.total),
    `  stockProgramFieldKeysTop: ${preview.programFlowDiagnostics.stockProgramFieldKeysTop}`,
    `  stockProgramValueReasonDistribution: ${preview.programFlowDiagnostics.stockProgramValueReasonTop}`,
    `  stockProgramSanitizedSampleTop: ${formatSampleList(preview.programFlowDiagnostics.stockProgramSanitizedSampleTop)}`,
    `  stockProgramBreakPoint: ${preview.programFlowDiagnostics.stockProgramBreakPoint}`,
    '',
    '  Upstream Population Trace:',
    `    programNetBuyAmountFieldCreated=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programNetBuyAmountFieldCreated}`,
    `    programNetBuyAmountNullCount=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programNetBuyAmountNullCount}`,
    `    programNetBuyAmountNonNullCount=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programNetBuyAmountNonNullCount}`,
    `    candidateContextHasField=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.candidateContextHasField}`,
    `    candidateContextValueNull=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.candidateContextValueNull}`,
    `    snapshotContextFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.snapshotContextFound}`,
    `    snapshotProgramRowsFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.snapshotProgramRowsFound}`,
    `    snapshotProgramRowsWithValue=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.snapshotProgramRowsWithValue}`,
    `    cacheContextFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.cacheContextFound}`,
    `    cacheProgramRowsFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.cacheProgramRowsFound}`,
    `    cacheProgramRowsWithValue=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.cacheProgramRowsWithValue}`,
    `    programTradingContextFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programTradingContextFound}`,
    `    programTradingRowsFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programTradingRowsFound}`,
    `    programTradingRowsWithValue=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programTradingRowsWithValue}`,
    `    carryAttempted=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carryAttempted}`,
    `    carrySource=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySource}`,
    `    carrySuccessCount=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySuccessCount}`,
    `    carryNullCount=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carryNullCount}`,
    `    stockProgramBreakPoint=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.breakPoint}`,
    `    reason=${preview.programFlowDiagnostics.reason}`,
    `    nextAction=${preview.programFlowDiagnostics.nextAction}`,
    '',
    '  Market Program Trace:',
    `    marketProgramNetBuyFieldCreated=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.marketProgramNetBuyFieldCreated}`,
    `    marketProgramNetBuyNull=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.marketProgramNetBuyNull}`,
    `    programMarketContextFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.programMarketContextFound}`,
    `    programMarketValueFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.programMarketValueFound}`,
    `    latestIntradayMarketProgramSnapshotFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.latestIntradayMarketProgramSnapshotFound}`,
    `    latestIntradayMarketProgramValueFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.latestIntradayMarketProgramValueFound}`,
    `    cacheContextFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.cacheContextFound}`,
    `    cacheValueFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.cacheValueFound}`,
    `    carryAttempted=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.carryAttempted}`,
    `    carrySource=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.carrySource}`,
    `    marketProgramBreakPoint=${preview.programFlowDiagnostics.marketProgramBreakPoint}`,
    `    marketProgramReason=${preview.programFlowDiagnostics.marketProgramReason}`,
    `    reason=${preview.programFlowDiagnostics.reason}`,
    `    nextAction=${preview.programFlowDiagnostics.nextAction}`,
    '',
    '  marketProgramStatus:',
    ...formatMarketProgramStatusLines(diagnosticsMarketProgramStatus, {
      providerIssue: preview.programFlowDiagnostics.marketProgramProviderIssue,
      marketSignal: preview.programFlowDiagnostics.marketProgramSignal,
      currentSession: preview.programFlowDiagnostics.sessionGuard.marketSession,
      liveWindow: preview.programFlowDiagnostics.recheckWindowKST,
      executionImpact: preview.programFlowDiagnostics.executionImpact,
    }).map((line) => `    ${line}`),
    '',
    `  marketProgramAvailable: ${preview.programFlowDiagnostics.marketProgramAvailable}`,
    `  marketProgramSignal: ${preview.programFlowDiagnostics.marketProgramSignal}`,
    `  marketProgramSource: ${preview.programFlowDiagnostics.marketProgramSource}`,
    `  marketProgramProviderIssue: ${preview.programFlowDiagnostics.marketProgramProviderIssue}`,
    `  marketProgramDataStatus: ${preview.programFlowDiagnostics.marketProgramDataStatus}`,
    `  kisAttempted: ${preview.programFlowDiagnostics.kisAttempted}`,
    `  kisStatus: ${preview.programFlowDiagnostics.kisStatus}`,
    `  krxFallbackAttempted: ${preview.programFlowDiagnostics.krxFallbackAttempted}`,
    `  krxFallbackStatus: ${preview.programFlowDiagnostics.krxFallbackStatus}`,
    `  cacheFallbackAttempted: ${preview.programFlowDiagnostics.cacheFallbackAttempted}`,
    `  cacheStatus: ${preview.programFlowDiagnostics.cacheStatus}`,
    `  marketProgramNetBuyAmount: ${preview.programFlowDiagnostics.marketProgramNetBuyAmount}`,
    `  marketProgramFetchedAt: ${preview.programFlowDiagnostics.marketProgramFetchedAt}`,
    `  marketProgramParsedFieldName: ${preview.programFlowDiagnostics.marketProgramParsedFieldName}`,
    `  marketProgramRawFieldKeys: ${formatList(preview.programFlowDiagnostics.marketProgramRawFieldKeys)}`,
    `  marketProgramMarketSignal: ${preview.programFlowDiagnostics.marketProgramMarketSignal}`,
    `  marketProgramContextFound: ${preview.programFlowDiagnostics.marketProgramContextFound}`,
    `  marketProgramFieldsFound: ${formatList(preview.programFlowDiagnostics.marketProgramFieldsFound)}`,
    `  marketProgramNumericFieldsFound: ${formatList(preview.programFlowDiagnostics.marketProgramNumericFieldsFound)}`,
    `  marketProgramParsableFieldsFound: ${formatList(preview.programFlowDiagnostics.marketProgramParsableFieldsFound)}`,
    `  marketProgramValueReasonDistribution: ${preview.programFlowDiagnostics.marketProgramValueReasonTop}`,
    `  marketProgramSanitizedSample: ${preview.programFlowDiagnostics.marketProgramSanitizedSample ? `"${escapePreviewHtmlText(preview.programFlowDiagnostics.marketProgramSanitizedSample)}"` : 'none'}`,
    `  marketProgramStatusFieldsFound: ${formatList(preview.programFlowDiagnostics.marketProgramStatusFieldsFound)}`,
    `  marketProgramBreakPoint: ${preview.programFlowDiagnostics.marketProgramBreakPoint}`,
    `  marketProgramReason: ${preview.programFlowDiagnostics.marketProgramReason}`,
    '',
    `  reason: ${preview.programFlowDiagnostics.reason}`,
    `  contextFound: ${preview.programFlowDiagnostics.contextFound}`,
    `  wiredButNoFields: ${preview.programFlowDiagnostics.wiredButNoFields}`,
    `  programMissingAsBearish=${preview.programFlowDiagnostics.programMissingAsBearish}`,
    `  programPenaltyApplied=${preview.programFlowDiagnostics.programPenaltyApplied}`,
    `  programFlowUsedForLiveDecision=${preview.programFlowDiagnostics.programFlowUsedForLiveDecision}`,
    `  passiveProxyUsedForLiveDecision=${preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision}`,
    `  providerCallsAdded=${preview.programFlowDiagnostics.providerCallsAdded}`,
    `  nextAction: ${preview.programFlowDiagnostics.nextAction}`,
    `  executionImpact=${preview.programFlowDiagnostics.executionImpact}`,
  ].join('\n'));

  return sections;
}

function paginateNormalSupplyPreviewSections(sections: string[], maxChars: number): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  const pushCurrent = () => {
    if (current.length === 0) return;
    pages.push(current.join('\n\n'));
    current = [];
    currentLength = 0;
  };

  for (const section of sections.flatMap((item) => splitOversizedSectionByLine(item, maxChars))) {
    const nextLength = currentLength + (current.length > 0 ? 2 : 0) + section.length;
    if (current.length > 0 && nextLength > maxChars) pushCurrent();
    current.push(section);
    currentLength += (current.length > 1 ? 2 : 0) + section.length;
  }
  pushCurrent();

  const total = Math.max(1, pages.length);
  return pages.map((body, index) => [
    `🔬 [normal_supply_preview full mode] Page ${index + 1}/${total}`,
    '━━━━━━━━━━━━━━━━',
    body,
  ].join('\n'));
}

function splitOversizedSectionByLine(section: string, maxChars: number): string[] {
  if (section.length <= maxChars) return [section];
  const blocks = section.split('\n\n');
  if (blocks.length > 1) return splitOversizedSectionByBlock(blocks, maxChars);
  const chunks: string[] = [];
  let lines: string[] = [];
  let length = 0;
  for (const line of section.split('\n')) {
    const nextLength = length + (lines.length > 0 ? 1 : 0) + line.length;
    if (lines.length > 0 && nextLength > maxChars) {
      chunks.push(lines.join('\n'));
      lines = [];
      length = 0;
    }
    if (line.length > maxChars) {
      if (lines.length > 0) {
        chunks.push(lines.join('\n'));
        lines = [];
        length = 0;
      }
      chunks.push(...splitLongLine(line, maxChars));
      continue;
    }
    lines.push(line);
    length += (lines.length > 1 ? 1 : 0) + line.length;
  }
  if (lines.length > 0) chunks.push(lines.join('\n'));
  return chunks;
}

function splitOversizedSectionByBlock(blocks: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join('\n\n'));
    current = [];
    length = 0;
  };
  for (const block of blocks) {
    if (block.length > maxChars) {
      flush();
      chunks.push(...splitOversizedSectionByLine(block, maxChars));
      continue;
    }
    const nextLength = length + (current.length > 0 ? 2 : 0) + block.length;
    if (current.length > 0 && nextLength > maxChars) flush();
    current.push(block);
    length += (current.length > 1 ? 2 : 0) + block.length;
  }
  flush();
  return chunks;
}

function splitLongLine(line: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxChars) {
    chunks.push(line.slice(index, index + maxChars));
  }
  return chunks;
}

export function formatNormalSupplyPreviewMissingSection(error?: string): string {
  return [
    '🧪 <b>Normal Supply Preview with legacy defense policy disabled (ADR-0518)</b>',
    '━━━━━━━━━━━━━━━━',
    'status: NOT_COLLECTED',
    `previewMode: ${NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE}`,
    'liveExecutionAllowed: false',
    'realOrderAllowed: false',
    'shadowObservableAllowed: true',
    'executionImpact: NONE',
    ...(error ? [`error: ${error}`] : []),
    'nextAction: run /normal_supply_preview or wait for next diagnostic scan',
  ].join('\n');
}

function formatFullCandidateDetail(
  candidate: NormalSupplyPreviewCandidate,
  rank: number,
  options: { includeThreshold: boolean; includeInvalidWarning: boolean },
): string {
  const name = candidate.name ? ` ${escapePreviewHtmlText(candidate.name)}` : '';
  const lines = [
    `${rank}. ${candidate.symbol}${name}`,
    `   signal=${candidate.supplySignal} / supplyScore=${candidate.supplyScore}`,
    ...(options.includeThreshold
      ? [`   bullishThreshold=${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold}`]
      : []),
    ...(candidate.supplySignal === 'ACCUMULATING'
      ? [`   accumulatingRange=${NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold}~${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold - 1}`]
      : []),
    `   reason=${escapePreviewHtmlText(candidate.reason)}`,
    `   activeFlow=${escapePreviewHtmlText(candidate.activeFlow)}`,
    `   passiveFlow=${candidate.passiveFlow}`,
    `   confluence=${candidate.activePassiveConfluence}`,
    `   programFlow: stockLevel=${candidate.programFlow?.stockLevel.signal ?? 'UNAVAILABLE'} / marketLevel=${candidate.programFlow?.marketLevel.signal ?? 'UNAVAILABLE'}`,
    `   foreignNetBuy=${formatAmount(candidate.foreignNetBuyAmount)}`,
    `   institutionNetBuy=${formatAmount(candidate.institutionNetBuyAmount)}`,
    `   stockProgramNetBuy=${formatAmount(candidate.programFlow?.stockLevel.netBuy)}`,
    `   programValueReason=${candidate.programValueReason ?? candidate.programFlow?.stockLevel.valueReason ?? 'N/A'}`,
    `   marketProgramSignal=${candidate.programFlow?.marketLevel.signal ?? 'UNAVAILABLE'}`,
    `   programNetBuy=${formatAmount(candidate.programNetBuyAmount)}`,
    `   programMissingAsBearish=${candidate.programMissingAsBearish}`,
    '   programPenaltyApplied=false',
    '   passiveProxyUsedForLiveDecision=false',
    `   providerIssue=${candidate.providerIssue}`,
    `   marketSignal=${candidate.marketSignal}`,
    `   dataStatus=${candidate.dataStatus}`,
    `   sourceProvider=${candidate.sourceProvider}`,
    `   confidence=${candidate.confidence}`,
    `   watchlistPriorityBoost=${candidate.watchlistPriorityBoost}`,
    `   shadowTracking=${candidate.shadowTracking}`,
    `   programFlowDryRun=appliedToLiveScore:${candidate.programFlowDryRun.appliedToLiveScore}/reason:${candidate.programFlowDryRun.reason}`,
    '   usedForLiveDecision=false',
    '   strongBuyAllowed=false',
    '   executionImpact=NONE',
  ];
  if (options.includeInvalidWarning && candidate.invalidBearishReason) {
    lines.push(`   ⚠️ invalidBearishReason=${candidate.invalidBearishReason}`);
  }
  if (options.includeInvalidWarning && candidate.invalidBullishReason) {
    lines.push(`   ⚠️ invalidBullishReason=${candidate.invalidBullishReason}`);
  }
  return lines.join('\n');
}

function formatUnknownCandidateDetail(candidate: NormalSupplyPreviewCandidate, rank: number): string {
  const name = candidate.name ? ` ${escapePreviewHtmlText(candidate.name)}` : '';
  return [
    `${rank}. ${candidate.symbol}${name}`,
    `   reason=${escapePreviewHtmlText(candidate.reason)}`,
    `   providerIssue=${candidate.providerIssue}`,
    '   marketSignal=false',
    `   status=${candidate.dataStatus}`,
    `   sourceProvider=${candidate.sourceProvider}`,
    '   executionImpact=NONE',
    '   penaltyApplied=false',
  ].join('\n');
}

function buildThresholdExplanation(candidate: NormalSupplyPreviewCandidate | undefined): string {
  if (!candidate) return 'No candidate rows are available for threshold explanation.';
  if (candidate.supplySignal === 'ACCUMULATING') {
    return `supplyScore ${candidate.supplyScore} is below bullishThreshold ${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold} and inside accumulatingRange ${NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold}-${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold - 1}; quiet accumulation candidate, not a live buy signal.`;
  }
  if (candidate.supplySignal === 'NEUTRAL' && candidate.supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold) {
    return `supplyScore ${candidate.supplyScore} is below accumulatingRange ${NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold}-${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold - 1}; classified as NEUTRAL.`;
  }
  if (candidate.supplySignal === 'NEUTRAL' && candidate.supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold) {
    return `supplyScore ${candidate.supplyScore}은 ${candidate.reason} 기준이나 bullishThreshold ${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold} 미만이므로 NEUTRAL로 분류됩니다.`;
  }
  if (candidate.supplySignal === 'BULLISH') {
    return `supplyScore ${candidate.supplyScore}이며 현재 수급 신호가 BULLISH입니다.`;
  }
  if (candidate.supplySignal === 'BEARISH') {
    return `supplyScore ${candidate.supplyScore}이며 marketSignal=${candidate.marketSignal} 기준 BEARISH입니다. providerIssue는 bearish로 해석하지 않습니다.`;
  }
  return `supplyScore ${candidate.supplyScore}이며 dataStatus=${candidate.dataStatus}입니다. UNKNOWN/MISSING/STALE은 bearish penalty로 변환하지 않습니다.`;
}

function escapePreviewHtmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
