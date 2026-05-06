/**
 * @responsibility 스캔 직전 매크로·시스템 게이트 — KIS·manual·regime·VIX·R6·FOMC·sellOnly 판정
 *
 * ADR-0129: macroGateState 11 필드 합성 + persistScanResults propagate (signalScanner/index.ts 호출자)
 * ADR-0168: Kelly clamp SSOT (applyKellyClamp + KELLY_FLOOR) — 매직 넘버 1.5 직접 사용 금지
 * ADR-0147b: signalScanner Phase 3 분해 후 게이팅·sanity·sizing wiring 단일 위치 (drift 차단)
 */

import { fetchAccountBalance } from '../../clients/kisClient.js';
import { getManualBlockNewBuy, getManualManageOnly, getEmergencyStop } from '../../state.js';
import { sendTelegramAlert } from '../../alerts/telegramClient.js';
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
import { loadShadowTrades, saveShadowTrades } from '../../persistence/shadowTradeRepo.js';
import { computeShadowAccount } from '../../persistence/shadowAccountRepo.js';
import { loadTradingSettings } from '../../persistence/tradingSettingsRepo.js';
import { updateShadowResults } from '../exitEngine.js';
import {
  isShadowLearningOnBlockedDaysEnabled,
  runShadowLearningOnlyScan,
  type ShadowLearningOnlyScanReason,
} from '../shadowLearningOnlyScan.js';
import { getVixGating } from '../vixGating.js';
import { getFomcProximity } from '../fomcCalendar.js';
import { isDataStarvedScan, getCompletenessSnapshot } from '../../screener/dataCompletenessTracker.js';
import { getKellyMultiplier as getIpsKellyMultiplier } from '../kellyDampener.js';
import { computeBiasPositionPenalty } from '../../learning/biasPositionPenalty.js';
import { computeSafetyGatePolicyFeedback } from '../../learning/safetyGatePolicyFeedback.js';
import { combineRegimeAndFomcKelly, describeRegimeFomcCombination } from '../regimeFomcCombiner.js';
import { applyKellyClamp, KELLY_FLOOR } from '../sizing/kellyClamp.js';
import { computeSlotConsumption } from '../slotAccounting.js';
import { checkVolumeClockWindow } from '../volumeClock.js';
import { loadConditionWeights, getConditionWeightsUpdatedAt } from '../../persistence/conditionWeightsRepo.js';
import { applyFreshnessDecayToNeutralWeightedRecord } from '../../learning/learningFreshnessGuard.js';
import { isOpenShadowStatus } from '../entryEngine.js';
import type { RunAutoSignalScanOptions } from './index.js';
import { buildMacroGateState } from './scanDiagnostics.js';
import type { SupplyHealthSnapshot } from '../../learning/supplyHealthLearning.js';

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

async function captureSupplyHealthSnapshot(): Promise<SupplyHealthSnapshot | undefined> {
  if (process.env.NODE_ENV === 'test' && process.env.SUPPLY_HEALTH_LEARNING_ENABLED !== 'true') {
    return undefined;
  }
  try {
    const mod = await import('../../telegram/commands/system/supplyHealth.cmd.js');
    return await mod.buildSupplyHealthSnapshot();
  } catch (e) {
    console.warn('[SupplyHealth] snapshot capture failed:', e);
    return undefined;
  }
}

// ADR-0183: blocked-day shadow learning is isolated here so entry blocks do not call order paths.
async function recordBlockedDayShadowScan(reason: ShadowLearningOnlyScanReason): Promise<void> {
  if (!isShadowLearningOnBlockedDaysEnabled()) return;
  try {
    const kstScanDate = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const supplyHealthSnapshot = await captureSupplyHealthSnapshot();
    await runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason,
      scanDate: kstScanDate,
      ...(supplyHealthSnapshot ? { supplyHealthSnapshot } : {}),
    });
  } catch (e) {
    console.warn(`[ShadowLearningOnly] scan 실패 (${reason}):`, e);
  }
}

