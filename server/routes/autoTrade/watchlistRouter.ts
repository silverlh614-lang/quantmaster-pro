/**
 * @responsibility 자동매매·장중 워치리스트의 CRUD 엔드포인트 제공
 *
 * 엔드포인트:
 *   GET    /auto-trade/watchlist             — 전체 조회
 *   POST   /auto-trade/watchlist             — 추가/갱신 (신규는 채널 알림)
 *   DELETE /auto-trade/watchlist/:code       — 제거 (채널 알림)
 *   GET    /auto-trade/watchlist/intraday    — 장중 워치리스트 조회
 *   DELETE /auto-trade/watchlist/intraday/:code — 장중 워치리스트 제거
 */
import { Router } from 'express';
import { loadWatchlist, saveWatchlist, type WatchlistEntry } from '../../persistence/watchlistRepo.js';
import { loadIntradayWatchlist, saveIntradayWatchlist } from '../../persistence/intradayWatchlistRepo.js';
import { loadMacroState } from '../../persistence/macroStateRepo.js';
import { channelWatchlistAdded, channelWatchlistRemoved } from '../../alerts/channelPipeline.js';

const router = Router();

router.get('/auto-trade/watchlist', (_req: any, res: any) => {
  res.json(loadWatchlist());
});

router.post('/auto-trade/watchlist', (req: any, res: any) => {
  const entry: WatchlistEntry = req.body;
  if (!entry.code || !entry.name) {
    return res.status(400).json({ error: 'code, name 필수' });
  }
  // 아이디어 6: 수동 추가 시 기본값 설정
  if (!entry.addedBy) entry.addedBy = 'MANUAL';
  if (entry.entryPrice && entry.stopLoss && entry.targetPrice && !entry.rrr) {
    const denom = entry.entryPrice - entry.stopLoss;
    entry.rrr = denom > 0
      ? parseFloat(((entry.targetPrice - entry.entryPrice) / denom).toFixed(2))
      : 0;
  }
  const list = loadWatchlist();
  const idx = list.findIndex((e) => e.code === entry.code);
  const isNew = idx < 0;
  if (idx >= 0) list[idx] = entry; else list.push({ ...entry, addedAt: new Date().toISOString() });
  saveWatchlist(list);

  // 채널 알림: 신규 추가 시에만 발송 (기존 종목 업데이트는 노이즈)
  if (isNew) {
    const macro = loadMacroState();
    channelWatchlistAdded(
      [{
        name: entry.name,
        code: entry.code,
        price: entry.entryPrice ?? 0,
        changePercent: 0,
        gateScore: entry.gateScore ?? 0,
        sector: entry.sector,
        entryPrice: entry.entryPrice,
        stopLoss: entry.stopLoss,
        targetPrice: entry.targetPrice,
        rrr: entry.rrr,
      }],
      macro?.regime ?? 'UNKNOWN',
    ).catch(console.error);
  }

  res.json({ ok: true, count: list.length });
});

router.delete('/auto-trade/watchlist/:code', (req: any, res: any) => {
  const currentList = loadWatchlist();
  const removed = currentList.find((e) => e.code === req.params.code);
  const list = currentList.filter((e) => e.code !== req.params.code);
  saveWatchlist(list);

  if (removed) {
    channelWatchlistRemoved(
      { name: removed.name, code: removed.code },
      list.length,
    ).catch(console.error);
  }

  res.json({ ok: true, count: list.length });
});

router.get('/auto-trade/watchlist/intraday', (_req: any, res: any) => {
  res.json(loadIntradayWatchlist());
});

router.delete('/auto-trade/watchlist/intraday/:code', (req: any, res: any) => {
  const list = loadIntradayWatchlist().filter((e) => e.code !== req.params.code);
  saveIntradayWatchlist(list);
  res.json({ ok: true, count: list.length });
});

export default router;
