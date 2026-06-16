/**
 * @responsibility ADR-0019 R3 provisional shadow lane extracted from buyListLoop.
 */

import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { recordR3ProvisionalShadowCandidate } from '../../../../persistence/provisionalShadowLedger.js';
import { deriveR3ProvisionalShadowCandidate } from '../../provisionalShadowLane.js';
import { deriveGateDecisionRouterResult } from '../../gateDecisionRouter.js';
import { resolveTradingContext } from '../../../../calendar/tradingContext.js';
import type { BuyListLoopContext } from '../types.js';

export async function provisionalShadowLaneDerive(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  routerResult: ReturnType<typeof deriveGateDecisionRouterResult>,
  currentPrice: number,
): Promise<void> {
  const macroState = ctx.macroState;
  const candidate = deriveR3ProvisionalShadowCandidate({
    symbol: stock.code,
    name: stock.name,
    regime: ctx.learningRegime ?? ctx.regime,
    gate1Passed: true,
    gate2Passed: false,
    router: routerResult,
    sectorEnergyDiagnostic: macroState?.sectorEnergyQualityDiagnostic as
      Parameters<typeof deriveR3ProvisionalShadowCandidate>[0]['sectorEnergyDiagnostic'],
    riskFlags: {
      sellOnly: false,
      r6Defense: false,
    },
    nowKst: new Date().toISOString(),
    // ADR-0617 — buyListLoop KIS 게이트 가격(실진입 동일 소스, ADR-0561). positive finite 검증은 derive 내부.
    entryPrice: currentPrice,
    entryPriceSource: 'KIS_CURRENT',
  });
  if (candidate !== null) {
    ctx.scanCounters.provisionalShadowEligible += 1;
    ctx.scanCounters.provisionalShadowCandidates.push(candidate);
    const recordResult = recordR3ProvisionalShadowCandidate({
      candidate,
      // ADR-0591 Market Truth Layer 날짜 SSOT — UTC 캘린더 날짜 대신 단일 KST 거래일. SHADOW 한정(executionImpact=NONE).
      scanId: `${resolveTradingContext().effectiveTradingDate}:${stock.code}`,
      scannedAtKst: new Date().toISOString(),
      metadata: {
        ...(macroState?.sectorEnergyDataQuality !== undefined
          ? { sectorEnergyDataQuality: String(macroState.sectorEnergyDataQuality) }
          : {}),
        ...(typeof macroState?.sectorEnergyConfidence === 'number'
          ? { sectorEnergyConfidence: macroState.sectorEnergyConfidence }
          : {}),
        ...(routerResult.reasons.length > 0
          ? { routerReasons: routerResult.reasons.map(String) }
          : {}),
      },
    });
    if (recordResult.recorded) {
      ctx.scanCounters.provisionalShadowCreated += 1;
    } else {
      ctx.scanCounters.provisionalShadowSkipped += 1;
      const reason = recordResult.reason;
      ctx.scanCounters.provisionalShadowSkipReasons[reason] =
        (ctx.scanCounters.provisionalShadowSkipReasons[reason] ?? 0) + 1;
    }
  }
}
