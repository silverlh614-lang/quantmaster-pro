/**
 * @responsibility Patch: preflight-blocked Page-1 canonical reconciliation — preflightBlockedScanSummary 를
 * runtime truth(universe/counterfactual ledger + ScanSummary)와 정합 + QMP_DIAGNOSTIC_CANONICAL_MISMATCH 표시.
 *
 * 배경: preflightBlockedScanSummary 는 buyListLoop 차단 시점에 frozen 되어 universeSnapshotRecorded /
 * counterfactualRecorded / buyListLoopEntered 를 박제한다. 그러나 /scan_blockers full 후반(RuntimePipelineAudit
 * ADR-461, Learning Status ADR-0433)은 누적 ledger + 직전 ScanSummary 를 읽어 RECORDED/true 를 표시한다.
 * Page 1 이 frozen 값 단독을 보이면 같은 출력 안에서 truth 가 충돌한다. 본 모듈은 Page 1 상단에 reconcile 된
 * canonical summary 를 만들어 충돌을 제거하고, frozen vs runtime 불일치를 명시 warning 으로 노출한다.
 *
 * 절대 invariant: executionImpact='NONE' literal. 실거래/Gate/SourceSnapshot 0줄 변경 (display-only, byte-equivalent).
 */
import type { ScanSummary } from './scanSummaryTypes.js';
import type { PreflightBlockedScanSummary } from '../preflightBlockedScanSummary.js';
import { summarizeCounterfactualUniverseLearningLedger } from '../../../persistence/counterfactualUniverseLearningRepo.js';

export interface PreflightCanonicalReconciliation {
  preflightBlocked: true;
  liveExecutionBlocked: true;
  diagnosticCarried: boolean;
  buyListLoopEnteredDiagnostic: boolean;
  universeSnapshotRecorded: boolean;
  counterfactualRecorded: boolean;
  shadowLearningRecorded: boolean;
  executionImpact: 'NONE';
  canonicalScanId: string;
  preflightScanId: string;
  summaryScanId: string | null;
  mismatches: string[];
}

const CANONICAL_MISMATCH_MARKER = '[QMP_DIAGNOSTIC_CANONICAL_MISMATCH]';

/** RuntimePipelineAudit.resolveCanonicalSourceSnapshotId 와 동일 우선순위 (summary 우선). */
function resolveSummaryScanId(summary: ScanSummary | null): string | null {
  if (!summary) return null;
  return (
    summary.snapshotId ??
    summary.scanEvaluation?.scanId ??
    (summary.time ? `scan-summary:${summary.time}` : null)
  );
}

/** RuntimePipelineAudit.buyListLoopEntered 와 동일 판정식 (gate sample / gate1 pass / near-miss 중 하나라도 있으면 true). */
function resolveBuyListLoopEnteredDiagnostic(summary: ScanSummary | null): boolean {
  if (!summary) return false;
  const gateSamples = summary.gateScoreHealth?.samples ?? 0;
  const gate1Pass = summary.gatePassDistribution?.gate1Pass ?? 0;
  const nearMiss = summary.gate1DryRunObservationLedger?.sources?.GATE1_NEAR_MISS ?? 0;
  return gateSamples > 0 || gate1Pass > 0 || nearMiss > 0;
}

