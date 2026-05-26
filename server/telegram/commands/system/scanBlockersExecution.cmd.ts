// @responsibility ADR-0527 Phase 2b — execution permission audit read from persisted unified resolution SSOT (no dummy-time recompute).
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import type {
  UnifiedExecutionPermissionAggregate,
  UnifiedExecutionPermissionResolution,
} from '../../../trading/gates/unifiedExecutionContract.js';
import { buildDiagnosticCommandHint } from '../../renderers/diagnosticButtonBuilder.js';
import { renderExecutionCompact } from '../../renderers/executionCompactRenderer.js';
import {
  buildSnapshotBundleFromScanSummary,
  executionSummaryFromUnifiedAggregate,
} from '../../renderers/snapshotBundle.js';

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

/** persist 된 per-candidate 통합 정본(스캔-시점 asOf 도출). 부재 시 빈 배열(graceful). */
function resolveCandidateResolutions(summary: AnyRecord | null): UnifiedExecutionPermissionResolution[] {
  return arrayOfRecords(summary?.candidateExecutionResolutions) as unknown as UnifiedExecutionPermissionResolution[];
}

function scopedCount(aggregate: AnyRecord | null, field: string): number {
  const value = getByPath(aggregate, `${field}.value`);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * ADR-0527 Phase 2b — execution 요약 라인.
 * UnifiedExecutionPermissionAggregate(스캔-시점 정본)를 read 한다(resolveFinalExecutionDecision 재실행 0).
 * shadowBuyAllowed(표시)는 aggregate.shadowOrderCreated(count) — per-candidate boolean 권한과 의미 분리.
 */
function runtimeLine(aggregate: AnyRecord | null): string {
  const liveBuy = scopedCount(aggregate, 'liveBuyAllowedCount');
  return [
    '[Execution]',
    `ENTRY_READY: ${scopedCount(aggregate, 'entryReadyCount')}`,
    `Live Buy: ${liveBuy}`,
    `Shadow Buy: ${scopedCount(aggregate, 'shadowOrderCreated')}`,
    `Observe: ${scopedCount(aggregate, 'observeOnlyCount')}`,
    `Top Block: ${text(aggregate?.topBlockReason, 'none')}`,
    `Impact: ${liveBuy > 0 ? 'LIVE_ORDER_ALLOWED' : scopedCount(aggregate, 'liveBuyBlockedCount') > 0 ? 'NEW_BUY_BLOCKED_ONLY' : 'NONE'}`,
    'Learning: ON',
  ].join('\n');
}

/**
 * ADR-0527 Phase 2b — full audit 라인을 persist 된 통합 정본에서 도출(더미 시각 재판정 제거).
 * permission boolean 군은 A(byte-equivalent)에서, decision/reasonCodes 라벨은 B 에서 병합된 정본을 표시한다.
 * leak detector(gate3LivePermissionLeakDetected/diagnosticOnlyBrokerOrderLeakDetected)는 통합 계약상
 * permission 이 A 정본이고 STRONG_BUY 가 label-only(strongBuyAsLabelOnly)이므로 구조적으로 0.
 */
function formatUnifiedAuditFull(
  sourceSnapshotId: string,
  resolutions: readonly UnifiedExecutionPermissionResolution[],
  aggregate: AnyRecord | null,
): string {
  const entryReady = scopedCount(aggregate, 'entryReadyCount');
  const liveBuyAllowed = scopedCount(aggregate, 'liveBuyAllowedCount');
  const liveBuyBlocked = scopedCount(aggregate, 'liveBuyBlockedCount');
  const shadowBuyAllowed = scopedCount(aggregate, 'shadowOrderCreated');
  const observeOnly = scopedCount(aggregate, 'observeOnlyCount');
  const blocked = scopedCount(aggregate, 'blockedCount');
  const blockReasonDistribution = (recordOf(aggregate?.blockReasonDistribution) ?? {}) as Record<string, number>;
  const counterfactualRecorded = resolutions.filter(r => r.counterfactualAllowed).length;
  const head = [
    '[scan_blockers_execution] Final Decision / Execution Permission',
    `sourceSnapshotId=${sourceSnapshotId}`,
    `evaluated: ${resolutions.length}`,
    `entryReady: ${entryReady}`,
    `liveBuyAllowed: ${liveBuyAllowed}`,
    `liveBuyBlocked: ${liveBuyBlocked}`,
    `shadowBuyAllowed: ${shadowBuyAllowed}`,
    `observeOnly: ${observeOnly}`,
    `blocked: ${blocked}`,
    // 불변식 #6: providerIssue 격리 — market signal 로 변환되지 않으므로 항상 0.
    'providerIssueConvertedToMarketSignal: 0',
    `counterfactualRecorded: ${counterfactualRecorded}`,
    // 통합 계약상 permission=A 정본 + STRONG_BUY label-only → live/broker leak 구조적 0.
    'gate3LivePermissionLeakDetected: 0',
    'diagnosticOnlyBrokerOrderLeakDetected: 0',
    `topBlockReason: ${text(aggregate?.topBlockReason, 'none')}`,
  ];
  const dist = Object.entries(blockReasonDistribution)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `- ${reason}: ${count}`);
  const perCandidate = resolutions.map((r) => {
    const reasons = r.reasonCodes.length > 0 ? r.reasonCodes.join('|') : 'none';
    return `- ${r.asOf} decision=${r.decision} liveBuy=${r.liveOrderAllowed} shadowBuy=${r.shadowPermissionAllowed} impact=${r.executionImpact} blockReason=${r.liveBlockReason} reasons=${reasons}`;
  });
  return [
    ...head,
    'blockReasonDistribution:',
    ...(dist.length > 0 ? dist : ['- none: 0']),
    'perCandidate:',
    ...(perCandidate.length > 0 ? perCandidate : ['- (no candidates)']),
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
    // ADR-0527 Phase 2b: execution 정본 = 스캔-시점 persist(candidateExecutionResolutions / executionResolutionAggregate).
    // 더미 시각(1970) resolveFinalExecutionDecision 재계산 제거 → 실제 asOf 정본 read(divergence 제거 = 의도된 정정).
    const aggregate = (summary?.executionResolutionAggregate ?? null) as UnifiedExecutionPermissionAggregate | null;
    const aggregateRecord = recordOf(aggregate);
    const resolutions = resolveCandidateResolutions(summary);
    const wantsFull = args.some(arg => ['full', 'detail'].includes(arg.toLowerCase()));
    if (!wantsFull) {
      const execution = executionSummaryFromUnifiedAggregate(aggregate);
      await reply([
        renderExecutionCompact({
          ...buildSnapshotBundleFromScanSummary(summary),
          execution,
          executionImpact: execution.executionImpact,
        }),
        buildDiagnosticCommandHint('execution'),
      ].join('\n'));
      return;
    }
    await reply([
      formatUnifiedAuditFull(sourceSnapshotId, resolutions, aggregateRecord),
      '',
      runtimeLine(aggregateRecord),
      '',
      'shadowLearning: ON',
      '',
      'note: read-only diagnostic; no provider fetch, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(scanBlockersExecution);

export default scanBlockersExecution;
