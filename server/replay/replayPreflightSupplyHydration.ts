// @responsibility Patch-002 snapshot → preflight supply merge orchestrator (replay-mode guard, providerCalls=0).

/**
 * Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-002 §D — Preflight Supply Hydration Orchestrator.
 *
 * 사용자 명시 framing verbatim:
 *   "이 프롬프트대로 가면 주말에 /replay_supply 로 수급이 실제 candidate context 에
 *    들어가는지를 provider 호출 없이 검증할 수 있습니다."
 *
 * 본 모듈은 SnapshotInvestorFlowReplayAdapter (§C) 를 실제 preflight merge 경로에
 * 주입할 수 있도록 *오케스트레이션 layer* 만 제공한다. LIVE 매매 본체에 절대 연결되지 않으며,
 * 모든 호출은 `withReplayContext('AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT', ...)` wrapping 으로
 * provider call guard 가 활성화된 상태에서만 실행된다.
 *
 * 두 진입점:
 *   1. `replayPreflightSupplyHydrationFromSnapshot(snapshot, opts?)`
 *      → snapshot 전체에서 frozen supply 후보 추출 → bySymbol map 합성
 *      → /replay_supply 명령 응답 본문에 사용
 *   2. `replayCandidateSupplyMergeFromSnapshot(snapshot, candidateSymbols, opts?)`
 *      → 호출자가 명시한 candidate 목록만 hydrate
 *      → 단위 테스트 / 부분 검증 용도
 *
 * 핵심 invariants (사용자 명시 §D — 절대 변경 금지):
 *   1. replay mode 안에서만 실행 (`withReplayContext` 의무 wrapping)
 *   2. providerCalls=0 invariant — adapter 가 자체적으로 0 보장, 본 모듈은 read-only 위임
 *   3. preflight 본체 호출 0 (signalScanner / entryEngine / orderExecutor 등 import 0)
 *   4. snapshot 본체 무수정 — frozenSupplyRows read-only 만
 *   5. UNKNOWN 을 임의로 VERIFIED 격상 금지 — adapter 가 status 그대로 propagate
 *   6. snapshot 부재 또는 frozenSupplyRows 부재 시 keyMissAll 결과 반환 — throw 금지
 *   7. executionImpact: 'NONE' / diagnosticOnly: true literal 강제
 *   8. LIVE 매매 본체 연결 금지 — diagnosticOnly: true literal 강제
 *
 * 주말 verification flow:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ /replay_supply 명령                                              │
 *   │   ↓                                                              │
 *   │ loadLatestRuntimeDebugSnapshot()  (read-only, providerCalls=0)   │
 *   │   ↓                                                              │
 *   │ withReplayContext('AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT')          │
 *   │   ↓                                                              │
 *   │ replayPreflightSupplyHydrationFromSnapshot(snapshot)             │
 *   │   ↓                                                              │
 *   │   └─ hydrateBulkFromSnapshot(candidateSymbols, snapshot)         │
 *   │     ↓                                                            │
 *   │     ├─ bySymbol map (frozen InvestorFlow router-equivalent)      │
 *   │     ├─ keyMissSymbols[] ('row missing' 진단)                     │
 *   │     └─ providerCalls=0 invariant 검증                             │
 *   │   ↓                                                              │
 *   │ Telegram 응답: 수급 hydration 결과 + provider call 차단 확인     │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * 호출자 (preflight merge 본체) wiring 은 *별도 후속 PR* scope — 본 모듈은 SSOT 진입점만 제공.
 * preflight 본체에서 호출하려면:
 *   `if (isReplayProviderCallBlocked()) { hydrate from snapshot } else { fetch from provider }`
 * 패턴이지만, signalScanner / preflight 본체 수정은 본 Patch scope 외 (회귀 위험 격리).
 */

import {
  hydrateBulkFromSnapshot,
  formatHydrationResultLine,
  type FrozenInvestorFlowRouteResult,
  type SnapshotInvestorFlowHydrationResult,
} from './snapshotInvestorFlowReplayAdapter.js';
import {
  withReplayContext,
  isReplayProviderCallBlocked,
  describeReplayBlock,
  getCurrentReplayContext,
} from './replayContext.js';
import type {
  RuntimeDebugSnapshot,
  SnapshotFrozenSupplyRow,
} from './runtimeDebugSnapshotRepo.js';

// ============================================================================
// 진단 결과 schema — literal types 컴파일 타임 강제
// ============================================================================

/**
 * Patch-002 §D — preflight supply hydration 결과 진단 schema.
 *
 * 호출자 (Telegram /replay_supply, 단위 테스트) 진단 입력.
 *
 * 사용자 명시 §D invariants (TypeScript 컴파일 타임 강제):
 *   - providerCalls/kisCalls/krxCalls/yahooCalls/naverCalls = 0 literal
 *   - source: 'SNAPSHOT_REPLAY_ADAPTER' literal
 *   - diagnosticOnly: true literal
 *   - executionImpact: 'NONE' literal
 *   - liveExecutionAllowed: false literal
 *   - replayMode: 'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT' literal
 *   - snapshotIngested = snapshot != null (snapshot 부재 시 false)
 *   - frozenRowSourceCount = snapshot.frozenSupplyRows?.length ?? 0
 */
