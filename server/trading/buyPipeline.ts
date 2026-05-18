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
import type { ApprovalAction } from '../telegram/buyApproval.js';
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
import { placeKisMarketBuyOrder, fetchAccountBalance } from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelShadowBuyFilled } from '../alerts/channelPipeline.js';
import { requestBuyApproval } from '../telegram/buyApproval.js';
import { markAutoTradeReady, markBlocked } from '../persistence/tradeSignalStatusRepo.js';
import type { TradeSignalBlockGate } from '../persistence/tradeSignalStatusRepo.js';
import { fetchEnemyCheckData } from '../clients/enemyCheckClient.js';
import { evaluateEnemyAutoBlock } from './enemyAutoBlock.js';
import { fillMonitor } from './fillMonitor.js';
import { appendShadowLog, loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { getLatestIncidentAt } from '../persistence/incidentLogRepo.js';
import { assertSafeOrder } from './preOrderGuard.js';
import { isEmergencyBuyPipelineCodeGuardEnabled } from '../dataQuality/emergencyDataQualityGuards.js';
import { normalizeKrxCode } from '../utils/symbolNormalizer.js';
import { getSmokeTestLiveBlocked, getSmokeTestLastFailedReason } from '../state.js';
import { lastManualExitAtForCode } from '../persistence/manualExitsRepo.js';
import {
  decideOrderType,
  isOrderTypeOptimizerEnabled,
} from './orderTypeOptimizer.js';
import {
  executeShadowBuy,
  recordShadowExecutionOutcome,
} from './shadowExecutionPipeline.js';

const _inflightBuyOrders = new Set<string>();

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
  sizingSource?: 'NEW_TIER_ENGINE' | 'LEGACY_SSOT';
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

function markSignalBlockedSafe(signalId: string | undefined, gate: TradeSignalBlockGate, reason: string): void {
  if (!signalId) return;
  try {
    markBlocked({ id: signalId, gate, reason });
  } catch (e) {
    console.warn(`[TradeSignalStatus] ${gate} markBlocked failed`, e);
  }
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
    console.warn('[OrderTypeOptimizer] decideOrderType failed', e);
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
  appendShadowLog({
    event: 'BUY_BLOCKED_MANUAL_EXIT_COOLDOWN',
    code: p.stockCode,
    price: p.currentPrice,
    lastExitAt: cooldown.lastExitAt,
    remainingHours: cooldown.remainingHours,
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
): Promise<ApprovalAction> {
  return requestBuyApproval({
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

function describeError(e: unknown): unknown {
  return e instanceof Error ? e.message : e;
}

async function executeLiveBuyTask(p: CreateBuyTaskParams): Promise<string | null> {
  if (getSmokeTestLiveBlocked()) {
    console.warn(
      `[BuyPipeline LIVE] ${p.stockName}(${p.stockCode}) smoke-test 실패로 LIVE 차단 — ${getSmokeTestLastFailedReason()}`,
    );
    p.trade.status = 'REJECTED';
    p.onRejected?.(p.trade, 'SKIP');
    return null;
  }

  if (_inflightBuyOrders.has(p.trade.id)) {
    console.warn(`[BuyPipeline LIVE] ${p.stockName}(${p.stockCode}) 이미 주문 진행 중 — 중복 발사 차단`);
    p.trade.status = 'REJECTED';
    p.onRejected?.(p.trade, 'SKIP');
    return null;
  }
  _inflightBuyOrders.add(p.trade.id);

  try {
    const totalAssets = await fetchAccountBalance().catch(() => null);
    assertSafeOrder({
      stockCode:   p.stockCode,
      stockName:   p.stockName,
      quantity:    p.quantity,
      entryPrice:  p.entryPrice,
      stopLoss:    p.stopLoss,
      totalAssets,
    });
  } catch (e) {
    console.error(`[BuyPipeline LIVE] ${p.stockName}(${p.stockCode}) 사전 가드 차단:`, describeError(e));
    p.trade.status = 'REJECTED';
    p.onRejected?.(p.trade, 'SKIP');
    _inflightBuyOrders.delete(p.trade.id);
    return null;
  }

  if (p.signalId) {
    try {
      markAutoTradeReady({ id: p.signalId, reason: 'KIS LIVE 주문 직전' });
    } catch (e) {
      console.warn('[TradeSignalStatus] LIVE markAutoTradeReady failed', e);
    }
  }

  let ordNo: string | null = null;
  try {
    ordNo = await placeKisMarketBuyOrder(p.stockCode, p.quantity);
  } catch (e) {
    console.error(`[BuyPipeline LIVE] ${p.stockName}(${p.stockCode}) 주문 API 실패:`, describeError(e));
    p.trade.status = 'REJECTED';
    p.onRejected?.(p.trade, 'SKIP');
    _inflightBuyOrders.delete(p.trade.id);
    return null;
  }

  const modeTag = `[BuyPipeline LIVE]`;
  console.log(`${modeTag} ${p.stockName} 매수 주문 — ODNO: ${ordNo}`);
  appendShadowLog({ event: p.logEvent, code: p.stockCode, price: p.currentPrice, ordNo });

  if (ordNo) {
    p.trade.status = 'ORDER_SUBMITTED';
    fillMonitor.addOrder({
      ordNo,
      stockCode:      p.stockCode,
      stockName:      p.stockName,
      quantity:       p.quantity,
      orderPrice:     p.entryPrice,
      placedAt:       new Date().toISOString(),
      relatedTradeId: p.trade.id,
    });
  } else {
    p.trade.status = 'REJECTED';
  }
  _inflightBuyOrders.delete(p.trade.id);
  return ordNo;
}

function executeShadowBuyTask(p: CreateBuyTaskParams): void {
  console.log(`[BuyPipeline SHADOW] ${p.stockName}(${p.stockCode}) 신호 등록 @${p.currentPrice}`);
  if (p.signalId) {
    try {
      markAutoTradeReady({ id: p.signalId, reason: 'SHADOW 진입 (USER_APPROVED 우회)' });
    } catch (e) {
      console.warn('[TradeSignalStatus] SHADOW markAutoTradeReady failed', e);
    }
  }
  appendShadowLog({ event: p.logEvent, ...p.trade });
}

function alignTradeModeWithTaskShadowMode(p: CreateBuyTaskParams): void {
  if (!p.shadowMode || p.trade.mode === 'SHADOW') return;
  const previousMode = p.trade.mode ?? 'undefined';
  p.trade.mode = 'SHADOW';
  console.warn(
    `[BuyPipeline SHADOW] ${p.stockName}(${p.stockCode}) task shadowMode=true but trade.mode=${previousMode}; aligned to SHADOW`,
  );
  appendShadowLog({
    event: 'SHADOW_MODE_ALIGNED',
    code: p.stockCode,
    tradeId: p.trade.id,
    previousMode,
    reason: 'buy task shadowMode=true',
  });
}

function hasConfirmedShadowBuy(trade: ServerShadowTrade): boolean {
  if (trade.status === 'ACTIVE') return true;
  return (trade.fills ?? []).some((fill) => fill.type === 'BUY' && fill.status !== 'REVERTED');
}

function mergeTradeForShadowPaperFill(trade: ServerShadowTrade): ServerShadowTrade[] {
  const allTrades = loadShadowTrades();
  const existingIndex = allTrades.findIndex((candidate) => candidate.id === trade.id);
  if (existingIndex >= 0) {
    allTrades[existingIndex] = trade;
  } else {
    allTrades.push(trade);
  }
  return allTrades;
}

async function ensureShadowPaperFillAfterApproval(p: CreateBuyTaskParams): Promise<void> {
  if (!p.shadowMode) return;
  if (p.trade.mode !== 'SHADOW') return;
  if (p.trade.status !== 'PENDING') return;
  if (hasConfirmedShadowBuy(p.trade)) return;

  const result = await executeShadowBuy({
    trade: p.trade,
    allTrades: mergeTradeForShadowPaperFill(p.trade),
    fillPrice: p.entryPrice,
    approvedAtIso: new Date().toISOString(),
    notifyFilled: async (filled) => {
      await channelShadowBuyFilled({
        stockName: filled.stockName,
        stockCode: filled.stockCode,
        fillPrice: filled.fillPrice,
        quantity: filled.quantity,
        fillId: filled.fillId,
        tradeId: filled.tradeId,
      });
    },
  });
  recordShadowExecutionOutcome(result.outcome);

  if (result.outcome !== 'EXECUTED' && result.outcome !== 'ALREADY_FILLED') {
    console.warn(
      `[BuyPipeline SHADOW] fallback paper-fill skipped for ${p.stockName}(${p.stockCode}) — ${result.outcome}: ${result.reason}`,
    );
  }
}

async function executeBuyTaskApproval(p: CreateBuyTaskParams, approval: ApprovalAction): Promise<void> {
  if (approval !== 'APPROVE') {
    const modeLabel = p.shadowMode ? 'SHADOW' : 'LIVE';
    console.log(`[BuyPipeline ${modeLabel}] ${p.stockName} 매수 ${approval} — 건너뜀`);
    p.trade.status = 'REJECTED';
    p.onRejected?.(p.trade, approval);
    return;
  }

  const ordNo = p.shadowMode ? null : await executeLiveBuyTask(p);
  if (p.shadowMode) executeShadowBuyTask(p);

  if (p.trade.status !== 'REJECTED') {
    await sendTelegramAlert(p.alertMessage).catch(console.error);
    await p.onApproved(p.trade, ordNo);
    await ensureShadowPaperFillAfterApproval(p);
  }
}

export async function createBuyTask(p: CreateBuyTaskParams): Promise<LiveBuyTask> {
  const regime = p.regime ?? p.trade.entryRegime;
  const sector = getSectorByCode(p.stockCode);
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
  return {
    approvalPromise: requestApprovalForBuyTask(p, enemyCheck, preMortem, regime),
    execute: (approval: ApprovalAction) => executeBuyTaskApproval(p, approval),
  };
}
