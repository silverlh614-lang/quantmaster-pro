/**
 * @responsibility ADR-0019 Gate Eligibility Split accumulation extracted from buyListLoop.
 */

import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { evaluateServerGate } from '../../../../quantFilter.js';
import { classifyGateEligibility } from '../../gateEligibilityClassifier.js';
import { accumulateGateEligibility, recordPipelineStage } from '../../scanDiagnostics.js';
import type { BuyListLoopContext } from '../types.js';

export function gateEligibilitySplit(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  currentPrice: number,
  reCheckGate: ReturnType<typeof evaluateServerGate> | null,
  isGate1Survivor: boolean,
): void {
  try {
    const priceValid = typeof currentPrice === 'number' && currentPrice > 0;
    const codeValid = /^[0-9]{6}$/.test(stock.code);
    const buySignalThreshold = 5;
    const strongBuySignalThreshold = 9;
    const signalGrade: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'NEUTRAL' | undefined =
      typeof stock.gateScore === 'number' && stock.gateScore >= strongBuySignalThreshold
        ? 'STRONG_BUY'
        : typeof stock.gateScore === 'number' && stock.gateScore >= buySignalThreshold
          ? 'BUY'
          : undefined;
    const sectorEnergyDataQualityCast = ctx.macroState?.sectorEnergyDataQuality as
      | 'OK' | 'PARTIAL' | 'STALE' | 'PARTIAL_VOLUME' | 'DEGRADED' | 'FAILED' | undefined;
    const priceDataDegraded =
      (stock as { technicalProviderDegraded?: boolean }).technicalProviderDegraded === true;
    const eligibility = classifyGateEligibility({
      currentPrice,
      stockCode: stock.code,
      supplyDataUnavailable: reCheckGate?.outputs?.some(
        (o) =>
          o.key === 'supply_confluence' &&
          (o.output as { status?: string } | null)?.status === 'DATA_UNAVAILABLE',
      ),
      investorFlowProviderUnavailable: reCheckGate?.outputs?.some(
        (o) =>
          (o.key === 'supply_confluence' || o.key === 'investor_flow') &&
          (o.output as { status?: string } | null)?.status === 'PROVIDER_DEGRADED',
      ),
      earningsDataUnavailable: reCheckGate?.outputs?.some(
        (o) =>
          o.key === 'earnings_quality' &&
          (o.output as { status?: string } | null)?.status === 'DATA_UNAVAILABLE',
      ),
      sectorEnergyDataQuality: sectorEnergyDataQualityCast,
      priceDataDegraded,
      macroBlocked: false,
      riskBlocked: false,
      trueGateFail: false,
      insufficientScore: false,
      dataStarved: false,
      hasFatalDefect: !priceValid || !codeValid,
      signalGrade,
      hasTechnicalSetup: isGate1Survivor,
    });
    accumulateGateEligibility(ctx.scanCounters, eligibility);
    recordPipelineStage(ctx.scanCounters, 'GATE_ELIGIBILITY_CLASSIFIED', eligibility.liveEligible ? 'PASS' : eligibility.shadowObservable ? 'SHADOW_ONLY' : 'BLOCKED');
  } catch (e) {
    console.warn('[Adr0436GateEligibility] classify 실패 — 매수 흐름 무영향:', e);
  }
}
