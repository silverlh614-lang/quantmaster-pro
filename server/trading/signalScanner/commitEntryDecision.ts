// @responsibility evaluateBuyList commit 단계 SSOT 통합 헬퍼 — addRecommendation·승인 큐·예약 8필드

/**
 * commitEntryDecision.ts — ADR-0031 §"commit 단계 분리" 후속 (4번 아이디어).
 *
 * evaluateBuyList 의 잔여 commit 영역(라인 938-1037, ~100 LoC)을 단일 헬퍼로 byte-equivalent 추출.
 * sizingDeciders 가 모두 통과 + entryKellySnapshot 까지 결정된 후의 단계:
 *   1. profitTargets 계산 + buildBuyTrade
 *   2. addRecommendation (RecommendationTracker 기록)
 *   3. scanCounters.entries++ + setLastBuySignalAt + stageLog.buy + pushTrace
 *   4. alertMessage 합성 + ctx.mutables.liveBuyQueue.push (createBuyTask + onApproved 클로저)
 *   5. applyApprovalReservation (8필드 동시 갱신, PR-65 SSOT)
 *
 * 본 모듈 외부 mutation 표면: ctx.mutables.liveBuyQueue / ctx.mutables.{8 reservation fields} /
 * ctx.scanCounters.entries / stageLog / ctx.shadows (onApproved 클로저). 본 모듈 자체는
 * 새로운 부수효과를 만들지 않으며 — 인라인 블록과 byte-equivalent.
 */

import type { ServerShadowTrade, EntryKellySnapshot } from '../../persistence/shadowTradeRepo.js';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
import { channelBuySignalEmitted } from '../../alerts/channelPipeline.js';
import { addRecommendation } from '../../learning/recommendationTracker.js';
import { recordUniverseEntries } from '../../learning/ledgerSimulator.js';
import { trancheExecutor } from '../trancheExecutor.js';
import { buildBuyTrade, createBuyTask } from '../buyPipeline.js';
import { formatStopLossBreakdown } from '../entryEngine.js';
import { setLastBuySignalAt } from './scanDiagnostics.js';
import { applyApprovalReservation } from './approvalQueue/index.js';
import {
  getAdaptiveProfitTargets,
  type SymbolExitContext,
  type BuyListLoopContext,
} from './perSymbolEvaluation.js';
import type { StopLossPolicyOutput } from './sizingDeciders/stopLossPolicyResolver.js';
import type { SizingTier } from '../sizingTier.js';

export type StageLogValue = string;

/**
 * stageLog 의 형식은 perSymbolEvaluation 내부 closure 변수라 외부 타입을 명시할 수 없다.
 * `buy` 키만 갱신하므로 좁은 타입으로 받는다.
 */
export interface CommitEntryStageLog {
  buy?: StageLogValue;
  [key: string]: unknown;
}

export interface CommitEntryDecisionInput {
  ctx: BuyListLoopContext;
  stock: WatchlistEntry;
  stockShadowMode: boolean;
  isMomentumShadow: boolean;
  isStrongBuy: boolean;
  shadowEntryPrice: number;
  currentPrice: number;
  execQty: number;
  quantity: number;
  positionPct: number;
  gateScore: number;
  liveGateScore: number;
  reCheckGate: { mtas: number; compressionScore: number };
  effectiveBudget: number;
  entryKellySnapshot: EntryKellySnapshot;
  grade: 'STRONG_BUY' | 'BUY' | 'PROBING' | 'HOLD';
  stopPolicy: StopLossPolicyOutput;
  tierDecision: { tier: SizingTier };
  stageLog: CommitEntryStageLog;
  pushTrace: () => void;
}

/**
 * 메인 buyList 루프의 commit 단계 — sizingDeciders 통과 후 trade build → 승인 큐 등록 →
 * 슬롯·섹터·예산 예약을 단일 진입점으로 묶는다.
 *
 * 인라인 코드와 비교해 (a) 변수 캡처를 input 객체로 평탄화, (b) 외부 mutation 시퀀스 100% 동일,
 * (c) onApproved closure 의 sideeffect (ctx.shadows.push / channelBuySignalEmitted /
 * recordUniverseEntries / trancheExecutor.scheduleTranches) 도 byte-equivalent 보존.
 */
