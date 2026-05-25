/**
 * @responsibility ADR-0019 pre-breakout followthrough execution extracted from buyListLoop.
 */

import { verifyStockIncremental } from '../../../../data/dataVerificationIncremental.js';
import { buildEntryConditionScores } from '../../../../learning/entryConditionScores.js';
import { addRecommendation } from '../../../../learning/recommendationTracker.js';
import type { TradingSignal } from '../../../../learning/supplyHealthLearning.js';
import { isBlacklisted } from '../../../../persistence/blacklistRepo.js';
import { recordAiCandidate, buildSignalId } from '../../../../persistence/tradeSignalStatusRepo.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { REGIME_CONFIGS } from '../../../../../src/services/quant/regimeEngine.js';
import { getSectorByCode } from '../../../../screener/sectorMap.js';
import {
  buildBuyTrade,
  createBuyTask,
  type BuildBuyTradeParams,
} from '../../../buyPipeline.js';
import {
  buildStopLossPlan,
  formatStopLossBreakdown,
  isOpenShadowStatus,
} from '../../../entryEngine.js';
import { getRegimeGateBand } from '../../../gateConfig.js';
import {
  getAdaptiveProfitTargets,
  type SymbolExitContext,
} from '../helpers.js';
import type { BuyListLoopContext } from '../types.js';
import { preBreakoutFollowthroughBudget } from './preBreakoutFollowthroughBudget.js';

interface PreBreakoutSupplyHealthResult {
  blocked: boolean;
  shadowMode: boolean;
  finalQuantity: number;
  finalSignal: TradingSignal;
  healthDecision?: {
    dataConfidence?: number;
    dataQualityBucket?: BuildBuyTradeParams['dataQualityBucket'];
    wasDowngradedBySupplyHealth?: boolean;
    downgradeReasons?: string[];
  };
}

interface PreBreakoutFollowthroughInput {
  ctx: BuyListLoopContext;
  stock: WatchlistEntry;
  currentPrice: number;
  today: string;
  stockShadowMode: boolean;
  diagnosticLiveBlockReason?: string;
  macroDiagnosticLiveBlock: boolean;
  shadowApprovalCtx: {
    tradeDate: string;
    marketSession: 'PRE_OPEN' | 'REGULAR' | 'LUNCH_BREAK' | 'AFTER_HOURS' | 'CLOSED';
  };
  applyBuySupplyHealthPolicy: (params: {
    stockCode: string;
    stockName: string;
    currentPrice: number;
    rawSignal: TradingSignal;
    rawScore: number;
    requestedSize: number;
    shadowMode: boolean;
    ctx: BuyListLoopContext;
  }) => PreBreakoutSupplyHealthResult;
  suppressDiagnosticLiveBuyTask: (ctx: BuyListLoopContext, stock: WatchlistEntry, reason: string) => void;
}

