/**
 * @responsibility 분할 매수 트랜치와 OCO 주문 쌍의 조회·수동 실행 엔드포인트 제공
 *
 * 엔드포인트:
 *   GET  /auto-trade/tranches      — 미체결 트랜치 조회
 *   POST /auto-trade/tranches/run  — 트랜치 수동 체크/실행
 *   GET  /auto-trade/oco-orders    — 활성 OCO + 최근 이력
 */
import { Router } from 'express';
import { trancheExecutor } from '../../trading/trancheExecutor.js';
import { getActiveOcoOrders, getAllOcoOrders } from '../../trading/ocoCloseLoop.js';

const router = Router();

router.get('/auto-trade/tranches', (_req: any, res: any) => {
  res.json(trancheExecutor.getPendingTranches());
});

router.post('/auto-trade/tranches/run', async (_req: any, res: any) => {
  // PR-52 H1: AUTO_TRADE_ENABLED 가드 — 자동매매 일시정지 상태에서 분할 매수 2·3차
  // LIVE 실주문 차단. trancheExecutor.checkPendingTranches() 본체에도 동일 가드가
  // 있어 심층 방어 — 라우터는 정확한 사유를 응답으로 즉시 반환한다.
  if (process.env.AUTO_TRADE_ENABLED !== 'true') {
    return res.status(403).json({
      error: 'AUTO_TRADE_ENABLED=false',
      reason: '자동매매가 일시정지 상태입니다. 분할 매수 2·3차 실행은 활성화 상태에서만 가능합니다.',
    });
  }
  try {
    await trancheExecutor.checkPendingTranches();
    res.json({ ok: true, pending: trancheExecutor.getPendingTranches() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/auto-trade/oco-orders', (_req: any, res: any) => {
  try {
    const active = getActiveOcoOrders();
    const all = getAllOcoOrders();
    res.json({ active, history: all.filter((o: any) => o.status !== 'ACTIVE').slice(-20) });
  } catch (_e: any) {
    res.json({ active: [], history: [] });
  }
});

export default router;
