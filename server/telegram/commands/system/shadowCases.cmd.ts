// @responsibility shadowCases.cmd — compact read-only Shadow blocked case runtime summary.
// @responsibility: /shadow_cases — 차단 사유별 Shadow 학습 케이스 누적 상태를 한 화면에 요약.

import { loadShadowLearningOnlySignals } from '../../../persistence/shadowLearningOnlySignalRepo.js';
import type { ShadowLearningOnlySignal } from '../../../trading/shadowLearningOnlyScan.js';
import {
  formatPct,
  loadAndSummarizeShadowBlockedOutcomes,
  type ShadowBlockedOutcomeSummary,
  type ShadowOutcomeAttributionSummary,
} from '../../../learning/shadowBlockedOutcomeAnalytics.js';
import {
  isShadowFutureReturnTargetMature,
  loadAndBuildShadowFutureReturnCacheCoverageSummary,
  type ShadowFutureReturnCacheCoverageSummary,
} from '../../../learning/shadowFutureReturnCacheProvider.js';
import type { ShadowFutureReturnHorizon } from '../../../learning/shadowFutureReturnResolver.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

interface HorizonMaturityRow {
  horizon: ShadowFutureReturnHorizon;
  total: number;
  resolved: number;
  maturePending: number;
  notYetDue: number;
}

const MATURITY_HORIZONS: ShadowFutureReturnHorizon[] = ['1d', '5d', '20d'];

function compactReason(row: ShadowOutcomeAttributionSummary): string {
  return `${row.key}: n=${row.total}, pend=${row.pendingCount}, res=${row.resolvedAnyCount}, 1d=${formatPct(row.avgReturn1d)}, over=${row.overBlockedCount}`;
}

function hasResolvedHorizon(signal: ShadowLearningOnlySignal, horizon: ShadowFutureReturnHorizon): boolean {
  if (horizon === '1d') return typeof signal.futureReturn1d === 'number';
  if (horizon === '3d') return typeof signal.futureReturn3d === 'number';
  if (horizon === '5d') return typeof signal.futureReturn5d === 'number';
  return typeof signal.futureReturn20d === 'number';
}

function buildOutcomeMaturityRows(now = new Date()): HorizonMaturityRow[] {
  const signals = loadShadowLearningOnlySignals();
  return MATURITY_HORIZONS.map((horizon) => {
    let resolved = 0;
    let maturePending = 0;
    let notYetDue = 0;
    for (const signal of signals) {
      if (hasResolvedHorizon(signal, horizon)) {
        resolved += 1;
        continue;
      }
      const mature = isShadowFutureReturnTargetMature({
        symbol: signal.symbol,
        signalDate: signal.signalDate,
        horizon,
        signal,
      }, now);
      if (mature) maturePending += 1;
      else notYetDue += 1;
    }
    return { horizon, total: signals.length, resolved, maturePending, notYetDue };
  });
}

function formatMaturityRows(rows: HorizonMaturityRow[]): string[] {
  return [
    '',
    '<b>Evidence maturity</b>',
    ...rows.map((row) => `${row.horizon}: resolved=${row.resolved}/${row.total}, due=${row.maturePending}, notYetDue=${row.notYetDue}`),
  ];
}

function deriveVerdict(summary: ShadowBlockedOutcomeSummary): string {
  if (summary.totalSignals === 0) return '⚪ no blocked cases yet';
  if (summary.pendingSignals > summary.resolvedSignals) return '🟡 accumulating — outcomes still pending';
  if (summary.topOverBlockedReasons.length > 0) return '🟠 over-block watch active';
  return '🟢 learning ledger healthy';
}

function formatManualBlockWatch(summary: ShadowBlockedOutcomeSummary, maturityRows: HorizonMaturityRow[]): string[] {
  const manual = summary.byBlockedReason.find((row) => row.blockedReason === 'MANUAL_BLOCK');
  if (!manual) return [];
  const positive1d = (manual.avgReturn1d ?? 0) > 0;
  const enoughMediumTerm = manual.resolved5dCount >= 10 || manual.resolved20dCount >= 10;
  const row5d = maturityRows.find((row) => row.horizon === '5d');
  const row20d = maturityRows.find((row) => row.horizon === '20d');
  const maturityHint = row5d && row20d
    ? `maturity: 5d notYetDue=${row5d.notYetDue}, 20d notYetDue=${row20d.notYetDue}`
    : 'maturity: n/a';
  const verdict = positive1d
    ? enoughMediumTerm
      ? 'watch medium-term outcomes before policy change'
      : 'positive 1d; wait for 5d/20d evidence'
    : 'no positive 1d opportunity-loss signal';
  return [
    '',
    '<b>Manual block watch</b>',
    compactReason(manual),
    `5d=${formatPct(manual.avgReturn5d)} (${manual.resolved5dCount}) · 20d=${formatPct(manual.avgReturn20d)} (${manual.resolved20dCount})`,
    maturityHint,
    `판정: ${verdict}`,
    '<i>read-only watch; no policy relaxation.</i>',
  ];
}

function formatReturnCacheLine(coverage: ShadowFutureReturnCacheCoverageSummary): string {
  return `returnCache: miss=${coverage.cacheMisses} · unresolved=${coverage.unresolvedSignals} · due=${coverage.notYetDueLookups}`;
}

function formatShadowCases(): string {
  const summary = loadAndSummarizeShadowBlockedOutcomes();
  const coverage = loadAndBuildShadowFutureReturnCacheCoverageSummary();
  const maturityRows = buildOutcomeMaturityRows();
  if (summary.totalSignals === 0) {
    return [
      '🧪 <b>SHADOW CASES</b>',
      '⚪ no blocked learning cases yet',
      '',
      '상세: /shadow_blocked_outcomes',
      '<i>read-only; executionImpact=NONE.</i>',
    ].join('\n');
  }

  const topReasons = summary.byBlockedReason.slice(0, 5);
  const overTop = summary.topOverBlockedReasons[0];
  const lines = [
    '🧪 <b>SHADOW CASES</b>',
    deriveVerdict(summary),
    `total=${summary.totalSignals} · resolved=${summary.resolvedSignals} · pending=${summary.pendingSignals}`,
    formatReturnCacheLine(coverage),
    ...formatMaturityRows(maturityRows),
    '',
    '<b>Top reasons</b>',
    ...topReasons.map((row, idx) => `${idx + 1}. ${compactReason(row)}`),
    ...formatManualBlockWatch(summary, maturityRows),
    '',
    `<b>Over-block top</b>: ${overTop ? compactReason(overTop) : 'none'}`,
    '상세: /shadow_blocked_outcomes',
    '<i>read-only; executionImpact=NONE.</i>',
  ];
  return lines.join('\n');
}

const shadowCases: TelegramCommand = {
  name: '/shadow_cases',
  aliases: ['/shadow_blocked_summary', '/blocked_cases'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Shadow blocked learning cases compact summary — read-only',
  usage: '/shadow_cases',
  async execute({ reply }) {
    await reply(formatShadowCases());
  },
};

commandRegistry.register(shadowCases);

export default shadowCases;
export { formatShadowCases, formatManualBlockWatch, buildOutcomeMaturityRows };
