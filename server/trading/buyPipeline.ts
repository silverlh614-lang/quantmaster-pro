// @responsibility buyPipeline 매매 엔진 모듈
/**
 * buyPipeline.ts — 매수 실행 파이프라인 공통 헬퍼
 */

import type { ServerShadowTrade, EntryKellySnapshot } from '../persistence/shadowTradeRepo.js';
import type {
  DataQualityBucket,
  SupplyHealthSnapshot,
  TradingSignal,
} from '../learning/supplyHealthLearning.js';
import type { ApprovalAction, BuyApprovalRequestResult } from '../telegram/buyApproval.js';
import type { EnemyCheckResult } from '../clients/enemyCheckClient.js';
import type { StopLossPlan } from './entryEngine.js';
import { fetchYahooQuote, fetchKisQuoteFallback, type YahooQuoteExtended } from '../screener/stockScreener.js';
import { fetchYahooQuoteByCode } from '../screener/adapters/yahooSymbolResolver.js';
import { fetchKisInvestorTradeByStockDaily } from '../clients/kisClient.js';
import type { KisInvestorTradeByStockDaily } from '../clients/kisClient/types.js';
import { getDartFinancials } from '../clients/dartFinancialClient.js';
import { evaluateServerGate, type ServerGateResult } from '../quantFilter.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { computeEtfSectorBoost } from '../alerts/globalScanAgent.js';
import { getSectorByCode } from '../screener/sectorMap.js';
import { generatePreMortem } from './entryEngine.js';
import { buildPreMortemStructured } from './preMortemStructured.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { requestBuyApprovalWithDelivery } from '../telegram/buyApproval.js';
import type { TradeSignalBlockGate } from '../persistence/tradeSignalStatusRepo.js';
import { fetchEnemyCheckData } from '../clients/enemyCheckClient.js';
import { evaluateEnemyAutoBlock } from './enemyAutoBlock.js';
import { appendShadowLog } from '../persistence/shadowTradeRepo.js';
import { getLatestIncidentAt } from '../persistence/incidentLogRepo.js';
import { isEmergencyBuyPipelineCodeGuardEnabled } from '../dataQuality/emergencyDataQualityGuards.js';
import { normalizeKrxCode } from '../utils/symbolNormalizer.js';
import { lastManualExitAtForCode } from '../persistence/manualExitsRepo.js';
import {
  decideOrderType,
  isOrderTypeOptimizerEnabled,
} from './orderTypeOptimizer.js';
import { createBuySignalStateMachine, type BuySignalStateMachine } from './buy/buySignalStateMachine.js';
import { resolveBuyApprovalPolicy, type BuyApprovalPolicyResult } from './buy/buyApprovalPolicy.js';
import {
  buyIdempotencyGuard,
  logBuyDuplicateBlocked,
  type BuyIdempotencyRecord,
} from './buy/buyIdempotencyGuard.js';
import { executeLiveBuy } from './buy/liveBuyExecutor.js';
import { executeShadowBuyOrder } from './buy/shadowBuyExecutor.js';
import { markBlocked as writeSignalBlocked, markRejected as writeSignalRejected } from './buy/tradeSignalStatusWriter.js';
import { emitOperationalWarn } from './buy/operationalWarn.js';

export const MANUAL_EXIT_REBUY_COOLDOWN_MS = 72 * 60 * 60 * 1000;

export interface ManualExitCooldownResult {
  blocked: boolean;
  lastExitAt?: string;
  remainingMs?: number;
  remainingHours?: number;
}

export function checkManualExitCooldown(
  stockCode: string,
  now = new Date(),
): ManualExitCooldownResult {
  const lastExitAt = lastManualExitAtForCode(stockCode, now);
  if (!lastExitAt) return { blocked: false };
  const elapsed = now.getTime() - new Date(lastExitAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed >= MANUAL_EXIT_REBUY_COOLDOWN_MS) {
    return { blocked: false, lastExitAt };
  }
  const remainingMs = MANUAL_EXIT_REBUY_COOLDOWN_MS - elapsed;
  return {
    blocked: true,
    lastExitAt,
    remainingMs,
    remainingHours: Math.ceil(remainingMs / (60 * 60 * 1000)),
  };
}

