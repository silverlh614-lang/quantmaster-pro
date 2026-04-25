/**
 * signalScanner.ts — 장중 자동 신호 스캔 오케스트레이터
 *
 * 세부 로직은 다음 서브모듈로 분리됨:
 *   entryEngine.ts  — 진입 검증 유틸리티 (EXIT_RULE_PRIORITY_TABLE, buildStopLossPlan, calculateOrderQuantity, evaluateEntryRevalidation, isOpenShadowStatus)
 *   exitEngine.ts   — 포지션 모니터링 및 청산 엔진 (updateShadowResults)
 *   buyPipeline.ts  — 매수 실행 공통 헬퍼 (MTAS 배수, Gate 조회, Trade 빌더, 승인 큐)
 */

import {
  fetchAccountBalance,
  fetchKisInvestorFlow,
} from '../clients/kisClient.js';
import { getRealtimePrice } from '../clients/kisStreamClient.js';
import {
  getPrice,
  FAILURE_BLOCK_THRESHOLD_PCT,
  type SymbolExitContext,
  getAdaptiveProfitTargets,
  evaluateBuyList,
  evaluateIntradayList,
} from './signalScanner/perSymbolEvaluation.js';
import { getDartFinancials } from '../clients/dartFinancialClient.js';
import { getKellyMultiplier as getIpsKellyMultiplier, loadKellyDampenerState } from './kellyDampener.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelBuySignalEmitted } from '../alerts/channelPipeline.js';
import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';
import { loadIntradayWatchlist } from '../persistence/intradayWatchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { computeShadowAccount } from '../persistence/shadowAccountRepo.js';
import { loadTradingSettings } from '../persistence/tradingSettingsRepo.js';
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

// FAILURE_BLOCK_THRESHOLD_PCT, getPrice, SymbolExitContext, getAdaptiveProfitTargets
// 는 signalScanner/perSymbolEvaluation.ts 에서 이식 후 import.
import { getManualBlockNewBuy, getManualManageOnly } from '../state.js';

// ── Phase 2-③: SELL_ONLY Top-K 예외 채널 평가 — preflight 단일 SSOT ───────────
// PR-42 M3: 이전 inline 본체(L66~102) 와 signalScanner/preflight.ts:82~108 가 byte
// 동일한 채로 병존하던 drift 위험을 제거. preflight 의 export 만 사용한다.
import { evaluateSellOnlyException } from './signalScanner/preflight.js';
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
// scanTracer 의 ScanTrace 영속화는 scanDiagnostics 모듈이 담당.
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

// ── 스캔 진단 상태 (scanDiagnostics 모듈로 위임) ──────────────────────────────
export {
  type ScanSummary,
  getLastBuySignalAt,
  getLastScanSummary,
  getConsecutiveZeroScans,
} from './signalScanner/scanDiagnostics.js';
import {
  setLastBuySignalAt,
  createScanCounters,
  persistScanResults,
} from './signalScanner/scanDiagnostics.js';

// PR-42 M3: getAccountScaleKellyMultiplier 의 inline 정의를 제거하고 preflight 의
// export 단일 SSOT 만 사용한다. 이전엔 byte 동일한 본체가 양쪽에 병존해 drift 위험.
import { getAccountScaleKellyMultiplier } from './signalScanner/preflight.js';