export async function preBreakoutFollowthrough(
  input: PreBreakoutFollowthroughInput,
): Promise<'SKIP' | 'CONTINUE'> {
  const {
    ctx,
    stock,
    currentPrice,
    today,
    stockShadowMode,
    diagnosticLiveBlockReason,
    macroDiagnosticLiveBlock,
    shadowApprovalCtx,
    applyBuySupplyHealthPolicy,
    suppressDiagnosticLiveBuyTask,
  } = input;

  const activePreBreakout = ctx.shadows.find(
    s => s.stockCode === stock.code &&
      s.watchlistSource === 'PRE_BREAKOUT' &&
      isOpenShadowStatus(s.status),
  );
  if (!activePreBreakout) return 'CONTINUE';

  if (currentPrice >= stock.entryPrice) {
    const followAlreadyDone = ctx.shadows.some(
      s => s.stockCode === stock.code &&
        s.watchlistSource === 'PRE_BREAKOUT_FOLLOWTHROUGH' &&
        (isOpenShadowStatus(s.status) || s.signalTime.startsWith(today)),
    );
    if (!followAlreadyDone && !isBlacklisted(stock.code)) {
      const budget = await preBreakoutFollowthroughBudget(ctx, stock, currentPrice);
      if (budget === 'SKIP') return 'SKIP';
      const {
        followEntryPrice,
        gateScoreFollow,
        reCheckGateFollow,
        reCheckQuoteFollow,
        posPctFollow,
        fullQty,
        followQty,
        sizingSourceFollow,
        sizingEngineSnapshotFollow,
      } = budget;
      const followHealth = applyBuySupplyHealthPolicy({
        stockCode: stock.code,
        stockName: stock.name,
        currentPrice,
        rawSignal: 'STRONG_BUY',
        rawScore: gateScoreFollow,
        requestedSize: followQty,
        shadowMode: ctx.shadowMode,
        ctx,
      });
      if (followHealth.blocked) return 'SKIP';
      const followFinalQty = followHealth.finalQuantity;
      if (followFinalQty < 1) return 'SKIP';

      const profile = stock.profileType ?? 'B';
      const profileKey = `profile${profile}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
      const regimeStopRate = REGIME_CONFIGS[ctx.regime].stopLoss[profileKey];
      const followATR14 = reCheckQuoteFollow?.atr ?? 0;
      const stopLossPlan = buildStopLossPlan({
        entryPrice: followEntryPrice,
        fixedStopLoss: stock.stopLoss,
        regimeStopRate,
        atr14: followATR14,
        regime: ctx.regime,
      });
      const followSymbolCtx: SymbolExitContext = {
        profileType: stock.section === 'CATALYST' ? 'CATALYST' : 'LEADER',
        sector: stock.sector,
        watchlistSource: 'PRE_BREAKOUT_FOLLOWTHROUGH',
      };
      const adaptiveFollowProfitTargets = getAdaptiveProfitTargets(ctx.regime, ctx.macroState, followSymbolCtx);
      const limitTranches = adaptiveFollowProfitTargets.targets.filter(t => t.type === 'LIMIT' && t.trigger !== null);
      const trailTarget = adaptiveFollowProfitTargets.targets.find(t => t.type === 'TRAILING');
      const followTrade = buildBuyTrade({
        idPrefix: 'srv_pbf', stockCode: stock.code, stockName: stock.name,
        currentPrice, shadowEntryPrice: followEntryPrice, quantity: followFinalQty,
        stopLossPlan, targetPrice: stock.targetPrice, shadowMode: followHealth.shadowMode, regime: ctx.regime,
        profileType: profile, watchlistSource: 'PRE_BREAKOUT_FOLLOWTHROUGH',
        profitTranches: limitTranches.map(t => ({ price: followEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false })),
        trailPct: Math.max(0.05, Math.min(0.14, (trailTarget?.trailPct ?? 0.10) + adaptiveFollowProfitTargets.trailPctAdjust)), entryATR14: followATR14,
        // ADR-0006 PR-19 baseline (PR-1) — entryConditionScores 영속.
        entryConditionScores: buildEntryConditionScores(['PRE_BREAKOUT_FOLLOWTHROUGH']),
        sizingSource: sizingSourceFollow, sizingEngineSnapshot: sizingEngineSnapshotFollow,
        rawSignal: 'STRONG_BUY',
        finalSignal: followHealth.finalSignal,
        dataConfidence: followHealth.healthDecision?.dataConfidence,
        dataQualityBucket: followHealth.healthDecision?.dataQualityBucket,
        supplyHealthSnapshot: ctx.supplyHealthSnapshot,
        wasDowngradedBySupplyHealth: followHealth.healthDecision?.wasDowngradedBySupplyHealth,
        downgradeReasons: followHealth.healthDecision?.downgradeReasons,
      });

      ctx.shadows.push(followTrade);

      let _verifyOkFollow = true;
      try {
        const _verifyResultFollow = await verifyStockIncremental(stock.code, 'BUY_CANDIDATE');
        if (!_verifyResultFollow.verified && _verifyResultFollow.action?.blockBuy) {
          _verifyOkFollow = false;
          console.log(`[AutoTrade] ${stock.name}(${stock.code}) → DATA_HOLD / ${_verifyResultFollow.reason} / ${_verifyResultFollow.source}`);
        }
      } catch (err) {
        console.warn(`[AutoTrade] verifyStockIncremental error (안전 통과): ${stock.code} — ${(err as Error).message}`);
      }
      if (!_verifyOkFollow) return 'SKIP';

      const _signalTimeFollow = new Date().toISOString();
      addRecommendation({
        stockCode: stock.code, stockName: stock.name, signalTime: _signalTimeFollow,
        priceAtRecommend: currentPrice, stopLoss: stopLossPlan.hardStopLoss,
        targetPrice: stock.targetPrice, kellyPct: Math.round(posPctFollow * 100),
        gateScore: gateScoreFollow, signalType: 'BUY',
        conditionKeys: ['PRE_BREAKOUT_FOLLOWTHROUGH'], entryRegime: ctx.regime,
      });
      try {
        recordAiCandidate({
          signalTimeIso: _signalTimeFollow,
          stockCode: stock.code,
          stockName: stock.name,
          recommendationType: 'BUY',
          signalGateScore: gateScoreFollow,
          reason: '선취매 추종 BUY 진입 후보',
        });
      } catch (e) {
        console.warn('[TradeSignalStatus] PRE_BREAKOUT_FOLLOWTHROUGH recordAiCandidate failed', e);
      }

      const alertMsg =
        `🚀 <b>[선취매 추종] ${stock.name} (${stock.code})</b>\n` +
        `돌파 확인 @${currentPrice.toLocaleString()}원 — 나머지 70% 집행\n` +
        `주문가: ${followEntryPrice.toLocaleString()}원 × ${followFinalQty}주\n` +
        `손절: ${formatStopLossBreakdown(stopLossPlan)} | 목표: ${stock.targetPrice.toLocaleString()}원`;

      if (diagnosticLiveBlockReason && !macroDiagnosticLiveBlock) {
        suppressDiagnosticLiveBuyTask(ctx, stock, diagnosticLiveBlockReason);
        return 'SKIP';
      }

      ctx.mutables.liveBuyQueue.push(await createBuyTask({
        trade: followTrade, stockCode: stock.code, stockName: stock.name,
        currentPrice, quantity: followFinalQty, entryPrice: followEntryPrice,
        stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
        gateScore: gateScoreFollow, shadowMode: macroDiagnosticLiveBlock ? true : followHealth.shadowMode, effectiveBudget: followFinalQty * followEntryPrice,
        alertMessage: alertMsg, logEvent: 'PRE_BREAKOUT_FOLLOWTHROUGH',
        signalId: buildSignalId(_signalTimeFollow, stock.code),
        tradeDate: shadowApprovalCtx.tradeDate,
        marketSession: shadowApprovalCtx.marketSession,
        sourceLane: 'SHADOW',
        rrr: stock.rrr,
        mtas: reCheckGateFollow?.mtas,
        compressionScore: reCheckGateFollow?.compressionScore,
        availableMaxScore: reCheckGateFollow?.availableMaxScore,
        gateLayerSummary: reCheckGateFollow?.gateLayerSummary,
        signalType: 'PRE_BREAKOUT_FOLLOWTHROUGH',
        gateBandNormal: getRegimeGateBand(ctx.regime).normal,
        gateBandStrong: getRegimeGateBand(ctx.regime).strong,
        onApproved: async () => {
          ctx.mutables.orderableCash.value = Math.max(0, ctx.mutables.orderableCash.value - followFinalQty * followEntryPrice);
          // P3-1 (shadow-exec-singlepath): PRE_BREAKOUT_FOLLOWTHROUGH SHADOW paper-fill 은 5-event 정본 경로
          // (buyPipeline.executeShadowBuyOrder → shadowBuyExecutor.executeShadowBuy) 가 단독 수행.
          // 과거 여기 있던 executeShadowBuy 재호출은 항상 5-event 이후라 isAlreadyFilled no-op 이었음 → 제거.
          // cash 차감은 task-tracking 책임으로 유지.
        },
      }));
      ctx.mutables.reservedSlots.value++;
      ctx.mutables.reservedTiers.push('OTHER');
      const _sec = stock.sector || getSectorByCode(stock.code) || '미분류';
      const _val = followFinalQty * followEntryPrice;
      ctx.mutables.pendingSectorValue.set(_sec, (ctx.mutables.pendingSectorValue.get(_sec) ?? 0) + _val);
      ctx.mutables.reservedSectorValues.push({ sector: _sec, value: _val });
    } else {
      console.log(`[PreBreakout] ${stock.name}(${stock.code}) 추종 매수 이미 실행됨 — 스킵`);
    }
  } else {
    console.log(`[PreBreakout] ${stock.name}(${stock.code}) 선취매 보유 중 @${activePreBreakout.shadowEntryPrice.toLocaleString()} — 돌파 대기`);
  }

  return 'SKIP';
}
