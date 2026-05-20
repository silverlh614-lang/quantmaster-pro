// @responsibility Render Telegram regime text from RegimeSnapshot only.
import { formatMarketStateNow, type MarketStateNowContext } from '../marketStateResolver.js';
import type { ResolvedRegimeSnapshot } from './effectiveRegimeSnapshot.js';
import { normalizeNowDisplay, normalizeR6LatchDisplay } from '../../telegram/nowDisplayNormalizer.js';

export type NowRenderMode = 'COMPACT' | 'DEBUG';

export interface NowRenderOptions {
  mode: NowRenderMode;
  includeRaw: boolean;
}

export type NowRenderOptionsInput = Partial<NowRenderOptions>;

export const NOW_COMPACT_RENDER_OPTIONS: NowRenderOptions = { mode: 'COMPACT', includeRaw: false };
export const NOW_DEBUG_RENDER_OPTIONS: NowRenderOptions = { mode: 'DEBUG', includeRaw: true };

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

export function normalizeNowRenderOptions(options: NowRenderOptionsInput = {}): NowRenderOptions {
  const mode = options.mode ?? (options.includeRaw ? 'DEBUG' : 'COMPACT');
  return {
    mode,
    includeRaw: mode === 'DEBUG' || options.includeRaw === true,
  };
}

function formatKstDateTime(value: string | undefined): string {
  if (!value) return 'N/A';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const kst = new Date(parsed + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min} KST`;
}

function formatKstHm(value: string | undefined): string {
  if (!value) return 'N/A';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const kst = new Date(parsed + 9 * 60 * 60 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min} KST`;
}

function formatTriggerList(triggers: string[] | undefined): string {
  return triggers && triggers.length > 0 ? triggers.join(', ') : 'none';
}

function formatDisplayNumber(value: number | null | undefined, digits: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'N/A';
}

function compactReason(snapshot: ResolvedRegimeSnapshot): string {
  if (isR6Snapshot(snapshot)) return 'BLACK_SWAN_OVERRIDE / next trading day confirmation';
  return snapshot.marketState.reasonCodes.length > 0 ? snapshot.marketState.reasonCodes.join(' / ') : 'NONE';
}

function compactNowIcon(snapshot: ResolvedRegimeSnapshot): string {
  if (isR6Snapshot(snapshot)) return '[R6]';
  return snapshot.marketState.displayEmoji || '[NOW]';
}

function compactMhsLabel(snapshot: ResolvedRegimeSnapshot): string {
  return isR6Snapshot(snapshot) ? 'OVERRIDDEN_BY_R6' : snapshot.marketState.mhsDisplayLabel;
}

