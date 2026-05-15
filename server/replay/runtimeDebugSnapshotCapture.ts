// @responsibility 18:00 KST after-hours runtime debug snapshot ESM-safe capture orchestrator SSOT (Patch-003 — 17:00 → 18:00 격상).

/**
 * Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-001/002/003 — Runtime Debug Snapshot Capture.
 *
 * 사용자 명시 framing (Patch-001 §A, Patch-003 시간 격상):
 *   "17시에 스냅샷을 찍고, 17시에 찍는 스냅샷은 sell only 용이 아니고 장중 스냅샷과
 *    동일하게 취급한다. 17:00에 신규 KIS/KRX/Yahoo/Naver 호출 금지.
 *    저장 대상은 마지막 장중 runtime snapshot/cache/diagnostic state.
 *    replay에서는 SELL_ONLY 의미 부여 금지."
 *
 * Patch-003 격상 사유: 17:00 KST 시점에 일부 평일에 직전 scan 미완료로
 * `getLastScanSummary() null` 경고 발생 빈도 ↑ → 18:00 KST (장 종료 +2.5h) 로 이동.
 * scan + learning + reflection cron 모두 완료 후 forensic / supply 영속 안정화 시점.
 *
 * 사용자 명시 framing (Patch-002 §B/C):
 *   "스냅샷을 단순 조회용으로만 쓰지 않고, SnapshotInvestorFlowReplayAdapter 를
 *    추가하여 snapshot 에 저장된 frozen per-symbol supply rows 를 실제 preflight
 *    merge 경로에 주입할 수 있게 한다. providerCalls=0 invariant 유지."
 *
 * ESM-only project (`"type": "module"` + `module: "ESNext"`) — 본 모듈은
 * `await import()` 동적 임포트만 사용. CommonJS `require()` 사용 금지 (root cause
 * of 15:19 production failure — `marketCloseSnapshotCapture.ts` 영구 폐기 정합).
 *
 * 우선순위 SSOT (9 source — 사용자 §"snapshot capture source" 직접 인용):
 *   1. runtime state (server/state.ts)
 *   2. scanDiagnostics.getLastScanSummary() — universe/gate/supply forensic 통합
 *   3. watchlist state (watchlistRepo.loadWatchlist)
 *   4. sectorEnergy (macroStateRepo.loadMacroState)
 *   5. program trading (macroStateRepo.loadMacroState)
 *   6. shadow position registry (shadowTradeRepo.loadShadowTrades)
 *   7. counterfactual universe learning ledger (옵셔널)
 *   8. provider diagnostics cache (옵셔널)
 *   9. **per-symbol frozen supply rows** (Patch-002 §B — from scanSummary.investorFlowProviderRouter.bySymbol)
 *
 * 절대 invariants (15+ 항목):
 *   - 외부 API 호출 0건 (KIS/KRX/Yahoo/Naver 모두) — 영속 + state read-only
 *   - KIS 주문 함수 5종 import 0건 (정적 grep 가드)
 *   - 영속 throw 시 매매 흐름 차단 0 — per-source try/catch 격리
 *   - sanitized fields 만 (redactSensitiveFields 통과 + sanitizeRuntimeDebugSnapshot 한 번 더)
 *   - partial capture 허용 — 일부 source missing 시 captureStatus='PARTIAL' + warnings[]
 *   - executionImpact: 'NONE' literal type 컴파일 타임 강제
 *   - replayOnly: true literal / diagnosticOnly: true literal
 *   - sellOnlySemanticApplied: false literal (사용자 명시 SELL_ONLY 의미 부여 금지)
 *   - sessionInterpretation: 'INTRADAY_REPLAY_EQUIVALENT' literal
 *   - priceSemantics: 'REFERENCE_ONLY_NOT_FOR_TRADE_DECISION' literal
 *   - replayGuard.providerCallsAllowed: false + 5 call counts = 0 literal
 *   - retention.model: 'SINGLE_LATEST_OVERWRITE' literal
 *   - sanitize.applied: true / rawPayloadStored: false literal
 *   - ENV `RUNTIME_DEBUG_SNAPSHOT_DISABLED=true` default OFF, ADR-0157 정확 비교 1줄 즉시 비활성
 *
 * Patch-002 추가 invariants:
 *   - frozenSupplyRows 는 normalized supply row schema 만 영속 (raw KIS/KRX response 영속 0건)
 *   - SnapshotInvestorFlowReplayAdapter 는 LIVE execution path 에 절대 연결 0건
 *   - UNKNOWN 을 임의로 VERIFIED 로 조작 금지 (status / signal preserved as-is)
 */

