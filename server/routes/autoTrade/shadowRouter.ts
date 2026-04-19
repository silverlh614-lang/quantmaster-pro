/**
 * @responsibility 섀도우 거래의 동기화·강제수정·성과·계좌·실시간가격·재조정 엔드포인트 제공
 *
 * 엔드포인트:
 *   GET   /auto-trade/shadow-trades              — 전체 조회
 *   POST  /auto-trade/shadow-trades              — 클라이언트 생성 trade 동기화
 *   PATCH /auto-trade/shadow-trades/:id/force    — 수량/가격 강제 입력 (감사 로그)
 *   GET   /shadow/performance                    — 결산 성과 + 6요건 체크리스트
 *   POST  /shadow/reconcile                      — fills 기반 quantity 재조정
 *   GET   /shadow/account                        — 전체 계좌 스냅샷 (현재가 포함)
 *   GET   /shadow/current-prices                 — 활성 포지션 현재가 맵
 */
import { Router } from 'express';
import { getShadowTrades } from '../../orchestrator/tradingOrchestrator.js';
import {
  loadShadowTrades,
  saveShadowTrades,
  getRemainingQty,
  appendShadowLog,
  type ServerShadowTrade,
} from '../../persistence/shadowTradeRepo.js';
import {
  computeShadowAccount,
  reconcileShadowQuantities,
} from '../../persistence/shadowAccountRepo.js';
import { loadTradingSettings } from '../../persistence/tradingSettingsRepo.js';
import { fetchCurrentPrice } from '../../clients/kisClient.js';
import { getRealtimePrice } from '../../clients/kisStreamClient.js';

const router = Router();

router.get('/auto-trade/shadow-trades', (_req: any, res: any) => {
  res.json(getShadowTrades());
});

/** POST /api/auto-trade/shadow-trades — 클라이언트에서 생성한 Shadow Trade를 서버에 동기화 */
router.post('/auto-trade/shadow-trades', (req: any, res: any) => {
  const trade = req.body;
  if (!trade || !trade.id || !trade.stockCode) {
    return res.status(400).json({ error: 'id, stockCode 필수' });
  }
  const shadows = loadShadowTrades();
  // 중복 방지: 같은 id가 이미 있으면 스킵
  if (shadows.some((s) => s.id === trade.id)) {
    return res.json({ ok: true, duplicate: true });
  }
  const serverTrade: ServerShadowTrade = {
    id: trade.id,
    stockCode: trade.stockCode,
    stockName: trade.stockName ?? '',
    signalTime: trade.signalTime ?? new Date().toISOString(),
    signalPrice: trade.signalPrice ?? 0,
    shadowEntryPrice: trade.shadowEntryPrice ?? 0,
    quantity: trade.quantity ?? 0,
    stopLoss: trade.stopLoss ?? 0,
    targetPrice: trade.targetPrice ?? 0,
    mode: 'SHADOW',
    status: trade.status ?? 'PENDING',
    watchlistSource: 'PRE_MARKET',
  };
  shadows.push(serverTrade);
  saveShadowTrades(shadows);
  res.json({ ok: true });
});

/**
 * Shadow 불일치 상황에서 사용자가 UI로부터 직접 수량·가격 등을
 * 강제 입력하여 서버 레코드와 동기화한다.
 *
 * 허용 필드: quantity, shadowEntryPrice, signalPrice, stopLoss, targetPrice.
 * 다른 필드는 무시하여 불변량(fills, originalQuantity 등)을 보호한다.
 * 변경된 값은 shadow 로그에 감사용으로 기록된다.
 */
