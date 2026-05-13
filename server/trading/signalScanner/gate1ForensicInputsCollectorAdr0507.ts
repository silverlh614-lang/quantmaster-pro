/**
 * @responsibility ADR-0507 Phase 1 — gate1ForensicInputs collector SSOT.
 *
 * ADR-0505 (Gate1 Minimum Signal Forensic Audit) 의 `persistScanResults`
 * 호출자 측 `gate1ForensicInputs` collector 가 Phase 1 후속 PR 로 분리되어
 * dead-code wiring 상태였던 결함 차단. 본 SSOT 는 *EntryFilterDecomposition
 * 결과* (이미 `persistScanResults` 안에서 생성되는 SSOT) 로부터 forensic
 * input array 를 합성한다 — 외부 호출자 변경 0, 호출자 측 collector 신규 0.
 *
 * 사용자 §"잘못된 해결 방법" 정합:
 *   - score / threshold / order path 변경 0
 *   - 외부 API 호출 0
 *   - executionImpact='NONE', liveExecutionAllowed=false
 *   - 호출자 측 inline 합성 금지 — 본 SSOT 위임 의무
 */

import type { CandidateEntryTrace, Gate1CandidateTrace, SupplyProviderHealthTrace } from './entryFilterDecomposition.js';
import type { MinimumSignalScoreTrace } from './minimumSignalScoreTrace.js';
import type { BuildGate1MinimumSignalForensicInput, Gate1ForensicTraceSourcePath } from './gate1MinimumSignalForensicAuditAdr0505.js';

/* ───────── ENV 우회 SSOT (ADR-0157 정확 비교) ───────── */

/**
 * Phase 1 collector 비활성화 — `=== 'true'` 정확 비교 의무.
 * 활성 시 본 SSOT 가 빈 배열 반환 → 외부 호출자가 명시 전달한 값만 사용
 * (ADR-0505 emission 결손 의도된 회귀 격리).
 */
export function isGate1ForensicCollectorAdr0507Disabled(): boolean {
  return process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED === 'true';
}

/* ───────── 입력 schema ───────── */

export interface CollectGate1ForensicInputsInput {
  /** EntryFilterDecomposition.gate1CandidateTraces — minSignalScoreTrace 포함. */
  gate1CandidateTraces?: ReadonlyArray<Gate1CandidateTrace>;
  /** EntryFilterDecomposition.candidateTraces — ADR-0509 feature hydration audit source. */
  candidateTraces?: ReadonlyArray<CandidateEntryTrace>;
  /** EntryFilterDecomposition.supplyProviderHealth — 공통 supply health (모든 종목 동일). */
  supplyProviderHealth?: SupplyProviderHealthTrace;
}

/* ───────── 핵심 SSOT — collectGate1ForensicInputs ───────── */

/**
 * `EntryFilterDecomposition.gate1CandidateTraces` 로부터 ADR-0505 forensic input
 * array 를 합성. minSignalScoreTrace 가 없는 trace 는 자동 skip (회귀 안전).
 *
 * 호출자 측 try/catch 격리 의무 — 본 함수 자체는 throw 안 함 (defensive copy).
 * ENV `GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED=true` 활성 시 빈 배열 반환.
 *
 * 9 invariants (절대 변경 금지):
 *   1. 신규 외부 API 호출 0 — EntryFilterDecomposition 결과만 사용.
 *   2. score / threshold / order path 변경 0 — read-only projection.
 *   3. 새 forensic build 로직 추가 0 — `buildGate1MinimumSignalForensicAuditAdr0505`
 *      에 위임 의무 (호출자 측이 별도 매핑).
 *   4. minSignalScoreTrace 부재 trace skip — null 강제 주입 금지.
 *   5. supplyProviderHealth 공통 share — 종목별 partial override 0.
 *   6. quoteSymbol = Gate1CandidateTrace.symbol — 정규화 0 (호출자 측 책임).
 *   7. ENV `=== 'true'` 정확 비교 의무 (ADR-0157).
 *   8. caller 측 inline 합성 금지 — 본 SSOT 위임 의무.
 *   9. executionImpact='NONE' — diagnostic / display only.
 */
