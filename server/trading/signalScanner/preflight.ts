/**
 * @responsibility 스캔 직전 매크로·시스템 게이트 — KIS·manual·regime·VIX·R6·FOMC·sellOnly 판정
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 preflight 단계. 종목별 평가 루프가
 * 시작되기 전에 실행되는 모든 매크로 가드를 한 곳에 모은다:
 *   - KIS_APP_KEY 미설정 단락
 *   - UI 수동 가드 (getManualBlockNewBuy / getManualManageOnly) → sellOnly 승격
 *   - regime/VIX/FOMC/R6_DEFENSE 게이팅
 *   - SELL_ONLY 예외 채널 (evaluateSellOnlyException)
 *   - data-starvation 게이팅 (isDataStarvedScan)
 *   - IPS Kelly 댐퍼 / accountScale Kelly 배수
 */

import type { FullRegimeConfig, RegimeLevel } from '../../../src/types/core.js';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

import { fetchAccountBalance } from '../../clients/kisClient.js';
import { sendTelegramAlert } from '../../alerts/telegramClient.js';
import { loadMacroState } from '../../persistence/macroStateRepo.js';
import { computeShadowAccount } from '../../persistence/shadowAccountRepo.js';
import { loadTradingSettings } from '../../persistence/tradingSettingsRepo.js';
import { loadShadowTrades, saveShadowTrades } from '../../persistence/shadowTradeRepo.js';
import { loadConditionWeights } from '../../persistence/conditionWeightsRepo.js';
import { getKellyMultiplier as getIpsKellyMultiplier } from '../kellyDampener.js';
import { getLiveRegime } from '../regimeBridge.js';
import { REGIME_CONFIGS } from '../../../src/services/quant/regimeEngine.js';
import { getVixGating, type VixGating } from '../vixGating.js';
import { getFomcProximity, type FomcProximity } from '../fomcCalendar.js';
import { checkVolumeClockWindow, type VolumeClockResult } from '../volumeClock.js';
import { isDataStarvedScan, getCompletenessSnapshot } from '../../screener/dataCompletenessTracker.js';
import { isOpenShadowStatus } from '../entryEngine.js';
import { updateShadowResults } from '../exitEngine.js';
import { getManualBlockNewBuy, getManualManageOnly } from '../../state.js';

export interface SellOnlyExceptionDecision {
  allow: boolean;
  maxSlots: number;
  kellyFactor: number;
  minLiveGate: number;
  minMtas: number;
  reason: string;
}

export interface PreflightInput {
  sellOnly?: boolean;
  /** volumeClock 차단 로그에서 표시되는 buyList 길이. 미지정 시 0 으로 표기. */
  buyListLength?: number;
}

export interface PreflightOutcome {
  shouldAbort: boolean;
  abortReason?: string;
  positionFull?: boolean;
  /** options.sellOnly 가 manual 가드로 인해 승격됐는지 여부. */
  sellOnly: boolean;

  // ── 통과 시 채워지는 컨텍스트 ─────────────────────────────────────────────
  totalAssets?: number;
  orderableCash?: number;
  activeHoldingValue?: number;
  shadowMode?: boolean;
  /** 스캐너가 mutate 하는 shadow trades 배열 (호출자가 이어서 사용). */
  shadows?: ServerShadowTrade[];
  conditionWeights?: ReturnType<typeof loadConditionWeights>;
  regime?: RegimeLevel;
  regimeConfig?: FullRegimeConfig;
  macroState?: MacroState | null;
  vixGating?: VixGating;
  fomcProximity?: FomcProximity;
  ipsKelly?: number;
  accountKellyMultiplier?: number;
  kellyMultiplier?: number;
  sellOnlyExc?: SellOnlyExceptionDecision;
  effectiveMaxPositions?: number;
  volumeClock?: VolumeClockResult;
}

/**
 * SELL_ONLY 예외 채널 판정. 기존 signalScanner.ts L84~110 의 동일 함수 이전 위치.
 */
