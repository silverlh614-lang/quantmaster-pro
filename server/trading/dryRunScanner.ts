/**
 * dryRunScanner.ts — 매수 시뮬레이션 드라이런 (아이디어 8)
 *
 * 실제 주문 없이 현재 파이프라인 상태에서 어떤 종목에 어떤 신호가 발생하는지
 * 평가한다. runAutoSignalScan()의 핵심 의사결정 로직을 부작용 없이 재현한다.
 */
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { computeFocusCodes } from '../screener/watchlistManager.js';
import { fetchCurrentPrice, fetchAccountBalance } from '../clients/kisClient.js';
import { fetchYahooQuote, fetchKisQuoteFallback, enrichQuoteWithKisMTAS, fetchKisIntraday } from '../screener/stockScreener.js';
import { evaluateServerGate } from '../quantFilter.js';
import { getLiveRegime } from './regimeBridge.js';
import { REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';
import {
  isOpenShadowStatus,
  calculateOrderQuantity,
  evaluateEntryRevalidation,
  buildStopLossPlan,
  getMinGateScore,
  getKstMarketElapsedMinutes,
} from './entryEngine.js';
import { isBlacklisted } from '../persistence/blacklistRepo.js';
import { calcRRR, RRR_MIN_THRESHOLD } from './riskManager.js';
import { getVixGating } from './vixGating.js';
import { getFomcProximity } from './fomcCalendar.js';
import { checkVolumeClockWindow } from './volumeClock.js';
import { PROFIT_TARGETS } from '../../src/services/quant/sellEngine.js';

export interface DryRunResult {
  stock: string;          // "삼성전자(005930)"
  stockCode: string;
  stockName: string;
  gateScore: number;
  liveGateScore: number;
  signalType: 'STRONG_BUY' | 'BUY' | null;
  wouldBuy: boolean;
  blockedBy: string | null;
  quantity: number;
  value: number;
  currentPrice: number;
  stopLoss: number;
  targetPrice: number;
  rrr: number;
}

export interface DryRunScanResult {
  dryRun:              true;
  scannedAt:           string;   // ISO
  regime:              string;
  kellyMultiplier:     number;
  vixBlocked:          boolean;
  fomcBlocked:         boolean;
  maxPositionsBlocked: boolean;
  volumeClockBlocked:  boolean;
  totalCandidates:     number;
  wouldBuyCount:       number;
  results:             DryRunResult[];
}

export async function runDryRunScan(): Promise<DryRunScanResult> {
  const watchlist        = loadWatchlist();
  const shadows          = loadShadowTrades();
  const macroState       = loadMacroState();
  const conditionWeights = loadConditionWeights();
  const regime           = getLiveRegime(macroState);
  const regimeConfig     = REGIME_CONFIGS[regime];
  const liveFocusCodes   = computeFocusCodes(watchlist);
  const buyList          = watchlist.filter(
    w => w.addedBy === 'MANUAL' || liveFocusCodes.has(w.code),
  );

  // 자금 산정 (signalScanner와 동일 로직)
  let totalAssets = Number(process.env.AUTO_TRADE_ASSETS || 0);
  const balance   = await fetchAccountBalance().catch(() => null);
  if (!totalAssets) totalAssets = balance ?? 30_000_000;
  const activeHolding = shadows
    .filter(s => isOpenShadowStatus(s.status))
    .reduce((sum, s) => sum + s.shadowEntryPrice * s.quantity, 0);
  let orderableCash = balance ?? Math.max(0, totalAssets - activeHolding);

  // 게이팅 평가
  const vixGating      = getVixGating(macroState?.vix, macroState?.vixHistory ?? []);
  const fomcProximity  = getFomcProximity();
  const volumeClock    = checkVolumeClockWindow();
  const kellyMultiplier = Math.min(
    1.5,
    regimeConfig.kellyMultiplier * vixGating.kellyMultiplier * fomcProximity.kellyMultiplier,
  );
  const activeSwingCount = shadows.filter(
    s => isOpenShadowStatus(s.status) &&
         s.watchlistSource !== 'INTRADAY' &&
         s.watchlistSource !== 'PRE_BREAKOUT',
  ).length;

  // 글로벌 차단 여부 — 이미 막혔으면 모든 종목에 동일 blockedBy 반환
  const globalBlock =
    vixGating.noNewEntry   ? `VIX_GATING: ${vixGating.reason}` :
    fomcProximity.noNewEntry ? `FOMC_GATING: ${fomcProximity.description}` :
    activeSwingCount >= regimeConfig.maxPositions ? `MAX_POSITIONS(${activeSwingCount}/${regimeConfig.maxPositions})` :
    !volumeClock.allowEntry ? `VOLUME_CLOCK: ${volumeClock.reason}` :
    null;

  const results: DryRunResult[] = [];

  for (const stock of buyList) {
    // 전역 차단 시 개별 평가 없이 즉시 기록
    if (globalBlock) {
      results.push({
        stock: `${stock.name}(${stock.code})`,
        stockCode: stock.code, stockName: stock.name,
        gateScore: stock.gateScore ?? 0, liveGateScore: 0,
        signalType: null, wouldBuy: false, blockedBy: globalBlock,
        quantity: 0, value: 0, currentPrice: 0,
        stopLoss: stock.stopLoss, targetPrice: stock.targetPrice, rrr: 0,
      });
      continue;
    }

    // ── 현재가 조회 ──────────────────────────────────────────────────────────
    const currentPrice = await fetchCurrentPrice(stock.code).catch(() => null);
    if (!currentPrice) {
      results.push({
        stock: `${stock.name}(${stock.code})`,
        stockCode: stock.code, stockName: stock.name,
        gateScore: stock.gateScore ?? 0, liveGateScore: 0,
        signalType: null, wouldBuy: false, blockedBy: 'PRICE_FETCH_FAIL',
        quantity: 0, value: 0, currentPrice: 0,
        stopLoss: stock.stopLoss, targetPrice: stock.targetPrice, rrr: 0,
      });
      continue;
    }

    // ── 진입 조건 체크 ───────────────────────────────────────────────────────
    const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= 0.01;
    const breakout  = currentPrice >= stock.entryPrice;
    const aboveStop = currentPrice > stock.stopLoss;
    if (!(nearEntry || breakout)) {
      results.push({
        stock: `${stock.name}(${stock.code})`,
        stockCode: stock.code, stockName: stock.name,
        gateScore: stock.gateScore ?? 0, liveGateScore: 0,
        signalType: null, wouldBuy: false,
        blockedBy: `NOT_AT_ENTRY(current=${currentPrice.toLocaleString()} entry=${stock.entryPrice.toLocaleString()})`,
        quantity: 0, value: 0, currentPrice,
        stopLoss: stock.stopLoss, targetPrice: stock.targetPrice,
        rrr: calcRRR(stock.entryPrice, stock.targetPrice, stock.stopLoss),
      });
      continue;
    }
    if (!aboveStop) {
      results.push({
        stock: `${stock.name}(${stock.code})`,
        stockCode: stock.code, stockName: stock.name,
        gateScore: stock.gateScore ?? 0, liveGateScore: 0,
        signalType: null, wouldBuy: false,
        blockedBy: `BELOW_STOP(current=${currentPrice.toLocaleString()} stop=${stock.stopLoss.toLocaleString()})`,
        quantity: 0, value: 0, currentPrice,
        stopLoss: stock.stopLoss, targetPrice: stock.targetPrice, rrr: 0,
      });
      continue;
    }

    // ── 블랙리스트 ───────────────────────────────────────────────────────────
    if (isBlacklisted(stock.code)) {
      results.push({
        stock: `${stock.name}(${stock.code})`,
        stockCode: stock.code, stockName: stock.name,
        gateScore: stock.gateScore ?? 0, liveGateScore: 0,
        signalType: null, wouldBuy: false, blockedBy: 'BLACKLIST',
        quantity: 0, value: 0, currentPrice,
        stopLoss: stock.stopLoss, targetPrice: stock.targetPrice, rrr: 0,
      });
      continue;
    }

    // ── RRR ──────────────────────────────────────────────────────────────────
    const rrr = calcRRR(stock.entryPrice, stock.targetPrice, stock.stopLoss);
    if (rrr < RRR_MIN_THRESHOLD) {
      results.push({
        stock: `${stock.name}(${stock.code})`,
        stockCode: stock.code, stockName: stock.name,
        gateScore: stock.gateScore ?? 0, liveGateScore: 0,
        signalType: null, wouldBuy: false,
        blockedBy: `RRR_FAIL(${rrr.toFixed(2)} < ${RRR_MIN_THRESHOLD})`,
        quantity: 0, value: 0, currentPrice,
        stopLoss: stock.stopLoss, targetPrice: stock.targetPrice, rrr,
      });
      continue;
    }

    // ── Yahoo Gate 재평가 ─────────────────────────────────────────────────────
    const shadowEntryPrice = Math.round(currentPrice * 1.003);
    const reCheckQuoteRaw  = await fetchYahooQuote(`${stock.code}.KS`).catch(() => null)
                          ?? await fetchYahooQuote(`${stock.code}.KQ`).catch(() => null)
                          ?? await fetchKisQuoteFallback(stock.code).catch(() => null);
    const reCheckQuote = reCheckQuoteRaw
      ? await enrichQuoteWithKisMTAS(reCheckQuoteRaw, stock.code)
      : null;

    // ── KIS 실시간 시가/전일종가 보정 ──
    if (reCheckQuote) {
      const kisSnap = await fetchKisIntraday(stock.code).catch(() => null);
      if (kisSnap) {
        if (kisSnap.dayOpen > 0)   reCheckQuote.dayOpen = kisSnap.dayOpen;
        if (kisSnap.prevClose > 0) reCheckQuote.prevClose = kisSnap.prevClose;
      }
    }

    const reCheckGate = reCheckQuote
      ? evaluateServerGate(reCheckQuote, conditionWeights, macroState?.kospiDayReturn)
      : null;

    if (!reCheckGate) {
      results.push({
        stock: `${stock.name}(${stock.code})`,
        stockCode: stock.code, stockName: stock.name,
        gateScore: stock.gateScore ?? 0, liveGateScore: 0,
        signalType: null, wouldBuy: false, blockedBy: 'YAHOO_UNAVAILABLE',
        quantity: 0, value: 0, currentPrice,
        stopLoss: stock.stopLoss, targetPrice: stock.targetPrice, rrr,
      });
      continue;
    }

    const liveGateScore = reCheckGate.gateScore ?? (stock.gateScore ?? 0);
    const entryRevalidation = evaluateEntryRevalidation({
      currentPrice,
      entryPrice:    stock.entryPrice,
      quoteGateScore:  reCheckGate.gateScore,
      quoteSignalType: reCheckGate.signalType,
      dayOpen:   reCheckQuote?.dayOpen,
      prevClose: reCheckQuote?.prevClose,
      volume:    reCheckQuote?.volume,
      avgVolume: reCheckQuote?.avgVolume,
      minGateScore: getMinGateScore(regime),
      marketElapsedMinutes: getKstMarketElapsedMinutes(),
    });

    if (!entryRevalidation.ok) {
      results.push({
        stock: `${stock.name}(${stock.code})`,
        stockCode: stock.code, stockName: stock.name,
        gateScore: stock.gateScore ?? 0, liveGateScore,
        signalType: null, wouldBuy: false,
        blockedBy: `GATE_FAIL(${entryRevalidation.reasons.join(',')})`,
        quantity: 0, value: 0, currentPrice,
        stopLoss: stock.stopLoss, targetPrice: stock.targetPrice, rrr,
      });
      continue;
    }

    // ── 포지션 사이징 ─────────────────────────────────────────────────────────
    const isStrongBuy  = liveGateScore >= 9;
    const signalType: 'STRONG_BUY' | 'BUY' = isStrongBuy ? 'STRONG_BUY' : 'BUY';
    const positionPct  = (isStrongBuy ? 0.12 : liveGateScore >= 7 ? 0.08 : 0.05)
                         * kellyMultiplier;
    const remainingSlots = Math.max(
      1,
      regimeConfig.maxPositions - activeSwingCount,
    );
    const stopLossPlan = buildStopLossPlan({
      entryPrice: shadowEntryPrice,
      regime,
      signalType,
      atr:    reCheckQuote?.atr    ?? 0,
      atr20avg: reCheckQuote?.atr20avg ?? 0,
      high20d: reCheckQuote?.high20d  ?? shadowEntryPrice,
      high60d: reCheckQuote?.high60d  ?? shadowEntryPrice,
    });
    const limitTranches = (PROFIT_TARGETS as Array<{ trigger: number; ratio: number }>).filter(
      t => typeof t.trigger === 'number' && t.trigger > 0,
    );
    const execQty = isStrongBuy
      ? Math.max(1, Math.floor(1 / (limitTranches.length + 1)))
      : 1;
    const { quantity } = calculateOrderQuantity({
      totalAssets,
      orderableCash,
      positionPct,
      price: shadowEntryPrice,
      remainingSlots,
    });
    const finalQty = isStrongBuy ? Math.max(1, Math.floor(quantity * execQty)) : quantity;

    if (finalQty < 1) {
      results.push({
        stock: `${stock.name}(${stock.code})`,
        stockCode: stock.code, stockName: stock.name,
        gateScore: stock.gateScore ?? 0, liveGateScore,
        signalType, wouldBuy: false, blockedBy: 'INSUFFICIENT_CASH',
        quantity: 0, value: 0, currentPrice,
        stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice, rrr,
      });
      continue;
    }

    results.push({
      stock: `${stock.name}(${stock.code})`,
      stockCode: stock.code, stockName: stock.name,
      gateScore: stock.gateScore ?? 0, liveGateScore,
      signalType, wouldBuy: true, blockedBy: null,
      quantity: finalQty, value: finalQty * shadowEntryPrice, currentPrice,
      stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice, rrr,
    });
    // 현금 차감 시뮬레이션 (다음 종목에 반영)
    orderableCash = Math.max(0, orderableCash - finalQty * shadowEntryPrice);
  }

  return {
    dryRun: true,
    scannedAt:           new Date().toISOString(),
    regime,
    kellyMultiplier,
    vixBlocked:          vixGating.noNewEntry,
    fomcBlocked:         fomcProximity.noNewEntry,
    maxPositionsBlocked: activeSwingCount >= regimeConfig.maxPositions,
    volumeClockBlocked:  !volumeClock.allowEntry,
    totalCandidates:     buyList.length,
    wouldBuyCount:       results.filter(r => r.wouldBuy).length,
    results,
  };
}
