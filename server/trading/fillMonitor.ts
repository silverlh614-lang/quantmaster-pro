import fs from 'fs';
import { PENDING_ORDERS_FILE, PENDING_SELL_ORDERS_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadShadowTrades, saveShadowTrades, appendFill, syncPositionCache, getRemainingQty, revertProvisionalFill } from '../persistence/shadowTradeRepo.js';
import { kisGet, kisPost, fetchCurrentPrice, KIS_IS_REAL, SELL_TR_ID } from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelBuyFilled } from '../alerts/channelPipeline.js';
import { registerOcoPair } from './ocoCloseLoop.js';
import { appendTradeEvent } from './tradeEventLog.js';
import { safePctChange } from '../utils/safePctChange.js';

const FILL_POLL_MAX = 10; // 최대 폴링 횟수 (cron 5분 간격 × 10 = 최대 50분 모니터링)

export interface PendingOrder {
  ordNo: string;           // KIS 주문번호 (ODNO)
  stockCode: string;
  stockName: string;
  quantity: number;
  orderPrice: number;
  placedAt: string;        // ISO
  pollCount: number;       // 현재까지 조회 횟수
  status: 'PENDING' | 'FILLED' | 'PARTIAL' | 'CANCELLED' | 'EXPIRED';
  fillPrice?: number;
  fillQty?: number;
  filledAt?: string;
  relatedTradeId?: string; // shadow trade ID (연관 포지션)
}

function loadPendingOrders(): PendingOrder[] {
  ensureDataDir();
  if (!fs.existsSync(PENDING_ORDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PENDING_ORDERS_FILE, 'utf-8')); } catch { return []; }
}

function savePendingOrders(orders: PendingOrder[]): void {
  ensureDataDir();
  // 완료/취소된 주문은 최근 100건만 보관
  const active  = orders.filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
  const history = orders.filter(o => o.status !== 'PENDING' && o.status !== 'PARTIAL').slice(-100);
  fs.writeFileSync(PENDING_ORDERS_FILE, JSON.stringify([...active, ...history], null, 2));
}

function updateRelatedTradeStatus(
  relatedTradeId: string | undefined,
  status: 'ORDER_SUBMITTED' | 'PARTIALLY_FILLED' | 'ACTIVE' | 'REJECTED',
  opts?: { fillPrice?: number; fillQty?: number },
): void {
  if (!relatedTradeId) return;
  const shadows = loadShadowTrades();
  const trade = shadows.find((s) => s.id === relatedTradeId);
  if (!trade) return;

  if (status === 'ORDER_SUBMITTED' && trade.status !== 'PENDING') return;
  if (status === 'PARTIALLY_FILLED' && trade.status !== 'ORDER_SUBMITTED' && trade.status !== 'PARTIALLY_FILLED') return;
  if (status === 'ACTIVE' && trade.status === 'REJECTED') return;
  if (status === 'REJECTED' && (trade.status === 'HIT_TARGET' || trade.status === 'HIT_STOP')) return;

  trade.status = status;
  if (opts?.fillPrice !== undefined && opts.fillPrice > 0) trade.shadowEntryPrice = opts.fillPrice;
  if (opts?.fillQty !== undefined && opts.fillQty > 0) {
    trade.quantity = opts.fillQty;
    trade.originalQuantity = Math.max(trade.originalQuantity ?? 0, opts.fillQty);
  }

  // ACTIVE 전환 시 BUY fill 기록 (포지션 생애 시작점)
  if (status === 'ACTIVE' && opts?.fillPrice && opts.fillPrice > 0 && opts?.fillQty && opts.fillQty > 0) {
    // 이미 BUY fill이 있으면 중복 추가 방지 (재폴링 등)
    const hasBuyFill = (trade.fills ?? []).some(f => f.type === 'BUY');
    if (!hasBuyFill) {
      const entryTs = new Date().toISOString();
      appendFill(trade, {
        type: 'BUY',
        subType: 'INITIAL_BUY',
        qty: opts.fillQty,
        price: opts.fillPrice,
        reason: '진입 체결 확인',
        timestamp: entryTs,
      });
      appendTradeEvent({
        positionId:    trade.id ?? trade.stockCode,
        ts:            entryTs,
        type:          'ENTRY',
        subType:       'INITIAL_BUY',
        quantity:      opts.fillQty,
        price:         opts.fillPrice,
        realizedPnL:   0,
        cumRealizedPnL: 0,
        remainingQty:  opts.fillQty,
      });
    }
  }

  saveShadowTrades(shadows);
}

