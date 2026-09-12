// @responsibility Calculate paper returns using entry-frozen execution costs.
import type { PaperCostModel } from '../../../src/types/paperExperiment.js';

export function calculatePaperReturn(entry: number, exit: number, cost: PaperCostModel) {
  const gross = exit - entry;
  const netPnl = gross - entry * (cost.buyFeeRate + cost.slippageRate)
    - exit * (cost.sellFeeRate + cost.sellTaxRate + cost.slippageRate);
  return { grossReturnPct: gross / entry * 100, netReturnPct: netPnl / entry * 100, netPnl };
}
