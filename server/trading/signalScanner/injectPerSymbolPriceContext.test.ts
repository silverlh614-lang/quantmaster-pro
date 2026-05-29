// @responsibility A1 회귀 — injectPerSymbolPriceContext avgVolume 배선 복구 검증 (bars 평균 주입, 덮어쓰기 금지).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../clients/kisClient.js', () => ({
  fetchKisStockFullQuote: vi.fn(),
  fetchKisStockDailyBars: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createTraceId: () => 'trace_test',
  logVisibilityEvent: vi.fn(),
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { injectPerSymbolPriceContext } from './injectPerSymbolPriceContext.js';
import { fetchKisStockFullQuote, fetchKisStockDailyBars } from '../../clients/kisClient.js';
import type { SymbolSnapshotData } from '../sourceSnapshot/symbolSnapshotData.js';

const mockedQuote = vi.mocked(fetchKisStockFullQuote);
const mockedBars = vi.mocked(fetchKisStockDailyBars);

function bars(volumes: Array<number | null>, baseClose = 100): Array<{ date: string; close: number; volume: number | null }> {
  return volumes.map((v, i) => ({ date: `2026-05-${String(28 - i).padStart(2, '0')}`, close: baseClose + i, volume: v }));
}

function snapshotData(map: Record<string, Partial<SymbolSnapshotData>>): Record<string, SymbolSnapshotData> {
  const out: Record<string, SymbolSnapshotData> = {};
  for (const [code, s] of Object.entries(map)) {
    out[code] = { code, dailyBars: [], quote: null, ...s } as unknown as SymbolSnapshotData;
  }
  return out;
}

describe('A1 injectPerSymbolPriceContext — avgVolume 배선 복구', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuote.mockResolvedValue(null as never);
    mockedBars.mockResolvedValue([] as never);
  });

  it('snapshotData 의 dailyBars volume 평균을 avgVolume 으로 주입한다', async () => {
    const candidates: Array<Record<string, unknown>> = [{ code: '005930' }];
    const { candidates: out, stats } = await injectPerSymbolPriceContext(candidates, {
      snapshotData: snapshotData({ '005930': { dailyBars: bars([100, 200, 300]) as never } }),
    });

    // (100 + 200 + 300) / 3 = 200
    expect(out[0].avgVolume).toBe(200);
    expect(stats.avgVolumeInjected).toBe(1);
    // volume 도 함께 주입 (bars[0] = 최신)
    expect(out[0].volume).toBe(100);
  });

  it('KIS bars 평균으로 avgVolume 을 주입한다 (snapshotData 부재 경로)', async () => {
    mockedBars.mockResolvedValue(bars([10, 20, 30, 40]) as never);
    const candidates: Array<Record<string, unknown>> = [{ code: '000660' }];

    const { candidates: out, stats } = await injectPerSymbolPriceContext(candidates);

    // (10 + 20 + 30 + 40) / 4 = 25
    expect(out[0].avgVolume).toBe(25);
    expect(stats.avgVolumeInjected).toBe(1);
  });

  it('최근 최대 20개 bar 의 volume 만 평균에 사용한다', async () => {
    // 21개 bar: 첫 20개는 모두 100, 21번째는 5000 (평균에서 제외돼야 함)
    const volumes = [...Array(20).fill(100), 5000];
    mockedBars.mockResolvedValue(bars(volumes) as never);
    const candidates: Array<Record<string, unknown>> = [{ code: '000660' }];

    const { candidates: out } = await injectPerSymbolPriceContext(candidates);

    expect(out[0].avgVolume).toBe(100);
  });

  it('이미 채워진 avgVolume 은 덮어쓰지 않는다 (회귀 방지)', async () => {
    const candidates: Array<Record<string, unknown>> = [{ code: '005930', avgVolume: 999 }];
    const { candidates: out, stats } = await injectPerSymbolPriceContext(candidates, {
      snapshotData: snapshotData({ '005930': { dailyBars: bars([100, 200, 300]) as never } }),
    });

    expect(out[0].avgVolume).toBe(999);
    expect(stats.avgVolumeInjected).toBe(0);
  });

  it('bars 가 비면 avgVolume 을 주입하지 않는다 (null)', async () => {
    const candidates: Array<Record<string, unknown>> = [{ code: '005930' }];
    const { candidates: out, stats } = await injectPerSymbolPriceContext(candidates, {
      snapshotData: snapshotData({ '005930': { dailyBars: [] } }),
    });

    expect('avgVolume' in out[0]).toBe(false);
    expect(stats.avgVolumeInjected).toBe(0);
  });

  it('finite volume 이 없는 bars 는 avgVolume 을 주입하지 않는다', async () => {
    mockedBars.mockResolvedValue(bars([null, null]) as never);
    const candidates: Array<Record<string, unknown>> = [{ code: '000660' }];

    const { candidates: out, stats } = await injectPerSymbolPriceContext(candidates);

    expect('avgVolume' in out[0]).toBe(false);
    expect(stats.avgVolumeInjected).toBe(0);
  });
});