export class FillMonitor {
  /** LIVE 주문 후 호출 — pending-orders.json에 추가 */
  addOrder(order: Omit<PendingOrder, 'pollCount' | 'status'>): void {
    const orders = loadPendingOrders();
    if (orders.some(o => o.ordNo === order.ordNo)) return; // 중복 방지
    orders.push({ ...order, pollCount: 0, status: 'PENDING' });
    savePendingOrders(orders);
    updateRelatedTradeStatus(order.relatedTradeId, 'ORDER_SUBMITTED');
    console.log(`[FillMonitor] 주문 등록: ${order.stockName}(${order.stockCode}) ODNO=${order.ordNo}`);
  }

  /** 5분 간격 cron에서 호출 — 모든 PENDING 주문의 체결 여부 확인 */
  async pollFills(): Promise<void> {
    if (!process.env.KIS_APP_KEY) return;
    const orders = loadPendingOrders();
    const pending = orders.filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
    if (pending.length === 0) return;

    console.log(`[FillMonitor] 미체결 조회 — ${pending.length}건`);
    const trId = KIS_IS_REAL ? 'TTTC0688R' : 'VTTC0688R';

    let data: { output?: { odno: string; ord_qty: string; tot_ccld_qty: string; avg_prvs: string; pdno: string }[] } | null = null;
    try {
      data = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl', {
        CANO: process.env.KIS_ACCOUNT_NO ?? '',
        ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
        CTX_AREA_FK100: '', CTX_AREA_NK100: '',
        INQR_DVSN_1: '0', INQR_DVSN_2: '0',
      });
    } catch (e) {
      // kisGet 내부에서 이미 429/5xx 재시도 수행 후에도 실패한 경우만 도달.
      // 이번 사이클은 건너뛰고 다음 cron(5분 후)에서 재조회 — pollCount 미증가로 만료 방지.
      console.error('[FillMonitor] KIS 미체결 조회 실패 — 이번 사이클 스킵:', e instanceof Error ? e.message : e);
      return;
    }

    // data=null 은 kisGet 재시도 후에도 응답을 받지 못한 경우(4xx/본문 비어있음 등).
    // output=[] (정상 빈 목록)과 구분하지 않으면 전 주문을 '체결됨'으로 오판하여
    // 잘못된 OCO 등록·Telegram 알림을 유발한다. 반드시 이번 사이클을 중단해야 한다.
    if (!data) {
      console.warn('[FillMonitor] KIS 미체결 응답이 비어 있음 — 전 주문 FILLED 오판 방지 위해 스킵');
      return;
    }

    const unfilledMap = new Map((data.output ?? []).map(o => [o.odno, o]));
    let changed = false;

    for (const order of pending) {
      order.pollCount++;

      const unfilled = unfilledMap.get(order.ordNo);

      if (!unfilled) {
        // KIS 미체결 목록에 없음 → 체결 완료
        const fillPrice = await fetchCurrentPrice(order.stockCode).catch(() => null) ?? order.fillPrice ?? order.orderPrice;
        Object.assign(order, {
          status: 'FILLED', fillPrice, fillQty: order.quantity,
          filledAt: new Date().toISOString(),
        });
        updateRelatedTradeStatus(order.relatedTradeId, 'ACTIVE', {
          fillPrice,
          fillQty: order.quantity,
        });
        changed = true;
        console.log(`[FillMonitor] ✅ 체결 확인: ${order.stockName} @${fillPrice.toLocaleString()}원 (ODNO=${order.ordNo})`);
        await sendTelegramAlert(
          `✅ <b>[체결 확인]</b>\n` +
          `종목: ${order.stockName} (${order.stockCode})\n` +
          `체결가: ${fillPrice.toLocaleString()}원\n` +
          `수량: ${order.quantity}주\n` +
          `주문번호: ${order.ordNo}`
        ).catch(console.error);
        await channelBuyFilled({
          stockName: order.stockName,
          stockCode: order.stockCode,
          fillPrice,
          quantity: order.quantity,
          orderNo: order.ordNo,
        }).catch(console.error);

        // ── OCO 손절+익절 지정가 쌍 동시 등록 (OCO Close Loop) ───────────
        // exitEngine 주기적 감시와 별개로, 거래소 레벨 안전망 확보.
        // 양쪽 주문번호를 DB에 저장 → 15분마다 생존 확인 → 한쪽 체결 시 다른쪽 취소.
        const shadows = loadShadowTrades();
        const trade = shadows.find(s => s.id === order.relatedTradeId);
        const stopPrice = trade?.hardStopLoss ?? trade?.stopLoss;
        const targetPrice = trade?.targetPrice;
        if (trade && stopPrice && stopPrice > 0 && targetPrice && targetPrice > 0) {
          await registerOcoPair(
            order.relatedTradeId ?? order.ordNo,
            order.stockCode,
            order.stockName,
            order.quantity,
            fillPrice,
            stopPrice,
            targetPrice,
          );
          console.log(`[FillMonitor] 🔗 OCO 쌍 등록: ${order.stockName} 손절=${Math.floor(stopPrice).toLocaleString()}원 익절=${Math.floor(targetPrice).toLocaleString()}원`);
        } else {
          console.warn(`[FillMonitor] ⚠️ ${order.stockName} 손절/익절가 미설정 — OCO 미등록 (exitEngine 감시 대체)`);
        }
      } else if (Number(unfilled.tot_ccld_qty ?? 0) > 0) {
        const fillQty = Math.min(order.quantity, Number(unfilled.tot_ccld_qty ?? 0));
        const fillPrice = Number(unfilled.avg_prvs ?? 0) || order.fillPrice || order.orderPrice;
        Object.assign(order, {
          status: 'PARTIAL',
          fillPrice,
          fillQty,
        });
        updateRelatedTradeStatus(order.relatedTradeId, 'PARTIALLY_FILLED', { fillPrice, fillQty });
        changed = true;
        console.log(`[FillMonitor] ◐ 부분 체결: ${order.stockName} ${fillQty}/${order.quantity}주 (ODNO=${order.ordNo})`);
      } else if (order.pollCount >= FILL_POLL_MAX) {
        // 10회 폴링 초과 → 만료 처리 (장 마감 취소와 별도)
        order.status = 'EXPIRED';
        updateRelatedTradeStatus(order.relatedTradeId, 'REJECTED');
        changed = true;
        console.warn(`[FillMonitor] ⏱ 폴링 만료 (${FILL_POLL_MAX}회): ${order.stockName} ODNO=${order.ordNo}`);
        await sendTelegramAlert(
          `⏱ <b>[미체결 만료]</b> ${order.stockName}(${order.ordNo}) — 폴링 ${FILL_POLL_MAX}회 초과`
        ).catch(console.error);
      } else {
        console.log(`[FillMonitor] 미체결 유지 (${order.pollCount}/${FILL_POLL_MAX}): ${order.stockName} ODNO=${order.ordNo}`);
      }
    }

    if (changed) savePendingOrders(orders);
  }

  /**
   * 장 마감 10분 전(15:20) cron에서 호출 — PENDING 주문 전량 자동 취소.
   * Railway cron 설정: '20 6 * * 1-5' (UTC 기준 15:20 KST)
   */
  async autoCancelAtClose(): Promise<void> {
    if (!process.env.KIS_APP_KEY) return;
    const orders = loadPendingOrders();
    const pending = orders.filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
    if (pending.length === 0) return;

    console.warn(`[FillMonitor] 장 마감 전 미체결 취소 — ${pending.length}건`);
    const cancelTrId = KIS_IS_REAL ? 'TTTC0803U' : 'VTTC0803U';

    for (const order of pending) {
      try {
        await kisPost(cancelTrId, '/uapi/domestic-stock/v1/trading/order-rvsecncl', {
          CANO: process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          KRX_FWDG_ORD_ORGNO: '', ORGN_ODNO: order.ordNo,
          ORD_DVSN: '00', RVSE_CNCL_DVSN_CD: '02',
          ORD_QTY: order.quantity.toString(), ORD_UNPR: '0',
          QTY_ALL_ORD_YN: 'Y', PDNO: order.stockCode.padStart(6, '0'),
        });
        order.status = 'CANCELLED';
        updateRelatedTradeStatus(order.relatedTradeId, 'REJECTED');
        console.log(`[FillMonitor] 취소 완료: ${order.stockName} ODNO=${order.ordNo}`);
        await sendTelegramAlert(
          `🚫 <b>[장마감 자동 취소]</b> ${order.stockName}(${order.stockCode})\n` +
          `주문번호: ${order.ordNo} | 미체결 ${order.quantity}주`
        ).catch(console.error);
      } catch (e) {
        console.error(`[FillMonitor] 취소 실패 ODNO=${order.ordNo}:`, e instanceof Error ? e.message : e);
      }
    }

    savePendingOrders(orders);
  }

  getPendingOrders(): PendingOrder[] {
    return loadPendingOrders();
  }
}

