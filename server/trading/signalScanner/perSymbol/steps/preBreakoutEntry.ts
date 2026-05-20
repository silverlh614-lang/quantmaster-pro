/**
 * @responsibility ADR-0019 pre-breakout entry and wait handling extracted from buyListLoop.
 */

import { channelShadowBuyFilled } from '../../../../alerts/channelPipeline.js';
import { fetchKisInvestorTradeByStockDaily } from '../../../../clients/kisClient.js';
import { applySupplyProviderHealthFromKisFlow } from '../../../../clients/kisClient/investorFlowSupplyHealthBridge.js';
import { getDartFinancials } from '../../../../clients/dartFinancialClient.js';
import { requestKisWsSubscription } from '../../../../clients/kisWebSocketSubscriptionManager.js';
import { verifyStockIncremental } from '../../../../data/dataVerificationIncremental.js';
import { buildEntryConditionScores } from '../../../../learning/entryConditionScores.js';
import { addRecommendation } from '../../../../learning/recommendationTracker.js';
import type { TradingSignal } from '../../../../learning/supplyHealthLearning.js';
import { isBlacklisted } from '../../../../persistence/blacklistRepo.js';
import type { ServerShadowTrade } from '../../../../persistence/shadowTradeRepo.js';
import { saveShadowTrades } from '../../../../persistence/shadowTradeRepo.js';
import { recordAiCandidate, buildSignalId } from '../../../../persistence/tradeSignalStatusRepo.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { logger } from '../../../../utils/logger.js';
import { REGIME_CONFIGS } from '../../../../../src/services/quant/regimeEngine.js';
import { getSectorByCode } from '../../../../screener/sectorMap.js';
import { evaluateServerGate } from '../../../../quantFilter.js';
import {
  buildBuyTrade,
  createBuyTask,
  computeMtasMultiplier,
  computeRawPositionPct,
  type BuildBuyTradeParams,
} from '../../../buyPipeline.js';
import { getExecutionCostConfig } from '../../../executionCosts.js';
import {
  buildStopLossPlan,
  calculateOrderQuantity,
  formatStopLossBreakdown,
  isOpenShadowStatus,
} from '../../../entryEngine.js';
import { getRegimeGateBand } from '../../../gateConfig.js';
import { executeShadowBuy, recordShadowExecutionOutcome } from '../../../shadowExecutionPipeline.js';
import { applyExposureBudgetCap, applyPositionSizingEngine } from '../../../sizing/positionSizingEngineWiring.js';
import { resolveCurrentEquityExposure } from '../../../sizing/currentEquityExposure.js';
import { formatExposureBudgetLog } from '../../../sizing/regimeExposurePolicy.js';
import {
  formatShadowBullFloorLog,
  resolveCandidatePositionFloor,
} from '../../../sizing/shadowBullExposureProfile.js';
import { shouldIncrementFailCount } from '../../failureClassifier.js';
import { routePreBreakoutWaitToKisWs } from '../../preBreakoutKisWsPriorityRouting.js';
import { evaluatePreBreakoutWait } from '../../preBreakoutWaitPolicy.js';
import {
  evaluateShadowNearBreakoutEntry,
  type ShadowNearBreakoutBlockReason,
} from '../../shadowNearBreakoutEntryPolicy.js';
import {
  buildExposureBudgetMacroInput,
  computeSizingLiquidityInputs,
  getAdaptiveProfitTargets,
} from '../helpers.js';
import type { BuyListLoopContext } from '../types.js';
import { detectPreBreakoutAccumulationStep } from './preBreakoutAccumulation.js';

interface PreBreakoutSupplyHealthResult {
  blocked: boolean;
  shadowMode: boolean;
  finalQuantity: number;
  finalSignal: TradingSignal;
  healthDecision?: {
    dataConfidence?: number;
    dataQualityBucket?: BuildBuyTradeParams['dataQualityBucket'];
    wasDowngradedBySupplyHealth?: boolean;
    downgradeReasons?: string[];
  };
}