export function computeMtasMultiplier(mtas: number): number {
  if (mtas >= 10) return 1.15;
  if (mtas >= 7) return 1.0;
  if (mtas > 3) return 0.5;
  return 0.3;
}

export function computeRawPositionPct(gateScore: number): number {
  if (gateScore >= 9) return 0.12;
  if (gateScore >= 7) return 0.08;
  if (gateScore >= 5) return 0.05;
  return 0.03;
}

export interface GateData {
  quote: YahooQuoteExtended | null;
  gate: ServerGateResult | null;
  kisFlow: KisInvestorTradeByStockDaily | null;
}

export async function fetchGateData(
  stockCode: string,
  conditionWeights?: ReturnType<typeof loadConditionWeights>,
  kospi20dReturn?: number,
): Promise<GateData> {
  const weights = conditionWeights ?? loadConditionWeights();
  const quote = await fetchYahooQuoteByCode(stockCode, fetchYahooQuote)
             ?? await fetchKisQuoteFallback(stockCode).catch(() => null);

  if (!quote) return { quote: null, gate: null, kisFlow: null };

  const [kisFlow, dartFin] = await Promise.all([
    fetchKisInvestorTradeByStockDaily(stockCode).catch(() => null),
    getDartFinancials(stockCode).catch(() => null),
  ]);

  const macroState = loadMacroState();
  const gate = evaluateServerGate(
    quote, weights, kospi20dReturn ?? macroState?.kospi20dReturn, dartFin, kisFlow,
  );

  const etfBoost = computeEtfSectorBoost(getSectorByCode(stockCode));
  if (etfBoost.boost > 0) {
    gate.gateScore += etfBoost.boost;
    gate.details.push(...etfBoost.reasons);
  }

  return { quote, gate, kisFlow };
}

export interface BuildBuyTradeParams {
  idPrefix: string;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  shadowEntryPrice: number;
  quantity: number;
  originalQuantity?: number;
  stopLossPlan: StopLossPlan;
  targetPrice: number;
  shadowMode: boolean;
  regime: string;
  profileType: 'A' | 'B' | 'C' | 'D';
  watchlistSource: ServerShadowTrade['watchlistSource'];
  profitTranches: { price: number; ratio: number; taken: boolean }[];
  trailPct: number;
  entryATR14?: number;
  entryKellySnapshot?: EntryKellySnapshot;
  entryConditionScores?: Record<number, number>;
  sizingSource?: 'NEW_TIER_ENGINE' | 'LEGACY_SSOT' | 'LIVE_SIZING_MIRROR';
  sizingEngineSnapshot?: ServerShadowTrade['sizingEngineSnapshot'];
  rawSignal?: TradingSignal;
  finalSignal?: TradingSignal;
  dataConfidence?: number;
  dataQualityBucket?: DataQualityBucket;
  supplyHealthSnapshot?: SupplyHealthSnapshot;
  wasDowngradedBySupplyHealth?: boolean;
  downgradeReasons?: string[];
}

