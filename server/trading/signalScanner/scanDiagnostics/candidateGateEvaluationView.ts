// @responsibility ADR-0526 per-candidate Gate0/1/2/3 evaluation SSOT contract + deterministic producer — formatters read this view, never re-infer from raw traces.

import type { CanonicalScope, ScopedCount } from '../../../telegram/renderers/canonicalDebugRawView.js';
import { buildGate2ConfluenceSummary, type Gate2ConfluenceSummary, type Gate2Status } from '../../../quant/gate2ConfluenceScore.js';
import { buildGate3RuntimeClosureSummary, type Gate3RuntimeClosureSummary } from '../../../quant/gate3RuntimeClosure.js';
import type { Gate3CandidateDetail, Gate3Readiness } from '../../../quant/gate3CandidateDetail.js';
import { logger } from '../../../utils/logger.js';
import type { ScanSummary } from './scanSummaryTypes.js';

export type { CanonicalScope, ScopedCount };

/** 게이트 통과 상태 (정본 판정 — formatter 재추론 금지). */
export type GateEvaluationStatus =
  | 'PASS'
  | 'PASS_WEAK'
  | 'WATCH'
  | 'FAIL'
  | 'DATA_INCOMPLETE'
  | 'SKIPPED'
  | 'UNKNOWN';

/** Gate3 타이밍 준비 상태 (정본 판정). */
export type Gate3TimingReadiness =
  | 'READY'
  | 'SETUP_READY'
  | 'TRIGGER_WAIT'
  | 'TIMING_FAIL'
  | 'DATA_INCOMPLETE'
  | 'SKIPPED';

/** 단일 게이트 판정. permission(boolean) 은 status 와 별도로 명시한다 (ADR-0527 정렬). */
export interface GateLayerVerdict {
  status: GateEvaluationStatus;
  /** 본 게이트를 통과했는가 (정본 boolean). status 와 중복이 아니라 명시적 권한 신호. */
  passPermission: boolean;
  /** 본 게이트의 정본 top block reason (정본이 계산 — formatter 아님). */
  topBlockReason: string;
}

/** Gate3 전용 판정 — 타이밍 readiness + permission 분리. */
export interface Gate3LayerVerdict {
  readiness: Gate3TimingReadiness;
  /** 타이밍 준비 완료 권한 (boolean). 집계 count 와 이름 분리. */
  timingReadyPermission: boolean;
  topBlockReason: string;
}

/**
 * ADR-0526 per-candidate Gate0/1/2/3 판단 정본. formatter 는 본 view 만 읽는다.
 * candidateTraces (rich/raw trace) 에서 pass/fail/topBlockReason 을 재추론하지 않는다.
 */
export interface CandidateGateEvaluationView {
  symbol: string;
  name?: string;
  sourceSnapshotId: string;
  asOf: string;
  scope: CanonicalScope;
  gate0: GateLayerVerdict;
  gate1: GateLayerVerdict;
  gate2: GateLayerVerdict;
  gate3: Gate3LayerVerdict;
  /** 전 게이트 통합 top block reason (우선순위 레지스트리 정본 계산). */
  topBlockReason: string;
}

/**
 * gate2 축(axis) 커버리지 기술자 — pass/fail status 가 *아닌* 표시용 보조 지표.
 * gate2 PASS/FAIL status 정본은 aggregate 의 gate2*Count 다. 이 블록은 axis 가용성/대표 axis 만 담는다.
 * View 생산자가 confluence 정본에서 1회 도출(formatter 재실행 금지).
 */
export interface CandidateGate2Coverage {
  rsUsable: number;
  supplyUsable: number;
  sectorUsable: number;
  technicalUsable: number;
  fundamentalUsable: number;
  topPositiveAxis: string;
  topMissingAxis: string;
  /** ADR-0599 dry-run — 비례 기준 적용 시 도달했을 STRONG/WEAK 수 (표시용 보조, 상태 정본 아님). */
  wouldStrongProportional?: number;
  wouldWeakProportional?: number;
}