export function buildPreflightCanonicalReconciliation(
  summary: ScanSummary | null,
  preflightBlocked: PreflightBlockedScanSummary,
): PreflightCanonicalReconciliation {
  let ledgerHasSnapshots = false;
  try {
    ledgerHasSnapshots = summarizeCounterfactualUniverseLearningLedger().totalSnapshots > 0;
  } catch {
    /* SDS-ignore: ledger read 실패는 진단 보조 — frozen preflight flag 로 폴백, executionImpact 없음 */
    ledgerHasSnapshots = false;
  }

  const buyListLoopEnteredDiagnostic = resolveBuyListLoopEnteredDiagnostic(summary);
  // ADR-0433: universe snapshot 영속 = counterfactual learning = shadow learning 이 단일 영속 연산.
  const universeSnapshotRecorded = preflightBlocked.universeSnapshotRecorded || ledgerHasSnapshots;
  const counterfactualRecorded = preflightBlocked.counterfactualRecorded || ledgerHasSnapshots;
  const shadowLearningRecorded = universeSnapshotRecorded;
  const diagnosticCarried =
    universeSnapshotRecorded || counterfactualRecorded || buyListLoopEnteredDiagnostic;

  const preflightScanId = preflightBlocked.scanEvaluation?.scanId ?? preflightBlocked.scanId;
  const summaryScanId = resolveSummaryScanId(summary);
  const canonicalScanId = summaryScanId ?? preflightScanId;

  const mismatches: string[] = [];
  if (ledgerHasSnapshots && !preflightBlocked.universeSnapshotRecorded) {
    mismatches.push(`${CANONICAL_MISMATCH_MARKER} universeSnapshotRecorded preflightFrozen=false vs ledger=true`);
  }
  if (ledgerHasSnapshots && !preflightBlocked.counterfactualRecorded) {
    mismatches.push(`${CANONICAL_MISMATCH_MARKER} counterfactualRecorded preflightFrozen=false vs ledger=true`);
  }
  if (buyListLoopEnteredDiagnostic && preflightBlocked.buyListLoopEntered === false) {
    mismatches.push(`${CANONICAL_MISMATCH_MARKER} buyListLoopEntered preflightFrozen=false vs runtime=true`);
  }
  if (summaryScanId && summaryScanId !== preflightScanId) {
    mismatches.push(`${CANONICAL_MISMATCH_MARKER} scanId preflight=${preflightScanId} vs summary=${summaryScanId}`);
  }

  return {
    preflightBlocked: true,
    liveExecutionBlocked: true,
    diagnosticCarried,
    buyListLoopEnteredDiagnostic,
    universeSnapshotRecorded,
    counterfactualRecorded,
    shadowLearningRecorded,
    executionImpact: 'NONE',
    canonicalScanId,
    preflightScanId,
    summaryScanId,
    mismatches,
  };
}

/**
 * Page 1 상단 canonical reconciliation 블록. preflightBlockedScanSummary 단독 frozen 값이 아니라
 * runtime truth 와 reconcile 한 결과를 표시한다. 아래에 이어지는 preflight 상세는 차단 시점 frozen snapshot(증거)이며,
 * frozen 과 runtime 이 다르면 CanonicalWarnings 가 그 divergence 를 명시한다.
 */
export function formatPreflightCanonicalReconciliationSection(
  recon: PreflightCanonicalReconciliation,
): string {
  const lines: string[] = [];
  lines.push('🧭 <b>[Canonical Reconciliation]</b>');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`canonicalScanId=${recon.canonicalScanId}`);
  lines.push(`preflightBlocked=${recon.preflightBlocked}`);
  lines.push(`liveExecutionBlocked=${recon.liveExecutionBlocked}`);
  lines.push(`diagnosticCarried=${recon.diagnosticCarried}`);
  lines.push(`buyListLoopEnteredDiagnostic=${recon.buyListLoopEnteredDiagnostic}`);
  lines.push(`universeSnapshotRecorded=${recon.universeSnapshotRecorded}`);
  lines.push(`universeCounterfactualRecorded=${recon.counterfactualRecorded}`);
  lines.push(`shadowLearningRecorded=${recon.shadowLearningRecorded}`);
  lines.push(`executionImpact=${recon.executionImpact}`);
  lines.push(
    recon.mismatches.length > 0
      ? `CanonicalWarnings: ${recon.mismatches.join(' | ')}`
      : 'CanonicalWarnings: none',
  );
  lines.push(
    '<i>아래 preflight 상세는 buyListLoop 차단 시점 frozen snapshot(증거)이며, 본 canonical 요약은 ' +
      'runtime truth(universe/counterfactual ledger + 직전 ScanSummary)와 reconcile 한 값입니다. 실거래 영향 없음.</i>',
  );
  return lines.join('\n');
}
