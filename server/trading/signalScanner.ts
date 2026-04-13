/**
 * signalScanner.ts — 장중 자동 신호 스캔 오케스트레이터
 *
 * 세부 로직은 다음 서브모듈로 분리됨:
 *   entryEngine.ts — 진입 검증 유틸리티 (EXIT_RULE_PRIORITY_TABLE, buildStopLossPlan, calculateOrderQuantity, evaluateEntryRevalidation, isOpenShadowStatus)
 *   exitEngine.ts  — 포지션 모니터링 및 청산 엔진 (updateShadowResults)
 */

import {
  fetchCurrentPrice, fetchAccountBalance, placeKisMarketBuyOrder,
} from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';
import { loadIntradayWatchlist } from '../persistence/intradayWatchlistRepo.js';
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
  MAX_INTRADAY_POSITIONS,
  INTRADAY_POSITION_PCT_FACTOR,
  INTRADAY_STOP_LOSS_PCT,
  INTRADAY_TARGET_PCT,
} from '../screener/intradayScanner.js';
import {
  isOpenShadowStatus,
  buildStopLossPlan,
  formatStopLossBreakdown,
  calculateOrderQuantity,
  evaluateEntryRevalidation,
} from './entryEngine.js';
import { updateShadowResults } from './exitEngine.js';
import { checkCooldownRelease } from './regretAsymmetryFilter.js';
import { checkVolumeClockWindow } from './volumeClock.js';
import { detectPreBreakoutAccumulation } from './preBreakoutAccumulationDetector.js';

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

  // 2단계 워치리스트: Focus 항목(isFocus=true) + MANUAL 항목만 매수 스캔
  const buyList = watchlist.filter((w) => w.isFocus === true || w.addedBy === 'MANUAL');
  let watchlistMutated = false;

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
    `[AutoTrade] 스캔 시작 — 워치리스트 ${watchlist.length}개 / Focus+MANUAL ${buyList.length}개 / Intraday Ready ${intradayBuyList.length}개 / 모드: ${shadowMode ? 'SHADOW' : 'LIVE'} / 총자산: ${totalAssets.toLocaleString()}원 / 주문가능현금: ${orderableCash.toLocaleString()}원`
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
  // INTRADAY 포지션은 별도 한도(MAX_INTRADAY_POSITIONS)로 관리하므로 제외한다.
  // 두 카운트를 혼합하면 인트라데이 포지션이 스윙 매수를 의도치 않게 차단하는 모순이 생긴다.
  const activeSwingCount = shadows.filter(
    (s) => isOpenShadowStatus(s.status) && s.watchlistSource !== 'INTRADAY',
  ).length;
  if (activeSwingCount >= regimeConfig.maxPositions) {
    console.log(
      `[AutoTrade] 최대 동시 포지션 도달 (${activeSwingCount}/${regimeConfig.maxPositions}, 레짐 ${regime}) — 신규 진입 스킵`
    );
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return;
  }

  // ── Volume Clock — 발주 허용 시간대 확인 ──────────────────────────────────
  const volumeClock = checkVolumeClockWindow();
  if (!volumeClock.allowEntry) {
    console.log(volumeClock.reason);
    // 시간대 차단 시에도 포지션 모니터링(청산)은 계속 수행
    await updateShadowResults(shadows, regime);
    saveShadowTrades(shadows);
    return;
  }
  if (volumeClock.scoreBonus > 0) {
    console.log(volumeClock.reason);
  }

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
      const currentPrice = await fetchCurrentPrice(stock.code).catch(() => null);
      if (!currentPrice) continue;

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
            const gateScoreFollow = (stock.gateScore ?? 0) + volumeClock.scoreBonus;
            const isStrongBuyFollow = gateScoreFollow >= 25;
            const rawPctFollow = isStrongBuyFollow ? 0.12
                               : gateScoreFollow >= 20 ? 0.08
                               : gateScoreFollow >= 15 ? 0.05
                               : 0.03;
            const posPctFollow = rawPctFollow * kellyMultiplier;
            const remSlots = Math.max(1, regimeConfig.maxPositions - shadows.filter(s => isOpenShadowStatus(s.status) && s.watchlistSource !== 'INTRADAY').length);
            const { quantity: fullQty } = calculateOrderQuantity({
              totalAssets, orderableCash, positionPct: posPctFollow,
              price: followEntryPrice, remainingSlots: remSlots,
            });
            const followQty = Math.max(1, Math.ceil(fullQty * 0.7));
            const profile    = stock.profileType ?? 'B';
            const profileKey = `profile${profile}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
            const regimeStopRate = REGIME_CONFIGS[regime].stopLoss[profileKey];
            const stopLossPlan = buildStopLossPlan({
              entryPrice:    followEntryPrice,
              fixedStopLoss: stock.stopLoss,
              regimeStopRate,
            });
            const limitTranches = PROFIT_TARGETS[regime].filter(t => t.type === 'LIMIT' && t.trigger !== null);
            const trailTarget   = PROFIT_TARGETS[regime].find(t => t.type === 'TRAILING');
            const followTrade: ServerShadowTrade = {
              id:                    `srv_pbf_${Date.now()}_${stock.code}`,
              stockCode:             stock.code,
              stockName:             stock.name,
              signalTime:            new Date().toISOString(),
              signalPrice:           currentPrice,
              shadowEntryPrice:      followEntryPrice,
              quantity:              followQty,
              originalQuantity:      followQty,
              stopLoss:              stopLossPlan.hardStopLoss,
              initialStopLoss:       stopLossPlan.initialStopLoss,
              regimeStopLoss:        stopLossPlan.regimeStopLoss,
              hardStopLoss:          stopLossPlan.hardStopLoss,
              targetPrice:           stock.targetPrice,
              status:                'PENDING',
              mode:                  shadowMode ? 'SHADOW' : 'LIVE',
              entryRegime:           regime,
              profileType:           profile,
              watchlistSource:       'PRE_BREAKOUT_FOLLOWTHROUGH',
              profitTranches:        limitTranches.map(t => ({
                price: followEntryPrice * (1 + (t.trigger as number)),
                ratio: t.ratio,
                taken: false,
              })),
              trailingHighWaterMark: followEntryPrice,
              trailPct:              trailTarget?.trailPct ?? 0.10,
              trailingEnabled:       false,
            };

            shadows.push(followTrade);
            appendShadowLog({ event: 'PRE_BREAKOUT_FOLLOWTHROUGH', ...followTrade });
            orderableCash = Math.max(0, orderableCash - followQty * followEntryPrice);

            const alertMsg =
              `🚀 <b>[선취매 추종] ${stock.name} (${stock.code})</b>\n` +
              `돌파 확인 @${currentPrice.toLocaleString()}원 — 나머지 70% 집행\n` +
              `주문가: ${followEntryPrice.toLocaleString()}원 × ${followQty}주\n` +
              `손절: ${formatStopLossBreakdown(stopLossPlan)} | 목표: ${stock.targetPrice.toLocaleString()}원`;

            if (shadowMode) {
              console.log(`[PreBreakout SHADOW] ${stock.name}(${stock.code}) 추종 매수 @${currentPrice}`);
              await sendTelegramAlert(alertMsg).catch(console.error);
            } else {
              const ordNo = await placeKisMarketBuyOrder(stock.code, followQty);
              console.log(`[PreBreakout LIVE] ${stock.name} 추종 매수 — ODNO: ${ordNo}`);
              if (ordNo) {
                fillMonitor.addOrder({
                  ordNo, stockCode: stock.code, stockName: stock.name,
                  quantity: followQty, orderPrice: followEntryPrice,
                  placedAt: new Date().toISOString(), relatedTradeId: followTrade.id,
                });
                followTrade.status = 'ORDER_SUBMITTED';
              } else {
                followTrade.status = 'REJECTED';
              }
              await sendTelegramAlert(alertMsg).catch(console.error);
            }
          } else {
            console.log(`[PreBreakout] ${stock.name}(${stock.code}) 추종 매수 이미 실행됨 — 스킵`);
          }
        } else {
          console.log(`[PreBreakout] ${stock.name}(${stock.code}) 선취매 보유 중 @${activePreBreakout.shadowEntryPrice.toLocaleString()} — 돌파 대기`);
        }
        continue; // 선취매 포지션이 있으면 일반 진입 로직 건너뜀
      }

      // 진입 조건: 현재가가 entryPrice ± 1% 이내로 도달
      const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= 0.01;
      // 손절 상향: 아직 손절선 위에 있어야 함
      const aboveStop = currentPrice > stock.stopLoss;
      // 상승 모멘텀: 현재가가 entry 이상
      const breakout = currentPrice >= stock.entryPrice;

      // ── Pre-Breakout 매집 감지 (진입가 미도달 + 손절선 위) ─────────────────
      if (!nearEntry && !breakout && aboveStop) {
        const reCheckQuotePb = await fetchYahooQuote(`${stock.code}.KS`).catch(() => null)
                            ?? await fetchYahooQuote(`${stock.code}.KQ`).catch(() => null);
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
              const isStrongPb  = gateScorePb >= 25;
              const rawPctPb    = isStrongPb ? 0.12 : gateScorePb >= 20 ? 0.08 : gateScorePb >= 15 ? 0.05 : 0.03;
              const posPctPb    = rawPctPb * kellyMultiplier;
              const remSlotsPb  = Math.max(1, regimeConfig.maxPositions - shadows.filter(s => isOpenShadowStatus(s.status) && s.watchlistSource !== 'INTRADAY').length);
              const { quantity: fullPbQty, effectiveBudget: pbBudget } = calculateOrderQuantity({
                totalAssets, orderableCash, positionPct: posPctPb,
                price: pbEntryPrice, remainingSlots: remSlotsPb,
              });
              const pbQty = Math.max(1, Math.floor(fullPbQty * 0.3)); // 30% 선취매

              if (pbQty >= 1) {
                const profilePb = stock.profileType ?? 'B';
                const profileKeyPb = `profile${profilePb}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
                const regimeStopRatePb = REGIME_CONFIGS[regime].stopLoss[profileKeyPb];
                const stopLossPlanPb = buildStopLossPlan({
                  entryPrice:    pbEntryPrice,
                  fixedStopLoss: stock.stopLoss,
                  regimeStopRate: regimeStopRatePb,
                });
                const limitTranchesPb = PROFIT_TARGETS[regime].filter(t => t.type === 'LIMIT' && t.trigger !== null);
                const trailTargetPb   = PROFIT_TARGETS[regime].find(t => t.type === 'TRAILING');
                const pbTrade: ServerShadowTrade = {
                  id:                    `srv_pb_${Date.now()}_${stock.code}`,
                  stockCode:             stock.code,
                  stockName:             stock.name,
                  signalTime:            new Date().toISOString(),
                  signalPrice:           currentPrice,
                  shadowEntryPrice:      pbEntryPrice,
                  quantity:              pbQty,
                  originalQuantity:      fullPbQty,
                  stopLoss:              stopLossPlanPb.hardStopLoss,
                  initialStopLoss:       stopLossPlanPb.initialStopLoss,
                  regimeStopLoss:        stopLossPlanPb.regimeStopLoss,
                  hardStopLoss:          stopLossPlanPb.hardStopLoss,
                  targetPrice:           stock.targetPrice,
                  status:                'PENDING',
                  mode:                  shadowMode ? 'SHADOW' : 'LIVE',
                  entryRegime:           regime,
                  profileType:           profilePb,
                  watchlistSource:       'PRE_BREAKOUT',
                  profitTranches:        limitTranchesPb.map(t => ({
                    price: pbEntryPrice * (1 + (t.trigger as number)),
                    ratio: t.ratio,
                    taken: false,
                  })),
                  trailingHighWaterMark: pbEntryPrice,
                  trailPct:              trailTargetPb?.trailPct ?? 0.10,
                  trailingEnabled:       false,
                };

                shadows.push(pbTrade);
                appendShadowLog({ event: 'PRE_BREAKOUT_ENTRY', ...pbTrade });
                // C2 수정: 실제 집행금액(pbQty × pbEntryPrice)으로 차감
                // (이전 pbBudget * 0.3 은 Math.floor 오차로 실투자금과 달랐음)
                orderableCash = Math.max(0, orderableCash - pbQty * pbEntryPrice);

                console.log(`[PreBreakout] ${stock.name}(${stock.code}) 매집 감지 — 30% 선취매 @${pbEntryPrice} (${pbQty}주/${fullPbQty}주)`);
                console.log(`[PreBreakout] ${accumResult.summary}`);

                await sendTelegramAlert(
                  `🔍 <b>[선취매 진입] ${stock.name} (${stock.code})</b>\n` +
                  `매집 감지 — ${accumResult.summary}\n` +
                  `현재가: ${currentPrice.toLocaleString()}원 × ${pbQty}주 (30% / 총 ${fullPbQty}주)\n` +
                  `손절: ${formatStopLossBreakdown(stopLossPlanPb)} | 목표: ${stock.targetPrice.toLocaleString()}원\n` +
                  `⚡ 돌파 확인 시 나머지 70%(${fullPbQty - pbQty}주) 추가 집행`
                ).catch(console.error);

                if (!shadowMode) {
                  const ordNo = await placeKisMarketBuyOrder(stock.code, pbQty);
                  if (ordNo) {
                    fillMonitor.addOrder({
                      ordNo, stockCode: stock.code, stockName: stock.name,
                      quantity: pbQty, orderPrice: pbEntryPrice,
                      placedAt: new Date().toISOString(), relatedTradeId: pbTrade.id,
                    });
                    pbTrade.status = 'ORDER_SUBMITTED';
                  } else {
                    pbTrade.status = 'REJECTED';
                  }
                }
              }
            }
          }
        }
        continue; // 진입가 미도달 — 일반 진입 로직 건너뜀
      }

      // C4 수정: 명시적 진입 조건 체크 (INTRADAY 경로와 동일한 방어 패턴)
      // (!nearEntry && !breakout) 케이스는 위 pre-breakout 블록이 처리하지만,
      // 방어적 가드를 명시하여 미래 코드 변경 시 조건 없는 진입을 차단한다.
      if (!(nearEntry || breakout)) continue;

      if (!aboveStop) continue;
      const alreadyTraded = shadows.some(
        (s) => s.stockCode === stock.code &&
        (isOpenShadowStatus(s.status) ||
         s.signalTime.startsWith(today))
      );
      if (alreadyTraded) continue;

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
      // Volume Clock 보너스: 10:00~11:00 KST 집행 시 +2점 (기관 알고리즘 집중 구간)
      const gateScore = (stock.gateScore ?? 0) + volumeClock.scoreBonus;
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
        // 가격 조건은 맞았으나 재검증 탈락 → 진입 실패 횟수 누적
        if (stock.addedBy === 'AUTO') {
          stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
          watchlistMutated = true;
        }
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
        mode: shadowMode ? 'SHADOW' : 'LIVE',
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
        const ordNo = await placeKisMarketBuyOrder(stock.code, execQty);
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

  // ── 장중 Watchlist 처리 — intradayReady 항목에 대해 진입 시도 ───────────────
  // 즉시 매수 금지: intradayReady=true (30분 경과 + 재검증 통과)인 항목만 대상
  // 위험 관리: maxIntradayPositions(2개) / 포지션 비중 50% 축소 / 빠른 손절(-5%)
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
          const currentPrice = await fetchCurrentPrice(stock.code).catch(() => null);
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

          // 장중 손절: -5% 고정 (레짐 손절보다 빠른 손절)
          const intradayStop   = Math.round(shadowEntryPrice * (1 - INTRADAY_STOP_LOSS_PCT));
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

          const trade: ServerShadowTrade = {
            id:                  `srv_intraday_${Date.now()}_${stock.code}`,
            stockCode:           stock.code,
            stockName:           stock.name,
            signalTime:          new Date().toISOString(),
            signalPrice:         currentPrice,
            shadowEntryPrice,
            quantity,
            originalQuantity:    quantity,
            stopLoss:            intradayStop,
            initialStopLoss:     intradayStop,
            // C3 수정: regimeStopLoss 필드 누락 → exitEngine의 일관된 손절 계산을 위해 명시 설정
            regimeStopLoss:      intradayStop,
            hardStopLoss:        intradayStop,
            targetPrice:         intradayTarget,
            status:              'PENDING',
            mode:                shadowMode ? 'SHADOW' : 'LIVE',
            entryRegime:         regime,
            profileType:         'C', // 장중 발굴 종목 — 소형모멘텀 프로파일
            watchlistSource:     'INTRADAY',
            trailingHighWaterMark: shadowEntryPrice,
            trailPct:             0.05, // 장중: 5% 트레일링 (더 빠른 익절 보호)
            trailingEnabled:      false,
          };

          addRecommendation({
            stockCode:        stock.code,
            stockName:        stock.name,
            signalTime:       new Date().toISOString(),
            priceAtRecommend: currentPrice,
            stopLoss:         intradayStop,
            targetPrice:      intradayTarget,
            kellyPct:         Math.round(positionPct * 100),
            gateScore:        0,
            signalType:       'BUY',
            conditionKeys:    ['INTRADAY_STRONG'],
            entryRegime:      regime,
          });

          if (shadowMode) {
            shadows.push(trade);
            console.log(`[AutoTrade/Intraday SHADOW] ${stock.name}(${stock.code}) 장중 진입 @${currentPrice}`);
            appendShadowLog({ event: 'INTRADAY_SIGNAL', ...trade });

            await sendTelegramAlert(
              `📈 <b>[Shadow] 장중 매수 신호</b>\n` +
              `종목: ${stock.name} (${stock.code})\n` +
              `현재가: ${currentPrice.toLocaleString()}원 × ${quantity}주\n` +
              `손절: ${intradayStop.toLocaleString()} (-5%) | 목표: ${intradayTarget.toLocaleString()}\n` +
              `⚡ Intraday 포지션 ${currentIntradayActive + 1}/${MAX_INTRADAY_POSITIONS}`,
            ).catch(console.error);
          } else {
            // LIVE 모드: 실제 시장가 주문
            const ordNo = await placeKisMarketBuyOrder(stock.code, quantity);
            console.log(`[AutoTrade/Intraday LIVE] ${stock.name} 매수 주문 — ODNO: ${ordNo}`);
            appendShadowLog({ event: 'INTRADAY_ORDER', code: stock.code, price: currentPrice, ordNo });

            if (ordNo) {
              fillMonitor.addOrder({
                ordNo,
                stockCode:      stock.code,
                stockName:      stock.name,
                quantity,
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
              `🚀 <b>[LIVE] 장중 매수 주문</b>\n` +
              `종목: ${stock.name} (${stock.code})\n` +
              `주문상태: ${ordNo ? 'ORDER_SUBMITTED' : 'REJECTED'}\n` +
              `주문가: ${currentPrice.toLocaleString()}원 × ${quantity}주\n` +
              `주문번호: ${ordNo ?? 'N/A'}\n` +
              `손절: ${intradayStop.toLocaleString()} (-5%) | 목표: ${intradayTarget.toLocaleString()}\n` +
              `⚡ Intraday 포지션 ${currentIntradayActive + 1}/${MAX_INTRADAY_POSITIONS}`,
            ).catch(console.error);
          }

          if (trade.status !== 'REJECTED') {
            orderableCash = Math.max(0, orderableCash - effectiveBudget);
          }
        } catch (err: unknown) {
          console.error(`[AutoTrade/Intraday] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  // entryFailCount 변경분 영속화
  if (watchlistMutated) {
    saveWatchlist(watchlist);
  }

  await updateShadowResults(shadows, regime);
  saveShadowTrades(shadows);
}