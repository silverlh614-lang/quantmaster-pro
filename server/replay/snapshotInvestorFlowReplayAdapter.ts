// @responsibility Patch-002 snapshot → frozen InvestorFlow router-equivalent bySymbol payload adapter (diagnosticOnly, providerCalls=0).

/**
 * Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-002 §C — SnapshotInvestorFlowReplayAdapter.
 *
 * 사용자 명시 framing verbatim:
 *   "스냅샷을 단순 조회용으로만 쓰지 않고, SnapshotInvestorFlowReplayAdapter 를
 *    추가하여 snapshot 에 저장된 frozen per-symbol supply rows 를 실제 preflight
 *    merge 경로에 주입할 수 있게 한다. 주말에도 providerCalls=0 상태에서
 *    '수급이 candidate context 에 정상적으로 들어가는지' 검증할 수 있어야 한다."
 *
 * 핵심 invariants (사용자 명시 절대 변경 금지):
 *   1. providerCalls=0 / kisCalls=0 / krxCalls=0 / yahooCalls=0 / naverCalls=0 literal 강제
 *   2. source: 'SNAPSHOT_REPLAY_ADAPTER' literal — 호출자가 *frozen* 임을 인지
 *   3. executionImpact: 'NONE' literal / liveExecutionAllowed: false literal
 *   4. scoreUsage: 'SHADOW_ONLY' literal — Gate 결정 입력 금지
 *   5. snapshot 에 frozen row 가 없으면 keyMiss++ + 'row missing' 진단 — UNKNOWN 을 임의 VERIFIED 격상 금지
 *   6. adapter return 은 InvestorFlowProviderRouteBySymbolPayloadAdr0477 schema 호환 — 호출자 무수정
 *   7. LIVE execution path 연결 금지 — diagnosticOnly: true 강제
 *   8. snapshot 본체 무수정 (read-only consumer)
 *
 * 동작:
 *   - hydrateBulkFromSnapshot(symbols, snapshot)
 *     → snapshot.frozenSupplyRows 에서 symbol 별 frozen row 조회 (정확 6자리 zero-pad)
 *     → 조회 성공 → InvestorFlowProviderRouteBySymbolPayloadAdr0477 호환 객체 합성
 *     → 조회 실패 → keyMiss++ 카운터 증가 + bySymbol 에 미포함
 *     → providerCalls 0 invariant 유지
 *
 * 주말 verification flow (사용자 §C):
 *   1. /replay_supply 명령 → loadLatestRuntimeDebugSnapshot()
 *   2. snapshot.frozenSupplyRows 에서 supply 후보 추출
 *   3. hydrateBulkFromSnapshot(symbols, snapshot) → frozen bySymbol map
 *   4. preflight merge 함수에 주입 → candidate context 의 supplyProviderHealth 가 frozen 값으로 채워지는지 확인
 *   5. providerCalls=0 invariant 검증 — KIS/KRX/Yahoo/Naver 실 호출 0건
 */

import type {
  InvestorFlowProviderRouteBySymbolPayloadAdr0477,
  InvestorFlowProviderStatus,
  SemanticSupplySignal,
} from '../trading/signalScanner/investorFlowProviderRouterAdr0477.js';
import type {
  RuntimeDebugSnapshot,
  SnapshotFrozenSupplyRow,
} from './runtimeDebugSnapshotRepo.js';

// ============================================================================
// Frozen route result schema — InvestorFlowProviderRouteBySymbolPayloadAdr0477 호환
// ============================================================================

/**
 * Snapshot replay adapter 의 단일 symbol 출력.
 * 호출자(preflight merge)는 InvestorFlowProviderRouteBySymbolPayloadAdr0477 와 동일 shape 로 사용 가능.
 *
 * 사용자 명시 §C invariants (literal types — TypeScript 컴파일 타임 강제):
 *   - source: 'SNAPSHOT_REPLAY_ADAPTER' — frozen 출처 추적
 *   - executionImpact: 'NONE'
 *   - liveExecutionAllowed: false
 *   - scoreUsage: 'SHADOW_ONLY'
 *   - usableForGate: false / usableForLive: false / usableForShadow: true
 */
