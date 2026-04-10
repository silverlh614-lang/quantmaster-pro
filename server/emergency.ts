// server/emergency.ts
// 비상 정지 관련 유틸리티 — server.ts에서 분리
// cancelAllPendingOrders: KIS 미체결 주문 전량 취소
// checkDailyLossLimit: 일일 손실 한도 도달 시 비상 정지 발동
import { getKisToken, getKisBase } from './clients/kisClient.js';
import {
  getEmergencyStop, setEmergencyStop,
  getDailyLossPct,
} from './state.js';

// 미체결 주문 전량 취소 — KIS 미체결 조회 후 취소 (서버사이드 직접 호출)
export async function cancelAllPendingOrders(): Promise<void> {
  if (!process.env.KIS_APP_KEY) return;
  console.error('[EMERGENCY] KIS 미체결 주문 전량 취소 시작');
  try {
    const token = await getKisToken();
    const isReal = process.env.KIS_IS_REAL === 'true';
    const base   = getKisBase();
    const trId   = isReal ? 'TTTC0688R' : 'VTTC0688R'; // 미체결 조회

    const res = await fetch(
      `${base}/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl?` +
      new URLSearchParams({
        CANO: process.env.KIS_ACCOUNT_NO ?? '',
        ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
        CTX_AREA_FK100: '', CTX_AREA_NK100: '',
        INQR_DVSN_1: '0', INQR_DVSN_2: '0',
      }),
      { headers: {
        Authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!, appsecret: process.env.KIS_APP_SECRET!,
        tr_id: trId, custtype: 'P', 'Content-Type': 'application/json',
      }}
    );
    const data = await res.json() as { output?: { odno: string; pdno: string; ord_qty: string }[] };
    const orders = data.output ?? [];
    console.error(`[EMERGENCY] 미체결 주문 ${orders.length}건 취소 처리`);

    const cancelTrId = isReal ? 'TTTC0803U' : 'VTTC0803U';
    for (const o of orders) {
      await fetch(`${base}/uapi/domestic-stock/v1/trading/order-rvsecncl`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          appkey: process.env.KIS_APP_KEY!, appsecret: process.env.KIS_APP_SECRET!,
          tr_id: cancelTrId, custtype: 'P', 'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          CANO: process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          KRX_FWDG_ORD_ORGNO: '', ORGN_ODNO: o.odno,
          ORD_DVSN: '00', RVSE_CNCL_DVSN_CD: '02',
          ORD_QTY: o.ord_qty, ORD_UNPR: '0', QTY_ALL_ORD_YN: 'Y', PDNO: o.pdno,
        }),
      }).catch((e) => console.error(`[EMERGENCY] 취소 실패 ODNO ${o.odno}:`, e));
    }
    console.error('[EMERGENCY] 미체결 전량 취소 완료');
  } catch (e) {
    console.error('[EMERGENCY] cancelAllPendingOrders 실패:', e);
  }
}

export async function checkDailyLossLimit(): Promise<void> {
  const limit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
  if (getDailyLossPct() >= limit && !getEmergencyStop()) {
    setEmergencyStop(true);
    console.error(`[EMERGENCY] 일일 손실 한도 도달 (${getDailyLossPct().toFixed(2)}% ≥ ${limit}%) — 자동매매 중단`);
    await cancelAllPendingOrders();
    const { generateDailyReport } = await import('../src/server/autoTradeEngine.js');
    await generateDailyReport().catch(console.error);
  }
}