interface PreBreakoutEntryInput {
  ctx: BuyListLoopContext;
  stock: WatchlistEntry;
  currentPrice: number;
  nearEntry: boolean;
  breakout: boolean;
  aboveStop: boolean;
  nearEntryThreshold: number;
  today: string;
  stockShadowMode: boolean;
  diagnosticLiveBlockReason?: string;
  macroDiagnosticLiveBlock: boolean;
  shadowApprovalCtx: {
    tradeDate: string;
    marketSession: 'PRE_OPEN' | 'REGULAR' | 'LUNCH_BREAK' | 'AFTER_HOURS' | 'CLOSED';
  };
  applyBuySupplyHealthPolicy: (params: {
    stockCode: string;
    stockName: string;
    currentPrice: number;
    rawSignal: TradingSignal;
    rawScore: number;
    requestedSize: number;
    shadowMode: boolean;
    ctx: BuyListLoopContext;
  }) => PreBreakoutSupplyHealthResult;
  suppressDiagnosticLiveBuyTask: (ctx: BuyListLoopContext, stock: WatchlistEntry, reason: string) => void;
  logPreEntryWaitDebug: (input: {
    stockName: string;
    stockCode: string;
    entryPrice: number;
    message: string;
    reason: string;
    nowMs?: number;
  }) => void;
}

async function recordPreBreakoutWait(
  input: Pick<PreBreakoutEntryInput, 'ctx' | 'stock' | 'currentPrice' | 'stockShadowMode'> & {
    warningLabel: 'pre-breakout' | 'entry deviation';
  },
): Promise<void> {
  const { ctx, stock, currentPrice, stockShadowMode, warningLabel } = input;
  const decision = evaluatePreBreakoutWait({
    symbol: stock.code,
    name: stock.name,
    currentPrice,
    entryPrice: stock.entryPrice,
    priceDistancePct: Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100),
    volumeRatio: undefined,
    gate1Passed: undefined,
    recheckPassed: undefined,
    waitCount: stock.waitCount,
    recheckFailCount: stock.recheckFailCount,
    lastWaitAt: stock.lastWaitAt,
    shadowObservable: undefined,
    liveEligible: undefined,
    riskBlocked: false,
    quoteStale: false,
  });
  ctx.scanCounters.preBreakoutWaitDecisions.push(decision);
  if (decision.increaseWaitCount) {
    stock.waitCount = (stock.waitCount ?? 0) + 1;
    stock.lastWaitAt = new Date().toISOString();
    ctx.mutables.watchlistMutated.value = true;
  }

  try {
    const routing = routePreBreakoutWaitToKisWs(decision);
    if (routing.shouldRequestSubscription) {
      requestKisWsSubscription(
        {
          code: stock.code,
          name: stock.name,
          priority: routing.priorityHint,
          reasons: [routing.reason],
          entryCandidate: decision.state === 'WAIT_RETRY_ELIGIBLE',
          shadowObservable: decision.shadowLearningAllowed,
        },
        {},
      );
    }
  } catch (e) {
    console.warn(`[ADR-0450] ${warningLabel} KIS-WS routing 실패 ${stock.code}:`, e);
  }

  try {
    const todayKst = new Date().toISOString().split('T')[0];
    const distancePct = Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100);
    const alreadyHasOpenShadow = ctx.shadows.some(
      (s) => s.stockCode === stock.code && isOpenShadowStatus(s.status),
    );
    const alreadyEnteredToday = ctx.shadows.some(
      (s) =>
        s.stockCode === stock.code &&
        s.watchlistSource === 'SHADOW_NEAR_BREAKOUT' &&
        s.signalTime.startsWith(todayKst),
    );
    const dailyCreatedCount = ctx.shadows.filter(
      (s) =>
        s.watchlistSource === 'SHADOW_NEAR_BREAKOUT' &&
        s.signalTime.startsWith(todayKst),
    ).length;
    const shadowDecision = evaluateShadowNearBreakoutEntry({
      symbol: stock.code,
      name: stock.name,
      currentPrice,
      entryPrice: stock.entryPrice,
      stopLoss: stock.stopLoss,
      targetPrice: stock.targetPrice,
      priceDistancePct: distancePct,
      gate1Passed: undefined,
      liveGateScore: stock.gateScore,
      conditionsPassed: undefined,
      recheckPassed: undefined,
      volumeRatio: undefined,
      preBreakoutState: decision.state,
      shadowMode: stockShadowMode,
      riskBlocked: false,
      quoteStale: false,
      alreadyHasOpenShadow,
      alreadyEnteredToday,
      dailyCreatedCount,
    });
    if (shadowDecision.allowed && shadowDecision.createShadowTrade) {
      const stopLossPlanShadow = {
        hardStopLoss: stock.stopLoss,
        initialStopLoss: stock.stopLoss,
        regimeStopLoss: stock.stopLoss,
        stopLossPct: ((currentPrice - stock.stopLoss) / currentPrice) * 100,
        stopLossKrw: currentPrice - stock.stopLoss,
        breakdown: { initial: stock.stopLoss, regime: stock.stopLoss, atr: null, hard: stock.stopLoss },
      };
      const shadowTrade: ServerShadowTrade = buildBuyTrade({
        idPrefix: 'shadow-near-breakout',
        stockCode: stock.code,
        stockName: stock.name,
        currentPrice,
        shadowEntryPrice: currentPrice,
        quantity: 1,
        originalQuantity: 1,
        stopLossPlan: stopLossPlanShadow,
        targetPrice: stock.targetPrice,
        shadowMode: true,
        regime: ctx.regime,
        profileType: 'B',
        watchlistSource: 'SHADOW_NEAR_BREAKOUT',
        profitTranches: [],
        trailPct: 5,
      });
      ctx.shadows.push(shadowTrade);
      saveShadowTrades(ctx.shadows);
      ctx.scanCounters.shadowNearBreakoutCreated = (ctx.scanCounters.shadowNearBreakoutCreated ?? 0) + 1;
      console.log(
        `[ShadowNearBreakout] created ${stock.code} current=${currentPrice} entry=${stock.entryPrice} ` +
        `distance=${distancePct.toFixed(1)}% cause=${shadowDecision.cause} executionImpact=NONE`,
      );
    } else if (!shadowDecision.allowed && shadowDecision.blockReason) {
      ctx.scanCounters.shadowNearBreakoutBlocked = (ctx.scanCounters.shadowNearBreakoutBlocked ?? 0) + 1;
      const reasons = ctx.scanCounters.shadowNearBreakoutBlockReasons ?? {};
      const key: ShadowNearBreakoutBlockReason = shadowDecision.blockReason;
      reasons[key] = (reasons[key] ?? 0) + 1;
      ctx.scanCounters.shadowNearBreakoutBlockReasons = reasons;
    }
  } catch (e) {
    console.warn(`[ADR-0452] ${warningLabel} shadow near-breakout 분류 실패 ${stock.code}:`, e);
  }
}

