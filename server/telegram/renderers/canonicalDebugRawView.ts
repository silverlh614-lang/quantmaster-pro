// @responsibility ADR-0525 canonical debug_raw view contract — persisted summary slice projection with scope tags, zero recomputation.

import type { ScanSummary } from '../../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js';
import { buildSnapshotBundleFromScanSummary, numberOf, recordOf, topKey } from './snapshotBundle.js';

/**
 * 표본 출처 태그 (ADR-0525 §Decision.2). 각 진단 숫자가 어느 표본에서 왔는지 명시한다.
 * debug_raw 와 scan_blockers 가 서로 다른 표본을 비교하지 못하도록 직렬화한다.
 */
export type CanonicalScope =
  | 'ALL_CANDIDATES'
  | 'GATE1_SURVIVAL_SAMPLE'
  | 'GATE2_COVERAGE_SAMPLE'
  | 'GATE3_TIMING_SAMPLE'
  | 'PAPER_OBSERVATIONAL'
  | 'SIZING_SAMPLE'
  | 'RUNTIME_RESOLUTION';

/** scope 태그를 부착한 진단 count. 모든 정본 숫자는 본 형태로 직렬화한다. */
export interface ScopedCount {
  scope: CanonicalScope;
  value: number;
}

/** gate3Consolidated (persisted 정본) 의 직렬화 슬라이스. 순수 추출 — 재계산 0. */
export interface CanonicalGate3ViewSlice {
  samples: ScopedCount;
  lastTriggerFiredCount: ScopedCount;
  lastTriggerWaitCount: ScopedCount;
  lastTriggerThresholdNotMetCount: ScopedCount;
  lastTriggerDataUnavailableCount: ScopedCount;
  rrrPassCount: ScopedCount;
  rrrWatchCount: ScopedCount;
  rrrFailCount: ScopedCount;
  rrrMissingCount: ScopedCount;
  executionReadyCount: ScopedCount;
  setupReadyCount: ScopedCount;
  /** persisted gate3Consolidated.executionImpact top key (재계산 금지, 추출만). */
  executionImpact: string;
}

/** gate1Survival (persisted 정본) 의 직렬화 슬라이스. */
export interface CanonicalGate1ViewSlice {
  samples: ScopedCount;
  liveBuyBlockedCount: ScopedCount;
  shadowAllowedCount: ScopedCount;
}

/** canonicalRuntimeResolution.sizing 슬라이스 (Step27 정본 추출). */
export interface CanonicalSizingViewSlice {
  hardBlockCount: ScopedCount;
  advisoryCount: ScopedCount;
  finalKelly: number | null;
}

/**
 * ADR-0525 정본 debug_raw view. persisted ScanSummary 에서 순수 추출한 슬라이스 모음.
 * 추론·재계산·더미 시각 재판정 금지 — 모든 필드는 summary 의 기존 정본을 투영한다.
 */
export interface CanonicalDebugRawView {
  sourceSnapshotId: string;
  asOf: string;
  marketSession: string;
  engineMode: string;
  effectiveRegime: string;
  gate1Survival?: CanonicalGate1ViewSlice;
  gate3Consolidated?: CanonicalGate3ViewSlice;
  sizing?: CanonicalSizingViewSlice;
  /** 정본 슬라이스가 누락된 축 (summary 미존재) 의 사유. silent drop 금지 (SDS). */
  missingSlices: string[];
}

function scoped(scope: CanonicalScope, value: number): ScopedCount {
  return { scope, value };
}

/**
 * ADR-0525 정본 debug_raw view 빌더. persisted ScanSummary 에서 정본 슬라이스를 순수 추출한다.
 * 구현 규칙 — 재계산 0, 추출만, 모든 count 에 scope 태그 부착.
 *   gate3:  summary.gateLayerAudit.gate3Consolidated (GATE3_TIMING_SAMPLE)
 *   gate1:  summary.gateLayerAudit.gate1Survival      (GATE1_SURVIVAL_SAMPLE)
 *   sizing: summary.canonicalRuntimeResolution.sizing (SIZING_SAMPLE)
 *
 * scan 메타(sourceSnapshotId/asOf/marketSession/engineMode/effectiveRegime)는
 * /scan_blockers base 와 동일한 정본 해석 로직(buildSnapshotBundleFromScanSummary)을 재사용한다.
 * 특히 effectiveRegime 은 scanEvaluation.effectiveRegime(정본)이며 폐기된 macroRegimeEffective 를 읽지 않는다.
 * 슬라이스가 없으면 해당 필드를 비우고 missingSlices 에 사유를 push 한다 (silent drop 금지, SDS).
 */
