/**
 * @responsibility ADR-0019 SHADOW/LIVE approval queue registration extracted from buyListLoop.
 */

import { channelBuySignalEmitted } from '../../../../alerts/channelPipeline.js';
import { recordUniverseEntries } from '../../../../learning/ledgerSimulator.js';
import type { ServerShadowTrade } from '../../../../persistence/shadowTradeRepo.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { buildSignalId } from '../../../../persistence/tradeSignalStatusRepo.js';
import { evaluateServerGate } from '../../../../quantFilter.js';
import { formatStopLossBreakdown, type StopLossPlan } from '../../../entryEngine.js';
import { getRegimeGateBand } from '../../../gateConfig.js';
import { trancheExecutor } from '../../../trancheExecutor.js';
import { createBuyTask } from '../../../buyPipeline.js';
import { setLastBuySignalAt } from '../../scanDiagnostics.js';
import { applyApprovalReservation } from '../../approvalQueue/index.js';
import type { TradingSignal } from '../../../../learning/supplyHealthLearning.js';
import type { BuyListLoopContext } from '../types.js';
import type { SizingSignalGrade, SizingTierFinalDecision } from './sizingTierDecider.js';

export interface HandleApprovalQueueInput {
  ctx: BuyListLoopContext;
  stock: WatchlistEntry;
  currentPrice: number;
  stockShadowMode: boolean;
  isMomentumShadow: boolean;
  isFinalStrongBuy: boolean;
  execQty: number;
  supplyAdjustedFinalQuantity: number;
  effectiveBudgetAfterHealth: number;
  trade: ServerShadowTrade;
  shadowEntryPrice: number;
  stopLossPlan: StopLossPlan;
  gateScore: number;
  liveGateScore: number;
  reCheckGate: NonNullable<ReturnType<typeof evaluateServerGate>>;
  finalSignalLevel: TradingSignal;
  shadowApprovalCtx: {
    tradeDate: string;
    marketSession: 'PRE_OPEN' | 'REGULAR' | 'LUNCH_BREAK' | 'AFTER_HOURS' | 'CLOSED';
  };
  diagnosticLiveBlockReason?: string;
  macroDiagnosticLiveBlock: boolean;
  stageLog: Record<string, string>;
  pushTrace: () => void;
  grade: SizingSignalGrade;
  tierDecision: SizingTierFinalDecision;
  signalTimeMain: string;
  suppressDiagnosticLiveBuyTask: (ctx: BuyListLoopContext, stock: WatchlistEntry, reason: string) => void;
}

