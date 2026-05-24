// @responsibility Compact FinalDecisionResolver runtime wiring audit from latest scan snapshot.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import { buildGate3RuntimeClosureSummary } from '../../../quant/gate3RuntimeClosure.js';
import {
  buildFinalDecisionRuntimeAuditSummary,
  formatFinalDecisionRuntimeAuditCompact,
  formatFinalDecisionRuntimeAuditFull,
  resolveFinalExecutionDecision,
  type FinalDecisionDataConfidenceCeiling,
  type FinalDecisionEffectiveRegime,
  type FinalDecisionEngineMode,
  type FinalDecisionEntryTimingSignal,
  type FinalDecisionMarketSession,
  type FinalDecisionProviderHealthStatus,
  type FinalDecisionShadowMode,
} from '../../../trading/gates/finalDecisionResolver.js';
import { buildDiagnosticCommandHint } from '../../renderers/diagnosticButtonBuilder.js';
import { renderExecutionCompact } from '../../renderers/executionCompactRenderer.js';
import { buildSnapshotBundleFromScanSummary, executionSummaryFromAudit } from '../../renderers/snapshotBundle.js';

type AnyRecord = Record<string, unknown>;

function recordOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.map(recordOf).filter((item): item is AnyRecord => Boolean(item)) : [];
}

function getByPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as AnyRecord)[part];
  }
  return current;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function bool(value: unknown): boolean {
  return value === true || String(value ?? '').trim().toLowerCase() === 'true';
}

function normalizeEngineMode(value: unknown): FinalDecisionEngineMode {
  const raw = text(value, 'OBSERVE_ONLY').toUpperCase();
  if (raw === 'NORMAL' || raw === 'DEGRADED' || raw === 'SELL_ONLY' || raw === 'SHADOW_ONLY' || raw === 'OBSERVE_ONLY') return raw;
  return 'OBSERVE_ONLY';
}

function normalizeMarketSession(value: unknown): FinalDecisionMarketSession {
  const raw = text(value, 'UNKNOWN').toUpperCase();
  if (raw === 'REGULAR' || raw === 'PRE_MARKET' || raw === 'POST_MARKET' || raw === 'HOLIDAY' || raw === 'LUNCH' || raw === 'UNKNOWN') return raw;
  if (raw === 'NON_TRADING_DAY' || raw === 'CLOSED') return 'HOLIDAY';
  return 'UNKNOWN';
}

function normalizeRegime(value: unknown): FinalDecisionEffectiveRegime {
  const raw = text(value, 'UNKNOWN').toUpperCase();
  if (raw === 'GREEN' || raw === 'YELLOW' || raw === 'RED' || raw === 'R6_DEFENSE' || raw === 'R5_STABILIZING' || raw === 'UNKNOWN') return raw;
  return raw.startsWith('R6') ? 'R6_DEFENSE' : 'UNKNOWN';
}

function normalizeHealth(value: unknown): FinalDecisionProviderHealthStatus {
  const raw = text(value, 'VERIFIED').toUpperCase();
  if (raw === 'VERIFIED' || raw === 'DEGRADED' || raw === 'STALE' || raw === 'MISSING') return raw;
  if (raw === 'FRESH' || raw === 'OK' || raw === 'PASS') return 'VERIFIED';
  return 'DEGRADED';
}

function normalizeConfidence(value: unknown): FinalDecisionDataConfidenceCeiling {
  const raw = text(value, 'HIGH').toUpperCase();
  return raw === 'LOW' || raw === 'MEDIUM' || raw === 'HIGH' ? raw : 'HIGH';
}

function resolveEntryFilter(summary: AnyRecord | null): AnyRecord | null {
  return recordOf(summary?.entryFilterDecomposition) ?? recordOf(summary?.entryFilterDecompositionAdr0464);
}

function resolveCandidateTraces(summary: AnyRecord | null): AnyRecord[] {
  return arrayOfRecords(resolveEntryFilter(summary)?.candidateTraces);
}

function resolveSourceSnapshotId(summary: AnyRecord | null): string {
  return text(
    summary?.sourceSnapshotId
      ?? summary?.scanId
      ?? getByPath(summary, 'candidatePool.sourceSnapshotId')
      ?? getByPath(summary, 'entryFilterDecomposition.sourceSnapshotId')
      ?? getByPath(summary, 'gateLayerAudit.sourceSnapshotId')
      ?? summary?.asOf
      ?? summary?.time,
    'UNKNOWN_SOURCE_SNAPSHOT',
  );
}