/**
 * per-candidate view 의 roll-up 집계. 모든 필드는 *Count 접미사 (count) 이며
 * permission(boolean) 과 이름이 분리된다 (ADR-0526 §Decision.2, ADR-0527 정렬).
 */
export interface CandidateGateEvaluationAggregate {
  evaluatedCount: ScopedCount;
  gate1PassCount: ScopedCount;
  gate2PassStrongCount: ScopedCount;
  gate2PassWeakCount: ScopedCount;
  gate2WatchCount: ScopedCount;
  gate2FailCount: ScopedCount;
  gate2DataIncompleteCount: ScopedCount;
  gate3ReadyCount: ScopedCount;
  gate3TriggerWaitCount: ScopedCount;
  gate3TimingFailCount: ScopedCount;
  /** gate2 축 커버리지 기술자 (표시용 보조 — status 정본 아님). 미도출 시 부재. */
  gate2Coverage?: CandidateGate2Coverage;
  /** 통합 top block reason 분포 (정본 계산). */
  topBlockReasonDistribution: Record<string, number>;
}

// ───────────────────────── producer (ADR-0526 Phase 1a) ─────────────────────────
//
// 결정론적: 동일 summary → 동일 View. 더미 시각 재판정 금지(네트워크/파일 IO 0, gate2 캐시 미사용).
// candidateTraces / gate1CandidateTraces / gate3Consolidated.candidateDetails 를 정당한
// 정규화 생산자로서 읽되, 판정 도출은 기존 formatter 와 *동일* 라이브러리를 공유한다(1b 순수 swap):
//   - gate2: buildGate2ConfluenceSummary (scanBlockersGate2.cmd 가 쓰는 동일 함수).
//   - gate3: gateLayerAudit.gate3Consolidated.candidateDetails (Phase0 정본, 재계산 금지).
//   - gate1: entryFilterDecomposition.gate1CandidateTraces (gate1CandidateTrace 정본).

type AnyRecord = Record<string, unknown>;

function recordOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
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

/** scan 메타 정본 해석 — snapshotBundle / canonicalDebugRawView 와 동일 우선순위(가법 일치). */
function resolveSourceSnapshotId(summary: AnyRecord): string {
  return text(
    summary.sourceSnapshotId
      ?? summary.snapshotId
      ?? getByPath(summary, 'scanEvaluation.scanId')
      ?? getByPath(summary, 'candidatePool.sourceSnapshotId')
      ?? getByPath(summary, 'entryFilterDecomposition.sourceSnapshotId')
      ?? getByPath(summary, 'gateLayerAudit.sourceSnapshotId')
      ?? getByPath(summary, 'macroGateState.regimeSnapshotId'),
    'SNAPSHOT_MISSING',
  );
}

function resolveAsOf(summary: AnyRecord): string {
  return text(
    summary.asOf
      ?? getByPath(summary, 'scanEvaluation.asOf')
      ?? summary.time
      ?? getByPath(summary, 'macroGateState.regimeSnapshotAsOf'),
    new Date(0).toISOString(),
  );
}

/**
 * gate0 통합 top block reason 우선순위 레지스트리 (정본 — formatter 아님).
 * gate0 fail > gate1 fail > gate2 fail > gate3 timing fail > none.
 * 코드 상수로 명시한다 (ADR-0526 §Decision.3, 결정론적 도출).
 */
export const COMBINED_TOP_BLOCK_PRIORITY = ['GATE0', 'GATE1', 'GATE2', 'GATE3', 'NONE'] as const;

/** Gate2Status → 정본 GateEvaluationStatus 매핑 (gate2ConfluenceScore 의 status 의미를 보존). */
function mapGate2Status(status: Gate2Status): GateEvaluationStatus {
  switch (status) {
    case 'GATE2_PASS_STRONG':
      return 'PASS';
    case 'GATE2_PASS_WEAK':
      return 'PASS_WEAK';
    case 'GATE2_WATCH':
      return 'WATCH';
    case 'GATE2_FAIL':
      return 'FAIL';
    case 'DATA_INCOMPLETE':
      return 'DATA_INCOMPLETE';
    case 'SKIPPED_BY_GATE1':
      return 'SKIPPED';
    default:
      return 'UNKNOWN';
  }
}