export function buildBuyTrade(p: BuildBuyTradeParams): ServerShadowTrade {
  const latestIncident = getLatestIncidentAt();
  const sector = getSectorByCode(p.stockCode) || undefined;
  return {
    id:                    `${p.idPrefix}_${Date.now()}_${p.stockCode}`,
    stockCode:             p.stockCode,
    stockName:             p.stockName,
    signalTime:            new Date().toISOString(),
    signalPrice:           p.currentPrice,
    shadowEntryPrice:      p.shadowEntryPrice,
    entryPriceRaw:         p.shadowEntryPrice,
    cumulativeAdjustmentFactor: 1.0,
    quantity:              p.quantity,
    originalQuantity:      p.originalQuantity ?? p.quantity,
    stopLoss:              p.stopLossPlan.hardStopLoss,
    initialStopLoss:       p.stopLossPlan.initialStopLoss,
    regimeStopLoss:        p.stopLossPlan.regimeStopLoss,
    hardStopLoss:          p.stopLossPlan.hardStopLoss,
    targetPrice:           p.targetPrice,
    status:                'PENDING',
    mode:                  p.shadowMode ? 'SHADOW' : 'LIVE',
    sector,
    entryRegime:           p.regime,
    profileType:           p.profileType,
    watchlistSource:       p.watchlistSource,
    profitTranches:        p.profitTranches,
    trailingHighWaterMark: p.shadowEntryPrice,
    trailPct:              p.trailPct,
    trailingEnabled:       false,
    entryATR14:            p.entryATR14 || undefined,
    dynamicStopPrice:      p.stopLossPlan.dynamicStopLoss,
    ...(latestIncident ? { incidentFlag: latestIncident } : {}),
    ...(p.entryKellySnapshot ? { entryKellySnapshot: p.entryKellySnapshot } : {}),
    ...(p.entryConditionScores && Object.keys(p.entryConditionScores).length > 0
      ? { entryConditionScores: p.entryConditionScores }
      : {}),
    ...(p.sizingSource ? { sizingSource: p.sizingSource } : {}),
    ...(p.sizingEngineSnapshot ? { sizingEngineSnapshot: p.sizingEngineSnapshot } : {}),
    ...(p.rawSignal ? { rawSignal: p.rawSignal } : {}),
    ...(p.finalSignal ? { finalSignal: p.finalSignal } : {}),
    ...(p.dataConfidence !== undefined ? { dataConfidence: p.dataConfidence } : {}),
    ...(p.dataQualityBucket ? { dataQualityBucket: p.dataQualityBucket } : {}),
    ...(p.supplyHealthSnapshot ? { supplyHealthSnapshot: p.supplyHealthSnapshot } : {}),
    ...(p.wasDowngradedBySupplyHealth !== undefined ? { wasDowngradedBySupplyHealth: p.wasDowngradedBySupplyHealth } : {}),
    ...(p.downgradeReasons ? { downgradeReasons: p.downgradeReasons } : {}),
  };
}

export type LiveBuyTask = {
  approvalPromise: Promise<ApprovalAction>;
  execute: (a: ApprovalAction) => Promise<void>;
};

export interface CreateBuyTaskParams {
  trade: ServerShadowTrade;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  gateScore: number;
  shadowMode: boolean;
  effectiveBudget: number;
  onApproved: (trade: ServerShadowTrade, ordNo: string | null) => Promise<void>;
  onRejected?: (trade: ServerShadowTrade, action: ApprovalAction) => void;
  alertMessage: string;
  logEvent: string;
  regime?: string;
  preMortem?: string | null;
  signalId?: string;
  volumeZ?: number;
  priceMomentumPct?: number;
  tradeDate?: string;
  marketSession?: string;
  sourceLane?: 'SHADOW' | 'DECISION_BROKER' | 'PROVISIONAL' | 'COUNTERFACTUAL';
  rrr?: number;
  mtas?: number;
  compressionScore?: number;
  signalType?: string;
  gateBandNormal?: number;
  gateBandStrong?: number;
}

function rejectBuyTask(
  p: CreateBuyTaskParams,
  action: ApprovalAction = 'SKIP',
): LiveBuyTask {
  return {
    approvalPromise: Promise.resolve<ApprovalAction>(action),
    execute: async () => {
      p.trade.status = 'REJECTED';
      p.onRejected?.(p.trade, action);
    },
  };
}

function appendShadowLogSafe(
  entry: Parameters<typeof appendShadowLog>[0],
  context: Record<string, unknown>,
): void {
  try {
    appendShadowLog(entry);
  } catch (e) {
    emitOperationalWarn({
      code: 'P2_BUY_SHADOW_LOG_WRITE_FAILED',
      severity: 'P2',
      message: 'buyPipeline shadow log write failed; execution flow continues',
      context,
      cause: e,
    });
  }
}

