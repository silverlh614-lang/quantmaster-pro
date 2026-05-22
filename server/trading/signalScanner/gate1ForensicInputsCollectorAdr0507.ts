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
import { conditionResultsTraceToMap } from './gateConditionResultTrace.js';
import type { MinimumSignalScoreTrace } from './minimumSignalScoreTrace.js';
import type { SanitizedInvestorFlowSemanticRow } from '../../supply/investorFlowSemanticAvailability.js';
import type { BuildGate1MinimumSignalForensicInput, Gate1ForensicTraceSourcePath } from './gate1MinimumSignalForensicAuditAdr0505.js';
import type { InvestorFlowFlatRowForGateAdr0513 } from './investorFlowProviderRouterAdr0477.js';
import { lookupSupplyBySymbolPayloadSnapshot } from '../../supply/investorFlowBySymbolPayloadSnapshot.js';

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
  /** Diagnostic-only supply router snapshot carrying bySymbol payloads. */
  supplyRouterResult?: { bySymbol?: Record<string, Record<string, unknown>> } | Record<string, unknown>;
  /** Diagnostic cache freshness guard for bySymbol snapshot lookup. */
  tradeDate?: string;
  now?: string;
  maxAgeMinutes?: number;
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
  const routerBySymbol = input.supplyRouterResult && typeof input.supplyRouterResult === 'object'
    ? ((input.supplyRouterResult as { bySymbol?: Record<string, Record<string, unknown>> }).bySymbol)
    : undefined;
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
    const sourcePath: Gate1ForensicTraceSourcePath = candidate?.gate1Trace || t.minSignalScoreTrace
        ? 'ENTRY_FILTER_GATE1_CANDIDATE_TRACE'
        : candidate?.stageReached === 'WATCHLIST'
          ? 'WATCHLIST_CANDIDATE'
          : candidate?.stageReached === 'UNIVERSE'
            ? 'PREFLIGHT_UNIVERSE_SNAPSHOT'
            : 'UNKNOWN';
    const health = candidate?.supplyProviderHealth ?? supplyProviderHealth;
    const resolvedBySymbol = resolveActualSymbolForBySymbolAdr0515(candidate, t.symbol);
    const directBySymbolPayload = sourcePath === 'PREFLIGHT_UNIVERSE_SNAPSHOT'
      ? bySymbolPayloadForCandidateAdr0507(routerBySymbol, candidate, t.symbol, resolvedBySymbol)
      : undefined;
    const cachedLookupSymbol = resolvedBySymbol ?? (isPseudoWatchlistSymbolAdr0515(candidate?.symbol) ? null : candidate?.symbol) ?? (isPseudoWatchlistSymbolAdr0515(t.symbol) ? null : t.symbol);
    const cachedBySymbolLookup = sourcePath === 'PREFLIGHT_UNIVERSE_SNAPSHOT' && !directBySymbolPayload && cachedLookupSymbol
      ? lookupSupplyBySymbolPayloadSnapshot({
          symbol: cachedLookupSymbol,
          tradeDate: input.tradeDate,
          now: input.now,
          maxAgeMinutes: input.maxAgeMinutes,
        })
      : undefined;
    const bySymbolPayload = (directBySymbolPayload ?? cachedBySymbolLookup?.payload ?? undefined) as Record<string, unknown> | undefined;
    const bySymbolPayloadStale = Boolean(cachedBySymbolLookup?.payload && cachedBySymbolLookup.stale);
    const healthRecord = mergeActualRowCarryAdr0507(health as Record<string, unknown> | undefined, bySymbolPayload, bySymbolPayloadStale);
    const selectedCandidateRecord = healthRecord?.selectedCandidate && typeof healthRecord.selectedCandidate === 'object'
      ? healthRecord.selectedCandidate as Record<string, unknown>
      : undefined;
    const selectedCandidateActualRowsCandidate = selectedCandidateRecord && Array.isArray(selectedCandidateRecord.actualInvestorFlowRows)
      ? selectedCandidateRecord.actualInvestorFlowRows as Array<Record<string, unknown>>
      : selectedCandidateRecord?.actualInvestorRow && typeof selectedCandidateRecord.actualInvestorRow === 'object'
        ? [selectedCandidateRecord.actualInvestorRow as Record<string, unknown>]
        : undefined;
    const routerActualRowsCandidate = healthRecord && Array.isArray(healthRecord.actualInvestorFlowRows)
      ? healthRecord.actualInvestorFlowRows as Array<Record<string, unknown>>
      : healthRecord?.actualInvestorRow && typeof healthRecord.actualInvestorRow === 'object'
        ? [healthRecord.actualInvestorRow as Record<string, unknown>]
        : undefined;
    const sanitizedRowsCandidate = healthRecord && Array.isArray(healthRecord.sanitizedInvestorFlowRows)
      ? healthRecord.sanitizedInvestorFlowRows as Array<Record<string, unknown>>
      : undefined;
    const actualRowsFromSelectedCandidate = selectedCandidateActualRowsCandidate && selectedCandidateActualRowsCandidate.length > 0 ? selectedCandidateActualRowsCandidate : undefined;
    const actualRowsFromRouter = routerActualRowsCandidate && routerActualRowsCandidate.length > 0 ? routerActualRowsCandidate : undefined;
    const sanitizedRowsFromRouter = sanitizedRowsCandidate && sanitizedRowsCandidate.length > 0 ? sanitizedRowsCandidate : undefined;
    const actualInvestorFlowRows = actualRowsFromSelectedCandidate ?? actualRowsFromRouter ?? sanitizedRowsFromRouter;
    const actualInvestorFlowFieldKeys = (selectedCandidateRecord?.actualInvestorFlowFieldKeys as string[] | undefined)
      ?? (healthRecord?.actualInvestorFlowFieldKeys as string[] | undefined)
      ?? (healthRecord?.selectedActualRowFieldKeys as string[] | undefined);
    const actualInvestorFlowNumericKeys = (selectedCandidateRecord?.actualInvestorFlowNumericKeys as string[] | undefined)
      ?? (healthRecord?.actualInvestorFlowNumericKeys as string[] | undefined);
    const actualInvestorFlowNumericStringKeys = (selectedCandidateRecord?.actualInvestorFlowNumericStringKeys as string[] | undefined)
      ?? (healthRecord?.actualInvestorFlowNumericStringKeys as string[] | undefined)
      ?? (healthRecord?.selectedActualNumericStringFieldKeys as string[] | undefined);
    const actualInvestorFlowRowCount = (selectedCandidateRecord?.actualInvestorFlowRowCount as number | undefined) ?? (healthRecord?.actualInvestorFlowRowCount as number | undefined) ?? actualInvestorFlowRows?.length;
    const actualInvestorFlowRowSourcePath = (selectedCandidateRecord?.actualInvestorFlowRowSourcePath as string | null | undefined)
      ?? (healthRecord?.actualInvestorFlowRowSourcePath as string | null | undefined)
      ?? (healthRecord?.selectedActualRowPath as string | null | undefined);
    const actualInvestorFlowCarried = (selectedCandidateRecord?.actualInvestorFlowCarried as boolean | undefined)
      ?? (healthRecord?.actualInvestorFlowCarried as boolean | undefined)
      ?? ((actualInvestorFlowRows?.length ?? 0) > 0);
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
          semanticRow: (healthRecord.semanticInvestorRow ?? healthRecord.supplySemanticRow ?? healthRecord.semanticRow) as SanitizedInvestorFlowSemanticRow | null | undefined,
          investorFlowSemanticRow: (healthRecord.semanticInvestorRow ?? healthRecord.supplySemanticRow ?? healthRecord.semanticRow) as SanitizedInvestorFlowSemanticRow | null | undefined,
          gateSemanticFlatRow: (healthRecord.gateSemanticFlatRow as InvestorFlowFlatRowForGateAdr0513 | null | undefined) ?? null,
          actualInvestorRow: (selectedCandidateRecord?.actualInvestorRow ?? healthRecord.actualInvestorRow ?? actualInvestorFlowRows?.[0]) as Record<string, unknown> | null | undefined,
          normalizedInvestorRow: (selectedCandidateRecord?.normalizedInvestorRow ?? healthRecord.normalizedInvestorRow) as Record<string, unknown> | null | undefined,
          semanticInvestorRow: (selectedCandidateRecord?.semanticInvestorRow ?? selectedCandidateRecord?.supplySemanticRow ?? healthRecord.semanticInvestorRow ?? healthRecord.supplySemanticRow ?? healthRecord.semanticRow) as SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null | undefined,
          supplySemanticRow: (selectedCandidateRecord?.supplySemanticRow ?? selectedCandidateRecord?.semanticInvestorRow ?? healthRecord.supplySemanticRow ?? healthRecord.semanticInvestorRow ?? healthRecord.semanticRow) as SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null | undefined,
          sanitizedInvestorFlowRows: actualInvestorFlowRows,
          actualInvestorFlowRows,
          actualInvestorFlowRowCount,
          actualInvestorFlowRowSourcePath,
          actualInvestorFlowFieldKeys,
          actualInvestorFlowNumericKeys,
          actualInvestorFlowNumericStringKeys,
          actualInvestorFlowCarried,
          // ADR-0477 supply actual row carry diagnostic — router/bySymbol 가 adapter row 를
          // selectedProvider != KIS_API 인 경우에도 carry 했는지. forensic supplyScopeAudit 가
          // 이 값을 읽어 adapterRowsForwardedAcrossProvidersCount 로 집계. CORE 무영향 / diagnostic only.
          adapterRowsForwardedAcrossProviders: ((selectedCandidateRecord?.adapterRowsForwardedAcrossProviders as boolean | undefined)
            ?? (healthRecord.adapterRowsForwardedAcrossProviders as boolean | undefined)),
          // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — selectedProvider 와 actual row carry 분리.
          // healthRecord 는 mergeActualRowCarryAdr0507 가 bySymbol payload 의 diagnostic row 를
          // 이미 merge 한 상태. forensic supplyScopeAudit 가 selectedProvider='NONE' 인 경우에도
          // 이 carry 를 읽어 diagnosticActualInvestorRowCarriedCount 로 집계. CORE 무영향 / diagnostic only.
          diagnosticActualInvestorRow: ((selectedCandidateRecord?.diagnosticActualInvestorRow as Record<string, unknown> | null | undefined)
            ?? (healthRecord.diagnosticActualInvestorRow as Record<string, unknown> | null | undefined)),
          selectedProviderActualInvestorRow: ((selectedCandidateRecord?.selectedProviderActualInvestorRow as Record<string, unknown> | null | undefined)
            ?? (healthRecord.selectedProviderActualInvestorRow as Record<string, unknown> | null | undefined)),
          actualInvestorRowProvider: ((selectedCandidateRecord?.actualInvestorRowProvider as 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'UNKNOWN' | null | undefined)
            ?? (healthRecord.actualInvestorRowProvider as 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'UNKNOWN' | null | undefined)),
          actualInvestorRowUseScope: ((selectedCandidateRecord?.actualInvestorRowUseScope as 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE' | 'GATE_SCORE_ELIGIBLE' | undefined)
            ?? (healthRecord.actualInvestorRowUseScope as 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE' | 'GATE_SCORE_ELIGIBLE' | undefined)),
          selectedActualRowPath: ((healthRecord.selectedActualRowPath as string | null | undefined) ?? (healthRecord.actualInvestorFlowRowSourcePath as string | null | undefined)),
          selectedActualRowFieldKeys: ((healthRecord.selectedActualRowFieldKeys as string[] | undefined) ?? actualInvestorFlowFieldKeys),
          selectedActualNumericFieldKeys: healthRecord.selectedActualNumericFieldKeys as string[] | undefined,
          selectedActualNumericStringFieldKeys: (healthRecord.selectedActualNumericStringFieldKeys as string[] | undefined) ?? actualInvestorFlowNumericStringKeys,
          selectedActualPlaceholderFieldKeys: healthRecord.selectedActualPlaceholderFieldKeys as string[] | undefined,
          kisRawRowAvailableAtAdapter: healthRecord.kisRawRowAvailableAtAdapter as boolean | undefined,
          kisNormalizedRowAvailableAtRouter: healthRecord.kisNormalizedRowAvailableAtRouter as boolean | undefined,
          kisSelectedCandidateCarriesSemanticRow: healthRecord.kisSelectedCandidateCarriesSemanticRow as boolean | undefined,
          forensicInputCarriesSemanticRow: Boolean(selectedCandidateRecord?.semanticInvestorRow ?? selectedCandidateRecord?.supplySemanticRow ?? healthRecord.semanticInvestorRow ?? healthRecord.supplySemanticRow ?? healthRecord.semanticRow),
          forensicInputCarriesActualInvestorRows: (actualInvestorFlowRows?.length ?? 0) > 0 || Boolean(healthRecord.diagnosticActualInvestorRow),
          semanticRowBreakPoint: (healthRecord.semanticRowBreakPoint as string | undefined) ?? (healthRecord.kisSelectedCandidateCarriesSemanticRow === false ? 'SELECTED_CANDIDATE_METADATA_ONLY' : undefined),
        }
      : undefined;
    const conditionResultsTrace = candidate?.conditionResultsTrace ?? t.conditionResultsTrace;
    const conditionResults = candidate?.conditionResults ?? t.conditionResults ?? conditionResultsTraceToMap(conditionResultsTrace);
    const conditionKeys = candidate?.conditionKeys ?? t.conditionKeys;
    const entry: BuildGate1MinimumSignalForensicInput = {
      trace,
      sourcePath,
      ...(candidate ? { candidate } : {}),
      ...(conditionResultsTrace && conditionResultsTrace.length > 0 ? { conditionResultsTrace } : {}),
      ...(conditionResults ? { conditionResults } : {}),
      ...(conditionKeys ? { conditionKeys } : {}),
      quoteSymbol: quoteSymbol ?? t.symbol ?? null,
      ...(healthRecord ? { supplyProviderHealth: healthRecord } : {}),
      ...(candidate?.supplyConfluenceState ? { supplyConfluence: candidate.supplyConfluenceState } : {}),
      ...(actualInvestorFlowRows ? { actualInvestorFlowRows } : {}),
      ...(actualInvestorFlowRowCount !== undefined ? { actualInvestorFlowRowCount } : {}),
      ...(actualInvestorFlowRowSourcePath !== undefined ? { actualInvestorFlowRowSourcePath } : {}),
      ...(actualInvestorFlowFieldKeys ? { actualInvestorFlowFieldKeys } : {}),
      ...(actualInvestorFlowNumericKeys ? { actualInvestorFlowNumericKeys } : {}),
      ...(actualInvestorFlowNumericStringKeys ? { actualInvestorFlowNumericStringKeys } : {}),
      ...(actualInvestorFlowCarried !== undefined ? { actualInvestorFlowCarried } : {}),
      ...((selectedCandidateRecord?.actualInvestorRow ?? (healthRecord?.actualInvestorRow as Record<string, unknown> | undefined) ?? actualInvestorFlowRows?.[0] ?? healthRecord?.normalizedInvestorRow) ? { actualInvestorRow: (selectedCandidateRecord?.actualInvestorRow ?? healthRecord?.actualInvestorRow ?? actualInvestorFlowRows?.[0] ?? healthRecord?.normalizedInvestorRow) as Record<string, unknown> } : {}),
      ...((selectedCandidateRecord?.diagnosticActualInvestorRow ?? healthRecord?.diagnosticActualInvestorRow ?? selectedCandidateRecord?.actualInvestorRow ?? healthRecord?.actualInvestorRow ?? healthRecord?.normalizedInvestorRow) ? { diagnosticActualInvestorRow: (selectedCandidateRecord?.diagnosticActualInvestorRow ?? healthRecord?.diagnosticActualInvestorRow ?? selectedCandidateRecord?.actualInvestorRow ?? healthRecord?.actualInvestorRow ?? healthRecord?.normalizedInvestorRow) as Record<string, unknown> } : {}),
      ...((selectedCandidateRecord?.normalizedInvestorRow ?? healthRecord?.normalizedInvestorRow) ? { normalizedInvestorRow: (selectedCandidateRecord?.normalizedInvestorRow ?? healthRecord?.normalizedInvestorRow) as Record<string, unknown> } : {}),
      ...((selectedCandidateRecord?.semanticInvestorRow ?? selectedCandidateRecord?.supplySemanticRow ?? healthRecord?.semanticInvestorRow ?? healthRecord?.supplySemanticRow ?? healthRecord?.semanticRow) ? { semanticInvestorRow: (selectedCandidateRecord?.semanticInvestorRow ?? selectedCandidateRecord?.supplySemanticRow ?? healthRecord?.semanticInvestorRow ?? healthRecord?.supplySemanticRow ?? healthRecord?.semanticRow) as SanitizedInvestorFlowSemanticRow | Record<string, unknown> } : {}),
      ...((selectedCandidateRecord?.supplySemanticRow ?? selectedCandidateRecord?.semanticInvestorRow ?? healthRecord?.supplySemanticRow ?? healthRecord?.semanticInvestorRow ?? healthRecord?.semanticRow) ? { supplySemanticRow: (selectedCandidateRecord?.supplySemanticRow ?? selectedCandidateRecord?.semanticInvestorRow ?? healthRecord?.supplySemanticRow ?? healthRecord?.semanticInvestorRow ?? healthRecord?.semanticRow) as SanitizedInvestorFlowSemanticRow | Record<string, unknown> } : {}),
      ...(selectedCandidateRecord ? { selectedCandidate: selectedCandidateRecord } : {}),
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
  conditionResultsAvailableCount: number;
  conditionResultsKeyCoverage: Record<string, number>;
  conditionResultStatusDistribution: Record<string, number>;
  conditionResultsBreakPoint: 'NONE' | 'CONDITION_RESULTS_PROJECTED' | 'CONDITION_RESULTS_NOT_PROJECTED';
  traceWithWatchlistScoreCount: number;
  traceWithSupplyContextCount: number;
  traceWithMinSignalScoreTraceCount: number;
  dominantFailureReason?: 'TRACE_HYDRATION_MISSING';
}

function normalizeSymbolKeyAdr0507(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits || value;
}

function isPseudoWatchlistSymbolAdr0515(value: unknown): boolean {
  return typeof value === 'string' && /^WATCHLIST_\d+$/i.test(value);
}

function resolveActualSymbolForBySymbolAdr0515(
  candidate: CandidateEntryTrace | undefined,
  traceSymbol: string,
): string | null {
  const record = candidate as unknown as Record<string, unknown> | undefined;
  const quote = record?.quote && typeof record.quote === 'object'
    ? record.quote as Record<string, unknown>
    : undefined;
  const selectedCandidate = record?.selectedCandidate && typeof record.selectedCandidate === 'object'
    ? record.selectedCandidate as Record<string, unknown>
    : undefined;
  const candidates = [
    record?.actualSymbol,
    record?.stockCode,
    record?.code,
    record?.iscd,
    record?.symbolCode,
    quote?.symbol,
    quote?.code,
    quote?.stockCode,
    selectedCandidate?.symbol,
    selectedCandidate?.code,
    selectedCandidate?.stockCode,
    traceSymbol,
    candidate?.symbol,
  ];
  for (const value of candidates) {
    const normalized = normalizeSymbolKeyAdr0507(value);
    if (normalized && /^\d{6}$/.test(normalized)) return normalized;
  }
  return null;
}

function bySymbolPayloadForCandidateAdr0507(
  bySymbol: Record<string, Record<string, unknown>> | undefined,
  candidate: CandidateEntryTrace | undefined,
  traceSymbol: string,
  resolvedActualSymbol?: string | null,
): Record<string, unknown> | undefined {
  if (!bySymbol || typeof bySymbol !== 'object') return undefined;
  const quoteSymbol = candidate?.quote && typeof candidate.quote === 'object'
    ? ((candidate.quote as Record<string, unknown>).symbol as string | undefined)
    : undefined;
  const keys = [
    resolvedActualSymbol,
    candidate?.symbol,
    traceSymbol,
    quoteSymbol,
  ]
    .filter((item) => !isPseudoWatchlistSymbolAdr0515(item))
    .flatMap((item) => {
      const normalized = normalizeSymbolKeyAdr0507(item);
      return normalized && item ? [normalized, String(item)] : normalized ? [normalized] : item ? [String(item)] : [];
    });
  for (const key of keys) {
    const payload = bySymbol[key];
    if (payload && typeof payload === 'object') return payload;
  }
  return undefined;
}

function mergeActualRowCarryAdr0507(
  base: Record<string, unknown> | undefined,
  payload: Record<string, unknown> | undefined,
  stale = false,
): Record<string, unknown> | undefined {
  if (!payload) return base;
  const selectedCandidate = base?.selectedCandidate && typeof base.selectedCandidate === 'object'
    ? base.selectedCandidate as Record<string, unknown>
    : {};
  const normalizedPayloadRow = payload.normalizedInvestorRow && typeof payload.normalizedInvestorRow === 'object'
    ? payload.normalizedInvestorRow as Record<string, unknown>
    : undefined;
  const promotedActualRow = payload.actualInvestorRow && typeof payload.actualInvestorRow === 'object'
    ? payload.actualInvestorRow as Record<string, unknown>
    : normalizedPayloadRow;
  const diagnosticPayloadRow = payload.diagnosticActualInvestorRow && typeof payload.diagnosticActualInvestorRow === 'object'
    ? payload.diagnosticActualInvestorRow as Record<string, unknown>
    : promotedActualRow;
  const actualRows = stale
    ? undefined
    : Array.isArray(payload.actualInvestorFlowRows)
      ? payload.actualInvestorFlowRows
      : promotedActualRow
        ? [promotedActualRow]
        : undefined;
  return {
    ...(base ?? {}),
    actualInvestorRow: stale ? base?.actualInvestorRow : (promotedActualRow ?? base?.actualInvestorRow ?? actualRows?.[0]),
    normalizedInvestorRow: payload.normalizedInvestorRow ?? base?.normalizedInvestorRow,
    semanticInvestorRow: payload.semanticInvestorRow ?? payload.supplySemanticRow ?? base?.semanticInvestorRow,
    supplySemanticRow: payload.supplySemanticRow ?? payload.semanticInvestorRow ?? base?.supplySemanticRow,
    gateSemanticFlatRow: stale ? base?.gateSemanticFlatRow : (payload.gateSemanticFlatRow ?? base?.gateSemanticFlatRow),
    actualInvestorFlowRows: stale ? base?.actualInvestorFlowRows : (actualRows ?? base?.actualInvestorFlowRows),
    actualInvestorFlowRowCount: stale ? base?.actualInvestorFlowRowCount : (payload.actualInvestorFlowRowCount ?? actualRows?.length ?? base?.actualInvestorFlowRowCount),
    actualInvestorFlowRowSourcePath: payload.actualInvestorFlowRowSourcePath ?? base?.actualInvestorFlowRowSourcePath,
    actualInvestorFlowFieldKeys: payload.actualInvestorFlowFieldKeys ?? payload.selectedActualRowFieldKeys ?? base?.actualInvestorFlowFieldKeys,
    actualInvestorFlowNumericKeys: payload.actualInvestorFlowNumericKeys ?? payload.selectedActualNumericFieldKeys ?? base?.actualInvestorFlowNumericKeys,
    actualInvestorFlowNumericStringKeys: payload.actualInvestorFlowNumericStringKeys ?? payload.selectedActualNumericStringFieldKeys ?? base?.actualInvestorFlowNumericStringKeys,
    actualInvestorFlowCarried: stale ? false : (payload.actualInvestorFlowCarried ?? ((actualRows?.length ?? 0) > 0) ?? base?.actualInvestorFlowCarried),
    // ADR-0477 supply actual row carry diagnostic — bySymbol payload 의
    // adapterRowsForwardedAcrossProviders 를 merge. stale payload 는 carry 주장 금지 (false).
    adapterRowsForwardedAcrossProviders: stale ? false : (payload.adapterRowsForwardedAcrossProviders ?? base?.adapterRowsForwardedAcrossProviders),
    // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — selectedProvider 와 actual row carry 분리.
    // diagnosticActualInvestorRow 는 selectedProvider 무관하게 carry (DIAGNOSTIC_ONLY scope).
    // stale payload 는 diagnostic row 새로 주장 금지 (base 보존).
    diagnosticActualInvestorRow: stale ? base?.diagnosticActualInvestorRow : (diagnosticPayloadRow ?? base?.diagnosticActualInvestorRow),
    selectedProviderActualInvestorRow: stale ? base?.selectedProviderActualInvestorRow : (payload.selectedProviderActualInvestorRow ?? base?.selectedProviderActualInvestorRow),
    actualInvestorRowProvider: payload.actualInvestorRowProvider ?? base?.actualInvestorRowProvider,
    actualInvestorRowUseScope: payload.actualInvestorRowUseScope ?? base?.actualInvestorRowUseScope,
    diagnosticAvailable: true,
    scoreUsage: 'SHADOW_ONLY',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    selectedCandidate: {
      ...selectedCandidate,
      ...(payload.selectedCandidate && typeof payload.selectedCandidate === 'object' ? payload.selectedCandidate as Record<string, unknown> : {}),
      actualInvestorRow: stale ? selectedCandidate.actualInvestorRow : (promotedActualRow ?? selectedCandidate.actualInvestorRow ?? actualRows?.[0]),
      normalizedInvestorRow: payload.normalizedInvestorRow ?? selectedCandidate.normalizedInvestorRow,
      semanticInvestorRow: payload.semanticInvestorRow ?? payload.supplySemanticRow ?? selectedCandidate.semanticInvestorRow,
      supplySemanticRow: payload.supplySemanticRow ?? payload.semanticInvestorRow ?? selectedCandidate.supplySemanticRow,
      gateSemanticFlatRow: stale ? selectedCandidate.gateSemanticFlatRow : (payload.gateSemanticFlatRow ?? selectedCandidate.gateSemanticFlatRow),
      actualInvestorFlowRows: stale ? selectedCandidate.actualInvestorFlowRows : (actualRows ?? selectedCandidate.actualInvestorFlowRows),
      actualInvestorFlowRowCount: stale ? selectedCandidate.actualInvestorFlowRowCount : (payload.actualInvestorFlowRowCount ?? actualRows?.length ?? selectedCandidate.actualInvestorFlowRowCount),
      actualInvestorFlowRowSourcePath: payload.actualInvestorFlowRowSourcePath ?? selectedCandidate.actualInvestorFlowRowSourcePath,
      actualInvestorFlowFieldKeys: payload.actualInvestorFlowFieldKeys ?? payload.selectedActualRowFieldKeys ?? selectedCandidate.actualInvestorFlowFieldKeys,
      actualInvestorFlowNumericKeys: payload.actualInvestorFlowNumericKeys ?? payload.selectedActualNumericFieldKeys ?? selectedCandidate.actualInvestorFlowNumericKeys,
      actualInvestorFlowNumericStringKeys: payload.actualInvestorFlowNumericStringKeys ?? payload.selectedActualNumericStringFieldKeys ?? selectedCandidate.actualInvestorFlowNumericStringKeys,
      actualInvestorFlowCarried: stale ? false : (payload.actualInvestorFlowCarried ?? ((actualRows?.length ?? 0) > 0) ?? selectedCandidate.actualInvestorFlowCarried),
      // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — selectedCandidate 레벨에도 carry 분리 전파.
      diagnosticActualInvestorRow: stale ? selectedCandidate.diagnosticActualInvestorRow : (diagnosticPayloadRow ?? selectedCandidate.diagnosticActualInvestorRow),
      selectedProviderActualInvestorRow: stale ? selectedCandidate.selectedProviderActualInvestorRow : (payload.selectedProviderActualInvestorRow ?? selectedCandidate.selectedProviderActualInvestorRow),
      actualInvestorRowProvider: payload.actualInvestorRowProvider ?? selectedCandidate.actualInvestorRowProvider,
      actualInvestorRowUseScope: payload.actualInvestorRowUseScope ?? selectedCandidate.actualInvestorRowUseScope,
    },
  };
}

function getConditionResults(input: CandidateEntryTrace): Record<string, unknown> | undefined {
  if (input.conditionResults && typeof input.conditionResults === 'object') return input.conditionResults;
  return conditionResultsTraceToMap(input.conditionResultsTrace);
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
  const conditionResultsByTrace = candidateTraces.map(getConditionResults);
  const conditionResultsKeyCoverage: Record<string, number> = {};
  const conditionResultStatusDistribution: Record<string, number> = {};
  for (const results of conditionResultsByTrace) {
    if (!results) continue;
    for (const [key, value] of Object.entries(results)) {
      conditionResultsKeyCoverage[key] = (conditionResultsKeyCoverage[key] ?? 0) + 1;
      const status = value && typeof value === 'object' && typeof (value as Record<string, unknown>).status === 'string'
        ? String((value as Record<string, unknown>).status)
        : 'UNKNOWN';
      conditionResultStatusDistribution[status] = (conditionResultStatusDistribution[status] ?? 0) + 1;
    }
  }
  const traceWithConditionResultsCount = conditionResultsByTrace.filter(Boolean).length;
  const conditionResultsAvailableCount = Object.values(conditionResultsKeyCoverage).reduce((sum, count) => sum + count, 0);
  const summary: Gate1ForensicInputCompletenessSummaryAdr0507 = {
    candidateTraceCount: candidateTraces.length,
    traceWithQuoteCount: candidateTraces.filter((t) => hasObjectField(t, 'quote')).length,
    traceWithSymbolFeaturesCount: candidateTraces.filter((t) => hasObjectField(t, 'symbolFeatures')).length,
    traceWithConditionResultsCount,
    conditionResultsAvailableCount,
    conditionResultsKeyCoverage,
    conditionResultStatusDistribution,
    conditionResultsBreakPoint: traceWithConditionResultsCount === 0
      ? 'CONDITION_RESULTS_NOT_PROJECTED'
      : conditionResultsAvailableCount > 0
        ? 'CONDITION_RESULTS_PROJECTED'
        : 'NONE',
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
