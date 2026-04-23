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

import type { ServerShadowTrade, EntryKellySnapshot } from '../persistence/shadowTradeRepo.js';
import type { ApprovalAction } from '../telegram/buyApproval.js';
import type { EnemyCheckResult } from '../clients/enemyCheckClient.js';
import type { StopLossPlan } from './entryEngine.js';
import { fetchYahooQuote, fetchKisQuoteFallback, type YahooQuoteExtended } from '../screener/stockScreener.js';
import { fetchKisInvestorFlow } from '../clients/kisClient.js';
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
import { requestBuyApproval } from '../telegram/buyApproval.js';
import { fetchEnemyCheckData } from '../clients/enemyCheckClient.js';
import { fillMonitor } from './fillMonitor.js';
import { appendShadowLog } from '../persistence/shadowTradeRepo.js';
import { getLatestIncidentAt } from '../persistence/incidentLogRepo.js';
import { assertSafeOrder } from './preOrderGuard.js';
import { getSmokeTestLiveBlocked, getSmokeTestLastFailedReason } from '../state.js';
import { lastManualExitAtForCode } from '../persistence/manualExitsRepo.js';

// ── 진행 중 매수 주문 예약 테이블 ────────────────────────────────────────────
// kisPost 가 수초(시장가 경합/재시도 포함) 걸리는 동안 다른 스캔 사이클이
// 동일 trade 에 대해 중복 주문을 발사하는 것을 막기 위한 in-process 가드.
// trade.id 를 키로 쓰며, 성공·실패 어떤 경로든 반드시 해제되도록 finally 에서 delete.
const _inflightBuyOrders = new Set<string>();

// ── P2 #18: 수동 청산 후 72h 재매수 냉각 룰 ──────────────────────────────────
/** 사용자가 수동 청산한 종목은 이 시간 동안 재매수 경로가 막힌다 (반복 편향 방지). */
export const MANUAL_EXIT_REBUY_COOLDOWN_MS = 72 * 60 * 60 * 1000;

export interface ManualExitCooldownResult {
  blocked: boolean;
  lastExitAt?: string;
  remainingMs?: number;
  remainingHours?: number;
}

/**
 * 주어진 종목이 72h 재매수 냉각 중인지 판정한다.
 * blocked=true 이면 매수 경로가 REJECTED 처리되어야 한다.
 */
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

// ── MTAS Multiplier ────────────────────────────────────────────────────────────

/**
 * MTAS(Multi-Timeframe Alignment Score) → 포지션 배수 매핑.
 * 이전에 signalScanner.ts 내에서 3회 중복되던 로직을 통합.
 *
 *   ≥10    → 1.15 (완벽 정렬 +15%)
 *   7~9    → 1.0  (표준)
 *   3<x<7  → 0.5  (약한/경계 구간)
 *   ≤3     → 0.3  (호출 전 별도 가드가 보통 차단 — fallback 도달 시 강제 축소)
 *
 * 주의: 이전 구현은 `mtas > 3 → 0.5` + `≤3 → 1.0` 이 되어 "진입 차단" docstring 과
 * 반대로 1.0 을 반환하던 불일치가 있었고, `>=5` 와 `>3` 이 둘 다 0.5 로 중복 분기였다.
 * 양쪽 모두 보수적 방향으로 정리.
 */
export function computeMtasMultiplier(mtas: number): number {
  if (mtas >= 10) return 1.15;
  if (mtas >= 7) return 1.0;
  if (mtas > 3) return 0.5;
  return 0.3;
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
  kospi20dReturn?: number,
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
    quote, weights, kospi20dReturn ?? macroState?.kospi20dReturn, dartFin, kisFlow,
  );

  // Layer 14 ETF 선행 수급 부스트 — universeScanner와 동일 기준으로 재평가 시에도 적용
  const etfBoost = computeEtfSectorBoost(getSectorByCode(stockCode));
  if (etfBoost.boost > 0) {
    gate.gateScore += etfBoost.boost;
    gate.details.push(...etfBoost.reasons);
  }

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
  /** Idea 1 — 진입 시점 Kelly 의사결정 스냅샷. 누락 시 snapshot 필드는 undefined 로 기록. */
  entryKellySnapshot?: EntryKellySnapshot;
}

/**
 * ServerShadowTrade 객체 생성 공통 빌더.
 * 4개 매수 경로에서 중복 생성하던 20+ 필드 객체를 통합.
 */
export function buildBuyTrade(p: BuildBuyTradeParams): ServerShadowTrade {
  // Phase 2차 C5 — 현재 활성 incident 가 있으면 해당 시점 이후 생성되는 Shadow 샘플은
  // 자동으로 incidentFlag 가 부착되어 캘리브레이션에서 격리된다.
  const latestIncident = getLatestIncidentAt();
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
    ...(latestIncident ? { incidentFlag: latestIncident } : {}),
    ...(p.entryKellySnapshot ? { entryKellySnapshot: p.entryKellySnapshot } : {}),
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
  /** 레짐 (자동 승인 타임아웃 가변용) */
  regime?: string;
  /** 사전 생성된 Pre-Mortem 실패 시나리오 체크리스트 */
  preMortem?: string | null;
}