/** 싱글턴 인스턴스 (server.ts에서 import하여 cron 연결) */
export const fillMonitor = new FillMonitor();

// ═══════════════════════════════════════════════════════════════════════════════
// 매도 체결 확인 폐루프 (OCO CCLD 완성)
// exitEngine이 placeKisSellOrder를 발행한 뒤 "체결 여부를 모르는" 상태를
// 해소하기 위한 시스템. 30초 간격 최대 5회 CCLD 폴링 → 미체결 시 시장가 재발행.
// ═══════════════════════════════════════════════════════════════════════════════

const SELL_POLL_MAX        = 5;      // 최대 폴링 횟수
/** 매도 체결 폴링 간격 (ms) — scheduler에서 setInterval에 사용 */
export const SELL_POLL_INTERVAL = 30_000; // 30초 간격

export interface PendingSellOrder {
  ordNo: string;
  stockCode: string;
  stockName: string;
  quantity: number;
  orderType: 'MARKET' | 'LIMIT';      // 현재 주문 유형
  originalReason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'EUPHORIA';
  placedAt: string;
  pollCount: number;
  status: 'PENDING' | 'FILLED' | 'PARTIAL' | 'REISSUED_MARKET' | 'FAILED';
  fillPrice?: number;
  fillQty?: number;
  filledAt?: string;
  relatedTradeId?: string;
  reissuedOrdNo?: string;              // 시장가 재발행 시 새 주문번호
}