function buildNowDisplay(snapshot: ResolvedRegimeSnapshot, context: MarketStateNowContext) {
  return normalizeNowDisplay({
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
}

function formatRegimeTelegramNowCompact(
  snapshot: ResolvedRegimeSnapshot,
  context: MarketStateNowContext = {},
): string {
  const display = buildNowDisplay(snapshot, context);
  const action = snapshot.marketState.liveNewBuyAllowed ? 'BUY_ALLOWED' : 'HOLD';
  const liveBuy = snapshot.marketState.liveNewBuyAllowed ? 'ALLOWED' : 'BLOCKED';
  const shadow = snapshot.marketState.shadowLearningAllowed ? 'ON' : 'OFF';
  const latch = snapshot.marketState.r6Latch;
  const latchDisplay = latch
    ? normalizeR6LatchDisplay({
      activeR6Triggers: latch.activeTriggers,
      previousR6Triggers: latch.previousTriggers,
      releaseEligibleAt: latch.releaseEligibleAt,
      expiresAt: latch.expiresAt,
    })
    : undefined;

  const header = [
    '[NOW]',
    `Snapshot: ${snapshot.snapshotId}`,
    `asOf: ${formatKstDateTime(snapshot.asOf)}`,
    '',
    `${compactNowIcon(snapshot)} ${snapshot.displayRegime} / ${action}`,
    `Live Buy: ${liveBuy}`,
    `Shadow: ${shadow}`,
    '',
    `Display regime: ${snapshot.displayRegime}`,
    `Effective regime: ${snapshot.effectiveRegime}`,
    `RiskOverride: ${snapshot.riskOverride} / engineMode=${snapshot.engineMode}`,
    `MHS: ${formatDisplayNumber(snapshot.mhs, 0)} ${compactMhsLabel(snapshot)}`,
    `Bias: ${snapshot.marketState.biasLabel} ${formatDisplayNumber(snapshot.biasScore, 1)}`,
    `Final: ${snapshot.riskOverride !== 'NONE' ? 'Risk Override priority' : snapshot.effectiveRegime}`,
    `Reason: ${compactReason(snapshot)}`,
    '',
    `Data: ${display.dataLine}`,
    `- ${display.dataExplanation}`,
    `- ${display.providerIsolationLabel} / marketSignal=${snapshot.marketSignal ? 'true' : 'false'}`,
    '',
    ...(latch ? [
      'R6 latch:',
      `- state: ${latchDisplay?.state ?? 'NONE'}`,
      `- retained: ${formatTriggerList(latch.previousTriggers)}`,
      `- releaseEligibleAt: ${formatKstHm(latch.releaseEligibleAt)}`,
      `- explanation: ${latchDisplay?.explanation ?? 'N/A'}`,
      '',
    ] : [
      'R6 latch:',
      '- state: NONE',
      '',
    ]),
    'Shadow:',
    `- position management: ${snapshot.marketState.positionManagementAllowed ? 'ON' : 'OFF'} / SELL checks ${context.shadowActivity?.sellCheckCount ?? 0}`,
    `- candidate scan: ${display.shadowScanLabel}`,
    `- paperFillCount: ${context.shadowActivity?.paperFillCount ?? 0}`,
    `- openShadowPositions: ${context.shadowActivity?.openShadowPositions ?? 0}`,
    '',
    'raw detail: /now_debug',
  ];
  return header.join('\n');
}

function formatRegimeTelegramNowDebug(
  snapshot: ResolvedRegimeSnapshot,
  context: MarketStateNowContext = {},
): string {
  const legacy = sanitizeLegacyMarketStateText(formatMarketStateNow(snapshot.marketState, context), snapshot);
  const display = buildNowDisplay(snapshot, context);
  const header = [
    '[NOW DEBUG]',
    'DEBUG VIEW - raw fields included. Decisions follow the compact summary Effective regime.',
    `Snapshot: ${snapshot.snapshotId} asOf=${snapshot.asOf} ttlSec=${snapshot.ttlSec}`,
    `Display regime: ${snapshot.displayRegime}`,
    `Effective regime: ${snapshot.effectiveRegime}`,
    `riskOverride=${snapshot.riskOverride} engineMode=${snapshot.engineMode}`,
    `Data: ${display.dataLine}`,
    `Data note: ${display.dataExplanation}`,
    'rawData:',
    `rawData: dataHealth=${snapshot.sourceHealth} providerIssue=${snapshot.providerIssue} marketSignal=${snapshot.marketSignal}`,
    ...formatMacroReleaseBlockLines(snapshot),
    `conflicts=${display.conflictLabel}`,
    ...(display.notes.length > 0 ? [`displayWarnings=${display.notes.join(',')}`] : []),
    'R6 latch raw:',
    'Shadow raw:',
    'macroState raw:',
    '',
  ].join('\n');
  return header + legacy;
}

export function formatRegimeTelegramNow(
  snapshot: ResolvedRegimeSnapshot,
  context: MarketStateNowContext = {},
  options: NowRenderOptionsInput = NOW_COMPACT_RENDER_OPTIONS,
): string {
  return normalizeNowRenderOptions(options).mode === 'DEBUG'
    ? formatRegimeTelegramNowDebug(snapshot, context)
    : formatRegimeTelegramNowCompact(snapshot, context);
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
