// @responsibility: /cancel <code> — 종목별 미체결 주문 KIS 취소 (TTTC0803U/VTTC0803U). TRD.
import { fillMonitor } from '../../../trading/fillMonitor.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const cancel: TelegramCommand = {
  name: '/cancel',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '종목 미체결 주문 취소 (KIS 직접 호출)',
  usage: '/cancel <code 6자리>',
  async execute({ args, reply }) {
    const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
    if (!code || code.length !== 6) {
      await reply('❌ 사용법: /cancel 005380 (종목코드 6자리)');
      return;
    }
    const pendingOrders = fillMonitor
      .getPendingOrders()
      .filter(o => (o.status === 'PENDING' || o.status === 'PARTIAL') && o.stockCode === code);
    if (pendingOrders.length === 0) {
      await reply(`⚠️ ${code} 미체결 주문 없음`);
      return;
    }
    await reply(
      `🚫 ${code} 미체결 ${pendingOrders.length}건 취소 처리 중...\n` +
      pendingOrders
        .map(o => `• ${o.stockName} ${o.quantity}주 @${o.orderPrice.toLocaleString()}`)
        .join('\n'),
    );
    // KIS 단건 취소 실행 — 동적 import 로 순환 참조 차단.
    const { kisPost, KIS_IS_REAL } = await import('../../../clients/kisClient.js');
    const cancelTrId = KIS_IS_REAL ? 'TTTC0803U' : 'VTTC0803U';
    for (const o of pendingOrders) {
      try {
        await kisPost(cancelTrId, '/uapi/domestic-stock/v1/trading/order-rvsecncl', {
          CANO: process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          KRX_FWDG_ORD_ORGNO: '',
          ORGN_ODNO: o.ordNo,
          ORD_DVSN: '00',
          RVSE_CNCL_DVSN_CD: '02',
          ORD_QTY: o.quantity.toString(),
          ORD_UNPR: '0',
          QTY_ALL_ORD_YN: 'Y',
          PDNO: code.padStart(6, '0'),
        });
      } catch (e) {
        console.error(
          `[TelegramBot] 취소 실패 ODNO=${o.ordNo}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    await reply(`✅ ${code} 미체결 주문 ${pendingOrders.length}건 취소 요청 완료`);
  },
};

commandRegistry.register(cancel);

export default cancel;
