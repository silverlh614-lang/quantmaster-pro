/**
 * phase3.test.ts — Phase 3 Condition Confession / Regret / Ghost / Distillation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── #6 Condition Confession ──────────────────────────────────────────────────
describe('Phase 3 #6 — buildConditionConfession', () => {
  it('passed 3+ & loss/passed ≥ 0.6 → 후보 채택', async () => {
    const { buildConditionConfession } = await import('./conditionConfession.js');
    const recs: any[] = [
      { tradeId: 't1', returnPct: -3, isWin: false, conditionScores: { 17: 8, 5: 9 } },
      { tradeId: 't2', returnPct: -2, isWin: false, conditionScores: { 17: 8 } },
      { tradeId: 't3', returnPct: -1, isWin: false, conditionScores: { 17: 7 } },
      { tradeId: 't4', returnPct: +5, isWin: true,  conditionScores: { 17: 7 } },
      { tradeId: 't5', returnPct: +3, isWin: true,  conditionScores: { 5: 9 } },
    ];
    const out = buildConditionConfession(recs);
    const c17 = out.find((e) => e.conditionId === 17);
    expect(c17).toBeDefined();
    expect(c17?.passedCount).toBe(4);
    expect(c17?.lossCount).toBe(3);
    expect(c17?.falseSignalScore).toBeCloseTo(0.75, 2);
  });

  it('passed < 3 이면 제외', async () => {
    const { buildConditionConfession } = await import('./conditionConfession.js');
    const recs: any[] = [
      { tradeId: 't1', returnPct: -3, isWin: false, conditionScores: { 21: 8 } },
      { tradeId: 't2', returnPct: -5, isWin: false, conditionScores: { 21: 8 } },
    ];
    expect(buildConditionConfession(recs)).toEqual([]);
  });

  it('findChronicConfessions — 3일 연속 동일 조건만 반환', async () => {
    const { findChronicConfessions } = await import('./conditionConfession.js');
    const day1 = { conditionConfession: [{ conditionId: 17 }, { conditionId: 21 }] as any };
    const day2 = { conditionConfession: [{ conditionId: 17 }, { conditionId: 5 }] as any };
    const day3 = { conditionConfession: [{ conditionId: 17 }, { conditionId: 22 }] as any };
    expect(findChronicConfessions([day1, day2, day3])).toEqual([17]);
    expect(findChronicConfessions([day1, day2])).toEqual([]); // < 3 days
  });
});

// ── #8 Regret Quantifier ─────────────────────────────────────────────────────
describe('Phase 3 #8 — quantifyRegret', () => {
  it('지연 proxy — 60분 시 3배 slippage 확대 (보수적)', async () => {
    const { quantifyRegret } = await import('./regretQuantifier.js');
    const trade: any = {
      id: 't1', stockCode: '005930', stockName: '삼성전자',
      shadowEntryPrice: 70_000, stopLoss: 66_000, quantity: 10,
      status: 'HIT_STOP', exitPrice: 65_500, returnPct: -6.43,
    };
    const res = await quantifyRegret({ stopLossTrades: [trade] });
    // baseSlip = 66000 - 65500 = 500.
    // delay5 proxy = exitPrice - slip*(1-1) = 65500 → loss=(70000-65500)*10=45000
    // delay30 proxy = exitPrice - slip*(2-1) = 65000 → loss=(70000-65000)*10=50000
    // delay60 proxy = exitPrice - slip*(3-1) = 64500 → loss=(70000-64500)*10=55000
    expect(res.immediateStopLossKrw).toBe(45_000);
    expect(res.delay5minLossKrw).toBe(45_000);
    expect(res.delay30minLossKrw).toBe(50_000);
    expect(res.delay60minLossKrw).toBe(55_000);
    expect(res.mechanicalValueKrw).toBe(10_000);
  });

  it('실측 priceAtDelay 주입 시 proxy 대신 사용', async () => {
    const { quantifyRegret } = await import('./regretQuantifier.js');
    const trade: any = {
      id: 't1', stockCode: '005930', stockName: '삼성전자',
      shadowEntryPrice: 70_000, stopLoss: 66_000, quantity: 10,
      status: 'HIT_STOP', exitPrice: 65_500, returnPct: -6.43,
    };
    const priceAtDelay = async (_t: any, d: number) => {
      if (d === 5)  return 64_000;
      if (d === 30) return 62_000;
      return 60_000;
    };
    const res = await quantifyRegret({ stopLossTrades: [trade], priceAtDelay });
    // delay5 loss = (70000-64000)*10 = 60000
    // delay30 loss = (70000-62000)*10 = 80000
    // delay60 loss = (70000-60000)*10 = 100000
    expect(res.delay5minLossKrw).toBe(60_000);
    expect(res.delay30minLossKrw).toBe(80_000);
    expect(res.delay60minLossKrw).toBe(100_000);
    expect(res.mechanicalValueKrw).toBe(55_000); // 100k - 45k
  });

  it('HIT_STOP 없으면 모두 0', async () => {
    const { quantifyRegret } = await import('./regretQuantifier.js');
    const res = await quantifyRegret({ stopLossTrades: [] });
    expect(res.mechanicalValueKrw).toBe(0);
  });
});

// ── #9 Ghost Portfolio Tracker ───────────────────────────────────────────────
describe('Phase 3 #9 — ghostPortfolioTracker', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../../clients/kisClient.js');
  });

  it('enqueue + refresh — 수익률 갱신', async () => {
    vi.doMock('../../clients/kisClient.js', () => ({
      fetchCurrentPrice: vi.fn().mockResolvedValue(73_500),
    }));
    const { enqueueMissedSignals, refreshGhostPortfolio } = await import('../ghostPortfolioTracker.js');
    enqueueMissedSignals([{
      stockCode: '005930', stockName: '삼성전자',
      signalDate: '2026-04-20', signalPriceKrw: 70_000,
      rejectionReason: 'GATE2_FAIL',
    }]);
    const now = new Date('2026-04-25T07:00:00Z');
    const res = await refreshGhostPortfolio({ now });
    expect(res.updated).toBe(1);
    const { loadGhostPortfolio } = await import('../../persistence/reflectionRepo.js');
    const all = loadGhostPortfolio();
    expect(all[0].currentReturnPct).toBe(5);
  });

  it('trackUntil 초과 → closed=true', async () => {
    vi.doMock('../../clients/kisClient.js', () => ({
      fetchCurrentPrice: vi.fn().mockResolvedValue(70_000),
    }));
    const { enqueueMissedSignals, refreshGhostPortfolio } = await import('../ghostPortfolioTracker.js');
    enqueueMissedSignals([{
      stockCode: '005930', stockName: '삼성전자',
      signalDate: '2026-03-01', signalPriceKrw: 70_000,
      rejectionReason: 'EXPIRED',
    }]);
    const now = new Date('2026-04-25T07:00:00Z');
    const res = await refreshGhostPortfolio({ now });
    expect(res.closed).toBe(1);
  });

  it('compareGhostVsReal — divergence > 2 → FILTER_TOO_CONSERVATIVE', async () => {
    vi.doMock('../../clients/kisClient.js', () => ({
      fetchCurrentPrice: vi.fn().mockResolvedValue(77_000), // +10%
    }));
    const { enqueueMissedSignals, refreshGhostPortfolio, compareGhostVsReal } = await import('../ghostPortfolioTracker.js');
    const input = Array.from({ length: 5 }, (_, i) => ({
      stockCode: `00000${i}`, stockName: `N${i}`,
      signalDate: '2026-04-20', signalPriceKrw: 70_000,
      rejectionReason: 'FILTER',
    }));
    enqueueMissedSignals(input);
    await refreshGhostPortfolio({ now: new Date('2026-04-25T07:00:00Z') });
    const cmp = compareGhostVsReal(3);
    expect(cmp.ghostCount).toBe(5);
    expect(cmp.ghostAvgReturnPct).toBe(10);
    expect(cmp.verdict).toBe('FILTER_TOO_CONSERVATIVE');
  });

  it('샘플 < 5 → INSUFFICIENT_DATA', async () => {
    const { compareGhostVsReal } = await import('../ghostPortfolioTracker.js');
    expect(compareGhostVsReal(2).verdict).toBe('INSUFFICIENT_DATA');
  });
});

// ── #7 Silent Knowledge Distillation ─────────────────────────────────────────
describe('Phase 3 #7 — distillWeeklyKnowledge', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'distill-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../../clients/geminiClient.js');
  });

  it('반성 리포트 < 3개 → INSUFFICIENT_REPORTS', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue('교훈'),
    }));
    const { distillWeeklyKnowledge } = await import('../silentKnowledgeDistillation.js');
    const res = await distillWeeklyKnowledge();
    expect(res.executed).toBe(false);
    expect(res.skipped).toBe('INSUFFICIENT_REPORTS');
  });

  it('3+ reports + Gemini 성공 → 교훈 append', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue('손절선 아래에서 평단 낮추기는 금지한다.'),
    }));
    const { saveReflection } = await import('../../persistence/reflectionRepo.js');
    const today = new Date();
    for (let i = 0; i < 4; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      saveReflection({
        date: d.toISOString().slice(0, 10),
        generatedAt: d.toISOString(),
        dailyVerdict: 'MIXED',
        keyLessons: [{ text: `D${i} lesson`, sourceIds: ['t1'] }],
        questionableDecisions: [], tomorrowAdjustments: [], followUpActions: [],
      });
    }
    const { distillWeeklyKnowledge } = await import('../silentKnowledgeDistillation.js');
    const res = await distillWeeklyKnowledge();
    expect(res.executed).toBe(true);
    expect(res.lesson).toContain('손절선');
    const fileContent = fs.readFileSync(path.join(tmpDir, 'knowledge', 'distilled-weekly.txt'), 'utf-8');
    expect(fileContent).toContain('손절선 아래에서 평단 낮추기');
  });

  it('Gemini null → GEMINI_NULL 스킵', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue(null),
    }));
    const { saveReflection } = await import('../../persistence/reflectionRepo.js');
    for (let i = 0; i < 4; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      saveReflection({
        date: d.toISOString().slice(0, 10),
        generatedAt: d.toISOString(),
        dailyVerdict: 'SILENT',
        keyLessons: [], questionableDecisions: [], tomorrowAdjustments: [], followUpActions: [],
      });
    }
    const { distillWeeklyKnowledge } = await import('../silentKnowledgeDistillation.js');
    const res = await distillWeeklyKnowledge();
    expect(res.executed).toBe(false);
    expect(res.skipped).toBe('GEMINI_NULL');
  });
});