/** Gate3 candidateDetail.readiness → 정본 Gate3TimingReadiness 매핑 (Phase0 판정 보존). */
function mapGate3Readiness(readiness: Gate3Readiness): Gate3TimingReadiness {
  switch (readiness) {
    case 'READY':
      return 'READY';
    case 'WAIT':
      return 'TRIGGER_WAIT';
    case 'BLOCKED':
      return 'TIMING_FAIL';
    case 'DATA_INCOMPLETE':
      return 'DATA_INCOMPLETE';
    default:
      return 'SKIPPED';
  }
}

/** gate1 status 도출 — gate1CandidateTrace 의 pass/hardFail/softFail 정본에서. */
function deriveGate1Verdict(trace: AnyRecord | undefined): GateLayerVerdict {
  if (!trace) {
    return { status: 'SKIPPED', passPermission: false, topBlockReason: 'GATE1_TRACE_MISSING' };
  }
  const passed = trace.gate1Passed === true;
  const hardFailCount = typeof trace.hardFailCount === 'number' ? trace.hardFailCount : 0;
  const softFailCount = typeof trace.softFailCount === 'number' ? trace.softFailCount : 0;
  const primaryFailCode = text(trace.primaryFailCode);
  let status: GateEvaluationStatus;
  if (passed) status = softFailCount > 0 ? 'PASS_WEAK' : 'PASS';
  else if (hardFailCount > 0) status = 'FAIL';
  else if (softFailCount > 0) status = 'WATCH';
  else status = 'DATA_INCOMPLETE';
  const topBlockReason = passed ? 'NONE' : primaryFailCode || (hardFailCount > 0 ? 'GATE1_HARD_FAIL' : 'GATE1_SOFT_FAIL');
  return { status, passPermission: passed, topBlockReason };
}

/**
 * gate0 (pre-filter: 유니버스/유동성/데이터 품질) 도출 — candidate trace 의 blockers 에서.
 * gate0 단계 차단이 없으면 PASS. blocker 부재(데이터 없음) 시 SKIPPED.
 */
const GATE0_BLOCKER_CATEGORIES = new Set(['UNIVERSE', 'WATCHLIST', 'DATA_QUALITY', 'PROVIDER_ISSUE']);
const GATE0_HARD_CODES = new Set(['PRICE_DATA_STALE', 'LIQUIDITY_LOW']);

function deriveGate0Verdict(candidateTrace: AnyRecord | undefined): GateLayerVerdict {
  if (!candidateTrace) {
    return { status: 'SKIPPED', passPermission: false, topBlockReason: 'GATE0_TRACE_MISSING' };
  }
  const blockers = arrayOfRecords(candidateTrace.blockers);
  const gate0Hard = blockers.find((b) => GATE0_HARD_CODES.has(text(b.code)));
  const gate0Block = blockers.find((b) => GATE0_BLOCKER_CATEGORIES.has(text(b.category)) && text(b.severity) === 'HARD_BLOCK');
  if (gate0Hard) {
    return { status: 'FAIL', passPermission: false, topBlockReason: text(gate0Hard.code, 'GATE0_FAIL') };
  }
  if (gate0Block) {
    return { status: 'FAIL', passPermission: false, topBlockReason: text(gate0Block.code, 'GATE0_FAIL') };
  }
  return { status: 'PASS', passPermission: true, topBlockReason: 'NONE' };
}

