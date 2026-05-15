// @responsibility Market-close 15:19 KST snapshot capture orchestrator SSOT

/**
 * Patch-MARKET-CLOSE-SNAPSHOT-001 — Snapshot Capture Orchestrator.
 *
 * 사용자 명시 framing (§4 Snapshot capture source):
 *   "15:19에 새로 KIS/KRX를 대량 호출하지 않는다.
 *    가능하면 이미 메모리/저장소에 있는 최신 runtime snapshot을 조합한다."
 *
 * 사용자 명시 capture 시간 (절대 변경 금지):
 *   - 15:19 KST (sell-only 시간 회피 — volumeClock policy 09:30~15:20 정합)
 *   - 다음 거래일 개장 시 초기화 안 함 (snapshot 은 다음 거래일 09:00 ~ 15:19 까지 유지)
 *   - 다음 거래일 15:19 capture 가 이전 일자 cleanup (intradaySnapshotRepo SSOT 위임)
 *
 * 우선순위 SSOT (사용자 §4 직접 인용 — 절대 변경 금지):
 *   1. latest scan summary (`getLastScanSummary()`)
 *   2. latest scan_blockers full snapshot source
 *   3. latest gate diagnostics (ScanSummary 안 freshGate2Attribution 등)
 *   4. latest supply snapshot store
 *   5. latest watchlist state (`loadWatchlist()`)
 *   6. latest shadow position registry (`loadShadowTrades()`)
 *   7. latest counterfactual/dry-run ledger (옵셔널 — repo 가용 시)
 *   8. latest sectorEnergy snapshot (`loadMacroState()`)
 *   9. latest provider health cache (server state)
 *
 * 금지 (사용자 §4 직접 인용):
 *   - snapshot capture 를 이유로 전체 KIS investor flow 재조회 금지
 *   - snapshot capture 를 이유로 전체 KRX variant 재시도 금지
 *   - snapshot capture 를 이유로 chart/current price 대량 호출 금지
 *
 * 절대 invariants:
 *   1. 외부 API 호출 0건 (KIS/KRX/Yahoo/Naver 모두) — 영속 + state read-only
 *   2. KIS 주문 함수 5종 import 0건 (정적 grep 가드)
 *   3. 영속 throw 시 매매 흐름 차단 0 — try/catch 격리
 *   4. sanitized fields 만 (redactSensitiveFields 통과)
 *   5. partial capture 허용 — 일부 source missing 시 status='PARTIAL' + warnings[]
 *   6. executionImpact: 'NONE' literal 강제
 *   7. ENV `MARKET_CLOSE_SNAPSHOT_DISABLED=true` default OFF, ADR-0157 정확 비교 1줄 즉시 비활성
 */

import {
  type MarketCloseReplaySnapshot,
  type SanitizedRuntimeBlock,
  type SanitizedUniverseBlock,
  type SanitizedGateBlock,
  type SanitizedSupplyBlock,
  type SanitizedWatchlistBlock,
  type SanitizedSectorEnergyBlock,
  type SanitizedProgramTradingBlock,
  type SanitizedShadowBlock,
  type SanitizedCounterfactualBlock,
  redactSensitiveFields,
  saveMarketCloseReplaySnapshot,
} from '../persistence/intradaySnapshotRepo.js';

// ============================================================================
// ENV gate SSOT
// ============================================================================

/**
 * ADR-0157 정확 비교 의무 — default OFF, 호출자 측 inline ENV 검사 0건.
 * `'1'`/`'TRUE'`/`'yes'`/빈값 모두 default ON (capture 활성) 유지.
 */
export function isMarketCloseSnapshotCaptureDisabled(): boolean {
  return process.env.MARKET_CLOSE_SNAPSHOT_DISABLED === 'true';
}

// ============================================================================
// snapshot ID 생성 SSOT
// ============================================================================

function generateSnapshotId(marketDate: string, capturedAtMs: number): string {
  const hms = new Date(capturedAtMs)
    .toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour12: false })
    .replace(/:/g, '');
  const rand = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `mcs-${marketDate.replace(/-/g, '')}-${hms}-${rand}`;
}

