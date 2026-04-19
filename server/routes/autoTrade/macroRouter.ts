/**
 * @responsibility Macro 시장 상태(MHS·Regime)와 FSS 외국인 수급 점수의 저장·조회·갱신 엔드포인트 제공
 *
 * 엔드포인트:
 *   GET  /macro/state    — 현재 MacroState
 *   GET  /macro/refresh  — KOSPI/SPX/DXY/USD-KRW + FSS 자동 갱신
 *   POST /macro/state    — MHS·regime + 보조 지표 머지 저장
 *   GET  /fss/records    — 일별 외국인 수급 기록
 *   POST /fss/records    — 일별 기록 추가/갱신
 *   GET  /fss/score      — 최근 5일 FSS 점수 계산
 */
import { Router } from 'express';
import { loadMacroState, saveMacroState, type MacroState } from '../../persistence/macroStateRepo.js';
import { loadFssRecords, upsertFssRecord } from '../../persistence/fssRepo.js';
import { pollBearRegime } from '../../alerts/bearRegimeAlert.js';
import { pollIpsAlert } from '../../alerts/ipsAlert.js';
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
  if (!state) return res.json({ mhs: null, regime: 'UNKNOWN', updatedAt: null });
  res.json(state);
});

/** 시장 지표 자동 갱신 — KOSPI/SPX/DXY/USD-KRW Yahoo Finance + FSS 수급 계산 */
router.get('/macro/refresh', async (_req: any, res: any) => {
  try {
    const computed = await refreshMarketRegimeVars();
    res.json({ ok: true, computed, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[MacroRefresh] 오류:', err);
    res.status(500).json({ error: String(err) });
  }
});

router.post('/macro/state', (req: any, res: any) => {
  const b = req.body;
  if (typeof b.mhs !== 'number' || b.mhs < 0 || b.mhs > 100) {
    return res.status(400).json({ error: 'mhs는 0~100 사이 숫자여야 합니다' });
  }
  const validRegimes = ['GREEN', 'YELLOW', 'RED'];
  const finalRegime = validRegimes.includes(b.regime) ? b.regime
    : (b.mhs >= 60 ? 'GREEN' : b.mhs >= 30 ? 'YELLOW' : 'RED');

  // ── 기존 상태와 MERGE — 서버 시장데이터 갱신 결과를 프론트 POST로 덮어쓰지 않음 ──
  const existing = loadMacroState() ?? {} as MacroState;
  const state: MacroState = { ...existing, mhs: b.mhs, regime: finalRegime, updatedAt: new Date().toISOString() };

  // ─── Bear Regime / IPS 보조 지표 ─────────────────────────────────────────
  const num  = (k: string) => typeof b[k] === 'number';
  const bool = (k: string) => typeof b[k] === 'boolean';
  if (num('vkospi'))                 state.vkospi                 = b.vkospi;
  if (num('foreignFuturesSellDays')) state.foreignFuturesSellDays = b.foreignFuturesSellDays;
  if (num('iri'))                    state.iri                    = b.iri;
  if (num('vix'))                    state.vix                    = b.vix;
  if (num('oeciCliKorea'))           state.oeciCliKorea           = b.oeciCliKorea;
  if (num('exportGrowth3mAvg'))      state.exportGrowth3mAvg      = b.exportGrowth3mAvg;
  if (num('bearRegimeTriggeredCount')) state.bearRegimeTriggeredCount = b.bearRegimeTriggeredCount;
  if (num('ips'))                    state.ips                    = b.ips;
  if (bool('vkospiRising'))          state.vkospiRising           = b.vkospiRising;
  if (bool('bearDefenseMode'))       state.bearDefenseMode        = b.bearDefenseMode;
  if (bool('dxyBullish'))            state.dxyBullish             = b.dxyBullish;
  if (bool('kospiBelow120ma'))       state.kospiBelow120ma        = b.kospiBelow120ma;
  if (b.mhsTrend === 'IMPROVING' || b.mhsTrend === 'STABLE' || b.mhsTrend === 'DETERIORATING')
    state.mhsTrend = b.mhsTrend;
  if (b.fssAlertLevel === 'NORMAL' || b.fssAlertLevel === 'CAUTION' || b.fssAlertLevel === 'HIGH_ALERT')
    state.fssAlertLevel = b.fssAlertLevel;
  if (num('fss')) state.fss = b.fss;

  // ─── RegimeVariables 7축 — classifyRegime()이 필요로 하는 필드 ────────────
  if (num('vkospiDayChange'))        state.vkospiDayChange        = b.vkospiDayChange;
  if (num('vkospi5dTrend'))          state.vkospi5dTrend          = b.vkospi5dTrend;
  if (num('usdKrw'))                 state.usdKrw                 = b.usdKrw;
  if (num('usdKrw20dChange'))        state.usdKrw20dChange        = b.usdKrw20dChange;
  if (num('usdKrwDayChange'))        state.usdKrwDayChange        = b.usdKrwDayChange;
  if (num('foreignNetBuy5d'))        state.foreignNetBuy5d        = b.foreignNetBuy5d;
  if (bool('passiveActiveBoth'))     state.passiveActiveBoth      = b.passiveActiveBoth;
  if (bool('kospiAbove20MA'))        state.kospiAbove20MA         = b.kospiAbove20MA;
  if (bool('kospiAbove60MA'))        state.kospiAbove60MA         = b.kospiAbove60MA;
  if (num('kospi20dReturn'))         state.kospi20dReturn         = b.kospi20dReturn;
  if (num('kospiDayReturn'))         state.kospiDayReturn         = b.kospiDayReturn;
  if (num('leadingSectorRS'))        state.leadingSectorRS        = b.leadingSectorRS;
  if (b.sectorCycleStage === 'EARLY' || b.sectorCycleStage === 'MID' ||
      b.sectorCycleStage === 'LATE'  || b.sectorCycleStage === 'TURNING')
    state.sectorCycleStage = b.sectorCycleStage;
  if (num('marginBalance5dChange'))  state.marginBalance5dChange  = b.marginBalance5dChange;
  if (num('shortSellingRatio'))      state.shortSellingRatio      = b.shortSellingRatio;
  if (num('spx20dReturn'))           state.spx20dReturn           = b.spx20dReturn;
  if (num('dxy5dChange'))            state.dxy5dChange            = b.dxy5dChange;

  saveMacroState(state);
  console.log(`[Macro] MHS 업데이트: ${b.mhs} (${finalRegime})`);
  pollBearRegime().catch(console.error);
  pollIpsAlert().catch(console.error);
  res.json({ ok: true, ...state });
});

export default router;
