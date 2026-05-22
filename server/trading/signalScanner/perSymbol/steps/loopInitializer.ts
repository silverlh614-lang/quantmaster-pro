/**
 * @responsibility ADR-0019 per-stock buyList loop initialization extracted from buyListLoop.
 */

import { recordTwinEntries } from '../../../../learning/counterfactualTwinPortfolio.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { deriveShadowApprovalContext } from '../../../../telegram/shadowApprovalDedupeStore.js';
import { computeSlotConsumption } from '../../../slotAccounting.js';
import { isOpenShadowStatus } from '../../../entryEngine.js';
import { resolveWatchlistKisPolicy } from '../../../watchlistKisTierPolicy.js';
import { getPrice } from '../helpers.js';
import type { BuyListLoopContext } from '../types.js';

export interface BuyListLoopRunState {
  shadowApprovalCtx: ReturnType<typeof deriveShadowApprovalContext>;
  diagnosticLiveBlockLogged: boolean;
}

export function createBuyListLoopRunState(): BuyListLoopRunState {
  return {
    shadowApprovalCtx: deriveShadowApprovalContext(),
    diagnosticLiveBlockLogged: false,
  };
}
function getDiagnosticLiveBlockReason(ctx: BuyListLoopContext): string | undefined {
  const reason = ctx.liveEntryBlockedReason?.trim();
  if (reason) return reason;
  return ctx.positionFullDiagnosticOnly ? 'POSITION_FULL' : undefined;
}

function isMacroDiagnosticLiveBlockReason(reason: string | undefined): boolean {
  if (!reason) return false;
  const macroReasons = new Set(['R4_NEUTRAL', 'R5_CAUTION', 'VIX_BLOCK', 'FOMC_BLOCK']);
  const parts = reason.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => macroReasons.has(part));
}

export interface LoopInitializerContinue {
  action: 'CONTINUE';
  currentActive: number;
  currentPrice: number;
  stageLog: Record<string, string>;
  pushTrace: () => void;
  stockShadowMode: boolean;
  diagnosticLiveBlockReason?: string;
  macroDiagnosticLiveBlock: boolean;
  diagnosticLiveBlockLogged: boolean;
}

export interface LoopInitializerStop {
  action: 'BREAK' | 'SKIP';
  diagnosticLiveBlockLogged: boolean;
}