function loadPendingSellOrders(): PendingSellOrder[] {
  ensureDataDir();
  if (!fs.existsSync(PENDING_SELL_ORDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PENDING_SELL_ORDERS_FILE, 'utf-8')); } catch { return []; }
}

function savePendingSellOrders(orders: PendingSellOrder[]): void {
  ensureDataDir();
  const active  = orders.filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
  const history = orders.filter(o => o.status !== 'PENDING' && o.status !== 'PARTIAL').slice(-100);
  fs.writeFileSync(PENDING_SELL_ORDERS_FILE, JSON.stringify([...active, ...history], null, 2));
}

/**
 * 매도 주문 후 호출 — 체결 확인 폐루프에 등록.
 * exitEngine의 placeKisSellOrder 후 호출하여 체결 추적을 시작한다.
 */
export function addSellOrder(order: Omit<PendingSellOrder, 'pollCount' | 'status' | 'orderType'>): void {
  // LIVE 모드에서만 추적
  if (!KIS_IS_REAL) return;
  const orders = loadPendingSellOrders();
  if (orders.some(o => o.ordNo === order.ordNo)) return;
  orders.push({ ...order, pollCount: 0, status: 'PENDING', orderType: 'MARKET' });
  savePendingSellOrders(orders);
  console.log(`[SellFillMonitor] 매도 주문 등록: ${order.stockName}(${order.stockCode}) ODNO=${order.ordNo}`);
}