import {
  type RuntimeDebugSnapshot,
  type SanitizedRuntimeBlock,
  type SanitizedUniverseBlock,
  type SanitizedGateBlock,
  type SanitizedSupplyBlock,
  type SanitizedWatchlistBlock,
  type SanitizedSectorEnergyBlock,
  type SanitizedProgramTradingBlock,
  type SanitizedShadowBlock,
  type SanitizedCounterfactualBlock,
  type SnapshotFrozenSupplyRow,
  type SnapshotReplayAdapterMeta,
  generateSnapshotId,
  kstDateString,
  saveLatestRuntimeDebugSnapshot,
  redactSensitiveFields,
} from './runtimeDebugSnapshotRepo.js';

// ============================================================================
// ENV gate SSOT — ADR-0157 정확 비교 의무
// ============================================================================

/**
 * ADR-0157 정확 비교 의무 — default OFF.
 * `'1'`/`'TRUE'`/`'yes'`/빈값 모두 default ON (capture 활성) 유지.
 * 호출자 측 inline ENV 검사 0건 (SSOT 헬퍼 위임).
 */
export function isRuntimeDebugSnapshotCaptureDisabled(): boolean {
  return process.env.RUNTIME_DEBUG_SNAPSHOT_DISABLED === 'true';
}

// ============================================================================
// Per-source block builders — 모두 try/catch 격리 + `await import()` 사용
// ============================================================================

interface BlockBuilderOptions {
  warnings: string[];
  missing: string[];
}

/**
 * Per-source import + 빌더 safety wrapper.
 * - import 실패 또는 빌더 throw 시 missing[] / warnings[] 누적 + undefined 반환
 * - 매매 흐름 차단 절대 금지 (Always-On Trading Kernel)
 */
