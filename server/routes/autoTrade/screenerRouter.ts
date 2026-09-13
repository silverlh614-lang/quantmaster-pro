/**
 * @responsibility 수동 스캔·드라이런·스크리너·워치리스트 자동채움·DART 폴링 트리거 엔드포인트 제공
 *
 * 엔드포인트:
 *   POST /auto-trade/scan             — 즉시 수동 스캔 트리거
 *   POST /auto-trade/dry-run          — 현행 관측·전략 상태 조회
 *   GET  /auto-trade/screener         — 스크리너 캐시 조회
 *   POST /auto-trade/screener/run     — 현행 관측·전략 스캔 실행
 *   POST /auto-trade/populate         — 현행 관측 스캔 실행과 기존 워치리스트 조회
 *   GET  /auto-trade/dart-alerts      — DART 알림 조회
 *   POST /auto-trade/dart-alerts/poll — DART 수동 폴링
 */
import { Router } from 'express';
import { runAutoSignalScan } from '../../trading/signalScanner.js';
import { getPaperExperimentView } from '../../trading/paper/paperExperimentRunner.js';
import {
  getScreenerCache,
} from '../../screener/stockScreener.js';
import { loadWatchlist } from '../../persistence/watchlistRepo.js';
import { getDartAlerts } from '../../persistence/dartRepo.js';
import { pollDartDisclosures } from '../../alerts/dartPoller.js';

const router = Router();

router.post('/auto-trade/scan', async (_req: any, res: any) => {
  try {
    await runAutoSignalScan();
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/auto-trade/dry-run', async (_req: any, res: any) => {
  try {
    const result = getPaperExperimentView();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/auto-trade/screener', (_req: any, res: any) => {
  res.json(getScreenerCache());
});

router.post('/auto-trade/screener/run', async (_req: any, res: any) => {
  try {
    const result = await runAutoSignalScan();
    res.json({ ok: true, model: 'PAPER_NEWS_MA20', result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/auto-trade/populate', async (_req: any, res: any) => {
  try {
    const result = await runAutoSignalScan();
    res.json({ ok: true, model: 'PAPER_NEWS_MA20', result, watchlist: loadWatchlist() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/auto-trade/dart-alerts', (_req: any, res: any) => {
  res.json(getDartAlerts());
});

router.post('/auto-trade/dart-alerts/poll', async (_req: any, res: any) => {
  try {
    await pollDartDisclosures();
    res.json({ ok: true, alerts: getDartAlerts().slice(-20) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