export async function loopInitializer(input: {
  ctx: BuyListLoopContext;
  stock: WatchlistEntry;
  isMomentumShadow: boolean;
  initialStockShadowMode: boolean;
  diagnosticLiveBlockLogged: boolean;
}): Promise<LoopInitializerContinue | LoopInitializerStop> {
  const {
    ctx,
    stock,
    isMomentumShadow,
  } = input;
  let stockShadowMode = input.initialStockShadowMode;
  let diagnosticLiveBlockLogged = input.diagnosticLiveBlockLogged;

  const slotResult = computeSlotConsumption(ctx.shadows, ctx.effectiveMaxPositions);
  const currentActive = slotResult.rawCount;
  const totalCommitted = slotResult.consumed + ctx.mutables.reservedSlots.value;
  const diagnosticLiveBlockReason = getDiagnosticLiveBlockReason(ctx);
  const macroDiagnosticLiveBlock = isMacroDiagnosticLiveBlockReason(diagnosticLiveBlockReason);
  if (!isMomentumShadow && macroDiagnosticLiveBlock) {
    stockShadowMode = true;
  }
  if (!isMomentumShadow && totalCommitted >= ctx.effectiveMaxPositions && !diagnosticLiveBlockReason) {
    console.log(
      `[AutoTrade] max positions reached (${slotResult.consumed.toFixed(2)} + reserved ${ctx.mutables.reservedSlots.value} = ${totalCommitted.toFixed(2)}/${ctx.effectiveMaxPositions}, regime=${ctx.regime}, raw=${slotResult.rawCount}) - remaining symbols skipped`,
    );
    return { action: 'BREAK', diagnosticLiveBlockLogged };
  }
  if (!isMomentumShadow && totalCommitted >= ctx.effectiveMaxPositions && diagnosticLiveBlockReason) {
    stockShadowMode = true;
    if (!diagnosticLiveBlockLogged) {
      console.log(
        `[AutoTrade] ${diagnosticLiveBlockReason} diagnostic-only path active ??live buy tasks suppressed while gate diagnostics continue (${totalCommitted.toFixed(2)}/${ctx.effectiveMaxPositions})`,
      );
      diagnosticLiveBlockLogged = true;
    }
  } else if (!isMomentumShadow && macroDiagnosticLiveBlock && !diagnosticLiveBlockLogged) {
    console.log(
      `[AutoTrade] ${diagnosticLiveBlockReason} macro diagnostic path active ??live buy tasks routed to shadow while gate diagnostics continue`,
    );
    diagnosticLiveBlockLogged = true;
  }

  const stageLog: Record<string, string> = {};
  const pushTrace = () => ctx.scanCounters.pendingTraces.push({
    ts: new Date().toISOString().slice(11, 19),
    stock: stock.code,
    name: stock.name,
    stages: { ...stageLog },
  });

  const isHeldPosition = ctx.shadows.some(
    (s) => s.stockCode === stock.code && isOpenShadowStatus(s.status),
  );
  const kisTierPolicy = resolveWatchlistKisPolicy({
    section: stock.section,
    gateScore: stock.gateScore,
    stage2Score: stock.stage2Score,
    momentumRank: (stock as { momentumRank?: number }).momentumRank,
    isOpenPosition: isHeldPosition,
    isForceBuy: (stock as { isForceBuy?: boolean }).isForceBuy,
  });
  const currentPrice = await getPrice(stock.code, {
    section: stock.section,
    gateScore: stock.gateScore,
    stage2Score: stock.stage2Score,
    isOpenPosition: isHeldPosition,
    allowRestFallback: kisTierPolicy.allowRestPrice,
    restTtlMs: kisTierPolicy.priceTtlMs,
    pricePurpose: 'BUY_EVAL',
    stockName: stock.name,
  });
  if (!currentPrice) {
    if (!kisTierPolicy.allowRestPrice) {
      stageLog.price = 'SKIP_TIER_PASSIVE_NO_REST';
      ctx.scanCounters.waitTierRestSuppressed =
        (ctx.scanCounters.waitTierRestSuppressed ?? 0) + 1;
      if (process.env.WATCHLIST_KIS_TIER_DEBUG === 'true') {
        console.debug(
          `[WATCHLIST_KIS_TIER] symbol=${stock.code} section=${stock.section ?? '?'} ` +
          `tier=${kisTierPolicy.tier} allowRestPrice=false reason=${kisTierPolicy.reason} ` +
          `executionImpact=NONE marketSignal=false`,
        );
      }
      pushTrace();
      return { action: 'SKIP', diagnosticLiveBlockLogged };
    }
    stageLog.price = 'FAIL';
    pushTrace();
    return { action: 'SKIP', diagnosticLiveBlockLogged };
  }
  stageLog.price = 'PASS';

  try {
    const ge = stock.gateEvaluation;
    if (ge?.gate1Passed === true) {
      ctx.scanCounters.gate1Pass++;
    } else if (!ge) {
      ctx.scanCounters.gate1Unknown++;
    }
    if (ge?.gate2Passed === true) ctx.scanCounters.gate2Pass++;
    if (ge?.gate3Passed === true) ctx.scanCounters.gate3Pass++;
  } catch (e) {
    console.warn('[ADR-0120] Gate pass 移댁슫???꾩쟻 ?ㅽ뙣:', e);
  }

  try {
    const kstDate = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    recordTwinEntries({
      stockCode: stock.code,
      stockName: stock.name,
      signalDate: kstDate,
      gateScore: stock.gateScore ?? 0,
      entryPrice: currentPrice,
      kellyWeight: 0.10,
    });
  } catch (e) {
    console.warn(`[TwinPortfolio] record ?ㅽ뙣 ${stock.code}:`, e instanceof Error ? e.message : e);
  }

  return {
    action: 'CONTINUE',
    currentActive,
    currentPrice,
    stageLog,
    pushTrace,
    stockShadowMode,
    diagnosticLiveBlockReason,
    macroDiagnosticLiveBlock,
    diagnosticLiveBlockLogged,
  };
}