/** 통합 top block reason — COMBINED_TOP_BLOCK_PRIORITY 순서로 첫 fail 게이트 사유를 채택. */
function resolveCombinedTopBlockReason(
  gate0: GateLayerVerdict,
  gate1: GateLayerVerdict,
  gate2: GateLayerVerdict,
  gate3: Gate3LayerVerdict,
): string {
  if (!gate0.passPermission && gate0.status === 'FAIL') return gate0.topBlockReason;
  if (!gate1.passPermission && gate1.status === 'FAIL') return gate1.topBlockReason;
  if (gate2.status === 'FAIL' || gate2.status === 'DATA_INCOMPLETE') return gate2.topBlockReason;
  if (gate3.readiness === 'TIMING_FAIL' || gate3.readiness === 'DATA_INCOMPLETE') return gate3.topBlockReason;
  return 'NONE';
}

/**
 * persisted ScanSummary 에서 per-candidate Gate0/1/2/3 판단 정본 View 를 결정론적으로 빌드한다.
 * 동일 summary → 동일 View. 더미 시각/네트워크/캐시 미사용. summary/traces 부재 시 빈 배열 + SDS 로깅.
 */
export function buildCandidateGateEvaluationViews(summary: ScanSummary | null): CandidateGateEvaluationView[] {
  const summaryRecord = recordOf(summary);
  if (!summaryRecord) {
    logger.debug('[ADR-0526] candidateGateView build skipped: summary 미존재 (graceful empty)');
    return [];
  }
  const entryFilter = recordOf(summaryRecord.entryFilterDecomposition);
  const candidateTraces = arrayOfRecords(entryFilter?.candidateTraces);
  if (candidateTraces.length === 0) {
    logger.debug('[ADR-0526] candidateGateView build skipped: entryFilterDecomposition.candidateTraces 미존재/빈 배열 (graceful empty)');
    return [];
  }

  const sourceSnapshotId = resolveSourceSnapshotId(summaryRecord);
  const asOf = resolveAsOf(summaryRecord);

  // gate2: scanBlockersGate2.cmd 가 쓰는 *동일* 라이브러리 — gate2 캐시 없이 traces 만으로 도출(결정론).
  const gate2Confluence = buildGate2ConfluenceSummary({
    traces: candidateTraces as readonly Record<string, unknown>[],
    sourceSnapshotId,
  });
  const gate2BySymbol = new Map<string, Gate2Status>(gate2Confluence.results.map((r) => [r.symbol, r.gate2Status]));
  const gate2BlockerBySymbol = new Map<string, string>(
    gate2Confluence.results.map((r) => [r.symbol, r.primaryBlocker ?? 'NONE']),
  );

  // gate1: gate1CandidateTraces 정본 (per-symbol).
  const gate1BySymbol = new Map<string, AnyRecord>();
  for (const trace of arrayOfRecords(entryFilter?.gate1CandidateTraces)) {
    const symbol = text(trace.symbol);
    if (symbol) gate1BySymbol.set(symbol, trace);
  }

  // gate3: Phase0 정본 candidateDetails (per-symbol). 재계산 금지.
  const gate3Details = (recordOf(getByPath(summaryRecord, 'gateLayerAudit.gate3Consolidated'))?.candidateDetails ?? []) as readonly Gate3CandidateDetail[];
  const gate3BySymbol = new Map<string, Gate3CandidateDetail>();
  for (const detail of gate3Details) {
    if (detail && typeof detail.symbol === 'string') gate3BySymbol.set(detail.symbol, detail);
  }

  return candidateTraces.map((candidateTrace) => {
    const symbol = text(candidateTrace.symbol ?? getByPath(candidateTrace, 'quote.symbol'), 'UNKNOWN');
    const name = text(candidateTrace.name);

    const gate0 = deriveGate0Verdict(candidateTrace);
    const gate1 = deriveGate1Verdict(gate1BySymbol.get(symbol));

    const gate2Status = gate2BySymbol.get(symbol) ?? 'DATA_INCOMPLETE';
    const gate2Mapped = mapGate2Status(gate2Status);
    const gate2: GateLayerVerdict = {
      status: gate2Mapped,
      passPermission: gate2Mapped === 'PASS' || gate2Mapped === 'PASS_WEAK',
      topBlockReason: gate2Mapped === 'PASS' || gate2Mapped === 'PASS_WEAK'
        ? 'NONE'
        : gate2BlockerBySymbol.get(symbol) ?? `GATE2_${gate2Status}`,
    };

    const gate3Detail = gate3BySymbol.get(symbol);
    const gate3Readiness = gate3Detail ? mapGate3Readiness(gate3Detail.readiness) : 'SKIPPED';
    const gate3: Gate3LayerVerdict = {
      readiness: gate3Readiness,
      timingReadyPermission: gate3Readiness === 'READY',
      topBlockReason: gate3Detail
        ? (gate3Readiness === 'READY' ? 'NONE' : String(gate3Detail.issue))
        : 'GATE3_DETAIL_MISSING',
    };

    const topBlockReason = resolveCombinedTopBlockReason(gate0, gate1, gate2, gate3);

    return {
      symbol,
      ...(name ? { name } : {}),
      sourceSnapshotId,
      asOf,
      scope: 'ALL_CANDIDATES',
      gate0,
      gate1,
      gate2,
      gate3,
      topBlockReason,
    };
  });
}

