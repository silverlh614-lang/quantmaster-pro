/**
 * @responsibility slippageHistoryRepo 회귀 테스트 (ADR-0031 PR-O)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'slippage-history-test-'));
process.env.PERSIST_DATA_DIR = TMP_DIR;

const {
  recordSlippageEntry,
  loadSlippageHistory,
  getSlippageStats,
  __resetSlippageHistoryForTests,
  SLIPPAGE_HISTORY_MAX,
} = await import('./slippageHistoryRepo.js');

beforeEach(() => {
  __resetSlippageHistoryForTests();
});

describe('recordSlippageEntry', () => {
  it('정상 입력 — slippagePct 자동 계산 + 영속', () => {
    const added = recordSlippageEntry({
      stockCode: 'A005930',
      theoreticalPrice: 70000,
      executedPrice: 70350, // +0.5%
      orderType: 'LIMIT',
    });
    expect(added).toBe(1);

    const all = loadSlippageHistory();
    expect(all).toHaveLength(1);
    expect(all[0].slippagePct).toBeCloseTo(0.005, 4);
    expect(all[0].orderType).toBe('LIMIT');
  });

  it('음수 슬리피지 (유리한 체결)', () => {
    recordSlippageEntry({
      stockCode: 'A',
      theoreticalPrice: 1000,
      executedPrice: 990, // -1%
      orderType: 'AGGRESSIVE_LIMIT',
    });
    expect(loadSlippageHistory()[0].slippagePct).toBeCloseTo(-0.01, 4);
  });

  it('잘못된 가격 (0/음수/NaN) → silent skip', () => {
    expect(recordSlippageEntry({
      stockCode: 'A', theoreticalPrice: 0, executedPrice: 100, orderType: 'LIMIT',
    })).toBe(0);
    expect(recordSlippageEntry({
      stockCode: 'A', theoreticalPrice: 100, executedPrice: -10, orderType: 'LIMIT',
    })).toBe(0);
    expect(recordSlippageEntry({
      stockCode: 'A', theoreticalPrice: NaN, executedPrice: 100, orderType: 'LIMIT',
    })).toBe(0);
    expect(loadSlippageHistory()).toHaveLength(0);
  });

  it('volumeZ / priceMomentumPct 옵셔널 영속 + NaN fallback undefined', () => {
    recordSlippageEntry({
      stockCode: 'A', theoreticalPrice: 1000, executedPrice: 1010,
      orderType: 'IOC_MARKET',
      volumeZ: 2.5, priceMomentumPct: 3.0,
    });
    recordSlippageEntry({
      stockCode: 'B', theoreticalPrice: 1000, executedPrice: 1010,
      orderType: 'IOC_MARKET',
      volumeZ: NaN, priceMomentumPct: Infinity,
    });
    const all = loadSlippageHistory();
    expect(all[0].volumeZ).toBe(2.5);
    expect(all[0].priceMomentumPct).toBe(3.0);
    expect(all[1].volumeZ).toBeUndefined();
    expect(all[1].priceMomentumPct).toBeUndefined();
  });

  it('1000건 초과 FIFO trim', () => {
    for (let i = 0; i < SLIPPAGE_HISTORY_MAX + 50; i++) {
      recordSlippageEntry({
        stockCode: `A${i}`, theoreticalPrice: 1000, executedPrice: 1010,
        orderType: 'LIMIT',
      });
    }
    expect(loadSlippageHistory()).toHaveLength(SLIPPAGE_HISTORY_MAX);
  });
});

describe('getSlippageStats', () => {
  it('빈 데이터 → sampleSize 0', () => {
    const s = getSlippageStats(null);
    expect(s.sampleSize).toBe(0);
    expect(s.mean).toBe(0);
    expect(s.byOrderType).toEqual({});
  });

  it('전체 누적 통계 (stockCode=null)', () => {
    // +1%, +0.5%, -0.5%, +2%, +0.2%
    const slips = [0.01, 0.005, -0.005, 0.02, 0.002];
    for (const s of slips) {
      recordSlippageEntry({
        stockCode: 'A', theoreticalPrice: 1000,
        executedPrice: 1000 * (1 + s), orderType: 'LIMIT',
      });
    }
    const stats = getSlippageStats(null);
    expect(stats.sampleSize).toBe(5);
    // mean = (0.01 + 0.005 - 0.005 + 0.02 + 0.002) / 5 = 0.032/5 = 0.0064
    expect(stats.mean).toBeCloseTo(0.0064, 4);
    expect(stats.p50).toBeCloseTo(0.005, 4);
  });

  it('종목별 필터', () => {
    recordSlippageEntry({
      stockCode: 'A', theoreticalPrice: 1000, executedPrice: 1010, orderType: 'LIMIT',
    });
    recordSlippageEntry({
      stockCode: 'B', theoreticalPrice: 1000, executedPrice: 1020, orderType: 'LIMIT',
    });
    const a = getSlippageStats('A');
    const b = getSlippageStats('B');
    expect(a.sampleSize).toBe(1);
    expect(b.sampleSize).toBe(1);
    expect(a.mean).toBeCloseTo(0.01, 4);
    expect(b.mean).toBeCloseTo(0.02, 4);
  });

  it('byOrderType 분리 평균', () => {
    recordSlippageEntry({
      stockCode: 'A', theoreticalPrice: 1000, executedPrice: 1010, orderType: 'IOC_MARKET',
    });
    recordSlippageEntry({
      stockCode: 'A', theoreticalPrice: 1000, executedPrice: 1020, orderType: 'IOC_MARKET',
    });
    recordSlippageEntry({
      stockCode: 'A', theoreticalPrice: 1000, executedPrice: 1003, orderType: 'LIMIT',
    });
    const stats = getSlippageStats('A');
    expect(stats.byOrderType.IOC_MARKET).toBeCloseTo(0.015, 4); // (0.01 + 0.02) / 2
    expect(stats.byOrderType.LIMIT).toBeCloseTo(0.003, 4);
  });

  it('lookback 옵션 — 최근 N건만', () => {
    for (let i = 0; i < 20; i++) {
      recordSlippageEntry({
        stockCode: 'A', theoreticalPrice: 1000, executedPrice: 1000 * (1 + i * 0.001),
        orderType: 'LIMIT',
      });
    }
    const all = getSlippageStats('A');
    const recent5 = getSlippageStats('A', 5);
    expect(all.sampleSize).toBe(20);
    expect(recent5.sampleSize).toBe(5);
    // 최근 5건 = i=15~19 (slippage 0.015~0.019), mean = 0.017
    expect(recent5.mean).toBeCloseTo(0.017, 3);
  });
});