function markSignalBlockedSafe(signalId: string | undefined, gate: TradeSignalBlockGate, reason: string): void {
  writeSignalBlocked({
    signalId,
    gate,
    reason,
  });
}

function applyOrderTypeDecisionIfEnabled(p: CreateBuyTaskParams): void {
  if (!isOrderTypeOptimizerEnabled()) return;
  try {
    const decision = decideOrderType({
      stockCode: p.stockCode,
      volumeZ: p.volumeZ,
      priceMomentumPct: p.priceMomentumPct,
    });
    p.trade.orderTypeDecision = {
      orderType: decision.orderType,
      reason: decision.reason,
      limitOffsetTicks: decision.limitOffsetTicks,
      chasePolicy: decision.chasePolicy,
      decidedAt: new Date().toISOString(),
    };
    console.log(
      `[OrderTypeOptimizer] ${p.stockName}(${p.stockCode}) → ${decision.orderType} — ${decision.reason} (ADR-0186, SHADOW-only 가시화)`,
    );
  } catch (e) {
    emitOperationalWarn({
      code: 'P2_BUY_ORDER_TYPE_OPTIMIZER_FAILED',
      severity: 'P2',
      message: 'Order type optimizer failed; default buy flow continues',
      context: { stockCode: p.stockCode, stockName: p.stockName, mode: p.shadowMode ? 'SHADOW' : 'LIVE' },
      cause: e,
    });
  }
}

function rejectForManualExitCooldown(
  p: CreateBuyTaskParams,
  cooldown: ManualExitCooldownResult,
): LiveBuyTask {
  console.warn(
    `[BuyPipeline] ${p.stockName}(${p.stockCode}) 72h 재매수 냉각 차단 — ` +
    `마지막 수동 청산: ${cooldown.lastExitAt}, 잔여 ${cooldown.remainingHours}h`,
  );
  appendShadowLogSafe({
    event: 'BUY_BLOCKED_MANUAL_EXIT_COOLDOWN',
    code: p.stockCode,
    price: p.currentPrice,
    lastExitAt: cooldown.lastExitAt,
    remainingHours: cooldown.remainingHours,
  }, {
    tradeId: p.trade.id,
    stockCode: p.stockCode,
    event: 'BUY_BLOCKED_MANUAL_EXIT_COOLDOWN',
  });
  p.trade.status = 'REJECTED';
  sendTelegramAlert(
    `🔒 <b>[재매수 냉각]</b> ${p.stockName}(${p.stockCode})\n` +
    `최근 수동 청산 후 ${cooldown.remainingHours}h 동안 재매수 차단 — 반복 편향 방지 룰.`,
    { category: 'manual_exit_cooldown', dedupeKey: `cooldown:${p.stockCode}:${cooldown.lastExitAt}` },
  ).catch(() => { /* noop */ });
  return {
    approvalPromise: Promise.resolve<ApprovalAction>('SKIP'),
    execute: async () => {
      p.onRejected?.(p.trade, 'SKIP');
    },
  };
}

async function buildPreApprovalContext(
  p: CreateBuyTaskParams,
  regime: string | undefined,
  sector: string,
): Promise<{ enemyCheck: EnemyCheckResult | null; preMortem: string | null }> {
  const [enemyCheck, preMortem] = await Promise.all([
    fetchEnemyCheckData(p.stockCode).catch(() => null),
    p.preMortem !== undefined
      ? Promise.resolve(p.preMortem)
      : generatePreMortem({
          stockCode:   p.stockCode,
          stockName:   p.stockName,
          entryPrice:  p.entryPrice,
          stopLoss:    p.stopLoss,
          targetPrice: p.targetPrice,
          regime,
          sector,
        }).catch(() => null),
  ]);
  return { enemyCheck, preMortem };
}

