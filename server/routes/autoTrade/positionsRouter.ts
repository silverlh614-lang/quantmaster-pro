/**
 * @responsibility fills 기반 포지션 집계·이벤트 타임라인·일일 Reconciliation 엔드포인트 제공
 *
 * 엔드포인트:
 *   GET  /auto-trade/positions               — 집계 뷰 (open/closed/limit 필터)
 *   GET  /auto-trade/positions/:id/events    — 특정 포지션의 TradeEvent 시퀀스
 *   GET  /auto-trade/reconcile               — 마지막 Reconciliation 결과
 *   POST /auto-trade/reconcile               — 즉시 Reconciliation 실행
 */
import { Router } from 'express';
import { aggregateAllPositions } from '../../trading/positionAggregator.js';
import { loadTradeEventsForPosition } from '../../trading/tradeEventLog.js';
import { runDailyReconciliation, loadLastReconcileResult } from '../../trading/reconciliationEngine.js';
import { getDataIntegrityBlocked } from '../../state.js';

const router = Router();

/**
 * GET /api/auto-trade/positions — fills 기반 집계 뷰 (PositionSummary[])
 * ?closed=true  : 완결 포지션만
 * ?open=true    : 보유중·부분청산만
 * ?limit=N      : 최신 N개 (기본 100)
 */
router.get('/auto-trade/positions', (req: any, res: any) => {
  const wantClosed = req.query.closed === 'true';
  const wantOpen   = req.query.open   === 'true';
  const limit      = Math.min(parseInt(req.query.limit ?? '100', 10), 500);

  let summaries = aggregateAllPositions();

  if (wantClosed) summaries = summaries.filter((s) => s.stage === 'CLOSED');
  else if (wantOpen) summaries = summaries.filter((s) => s.remainingQty > 0);

  res.json(summaries.slice(0, limit));
});

/**
 * 감사 추적 뷰어용. 현재 월 + 직전 월을 검색하므로 최대 2개월 이력 커버.
 */
router.get('/auto-trade/positions/:id/events', (req: any, res: any) => {
  try {
    const events = loadTradeEventsForPosition(req.params.id);
    res.json(events);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/auto-trade/reconcile', (_req: any, res: any) => {
  const last = loadLastReconcileResult();
  res.json({
    last,
    dataIntegrityBlocked: getDataIntegrityBlocked(),
  });
});

router.post('/auto-trade/reconcile', async (_req: any, res: any) => {
  try {
    const result = await runDailyReconciliation({ silent: false });
    res.json({ ok: true, ...result, dataIntegrityBlocked: getDataIntegrityBlocked() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
