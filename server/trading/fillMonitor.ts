import fs from 'fs';
import { PENDING_ORDERS_FILE, PENDING_SELL_ORDERS_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadShadowTrades, saveShadowTrades, appendFill } from '../persistence/shadowTradeRepo.js';
import { kisGet, kisPost, fetchCurrentPrice, KIS_IS_REAL, SELL_TR_ID } from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { registerOcoPair } from './ocoCloseLoop.js';

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
      appendFill(trade, {
        type: 'BUY',
        subType: 'INITIAL_BUY',
        qty: opts.fillQty,
        price: opts.fillPrice,
        reason: '진입 체결 확인',
        timestamp: new Date().toISOString(),
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
      console.error('[FillMonitor] KIS 미체결 조회 실패:', e instanceof Error ? e.message : e);
      return;
    }

    const unfilledMap = new Map((data?.output ?? []).map(o => [o.odno, o]));
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
    console.error('[SellFillMonitor] CCLD 조회 실패:', e instanceof Error ? e.message : e);
    return;
  }

  const ccldMap = new Map((ccldData?.output ?? []).map(o => [o.odno, o]));
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

        // shadow.status 최종 전환 — exitEngine이 이미 HIT_STOP/HIT_TARGET 설정했으므로 추가 전환 불필요
        // 단, 로그 기록으로 체결 확인 표시
        await sendTelegramAlert(
          `✅ <b>[매도 체결 확인]</b> ${order.stockName} (${order.stockCode})\n` +
          `체결: ${filledQty}주 @${avgPrice.toLocaleString()}원\n` +
          `사유: ${order.originalReason} | 주문번호: ${order.ordNo}`,
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
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${order.stockName} 매도 재발행 실패!</b>\n` +
      `수동으로 즉시 매도하세요!\n` +
      `오류: ${err instanceof Error ? err.message : String(err)}`,
      { priority: 'CRITICAL' },
    ).catch(console.error);
  }
}

export { pollSellFills as pollSellFillsOnce };
