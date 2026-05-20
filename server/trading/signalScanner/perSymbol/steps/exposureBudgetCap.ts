/**
 * @responsibility ADR-0019 main buyList exposure budget cap extracted from buyListLoop.
 */

import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { applyExposureBudgetCap } from '../../../sizing/positionSizingEngineWiring.js';
import { resolveCurrentEquityExposure } from '../../../sizing/currentEquityExposure.js';
import { formatExposureBudgetLog } from '../../../sizing/regimeExposurePolicy.js';
import { buildExposureBudgetMacroInput } from '../helpers.js';
import type { BuyListLoopContext } from '../types.js';

export function exposureBudgetCap(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  shadowEntryPrice: number,
  baseQuantity: number,
): number {
  const exposureCapMain = applyExposureBudgetCap({
    rawQuantity: baseQuantity,
    shadowEntryPrice,
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
  const finalQuantity = exposureCapMain.applied ? exposureCapMain.finalQuantity : baseQuantity;
  if (exposureCapMain.applied && exposureCapMain.capResult?.cappedByExposureBudget) {
    console.log(formatExposureBudgetLog({
      stockCode: stock.code,
      stockName: stock.name,
      rawQuantity: baseQuantity,
      finalQuantity,
      budget: exposureCapMain.budget,
      capResult: exposureCapMain.capResult,
    }));
  }
  return finalQuantity;
}
