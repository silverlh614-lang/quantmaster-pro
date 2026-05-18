// @responsibility Render Telegram regime text from RegimeSnapshot only.
import { formatMarketStateNow, type MarketStateNowContext } from '../marketStateResolver.js';
import type { ResolvedRegimeSnapshot } from './effectiveRegimeSnapshot.js';

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
  const header = [
    `Snapshot: ${snapshot.snapshotId} asOf=${snapshot.asOf} ttlSec=${snapshot.ttlSec}`,
    `Display regime: ${snapshot.displayRegime}`,
    `Effective regime: ${snapshot.effectiveRegime}`,
    `riskOverride=${snapshot.riskOverride} engineMode=${snapshot.engineMode}`,
    `dataHealth=${snapshot.sourceHealth} providerIssue=${snapshot.providerIssue} marketSignal=${snapshot.marketSignal}`,
    `conflicts=${snapshot.conflicts.join(',') || 'none'}`,
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