export async function runPreflight(options?: RunAutoSignalScanOptions): Promise<any> {
  if (!process.env.KIS_APP_KEY) {
    console.warn('[AutoTrade] KIS_APP_KEY 미설정 — 스캔 건너뜀');
    return { shouldAbort: true, skipPersist: true };
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
    return { shouldAbort: true, skipPersist: true };
  }

  const shadowMode = process.env.AUTO_TRADE_MODE !== 'LIVE';
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
  const regimeConfig = REGIME_CONFIGS[regime];
  conditionWeights = applyFreshnessDecayToNeutralWeightedRecord(
    conditionWeights,
    { generatedAt: getConditionWeightsUpdatedAt() ?? undefined, regime },
    regime,
  );

  const r3SanityBlock = loadR3SanityBlockState();
  if (r3SanityBlock.active) {
    if (isR3SanityAckTokenValid(r3SanityBlock, process.env.R3_SANITY_OPERATOR_ACK)) {
      acknowledgeR3SanityBlock('R3_SANITY_OPERATOR_ACK');
    } else {
      console.warn(`[AutoTrade] R3 sanity block active — 신규 매수 차단 (${r3SanityBlock.violation}, ${r3SanityBlock.regime})`);
      // ADR-0195: cooldown 60min → 24h (사용자 9번 §6 정합 — 1일 1회 알림).
      // 텔레그램 즉시 해제: /r3_unblock (ADR-0195) 또는 ENV `R3_SANITY_OPERATOR_ACK=<triggeredAt>` (ADR-0120).
      await sendTelegramAlert(
        `🚨 <b>[R3 Sanity Block Active]</b>\n신규 매수 차단 + shadow-only 전환 유지\n위반: ${r3SanityBlock.violation} / ${r3SanityBlock.regime}\n` +
        `즉시 해제: <code>/r3_unblock</code> (텔레그램, ADR-0195)\n` +
        `또는 ENV <code>R3_SANITY_OPERATOR_ACK=${r3SanityBlock.triggeredAt}</code> (ADR-0120)`,
        { priority: 'HIGH', dedupeKey: 'r3_sanity_block_active', cooldownMs: 24 * 60 * 60_000 },
      ).catch(console.error);
      await recordBlockedDayShadowScan('R3_SANITY_BLOCK');
      await updateShadowResults(shadows, regime);
      saveShadowTrades(shadows);
      return { shouldAbort: true, skipPersist: true };
    }
  }

  const sellOnlyExc = optSellOnly
    ? evaluateSellOnlyException(regimeConfig, macroState)
    : { allow: false, maxSlots: 0, kellyFactor: 1, minLiveGate: 0, minMtas: 0, reason: 'not-sellOnly' };
    
  if (optSellOnly && !sellOnlyExc.allow) {
    console.log(`[AutoTrade] SELL_ONLY 모드 — 포지션 모니터링 전용 (예외 불가: ${sellOnlyExc.reason})`);
    await recordBlockedDayShadowScan('MANUAL_BLOCK');
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, skipPersist: true };
  }
  if (optSellOnly && sellOnlyExc.allow) {
    console.log(`[AutoTrade] SELL_ONLY 예외 채널 활성 — ${sellOnlyExc.reason} | maxSlots=${sellOnlyExc.maxSlots}, Kelly×${sellOnlyExc.kellyFactor}, Gate≥${sellOnlyExc.minLiveGate}, MTAS≥${sellOnlyExc.minMtas}`);
  }

  if (regime === 'R6_DEFENSE') {
    await sendTelegramAlert(`🔴 <b>[R6_DEFENSE] 신규 진입 전면 차단</b>\nMHS: ${macroState?.mhs ?? 'N/A'} | 블랙스완 감지 — 기존 포지션 모니터링만 수행`).catch(console.error);
    console.warn(`[AutoTrade] R6_DEFENSE (MHS=${macroState?.mhs}) — 신규 진입 전면 차단`);
    await recordBlockedDayShadowScan('RISK_OFF_REGIME');
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, skipPersist: true };
  }

  const vixGating = getVixGating(macroState?.vix, macroState?.vixHistory ?? []);
  if (vixGating.noNewEntry) {
    console.warn(`[AutoTrade] VIX 게이팅 — 신규 진입 중단: ${vixGating.reason}`);
    const session = getGatingAlertSession();
    if (session) {
      const kstDateStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await sendTelegramAlert(`🚨 <b>[VIX 게이팅] 신규 진입 차단</b>\n${vixGating.reason}\n포지션 모니터링만 수행합니다.`, {
        dedupeKey: `vix_gating_block:${kstDateStr}:${session.toLowerCase()}`, cooldownMs: 12 * 60 * 60 * 1000,
      }).catch(console.error);
    }
    await recordBlockedDayShadowScan('VIX_SPIKE');
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, skipPersist: true };
  }

  const fomcProximity = getFomcProximity(
    macroState ? { mhs: macroState.mhs, regime: regime ?? macroState.regime, vkospi: macroState.vkospi } : undefined,
  );
  if (fomcProximity.noNewEntry) {
    console.warn(`[AutoTrade] FOMC 게이팅 — 신규 진입 차단: ${fomcProximity.description}`);
    const session = getGatingAlertSession();
    if (session) {
      await sendTelegramAlert(`📅 <b>[FOMC 게이팅] 신규 진입 차단</b>\n${fomcProximity.description}\n포지션 모니터링만 수행합니다.`, {
        dedupeKey: `fomc_gating_block:${fomcProximity.nextFomcDate ?? 'unknown'}:${session.toLowerCase()}`, cooldownMs: 12 * 60 * 60 * 1000,
      }).catch(console.error);
    }
    await recordBlockedDayShadowScan('FOMC_BLOCK');
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, skipPersist: true };
  }

  if (isDataStarvedScan()) {
    const snap = getCompletenessSnapshot();
    console.warn(`[AutoTrade] 데이터 빈곤 스캔 차단 — MTAS실패 ${(snap.mtasFailRate * 100).toFixed(1)}% / DART null ${(snap.dartNullRate * 100).toFixed(1)}%`);
    await sendTelegramAlert(`🧪 <b>[데이터 빈곤 스캔] 신규 진입 보류</b>\nMTAS 실패 ${(snap.mtasFailRate * 100).toFixed(1)}% | DART null ${(snap.dartNullRate * 100).toFixed(1)}%\n표본: M${snap.mtasAttempts} · D${snap.dartAttempts}\n빈 스캔과 구분되는 "데이터 부재" 상태 — 원천 데이터 점검 후 복귀`, { priority: 'HIGH', dedupeKey: 'data-starved-scan', cooldownMs: 30 * 60_000 }).catch(console.error);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, skipPersist: true };
  }

  const ipsKelly = getIpsKellyMultiplier();
  const accountKellyMultiplier = getAccountScaleKellyMultiplier(totalAssets);
  const biasPositionPenalty = computeBiasPositionPenalty();
  const biasMultiplier = biasPositionPenalty.multiplier;
  const safetyGatePolicyFeedback = computeSafetyGatePolicyFeedback();
  const safetyGateMultiplier = safetyGatePolicyFeedback.multiplier;
  const exceptionKellyFactor = sellOnlyExc.allow ? sellOnlyExc.kellyFactor : 1;
  const regimeFomcCombined = combineRegimeAndFomcKelly(regimeConfig.kellyMultiplier, fomcProximity.kellyMultiplier, fomcProximity.phase, regime);
  
  const rawKelly = regimeFomcCombined.value * vixGating.kellyMultiplier * ipsKelly * exceptionKellyFactor * accountKellyMultiplier * biasMultiplier * safetyGateMultiplier;
  const kellyMultiplier = applyKellyClamp(rawKelly);
  
  if (ipsKelly < 1.0) console.log(`[AutoTrade] IPS 변곡 Kelly 감쇠 적용 — ×${ipsKelly.toFixed(2)}`);
  if (vixGating.kellyMultiplier < 1) console.log(`[AutoTrade] VIX 게이팅 적용 — ${vixGating.reason}`);
  if (fomcProximity.kellyMultiplier !== 1) console.log(`[AutoTrade] FOMC 게이팅 적용 — ${fomcProximity.description}`);
  if (biasMultiplier < 1) console.log(`[AutoTrade] learning bias position penalty applied — x${biasMultiplier.toFixed(2)} (${biasPositionPenalty.reasons.join('; ')})`);
  if (safetyGatePolicyFeedback.active) console.log(`[AutoTrade] safety gate policy feedback applied — x${safetyGateMultiplier.toFixed(2)} (${safetyGatePolicyFeedback.reasons.join('; ')})`);
  if (kellyMultiplier !== regimeConfig.kellyMultiplier) {
    console.log(
      `[AutoTrade] ${describeRegimeFomcCombination(regimeFomcCombined)} × VIX(×${vixGating.kellyMultiplier.toFixed(2)}) × IPS(×${ipsKelly.toFixed(2)}) × 계좌(×${accountKellyMultiplier.toFixed(2)}) = raw ×${rawKelly.toFixed(3)}${rawKelly < KELLY_FLOOR ? ` → floor ×${KELLY_FLOOR}` : ''} → 유효 ×${kellyMultiplier.toFixed(2)}`,
    );
  }

  const MAX_CONVICTION_POSITIONS = Number(process.env.MAX_CONVICTION_POSITIONS ?? '8');
  const effectiveMaxPositions = Math.min(
    MAX_CONVICTION_POSITIONS,
    sellOnlyExc.allow ? Math.min(regimeConfig.maxPositions, sellOnlyExc.maxSlots) : regimeConfig.maxPositions,
  );
  
  const slotResult = computeSlotConsumption(shadows, effectiveMaxPositions);
  if (slotResult.isFull) {
    console.log(`[AutoTrade] 최대 동시 포지션 도달 (${slotResult.consumed.toFixed(2)}/${effectiveMaxPositions}${sellOnlyExc.allow ? ' · SELL_ONLY 예외 캡' : ''}, 레짐 ${regime}, raw=${slotResult.rawCount}) — 신규 진입 스킵`);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, skipPersist: true, positionFull: true };
  }

  const volumeClock = checkVolumeClockWindow();
  if (!volumeClock.allowEntry) {
    console.log(volumeClock.reason);
    console.log(`[AutoTrade] 매수 대기 종목 대기 중 (허용 구간: 09:30~11:30, 13:00~15:20 KST)`);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, skipPersist: true };
  }
  if (volumeClock.scoreBonus !== 0) {
    console.log(volumeClock.reason);
  }

  const supplyHealthSnapshot = await captureSupplyHealthSnapshot();

  const macroGateState = buildMacroGateState({
    emergencyStop: getEmergencyStop(),
    autoTradeEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
    regime: regime ?? 'UNKNOWN',
    regimeKelly: regimeConfig.kellyMultiplier,
    fomcPhase: fomcProximity.phase,
    fomcKelly: fomcProximity.kellyMultiplier,
    finalKelly: kellyMultiplier,
    vixGatingActive: vixGating.noNewEntry,
    bearDefenseMode: false,
    mhsBelow30: (macroState?.mhs ?? 100) < 30,
    watchlistEmpty: watchlist.length === 0,
    sellOnlyMode: optSellOnly === true,
  });

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
      accountKellyMultiplier,
      sellOnlyExc,
      volumeClock,
      conditionWeights,
      supplyHealthSnapshot,
      shadows,
      watchlist,
      optSellOnly,
    },
  };
}