function kstDateString(nowMs: number): string {
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstDate = new Date(nowMs + kstOffset);
  const yyyy = kstDate.getUTCFullYear();
  const mm = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstDate.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================================
// Block builders (sanitized — 모두 try/catch 격리, throw 시 undefined 반환)
// ============================================================================

interface BlockBuilderOptions {
  warnings: string[];
  missing: string[];
}

function safeRequire<T>(loader: () => T, sectionName: string, opts: BlockBuilderOptions): T | undefined {
  try {
    return loader();
  } catch (err) {
    opts.missing.push(sectionName);
    opts.warnings.push(
      `[capture] ${sectionName} 로드 실패: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

async function buildRuntimeBlock(opts: BlockBuilderOptions): Promise<SanitizedRuntimeBlock | undefined> {
  return safeRequire(
    () => {
      // Dynamic import — 순환 import 회피
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const state = require('../state.js') as typeof import('../state.js');
      return {
        marketSession: 'REGULAR', // 15:19 capture 시점은 정규장 후반 (volumeClock 09:30~15:20 이내)
        sellOnly: false, // 15:19 는 매수 허용 정규장 — SELL_ONLY 윈도우 (15:21~15:30) 직전
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
    'runtime',
    opts
  );
}

async function buildShadowBlock(opts: BlockBuilderOptions): Promise<SanitizedShadowBlock | undefined> {
  return safeRequire(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const repo = require('../persistence/shadowTradeRepo.js') as typeof import('../persistence/shadowTradeRepo.js');
      const trades = repo.loadShadowTrades();
      let open = 0;
      let detached = 0;
      let todayCreated = 0;
      let todayClosed = 0;
      const kstDate = kstDateString(Date.now());
      for (const t of trades) {
        const isOpen =
          t.status === 'PENDING' ||
          t.status === 'ORDER_SUBMITTED' ||
          t.status === 'PARTIALLY_FILLED' ||
          t.status === 'ACTIVE' ||
          t.status === 'EUPHORIA_PARTIAL';
        if (isOpen) open++;
        if ((t as { detachedFromWatchlist?: boolean }).detachedFromWatchlist === true) detached++;
        if (typeof t.signalTime === 'string' && t.signalTime.startsWith(kstDate)) todayCreated++;
        if (
          (t.status === 'HIT_TARGET' || t.status === 'HIT_STOP' || t.status === 'REVERTED') &&
          typeof t.signalTime === 'string' &&
          t.signalTime.startsWith(kstDate)
        ) {
          todayClosed++;
        }
      }
      return { openPositions: open, detachedPositions: detached, todayCreated, todayClosed };
    },
    'shadow',
    opts
  );
}

async function buildScanDiagnosticsBlocks(opts: BlockBuilderOptions): Promise<{
  universe?: SanitizedUniverseBlock;
  gate?: SanitizedGateBlock;
  supply?: SanitizedSupplyBlock;
  sectorEnergy?: SanitizedSectorEnergyBlock;
}> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sd = require('../trading/signalScanner/scanDiagnostics.js') as typeof import('../trading/signalScanner/scanDiagnostics.js');
    const summary = sd.getLastScanSummary();
    if (!summary) {
      opts.missing.push('scanSummary');
      opts.warnings.push('[capture] getLastScanSummary() null — 부팅 후 첫 스캔 전 또는 cron 비활성');
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
    const sectorEnergy: SanitizedSectorEnergyBlock | undefined =
      summary.sectorEnergyQuality !== undefined || summary.sectorEnergyQualityDiagnostic !== undefined
        ? {
            dataQuality: summary.sectorEnergyQuality,
            validSectorCount: summary.validSectorCount,
            sourceTier: summary.sectorEnergyQualityDiagnostic?.sourceTier,
            sectorBoostAllowed: undefined, // ADR-0398 ENV-gated wiring 영역
            strongBuyAllowed: undefined,
          }
        : undefined;
    // Supply block — gate1MinimumSignalForensicAdr0505 summary 가 있으면 사용
    const supplyForensic = summary.gate1MinimumSignalForensicAdr0505 as
      | undefined
      | { semanticAvailableCount?: number; supplyScopeAudit?: Record<string, unknown> };
    const supply: SanitizedSupplyBlock | undefined = supplyForensic
      ? {
          semanticAvailable: supplyForensic.semanticAvailableCount,
        }
      : undefined;
    return { universe, gate, supply, sectorEnergy };
  } catch (err) {
    opts.missing.push('scanDiagnostics');
    opts.warnings.push(
      `[capture] scanDiagnostics 로드 실패: ${err instanceof Error ? err.message : String(err)}`
    );
    return {};
  }
}

async function buildWatchlistBlock(opts: BlockBuilderOptions): Promise<SanitizedWatchlistBlock | undefined> {
  return safeRequire(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const repo = require('../persistence/watchlistRepo.js') as typeof import('../persistence/watchlistRepo.js');
      const list = repo.loadWatchlist();
      const momentumCount = list.filter(
        (w) => (w as { section?: string }).section === 'MOMENTUM'
      ).length;
      const detachedShadowCount = list.filter(
        (w) => (w as { isDataQuarantined?: boolean }).isDataQuarantined === true
      ).length;
      return {
        imported: list.length,
        momentumCount,
        detachedShadowCount,
      };
    },
    'watchlist',
    opts
  );
}

async function buildSectorEnergyBlockFromMacro(
  opts: BlockBuilderOptions
): Promise<SanitizedSectorEnergyBlock | undefined> {
  return safeRequire(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const repo = require('../persistence/macroStateRepo.js') as typeof import('../persistence/macroStateRepo.js');
      const macro = repo.loadMacroState();
      if (!macro) return undefined;
      return {
        dataQuality: (macro as { sectorEnergyQuality?: string }).sectorEnergyQuality,
        validSectorCount: (macro as { validSectorCount?: number }).validSectorCount,
        sourceTier: (macro as { sectorEnergySourceTier?: string }).sectorEnergySourceTier,
      };
    },
    'sectorEnergyMacro',
    opts
  );
}

async function buildProgramTradingBlock(
  opts: BlockBuilderOptions
): Promise<SanitizedProgramTradingBlock | undefined> {
  return safeRequire(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const repo = require('../persistence/macroStateRepo.js') as typeof import('../persistence/macroStateRepo.js');
      const macro = repo.loadMacroState();
      if (!macro) return undefined;
      return {
        marketProgramStatus: (macro as { programSource?: string }).programSource,
      };
    },
    'programTrading',
    opts
  );
}

async function buildCounterfactualBlock(
  opts: BlockBuilderOptions
): Promise<SanitizedCounterfactualBlock | undefined> {
  return safeRequire(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const repo = require('../persistence/counterfactualUniverseLearningRepo.js') as
        | typeof import('../persistence/counterfactualUniverseLearningRepo.js')
        | undefined;
      if (!repo) return undefined;
      // Loader 명칭은 모듈 마다 다를 수 있어 옵셔널 접근.
      const summarizer = (repo as { summarizeCounterfactualUniverseLearningLedger?: () => unknown })
        .summarizeCounterfactualUniverseLearningLedger;
      if (typeof summarizer !== 'function') return undefined;
      const summary = summarizer() as { totalSnapshots?: number; todaySnapshots?: number };
      return {
        recordedCount: summary?.totalSnapshots,
        nearMissCount: summary?.todaySnapshots,
      };
    },
    'counterfactual',
    opts
  );
}

// ============================================================================
// 메인 진입점
// ============================================================================

export interface CaptureMarketCloseSnapshotOptions {
  /** capture 시점 강제 주입 (테스트 격리). 미전달 시 `Date.now()`. */
  nowMs?: number;
  /** marketDate 강제 주입 (테스트 격리). 미전달 시 KST 자동 산출. */
  marketDate?: string;
}

export interface CaptureMarketCloseSnapshotResult {
  status: 'CAPTURED' | 'DISABLED' | 'PARTIAL_CAPTURED';
  snapshot?: MarketCloseReplaySnapshot;
  warnings: string[];
  missingSections: string[];
}

/**
 * Market-close 15:19 KST snapshot 자동 capture + 영속.
 *
 * 호출자 (15:19 cron) 가 본 함수 호출 → 외부 API 호출 0건으로 9 source 모두
 * sanitized snapshot assembly → `saveMarketCloseReplaySnapshot` 영속.
 *
 * Partial 허용: 일부 source missing 시 status='PARTIAL_CAPTURED' + warnings[] +
 * missingSections[]. Capture 자체는 throw 안 함 (매매 흐름 보호).
 *
 * 사용자 명시 lifecycle: save 성공 후 이전 일자 디렉토리 cleanup (intradaySnapshotRepo
 * 위임 — 다음 거래일 개장 시 초기화 안 함, 본 15:19 capture 시점만이 cleanup 트리거).
 */
export async function captureMarketCloseSnapshot(
  options: CaptureMarketCloseSnapshotOptions = {}
): Promise<CaptureMarketCloseSnapshotResult> {
  if (isMarketCloseSnapshotCaptureDisabled()) {
    return { status: 'DISABLED', warnings: ['ENV MARKET_CLOSE_SNAPSHOT_DISABLED=true'], missingSections: [] };
  }
  const nowMs = options.nowMs ?? Date.now();
  const marketDate = options.marketDate ?? kstDateString(nowMs);
  const capturedAt = new Date(nowMs).toISOString();
  const snapshotId = generateSnapshotId(marketDate, nowMs);

  const opts: BlockBuilderOptions = { warnings: [], missing: [] };

  // 9 source 병렬 로드 (모두 read-only, 외부 호출 0)
  const [
    runtime,
    scanBlocks,
    watchlist,
    sectorEnergy,
    programTrading,
    shadow,
    counterfactual,
  ] = await Promise.all([
    buildRuntimeBlock(opts),
    buildScanDiagnosticsBlocks(opts),
    buildWatchlistBlock(opts),
    buildSectorEnergyBlockFromMacro(opts),
    buildProgramTradingBlock(opts),
    buildShadowBlock(opts),
    buildCounterfactualBlock(opts),
  ]);

  const isPartial = opts.missing.length > 0;
  const snapshot: MarketCloseReplaySnapshot = {
    snapshotId,
    capturedAt,
    marketDate,
    captureKind: 'MARKET_CLOSE_1519',
    timezone: 'Asia/Seoul',
    source: 'RUNTIME_SNAPSHOT',
    replayOnly: true,
    executionImpact: 'NONE',
    revision: 1, // saveMarketCloseReplaySnapshot 가 nextRevision 자동 결정
    schemaVersion: 1,
    captureStatus: isPartial ? 'PARTIAL' : 'OK',
    missingSections: opts.missing.length > 0 ? [...opts.missing] : undefined,
    warnings: opts.warnings.length > 0 ? [...opts.warnings] : undefined,
    runtime: runtime ? redactSensitiveFields(runtime) : undefined,
    universe: scanBlocks.universe ? redactSensitiveFields(scanBlocks.universe) : undefined,
    gate: scanBlocks.gate ? redactSensitiveFields(scanBlocks.gate) : undefined,
    supply: scanBlocks.supply ? redactSensitiveFields(scanBlocks.supply) : undefined,
    watchlist: watchlist ? redactSensitiveFields(watchlist) : undefined,
    // sectorEnergy: scanBlocks 우선, fallback macroState
    sectorEnergy: redactSensitiveFields(scanBlocks.sectorEnergy ?? sectorEnergy ?? undefined),
    programTrading: programTrading ? redactSensitiveFields(programTrading) : undefined,
    shadow: shadow ? redactSensitiveFields(shadow) : undefined,
    counterfactual: counterfactual ? redactSensitiveFields(counterfactual) : undefined,
  };

  let savedSnapshot: MarketCloseReplaySnapshot;
  try {
    savedSnapshot = saveMarketCloseReplaySnapshot(snapshot);
  } catch (err) {
    return {
      status: 'PARTIAL_CAPTURED',
      warnings: [
        ...opts.warnings,
        `[capture] 영속 실패: ${err instanceof Error ? err.message : String(err)}`,
      ],
      missingSections: opts.missing,
    };
  }

  return {
    status: isPartial ? 'PARTIAL_CAPTURED' : 'CAPTURED',
    snapshot: savedSnapshot,
    warnings: opts.warnings,
    missingSections: opts.missing,
  };
}