// SymbolExitContext / getAdaptiveProfitTargets 는 signalScanner/perSymbolEvaluation.ts
// 로 이동 (Step 4a). 외부 노출은 본 파일 상단의 import 를 통해 유지.
export type { SymbolExitContext };

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

  // 스캔 통계 카운터 — scanDiagnostics 의 ScanCounters 객체를 사용 (mutate 가능).
  // 원본의 모듈 전역 _scanYahooFails 등을 본 객체 안으로 캡슐화 (스캔 1회당 인스턴스).
  const _counters = createScanCounters();

  // 장중 워치리스트: intradayReady=true 항목만 진입 후보
  const intradayBuyList = loadIntradayWatchlist().filter(w => w.intradayReady === true);

  const shadowMode = process.env.AUTO_TRADE_MODE !== 'LIVE'; // 기본 Shadow 모드

  // PR-5 #11: SHADOW ↔ LIVE 계좌 잔고 분리.
  // 이전 코드는 shadowMode 여부와 무관하게 fetchAccountBalance() (실/모의 KIS 잔고)
  // 를 읽어 totalAssets 로 삼았고, SHADOW 상태에서도 KIS 잔고가 "Shadow 보유가치"
  // 차감 대상이 되면서 로그/사이징/알림이 모두 실계좌 값으로 표시되었다.
  //
  // 원칙:
  //   - SHADOW 모드 → shadowAccountRepo.computeShadowAccount() 의 독립 원장 사용
  //     (startingCapital 기반, KIS 잔고 미참조)
  //   - LIVE 모드   → fetchAccountBalance() KIS 실/모의 잔고 사용
  //
  // Shadow 는 진짜 가상 포트폴리오로 독립 운용되어야 한다는 사용자 요구(2026-04-24).
  const shadows = loadShadowTrades();
  let totalAssets: number;
  let orderableCash: number;
  let activeHoldingValue = 0;

  if (shadowMode) {
    const settings = loadTradingSettings();
    // AUTO_TRADE_ASSETS 가 명시됐으면 그 값으로 시작원금 오버라이드 (운영 편의).
    const startingCapital = Number(process.env.AUTO_TRADE_ASSETS || settings.startingCapital);
    const account = computeShadowAccount(shadows, startingCapital);
    totalAssets        = account.totalAssets;      // cash + invested + unrealized(미제공 시 invested)
    orderableCash      = Math.max(0, account.cashBalance);
    activeHoldingValue = account.totalInvested;
  } else {
    totalAssets = Number(process.env.AUTO_TRADE_ASSETS || 0);
    const balance = await fetchAccountBalance().catch(() => null);
    if (!totalAssets) totalAssets = balance ?? 30_000_000; // 모의계좌 기본 3천만원
    orderableCash = balance ?? totalAssets;
  }
  const conditionWeights = loadConditionWeights();

  console.log(
    `[AutoTrade] 스캔 시작 — 워치리스트 ${watchlist.length}개 (SWING ${swingList.length}개 / CATALYST ${catalystList.length}개 / MOMENTUM ${momentumList.length}개) / Intraday Ready ${intradayBuyList.length}개 / 모드: ${shadowMode ? 'SHADOW' : 'LIVE'}`
  );

  // 레거시 호환: preMarket 경로에서 이미 activeHoldingValue 를 미리 계산해둔 경우를
  // 대비해, shadowMode 이면서 activeHoldingValue 가 0 이면 fills 기반으로 한 번 더 확인.
  if (shadowMode && activeHoldingValue === 0) {
    activeHoldingValue = shadows
      .filter((s) => isOpenShadowStatus(s.status))
      .reduce((sum, s) => sum + (s.shadowEntryPrice * s.quantity), 0);
  }

  console.log(
    shadowMode
      ? `[AutoTrade] [SHADOW] 가상 계좌 기준 — 시작원금: ${totalAssets.toLocaleString()}원 / 현금: ${orderableCash.toLocaleString()}원 / 보유가치: ${activeHoldingValue.toLocaleString()}원 / 모드: SHADOW`
      : `[AutoTrade] [LIVE] 실계좌 기준 — 총자산: ${totalAssets.toLocaleString()}원 / 주문가능현금: ${orderableCash.toLocaleString()}원 / 모드: LIVE`
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

  // 메인 per-stock 루프 — perSymbolEvaluation/evaluateBuyList 로 위임 (ADR-0001 Phase B Step 4b)
  // 박스 패턴: 지역 let 변수 4개 (reservedSlots, probingReservedSlots, orderableCash,
  // watchlistMutated) 를 box 객체로 wrap → ctx 에 전달 → 호출 후 .value 를 다시 풀어
  // 후속 큐 플러시·watchlist 영속화 코드와 동일 시그니처를 유지한다.
  {
    const _reservedSlotsBox = { value: reservedSlots };
    const _probingReservedSlotsBox = { value: probingReservedSlots };
    const _orderableCashBox = { value: orderableCash };
    const _watchlistMutatedBox = { value: watchlistMutated };
    await evaluateBuyList({
      buyList,
      swingList,
      watchlist,
      shadows,
      shadowMode,
      totalAssets,
      effectiveMaxPositions,
      regime,
      regimeConfig,
      macroState,
      vixGating,
      fomcProximity,
      kellyMultiplier,
      accountKellyMultiplier,
      banditDecision,
      sellOnlyExc,
      volumeClock,
      conditionWeights,
      scanCounters: _counters,
      mutables: {
        liveBuyQueue,
        reservedSlots: _reservedSlotsBox,
        probingReservedSlots: _probingReservedSlotsBox,
        reservedTiers,
        reservedIsMomentum,
        reservedBudgets,
        reservedSectorValues,
        pendingSectorValue,
        currentSectorValue,
        orderableCash: _orderableCashBox,
        watchlistMutated: _watchlistMutatedBox,
      },
    });
    // 호출 후 box 값 복원 — 큐 플러시·watchlist 영속화 코드가 기존 let 변수를 참조한다.
    reservedSlots = _reservedSlotsBox.value;
    probingReservedSlots = _probingReservedSlotsBox.value;
    orderableCash = _orderableCashBox.value;
    watchlistMutated = _watchlistMutatedBox.value;
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

  // 장중 Watchlist 처리 — perSymbolEvaluation/evaluateIntradayList 로 위임 (ADR-0001 Phase B Step 4c)
  const intradayMutables = { orderableCash: { value: orderableCash } };
  await evaluateIntradayList({
    intradayBuyList, shadows, shadowMode, totalAssets, accountKellyMultiplier,
    kellyMultiplier, regime, regimeConfig, macroState, conditionWeights,
    options: options ?? {},
    scanCounters: _counters,
    mutables: intradayMutables,
  });
  orderableCash = intradayMutables.orderableCash.value;

  // entryFailCount 변경분 영속화
  if (watchlistMutated) {
    saveWatchlist(watchlist);
  }

  // ── 진단 영속화 (scanDiagnostics 모듈로 위임) ────────────────────────────────
  // pendingTraces 파일 기록 + ScanSummary 갱신 + 3회 침묵 시 텔레그램 알림.
  await persistScanResults(_counters, {
    sellOnly: options?.sellOnly,
    buyListLength: buyList.length,
    intradayBuyListLength: intradayBuyList.length,
    swingListLength: swingList.length,
    catalystListLength: catalystList.length,
    momentumListLength: momentumList.length,
  });

  await updateShadowResults(shadows, regime);
  saveShadowTrades(shadows);
  return {};
}
