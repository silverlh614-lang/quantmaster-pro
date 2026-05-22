/**
 * @responsibility ?ㅼ틪 吏곸쟾 留ㅽ겕濡쑣룹떆?ㅽ뀥 寃뚯씠????KIS쨌manual쨌regime쨌VIX쨌R6쨌FOMC쨌sellOnly ?먯젙
 *
 * ADR-0129: macroGateState 11 ?꾨뱶 ?⑹꽦 + persistScanResults propagate (signalScanner/index.ts ?몄텧??
 * ADR-0168: Kelly clamp SSOT (applyKellyClamp + KELLY_FLOOR) ??留ㅼ쭅 ?섎쾭 1.5 吏곸젒 ?ъ슜 湲덉?
 * ADR-0147b: signalScanner Phase 3 遺꾪빐 ??寃뚯씠?끒톝anity쨌sizing wiring ?⑥씪 ?꾩튂 (drift 李⑤떒)
 * ADR-0367: volumeClock abort??/scan_blockers 吏꾨떒 summary瑜??④릿??
 */

import { fetchAccountBalance } from '../../clients/kisClient.js';
import {
  getManualBlockNewBuy,
  getManualManageOnly,
  getEmergencyStop,
  getTradingMode,
  getMacroEntryOverrideState,
  type MacroEntryOverrideState,
  type MacroEntryOverrideTarget,
} from '../../state.js';
import { sendTelegramAlert } from '../../alerts/telegramClient.js';
import { defaultWarnTtlSec, emitOperationalWarn } from '../../observability/operationalWarn.js';
import { getGatingAlertSession } from '../../utils/gatingAlertWindow.js';
import { loadMacroState } from '../../persistence/macroStateRepo.js';
import { resolveRegimeSnapshot } from '../regime/regimeResolver.js';
import { REGIME_CONFIGS } from '../../../src/services/quant/regimeEngine.js';
import { loadWatchlist } from '../../persistence/watchlistRepo.js';
import {
  acknowledgeR3SanityBlock,
  isR3SanityAckTokenValid,
  loadR3SanityBlockState,
} from '../../persistence/r3SanityBlockRepo.js';
// ADR-0401: R3 Violation streak pre-scan check (SHADOW_ONLY ephemeral 李⑤떒).
import { getEffectiveR3ViolationStreak } from '../../persistence/r3ViolationStreakRepo.js';
import { getR3SanityProfile } from './r3SanityProfiles.js';
import { loadShadowTrades, saveShadowTrades } from '../../persistence/shadowTradeRepo.js';
import { computeShadowAccount } from '../../persistence/shadowAccountRepo.js';
import { loadTradingSettings } from '../../persistence/tradingSettingsRepo.js';
import { updateShadowResults } from '../exitEngine.js';
import { getVixGating } from '../vixGating.js';
import { getFomcProximity } from '../fomcCalendar.js';
import { isDataStarvedScan, getCompletenessSnapshot } from '../../screener/dataCompletenessTracker.js';
import { getKellyMultiplier as getIpsKellyMultiplier } from '../kellyDampener.js';
import { computeBiasPositionPenalty } from '../../learning/biasPositionPenalty.js';
import { computeSafetyGatePolicyFeedback } from '../../learning/safetyGatePolicyFeedback.js';
import { combineRegimeAndFomcKelly, describeRegimeFomcCombination } from '../regimeFomcCombiner.js';
import { computeSlotConsumption } from '../slotAccounting.js';
import { checkVolumeClockWindow } from '../volumeClock.js';
import { isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { evaluateR3CountableScan } from './r3StreakSkipPolicy.js';
import { loadConditionWeights, getConditionWeightsUpdatedAt } from '../../persistence/conditionWeightsRepo.js';
import { applyFreshnessDecayToNeutralWeightedRecord } from '../../learning/learningFreshnessGuard.js';
import { isOpenShadowStatus } from '../entryEngine.js';
import {
  formatPreScanSkippedLog,
  normalizeMacroRegime,
  resolveMarketSessionState,
  type EntryBlockReason,
  type ExecutionMode,
} from '../entryPolicySemantics.js';
import type { RunAutoSignalScanOptions } from './index.js';
import { buildMacroGateState } from './scanDiagnostics.js';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
import {
  captureSupplyHealthSnapshot,
  recordBlockedDayShadowScan,
  recordPreflightBlockedScan,
  recordPreflightUniverseLearningSnapshot,
} from './preflightLearningRecorder.js';
import { computeEffectiveKelly, formatKellyPolicyBlockedLog } from './kellyPolicyBlock.js';



type RegimeStatusSnapshot = {
  effectiveRegime: string;
  riskOverride: string;
  mhsBucket: string;
  liveBuyPolicy: string;
  shadowPolicy: string;
  tradeDate: string;
  snapshotId: string;
};

const regimeStatusByChannel = new Map<string, RegimeStatusSnapshot>();
function toMhsBucket(mhs: unknown): string {
  const n = Number(mhs);
  if (!Number.isFinite(n)) return 'MHS_NA';
  return `MHS_${Math.round(n / 10) * 10}`;
}
function buildRegimeAlertDedupKey(channelId: string, snap: RegimeStatusSnapshot): string {
  return `REGIME_STATUS:${snap.effectiveRegime}:${snap.riskOverride}:${snap.mhsBucket}:${snap.liveBuyPolicy}:${snap.shadowPolicy}:${snap.tradeDate}:${channelId}`;
}

export function getAccountScaleKellyMultiplier(totalAssets: number): number {
  if (totalAssets >= 300_000_000) return 1.15;
  if (totalAssets >= 100_000_000) return 1.08;
  if (totalAssets >= 50_000_000) return 1.0;
  return 0.92;
}

export function evaluateSellOnlyException(regimeConfig: any, macroState: any): any {
  const cfg = regimeConfig.sellOnlyException;
  if (!cfg?.enabled) return { allow: false, maxSlots: 0, kellyFactor: 1, minLiveGate: 0, minMtas: 0, reason: 'disabled' };
  
  if (macroState?.vix >= cfg.maxVix) {
    return { allow: false, maxSlots: 0, kellyFactor: 1, minLiveGate: 0, minMtas: 0, reason: `VIX ${macroState.vix} ??${cfg.maxVix}` };
  }
  
  return { 
    allow: true,
    maxSlots: cfg.maxSlots,
    kellyFactor: cfg.kellyFactor,
    minLiveGate: cfg.minLiveGate,
    minMtas: cfg.minMtas,
    reason: 'sectorAligned ?듦낵'
  };
}

function buildPreflightDiagnosticContext(input: {
  watchlist: WatchlistEntry[];
  shadows: any[];
  shadowMode: boolean;
  totalAssets: number;
  orderableCash: number;
  activeHoldingValue: number;
  macroState: any;
  regime: any;
  regimeConfig: any;
  conditionWeights: any;
  extra?: Record<string, unknown>;
}): any {
  return {
    watchlist: input.watchlist,
    shadows: input.shadows,
    shadowMode: input.shadowMode,
    totalAssets: input.totalAssets,
    orderableCash: input.orderableCash,
    activeHoldingValue: input.activeHoldingValue,
    macroState: input.macroState,
    regime: input.regime,
    regimeConfig: input.regimeConfig,
    conditionWeights: input.conditionWeights,
    ...(input.extra ?? {}),
  };
}

const MACRO_OVERRIDE_ALLOWED_SIGNALS = ['CONFIRMED_STRONG_BUY', 'STRONG_BUY'];
const DEFAULT_MACRO_DIAGNOSTIC_KELLY_FLOOR = 0.3;
const DEFAULT_MACRO_DIAGNOSTIC_MAX_POSITIONS_FLOOR = 1;

function isPostCloseObservationScan(options?: RunAutoSignalScanOptions): boolean {
  return options?.candidateScanTrigger === 'POST_CLOSE_OBSERVE';
}

function macroEntryOverrideApplies(
  override: MacroEntryOverrideState | null,
  target: MacroEntryOverrideTarget,
): override is MacroEntryOverrideState {
  return override?.targets.includes(target) === true;
}

function getMacroDiagnosticKellyFloor(): number {
  const parsed = Number(process.env.MACRO_DIAGNOSTIC_KELLY_FLOOR ?? DEFAULT_MACRO_DIAGNOSTIC_KELLY_FLOOR);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MACRO_DIAGNOSTIC_KELLY_FLOOR;
}

function getMacroDiagnosticMaxPositionsFloor(): number {
  const parsed = Number(
    process.env.MACRO_DIAGNOSTIC_MAX_POSITIONS_FLOOR ?? DEFAULT_MACRO_DIAGNOSTIC_MAX_POSITIONS_FLOOR,
  );
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MACRO_DIAGNOSTIC_MAX_POSITIONS_FLOOR;
}

function appendLiveEntryBlockReason(current: string | undefined, reason: string): string {
  if (!current) return reason;
  const parts = current.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.includes(reason) ? current : `${current},${reason}`;
}

function parseEntryBlockReasons(reason: string | undefined): EntryBlockReason[] {
  if (!reason) return [];
  const allowed = new Set<EntryBlockReason>([
    'POSITION_FULL',
    'SHADOW_ONLY',
    'OBSERVE_ONLY',
    'KRX_NON_TRADING_DAY',
    'MARKET_CLOSED',
    'PROVIDER_BLOCKING',
    'DATA_CONFIDENCE_LOW',
    'RISK_LIMIT',
  ]);
  return reason
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is EntryBlockReason => allowed.has(part as EntryBlockReason));
}

