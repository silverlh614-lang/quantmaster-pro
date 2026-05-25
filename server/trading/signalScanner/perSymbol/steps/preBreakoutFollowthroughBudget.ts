/**
 * @responsibility ADR-0019 pre-breakout followthrough budget sizing extracted from buyListLoop.
 */

import type { ServerShadowTrade } from '../../../../persistence/shadowTradeRepo.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { applySupplyProviderHealthFromKisFlow } from '../../../../clients/kisClient/investorFlowSupplyHealthBridge.js';
import { RRR_MIN_THRESHOLD, calcRRR } from '../../../riskManager.js';
import { getExecutionCostConfig } from '../../../executionCosts.js';
import { isOpenShadowStatus, calculateOrderQuantity } from '../../../entryEngine.js';
import {
  fetchGateData,
} from '../../../buyPipeline.js';
import { buildExposureBudgetMacroInput, computeSizingLiquidityInputs } from '../helpers.js';
import { applyExposureBudgetCap, applyPositionSizingEngine } from '../../../sizing/positionSizingEngineWiring.js';
import { resolveCurrentEquityExposure } from '../../../sizing/currentEquityExposure.js';
import { formatExposureBudgetLog } from '../../../sizing/regimeExposurePolicy.js';
import {
  formatShadowBullFloorLog,
  resolveCandidatePositionFloor,
} from '../../../sizing/shadowBullExposureProfile.js';
import { calculateRegimePositionSizing } from '../../../sizing/regimePositionPolicy.js';
import { readCandidateDartSlot } from '../../injectPerSymbolDartContext.js';
import type { BuyListLoopContext } from '../types.js';

type FetchGateDataResult = Awaited<ReturnType<typeof fetchGateData>>;

export interface PreBreakoutFollowthroughBudgetResult {
  followEntryPrice: number;
  gateScoreFollow: number;
  reCheckGateFollow: FetchGateDataResult['gate'];
  reCheckQuoteFollow: FetchGateDataResult['quote'];
  posPctFollow: number;
  fullQty: number;
  followQty: number;
  sizingSourceFollow: ServerShadowTrade['sizingSource'];
  sizingEngineSnapshotFollow?: ServerShadowTrade['sizingEngineSnapshot'];
}

