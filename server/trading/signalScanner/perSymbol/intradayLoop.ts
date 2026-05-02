/**
 * @responsibility 장중 watchlist 루프 — intradayReady 종목 진입 시도 + 슬롯·손절·트레일링 분기
 *
 * ADR-0134 (PR-Refactor-2) — perSymbolEvaluation.ts 분해 시 evaluateIntradayList 격리.
 * signalScanner.ts L622~L802 (~181줄) 와 100% 동작 일치 (byte-equivalent 이주).
 */

import { isBlacklisted } from '../../../persistence/blacklistRepo.js';
import { addRecommendation } from '../../../learning/recommendationTracker.js';
import { recordAiCandidate, buildSignalId } from '../../../persistence/tradeSignalStatusRepo.js';
import { buildEntryConditionScores } from '../../../learning/entryConditionScores.js';
import { getExecutionCostConfig } from '../../executionCosts.js';
import { fetchGateData, buildBuyTrade, createBuyTask, type LiveBuyTask } from '../../buyPipeline.js';
import { verifyStockIncremental } from '../../../data/dataVerificationIncremental.js';
import {
  isOpenShadowStatus,
  calculateOrderQuantity,
} from '../../entryEngine.js';
import {
  MAX_INTRADAY_POSITIONS,
  INTRADAY_POSITION_PCT_FACTOR,
  INTRADAY_STOP_LOSS_PCT,
  INTRADAY_PULLBACK_STOP_LOSS_PCT,
  INTRADAY_TARGET_PCT,
} from '../../../screener/intradayScanner.js';
import { type ApprovalAction } from '../../../telegram/buyApproval.js';
import { setLastBuySignalAt } from '../scanDiagnostics.js';
import { getPrice } from './helpers.js';
import type { IntradayLoopContext } from './types.js';
// ADR-0163 Phase 2-D Extension — INTRADAY_STRONG 경로 SHADOW only 사이징 엔진 wiring.
// ADR-0166 — Exposure Budget cap 추가 (default OFF).
// ADR-0167 — currentEquityExposureAmount 정확 산출 (default OFF, ENV `POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED=true`).
import { applyPositionSizingEngine, applyExposureBudgetCap } from '../../sizing/positionSizingEngineWiring.js';
import { resolveCurrentEquityExposure } from '../../sizing/currentEquityExposure.js';

/**
 * 장중(Intraday) Watchlist 처리 — Step 4c 이식 본체.
 * 원본 signalScanner.ts L622~L802 (~181줄) 와 100% 동작 일치.
 */