function resolvePreflightExecutionMode(input: {
  sellOnly: boolean;
  diagnosticLiveBlock: boolean;
}): ExecutionMode {
  if (input.diagnosticLiveBlock) return 'SHADOW_ONLY';
  return 'NORMAL';
}

function applyMacroDiagnosticRegimeConfig(regimeConfig: any): any {
  const caution = (REGIME_CONFIGS as any).R5_CAUTION ?? {};
  const gate2Ceiling = caution.gate2Required ?? 10;
  const gate3Ceiling = caution.gate3Required ?? 8;
  const allowedSignals = Array.isArray(regimeConfig?.allowedSignals) && regimeConfig.allowedSignals.length > 0
    ? regimeConfig.allowedSignals
    : [...MACRO_OVERRIDE_ALLOWED_SIGNALS];
  return {
    ...regimeConfig,
    gate2Required: Math.min(regimeConfig?.gate2Required ?? gate2Ceiling, gate2Ceiling),
    gate3Required: Math.min(regimeConfig?.gate3Required ?? gate3Ceiling, gate3Ceiling),
    kellyMultiplier: Math.max(regimeConfig?.kellyMultiplier ?? 0, getMacroDiagnosticKellyFloor()),
    maxPositions: Math.max(regimeConfig?.maxPositions ?? 0, getMacroDiagnosticMaxPositionsFloor()),
    allowedSignals,
    trancheStrategy: `${regimeConfig?.trancheStrategy ?? 'macro diagnostic'} | MACRO_DIAGNOSTIC_ONLY`,
  };
}

function applyMacroDiagnosticKellyFloor(value: number, active: boolean): number {
  if (!active) return value;
  return Math.max(value, getMacroDiagnosticKellyFloor());
}

function applyMacroEntryOverrideRegimeConfig(
  regimeConfig: any,
  override: MacroEntryOverrideState | null,
): any {
  if (!override) return regimeConfig;
  const caution = (REGIME_CONFIGS as any).R5_CAUTION ?? {};
  const gate2Ceiling = caution.gate2Required ?? 10;
  const gate3Ceiling = caution.gate3Required ?? 8;
  return {
    ...regimeConfig,
    gate2Required: Math.min(regimeConfig?.gate2Required ?? gate2Ceiling, gate2Ceiling),
    gate3Required: Math.min(regimeConfig?.gate3Required ?? gate3Ceiling, gate3Ceiling),
    kellyMultiplier: Math.max(regimeConfig?.kellyMultiplier ?? 0, override.kellyFloor),
    maxPositions: Math.max(regimeConfig?.maxPositions ?? 0, override.maxPositionsFloor),
    allowedSignals:
      Array.isArray(regimeConfig?.allowedSignals) && regimeConfig.allowedSignals.length > 0
        ? regimeConfig.allowedSignals
        : [...MACRO_OVERRIDE_ALLOWED_SIGNALS],
    trancheStrategy: `${regimeConfig?.trancheStrategy ?? 'operator macro override'} | OPERATOR_MACRO_ENTRY_OVERRIDE`,
  };
}

function applyMacroEntryOverrideKellyFloor(
  value: number,
  override: MacroEntryOverrideState | null,
  target: MacroEntryOverrideTarget,
): number {
  if (!macroEntryOverrideApplies(override, target)) return value;
  return Math.max(value, override.kellyFloor);
}

function formatMacroEntryOverrideLog(override: MacroEntryOverrideState): string {
  return `targets=${override.targets.join(',')} expiresAt=${override.expiresAt} reason=${override.reason}`;
}

