/**
 * @responsibility ADR-0019 KIS intraday correction gate extracted from buyListLoop.
 */

import { fetchKisInvestorTradeByStockDaily } from '../../../../clients/kisClient.js';
import { applySupplyProviderHealthFromKisFlow } from '../../../../clients/kisClient/investorFlowSupplyHealthBridge.js';
import { getDartFinancials } from '../../../../clients/dartFinancialClient.js';
import { fetchYahooQuote, fetchKisQuoteFallback, enrichQuoteWithKisMTAS } from '../../../../screener/stockScreener.js';
import { fetchYahooQuoteByCode } from '../../../../screener/adapters/yahooSymbolResolver.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { recordNearMissOutcome } from '../../../../persistence/nearMissOutcomeLedger.js';
import { loadGateReclassificationApprovalPlan } from '../../../../learning/gateReclassificationApprovalPlan.js';
import {
  evaluateGateReclassificationDryRun,
  isGateReclassificationDryRunDisabled,
} from '../../../../learning/gateReclassificationDryRun.js';
import {
  buildGateReclassificationDryRunId,
  upsertGateReclassificationDryRunRecord,
} from '../../../../persistence/gateReclassificationDryRunRepo.js';
import { evaluateServerGate } from '../../../../quantFilter.js';
import { kisIntradayCorrectionStep as runKisIntradayCorrectionStep } from '../../revalidationSteps/index.js';
import {
  accumulateGateLayerSummary,
  accumulateGateReclassificationDryRun,
  accumulateGateScoreCandidateBucket,
  accumulateGateScoreHealth,
  accumulateNearMissOutcomeLedgerWrite,
  accumulatePositiveScoreStarvation,
  recordPipelineStage,
} from '../../scanDiagnostics.js';
import { getRegimeGateBand } from '../../../gateConfig.js';
import { buildGate1ScoreStarvationTraceFromGateResult } from '../../gate1PositiveScoreStarvation.js';
import { conditionResultsTraceToMap, projectGateOutputsToConditionResultsTrace } from '../../gateConditionResultTrace.js';
import type { BuyListLoopContext } from '../types.js';

export interface KisIntradayCorrectionResult {
  gateResult: ReturnType<typeof evaluateServerGate> | null;
  reCheckQuote: Awaited<ReturnType<typeof enrichQuoteWithKisMTAS>> | null;
}