export interface FrozenInvestorFlowRouteResult
  extends InvestorFlowProviderRouteBySymbolPayloadAdr0477 {
  source: 'SNAPSHOT_REPLAY_ADAPTER';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  scoreUsage: 'SHADOW_ONLY';
  frozenFromSnapshotId: string; // 진단 추적 — 어느 snapshot 에서 frozen 되었는지
  frozenFetchedAtKst?: string; // 원본 fetch 시각 (snapshot 영속 시점 아님)
}

/**
 * hydrateBulkFromSnapshot 반환 schema — 호출자 진단/검증 입력.
 *
 * 사용자 명시 §C invariants:
 *   - providerCalls/kisCalls/krxCalls/yahooCalls/naverCalls = 0 literal 강제
 *   - source: 'SNAPSHOT_REPLAY_ADAPTER' literal
 *   - keyMiss = symbol 요청 ↔ snapshot frozen row 부재 카운트 ('row missing' 진단)
 *   - returned = bySymbol 에 들어간 count = requested - keyMiss
 *   - status 별 분류 카운터 (verified / emptyValid / staleCache / failed / unknown)
 *     — UNKNOWN 을 임의로 VERIFIED 격상 금지
 */
export interface SnapshotInvestorFlowHydrationResult {
  requested: number;
  returned: number;
  verified: number;
  emptyValid: number;
  staleCache: number;
  failed: number;
  unknown: number;
  keyMiss: number;
  keyMissSymbols: string[]; // 'row missing' 진단 — 어떤 종목이 snapshot 에 없는지
  bySymbol: Map<string, FrozenInvestorFlowRouteResult>;
  providerCalls: 0;
  kisCalls: 0;
  krxCalls: 0;
  yahooCalls: 0;
  naverCalls: 0;
  source: 'SNAPSHOT_REPLAY_ADAPTER';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  diagnosticOnly: true;
  snapshotId: string | null;
  snapshotCapturedAt: string | null;
  hydratedAt: string; // adapter 호출 시각 ISO
}

// ============================================================================
// SSOT 헬퍼 — 정규화 + 매핑
// ============================================================================

/** 6자리 KRX code 정규화 — `.KS`/`.KQ` suffix strip + 6자리 zero-pad. invalid 시 null. */
function normalizeSnapshotSymbol(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim().replace(/\.(KS|KQ|KOSPI|KOSDAQ)$/i, '');
  if (!/^\d{1,6}$/.test(stripped)) return null;
  return stripped.padStart(6, '0');
}

/** SnapshotFrozenSupplyRow.status → InvestorFlowProviderStatus 매핑 SSOT (UNKNOWN preserves UNKNOWN). */
function mapSnapshotStatusToProviderStatus(
  status: SnapshotFrozenSupplyRow['status']
): InvestorFlowProviderStatus {
  switch (status) {
    case 'VERIFIED':
      return 'VERIFIED';
    case 'PARTIAL_VERIFIED':
      return 'PARTIAL';
    case 'EMPTY_VALID':
      return 'ACCEPTED_EMPTY';
    case 'STALE_CACHE':
      return 'CACHE_STALE_HIT';
    case 'PROVIDER_ERROR':
      return 'PROVIDER_ERROR';
    case 'UNKNOWN':
    default:
      return 'UNKNOWN';
  }
}

/** SnapshotFrozenSupplyRow.semanticSignal → SemanticSupplySignal 매핑 SSOT. */
function mapSnapshotSignalToSemanticSignal(
  signal: SnapshotFrozenSupplyRow['semanticSignal']
): SemanticSupplySignal {
  switch (signal) {
    case 'BULLISH':
      return 'BULLISH';
    case 'BEARISH':
      return 'BEARISH';
    case 'NEUTRAL':
      return 'NEUTRAL';
    case 'UNKNOWN':
    default:
      return 'UNKNOWN';
  }
}