export interface ReplayPreflightSupplyHydrationResult {
  snapshotIngested: boolean;
  snapshotId: string | null;
  snapshotCapturedAt: string | null;
  snapshotMarketDate: string | null;
  frozenRowSourceCount: number;
  hydration: SnapshotInvestorFlowHydrationResult;
  replayMode: 'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT';
  providerCallsBlocked: true;
  providerCalls: 0;
  kisCalls: 0;
  krxCalls: 0;
  yahooCalls: 0;
  naverCalls: 0;
  source: 'SNAPSHOT_REPLAY_ADAPTER';
  diagnosticOnly: true;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  hydratedAt: string;
  diagnosticLine: string;
}

/**
 * 호출자가 옵션으로 사용할 수 있는 hint 입력.
 *
 * - `symbolFilter`: 특정 candidate 만 hydrate. undefined 시 snapshot 의 전체 frozen rows 대상.
 * - `verifyProviderCallBlocked`: 호출 종료 시점에 replay context 의 provider call guard 가
 *   여전히 활성 상태인지 추가 검증. true (default) — 안전 invariant.
 */
export interface ReplayPreflightSupplyHydrationOptions {
  symbolFilter?: string[];
  verifyProviderCallBlocked?: boolean;
}

// ============================================================================
// SSOT 헬퍼 — symbol 추출
// ============================================================================

/**
 * snapshot.frozenSupplyRows 에서 symbol 목록 추출.
 * snapshot 부재 / frozenSupplyRows 부재 / non-array 시 빈 배열.
 */
function extractFrozenSymbols(snapshot: RuntimeDebugSnapshot | null): string[] {
  if (!snapshot) return [];
  const rows = snapshot.frozenSupplyRows;
  if (!Array.isArray(rows)) return [];
  const symbols: string[] = [];
  for (const row of rows) {
    if (row && typeof row.symbol === 'string' && row.symbol.length > 0) {
      symbols.push(row.symbol);
    }
  }
  return symbols;
}

/**
 * 사용자 명시 §D invariant 검증 — replay context 가 활성 + provider call 차단 활성.
 * 위반 시 throw — 호출자가 try/catch 격리해 graceful 처리.
 */
function assertReplayContextActive(): void {
  const ctx = getCurrentReplayContext();
  if (ctx === null) {
    throw new Error(
      '[ReplayPreflightSupplyHydration] replay context 가 활성 상태가 아닙니다. ' +
        'withReplayContext("AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT", ...) 안에서만 호출 가능합니다.'
    );
  }
  if (!isReplayProviderCallBlocked()) {
    throw new Error(
      `[ReplayPreflightSupplyHydration] replay provider call guard 가 비활성 상태입니다. ` +
        describeReplayBlock('snapshot-replay-adapter')
    );
  }
}

// ============================================================================
// Internal core — 실제 hydration 로직 (replay context wrapping 없음)
// ============================================================================

/**
 * Internal — 실제 hydration 수행. replay context guard 는 호출자가 보장.
 *
 * 본 함수는 외부 export 0 — 호출자는 반드시 `replayPreflightSupplyHydrationFromSnapshot`
 * 또는 `replayCandidateSupplyMergeFromSnapshot` 경유 (replay context wrapping 의무).
 */
function performHydration(
  snapshot: RuntimeDebugSnapshot | null,
  candidateSymbols: string[]
): ReplayPreflightSupplyHydrationResult {
  const hydration = hydrateBulkFromSnapshot(candidateSymbols, snapshot);
  const frozenRowSourceCount = Array.isArray(snapshot?.frozenSupplyRows)
    ? snapshot.frozenSupplyRows.length
    : 0;
  return {
    snapshotIngested: snapshot !== null,
    snapshotId: snapshot?.snapshotId ?? null,
    snapshotCapturedAt: snapshot?.capturedAt ?? null,
    snapshotMarketDate: snapshot?.marketDate ?? null,
    frozenRowSourceCount,
    hydration,
    replayMode: 'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT',
    providerCallsBlocked: true,
    providerCalls: 0,
    kisCalls: 0,
    krxCalls: 0,
    yahooCalls: 0,
    naverCalls: 0,
    source: 'SNAPSHOT_REPLAY_ADAPTER',
    diagnosticOnly: true,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    hydratedAt: new Date().toISOString(),
    diagnosticLine: formatHydrationResultLine(hydration),
  };
}

// ============================================================================
// Public API — 두 진입점
// ============================================================================