/**
 * KIS CCLD 확인 결과로 Fill 레코드의 qty/price/pnl을 실체결량으로 보정한다.
 *
 * exitEngine이 매도 직후 `appendFill`로 기록한 Fill은 "의도 수량"을 가지고
 * 있다. 실제 KIS 체결량은 CCLD로만 확인 가능하므로, 이 헬퍼가 두 값의
 * 차이를 fills 배열에 반영한다. Fill SSOT 유지의 마지막 고리.
 *
 * @param relatedTradeId - 원본 shadow trade ID
 * @param ordNo          - Fill에 저장된 KIS 주문번호 (exitEngine이 심어둔 값)
 * @param filledQty      - KIS CCLD tot_ccld_qty
 * @param fillPrice      - KIS CCLD avg_prvs (0이면 Fill의 기존 price 유지)
 * @param finalize       - true면 ordNo 필드 제거 (더 이상 보정 안 함)
 */
function correctShadowFill(
  relatedTradeId: string | undefined,
  ordNo: string,
  filledQty: number,
  fillPrice: number,
  finalize: boolean,
): { remainingQty: number; closed: boolean } | null {
  if (!relatedTradeId || !ordNo) return null;
  const trades = loadShadowTrades();
  const trade = trades.find(t => t.id === relatedTradeId);
  if (!trade || !trade.fills) return null;

  const fill = trade.fills.find(f => f.ordNo === ordNo);
  if (!fill) return null;

  const effectivePrice = fillPrice > 0 ? fillPrice : fill.price;
  const qtyChanged = fill.qty !== filledQty;
  const priceChanged = Math.abs((fill.price ?? 0) - effectivePrice) >= 1;
  if (!qtyChanged && !priceChanged && !finalize) {
    // 변경 없음 — 현재 잔량만 반환
    return { remainingQty: getRemainingQty(trade), closed: false };
  }

  // ── 트랜잭션 스냅샷: saveShadowTrades 실패 시 in-memory 롤백 ─────────────────
  // fill.qty/price/pnl/ordNo 와 trade.quantity/originalQuantity/status/exitTime
  // /exitPrice 가 모두 변경 대상. 중간에 throw 되면 in-memory 에는 부분 변경만
  // 반영된 채로 "다음 호출이 신선한 load 로 덮어쓰는" 운에 맡기게 되는데,
  // pollSellFills 의 caller 가 동일 fill 에 재접근할 수 있어 위험하다.
  const snapshot = {
    fillQty: fill.qty,
    fillPrice: fill.price,
    fillPnl: fill.pnl,
    fillPnlPct: fill.pnlPct,
    fillOrdNo: fill.ordNo,
    fillStatus: fill.status,
    fillConfirmedAt: fill.confirmedAt,
    tradeQuantity: trade.quantity,
    tradeOriginalQuantity: trade.originalQuantity,
    tradeStatus: trade.status,
    tradeExitTime: trade.exitTime,
    tradeExitPrice: trade.exitPrice,
  };

  if (qtyChanged) fill.qty = filledQty;
  if (priceChanged) fill.price = effectivePrice;
  // pnl / pnlPct 재계산 (entryPrice 기준)
  // ADR-0028: pnlPct 는 fill 영속화에 사용 — sanity 위반 시 0 fallback (학습 오염 차단).
  if (trade.shadowEntryPrice > 0) {
    fill.pnl = (effectivePrice - trade.shadowEntryPrice) * filledQty;
    fill.pnlPct = safePctChange(effectivePrice, trade.shadowEntryPrice, {
      label: `fillMonitor.pnlPct:${trade.stockCode}`,
    }) ?? 0;
  }
  if (finalize) {
    delete fill.ordNo;
    // CCLD 확인으로 PROVISIONAL → CONFIRMED 최종 확정. 레거시 fill (status 미정)은
    // CONFIRMED 간주이므로 굳이 덮어쓸 필요는 없지만, 명시적으로 기록해두면 감사
    // 추적 시 "어느 시점에 확정되었는가"를 확인할 수 있다.
    fill.status = 'CONFIRMED';
    fill.confirmedAt = new Date().toISOString();
  }

  syncPositionCache(trade);

  // 보정 결과 잔량이 0이 됐는데 status가 아직 열린 상태이면 HIT_STOP으로 자동 전환
  // (reconcileShadowQuantities와 동일 원칙). 전량청산 경로는 exitEngine이 이미 status를
  // 설정하지만, 부분청산 fill이 누적되어 잔량이 0이 되는 경로는 닫아줄 주체가 없다.
  const openStatuses = new Set(['ACTIVE', 'PARTIALLY_FILLED', 'EUPHORIA_PARTIAL', 'PENDING', 'ORDER_SUBMITTED']);
  const remainingQty = getRemainingQty(trade);
  let autoClosed = false;
  if (remainingQty === 0 && openStatuses.has(trade.status)) {
    trade.status = 'HIT_STOP';
    trade.exitTime ??= new Date().toISOString();
    trade.exitPrice ??= effectivePrice;
    autoClosed = true;
  }

  try {
    saveShadowTrades(trades);
  } catch (e) {
    // 저장 실패 — in-memory 변경을 snapshot 으로 롤백하여 "persist 안된 변경이
    // 메모리에만 남아 이후 로직에서 쓰이는" 상태 분기를 차단한다.
    fill.qty = snapshot.fillQty;
    fill.price = snapshot.fillPrice;
    fill.pnl = snapshot.fillPnl;
    fill.pnlPct = snapshot.fillPnlPct;
    if (snapshot.fillOrdNo !== undefined) fill.ordNo = snapshot.fillOrdNo;
    fill.status = snapshot.fillStatus;
    fill.confirmedAt = snapshot.fillConfirmedAt;
    trade.quantity = snapshot.tradeQuantity;
    trade.originalQuantity = snapshot.tradeOriginalQuantity;
    trade.status = snapshot.tradeStatus;
    trade.exitTime = snapshot.tradeExitTime;
    trade.exitPrice = snapshot.tradeExitPrice;
    console.error(`[SellFillMonitor] ⚠️ Fill 저장 실패 — 롤백 수행: ${trade.stockCode} ordNo=${ordNo}`, e instanceof Error ? e.message : e);
    return null;
  }

  // 저장 성공 후에만 사용자 가시 로그 방출 — 실패 시 "자동 닫힘" 오보를 막는다.
  if (autoClosed) {
    console.log(`[SellFillMonitor] 🏁 자동 닫힘: ${trade.stockCode} 잔량 0 → HIT_STOP`);
  }
  const action = finalize ? '최종 보정' : '중간 보정';
  console.log(`[SellFillMonitor] 🔧 Fill ${action}: ${trade.stockCode} ordNo=${ordNo} qty=${filledQty} @${effectivePrice.toLocaleString()}원 pnl=${fill.pnl?.toFixed(0)}`);

  return { remainingQty, closed: autoClosed };
}

