/**
 * @responsibility 시장 원자료 API 제공
 *
 * 엔드포인트:
 *   GET  /macro/state    — 현재 MacroState
 *   GET  /macro/refresh  — KOSPI/SPX/DXY/USD-KRW + FSS 자동 갱신
 *   POST /macro/state    — 레짐 저장 폐기(410)
 *   GET  /fss/records    — 일별 외국인 수급 기록
 *   POST /fss/records    — 일별 기록 추가/갱신
 *   GET  /fss/score      — 최근 5일 FSS 점수 계산
 */
import { Router } from 'express';
import { loadMacroState, saveMacroState } from '../../persistence/macroStateRepo.js';
import { loadFssRecords, upsertFssRecord } from '../../persistence/fssRepo.js';
import { refreshMarketRegimeVars } from '../../trading/marketDataRefresh.js';

const router = Router();

router.get('/fss/records', (_req: any, res: any) => {
  res.json(loadFssRecords());
});

router.post('/fss/records', (req: any, res: any) => {
  const { date, passiveNetBuy, activeNetBuy } = req.body;
  if (!date || typeof passiveNetBuy !== 'number' || typeof activeNetBuy !== 'number') {
    return res.status(400).json({
      error: 'date(YYYY-MM-DD), passiveNetBuy(number), activeNetBuy(number) 필수',
    });
  }
  const updated = upsertFssRecord({ date, passiveNetBuy, activeNetBuy });
  res.json({ ok: true, records: updated });
});

router.get('/fss/score', (_req: any, res: any) => {
  const records = loadFssRecords();
  if (records.length === 0) {
    return res.json({ cumulativeScore: null, alertLevel: null, message: 'FSS 데이터 없음' });
  }
  // 최근 5일만 추출하여 점수 계산 (클라이언트 computeFSS와 동일 로직)
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date)).slice(-5);
  const dailyScores: number[] = sorted.map(r => {
    const ps = r.passiveNetBuy < 0;
    const as_ = r.activeNetBuy < 0;
    const pb = r.passiveNetBuy > 0;
    const ab = r.activeNetBuy > 0;
    if (ps && as_) return -3;
    if (pb && ab) return 3;
    if (ps || as_) return -1;
    if (pb || ab) return 1;
    return 0;
  });
  const cum = dailyScores.reduce((s, v) => s + v, 0);
  const alertLevel = cum <= -5 ? 'HIGH_ALERT' : cum <= -3 ? 'CAUTION' : 'NORMAL';
  // MacroState에 캐싱
  const macro = loadMacroState();
  if (macro) {
    macro.fss = cum;
    macro.fssAlertLevel = alertLevel;
    saveMacroState(macro);
  }
  res.json({ cumulativeScore: cum, alertLevel, dailyScores: sorted });
});

router.get('/macro/state', (_req: any, res: any) => {
  const state = loadMacroState();
  if (!state) return res.json({ updatedAt: null, regimeStatus: 'RETIRED' });
  const { regime: _regime, bearDefenseMode: _bear, bearRegimeTriggeredCount: _count, ips: _ips, ...data } = state;
  res.json({ ...data, regimeStatus: 'RETIRED' });
});

/** 시장 지표 자동 갱신 — KOSPI/SPX/DXY/USD-KRW Yahoo Finance + FSS 수급 계산 */
router.get('/macro/refresh', async (_req: any, res: any) => {
  try {
    const computed = await refreshMarketRegimeVars('MANUAL');
    res.json({ ok: true, computed, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[MacroRefresh] 오류:', err);
    res.status(500).json({ error: String(err) });
  }
});

// The old client wrote a market regime and triggered Bear/IPS policy. That API is retired.
router.post('/macro/state', (_req: any, res: any) => {
  res.status(410).json({ error: 'REGIME_RETIRED', message: '레짐 판정·정책 저장은 폐기되었습니다. 시장 데이터는 /macro/refresh에서 수집합니다.' });
});

export default router;
