// server/routes/autoTradeRouter.ts
// 자동매매 라우터 — server.ts에서 분리
// 포함 대상: /api/auto-trade/*, /api/macro/*, /api/shadow/*, /api/real-trade/*, /api/fss/*
import { Router } from 'express';
import { loadWatchlist, saveWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { loadMacroState, saveMacroState, type MacroState } from '../persistence/macroStateRepo.js';
import { getDartAlerts } from '../persistence/dartRepo.js';
import { loadFssRecords, upsertFssRecord } from '../persistence/fssRepo.js';
import { getShadowTrades } from '../orchestrator/tradingOrchestrator.js';
import { getScreenerCache, preScreenStocks, autoPopulateWatchlist } from '../screener/stockScreener.js';
import { getRecommendations, getMonthlyStats, evaluateRecommendations, isRealTradeReady } from '../learning/recommendationTracker.js';
import { pollDartDisclosures } from '../alerts/dartPoller.js';
import { pollBearRegime } from '../alerts/bearRegimeAlert.js';
import { pollIpsAlert } from '../alerts/ipsAlert.js';
import { trancheExecutor } from '../trading/trancheExecutor.js';
import { refreshMarketRegimeVars } from '../trading/marketDataRefresh.js';
import { runAutoSignalScan } from '../trading/signalScanner.js';

const router = Router();

// ─── 아이디어 4: FSS 외국인 수급 방향 전환 스코어 API ──────────────────────
// GET  /api/fss/records  — 저장된 일별 외국인 수급 기록 조회
// POST /api/fss/records  — 일별 외국인 수급 기록 추가/갱신
// GET  /api/fss/score    — 현재 FSS 점수 계산 결과 반환

router.get('/fss/records', (_req: any, res: any) => {
  const records = loadFssRecords();
  res.json(records);
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

// ─────────────────────────────────────────────────────────────
// 자동매매 워치리스트 REST API
// ─────────────────────────────────────────────────────────────

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
  if (idx >= 0) list[idx] = entry; else list.push({ ...entry, addedAt: new Date().toISOString() });
  saveWatchlist(list);
  res.json({ ok: true, count: list.length });
});

router.delete('/auto-trade/watchlist/:code', (req: any, res: any) => {
  const list = loadWatchlist().filter((e) => e.code !== req.params.code);
  saveWatchlist(list);
  res.json({ ok: true, count: list.length });
});

router.get('/auto-trade/shadow-trades', (_req: any, res: any) => {
  res.json(getShadowTrades());
});

// 즉시 수동 스캔 트리거 (체크리스트 Step 6 등에서 호출)
router.post('/auto-trade/scan', async (_req: any, res: any) => {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') {
    return res.status(403).json({ error: 'AUTO_TRADE_ENABLED=true 필요' });
  }
  try {
    await runAutoSignalScan();
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// [아이디어 4] 스크리너 캐시 조회 + 수동 실행
router.get('/auto-trade/screener', (_req: any, res: any) => {
  res.json(getScreenerCache());
});

router.post('/auto-trade/screener/run', async (_req: any, res: any) => {
  try {
    const results = await preScreenStocks();
    res.json({ ok: true, count: results.length, stocks: results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 수동 워치리스트 자동 채우기 트리거 (Yahoo Finance 기반)
router.post('/auto-trade/populate', async (_req: any, res: any) => {
  try {
    const added = await autoPopulateWatchlist();
    res.json({ ok: true, added, watchlist: loadWatchlist() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// [아이디어 6] DART 공시 알림 조회 + 수동 폴링
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

// ─────────────────────────────────────────────────────────────
// 아이디어 10: 추천 적중률 자기학습 — 이력 조회 + 수동 평가 트리거
// ─────────────────────────────────────────────────────────────

router.get('/auto-trade/recommendations', (_req: any, res: any) => {
  res.json(getRecommendations());
});

router.get('/auto-trade/recommendations/stats', (_req: any, res: any) => {
  res.json(getMonthlyStats());
});

// 수동 평가 트리거 (테스트 / 장 마감 후 즉시 확인 용도)
router.post('/auto-trade/recommendations/evaluate', async (_req: any, res: any) => {
  try {
    await evaluateRecommendations();
    res.json({ ok: true, stats: getMonthlyStats() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 아이디어 8: 분할 매수 트랜치 조회 + 수동 실행 ─────────────────────────────
router.get('/auto-trade/tranches', (_req: any, res: any) => {
  res.json(trancheExecutor.getPendingTranches());
});

router.post('/auto-trade/tranches/run', async (_req: any, res: any) => {
  try {
    await trancheExecutor.checkPendingTranches();
    res.json({ ok: true, pending: trancheExecutor.getPendingTranches() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 아이디어 10: 실거래 전환 준비 상태 조회 ─────────────────────────────────
router.get('/real-trade/status', (_req: any, res: any) => {
  res.json({ ready: isRealTradeReady(), kisIsReal: process.env.KIS_IS_REAL === 'true' });
});

// ─────────────────────────────────────────────────────────────
// 아이디어 8: Macro State API (MHS 저장/조회 — 서버 Gate 연동)
// ─────────────────────────────────────────────────────────────

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

  // ─── 선언적 필드 병합 — number / boolean / enum 타입별 일괄 처리 ───────────
  const numKeys: (keyof MacroState)[] = [
    // Bear / IPS 보조
    'vkospi', 'foreignFuturesSellDays', 'iri', 'vix',
    'oeciCliKorea', 'exportGrowth3mAvg', 'bearRegimeTriggeredCount', 'ips', 'fss',
    // RegimeVariables 7축
    'vkospiDayChange', 'vkospi5dTrend',
    'usdKrw', 'usdKrw20dChange', 'usdKrwDayChange',
    'foreignNetBuy5d', 'kospi20dReturn', 'kospiDayReturn',
    'leadingSectorRS', 'marginBalance5dChange', 'shortSellingRatio',
    'spx20dReturn', 'dxy5dChange',
  ];
  const boolKeys: (keyof MacroState)[] = [
    'vkospiRising', 'bearDefenseMode', 'dxyBullish', 'kospiBelow120ma',
    'passiveActiveBoth', 'kospiAbove20MA', 'kospiAbove60MA',
  ];
  for (const k of numKeys)  if (typeof b[k] === 'number')  (state as any)[k] = b[k];
  for (const k of boolKeys) if (typeof b[k] === 'boolean') (state as any)[k] = b[k];

  // enum 필드 — 허용 값 화이트리스트
  if (['IMPROVING', 'STABLE', 'DETERIORATING'].includes(b.mhsTrend))
    state.mhsTrend = b.mhsTrend;
  if (['NORMAL', 'CAUTION', 'HIGH_ALERT'].includes(b.fssAlertLevel))
    state.fssAlertLevel = b.fssAlertLevel;
  if (['EARLY', 'MID', 'LATE', 'TURNING'].includes(b.sectorCycleStage))
    state.sectorCycleStage = b.sectorCycleStage;

  saveMacroState(state);
  console.log(`[Macro] MHS 업데이트: ${b.mhs} (${finalRegime})`);
  pollBearRegime().catch(console.error);
  pollIpsAlert().catch(console.error);
  res.json({ ok: true, ...state });
});

// ─────────────────────────────────────────────────────────────
// 아이디어 3: Shadow 성과 대시보드 API (실거래 전환 판단 기준)
// ─────────────────────────────────────────────────────────────

router.get('/shadow/performance', (_req: any, res: any) => {
  const shadows = getShadowTrades();
  const closed = shadows.filter(
    (s: any) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP'
  );

  if (closed.length === 0) {
    return res.json({
      total: 0, winRate: 0, avgReturn: 0, avgWin: 0, avgLoss: 0,
      profitFactor: 0, sharpeRatio: 0, mdd: 0, avgHoldingDays: 0,
      readyForLive: false, reason: '결산 데이터 없음',
    });
  }

  const returns = closed.map((s: any) => s.returnPct ?? 0);
  const wins = returns.filter((r: number) => r > 0);
  const losses = returns.filter((r: number) => r <= 0);

  const avgReturn = returns.reduce((a: number, b: number) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(
    returns.map((r: number) => Math.pow(r - avgReturn, 2))
           .reduce((a: number, b: number) => a + b, 0) / returns.length
  );

  // 최대낙폭 (MDD) 계산
  let peak = 0, mdd = 0, cumReturn = 0;
  for (const r of returns) {
    cumReturn += r;
    peak = Math.max(peak, cumReturn);
    mdd = Math.min(mdd, cumReturn - peak);
  }

  // 평균 보유기간 (일)
  const holdingDays = closed
    .filter((s: any) => s.exitTime && s.signalTime)
    .map((s: any) => {
      const ms = new Date(s.exitTime).getTime() - new Date(s.signalTime).getTime();
      return ms / (1000 * 60 * 60 * 24);
    });
  const avgHoldingDays = holdingDays.length > 0
    ? holdingDays.reduce((a: number, b: number) => a + b, 0) / holdingDays.length
    : 0;

  const winRate = (wins.length / closed.length) * 100;
  const totalWin = wins.length > 0 ? wins.reduce((a: number, b: number) => a + b, 0) : 0;
  const totalLoss = losses.length > 0 ? losses.reduce((a: number, b: number) => a + b, 0) : 0;

  // 아이디어 4: 연속 손절 최대 횟수
  let maxConsecLoss = 0, streak = 0;
  for (const s of closed) {
    if ((s as any).status === 'HIT_STOP') { streak++; maxConsecLoss = Math.max(maxConsecLoss, streak); }
    else { streak = 0; }
  }

  const pf = parseFloat(Math.abs(totalWin / (totalLoss || 1)).toFixed(2));

  // 아이디어 4: 6개 전환 요건 체크리스트
  const checklist = {
    sampleSize:    { pass: closed.length >= 30,                             label: `건수 ${closed.length}/30` },
    winRate:       { pass: winRate >= 55,                                   label: `승률 ${winRate.toFixed(1)}%/55%` },
    profitFactor:  { pass: pf >= 1.5,                                       label: `PF ${pf}/1.5` },
    mdd:           { pass: mdd > -10,                                       label: `MDD ${mdd.toFixed(2)}%/-10%` },
    holdingPeriod: { pass: avgHoldingDays >= 3 && avgHoldingDays <= 15,     label: `보유 ${avgHoldingDays.toFixed(1)}일/3~15일` },
    consecLoss:    { pass: maxConsecLoss <= 3,                              label: `연속손절 ${maxConsecLoss}회/≤3회` },
  };
  const passCount = Object.values(checklist).filter(c => c.pass).length;
  const readyForLive = passCount === Object.keys(checklist).length;
  const reasons = Object.values(checklist).filter(c => !c.pass).map(c => c.label);

  res.json({
    total: closed.length,
    winRate: parseFloat(winRate.toFixed(1)),
    avgReturn: parseFloat(avgReturn.toFixed(2)),
    avgWin: wins.length > 0 ? parseFloat((totalWin / wins.length).toFixed(2)) : 0,
    avgLoss: losses.length > 0 ? parseFloat((totalLoss / losses.length).toFixed(2)) : 0,
    profitFactor: pf,
    sharpeRatio: parseFloat((stdDev > 0 ? avgReturn / stdDev : 0).toFixed(2)),
    mdd: parseFloat(mdd.toFixed(2)),
    avgHoldingDays: parseFloat(avgHoldingDays.toFixed(1)),
    maxConsecLoss,
    checklist,
    readyForLive,
    reason: readyForLive ? '실거래 전환 조건 충족 ✅' : reasons.join(' / '),
  });
});

export default router;