/**
 * 매도 체결 확인 폴링 — 30초 간격 최대 5회.
 * 미체결 시 지정가→시장가 자동 전환 재발행.
 * 부분 체결 시 잔여 수량 재폴링.
 * 완전 체결 확인 후에만 shadow.status를 최종 CLOSED로 전환.
 */
export async function pollSellFills(): Promise<void> {
  if (!process.env.KIS_APP_KEY || !KIS_IS_REAL) return;
  const orders = loadPendingSellOrders();
  const pending = orders.filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
  if (pending.length === 0) return;

  console.log(`[SellFillMonitor] 매도 체결 조회 — ${pending.length}건`);
  const trId = KIS_IS_REAL ? 'TTTC8001R' : 'VTTC8001R';

  // CCLD TR(당일 체결 내역 조회) — 당일 전체 체결 목록에서 매칭
  // priority HIGH: 매도 체결 확인은 최우선 (네이키드 포지션 방지)
  let ccldData: { output?: { odno: string; tot_ccld_qty: string; avg_prvs: string; ord_qty: string; sll_buy_dvsn_cd: string }[] } | null = null;
  try {
    ccldData = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-daily-ccld', {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      INQR_STRT_DT: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      INQR_END_DT: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      SLL_BUY_DVSN_CD: '01', // 매도만
      INQR_DVSN: '00',
      PDNO: '',
      CCLD_DVSN: '00',
      ORD_GNO_BRNO: '',
      ODNO: '',
      INQR_DVSN_3: '00',
      INQR_DVSN_1: '',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    }, 'HIGH');
  } catch (e) {
    console.error('[SellFillMonitor] CCLD 조회 실패 — 이번 사이클 스킵:', e instanceof Error ? e.message : e);
    return;
  }

  // ccldData=null (kisGet 재시도 실패) 과 output=[] (정상 빈 목록) 구분.
  // null 을 빈 목록으로 취급하면 미체결 매도가 '폴링 만료 → 시장가 재발행' 경로로
  // 잘못 흘러 중복 매도를 유발한다. null 이면 이번 사이클 중단.
  if (!ccldData) {
    console.warn('[SellFillMonitor] CCLD 응답이 비어 있음 — 중복 재발행 방지 위해 스킵');
    return;
  }

  const ccldMap = new Map((ccldData.output ?? []).map(o => [o.odno, o]));
  let changed = false;

  for (const order of pending) {
    order.pollCount++;
    const ccld = ccldMap.get(order.ordNo) ?? ccldMap.get(order.reissuedOrdNo ?? '');

    if (ccld) {
      const filledQty = Number(ccld.tot_ccld_qty ?? 0);
      const avgPrice  = Number(ccld.avg_prvs ?? 0);

      if (filledQty >= order.quantity) {
        // ── 완전 체결 ──
        Object.assign(order, {
          status: 'FILLED',
          fillPrice: avgPrice || order.fillPrice,
          fillQty: filledQty,
          filledAt: new Date().toISOString(),
        });
        changed = true;
        console.log(`[SellFillMonitor] ✅ 매도 체결 확인: ${order.stockName} ${filledQty}주 @${avgPrice.toLocaleString()}원`);

        // Fill 레코드를 실체결량으로 최종 보정 (ordNo 제거)
        const correction = correctShadowFill(order.relatedTradeId, order.ordNo, filledQty, avgPrice, true);

        const remainingLine = correction
          ? (correction.closed
              ? '\n포지션 전량 청산 완료 (자동 닫힘)'
              : `\n잔여: ${correction.remainingQty}주`)
          : '';
        await sendTelegramAlert(
          `✅ <b>[매도 체결 확인]</b> ${order.stockName} (${order.stockCode})\n` +
          `체결: ${filledQty}주 @${avgPrice.toLocaleString()}원\n` +
          `사유: ${order.originalReason} | 주문번호: ${order.ordNo}` +
          remainingLine,
        ).catch(console.error);
      } else if (filledQty > 0) {
        // ── 부분 체결 → 잔여 재폴링 ──
        Object.assign(order, {
          status: 'PARTIAL',
          fillPrice: avgPrice || order.fillPrice,
          fillQty: filledQty,
        });
        changed = true;
        console.log(`[SellFillMonitor] ◐ 매도 부분 체결: ${order.stockName} ${filledQty}/${order.quantity}주`);

        // Fill 레코드를 현 시점 부분체결량으로 중간 보정 (ordNo 유지 — 추가 체결/재발행 대기)
        correctShadowFill(order.relatedTradeId, order.ordNo, filledQty, avgPrice, false);

        // 마지막 폴링이면 잔여 수량 시장가 재발행
        if (order.pollCount >= SELL_POLL_MAX) {
          const remainQty = order.quantity - filledQty;
          await reissueAsMarketOrder(order, remainQty);
          changed = true;
        }
      } else if (order.pollCount >= SELL_POLL_MAX) {
        // 체결 건수 0 + 폴링 만료 → 시장가 재발행
        await reissueAsMarketOrder(order, order.quantity);
        changed = true;
      }
    } else if (order.pollCount >= SELL_POLL_MAX) {
      // CCLD에 아예 없음 + 폴링 만료 → 시장가 재발행
      await reissueAsMarketOrder(order, order.quantity);
      changed = true;
    } else {
      console.log(`[SellFillMonitor] 미체결 유지 (${order.pollCount}/${SELL_POLL_MAX}): ${order.stockName} ODNO=${order.ordNo}`);
    }
  }

  if (changed) savePendingSellOrders(orders);
}