export async function preBreakoutEntry(input: PreBreakoutEntryInput): Promise<'SKIP' | 'CONTINUE'> {
  const {
    ctx,
    stock,
    currentPrice,
    nearEntry,
    breakout,
    aboveStop,
    nearEntryThreshold,
    today,
    stockShadowMode,
    diagnosticLiveBlockReason,
    macroDiagnosticLiveBlock,
    shadowApprovalCtx,
    applyBuySupplyHealthPolicy,
    suppressDiagnosticLiveBuyTask,
    logPreEntryWaitDebug,
  } = input;

  if (!nearEntry && !breakout && aboveStop) {
    const accumulation = await detectPreBreakoutAccumulationStep(ctx, stock, currentPrice, nearEntryThreshold);
    if (accumulation?.result.isAccumulating) {
      const pbAlreadyToday = ctx.shadows.some(
        s => s.stockCode === stock.code &&
          s.watchlistSource === 'PRE_BREAKOUT' &&
          s.signalTime.startsWith(today),
      );
      if (!pbAlreadyToday && !isBlacklisted(stock.code)) {
        const slippage = getExecutionCostConfig().slippageRate;
        const pbEntryPrice = Math.round(currentPrice * (1 + slippage));
        const gateScorePb = (stock.gateScore ?? 0) + ctx.volumeClock.scoreBonus;
        const [kisFlowPb, dartFinPb] = await Promise.all([
          fetchKisInvestorTradeByStockDaily(stock.code).catch(() => null),
          getDartFinancials(stock.code).catch(() => null),
        ]);
        applySupplyProviderHealthFromKisFlow(
          stock as { supplyProviderHealth?: Record<string, unknown> | undefined },
          kisFlowPb,
        );
        const reCheckGatePb = evaluateServerGate(
          accumulation.quote,
          ctx.conditionWeights,
          ctx.macroState?.kospi20dReturn,
          dartFinPb,
          kisFlowPb,
          ctx.regime,
        );
        const mtasPb = reCheckGatePb ? computeMtasMultiplier(reCheckGatePb.mtas) : 1.0;
        const posPctPb = computeRawPositionPct(gateScorePb) * ctx.kellyMultiplier * mtasPb;
        const exposureFloorPb = resolveCandidatePositionFloor({
          shadowMode: ctx.shadowMode,
          regime: ctx.regime,
          tier: 'STANDARD',
          computedPositionPct: posPctPb,
        });
        const effPosPctPb = exposureFloorPb.effectivePositionPct;
        if (exposureFloorPb.applied) {
          console.log(
            formatShadowBullFloorLog(exposureFloorPb, {
              stockName: stock.name,
              stockCode: stock.code,
              computedPositionPct: posPctPb,
              pathLabel: 'PRE_BREAKOUT_30PCT',
            }),
          );
        }
        const remSlotsPb = Math.max(
          1,
          ctx.effectiveMaxPositions
            - ctx.shadows.filter(s =>
              isOpenShadowStatus(s.status) &&
              s.watchlistSource !== 'INTRADAY' &&
              s.watchlistSource !== 'PRE_BREAKOUT',
            ).length
            - ctx.mutables.reservedSlots.value,
        );
        const { quantity: legacyFullPbQty } = calculateOrderQuantity({
          totalAssets: ctx.totalAssets,
          orderableCash: ctx.mutables.orderableCash.value,
          positionPct: effPosPctPb,
          price: pbEntryPrice,
          remainingSlots: remSlotsPb,
          accountKellyMultiplier: ctx.accountKellyMultiplier,
        });
        const _sizingInputPb = computeSizingLiquidityInputs(
          accumulation.quote ?? null,
          stock.code,
          stock.sector,
          ctx.shadows,
        );
        const sizingApplyPb = applyPositionSizingEngine(ctx.shadowMode, {
          totalAssets: ctx.totalAssets, shadowEntryPrice: pbEntryPrice, stopLoss: stock.stopLoss,
          signalGrade: 'BUY', regimeKelly: ctx.kellyMultiplier, confidenceModifier: 1.0,
          rrr: stock.rrr ?? 0,
          marketCap: 1_000_000_000_000_000,
          avgDailyVolume20d: _sizingInputPb.avgDailyVolume20d,
          currentSectorWeight: _sizingInputPb.currentSectorWeight,
          isNormalRegime: ctx.regime === 'R1_TURBO' || ctx.regime === 'R2_BULL' || ctx.regime === 'R3_EARLY',
          enemyChecklistPassed: true, highDataReliability: true, gate1AllPassed: true,
          notInDowntrend: ctx.regime !== 'R6_DEFENSE' && ctx.regime !== 'R5_CAUTION',
        });
        const fullPbQty = sizingApplyPb.applied ? sizingApplyPb.quantity : legacyFullPbQty;
        const sizingSourcePb = sizingApplyPb.sizingSource;
        const sizingEngineSnapshotPb = sizingApplyPb.applied && sizingApplyPb.result ? {
          tierName: sizingApplyPb.result.tier.name,
          basePct: sizingApplyPb.result.basePct,
          finalPositionPct: sizingApplyPb.result.finalPositionPct,
          finalPositionKrw: sizingApplyPb.result.finalPosition,
          drawdownMultiplier: sizingApplyPb.result.drawdownMultiplier,
          lossStreakMultiplier: sizingApplyPb.result.lossStreakMultiplier,
          liquidityMultiplier: sizingApplyPb.result.liquidityMultiplier,
          sectorExposureMultiplier: sizingApplyPb.result.sectorExposureMultiplier,
          expectedStopLossDamagePct: sizingApplyPb.result.expectedStopLossDamagePct,
          signalPriorityApplied: sizingApplyPb.result.signalPriorityApplied,
          adjustmentReasons: sizingApplyPb.result.adjustmentReasons,
          snapshotAt: new Date().toISOString(),
        } : undefined;
        if (sizingApplyPb.applied) {
          console.log(`[Sizing-NewEngine] ${stock.code} ${stock.name} (PRE_BREAKOUT 30%) → tier=${sizingEngineSnapshotPb!.tierName} qty=${fullPbQty} (legacy=${legacyFullPbQty})`);
        }
        const pbQtyRaw = Math.max(1, Math.floor(fullPbQty * 0.3));
        const exposureCapPb = applyExposureBudgetCap({
          rawQuantity: pbQtyRaw,
          shadowEntryPrice: pbEntryPrice,
          accountEquity: ctx.totalAssets,
          currentEquityExposureAmount: resolveCurrentEquityExposure(
            ctx.totalAssets,
            ctx.mutables.orderableCash.value,
            ctx.shadows,
          ),
          currentCashAmount: ctx.mutables.orderableCash.value,
          regime: ctx.regime,
          isAddOnBuy: false,
          macro: buildExposureBudgetMacroInput(ctx.macroState),
        });
        const pbQty = exposureCapPb.applied ? exposureCapPb.finalQuantity : pbQtyRaw;
        if (exposureCapPb.applied && exposureCapPb.capResult?.cappedByExposureBudget) {
          console.log(formatExposureBudgetLog({
            stockCode: stock.code,
            stockName: stock.name,
            pathLabel: 'PRE_BREAKOUT 30%',
            rawQuantity: pbQtyRaw,
            finalQuantity: pbQty,
            budget: exposureCapPb.budget,
            capResult: exposureCapPb.capResult,
          }));
        }

        const pbHealth = applyBuySupplyHealthPolicy({
          stockCode: stock.code,
          stockName: stock.name,
          currentPrice,
          rawSignal: 'BUY',
          rawScore: gateScorePb,
          requestedSize: pbQty,
          shadowMode: ctx.shadowMode,
          ctx,
        });
        if (pbHealth.blocked) return 'SKIP';
        const pbFinalQty = pbHealth.finalQuantity;

        if (pbFinalQty >= 1) {
          const profilePb = stock.profileType ?? 'B';
          const profileKeyPb = `profile${profilePb}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
          const regimeStopRatePb = REGIME_CONFIGS[ctx.regime].stopLoss[profileKeyPb];
          const pbATR14 = accumulation.quote?.atr ?? 0;
          const stopLossPlanPb = buildStopLossPlan({
            entryPrice: pbEntryPrice,
            fixedStopLoss: stock.stopLoss,
            regimeStopRate: regimeStopRatePb,
            atr14: pbATR14,
            regime: ctx.regime,
          });
          const adaptivePreBreakoutTargets = getAdaptiveProfitTargets(ctx.regime, ctx.macroState);
          const limitTranchesPb = adaptivePreBreakoutTargets.targets.filter(t => t.type === 'LIMIT' && t.trigger !== null);
          const trailTargetPb = adaptivePreBreakoutTargets.targets.find(t => t.type === 'TRAILING');
          const pbTrade: ServerShadowTrade = buildBuyTrade({
            idPrefix: 'srv_pb', stockCode: stock.code, stockName: stock.name,
            currentPrice, shadowEntryPrice: pbEntryPrice, quantity: pbFinalQty, originalQuantity: fullPbQty,
            stopLossPlan: stopLossPlanPb, targetPrice: stock.targetPrice, shadowMode: pbHealth.shadowMode, regime: ctx.regime,
            profileType: profilePb, watchlistSource: 'PRE_BREAKOUT',
            profitTranches: limitTranchesPb.map(t => ({ price: pbEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false })),
            trailPct: Math.max(0.05, Math.min(0.14, (trailTargetPb?.trailPct ?? 0.10) + adaptivePreBreakoutTargets.trailPctAdjust)), entryATR14: pbATR14,
            // ADR-0006 PR-19 baseline (PR-1) — entryConditionScores 영속.
            entryConditionScores: buildEntryConditionScores(['PRE_BREAKOUT']),
            sizingSource: sizingSourcePb, sizingEngineSnapshot: sizingEngineSnapshotPb,
            rawSignal: 'BUY',
            finalSignal: pbHealth.finalSignal,
            dataConfidence: pbHealth.healthDecision?.dataConfidence,
            dataQualityBucket: pbHealth.healthDecision?.dataQualityBucket,
            supplyHealthSnapshot: ctx.supplyHealthSnapshot,
            wasDowngradedBySupplyHealth: pbHealth.healthDecision?.wasDowngradedBySupplyHealth,
            downgradeReasons: pbHealth.healthDecision?.downgradeReasons,
          });

          ctx.shadows.push(pbTrade);

          let _verifyOkPb = true;
          try {
            const _verifyResultPb = await verifyStockIncremental(stock.code, 'BUY_CANDIDATE');
            if (!_verifyResultPb.verified && _verifyResultPb.action?.blockBuy) {
              _verifyOkPb = false;
              console.log(`[AutoTrade] ${stock.name}(${stock.code}) → DATA_HOLD / ${_verifyResultPb.reason} / ${_verifyResultPb.source}`);
            }
          } catch (err) {
            console.warn(`[AutoTrade] verifyStockIncremental error (안전 통과): ${stock.code} — ${(err as Error).message}`);
          }
          if (!_verifyOkPb) return 'SKIP';

          const _signalTimePb = new Date().toISOString();
          addRecommendation({
            stockCode: stock.code, stockName: stock.name, signalTime: _signalTimePb,
            priceAtRecommend: currentPrice, stopLoss: stopLossPlanPb.hardStopLoss,
            targetPrice: stock.targetPrice, kellyPct: Math.round(posPctPb * 100),
            gateScore: gateScorePb, signalType: 'BUY',
            conditionKeys: ['PRE_BREAKOUT'], entryRegime: ctx.regime,
          });
          try {
            recordAiCandidate({
              signalTimeIso: _signalTimePb,
              stockCode: stock.code,
              stockName: stock.name,
              recommendationType: 'BUY',
              signalGateScore: gateScorePb,
              reason: 'PRE_BREAKOUT 매집 감지 30% 선취매',
            });
          } catch (e) {
            console.warn('[TradeSignalStatus] PRE_BREAKOUT recordAiCandidate failed', e);
          }

          console.log(`[PreBreakout] ${stock.name}(${stock.code}) 매집 감지 — 30% 선취매 @${pbEntryPrice} (${pbFinalQty}주/${fullPbQty}주)`);
          console.log(`[PreBreakout] ${accumulation.result.summary}`);

          const pbAlertMsg =
            `🔍 <b>[선취매 진입] ${stock.name} (${stock.code})</b>\n` +
            `매집 감지 — ${accumulation.result.summary}\n` +
            `현재가: ${currentPrice.toLocaleString()}원 × ${pbFinalQty}주 (30% / 총 ${fullPbQty}주)\n` +
            `손절: ${formatStopLossBreakdown(stopLossPlanPb)} | 목표: ${stock.targetPrice.toLocaleString()}원\n` +
            `⚡ 돌파 확인 시 나머지 70%(${fullPbQty - pbFinalQty}주) 추가 집행`;

          if (diagnosticLiveBlockReason && !macroDiagnosticLiveBlock) {
            suppressDiagnosticLiveBuyTask(ctx, stock, diagnosticLiveBlockReason);
            return 'SKIP';
          }

          ctx.mutables.liveBuyQueue.push(await createBuyTask({
            trade: pbTrade, stockCode: stock.code, stockName: stock.name,
            currentPrice, quantity: pbFinalQty, entryPrice: pbEntryPrice,
            stopLoss: stopLossPlanPb.hardStopLoss, targetPrice: stock.targetPrice,
            gateScore: gateScorePb, shadowMode: macroDiagnosticLiveBlock ? true : pbHealth.shadowMode, effectiveBudget: pbFinalQty * pbEntryPrice,
            alertMessage: pbAlertMsg, logEvent: 'PRE_BREAKOUT_ENTRY',
            signalId: buildSignalId(_signalTimePb, stock.code),
            tradeDate: shadowApprovalCtx.tradeDate,
            marketSession: shadowApprovalCtx.marketSession,
            sourceLane: 'SHADOW',
            rrr: stock.rrr,
            mtas: reCheckGatePb?.mtas,
            compressionScore: reCheckGatePb?.compressionScore,
            signalType: 'PRE_BREAKOUT_SHADOW_ALLOWED',
            gateBandNormal: getRegimeGateBand(ctx.regime).normal,
            gateBandStrong: getRegimeGateBand(ctx.regime).strong,
            onApproved: async () => {
              ctx.mutables.orderableCash.value = Math.max(0, ctx.mutables.orderableCash.value - pbFinalQty * pbEntryPrice);
              if (pbHealth.shadowMode) {
                try {
                  const _r = await executeShadowBuy({
                    trade: pbTrade,
                    allTrades: ctx.shadows,
                    fillPrice: pbEntryPrice,
                    notifyFilled: async (n) => {
                      await channelShadowBuyFilled({
                        stockName: n.stockName,
                        stockCode: n.stockCode,
                        fillPrice: n.fillPrice,
                        quantity: n.quantity,
                        fillId: n.fillId,
                        tradeId: n.tradeId,
                      });
                    },
                  });
                  recordShadowExecutionOutcome(_r.outcome);
                } catch (e) {
                  console.warn('[ShadowExecutionPipeline] PRE_BREAKOUT_ENTRY 영속 실패 (매매 흐름 보호):', e);
                }
              }
            },
          }));
          ctx.mutables.reservedSlots.value++;
          ctx.mutables.reservedTiers.push('OTHER');
          const _sec = stock.sector || getSectorByCode(stock.code) || '미분류';
          const _val = pbFinalQty * pbEntryPrice;
          ctx.mutables.pendingSectorValue.set(_sec, (ctx.mutables.pendingSectorValue.get(_sec) ?? 0) + _val);
          ctx.mutables.reservedSectorValues.push({ sector: _sec, value: _val });
        }
      }
    }

    if (shouldIncrementFailCount('PRE_BREAKOUT_MISS')) {
      stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
      ctx.mutables.watchlistMutated.value = true;
      logger.debug(`[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달(pre-breakout) — failCount=${stock.entryFailCount}`);
    } else {
      logPreEntryWaitDebug({
        stockName: stock.name,
        stockCode: stock.code,
        entryPrice: stock.entryPrice,
        reason: 'PRE_BREAKOUT_MISS',
        message: `[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달(pre-breakout) — WAIT (ADR-0115 — failCount 미증가)`,
      });
    }
    ctx.scanCounters.waitPreBreakout++;
    try {
      await recordPreBreakoutWait({ ctx, stock, currentPrice, stockShadowMode, warningLabel: 'pre-breakout' });
    } catch (e) {
      console.warn(`[ADR-0449] pre-breakout WAIT 분류 실패 ${stock.code}:`, e);
    }
    return 'SKIP';
  }

  if (!(nearEntry || breakout)) {
    if (shouldIncrementFailCount('ENTRY_PRICE_DEVIATION')) {
      stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
      ctx.mutables.watchlistMutated.value = true;
      logger.info(`[AutoTrade] ${stock.name}(${stock.code}) 진입가 이탈 — failCount=${stock.entryFailCount}`);
    } else {
      logPreEntryWaitDebug({
        stockName: stock.name,
        stockCode: stock.code,
        entryPrice: stock.entryPrice,
        reason: 'ENTRY_PRICE_DEVIATION',
        message: `[AutoTrade] ${stock.name}(${stock.code}) 진입가 이탈 — WAIT (ADR-0115 — failCount 미증가)`,
      });
    }
    ctx.scanCounters.waitPreBreakout++;
    try {
      await recordPreBreakoutWait({ ctx, stock, currentPrice, stockShadowMode, warningLabel: 'entry deviation' });
    } catch (e) {
      console.warn(`[ADR-0449] entry deviation WAIT 분류 실패 ${stock.code}:`, e);
    }
    return 'SKIP';
  }

  return 'CONTINUE';
}
