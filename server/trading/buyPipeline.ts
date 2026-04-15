/**
 * buyPipeline.ts — 매수 실행 파이프라인 공통 헬퍼
 *
 * signalScanner.ts 에서 반복되는 매수 경로(MAIN, PRE_BREAKOUT, INTRADAY)의
 * 공통 패턴을 추출하여 중복을 제거하고 일관성을 보장한다.
 *
 *   computeMtasMultiplier()   — MTAS → 포지션 배수 매핑
 *   computeRawPositionPct()   — Gate 점수 → 기본 포지션 비중
 *   fetchGateData()           — Yahoo + KIS + DART → Gate 재평가 일괄 조회
 *   buildBuyTrade()           — ServerShadowTrade 객체 공통 생성
 *   createBuyTask()           — 승인 큐 태스크 (SHADOW/LIVE 통합)
 */

import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import type { ApprovalAction } from '../telegram/buyApproval.js';
import type { EnemyCheckResult } from '../clients/enemyCheckClient.js';
import type { StopLossPlan } from './entryEngine.js';
import { fetchYahooQuote, fetchKisQuoteFallback, type YahooQuoteExtended } from '../screener/stockScreener.js';
import { fetchKisInvestorFlow } from '../clients/kisClient.js';
import { getDartFinancials } from '../clients/dartFinancialClient.js';
import { evaluateServerGate, type ServerGateResult } from '../quantFilter.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { placeKisMarketBuyOrder } from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { requestBuyApproval } from '../telegram/buyApproval.js';
import { fetchEnemyCheckData } from '../clients/enemyCheckClient.js';
import { fillMonitor } from './fillMonitor.js';
import { appendShadowLog } from '../persistence/shadowTradeRepo.js';

// ── MTAS Multiplier ────────────────────────────────────────────────────────────

/**
 * MTAS(Multi-Timeframe Alignment Score) → 포지션 배수 매핑.
 * 이전에 signalScanner.ts 내에서 3회 중복되던 로직을 통합.
 *
 *   10     → 1.15 (완벽 정렬 +15%)
 *   7~9    → 1.0  (표준)
 *   5~6    → 0.5  (약한 정렬 50% 축소)
 *   3<x<5  → 0.5  (경계 구간)
 *   ≤3     → 진입 차단 (호출 전 별도 가드)
 */
export function computeMtasMultiplier(mtas: number): number {
  if (mtas === 10) return 1.15;
  if (mtas >= 7) return 1.0;
  if (mtas >= 5) return 0.5;
  if (mtas > 3) return 0.5;
  return 1.0; // ≤3: 일반적으로 진입 전 차단되므로 fallback
}

// ── Raw Position Pct ────────────────────────────────────────────────────────────

/**
 * 서버 Gate 점수(최대 13점) → 기본 포지션 비중.
 *   ≥9  → 12% (STRONG_BUY)
 *   ≥7  → 8%
 *   ≥5  → 5%
 *   <5  → 3%
 */
export function computeRawPositionPct(gateScore: number): number {
  if (gateScore >= 9) return 0.12;
  if (gateScore >= 7) return 0.08;
  if (gateScore >= 5) return 0.05;
  return 0.03;
}

// ── Gate Data Fetch ─────────────────────────────────────────────────────────────

export interface GateData {
  quote: YahooQuoteExtended | null;
  gate: ServerGateResult | null;
}

/**
 * Yahoo + KIS + DART 데이터를 일괄 조회 후 서버 Gate 평가.
 * signalScanner.ts 내에서 4회 중복되던 패턴을 통합.
 */
export async function fetchGateData(
  stockCode: string,
  conditionWeights?: ReturnType<typeof loadConditionWeights>,
  kospiDayReturn?: number,
): Promise<GateData> {
  const weights = conditionWeights ?? loadConditionWeights();
  const quote = await fetchYahooQuote(`${stockCode}.KS`).catch(() => null)
             ?? await fetchYahooQuote(`${stockCode}.KQ`).catch(() => null)
             ?? await fetchKisQuoteFallback(stockCode).catch(() => null);

  if (!quote) return { quote: null, gate: null };

  const [kisFlow, dartFin] = await Promise.all([
    fetchKisInvestorFlow(stockCode).catch(() => null),
    getDartFinancials(stockCode).catch(() => null),
  ]);

  const macroState = loadMacroState();
  const gate = evaluateServerGate(
    quote, weights, kospiDayReturn ?? macroState?.kospiDayReturn, dartFin, kisFlow,
  );

  return { quote, gate };
}