export async function handleApprovalQueue(input: HandleApprovalQueueInput): Promise<'SKIP' | 'CONTINUE'> {
  const {
    ctx,
    stock,
    currentPrice,
    stockShadowMode,
    isMomentumShadow,
    isFinalStrongBuy,
    execQty,
    supplyAdjustedFinalQuantity,
    effectiveBudgetAfterHealth,
    trade,
    shadowEntryPrice,
    stopLossPlan,
    gateScore,
    liveGateScore,
    reCheckGate,
    finalSignalLevel,
    shadowApprovalCtx,
    diagnosticLiveBlockReason,
    macroDiagnosticLiveBlock,
    stageLog,
    pushTrace,
    grade,
    tierDecision,
    signalTimeMain,
    suppressDiagnosticLiveBuyTask,
  } = input;

  ctx.scanCounters.entries++;
  setLastBuySignalAt(Date.now());
  stageLog.buy = stockShadowMode ? 'SHADOW' : 'LIVE';
  pushTrace();

  const modeEmoji = stockShadowMode ? '⚡' : '🚀';
  const modeLabel = isMomentumShadow ? 'Shadow(학습)' : stockShadowMode ? 'Shadow' : 'LIVE';
  const gateLabel = `Gate ${liveGateScore.toFixed(1)} | MTAS ${reCheckGate.mtas.toFixed(0)}/10 | CS ${reCheckGate.compressionScore.toFixed(2)}`;
  const slBreakdown = formatStopLossBreakdown(stopLossPlan);
  const mainAlertMsg =
    `${modeEmoji} <b>[${modeLabel}] 매수 ${stockShadowMode ? '신호' : '주문'}${isFinalStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
    `종목: ${stock.name} (${stock.code})\n` +
    `현재가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isFinalStrongBuy ? ` (총${supplyAdjustedFinalQuantity}주)` : ''}\n` +
    `📊 ${gateLabel}\n` +
    `손절: ${slBreakdown} | 목표: ${stock.targetPrice.toLocaleString()}원`;

  const _rrr = stock.rrr;
  const _sector = stock.sector;
  if (diagnosticLiveBlockReason && !macroDiagnosticLiveBlock) {
    suppressDiagnosticLiveBuyTask(ctx, stock, diagnosticLiveBlockReason);
    return 'SKIP';
  }

  ctx.mutables.liveBuyQueue.push(await createBuyTask({
    trade, stockCode: stock.code, stockName: stock.name,
    currentPrice, quantity: execQty, entryPrice: shadowEntryPrice,
    stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
    gateScore, shadowMode: stockShadowMode, effectiveBudget: effectiveBudgetAfterHealth,
    alertMessage: mainAlertMsg,
    logEvent: isMomentumShadow ? 'MOMENTUM_SHADOW_SIGNAL' : (stockShadowMode ? 'SIGNAL' : 'ORDER'),
    signalId: buildSignalId(signalTimeMain, stock.code),
    tradeDate: shadowApprovalCtx.tradeDate,
    marketSession: shadowApprovalCtx.marketSession,
    sourceLane: 'SHADOW',
    rrr: _rrr,
    mtas: reCheckGate.mtas,
    compressionScore: reCheckGate.compressionScore,
    availableMaxScore: reCheckGate.availableMaxScore,
    gateLayerSummary: stock.gateLayerSummary,
    signalType: isFinalStrongBuy ? 'STRONG_BUY' : 'BUY',
    gateBandNormal: getRegimeGateBand(ctx.regime).normal,
    gateBandStrong: getRegimeGateBand(ctx.regime).strong,
    onApproved: async (t) => {
      ctx.shadows.push(t);
      // P3-1 (shadow-exec-singlepath): SHADOW paper-fill 은 5-event 정본 경로
      // (buyPipeline.executeShadowBuyOrder → shadowBuyExecutor.executeShadowBuy) 가 단독 수행.
      // 과거 여기 있던 executeShadowBuy 재호출은 항상 5-event 이후라 isAlreadyFilled no-op 이었음 → 제거.
      // 비-fill 부수효과(신호 카드/학습 ledger/분할매수)는 task-tracking 책임으로 유지.
      await channelBuySignalEmitted({
        mode: stockShadowMode ? 'SHADOW' : 'LIVE', stockName: stock.name, stockCode: stock.code,
        price: currentPrice, quantity: execQty, gateScore: liveGateScore,
        mtas: reCheckGate.mtas, cs: reCheckGate.compressionScore,
        stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
        rrr: _rrr ?? 0, signalType: isFinalStrongBuy ? 'STRONG_BUY' : 'BUY',
        sector: _sector,
      }).catch(console.error);

      try {
        recordUniverseEntries({
          stockCode: stock.code,
          stockName: stock.name,
          entryPrice: shadowEntryPrice,
          regime: ctx.regime,
          signalGrade: grade,
        });
      } catch (e) {
        console.warn(`[Ledger] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
      }

      if (isFinalStrongBuy && supplyAdjustedFinalQuantity > 1 && !isMomentumShadow) {
        trancheExecutor.scheduleTranches({
          parentTradeId: t.id, stockCode: stock.code, stockName: stock.name,
          totalQuantity: supplyAdjustedFinalQuantity, firstQuantity: execQty,
          entryPrice: shadowEntryPrice, stopLoss: stopLossPlan.hardStopLoss,
          targetPrice: stock.targetPrice,
        });
      }
    },
  }));

  applyApprovalReservation({
    mutables: ctx.mutables,
    isMomentumShadow,
    tier: tierDecision.tier,
    effectiveBudget: effectiveBudgetAfterHealth,
    stockCode: stock.code,
    stockSector: stock.sector,
  });
  return 'CONTINUE';
}
