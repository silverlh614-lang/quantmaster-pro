/**
 * signalScanner.ts — 장중 자동 신호 스캔 오케스트레이터
 *
 * 세부 로직은 다음 서브모듈로 분리됨:
 *   entryEngine.ts  — 진입 검증 유틸리티 (EXIT_RULE_PRIORITY_TABLE, buildStopLossPlan, calculateOrderQuantity, evaluateEntryRevalidation, isOpenShadowStatus)
 *   exitEngine.ts   — 포지션 모니터링 및 청산 엔진 (updateShadowResults)
 *   buyPipeline.ts  — 매수 실행 공통 헬퍼 (MTAS 배수, Gate 조회, Trade 빌더, 승인 큐)
 */

import {
  fetchCurrentPrice, fetchAccountBalance,
  fetchKisInvestorFlow,
} from '../clients/kisClient.js';
import { getRealtimePrice, subscribeStock } from '../clients/kisStreamClient.js';

/**
 * 실시간 가격 맵 우선 조회 → REST fallback.
 * KIS WebSocket H0STCNT0 구독 중이면 인메모리 맵에서 즉시 반환,
 * 미구독/stale 시에만 REST fetchCurrentPrice 호출.
 */
async function getPrice(stockCode: string): Promise<number | null> {
  const rtPrice = getRealtimePrice(stockCode);
  if (rtPrice !== null) return rtPrice;
  // 미구독 종목은 즉시 구독 등록 (다음 호출부터 실시간)
  subscribeStock(stockCode);
  return fetchCurrentPrice(stockCode).catch(() => null);
}
import { getDartFinancials } from '../clients/dartFinancialClient.js';
import { getKellyMultiplier as getIpsKellyMultiplier, loadKellyDampenerState } from './kellyDampener.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelBuySignalEmitted } from '../alerts/channelPipeline.js';
import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';
import { loadIntradayWatchlist } from '../persistence/intradayWatchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import {
  type ServerShadowTrade,
  type EntryKellySnapshot,
  getRemainingQty,
  loadShadowTrades, saveShadowTrades, appendShadowLog,
} from '../persistence/shadowTradeRepo.js';
import { isBlacklisted } from '../persistence/blacklistRepo.js';
import {
  RRR_MIN_THRESHOLD, MAX_SECTOR_CONCENTRATION,
  calcRRR,
} from './riskManager.js';
import { evaluatePortfolioRisk } from './portfolioRiskEngine.js';
import { checkSectorExposureBefore } from './preOrderGuard.js';
import { getSectorByCode } from '../screener/sectorMap.js';
import { getExecutionCostConfig } from './executionCosts.js';
import { classifySizingTier, PROBING_MAX_SLOTS } from './sizingTier.js';
import {
  decideProbingSlotBudget, canReserveBanditProbingSlot, buildArmKey,
  type BanditDecision,
} from '../learning/probingBandit.js';
import { checkFailurePattern } from '../learning/failurePatternDB.js';
import { buildEntryConditionScores } from '../learning/entryConditionScores.js';
import { evaluateCorrelationGate } from './correlationSlotGate.js';
import { recordCounterfactual, COUNTERFACTUAL_DAILY_CAP } from '../learning/counterfactualShadow.js';
import { recordUniverseEntries } from '../learning/ledgerSimulator.js';

/**
 * Idea 7 — 진입 차단 유사도 임계값 (0~100). 85% 이상 일치하는 실패 패턴이 존재하면 진입 차단.
 * failurePatternDB 의 SIMILARITY_THRESHOLD (매칭 임계) 보다 엄격하게 운용 가능.
 */
const FAILURE_BLOCK_THRESHOLD_PCT = Number(process.env.FAILURE_BLOCK_THRESHOLD_PCT ?? '85');
import type { FullRegimeConfig } from '../../src/types/core.js';
import type { MacroState } from '../persistence/macroStateRepo.js';
import { getManualBlockNewBuy, getManualManageOnly } from '../state.js';

