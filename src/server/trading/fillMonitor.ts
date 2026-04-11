import fs from 'fs';
import { PENDING_ORDERS_FILE, ensureDataDir } from '../persistence/paths.js';
import { kisGet, kisPost, fetchCurrentPrice, KIS_IS_REAL } from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

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

export class FillMonitor {
  /** LIVE 주문 후 호출 — pending-orders.json에 추가 */
  addOrder(order: Omit<PendingOrder, 'pollCount' | 'status'>): void {
    const orders = loadPendingOrders();
    if (orders.some(o => o.ordNo === order.ordNo)) return; // 중복 방지
    orders.push({ ...order, pollCount: 0, status: 'PENDING' });
    savePendingOrders(orders);
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

    const unfilledOdnoSet = new Set((data?.output ?? []).map(o => o.odno));
    let changed = false;

    for (const order of pending) {
      order.pollCount++;

      if (!unfilledOdnoSet.has(order.ordNo)) {
        // KIS 미체결 목록에 없음 → 체결 완료
        const fillPrice = await fetchCurrentPrice(order.stockCode).catch(() => null) ?? order.orderPrice;
        Object.assign(order, {
          status: 'FILLED', fillPrice, fillQty: order.quantity,
          filledAt: new Date().toISOString(),
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
      } else if (order.pollCount >= FILL_POLL_MAX) {
        // 10회 폴링 초과 → 만료 처리 (장 마감 취소와 별도)
        order.status = 'EXPIRED';
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
