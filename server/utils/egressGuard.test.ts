/**
 * @responsibility EgressGuard 심볼 추출·게이트 판정·synthetic Response 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateEgress,
  guardedFetch,
  __setFetchImplForTests,
  __resetFetchImplForTests,
  __resetLogThrottleForTests,
} from './egressGuard.js';

// KST 토요일 정오 — KRX/NYSE 모두 closed
const SAT_KST_NOON = new Date('2026-04-25T03:00:00.000Z');
// KST 월 정오 — KRX open, NYSE closed
const MON_KST_NOON = new Date('2026-04-27T03:00:00.000Z');
// ET 월 10:30 — NYSE open, KRX closed
const MON_NYSE_OPEN = new Date('2026-04-27T15:30:00.000Z');

afterEach(() => {
  __resetFetchImplForTests();
  __resetLogThrottleForTests();
  delete process.env.EGRESS_GUARD_DISABLED;
  delete process.env.DATA_FETCH_FORCE_MARKET;
  delete process.env.DATA_FETCH_FORCE_OFF;
});

describe('evaluateEgress — URL 기반 심볼 추출 + 시장 판정', () => {
  it('Yahoo chart URL 에서 심볼 추출 (query2)', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS?range=1y', MON_KST_NOON);
    expect(d.action).toBe('pass');
    expect(d.symbol).toBe('005930.KS');
    expect(d.market).toBe('KRX');
  });

  it('Yahoo chart URL 에서 심볼 추출 (query1)', () => {
    const d = evaluateEgress('https://query1.finance.yahoo.com/v8/finance/chart/AAPL', MON_NYSE_OPEN);
    expect(d.action).toBe('pass');
    expect(d.symbol).toBe('AAPL');
    expect(d.market).toBe('NYSE');
  });

  it('URL-encoded ^KQ11 — decodeURIComponent 후 분류', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/%5EKQ11?range=1d', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.symbol).toBe('^KQ11');
    expect(d.market).toBe('KRX');
  });

  it('KRX 주말 → skip', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/^KS11', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('KRX');
  });

  it('NYSE 평일 장외(KST 토 정오 = ET 금 22:00) → skip', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/^VIX', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('NYSE');
  });

  it('KRX 장중(월 12:00 KST) → pass', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v8/finance/chart/^KS11', MON_KST_NOON);
    expect(d.action).toBe('pass');
    expect(d.market).toBe('KRX');
  });

  it('quoteSummary endpoint 도 지원', () => {
    const d = evaluateEgress('https://query2.finance.yahoo.com/v10/finance/quoteSummary/005930.KS?modules=assetProfile', SAT_KST_NOON);
    expect(d.action).toBe('skip');
    expect(d.market).toBe('KRX');
  });

  it('미등록 host → pass', () => {
    const d = evaluateEgress('https://api.stlouisfed.org/fred/series/observations', SAT_KST_NOON);
    expect(d.action).toBe('pass');
    expect(d.symbol).toBeUndefined();
  });

  it('심볼 추출 불가(finance.yahoo.com 루트) → pass', () => {
    const d = evaluateEgress('https://finance.yahoo.com/', SAT_KST_NOON);
    expect(d.action).toBe('pass');
  });

  it('잘못된 URL → pass (원 fetch 가 에러 처리)', () => {
    const d = evaluateEgress('not-a-url', SAT_KST_NOON);
    expect(d.action).toBe('pass');
  });
});

describe('guardedFetch — pass 분기', () => {
  it('시장 열려있으면 native fetch 호출', async () => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    const mock = vi.fn(async () => new Response('{}', { status: 200 }));
    __setFetchImplForTests(mock as any);
    const res = await guardedFetch('https://query2.finance.yahoo.com/v8/finance/chart/AAPL');
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledOnce();
  });

  it('미등록 host 는 native fetch 호출 (FORCE_OFF 여도 pass)', async () => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    const mock = vi.fn(async () => new Response('{}', { status: 200 }));
    __setFetchImplForTests(mock as any);
    const res = await guardedFetch('https://api.example.com/data');
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledOnce();
  });
});

describe('guardedFetch — skip 분기 (synthetic 503)', () => {
  beforeEach(() => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
  });

  it('시장 닫혀있으면 503 + X-Egress-Guard 헤더, native fetch 미호출', async () => {
    const mock = vi.fn(async () => new Response('{}', { status: 200 }));
    __setFetchImplForTests(mock as any);
    const res = await guardedFetch('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS');
    expect(res.status).toBe(503);
    expect(res.ok).toBe(false);
    expect(res.headers.get('X-Egress-Guard')).toBe('market-closed');
    expect(mock).not.toHaveBeenCalled();
  });

  it('body 에 gated=true + symbol + market 포함', async () => {
    __setFetchImplForTests(vi.fn() as any);
    const res = await guardedFetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL');
    const body = await res.json() as { gated: boolean; symbol: string; market: string };
    expect(body.gated).toBe(true);
    expect(body.symbol).toBe('AAPL');
    expect(body.market).toBe('NYSE');
  });
});

describe('EGRESS_GUARD_DISABLED env 탈출구', () => {
  it('true 면 시장 닫혀있어도 native fetch 호출', async () => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    process.env.EGRESS_GUARD_DISABLED = 'true';
    const mock = vi.fn(async () => new Response('{}', { status: 200 }));
    __setFetchImplForTests(mock as any);
    const res = await guardedFetch('https://query2.finance.yahoo.com/v8/finance/chart/005930.KS');
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledOnce();
  });
});