/** Frozen row 가 numeric supply 값을 보유하는지 (foreign or institution net buy finite). */
function hasFrozenNumericRow(row: SnapshotFrozenSupplyRow): boolean {
  const f = row.foreignNetBuy;
  const i = row.institutionNetBuy;
  return (
    (typeof f === 'number' && Number.isFinite(f)) ||
    (typeof i === 'number' && Number.isFinite(i))
  );
}

/**
 * SnapshotFrozenSupplyRow → InvestorFlowProviderRouteBySymbolPayloadAdr0477 호환 객체 합성.
 *
 * 사용자 명시 §F invariants:
 *   - source: 'SNAPSHOT_REPLAY_ADAPTER' literal
 *   - executionImpact: 'NONE' / liveExecutionAllowed: false / scoreUsage: 'SHADOW_ONLY' literal
 *   - usableForGate: false / usableForLive: false / usableForShadow: true literal
 *   - UNKNOWN 을 VERIFIED 로 임의 격상 금지 — status/signal 그대로 propagate
 */
function buildFrozenRouteResult(
  symbol: string,
  row: SnapshotFrozenSupplyRow,
  snapshotId: string
): FrozenInvestorFlowRouteResult {
  const providerStatus = mapSnapshotStatusToProviderStatus(row.status);
  const semanticSignal = mapSnapshotSignalToSemanticSignal(row.semanticSignal);
  const hasNumeric = hasFrozenNumericRow(row);

  // Construct an actualInvestorRow that downstream evaluators can consume.
  // Only includes numeric supply fields when row.rowAvailable=true AND numeric values exist.
  const actualInvestorRow: Record<string, unknown> | null =
    row.rowAvailable && hasNumeric
      ? {
          foreignNetBuy: row.foreignNetBuy,
          institutionalNetBuy: row.institutionNetBuy,
          programNetBuy: row.programNetBuy,
          _source: 'SNAPSHOT_REPLAY_ADAPTER',
        }
      : null;

  return {
    code: symbol,
    requestSymbol: symbol,
    candidateSymbol: symbol,
    quoteSymbol: symbol,
    providerSymbol: symbol,
    normalizedSymbol: symbol,
    providerScope: 'SYMBOL_LEVEL',
    routePurpose: 'snapshot_replay_diagnostic',
    materialized: row.rowAvailable === true,
    usableForRouter: row.rowAvailable === true,
    usableForGate: false,
    usableForLive: false,
    usableForShadow: true,
    selectedProvider:
      row.selectedProvider === 'KIS_API'
        ? 'KIS_API'
        : row.selectedProvider === 'KRX_OPENAPI'
        ? 'KRX_INVESTOR_FLOW'
        : row.selectedProvider === 'NAVER_INVESTOR_TREND'
        ? 'NAVER_INVESTOR_TREND'
        : row.selectedProvider === 'CACHE'
        ? 'CACHE'
        : row.selectedProvider === 'NONE'
        ? 'NONE'
        : 'UNKNOWN',
    semanticRow: null,
    gateSemanticFlatRow: hasNumeric
      ? {
          foreignNetBuy: typeof row.foreignNetBuy === 'number' ? row.foreignNetBuy : null,
          institutionNetBuy:
            typeof row.institutionNetBuy === 'number' ? row.institutionNetBuy : null,
          programNetBuy: typeof row.programNetBuy === 'number' ? row.programNetBuy : null,
          _source: 'ROUTER_EXTRACTED',
        }
      : null,
    actualInvestorRow,
    normalizedInvestorRow: actualInvestorRow,
    semanticInvestorRow: null,
    supplySemanticRow: null,
    actualRowAvailable: row.rowAvailable === true && hasNumeric,
    normalizedRowAvailable: row.rowAvailable === true && hasNumeric,
    semanticRowAvailable: false,
    rowCarryPath: row.rowAvailable === true && hasNumeric ? 'ADAPTER_TO_ROUTER' : 'NONE',
    sanitizedInvestorFlowRows: [],
    actualInvestorFlowRows: actualInvestorRow ? [actualInvestorRow] : [],
    actualInvestorFlowRowCount: actualInvestorRow ? 1 : 0,
    actualInvestorFlowRowSourcePath: 'SNAPSHOT_REPLAY_ADAPTER',
    actualInvestorFlowFieldKeys: actualInvestorRow ? Object.keys(actualInvestorRow) : [],
    actualInvestorFlowNumericKeys: hasNumeric
      ? ['foreignNetBuy', 'institutionalNetBuy', 'programNetBuy'].filter((k) => {
          const v = (actualInvestorRow as Record<string, unknown> | null)?.[k];
          return typeof v === 'number' && Number.isFinite(v);
        })
      : [],
    actualInvestorFlowNumericStringKeys: [],
    actualInvestorFlowCarried: actualInvestorRow !== null,
    adapterRowsForwardedAcrossProviders: false,
    diagnosticActualInvestorRow: actualInvestorRow,
    selectedProviderActualInvestorRow: actualInvestorRow,
    actualInvestorRowProvider:
      row.selectedProvider === 'KIS_API'
        ? 'KIS_API'
        : row.selectedProvider === 'NAVER_INVESTOR_TREND'
        ? 'NAVER_INVESTOR_TREND'
        : actualInvestorRow !== null
        ? 'UNKNOWN'
        : null,
    actualInvestorRowUseScope: 'SHADOW_SCORE',
    investorRowMaterializationClass: hasNumeric
      ? 'ACTUAL_NUMERIC_ROW'
      : 'NORMALIZED_METADATA_ONLY',
    diagnosticActualInvestorRowFromNormalized: false,
    selectedCandidate: null,
    selectedActualRowPath: 'SNAPSHOT_REPLAY_ADAPTER',
    selectedActualRowFieldKeys: actualInvestorRow ? Object.keys(actualInvestorRow) : [],
    selectedActualNumericFieldKeys: hasNumeric
      ? ['foreignNetBuy', 'institutionalNetBuy', 'programNetBuy'].filter((k) => {
          const v = (actualInvestorRow as Record<string, unknown> | null)?.[k];
          return typeof v === 'number' && Number.isFinite(v);
        })
      : [],
    selectedActualNumericStringFieldKeys: [],
    selectedActualPlaceholderFieldKeys: [],
    kisRawRowAvailableAtAdapter: false,
    kisNormalizedRowAvailableAtRouter: false,
    kisSelectedCandidateCarriesSemanticRow: false,
    semanticRowBreakPoint: hasNumeric ? 'ACTUAL_ROW_CARRIED_WITH_FIELDS' : 'NO_ROW_FOUND',
    status: providerStatus,
    signal: semanticSignal,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    scoreUsage: 'SHADOW_ONLY',
    // Frozen route metadata (extends Pick<>)
    source: 'SNAPSHOT_REPLAY_ADAPTER',
    frozenFromSnapshotId: snapshotId,
    frozenFetchedAtKst: row.fetchedAtKst,
  };
}