function scoped(scope: CanonicalScope, value: number): ScopedCount {
  return { scope, value };
}

/**
 * gate2 confluence 정본 스냅샷을 스캔-시점 traces 에서 1회 도출한다(gate2 캐시 미사용 → 결정론).
 * formatter(scanBlockersGate2/Gate3)가 본 스냅샷을 read 하여 buildGate2ConfluenceSummary 재실행을 제거한다.
 * traces 부재 시 undefined(graceful).
 */
export function buildCandidateGate2ConfluenceSnapshot(summary: ScanSummary | null): Gate2ConfluenceSummary | undefined {
  const summaryRecord = recordOf(summary);
  if (!summaryRecord) return undefined;
  const entryFilter = recordOf(summaryRecord.entryFilterDecomposition);
  const candidateTraces = arrayOfRecords(entryFilter?.candidateTraces);
  if (candidateTraces.length === 0) return undefined;
  return buildGate2ConfluenceSummary({
    traces: candidateTraces as readonly Record<string, unknown>[],
    sourceSnapshotId: resolveSourceSnapshotId(summaryRecord),
  });
}

/**
 * gate3 runtime closure 정본 스냅샷을 스캔-시점 traces + gate2 confluence(스캔-시점, 캐시 미사용)에서 1회 도출.
 * formatter(scanBlockersGate3)가 buildGate3RuntimeClosureSummary 를 재실행하지 않고 본 스냅샷을 read.
 * gate2StatusBySymbol 은 confluence 정본에서 도출(View 와 동일 status 도출 경로) → 결정론.
 */
export function buildCandidateGate3ClosureSnapshot(summary: ScanSummary | null): Gate3RuntimeClosureSummary | undefined {
  const summaryRecord = recordOf(summary);
  if (!summaryRecord) return undefined;
  const entryFilter = recordOf(summaryRecord.entryFilterDecomposition);
  const candidateTraces = arrayOfRecords(entryFilter?.candidateTraces);
  if (candidateTraces.length === 0) return undefined;
  const sourceSnapshotId = resolveSourceSnapshotId(summaryRecord);
  const confluence = buildCandidateGate2ConfluenceSnapshot(summaryRecord as unknown as ScanSummary);
  const gate2StatusBySymbol = new Map<string, Gate2Status | string>(
    (confluence?.results ?? []).map((r) => [r.symbol, r.gate2Status]),
  );
  return buildGate3RuntimeClosureSummary({
    traces: candidateTraces as readonly Record<string, unknown>[],
    sourceSnapshotId,
    gate2StatusBySymbol,
  });
}

/**
 * gate2 축 커버리지 기술자(표시용 보조)를 confluence 정본에서 1회 도출한다.
 * status 정본이 아니다 — formatter 가 buildGate2ConfluenceSummary 를 재실행하지 않도록 View 가 미리 채운다.
 * gate2 캐시/네트워크/더미 시각 미사용(결정론) — buildCandidateGateEvaluationViews 와 동일 입력 경로.
 */