/**
 * Patch-002 §D 메인 진입점 — snapshot 전체에서 frozen supply 후보 추출 후 bySymbol 합성.
 *
 * `/replay_supply` Telegram 명령 본문에 사용.
 *
 * 알고리즘:
 *   1. snapshot 부재 → 빈 hydration result 반환 (throw 0)
 *   2. snapshot.frozenSupplyRows 에서 symbol 추출 (options.symbolFilter 우선)
 *   3. withReplayContext('AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT', snapshotId, ...) wrapping
 *   4. context 안에서 hydrateBulkFromSnapshot(symbols, snapshot) 호출
 *   5. context 종료 시 replay guard 자동 해제 (try/finally)
 *
 * @param snapshot RuntimeDebugSnapshot — null 시 keyMissAll 결과
 * @param options 옵셔널 - symbolFilter / verifyProviderCallBlocked
 * @returns ReplayPreflightSupplyHydrationResult (providerCalls=0 invariant 보장)
 */
export async function replayPreflightSupplyHydrationFromSnapshot(
  snapshot: RuntimeDebugSnapshot | null,
  options: ReplayPreflightSupplyHydrationOptions = {}
): Promise<ReplayPreflightSupplyHydrationResult> {
  const candidateSymbols =
    options.symbolFilter !== undefined && Array.isArray(options.symbolFilter)
      ? options.symbolFilter
      : extractFrozenSymbols(snapshot);
  const verifyGuard = options.verifyProviderCallBlocked !== false; // default true

  return withReplayContext(
    'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT',
    snapshot?.snapshotId ?? null,
    () => {
      if (verifyGuard) {
        assertReplayContextActive();
      }
      return performHydration(snapshot, candidateSymbols);
    }
  );
}

/**
 * Patch-002 §D 보조 진입점 — 호출자가 명시한 candidate 목록만 hydrate.
 *
 * 단위 테스트 / 부분 검증 용도. preflight merge 본체에서 직접 호출 금지
 * (LIVE 매매 본체 연결 금지 — 본 함수는 read-only 진단 전용).
 *
 * @param snapshot RuntimeDebugSnapshot — null 시 keyMissAll
 * @param candidateSymbols hydrate 대상 6자리 KRX code 목록
 * @param options 옵셔널 - verifyProviderCallBlocked (default true)
 * @returns ReplayPreflightSupplyHydrationResult
 */
export async function replayCandidateSupplyMergeFromSnapshot(
  snapshot: RuntimeDebugSnapshot | null,
  candidateSymbols: string[],
  options: ReplayPreflightSupplyHydrationOptions = {}
): Promise<ReplayPreflightSupplyHydrationResult> {
  const verifyGuard = options.verifyProviderCallBlocked !== false;
  return withReplayContext(
    'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT',
    snapshot?.snapshotId ?? null,
    () => {
      if (verifyGuard) {
        assertReplayContextActive();
      }
      return performHydration(snapshot, candidateSymbols);
    }
  );
}

// ============================================================================
// Public diagnostic formatters
// ============================================================================

/**
 * 사람이 읽을 수 있는 multi-line 진단 메시지 — Telegram /replay_supply 응답용.
 *
 * 형식:
 *   [SnapshotReplayPreflight] mode=AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT snapshotId=... marketDate=...
 *   [SnapshotReplayAdapter] requested=N returned=N keyMiss=N ... providerCalls=0
 *   [Invariant] replayMode active / providerCallsBlocked=true / executionImpact=NONE
 */
export function formatReplayPreflightHydrationMessage(
  result: ReplayPreflightSupplyHydrationResult
): string {
  const lines: string[] = [];
  lines.push(
    `[SnapshotReplayPreflight] mode=${result.replayMode} snapshotIngested=${result.snapshotIngested} ` +
      `snapshotId=${result.snapshotId ?? 'null'} marketDate=${result.snapshotMarketDate ?? 'null'} ` +
      `frozenRowSourceCount=${result.frozenRowSourceCount}`
  );
  lines.push(result.diagnosticLine);
  lines.push(
    `[Invariant] replayMode=active providerCallsBlocked=${result.providerCallsBlocked} ` +
      `providerCalls=${result.providerCalls} kisCalls=${result.kisCalls} ` +
      `krxCalls=${result.krxCalls} yahooCalls=${result.yahooCalls} naverCalls=${result.naverCalls} ` +
      `source=${result.source} executionImpact=${result.executionImpact} ` +
      `liveExecutionAllowed=${result.liveExecutionAllowed} diagnosticOnly=${result.diagnosticOnly}`
  );
  if (result.hydration.keyMissSymbols.length > 0) {
    const preview = result.hydration.keyMissSymbols.slice(0, 5).join(',');
    const remainder =
      result.hydration.keyMissSymbols.length > 5
        ? ` ... (+${result.hydration.keyMissSymbols.length - 5} more)`
        : '';
    lines.push(`[KeyMiss] symbols=${preview}${remainder} reason='row missing in snapshot'`);
  }
  return lines.join('\n');
}

// ============================================================================
// Re-exports — 호출자(Telegram cmd, 단위 테스트) 편의
// ============================================================================

export type { FrozenInvestorFlowRouteResult, SnapshotInvestorFlowHydrationResult };