export async function preBreakoutFollowthroughBudget(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  currentPrice: number,
): Promise<PreBreakoutFollowthroughBudgetResult | 'SKIP'> {
  const slippage = getExecutionCostConfig().slippageRate;
  const followEntryPrice = Math.round(currentPrice * (1 + slippage));

  const followRRR = calcRRR(followEntryPrice, stock.targetPrice, stock.stopLoss);
  if (followRRR < RRR_MIN_THRESHOLD) {
    console.log(
      `[PreBreakout] ${stock.name}(${stock.code}) 추종 RRR ${followRRR.toFixed(2)} < ${RRR_MIN_THRESHOLD} — 추종 매수 제외`,
    );
    return 'SKIP';
  }

  const gateScoreFollow = (stock.gateScore ?? 0) + ctx.volumeClock.scoreBonus;
  const {
    gate: reCheckGateFollow,
    quote: reCheckQuoteFollow,
    kisFlow: kisFlowFollow,
  } = await fetchGateData(stock.code, ctx.conditionWeights, ctx.macroState?.kospi20dReturn, readCandidateDartSlot(stock));
  applySupplyProviderHealthFromKisFlow(
    stock as { supplyProviderHealth?: Record<string, unknown> | undefined },
    kisFlowFollow,
  );

  const activeFollowPositions = ctx.shadows.filter(s =>
    isOpenShadowStatus(s.status) &&
    s.watchlistSource !== 'INTRADAY' &&
    s.watchlistSource !== 'PRE_BREAKOUT',
  ).length + ctx.mutables.reservedSlots.value;
  const simpleSizingFollow = calculateRegimePositionSizing({
    regime: ctx.regime,
    totalEquity: ctx.totalAssets,
    currentPositions: activeFollowPositions,
  });
  const posPctFollow = simpleSizingFollow.positionSizePct / 100;
  const exposureFloorFollow = resolveCandidatePositionFloor({
    shadowMode: ctx.shadowMode,
    regime: ctx.regime,
    tier: 'STANDARD',
    computedPositionPct: posPctFollow,
  });
  const effPosPctFollow = exposureFloorFollow.effectivePositionPct;
  if (exposureFloorFollow.applied) {
    console.log(
      formatShadowBullFloorLog(exposureFloorFollow, {
        stockName: stock.name,
        stockCode: stock.code,
        computedPositionPct: posPctFollow,
        pathLabel: 'PRE_BREAKOUT_FOLLOWTHROUGH',
      }),
    );
  }

  const remSlots = Math.max(1, simpleSizingFollow.remainingSlots);
  const { quantity: legacyFullQty } = calculateOrderQuantity({
    totalAssets: ctx.totalAssets,
    orderableCash: ctx.mutables.orderableCash.value,
    positionPct: effPosPctFollow,
    price: followEntryPrice,
    remainingSlots: remSlots,
    accountKellyMultiplier: 1.0,
  });

  const _sizingInputFollow = computeSizingLiquidityInputs(
    reCheckQuoteFollow ?? null,
    stock.code,
    stock.sector,
    ctx.shadows,
  );
  const sizingApplyFollow = applyPositionSizingEngine(ctx.shadowMode, {
    totalAssets: ctx.totalAssets, shadowEntryPrice: followEntryPrice, stopLoss: stock.stopLoss,
    signalGrade: 'BUY', regimeKelly: 1.0, confidenceModifier: 1.0,
    rrr: stock.rrr ?? 0,
    marketCap: 1_000_000_000_000_000,
    avgDailyVolume20d: _sizingInputFollow.avgDailyVolume20d,
    currentSectorWeight: _sizingInputFollow.currentSectorWeight,
    isNormalRegime: ctx.regime === 'R1_TURBO' || ctx.regime === 'R2_BULL' || ctx.regime === 'R3_EARLY',
    enemyChecklistPassed: true, highDataReliability: true, gate1AllPassed: true,
    notInDowntrend: ctx.regime !== 'R6_DEFENSE' && ctx.regime !== 'R5_CAUTION',
  });
  const fullQty = sizingApplyFollow.applied ? sizingApplyFollow.quantity : legacyFullQty;
  const sizingSourceFollow = sizingApplyFollow.sizingSource;
  const sizingEngineSnapshotFollow = sizingApplyFollow.applied && sizingApplyFollow.result ? {
    tierName: sizingApplyFollow.result.tier.name,
    basePct: sizingApplyFollow.result.basePct,
    finalPositionPct: sizingApplyFollow.result.finalPositionPct,
    finalPositionKrw: sizingApplyFollow.result.finalPosition,
    drawdownMultiplier: sizingApplyFollow.result.drawdownMultiplier,
    lossStreakMultiplier: sizingApplyFollow.result.lossStreakMultiplier,
    liquidityMultiplier: sizingApplyFollow.result.liquidityMultiplier,
    sectorExposureMultiplier: sizingApplyFollow.result.sectorExposureMultiplier,
    expectedStopLossDamagePct: sizingApplyFollow.result.expectedStopLossDamagePct,
    signalPriorityApplied: sizingApplyFollow.result.signalPriorityApplied,
    adjustmentReasons: sizingApplyFollow.result.adjustmentReasons,
    snapshotAt: new Date().toISOString(),
  } : undefined;
  if (sizingApplyFollow.applied) {
    console.log(
      `[Sizing-NewEngine] ${stock.code} ${stock.name} (PRE_BREAKOUT_FOLLOWTHROUGH) → tier=${sizingEngineSnapshotFollow!.tierName} qty=${fullQty} (legacy=${legacyFullQty})`,
    );
  }

  const followQtyRaw = Math.max(1, Math.ceil(fullQty * 0.7));
  const exposureCapFollow = applyExposureBudgetCap({
    rawQuantity: followQtyRaw,
    shadowEntryPrice: followEntryPrice,
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
  const followQty = exposureCapFollow.applied ? exposureCapFollow.finalQuantity : followQtyRaw;
  if (exposureCapFollow.applied && exposureCapFollow.capResult?.cappedByExposureBudget) {
    console.log(formatExposureBudgetLog({
      stockCode: stock.code,
      stockName: stock.name,
      pathLabel: 'PRE_BREAKOUT_FOLLOWTHROUGH',
      rawQuantity: followQtyRaw,
      finalQuantity: followQty,
      budget: exposureCapFollow.budget,
      capResult: exposureCapFollow.capResult,
    }));
  }

  return {
    followEntryPrice,
    gateScoreFollow,
    reCheckGateFollow,
    reCheckQuoteFollow,
    posPctFollow,
    fullQty,
    followQty,
    sizingSourceFollow,
    sizingEngineSnapshotFollow,
  };
}