export function collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507(
  input: CollectGate1ForensicInputsInput,
): ReadonlyArray<BuildGate1MinimumSignalForensicInput> {
  if (isGate1ForensicCollectorAdr0507Disabled()) return [];
  const traces = input.gate1CandidateTraces ?? [];
  if (traces.length === 0) return [];
  const supplyProviderHealth = input.supplyProviderHealth;
  const candidateBySymbol = new Map<string, CandidateEntryTrace>();
  for (const c of input.candidateTraces ?? []) {
    if (c.symbol) candidateBySymbol.set(c.symbol, c);
  }
  const out: BuildGate1MinimumSignalForensicInput[] = [];
  for (const t of traces) {
    const trace: MinimumSignalScoreTrace | undefined = t.minSignalScoreTrace;
    if (!trace) continue;
    const candidate = candidateBySymbol.get(t.symbol);
    const quoteSymbol = candidate?.quote && typeof candidate.quote === 'object'
      ? ((candidate.quote as Record<string, unknown>).symbol as string | null | undefined)
      : undefined;
    const health = candidate?.supplyProviderHealth ?? supplyProviderHealth;
    const healthRecord = health as Record<string, unknown> | undefined;
    const kisFlow = healthRecord
      ? {
          requestSymbol: (healthRecord.requestSymbol as string | null | undefined) ?? candidate?.symbol ?? t.symbol ?? null,
          candidateSymbol: (healthRecord.candidateSymbol as string | null | undefined) ?? candidate?.symbol ?? t.symbol ?? null,
          quoteSymbol: quoteSymbol ?? (healthRecord.quoteSymbol as string | null | undefined) ?? null,
          providerSymbol: (healthRecord.providerSymbol as string | null | undefined) ?? null,
          normalizedSymbol: (healthRecord.normalizedSymbol as string | null | undefined) ?? null,
          providerScope: (healthRecord.providerScope as 'SYMBOL_LEVEL' | 'MARKET_LEVEL' | 'SECTOR_LEVEL' | 'UNKNOWN' | undefined) ?? 'SYMBOL_LEVEL',
          routePurpose: (healthRecord.routePurpose as string | undefined) ?? 'GATE1_FORENSIC_SHADOW_AUDIT',
          selectedProvider: (healthRecord.selectedInvestorFlowProvider as string | undefined) ?? (healthRecord.providerName as string | undefined),
          materialized: healthRecord.materialized as boolean | undefined,
          usableForRouter: healthRecord.usableForRouter as boolean | undefined,
          usableForGate: false as const,
          usableForLive: false as const,
          usableForShadow: true as const,
          semanticAvailable: healthRecord.status === 'VERIFIED',
        }
      : undefined;
    const sourcePath: Gate1ForensicTraceSourcePath = candidate?.marketSession === 'SELL_ONLY'
      ? 'SELL_ONLY_DIAGNOSTIC_SNAPSHOT'
      : candidate?.gate1Trace || t.minSignalScoreTrace
        ? 'ENTRY_FILTER_GATE1_CANDIDATE_TRACE'
        : candidate?.stageReached === 'WATCHLIST'
          ? 'WATCHLIST_CANDIDATE'
          : candidate?.stageReached === 'UNIVERSE'
            ? 'PREFLIGHT_UNIVERSE_SNAPSHOT'
            : 'UNKNOWN';
    const entry: BuildGate1MinimumSignalForensicInput = {
      trace,
      sourcePath,
      ...(candidate ? { candidate } : {}),
      quoteSymbol: quoteSymbol ?? t.symbol ?? null,
      ...(health ? { supplyProviderHealth: health } : {}),
      ...(candidate?.supplyConfluenceState ? { supplyConfluence: candidate.supplyConfluenceState } : {}),
      ...(kisFlow ? { kisFlow } : {}),
    };
    out.push(entry);
  }
  return out;
}

export interface Gate1ForensicInputCompletenessSummaryAdr0507 {
  candidateTraceCount: number;
  traceWithQuoteCount: number;
  traceWithSymbolFeaturesCount: number;
  traceWithConditionResultsCount: number;
  traceWithWatchlistScoreCount: number;
  traceWithSupplyContextCount: number;
  traceWithMinSignalScoreTraceCount: number;
  dominantFailureReason?: 'TRACE_HYDRATION_MISSING';
}

function hasObjectField(input: unknown, field: string): boolean {
  return Boolean(input && typeof input === 'object' && (input as Record<string, unknown>)[field] && typeof (input as Record<string, unknown>)[field] === 'object');
}

function hasWatchlistScoreField(input: CandidateEntryTrace): boolean {
  const record = input as unknown as Record<string, unknown>;
  const fields = ['stage2Score', 'watchlistScore', 'upstreamCandidateScore', 'watchlistUpstreamScore', 'totalGateScore', 'gateScore', 'priorityScore', 'score'];
  const features = record.symbolFeatures && typeof record.symbolFeatures === 'object' ? record.symbolFeatures as Record<string, unknown> : undefined;
  return fields.some((field) => typeof record[field] === 'number' || typeof features?.[field] === 'number');
}

/** Diagnostic-only input completeness summary for /scan_blockers compact audit. */
export function summarizeGate1ForensicInputCompletenessAdr0507(
  input: CollectGate1ForensicInputsInput,
): Gate1ForensicInputCompletenessSummaryAdr0507 {
  const candidateTraces = input.candidateTraces ?? [];
  const minTraceSymbols = new Set((input.gate1CandidateTraces ?? []).filter((t) => t.minSignalScoreTrace).map((t) => t.symbol));
  const summary: Gate1ForensicInputCompletenessSummaryAdr0507 = {
    candidateTraceCount: candidateTraces.length,
    traceWithQuoteCount: candidateTraces.filter((t) => hasObjectField(t, 'quote')).length,
    traceWithSymbolFeaturesCount: candidateTraces.filter((t) => hasObjectField(t, 'symbolFeatures')).length,
    traceWithConditionResultsCount: candidateTraces.filter((t) => hasObjectField(t, 'conditionResults')).length,
    traceWithWatchlistScoreCount: candidateTraces.filter(hasWatchlistScoreField).length,
    traceWithSupplyContextCount: candidateTraces.filter((t) => Boolean(t.supplyConfluenceState || t.supplyProviderHealth)).length,
    traceWithMinSignalScoreTraceCount: candidateTraces.filter((t) => minTraceSymbols.has(t.symbol)).length,
  };
  if (
    summary.candidateTraceCount > 0 &&
    summary.traceWithQuoteCount === 0 &&
    summary.traceWithSymbolFeaturesCount === 0 &&
    summary.traceWithConditionResultsCount === 0
  ) {
    summary.dominantFailureReason = 'TRACE_HYDRATION_MISSING';
  }
  return summary;
}