/** 미체결 매도 → 시장가 즉시 재발행 */
async function reissueAsMarketOrder(order: PendingSellOrder, quantity: number): Promise<void> {
  console.warn(`[SellFillMonitor] ⚠️ ${order.stockName} 매도 미체결 (${order.pollCount}회) — 시장가 재발행 ${quantity}주`);

  try {
    // 기존 주문 취소 시도
    const cancelTrId = KIS_IS_REAL ? 'TTTC0803U' : 'VTTC0803U';
    await kisPost(cancelTrId, '/uapi/domestic-stock/v1/trading/order-rvsecncl', {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      KRX_FWDG_ORD_ORGNO: '',
      ORGN_ODNO: order.reissuedOrdNo ?? order.ordNo,
      ORD_DVSN: '00',
      RVSE_CNCL_DVSN_CD: '02',
      ORD_QTY: quantity.toString(),
      ORD_UNPR: '0',
      QTY_ALL_ORD_YN: 'Y',
      PDNO: order.stockCode.padStart(6, '0'),
    }).catch(() => { /* 이미 취소/체결됐을 수 있음 — 무시 */ });

    // 시장가 매도 즉시 재발행
    const orderData = await kisPost(SELL_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO: order.stockCode.padStart(6, '0'),
      ORD_DVSN: '01',   // 시장가
      ORD_QTY: quantity.toString(),
      ORD_UNPR: '0',
      SLL_BUY_DVSN_CD: '01',
      CTAC_TLNO: '',
      MGCO_APTM_ODNO: '',
      ORD_SVR_DVSN_CD: '0',
    });

    const newOrdNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO;
    order.reissuedOrdNo = newOrdNo ?? undefined;
    order.orderType = 'MARKET';
    // 재발행된 주문을 새로 추적 — pollCount 리셋
    order.pollCount = 0;
    order.status = 'PENDING';

    console.log(`[SellFillMonitor] 🔄 ${order.stockName} 시장가 재발행 완료 — 새 ODNO: ${newOrdNo}`);
    await sendTelegramAlert(
      `🔄 <b>[매도 재발행]</b> ${order.stockName} (${order.stockCode})\n` +
      `미체결 → 시장가 즉시 재발행 ${quantity}주\n` +
      `구 ODNO: ${order.ordNo} → 신 ODNO: ${newOrdNo ?? 'N/A'}`,
      { priority: 'HIGH' },
    ).catch(console.error);
  } catch (err) {
    order.status = 'FAILED';
    console.error(`[SellFillMonitor] 시장가 재발행 실패:`, err instanceof Error ? err.message : err);

    // ── PROVISIONAL fill 되돌림 (선반영 수정) ─────────────────────────────
    // exitEngine 이 주문 접수 직후 "선반영" 했던 SELL fill 을 되돌린다. 이 경로는
    // 체결이 전혀 일어나지 않았을 때만 안전하다: order.fillQty > 0 (부분 체결 누적)
    // 인 경우엔 일부는 실제로 매도됐으므로 되돌리면 안 된다. CCLD 재폴링을 포기하고
    // 운영자의 수동 개입을 요청한다.
    const alreadyFilled = (order.fillQty ?? 0) > 0;
    let revertedMsg = '';
    if (!alreadyFilled && order.relatedTradeId) {
      try {
        const trades = loadShadowTrades();
        const trade = trades.find(t => t.id === order.relatedTradeId);
        const reverted = trade
          ? revertProvisionalFill(trade, order.ordNo, `재발행 실패: ${err instanceof Error ? err.message : String(err)}`)
          : false;
        if (reverted) {
          saveShadowTrades(trades);
          revertedMsg = '\n↩️ 선반영 Fill 되돌림 — 잔량/플래그 복구됨.';
          console.warn(`[SellFillMonitor] ↩️ PROVISIONAL fill 되돌림 — ${order.stockName} ordNo=${order.ordNo}`);
        }
      } catch (revertErr) {
        console.error('[SellFillMonitor] 되돌림 실패:', revertErr instanceof Error ? revertErr.message : revertErr);
      }
    } else if (alreadyFilled) {
      revertedMsg = `\n⚠️ 부분 체결 ${order.fillQty}주 반영 상태 — 되돌림 금지, 수동 확인 필수.`;
    }

    await sendTelegramAlert(
      `🚨 <b>[긴급] ${order.stockName} 매도 재발행 실패!</b>\n` +
      `수동으로 즉시 매도하세요!\n` +
      `오류: ${err instanceof Error ? err.message : String(err)}` +
      revertedMsg,
      { priority: 'CRITICAL' },
    ).catch(console.error);
  }
}

export { pollSellFills as pollSellFillsOnce };

