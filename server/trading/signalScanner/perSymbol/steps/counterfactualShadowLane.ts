/**
 * @responsibility ADR-0019 counterfactual shadow learning lane extracted from buyListLoop.
 */

import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { appendCounterfactualShadowLearningEntry } from '../../../../persistence/counterfactualShadowLearningRepo.js';
import { evaluateServerGate } from '../../../../quantFilter.js';
import { deriveCounterfactualShadowLearningCandidate } from '../../counterfactualShadowLearningLane.js';
import { deriveGateDecisionRouterResult } from '../../gateDecisionRouter.js';
import type { BuyListLoopContext } from '../types.js';

export async function counterfactualShadowLearning(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  reCheckGate: ReturnType<typeof evaluateServerGate> | null,
  isGate1Survivor: boolean,
): Promise<void> {
  try {
    if ((ctx.learningRegime ?? ctx.regime) === 'R3_EARLY' && isGate1Survivor && reCheckGate?.outputs) {
      const macroStateCf = ctx.macroState;
      const cfRouterResult = deriveGateDecisionRouterResult({
        regime: ctx.learningRegime ?? ctx.regime,
        gate1Pass: 1,
        gate2Pass: 0,
        riskFlags: {
          sellOnly: false,
          r6Defense: false,
        },
        sectorEnergyDiagnostic: macroStateCf?.sectorEnergyQualityDiagnostic as
          Parameters<typeof deriveCounterfactualShadowLearningCandidate>[0]['sectorEnergyDiagnostic'],
      });
      const cfCandidate = deriveCounterfactualShadowLearningCandidate({
        symbol: stock.code,
        name: stock.name,
        regime: ctx.learningRegime ?? ctx.regime,
        gate1Passed: true,
        gate2Passed: false,
        router: cfRouterResult,
        sectorEnergyDiagnostic: macroStateCf?.sectorEnergyQualityDiagnostic as
          Parameters<typeof deriveCounterfactualShadowLearningCandidate>[0]['sectorEnergyDiagnostic'],
        riskFlags: {
          sellOnly: false,
          r6Defense: false,
        },
        scanId: `${new Date().toISOString().slice(0, 10)}:${stock.code}`,
        nowKst: new Date().toISOString(),
      });
      if (cfCandidate !== null) {
        ctx.scanCounters.counterfactualShadowEligible += 1;
        ctx.scanCounters.counterfactualShadowCandidates.push(cfCandidate);
        const cfRecordResult = appendCounterfactualShadowLearningEntry({
          candidate: cfCandidate,
          scanId: `${new Date().toISOString().slice(0, 10)}:${stock.code}`,
          scannedAtKst: new Date().toISOString(),
        });
        if (cfRecordResult.recorded) {
          ctx.scanCounters.counterfactualShadowCreated += 1;
        } else {
          ctx.scanCounters.counterfactualShadowSkipped += 1;
          const reason = cfRecordResult.reason;
          ctx.scanCounters.counterfactualShadowSkipReasons[reason] =
            (ctx.scanCounters.counterfactualShadowSkipReasons[reason] ?? 0) + 1;
        }
      }
    }
  } catch (e) {
    console.warn('[Adr0430CounterfactualShadow] wiring 실패 — 매수 흐름 무영향:', e);
  }
}
