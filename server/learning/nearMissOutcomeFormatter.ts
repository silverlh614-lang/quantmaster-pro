/**
 * @responsibility ADR-454b Near-Miss Outcome 평가 결과 포맷터 — Telegram/diagnostic read-only 노출.
 *
 * DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY outcome ledger 의 3/5/10영업일
 * 관측 결과를 운영자에게 보여주기만 한다. live decision, Kelly, Gate threshold, KIS 주문,
 * entryEngine 에는 어떤 값도 전달하지 않는다.
 */
import type {
  NearMissOutcomeHorizon,
  NearMissOutcomeSummary,
} from '../persistence/nearMissOutcomeLedger.js';
import type { NearMissOutcomeEvaluationResult } from './nearMissOutcomeEvaluator.js';

const HORIZONS: readonly NearMissOutcomeHorizon[] = [3, 5, 10];

function formatPct(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function formatHorizon(summary: NearMissOutcomeSummary, horizon: NearMissOutcomeHorizon): string {
  const observed = summary.observedCountByHorizon[horizon] ?? 0;
  const avg = summary.avgReturnPctByHorizon[horizon] ?? 0;
  return `${horizon}d ${formatPct(avg)} (n=${observed})`;
}

/**
 * /scan_blockers 용 compact line. Ledger 가 비어 있으면 noise 를 만들지 않는다.
 */
export function formatNearMissOutcomeDiagnosticLine(
  summary: NearMissOutcomeSummary | null | undefined,
): string | null {
  if (!summary || summary.totalCount === 0) return null;

  return [
    '🧪 Near-Miss Outcome (ADR-454b):',
    `total ${summary.totalCount}`,
    `active ${summary.activeCount}`,
    `closed ${summary.closedCount}`,
    HORIZONS.map((horizon) => formatHorizon(summary, horizon)).join(' | '),
    'executionImpact NONE',
  ].join(' ');
}

/**
 * 장마감 cron Telegram/report 용 multi-line formatter.
 */
export function formatNearMissOutcomeEvaluationReport(result: NearMissOutcomeEvaluationResult): string {
  const lines = [
    '🧪 Near-Miss Outcome Evaluation (ADR-454b)',
    '• scope: DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY only',
    '• executionImpact: NONE — diagnostic/learning only',
    `• refreshed: observed ${result.updated}, skipped ${result.skipped}, newlyClosed ${result.closed}`,
    `• ledger: total ${result.summary.totalCount}, active ${result.summary.activeCount}, closed ${result.summary.closedCount}`,
    `• avg return: ${HORIZONS.map((horizon) => formatHorizon(result.summary, horizon)).join(' | ')}`,
    '• safety: no live promotion, no normalizedGateScore decision use, no Kelly/Gate/KIS/entryEngine changes',
  ];

  return lines.join('\n');
}
