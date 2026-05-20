/**
 * @responsibility ADR-0019 entry revalidation gate extracted from buyListLoop.
 */

import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { logVisibilityEvent } from '../../../../utils/logger.js';
import { recordCounterfactual, COUNTERFACTUAL_DAILY_CAP } from '../../../../learning/counterfactualShadow.js';
import { recordRejection } from '../../../../learning/rejectionShadowTracker.js';
import { buildEntryConditionScores } from '../../../../learning/entryConditionScores.js';
import { evaluateServerGate } from '../../../../quantFilter.js';
import {
  applySectorScoreBoost,
  classifySectorTier,
  describeSectorBoost,
} from '../../../sectorScoreBoost.js';
import { getKstMarketElapsedMinutes } from '../../../entryEngine.js';
import { shouldIncrementFailCount } from '../../failureClassifier.js';
import { entryRevalidationStep } from '../../revalidationSteps/index.js';
import type { BuyListLoopContext } from '../types.js';

export interface EntryRevalidationSkippedBatchItem {
  symbol: string;
  score?: number;
  reasons: string[];
}

type ReCheckQuote = {
  dayOpen?: number;
  prevClose?: number;
  volume?: number;
  avgVolume?: number;
} | null;

export async function handleEntryRevalidationGate(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  gateResult: ReturnType<typeof evaluateServerGate> | null,
  conditionScores: ReturnType<typeof buildEntryConditionScores>,
  currentPrice: number,
  reCheckQuote: ReCheckQuote,
  stageLog: Record<string, string>,
  pushTrace: () => void,
  entryRevalidationSkippedBatch: EntryRevalidationSkippedBatchItem[],
): Promise<'SKIP' | 'CONTINUE'> {
  const sectorEnergyResult = ctx.macroState?.sectorEnergyResult ?? null;
  const sectorEnergyDataQuality = ctx.macroState?.sectorEnergyDataQuality;
  const sectorBoost = applySectorScoreBoost(stock.sector, sectorEnergyResult, ctx.regime, sectorEnergyDataQuality);
  const sectorBoostReason = sectorBoost !== 0 && stock.sector && sectorEnergyResult
    ? describeSectorBoost(
        stock.sector,
        sectorBoost,
        classifySectorTier(stock.sector, sectorEnergyResult),
        ctx.regime,
      )
    : undefined;

  const revalResult = entryRevalidationStep({
    stockName: stock.name,
    currentPrice,
    entryPrice: stock.entryPrice,
    reCheckQuote,
    reCheckGate: gateResult,
    regime: ctx.regime,
    marketSessionState: ctx.resolvedMarketSessionState,
    marketElapsedMinutes: getKstMarketElapsedMinutes(),
    sectorBoost,
    sectorBoostReason,
  });
  if (!revalResult.proceed) {
    const policySkipped = revalResult.stageLogValue === 'SKIPPED_POLICY_BLOCK';
    if (policySkipped) {
      entryRevalidationSkippedBatch.push({
        symbol: stock.name,
        score: gateResult?.gateScore,
        reasons: revalResult.failReasons,
      });
    }
    logVisibilityEvent({
      visibility: policySkipped ? 'TRACE' : 'SUMMARY',
      message: revalResult.logMessage,
      category: 'GATE',
      sourceCommand: '/scan',
      dedupKey: `ENTRY_REVALIDATION:${revalResult.stageLogValue}:${ctx.resolvedMarketSessionState ?? 'UNKNOWN'}:NONE`,
      summary: {
        stock: stock.name,
        stageLogValue: revalResult.stageLogValue,
        marketSessionState: ctx.resolvedMarketSessionState ?? 'UNKNOWN',
        executionImpact: 'NONE',
      },
      details: { stockCode: stock.code, stockName: stock.name, failReasons: revalResult.failReasons },
      level: 'info',
      executionImpact: 'NONE',
    });
    if (shouldIncrementFailCount('GATE_REVALIDATION_FAIL')) {
      stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
      ctx.mutables.watchlistMutated.value = true;
    }
    ctx.scanCounters.gateMisses++;
    if (revalResult.waitReason === 'DATA_HOLD') {
      ctx.scanCounters.waitDataHold++;
    } else {
      ctx.scanCounters.waitGateFail++;
    }
    stageLog.gate = revalResult.stageLogValue;
    pushTrace();

    if (ctx.scanCounters.counterfactualRecordedToday < COUNTERFACTUAL_DAILY_CAP) {
      try {
        const recorded = recordCounterfactual({
          stockCode: stock.code,
          stockName: stock.name,
          priceAtSignal: currentPrice,
          gateScore: stock.gateScore ?? 0,
          regime: ctx.regime,
          conditionKeys: stock.conditionKeys ?? [],
          skipReason: `entryRevalidation:${revalResult.failReasons.join(',')}`,
        });
        if (recorded) ctx.scanCounters.counterfactualRecordedToday++;
      } catch (e) {
        console.warn(`[Counterfactual] record ?ㅽ뙣 ${stock.code}:`, e instanceof Error ? e.message : e);
      }
    }

    try {
      const kstDate = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
      const rejectionConditionScores = conditionScores || buildEntryConditionScores(stock.conditionKeys);
      recordRejection({
        stockCode: stock.code,
        stockName: stock.name,
        signalDate: kstDate,
        signalPriceKrw: currentPrice,
        gateScore: stock.gateScore ?? 0,
        rejectionReason: `entryRevalidation:${revalResult.failReasons.join(',')}`,
        conditionScores: rejectionConditionScores,
      });
    } catch (e) {
      console.warn(`[RejectionShadow] record ?ㅽ뙣 ${stock.code}:`, e instanceof Error ? e.message : e);
    }
    return 'SKIP';
  }
  return 'CONTINUE';
}