export async function commitEntryDecision(input: CommitEntryDecisionInput): Promise<void> {
  const {
    ctx, stock, stockShadowMode, isMomentumShadow, isStrongBuy,
    shadowEntryPrice, currentPrice, execQty, quantity, positionPct,
    gateScore, liveGateScore, reCheckGate, effectiveBudget,
    entryKellySnapshot, grade, stopPolicy, tierDecision, stageLog, pushTrace,
  } = input;
  const { profile, isCatalyst, stopLossPlan, entryATR14 } = stopPolicy;

  // L3 분할 익절 타겟 — PROFIT_TARGETS[ctx.regime]에서 LIMIT 트랜치 추출.
  // section (CATALYST/SWING) 과 ctx.watchlist 추적자(MOMENTUM = LEADER 추세) 에 따라
  // 익절 라인을 종목별로 차등 조정 (사용자 P1-1 의견 반영).
  const symbolProfile: SymbolExitContext = {
    profileType: isCatalyst ? 'CATALYST'
      : (stock.section === 'MOMENTUM' || stock.profileType === 'A') ? 'LEADER'
      : undefined,
    sector: stock.sector,
  };
  const adaptiveProfitTargets = getAdaptiveProfitTargets(ctx.regime, ctx.macroState, symbolProfile);
  // composite reason 을 로그에 노출 — Telegram 메시지에서 운영자가 조정 사유를 추적 가능.
  if (adaptiveProfitTargets.reason !== 'macro:기본') {
    console.log(`[ProfitTargets] ${stock.code} ${stock.name}: ${adaptiveProfitTargets.reason}`);
  }
  const limitTranches = adaptiveProfitTargets.targets.filter((t) => t.type === 'LIMIT' && t.trigger !== null);
  const trailTarget = adaptiveProfitTargets.targets.find((t) => t.type === 'TRAILING');

  const trade = buildBuyTrade({
    idPrefix: isMomentumShadow ? 'srv_mom_shadow' : 'srv',
    stockCode: stock.code, stockName: stock.name,
    currentPrice, shadowEntryPrice, quantity: execQty,
    stopLossPlan, targetPrice: stock.targetPrice, shadowMode: stockShadowMode, regime: ctx.regime,
    profileType: profile, watchlistSource: undefined,
    profitTranches: limitTranches.map((t) => ({
      price: shadowEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false,
    })),
    trailPct: Math.max(0.05, Math.min(0.14, (trailTarget?.trailPct ?? 0.10) + adaptiveProfitTargets.trailPctAdjust)), entryATR14,
    entryKellySnapshot,
  });

  addRecommendation({
    stockCode: stock.code, stockName: stock.name, signalTime: new Date().toISOString(),
    priceAtRecommend: currentPrice, stopLoss: stopLossPlan.hardStopLoss,
    targetPrice: stock.targetPrice, kellyPct: Math.round(positionPct * 100),
    gateScore, signalType: isStrongBuy ? 'STRONG_BUY' : 'BUY',
    conditionKeys: stock.conditionKeys ?? [], entryRegime: ctx.regime,
  });

  // ─── SHADOW/LIVE 통합 승인 큐 등록 ──────────────────────────────────────
  ctx.scanCounters.entries++;
  setLastBuySignalAt(Date.now());
  stageLog.buy = stockShadowMode ? 'SHADOW' : 'LIVE';
  pushTrace();

  const modeEmoji = stockShadowMode ? '⚡' : '🚀';
  const modeLabel = isMomentumShadow ? 'Shadow(학습)' : stockShadowMode ? 'Shadow' : 'LIVE';
  const gateLabel = `Gate ${liveGateScore.toFixed(1)} | MTAS ${reCheckGate.mtas.toFixed(0)}/10 | CS ${reCheckGate.compressionScore.toFixed(2)}`;
  const slBreakdown = formatStopLossBreakdown(stopLossPlan);
  const mainAlertMsg =
    `${modeEmoji} <b>[${modeLabel}] 매수 ${stockShadowMode ? '신호' : '주문'}${isStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
    `종목: ${stock.name} (${stock.code})\n` +
    `현재가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isStrongBuy ? ` (총${quantity}주)` : ''}\n` +
    `📊 ${gateLabel}\n` +
    `손절: ${slBreakdown} | 목표: ${stock.targetPrice.toLocaleString()}원`;

  const _rrr = stock.rrr, _sector = stock.sector;
  ctx.mutables.liveBuyQueue.push(await createBuyTask({
    trade, stockCode: stock.code, stockName: stock.name,
    currentPrice, quantity: execQty, entryPrice: shadowEntryPrice,
    stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
    gateScore, shadowMode: stockShadowMode, effectiveBudget,
    alertMessage: mainAlertMsg,
    logEvent: isMomentumShadow ? 'MOMENTUM_SHADOW_SIGNAL' : (stockShadowMode ? 'SIGNAL' : 'ORDER'),
    onApproved: async (t: ServerShadowTrade) => {
      ctx.shadows.push(t);
      await channelBuySignalEmitted({
        mode: stockShadowMode ? 'SHADOW' : 'LIVE', stockName: stock.name, stockCode: stock.code,
        price: currentPrice, quantity: execQty, gateScore: liveGateScore,
        mtas: reCheckGate.mtas, cs: reCheckGate.compressionScore,
        stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
        rrr: _rrr ?? 0, signalType: isStrongBuy ? 'STRONG_BUY' : 'BUY',
        sector: _sector,
      }).catch(console.error);

      // Idea 2 — Parallel Universe Ledger: 승인된 엔트리에 대해 A/B/C 3 세팅을 동시에 가상체결 기록.
      // 실 진입 = Universe A 와 동형. B/C 는 학습 표본. LIVE/Shadow 양쪽 모두 기록.
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

      // BUG #3 fix — ctx.mutables.orderableCash.value 는 큐 푸시 시점에 이미 예약/차감됨.
      // onApproved 에서는 "예약 확정" 만 수행 (추가 차감 없음).
      // ctx.mutables.reservedBudgets 는 그대로 두고, 롤백 경로만 참조.
      if (isStrongBuy && quantity > 1 && !isMomentumShadow) {
        // MOMENTUM Shadow 는 분할 매수 스케줄 제외 (진입 자체가 관찰 표본)
        trancheExecutor.scheduleTranches({
          parentTradeId: t.id, stockCode: stock.code, stockName: stock.name,
          totalQuantity: quantity, firstQuantity: execQty,
          entryPrice: shadowEntryPrice, stopLoss: stopLossPlan.hardStopLoss,
          targetPrice: stock.targetPrice,
        });
      }
    },
  }));
  // ── ADR-0031 PR-65: applyApprovalReservation commit 단계 SSOT ───────
  // 8개 mutable 필드 (reservedSlots / probingReservedSlots / reservedTiers /
  // reservedIsMomentum / reservedBudgets / orderableCash / pendingSectorValue /
  // reservedSectorValues) 동시 갱신을 단일 헬퍼로 캡슐화 — 슬롯 예약 롤백 SSOT.
  applyApprovalReservation({
    mutables: ctx.mutables,
    isMomentumShadow,
    tier: tierDecision.tier,
    effectiveBudget,
    stockCode: stock.code,
    stockSector: stock.sector,
  });
}
