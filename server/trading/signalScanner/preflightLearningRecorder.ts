// @responsibility PATCH-0183 preflight learning recorder SSOT — Shadow/Universe learning recorders only.
/**
 * Extracted recorder helpers for preflight blocked-day learning.
 *
 * This module is intentionally side-effect limited:
 * - records ShadowLearningOnly scans for blocked preflight situations
 * - records CounterfactualUniverseLearning snapshots for preflight abort context
 * - never imports KIS order functions
 * - never mutates Gate/Kelly/order/live execution behavior
 * - recorder failures are catch-isolated and must not affect preflight abort flow
 */

import {
  isShadowLearningOnBlockedDaysEnabled,
  runShadowLearningOnlyScan,
  type ShadowLearningOnlyScanReason,
} from '../shadowLearningOnlyScan.js';
import type { SupplyHealthSnapshot } from '../../learning/supplyHealthLearning.js';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
import {
  buildCandidateSummaries,
  deriveUniverseLearningReason,
  recordCounterfactualUniverseLearningSnapshot,
} from './counterfactualUniverseLearningWiring.js';
import type { CounterfactualUniverseLearningReason } from '../../persistence/counterfactualUniverseLearningRepo.js';
import {
  recordPreflightBlockedScanSummary,
  type PreflightBlockedBy,
  type PreflightBlockedScanSummary,
} from './preflightBlockedScanSummary.js';
import { buildPreflightDiagnosticScanSummary } from './scanDiagnostics/preflightDiagnosticScanSummary.js';
import { setPreflightDiagnosticScanSummaryIfAbsent } from './scanDiagnostics/persistScanResults.js';
import { emitOperationalWarn } from '../../observability/operationalWarn.js';
import type { WarnMode } from '../../observability/operationalWarnTypes.js';

export type PreflightUniverseLearningStage =
  | 'BEFORE_UNIVERSE_BUILD'
  | 'AFTER_UNIVERSE_BUILD'
  | 'AFTER_CANDIDATE_SCAN'
  | 'BEFORE_BUYLIST_LOOP';

export interface PreflightUniverseLearningSnapshotInput {
  stage: PreflightUniverseLearningStage;
  primaryReason: string;
  watchlist?: WatchlistEntry[];
  regime?: string;
  marketSnapshot?: {
    riskMode?: string;
    sellOnly?: boolean;
    r6Defense?: boolean;
    emergencyStop?: boolean;
    regime?: string;
    vkospiLevel?: number;
    marketHealth?: string;
  };
  notes?: string[];
}

export async function captureSupplyHealthSnapshot(): Promise<SupplyHealthSnapshot | undefined> {
  if (process.env.NODE_ENV === 'test' && process.env.SUPPLY_HEALTH_LEARNING_ENABLED !== 'true') {
    return undefined;
  }
  try {
    const mod = await import('../../telegram/commands/system/supplyHealth.cmd.js');
    return await mod.buildSupplyHealthSnapshot();
  } catch (e) {
    console.warn('[SupplyHealth] snapshot capture failed:', e);
    return undefined;
  }
}

/**
 * ADR-0183: blocked-day shadow learning recorder.
 *
 * This must remain learning-only. It never allows real orders and never throws into
 * preflight control flow.
 */
export async function recordBlockedDayShadowScan(
  reason: ShadowLearningOnlyScanReason,
): Promise<void> {
  if (reason === 'VOLUME_CLOCK_BLOCK') {
    await recordPreflightUniverseLearningSnapshot({
      stage: 'BEFORE_BUYLIST_LOOP',
      primaryReason: 'VOLUME_CLOCK_BLOCK',
      notes: ['VOLUME_CLOCK_BLOCK — entry window closed; minimal universe snapshot recorded by preflight learning recorder'],
    });
  }
  if (!isShadowLearningOnBlockedDaysEnabled()) return;
  try {
    const kstScanDate = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const supplyHealthSnapshot = await captureSupplyHealthSnapshot();
    await runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason,
      scanDate: kstScanDate,
      ...(supplyHealthSnapshot ? { supplyHealthSnapshot } : {}),
    });
  } catch (e) {
    console.warn(`[ShadowLearningOnly] scan 실패 (${reason}):`, e);
  }
}

/**
 * ADR-0433: preflight abort universe-level learning snapshot recorder.
 *
 * Responsibility split:
 * - recordBlockedDayShadowScan = per-symbol hypothetical buy judgment
 * - recordPreflightUniverseLearningSnapshot = preflight context/universe preservation
 */
export async function recordPreflightUniverseLearningSnapshot(
  input: PreflightUniverseLearningSnapshotInput,
): Promise<{ recorded: boolean; candidateSummaryCount: number }> {
  try {
    const reasons: CounterfactualUniverseLearningReason[] = [
      deriveUniverseLearningReason(input.primaryReason),
    ];
    const watchlist = input.watchlist ?? [];
    const universeSize = watchlist.length;
    const candidates = watchlist.map((w, i) => ({
      symbol: w.code,
      name: w.name,
      sector: w.sector,
      source: 'watchlist',
      rank: i + 1,
    }));
    // ADR-0367: candidateSummaryCount 는 buildCandidateSummaries 의 sanitize 결과 길이 (invalid KRX code 제외,
    // Top N≤50 절삭). counterfactual env-disabled 여도 순수 함수라 항상 계산 가능 — preflight blocked summary 입력.
    const candidateSummaryCount = buildCandidateSummaries(candidates).length;
    const result = recordCounterfactualUniverseLearningSnapshot({
      preflightStage: input.stage,
      blockedBy: [input.primaryReason],
      reasons,
      regime: input.regime,
      universeSize,
      candidateCount: universeSize,
      candidates,
      marketSnapshot: input.marketSnapshot,
      notes: input.notes,
    });
    return { recorded: result.recorded, candidateSummaryCount };
  } catch (e) {
    console.warn('[CounterfactualUniverseLearning] preflight snapshot 영속 실패 — 격리 (abort 흐름 보호)', e);
    return { recorded: false, candidateSummaryCount: 0 };
  }
}

