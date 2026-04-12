/**
 * signalScanner.ts — 장중 자동 신호 스캔 오케스트레이터
 *
 * 세부 로직은 다음 서브모듈로 분리됨:
 *   entryEngine.ts — 진입 검증 유틸리티 (EXIT_RULE_PRIORITY_TABLE, buildStopLossPlan, calculateOrderQuantity, evaluateEntryRevalidation, isOpenShadowStatus)
 *   exitEngine.ts  — 포지션 모니터링 및 청산 엔진 (updateShadowResults)
 */

import {
  BUY_TR_ID,
  kisPost,
  fetchCurrentPrice, fetchAccountBalance,
} from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import {
  type ServerShadowTrade,
  loadShadowTrades, saveShadowTrades, appendShadowLog,
} from '../persistence/shadowTradeRepo.js';
import { isBlacklisted } from '../persistence/blacklistRepo.js';
import {
  RRR_MIN_THRESHOLD, MAX_SECTOR_CONCENTRATION,
  calcRRR,
} from './riskManager.js';
import { getLiveRegime } from './regimeBridge.js';
import { REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';
import { PROFIT_TARGETS } from '../../src/services/quant/sellEngine.js';
import { addRecommendation } from '../learning/recommendationTracker.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { evaluateServerGate } from '../quantFilter.js';
import { fetchYahooQuote } from '../screener/stockScreener.js';
import { fillMonitor } from './fillMonitor.js';
import { trancheExecutor } from './trancheExecutor.js';
import { getVixGating } from './vixGating.js';
import { getFomcProximity } from './fomcCalendar.js';
import {
  isOpenShadowStatus,
  buildStopLossPlan,
  formatStopLossBreakdown,
  calculateOrderQuantity,
  evaluateEntryRevalidation,
} from './entryEngine.js';
import { updateShadowResults } from './exitEngine.js';

// ── 서브모듈 re-export (하위 호환성 유지) ──────────────────────────────────────
export {
  EXIT_RULE_PRIORITY_TABLE,
  StopLossPlan,
  buildStopLossPlan,
  PositionSizingInput,
  calculateOrderQuantity,
  evaluateEntryRevalidation,
} from './entryEngine.js';

/**
 * 아이디어 1: 장중 자동 신호 스캔
 * - 관심 종목 현재가 조회
 * - 진입 조건 판정: 현재가 ≥ entryPrice AND 손절선 이상
 * - 조건 충족 시 Shadow 또는 실 주문 실행
 *
 * options.sellOnly: true → 신규 매수 없이 기존 포지션 모니터링만 실행
 *   (VKOSPI 급등·R6_DEFENSE·마감 급변 시 adaptiveScanScheduler가 호출)
 */
export async function runAutoSignalScan(options?: { sellOnly?: boolean }): Promise<void> {
  if (!process.env.KIS_APP_KEY) {
    console.warn('[AutoTrade] KIS_APP_KEY 미설정 — 스캔 건너뜀');
    return;
  }

  const watchlist = loadWatchlist();
  if (watchlist.length === 0) return;

  const shadowMode = process.env.AUTO_TRADE_MODE !== 'LIVE'; // 기본 Shadow 모드

  // 투자 총자산: 환경변수 → KIS 계좌 주문가능현금+기본값 순으로 결정
  let totalAssets = Number(process.env.AUTO_TRADE_ASSETS || 0);
  const balance = await fetchAccountBalance().catch(() => null);
  if (!totalAssets) totalAssets = balance ?? 30_000_000; // 모의계좌 기본 3천만원
  let orderableCash = balance ?? totalAssets;
  const conditionWeights = loadConditionWeights();

  console.log(
    `[AutoTrade] 스캔 시작 — ${watchlist.length}개 종목 / 모드: ${shadowMode ? 'SHADOW' : 'LIVE'} / 총자산: ${totalAssets.toLocaleString()}원 / 주문가능현금: ${orderableCash.toLocaleString()}원`
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
    return;
  }

  if (regime === 'R6_DEFENSE') {
    await sendTelegramAlert(
      `🔴 <b>[R6_DEFENSE] 신규 진입 전면 차단</b>\n` +
      `MHS: ${macroState?.mhs ?? 'N/A'} | 블랙스완 감지 — 기존 포지션 모니터링만 수행`
    ).catch(console.error);
    console.warn(`[AutoTrade] R6_DEFENSE (MHS=${macroState?.mhs}) — 신규 진입 전면 차단`);
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return;
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
    return;
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
    return;
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
  const activeCount = shadows.filter(
    (s) => isOpenShadowStatus(s.status)
  ).length;
  if (activeCount >= regimeConfig.maxPositions) {
    console.log(
      `[AutoTrade] 최대 동시 포지션 도달 (${activeCount}/${regimeConfig.maxPositions}, 레짐 ${regime}) — 신규 진입 스킵`
    );
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return;
  }

  for (const stock of watchlist) {
    // 아이디어 7: 루프 내에서도 포지션 수 재확인 (같은 스캔 중 복수 진입 방지)
    const currentActive = shadows.filter(
      (s) => isOpenShadowStatus(s.status)
    ).length;
    if (currentActive >= regimeConfig.maxPositions) {
      console.log(`[AutoTrade] 최대 포지션 도달 (${currentActive}/${regimeConfig.maxPositions}, 레짐 ${regime}) — 나머지 종목 스킵`);
      break;
    }

    try {
      const currentPrice = await fetchCurrentPrice(stock.code).catch(() => null);
      if (!currentPrice) continue;

      // 진입 조건: 현재가가 entryPrice ± 1% 이내로 도달
      const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= 0.01;
      // 손절 상향: 아직 손절선 위에 있어야 함
      const aboveStop = currentPrice > stock.stopLoss;
      // 상승 모멘텀: 현재가가 entry 이상
      const breakout = currentPrice >= stock.entryPrice;

      if (!(nearEntry || breakout) || !aboveStop) continue;

      // 버그 6 수정: 당일 재진입 방지 — PENDING/ACTIVE 및 당일 이미 거래한 종목 제외
      const today = new Date().toISOString().split('T')[0];
      const alreadyTraded = shadows.some(
        (s) => s.stockCode === stock.code &&
        (isOpenShadowStatus(s.status) ||
         s.signalTime.startsWith(today))
      );
      if (alreadyTraded) continue;

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
        continue;
      }

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

      const slippage = 0.003;
      const shadowEntryPrice = Math.round(currentPrice * (1 + slippage));
      // 버그 5 수정: Gate 점수 기반 간이 Kelly 포지션 사이징
      const gateScore = stock.gateScore ?? 0;
      const isStrongBuy = gateScore >= 25;

      const reCheckQuote = await fetchYahooQuote(`${stock.code}.KS`).catch(() => null)
                        ?? await fetchYahooQuote(`${stock.code}.KQ`).catch(() => null);
      const reCheckGate = reCheckQuote
        ? evaluateServerGate(reCheckQuote, conditionWeights, macroState?.kospiDayReturn)
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
      });
      if (!entryRevalidation.ok) {
        console.log(`[AutoTrade] ${stock.name} 진입 직전 재검증 탈락: ${entryRevalidation.reasons.join(', ')}`);
        continue;
      }

      const rawPositionPct = isStrongBuy       ? 0.12
                           : gateScore >= 20   ? 0.08
                           : gateScore >= 15   ? 0.05
                           : 0.03;
      // 레짐 Kelly 배율 적용 (R1=1.0, R2=0.8, R3=0.6, R4=0.5, R5=0.3)
      const positionPct = rawPositionPct * kellyMultiplier;
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
      const profile    = stock.profileType ?? 'B';
      const profileKey = `profile${profile}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
      const regimeStopRate  = REGIME_CONFIGS[regime].stopLoss[profileKey]; // 음수 비율 (e.g., -0.10)
      const stopLossPlan = buildStopLossPlan({
        entryPrice: shadowEntryPrice,
        fixedStopLoss: stock.stopLoss,
        regimeStopRate,
      });

      // L3 분할 익절 타겟 — PROFIT_TARGETS[regime]에서 LIMIT 트랜치 추출
      const limitTranches = PROFIT_TARGETS[regime].filter(
        (t) => t.type === 'LIMIT' && t.trigger !== null
      );
      const trailTarget = PROFIT_TARGETS[regime].find((t) => t.type === 'TRAILING');

      const trade: ServerShadowTrade = {
        id: `srv_${Date.now()}_${stock.code}`,
        stockCode: stock.code,
        stockName: stock.name,
        signalTime: new Date().toISOString(),
        signalPrice: currentPrice,
        shadowEntryPrice,
        quantity: execQty,
        originalQuantity: execQty,
        stopLoss: stopLossPlan.hardStopLoss,
        initialStopLoss: stopLossPlan.initialStopLoss,
        regimeStopLoss: stopLossPlan.regimeStopLoss,
        hardStopLoss: stopLossPlan.hardStopLoss,
        targetPrice: stock.targetPrice,
        status: 'PENDING',
        // ─── 레짐 연결 ──────────────────────────────────────────────────────
        entryRegime: regime,
        profileType: profile,
        profitTranches: limitTranches.map((t) => ({
          price: shadowEntryPrice * (1 + (t.trigger as number)),
          ratio: t.ratio,
          taken: false,
        })),
        trailingHighWaterMark: shadowEntryPrice,
        trailPct: trailTarget?.trailPct ?? 0.10,
        trailingEnabled: false,
      };

      // 아이디어 10: 추천 기록 — 신호 발생 즉시 저장 (WIN/LOSS 추후 평가)
      // 버그 4 수정: gateScore·signalType을 워치리스트 entry에서 가져와 자기학습 통계 정상화
      addRecommendation({
        stockCode:        stock.code,
        stockName:        stock.name,
        signalTime:       new Date().toISOString(),
        priceAtRecommend: currentPrice,
        stopLoss:         stopLossPlan.hardStopLoss,
        targetPrice:      stock.targetPrice,
        kellyPct:         Math.round(positionPct * 100),
        gateScore:        gateScore,
        signalType:       isStrongBuy ? 'STRONG_BUY' : 'BUY',
        conditionKeys:    stock.conditionKeys ?? [],
        entryRegime:      regime,  // 레짐별 캘리브레이션용 (아이디어 1)
      });

      const trancheLabel = isStrongBuy ? ` (1차/${execQty}주, 총${quantity}주)` : '';

      if (shadowMode) {
        shadows.push(trade);
        console.log(`[AutoTrade SHADOW] ${stock.name}(${stock.code}) 신호 등록 @${currentPrice}${trancheLabel}`);
        appendShadowLog({ event: 'SIGNAL', ...trade });

        await sendTelegramAlert(
          `⚡ <b>[Shadow] 매수 신호${isStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `현재가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isStrongBuy ? ` (총${quantity}주)` : ''}\n` +
          `손절: ${formatStopLossBreakdown(stopLossPlan)} | 목표: ${stock.targetPrice.toLocaleString()}원`
        ).catch(console.error);
      } else {
        // LIVE 모드: 실제 주문 (1차 수량만)
        const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
          CANO: process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          PDNO: stock.code.padStart(6, '0'),
          ORD_DVSN: '01', // 시장가
          ORD_QTY: execQty.toString(),
          ORD_UNPR: '0',
          SLL_BUY_DVSN_CD: '02',
          CTAC_TLNO: '',
          MGCO_APTM_ODNO: '',
          ORD_SVR_DVSN_CD: '0',
        });
        const ordNo = orderData?.output?.ODNO;
        console.log(`[AutoTrade LIVE] ${stock.name} 매수 주문 완료 — ODNO: ${ordNo}${trancheLabel}`);
        appendShadowLog({ event: 'ORDER', code: stock.code, price: currentPrice, ordNo, tranche: isStrongBuy ? 1 : 0 });

        if (ordNo) {
          fillMonitor.addOrder({
            ordNo,
            stockCode:      stock.code,
            stockName:      stock.name,
            quantity:       execQty,
            orderPrice:     shadowEntryPrice,
            placedAt:       new Date().toISOString(),
            relatedTradeId: trade.id,
          });
          trade.status = 'ORDER_SUBMITTED';
        } else {
          trade.status = 'REJECTED';
        }

        shadows.push(trade);

        await sendTelegramAlert(
          `🚀 <b>[LIVE] 매수 주문${isStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `주문상태: ${ordNo ? 'ORDER_SUBMITTED' : 'REJECTED'}\n` +
          `주문가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isStrongBuy ? ` (총${quantity}주)` : ''}\n` +
          `주문번호: ${ordNo ?? 'N/A'}\n` +
          `손절: ${formatStopLossBreakdown(stopLossPlan)} | 목표: ${stock.targetPrice.toLocaleString()}원`
        ).catch(console.error);
      }

      if (trade.status !== 'REJECTED') {
        orderableCash = Math.max(0, orderableCash - effectiveBudget);
      }

      // 아이디어 8: STRONG_BUY → 2·3차 분할 매수 스케줄 등록
      if (isStrongBuy && quantity > 1 && trade.status !== 'REJECTED') {
        trancheExecutor.scheduleTranches({
          parentTradeId: trade.id,
          stockCode:     stock.code,
          stockName:     stock.name,
          totalQuantity: quantity,
          firstQuantity: execQty,
          entryPrice:    shadowEntryPrice,
          stopLoss:      stopLossPlan.hardStopLoss,
          targetPrice:   stock.targetPrice,
        });
      }
    } catch (err: unknown) {
      console.error(`[AutoTrade] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
    }
  }

  await updateShadowResults(shadows, regime);
  saveShadowTrades(shadows);
}