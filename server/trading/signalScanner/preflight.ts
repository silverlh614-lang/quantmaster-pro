/**
 * @responsibility 스캔 직전 매크로·시스템 게이트 — KIS·manual·regime·VIX·R6·FOMC·sellOnly 판정
 *
 * ADR-0129: macroGateState 11 필드 합성 + persistScanResults propagate (signalScanner/index.ts 호출자)
 * ADR-0168: Kelly clamp SSOT (applyKellyClamp + KELLY_FLOOR) — 매직 넘버 1.5 직접 사용 금지
 * ADR-0147b: signalScanner Phase 3 분해 후 게이팅·sanity·sizing wiring 단일 위치 (drift 차단)
 * ADR-0367: volumeClock abort도 /scan_blockers 진단 summary를 남긴다.
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
import { sendTelegramAlert, escapeHtml } from '../../alerts/telegramClient.js';
import { getGatingAlertSession } from '../../utils/gatingAlertWindow.js';
import { loadMacroState } from '../../persistence/macroStateRepo.js';
import { getLiveRegime } from '../regimeBridge.js';
import { REGIME_CONFIGS } from '../../../src/services/quant/regimeEngine.js';
import { loadWatchlist } from '../../persistence/watchlistRepo.js';
import {
  acknowledgeR3SanityBlock,
  isR3SanityAckTokenValid,
  loadR3SanityBlockState,
} from '../../persistence/r3SanityBlockRepo.js';
// ADR-0401: R3 Violation streak pre-scan check (SHADOW_ONLY ephemeral 차단).
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
    return { allow: false, maxSlots: 0, kellyFactor: 1, minLiveGate: 0, minMtas: 0, reason: `VIX ${macroState.vix} ≥ ${cfg.maxVix}` };
  }
  
  return { 
    allow: true, 
    maxSlots: cfg.maxSlots, 
    kellyFactor: cfg.kellyFactor, 
    minLiveGate: cfg.minLiveGate, 
    minMtas: cfg.minMtas, 
    reason: 'sectorAligned 통과' 
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
    'R6_DEFENSE',
    'POSITION_FULL',
    'SELL_ONLY',
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
  if (input.sellOnly) return 'SELL_ONLY';
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

export async function runPreflight(options?: RunAutoSignalScanOptions): Promise<any> {
  if (!process.env.KIS_APP_KEY) {
    console.warn('[AutoTrade] KIS_APP_KEY 미설정 — 스캔 건너뜀');
    await recordBlockedDayShadowScan('KIS_CONFIG_MISSING');
    let watchlistForLearning: WatchlistEntry[] = [];
    try {
      watchlistForLearning = loadWatchlist();
    } catch (e) {
      console.warn('[CounterfactualUniverseLearning] KIS 설정 누락 snapshot용 watchlist 로드 실패 — 빈 universe로 기록', e);
    }
    await recordPreflightUniverseLearningSnapshot({
      stage: 'BEFORE_UNIVERSE_BUILD',
      primaryReason: 'KIS_CONFIG_MISSING',
      watchlist: watchlistForLearning,
      marketSnapshot: {
        emergencyStop: getEmergencyStop(),
      },
      notes: ['KIS_APP_KEY missing — real order preflight remains aborted; learning-only case recorded'],
    });
    return { shouldAbort: true, skipPersist: false };
  }

  let optSellOnly = options?.sellOnly;
  const manualBlockNewBuy = getManualBlockNewBuy();
  const manualManageOnly = getManualManageOnly();
  if ((manualBlockNewBuy || manualManageOnly) && !optSellOnly) {
    const reason = manualManageOnly ? '보유만 관리 모드' : '신규 매수 차단';
    console.warn(`[AutoTrade] UI 수동 가드 활성 (${reason}) — sellOnly 로 승격`);
    optSellOnly = true;
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
      notes: ['watchlist empty — pre-universe learning snapshot retained with zero candidates'],
    });
    await recordBlockedDayShadowScan('WATCHLIST_EMPTY');
    return { shouldAbort: true, skipPersist: false };
  }

  // ADR-0392 P0-B — env 직접 참조 → getTradingMode() SSOT 통일.
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
      ? `[AutoTrade] [SHADOW] virtual account — equity=${totalAssets.toLocaleString()}원 / cash=${orderableCash.toLocaleString()}원 / holding=${activeHoldingValue.toLocaleString()}원 / mode=SHADOW`
      : `[AutoTrade] [LIVE] real account — equity=${totalAssets.toLocaleString()}원 / orderable_cash=${orderableCash.toLocaleString()}원 / mode=LIVE`
  );

  const macroState = loadMacroState();
  const regime      = getLiveRegime(macroState);
  let regimeConfig = REGIME_CONFIGS[regime];
  const macroEntryOverride = getMacroEntryOverrideState();
  const r6EntryOverrideActive =
    regime === 'R6_DEFENSE' && macroEntryOverrideApplies(macroEntryOverride, 'R6_DEFENSE');
  if (r6EntryOverrideActive) {
    regimeConfig = applyMacroEntryOverrideRegimeConfig(regimeConfig, macroEntryOverride!);
    console.warn(
      `[AutoTrade] OPERATOR_MACRO_ENTRY_OVERRIDE applied for R6_DEFENSE — ${formatMacroEntryOverrideLog(macroEntryOverride!)}`,
    );
    await sendTelegramAlert(
      `⚠️ <b>[Operator Macro Entry Override]</b>\n` +
      `R6_DEFENSE 신규 진입 차단을 운영자 명령으로 우회합니다.\n` +
      `expiresAt: <code>${macroEntryOverride!.expiresAt}</code>\n` +
      `reason: <code>${escapeHtml(macroEntryOverride!.reason)}</code>`,
      { priority: 'HIGH', dedupeKey: 'operator_macro_entry_override:r6', cooldownMs: 30 * 60_000 },
    ).catch(console.error);
  }
  let liveEntryBlockedReason: string | undefined;
  let macroDiagnosticOnly = false;
  const markMacroDiagnosticLiveBlock = (reason: MacroEntryOverrideTarget) => {
    liveEntryBlockedReason = appendLiveEntryBlockReason(liveEntryBlockedReason, reason);
    macroDiagnosticOnly = true;
  };
  if (regime === 'R6_DEFENSE' && !r6EntryOverrideActive) {
    markMacroDiagnosticLiveBlock('R6_DEFENSE');
    regimeConfig = applyMacroDiagnosticRegimeConfig(regimeConfig);
  }
  conditionWeights = applyFreshnessDecayToNeutralWeightedRecord(
    conditionWeights,
    { generatedAt: getConditionWeightsUpdatedAt() ?? undefined, regime },
    regime,
  );
  const diagnosticContext = (extra: Record<string, unknown> = {}) =>
    buildPreflightDiagnosticContext({
      watchlist,
      shadows,
      shadowMode,
      totalAssets,
      orderableCash,
      activeHoldingValue,
      macroState,
      regime,
      regimeConfig,
      conditionWeights,
      extra: {
        macroEntryOverride,
        ...extra,
      },
    });

  const r3SanityBlock = loadR3SanityBlockState();
  if (r3SanityBlock.active) {
    if (isR3SanityAckTokenValid(r3SanityBlock, process.env.R3_SANITY_OPERATOR_ACK)) {
      acknowledgeR3SanityBlock('R3_SANITY_OPERATOR_ACK');
    } else {
      console.warn(`[AutoTrade] R3 sanity block active — 신규 매수 차단 (${r3SanityBlock.violation}, ${r3SanityBlock.regime})`);
      await sendTelegramAlert(
        `🚨 <b>[R3 Sanity Block Active]</b>\n신규 매수 차단 + shadow-only 전환 유지\n위반: ${r3SanityBlock.violation} / ${r3SanityBlock.regime}\n` +
        `즉시 해제: <code>/r3_unblock</code> (텔레그램, ADR-0195)\n` +
        `또는 ENV <code>R3_SANITY_OPERATOR_ACK=${r3SanityBlock.triggeredAt}</code> (ADR-0120)`,
        { priority: 'HIGH', dedupeKey: 'r3_sanity_block_active', cooldownMs: 24 * 60 * 60_000 },
      ).catch(console.error);
      await recordBlockedDayShadowScan('R3_SANITY_BLOCK');
      // ADR-0433: preflight abort 시 universe-level learning snapshot 영속 (HARD_BLOCK).
      // ADR-0367: buyListLoop 진입 전 차단 — preflightBlockedScanSummary 도 영속.
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
          notes: [`R3 sanity latch active — ${r3SanityBlock.violation}`],
        },
        {
          blockedBy: 'HARD_BLOCK',
          hardBlockSource: 'R3_SANITY_LATCH',
          hardBlockModule: 'r3SanityBlockRepo',
          hardBlockReason: `${r3SanityBlock.violation} (${r3SanityBlock.regime})`,
          preflightDecision: 'ABORT_HARD_BLOCK',
        },
      );
      await updateShadowResults(shadows, regime);
      saveShadowTrades(shadows);
      return { shouldAbort: true, skipPersist: true, context: diagnosticContext() };
    }
  }

  // ADR-0419: SHADOW_ONLY pre-scan 발화는 *정상 거래일에 GATE1_PASS_ZERO 가 누적될 때만* 의미가 있으므로
  // R6/VIX/FOMC 는 liveEntryBlockedReason 으로 실진입만 막고 진단 루프는 계속 살린다.
  // SELL_ONLY / VolumeClock closed / 데이터 빈곤은 여전히 preflight abort 로 별도 학습 snapshot 을 남긴다.
  // 추가 belt-and-suspenders 가드는 라인 ~360 의 evaluateR3CountableScan 호출.
  // HARD_BLOCK latch (영속, ADR-0120) 는 위 분기에서 이미 처리됨 (절대 원칙 #11/12 — 자동 해제 0).

  const sellOnlyExc = optSellOnly
    ? evaluateSellOnlyException(regimeConfig, macroState)
    : { allow: false, maxSlots: 0, kellyFactor: 1, minLiveGate: 0, minMtas: 0, reason: 'not-sellOnly' };
    
  if (optSellOnly && !sellOnlyExc.allow) {
    console.log(`[AutoTrade] SELL_ONLY 모드 — 포지션 모니터링 전용 (예외 불가: ${sellOnlyExc.reason})`);
    await recordBlockedDayShadowScan('MANUAL_BLOCK');
    // ADR-0433: SELL_ONLY preflight abort universe snapshot.
    // ADR-0367: buyListLoop 진입 전 차단 — preflightBlockedScanSummary 도 영속.
    await recordPreflightBlockedScan(
      {
        stage: 'AFTER_UNIVERSE_BUILD',
        primaryReason: 'SELL_ONLY',
        watchlist,
        regime,
        marketSnapshot: {
          sellOnly: true,
          emergencyStop: getEmergencyStop(),
          regime: regime ?? macroState?.regime,
          vkospiLevel: macroState?.vkospi,
        },
        notes: [`SELL_ONLY 예외 불가: ${sellOnlyExc.reason}`],
      },
      {
        blockedBy: 'SELL_ONLY',
        preflightDecision: 'ABORT_SELL_ONLY',
      },
    );
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, skipPersist: true, context: diagnosticContext({ sellOnlyExc }) };
  }
  if (optSellOnly && sellOnlyExc.allow) {
    console.log(`[AutoTrade] SELL_ONLY 예외 채널 활성 — ${sellOnlyExc.reason} | maxSlots=${sellOnlyExc.maxSlots}, Kelly×${sellOnlyExc.kellyFactor}, Gate≥${sellOnlyExc.minLiveGate}, MTAS≥${sellOnlyExc.minMtas}`);
  }

  if (regime === 'R6_DEFENSE' && !r6EntryOverrideActive) {
    await sendTelegramAlert(`🔴 <b>[R6_DEFENSE] 신규 진입 전면 차단</b>\nMHS: ${macroState?.mhs ?? 'N/A'} | 블랙스완 감지 — 기존 포지션 모니터링만 수행`).catch(console.error);
    console.warn(`[AutoTrade] R6_DEFENSE (MHS=${macroState?.mhs}) — 신규 진입 전면 차단`);
    console.warn(`[AutoTrade] R6_DEFENSE diagnostic-only live block active; continuing scan diagnostics`);
    await recordBlockedDayShadowScan('RISK_OFF_REGIME');
  }
  if (regime === 'R6_DEFENSE' && r6EntryOverrideActive) {
    console.warn(
      `[AutoTrade] R6_DEFENSE no-new-entry bypassed by OPERATOR_MACRO_ENTRY_OVERRIDE — ` +
      `kellyFloor=${macroEntryOverride?.kellyFloor}, maxPositionsFloor=${macroEntryOverride?.maxPositionsFloor}`,
    );
  }

  const vixGating = getVixGating(macroState?.vix, macroState?.vixHistory ?? []);
  const vixEntryOverrideActive = macroEntryOverrideApplies(macroEntryOverride, 'VIX_BLOCK');
  if (vixGating.noNewEntry && !vixEntryOverrideActive) {
    markMacroDiagnosticLiveBlock('VIX_BLOCK');
    console.warn(`[AutoTrade] VIX 게이팅 — 신규 진입 중단: ${vixGating.reason}`);
    const session = getGatingAlertSession();
    if (session) {
      const kstDateStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await sendTelegramAlert(`🚨 <b>[VIX 게이팅] 신규 진입 차단</b>\n${vixGating.reason}\n포지션 모니터링만 수행합니다.`, {
        dedupeKey: `vix_gating_block:${kstDateStr}:${session.toLowerCase()}`, cooldownMs: 12 * 60 * 60 * 1000,
      }).catch(console.error);
    }
    console.warn(`[AutoTrade] VIX_BLOCK diagnostic-only live block active; continuing scan diagnostics`);
    await recordBlockedDayShadowScan('VIX_SPIKE');
  }
  if (vixGating.noNewEntry && vixEntryOverrideActive) {
    console.warn(
      `[AutoTrade] VIX no-new-entry bypassed by OPERATOR_MACRO_ENTRY_OVERRIDE — ` +
      `${formatMacroEntryOverrideLog(macroEntryOverride!)}`,
    );
  }

  const fomcProximity = getFomcProximity(
    macroState ? { mhs: macroState.mhs, regime: regime ?? macroState.regime, vkospi: macroState.vkospi } : undefined,
  );
  const fomcEntryOverrideActive = macroEntryOverrideApplies(macroEntryOverride, 'FOMC_BLOCK');
  if (fomcProximity.noNewEntry && !fomcEntryOverrideActive) {
    markMacroDiagnosticLiveBlock('FOMC_BLOCK');
    console.warn(`[AutoTrade] FOMC 게이팅 — 신규 진입 차단: ${fomcProximity.description}`);
    const session = getGatingAlertSession();
    if (session) {
      await sendTelegramAlert(`📅 <b>[FOMC 게이팅] 신규 진입 차단</b>\n${fomcProximity.description}\n포지션 모니터링만 수행합니다.`, {
        dedupeKey: `fomc_gating_block:${fomcProximity.nextFomcDate ?? 'unknown'}:${session.toLowerCase()}`, cooldownMs: 12 * 60 * 60 * 1000,
      }).catch(console.error);
    }
    console.warn(`[AutoTrade] FOMC_BLOCK diagnostic-only live block active; continuing scan diagnostics`);
    await recordBlockedDayShadowScan('FOMC_BLOCK');
  }
  if (fomcProximity.noNewEntry && fomcEntryOverrideActive) {
    console.warn(
      `[AutoTrade] FOMC no-new-entry bypassed by OPERATOR_MACRO_ENTRY_OVERRIDE — ` +
      `${formatMacroEntryOverrideLog(macroEntryOverride!)}`,
    );
  }

  if (isDataStarvedScan()) {
    const snap = getCompletenessSnapshot();
    console.warn(`[AutoTrade] 데이터 빈곤 스캔 차단 — MTAS실패 ${(snap.mtasFailRate * 100).toFixed(1)}% / DART null ${(snap.dartNullRate * 100).toFixed(1)}%`);
    await sendTelegramAlert(`🧪 <b>[데이터 빈곤 스캔] 신규 진입 보류</b>\nMTAS 실패 ${(snap.mtasFailRate * 100).toFixed(1)}% | DART null ${(snap.dartNullRate * 100).toFixed(1)}%\n표본: M${snap.mtasAttempts} · D${snap.dartAttempts}\n빈 스캔과 구분되는 "데이터 부재" 상태 — 원천 데이터 점검 후 복귀`, { priority: 'HIGH', dedupeKey: 'data-starved-scan', cooldownMs: 30 * 60_000 }).catch(console.error);
    await recordBlockedDayShadowScan('DATA_STARVED');
    // ADR-0433: data-starved preflight abort universe snapshot.
    // ADR-0367: buyListLoop 진입 전 차단 — preflightBlockedScanSummary 도 영속.
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
          `data starved — MTAS fail ${(snap.mtasFailRate * 100).toFixed(1)}% / DART null ${(snap.dartNullRate * 100).toFixed(1)}%`,
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
    volumeClockAllowsEntry: volumeClock.allowEntry,
    emergencyStop: getEmergencyStop(),
    manualBlockNewBuy,
    manualManageOnly,
    sellOnlyMode: optSellOnly === true,
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
    volumeClockAllowsEntry: volumeClock.allowEntry,
  });

  const ipsKelly = getIpsKellyMultiplier();
  const accountKellyMultiplier = getAccountScaleKellyMultiplier(totalAssets);
  const biasPositionPenalty = computeBiasPositionPenalty();
  const biasMultiplier = biasPositionPenalty.multiplier;
  const safetyGatePolicyFeedback = computeSafetyGatePolicyFeedback();
  const safetyGateMultiplier = safetyGatePolicyFeedback.multiplier;
  const exceptionKellyFactor = sellOnlyExc.allow ? sellOnlyExc.kellyFactor : 1;
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
    !liveEntryBlockedReason &&
    optSellOnly !== true &&
    volumeClock.allowEntry === true &&
    resolvedMarketSessionState === 'OPEN';
  const executionModeForKelly = resolvePreflightExecutionMode({
    sellOnly: optSellOnly === true,
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
  
  if (ipsKelly < 1.0) console.log(`[AutoTrade] IPS 변곡 Kelly 감쇠 적용 — ×${ipsKelly.toFixed(2)}`);
  if (vixGating.kellyMultiplier < 1) console.log(`[AutoTrade] VIX 게이팅 적용 — ${vixGating.reason}`);
  if (fomcProximity.kellyMultiplier !== 1) console.log(`[AutoTrade] FOMC 게이팅 적용 — ${fomcProximity.description}`);
  if (biasMultiplier < 1) console.log(`[AutoTrade] learning bias position penalty applied — x${biasMultiplier.toFixed(2)} (${biasPositionPenalty.reasons.join('; ')})`);
  if (safetyGatePolicyFeedback.active) console.log(`[AutoTrade] safety gate policy feedback applied — x${safetyGateMultiplier.toFixed(2)} (${safetyGatePolicyFeedback.reasons.join('; ')})`);
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
      `[AutoTrade] ${describeRegimeFomcCombination(regimeFomcCombined)} × VIX(×${effectiveVixKelly.toFixed(2)}) × IPS(×${ipsKelly.toFixed(2)}) × 계좌(×${accountKellyMultiplier.toFixed(2)}) = raw ×${rawKelly.toFixed(3)}${kellyResult.floorApplied ? ' → floor applied' : ''} → 유효 ×${kellyMultiplier.toFixed(2)}`,
    );
  }

  const MAX_CONVICTION_POSITIONS = Number(process.env.MAX_CONVICTION_POSITIONS ?? '8');
  const effectiveMaxPositions = Math.min(
    MAX_CONVICTION_POSITIONS,
    sellOnlyExc.allow ? Math.min(regimeConfig.maxPositions, sellOnlyExc.maxSlots) : regimeConfig.maxPositions,
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

  if (slotResult.isFull && process.env.POSITION_FULL_PREFLIGHT_ABORT === 'true') {
    console.log(`[AutoTrade] 최대 동시 포지션 도달 (${slotResult.consumed.toFixed(2)}/${effectiveMaxPositions}${sellOnlyExc.allow ? ' · SELL_ONLY 예외 캡' : ''}, 레짐 ${regime}, raw=${slotResult.rawCount}) — 신규 진입 스킵`);
    await recordBlockedDayShadowScan('POSITION_FULL');
    // ADR-0367: buyListLoop 진입 전 차단 — preflightBlockedScanSummary 도 영속.
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
        notes: [`position slots full — consumed=${slotResult.consumed.toFixed(2)}/${effectiveMaxPositions}, raw=${slotResult.rawCount}`],
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
    bearDefenseMode: regime === 'R6_DEFENSE',
    mhsBelow30: (macroState?.mhs ?? 100) < 30,
    watchlistEmpty: watchlist.length === 0,
    sellOnlyMode: optSellOnly === true || !volumeClock.allowEntry,
    macroEntryOverrideActive: macroEntryOverride !== null,
    macroEntryOverrideTargets: macroEntryOverride?.targets,
    diagnosticLiveEntryBlocked: diagnosticOnlyLiveBlock,
    liveEntryBlockedReason: liveEntryBlockReason,
  });

  if (!volumeClock.allowEntry) {
    console.log(volumeClock.reason);
    // ADR-0515 — volumeClock 점심 차단을 ADR-0192(12:00~12:59) 정합 → 허용 구간 09:30~11:59.
    console.log(`[AutoTrade] 매수 대기 종목 대기 중 (허용 구간: 09:30~11:59, 13:00~15:20 KST)`);
    await recordBlockedDayShadowScan('VOLUME_CLOCK_BLOCK');
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return {
      shouldAbort: true,
      skipPersist: false,
      diagnosticData: {
        buyListLength: watchlist.length,
        intradayBuyListLength: 0,
        swingListLength: 0,
        catalystListLength: 0,
        momentumListLength: watchlist.length,
        macroGateState,
      },
      context: diagnosticContext({ sellOnlyExc, vixGating, fomcProximity, kellyMultiplier, volumeClock, macroGateState }),
    };
  }
  if (volumeClock.scoreBonus !== 0) {
    console.log(volumeClock.reason);
  }

  // ADR-0419: SHADOW_ONLY ephemeral 차단 — R6/VIX/FOMC 상태에서도 진단 루프는 유지한다.
  //   evaluateR3CountableScan 은 이런 거시 차단일을 R3 streak 누적에서 제외하는 안전망이다.
  // ADR-0401: 영속 latch 와 무관, streak repo 의 24h decay 로 자연 회복.
  // HARD_BLOCK latch (영속, ADR-0120) 는 라인 ~173 에서 이미 처리됨 (절대 원칙 #11/12 — 자동 해제 0).
  if (r3Countability.countable) {
    const effectiveStreak = getEffectiveR3ViolationStreak();
    if (effectiveStreak.violation === 'GATE1_PASS_ZERO' && effectiveStreak.consecutiveCount > 0) {
      const profile = getR3SanityProfile(effectiveStreak.regime);
      if (effectiveStreak.consecutiveCount >= profile.shadowOnlyAt) {
        console.warn(
          `[AutoTrade] R3 SHADOW_ONLY ephemeral block — streak=${effectiveStreak.consecutiveCount}/${profile.shadowOnlyAt} ` +
          `(${effectiveStreak.violation}, ${effectiveStreak.regime}) — ADR-0401/0419`,
        );
        await sendTelegramAlert(
          `⚫️ <b>[R3 Sanity — SHADOW_ONLY pre-scan]</b>\n` +
          `직전 스캔 누적 ${effectiveStreak.consecutiveCount}회 (임계 ${profile.shadowOnlyAt}) — ` +
          `신규 진입 차단 + shadow learning 유지.\n` +
          `<i>다음 정상 스캔 (위반 NONE 또는 24h decay) 시 자동 회복 — 영속 latch 없음 (ADR-0401).</i>`,
          {
            priority: 'HIGH',
            dedupeKey: `r3_sanity_shadow_only_pre:${effectiveStreak.regime}:${effectiveStreak.consecutiveCount}`,
            cooldownMs: 6 * 60 * 60_000,
          },
        ).catch(console.error);
        await recordBlockedDayShadowScan('R3_SANITY_BLOCK');
        // ADR-0433: R3 SHADOW_ONLY ephemeral preflight abort universe snapshot.
        // ADR-0367: buyListLoop 진입 전 차단 — preflightBlockedScanSummary 도 영속.
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
              `R3 SHADOW_ONLY ephemeral — streak=${effectiveStreak.consecutiveCount}/${profile.shadowOnlyAt} (${effectiveStreak.violation}, ${effectiveStreak.regime})`,
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
    // ADR-0419: 비정상 컨텍스트 — SHADOW_ONLY pre-scan 자체 차단 (사용자 명시 절대 원칙).
    // R6/VIX/FOMC 진단일은 buyList/gate 진단을 계속하되 R3 streak 산정에서 제외한다.
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