export interface PreflightBlockedScanMeta {
  blockedBy: PreflightBlockedBy;
  hardBlockSource?: string;
  hardBlockModule?: string;
  hardBlockReason?: string;
  preflightDecision?: string;
}

function toWarnMode(value: string | undefined): WarnMode | undefined {
  switch (value) {
    case 'LIVE':
    case 'SHADOW':
    case 'SHADOW_ONLY':
    case 'SELL_ONLY':
    case 'OBSERVE_ONLY':
    case 'NORMAL':
    case 'DEGRADED':
      return value;
    default:
      return undefined;
  }
}

function emitPreflightScanEvaluationWarn(summary: PreflightBlockedScanSummary): void {
  const scanEvaluation = summary.scanEvaluation;
  if (!scanEvaluation) return;
  const code = scanEvaluation.evaluationState === 'NOT_EVALUATED_R6_LIVE_BLOCKED'
    ? 'P1_LEGACY_R6_EVALUATION_IGNORED'
    : null;
  if (!code) return;
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DIAGNOSTIC',
    code,
    message: `${scanEvaluation.evaluationState} before buyListLoop`,
    executionImpact: scanEvaluation.executionImpact,
    mode: toWarnMode(scanEvaluation.engineMode),
    regime: scanEvaluation.effectiveRegime,
    dedupKey: `preflight-scan:${code}:${scanEvaluation.blockReason ?? summary.blockedBy}`,
    ttlSec: 60,
    details: {
      reason: scanEvaluation.blockReason ?? summary.blockedBy,
      evaluationState: scanEvaluation.evaluationState,
      breakPoint: scanEvaluation.breakPoint,
      sourcePath: scanEvaluation.sourcePath,
      scanId: scanEvaluation.scanId,
      normalStateMessage: 'Legacy defense policy ignored by rollback; Gate/data quality remains authoritative.',
      liveNewBuyAllowed: undefined,
      positionManagementAllowed: undefined,
      shadowLearningAllowed: scanEvaluation.shadowLearningAllowed,
    },
  });
}

/**
 * ADR-0367: buyListLoop 진입 전 preflight abort 시 universe learning snapshot + blocked scan summary 동시 영속.
 *
 * recordPreflightUniverseLearningSnapshot (counterfactual learning) 의 결과를 받아
 * preflightBlockedScanSummary SSOT 에 candidateSummaryCount / universeSnapshotRecorded /
 * counterfactualRecorded 를 propagate. ADR-0433 에서 universe snapshot = counterfactual learning event 가
 * 단일 영속 연산이므로 두 플래그 모두 learningResult.recorded 를 사용한다.
 * 실패는 catch 격리 — preflight abort 흐름을 절대 차단하지 않는다.
 */
export async function recordPreflightBlockedScan(
  learningInput: PreflightUniverseLearningSnapshotInput,
  blockMeta: PreflightBlockedScanMeta,
): Promise<PreflightBlockedScanSummary | null> {
  try {
    const learningResult = await recordPreflightUniverseLearningSnapshot(learningInput);
    const summary = recordPreflightBlockedScanSummary({
      blockedBy: blockMeta.blockedBy,
      hardBlockSource: blockMeta.hardBlockSource,
      hardBlockModule: blockMeta.hardBlockModule,
      hardBlockReason: blockMeta.hardBlockReason,
      preflightDecision: blockMeta.preflightDecision,
      candidateSummaryCount: learningResult.candidateSummaryCount,
      universeSnapshotRecorded: learningResult.recorded,
      counterfactualRecorded: learningResult.recorded,
    });
    emitPreflightScanEvaluationWarn(summary);
    // Patch: getLastScanSummary()가 null 로 남으면 /gate_full·Runtime Trace·ADR-0505 가 비므로,
    // canonical scanId/candidate 를 담은 minimal diagnostic ScanSummary 를 영속한다 (display-only, 실제 스캔 미clobber).
    try {
      setPreflightDiagnosticScanSummaryIfAbsent(buildPreflightDiagnosticScanSummary(summary));
    } catch (e) {
      /* SDS-ignore: diagnostic summary 영속 실패는 보조 — preflight abort 흐름을 절대 차단하지 않는다 */
      console.warn('[PreflightDiagnosticScanSummary] 영속 실패 — 격리 (abort 흐름 보호)', e);
    }
    return summary;
  } catch (e) {
    emitOperationalWarn({
      priority: 'P1',
      domain: 'DIAGNOSTIC',
      code: 'P1_SCAN_DIAGNOSTIC_BUILD_FAILED',
      message: 'Preflight blocked scan summary persistence failed',
      executionImpact: 'NONE',
      dedupKey: 'preflight-blocked-scan-summary:persist-failed',
      ttlSec: 300,
      details: {
        reason: e instanceof Error ? e.message : String(e),
        sourcePath: 'preflightLearningRecorder.recordPreflightBlockedScan',
      },
    });
    return null;
  }
}