// ── Build Buy Trade ─────────────────────────────────────────────────────────────

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
}

/**
 * ServerShadowTrade 객체 생성 공통 빌더.
 * 4개 매수 경로에서 중복 생성하던 20+ 필드 객체를 통합.
 */
export function buildBuyTrade(p: BuildBuyTradeParams): ServerShadowTrade {
  return {
    id:                    `${p.idPrefix}_${Date.now()}_${p.stockCode}`,
    stockCode:             p.stockCode,
    stockName:             p.stockName,
    signalTime:            new Date().toISOString(),
    signalPrice:           p.currentPrice,
    shadowEntryPrice:      p.shadowEntryPrice,
    quantity:              p.quantity,
    originalQuantity:      p.originalQuantity ?? p.quantity,
    stopLoss:              p.stopLossPlan.hardStopLoss,
    initialStopLoss:       p.stopLossPlan.initialStopLoss,
    regimeStopLoss:        p.stopLossPlan.regimeStopLoss,
    hardStopLoss:          p.stopLossPlan.hardStopLoss,
    targetPrice:           p.targetPrice,
    status:                'PENDING',
    mode:                  p.shadowMode ? 'SHADOW' : 'LIVE',
    entryRegime:           p.regime,
    profileType:           p.profileType,
    watchlistSource:       p.watchlistSource,
    profitTranches:        p.profitTranches,
    trailingHighWaterMark: p.shadowEntryPrice,
    trailPct:              p.trailPct,
    trailingEnabled:       false,
    entryATR14:            p.entryATR14 || undefined,
    dynamicStopPrice:      p.stopLossPlan.dynamicStopLoss,
  };
}

// ── Buy Task (Approval Queue) ───────────────────────────────────────────────────

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
  /** 승인 후 실행할 추가 콜백 (shadows.push, trancheExecutor 등) */
  onApproved: (trade: ServerShadowTrade, ordNo: string | null) => Promise<void>;
  /** 승인 거절/스킵 시 콜백 */
  onRejected?: (trade: ServerShadowTrade, action: ApprovalAction) => void;
  /** 텔레그램 알림 메시지 */
  alertMessage: string;
  /** shadow log 이벤트명 */
  logEvent: string;
}

/**
 * 매수 승인 큐 태스크 생성 — SHADOW/LIVE 분기를 통합.
 * 기존에 6회 중복되던 approval + execute 패턴을 1회로 통합.
 */
export async function createBuyTask(p: CreateBuyTaskParams): Promise<LiveBuyTask> {
  const enemyCheck = await fetchEnemyCheckData(p.stockCode).catch(() => null);

  return {
    approvalPromise: requestBuyApproval({
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
    }),
    execute: async (approval: ApprovalAction) => {
      if (approval !== 'APPROVE') {
        const modeLabel = p.shadowMode ? 'SHADOW' : 'LIVE';
        console.log(`[BuyPipeline ${modeLabel}] ${p.stockName} 매수 ${approval} — 건너뜀`);
        p.trade.status = 'REJECTED';
        p.onRejected?.(p.trade, approval);
        return;
      }

      let ordNo: string | null = null;

      if (!p.shadowMode) {
        // LIVE 모드: KIS 실주문
        ordNo = await placeKisMarketBuyOrder(p.stockCode, p.quantity);
        const modeTag = `[BuyPipeline LIVE]`;
        console.log(`${modeTag} ${p.stockName} 매수 주문 — ODNO: ${ordNo}`);
        appendShadowLog({ event: p.logEvent, code: p.stockCode, price: p.currentPrice, ordNo });

        if (ordNo) {
          fillMonitor.addOrder({
            ordNo,
            stockCode:      p.stockCode,
            stockName:      p.stockName,
            quantity:       p.quantity,
            orderPrice:     p.entryPrice,
            placedAt:       new Date().toISOString(),
            relatedTradeId: p.trade.id,
          });
          p.trade.status = 'ORDER_SUBMITTED';
        } else {
          p.trade.status = 'REJECTED';
        }
      } else {
        // SHADOW 모드
        console.log(`[BuyPipeline SHADOW] ${p.stockName}(${p.stockCode}) 신호 등록 @${p.currentPrice}`);
        appendShadowLog({ event: p.logEvent, ...p.trade });
      }

      // 공통 후처리
      if (p.trade.status !== 'REJECTED') {
        await sendTelegramAlert(p.alertMessage).catch(console.error);
        await p.onApproved(p.trade, ordNo);
      }
    },
  };
}