function applyPreMortemFields(
  p: CreateBuyTaskParams,
  preMortem: string | null,
  regime: string | undefined,
  sector: string,
): void {
  if (preMortem) {
    p.trade.preMortem = preMortem;
  }

  if (!p.trade.preMortemStructured) {
    p.trade.preMortemStructured = buildPreMortemStructured({
      entryPrice: p.entryPrice,
      targetPrice: p.targetPrice,
      stopLoss: p.stopLoss,
      regime: p.trade.entryRegime ?? regime ?? 'R4_NEUTRAL',
      sector,
      gateScore: p.gateScore,
      atr14: p.trade.entryATR14,
      profileType: p.trade.profileType,
      profitTrancheCount: p.trade.profitTranches?.length ?? 0,
    });
  }
}

function requestApprovalForBuyTask(
  p: CreateBuyTaskParams,
  enemyCheck: EnemyCheckResult | null,
  preMortem: string | null,
  regime: string | undefined,
): Promise<BuyApprovalRequestResult> {
  return requestBuyApprovalWithDelivery({
    tradeId:     p.trade.id,
    stockCode:   p.stockCode,
    stockName:   p.stockName,
    currentPrice: p.currentPrice,
    quantity:    p.quantity,
    stopLoss:    p.stopLoss,
    targetPrice: p.targetPrice,
    mode:        p.shadowMode ? 'SHADOW' : 'LIVE',
    gateScore:   p.gateScore,
    enemyCheck,
    regime,
    preMortem,
    signalId:    p.signalId,
    tradeDate:    p.tradeDate,
    marketSession: p.marketSession,
    sourceLane:   p.sourceLane,
    rrr:          p.rrr,
    mtas:         p.mtas,
    compressionScore: p.compressionScore,
    signalType:   p.signalType,
    gateBandNormal: p.gateBandNormal,
    gateBandStrong: p.gateBandStrong,
  });
}

function alignTradeModeWithTaskShadowMode(p: CreateBuyTaskParams): void {
  if (!p.shadowMode || p.trade.mode === 'SHADOW') return;
  const previousMode = p.trade.mode ?? 'undefined';
  p.trade.mode = 'SHADOW';
  emitOperationalWarn({
    code: 'P2_BUY_SHADOW_MODE_ALIGNED',
    severity: 'P2',
    message: 'Buy task shadowMode=true but trade.mode was not SHADOW; aligned before execution',
    context: {
      tradeId: p.trade.id,
      stockCode: p.stockCode,
      previousMode,
    },
  });
  appendShadowLogSafe({
    event: 'SHADOW_MODE_ALIGNED',
    code: p.stockCode,
    tradeId: p.trade.id,
    previousMode,
    reason: 'buy task shadowMode=true',
  }, {
    tradeId: p.trade.id,
    stockCode: p.stockCode,
    event: 'SHADOW_MODE_ALIGNED',
  });
}

function buildBuyTaskStrategy(p: CreateBuyTaskParams): string {
  return p.sourceLane ?? p.signalType ?? p.trade.profileType ?? 'DEFAULT';
}

function buildBuyTaskSession(p: CreateBuyTaskParams): string {
  return p.marketSession ?? p.tradeDate ?? 'UNKNOWN_SESSION';
}

function rejectApprovedLifecycle(
  p: CreateBuyTaskParams,
  stateMachine: BuySignalStateMachine,
  approval: ApprovalAction,
  reason: string,
  reservation?: BuyIdempotencyRecord,
): void {
  const modeState = p.shadowMode ? 'SHADOW_REJECTED' : 'LIVE_REJECTED';
  stateMachine.transition(modeState, reason);
  p.trade.status = 'REJECTED';
  writeSignalRejected({
    signalId: p.signalId,
    reason,
    gate: approval === 'REJECT' ? 'USER_REJECT' : 'OTHER',
    important: false,
  });
  if (reservation) buyIdempotencyGuard.release(reservation.key, 'REJECTED');
  p.onRejected?.(p.trade, approval);
}