function shadowModeFor(engineMode: FinalDecisionEngineMode): FinalDecisionShadowMode {
  if (engineMode === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  if (engineMode === 'OBSERVE_ONLY') return 'OBSERVE_ONLY';
  return 'NORMAL';
}

function runtimeLine(summary: ReturnType<typeof buildFinalDecisionRuntimeAuditSummary>): string {
  return [
    '[Execution]',
    `ENTRY_READY: ${summary.entryReady}`,
    `Live Buy: ${summary.liveBuyAllowed}`,
    `Shadow Buy: ${summary.shadowBuyAllowed}`,
    `Observe: ${summary.observeOnly}`,
    `Top Block: ${Object.entries(summary.blockReasonDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none'}`,
    `Impact: ${Object.entries(summary.executionImpactDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'NONE'}`,
    'Learning: ON',
  ].join('\n');
}

const scanBlockersExecution: TelegramCommand = {
  name: '/scan_blockers_execution',
  aliases: ['/blockers_execution', '/execution_blockers', '/execution_audit'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'FinalDecisionResolver execution permission audit from latest scan blockers',
  usage: '/scan_blockers_execution',
  async execute({ args, reply }) {
    const summary = recordOf(getLastScanSummary());
    const sourceSnapshotId = resolveSourceSnapshotId(summary);
    const traces = resolveCandidateTraces(summary);
    const gate3 = buildGate3RuntimeClosureSummary({ traces, sourceSnapshotId });
    const engineMode = normalizeEngineMode(
      summary?.engineMode ?? summary?.executionMode ?? getByPath(summary, 'runtimePolicy.engineMode'),
    );
    const marketSession = normalizeMarketSession(
      summary?.marketSession ?? summary?.marketSessionState ?? getByPath(summary, 'runtimePolicy.marketSessionState'),
    );
    const effectiveRegime = normalizeRegime(
      summary?.effectiveRegime ?? summary?.macroRegime ?? getByPath(summary, 'runtimePolicy.effectiveRegime'),
    );
    const providerIssue = bool(summary?.providerIssue ?? getByPath(summary, 'runtimePolicy.providerIssue'));
    const marketSignal = bool(summary?.marketSignal ?? getByPath(summary, 'runtimePolicy.marketSignal'));

    const inputs = gate3.results.map((result) => {
      const trace = traces.find((item) => text(item.symbol) === result.symbol) ?? {};
      return {
        sourceSnapshotId,
        symbol: result.symbol,
        asOf: text(summary?.asOf ?? summary?.time, '1970-01-01T00:00:00.000Z'),
        gate1Status: result.gate1Status,
        gate2Status: result.gate2Status,
        gate3Readiness: result.gate3Readiness,
        entryTimingSignal: result.entryTimingSignal as FinalDecisionEntryTimingSignal,
        engineMode,
        marketSession,
        effectiveRegime,
        riskOverride: effectiveRegime === 'R6_DEFENSE' ? 'R6_DEFENSE' as const : 'NONE' as const,
        providerHealth: {
          quote: normalizeHealth(result.priceFreshness),
          supply: normalizeHealth(getByPath(trace, 'providerHealth.supply') ?? trace.supplyConfidence),
          dart: normalizeHealth(getByPath(trace, 'providerHealth.dart') ?? trace.dartConfidence),
          macro: normalizeHealth(getByPath(trace, 'providerHealth.macro') ?? getByPath(summary, 'providerHealth.macro')),
        },
        dataConfidenceCeiling: normalizeConfidence(trace.dataConfidenceCeiling ?? summary?.dataConfidenceCeiling),
        marketSignal,
        providerIssue: providerIssue || bool(trace.providerIssue),
        shadowMode: shadowModeFor(engineMode),
        requestedSide: 'BUY' as const,
        currentPositionState: 'NONE' as const,
        isDiagnosticOnly: bool(trace.isDiagnosticOnly) || result.gate3Readiness === 'SKIPPED',
      };
    });
    const decisions = inputs.map(input => resolveFinalExecutionDecision(input, new Date('1970-01-01T00:00:00.000Z')));
    const audit = buildFinalDecisionRuntimeAuditSummary({ sourceSnapshotId, decisions, inputs });
    const wantsFull = args.some(arg => ['full', 'detail'].includes(arg.toLowerCase()));
    if (!wantsFull) {
      await reply([
        renderExecutionCompact({
          ...buildSnapshotBundleFromScanSummary(summary),
          execution: executionSummaryFromAudit(audit),
          executionImpact: executionSummaryFromAudit(audit).executionImpact,
        }),
        buildDiagnosticCommandHint('execution'),
      ].join('\n'));
      return;
    }
    await reply([
      formatFinalDecisionRuntimeAuditCompact(audit),
      '',
      runtimeLine(audit),
      '',
      formatFinalDecisionRuntimeAuditFull(audit),
      '',
      'note: read-only diagnostic; no provider fetch, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(scanBlockersExecution);

export default scanBlockersExecution;