router.patch('/auto-trade/shadow-trades/:id/force', (req: any, res: any) => {
  const { id } = req.params;
  const patch = req.body ?? {};
  if (!id) return res.status(400).json({ error: 'id 필수' });

  const shadows = loadShadowTrades();
  const target = shadows.find((s) => s.id === id);
  if (!target) return res.status(404).json({ error: '해당 shadow trade 없음' });

  const ALLOWED = ['quantity', 'shadowEntryPrice', 'signalPrice', 'stopLoss', 'targetPrice'] as const;
  const applied: Record<string, { before: number; after: number }> = {};

  for (const key of ALLOWED) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({ error: `${key}: 음수가 아닌 유한 숫자 필요` });
    }
    const before = (target as any)[key] ?? 0;
    if (before === num) continue;
    (target as any)[key] = num;
    applied[key] = { before, after: num };
  }

  if (Object.keys(applied).length === 0) {
    return res.json({ ok: true, changed: false, trade: target });
  }

  saveShadowTrades(shadows);
  try {
    appendShadowLog({
      kind: 'FORCED_INPUT',
      id,
      stockCode: target.stockCode,
      stockName: target.stockName,
      applied,
      reason: patch.reason ?? 'manual-mismatch-fix',
    });
  } catch (err) {
    console.error('[force-input] shadow 로그 기록 실패:', err);
  }

  res.json({ ok: true, changed: true, applied, trade: target });
});

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

/**
 * 섀도우 거래의 quantity 필드를 fills 기반으로 즉시 재조정한다.
 * 서버 시작 시 자동 실행되며, UI에서 수동 호출도 가능.
 */
router.post('/shadow/reconcile', (_req: any, res: any) => {
  try {
    const result = reconcileShadowQuantities();
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[ShadowReconcile] 실패:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── 서버 시작 시 1회 자동 재조정 ───────────────────────────────────────────────
try {
  reconcileShadowQuantities();
} catch (e) {
  console.error('[ShadowReconcile] 시작 시 재조정 실패:', e);
}

/**
 * 모든 섀도우 거래 + 현재가를 기반으로 계좌 전체 상태를 계산하여 반환한다.
 * 현재가 조회는 먼저 WebSocket 캐시(getRealtimePrice)를 사용하고,
 * 없으면 KIS REST(fetchCurrentPrice)로 폴백한다.
 */
router.get('/shadow/account', async (_req: any, res: any) => {
  try {
    const settings = loadTradingSettings();
    const trades = loadShadowTrades();

    // 활성 포지션의 종목코드만 추출하여 현재가 조회
    // 분류는 computeShadowAccount와 동일한 fills 기반 잔량 규칙을 사용한다.
    const activeCodes = [...new Set(
      trades
        .filter(t => t.status !== 'REJECTED' && getRemainingQty(t) > 0)
        .map(t => t.stockCode)
    )];

    const currentPrices: Record<string, number> = {};
    await Promise.all(
      activeCodes.map(async code => {
        const rt = getRealtimePrice(code);
        if (rt !== null) {
          currentPrices[code] = rt;
        } else {
          const price = await fetchCurrentPrice(code).catch(() => null);
          if (price !== null && price !== undefined) currentPrices[code] = price;
        }
      })
    );

    const account = computeShadowAccount(trades, settings.startingCapital, currentPrices);
    res.json(account);
  } catch (e: any) {
    console.error('[ShadowAccount] 계산 실패:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * 활성 포지션의 현재가만 빠르게 반환한다. (UI 폴링용)
 * 응답: { prices: { [stockCode]: number }, updatedAt: string }
 */
router.get('/shadow/current-prices', async (_req: any, res: any) => {
  try {
    const trades = loadShadowTrades();
    const activeStatuses = new Set(['ACTIVE', 'PARTIALLY_FILLED', 'ORDER_SUBMITTED', 'PENDING']);
    const activeCodes = [...new Set(
      trades
        .filter(t => activeStatuses.has(t.status))
        .map(t => t.stockCode)
    )];

    const prices: Record<string, number> = {};
    await Promise.all(
      activeCodes.map(async code => {
        const rt = getRealtimePrice(code);
        if (rt !== null) {
          prices[code] = rt;
        } else {
          const price = await fetchCurrentPrice(code).catch(() => null);
          if (price !== null && price !== undefined) prices[code] = price;
        }
      })
    );

    res.json({ prices, updatedAt: new Date().toISOString() });
  } catch (e: any) {
    console.error('[ShadowCurrentPrices] 조회 실패:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