export function buildCandidateGate2Coverage(summary: ScanSummary | null): CandidateGate2Coverage | undefined {
  const confluence = buildCandidateGate2ConfluenceSnapshot(summary);
  if (!confluence) return undefined;
  return {
    rsUsable: confluence.rsUsable,
    supplyUsable: confluence.supplyUsable,
    sectorUsable: confluence.sectorUsable,
    technicalUsable: confluence.technicalUsable,
    fundamentalUsable: confluence.fundamentalUsable,
    topPositiveAxis: String(confluence.topPositiveAxis),
    topMissingAxis: String(confluence.topMissingAxis),
    ...(typeof confluence.wouldStrongProportional === 'number' ? { wouldStrongProportional: confluence.wouldStrongProportional } : {}),
    ...(typeof confluence.wouldWeakProportional === 'number' ? { wouldWeakProportional: confluence.wouldWeakProportional } : {}),
  };
}

/**
 * per-candidate view 의 roll-up 집계 → CandidateGateEvaluationAggregate.
 * gate3ReadyCount/triggerWait/timingFail 는 Phase0 gate3Consolidated aggregate(같은 candidateDetails)와 수치 일치.
 * gate2Coverage(표시용 보조)는 옵셔널 인자로 받아 그대로 carry 한다(상태 정본 아님).
 */
export function aggregateCandidateGateEvaluationViews(
  views: CandidateGateEvaluationView[],
  gate2Coverage?: CandidateGate2Coverage,
): CandidateGateEvaluationAggregate {
  const topBlockReasonDistribution: Record<string, number> = {};
  let gate1Pass = 0;
  let gate2PassStrong = 0;
  let gate2PassWeak = 0;
  let gate2Watch = 0;
  let gate2Fail = 0;
  let gate2DataIncomplete = 0;
  let gate3Ready = 0;
  let gate3TriggerWait = 0;
  let gate3TimingFail = 0;

  for (const view of views) {
    if (view.gate1.passPermission) gate1Pass += 1;
    if (view.gate2.status === 'PASS') gate2PassStrong += 1;
    if (view.gate2.status === 'PASS_WEAK') gate2PassWeak += 1;
    if (view.gate2.status === 'WATCH') gate2Watch += 1;
    if (view.gate2.status === 'FAIL') gate2Fail += 1;
    if (view.gate2.status === 'DATA_INCOMPLETE') gate2DataIncomplete += 1;
    if (view.gate3.readiness === 'READY') gate3Ready += 1;
    if (view.gate3.readiness === 'TRIGGER_WAIT') gate3TriggerWait += 1;
    if (view.gate3.readiness === 'TIMING_FAIL') gate3TimingFail += 1;
    const reason = view.topBlockReason || 'NONE';
    topBlockReasonDistribution[reason] = (topBlockReasonDistribution[reason] ?? 0) + 1;
  }

  return {
    evaluatedCount: scoped('ALL_CANDIDATES', views.length),
    gate1PassCount: scoped('ALL_CANDIDATES', gate1Pass),
    gate2PassStrongCount: scoped('GATE2_COVERAGE_SAMPLE', gate2PassStrong),
    gate2PassWeakCount: scoped('GATE2_COVERAGE_SAMPLE', gate2PassWeak),
    gate2WatchCount: scoped('GATE2_COVERAGE_SAMPLE', gate2Watch),
    gate2FailCount: scoped('GATE2_COVERAGE_SAMPLE', gate2Fail),
    gate2DataIncompleteCount: scoped('GATE2_COVERAGE_SAMPLE', gate2DataIncomplete),
    gate3ReadyCount: scoped('GATE3_TIMING_SAMPLE', gate3Ready),
    gate3TriggerWaitCount: scoped('GATE3_TIMING_SAMPLE', gate3TriggerWait),
    gate3TimingFailCount: scoped('GATE3_TIMING_SAMPLE', gate3TimingFail),
    ...(gate2Coverage ? { gate2Coverage } : {}),
    topBlockReasonDistribution,
  };
}
