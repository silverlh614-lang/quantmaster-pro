/**
 * @responsibility ADR-0019 final sizing tier decision extracted from buyListLoop.
 * ADR-0191 keeps the self-holding guard here after extraction.
 * Persona 9: 보유 효과 boundary blocks duplicate live averaging entries.
 */

import type { EntryKellySnapshot } from '../../../../persistence/shadowTradeRepo.js';
import { appendShadowLog } from '../../../../persistence/shadowTradeRepo.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { checkFailurePattern } from '../../../../learning/failurePatternDB.js';
import { buildEntryConditionScores } from '../../../../learning/entryConditionScores.js';
import { evaluateCorrelationGate } from '../../../correlationSlotGate.js';
import { evaluateServerGate } from '../../../../quantFilter.js';
import { evaluateDataQualityFromStock } from '../../../priceSourcePolicy.js';
import {
  sizingTierDecider,
} from '../../sizingDeciders/index.js';
import { loadOpenPositions } from '../../../../persistence/positionTruth.js';
import { FAILURE_BLOCK_THRESHOLD_PCT } from '../helpers.js';
import type { BuyListLoopContext } from '../types.js';
import {
  calculateRegimePositionSizing,
  formatKellyRemovedIgnoredLog,
  formatPositionPolicySimpleAppliedLog,
} from '../../../sizing/regimePositionPolicy.js';

export type SizingTierFinalDecision = Extract<ReturnType<typeof sizingTierDecider>, { ok: true }>['tierDecision'];
export type SizingSignalGrade = 'STRONG_BUY' | 'BUY' | 'PROBING' | 'HOLD';

export interface SizingTierDeciderFinalResult {
  shouldSkip: boolean;
  kellySnapshot?: EntryKellySnapshot;
  tierDecision?: SizingTierFinalDecision;
  positionPct?: number;
  remainingSlots?: number;
  confidenceModifier?: number;
  grade?: SizingSignalGrade;
}

