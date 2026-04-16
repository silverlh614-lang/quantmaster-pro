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
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelBuySignal } from '../alerts/channelPipeline.js';
import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';
import { loadIntradayWatchlist } from '../persistence/intradayWatchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import {
  type ServerShadowTrade,
  loadShadowTrades, saveShadowTrades,
} from '../persistence/shadowTradeRepo.js';
import { isBlacklisted } from '../persistence/blacklistRepo.js';
import {
  RRR_MIN_THRESHOLD, MAX_SECTOR_CONCENTRATION,
  calcRRR,
} from './riskManager.js';
import { evaluatePortfolioRisk } from './portfolioRiskEngine.js';
import { getLiveRegime } from './regimeBridge.js';
import { REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';
import { PROFIT_TARGETS } from '../../src/services/quant/sellEngine.js';
import { addRecommendation } from '../learning/recommendationTracker.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { evaluateServerGate } from '../quantFilter.js';
import {
  computeFocusCodes, applyEntryPriceDrift, assignSection,
  CATALYST_POSITION_FACTOR, CATALYST_FIXED_STOP_PCT,
} from '../screener/watchlistManager.js';
import { fetchYahooQuote, fetchKisQuoteFallback, enrichQuoteWithKisMTAS, fetchKisIntraday } from '../screener/stockScreener.js';
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
  evaluateEntryRevalidation,
  regimeToStopRegime,
} from './entryEngine.js';

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

  // SWING + CATALYST = 매수 대상, MOMENTUM = 관찰 전용
  const buyList = watchlist.filter(
    (w) => w.section === 'SWING' || w.section === 'CATALYST' || forceCodes.has(w.code),
  );
  const swingList    = watchlist.filter((w) => w.section === 'SWING');
  const catalystList = watchlist.filter((w) => w.section === 'CATALYST');
  const momentumList = watchlist.filter((w) => w.section === 'MOMENTUM');

  // 진단 로그: MOMENTUM(관찰 전용) 종목 — 매수 스캔에서 제외
  if (momentumList.length > 0) {
    console.log(
      `[AutoTrade] MOMENTUM 관찰 ${momentumList.length}개 (매수 스캔 제외): ` +
      momentumList.map(w => `${w.name}(${w.code}) gate=${w.gateScore ?? 0}`).join(', '),
    );
  }
  let watchlistMutated = false;

  // 스캔 통계 카운터 (침묵 실패 탐지 · 파이프라인 헬스)
  let _scanYahooFails = 0;
  let _scanGateMisses = 0;
  let _scanRrrMisses  = 0;
  let _scanEntries    = 0;

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

  console.log(
    `[AutoTrade] 스캔 시작 — 워치리스트 ${watchlist.length}개 (SWING ${swingList.length}개 / CATALYST ${catalystList.length}개 / MOMENTUM ${momentumList.length}개) / Intraday Ready ${intradayBuyList.length}개 / 모드: ${shadowMode ? 'SHADOW' : 'LIVE'} / 총자산: ${totalAssets.toLocaleString()}원 / 주문가능현금: ${orderableCash.toLocaleString()}원`
  );

  const shadows = loadShadowTrades();
  if (balance === null) {
    const activeHoldingValue = shadows
      .filter((s) => isOpenShadowStatus(s.status))
      .reduce((sum, s) => sum + (s.shadowEntryPrice * s.quantity), 0);
    orderableCash = Math.max(0, totalAssets - activeHoldingValue);
  }

  // ── 레짐 분류 (classifyRegime — backtestPortfolio와 동일 로직) ──────────────
  const macroState = loadMacroState();
  const regime      = getLiveRegime(macroState);
  const regimeConfig = REGIME_CONFIGS[regime];

  // SELL_ONLY 모드: 신규 매수 없이 기존 포지션 모니터링만 실행
  // (adaptiveScanScheduler — VKOSPI 급등·R6_DEFENSE·마감 급변 구간 호출)
  if (options?.sellOnly) {
    console.log('[AutoTrade] SELL_ONLY 모드 — 포지션 모니터링 전용');
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return {};
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

  // 레짐 Kelly × VIX Kelly × FOMC Kelly → 유효 배율
  const kellyMultiplier = Math.min(
    1.5,  // 상한 캡 (POST 부스트 구간에서도 최대 1.5배)
    regimeConfig.kellyMultiplier * vixGating.kellyMultiplier * fomcProximity.kellyMultiplier,
  );
  if (vixGating.kellyMultiplier < 1) {
    console.log(`[AutoTrade] VIX 게이팅 적용 — ${vixGating.reason}`);
  }
  if (fomcProximity.kellyMultiplier !== 1) {
    console.log(`[AutoTrade] FOMC 게이팅 적용 — ${fomcProximity.description}`);
  }
  if (kellyMultiplier !== regimeConfig.kellyMultiplier) {
    console.log(`[AutoTrade] 레짐 ${regime} × VIX × FOMC — Kelly ×${kellyMultiplier.toFixed(2)}`);
  }

  // ── 동시 최대 보유 종목 (regimeConfig.maxPositions) ─────────────────────────
  // INTRADAY 포지션은 별도 한도(MAX_INTRADAY_POSITIONS)로 관리하므로 제외한다.
  // BUG-09 fix: PRE_BREAKOUT(30% 선취매)도 제외 — 선취매는 탐색적 소량 포지션이므로
  // 스윙 한도에 포함하면 같은 종목의 일반 스윙 진입이 이중 차단됨.
  const activeSwingCount = shadows.filter(
    (s) => isOpenShadowStatus(s.status) &&
           s.watchlistSource !== 'INTRADAY' &&
           s.watchlistSource !== 'PRE_BREAKOUT',
  ).length;
  if (activeSwingCount >= regimeConfig.maxPositions) {
    console.log(
      `[AutoTrade] 최대 동시 포지션 도달 (${activeSwingCount}/${regimeConfig.maxPositions}, 레짐 ${regime}) — 신규 진입 스킵`
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

  for (const stock of buyList) {
    // 아이디어 7: 루프 내에서도 포지션 수 재확인 (같은 스캔 중 복수 진입 방지)
    const currentActive = shadows.filter(
      (s) => isOpenShadowStatus(s.status) && s.watchlistSource !== 'INTRADAY',
    ).length;
    if (currentActive >= regimeConfig.maxPositions) {
      console.log(`[AutoTrade] 최대 포지션 도달 (${currentActive}/${regimeConfig.maxPositions}, 레짐 ${regime}) — 나머지 종목 스킵`);
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
            const slippage = 0.003;
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
            const { gate: reCheckGateFollow, quote: reCheckQuoteFollow } = await fetchGateData(stock.code, conditionWeights, macroState?.kospiDayReturn);
            const mtasFollow = reCheckGateFollow ? computeMtasMultiplier(reCheckGateFollow.mtas) : 1.0;
            const posPctFollow = computeRawPositionPct(gateScoreFollow) * kellyMultiplier * mtasFollow;
            const remSlots = Math.max(1, regimeConfig.maxPositions - shadows.filter(s => isOpenShadowStatus(s.status) && s.watchlistSource !== 'INTRADAY').length);
            const { quantity: fullQty } = calculateOrderQuantity({
              totalAssets, orderableCash, positionPct: posPctFollow,
              price: followEntryPrice, remainingSlots: remSlots,
            });
            const followQty = Math.max(1, Math.ceil(fullQty * 0.7));
            const profile    = stock.profileType ?? 'B';
            const profileKey = `profile${profile}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
            const regimeStopRate = REGIME_CONFIGS[regime].stopLoss[profileKey];
            const followATR14 = reCheckQuoteFollow?.atr ?? 0;
            const stopLossPlan = buildStopLossPlan({
              entryPrice: followEntryPrice, fixedStopLoss: stock.stopLoss, regimeStopRate, atr14: followATR14, regime,
            });
            const limitTranches = PROFIT_TARGETS[regime].filter(t => t.type === 'LIMIT' && t.trigger !== null);
            const trailTarget   = PROFIT_TARGETS[regime].find(t => t.type === 'TRAILING');
            const followTrade = buildBuyTrade({
              idPrefix: 'srv_pbf', stockCode: stock.code, stockName: stock.name,
              currentPrice, shadowEntryPrice: followEntryPrice, quantity: followQty,
              stopLossPlan, targetPrice: stock.targetPrice, shadowMode, regime,
              profileType: profile, watchlistSource: 'PRE_BREAKOUT_FOLLOWTHROUGH',
              profitTranches: limitTranches.map(t => ({ price: followEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false })),
              trailPct: trailTarget?.trailPct ?? 0.10, entryATR14: followATR14,
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
              const slippage = 0.003;
              const pbEntryPrice = Math.round(currentPrice * (1 + slippage));
              const gateScorePb = (stock.gateScore ?? 0) + volumeClock.scoreBonus;
              // BUG-05 fix: MTAS 기반 포지션 조정 (Pre-Breakout 선취매에도 적용)
              const [kisFlowPb, dartFinPb] = await Promise.all([
                fetchKisInvestorFlow(stock.code).catch(() => null),
                getDartFinancials(stock.code).catch(() => null),
              ]);
              const reCheckGatePb = evaluateServerGate(reCheckQuotePb, conditionWeights, macroState?.kospiDayReturn, dartFinPb, kisFlowPb);
              const mtasPb = reCheckGatePb ? computeMtasMultiplier(reCheckGatePb.mtas) : 1.0;
              const posPctPb    = computeRawPositionPct(gateScorePb) * kellyMultiplier * mtasPb;
              const remSlotsPb  = Math.max(1, regimeConfig.maxPositions - shadows.filter(s => isOpenShadowStatus(s.status) && s.watchlistSource !== 'INTRADAY').length);
              const { quantity: fullPbQty } = calculateOrderQuantity({
                totalAssets, orderableCash, positionPct: posPctPb,
                price: pbEntryPrice, remainingSlots: remSlotsPb,
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
                const limitTranchesPb = PROFIT_TARGETS[regime].filter(t => t.type === 'LIMIT' && t.trigger !== null);
                const trailTargetPb   = PROFIT_TARGETS[regime].find(t => t.type === 'TRAILING');
                const pbTrade = buildBuyTrade({
                  idPrefix: 'srv_pb', stockCode: stock.code, stockName: stock.name,
                  currentPrice, shadowEntryPrice: pbEntryPrice, quantity: pbQty, originalQuantity: fullPbQty,
                  stopLossPlan: stopLossPlanPb, targetPrice: stock.targetPrice, shadowMode, regime,
                  profileType: profilePb, watchlistSource: 'PRE_BREAKOUT',
                  profitTranches: limitTranchesPb.map(t => ({ price: pbEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false })),
                  trailPct: trailTargetPb?.trailPct ?? 0.10, entryATR14: pbATR14,
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

      const slippage = 0.003;
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
          if (kisSnap.dayOpen > 0 && reCheckQuote.dayOpen !== kisSnap.dayOpen) {
            console.log(
              `[KisIntraday] ${stock.code} 시가 보정: Yahoo=${reCheckQuote.dayOpen} → KIS=${kisSnap.dayOpen}`,
            );
            reCheckQuote.dayOpen = kisSnap.dayOpen;
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
        ? evaluateServerGate(reCheckQuote, conditionWeights, macroState?.kospiDayReturn, dartFin, kisFlow)
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

      // 포지션 사이징: 실시간 Gate 결과 연동 (buyPipeline 헬퍼 사용)
      // CATALYST 섹션은 표준의 60%로 축소 — 촉매 신호는 단기 고리스크이므로 손실 제한
      const mtasMultiplier = computeMtasMultiplier(reCheckGate.mtas);
      const sectionFactor = stock.section === 'CATALYST' ? CATALYST_POSITION_FACTOR : 1.0;
      const positionPct = computeRawPositionPct(gateScore) * kellyMultiplier * mtasMultiplier * sectionFactor;

      if (reCheckGate) {
        console.log(
          `[AutoTrade] ${stock.name} 타점 판단 — ` +
          `liveGate: ${liveGateScore.toFixed(1)} (stale: ${(stock.gateScore ?? 0)}) | ` +
          `MTAS: ${reCheckGate.mtas.toFixed(1)}/10 (×${mtasMultiplier}) | ` +
          `CS: ${reCheckGate.compressionScore.toFixed(2)} | ` +
          `posPct: ${(positionPct * 100).toFixed(1)}%`
        );
      }
      const remainingSlots = Math.max(1, regimeConfig.maxPositions - currentActive);
      const { quantity, effectiveBudget } = calculateOrderQuantity({
        totalAssets,
        orderableCash,
        positionPct,
        price: shadowEntryPrice,
        remainingSlots,
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

      // L3 분할 익절 타겟 — PROFIT_TARGETS[regime]에서 LIMIT 트랜치 추출
      const limitTranches = PROFIT_TARGETS[regime].filter((t) => t.type === 'LIMIT' && t.trigger !== null);
      const trailTarget = PROFIT_TARGETS[regime].find((t) => t.type === 'TRAILING');

      const trade = buildBuyTrade({
        idPrefix: 'srv', stockCode: stock.code, stockName: stock.name,
        currentPrice, shadowEntryPrice, quantity: execQty,
        stopLossPlan, targetPrice: stock.targetPrice, shadowMode, regime,
        profileType: profile, watchlistSource: undefined,
        profitTranches: limitTranches.map((t) => ({
          price: shadowEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false,
        })),
        trailPct: trailTarget?.trailPct ?? 0.10, entryATR14,
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
      stageLog.buy = shadowMode ? 'SHADOW' : 'LIVE'; pushTrace();

      const modeEmoji = shadowMode ? '⚡' : '🚀';
      const modeLabel = shadowMode ? 'Shadow' : 'LIVE';
      const trancheLabel = isStrongBuy ? ` (1차/${execQty}주, 총${quantity}주)` : '';
      const gateLabel = `Gate ${liveGateScore.toFixed(1)} | MTAS ${reCheckGate.mtas.toFixed(0)}/10 | CS ${reCheckGate.compressionScore.toFixed(2)}`;
      const slBreakdown = formatStopLossBreakdown(stopLossPlan);
      const mainAlertMsg =
        `${modeEmoji} <b>[${modeLabel}] 매수 ${shadowMode ? '신호' : '주문'}${isStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
        `종목: ${stock.name} (${stock.code})\n` +
        `현재가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isStrongBuy ? ` (총${quantity}주)` : ''}\n` +
        `📊 ${gateLabel}\n` +
        `손절: ${slBreakdown} | 목표: ${stock.targetPrice.toLocaleString()}원`;

      const _rrr = stock.rrr, _sector = stock.sector;
      liveBuyQueue.push(await createBuyTask({
        trade, stockCode: stock.code, stockName: stock.name,
        currentPrice, quantity: execQty, entryPrice: shadowEntryPrice,
        stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
        gateScore, shadowMode, effectiveBudget,
        alertMessage: mainAlertMsg, logEvent: shadowMode ? 'SIGNAL' : 'ORDER',
        onApproved: async (t) => {
          shadows.push(t);
          await channelBuySignal({
            mode: shadowMode ? 'SHADOW' : 'LIVE', stockName: stock.name, stockCode: stock.code,
            price: currentPrice, quantity: execQty, gateScore: liveGateScore,
            mtas: reCheckGate.mtas, cs: reCheckGate.compressionScore,
            stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
            rrr: _rrr ?? 0, signalType: isStrongBuy ? 'STRONG_BUY' : 'BUY',
            sector: _sector,
          }).catch(console.error);
          orderableCash = Math.max(0, orderableCash - effectiveBudget);
          if (isStrongBuy && quantity > 1) {
            trancheExecutor.scheduleTranches({
              parentTradeId: t.id, stockCode: stock.code, stockName: stock.name,
              totalQuantity: quantity, firstQuantity: execQty,
              entryPrice: shadowEntryPrice, stopLoss: stopLossPlan.hardStopLoss,
              targetPrice: stock.targetPrice,
            });
          }
        },
      }));
    } catch (err: unknown) {
      console.error(`[AutoTrade] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
    }
  }

  // ── buyList 병렬 승인 큐 플러시 ─────────────────────────────────────────────
  // 모든 승인 요청을 동시에 발송했다가 응답을 일괄 수거한 후 순차 실행
  if (liveBuyQueue.length > 0) {
    const approvals = await Promise.allSettled(liveBuyQueue.map((t) => t.approvalPromise));
    for (let i = 0; i < liveBuyQueue.length; i++) {
      const result = approvals[i];
      const action: ApprovalAction = result.status === 'fulfilled' ? result.value : 'SKIP';
      await liveBuyQueue[i].execute(action);
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

      for (const stock of intradayBuyList) {
        // 포지션 수 재확인
        const currentIntradayActive = shadows.filter(
          (s) => isOpenShadowStatus(s.status) && s.watchlistSource === 'INTRADAY',
        ).length;
        if (currentIntradayActive >= MAX_INTRADAY_POSITIONS) {
          console.log(`[AutoTrade/Intraday] 최대 포지션 도달 (${currentIntradayActive}/${MAX_INTRADAY_POSITIONS}) — 나머지 스킵`);
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

          const slippage         = 0.003;
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
          const { gate: intradayGate } = await fetchGateData(stock.code, conditionWeights, macroState?.kospiDayReturn);
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
        } catch (err: unknown) {
          console.error(`[AutoTrade/Intraday] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
        }
      }

      // ── intradayBuyList 병렬 승인 큐 플러시 ──────────────────────────────────
      if (intradayLiveBuyQueue.length > 0) {
        const intradayApprovals = await Promise.allSettled(intradayLiveBuyQueue.map((t) => t.approvalPromise));
        for (let i = 0; i < intradayLiveBuyQueue.length; i++) {
          const result = intradayApprovals[i];
          const action: ApprovalAction = result.status === 'fulfilled' ? result.value : 'SKIP';
          await intradayLiveBuyQueue[i].execute(action);
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