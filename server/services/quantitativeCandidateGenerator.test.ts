/**
 * @responsibility quantitativeCandidateGenerator 회귀 — Tier 3 정량 폴백 (PR-37, ADR-0016)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import {
  generateQuantitativeCandidates,
  __testOnly,
} from './quantitativeCandidateGenerator.js';
import {
  setStockMaster,
  __testOnly as __masterTestOnly,
} from '../persistence/krxStockMasterRepo.js';
import { __testOnly as __budgetTestOnly } from '../persistence/aiCallBudgetRepo.js';
import {
  AI_CALL_BUDGET_FILE,
  KRX_STOCK_MASTER_FILE,
} from '../persistence/paths.js';

function cleanFiles(): void {
  for (const f of [AI_CALL_BUDGET_FILE, KRX_STOCK_MASTER_FILE]) {
    try { fs.unlinkSync(f); } catch { /* not present */ }
  }
}

/**
 * 가상의 Yahoo 응답을 만들어 fetch mock 에 연결한다.
 * 21봉 이상이어야 metric 계산이 통과한다.
 */
function makeYahooResponse(opts: {
  closes: number[];
  volumes?: number[];
  tradingDate?: string;
  fiftyTwoWeekHigh?: number;
}): Response {
  const ts: number[] = [];
  const close: (number | null)[] = [];
  const high: (number | null)[] = [];
  const low: (number | null)[] = [];
  const volume: (number | null)[] = [];
  const baseDate = opts.tradingDate ? new Date(`${opts.tradingDate}T00:00:00.000Z`) : new Date('2026-04-24T00:00:00.000Z');
  for (let i = 0; i < opts.closes.length; i++) {
    const d = new Date(baseDate.getTime() - (opts.closes.length - 1 - i) * 24 * 3_600_000);
    ts.push(Math.floor(d.getTime() / 1000));
    close.push(opts.closes[i]);
    high.push(opts.closes[i]);
    low.push(opts.closes[i]);
    volume.push(opts.volumes?.[i] ?? 1_000_000);
  }
  const data = {
    chart: {
      result: [
        {
          timestamp: ts,
          indicators: { quote: [{ close, high, low, volume }] },
          meta: { fiftyTwoWeekHigh: opts.fiftyTwoWeekHigh ?? Math.max(...opts.closes) },
        },
      ],
    },
  };
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function gatedResponse(): Response {
  return new Response(JSON.stringify({ gated: true }), {
    status: 503,
    headers: { 'X-Egress-Guard': 'market-closed' },
  });
}

describe('quantitativeCandidateGenerator (PR-37)', () => {
  beforeEach(() => {
    cleanFiles();
    __masterTestOnly.reset();
    __budgetTestOnly.reset();
    delete process.env.AI_DAILY_CALL_BUDGET;
    delete process.env.DATA_FETCH_FORCE_OFF;
    delete process.env.DATA_FETCH_FORCE_MARKET;
    process.env.DATA_FETCH_FORCE_MARKET = 'true'; // EgressGuard pass — 정량 로직 자체 검증
  });
  afterEach(() => {
    cleanFiles();
    __masterTestOnly.reset();
    __budgetTestOnly.reset();
    delete process.env.DATA_FETCH_FORCE_MARKET;
    delete process.env.DATA_FETCH_FORCE_OFF;
    vi.restoreAllMocks();
  });

  it('정량 metric 헬퍼 — momentum/avg turnover/volatility/drawdown', () => {
    const bars = Array.from({ length: 25 }, (_, i) => ({
      close: 100 + i, high: null, low: null, volume: 1000,
    }));
    // window=20 → lastN 21 bars (앞·뒤 비교) → bars[4]=104, bars[24]=124 → 124/104-1 ≈ 0.1923
    expect(__testOnly.computeMomentum(bars, 20)).toBeCloseTo(0.1923, 2);
    expect(__testOnly.computeAvgTurnover(bars, 20)).toBeGreaterThan(0);
    expect(__testOnly.computeVolatility(bars, 20)).toBeGreaterThan(0);
    expect(__testOnly.computeDrawdownFromHigh(bars, 124)).toBeCloseTo(0, 2);
    expect(__testOnly.computeDrawdownFromHigh(bars, 200)).toBeCloseTo(-0.38, 2);
  });

  it('toYahooSymbol — KOSPI .KS / KOSDAQ .KQ / KONEX/OTHER null', () => {
    expect(__testOnly.toYahooSymbol({ code: '005930', market: 'KOSPI' })).toBe('005930.KS');
    expect(__testOnly.toYahooSymbol({ code: '247540', market: 'KOSDAQ' })).toBe('247540.KQ');
    expect(__testOnly.toYahooSymbol({ code: '900100', market: 'KONEX' })).toBeNull();
    expect(__testOnly.toYahooSymbol({ code: '900100', market: 'OTHER' })).toBeNull();
  });

  it('buildUniverse — 마스터 비어있으면 CORE_SEED 사용', () => {
    setStockMaster([]);
    const universe = __testOnly.buildUniverse(20);
    expect(universe.length).toBeGreaterThanOrEqual(20);
    expect(universe[0].code).toBe('005930');
  });

  it('Yahoo 응답 < 5건 → stale=true + 빈 배열 (호출자 Tier 4 진행)', async () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI' },
    ]);
    // 첫 두 호출은 정상, 나머지는 모두 빈 응답 (bars < 21)
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call++;
      if (call <= 2) return makeYahooResponse({ closes: Array.from({ length: 25 }, (_, i) => 100 + i) });
      return new Response(JSON.stringify({ chart: { result: [] } }), { status: 200 });
    });
    const result = await generateQuantitativeCandidates('MOMENTUM', { maxCandidates: 10, universeLimit: 6 });
    expect(result.stale).toBe(true);
    expect(result.candidates.length).toBe(0);
  });

  it('MOMENTUM — 모멘텀 + 거래대금 합산 정렬', async () => {
    setStockMaster([]);
    // 5종목 — 각각 다른 모멘텀
    const closes_A = Array.from({ length: 25 }, (_, i) => 100 + i);    // 강모멘텀
    const closes_B = Array.from({ length: 25 }, (_, i) => 100 - i * 0.1); // 약하강
    const closes_C = Array.from({ length: 25 }, () => 100);            // 횡보
    const closes_D = Array.from({ length: 25 }, (_, i) => 100 + i * 0.5);
    const closes_E = Array.from({ length: 25 }, (_, i) => 100 + i * 2);  // 최강모멘텀
    const responses = [
      makeYahooResponse({ closes: closes_E, volumes: Array(25).fill(2_000_000) }),
      makeYahooResponse({ closes: closes_A }),
      makeYahooResponse({ closes: closes_D }),
      makeYahooResponse({ closes: closes_C }),
      makeYahooResponse({ closes: closes_B }),
    ];
    let i = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses[i++] ?? makeYahooResponse({ closes: closes_C }));

    const result = await generateQuantitativeCandidates('MOMENTUM', { maxCandidates: 5, universeLimit: 5 });
    expect(result.stale).toBe(false);
    expect(result.candidates.length).toBe(5);
    // 첫 번째는 가장 강한 모멘텀(E)
    expect(result.candidates[0].metrics.momentum20d).toBeGreaterThan(0.3);
  });

  it('EARLY_DETECT — 신고가 -5~-15% 구간 + 변동성 하위', async () => {
    setStockMaster([]);
    // 5종목 — 다양한 drawdown
    // ㄱ. 25개 종가, 마지막이 fiftyTwoWeekHigh 의 92% (drawdown -8%, 구간 통과)
    const closes_in = Array.from({ length: 25 }, () => 92);
    // ㄴ. drawdown -25% (구간 미통과)
    const closes_far = Array.from({ length: 25 }, () => 75);
    // ㄷ. drawdown -2% (구간 미통과 — 너무 가까움)
    const closes_near = Array.from({ length: 25 }, () => 98);
    let i = 0;
    const responses = [
      makeYahooResponse({ closes: closes_in, fiftyTwoWeekHigh: 100 }),
      makeYahooResponse({ closes: closes_in, fiftyTwoWeekHigh: 100 }),
      makeYahooResponse({ closes: closes_far, fiftyTwoWeekHigh: 100 }),
      makeYahooResponse({ closes: closes_near, fiftyTwoWeekHigh: 100 }),
      makeYahooResponse({ closes: closes_in, fiftyTwoWeekHigh: 100 }),
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses[i++] ?? responses[0]);
    const result = await generateQuantitativeCandidates('EARLY_DETECT', { maxCandidates: 3, universeLimit: 5 });
    expect(result.stale).toBe(false);
    // 모든 후보의 drawdown 이 -0.05 ~ -0.15 구간이어야 함
    for (const c of result.candidates) {
      expect(c.metrics.drawdownFromHigh).toBeLessThanOrEqual(-0.05);
      expect(c.metrics.drawdownFromHigh).toBeGreaterThanOrEqual(-0.15);
    }
  });

  it('EgressGuard 차단(503) — successCount < 5 → stale', async () => {
    setStockMaster([]);
    delete process.env.DATA_FETCH_FORCE_MARKET;
    process.env.DATA_FETCH_FORCE_OFF = 'true'; // EgressGuard 가 모두 503 반환
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => gatedResponse());
    const result = await generateQuantitativeCandidates('MOMENTUM', { maxCandidates: 5, universeLimit: 8 });
    expect(result.stale).toBe(true);
    expect(result.candidates.length).toBe(0);
  });

  it('BEAR_SCREEN — 변동성 하위 정렬', async () => {
    setStockMaster([]);
    // 5종목 — 다양한 변동성
    const closes_low = Array.from({ length: 25 }, () => 100); // 변동 0
    const closes_mid = Array.from({ length: 25 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
    const closes_high = Array.from({ length: 25 }, (_, i) => 100 + (i % 2 === 0 ? 10 : -10));
    let i = 0;
    const responses = [
      makeYahooResponse({ closes: closes_high }),
      makeYahooResponse({ closes: closes_mid }),
      makeYahooResponse({ closes: closes_low }),
      makeYahooResponse({ closes: closes_low }),
      makeYahooResponse({ closes: closes_mid }),
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses[i++] ?? responses[0]);

    const result = await generateQuantitativeCandidates('BEAR_SCREEN', { maxCandidates: 3, universeLimit: 5 });
    expect(result.stale).toBe(false);
    // 첫 번째는 변동성 가장 낮은 종목
    expect(result.candidates[0].metrics.volatility20d).toBeLessThan(result.candidates[result.candidates.length - 1].metrics.volatility20d);
  });

  it('rankCandidates — QUANT_SCREEN 은 MOMENTUM 정렬에 위임 (Naver enrichment 후 service 에서 PER/PBR 필터)', () => {
    const items = new Map<string, { entry: { code: string; name: string; market: 'KOSPI' | 'KOSDAQ' }; metrics: Record<string, number> }>();
    items.set('A', { entry: { code: 'A', name: 'a', market: 'KOSPI' }, metrics: { momentum20d: 0.05, avgTurnoverKrw: 100 } });
    items.set('B', { entry: { code: 'B', name: 'b', market: 'KOSPI' }, metrics: { momentum20d: 0.30, avgTurnoverKrw: 200 } });
    const r = __testOnly.rankCandidates('QUANT_SCREEN', items);
    expect(r[0].code).toBe('B');
  });
});