export function evaluateSellOnlyException(
  cfg: FullRegimeConfig,
  macro: MacroState | null,
): SellOnlyExceptionDecision {
  const exc = cfg.sellOnlyException;
  if (!exc || !exc.enabled) {
    return { allow: false, maxSlots: 0, kellyFactor: 1, minLiveGate: 99, minMtas: 11, reason: 'disabled' };
  }
  const vix = macro?.vix;
  if (vix == null || vix >= exc.maxVix) {
    return { allow: false, maxSlots: 0, kellyFactor: exc.kellyFactor, minLiveGate: exc.minLiveGate, minMtas: exc.minMtas, reason: `VIX ${vix ?? 'N/A'} ≥ ${exc.maxVix}` };
  }
  const rs = macro?.leadingSectorRS ?? 0;
  const stage = macro?.sectorCycleStage;
  const sectorAligned = rs >= 60 || stage === 'EARLY' || stage === 'MID';
  if (!sectorAligned) {
    return { allow: false, maxSlots: 0, kellyFactor: exc.kellyFactor, minLiveGate: exc.minLiveGate, minMtas: exc.minMtas, reason: `sector not aligned (RS ${rs}, stage ${stage ?? 'N/A'})` };
  }
  return {
    allow: true,
    maxSlots: Math.max(1, Math.floor(exc.maxSlots)),
    kellyFactor: exc.kellyFactor,
    minLiveGate: exc.minLiveGate,
    minMtas: exc.minMtas,
    reason: `ALIGNED (VIX ${vix} < ${exc.maxVix}, RS ${rs}, stage ${stage ?? '-'})`,
  };
}

/**
 * 계좌 규모별 Kelly 배수. 기존 signalScanner.ts L189~194 이전 위치.
 */
export function getAccountScaleKellyMultiplier(totalAssets: number): number {
  if (totalAssets >= 300_000_000) return 1.15;
  if (totalAssets >= 100_000_000) return 1.08;
  if (totalAssets <= 20_000_000) return 0.92;
  return 1.0;
}

/**
 * 스캔 진입 전 매크로·시스템 게이트 통합 평가.
 *
 * 원본 signalScanner.ts 의 L297~577 동작과 동등 — 게이트 차단 시 내부에서
 * `updateShadowResults`+`saveShadowTrades` 까지 수행하고 `shouldAbort=true` 를 반환.
 */