async function emitApprovalSideEffects(
  p: CreateBuyTaskParams,
  ordNo: string | null,
): Promise<void> {
  await sendTelegramAlert(p.alertMessage).catch((error) => {
    emitOperationalWarn({
      code: 'P2_BUY_APPROVAL_ALERT_DELIVERY_FAILED',
      severity: 'P2',
      message: 'Buy approval side-effect alert delivery failed',
      context: {
        tradeId: p.trade.id,
        stockCode: p.stockCode,
        shadowMode: p.shadowMode,
      },
      cause: error,
    });
  });
  await p.onApproved(p.trade, ordNo);
}

function describeExecutionError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function executeBuyTaskApproval(
  p: CreateBuyTaskParams,
  approval: ApprovalAction,
  stateMachine: BuySignalStateMachine,
  approvalResultPromise: Promise<BuyApprovalRequestResult>,
  reservation?: BuyIdempotencyRecord,
): Promise<void> {
  let approvalResult: BuyApprovalRequestResult = {
    action: approval,
    telegramDelivered: true,
  };
  try {
    approvalResult = await approvalResultPromise;
  } catch (error) {
    approvalResult = {
      action: 'SKIP',
      telegramDelivered: false,
      deliveryFailureReason: `BUY_APPROVAL_REQUEST_FAILED: ${describeExecutionError(error)}`,
    };
  }

  const policy: BuyApprovalPolicyResult = resolveBuyApprovalPolicy({
    mode: p.shadowMode ? 'SHADOW' : 'LIVE',
    action: approval,
    telegramDelivered: approvalResult.telegramDelivered,
    deliveryFailureReason: approvalResult.deliveryFailureReason,
    approvalDecision: approvalResult.approvalDecision,
    normalizedApproval: approvalResult.normalizedApproval,
  });

  if (!policy.executionAllowed) {
    const modeLabel = p.shadowMode ? 'SHADOW' : 'LIVE';
    console.log(`[BuyPipeline ${modeLabel}] ${p.stockName} buy ${approval} skipped: ${policy.reason}`);
    rejectApprovedLifecycle(
      p,
      stateMachine,
      policy.normalizedAction,
      policy.reason,
      reservation,
    );
    stateMachine.assertSettled({ mode: p.shadowMode ? 'SHADOW' : 'LIVE', reason: policy.reason });
    return;
  }

  stateMachine.transition('APPROVED', policy.reason);

  try {
    if (p.shadowMode) {
      const result = await executeShadowBuyOrder({
        trade: p.trade,
        stockCode: p.stockCode,
        stockName: p.stockName,
        currentPrice: p.currentPrice,
        entryPrice: p.entryPrice,
        logEvent: p.logEvent,
        signalId: p.signalId,
        approvalPolicy: policy,
        stateMachine,
      });
      if (result.outcome === 'SHADOW_POSITION_OPENED') {
        if (reservation) buyIdempotencyGuard.markOpen(reservation.key);
        await emitApprovalSideEffects(p, null);
      } else {
        if (reservation) buyIdempotencyGuard.release(reservation.key, 'REJECTED');
        p.onRejected?.(p.trade, 'SKIP');
      }
      return;
    }

    const result = await executeLiveBuy({
      trade: p.trade,
      stockCode: p.stockCode,
      stockName: p.stockName,
      quantity: p.quantity,
      entryPrice: p.entryPrice,
      stopLoss: p.stopLoss,
      currentPrice: p.currentPrice,
      logEvent: p.logEvent,
      signalId: p.signalId,
      approvalPolicy: policy,
      stateMachine,
    });
    if (result.outcome === 'LIVE_ORDER_SUBMITTED') {
      if (reservation) buyIdempotencyGuard.markOpen(reservation.key);
      await emitApprovalSideEffects(p, result.ordNo);
    } else {
      if (reservation) buyIdempotencyGuard.release(reservation.key, 'REJECTED');
      p.onRejected?.(p.trade, 'SKIP');
    }
  } catch (error) {
    stateMachine.transition('FAILED', `BUY_EXECUTOR_THROW: ${describeExecutionError(error)}`);
    p.trade.status = 'REJECTED';
    if (reservation) buyIdempotencyGuard.release(reservation.key, 'REJECTED');
    emitOperationalWarn({
      code: p.shadowMode ? 'P0_SHADOW_EXECUTION_STUCK' : 'P0_LIVE_EXECUTION_STUCK',
      message: 'BUY executor threw before returning a normalized lifecycle result',
      context: {
        tradeId: p.trade.id,
        stockCode: p.stockCode,
        shadowMode: p.shadowMode,
        state: stateMachine.state,
      },
      cause: error,
    });
    p.onRejected?.(p.trade, 'SKIP');
  } finally {
    stateMachine.assertSettled({
      mode: p.shadowMode ? 'SHADOW' : 'LIVE',
      reason: 'buy task execution completed',
    });
  }
}