function kstDecisionDate(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export async function kisIntradayCorrectionStep(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  currentPrice: number,
): Promise<KisIntradayCorrectionResult> {
  const reCheckQuoteRaw = await fetchYahooQuoteByCode(stock.code, fetchYahooQuote)
                       ?? await fetchKisQuoteFallback(stock.code).catch(() => null);
  const reCheckQuote = reCheckQuoteRaw
    ? await enrichQuoteWithKisMTAS(reCheckQuoteRaw, stock.code)
    : null;

  const kisCorrection = await runKisIntradayCorrectionStep({
    stockCode: stock.code,
    reCheckQuote,
  });
  for (const msg of kisCorrection.logMessages) console.log(msg);

  const [kisFlow, dartFin] = reCheckQuote
    ? await Promise.all([
        fetchKisInvestorTradeByStockDaily(stock.code).catch(() => null),
        getDartFinancials(stock.code).catch(() => null),
      ])
    : [null, null];
  applySupplyProviderHealthFromKisFlow(stock as { supplyProviderHealth?: Record<string, unknown> | undefined }, kisFlow);
  try { recordPipelineStage(ctx.scanCounters, 'PRICE_FETCH', reCheckQuote ? 'PASS' : 'FAIL'); } catch {}
  const reCheckGate = reCheckQuote
    ? evaluateServerGate(
        reCheckQuote,
        ctx.conditionWeights,
        ctx.macroState?.kospi20dReturn,
        dartFin,
        kisFlow,
        ctx.regime,
        'ENTRY_RECHECK_GATE',
      )
    : null;
  try {
    recordPipelineStage(ctx.scanCounters, 'SERVER_GATE_EVALUATED', reCheckGate ? 'PASS' : 'SKIPPED');
    recordPipelineStage(ctx.scanCounters, 'GATE_LAYER_SUMMARY_BUILT', reCheckGate?.gateLayerSummary ? 'PASS' : 'SKIPPED');
  } catch {}
  if (reCheckGate) {
    const conditionResultsTrace = projectGateOutputsToConditionResultsTrace(reCheckGate.outputs);
    const conditionResults = conditionResultsTraceToMap(conditionResultsTrace);
    Object.assign(stock, {
      gateEvaluation: {
        ...reCheckGate.gateEvaluation,
        rawScore: reCheckGate.rawScore,
        availableMaxScore: reCheckGate.availableMaxScore,
        normalizedGateScore: reCheckGate.normalizedGateScore,
        conditionKeys: reCheckGate.conditionKeys,
        outputs: reCheckGate.outputs,
      },
      conditionResultsTrace,
      ...(conditionResults ? { conditionResults } : {}),
      conditionKeys: reCheckGate.conditionKeys,
      gateRawScore: reCheckGate.rawScore,
      normalizedGateScore: reCheckGate.normalizedGateScore,
      availableMaxScore: reCheckGate.availableMaxScore,
      gateLayerSummary: reCheckGate.gateLayerSummary,
      gate2ExternalDataCoverage: reCheckGate.gateLayerSummary?.gate2?.externalDataCoverage,
      gate3ExternalDataCoverage: reCheckGate.gateLayerSummary?.gate3?.externalDataCoverage,
    });
  }
  try {
    accumulateGateScoreHealth(ctx.scanCounters, reCheckGate);
    accumulateGateLayerSummary(ctx.scanCounters, reCheckGate?.gateLayerSummary, reCheckGate?.signalType);
  } catch (e) {
    console.warn('[ADR-452c] accumulateGateScoreHealth failed:', e instanceof Error ? e.message : e);
  }
  try {
    if (reCheckGate) {
      const band = getRegimeGateBand(ctx.regime);
      accumulatePositiveScoreStarvation(
        ctx.scanCounters,
        buildGate1ScoreStarvationTraceFromGateResult({
          symbol: stock.code,
          name: stock.name,
          requiredScore: band.strong,
          gateResult: reCheckGate,
          watchlistScore: stock.gateScore,
          upstreamScore: stock.gateScore,
        }),
      );
    }
  } catch (e) {
    console.warn('[ADR-0467] positive score starvation audit failed:', e instanceof Error ? e.message : e);
  }
  try {
    const band = getRegimeGateBand(ctx.regime);
    const bucketDecision = accumulateGateScoreCandidateBucket(ctx.scanCounters, reCheckGate, band.normal);
    if (
      bucketDecision &&
      reCheckGate &&
      (bucketDecision.bucket === 'DATA_BLOCKED_NEAR_MISS' ||
        bucketDecision.bucket === 'PROBING' ||
        bucketDecision.bucket === 'SHADOW_ONLY')
    ) {
      const outcome = recordNearMissOutcome({
        stockCode: stock.code,
        stockName: stock.name,
        signalDate: kstDecisionDate(),
        signalPriceKrw: currentPrice,
        bucket: bucketDecision.bucket,
        diagnosticReason: bucketDecision.reason,
        gateScore: reCheckGate.gateScore,
        rawScore: reCheckGate.rawScore,
        availableMaxScore: reCheckGate.availableMaxScore,
        normalizedGateScore: reCheckGate.normalizedGateScore,
        normalThreshold: band.normal,
        unavailableConditions: reCheckGate.unavailableConditions,
        thresholdNotMetConditions: reCheckGate.thresholdNotMetConditions,
        providerDegradedConditions: reCheckGate.providerDegradedConditions,
      });
      accumulateNearMissOutcomeLedgerWrite(ctx.scanCounters, outcome);
    }

    if (!isGateReclassificationDryRunDisabled() && bucketDecision && reCheckGate) {
      const approvedItems = loadGateReclassificationApprovalPlan().items
        .filter((item) => item.status === 'APPROVED');
      const observedDateKst = kstDecisionDate();
      const dryRun = evaluateGateReclassificationDryRun({
        code: stock.code,
        name: stock.name,
        gateScore: reCheckGate.gateScore,
        rawScore: reCheckGate.rawScore,
        availableMaxScore: reCheckGate.availableMaxScore,
        normalizedGateScore: reCheckGate.normalizedGateScore,
        unavailableConditions: reCheckGate.unavailableConditions ?? [],
        thresholdNotMetConditions: reCheckGate.thresholdNotMetConditions ?? [],
        providerDegradedConditions: reCheckGate.providerDegradedConditions ?? [],
        originalBucket: bucketDecision.bucket,
        approvedItems,
      });

      if (dryRun.dryRunDecision !== 'NO_CHANGE') {
        upsertGateReclassificationDryRunRecord({
          ...dryRun,
          id: buildGateReclassificationDryRunId(stock.code, observedDateKst, dryRun.dryRunDecision),
          observedAt: new Date().toISOString(),
          observedDateKst,
          status: 'OUTCOME_PENDING',
        });
        accumulateGateReclassificationDryRun(ctx.scanCounters, dryRun);
      }
    }
  } catch (e) {
    console.warn('[ADR-454/458] near-miss outcome or gate reclassification dry-run failed (live flow unaffected):', e instanceof Error ? e.message : e);
  }
  return { gateResult: reCheckGate, reCheckQuote };
}
