/**
 * @responsibility ADR-0019 supply health routing extracted from buyListLoop.
 */

import { createLearningSampleFromDecision, applySupplyHealthToSignal, determineExecutionMode, type TradingSignal } from '../../../../learning/supplyHealthLearning.js';
import { appendLearningSample } from '../../../../persistence/learningSampleRepo.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import type { BuyListLoopContext } from '../types.js';

function kstDecisionDate(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function recordSupplyHealthLearningSample(params: {
  stockCode: string;
  stockName: string;
  currentPrice: number;
  rawSignal: TradingSignal;
  rawScore: number;
  requestedSize: number;
  ctx: BuyListLoopContext;
}): void {
  const snapshot = params.ctx.supplyHealthSnapshot;
  if (!snapshot) return;
  try {
    appendLearningSample(createLearningSampleFromDecision({
      symbol: params.stockCode,
      name: params.stockName,
      market: 'UNKNOWN',
      date: kstDecisionDate(),
      currentPrice: params.currentPrice,
      rawSignal: params.rawSignal,
      rawScore: params.rawScore,
      positionSize: params.requestedSize,
      supplyHealthSnapshot: snapshot,
    }));
  } catch (e) {
    console.warn('[SupplyHealthLearning] sample append failed:', e);
  }
}

export function applyBuySupplyHealthPolicy(params: {
  stockCode: string;
  stockName: string;
  currentPrice: number;
  rawSignal: TradingSignal;
  rawScore: number;
  requestedSize: number;
  shadowMode: boolean;
  ctx: BuyListLoopContext;
}): {
  blocked: boolean;
  shadowMode: boolean;
  finalQuantity: number;
  finalSignal: TradingSignal;
  healthDecision?: ReturnType<typeof applySupplyHealthToSignal>;
} {
  const snapshot = params.ctx.supplyHealthSnapshot;
  if (!snapshot) {
    return {
      blocked: false,
      shadowMode: params.shadowMode,
      finalQuantity: params.requestedSize,
      finalSignal: params.rawSignal,
    };
  }

  const healthDecision = applySupplyHealthToSignal({
    rawSignal: params.rawSignal,
    rawScore: params.rawScore,
    positionSize: params.requestedSize,
    supplyHealthSnapshot: snapshot,
  });
  recordSupplyHealthLearningSample(params);
  const executionMode = determineExecutionMode({
    rawSignal: params.rawSignal,
    finalSignal: healthDecision.finalSignal,
    dataConfidence: healthDecision.dataConfidence,
    overallStatus: snapshot.summary.overallStatus,
    wasDowngradedBySupplyHealth: healthDecision.wasDowngradedBySupplyHealth,
  });
  if (executionMode === 'BLOCKED' || executionMode === 'WATCHLIST') {
    console.log(`[AutoTrade/SupplyHealth] ${params.stockName}(${params.stockCode}) ${executionMode} by supply_health`);
    return {
      blocked: true,
      shadowMode: params.shadowMode,
      finalQuantity: 0,
      finalSignal: healthDecision.finalSignal,
      healthDecision,
    };
  }
  return {
    blocked: false,
    shadowMode: executionMode === 'SHADOW' ? true : params.shadowMode,
    finalQuantity: Math.max(0, Math.floor(healthDecision.positionSizeAfterHealth ?? params.requestedSize)),
    finalSignal: healthDecision.finalSignal,
    healthDecision,
  };
}

export interface SupplyHealthRoutingResult {
  action: 'SKIP' | 'CONTINUE';
  stockShadowMode: boolean;
  finalSignalLevel: TradingSignal;
  supplyAdjustedFinalQuantity: number;
  healthDecision?: ReturnType<typeof applySupplyHealthToSignal>;
}

export function supplyHealthRouting(input: {
  ctx: BuyListLoopContext;
  stock: WatchlistEntry;
  currentPrice: number;
  rawSignalLevel: TradingSignal;
  gateScore: number;
  finalQuantity: number;
  stockShadowMode: boolean;
}): SupplyHealthRoutingResult {
  const {
    ctx,
    stock,
    currentPrice,
    rawSignalLevel,
    gateScore,
    finalQuantity,
  } = input;
  const supplyHealthSnapshot = ctx.supplyHealthSnapshot;
  let stockShadowMode = input.stockShadowMode;
  let finalSignalLevel: TradingSignal = rawSignalLevel;
  let supplyAdjustedFinalQuantity = finalQuantity;
  let healthDecision: ReturnType<typeof applySupplyHealthToSignal> | undefined = undefined;

  if (supplyHealthSnapshot) {
    healthDecision = applySupplyHealthToSignal({
      rawSignal: rawSignalLevel,
      rawScore: gateScore,
      positionSize: finalQuantity,
      supplyHealthSnapshot,
    });
    recordSupplyHealthLearningSample({
      stockCode: stock.code,
      stockName: stock.name,
      currentPrice,
      rawSignal: rawSignalLevel,
      rawScore: gateScore,
      requestedSize: finalQuantity,
      ctx,
    });

    const executionMode = determineExecutionMode({
      rawSignal: rawSignalLevel,
      finalSignal: healthDecision.finalSignal,
      dataConfidence: healthDecision.dataConfidence,
      overallStatus: supplyHealthSnapshot.summary.overallStatus,
      wasDowngradedBySupplyHealth: healthDecision.wasDowngradedBySupplyHealth,
    });

    if (executionMode === 'BLOCKED') {
      console.log(`[AutoTrade/SupplyHealth] ${stock.name}(${stock.code}) 수급 데이터 BROKEN — 진입 차단`);
      return {
        action: 'SKIP',
        stockShadowMode,
        finalSignalLevel,
        supplyAdjustedFinalQuantity: 0,
        healthDecision,
      };
    }
    if (executionMode === 'WATCHLIST') {
      console.log(`[AutoTrade/SupplyHealth] ${stock.name}(${stock.code}) 수급 데이터 불안정 — WATCHLIST 유지 (진입 보류)`);
      return {
        action: 'SKIP',
        stockShadowMode,
        finalSignalLevel,
        supplyAdjustedFinalQuantity: 0,
        healthDecision,
      };
    }
    if (executionMode === 'SHADOW' && !stockShadowMode) {
      console.log(`[AutoTrade/SupplyHealth] ⚠️ ${stock.name}(${stock.code}) 수급 데이터 저신뢰 — 강제 SHADOW 모드 전환`);
      stockShadowMode = true;
    }

    supplyAdjustedFinalQuantity = Math.max(0, Math.floor(healthDecision.positionSizeAfterHealth ?? finalQuantity));
    finalSignalLevel = healthDecision.finalSignal;
  }
  if (supplyAdjustedFinalQuantity < 1) {
    return {
      action: 'SKIP',
      stockShadowMode,
      finalSignalLevel,
      supplyAdjustedFinalQuantity,
      healthDecision,
    };
  }

  return {
    action: 'CONTINUE',
    stockShadowMode,
    finalSignalLevel,
    supplyAdjustedFinalQuantity,
    healthDecision,
  };
}
