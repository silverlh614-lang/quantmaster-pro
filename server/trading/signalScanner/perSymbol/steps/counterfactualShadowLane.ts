/**
 * @responsibility ADR-0019 counterfactual shadow learning lane extracted from buyListLoop.
 */

import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { appendCounterfactualShadowLearningEntry } from '../../../../persistence/counterfactualShadowLearningRepo.js';
import { evaluateServerGate } from '../../../../quantFilter.js';
import { deriveCounterfactualShadowLearningCandidate } from '../../counterfactualShadowLearningLane.js';
import { deriveGateDecisionRouterResult } from '../../gateDecisionRouter.js';
import { resolveTradingContext } from '../../../../calendar/tradingContext.js';
import type { BuyListLoopContext } from '../types.js';

export async function counterfactualShadowLearning(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  reCheckGate: ReturnType<typeof evaluateServerGate> | null,
  isGate1Survivor: boolean,
  // ADR-0632: KIS 게이트 현재가(실진입 동일 소스, ADR-0561 L1). flag ON 시 entryPriceHint 로 stamp.
  currentPrice: number,
): Promise<void> {
  try {
    if ((ctx.learningRegime ?? ctx.regime) === 'R3_EARLY' && isGate1Survivor && reCheckGate?.outputs) {
      const macroStateCf = ctx.macroState;
      // ADR-0591 Market Truth Layer 날짜 SSOT — UTC 캘린더 날짜(new Date().toISOString().slice) 대신
      // 단일 KST 거래일(effectiveTradingDate) 사용. 장전(08:40 KST=전날 UTC) scanId 전날 박힘 + 동일 스캔
      // 내 두 scanId 불일치(UTC midnight cross) 동시 해소. SHADOW 학습 한정(executionImpact=NONE).
      const effectiveTradingDate = resolveTradingContext().effectiveTradingDate;
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
        scanId: `${effectiveTradingDate}:${stock.code}`,
        nowKst: new Date().toISOString(),
        // ADR-0632: snapshot 위생 carry — derive 내부에서 flag ON + non-empty 시에만 stamp.
        // 결정·실행 분기 미사용(log/learning carry). ctx 미설정(undefined) 시 graceful 미stamp.
        ...(ctx.sourceSnapshotId !== undefined ? { sourceSnapshotId: ctx.sourceSnapshotId } : {}),
        ...(ctx.candidateSetId !== undefined ? { candidateSetId: ctx.candidateSetId } : {}),
        entryPriceHint: currentPrice,
      });
      if (cfCandidate !== null) {
        ctx.scanCounters.counterfactualShadowEligible += 1;
        ctx.scanCounters.counterfactualShadowCandidates.push(cfCandidate);
        const cfRecordResult = appendCounterfactualShadowLearningEntry({
          candidate: cfCandidate,
          scanId: `${effectiveTradingDate}:${stock.code}`,
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