// ============================================================================
// Public API — bulk hydration
// ============================================================================

/**
 * Snapshot 에 저장된 frozen per-symbol supply rows 를 InvestorFlow router-equivalent
 * bySymbol map 으로 변환.
 *
 * @param symbols 요청할 6자리 KRX code 목록 (정규화 자동 수행)
 * @param snapshot RuntimeDebugSnapshot — null/undefined 시 모두 keyMiss 처리
 * @returns SnapshotInvestorFlowHydrationResult — providerCalls=0 invariant 보장
 *
 * 사용자 명시 §C invariants (절대 변경 금지):
 *   - providerCalls/kisCalls/krxCalls/yahooCalls/naverCalls = 0
 *   - source: 'SNAPSHOT_REPLAY_ADAPTER'
 *   - keyMiss → 'row missing' 진단 (UNKNOWN 임의 VERIFIED 격상 금지)
 *   - bySymbol 은 snapshot 에 존재하는 symbol 만 entry — 부재 symbol 은 미포함
 */
export function hydrateBulkFromSnapshot(
  symbols: string[],
  snapshot: RuntimeDebugSnapshot | null
): SnapshotInvestorFlowHydrationResult {
  const bySymbol = new Map<string, FrozenInvestorFlowRouteResult>();
  const keyMissSymbols: string[] = [];
  let verified = 0;
  let emptyValid = 0;
  let staleCache = 0;
  let failed = 0;
  let unknown = 0;

  // Build O(1) lookup index from snapshot.frozenSupplyRows
  const frozenIndex = new Map<string, SnapshotFrozenSupplyRow>();
  if (snapshot && Array.isArray(snapshot.frozenSupplyRows)) {
    for (const row of snapshot.frozenSupplyRows) {
      const normalized = normalizeSnapshotSymbol(row.symbol);
      if (normalized !== null) {
        frozenIndex.set(normalized, row);
      }
    }
  }

  const snapshotId = snapshot?.snapshotId ?? null;
  const snapshotCapturedAt = snapshot?.capturedAt ?? null;

  for (const rawSymbol of symbols) {
    const symbol = normalizeSnapshotSymbol(rawSymbol);
    if (symbol === null) {
      // Invalid symbol — treat as keyMiss (no frozen row possible)
      keyMissSymbols.push(rawSymbol);
      continue;
    }
    const frozenRow = frozenIndex.get(symbol);
    if (!frozenRow) {
      keyMissSymbols.push(symbol);
      continue;
    }
    const result = buildFrozenRouteResult(symbol, frozenRow, snapshotId ?? 'unknown');
    bySymbol.set(symbol, result);
    // Status classification (UNKNOWN preserved — never silently upgrade)
    switch (frozenRow.status) {
      case 'VERIFIED':
      case 'PARTIAL_VERIFIED':
        verified += 1;
        break;
      case 'EMPTY_VALID':
        emptyValid += 1;
        break;
      case 'STALE_CACHE':
        staleCache += 1;
        break;
      case 'PROVIDER_ERROR':
        failed += 1;
        break;
      case 'UNKNOWN':
      default:
        unknown += 1;
        break;
    }
  }

  return {
    requested: symbols.length,
    returned: bySymbol.size,
    verified,
    emptyValid,
    staleCache,
    failed,
    unknown,
    keyMiss: keyMissSymbols.length,
    keyMissSymbols,
    bySymbol,
    providerCalls: 0,
    kisCalls: 0,
    krxCalls: 0,
    yahooCalls: 0,
    naverCalls: 0,
    source: 'SNAPSHOT_REPLAY_ADAPTER',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    diagnosticOnly: true,
    snapshotId,
    snapshotCapturedAt,
    hydratedAt: new Date().toISOString(),
  };
}

/**
 * 진단용 — adapter 호출 결과를 사람이 읽을 수 있는 1줄 메시지로 포맷.
 * `/replay_supply` 응답 메시지 헤더 등에 사용.
 */
export function formatHydrationResultLine(result: SnapshotInvestorFlowHydrationResult): string {
  return (
    `[SnapshotReplayAdapter] requested=${result.requested} returned=${result.returned} ` +
    `keyMiss=${result.keyMiss} verified=${result.verified} emptyValid=${result.emptyValid} ` +
    `staleCache=${result.staleCache} failed=${result.failed} unknown=${result.unknown} ` +
    `providerCalls=0 source=SNAPSHOT_REPLAY_ADAPTER executionImpact=NONE`
  );
}