/**
 * 매수 승인 큐 태스크 생성 — SHADOW/LIVE 분기를 통합.
 * 기존에 6회 중복되던 approval + execute 패턴을 1회로 통합.
 */
export async function createBuyTask(p: CreateBuyTaskParams): Promise<LiveBuyTask> {
  const regime = p.regime ?? p.trade.entryRegime;
  const sector = getSectorByCode(p.stockCode);

  // P2 #18 — 수동 청산 후 72h 재매수 냉각 가드. 승인 요청 전에 즉시 차단.
  const cooldown = checkManualExitCooldown(p.stockCode);
  if (cooldown.blocked) {
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
      execute: async (_a) => {
        p.onRejected?.(p.trade, 'SKIP');
      },
    };
  }

  // enemyCheck + preMortem 병렬 생성 (둘 다 외부 호출이고 서로 독립적)
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

  // Pre-Mortem을 shadowTrade에 저장 (승인 여부와 무관하게 기록 — 승인 거절 시 복기용)
  if (preMortem) {
    p.trade.preMortem = preMortem;
  }

  // Phase 3-⑫: 구조화된 4필드 Pre-Mortem 은 항상 필수 기록 (deterministic, Gemini 독립).
  // Gemini free-text 는 사람 복기용이고, structured 는 exitEngine 의 기계 매칭용.
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
      regime,
      preMortem,
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
        // Phase 2차 C7 — 당일 Pre-Market Smoke Test 가 실패했으면 LIVE 경로 완전 차단.
        if (getSmokeTestLiveBlocked()) {
          console.warn(
            `[BuyPipeline LIVE] ${p.stockName}(${p.stockCode}) smoke-test 실패로 LIVE 차단 — ${getSmokeTestLastFailedReason()}`,
          );
          p.trade.status = 'REJECTED';
          p.onRejected?.(p.trade, 'SKIP');
          return;
        }
        // 중복 발사 가드 — 동일 trade.id 에 대해 이미 주문이 진행 중이면 즉시 REJECTED.
        if (_inflightBuyOrders.has(p.trade.id)) {
          console.warn(`[BuyPipeline LIVE] ${p.stockName}(${p.stockCode}) 이미 주문 진행 중 — 중복 발사 차단`);
          p.trade.status = 'REJECTED';
          p.onRejected?.(p.trade, 'SKIP');
          return;
        }
        _inflightBuyOrders.add(p.trade.id);

        // Phase 2차 C3 — 주문 직전 Automated Kill Switch 검증.
        // 포지션 팽창·손절 논리 붕괴·무한 루프 감지 시 여기서 throw → REJECTED.
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
          // PreOrderGuardError — 이미 incident 기록 + EmergencyStop + Telegram 경보 완료.
          console.error(`[BuyPipeline LIVE] ${p.stockName}(${p.stockCode}) 사전 가드 차단:`,
            e instanceof Error ? e.message : e);
          p.trade.status = 'REJECTED';
          p.onRejected?.(p.trade, 'SKIP');
          _inflightBuyOrders.delete(p.trade.id);
          return;
        }

        try {
          ordNo = await placeKisMarketBuyOrder(p.stockCode, p.quantity);
        } catch (e) {
          // kisPost 가 재시도 후에도 throw 하는 경우 (네트워크·권한·한도 초과 등).
          // ordNo 미수신이므로 REJECTED 로 마감하여 다음 스캔에서 새로 시도할 수 있게 한다.
          console.error(`[BuyPipeline LIVE] ${p.stockName}(${p.stockCode}) 주문 API 실패:`, e instanceof Error ? e.message : e);
          p.trade.status = 'REJECTED';
          p.onRejected?.(p.trade, 'SKIP');
          _inflightBuyOrders.delete(p.trade.id);
          return;
        }

        const modeTag = `[BuyPipeline LIVE]`;
        console.log(`${modeTag} ${p.stockName} 매수 주문 — ODNO: ${ordNo}`);
        appendShadowLog({ event: p.logEvent, code: p.stockCode, price: p.currentPrice, ordNo });

        if (ordNo) {
          // 상태를 먼저 전이시켜 뒤따르는 fillMonitor 등록 실패가 있어도 중복 주문이 재발사되지
          // 않도록 한다. addOrder 는 파일 I/O 로만 실패 가능 — 실패해도 KIS 상에는 이미 주문이
          // 들어간 상태이므로 REJECTED 로 되돌리면 오히려 네이키드 포지션을 만든다.
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
