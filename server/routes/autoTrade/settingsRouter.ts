/**
 * @responsibility 트레이딩 설정과 세션 상태의 저장·복원 엔드포인트 제공
 *
 * 엔드포인트:
 *   GET  /auto-trade/trading-settings — 현재 트레이딩 설정
 *   POST /auto-trade/trading-settings — 트레이딩 설정 저장
 *   GET  /session-state               — 마지막 세션 상태 조회
 *   POST /session-state               — 현재 세션 상태 저장
 */
import { Router } from 'express';
import {
  loadTradingSettings,
  saveTradingSettings,
  loadSessionState,
  saveSessionState,
  type TradingSettings,
  type SessionState,
} from '../../persistence/tradingSettingsRepo.js';

const router = Router();

router.get('/auto-trade/trading-settings', (_req: any, res: any) => {
  res.json(loadTradingSettings());
});

router.post('/auto-trade/trading-settings', (req: any, res: any) => {
  try {
    const settings = req.body as TradingSettings;
    saveTradingSettings(settings);
    res.json({ ok: true, settings: loadTradingSettings() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/session-state', (_req: any, res: any) => {
  const state = loadSessionState();
  if (!state) return res.json({ restored: false });
  res.json({ restored: true, ...state });
});

router.post('/session-state', (req: any, res: any) => {
  try {
    const state = req.body as SessionState;
    saveSessionState(state);
    res.json({ ok: true, savedAt: state.savedAt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