function emitPreflightOperationalWarn(input: {
  code: string;
  domain?: 'REGIME' | 'DATA' | 'PROVIDER' | 'DIAGNOSTIC';
  message: string;
  dedupKey: string;
  executionImpact?: 'LIVE_ORDER_BLOCKED' | 'SCAN_GATE_DEGRADED' | 'NONE';
  details?: Record<string, unknown>;
}): void {
  emitOperationalWarn({
    priority: 'P1',
    domain: input.domain ?? 'REGIME',
    code: input.code,
    message: input.message,
    executionImpact: input.executionImpact ?? (input.domain === 'DATA' || input.domain === 'PROVIDER' ? 'NONE' : 'SCAN_GATE_DEGRADED'),
    mode: 'DEGRADED',
    dedupKey: input.dedupKey,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason: input.domain === 'DATA' || input.domain === 'PROVIDER'
        ? 'providerIssue=true marketSignal=false'
        : 'preflight gate changed runtime behavior',
      ...input.details,
    },
  });
}

export async function runPreflight(options?: RunAutoSignalScanOptions): Promise<any> {
  if (!process.env.KIS_APP_KEY) {
    emitPreflightOperationalWarn({
      code: 'P1_PREFLIGHT_KIS_CONFIG_MISSING',
      domain: 'PROVIDER',
      message: '[AutoTrade] KIS_APP_KEY missing; scan skipped',
      dedupKey: 'preflight:kis-config-missing',
      executionImpact: 'LIVE_ORDER_BLOCKED',
      details: { providerIssue: true, marketSignal: false },
    });
    await recordBlockedDayShadowScan('KIS_CONFIG_MISSING');
    let watchlistForLearning: WatchlistEntry[] = [];
    try {
      watchlistForLearning = loadWatchlist();
    } catch (e) {
      emitPreflightOperationalWarn({
        code: 'P1_MACRO_DATA_HEALTH_DEGRADED',
        domain: 'DATA',
        message: '[CounterfactualUniverseLearning] watchlist load failed for KIS config missing snapshot',
        dedupKey: 'preflight:kis-config-missing:watchlist-load-failed',
        details: { error: e instanceof Error ? e.message : String(e) },
      });
    }
    await recordPreflightUniverseLearningSnapshot({
      stage: 'BEFORE_UNIVERSE_BUILD',
      primaryReason: 'KIS_CONFIG_MISSING',
      watchlist: watchlistForLearning,
      marketSnapshot: {
        emergencyStop: getEmergencyStop(),
      },
      notes: ['KIS_APP_KEY missing ??real order preflight remains aborted; learning-only case recorded'],
    });
    return { shouldAbort: true, skipPersist: false };
  }

  const legacySellOnlyRequested = options?.sellOnly === true;
  let optSellOnly = false;
  const manualBlockNewBuy = getManualBlockNewBuy();
  const manualManageOnly = getManualManageOnly();
  if ((manualBlockNewBuy || manualManageOnly) && !optSellOnly) {
    const reason = manualManageOnly ? '蹂댁쑀留?愿由?紐⑤뱶' : '?좉퇋 留ㅼ닔 李⑤떒';
    emitPreflightOperationalWarn({
      code: 'P1_PREFLIGHT_MANUAL_GUARD_SELL_ONLY',
      domain: 'DIAGNOSTIC',
      message: '[AutoTrade] UI manual guard promoted preflight to sellOnly',
      dedupKey: `preflight:manual-guard:${reason}`,
      details: { guardReason: reason },
    });
    console.info(
      `[LEGACY_R6_SELLONLY_IGNORED] snapshotId=preflight marketSession=UNKNOWN displaySession=REGULAR ` +
      `inputEntryBlockMode=SELL_ONLY ignoredReasons=MANUAL_SELL_ONLY_IGNORED_BY_ROLLBACK ` +
      `liveBuyAllowed=true realOrderAllowed=true shadowSignalAllowed=true diagnosticAllowed=true ` +
      `counterfactualAllowed=true executionImpact='NONE' rollback='R6_SELLONLY_DISABLED'`,
    );
  }
  if (legacySellOnlyRequested) {
    console.info(
      `[LEGACY_R6_SELLONLY_IGNORED] snapshotId=preflight marketSession=UNKNOWN displaySession=REGULAR ` +
      `inputEntryBlockMode=SELL_ONLY ignoredReasons=SELL_ONLY_IGNORED_BY_ROLLBACK ` +
      `liveBuyAllowed=true realOrderAllowed=true shadowSignalAllowed=true diagnosticAllowed=true ` +
      `counterfactualAllowed=true executionImpact='NONE' rollback='R6_SELLONLY_DISABLED'`,
    );
  }

  const watchlist = loadWatchlist();
  if (watchlist.length === 0) {
    await recordPreflightUniverseLearningSnapshot({
      stage: 'BEFORE_UNIVERSE_BUILD',
      primaryReason: 'WATCHLIST_EMPTY',
      watchlist,
      marketSnapshot: {
        emergencyStop: getEmergencyStop(),
      },
      notes: ['watchlist empty ??pre-universe learning snapshot retained with zero candidates'],
    });
    await recordBlockedDayShadowScan('WATCHLIST_EMPTY');
    return { shouldAbort: true, skipPersist: false };
  }

  // ADR-0392 P0-B ??env 吏곸젒 李몄“ ??getTradingMode() SSOT ?듭씪.
  const shadowMode = getTradingMode() !== 'LIVE';
  const shadows = loadShadowTrades();
  let totalAssets: number;
  let orderableCash: number;
  let activeHoldingValue = 0;

  if (shadowMode) {
    const settings = loadTradingSettings();
    const startingCapital = Number(process.env.AUTO_TRADE_ASSETS || settings.startingCapital);
    const account = computeShadowAccount(shadows, startingCapital);
    totalAssets        = account.totalAssets;
    orderableCash      = Math.max(0, account.cashBalance);
    activeHoldingValue = account.totalInvested;
  } else {
    totalAssets = Number(process.env.AUTO_TRADE_ASSETS || 0);
    const balance = await fetchAccountBalance().catch(() => null);
    if (!totalAssets) totalAssets = balance ?? 30_000_000;
    orderableCash = balance ?? totalAssets;
  }
  
  if (shadowMode && activeHoldingValue === 0) {
    activeHoldingValue = shadows
      .filter((s) => isOpenShadowStatus(s.status))
      .reduce((sum, s) => sum + (s.shadowEntryPrice * s.quantity), 0);
  }

  let conditionWeights = loadConditionWeights();

  console.log(
    shadowMode
      ? `[AutoTrade] [SHADOW] virtual account ??equity=${totalAssets.toLocaleString()}??/ cash=${orderableCash.toLocaleString()}??/ holding=${activeHoldingValue.toLocaleString()}??/ mode=SHADOW`
      : `[AutoTrade] [LIVE] real account ??equity=${totalAssets.toLocaleString()}??/ orderable_cash=${orderableCash.toLocaleString()}??/ mode=LIVE`
  );

  const macroState = loadMacroState();
  const regimeSnapshot = resolveRegimeSnapshot({ macroState });
  const regimeDiagnostics = regimeSnapshot.diagnostics;
  const observedRegime = String(regimeSnapshot.effectiveRegime) as keyof typeof REGIME_CONFIGS;
  const observedRawRegime = String(regimeDiagnostics.rawRegime) as keyof typeof REGIME_CONFIGS;
  const defaultRollbackRegime = (Object.prototype.hasOwnProperty.call(REGIME_CONFIGS, 'R4_NEUTRAL')
    ? 'R4_NEUTRAL'
    : Object.keys(REGIME_CONFIGS).find((key) => key !== 'R6_DEFENSE')) as keyof typeof REGIME_CONFIGS;
  const rollbackRegime = observedRawRegime !== 'R6_DEFENSE' && Object.prototype.hasOwnProperty.call(REGIME_CONFIGS, observedRawRegime)
    ? observedRawRegime
    : defaultRollbackRegime;
  const regime = observedRegime === 'R6_DEFENSE' || !Object.prototype.hasOwnProperty.call(REGIME_CONFIGS, observedRegime)
    ? rollbackRegime
    : observedRegime;
  const legacyR6Detected =
    observedRegime === 'R6_DEFENSE' ||
    observedRawRegime === 'R6_DEFENSE' ||
    regimeSnapshot.detectedRegime === 'R6_DEFENSE' ||
    regimeSnapshot.riskOverride === 'R6_DEFENSE' ||
    regimeSnapshot.displayRegime === 'R6_DEFENSE';
  let regimeConfig = REGIME_CONFIGS[regime];
  const macroEntryOverride = getMacroEntryOverrideState();
  const r6EntryOverrideActive =
    legacyR6Detected && macroEntryOverrideApplies(macroEntryOverride, 'R6_DEFENSE');
  if (r6EntryOverrideActive) {
    emitPreflightOperationalWarn({
      code: 'P1_RISK_OVERRIDE_WITH_NON_R6',
      message: '[AutoTrade] legacy R6 entry override ignored by rollback',
      dedupKey: 'preflight:operator-macro-entry-override:r6',
      details: {
        override: formatMacroEntryOverrideLog(macroEntryOverride!),
        regimeSnapshotId: regimeSnapshot.snapshotId,
        executionImpact: 'NONE',
        rollback: 'R6_SELLONLY_DISABLED',
      },
    });
  }
  let liveEntryBlockedReason: string | undefined;
  let macroDiagnosticOnly = false;
  const markMacroDiagnosticLiveBlock = (reason: MacroEntryOverrideTarget) => {
    liveEntryBlockedReason = appendLiveEntryBlockReason(liveEntryBlockedReason, reason);
    macroDiagnosticOnly = true;
  };
  if (legacyR6Detected) {
    macroDiagnosticOnly = true;
    console.info(
      `[LEGACY_R6_SELLONLY_IGNORED] snapshotId=${String(regimeSnapshot.snapshotId ?? 'unknown')} marketSession=REGULAR displaySession=REGULAR ` +
      `inputEntryBlockMode=R6_DEFENSE ignoredReasons=R6_DEFENSE_IGNORED_BY_ROLLBACK ` +
      `liveBuyAllowed=true realOrderAllowed=true shadowSignalAllowed=true diagnosticAllowed=true ` +
      `counterfactualAllowed=true executionImpact='NONE' rollback='R6_SELLONLY_DISABLED'`,
    );
  }

  if (legacyR6Detected && r6EntryOverrideActive) {
    emitPreflightOperationalWarn({
      code: 'P1_RISK_OVERRIDE_WITH_NON_R6',
      message: '[AutoTrade] legacy R6 operator bypass ignored by rollback',
      dedupKey: 'preflight:r6-defense:operator-bypass',
      details: {
        kellyFloor: macroEntryOverride?.kellyFloor,
        maxPositionsFloor: macroEntryOverride?.maxPositionsFloor,
        regimeSnapshotId: regimeSnapshot.snapshotId,
        executionImpact: 'NONE',
        rollback: 'R6_SELLONLY_DISABLED',
      },
    });
  }
  const sellOnlyExc = { allow: false, maxSlots: 0, kellyFactor: 1, minLiveGate: 0, minMtas: 0, reason: 'R6_SELLONLY_DISABLED' };

  const vixGating = getVixGating(macroState?.vix, macroState?.vixHistory ?? []);
  const vixEntryOverrideActive = macroEntryOverrideApplies(macroEntryOverride, 'VIX_BLOCK');
  if (vixGating.noNewEntry && !vixEntryOverrideActive) {
    markMacroDiagnosticLiveBlock('VIX_BLOCK');
    emitPreflightOperationalWarn({
      code: 'P1_REGIME_CONFLICT',
      domain: 'REGIME',
      message: '[AutoTrade] VIX gating blocked new entries',
      dedupKey: `preflight:vix-block:${vixGating.reason}`,
      details: { vixReason: vixGating.reason, regimeSnapshotId: regimeSnapshot.snapshotId },
    });
    const session = getGatingAlertSession();
    if (session) {
      const kstDateStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await sendTelegramAlert(`?슚 <b>[VIX 寃뚯씠?? ?좉퇋 吏꾩엯 李⑤떒</b>\n${vixGating.reason}\n?ъ???紐⑤땲?곕쭅留??섑뻾?⑸땲??`, {
        dedupeKey: `vix_gating_block:${kstDateStr}:${session.toLowerCase()}`, cooldownMs: 12 * 60 * 60 * 1000,
      }).catch(console.error);
    }
    emitPreflightOperationalWarn({
      code: 'P1_REGIME_CONFLICT',
      domain: 'REGIME',
      message: '[AutoTrade] VIX_BLOCK diagnostic-only live block active; continuing scan diagnostics',
      dedupKey: 'preflight:vix-block:diagnostic-only',
      details: { regimeSnapshotId: regimeSnapshot.snapshotId },
    });
    await recordBlockedDayShadowScan('VIX_SPIKE');
  }
  if (vixGating.noNewEntry && vixEntryOverrideActive) {
    emitPreflightOperationalWarn({
      code: 'P1_RISK_OVERRIDE_WITH_NON_R6',
      domain: 'REGIME',
      message: '[AutoTrade] VIX no-new-entry bypassed by OPERATOR_MACRO_ENTRY_OVERRIDE',
      dedupKey: 'preflight:vix-block:operator-bypass',
      details: { override: formatMacroEntryOverrideLog(macroEntryOverride!) },
    });
  }

  const fomcProximity = getFomcProximity(
    macroState ? { mhs: macroState.mhs, regime: regime ?? macroState.regime, vkospi: macroState.vkospi } : undefined,
  );
  const fomcEntryOverrideActive = macroEntryOverrideApplies(macroEntryOverride, 'FOMC_BLOCK');
  if (fomcProximity.noNewEntry && !fomcEntryOverrideActive) {
    markMacroDiagnosticLiveBlock('FOMC_BLOCK');
    emitPreflightOperationalWarn({
      code: 'P1_REGIME_CONFLICT',
      domain: 'REGIME',
      message: '[AutoTrade] FOMC gating blocked new entries',
      dedupKey: `preflight:fomc-block:${fomcProximity.nextFomcDate ?? 'unknown'}`,
      details: { description: fomcProximity.description, regimeSnapshotId: regimeSnapshot.snapshotId },
    });
    const session = getGatingAlertSession();
    if (session) {
      await sendTelegramAlert(`?뱟 <b>[FOMC 寃뚯씠?? ?좉퇋 吏꾩엯 李⑤떒</b>\n${fomcProximity.description}\n?ъ???紐⑤땲?곕쭅留??섑뻾?⑸땲??`, {
        dedupeKey: `fomc_gating_block:${fomcProximity.nextFomcDate ?? 'unknown'}:${session.toLowerCase()}`, cooldownMs: 12 * 60 * 60 * 1000,
      }).catch(console.error);
    }
    emitPreflightOperationalWarn({
      code: 'P1_REGIME_CONFLICT',
      domain: 'REGIME',
      message: '[AutoTrade] FOMC_BLOCK diagnostic-only live block active; continuing scan diagnostics',
      dedupKey: 'preflight:fomc-block:diagnostic-only',
      details: { regimeSnapshotId: regimeSnapshot.snapshotId },
    });
    await recordBlockedDayShadowScan('FOMC_BLOCK');
  }
  if (fomcProximity.noNewEntry && fomcEntryOverrideActive) {
    emitPreflightOperationalWarn({
      code: 'P1_RISK_OVERRIDE_WITH_NON_R6',
      domain: 'REGIME',
      message: '[AutoTrade] FOMC no-new-entry bypassed by OPERATOR_MACRO_ENTRY_OVERRIDE',
      dedupKey: 'preflight:fomc-block:operator-bypass',
      details: { override: formatMacroEntryOverrideLog(macroEntryOverride!) },
    });
  }
  const diagnosticContext = (extra: Record<string, unknown> = {}) => ({
    shadowMode,
    totalAssets,
    orderableCash,
    activeHoldingValue,
    regime,
    regimeConfig,
    macroState,
    conditionWeights,
    shadows,
    watchlist,
    optSellOnly,
    macroDiagnosticOnly,
    liveEntryBlockedReason,
    macroEntryOverride,
    ...extra,
  });

  const r3SanityBlock = loadR3SanityBlockState();
  const r3SanityAckToken = process.env.R3_SANITY_ACK_TOKEN;
  if (r3SanityBlock.active && isR3SanityAckTokenValid(r3SanityBlock, r3SanityAckToken)) {
    acknowledgeR3SanityBlock('preflight_env_ack');
  } else if (r3SanityBlock.active) {
    emitPreflightOperationalWarn({
      code: 'P1_R3_SANITY_BLOCK_ACTIVE',
      domain: 'REGIME',
      message: '[AutoTrade] R3 sanity persistent block active',
      dedupKey: `preflight:r3-sanity-block:${r3SanityBlock.violation}:${r3SanityBlock.regime}`,
      details: {
        violation: r3SanityBlock.violation,
        regime: r3SanityBlock.regime,
        triggeredAt: r3SanityBlock.triggeredAt,
      },
    });
    await recordBlockedDayShadowScan('R3_SANITY_BLOCK');
    await recordPreflightBlockedScan(
      {
        stage: 'AFTER_UNIVERSE_BUILD',
        primaryReason: 'HARD_BLOCK',
        watchlist,
        regime,
        marketSnapshot: {
          emergencyStop: getEmergencyStop(),
          regime: regime ?? macroState?.regime,
          vkospiLevel: macroState?.vkospi,
        },
        notes: [
          `R3 sanity persistent block active: ${r3SanityBlock.violation} (${r3SanityBlock.regime})`,
        ],
      },
      {
        blockedBy: 'HARD_BLOCK',
        hardBlockSource: 'R3_SANITY_BLOCK',
        hardBlockModule: 'r3SanityBlockRepo',
        hardBlockReason: `${r3SanityBlock.violation} (${r3SanityBlock.regime})`,
        preflightDecision: 'ABORT_HARD_BLOCK',
      },
    );
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return {
      shouldAbort: true,
      skipPersist: true,
      context: diagnosticContext({ sellOnlyExc, vixGating, fomcProximity }),
    };
  }

  if (isDataStarvedScan()) {
    const snap = getCompletenessSnapshot();
    emitPreflightOperationalWarn({
      code: 'P1_MACRO_DATA_HEALTH_DEGRADED',
      domain: 'DATA',
      message: '[AutoTrade] data-starved scan blocked',
      dedupKey: 'preflight:data-starved-scan',
      details: {
        mtasFailRate: snap.mtasFailRate,
        dartNullRate: snap.dartNullRate,
        mtasAttempts: snap.mtasAttempts,
        dartAttempts: snap.dartAttempts,
      },
    });
    await sendTelegramAlert(`?㎦ <b>[?곗씠??鍮덇낀 ?ㅼ틪] ?좉퇋 吏꾩엯 蹂대쪟</b>\nMTAS ?ㅽ뙣 ${(snap.mtasFailRate * 100).toFixed(1)}% | DART null ${(snap.dartNullRate * 100).toFixed(1)}%\n?쒕낯: M${snap.mtasAttempts} 쨌 D${snap.dartAttempts}\n鍮??ㅼ틪怨?援щ텇?섎뒗 "?곗씠??遺?? ?곹깭 ???먯쿇 ?곗씠???먭? ??蹂듦?`, { priority: 'HIGH', dedupeKey: 'data-starved-scan', cooldownMs: 30 * 60_000 }).catch(console.error);
    await recordBlockedDayShadowScan('DATA_STARVED');
    // ADR-0433: data-starved preflight abort universe snapshot.
    // ADR-0367: buyListLoop 吏꾩엯 ??李⑤떒 ??preflightBlockedScanSummary ???곸냽.
    await recordPreflightBlockedScan(
      {
        stage: 'AFTER_UNIVERSE_BUILD',
        primaryReason: 'SCAN_ABORTED',
        watchlist,
        regime,
        marketSnapshot: {
          emergencyStop: getEmergencyStop(),
          regime: regime ?? macroState?.regime,
          vkospiLevel: macroState?.vkospi,
        },
        notes: [
          `data starved ??MTAS fail ${(snap.mtasFailRate * 100).toFixed(1)}% / DART null ${(snap.dartNullRate * 100).toFixed(1)}%`,
        ],
      },
      {
        blockedBy: 'PRE_FLIGHT_BLOCK',
        preflightDecision: 'ABORT_DATA_STARVED',
      },
    );
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, skipPersist: true, context: diagnosticContext({ vixGating, fomcProximity }) };
  }

  const volumeClock = checkVolumeClockWindow();
  const todayKstDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayIsKrxTradingDay = isKrxTradingDay(todayKstDate);
  const r3Countability = evaluateR3CountableScan({
    todayKstDate,
    isKrxTradingDay: todayIsKrxTradingDay,
    volumeClockAllowsEntry: true,
    emergencyStop: getEmergencyStop(),
    manualBlockNewBuy,
    manualManageOnly,
    sellOnlyMode: false,
    regime: regime ?? 'UNKNOWN',
    bearDefenseMode: false,
    vixGatingActive: vixGating.noNewEntry,
    fomcBlockActive: fomcProximity.noNewEntry,
    dataStarvedScan: false,
    frozenQuoteDataQuality: 'OK',
  });
  const resolvedMarketSessionState = resolveMarketSessionState({
    skipReason: r3Countability.skipReason,
    isKrxTradingDay: todayIsKrxTradingDay,
    volumeClockAllowsEntry: true,
  });

  const ipsKelly = getIpsKellyMultiplier();
  const accountKellyMultiplier = getAccountScaleKellyMultiplier(totalAssets);
  const biasPositionPenalty = computeBiasPositionPenalty();
  const biasMultiplier = biasPositionPenalty.multiplier;
  const safetyGatePolicyFeedback = computeSafetyGatePolicyFeedback();
  const safetyGateMultiplier = safetyGatePolicyFeedback.multiplier;
  const exceptionKellyFactor = 1;
  const vixDiagnosticOnly = vixGating.noNewEntry && !vixEntryOverrideActive;
  const fomcDiagnosticOnly = fomcProximity.noNewEntry && !fomcEntryOverrideActive;
  const effectiveVixKelly = applyMacroEntryOverrideKellyFloor(
    applyMacroDiagnosticKellyFloor(vixGating.kellyMultiplier, vixDiagnosticOnly),
    macroEntryOverride,
    'VIX_BLOCK',
  );
  const effectiveFomcKelly = applyMacroEntryOverrideKellyFloor(
    applyMacroDiagnosticKellyFloor(fomcProximity.kellyMultiplier, fomcDiagnosticOnly),
    macroEntryOverride,
    'FOMC_BLOCK',
  );
  const regimeFomcCombined = combineRegimeAndFomcKelly(regimeConfig.kellyMultiplier, effectiveFomcKelly, fomcProximity.phase, regime);
  
  const liveEntryAllowedForKelly =
    !liveEntryBlockedReason;
  const executionModeForKelly = resolvePreflightExecutionMode({
    sellOnly: false,
    diagnosticLiveBlock: Boolean(liveEntryBlockedReason),
  });
  const kellyResult = computeEffectiveKelly({
    baseKelly: regimeFomcCombined.value,
    vixMultiplier: effectiveVixKelly,
    ipsMultiplier: ipsKelly,
    exceptionKellyFactor,
    accountMultiplier: accountKellyMultiplier,
    biasMultiplier,
    safetyGateMultiplier,
    liveEntryAllowed: liveEntryAllowedForKelly,
    macroRegime: normalizeMacroRegime(regime),
    executionMode: executionModeForKelly,
    marketSessionState: resolvedMarketSessionState,
    blockReasons: parseEntryBlockReasons(liveEntryBlockedReason),
    executionImpact: 'NONE',
  });
  let rawKelly = kellyResult.rawKelly;
  let kellyMultiplier = kellyResult.effectiveKelly;
  
  if (ipsKelly < 1.0) console.log(`[AutoTrade] IPS 蹂怨?Kelly 媛먯뇿 ?곸슜 ??횞${ipsKelly.toFixed(2)}`);
  if (vixGating.kellyMultiplier < 1) console.log(`[AutoTrade] VIX 寃뚯씠???곸슜 ??${vixGating.reason}`);
  if (fomcProximity.kellyMultiplier !== 1) console.log(`[AutoTrade] FOMC 寃뚯씠???곸슜 ??${fomcProximity.description}`);
  if (biasMultiplier < 1) console.log(`[AutoTrade] learning bias position penalty applied ??x${biasMultiplier.toFixed(2)} (${biasPositionPenalty.reasons.join('; ')})`);
  if (safetyGatePolicyFeedback.active) console.log(`[AutoTrade] safety gate policy feedback applied ??x${safetyGateMultiplier.toFixed(2)} (${safetyGatePolicyFeedback.reasons.join('; ')})`);
  if (kellyResult.blockedByPolicy) {
    console.info(formatKellyPolicyBlockedLog({
      macroRegime: normalizeMacroRegime(regime),
      executionMode: executionModeForKelly,
      marketSessionState: resolvedMarketSessionState,
      liveEntryAllowed: false,
      shadowLearningAllowed: true,
      result: kellyResult,
    }));
  } else if (kellyMultiplier !== regimeConfig.kellyMultiplier) {
    console.log(
      `[AutoTrade] ${describeRegimeFomcCombination(regimeFomcCombined)} 횞 VIX(횞${effectiveVixKelly.toFixed(2)}) 횞 IPS(횞${ipsKelly.toFixed(2)}) 횞 怨꾩쥖(횞${accountKellyMultiplier.toFixed(2)}) = raw 횞${rawKelly.toFixed(3)}${kellyResult.floorApplied ? ' ??floor applied' : ''} ???좏슚 횞${kellyMultiplier.toFixed(2)}`,
    );
  }

  const MAX_CONVICTION_POSITIONS = Number(process.env.MAX_CONVICTION_POSITIONS ?? '10');
  const effectiveMaxPositions = Math.min(
    MAX_CONVICTION_POSITIONS,
    regimeConfig.maxPositions,
  );
  
  const slotResult = computeSlotConsumption(shadows, effectiveMaxPositions);
  const liveEntryBlockReason = slotResult.isFull
    ? appendLiveEntryBlockReason(liveEntryBlockedReason, 'POSITION_FULL')
    : liveEntryBlockedReason;
  const diagnosticOnlyLiveBlock = Boolean(liveEntryBlockReason);
  if (slotResult.isFull && kellyMultiplier !== 0) {
    const positionFullKellyResult = computeEffectiveKelly({
      baseKelly: regimeFomcCombined.value,
      vixMultiplier: effectiveVixKelly,
      ipsMultiplier: ipsKelly,
      exceptionKellyFactor,
      accountMultiplier: accountKellyMultiplier,
      biasMultiplier,
      safetyGateMultiplier,
      liveEntryAllowed: false,
      macroRegime: normalizeMacroRegime(regime),
      executionMode: executionModeForKelly,
      marketSessionState: resolvedMarketSessionState,
      positionFull: true,
      blockReasons: parseEntryBlockReasons(liveEntryBlockReason),
      executionImpact: 'NONE',
    });
    rawKelly = positionFullKellyResult.rawKelly;
    kellyMultiplier = positionFullKellyResult.effectiveKelly;
    console.info(formatKellyPolicyBlockedLog({
      macroRegime: normalizeMacroRegime(regime),
      executionMode: executionModeForKelly,
      marketSessionState: resolvedMarketSessionState,
      liveEntryAllowed: false,
      shadowLearningAllowed: true,
      result: positionFullKellyResult,
    }));
  }
  if (slotResult.isFull && process.env.POSITION_FULL_PREFLIGHT_ABORT !== 'true') {
    console.log(`[AutoTrade] POSITION_FULL live entry blocked, diagnostic buyList/gate loop kept (${slotResult.consumed.toFixed(2)}/${effectiveMaxPositions}, regime=${regime}, raw=${slotResult.rawCount})`);
    await recordBlockedDayShadowScan('POSITION_FULL');
  }

  if (slotResult.isFull && process.env.POSITION_FULL_PREFLIGHT_ABORT === 'true' && !shadowMode) {
    console.log(`[AutoTrade] maximum positions reached (${slotResult.consumed.toFixed(2)}/${effectiveMaxPositions}, regime=${regime}, raw=${slotResult.rawCount}) - live entry skipped`);
    await recordBlockedDayShadowScan('POSITION_FULL');
    // ADR-0367: buyListLoop 吏꾩엯 ??李⑤떒 ??preflightBlockedScanSummary ???곸냽.
    await recordPreflightBlockedScan(
      {
        stage: 'BEFORE_BUYLIST_LOOP',
        primaryReason: 'POSITION_FULL',
        watchlist,
        regime,
        marketSnapshot: {
          emergencyStop: getEmergencyStop(),
          regime: regime ?? macroState?.regime,
          vkospiLevel: macroState?.vkospi,
        },
        notes: [`position slots full ??consumed=${slotResult.consumed.toFixed(2)}/${effectiveMaxPositions}, raw=${slotResult.rawCount}`],
      },
      {
        blockedBy: 'NO_BUYLIST_ELIGIBLE',
        preflightDecision: 'ABORT_POSITION_FULL',
      },
    );
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return {
      shouldAbort: true,
      skipPersist: true,
      positionFull: true,
      context: diagnosticContext({ sellOnlyExc, vixGating, fomcProximity, kellyMultiplier }),
    };
  }

  const macroGateState = buildMacroGateState({
    emergencyStop: getEmergencyStop(),
    autoTradeEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
    regime: regime ?? 'UNKNOWN',
    regimeKelly: regimeConfig.kellyMultiplier,
    fomcPhase: fomcProximity.phase,
    fomcKelly: effectiveFomcKelly,
    finalKelly: kellyMultiplier,
    vixGatingActive: vixGating.noNewEntry,
    bearDefenseMode: false,
    mhsBelow30: (macroState?.mhs ?? 100) < 30,
    watchlistEmpty: watchlist.length === 0,
    sellOnlyMode: false,
    macroEntryOverrideActive: macroEntryOverride !== null,
    macroEntryOverrideTargets: macroEntryOverride?.targets,
    diagnosticLiveEntryBlocked: diagnosticOnlyLiveBlock,
    liveEntryBlockedReason: liveEntryBlockReason,
    macroRegimeRaw: regimeDiagnostics.rawRegime,
    macroRegimeEffective: legacyR6Detected ? regime : regimeDiagnostics.effectiveRegime,
    regimeSnapshotId: regimeSnapshot.snapshotId,
    regimeSnapshotAsOf: regimeSnapshot.asOf,
    regimeSnapshotTtlSec: regimeSnapshot.ttlSec,
    displayRegime: regimeSnapshot.displayRegime === 'R6_DEFENSE' || regimeSnapshot.displayRegime === 'SELL_ONLY'
      ? regimeDiagnostics.rawRegime
      : regimeSnapshot.displayRegime,
    riskOverride: regimeSnapshot.riskOverride === 'R6_DEFENSE' || regimeSnapshot.riskOverride === 'SELL_ONLY'
      ? 'NONE'
      : regimeSnapshot.riskOverride,
    engineMode: regimeSnapshot.engineMode === 'SELL_ONLY'
      ? 'NORMAL'
      : regimeSnapshot.engineMode,
    sourceHealth: regimeSnapshot.sourceHealth,
    regimeConflicts: regimeSnapshot.conflicts,
    r6RecoveryStatus: regimeDiagnostics.r6RecoveryStatus,
    activeR6Triggers: regimeDiagnostics.activeR6Triggers,
    r6ShockLatch: regimeDiagnostics.r6ShockLatch,
    recoveryBlockedReason: regimeDiagnostics.recoveryBlockedReason,
    liveEntryAllowed: !diagnosticOnlyLiveBlock,
    liveExitAllowed: true,
    shadowBuyAllowed: true,
    shadowSellAllowed: true,
    shadowLearningAllowed: true,
    counterfactualAllowed: true,
    diagnosticAllowed: true,
    brokerOrderAllowed: !diagnosticOnlyLiveBlock,
  });

  const keepPostCloseObservationAlive =
    isPostCloseObservationScan(options) && macroDiagnosticOnly;

  if (!volumeClock.allowEntry && !shadowMode) {
    console.info(
      `[LEGACY_R6_SELLONLY_IGNORED] snapshotId=${String(regimeSnapshot.snapshotId ?? 'unknown')} marketSession=AFTERMARKET displaySession=REGULAR ` +
      `inputEntryBlockMode=SELL_ONLY ignoredReasons=AFTERMARKET_BUY_BLOCK_IGNORED_BY_ROLLBACK ` +
      `liveBuyAllowed=true realOrderAllowed=true shadowSignalAllowed=true diagnosticAllowed=true ` +
      `counterfactualAllowed=true executionImpact='NONE' rollback='R6_SELLONLY_DISABLED'`,
    );
    console.info(
      `[AutoTrade] volumeClock observation only; Gate/data diagnostics continue (${volumeClock.reason}, postCloseObservation=${keepPostCloseObservationAlive})`,
    );
  }
  if (!volumeClock.allowEntry && shadowMode) {
    console.log(`[AutoTrade] volumeClock observation SHADOW - Shadow learning continues (${volumeClock.reason})`);
  }

  if (volumeClock.scoreBonus !== 0) {
    console.log(volumeClock.reason);
  }

  // ADR-0419: SHADOW_ONLY ephemeral 李⑤떒 ??R6/VIX/FOMC ?곹깭?먯꽌??吏꾨떒 猷⑦봽???좎??쒕떎.
  //   evaluateR3CountableScan ? ?대윴 嫄곗떆 李⑤떒?쇱쓣 R3 streak ?꾩쟻?먯꽌 ?쒖쇅?섎뒗 ?덉쟾留앹씠??
  // ADR-0401: ?곸냽 latch ? 臾닿?, streak repo ??24h decay 濡??먯뿰 ?뚮났.
  // HARD_BLOCK latch (?곸냽, ADR-0120) ???쇱씤 ~173 ?먯꽌 ?대? 泥섎━??(?덈? ?먯튃 #11/12 ???먮룞 ?댁젣 0).
  if (r3Countability.countable) {
    const effectiveStreak = getEffectiveR3ViolationStreak();
    if (effectiveStreak.violation === 'GATE1_PASS_ZERO' && effectiveStreak.consecutiveCount > 0) {
      const profile = getR3SanityProfile(effectiveStreak.regime);
      if (effectiveStreak.consecutiveCount >= profile.shadowOnlyAt) {
        emitPreflightOperationalWarn({
          code: 'P1_REGIME_CONFLICT',
          domain: 'REGIME',
          message: '[AutoTrade] R3 SHADOW_ONLY ephemeral block active',
          dedupKey: `preflight:r3-shadow-only:${effectiveStreak.violation}:${effectiveStreak.regime}:${effectiveStreak.consecutiveCount}`,
          details: {
            streak: `${effectiveStreak.consecutiveCount}/${profile.shadowOnlyAt}`,
            violation: effectiveStreak.violation,
            regime: effectiveStreak.regime,
          },
        });
        await sendTelegramAlert(
          `?ワ툘 <b>[R3 Sanity ??SHADOW_ONLY pre-scan]</b>\n` +
          `吏곸쟾 ?ㅼ틪 ?꾩쟻 ${effectiveStreak.consecutiveCount}??(?꾧퀎 ${profile.shadowOnlyAt}) ??` +
          `?좉퇋 吏꾩엯 李⑤떒 + shadow learning ?좎?.\n` +
          `<i>?ㅼ쓬 ?뺤긽 ?ㅼ틪 (?꾨컲 NONE ?먮뒗 24h decay) ???먮룞 ?뚮났 ???곸냽 latch ?놁쓬 (ADR-0401).</i>`,
          {
            priority: 'HIGH',
            dedupeKey: `r3_sanity_shadow_only_pre:${effectiveStreak.regime}:${effectiveStreak.consecutiveCount}`,
            cooldownMs: 6 * 60 * 60_000,
          },
        ).catch(console.error);
        await recordBlockedDayShadowScan('R3_SANITY_BLOCK');
        // ADR-0433: R3 SHADOW_ONLY ephemeral preflight abort universe snapshot.
        // ADR-0367: buyListLoop 吏꾩엯 ??李⑤떒 ??preflightBlockedScanSummary ???곸냽.
        await recordPreflightBlockedScan(
          {
            stage: 'BEFORE_BUYLIST_LOOP',
            primaryReason: 'HARD_BLOCK',
            watchlist,
            regime,
            marketSnapshot: {
              emergencyStop: getEmergencyStop(),
              regime: regime ?? macroState?.regime,
              vkospiLevel: macroState?.vkospi,
            },
            notes: [
              `R3 SHADOW_ONLY ephemeral ??streak=${effectiveStreak.consecutiveCount}/${profile.shadowOnlyAt} (${effectiveStreak.violation}, ${effectiveStreak.regime})`,
            ],
          },
          {
            blockedBy: 'HARD_BLOCK',
            hardBlockSource: 'R3_VIOLATION_STREAK',
            hardBlockModule: 'r3ViolationStreakRepo',
            hardBlockReason: `${effectiveStreak.violation} streak=${effectiveStreak.consecutiveCount}/${profile.shadowOnlyAt} (${effectiveStreak.regime})`,
            preflightDecision: 'ABORT_SHADOW_ONLY_EPHEMERAL',
          },
        );
        await updateShadowResults(shadows, regime);
        saveShadowTrades(shadows);
        return {
          shouldAbort: true,
          skipPersist: true,
          context: diagnosticContext({ sellOnlyExc, vixGating, fomcProximity, kellyMultiplier, volumeClock, macroGateState }),
        };
      }
    }
  } else {
    // ADR-0419: 鍮꾩젙??而⑦뀓?ㅽ듃 ??SHADOW_ONLY pre-scan ?먯껜 李⑤떒 (?ъ슜??紐낆떆 ?덈? ?먯튃).
    // R6/VIX/FOMC 吏꾨떒?쇱? buyList/gate 吏꾨떒??怨꾩냽?섎릺 R3 streak ?곗젙?먯꽌 ?쒖쇅?쒕떎.
    console.info(formatPreScanSkippedLog({
      macroRegime: normalizeMacroRegime(regime ?? macroState?.regime ?? 'R2_NEUTRAL'),
      executionMode: 'SHADOW_ONLY',
      marketSessionState: resolvedMarketSessionState,
      reason: r3Countability.skipReason ?? 'unknown',
      liveEntryAllowed: false,
      shadowLearningAllowed: true,
      executionImpact: 'NONE',
    }));
  }

  const supplyHealthSnapshot = await captureSupplyHealthSnapshot();

  return {
    shouldAbort: false,
    macroGateState,
    context: {
      shadowMode,
      totalAssets,
      orderableCash,
      activeHoldingValue,
      effectiveMaxPositions,
      regime,
      regimeConfig,
      macroState,
      vixGating,
      fomcProximity,
      kellyMultiplier,
      effectiveVixKelly,
      effectiveFomcKelly,
      accountKellyMultiplier,
      macroEntryOverride,
      sellOnlyExc,
      volumeClock,
      resolvedMarketSessionState,
      conditionWeights,
      supplyHealthSnapshot,
      shadows,
      watchlist,
      optSellOnly,
      positionFullDiagnosticOnly: slotResult.isFull,
      macroDiagnosticOnly,
      diagnosticOnlyLiveBlock,
      liveEntryBlockedReason: liveEntryBlockReason,
      positionSlotDiagnostic: slotResult.isFull
        ? {
            consumed: slotResult.consumed,
            rawCount: slotResult.rawCount,
            effectiveMaxPositions,
          }
        : undefined,
    },
  };
}