// ── Phase 2-③: SELL_ONLY Top-K 예외 채널 평가 ─────────────────────────────────
// regimeConfig.sellOnlyException.enabled=true 일 때만 작동.
// 4중 AND 조건: liveGate≥minLiveGate && MTAS≥minMtas && sectorAligned && VIX<maxVix.
// liveGate·MTAS 는 종목 단위라 이 평가에서는 매크로(sectorAligned + VIX) 만 선검증.
interface SellOnlyExceptionDecision {
  allow: boolean;
  maxSlots: number;
  kellyFactor: number;
  minLiveGate: number;
  minMtas: number;
  reason: string;
}
function evaluateSellOnlyException(
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
import { getLiveRegime } from './regimeBridge.js';
import { REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';
import { PROFIT_TARGETS } from '../../src/services/quant/sellEngine.js';
import { addRecommendation } from '../learning/recommendationTracker.js';
import { getAccountRiskBudget, computeRiskAdjustedSize, FRACTIONAL_KELLY_CAP } from './accountRiskBudget.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { evaluateServerGate } from '../quantFilter.js';
import {
  computeFocusCodes, applyEntryPriceDrift, assignSection,
  CATALYST_POSITION_FACTOR, CATALYST_FIXED_STOP_PCT,
} from '../screener/watchlistManager.js';
import { fetchYahooQuote, fetchKisQuoteFallback, enrichQuoteWithKisMTAS, fetchKisIntraday } from '../screener/stockScreener.js';
import { isDataStarvedScan, getCompletenessSnapshot } from '../screener/dataCompletenessTracker.js';
import { fillMonitor } from './fillMonitor.js';
import { trancheExecutor } from './trancheExecutor.js';
import { getVixGating } from './vixGating.js';
import { getFomcProximity } from './fomcCalendar.js';
import {
  MAX_INTRADAY_POSITIONS,
  INTRADAY_POSITION_PCT_FACTOR,
  INTRADAY_STOP_LOSS_PCT,
  INTRADAY_PULLBACK_STOP_LOSS_PCT,
  INTRADAY_TARGET_PCT,
} from '../screener/intradayScanner.js';
import {
  isOpenShadowStatus,
  buildStopLossPlan,
  formatStopLossBreakdown,
  calculateOrderQuantity,
  reconcileDayOpen,
  evaluateEntryRevalidation,
  getMinGateScore,
  getKstMarketElapsedMinutes,
} from './entryEngine.js';
import { updateShadowResults } from './exitEngine.js';
import { type ApprovalAction } from '../telegram/buyApproval.js';
import { checkCooldownRelease } from './regretAsymmetryFilter.js';
import { checkVolumeClockWindow } from './volumeClock.js';
import { detectPreBreakoutAccumulation } from './preBreakoutAccumulationDetector.js';
import { appendScanTraces, type ScanTrace } from './scanTracer.js';
import {
  computeMtasMultiplier,
  computeRawPositionPct,
  fetchGateData,
  buildBuyTrade,
  createBuyTask,
  type LiveBuyTask,
} from './buyPipeline.js';

// ── 서브모듈 re-export (하위 호환성 유지) ──────────────────────────────────────
export type {
  StopLossPlan,
  PositionSizingInput,
} from './entryEngine.js';
export {
  EXIT_RULE_PRIORITY_TABLE,
  isOpenShadowStatus,
  buildStopLossPlan,
  calculateOrderQuantity,
  reconcileDayOpen,
  evaluateEntryRevalidation,
  regimeToStopRegime,
} from './entryEngine.js';
export { getRemainingQty } from '../persistence/shadowTradeRepo.js';

// ── 스캔 진단 상태 (파이프라인 헬스체크 · 침묵 실패 탐지용) ─────────────────────
export interface ScanSummary {
  time: string;          // "HH:MM KST"
  candidates: number;    // SWING + CATALYST + Intraday 합산
  /** @deprecated trackB → swing + catalyst 합산. 하위 호환용. */
  trackB: number;        // buyList.length (main 워치리스트)
  swing: number;         // SWING 섹션 매수 대상 수
  catalyst: number;      // CATALYST 섹션 매수 대상 수
  momentum: number;      // MOMENTUM 섹션 관찰 전용 수
  yahooFails: number;    // Yahoo + KIS fallback 모두 실패한 종목 수
  gateMisses: number;    // entryRevalidation 탈락 수
  rrrMisses: number;     // RRR < 최솟값 탈락 수
  entries: number;       // 실제 진입(Shadow 포함 신호 등록) 수
}
let _lastBuySignalAt = 0;
let _consecutiveZeroScans = 0;
let _lastScanSummary: ScanSummary | null = null;

export function getLastBuySignalAt(): number    { return _lastBuySignalAt; }
export function getLastScanSummary(): ScanSummary | null { return _lastScanSummary; }
export function getConsecutiveZeroScans(): number { return _consecutiveZeroScans; }

function getAccountScaleKellyMultiplier(totalAssets: number): number {
  if (totalAssets >= 300_000_000) return 1.15;
  if (totalAssets >= 100_000_000) return 1.08;
  if (totalAssets <= 20_000_000) return 0.92;
  return 1.0;
}

/**
 * 종목 단위 상태 — getAdaptiveProfitTargets() 의 선택적 컨텍스트.
 *
 *   profileType
 *     'LEADER'      — 주도주 추세 보유 강화 → 익절 라인 약간 상향, 트레일링 넓힘
 *     'CATALYST'    — 단기 촉매 → 1차 익절 비중 확대(보수화)
 *     'OVERHEATED'  — 고점/뉴스 과열 → 1차 익절 조기화 + 트레일링 짧게
 *     'DIVERGENT'   — 거래량/RSI 다이버전스 → 트레일링 짧게
 *
 * 셋 다 미지정이면 macro 만 반영 (기존 동작과 100% 호환).
 */
export interface SymbolExitContext {
  profileType?: 'LEADER' | 'CATALYST' | 'OVERHEATED' | 'DIVERGENT';
  sector?: string;
  watchlistSource?: string;
}

function getAdaptiveProfitTargets(
  regime: keyof typeof PROFIT_TARGETS,
  macroState: MacroState | null,
  symbolCtx?: SymbolExitContext,
): { targets: typeof PROFIT_TARGETS[typeof regime]; trailPctAdjust: number; reason: string } {
  const vix = macroState?.vix ?? null;
  const mhs = macroState?.mhs ?? null;

  // ── 1) Macro overlay (기존 로직 유지) ────────────────────────────────────
  let macroTriggerAdjust = 0;
  let macroTrailAdjust   = 0;
  let macroReason = 'macro:기본';
  if ((mhs != null && mhs >= 70) || (vix != null && vix <= 18) || regime === 'R1_TURBO' || regime === 'R2_BULL') {
    macroTriggerAdjust = 0.02;
    macroTrailAdjust   = 0.02;
    macroReason = 'macro:risk-on 확장(트레일링 넓힘)';
  } else if ((mhs != null && mhs <= 45) || (vix != null && vix >= 24) || regime === 'R5_CAUTION' || regime === 'R6_DEFENSE') {
    macroTriggerAdjust = -0.02;
    macroTrailAdjust   = -0.02;
    macroReason = 'macro:risk-off 보수화(익절 조기화)';
  }

  // ── 2) Symbol overlay — 주도주 추세 / 과열 / 다이버전스 ──────────────────
  // 의견(사용자 P1-1) 반영: 같은 레짐에서도 종목 상태에 따라 익절 강도를 차등화.
  // 변경량은 macro 와 합산되며, 최종 trigger 는 floor 3% / ceiling 25% 로 클램프.
  let symbolTriggerAdjust = 0;
  let symbolTrailAdjust   = 0;
  let symbolReason: string | null = null;
  switch (symbolCtx?.profileType) {
    case 'LEADER':
      // 주도주 — 추세 보유. 1차 익절 늦추고 트레일링은 더 넓힘.
      symbolTriggerAdjust = 0.01;
      symbolTrailAdjust   = 0.02;
      symbolReason = 'symbol:LEADER(추세보유 강화)';
      break;
    case 'CATALYST':
      // 단기 촉매 — 1차 익절 약간 조기화하여 회수 우선.
      symbolTriggerAdjust = -0.01;
      symbolTrailAdjust   = -0.01;
      symbolReason = 'symbol:CATALYST(1차 익절 조기화)';
      break;
    case 'OVERHEATED':
      // 고점/뉴스 과열 — 1차 익절 빠르게, 트레일링 짧게.
      symbolTriggerAdjust = -0.02;
      symbolTrailAdjust   = -0.03;
      symbolReason = 'symbol:OVERHEATED(과열 방어)';
      break;
    case 'DIVERGENT':
      // 다이버전스 — 트레일링만 강화 (트리거는 유지).
      symbolTrailAdjust   = -0.02;
      symbolReason = 'symbol:DIVERGENT(트레일링 강화)';
      break;
    default:
      break;
  }

  const triggerAdjust = macroTriggerAdjust + symbolTriggerAdjust;
  const trailPctAdjust = macroTrailAdjust + symbolTrailAdjust;
  const reason = [macroReason, symbolReason].filter(Boolean).join(' + ');

  return {
    targets: PROFIT_TARGETS[regime].map((target) => {
      if (target.type !== 'LIMIT' || target.trigger == null) return target;
      // floor 3% / ceiling 25% — 합성 효과로 양 극단까지 가지 않도록 클램프.
      const adjusted = Math.max(0.03, Math.min(0.25, target.trigger + triggerAdjust));
      return {
        ...target,
        trigger: Number(adjusted.toFixed(3)),
      };
    }),
    trailPctAdjust,
    reason,
  };
}

/**
 * 아이디어 1: 장중 자동 신호 스캔
 * - 관심 종목 현재가 조회
 * - 진입 조건 판정: 현재가 ≥ entryPrice AND 손절선 이상
 * - 조건 충족 시 Shadow 또는 실 주문 실행
 *
 * options.sellOnly: true → 신규 매수 없이 기존 포지션 모니터링만 실행
 *   (VKOSPI 급등·R6_DEFENSE·마감 급변 시 adaptiveScanScheduler가 호출)
 */
export async function runAutoSignalScan(options?: { sellOnly?: boolean; forceBuyCodes?: string[] }): Promise<{ positionFull?: boolean }> {
  if (!process.env.KIS_APP_KEY) {
    console.warn('[AutoTrade] KIS_APP_KEY 미설정 — 스캔 건너뜀');
    return {};
  }

  // UI 수동 가드 — EmergencyActionsPanel 버튼으로 설정된 "신규 매수 차단" /
  // "보유만 관리" 를 sellOnly 로 승격시켜 신규 진입만 차단. 청산·모니터링은
  // 기존 sellOnly 분기가 처리하므로 추가 분기 불필요.
  const manualBlockNewBuy = getManualBlockNewBuy();
  const manualManageOnly = getManualManageOnly();
  if ((manualBlockNewBuy || manualManageOnly) && !options?.sellOnly) {
    const reason = manualManageOnly ? '보유만 관리 모드' : '신규 매수 차단';
    console.warn(`[AutoTrade] UI 수동 가드 활성 (${reason}) — sellOnly 로 승격`);
    options = { ...(options ?? {}), sellOnly: true };
  }

  const watchlist = loadWatchlist();
  if (watchlist.length === 0) return {};

  // 3-섹션 구조 — SWING/CATALYST만 매수 스캔, MOMENTUM은 관찰 전용
  // isFocus를 스캔 시점에 실시간 계산 (cleanupWatchlist은 16:00에만 실행되므로
  // 08:35에 추가된 AUTO 종목의 isFocus가 미설정 상태일 수 있음)
  const liveFocusCodes = computeFocusCodes(watchlist);
  const forceCodes = new Set(options?.forceBuyCodes ?? []);

  // 실시간 section 할당
  for (const w of watchlist) {
    w.section = assignSection(w, liveFocusCodes);
  }

  // Idea 1 — Shadow Portfolio 50 확장.
  // AUTO_SHADOW_FROM_MOMENTUM=true (기본) 이면 MOMENTUM 섹션을 buyList 에 포함시켜
  // 모든 후보에 대해 Shadow 가상 체결을 집행하고 학습 표본을 5배 확대한다. 실 자본
  // 경로 격리는 아래 per-stock `forceSectionShadow` 가 담당한다.
  const AUTO_SHADOW_FROM_MOMENTUM = process.env.AUTO_SHADOW_FROM_MOMENTUM !== 'false';
  const buyList = watchlist.filter(
    (w) =>
      w.section === 'SWING' ||
      w.section === 'CATALYST' ||
      (AUTO_SHADOW_FROM_MOMENTUM && w.section === 'MOMENTUM') ||
      forceCodes.has(w.code),
  );
  const swingList    = watchlist.filter((w) => w.section === 'SWING');
  const catalystList = watchlist.filter((w) => w.section === 'CATALYST');
  const momentumList = watchlist.filter((w) => w.section === 'MOMENTUM');

  // 진단 로그: MOMENTUM 처리 경로 — 플래그에 따라 학습/관찰 분기
  if (momentumList.length > 0) {
    const scope = AUTO_SHADOW_FROM_MOMENTUM ? 'Shadow 학습' : '관찰 전용';
    console.log(
      `[AutoTrade] MOMENTUM ${scope} ${momentumList.length}개: ` +
      momentumList.slice(0, 10).map(w => `${w.name}(${w.code}) gate=${w.gateScore ?? 0}`).join(', ') +
      (momentumList.length > 10 ? ` ...외 ${momentumList.length - 10}개` : ''),
    );
  }
  let watchlistMutated = false;

  // 스캔 통계 카운터 (침묵 실패 탐지 · 파이프라인 헬스)
  let _scanYahooFails = 0;
  let _scanGateMisses = 0;
  let _scanRrrMisses  = 0;
  let _scanEntries    = 0;
  // Idea 4 — 일일 Counterfactual 기록 상한 (COUNTERFACTUAL_DAILY_CAP).
  let _counterfactualRecordedToday = 0;

  // 파이프라인 트레이서 버퍼 — 스캔 종료 시 일괄 파일 기록 (아이디어 10)
  const _pendingTraces: ScanTrace[] = [];

  // 장중 워치리스트: intradayReady=true 항목만 진입 후보
  const intradayBuyList = loadIntradayWatchlist().filter(w => w.intradayReady === true);

  const shadowMode = process.env.AUTO_TRADE_MODE !== 'LIVE'; // 기본 Shadow 모드

  // 투자 총자산: 환경변수 → KIS 계좌 주문가능현금+기본값 순으로 결정
  let totalAssets = Number(process.env.AUTO_TRADE_ASSETS || 0);
  const balance = await fetchAccountBalance().catch(() => null);
  if (!totalAssets) totalAssets = balance ?? 30_000_000; // 모의계좌 기본 3천만원
  let orderableCash = balance ?? totalAssets;
  const conditionWeights = loadConditionWeights();
  let activeHoldingValue = 0;

  console.log(
    `[AutoTrade] 스캔 시작 — 워치리스트 ${watchlist.length}개 (SWING ${swingList.length}개 / CATALYST ${catalystList.length}개 / MOMENTUM ${momentumList.length}개) / Intraday Ready ${intradayBuyList.length}개 / 모드: ${shadowMode ? 'SHADOW' : 'LIVE'}`
  );

  const shadows = loadShadowTrades();
  if (shadowMode || balance === null) {
    activeHoldingValue = shadows
      .filter((s) => isOpenShadowStatus(s.status))
      .reduce((sum, s) => sum + (s.shadowEntryPrice * s.quantity), 0);
    orderableCash = Math.max(0, orderableCash - activeHoldingValue);
  }

  console.log(
    `[AutoTrade] 실주문 기준 현금 — 총자산: ${totalAssets.toLocaleString()}원 / 주문가능현금: ${orderableCash.toLocaleString()}원 / Shadow 보유가치: ${activeHoldingValue.toLocaleString()}원 / 모드: ${shadowMode ? 'SHADOW' : 'LIVE'}`
  );

  // ── 레짐 분류 (classifyRegime — backtestPortfolio와 동일 로직) ──────────────
  const macroState = loadMacroState();
  const regime      = getLiveRegime(macroState);
  const regimeConfig = REGIME_CONFIGS[regime];

  // SELL_ONLY 모드: 신규 매수 없이 기존 포지션 모니터링만 실행
  // (adaptiveScanScheduler — VKOSPI 급등·R6_DEFENSE·마감 급변 구간 호출)
  //
  // Phase 2-③: regimeConfig.sellOnlyException 가 켜져 있고 macro 4중 조건이
  // 모두 만족되면, maxSlots(1~2) 한정으로 신규 매수를 허용한다. Kelly 는 ×0.5
  // 추가 감쇠, 종목별 liveGate·MTAS 재검증은 루프 안쪽에서 수행.
  const sellOnlyExc = options?.sellOnly
    ? evaluateSellOnlyException(regimeConfig, macroState)
    : { allow: false, maxSlots: 0, kellyFactor: 1, minLiveGate: 0, minMtas: 0, reason: 'not-sellOnly' };
  if (options?.sellOnly && !sellOnlyExc.allow) {
    console.log(`[AutoTrade] SELL_ONLY 모드 — 포지션 모니터링 전용 (예외 불가: ${sellOnlyExc.reason})`);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return {};
  }
  if (options?.sellOnly && sellOnlyExc.allow) {
    console.log(
      `[AutoTrade] SELL_ONLY 예외 채널 활성 — ${sellOnlyExc.reason} | ` +
      `maxSlots=${sellOnlyExc.maxSlots}, Kelly×${sellOnlyExc.kellyFactor}, Gate≥${sellOnlyExc.minLiveGate}, MTAS≥${sellOnlyExc.minMtas}`,
    );
  }

  if (regime === 'R6_DEFENSE') {
    await sendTelegramAlert(
      `🔴 <b>[R6_DEFENSE] 신규 진입 전면 차단</b>\n` +
      `MHS: ${macroState?.mhs ?? 'N/A'} | 블랙스완 감지 — 기존 포지션 모니터링만 수행`
    ).catch(console.error);
    console.warn(`[AutoTrade] R6_DEFENSE (MHS=${macroState?.mhs}) — 신규 진입 전면 차단`);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return {};
  }

  // ── VIX 게이팅 — 레짐 Kelly와 교차 적용 ──────────────────────────────────
  const vixGating = getVixGating(macroState?.vix, macroState?.vixHistory ?? []);
  if (vixGating.noNewEntry) {
    console.warn(`[AutoTrade] VIX 게이팅 — 신규 진입 중단: ${vixGating.reason}`);
    await sendTelegramAlert(
      `🚨 <b>[VIX 게이팅] 신규 진입 차단</b>\n` +
      `${vixGating.reason}\n` +
      `포지션 모니터링만 수행합니다.`
    ).catch(console.error);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return {};
  }

  // ── FOMC 게이팅 ───────────────────────────────────────────────────────────
  const fomcProximity = getFomcProximity();
  if (fomcProximity.noNewEntry) {
    console.warn(`[AutoTrade] FOMC 게이팅 — 신규 진입 차단: ${fomcProximity.description}`);
    await sendTelegramAlert(
      `📅 <b>[FOMC 게이팅] 신규 진입 차단</b>\n` +
      `${fomcProximity.description}\n` +
      `포지션 모니터링만 수행합니다.`
    ).catch(console.error);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return {};
  }

  // ── Data Degradation Gate: 데이터 빈곤 스캔이면 신규 진입 보류 ───────────
  // "신호 부재"와 "데이터 부재"를 분리 — 데이터가 없으면 대응 자체가 달라야 한다.
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
    return {};
  }

  // 레짐 Kelly × VIX Kelly × FOMC Kelly × IPS 변곡 감쇠 → 유효 배율
  // 최소 하한선 0.15 — 누적 패널티가 과도하게 쌓여 포지션이 의미 없이 작아지는 것을 방지
  const KELLY_FLOOR = 0.15;
  const ipsKelly = getIpsKellyMultiplier();
  const accountKellyMultiplier = getAccountScaleKellyMultiplier(totalAssets);
  // Phase 2-③: SELL_ONLY 예외 채널 진입 시 Kelly ×0.5 (kellyFactor) 추가 감쇠
  const exceptionKellyFactor = sellOnlyExc.allow ? sellOnlyExc.kellyFactor : 1;
  const rawKelly = regimeConfig.kellyMultiplier * vixGating.kellyMultiplier * fomcProximity.kellyMultiplier * ipsKelly * exceptionKellyFactor * accountKellyMultiplier;
  const kellyMultiplier = Math.min(
    1.5,  // 상한 캡 (POST 부스트 구간에서도 최대 1.5배)
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
  // 진단 로그: 각 패널티 구성 요소를 분해하여 기록
  if (kellyMultiplier !== regimeConfig.kellyMultiplier) {
    console.log(
      `[AutoTrade] Kelly 배율 분해: 레짐 ${regime}(×${regimeConfig.kellyMultiplier}) × ` +
      `VIX(×${vixGating.kellyMultiplier.toFixed(2)}) × FOMC(×${fomcProximity.kellyMultiplier.toFixed(2)}) ` +
      `× 계좌(×${accountKellyMultiplier.toFixed(2)}) = raw ×${rawKelly.toFixed(3)}` +
      `${rawKelly < KELLY_FLOOR ? ` → floor ×${KELLY_FLOOR}` : ''} → 유효 ×${kellyMultiplier.toFixed(2)}`,
    );
  }

  // Idea 10 — Minimal Real Positions. 페르소나 원칙 "계좌 생존 우선" 에 맞춰
  // 실 자본 포지션은 CONVICTION 등급 소수로 집중. 기본 8 로 설정 (레짐 maxPositions 의 min).
  // MOMENTUM Shadow / PRE_BREAKOUT / INTRADAY 는 이 캡과 무관.
  const MAX_CONVICTION_POSITIONS = Number(process.env.MAX_CONVICTION_POSITIONS ?? '8');

  // ── 동시 최대 보유 종목 (regimeConfig.maxPositions) ─────────────────────────
  // INTRADAY 포지션은 별도 한도(MAX_INTRADAY_POSITIONS)로 관리하므로 제외한다.
  // BUG-09 fix: PRE_BREAKOUT(30% 선취매)도 제외 — 선취매는 탐색적 소량 포지션이므로
  // 스윙 한도에 포함하면 같은 종목의 일반 스윙 진입이 이중 차단됨.
  // Phase 2-③: SELL_ONLY 예외 시 maxSlots 캡과 min 으로 제한.
  // Idea 10: CONVICTION 캡을 레짐 기반 상한과 min 으로 합성. 레짐이 여유롭더라도
  // 실 자본 집중도를 유지하려면 절대 상한을 더 엄격히 적용. env 로 조정 가능.
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
      `[AutoTrade] 최대 동시 포지션 도달 (${activeSwingCount}/${effectiveMaxPositions}${sellOnlyExc.allow ? ' · SELL_ONLY 예외 캡' : ''}, 레짐 ${regime}) — 신규 진입 스킵`
    );
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return { positionFull: true };
  }

  // ── Volume Clock — 발주 허용 시간대 확인 ──────────────────────────────────
  const volumeClock = checkVolumeClockWindow();
  if (!volumeClock.allowEntry) {
    console.log(volumeClock.reason);
    console.log(
      `[AutoTrade] 매수 대기 종목 ${buyList.length}개 대기 중 (허용 구간: 10:00~11:30, 14:00~14:50 KST)`,
    );
    // 시간대 차단 시에도 포지션 모니터링(청산)은 계속 수행
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return {};
  }
  if (volumeClock.scoreBonus !== 0) {
    console.log(volumeClock.reason);
  }

  // 매수 승인 큐 (LIVE/Shadow 공통) — 승인 요청을 병렬 발송하고 루프 완료 후 일괄 처리
  // (순차 대기 시 종목당 최대 3분 × N종목 = 총 N×3분 블로킹 방지)
  const liveBuyQueue: LiveBuyTask[] = [];
  // Phase 1 ①: 원자적 슬롯 예약 — 큐 푸시 시점에 예약 카운터 증가, 실패한 예약은 롤백.
  // 루프 내 currentActive 만 보던 기존 로직은 같은 tick 안에서 이미 큐에 들어간 N-1개를
  // 보지 못해 maxPositions 초과 승인을 허용했다(00:40 사건). reservedSlots 로 이를 차단.
  let reservedSlots = 0;
  // Phase 4-⑧(수정): sizingTier — PROBING 은 전체 maxPositions 안에서 최대 1슬롯 허용.
  // 워치리스트 구조·총 포지션 수는 그대로 유지하고 Kelly 만 티어별로 차등 적용.
  let probingReservedSlots = 0;
  // Idea 6 — Thompson Sampling bandit: 이번 스캔의 PROBING 슬롯 동적 예산.
  // buyList 에 나타날 수 있는 arm key(signalType × profileType) 를 상한으로 세팅하여
  // 최악 케이스에서도 보너스 슬롯이 할당되도록 한다. 실제 슬롯 점유는
  // canReserveBanditProbingSlot() 가 증가분만큼 허용한다.
  const _banditCandidateArms: string[] = [];
  for (const w of buyList) {
    const sig = (w.gateScore ?? 0) >= 9 ? 'STRONG_BUY' : 'BUY';
    _banditCandidateArms.push(buildArmKey({ signalType: sig, profileType: w.profileType ?? null }));
  }
  // PROBING tier 자체도 하나의 arm 으로 보강 — 히스토리가 희박한 PROBING 라인은 항상 탐색 가치.
  _banditCandidateArms.push('PROBING:X');
  const banditDecision: BanditDecision = decideProbingSlotBudget(_banditCandidateArms);
  if (banditDecision.budget > 1) {
    console.log(
      `[AutoTrade/Bandit] PROBING 동적 예산 ×${banditDecision.budget} (base ${1}) — ${banditDecision.rationale}`,
    );
  }
  // Phase 1 ②: 섹터 노출 선검증용 — 현재 보유 + 같은 tick 예약분을 합산해 투영 비중 계산.
  const currentSectorValue = new Map<string, number>();
  for (const s of shadows) {
    if (!isOpenShadowStatus(s.status) || s.watchlistSource === 'INTRADAY') continue;
    const sec = getSectorByCode(s.stockCode) || '미분류';
    const val = s.shadowEntryPrice * s.quantity;
    currentSectorValue.set(sec, (currentSectorValue.get(sec) ?? 0) + val);
  }
  const pendingSectorValue = new Map<string, number>();
  const reservedSectorValues: Array<{ sector: string; value: number }> = [];
  // Phase 4-⑧(수정): 큐 인덱스별 티어 — 플러시 시 PROBING 실패 예약도 정확히 롤백.
  const reservedTiers: Array<'PROBING' | 'OTHER'> = [];
  // Idea 1: 큐 인덱스별 MOMENTUM Shadow 여부 — 플러시 롤백 시 reservedSlots 를
  // 감소시키지 않도록(애초에 증가하지 않음) 구분한다.
  const reservedIsMomentum: boolean[] = [];
  // BUG #3 fix — 승인 전 예약된 효과 자본(원). onApproved 이 아닌 큐 푸시 시점에
  // 동기적으로 차감해 "같은 스캔의 다음 후보가 이미 예약된 현금을 다시 쓰는" 레이스를 차단.
  // 롤백 시 reservedBudgets[i] 만큼 orderableCash 를 복원한다.
  const reservedBudgets: number[] = [];

  for (const stock of buyList) {
    // Idea 1 — MOMENTUM 은 AUTO_SHADOW_FROM_MOMENTUM 경로에서 강제 SHADOW 로 귀속된다.
    // LIVE 모드 스캔 중에도 MOMENTUM 후보는 실 자본을 쓰지 않고 학습 표본만 남긴다.
    // 이 플래그가 true 인 스톡은 슬롯/섹터/오더 현금 예약에서 제외된다.
    const isMomentumShadow = stock.section === 'MOMENTUM';
    const stockShadowMode = shadowMode || isMomentumShadow;

    // 아이디어 7: 루프 내에서도 포지션 수 재확인 (같은 스캔 중 복수 진입 방지)
    // BUG-09 정합성: 사전 점검(activeSwingCount)이 PRE_BREAKOUT(30% 선취매)을 제외하는 것과
    // 동일 기준을 적용해야 한다. 루프 내에서만 PRE_BREAKOUT을 포함하면 사전 점검은 "여유 있음",
    // 루프는 "만석"이라 판정해 보유 슬롯이 남았음에도 매수가 전혀 발생하지 않는 무성 실패가 난다.
    const currentActive = shadows.filter(
      (s) => isOpenShadowStatus(s.status) &&
             s.watchlistSource !== 'INTRADAY' &&
             s.watchlistSource !== 'PRE_BREAKOUT',
    ).length;
    const totalCommitted = currentActive + reservedSlots;
    if (!isMomentumShadow && totalCommitted >= effectiveMaxPositions) {
      // MOMENTUM Shadow 는 LIVE 슬롯 한도에 귀속되지 않으므로 이 가드를 건너뛴다.
      console.log(
        `[AutoTrade] 최대 포지션 도달 (활성 ${currentActive} + 예약 ${reservedSlots} = ${totalCommitted}/${effectiveMaxPositions}${sellOnlyExc.allow ? ' · SELL_ONLY 예외 캡' : ''}, 레짐 ${regime}) — 나머지 종목 스킵`,
      );
      break;
    }

    try {
      const stageLog: Record<string, string> = {};
      const pushTrace = () => _pendingTraces.push({
        ts: new Date().toISOString().slice(11, 19),
        stock: stock.code,
        name:  stock.name,
        stages: { ...stageLog },
      });

      const currentPrice = await getPrice(stock.code);
      if (!currentPrice) { stageLog.price = 'FAIL'; pushTrace(); continue; }
      stageLog.price = 'PASS';

      // ── entryPrice 드리프트 체크: 현재가가 10% 이상 올랐으면 갱신/제거 ─────
      const driftAction = applyEntryPriceDrift(stock, currentPrice);
      if (driftAction === 'REMOVE') {
        const driftPct = ((currentPrice - stock.entryPrice) / stock.entryPrice * 100).toFixed(1);
        console.log(
          `[AutoTrade] ${stock.name}(${stock.code}) entryPrice 드리프트 제거 — ` +
          `현재가 ${currentPrice.toLocaleString()} vs entryPrice ${stock.entryPrice.toLocaleString()} (+${driftPct}%)`,
        );
        const idx = watchlist.findIndex(w => w.code === stock.code);
        if (idx >= 0) { watchlist.splice(idx, 1); watchlistMutated = true; }
        stageLog.drift = 'REMOVE';
        pushTrace();
        continue;
      }
      if (driftAction === 'UPDATE') {
        const oldEntry = stock.entryPrice;
        stock.entryPrice = currentPrice;
        watchlistMutated = true;
        console.log(
          `[AutoTrade] ${stock.name}(${stock.code}) entryPrice 트레일 업 — ` +
          `${oldEntry.toLocaleString()} → ${currentPrice.toLocaleString()} (+10% 이상 드리프트)`,
        );
        stageLog.drift = 'UPDATE';
        pushTrace();
        continue; // 이번 스캔에서는 진입 시도하지 않음 (갱신 직후 안정화 대기)
      }

      // 당일 날짜 (재진입 방지 + PRE_BREAKOUT 추종 중복 방지 공통 사용)
      const today = new Date().toISOString().split('T')[0];

      // ── Pre-Breakout: 선취매 포지션 확인 → 돌파 추종 실행 ──────────────────
      const activePreBreakout = shadows.find(
        s => s.stockCode === stock.code &&
             s.watchlistSource === 'PRE_BREAKOUT' &&
             isOpenShadowStatus(s.status)
      );

      if (activePreBreakout) {
        if (currentPrice >= stock.entryPrice) {
          // 돌파 확인! 나머지 70% 추종 매수 실행
          const followAlreadyDone = shadows.some(
            s => s.stockCode === stock.code &&
                 s.watchlistSource === 'PRE_BREAKOUT_FOLLOWTHROUGH' &&
                 (isOpenShadowStatus(s.status) || s.signalTime.startsWith(today))
          );
          if (!followAlreadyDone && !isBlacklisted(stock.code)) {
            const slippage = getExecutionCostConfig().slippageRate;
            const followEntryPrice = Math.round(currentPrice * (1 + slippage));

            // BUG-08 fix: 추종 매수 시 새 진입가 기준 RRR 재검증
            const followRRR = calcRRR(followEntryPrice, stock.targetPrice, stock.stopLoss);
            if (followRRR < RRR_MIN_THRESHOLD) {
              console.log(
                `[PreBreakout] ${stock.name}(${stock.code}) 추종 RRR ${followRRR.toFixed(2)} < ${RRR_MIN_THRESHOLD} — 추종 매수 제외`
              );
              continue;
            }

            // BUG-05 fix: MTAS 기반 포지션 조정 (Pre-Breakout 추종에도 적용)
            const gateScoreFollow = (stock.gateScore ?? 0) + volumeClock.scoreBonus;
            const { gate: reCheckGateFollow, quote: reCheckQuoteFollow } = await fetchGateData(stock.code, conditionWeights, macroState?.kospi20dReturn);
            const mtasFollow = reCheckGateFollow ? computeMtasMultiplier(reCheckGateFollow.mtas) : 1.0;
            const posPctFollow = computeRawPositionPct(gateScoreFollow) * kellyMultiplier * mtasFollow;
            const remSlots = Math.max(
              1,
              effectiveMaxPositions
                - shadows.filter(s =>
                    isOpenShadowStatus(s.status) &&
                    s.watchlistSource !== 'INTRADAY' &&
                    s.watchlistSource !== 'PRE_BREAKOUT',
                  ).length
                - reservedSlots,
            );
            const { quantity: fullQty } = calculateOrderQuantity({
              totalAssets, orderableCash, positionPct: posPctFollow,
              price: followEntryPrice, remainingSlots: remSlots,
              accountKellyMultiplier,
            });
            const followQty = Math.max(1, Math.ceil(fullQty * 0.7));
            const profile    = stock.profileType ?? 'B';
            const profileKey = `profile${profile}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
            const regimeStopRate = REGIME_CONFIGS[regime].stopLoss[profileKey];
            const followATR14 = reCheckQuoteFollow?.atr ?? 0;
            const stopLossPlan = buildStopLossPlan({
              entryPrice: followEntryPrice, fixedStopLoss: stock.stopLoss, regimeStopRate, atr14: followATR14, regime,
            });
            const followSymbolCtx: SymbolExitContext = {
              // PRE_BREAKOUT 추세 추격 진입은 본질적으로 LEADER 성격(돌파 후 추세 보유 우선).
              profileType: stock.section === 'CATALYST' ? 'CATALYST' : 'LEADER',
              sector: stock.sector,
              watchlistSource: 'PRE_BREAKOUT_FOLLOWTHROUGH',
            };
            const adaptiveFollowProfitTargets = getAdaptiveProfitTargets(regime, macroState, followSymbolCtx);
            const limitTranches = adaptiveFollowProfitTargets.targets.filter(t => t.type === 'LIMIT' && t.trigger !== null);
            const trailTarget   = adaptiveFollowProfitTargets.targets.find(t => t.type === 'TRAILING');
            const followTrade = buildBuyTrade({
              idPrefix: 'srv_pbf', stockCode: stock.code, stockName: stock.name,
              currentPrice, shadowEntryPrice: followEntryPrice, quantity: followQty,
              stopLossPlan, targetPrice: stock.targetPrice, shadowMode, regime,
              profileType: profile, watchlistSource: 'PRE_BREAKOUT_FOLLOWTHROUGH',
              profitTranches: limitTranches.map(t => ({ price: followEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false })),
              trailPct: Math.max(0.05, Math.min(0.14, (trailTarget?.trailPct ?? 0.10) + adaptiveFollowProfitTargets.trailPctAdjust)), entryATR14: followATR14,
            });

            shadows.push(followTrade);

            addRecommendation({
              stockCode: stock.code, stockName: stock.name, signalTime: new Date().toISOString(),
              priceAtRecommend: currentPrice, stopLoss: stopLossPlan.hardStopLoss,
              targetPrice: stock.targetPrice, kellyPct: Math.round(posPctFollow * 100),
              gateScore: gateScoreFollow, signalType: 'BUY',
              conditionKeys: ['PRE_BREAKOUT_FOLLOWTHROUGH'], entryRegime: regime,
            });

            const alertMsg =
              `🚀 <b>[선취매 추종] ${stock.name} (${stock.code})</b>\n` +
              `돌파 확인 @${currentPrice.toLocaleString()}원 — 나머지 70% 집행\n` +
              `주문가: ${followEntryPrice.toLocaleString()}원 × ${followQty}주\n` +
              `손절: ${formatStopLossBreakdown(stopLossPlan)} | 목표: ${stock.targetPrice.toLocaleString()}원`;

            liveBuyQueue.push(await createBuyTask({
              trade: followTrade, stockCode: stock.code, stockName: stock.name,
              currentPrice, quantity: followQty, entryPrice: followEntryPrice,
              stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
              gateScore: gateScoreFollow, shadowMode, effectiveBudget: followQty * followEntryPrice,
              alertMessage: alertMsg, logEvent: 'PRE_BREAKOUT_FOLLOWTHROUGH',
              onApproved: async () => { orderableCash = Math.max(0, orderableCash - followQty * followEntryPrice); },
            }));
            // Phase 1 ①: 큐 푸시 시점에 슬롯·섹터 예약 기록 (플러시 후 실패 시 롤백)
            reservedSlots++;
            reservedTiers.push('OTHER');
            {
              const _sec = stock.sector || getSectorByCode(stock.code) || '미분류';
              const _val = followQty * followEntryPrice;
              pendingSectorValue.set(_sec, (pendingSectorValue.get(_sec) ?? 0) + _val);
              reservedSectorValues.push({ sector: _sec, value: _val });
            }
          } else {
            console.log(`[PreBreakout] ${stock.name}(${stock.code}) 추종 매수 이미 실행됨 — 스킵`);
          }
        } else {
          console.log(`[PreBreakout] ${stock.name}(${stock.code}) 선취매 보유 중 @${activePreBreakout.shadowEntryPrice.toLocaleString()} — 돌파 대기`);
        }
        continue; // 선취매 포지션이 있으면 일반 진입 로직 건너뜀
      }

      // 진입 조건: 현재가가 entryPrice 부근 도달
      // MANUAL 종목은 사용자 확신이 높으므로 ±2%, AUTO 종목은 ±1%
      const nearEntryThreshold = stock.addedBy === 'MANUAL' ? 0.02 : 0.01;
      const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= nearEntryThreshold;
      // 손절 상향: 아직 손절선 위에 있어야 함
      const aboveStop = currentPrice > stock.stopLoss;
      // 상승 모멘텀: 현재가가 entry 이상
      const breakout = currentPrice >= stock.entryPrice;

      // ── Pre-Breakout 매집 감지 (진입가 미도달 + 손절선 위) ─────────────────
      if (!nearEntry && !breakout && aboveStop) {
        const priceDiffPct = ((currentPrice - stock.entryPrice) / stock.entryPrice * 100).toFixed(1);
        console.log(
          `[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달 — ` +
          `현재가 ${currentPrice.toLocaleString()} vs 진입가 ${stock.entryPrice.toLocaleString()} (${priceDiffPct}%, 기준 ±${(nearEntryThreshold * 100).toFixed(0)}%) → Pre-Breakout 판별`,
        );
        const reCheckQuotePb = await fetchYahooQuote(`${stock.code}.KS`).catch(() => null)
                            ?? await fetchYahooQuote(`${stock.code}.KQ`).catch(() => null)
                            ?? await fetchKisQuoteFallback(stock.code).catch(() => null);
        if (
          reCheckQuotePb != null &&
          (reCheckQuotePb.recentCloses10d?.length ?? 0) >= 5 &&
          (reCheckQuotePb.recentVolumes10d?.length ?? 0) >= 4 &&
          (reCheckQuotePb.recentHighs10d?.length ?? 0) >= 6 &&
          (reCheckQuotePb.recentLows10d?.length ?? 0) >= 6
        ) {
          const accumResult = detectPreBreakoutAccumulation({
            recentCloses:         reCheckQuotePb.recentCloses10d!,
            recentVolumes:        reCheckQuotePb.recentVolumes10d!,
            avgVolume20d:         reCheckQuotePb.avgVolume,
            recentHighs:          reCheckQuotePb.recentHighs10d!,
            recentLows:           reCheckQuotePb.recentLows10d!,
            atrRatio:             reCheckQuotePb.price > 0 ? reCheckQuotePb.atr / reCheckQuotePb.price : 0.02,
            foreignNetBuy5d:      macroState?.foreignNetBuy5d ?? 0,
            institutionalNetBuy5d: 0,
          });

          if (accumResult.isAccumulating) {
            // 당일 이미 선취매 진행 여부 확인
            const pbAlreadyToday = shadows.some(
              s => s.stockCode === stock.code &&
                   s.watchlistSource === 'PRE_BREAKOUT' &&
                   s.signalTime.startsWith(today)
            );
            if (!pbAlreadyToday && !isBlacklisted(stock.code)) {
              const slippage = getExecutionCostConfig().slippageRate;
              const pbEntryPrice = Math.round(currentPrice * (1 + slippage));
              const gateScorePb = (stock.gateScore ?? 0) + volumeClock.scoreBonus;
              // BUG-05 fix: MTAS 기반 포지션 조정 (Pre-Breakout 선취매에도 적용)
              const [kisFlowPb, dartFinPb] = await Promise.all([
                fetchKisInvestorFlow(stock.code).catch(() => null),
                getDartFinancials(stock.code).catch(() => null),
              ]);
              const reCheckGatePb = evaluateServerGate(reCheckQuotePb, conditionWeights, macroState?.kospi20dReturn, dartFinPb, kisFlowPb, regime);
              const mtasPb = reCheckGatePb ? computeMtasMultiplier(reCheckGatePb.mtas) : 1.0;
              const posPctPb    = computeRawPositionPct(gateScorePb) * kellyMultiplier * mtasPb;
              const remSlotsPb  = Math.max(
                1,
                effectiveMaxPositions
                  - shadows.filter(s =>
                      isOpenShadowStatus(s.status) &&
                      s.watchlistSource !== 'INTRADAY' &&
                      s.watchlistSource !== 'PRE_BREAKOUT',
                    ).length
                  - reservedSlots,
              );
              const { quantity: fullPbQty } = calculateOrderQuantity({
                totalAssets, orderableCash, positionPct: posPctPb,
                price: pbEntryPrice, remainingSlots: remSlotsPb,
                accountKellyMultiplier,
              });
              const pbQty = Math.max(1, Math.floor(fullPbQty * 0.3)); // 30% 선취매

              if (pbQty >= 1) {
                const profilePb = stock.profileType ?? 'B';
                const profileKeyPb = `profile${profilePb}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
                const regimeStopRatePb = REGIME_CONFIGS[regime].stopLoss[profileKeyPb];
                const pbATR14 = reCheckQuotePb?.atr ?? 0;
                const stopLossPlanPb = buildStopLossPlan({
                  entryPrice: pbEntryPrice, fixedStopLoss: stock.stopLoss, regimeStopRate: regimeStopRatePb, atr14: pbATR14, regime,
                });
                const adaptivePreBreakoutTargets = getAdaptiveProfitTargets(regime, macroState);
                const limitTranchesPb = adaptivePreBreakoutTargets.targets.filter(t => t.type === 'LIMIT' && t.trigger !== null);
                const trailTargetPb   = adaptivePreBreakoutTargets.targets.find(t => t.type === 'TRAILING');
                const pbTrade = buildBuyTrade({
                  idPrefix: 'srv_pb', stockCode: stock.code, stockName: stock.name,
                  currentPrice, shadowEntryPrice: pbEntryPrice, quantity: pbQty, originalQuantity: fullPbQty,
                  stopLossPlan: stopLossPlanPb, targetPrice: stock.targetPrice, shadowMode, regime,
                  profileType: profilePb, watchlistSource: 'PRE_BREAKOUT',
                  profitTranches: limitTranchesPb.map(t => ({ price: pbEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false })),
                  trailPct: Math.max(0.05, Math.min(0.14, (trailTargetPb?.trailPct ?? 0.10) + adaptivePreBreakoutTargets.trailPctAdjust)), entryATR14: pbATR14,
                });

                shadows.push(pbTrade);

                addRecommendation({
                  stockCode: stock.code, stockName: stock.name, signalTime: new Date().toISOString(),
                  priceAtRecommend: currentPrice, stopLoss: stopLossPlanPb.hardStopLoss,
                  targetPrice: stock.targetPrice, kellyPct: Math.round(posPctPb * 100),
                  gateScore: gateScorePb, signalType: 'BUY',
                  conditionKeys: ['PRE_BREAKOUT'], entryRegime: regime,
                });

                console.log(`[PreBreakout] ${stock.name}(${stock.code}) 매집 감지 — 30% 선취매 @${pbEntryPrice} (${pbQty}주/${fullPbQty}주)`);
                console.log(`[PreBreakout] ${accumResult.summary}`);

                const pbAlertMsg =
                  `🔍 <b>[선취매 진입] ${stock.name} (${stock.code})</b>\n` +
                  `매집 감지 — ${accumResult.summary}\n` +
                  `현재가: ${currentPrice.toLocaleString()}원 × ${pbQty}주 (30% / 총 ${fullPbQty}주)\n` +
                  `손절: ${formatStopLossBreakdown(stopLossPlanPb)} | 목표: ${stock.targetPrice.toLocaleString()}원\n` +
                  `⚡ 돌파 확인 시 나머지 70%(${fullPbQty - pbQty}주) 추가 집행`;

                liveBuyQueue.push(await createBuyTask({
                  trade: pbTrade, stockCode: stock.code, stockName: stock.name,
                  currentPrice, quantity: pbQty, entryPrice: pbEntryPrice,
                  stopLoss: stopLossPlanPb.hardStopLoss, targetPrice: stock.targetPrice,
                  gateScore: gateScorePb, shadowMode, effectiveBudget: pbQty * pbEntryPrice,
                  alertMessage: pbAlertMsg, logEvent: 'PRE_BREAKOUT_ENTRY',
                  onApproved: async () => { orderableCash = Math.max(0, orderableCash - pbQty * pbEntryPrice); },
                }));
                // Phase 1 ①: 큐 푸시 시점에 슬롯·섹터 예약 기록 (플러시 후 실패 시 롤백)
                reservedSlots++;
                reservedTiers.push('OTHER');
                {
                  const _sec = stock.sector || getSectorByCode(stock.code) || '미분류';
                  const _val = pbQty * pbEntryPrice;
                  pendingSectorValue.set(_sec, (pendingSectorValue.get(_sec) ?? 0) + _val);
                  reservedSectorValues.push({ sector: _sec, value: _val });
                }
              }
            }
          }
        }
        // 진입가 미도달 → failCount 증가 (3회 누적 시 cleanupWatchlist에서 자동 제거)
        stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
        watchlistMutated = true;
        console.log(`[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달(pre-breakout) — failCount=${stock.entryFailCount}`);
        continue; // 진입가 미도달 — 일반 진입 로직 건너뜀
      }

      // C4 수정: 명시적 진입 조건 체크 (INTRADAY 경로와 동일한 방어 패턴)
      // (!nearEntry && !breakout) 케이스는 위 pre-breakout 블록이 처리하지만,
      // 방어적 가드를 명시하여 미래 코드 변경 시 조건 없는 진입을 차단한다.
      if (!(nearEntry || breakout)) {
        stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
        watchlistMutated = true;
        console.log(`[AutoTrade] ${stock.name}(${stock.code}) 진입가 이탈 — failCount=${stock.entryFailCount}`);
        continue;
      }

      if (!aboveStop) {
        console.log(
          `[AutoTrade] ${stock.name}(${stock.code}) 손절선 하회 — ` +
          `현재가 ${currentPrice.toLocaleString()} ≤ 손절 ${stock.stopLoss.toLocaleString()} → 진입 차단`,
        );
        continue;
      }
      const alreadyTraded = shadows.some(
        (s) => s.stockCode === stock.code &&
        (isOpenShadowStatus(s.status) ||
         s.signalTime.startsWith(today))
      );
      if (alreadyTraded) continue;

      // 동시호가 중복 주문 방지 — 동시호가 주문 후 9시 스캔에서 같은 종목에 중복 진입 차단
      const hasPendingPreMarketOrder = fillMonitor.getPendingOrders().some(
        o => o.stockCode === stock.code &&
             (o.status === 'PENDING' || o.status === 'PARTIAL') &&
             o.placedAt.startsWith(today),
      );
      if (hasPendingPreMarketOrder) continue;

      // ── Regret Asymmetry Filter — 쿨다운 종목 진입 보류/해제 판단 ────────────
      if (stock.cooldownUntil) {
        const released = checkCooldownRelease(
          stock.cooldownUntil,
          stock.recentHigh ?? stock.entryPrice,
          currentPrice,
        );
        if (released) {
          // 쿨다운 해제 — 플래그 제거 후 진입 허용
          stock.cooldownUntil = undefined;
          stock.recentHigh    = undefined;
          watchlistMutated = true;
          console.log(`[Regret Asymmetry] ${stock.name}(${stock.code}) 쿨다운 해제 — 진입 재허용`);
        } else {
          console.log(
            `[Regret Asymmetry] ${stock.name}(${stock.code}) 쿨다운 유지` +
            ` (until ${stock.cooldownUntil}, high ${(stock.recentHigh ?? 0).toLocaleString()}원)`,
          );
          continue;
        }
      }

      // ── 블랙리스트 확인 (Cascade -30% 진입 금지 목록) ──
      if (isBlacklisted(stock.code)) {
        console.log(`[AutoTrade] 🚫 ${stock.name}(${stock.code}) 블랙리스트 — 진입 차단`);
        continue;
      }

      // ── 추가 매수 차단 플래그 확인 (Cascade -7% 이후) ──
      const blockedShadow = shadows.find(
        s => s.stockCode === stock.code && s.addBuyBlocked === true
      );
      if (blockedShadow) {
        console.log(`[AutoTrade] ⚠️  ${stock.name}(${stock.code}) 추가 매수 차단 중 (Cascade -7%)`);
        continue;
      }

      // ── RRR 필터 (Risk-Reward Ratio 최소값 미달 종목 제외) ──
      const rrr = calcRRR(stock.entryPrice, stock.targetPrice, stock.stopLoss);
      if (rrr < RRR_MIN_THRESHOLD) {
        console.log(
          `[AutoTrade] 📐 ${stock.name}(${stock.code}) RRR ${rrr.toFixed(2)} < ${RRR_MIN_THRESHOLD} — 진입 제외`
        );
        _scanRrrMisses++;
        stageLog.rrr = `FAIL(${rrr.toFixed(2)} < ${RRR_MIN_THRESHOLD})`;
        pushTrace();
        continue;
      }
      stageLog.rrr = 'PASS';

      // ── 아이디어 4: 섹터 집중도 가드 (Correlation Guard) ──
      if (stock.sector) {
        const activeSectorCodes = watchlist
          .filter(w => shadows.some(
            s => s.stockCode === w.code && isOpenShadowStatus(s.status)
          ))
          .map(w => w.sector)
          .filter(Boolean);
        const sectorCount = activeSectorCodes.filter(s => s === stock.sector).length;
        if (sectorCount >= MAX_SECTOR_CONCENTRATION) {
          console.log(
            `[CorrelationGuard] ${stock.name}(${stock.sector}) 진입 보류 — ` +
            `동일 섹터 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 포화`
          );
          await sendTelegramAlert(
            `🚧 <b>[가드] ${stock.name} 진입 보류</b>\n` +
            `섹터: ${stock.sector}\n` +
            `동일 섹터 보유 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 → 분산 한도 초과`
          ).catch(console.error);
          continue;
        }
      }

      // ── Phase 1-②: 섹터 노출 선검증 (승인 큐 투입 전, 같은 tick 의 pending 포함) ──
      // 현재 보유 + 같은 스캔에서 이미 큐에 들어간 종목의 섹터 합산으로 투영 비중을 계산해
      // 단일 섹터 > 40% 또는 상관 그룹 > 50% 를 사전 차단한다. portfolioRiskEngine 의
      // 사후 점검은 그대로 남아 제2방어선 역할. 위반 시 해당 후보만 SKIP 해 다음 섹터로 교체.
      {
        const candidateSector = stock.sector || getSectorByCode(stock.code);
        // 신규 진입 예상 금액 — 실제 quantity 계산 전이므로 positionPct × totalAssets 추정.
        // 후속 포지션 사이징 결과와 10~30% 오차가 있을 수 있으나, 단일 섹터 40% 가드에
        // 비하면 무시할 수준. 섹터 skip 판단용도의 보수적 추정이면 충분.
        const estGateScore = stock.gateScore ?? 5;
        const estRawPct = estGateScore >= 9 ? 0.12 : estGateScore >= 7 ? 0.08 : estGateScore >= 5 ? 0.05 : 0.03;
        const estCandidateValue = totalAssets * estRawPct * kellyMultiplier;
        const secGuard = checkSectorExposureBefore({
          candidateSector,
          candidateValue: estCandidateValue,
          currentSectorValue,
          pendingSectorValue,
          totalAssets,
        });
        if (!secGuard.allowed) {
          console.log(`[SectorPreGuard] ${stock.name}(${candidateSector ?? '?'}) ${secGuard.reason}`);
          stageLog.sectorGuard = `BLOCK(${secGuard.projectedSectorWeight.toFixed(2)})`;
          pushTrace();
          continue;
        }
      }

      // ── 포트폴리오 리스크 엔진 — 섹터 비중/베타/일일 손실 통합 체크 ──────────
      {
        const prisk = await evaluatePortfolioRisk(stock.sector);
        if (!prisk.entryAllowed) {
          console.log(
            `[PortfolioRisk] ${stock.name} 진입 차단 — ${prisk.blockReasons.join('; ')}`
          );
          stageLog.portfolioRisk = prisk.blockReasons.join('; ');
          pushTrace();
          continue;
        }
        if (prisk.warnings.length > 0) {
          console.warn(`[PortfolioRisk] ${stock.name} 경고: ${prisk.warnings.join('; ')}`);
        }
      }

      const slippage = getExecutionCostConfig().slippageRate;
      const shadowEntryPrice = Math.round(currentPrice * (1 + slippage));

      // ── 실시간 Gate 재평가 (타점 판단 연동) ──────────────────────────────────
      // 워치리스트 stale gateScore 대신 실시간 evaluateServerGate 결과를 포지션 사이징에 반영
      // 아이디어 9: KIS API로 MTAS 월봉/주봉 보강 (매수 결정 직전 정확도 향상)
      const reCheckQuoteRaw = await fetchYahooQuote(`${stock.code}.KS`).catch(() => null)
                           ?? await fetchYahooQuote(`${stock.code}.KQ`).catch(() => null)
                           ?? await fetchKisQuoteFallback(stock.code).catch(() => null);
      const reCheckQuote = reCheckQuoteRaw
        ? await enrichQuoteWithKisMTAS(reCheckQuoteRaw, stock.code)
        : null;

      // ── KIS 실시간 시가/전일종가 보정 ──────────────────────────────────────────
      // Yahoo Finance의 regularMarketOpen이 한국 장중 부정확한 경우가 빈번하여
      // KIS 현재가 API(FHKST01010100)로 dayOpen·prevClose를 항상 덮어쓴다.
      if (reCheckQuote) {
        const kisSnap = await fetchKisIntraday(stock.code).catch(() => null);
        if (kisSnap) {
          const dayOpenDecision = reconcileDayOpen({
            yahooDayOpen: reCheckQuote.dayOpen,
            kisDayOpen: kisSnap.dayOpen,
          });
          if (
            dayOpenDecision.dayOpen &&
            reCheckQuote.dayOpen !== dayOpenDecision.dayOpen
          ) {
            const divergenceLabel = dayOpenDecision.divergencePct == null
              ? 'N/A'
              : `${dayOpenDecision.divergencePct.toFixed(1)}%`;
            console.log(
              `[KisIntraday] ${stock.code} 시가 ${dayOpenDecision.acceptedKis ? '보정' : '유지'}: Yahoo=${reCheckQuote.dayOpen} / KIS=${kisSnap.dayOpen} / 사용=${dayOpenDecision.dayOpen} / 괴리=${divergenceLabel}`,
            );
            reCheckQuote.dayOpen = dayOpenDecision.dayOpen;
          }
          if (kisSnap.prevClose > 0) {
            reCheckQuote.prevClose = kisSnap.prevClose;
          }
        }
      }

      const [kisFlow, dartFin] = reCheckQuote
        ? await Promise.all([
            fetchKisInvestorFlow(stock.code).catch(() => null),
            getDartFinancials(stock.code).catch(() => null),
          ])
        : [null, null];
      const reCheckGate = reCheckQuote
        ? evaluateServerGate(reCheckQuote, conditionWeights, macroState?.kospi20dReturn, dartFin, kisFlow, regime)
        : null;
      const entryRevalidation = evaluateEntryRevalidation({
        currentPrice,
        entryPrice: stock.entryPrice,
        quoteGateScore: reCheckGate?.gateScore,
        quoteSignalType: reCheckGate?.signalType,
        dayOpen: reCheckQuote?.dayOpen,
        prevClose: reCheckQuote?.prevClose,
        volume: reCheckQuote?.volume,
        avgVolume: reCheckQuote?.avgVolume,
        minGateScore: getMinGateScore(regime),  // 아이디어 #7: 레짐별 Gate 임계값 적용
        marketElapsedMinutes: getKstMarketElapsedMinutes(),
      });
      if (!entryRevalidation.ok) {
        console.log(`[AutoTrade] ${stock.name} 진입 직전 재검증 탈락: ${entryRevalidation.reasons.join(', ')}`);
        // BUG-07 fix: MANUAL 종목도 entryFailCount 추적 — 반복 실패 시 자동 제거 대상에 포함
        stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
        watchlistMutated = true;
        _scanGateMisses++;
        stageLog.gate = `FAIL(${entryRevalidation.reasons.join(',')})`;
        pushTrace();

        // Idea 4 — Counterfactual Shadow: 탈락 후보 상위 N 개를 가상 진입으로 기록.
        // 같은 날 동일 종목 중복은 자동 스킵 (멱등). I/O 실패가 실 매매 경로를 멈추지 않도록 try/catch.
        if (_counterfactualRecordedToday < COUNTERFACTUAL_DAILY_CAP) {
          try {
            const recorded = recordCounterfactual({
              stockCode: stock.code,
              stockName: stock.name,
              priceAtSignal: currentPrice,
              gateScore: stock.gateScore ?? 0,
              regime,
              conditionKeys: stock.conditionKeys ?? [],
              skipReason: `entryRevalidation:${entryRevalidation.reasons.join(',')}`,
            });
            if (recorded) _counterfactualRecordedToday++;
          } catch (e) {
            console.warn(`[Counterfactual] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
          }
        }
        continue;
      }

      // BUG-02 fix: Yahoo 실패 시 MTAS 검증 우회 방지 — 재검증 불가 시 진입 보류
      if (!reCheckGate) {
        console.warn(`[AutoTrade] ${stock.name} Yahoo 조회 실패 — 재검증 불가, 진입 보류`);
        _scanYahooFails++;
        stageLog.gate = 'FAIL(yahoo_unavailable)';
        pushTrace();
        continue;
      }
      stageLog.gate = 'PASS';

      // 실시간 gateScore: 재평가 성공 시 실시간 값 우선
      // Volume Clock 시간대별 점수 조정: -2 ~ +2점 (시간대별 패널티/보너스)
      const liveGateScore = reCheckGate.gateScore ?? (stock.gateScore ?? 0);
      const gateScore = liveGateScore + volumeClock.scoreBonus;
      // 서버 Gate 최대 13점(11조건 × 1.0 + volumeClock +2) 기준 임계값
      const isStrongBuy = gateScore >= 9;

      // MTAS 기반 진입 차단: 타임프레임 불일치 시 진입 금지
      if (reCheckGate.mtas <= 3) {
        console.log(
          `[AutoTrade] ${stock.name} MTAS ${reCheckGate.mtas.toFixed(1)}/10 진입 금지 — 타임프레임 불일치`
        );
        continue;
      }

      // Phase 2-③: SELL_ONLY 예외 채널이면 liveGate·MTAS 재검증 (4중 조건의 종목 측면)
      if (sellOnlyExc.allow) {
        if (liveGateScore < sellOnlyExc.minLiveGate) {
          console.log(
            `[AutoTrade/SellOnlyExc] ${stock.name} liveGate ${liveGateScore.toFixed(2)} < ${sellOnlyExc.minLiveGate} — 예외 진입 차단`,
          );
          continue;
        }
        if (reCheckGate.mtas < sellOnlyExc.minMtas) {
          console.log(
            `[AutoTrade/SellOnlyExc] ${stock.name} MTAS ${reCheckGate.mtas.toFixed(1)} < ${sellOnlyExc.minMtas} — 예외 진입 차단`,
          );
          continue;
        }
      }

      // Phase 4-⑧(수정): 신뢰도 티어 기반 사이징 — 카테고리 신설 대신 Kelly 만 차등.
      // Gate 1 통과 프록시: liveGateScore ≥ getMinGateScore(regime).
      // 섹터 정렬 프록시: leadingSectorRS ≥ 60 또는 sectorCycleStage ∈ {EARLY, MID}.
      // conditionsMatched: 통과 조건 키 수.
      const _gate1Pass = liveGateScore >= getMinGateScore(regime);
      const _rs = macroState?.leadingSectorRS ?? 0;
      const _stage = macroState?.sectorCycleStage;
      const _sectorAligned = _rs >= 60 || _stage === 'EARLY' || _stage === 'MID';
      const _conditionsMatched = reCheckGate.conditionKeys?.length ?? 0;
      const tierDecision = classifySizingTier({
        liveGate: liveGateScore, mtas: reCheckGate.mtas,
        gate1Pass: _gate1Pass, sectorAligned: _sectorAligned,
        conditionsMatched: _conditionsMatched,
      });
      if (tierDecision.tier === null) {
        console.log(`[AutoTrade/SizingTier] ${stock.name} 티어 미달 — ${tierDecision.reason}`);
        continue;
      }
      // Idea 6: bandit 이 결정한 동적 예산으로 PROBING 슬롯 제어.
      // 최소 = 레거시 PROBING_MAX_SLOTS (1). bandit 이 더 높은 예산을 제시하면 그 값을 채택.
      const probingBudget = Math.max(PROBING_MAX_SLOTS, banditDecision.budget);
      if (tierDecision.tier === 'PROBING' &&
          !canReserveBanditProbingSlot(probingReservedSlots, probingBudget)) {
        console.log(
          `[AutoTrade/SizingTier] ${stock.name} PROBING 슬롯 포화 (${probingReservedSlots}/${probingBudget}) — 스킵`,
        );
        continue;
      }
      console.log(
        `[AutoTrade/SizingTier] ${stock.name} → ${tierDecision.tier} (×${tierDecision.kellyFactor}) — ${tierDecision.reason}`,
      );

      // 포지션 사이징: 실시간 Gate 결과 연동 (buyPipeline 헬퍼 사용)
      // CATALYST 섹션은 표준의 60%로 축소 — 촉매 신호는 단기 고리스크이므로 손실 제한
      const mtasMultiplier = computeMtasMultiplier(reCheckGate.mtas);
      const sectionFactor = stock.section === 'CATALYST' ? CATALYST_POSITION_FACTOR : 1.0;
      const positionPct =
        computeRawPositionPct(gateScore) * kellyMultiplier * mtasMultiplier * sectionFactor * tierDecision.kellyFactor;

      if (reCheckGate) {
        console.log(
          `[AutoTrade] ${stock.name} 타점 판단 — ` +
          `liveGate: ${liveGateScore.toFixed(1)} (stale: ${(stock.gateScore ?? 0)}) | ` +
          `MTAS: ${reCheckGate.mtas.toFixed(1)}/10 (×${mtasMultiplier}) | ` +
          `CS: ${reCheckGate.compressionScore.toFixed(2)} | ` +
          `tier: ${tierDecision.tier}(×${tierDecision.kellyFactor}) | ` +
          `posPct: ${(positionPct * 100).toFixed(1)}%`
        );
      }
      // 사전 점검·루프 점검과 동일 기준으로 잔여 슬롯을 산정한다:
      //   - effectiveMaxPositions(SELL_ONLY 예외 캡 반영) 사용
      //   - 같은 tick 안에서 이미 큐에 쌓인 reservedSlots 차감
      // 기존 로직은 regimeConfig.maxPositions - currentActive 만 봐서 sizing 분모가 과대평가되어
      // 예산 분할이 느슨해지고, SELL_ONLY 예외 시 max 캡이 무시되는 부작용이 있었다.
      const remainingSlots = Math.max(
        1,
        effectiveMaxPositions - currentActive - reservedSlots,
      );

      // Idea 7 — Pre-Mortem Failure DB 능동 필터.
      // preMortemStructured 에서 invalidation id 가 3회 이상 반복 손절로 이어진 패턴이
      // failurePatternRepo 로 자동 승급됐다면, 이 후보의 진입 조건 벡터와 비교해
      // 유사도 ≥ 85% 인 패턴이 있을 경우 진입을 차단한다. LIVE 경로 전용 —
      // MOMENTUM Shadow 는 학습 표본이 목적이므로 이 게이트를 건너뛴다.
      if (!isMomentumShadow) {
        const candidateScores = buildEntryConditionScores(stock.conditionKeys);
        const failureWarning = checkFailurePattern(candidateScores);
        if (failureWarning.hasWarning && failureWarning.maxSimilarity >= FAILURE_BLOCK_THRESHOLD_PCT) {
          console.log(
            `[AutoTrade/FailureDB] ${stock.name}(${stock.code}) 진입 차단 — ${failureWarning.message}`,
          );
          appendShadowLog({
            event: 'BLOCKED_FAILURE_PATTERN',
            code: stock.code,
            maxSimilarity: failureWarning.maxSimilarity,
            similarCount: failureWarning.similarCount,
            topMatches: failureWarning.topMatches.map(m =>
              `${m.stockCode}(${m.similarity}%, ${m.returnPct.toFixed(1)}%)`,
            ),
          });
          continue;
        }

        // Idea 5 — Correlation-Aware Slot Allocation.
        // 기존 포지션과 후보의 섹터 기반 평균 상관이 임계 이상이면 신규 진입 차단.
        // 실 진입 경로(LIVE) 만 게이팅. Shadow 학습 경로는 샘플 다양성 보존을 위해 통과.
        const corrGate = evaluateCorrelationGate({
          candidateCode: stock.code,
          candidateSector: stock.sector,
          trades: shadows,
        });
        if (!corrGate.allowed) {
          console.log(`[AutoTrade/CorrGate] ${stock.name}(${stock.code}) 진입 차단 — ${corrGate.reason}`);
          appendShadowLog({
            event: 'BLOCKED_CORRELATION',
            code: stock.code,
            avgCorrelation: Number(corrGate.avgCorrelation.toFixed(3)),
            effectiveIndependentCount: Number(corrGate.effectiveIndependentCount.toFixed(2)),
          });
          continue;
        }
      }

      // ── P1-2: 계좌 리스크 예산 + Fractional Kelly 게이트 ────────────────
      // sizingTier × kellyDampener × accountScale 까지 누적된 positionPct 에
      // 다시 한 번 "신호 등급별 캡 + 동시 R 잔여 + 일일 손실 잔여" 를 강제한다.
      // 작은 쪽이 채택되므로 기존 sizing 보다 더 보수적인 결과만 나올 수 있다.
      const grade: 'STRONG_BUY' | 'BUY' | 'PROBING' | 'HOLD' =
        tierDecision.tier === 'PROBING' ? 'PROBING'
        : isStrongBuy ? 'STRONG_BUY'
        : 'BUY';
      // Idea 8: 활성 포지션의 실시간 현재가를 수집하여 getAccountRiskBudget 에 주입.
      // 이미 스트림 구독 중인 종목은 getRealtimePrice() 로 즉시 조회 가능하므로
      // 추가 네트워크 비용 없이 trailing hardStop 반영 activeR 계산을 활성화한다.
      const openCurrentPrices = new Map<string, number>();
      for (const s of shadows) {
        if (!isOpenShadowStatus(s.status)) continue;
        const rt = getRealtimePrice(s.stockCode);
        if (rt !== null && Number.isFinite(rt) && rt > 0) {
          openCurrentPrices.set(s.stockCode, rt);
        }
      }
      const budget = getAccountRiskBudget({
        totalAssets,
        trades: shadows,
        currentPrices: openCurrentPrices,
      });
      if (!budget.canEnterNew) {
        console.log(`[AutoTrade/RiskBudget] ${stock.name} 진입 차단 — ${budget.blockedReasons.join(' / ')}`);
        continue;
      }
      const confidenceModifier = Math.min(1.2, 0.6 + 0.05 * (reCheckGate.mtas ?? 0));
      const sized = computeRiskAdjustedSize({
        entryPrice: shadowEntryPrice,
        stopLoss:   stock.stopLoss,
        signalGrade: grade,
        kellyMultiplier: positionPct,             // 누적 Kelly 비율
        confidenceModifier,
        budget,
        totalAssets,
      });
      if (sized.recommendedBudgetKrw <= 0) {
        console.log(`[AutoTrade/RiskBudget] ${stock.name} 사이즈 0 — ${sized.reason}`);
        continue;
      }
      if (sized.kellyWasCapped) {
        console.log(`[AutoTrade/RiskBudget] ${stock.name} Fractional Kelly 캡 적용 — ${sized.reason}`);
      }

      // Idea 1 — 진입 시점 Kelly 의사결정 스냅샷 동결.
      // buildBuyTrade 가 이 값을 trade 객체에 귀속시켜 이후 /kelly 헬스 카드·사후 복기에서 단일 참조점으로 쓴다.
      const entryKellySnapshot: EntryKellySnapshot = {
        tier: tierDecision.tier,
        signalGrade: grade,
        rawKellyMultiplier: positionPct,
        effectiveKelly: sized.effectiveKelly,
        fractionalCap: FRACTIONAL_KELLY_CAP[grade],
        ipsAtEntry: loadKellyDampenerState().ips,
        regimeAtEntry: regime,
        accountRiskBudgetPctAtEntry: budget.openRiskPct,
        confidenceModifier,
        snapshotAt: new Date().toISOString(),
      };

      const { quantity, effectiveBudget } = calculateOrderQuantity({
        totalAssets,
        orderableCash,
        positionPct,
        price: shadowEntryPrice,
        remainingSlots,
        accountKellyMultiplier,
      });

      if (quantity < 1) continue;

      // 아이디어 8: STRONG_BUY → 분할 매수 1차 진입 (전체 수량의 50%)
      // 잔여 30%·20%는 trancheExecutor가 3일·7일 후 실행
      const execQty = isStrongBuy ? Math.max(1, Math.floor(quantity * 0.5)) : quantity;

      // ─── ① 손절 정책 분리: 고정 손절 / 레짐 손절 / 하드 스톱 ───────────────
      // CATALYST 섹션: 고정 -5% 타이트 손절 (ATR 동적 손절 비사용)
      // SWING 섹션: 기존 ATR 동적 손절 + 레짐 손절
      const profile    = stock.profileType ?? 'B';
      const profileKey = `profile${profile}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
      const isCatalyst = stock.section === 'CATALYST';
      const regimeStopRate  = isCatalyst ? CATALYST_FIXED_STOP_PCT : REGIME_CONFIGS[regime].stopLoss[profileKey];
      const entryATR14 = isCatalyst ? 0 : (reCheckQuote?.atr ?? 0); // CATALYST는 ATR 동적 손절 비사용
      const catalystFixedStop = isCatalyst ? Math.round(shadowEntryPrice * (1 + CATALYST_FIXED_STOP_PCT)) : stock.stopLoss;
      const stopLossPlan = buildStopLossPlan({
        entryPrice: shadowEntryPrice, fixedStopLoss: isCatalyst ? catalystFixedStop : stock.stopLoss, regimeStopRate, atr14: entryATR14, regime,
      });

      // L3 분할 익절 타겟 — PROFIT_TARGETS[regime]에서 LIMIT 트랜치 추출.
      // section (CATALYST/SWING) 과 watchlist 추적자(MOMENTUM = LEADER 추세) 에 따라
      // 익절 라인을 종목별로 차등 조정 (사용자 P1-1 의견 반영).
      const symbolProfile: SymbolExitContext = {
        profileType: isCatalyst ? 'CATALYST'
          : (stock.section === 'MOMENTUM' || stock.profileType === 'A') ? 'LEADER'
          : undefined,
        sector: stock.sector,
      };
      const adaptiveProfitTargets = getAdaptiveProfitTargets(regime, macroState, symbolProfile);
      // composite reason 을 로그에 노출 — Telegram 메시지에서 운영자가 조정 사유를 추적 가능.
      if (adaptiveProfitTargets.reason !== 'macro:기본') {
        console.log(`[ProfitTargets] ${stock.code} ${stock.name}: ${adaptiveProfitTargets.reason}`);
      }
      const limitTranches = adaptiveProfitTargets.targets.filter((t) => t.type === 'LIMIT' && t.trigger !== null);
      const trailTarget = adaptiveProfitTargets.targets.find((t) => t.type === 'TRAILING');

      const trade = buildBuyTrade({
        idPrefix: isMomentumShadow ? 'srv_mom_shadow' : 'srv',
        stockCode: stock.code, stockName: stock.name,
        currentPrice, shadowEntryPrice, quantity: execQty,
        stopLossPlan, targetPrice: stock.targetPrice, shadowMode: stockShadowMode, regime,
        profileType: profile, watchlistSource: undefined,
        profitTranches: limitTranches.map((t) => ({
          price: shadowEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false,
        })),
        trailPct: Math.max(0.05, Math.min(0.14, (trailTarget?.trailPct ?? 0.10) + adaptiveProfitTargets.trailPctAdjust)), entryATR14,
        entryKellySnapshot,
      });

      addRecommendation({
        stockCode: stock.code, stockName: stock.name, signalTime: new Date().toISOString(),
        priceAtRecommend: currentPrice, stopLoss: stopLossPlan.hardStopLoss,
        targetPrice: stock.targetPrice, kellyPct: Math.round(positionPct * 100),
        gateScore, signalType: isStrongBuy ? 'STRONG_BUY' : 'BUY',
        conditionKeys: stock.conditionKeys ?? [], entryRegime: regime,
      });

      // ─── SHADOW/LIVE 통합 승인 큐 등록 ──────────────────────────────────────
      _scanEntries++;
      _lastBuySignalAt = Date.now();
      stageLog.buy = stockShadowMode ? 'SHADOW' : 'LIVE'; pushTrace();

      const modeEmoji = stockShadowMode ? '⚡' : '🚀';
      const modeLabel = isMomentumShadow ? 'Shadow(학습)' : stockShadowMode ? 'Shadow' : 'LIVE';
      const trancheLabel = isStrongBuy ? ` (1차/${execQty}주, 총${quantity}주)` : '';
      const gateLabel = `Gate ${liveGateScore.toFixed(1)} | MTAS ${reCheckGate.mtas.toFixed(0)}/10 | CS ${reCheckGate.compressionScore.toFixed(2)}`;
      const slBreakdown = formatStopLossBreakdown(stopLossPlan);
      const mainAlertMsg =
        `${modeEmoji} <b>[${modeLabel}] 매수 ${stockShadowMode ? '신호' : '주문'}${isStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
        `종목: ${stock.name} (${stock.code})\n` +
        `현재가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isStrongBuy ? ` (총${quantity}주)` : ''}\n` +
        `📊 ${gateLabel}\n` +
        `손절: ${slBreakdown} | 목표: ${stock.targetPrice.toLocaleString()}원`;

      const _rrr = stock.rrr, _sector = stock.sector;
      liveBuyQueue.push(await createBuyTask({
        trade, stockCode: stock.code, stockName: stock.name,
        currentPrice, quantity: execQty, entryPrice: shadowEntryPrice,
        stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
        gateScore, shadowMode: stockShadowMode, effectiveBudget,
        alertMessage: mainAlertMsg,
        logEvent: isMomentumShadow ? 'MOMENTUM_SHADOW_SIGNAL' : (stockShadowMode ? 'SIGNAL' : 'ORDER'),
        onApproved: async (t) => {
          shadows.push(t);
          await channelBuySignalEmitted({
            mode: stockShadowMode ? 'SHADOW' : 'LIVE', stockName: stock.name, stockCode: stock.code,
            price: currentPrice, quantity: execQty, gateScore: liveGateScore,
            mtas: reCheckGate.mtas, cs: reCheckGate.compressionScore,
            stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
            rrr: _rrr ?? 0, signalType: isStrongBuy ? 'STRONG_BUY' : 'BUY',
            sector: _sector,
          }).catch(console.error);

          // Idea 2 — Parallel Universe Ledger: 승인된 엔트리에 대해 A/B/C 3 세팅을 동시에 가상체결 기록.
          // 실 진입 = Universe A 와 동형. B/C 는 학습 표본. LIVE/Shadow 양쪽 모두 기록.
          try {
            recordUniverseEntries({
              stockCode: stock.code,
              stockName: stock.name,
              entryPrice: shadowEntryPrice,
              regime,
              signalGrade: grade,
            });
          } catch (e) {
            console.warn(`[Ledger] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
          }

          // BUG #3 fix — orderableCash 는 큐 푸시 시점에 이미 예약/차감됨.
          // onApproved 에서는 "예약 확정" 만 수행 (추가 차감 없음).
          // reservedBudgets 는 그대로 두고, 롤백 경로만 참조.
          if (isStrongBuy && quantity > 1 && !isMomentumShadow) {
            // MOMENTUM Shadow 는 분할 매수 스케줄 제외 (진입 자체가 관찰 표본)
            trancheExecutor.scheduleTranches({
              parentTradeId: t.id, stockCode: stock.code, stockName: stock.name,
              totalQuantity: quantity, firstQuantity: execQty,
              entryPrice: shadowEntryPrice, stopLoss: stopLossPlan.hardStopLoss,
              targetPrice: stock.targetPrice,
            });
          }
        },
      }));
      // Phase 1 ①: 큐 푸시 시점에 슬롯·섹터 예약 기록 (플러시 후 실패 시 롤백)
      // MOMENTUM Shadow 는 LIVE 슬롯/섹터/PROBING 예산에서 모두 격리된다.
      if (!isMomentumShadow) {
        reservedSlots++;
        // Phase 4-⑧(수정): PROBING 티어 전용 슬롯 카운터
        if (tierDecision.tier === 'PROBING') probingReservedSlots++;
        reservedTiers.push(tierDecision.tier === 'PROBING' ? 'PROBING' : 'OTHER');
      } else {
        // 큐 index 와 reservedTiers 길이 정합성을 위해 플레이스홀더를 push
        reservedTiers.push('OTHER');
      }
      reservedIsMomentum.push(isMomentumShadow);
      // BUG #3 fix — 같은 스캔의 다음 후보가 동일 orderableCash 를 이중 사용하는 것을
      // 차단하기 위해, 승인 대기 시점에 즉시 예산을 예약(차감) 한다. 롤백 시 복원.
      if (!isMomentumShadow && effectiveBudget > 0) {
        orderableCash = Math.max(0, orderableCash - effectiveBudget);
        reservedBudgets.push(effectiveBudget);
      } else {
        reservedBudgets.push(0);
      }
      if (!isMomentumShadow) {
        const _sec = stock.sector || getSectorByCode(stock.code) || '미분류';
        pendingSectorValue.set(_sec, (pendingSectorValue.get(_sec) ?? 0) + effectiveBudget);
        reservedSectorValues.push({ sector: _sec, value: effectiveBudget });
      }
    } catch (err: unknown) {
      console.error(`[AutoTrade] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
    }
  }

  // ── buyList 병렬 승인 큐 플러시 ─────────────────────────────────────────────
  // 모든 승인 요청을 동시에 발송했다가 응답을 일괄 수거한 후 순차 실행
  if (liveBuyQueue.length > 0) {
    const approvals = await Promise.allSettled(liveBuyQueue.map((t) => t.approvalPromise));
    let approved = 0, rejected = 0;
    for (let i = 0; i < liveBuyQueue.length; i++) {
      const result = approvals[i];
      const action: ApprovalAction = result.status === 'fulfilled' ? result.value : 'SKIP';
      await liveBuyQueue[i].execute(action);
      if (action === 'APPROVE') {
        approved++;
      } else {
        // Phase 1 ①: 실패한 예약은 롤백 — reservedSlots/pendingSectorValue 감소
        rejected++;
        // Idea 1: MOMENTUM Shadow 는 애초에 reservedSlots 를 증가시키지 않았으므로 롤백도 스킵.
        if (!reservedIsMomentum[i]) {
          reservedSlots = Math.max(0, reservedSlots - 1);
          // Phase 4-⑧(수정): PROBING 예약도 롤백해 다음 tick 이 정확히 1 슬롯 재사용
          if (reservedTiers[i] === 'PROBING') {
            probingReservedSlots = Math.max(0, probingReservedSlots - 1);
          }
          const rel = reservedSectorValues[i];
          if (rel) {
            const cur = pendingSectorValue.get(rel.sector) ?? 0;
            const next = Math.max(0, cur - rel.value);
            if (next === 0) pendingSectorValue.delete(rel.sector);
            else pendingSectorValue.set(rel.sector, next);
          }
          // BUG #3 fix — 승인 거절/스킵 시 큐 푸시 때 예약한 orderableCash 복원.
          const refund = reservedBudgets[i] ?? 0;
          if (refund > 0) {
            orderableCash += refund;
          }
        }
      }
    }
    if (rejected > 0) {
      console.log(
        `[AutoTrade] 승인 큐 플러시 — 승인 ${approved} / 거절·스킵 ${rejected} → 예약 롤백 완료 (잔여 reservedSlots=${reservedSlots})`,
      );
    }
  }

  // ── 장중 Watchlist 처리 — intradayReady 항목에 대해 진입 시도 ───────────────
  // 즉시 매수 금지: intradayReady=true (15분 경과 + 재검증 통과)인 항목만 대상
  // 위험 관리: maxIntradayPositions(3개) / 포지션 비중 50% 축소 / 경로별 손절(돌파-5%/눌림목-4%)
  if (!options?.sellOnly && intradayBuyList.length > 0) {
    const activeIntradayCount = shadows.filter(
      (s) => isOpenShadowStatus(s.status) && s.watchlistSource === 'INTRADAY',
    ).length;

    if (activeIntradayCount >= MAX_INTRADAY_POSITIONS) {
      console.log(
        `[AutoTrade/Intraday] 최대 장중 포지션 도달 (${activeIntradayCount}/${MAX_INTRADAY_POSITIONS}) — 진입 스킵`,
      );
    } else {
      const today = new Date().toISOString().split('T')[0];
      // Intraday 병렬 승인 큐 (LIVE/Shadow 공통)
      const intradayLiveBuyQueue: LiveBuyTask[] = [];
      // Phase 1 ①: Intraday 경로도 원자적 슬롯 예약 적용 (main 경로와 동일 원리)
      let reservedIntradaySlots = 0;

      for (const stock of intradayBuyList) {
        // 포지션 수 재확인
        const currentIntradayActive = shadows.filter(
          (s) => isOpenShadowStatus(s.status) && s.watchlistSource === 'INTRADAY',
        ).length;
        const totalIntradayCommitted = currentIntradayActive + reservedIntradaySlots;
        if (totalIntradayCommitted >= MAX_INTRADAY_POSITIONS) {
          console.log(
            `[AutoTrade/Intraday] 최대 포지션 도달 (활성 ${currentIntradayActive} + 예약 ${reservedIntradaySlots} = ${totalIntradayCommitted}/${MAX_INTRADAY_POSITIONS}) — 나머지 스킵`,
          );
          break;
        }

        try {
          const currentPrice = await getPrice(stock.code);
          if (!currentPrice) continue;

          // 진입 조건: 현재가가 entryPrice ± 1% 이내 or 돌파
          const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= 0.01;
          const breakout  = currentPrice >= stock.entryPrice;
          const aboveStop = currentPrice > stock.stopLoss;

          if (!(nearEntry || breakout) || !aboveStop) continue;

          // 당일 재진입 금지 — Intraday는 더 엄격하게: 오늘 진입한 동일 종목 완전 차단
          const alreadyTraded = shadows.some(
            (s) => s.stockCode === stock.code &&
              s.watchlistSource === 'INTRADAY' &&
              s.signalTime.startsWith(today),
          );
          if (alreadyTraded) {
            console.log(`[AutoTrade/Intraday] ${stock.name}(${stock.code}) 당일 재진입 금지`);
            continue;
          }

          // 블랙리스트 확인
          if (isBlacklisted(stock.code)) {
            console.log(`[AutoTrade/Intraday] 🚫 ${stock.name}(${stock.code}) 블랙리스트 — 진입 차단`);
            continue;
          }

          const slippage         = getExecutionCostConfig().slippageRate;
          const shadowEntryPrice = Math.round(currentPrice * (1 + slippage));

          // 장중 손절: 경로별 차등 — 돌파형 -5% / 수급·눌림목형 -4%
          const stopPct = (stock.entryPath === 'SUPPLY_DEMAND' || stock.entryPath === 'PULLBACK')
            ? INTRADAY_PULLBACK_STOP_LOSS_PCT
            : INTRADAY_STOP_LOSS_PCT;
          const intradayStop   = Math.round(shadowEntryPrice * (1 - stopPct));
          const intradayTarget = stock.targetPrice > 0
            ? stock.targetPrice
            : Math.round(shadowEntryPrice * (1 + INTRADAY_TARGET_PCT));

          // 포지션 사이징: gateScore 없으므로 기본 5% × 레짐 Kelly × 50% 축소
          const rawPositionPct  = 0.05; // Intraday 기본 포지션
          const positionPct     = rawPositionPct * kellyMultiplier * INTRADAY_POSITION_PCT_FACTOR;
          const remainingSlots  = Math.max(1, MAX_INTRADAY_POSITIONS - currentIntradayActive);
          const { quantity, effectiveBudget } = calculateOrderQuantity({
            totalAssets,
            orderableCash,
            positionPct,
            price: shadowEntryPrice,
            remainingSlots,
            accountKellyMultiplier,
          });

          if (quantity < 1) continue;

          // C3 수정: regimeStopLoss = intradayStop → exitEngine 일관된 손절 계산
          const intradayStopPlan = {
            initialStopLoss: intradayStop,
            regimeStopLoss: intradayStop,
            hardStopLoss: intradayStop,
          } as const;
          const trade = buildBuyTrade({
            idPrefix: 'srv_intraday', stockCode: stock.code, stockName: stock.name,
            currentPrice, shadowEntryPrice, quantity,
            stopLossPlan: intradayStopPlan,
            targetPrice: intradayTarget, shadowMode, regime,
            profileType: 'C', watchlistSource: 'INTRADAY',
            profitTranches: [], // Intraday는 분할익절 없음
            trailPct: 0.05,    // 장중: 5% 트레일링
          });

          // BUG-10 fix: 실시간 Gate 평가로 Intraday 종목의 gateScore 추정
          const { gate: intradayGate } = await fetchGateData(stock.code, conditionWeights, macroState?.kospi20dReturn);
          const intradayGateScore = intradayGate?.gateScore ?? 0;

          addRecommendation({
            stockCode: stock.code, stockName: stock.name, signalTime: new Date().toISOString(),
            priceAtRecommend: currentPrice, stopLoss: intradayStop,
            targetPrice: intradayTarget, kellyPct: Math.round(positionPct * 100),
            gateScore: intradayGateScore, signalType: 'BUY',
            conditionKeys: ['INTRADAY_STRONG'], entryRegime: regime,
          });

          const stopLabel = stopPct === INTRADAY_PULLBACK_STOP_LOSS_PCT ? '-4%' : '-5%';
          const intradaySlotLabel = `${currentIntradayActive + 1}/${MAX_INTRADAY_POSITIONS}`;

          // SHADOW/LIVE 통합 승인 큐 등록
          _scanEntries++;
          _lastBuySignalAt = Date.now();

          const intradayModeEmoji = shadowMode ? '📈' : '🚀';
          const intradayModeLabel = shadowMode ? 'Shadow' : 'LIVE';
          const intradayAlertMsg =
            `${intradayModeEmoji} <b>[${intradayModeLabel}] 장중 매수 ${shadowMode ? '신호' : '주문'}</b>\n` +
            `종목: ${stock.name} (${stock.code})\n` +
            `현재가: ${currentPrice.toLocaleString()}원 × ${quantity}주\n` +
            `손절: ${intradayStop.toLocaleString()} (${stopLabel}) | 목표: ${intradayTarget.toLocaleString()}\n` +
            `⚡ Intraday 포지션 ${intradaySlotLabel}`;

          intradayLiveBuyQueue.push(await createBuyTask({
            trade, stockCode: stock.code, stockName: stock.name,
            currentPrice, quantity, entryPrice: shadowEntryPrice,
            stopLoss: intradayStop, targetPrice: intradayTarget,
            gateScore: intradayGateScore, shadowMode, effectiveBudget,
            alertMessage: intradayAlertMsg, logEvent: shadowMode ? 'INTRADAY_SIGNAL' : 'INTRADAY_ORDER',
            onApproved: async (t) => {
              // 포지션 수 재확인 (큐 플러시 시점에 재검증)
              const latestIntradayCount = shadows.filter(
                (s) => isOpenShadowStatus(s.status) && s.watchlistSource === 'INTRADAY',
              ).length;
              if (latestIntradayCount >= MAX_INTRADAY_POSITIONS) {
                console.log(`[AutoTrade/Intraday] 최대 포지션 도달 — ${stock.name} 건너뜀`);
                t.status = 'REJECTED';
                return;
              }
              shadows.push(t);
              orderableCash = Math.max(0, orderableCash - effectiveBudget);
            },
          }));
          // Phase 1 ①: 큐 푸시 시점에 Intraday 슬롯 예약 (플러시 후 실패 시 롤백)
          reservedIntradaySlots++;
        } catch (err: unknown) {
          console.error(`[AutoTrade/Intraday] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
        }
      }

      // ── intradayBuyList 병렬 승인 큐 플러시 ──────────────────────────────────
      if (intradayLiveBuyQueue.length > 0) {
        const intradayApprovals = await Promise.allSettled(intradayLiveBuyQueue.map((t) => t.approvalPromise));
        let intradayApproved = 0, intradayRejected = 0;
        for (let i = 0; i < intradayLiveBuyQueue.length; i++) {
          const result = intradayApprovals[i];
          const action: ApprovalAction = result.status === 'fulfilled' ? result.value : 'SKIP';
          await intradayLiveBuyQueue[i].execute(action);
          if (action === 'APPROVE') intradayApproved++;
          else {
            // Phase 1 ①: Intraday 실패 예약 롤백
            intradayRejected++;
            reservedIntradaySlots = Math.max(0, reservedIntradaySlots - 1);
          }
        }
        if (intradayRejected > 0) {
          console.log(
            `[AutoTrade/Intraday] 승인 큐 플러시 — 승인 ${intradayApproved} / 거절·스킵 ${intradayRejected} → 예약 롤백 완료 (잔여 reservedIntradaySlots=${reservedIntradaySlots})`,
          );
        }
      }
    }
  }

  // entryFailCount 변경분 영속화
  if (watchlistMutated) {
    saveWatchlist(watchlist);
  }

  // ── 파이프라인 트레이서 — 스캔 결과 파일 영속화 (아이디어 10) ─────────────────
  if (!options?.sellOnly && _pendingTraces.length > 0) {
    appendScanTraces(_pendingTraces);
  }

  // ── 침묵 실패 탐지기 (아이디어 3) ────────────────────────────────────────────
  // sellOnly 모드는 신규 진입 스캔이 아니므로 집계 제외
  if (!options?.sellOnly) {
    const kstNow = new Date(Date.now() + 9 * 3_600_000);
    const timeLabel = kstNow.toISOString().slice(11, 16) + ' KST';
    _lastScanSummary = {
      time:       timeLabel,
      candidates: buyList.length + intradayBuyList.length,
      trackB:     buyList.length,
      swing:      swingList.length,
      catalyst:   catalystList.length,
      momentum:   momentumList.length,
      yahooFails: _scanYahooFails,
      gateMisses: _scanGateMisses,
      rrrMisses:  _scanRrrMisses,
      entries:    _scanEntries,
    };

    if (_scanEntries === 0 && _lastScanSummary.candidates > 0) {
      _consecutiveZeroScans++;
    } else {
      _consecutiveZeroScans = 0;
    }

    if (_consecutiveZeroScans >= 3) {
      _consecutiveZeroScans = 0; // 알림 후 리셋 — 스팸 방지
      await sendTelegramAlert(
        `📊 <b>[스캔 요약]</b> ${timeLabel}\n` +
        `총 후보: ${_lastScanSummary.candidates}개 | SWING: ${_lastScanSummary.swing}개 | CATALYST: ${_lastScanSummary.catalyst}개 | MOMENTUM: ${_lastScanSummary.momentum}개\n` +
        `- Yahoo 실패: ${_scanYahooFails}개 → 진입 보류\n` +
        `- Gate 미달: ${_scanGateMisses}개\n` +
        `- RRR 미달: ${_scanRrrMisses}개\n` +
        `- 진입 성공: 0개\n` +
        `⚠️ 3회 연속 진입 없음 — 파이프라인 점검 필요`
      ).catch(console.error);
    }
  }

  await updateShadowResults(shadows, regime);
  saveShadowTrades(shadows);
  return {};
}