export function buildCanonicalDebugRawView(summary: ScanSummary | null): CanonicalDebugRawView {
  const missingSlices: string[] = [];

  // scan 메타: scan_blockers base 와 동일한 정본 해석 (effectiveRegime = scanEvaluation.effectiveRegime SSOT).
  const base = buildSnapshotBundleFromScanSummary(summary);

  const summaryRecord = recordOf(summary);
  const gateLayer = recordOf(summaryRecord?.gateLayerAudit);

  // gate3Consolidated — persisted 정본 (GATE3_TIMING_SAMPLE). 재계산 금지, 추출만.
  const gate3Raw = recordOf(gateLayer?.gate3Consolidated);
  let gate3Consolidated: CanonicalGate3ViewSlice | undefined;
  if (gate3Raw) {
    gate3Consolidated = {
      samples: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.samples, 0)),
      lastTriggerFiredCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.lastTriggerFiredCount, 0)),
      lastTriggerWaitCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.lastTriggerWaitCount, 0)),
      lastTriggerThresholdNotMetCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.lastTriggerThresholdNotMetCount, 0)),
      lastTriggerDataUnavailableCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.lastTriggerDataUnavailableCount, 0)),
      rrrPassCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.rrrPassCount, 0)),
      rrrWatchCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.rrrWatchCount, 0)),
      rrrFailCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.rrrFailCount, 0)),
      rrrMissingCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.rrrMissingCount, 0)),
      executionReadyCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.executionReadyCount, 0)),
      // setupReadyCount 는 persisted Gate3ConsolidatedAuditSummary 에 없는 필드 — 추출 0 (재계산 금지).
      setupReadyCount: scoped('GATE3_TIMING_SAMPLE', numberOf(gate3Raw.setupReadyCount, 0)),
      // executionImpact distribution 의 top key 추출 (snapshotBundle.topKey 재사용, 재계산 금지).
      executionImpact: topKey(gate3Raw.executionImpact, 'NONE'),
    };
    if (gate3Raw.setupReadyCount === undefined) {
      missingSlices.push('gate3Consolidated.setupReadyCount: persisted gate3Consolidated 에 없는 필드 — 0 으로 투영');
    }
  } else {
    missingSlices.push('gate3Consolidated: summary.gateLayerAudit.gate3Consolidated 미존재');
  }

  // gate1Survival — persisted 정본 (GATE1_SURVIVAL_SAMPLE).
  const gate1Raw = recordOf(gateLayer?.gate1Survival);
  let gate1Survival: CanonicalGate1ViewSlice | undefined;
  if (gate1Raw) {
    gate1Survival = {
      samples: scoped('GATE1_SURVIVAL_SAMPLE', numberOf(gate1Raw.samples, 0)),
      liveBuyBlockedCount: scoped('GATE1_SURVIVAL_SAMPLE', numberOf(gate1Raw.liveBuyBlockedCount, 0)),
      shadowAllowedCount: scoped('GATE1_SURVIVAL_SAMPLE', numberOf(gate1Raw.shadowAllowedCount, 0)),
    };
  } else {
    missingSlices.push('gate1Survival: summary.gateLayerAudit.gate1Survival 미존재');
  }

  // sizing — canonicalRuntimeResolution.sizing (Step27 정본, SIZING_SAMPLE).
  const sizingRaw = recordOf(recordOf(summaryRecord?.canonicalRuntimeResolution)?.sizing);
  let sizing: CanonicalSizingViewSlice | undefined;
  if (sizingRaw) {
    const finalKellyRaw = sizingRaw.finalKelly;
    sizing = {
      hardBlockCount: scoped('SIZING_SAMPLE', numberOf(sizingRaw.hardBlockCount, 0)),
      advisoryCount: scoped('SIZING_SAMPLE', numberOf(sizingRaw.advisoryCount, 0)),
      finalKelly: typeof finalKellyRaw === 'number' && Number.isFinite(finalKellyRaw) ? finalKellyRaw : null,
    };
  } else {
    missingSlices.push('sizing: summary.canonicalRuntimeResolution.sizing 미존재');
  }

  return {
    sourceSnapshotId: base.sourceSnapshotId,
    asOf: base.asOf,
    marketSession: base.marketSession,
    engineMode: base.engineMode,
    effectiveRegime: base.effectiveRegime,
    ...(gate1Survival ? { gate1Survival } : {}),
    ...(gate3Consolidated ? { gate3Consolidated } : {}),
    ...(sizing ? { sizing } : {}),
    missingSlices,
  };
}
