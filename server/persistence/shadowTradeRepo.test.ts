/**
 * shadowTradeRepo.test.ts — computeShadowMonthlyStats 계약 테스트.
 *
 * SSOT(fills) 기반 당월 종결 집계를 검증한다.
 * - WIN/LOSS 혼합
 * - 미결 포지션 카운트
 * - 표본 부족 플래그
 * - STRONG_BUY 승률 분리
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('computeShadowMonthlyStats', () => {
  let tmpDir: string;
  let repo: typeof import('./shadowTradeRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-stats-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    // 동적 import — PERSIST_DATA_DIR 반영된 이후 paths.ts 가 해석되도록.
    repo = await import('./shadowTradeRepo.js');
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  const thisMonth = new Date().toISOString().slice(0, 7);
  const ymd = (offsetDays: number) => {
    const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    return d.toISOString();
  };

  function makeTrade(opts: {
    id: string;
    status: 'HIT_TARGET' | 'HIT_STOP' | 'ACTIVE' | 'PENDING';
    exitTime?: string;
    entryPrice: number;
    exitPrice?: number;
    qty: number;
    signalGrade?: 'STRONG_BUY' | 'BUY';
  }) {
    const pnlPct = opts.exitPrice != null
      ? ((opts.exitPrice - opts.entryPrice) / opts.entryPrice) * 100
      : 0;
    const pnl = opts.exitPrice != null ? (opts.exitPrice - opts.entryPrice) * opts.qty : 0;
    const fills: any[] = [
      {
        id: `${opts.id}-b`,
        type: 'BUY',
        qty: opts.qty,
        price: opts.entryPrice,
        reason: 'init',
        timestamp: ymd(-5),
        status: 'CONFIRMED',
      },
    ];
    if (opts.exitPrice != null) {
      fills.push({
        id: `${opts.id}-s`,
        type: 'SELL',
        qty: opts.qty,
        price: opts.exitPrice,
        pnl,
        pnlPct,
        reason: 'exit',
        timestamp: opts.exitTime ?? ymd(-1),
        status: 'CONFIRMED',
      });
    }
    const trade: any = {
      id: opts.id,
      stockCode: opts.id,
      stockName: `종목${opts.id}`,
      signalTime: ymd(-5),
      signalPrice: opts.entryPrice,
      shadowEntryPrice: opts.entryPrice,
      quantity: opts.exitPrice != null ? 0 : opts.qty,
      stopLoss: opts.entryPrice * 0.95,
      targetPrice: opts.entryPrice * 1.1,
      status: opts.status,
      exitPrice: opts.exitPrice,
      exitTime: opts.exitTime,
      fills,
    };
    if (opts.signalGrade) {
      trade.entryKellySnapshot = {
        tier: 'CONVICTION',
        signalGrade: opts.signalGrade,
        rawKellyMultiplier: 0.5,
        effectiveKelly: 0.3,
        fractionalCap: 0.5,
        ipsAtEntry: 65,
        regimeAtEntry: 'R2_BULL',
        accountRiskBudgetPctAtEntry: 2,
        confidenceModifier: 1,
        snapshotAt: ymd(-5),
      };
    }
    return trade;
  }

  it('WIN/LOSS 혼합 + STRONG_BUY 승률 분리', () => {
    const thisMonthISO = `${thisMonth}-15T10:00:00.000Z`;
    const trades = [
      // 2 WIN (STRONG_BUY × 1)
      makeTrade({ id: 'A', status: 'HIT_TARGET', entryPrice: 10_000, exitPrice: 11_000, qty: 10, exitTime: thisMonthISO, signalGrade: 'STRONG_BUY' }),
      makeTrade({ id: 'B', status: 'HIT_TARGET', entryPrice: 20_000, exitPrice: 21_000, qty: 5,  exitTime: thisMonthISO, signalGrade: 'BUY' }),
      // 1 LOSS (STRONG_BUY)
      makeTrade({ id: 'C', status: 'HIT_STOP', entryPrice: 30_000, exitPrice: 27_000, qty: 3, exitTime: thisMonthISO, signalGrade: 'STRONG_BUY' }),
      // 미결
      makeTrade({ id: 'D', status: 'ACTIVE', entryPrice: 40_000, qty: 2 }),
      makeTrade({ id: 'E', status: 'PENDING', entryPrice: 50_000, qty: 1 }),
    ];
    repo.saveShadowTrades(trades);

    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.month).toBe(thisMonth);
    expect(stats.totalClosed).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(66.67, 1);
    expect(stats.openPositions).toBe(2);
    // avg netPct = mean(10, 5, -10) = 5/3 ≈ 1.67
    expect(stats.avgReturnPct).toBeCloseTo(5 / 3, 1);
    // STRONG_BUY: A WIN, C LOSS → 50%
    expect(stats.strongBuyWinRate).toBeCloseTo(50, 1);
    // 표본 3 < 5
    expect(stats.sampleSufficient).toBe(false);
    // Profit factor = (10+5)/10 = 1.5
    expect(stats.profitFactor).toBeCloseTo(1.5, 2);
  });

  it('표본 부족 플래그 — 당월 종결 1건', () => {
    const thisMonthISO = `${thisMonth}-05T10:00:00.000Z`;
    repo.saveShadowTrades([
      makeTrade({ id: 'X', status: 'HIT_TARGET', entryPrice: 1_000, exitPrice: 1_050, qty: 5, exitTime: thisMonthISO }),
    ]);
    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.totalClosed).toBe(1);
    expect(stats.sampleSufficient).toBe(false);
    expect(stats.openPositions).toBe(0);
    expect(stats.profitFactor).toBeNull(); // 손실 없음
  });

  it('표본 ≥ 5 이면 sampleSufficient=true', () => {
    const thisMonthISO = `${thisMonth}-10T10:00:00.000Z`;
    const trades = Array.from({ length: 5 }).map((_, i) => makeTrade({
      id: `T${i}`,
      status: i % 2 === 0 ? 'HIT_TARGET' : 'HIT_STOP',
      entryPrice: 10_000,
      exitPrice: i % 2 === 0 ? 11_000 : 9_500,
      qty: 1,
      exitTime: thisMonthISO,
    }));
    repo.saveShadowTrades(trades);
    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.totalClosed).toBe(5);
    expect(stats.sampleSufficient).toBe(true);
  });

  it('당월 밖 exitTime 은 집계에서 제외', () => {
    const thisMonthISO = `${thisMonth}-10T10:00:00.000Z`;
    const otherMonth = '2020-01-15T10:00:00.000Z';
    repo.saveShadowTrades([
      makeTrade({ id: 'M', status: 'HIT_TARGET', entryPrice: 1000, exitPrice: 1100, qty: 1, exitTime: thisMonthISO }),
      makeTrade({ id: 'N', status: 'HIT_TARGET', entryPrice: 1000, exitPrice: 1200, qty: 1, exitTime: otherMonth }),
    ]);
    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.totalClosed).toBe(1);
  });

  it('종결/미결 모두 없으면 zero 집계', () => {
    repo.saveShadowTrades([]);
    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.totalClosed).toBe(0);
    expect(stats.openPositions).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.avgReturnPct).toBe(0);
    expect(stats.profitFactor).toBeNull();
    expect(stats.sampleSufficient).toBe(false);
  });
});