export async function evaluateIntradayList(ctx: IntradayLoopContext): Promise<void> {
  // ── 장중 Watchlist 처리 — intradayReady 항목에 대해 진입 시도 ───────────────
  // 즉시 매수 금지: intradayReady=true (15분 경과 + 재검증 통과)인 항목만 대상
  // 위험 관리: maxIntradayPositions(3개) / 포지션 비중 50% 축소 / 경로별 손절(돌파-5%/눌림목-4%)
  if (!ctx.options?.sellOnly && ctx.intradayBuyList.length > 0) {
    const activeIntradayCount = ctx.shadows.filter(
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

      for (const stock of ctx.intradayBuyList) {
        // 포지션 수 재확인
        const currentIntradayActive = ctx.shadows.filter(
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
          const alreadyTraded = ctx.shadows.some(
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
          const positionPct     = rawPositionPct * ctx.kellyMultiplier * INTRADAY_POSITION_PCT_FACTOR;
          const remainingSlots  = Math.max(1, MAX_INTRADAY_POSITIONS - currentIntradayActive);
          const { quantity: legacyIntradayQty, effectiveBudget } = calculateOrderQuantity({
            totalAssets: ctx.totalAssets,
            orderableCash: ctx.mutables.orderableCash.value,
            positionPct,
            price: shadowEntryPrice,
            remainingSlots,
            accountKellyMultiplier: ctx.accountKellyMultiplier,
          });

          if (legacyIntradayQty < 1) continue;

          // ── ADR-0163 (Phase 2-D Extension): INTRADAY_STRONG 경로 wiring ──
          // BUY 매핑 (장중 강세 = 보수적 진입) + 100% (분할 없음).
          // INTRADAY 는 universe 기준 미부합 가능성 → 큰 수 전달로 차단 회피.
          const sizingApplyIntra = applyPositionSizingEngine(ctx.shadowMode, {
            totalAssets: ctx.totalAssets, shadowEntryPrice, stopLoss: intradayStop,
            signalGrade: 'BUY', regimeKelly: ctx.kellyMultiplier, confidenceModifier: 1.0,
            rrr: 0,  // INTRADAY 는 RRR 평가 부재 — 본 모듈 rrrMultiplier=0 → engine 차단 → legacy fallback
            marketCap: 1_000_000_000_000_000, avgDailyVolume20d: 1_000_000_000_000_000,
            currentSectorWeight: 0,
            isNormalRegime: ctx.regime === 'R1_TURBO' || ctx.regime === 'R2_BULL' || ctx.regime === 'R3_EARLY',
            enemyChecklistPassed: true, highDataReliability: true, gate1AllPassed: true,
            notInDowntrend: ctx.regime !== 'R6_DEFENSE' && ctx.regime !== 'R5_CAUTION',
          });
          const baseIntradayQty = sizingApplyIntra.applied ? sizingApplyIntra.quantity : legacyIntradayQty;
          // ── ADR-0166: INTRADAY_STRONG 노출 예산 cap (default OFF) ──
          const exposureCapIntra = applyExposureBudgetCap({
            rawQuantity: baseIntradayQty,
            shadowEntryPrice,
            accountEquity: ctx.totalAssets,
            currentEquityExposureAmount: resolveCurrentEquityExposure(ctx.totalAssets, ctx.mutables.orderableCash.value, ctx.shadows),
            currentCashAmount: ctx.mutables.orderableCash.value,
            regime: ctx.regime,
            isAddOnBuy: false,  // INTRADAY = 신규 진입 (장중 강세)
          });
          const quantity = exposureCapIntra.applied ? exposureCapIntra.finalQuantity : baseIntradayQty;
          if (exposureCapIntra.applied && exposureCapIntra.capResult?.cappedByExposureBudget) {
            console.log(`[Sizing-ExposureBudget] ${stock.code} ${stock.name} (INTRADAY_STRONG) → qty=${quantity} (raw=${baseIntradayQty}) ${exposureCapIntra.capResult.blockReason ?? ''}`);
          }
          if (quantity < 1) continue;  // exposure cap 0 차단 시 진입 스킵
          const sizingSourceIntra = sizingApplyIntra.sizingSource;
          const sizingEngineSnapshotIntra = sizingApplyIntra.applied && sizingApplyIntra.result ? {
            tierName: sizingApplyIntra.result.tier.name, basePct: sizingApplyIntra.result.basePct,
            finalPositionPct: sizingApplyIntra.result.finalPositionPct, finalPositionKrw: sizingApplyIntra.result.finalPosition,
            drawdownMultiplier: sizingApplyIntra.result.drawdownMultiplier, lossStreakMultiplier: sizingApplyIntra.result.lossStreakMultiplier,
            liquidityMultiplier: sizingApplyIntra.result.liquidityMultiplier, sectorExposureMultiplier: sizingApplyIntra.result.sectorExposureMultiplier,
            expectedStopLossDamagePct: sizingApplyIntra.result.expectedStopLossDamagePct,
            signalPriorityApplied: sizingApplyIntra.result.signalPriorityApplied,
            adjustmentReasons: sizingApplyIntra.result.adjustmentReasons, snapshotAt: new Date().toISOString(),
          } : undefined;
          if (sizingApplyIntra.applied) {
            console.log(`[Sizing-NewEngine] ${stock.code} ${stock.name} (INTRADAY_STRONG) → tier=${sizingEngineSnapshotIntra!.tierName} qty=${quantity} (legacy=${legacyIntradayQty})`);
          }

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
            targetPrice: intradayTarget, shadowMode: ctx.shadowMode, regime: ctx.regime,
            profileType: 'C', watchlistSource: 'INTRADAY',
            profitTranches: [], // Intraday는 분할익절 없음
            trailPct: 0.05,    // 장중: 5% 트레일링
            // ADR-0006 PR-19 baseline (PR-1) — entryConditionScores 영속.
            entryConditionScores: buildEntryConditionScores(['INTRADAY_STRONG']),
            // ADR-0163 Phase 2-D Extension — sizingSource marker + 스냅샷 영속.
            sizingSource: sizingSourceIntra, sizingEngineSnapshot: sizingEngineSnapshotIntra,
          });

          // BUG-10 fix: 실시간 Gate 평가로 Intraday 종목의 gateScore 추정
          const { gate: intradayGate } = await fetchGateData(stock.code, ctx.conditionWeights, ctx.macroState?.kospi20dReturn);
          const intradayGateScore = intradayGate?.gateScore ?? 0;

          // ADR-0128 §Wiring 1A: 장중 강세 후보 incremental 검증 (BUY_CANDIDATE role).
          let _verifyOkIntra = true;
          try {
            const _verifyResultIntra = await verifyStockIncremental(stock.code, 'BUY_CANDIDATE');
            if (!_verifyResultIntra.verified && _verifyResultIntra.action?.blockBuy) {
              _verifyOkIntra = false;
              console.log(`[AutoTrade] ${stock.name}(${stock.code}) → DATA_HOLD / ${_verifyResultIntra.reason} / ${_verifyResultIntra.source}`);
            }
          } catch (err) {
            console.warn(`[AutoTrade] verifyStockIncremental error (안전 통과): ${stock.code} — ${(err as Error).message}`);
          }
          if (!_verifyOkIntra) continue;

          const _signalTimeIntra = new Date().toISOString();
          addRecommendation({
            stockCode: stock.code, stockName: stock.name, signalTime: _signalTimeIntra,
            priceAtRecommend: currentPrice, stopLoss: intradayStop,
            targetPrice: intradayTarget, kellyPct: Math.round(positionPct * 100),
            gateScore: intradayGateScore, signalType: 'BUY',
            conditionKeys: ['INTRADAY_STRONG'], entryRegime: ctx.regime,
          });
          // ADR-0077 wiring — AI_CANDIDATE 영속 (장중 강세 후보)
          try {
            recordAiCandidate({
              signalTimeIso: _signalTimeIntra,
              stockCode: stock.code,
              stockName: stock.name,
              recommendationType: 'BUY',
              signalGateScore: intradayGateScore,
              reason: `장중 강세 추격 후보 (Gate ${intradayGateScore})`,
            });
          } catch (e) {
            console.warn('[TradeSignalStatus] INTRADAY_STRONG recordAiCandidate failed', e);
          }

          const stopLabel = stopPct === INTRADAY_PULLBACK_STOP_LOSS_PCT ? '-4%' : '-5%';
          const intradaySlotLabel = `${currentIntradayActive + 1}/${MAX_INTRADAY_POSITIONS}`;

          // SHADOW/LIVE 통합 승인 큐 등록
          ctx.scanCounters.entries++;
          setLastBuySignalAt(Date.now());

          const intradayModeEmoji = ctx.shadowMode ? '📈' : '🚀';
          const intradayModeLabel = ctx.shadowMode ? 'Shadow' : 'LIVE';
          const intradayAlertMsg =
            `${intradayModeEmoji} <b>[${intradayModeLabel}] 장중 매수 ${ctx.shadowMode ? '신호' : '주문'}</b>\n` +
            `종목: ${stock.name} (${stock.code})\n` +
            `현재가: ${currentPrice.toLocaleString()}원 × ${quantity}주\n` +
            `손절: ${intradayStop.toLocaleString()} (${stopLabel}) | 목표: ${intradayTarget.toLocaleString()}\n` +
            `⚡ Intraday 포지션 ${intradaySlotLabel}`;

          intradayLiveBuyQueue.push(await createBuyTask({
            trade, stockCode: stock.code, stockName: stock.name,
            currentPrice, quantity, entryPrice: shadowEntryPrice,
            stopLoss: intradayStop, targetPrice: intradayTarget,
            gateScore: intradayGateScore, shadowMode: ctx.shadowMode, effectiveBudget,
            alertMessage: intradayAlertMsg, logEvent: ctx.shadowMode ? 'INTRADAY_SIGNAL' : 'INTRADAY_ORDER',
            signalId: buildSignalId(_signalTimeIntra, stock.code), // ADR-0077
            onApproved: async (t) => {
              // 포지션 수 재확인 (큐 플러시 시점에 재검증)
              const latestIntradayCount = ctx.shadows.filter(
                (s) => isOpenShadowStatus(s.status) && s.watchlistSource === 'INTRADAY',
              ).length;
              if (latestIntradayCount >= MAX_INTRADAY_POSITIONS) {
                console.log(`[AutoTrade/Intraday] 최대 포지션 도달 — ${stock.name} 건너뜀`);
                t.status = 'REJECTED';
                return;
              }
              ctx.shadows.push(t);
              ctx.mutables.orderableCash.value = Math.max(0, ctx.mutables.orderableCash.value - effectiveBudget);
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
}