export async function runPreflight(
  input: PreflightInput,
): Promise<PreflightOutcome> {
  // ── 1. KIS_APP_KEY 단락 ────────────────────────────────────────────────────
  if (!process.env.KIS_APP_KEY) {
    console.warn('[AutoTrade] KIS_APP_KEY 미설정 — 스캔 건너뜀');
    return { shouldAbort: true, abortReason: 'NO_KIS_APP_KEY', sellOnly: !!input.sellOnly };
  }

  // ── 2. UI 수동 가드 → sellOnly 승격 ────────────────────────────────────────
  let sellOnly = !!input.sellOnly;
  const manualBlockNewBuy = getManualBlockNewBuy();
  const manualManageOnly = getManualManageOnly();
  if ((manualBlockNewBuy || manualManageOnly) && !sellOnly) {
    const reason = manualManageOnly ? '보유만 관리 모드' : '신규 매수 차단';
    console.warn(`[AutoTrade] UI 수동 가드 활성 (${reason}) — sellOnly 로 승격`);
    sellOnly = true;
  }

  // ── 3. shadowMode 분기 + 잔고 결정 ─────────────────────────────────────────
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
  const conditionWeights = loadConditionWeights();

  // 레거시 호환: shadowMode + activeHoldingValue==0 시 fills 기반으로 한 번 더 확인.
  if (shadowMode && activeHoldingValue === 0) {
    activeHoldingValue = shadows
      .filter((s) => isOpenShadowStatus(s.status))
      .reduce((sum, s) => sum + (s.shadowEntryPrice * s.quantity), 0);
  }

  console.log(
    shadowMode
      ? `[AutoTrade] [SHADOW] 가상 계좌 기준 — 시작원금: ${totalAssets.toLocaleString()}원 / 현금: ${orderableCash.toLocaleString()}원 / 보유가치: ${activeHoldingValue.toLocaleString()}원 / 모드: SHADOW`
      : `[AutoTrade] [LIVE] 실계좌 기준 — 총자산: ${totalAssets.toLocaleString()}원 / 주문가능현금: ${orderableCash.toLocaleString()}원 / 모드: LIVE`,
  );

  // ── 4. 레짐 분류 ──────────────────────────────────────────────────────────
  const macroState = loadMacroState();
  const regime      = getLiveRegime(macroState);
  const regimeConfig = REGIME_CONFIGS[regime];

  // ── 5. SELL_ONLY 예외 채널 ────────────────────────────────────────────────
  const sellOnlyExc: SellOnlyExceptionDecision = sellOnly
    ? evaluateSellOnlyException(regimeConfig, macroState)
    : { allow: false, maxSlots: 0, kellyFactor: 1, minLiveGate: 0, minMtas: 0, reason: 'not-sellOnly' };

  if (sellOnly && !sellOnlyExc.allow) {
    console.log(`[AutoTrade] SELL_ONLY 모드 — 포지션 모니터링 전용 (예외 불가: ${sellOnlyExc.reason})`);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, abortReason: 'SELL_ONLY_NO_EXCEPTION', sellOnly };
  }
  if (sellOnly && sellOnlyExc.allow) {
    console.log(
      `[AutoTrade] SELL_ONLY 예외 채널 활성 — ${sellOnlyExc.reason} | ` +
      `maxSlots=${sellOnlyExc.maxSlots}, Kelly×${sellOnlyExc.kellyFactor}, Gate≥${sellOnlyExc.minLiveGate}, MTAS≥${sellOnlyExc.minMtas}`,
    );
  }

  // ── 6. R6_DEFENSE ─────────────────────────────────────────────────────────
  if (regime === 'R6_DEFENSE') {
    await sendTelegramAlert(
      `🔴 <b>[R6_DEFENSE] 신규 진입 전면 차단</b>\n` +
      `MHS: ${macroState?.mhs ?? 'N/A'} | 블랙스완 감지 — 기존 포지션 모니터링만 수행`,
    ).catch(console.error);
    console.warn(`[AutoTrade] R6_DEFENSE (MHS=${macroState?.mhs}) — 신규 진입 전면 차단`);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, abortReason: 'R6_DEFENSE', sellOnly };
  }

  // ── 7. VIX 게이팅 ─────────────────────────────────────────────────────────
  const vixGating = getVixGating(macroState?.vix, macroState?.vixHistory ?? []);
  if (vixGating.noNewEntry) {
    console.warn(`[AutoTrade] VIX 게이팅 — 신규 진입 중단: ${vixGating.reason}`);
    await sendTelegramAlert(
      `🚨 <b>[VIX 게이팅] 신규 진입 차단</b>\n` +
      `${vixGating.reason}\n` +
      `포지션 모니터링만 수행합니다.`,
    ).catch(console.error);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, abortReason: 'VIX_GATING', sellOnly };
  }

  // ── 8. FOMC 게이팅 ────────────────────────────────────────────────────────
  // v2 (2026-04-26): macroState 를 전달해 PRE_1/DAY 에서도 우호 환경 시 보수적 진입 허용.
  // 우호 환경 조건: MHS≥60 + 강세 레짐(BULL_AGGRESSIVE/BULL_NORMAL) + VKOSPI≤22.
  // macro 누락 시 보수적 차단 유지 (회귀 안전).
  const fomcProximity = getFomcProximity(
    macroState
      ? {
          mhs: macroState.mhs,
          regime: regime ?? macroState.regime,
          vkospi: macroState.vkospi,
        }
      : undefined,
  );
  if (fomcProximity.noNewEntry) {
    console.warn(`[AutoTrade] FOMC 게이팅 — 신규 진입 차단: ${fomcProximity.description}`);
    await sendTelegramAlert(
      `📅 <b>[FOMC 게이팅] 신규 진입 차단</b>\n` +
      `${fomcProximity.description}\n` +
      `포지션 모니터링만 수행합니다.`,
    ).catch(console.error);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, abortReason: 'FOMC_GATING', sellOnly };
  }
  // 우호 환경 완화 적용 시 운영자 알림 (1회/일 dedupeKey).
  if (fomcProximity.relaxed) {
    console.log(`[AutoTrade] FOMC 우호 환경 완화 — 보수적 진입 허용: ${fomcProximity.relaxationReason}`);
    await sendTelegramAlert(
      `🟢 <b>[FOMC 우호 환경 완화]</b>\n` +
      `${fomcProximity.description}\n` +
      `Kelly ×${fomcProximity.kellyMultiplier.toFixed(2)} 보수적 진입 허용 — ` +
      `규모 축소 + 종목 선별 강화`,
      {
        priority: 'NORMAL',
        dedupeKey: `fomc_relaxed_${fomcProximity.nextFomcDate ?? 'unknown'}`,
        cooldownMs: 12 * 60 * 60 * 1000,
      },
    ).catch(console.error);
  }

  // ── 9. Data Degradation Gate ──────────────────────────────────────────────
  if (isDataStarvedScan()) {
    const snap = getCompletenessSnapshot();
    console.warn(
      `[AutoTrade] 데이터 빈곤 스캔 차단 — MTAS실패 ${(snap.mtasFailRate * 100).toFixed(1)}% / ` +
      `DART null ${(snap.dartNullRate * 100).toFixed(1)}%`,
    );
    await sendTelegramAlert(
      `🧪 <b>[데이터 빈곤 스캔] 신규 진입 보류</b>\n` +
      `MTAS 실패 ${(snap.mtasFailRate * 100).toFixed(1)}% | DART null ${(snap.dartNullRate * 100).toFixed(1)}%\n` +
      `표본: M${snap.mtasAttempts} · D${snap.dartAttempts}\n` +
      `빈 스캔과 구분되는 "데이터 부재" 상태 — 원천 데이터 점검 후 복귀`,
      { priority: 'HIGH', dedupeKey: 'data-starved-scan', cooldownMs: 30 * 60_000 },
    ).catch(console.error);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, abortReason: 'DATA_STARVED', sellOnly };
  }

  // ── 10. Kelly 배율 합성 ───────────────────────────────────────────────────
  const KELLY_FLOOR = 0.15;
  const ipsKelly = getIpsKellyMultiplier();
  const accountKellyMultiplier = getAccountScaleKellyMultiplier(totalAssets);
  const exceptionKellyFactor = sellOnlyExc.allow ? sellOnlyExc.kellyFactor : 1;
  const rawKelly = regimeConfig.kellyMultiplier * vixGating.kellyMultiplier * fomcProximity.kellyMultiplier * ipsKelly * exceptionKellyFactor * accountKellyMultiplier;
  const kellyMultiplier = Math.min(
    1.5,
    Math.max(KELLY_FLOOR, rawKelly),
  );
  if (ipsKelly < 1.0) {
    console.log(`[AutoTrade] IPS 변곡 Kelly 감쇠 적용 — ×${ipsKelly.toFixed(2)}`);
  }
  if (vixGating.kellyMultiplier < 1) {
    console.log(`[AutoTrade] VIX 게이팅 적용 — ${vixGating.reason}`);
  }
  if (fomcProximity.kellyMultiplier !== 1) {
    console.log(`[AutoTrade] FOMC 게이팅 적용 — ${fomcProximity.description}`);
  }
  if (kellyMultiplier !== regimeConfig.kellyMultiplier) {
    console.log(
      `[AutoTrade] Kelly 배율 분해: 레짐 ${regime}(×${regimeConfig.kellyMultiplier}) × ` +
      `VIX(×${vixGating.kellyMultiplier.toFixed(2)}) × FOMC(×${fomcProximity.kellyMultiplier.toFixed(2)}) ` +
      `× 계좌(×${accountKellyMultiplier.toFixed(2)}) = raw ×${rawKelly.toFixed(3)}` +
      `${rawKelly < KELLY_FLOOR ? ` → floor ×${KELLY_FLOOR}` : ''} → 유효 ×${kellyMultiplier.toFixed(2)}`,
    );
  }

  // ── 11. effectiveMaxPositions / activeSwingCount ──────────────────────────
  const MAX_CONVICTION_POSITIONS = Number(process.env.MAX_CONVICTION_POSITIONS ?? '8');
  const effectiveMaxPositions = Math.min(
    MAX_CONVICTION_POSITIONS,
    sellOnlyExc.allow
      ? Math.min(regimeConfig.maxPositions, sellOnlyExc.maxSlots)
      : regimeConfig.maxPositions,
  );
  const activeSwingCount = shadows.filter(
    (s) => isOpenShadowStatus(s.status) &&
           s.watchlistSource !== 'INTRADAY' &&
           s.watchlistSource !== 'PRE_BREAKOUT',
  ).length;
  if (activeSwingCount >= effectiveMaxPositions) {
    console.log(
      `[AutoTrade] 최대 동시 포지션 도달 (${activeSwingCount}/${effectiveMaxPositions}${sellOnlyExc.allow ? ' · SELL_ONLY 예외 캡' : ''}, 레짐 ${regime}) — 신규 진입 스킵`,
    );
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, abortReason: 'POSITION_FULL', positionFull: true, sellOnly };
  }

  // ── 12. Volume Clock ──────────────────────────────────────────────────────
  const volumeClock = checkVolumeClockWindow();
  if (!volumeClock.allowEntry) {
    console.log(volumeClock.reason);
    console.log(
      `[AutoTrade] 매수 대기 종목 ${input.buyListLength ?? 0}개 대기 중 (허용 구간: 10:00~11:30, 14:00~14:50 KST)`,
    );
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { shouldAbort: true, abortReason: 'VOLUME_CLOCK', sellOnly };
  }
  if (volumeClock.scoreBonus !== 0) {
    console.log(volumeClock.reason);
  }

  // ── 13. 통과 — 컨텍스트 반환 ──────────────────────────────────────────────
  return {
    shouldAbort: false,
    sellOnly,
    totalAssets,
    orderableCash,
    activeHoldingValue,
    shadowMode,
    shadows,
    conditionWeights,
    regime,
    regimeConfig,
    macroState,
    vixGating,
    fomcProximity,
    ipsKelly,
    accountKellyMultiplier,
    kellyMultiplier,
    sellOnlyExc,
    effectiveMaxPositions,
    volumeClock,
  };
}