async function safeBuild<T>(
  sectionName: string,
  loader: () => Promise<T | undefined>,
  opts: BlockBuilderOptions,
): Promise<T | undefined> {
  try {
    return await loader();
  } catch (err) {
    opts.missing.push(sectionName);
    opts.warnings.push(
      `[capture] ${sectionName} 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

async function buildRuntimeBlock(
  opts: BlockBuilderOptions,
): Promise<SanitizedRuntimeBlock | undefined> {
  return safeBuild(
    'runtime',
    async () => {
      const state = await import('../state.js');
      return {
        marketSession: 'REGULAR', // 18:00 — runtimeStateBasis=LATEST_INTRADAY_RUNTIME_STATE (Patch-003)
        sellOnly: false, // 사용자 명시 절대 invariant: 18:00 snapshot 은 SELL_ONLY 아님
        engineAlive: true,
        shadowLearningEnabled: true,
        emergencyStop: state.getEmergencyStop(),
        dailyLossPct: state.getDailyLossPct(),
        tradingMode: state.getTradingMode(),
        executionMode: state.getExecutionMode(),
        autoTradePaused: state.getAutoTradePaused(),
        manualBlockNewBuy: state.getManualBlockNewBuy(),
        manualManageOnly: state.getManualManageOnly(),
        dataIntegrityBlocked: state.getDataIntegrityBlocked(),
      };
    },
    opts,
  );
}

async function buildShadowBlock(
  opts: BlockBuilderOptions,
  marketDate: string,
): Promise<SanitizedShadowBlock | undefined> {
  return safeBuild(
    'shadow',
    async () => {
      const repo = await import('../persistence/shadowTradeRepo.js');
      const trades = repo.loadShadowTrades();
      let open = 0;
      let detached = 0;
      let todayCreated = 0;
      let todayClosed = 0;
      for (const t of trades) {
        const isOpen =
          t.status === 'PENDING' ||
          t.status === 'ORDER_SUBMITTED' ||
          t.status === 'PARTIALLY_FILLED' ||
          t.status === 'ACTIVE' ||
          t.status === 'EUPHORIA_PARTIAL';
        if (isOpen) open++;
        if ((t as { detachedFromWatchlist?: boolean }).detachedFromWatchlist === true) detached++;
        if (typeof t.signalTime === 'string' && t.signalTime.startsWith(marketDate)) todayCreated++;
        if (
          (t.status === 'HIT_TARGET' || t.status === 'HIT_STOP') &&
          typeof t.signalTime === 'string' &&
          t.signalTime.startsWith(marketDate)
        ) {
          todayClosed++;
        }
      }
      return { openPositions: open, detachedPositions: detached, todayCreated, todayClosed };
    },
    opts,
  );
}

interface ScanDiagnosticBlocks {
  universe?: SanitizedUniverseBlock;
  gate?: SanitizedGateBlock;
  supply?: SanitizedSupplyBlock;
  sectorEnergy?: SanitizedSectorEnergyBlock;
  /** Patch-002 §B — per-symbol frozen supply rows from investorFlowProviderRouter.bySymbol */
  frozenSupplyRows?: SnapshotFrozenSupplyRow[];
}

async function buildScanDiagnosticBlocks(
  opts: BlockBuilderOptions,
): Promise<ScanDiagnosticBlocks> {
  try {
    const sd = await import('../trading/signalScanner/scanDiagnostics.js');
    const summary = sd.getLastScanSummary();
    if (!summary) {
      opts.missing.push('scanSummary');
      opts.warnings.push(
        '[capture] getLastScanSummary() null — 부팅 후 첫 스캔 전 또는 cron 비활성',
      );
      return {};
    }
    const universe: SanitizedUniverseBlock = {
      candidateCount: summary.candidates,
      sections: {
        trackB: summary.trackB,
        swing: summary.swing,
        catalyst: summary.catalyst,
        momentum: summary.momentum,
      },
      yahooFails: summary.yahooFails,
    };
    const blockers: Array<{ reason: string; count: number }> = [];
    if (summary.waitDistribution) {
      for (const [reason, count] of Object.entries(summary.waitDistribution)) {
        if (typeof count === 'number' && count > 0) blockers.push({ reason, count });
      }
    }
    const gate: SanitizedGateBlock = {
      gate1Pass: summary.gatePassDistribution?.gate1Pass,
      gate2Pass: summary.gatePassDistribution?.gate2Pass,
      gate3Pass: summary.gatePassDistribution?.gate3Pass,
      entries: summary.entries,
      gateMisses: summary.gateMisses,
      rrrMisses: summary.rrrMisses,
      blockers,
    };
    const sectorEnergyDiag = summary.sectorEnergyQualityDiagnostic as
      | { sourceTier?: string }
      | undefined;
    const sectorEnergy: SanitizedSectorEnergyBlock | undefined =
      summary.sectorEnergyQuality !== undefined || sectorEnergyDiag !== undefined
        ? {
            dataQuality: summary.sectorEnergyQuality,
            validSectorCount: summary.validSectorCount,
            sourceTier: sectorEnergyDiag?.sourceTier,
            sectorBoostAllowed: undefined, // ADR-0398 ENV-gated wiring 영역
            strongBuyAllowed: undefined,
          }
        : undefined;
    // Supply block — gate1MinimumSignalForensicAdr0505 summary 기반
    const supplyForensic = summary.gate1MinimumSignalForensicAdr0505 as
      | undefined
      | { semanticAvailableCount?: number };
    const router = summary.investorFlowProviderRouter;
    const supply: SanitizedSupplyBlock | undefined =
      supplyForensic || router
        ? {
            selectedProvider: router?.selectedProvider,
            semanticAvailable: supplyForensic?.semanticAvailableCount,
            providerIssue: router?.status === 'PROVIDER_ERROR',
            marketSignal:
              router?.signal === 'BULLISH' || router?.signal === 'BEARISH' ? true : false,
          }
        : undefined;
    // Patch-002 §B — frozen supply rows from per-symbol bySymbol payload
    const frozenSupplyRows = buildFrozenSupplyRowsFromRouter(router);
    if (router && !frozenSupplyRows) {
      // Router 가 있는데 frozen rows 가 비어있는 케이스 — bySymbol 부재
      opts.warnings.push(
        '[capture] investorFlowProviderRouter.bySymbol 부재 — frozen supply rows 0건',
      );
    }
    return {
      universe,
      gate,
      supply,
      sectorEnergy,
      frozenSupplyRows: frozenSupplyRows ?? undefined,
    };
  } catch (err) {
    opts.missing.push('scanDiagnostics');
    opts.warnings.push(
      `[capture] scanDiagnostics 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}

/**
 * Patch-002 §B — investorFlowProviderRouter.bySymbol → SnapshotFrozenSupplyRow[].
 *
 * 절대 invariants (사용자 명시):
 *   - normalized supply row schema 만 영속 — raw KIS/KRX response 영속 0건
 *   - UNKNOWN 을 임의로 VERIFIED 로 조작 금지 (status / signal preserved)
 *   - row missing 종목은 rowAvailable=false 로 진단 (절대 빠뜨리지 않음)
 */
function buildFrozenSupplyRowsFromRouter(
  router:
    | {
        bySymbol?: Record<string, Record<string, unknown>>;
      }
    | undefined,
): SnapshotFrozenSupplyRow[] | null {
  if (!router?.bySymbol) return null;
  const rows: SnapshotFrozenSupplyRow[] = [];
  for (const [symbol, payload] of Object.entries(router.bySymbol)) {
    if (!payload || typeof payload !== 'object') continue;
    const status = normalizeRowStatus(payload.status);
    const signal = normalizeRowSignal(payload.signal);
    const selectedProvider = normalizeRowProvider(payload.selectedProvider);
    const semantic = payload.semanticInvestorRow as
      | { foreignNetBuy?: number; institutionNetBuy?: number; programNetBuy?: number }
      | null
      | undefined;
    const flat = payload.gateSemanticFlatRow as
      | { foreignNetBuy?: number; institutionNetBuy?: number; programNetBuy?: number }
      | null
      | undefined;
    const foreignNetBuy = pickFiniteNumber(semantic?.foreignNetBuy, flat?.foreignNetBuy);
    const institutionNetBuy = pickFiniteNumber(
      semantic?.institutionNetBuy,
      flat?.institutionNetBuy,
    );
    const programNetBuy = pickFiniteNumber(semantic?.programNetBuy, flat?.programNetBuy);
    const rowAvailable =
      foreignNetBuy !== undefined ||
      institutionNetBuy !== undefined ||
      programNetBuy !== undefined;
    const row: SnapshotFrozenSupplyRow = {
      symbol: normalizeKrxSymbol(symbol),
      selectedProvider,
      status,
      semanticSignal: signal,
      foreignNetBuy,
      institutionNetBuy,
      programNetBuy,
      rowAvailable,
      source: 'INVESTOR_FLOW_PROVIDER_ROUTER_ADR_0477',
    };
    rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

function normalizeKrxSymbol(input: string): string {
  const trimmed = input.trim().replace(/\.(KS|KQ)$/i, '');
  if (/^\d{1,6}$/.test(trimmed)) return trimmed.padStart(6, '0');
  return trimmed;
}

function normalizeRowStatus(input: unknown): SnapshotFrozenSupplyRow['status'] {
  if (typeof input !== 'string') return 'UNKNOWN';
  switch (input) {
    case 'VERIFIED':
      return 'VERIFIED';
    case 'PARTIAL_VERIFIED':
    case 'PARTIAL':
      return 'PARTIAL_VERIFIED';
    case 'EMPTY_VALID':
    case 'ACCEPTED_EMPTY':
      return 'EMPTY_VALID';
    case 'STALE_CACHE':
    case 'CACHE_STALE_HIT':
      return 'STALE_CACHE';
    case 'PROVIDER_ERROR':
      return 'PROVIDER_ERROR';
    default:
      return 'UNKNOWN'; // 사용자 명시 invariant — 임의 격상 금지
  }
}

function normalizeRowSignal(input: unknown): SnapshotFrozenSupplyRow['semanticSignal'] {
  if (input === 'BULLISH' || input === 'BEARISH' || input === 'NEUTRAL') return input;
  return 'UNKNOWN';
}

function normalizeRowProvider(input: unknown): SnapshotFrozenSupplyRow['selectedProvider'] {
  if (typeof input !== 'string') return 'UNKNOWN';
  switch (input) {
    case 'KIS_API':
      return 'KIS_API';
    case 'KRX_OPENAPI':
    case 'KRX_INVESTOR_FLOW':
    case 'KRX_SYMBOL_INVESTOR_FLOW':
    case 'KRX_MARKET_INVESTOR_FLOW':
      return 'KRX_OPENAPI';
    case 'NAVER_INVESTOR_TREND':
      return 'NAVER_INVESTOR_TREND';
    case 'CACHE':
      return 'CACHE';
    case 'NONE':
      return 'NONE';
    default:
      return 'UNKNOWN';
  }
}

function pickFiniteNumber(...candidates: Array<number | undefined>): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return undefined;
}

async function buildWatchlistBlock(
  opts: BlockBuilderOptions,
): Promise<SanitizedWatchlistBlock | undefined> {
  return safeBuild(
    'watchlist',
    async () => {
      const repo = await import('../persistence/watchlistRepo.js');
      const list = repo.loadWatchlist();
      const momentumCount = list.filter(
        (w) => (w as { section?: string }).section === 'MOMENTUM',
      ).length;
      const detachedShadowCount = list.filter(
        (w) => (w as { isDataQuarantined?: boolean }).isDataQuarantined === true,
      ).length;
      return {
        imported: list.length,
        momentumCount,
        detachedShadowCount,
      };
    },
    opts,
  );
}

async function buildSectorEnergyMacroBlock(
  opts: BlockBuilderOptions,
): Promise<SanitizedSectorEnergyBlock | undefined> {
  return safeBuild(
    'sectorEnergyMacro',
    async () => {
      const repo = await import('../persistence/macroStateRepo.js');
      const macro = repo.loadMacroState();
      if (!macro) return undefined;
      return {
        dataQuality: (macro as { sectorEnergyQuality?: string }).sectorEnergyQuality,
        validSectorCount: (macro as { validSectorCount?: number }).validSectorCount,
        sourceTier: (macro as { sectorEnergySourceTier?: string }).sectorEnergySourceTier,
      };
    },
    opts,
  );
}

async function buildProgramTradingBlock(
  opts: BlockBuilderOptions,
): Promise<SanitizedProgramTradingBlock | undefined> {
  return safeBuild(
    'programTrading',
    async () => {
      const repo = await import('../persistence/macroStateRepo.js');
      const macro = repo.loadMacroState();
      if (!macro) return undefined;
      return {
        marketProgramStatus: (macro as { programSource?: string }).programSource,
      };
    },
    opts,
  );
}

async function buildCounterfactualBlock(
  opts: BlockBuilderOptions,
): Promise<SanitizedCounterfactualBlock | undefined> {
  return safeBuild(
    'counterfactual',
    async () => {
      const repo = await import(
        '../persistence/counterfactualUniverseLearningRepo.js'
      ).catch(() => null);
      if (!repo) return undefined;
      const summarizer = (
        repo as {
          summarizeCounterfactualUniverseLearningLedger?: () => unknown;
        }
      ).summarizeCounterfactualUniverseLearningLedger;
      if (typeof summarizer !== 'function') return undefined;
      const summary = summarizer() as {
        totalSnapshots?: number;
        todaySnapshots?: number;
      };
      return {
        recordedCount: summary?.totalSnapshots,
        nearMissCount: summary?.todaySnapshots,
      };
    },
    opts,
  );
}

// ============================================================================
// 메인 진입점
// ============================================================================

export interface CaptureRuntimeDebugSnapshotOptions {
  /** capture 시점 강제 주입 (테스트 격리). 미전달 시 `Date.now()`. */
  nowMs?: number;
  /** marketDate 강제 주입 (테스트 격리). 미전달 시 KST 자동 산출. */
  marketDate?: string;
}

export interface CaptureRuntimeDebugSnapshotResult {
  status: 'CAPTURED' | 'PARTIAL_CAPTURED' | 'DISABLED' | 'PERSIST_FAILED';
  snapshot?: RuntimeDebugSnapshot;
  warnings: string[];
  missingSections: string[];
}

/**
 * 18:00 KST after-hours runtime debug snapshot 자동 capture + 영속 (Patch-003 — 17:00 → 18:00).
 *
 * 호출자 (18:00 cron) 가 본 함수 호출 → 외부 API 호출 0건으로 9 source 모두
 * sanitized snapshot assembly → frozen supply rows 추출 → replay adapter
 * metadata 첨부 → `saveLatestRuntimeDebugSnapshot` 단일 latest overwrite.
 *
 * Partial 허용: 일부 source missing 시 status='PARTIAL_CAPTURED' + warnings[] +
 * missingSections[]. Capture 자체는 throw 안 함 (매매 흐름 보호).
 *
 * 사용자 명시 lifecycle:
 *   - 매 평일 18:00 성공 capture 시 직전 latest atomic overwrite
 *   - capture 실패 시 직전 latest 보존 (`saveLatestRuntimeDebugSnapshot` 가 tmp→rename)
 *   - 다음 거래일 09:00 개장 시 초기화 절대 금지 — 본 capture 만이 cleanup 트리거
 */
export async function captureRuntimeDebugSnapshot(
  options: CaptureRuntimeDebugSnapshotOptions = {},
): Promise<CaptureRuntimeDebugSnapshotResult> {
  if (isRuntimeDebugSnapshotCaptureDisabled()) {
    return {
      status: 'DISABLED',
      warnings: ['ENV RUNTIME_DEBUG_SNAPSHOT_DISABLED=true'],
      missingSections: [],
    };
  }
  const nowMs = options.nowMs ?? Date.now();
  const marketDate = options.marketDate ?? kstDateString(nowMs);
  const capturedAt = new Date(nowMs).toISOString();
  const snapshotId = generateSnapshotId(marketDate, nowMs);

  const opts: BlockBuilderOptions = { warnings: [], missing: [] };

  // 7 source 병렬 로드 (모두 read-only, 외부 호출 0)
  const [runtime, scanBlocks, watchlist, sectorEnergy, programTrading, shadow, counterfactual] =
    await Promise.all([
      buildRuntimeBlock(opts),
      buildScanDiagnosticBlocks(opts),
      buildWatchlistBlock(opts),
      buildSectorEnergyMacroBlock(opts),
      buildProgramTradingBlock(opts),
      buildShadowBlock(opts, marketDate),
      buildCounterfactualBlock(opts),
    ]);

  const isPartial = opts.missing.length > 0;
  const frozenSupplyRows = scanBlocks.frozenSupplyRows;

  // Patch-002 §C — SnapshotInvestorFlowReplayAdapter 메타 (frozen rows 보유 시에만 첨부)
  const snapshotReplayAdapter: SnapshotReplayAdapterMeta | undefined =
    frozenSupplyRows && frozenSupplyRows.length > 0
      ? {
          adapterName: 'SNAPSHOT_INVESTOR_FLOW_REPLAY_ADAPTER',
          diagnosticOnly: true,
          liveExecutionAllowed: false,
          providerCalls: 0,
          kisCalls: 0,
          krxCalls: 0,
          yahooCalls: 0,
          naverCalls: 0,
          source: 'SNAPSHOT_REPLAY_ADAPTER',
        }
      : undefined;

  // sectorEnergy 우선순위: scanDiagnostics > macroState
  const mergedSectorEnergy = scanBlocks.sectorEnergy ?? sectorEnergy;

  // 영속 직전 sanitize 한 번 더 통과 (saveLatestRuntimeDebugSnapshot 가 sanitizeRuntimeDebugSnapshot
  // 한 번 더 통과시키지만, frozen supply rows 의 raw payload 누출 위험 차단을 위해 호출자도 한 번 통과)
  const sanitizedFrozenRows = frozenSupplyRows
    ? (redactSensitiveFields(frozenSupplyRows) as SnapshotFrozenSupplyRow[])
    : undefined;

  const draft: Partial<RuntimeDebugSnapshot> &
    Pick<RuntimeDebugSnapshot, 'snapshotId' | 'capturedAt' | 'marketDate'> = {
    snapshotId,
    capturedAt,
    marketDate,
    captureStatus: isPartial ? 'PARTIAL' : 'OK',
    missingSections: opts.missing.length > 0 ? [...opts.missing] : undefined,
    warnings: opts.warnings.length > 0 ? [...opts.warnings] : undefined,
    runtime: runtime ? (redactSensitiveFields(runtime) as SanitizedRuntimeBlock) : undefined,
    universe: scanBlocks.universe
      ? (redactSensitiveFields(scanBlocks.universe) as SanitizedUniverseBlock)
      : undefined,
    gate: scanBlocks.gate ? (redactSensitiveFields(scanBlocks.gate) as SanitizedGateBlock) : undefined,
    supply: scanBlocks.supply
      ? (redactSensitiveFields(scanBlocks.supply) as SanitizedSupplyBlock)
      : undefined,
    watchlist: watchlist ? (redactSensitiveFields(watchlist) as SanitizedWatchlistBlock) : undefined,
    sectorEnergy: mergedSectorEnergy
      ? (redactSensitiveFields(mergedSectorEnergy) as SanitizedSectorEnergyBlock)
      : undefined,
    programTrading: programTrading
      ? (redactSensitiveFields(programTrading) as SanitizedProgramTradingBlock)
      : undefined,
    shadow: shadow ? (redactSensitiveFields(shadow) as SanitizedShadowBlock) : undefined,
    counterfactual: counterfactual
      ? (redactSensitiveFields(counterfactual) as SanitizedCounterfactualBlock)
      : undefined,
    frozenSupplyRows: sanitizedFrozenRows,
    snapshotReplayAdapter,
  };

  let saved: RuntimeDebugSnapshot;
  try {
    // saveLatestRuntimeDebugSnapshot 내부에서 sanitizeRuntimeDebugSnapshot 가 모든
    // literal type invariants 를 강제 (replayOnly / diagnosticOnly / executionImpact /
    // sellOnlySemanticApplied / replayGuard / retention / sanitize 등).
    saved = saveLatestRuntimeDebugSnapshot(draft as RuntimeDebugSnapshot);
  } catch (err) {
    return {
      status: 'PERSIST_FAILED',
      warnings: [
        ...opts.warnings,
        `[capture] 영속 실패: ${err instanceof Error ? err.message : String(err)}`,
      ],
      missingSections: opts.missing,
    };
  }

  return {
    status: isPartial ? 'PARTIAL_CAPTURED' : 'CAPTURED',
    snapshot: saved,
    warnings: opts.warnings,
    missingSections: opts.missing,
  };
}
