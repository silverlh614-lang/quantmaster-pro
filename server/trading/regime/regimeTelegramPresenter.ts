// @responsibility Render Telegram regime text from RegimeSnapshot only.
import { formatMarketStateNow, type MarketStateNowContext } from '../marketStateResolver.js';
import type { ResolvedRegimeSnapshot } from './effectiveRegimeSnapshot.js';
import { normalizeNowDisplay } from '../../telegram/nowDisplayNormalizer.js';

function isR6Snapshot(snapshot: ResolvedRegimeSnapshot): boolean {
  return snapshot.riskOverride === 'R6_DEFENSE' ||
    snapshot.effectiveRegime === 'R6_DEFENSE' ||
    snapshot.effectiveRegime === 'R6_PANIC';
}

function sanitizeR6LegacyLine(line: string, snapshot: ResolvedRegimeSnapshot): string {
  if (line.includes(' OK')) return line.replace('OK', 'HOLD');
  if (line.startsWith('MHS: ')) {
    return line
      .replace(/\bGREEN\b/g, `riskOverride=${snapshot.riskOverride}`)
      .replace(/\bYELLOW\b/g, `riskOverride=${snapshot.riskOverride}`)
      .replace(/\bRED\b/g, `riskOverride=${snapshot.riskOverride}`);
  }
  if (line === 'Raw trend: GREEN') return `Raw trend: macro_green_overridden_by_${snapshot.displayRegime}`;
  return line;
}

function formatMacroReleaseBlockLines(snapshot: ResolvedRegimeSnapshot): string[] {
  if (!snapshot.macroReleaseBlockMessage) return [];
  const details = snapshot.macroReleaseBlockDetails;
  return [
    snapshot.macroReleaseBlockMessage,
    `macroFreshness=${snapshot.marketState.macroState.freshness} ageSec=${details?.ageSec ?? 'N/A'} lastRefreshAttemptAt=${details?.lastRefreshAttemptAt ?? 'N/A'} refreshJobLastRunAt=${details?.refreshJobLastRunAt ?? 'N/A'} executionImpact=${details?.executionImpact ?? snapshot.marketState.macroState.executionImpact}`,
  ];
}

function sanitizeLegacyMarketStateText(text: string, snapshot: ResolvedRegimeSnapshot): string {
  if (!isR6Snapshot(snapshot)) return text;
  return text
    .split('\n')
    .map((line) => sanitizeR6LegacyLine(line, snapshot))
    .join('\n');
}

export function formatRegimeTelegramNow(
  snapshot: ResolvedRegimeSnapshot,
  context: MarketStateNowContext = {},
): string {
  const legacy = sanitizeLegacyMarketStateText(formatMarketStateNow(snapshot.marketState, context), snapshot);
  const display = normalizeNowDisplay({
    dataHealth: snapshot.sourceHealth,
    providerIssue: snapshot.providerIssue,
    marketSignal: snapshot.marketSignal,
    conflicts: snapshot.conflicts,
    freshness: snapshot.marketState.macroState.freshness,
    ageSec: snapshot.marketState.macroState.ageSec,
    ttlSec: snapshot.marketState.macroState.ttlSec,
    softStaleSec: snapshot.marketState.macroState.softStaleSec,
    hardStaleSec: snapshot.marketState.macroState.hardStaleSec,
    updatedAt: snapshot.marketState.macroState.updatedAt,
    lastRefreshSuccessAt: snapshot.marketState.macroState.lastRefreshSuccessAt,
    shadowCandidateScanStatus: context.shadowActivity?.candidateScanStatus,
    shadowCandidateScanSkipReason: context.shadowActivity?.candidateSkipReason ?? context.shadowActivity?.lastBlockReason,
    shadowPolicyOn: snapshot.marketState.shadowScanAllowed,
    shadowLearningAllowed: snapshot.marketState.shadowLearningAllowed,
    shadowScanAllowed: snapshot.marketState.shadowScanAllowed,
    trigger: context.shadowActivity?.candidateScanTrigger,
    effectiveRegime: snapshot.effectiveRegime,
    riskOverride: snapshot.riskOverride,
  });
  const header = [
    `Snapshot: ${snapshot.snapshotId} asOf=${snapshot.asOf} ttlSec=${snapshot.ttlSec}`,
    `Display regime: ${snapshot.displayRegime}`,
    `Effective regime: ${snapshot.effectiveRegime}`,
    `riskOverride=${snapshot.riskOverride} engineMode=${snapshot.engineMode}`,
    `Data: ${display.dataLine}`,
    `Data note: ${display.dataExplanation}`,
    `rawData: dataHealth=${snapshot.sourceHealth} providerIssue=${snapshot.providerIssue} marketSignal=${snapshot.marketSignal}`,
    ...formatMacroReleaseBlockLines(snapshot),
    `conflicts=${display.conflictLabel}`,
    ...(display.notes.length > 0 ? [`displayWarnings=${display.notes.join(',')}`] : []),
    '',
  ].join('\n');
  return header + legacy;
}

export function formatRegimeSnapshotCompact(snapshot: ResolvedRegimeSnapshot): string {
  return [
    `snapshotId=${snapshot.snapshotId}`,
    `displayRegime=${snapshot.displayRegime}`,
    `effectiveRegime=${snapshot.effectiveRegime}`,
    `riskOverride=${snapshot.riskOverride}`,
    `engineMode=${snapshot.engineMode}`,
    `sourceHealth=${snapshot.sourceHealth}`,
  ].join(' ');
}