export async function sizingTierDeciderFinal(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  currentPrice: number,
  gateResult: ReturnType<typeof evaluateServerGate>,
  params: {
    liveGateScore: number;
    gateScore: number;
    shadowEntryPrice: number;
    currentActive: number;
    isMomentumShadow: boolean;
    isStrongBuy: boolean;
  },
): Promise<SizingTierDeciderFinalResult> {
  const priceSourceDataQuality = evaluateDataQualityFromStock(
    { priceKrw: (stock as { priceKrw?: number | null }).priceKrw ?? null },
    currentPrice,
    `final-candidate:${stock.code}`,
  );
  const mergedDataQuality = stock.dataQuality ?? priceSourceDataQuality;

  const tierResult = sizingTierDecider({
    stockName: stock.name,
    liveGateScore: params.liveGateScore,
    reCheckGate: gateResult,
    regime: ctx.regime,
    macroState: ctx.macroState,
    banditDecision: ctx.banditDecision,
    probingReservedSlots: ctx.mutables.probingReservedSlots.value,
    dataQuality: mergedDataQuality,
  });
  if (!tierResult.ok) {
    console.log(tierResult.logMessage);
    ctx.scanCounters.waitSizingBlocked++;
    return { shouldSkip: true };
  }
  const tierDecision = tierResult.tierDecision;
  for (const msg of tierResult.logMessages) console.log(msg);

  const sizing = calculateRegimePositionSizing({
    regime: ctx.regime,
    totalEquity: ctx.totalAssets,
    currentPositions: params.currentActive + ctx.mutables.reservedSlots.value,
  });
  const positionPct = sizing.positionSizePct / 100;

  if (gateResult) {
    console.log(
      `[AutoTrade] ${stock.name} simple position policy ` +
      `liveGate: ${params.liveGateScore.toFixed(1)} (stale: ${(stock.gateScore ?? 0)}) | ` +
      `MTAS: ${gateResult.mtas.toFixed(1)}/10 | ` +
      `CS: ${gateResult.compressionScore.toFixed(2)} | ` +
      `tier: ${tierDecision.tier}(diagnostic) | ` +
      `posPct: ${(positionPct * 100).toFixed(1)}%`
    );
  }

  console.log(formatPositionPolicySimpleAppliedLog({
    snapshotId: `buyList:${stock.code}`,
    symbol: stock.code,
    sizing,
  }));
  console.log(formatKellyRemovedIgnoredLog({
    snapshotId: `buyList:${stock.code}`,
    symbol: stock.code,
    previousKellyValue: ctx.kellyMultiplier,
  }));

  const remainingSlots = sizing.remainingSlots;
  if (remainingSlots <= 0) {
    console.log(`[PositionPolicy] ${stock.name}(${stock.code}) slot full by regime policy`);
    return { shouldSkip: true, remainingSlots: 0, positionPct, tierDecision };
  }

  if (!params.isMomentumShadow) {
    const candidateScores = buildEntryConditionScores(stock.conditionKeys);
    const failureWarning = checkFailurePattern(candidateScores, undefined, ctx.regime);
    if (failureWarning.hasWarning && failureWarning.maxSimilarity >= FAILURE_BLOCK_THRESHOLD_PCT) {
      console.log(
        `[AutoTrade/FailureDB] ${stock.name}(${stock.code}) 吏꾩엯 李⑤떒 ??${failureWarning.message}`,
      );
      appendShadowLog({
        event: 'BLOCKED_FAILURE_PATTERN',
        code: stock.code,
        maxSimilarity: failureWarning.maxSimilarity,
        similarCount: failureWarning.similarCount,
        topMatches: failureWarning.topMatches.map(m =>
          `${m.stockCode}(${m.similarity}%, ${m.returnPct.toFixed(1)}%)`,
        ),
      });
      return { shouldSkip: true };
    }

    const corrGate = evaluateCorrelationGate({
      candidateCode: stock.code,
      candidateSector: stock.sector,
      trades: ctx.shadows,
    });
    if (!corrGate.allowed) {
      console.log(`[AutoTrade/CorrGate] ${stock.name}(${stock.code}) 吏꾩엯 李⑤떒 ??${corrGate.reason}`);
      appendShadowLog({
        event: 'BLOCKED_CORRELATION',
        code: stock.code,
        avgCorrelation: Number(corrGate.avgCorrelation.toFixed(3)),
        effectiveIndependentCount: Number(corrGate.effectiveIndependentCount.toFixed(2)),
      });
      return { shouldSkip: true };
    }

    if (process.env.BUY_LIST_SELF_HOLDING_GUARD_DISABLED !== 'true') {
      const openPositions = loadOpenPositions();
      const alreadyHeld = openPositions.some(p => p.stockCode === stock.code);
      if (alreadyHeld) {
        console.log(
          `[AutoTrade/SelfHoldingGuard] ${stock.name}(${stock.code}) 이미 보유 중 — 물타기 차단 (ADR-0191)`,
        );
        appendShadowLog({
          event: 'BLOCKED_SELF_HOLDING',
          code: stock.code,
        });
        return { shouldSkip: true };
      }
    }
  }

  const grade: SizingSignalGrade =
    tierDecision.tier === 'PROBING' ? 'PROBING'
    : 'BUY';
  const confidenceModifier = 1.0;

  const entryKellySnapshot: EntryKellySnapshot = {
    tier: tierDecision.tier,
    signalGrade: grade,
    rawKellyMultiplier: positionPct,
    effectiveKelly: positionPct,
    fractionalCap: positionPct,
    ipsAtEntry: 0,
    regimeAtEntry: ctx.regime,
    accountRiskBudgetPctAtEntry: 0,
    confidenceModifier,
    snapshotAt: new Date().toISOString(),
  };
  return {
    shouldSkip: false,
    kellySnapshot: entryKellySnapshot,
    tierDecision,
    positionPct,
    remainingSlots,
    confidenceModifier,
    grade,
  };
}
