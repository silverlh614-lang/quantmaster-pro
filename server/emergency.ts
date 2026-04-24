// server/emergency.ts
/**
 * @responsibility 비상 정지 유틸 - 미체결 주문 취소와 일일 손실 한도 감시
 *
 * PR-4 A: raw fetch 제거. CLAUDE.md 절대 규칙 #2 "kisClient 단일 통로" 준수.
 * kisGet/kisPost 경유로 토큰 자동 갱신·서킷 브레이커·레이트 리미터를 일관 적용.
 */

import { kisGet, kisPost } from './clients/kisClient.js';
import {
  getEmergencyStop, setEmergencyStop,
  getDailyLossPct,
} from './state.js';

interface PendingOrder {
  odno:    string;
  pdno:    string;
  ord_qty: string;
}

/**
 * 미체결 주문 전량 취소 — KIS 미체결 조회(TTTC0688R/VTTC0688R) 후 하나씩 취소.
 *
 * LIVE/VTS 모드는 kisClient 의 assertModeCompatible 가 자동으로 TR ID 와 매칭을
 * 검증한다. 서킷 차단·토큰 갱신 실패 시 kisGet/kisPost 가 throw 하므로 try/catch
 * 로 감싸 비상 정지 자체가 멈추지 않게 유지.
 */
export async function cancelAllPendingOrders(): Promise<void> {
  if (!process.env.KIS_APP_KEY) return;
  console.error('[EMERGENCY] KIS 미체결 주문 전량 취소 시작');

  const isReal   = process.env.KIS_IS_REAL === 'true';
  const inquireTr = isReal ? 'TTTC0688R' : 'VTTC0688R';
  const cancelTr  = isReal ? 'TTTC0803U' : 'VTTC0803U';

  try {
    const data = await kisGet(
      inquireTr,
      '/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl',
      {
        CANO:           process.env.KIS_ACCOUNT_NO ?? '',
        ACNT_PRDT_CD:   process.env.KIS_ACCOUNT_PROD ?? '01',
        CTX_AREA_FK100: '',
        CTX_AREA_NK100: '',
        INQR_DVSN_1:    '0',
        INQR_DVSN_2:    '0',
      },
      'HIGH',
    ) as { output?: PendingOrder[] } | null;

    const orders = data?.output ?? [];
    console.error(`[EMERGENCY] 미체결 주문 ${orders.length}건 취소 처리`);

    for (const o of orders) {
      await kisPost(
        cancelTr,
        '/uapi/domestic-stock/v1/trading/order-rvsecncl',
        {
          CANO:                process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD:        process.env.KIS_ACCOUNT_PROD ?? '01',
          KRX_FWDG_ORD_ORGNO:  '',
          ORGN_ODNO:           o.odno,
          ORD_DVSN:            '00',
          RVSE_CNCL_DVSN_CD:   '02',
          ORD_QTY:             o.ord_qty,
          ORD_UNPR:            '0',
          QTY_ALL_ORD_YN:      'Y',
          PDNO:                o.pdno,
        },
      ).catch((e: unknown) =>
        console.error(
          `[EMERGENCY] 취소 실패 ODNO ${o.odno}:`,
          e instanceof Error ? e.message : e,
        ),
      );
    }
    console.error('[EMERGENCY] 미체결 전량 취소 완료');
  } catch (e) {
    console.error(
      '[EMERGENCY] cancelAllPendingOrders 실패:',
      e instanceof Error ? e.message : e,
    );
  }
}

export async function checkDailyLossLimit(): Promise<void> {
  const limit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
  if (getDailyLossPct() >= limit && !getEmergencyStop()) {
    setEmergencyStop(true);
    const lossPct = getDailyLossPct().toFixed(2);
    console.error(`[EMERGENCY] 일일 손실 한도 도달 (${lossPct}% ≥ ${limit}%) — 자동매매 중단`);
    await cancelAllPendingOrders();
    const { generateDailyReport } = await import('./alerts/reportGenerator.js');
    await generateDailyReport().catch(console.error);

    // SYSTEM 채널로 비상 정지 사실을 즉시 브로드캐스트 — CRITICAL 로 cooldown 우회.
    // 이전엔 개인 chat 만 알았으나, 운영 콘솔(SYSTEM 채널) 구독자도 즉시 알 수 있어야 한다.
    try {
      const { dispatchAlert } = await import('./alerts/alertRouter.js');
      const { AlertCategory } = await import('./alerts/alertCategories.js');
      await dispatchAlert(
        AlertCategory.SYSTEM,
        `🚨 <b>[비상 정지 자동 발동]</b>\n` +
        `사유: 일일 손실 한도 도달 (${lossPct}% ≥ ${limit}%)\n` +
        `미체결 주문 전량 취소 완료. /reset 으로 재개 가능.`,
        { priority: 'CRITICAL', dedupeKey: 'daily_loss_emergency_stop' },
      );
    } catch (e) {
      console.error('[EMERGENCY] SYSTEM 채널 발송 실패:', e);
    }
  }
}