export async function createBuyTask(p: CreateBuyTaskParams): Promise<LiveBuyTask> {
  const regime = p.regime ?? p.trade.entryRegime;
  const sector = getSectorByCode(p.stockCode);
  const mode = p.shadowMode ? 'SHADOW' : 'LIVE';
  const stateMachine = createBuySignalStateMachine({
    tradeId: p.trade.id,
    stockCode: p.stockCode,
    stockName: p.stockName,
    mode,
  });
  alignTradeModeWithTaskShadowMode(p);

  if (isEmergencyBuyPipelineCodeGuardEnabled() && !normalizeKrxCode(p.stockCode).valid) {
    console.warn(
      `[BuyPipeline/CodeGuard] invalid KRX code 자동 SKIP — code="${p.stockCode}" name="${p.stockName}" (ADR-0185)`,
    );
    markSignalBlockedSafe(p.signalId, 'DATA', `INVALID_KRX_CODE: ${p.stockCode}`);
    return rejectBuyTask(p);
  }

  applyOrderTypeDecisionIfEnabled(p);

  const cooldown = checkManualExitCooldown(p.stockCode);
  if (cooldown.blocked) {
    return rejectForManualExitCooldown(p, cooldown);
  }

  const { enemyCheck, preMortem } = await buildPreApprovalContext(p, regime, sector);

  const enemyDecision = evaluateEnemyAutoBlock(enemyCheck);
  if (enemyDecision.shouldBlock) {
    console.warn(
      `[BuyPipeline] ${p.stockName}(${p.stockCode}) ENEMY 자동 차단 — ${enemyDecision.reason}`,
    );
    markSignalBlockedSafe(p.signalId, 'ENEMY', enemyDecision.reason);
    return rejectBuyTask(p);
  }

  applyPreMortemFields(p, preMortem, regime, sector);
  const reservation = buyIdempotencyGuard.reserve({
    mode,
    symbol: p.stockCode,
    strategy: buildBuyTaskStrategy(p),
    session: buildBuyTaskSession(p),
    side: 'BUY',
    tradeId: p.trade.id,
    signalId: p.signalId,
  });
  if (!reservation.allowed) {
    stateMachine.transition('DUPLICATE_BLOCKED', 'pending/open buy signal already exists', {
      dedupKey: reservation.key,
    });
    logBuyDuplicateBlocked(reservation.existing ?? reservation.record);
    return rejectBuyTask(p, 'SKIP');
  }

  stateMachine.transition('APPROVAL_REQUESTED', 'buy approval requested', {
    dedupKey: reservation.key,
  });
  const approvalResultPromise = Promise.resolve().then(() => requestApprovalForBuyTask(
    p,
    enemyCheck,
    preMortem,
    regime,
  ));
  return {
    approvalPromise: approvalResultPromise.then((result) => result.action),
    execute: (approval: ApprovalAction) => executeBuyTaskApproval(
      p,
      approval,
      stateMachine,
      approvalResultPromise,
      reservation.record,
    ),
  };
}
