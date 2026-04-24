/**
 * @responsibility 프론트 관심종목 동기화용 REST 엔드포인트 제공
 *
 * 엔드포인트:
 *   GET    /api/user-watchlist              — 전체 조회
 *   PUT    /api/user-watchlist              — 배열 전체 치환 (멱등)
 *   POST   /api/user-watchlist/toggle       — 단일 항목 토글 (add/remove)
 *   DELETE /api/user-watchlist/:code        — 단건 제거
 */

import { Router } from 'express';
import {
  loadUserWatchlist,
  saveUserWatchlist,
  toggleUserWatchlistItem,
  removeUserWatchlistItem,
  type UserWatchlistItem,
} from '../persistence/userWatchlistRepo.js';

const router = Router();

router.get('/api/user-watchlist', (_req: any, res: any) => {
  res.json({ items: loadUserWatchlist() });
});

router.put('/api/user-watchlist', (req: any, res: any) => {
  const body = req.body;
  const items: unknown = body?.items ?? body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items 배열 필수' });
  }
  const filtered = items.filter(
    (x): x is UserWatchlistItem =>
      !!x && typeof x === 'object'
      && typeof (x as any).code === 'string' && (x as any).code.length > 0
      && typeof (x as any).name === 'string' && (x as any).name.length > 0,
  );
  saveUserWatchlist(filtered);
  res.json({ ok: true, count: filtered.length, items: loadUserWatchlist() });
});

router.post('/api/user-watchlist/toggle', (req: any, res: any) => {
  const item = req.body as UserWatchlistItem | undefined;
  if (!item || typeof item.code !== 'string' || typeof item.name !== 'string') {
    return res.status(400).json({ error: 'code, name 필수' });
  }
  const result = toggleUserWatchlistItem(item);
  res.json({ ok: true, action: result.action, items: result.list });
});

router.delete('/api/user-watchlist/:code', (req: any, res: any) => {
  const code = String(req.params.code ?? '');
  if (!code) return res.status(400).json({ error: 'code 필수' });
  const result = removeUserWatchlistItem(code);
  res.json({ ok: result.removed, items: result.list });
});

export default router;
