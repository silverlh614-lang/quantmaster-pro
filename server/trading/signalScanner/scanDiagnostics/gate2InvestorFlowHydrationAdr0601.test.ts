// @responsibility ADR-0601 Gate2 investor-flow 네이티브 hydration 회귀 — 캐시·상한·실패 격리·flag.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetGate2InvestorFlowHydrationStateForTest,
  hydrateGate2InvestorFlowAdr0601,
  isGate2InvestorFlowHydrationEnabled,
  resolveGate2InvestorFlowHydrationMax,
} from './gate2InvestorFlowHydrationAdr0601.js';

const NOW = new Date('2026-06-11T03:30:00.000Z');

function snapshot(symbol: string, gate1Passed = true, covered = false): Record<string, unknown> {
  return {
    symbol,
    gate1Passed,
    ...(covered ? { gate2ExternalDataCoverage: { kisInvestorFlow: { status: 'VERIFIED', foreignNetBuy: 100 } } } : {}),
  };
}

function evidence(foreignNetBuy: number | undefined, confidence: 'VERIFIED' | 'DEGRADED' = 'VERIFIED') {
  return {
    sample: foreignNetBuy === undefined ? null : {
      stockCode: 'X', source: 'KIS_API', sourceKind: 'INVESTOR_TRADE_BY_STOCK_DAILY',
      foreignNetBuy, institutionalNetBuy: 50, sourceDate: '2026-06-11', confidence,
      hasRealFields: true, marketSignal: false, providerIssue: false,
      executionImpact: 'NONE', usableForShadow: true,
    },
  } as never;
}

describe('hydrateGate2InvestorFlowAdr0601', () => {
  beforeEach(() => { __resetGate2InvestorFlowHydrationStateForTest(); });
  afterEach(() => {
    delete process.env.GATE2_INVESTOR_FLOW_NATIVE_HYDRATION_ENABLED;
    delete process.env.GATE2_INVESTOR_FLOW_HYDRATION_MAX;
  });

  it('ENV 가드 — default ON·false 시 OFF·상한 0~50 정수 외 16', () => {
    expect(isGate2InvestorFlowHydrationEnabled({})).toBe(true);
    expect(isGate2InvestorFlowHydrationEnabled({ GATE2_INVESTOR_FLOW_NATIVE_HYDRATION_ENABLED: 'false' })).toBe(false);
    expect(resolveGate2InvestorFlowHydrationMax({})).toBe(16);
    expect(resolveGate2InvestorFlowHydrationMax({ GATE2_INVESTOR_FLOW_HYDRATION_MAX: '8' })).toBe(8);
    expect(resolveGate2InvestorFlowHydrationMax({ GATE2_INVESTOR_FLOW_HYDRATION_MAX: '999' })).toBe(16);
  });

  it('결손 후보만 보충하고 snapshot 에 kisInvestorFlow 를 주입한다 (기보유 후보 skip)', async () => {
    const fetcher = vi.fn(async () => evidence(1200));
    const missing = snapshot('000001');
    const covered = snapshot('000002', true, true);
    const report = await hydrateGate2InvestorFlowAdr0601({
      candidateSnapshots: [missing, covered], now: NOW, fetcher: fetcher as never,
    });
    expect(report).toMatchObject({ enabled: true, hydrated: 1, attempted: 1, alreadyCovered: 1, failures: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const flow = (missing.gate2ExternalDataCoverage as Record<string, unknown>).kisInvestorFlow as Record<string, unknown>;
    expect(flow).toMatchObject({ status: 'VERIFIED', foreignNetBuy: 1200, hydratedBy: 'ADR_0601_KIS_NATIVE_HYDRATION' });
  });

  it('일중 캐시 — 같은 KST 일자 재스캔은 fetch 0 으로 재주입 (상한 미소모)', async () => {
    const fetcher = vi.fn(async () => evidence(700));
    await hydrateGate2InvestorFlowAdr0601({ candidateSnapshots: [snapshot('000003')], now: NOW, fetcher: fetcher as never });
    const second = snapshot('000003');
    const report = await hydrateGate2InvestorFlowAdr0601({ candidateSnapshots: [second], now: NOW, fetcher: fetcher as never });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ cacheHits: 1, hydrated: 1, attempted: 0 });
    expect((second.gate2ExternalDataCoverage as Record<string, unknown>).kisInvestorFlow).toBeDefined();
  });

  it('스캔당 상한 — gate1Passed 우선 순으로 maxPerScan 까지만 신규 조회, 초과는 capped', async () => {
    process.env.GATE2_INVESTOR_FLOW_HYDRATION_MAX = '2';
    const fetcher = vi.fn(async () => evidence(10));
    const passed = [snapshot('100001'), snapshot('100002')];
    const notPassed = snapshot('100003', false);
    const report = await hydrateGate2InvestorFlowAdr0601({
      candidateSnapshots: [notPassed, ...passed], now: NOW, fetcher: fetcher as never,
    });
    expect(report).toMatchObject({ attempted: 2, capped: 1, maxPerScan: 2 });
    expect(passed.every((s) => s.gate2ExternalDataCoverage !== undefined)).toBe(true);
    expect(notPassed.gate2ExternalDataCoverage).toBeUndefined();
  });

  it('실패 격리 — throw/빈 sample 은 failures 집계 + 당일 재시도 억제, 엔진 무중단', async () => {
    const fetcher = vi.fn(async () => { throw new Error('KIS_DOWN'); });
    const first = await hydrateGate2InvestorFlowAdr0601({ candidateSnapshots: [snapshot('200001')], now: NOW, fetcher: fetcher as never });
    expect(first).toMatchObject({ failures: 1, hydrated: 0 });
    const second = await hydrateGate2InvestorFlowAdr0601({ candidateSnapshots: [snapshot('200001')], now: NOW, fetcher: fetcher as never });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.attempted).toBe(0);
  });

  it('flag=false → fetch 0·주입 0 (byte-equivalent)', async () => {
    process.env.GATE2_INVESTOR_FLOW_NATIVE_HYDRATION_ENABLED = 'false';
    const fetcher = vi.fn(async () => evidence(10));
    const target = snapshot('300001');
    const report = await hydrateGate2InvestorFlowAdr0601({ candidateSnapshots: [target], now: NOW, fetcher: fetcher as never });
    expect(report.enabled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(target.gate2ExternalDataCoverage).toBeUndefined();
  });
});
